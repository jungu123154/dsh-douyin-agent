// DFY 互动能力模块：点赞 / 收藏 / 评论 / 查看他人主页
// 复用既有 CDP 通道，不启动第二个浏览器；由 native-settings 路由暴露给设置页。
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const EDITOR_SEL = '.comment-input-inner-container [contenteditable="true"],.comment-input-container [contenteditable="true"],.comment-input-inner-container textarea';
const CREATOR_UPLOAD = 'https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web';

// 轮询等待条件成立，命中即返回，避免固定 sleep 拖慢整体速度。
async function waitFor(probe, { timeoutMs = 6000, intervalMs = 150, fallback = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(intervalMs);
  }
  return fallback;
}

function controlFile() {
  return path.join(homedir(), '.dsh', 'douyin-browser', 'control', 'browser.json');
}
function browserPort() {
  const file = controlFile();
  if (!existsSync(file)) throw Object.assign(new Error('专用浏览器尚未启动，请先打开抖音页。'), { status: 409 });
  const { port } = JSON.parse(readFileSync(file, 'utf8'));
  if (!port) throw Object.assign(new Error('专用浏览器端口未记录。'), { status: 409 });
  return port;
}
async function listPages() {
  const port = browserPort();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  return targets.filter(t => t.type === 'page' && /douyin\.com/.test(t.url || ''));
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('浏览器调试通道连接失败。')); });
  let seq = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, m => m.error ? rej(new Error(m.error.message || '调试命令失败')) : res(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaljs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '页面脚本执行失败');
    return r.result?.value;
  };
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(180);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(70);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  return { ws, ready, send, evaljs, clickAt };
}
const videoIdOf = url => (String(url || '').match(/(?:video|note)\/(\d{10,})/) || [])[1] || '';
const userIdOf = url => (String(url || '').match(/\/user\/([A-Za-z0-9_-]{10,})/) || [])[1] || '';

export class InteractionService {
  constructor({ stateDir, getController, notifier } = {}) {
    this.stateDir = stateDir || path.join(homedir(), '.dsh', 'douyin-browser', 'state');
    this.getController = getController;
    this.notifier = notifier;
    this.lockFile = path.join(this.stateDir, 'interaction.lock');
  }

  // 主人通知：动作记录失败不影响动作本身，也不阻塞返回。
  async notifyOwner(entry) {
    try { await this.notifier?.notify(entry); } catch { /* 通知失败只丢记录，不影响已完成的动作。 */ }
  }

  audit(entry) {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      appendFileSync(path.join(this.stateDir, 'interaction-audit.log'), JSON.stringify({ at: new Date().toISOString(), source: 'dsh-settings', ...entry }) + '\n');
    } catch { /* 审计失败不影响主流程 */ }
  }

  // 选一个可操作页面：优先指定视频页，其次推荐流
  async pickPage(videoId) {
    const pages = await listPages();
    if (!pages.length) throw Object.assign(new Error('没有可用的抖音页面，请先打开抖音。'), { status: 409 });
    const byVideo = videoId ? pages.find(p => p.url.includes(videoId)) : null;
    const feed = pages.find(p => /recommend|jingxuan/.test(p.url));
    const pick = byVideo || feed || pages[0];
    const conn = connect(pick.webSocketDebuggerUrl);
    await conn.ready;
    if (videoId && !byVideo) {
      // 需要导航到目标作品；导航后由 readVideo 轮询就绪，不再固定等待。
      await conn.send('Page.navigate', { url: `https://www.douyin.com/video/${videoId}` });
      return { conn, page: pick, navigated: true };
    }
    return { conn, page: pick, navigated: false };
  }

  // 通用：等待视频就绪并读取作者/标题
  async readVideo(conn, { timeoutMs = 9000 } = {}) {
    const probe = async () => conn.evaljs(`(() => {
        const el = document.querySelector('video');
        const id = (location.href.match(/(?:video|note)\\/(\\d{10,})/) || [])[1] || null;
        if (!el || !id || el.readyState < 2) return null;
        // 作者：只用可靠选择器，避免误取评论区昵称
        const authorEl = document.querySelector('[data-e2e="video-author"],[data-e2e="user-name"]');
        const authorLink = [...document.querySelectorAll('a[href*="/user/MS4w"],a[href^="/user/MS4w"]')]
          .find(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (a.textContent || '').trim().length > 0; });
        let author = authorEl ? (authorEl.textContent || '').trim() : '';
        if (!author && authorLink) author = (authorLink.textContent || '').trim();
        return { id, url: location.href.split('?')[0], author: author || null, duration: el.duration || 0, paused: el.paused, ready: el.readyState };
      })()`);
    const value = await waitFor(probe, { timeoutMs, intervalMs: 200 });
    if (value) return value;
    throw Object.assign(new Error('目标作品尚未就绪，请稍后重试。'), { status: 409 });
  }

  // 定位互动区（作品详情页：点赞/评论/收藏/分享 同一行）
  async railBoxes(conn) {
    return conn.evaljs(`(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
      const out = [];
      for (const e of document.querySelectorAll('div,span')) {
        if (!vis(e)) continue;
        const t = (e.textContent || '').trim();
        if (!/^(\\d+([.,]\\d+)?[万w]?|抢首评|评论|收藏|分享|点赞)$/.test(t)) continue;
        const r = e.getBoundingClientRect();
        if (r.width > 90 || r.width < 8 || r.height > 60) continue;
        if (r.left < window.innerWidth * 0.02) continue;
        out.push({ t, cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, top: r.top, w: r.width });
      }
      // 按行聚合，取同一行的控件（从左到右：点赞 / 评论 / 收藏 / 分享）
      const rows = new Map();
      for (const b of out) {
        const key = Math.round(b.cy / 12);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(b);
      }
      let best = null;
      for (const [, items] of rows) {
        if (!items.some(i => i.t === '分享') || items.length < 3) continue;
        // 优先取可见行，否则取第一行（后续会滚进视野）
        const inView = items.every(i => i.cy > 0 && i.cy < window.innerHeight);
        if (inView) { best = items; break; }
        if (!best) best = items;
      }
      if (!best) return null;
      best.sort((a, b) => a.left - b.left);
      const uniq = [];
      for (const b of best) if (!uniq.some(u => Math.abs(u.left - b.left) < 8)) uniq.push(b);
      const inViewport = uniq.every(u => u.cy > 0 && u.cy < window.innerHeight);
      return { cy: Math.round(uniq[0].cy), inViewport, items: uniq.map(u => ({ t: u.t, cx: Math.round(u.cx), cy: Math.round(u.cy), left: Math.round(u.left) })) };
    })()`);
  }

  async ensureRail(conn) {
    let rail = await this.railBoxes(conn);
    if (rail?.inViewport) return rail;
    // 控件行不在视野内：把承载它的行滚进视野，再重新读取坐标。
    if (rail) {
      await conn.evaljs(`(() => {
        const items = [${rail.items.map(i => `'${i.t}'`).join(',')}];
        for (const e of document.querySelectorAll('div,span')) {
          const t = (e.textContent || '').trim();
          if (!items.includes(t)) continue;
          const r = e.getBoundingClientRect();
          if (r.width > 90 || r.width < 8) continue;
          e.scrollIntoView({ block: 'center', inline: 'nearest' });
          return 1;
        }
        return 0;
      })()`);
      rail = await waitFor(async () => { const next = await this.railBoxes(conn); return next?.inViewport ? next : null; }, { timeoutMs: 2500, intervalMs: 150 }) || await this.railBoxes(conn);
      if (rail?.inViewport) return rail;
    }
    // 悬停视频唤出控件，随后轮询等控件出现
    const v = await conn.evaljs(`(() => { const v = document.querySelector('video'); if (!v) return null; const r = v.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
    if (v) { await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x, y: v.y, button: 'none' }); }
    return waitFor(async () => { const next = await this.railBoxes(conn); return next?.inViewport ? next : null; }, { timeoutMs: 3500, intervalMs: 200 }) || rail;
  }

  // 找出点赞/评论/收藏三个按钮的坐标（作品详情页固定顺序：点赞 / 评论 / 收藏）
  pickThree(rail) {
    if (!rail || !rail.items?.length) return null;
    const noShare = rail.items.filter(i => i.t !== '分享');
    const like = noShare[0];
    const collect = noShare[noShare.length - 1];
    const comment = noShare.length >= 3 ? noShare[1] : null;
    return { like, collect, comment };
  }

  async pressLike(conn, target) {
    // 同坐标读计数：点击前 / 点击后 用完全相同的选择逻辑，避免误判
    const readStat = () => conn.evaljs(`(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
      for (const e of document.querySelectorAll('div,span')) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (Math.abs(r.left + r.width/2 - ${target.cx}) < 34 && Math.abs(r.top + r.height/2 - ${target.cy}) < 26) {
          const t = (e.textContent || '').trim();
          if (/^\\d+([.,]\\d+)?[万w]?$/.test(t)) return { text: t, cls: String(e.className).slice(0, 40) };
        }
      }
      return null;
    })()`);
    const before = await readStat();
    await conn.clickAt(target.cx, target.cy);
    // 等计数变化或按钮进入已点赞态，最多 3 秒，命中立刻返回。
    const after = await waitFor(async () => {
      const current = await readStat();
      if (!current) return null;
      return current.text !== before?.text || /active|liked|selected/i.test(current.cls || '') ? current : null;
    }, { timeoutMs: 3000, intervalMs: 150, fallback: null }) || await readStat();
    const pressed = await conn.evaljs(`(() => {
      const el = document.elementFromPoint(${target.cx}, ${target.cy});
      let node = el;
      for (let i = 0; i < 4 && node; i++) { if (/active|liked|selected/i.test(String(node.className || ''))) return true; node = node.parentElement; }
      return false;
    })()`);
    const liked = pressed || (before && after && before.text !== after.text) || (!before && Boolean(after));
    return { before: before?.text ?? null, after: after?.text ?? null, pressed: Boolean(pressed), liked: Boolean(liked) };
  }

  async pressCollect(conn, target) {
    const before = await conn.evaljs(`(() => { for (const e of document.querySelectorAll('div,span')) { const r=e.getBoundingClientRect(); if (Math.abs(r.left+r.width/2-${target.cx})<30 && Math.abs(r.top+r.height/2-${target.cy})<24) { const t=(e.textContent||'').trim(); if(/^\\d+([.,]\\d+)?[万w]?$/.test(t)) return t; } } return null; })()`);
    await conn.clickAt(target.cx, target.cy);
    // 收藏可能弹出收藏夹，轮询等弹层；不弹层时不空等。
    const dialog = await waitFor(() => conn.evaljs(`(() => {
      const d = document.querySelector('[data-e2e="collect-dialog"],[role="dialog"],.semi-modal,.collect-popup');
      if (!d) return null;
      const txt = (d.textContent||'').replace(/\\s+/g,' ').slice(0, 60);
      return txt ? { txt } : null;
    })()`), { timeoutMs: 2500, intervalMs: 200 });
    return { before, dialog };
  }

  async postComment(conn, text) {
    const findEditor = () => conn.evaljs(`(() => { const el = [...document.querySelectorAll('${EDITOR_SEL}')].find(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width/2), y: r.y + r.height/2 }; })()`);
    const clickLazy = () => conn.evaljs(`(() => { const el = [...document.querySelectorAll('.comment-input-inner-container')].find(e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8; }); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.top < 0 || r.top > window.innerHeight) return null; return { x: r.x + Math.min(40, r.width/2), y: r.top + r.height/2 }; })()`);

    // 1) 已激活就直接用
    let ed = await findEditor();
    // 2) 优先点懒加载的评论输入容器（详情页最稳）
    for (let attempt = 0; attempt < 2 && !ed; attempt++) {
      const lazy = await clickLazy();
      if (lazy) { await conn.clickAt(lazy.x, lazy.y); ed = await waitFor(findEditor, { timeoutMs: 2500, intervalMs: 150 }); }
    }
    // 3) 仍没有就用互动行里的"评论"按钮
    if (!ed) {
      const rail = await this.ensureRail(conn);
      const three = this.pickThree(rail);
      if (three?.comment) { await conn.clickAt(three.comment.cx, three.comment.cy); ed = await waitFor(findEditor, { timeoutMs: 3000, intervalMs: 200 }); }
    }
    if (!ed) throw Object.assign(new Error('评论输入区没有出现，请确认页面已展示作品详情。'), { status: 409 });

    // 2) 清空 → 输入
    await conn.clickAt(ed.x, ed.y);
    // 等编辑器获得焦点再清空，避免抢跑
    await waitFor(() => conn.evaljs(`(() => { const el = document.activeElement; return Boolean(el && (el.isContentEditable || el.tagName === 'TEXTAREA')); })()`), { timeoutMs: 1500, intervalMs: 100 });
    await conn.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await sleep(120);
    await conn.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await waitFor(() => conn.evaljs(`(() => { const el = [...document.querySelectorAll('${EDITOR_SEL}')].find(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }); return el ? !((el.value ?? el.innerText ?? '').trim()) : false; })()`), { timeoutMs: 1200, intervalMs: 100 });
    await conn.send('Input.insertText', { text });
    const draft = await waitFor(async () => {
      const value = await conn.evaljs(`(() => { const el = [...document.querySelectorAll('${EDITOR_SEL}')].find(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }); return el ? ((el.value ?? el.innerText ?? '').trim()) : null; })()`);
      return value === text ? value : null;
    }, { timeoutMs: 2500, intervalMs: 120 });
    if (draft !== text) throw Object.assign(new Error('评论草稿写入未通过核对，未发布。'), { status: 409 });

    // 3) 找发布按钮并点击
    const btn = await conn.evaljs(`(() => { const els = [...document.querySelectorAll('span.wchsYBpK,[data-e2e="comment-post"],[aria-label="发布"],[aria-label="发送"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[data-e2e="comment-item"],[data-e2e="im-dialog"]'); }); const enabled = els.find(e => e.classList.contains('jfGCpJo0')) || els[0]; if (!enabled) return null; const r = enabled.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, enabled: enabled.classList.contains('jfGCpJo0') }; })()`);
    if (!btn) throw Object.assign(new Error('未找到评论发布按钮，已保留草稿。'), { status: 409 });
    const beforeCount = await conn.evaljs(`document.querySelectorAll('[data-e2e="comment-item"]').length`);
    await conn.clickAt(btn.x, btn.y);
    // 等"输入框清空"或评论出现，命中即返回，最长 6 秒。
    const after = await waitFor(async () => {
      const state = await conn.evaljs(`(() => { const items = [...document.querySelectorAll('[data-e2e="comment-item"]')]; const mine = items.filter(i => (i.textContent||'').includes(${JSON.stringify(text.slice(0, 8))})); const el = [...document.querySelectorAll('${EDITOR_SEL}')].find(e => { const r = e.getBoundingClientRect(); return r.width > 4; }); return { total: items.length, mine: mine.length, draftLeft: el ? ((el.innerText ?? '').trim().slice(0, 30)) : '', sample: mine[0] ? (mine[0].textContent||'').replace(/\\s+/g,' ').slice(0, 60) : null }; })()`);
      if (state.mine > 0) return state;
      if (!state.draftLeft) return state;
      return null;
    }, { timeoutMs: 6000, intervalMs: 250, fallback: null }) || { total: beforeCount, mine: 0, draftLeft: '', sample: null };
    const ok = after.mine > 0 || (!after.draftLeft && after.total >= beforeCount);
    return { ok, text, before: beforeCount, after };
  }

  // 检测登录/验证遮罩：命中时立刻给出可操作提示，不再空等超时。
  async assertInteractive(conn) {
    const blocked = await conn.evaljs(`(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const mask = [...document.querySelectorAll('.second-verify-mask,[class*="verify_mask"],[class*="verify-mask"],[data-e2e*="verify"]')].find(vis);
      const text = document.body.innerText || '';
      const verifyText = /为确保是本人操作|请输入当前手机|短信验证码|请完成验证|安全验证/.test(text);
      const loginText = /扫码登录|登录后查看更多|请先登录/.test(text);
      const loginMask = [...document.querySelectorAll('[data-e2e="login-mask"],[class*="login-mask"],[class*="loginMask"]')].find(vis);
      return {
        verification: Boolean(mask) || verifyText,
        login: Boolean(loginMask) || loginText,
        hint: (mask?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) || null,
      };
    })()`);
    if (blocked?.verification) throw Object.assign(new Error(`抖音要求短信安全验证，页面上有遮罩挡住了互动按钮。请到专用浏览器窗口完成验证后重试。${blocked.hint ? `（页面提示：${blocked.hint}）` : ''}`), { status: 409, code: 'DOUYIN_VERIFICATION_REQUIRED' });
    if (blocked?.login) throw Object.assign(new Error('专用浏览器里的抖音账号已退出登录，请重新登录后重试。'), { status: 409, code: 'DOUYIN_LOGIN_REQUIRED' });
    return true;
  }

  // 对外：只检查当前页面能否互动（不点击、不发评论）
  async check() {
    const pages = await listPages();
    if (!pages.length) return { ok: false, reason: '没有可用的抖音页面，请先打开抖音。', needsUserAction: true };
    const page = pages.find(p => /video\//.test(p.url)) || pages.find(p => /recommend|jingxuan/.test(p.url)) || pages[0];
    const conn = connect(page.webSocketDebuggerUrl);
    await conn.ready;
    try {
      let video = null;
      try { video = await this.readVideo(conn, { timeoutMs: 4000 }); } catch { /* 推荐流页可能没有作品 */ }
      let blocked;
      try { await this.assertInteractive(conn); blocked = { ok: true }; }
      catch (error) { blocked = { ok: false, reason: error.message, code: error.code || null, needsUserAction: true }; }
      let rail = null;
      try { rail = await this.railBoxes(conn); } catch { /* ignore */ }
      return {
        ok: blocked.ok === true && Boolean(rail),
        page: video?.url || page.url,
        video: video ? { id: video.id, author: video.author, duration: video.duration } : null,
        railFound: Boolean(rail),
        inViewport: rail?.inViewport ?? null,
        buttons: rail?.items?.map(i => i.t) ?? [],
        ...(blocked.ok ? {} : { reason: blocked.reason, code: blocked.code, needsUserAction: true }),
        ...(rail ? {} : { hint: '没有找到点赞/评论/收藏按钮行，可能页面没加载完或抖音改版。' }),
      };
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }

  // ── 发布作品 ──────────────────────────────────────────────

  // 在页面里找发布表单的关键控件
  async creatorForm(conn) {
    return conn.evaljs(`(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const file = [...document.querySelectorAll('input[type="file"]')].find(e => /video/i.test(e.getAttribute('accept') || ''));
      const editors = [...document.querySelectorAll('[contenteditable="true"],textarea')].filter(vis);
      const titleInput = editors.find(e => /标题|作品描述|添加作品描述|说说/.test(e.getAttribute('placeholder') || e.getAttribute('data-placeholder') || ''))
        || editors.find(e => e.closest('[class*="editor"],[class*="Editor"],[class*="desc"],[class*="Desc"]'))
        || editors[0] || null;
      const btns = [...document.querySelectorAll('button,[role="button"]')].filter(vis);
      const publishBtn = btns.find(e => /^(发布|立即发布|发布作品)$/.test((e.textContent || '').trim()));
      const box = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: Math.round(r.width) }; };
      return {
        hasFileInput: Boolean(file),
        editors: editors.length,
        titleBox: box(titleInput),
        titleTag: titleInput ? titleInput.tagName : null,
        publishBox: box(publishBtn),
        publishDisabled: publishBtn ? (publishBtn.disabled || publishBtn.getAttribute('aria-disabled') === 'true' || /disabled/i.test(publishBtn.className || '')) : null,
        uploading: /上传中|正在上传|上传失败|处理中/.test(document.body.innerText || ''),
        ready: Boolean(publishBtn) && !/上传中|正在上传|处理中/.test(document.body.innerText || ''),
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
      };
    })()`);
  }

  // 打开创作者中心上传页（复用已有页面，没有就新建）
  async openCreatorPage() {
    const pages = await listPages();
    const existing = pages.find(p => /creator\.douyin\.com\/creator-micro\/content\/upload/.test(p.url));
    const target = existing || pages.find(p => /creator\.douyin\.com/.test(p.url));
    if (target) {
      const conn = connect(target.webSocketDebuggerUrl);
      await conn.ready;
      if (!/creator-micro\/content\/upload/.test(target.url)) {
        await conn.send('Page.navigate', { url: CREATOR_UPLOAD });
      }
      return { conn, page: target };
    }
    const page = pages[0];
    if (!page) throw Object.assign(new Error('没有可用的浏览器页面，请先打开抖音。'), { status: 409 });
    const conn = connect(page.webSocketDebuggerUrl);
    await conn.ready;
    await conn.send('Page.navigate', { url: CREATOR_UPLOAD });
    await sleep(1500);
    const list = await listPages();
    const created = list.find(p => /creator-micro\/content\/upload/.test(p.url));
    if (created) { try { conn.ws.close(); } catch {} const next = connect(created.webSocketDebuggerUrl); await next.ready; return { conn: next, page: created }; }
    return { conn, page };
  }

  // 对外：发布作品（视频）。filePath 为本机视频绝对路径。
  async publish({ filePath, title = '', tags = [], publish = true, dryRun = false } = {}) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw Object.assign(new Error('请提供本机视频文件路径。'), { status: 400 });
    if (!existsSync(filePath)) throw Object.assign(new Error(`找不到视频文件：${filePath}`), { status: 400 });
    if (!/\.(mp4|mov|webm|flv|avi|mkv|m4v|ts|mpeg4|mpg|wmv)$/i.test(filePath)) throw Object.assign(new Error('只支持常见视频格式（mp4/mov/webm 等）。'), { status: 400 });
    const caption = String(title || '').slice(0, 500);
    const tagList = (Array.isArray(tags) ? tags : []).map(t => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
    const startedAt = Date.now();
    const timings = {};
    const { conn, page } = await this.openCreatorPage();
    const result = { filePath, page: page.url, steps: {} };
    try {
      // 1) 等上传页就绪
      const form = await waitFor(async () => { const f = await this.creatorForm(conn); return f?.hasFileInput ? f : null; }, { timeoutMs: 15000, intervalMs: 300 });
      if (!form) throw Object.assign(new Error('创作者中心上传页没有就绪。请确认专用浏览器已登录抖音创作者中心。'), { status: 409, code: 'CREATOR_PAGE_NOT_READY' });
      timings.等待上传页 = Date.now() - startedAt; let cursor = Date.now();

      // 2) 通过 CDP 设置文件（等价于用户选文件）
      const { root } = await conn.send('DOM.getDocument', { depth: 1 });
      const { nodeId } = await conn.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
      if (!nodeId) throw Object.assign(new Error('上传页没有文件输入框。'), { status: 409 });
      await conn.send('DOM.setFileInputFiles', { files: [filePath], nodeId });
      result.steps.fileSelected = true;
      cursor = Date.now();

      // 3) 等编辑表单出现（上传开始后才有标题框与发布按钮）
      const ready = await waitFor(async () => { const f = await this.creatorForm(conn); return f?.publishBox && f?.titleBox ? f : null; }, { timeoutMs: 120000, intervalMs: 800 });
      if (!ready) throw Object.assign(new Error('上传后没有出现发布表单，可能上传失败或页面改版。'), { status: 409, code: 'PUBLISH_FORM_TIMEOUT' });
      timings.等待上传处理 = Date.now() - cursor; cursor = Date.now();
      result.steps.formReady = true;

      // 4) 填标题与话题
      if (caption || tagList.length) {
        const text = [caption, ...tagList.map(t => `#${t}`)].filter(Boolean).join(' ');
        await conn.clickAt(ready.titleBox.x, ready.titleBox.y);
        await sleep(250);
        await conn.send('Input.insertText', { text });
        await sleep(300);
        const filled = await conn.evaljs(`(() => { const eds = [...document.querySelectorAll('[contenteditable="true"],textarea')]; for (const e of eds) { const v = (e.value ?? e.innerText ?? '').trim(); if (v) return v.slice(0, 120); } return ''; })()`);
        result.steps.titleFilled = filled ? filled.slice(0, 80) : null;
      }
      timings.填写说明 = Date.now() - cursor; cursor = Date.now();

      if (dryRun || !publish) {
        result.published = false;
        result.dryRun = true;
        result.note = '已选文件并填好说明，按 dryRun 未点击发布。';
        timings.总计 = Date.now() - startedAt;
        result.timings = timings;
        this.audit({ action: 'publish.dryRun', ...result });
        return result;
      }

      // 5) 点发布
      const final = await this.creatorForm(conn);
      if (!final?.publishBox) throw Object.assign(new Error('找不到发布按钮。'), { status: 409 });
      if (final.publishDisabled) throw Object.assign(new Error('发布按钮当前不可用（可能仍在转码或缺少必填项）。'), { status: 409, code: 'PUBLISH_BUTTON_DISABLED' });
      await conn.clickAt(final.publishBox.x, final.publishBox.y);
      cursor = Date.now();

      // 6) 核对：跳到内容管理或出现成功提示
      const done = await waitFor(async () => {
        const state = await conn.evaljs(`(() => ({ url: location.href, text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) }))()`);
        if (/content\/manage|content\/post/.test(state.url)) return { by: 'redirect', url: state.url };
        if (/发布成功|作品已发布|已提交审核|审核中/.test(state.text)) return { by: 'toast', text: state.text.slice(0, 80) };
        return null;
      }, { timeoutMs: 30000, intervalMs: 500 });
      result.published = Boolean(done);
      result.confirm = done;
      timings.发布确认 = Date.now() - cursor;
      timings.总计 = Date.now() - startedAt;
      result.timings = timings;
      this.audit({ action: 'publish', ...result });
      return result;
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }

  // 对外：只检查发布页能否用（不选文件）
  async publishStatus() {
    const { conn, page } = await this.openCreatorPage();
    try {
      const form = await waitFor(async () => { const f = await this.creatorForm(conn); return f?.hasFileInput ? f : null; }, { timeoutMs: 12000, intervalMs: 300 });
      if (!form) return { ok: false, page: page.url, reason: '上传页没有就绪，可能未登录创作者中心。', needsUserAction: true };
      return { ok: true, page: page.url, hasFileInput: form.hasFileInput, text: form.text };
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }

  // 对外：点赞+收藏+评论 一条龙
  async interact({ videoId, comment = '', like = true, collect = true } = {}) {
    const id = String(videoId || '').replace(/\D/g, '');
    if (!id) throw Object.assign(new Error('请提供作品 ID 或链接。'), { status: 400 });
    const text = String(comment || '').slice(0, 300);
    const startedAt = Date.now();
    const timings = {};
    const mark = (label, from) => { timings[label] = Date.now() - from; };
    let cursor = startedAt;
    const { conn, page, navigated } = await this.pickPage(id);
    mark('定位页面', cursor); cursor = Date.now();
    const result = { videoId: id, page: page.url, navigated, like: null, collect: null, comment: null };
    try {
      const video = await this.readVideo(conn);
      result.video = video;
      result.page = video.url || page.url;
      mark('等待作品就绪', cursor); cursor = Date.now();
      if (video.id !== id) throw Object.assign(new Error('当前页面作品与目标不一致，未执行互动。'), { status: 409 });
      await this.assertInteractive(conn);
      mark('检查页面状态', cursor); cursor = Date.now();
      const rail = await this.ensureRail(conn);
      mark('定位互动按钮', cursor); cursor = Date.now();
      const three = this.pickThree(rail);
      if (!three) throw Object.assign(new Error('未找到互动按钮，请确认作品详情页已完整加载。'), { status: 409 });
      result.rail = rail;
      if (like) { result.like = await this.pressLike(conn, three.like); mark('点赞', cursor); cursor = Date.now(); }
      if (collect) { result.collect = await this.pressCollect(conn, three.collect); mark('收藏', cursor); cursor = Date.now(); }
      if (text) { result.comment = await this.postComment(conn, text); mark('评论', cursor); cursor = Date.now(); }
      timings.总计 = Date.now() - startedAt;
      result.timings = timings;
      this.audit({ action: 'interact', ...result, ok: Boolean(result.like?.liked || result.comment?.ok || result.collect) });
      // 点赞与评论是对外可见的动作，逐个通知主人；收藏是自己的事，不打扰。
      if (result.like) await this.notifyOwner({
        kind: 'like', action: result.like.liked ? '给作品点了赞' : '点赞没有确认',
        title: `作品 ${id}${video?.author ? ` · @${video.author}` : ''}`,
        detail: `点赞数 ${result.like.before ?? '?'} → ${result.like.after ?? '?'}`,
        target: video?.author || '作品作者', videoId: id,
        result: result.like.liked ? 'confirmed' : 'uncertain',
        dedupeKey: `like:${id}:${result.like.before}:${result.like.after}`,
      });
      if (result.comment) await this.notifyOwner({
        kind: 'comment', action: result.comment.ok ? '发了一条公开评论' : '评论没有确认',
        title: result.comment.text || '',
        detail: `作品 ${id}${video?.author ? ` · @${video.author}` : ''}`,
        target: '公开评论区', videoId: id,
        result: result.comment.ok ? 'confirmed' : 'uncertain',
        dedupeKey: `comment-manual:${id}:${(result.comment.text || '').slice(0, 40)}`,
      });
      return result;
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }

  // 对外：只发评论
  async comment({ videoId, text } = {}) {
    const id = String(videoId || '').replace(/\D/g, '');
    if (!id) throw Object.assign(new Error('请提供作品 ID 或链接。'), { status: 400 });
    const body = String(text || '').trim();
    if (!body) throw Object.assign(new Error('评论内容不能为空。'), { status: 400 });
    const { conn, page } = await this.pickPage(id);
    try {
      const video = await this.readVideo(conn);
      if (video.id !== id) throw Object.assign(new Error('当前页面作品与目标不一致，未发布评论。'), { status: 409 });
      const out = await this.postComment(conn, body);
      this.audit({ action: 'comment', videoId: id, ok: out.ok, text: body, before: out.before, after: out.after });
      await this.notifyOwner({
        kind: 'comment', action: out.ok ? '发了一条公开评论' : '评论没有确认',
        title: body, detail: `作品 ${id}${video?.author ? ` · @${video.author}` : ''}`,
        target: '公开评论区', videoId: id, result: out.ok ? 'confirmed' : 'uncertain',
        dedupeKey: `comment-only:${id}:${body.slice(0, 40)}`,
      });
      return { videoId: id, page: video.url || page.url, ...out };
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }

  // 对外：查看用户主页（本人或他人）
  async profile({ userId = 'self', url = '' } = {}) {
    const target = url || (userId === 'self' ? 'https://www.douyin.com/user/self' : `https://www.douyin.com/user/${String(userId).replace(/[^A-Za-z0-9_-]/g, '')}`);
    if (!/^https:\/\/www\.douyin\.com\/user\//.test(target)) throw Object.assign(new Error('只支持抖音用户主页链接。'), { status: 400 });
    const pages = await listPages();
    const page = pages.find(p => /recommend|jingxuan|user/.test(p.url)) || pages[0];
    if (!page) throw Object.assign(new Error('没有可用的抖音页面。'), { status: 409 });
    const conn = connect(page.webSocketDebuggerUrl);
    await conn.ready;
    try {
      await conn.send('Page.navigate', { url: target });
      // 轮询等主页作品网格出现，不再固定等 6.5 秒
      await waitFor(() => conn.evaljs(`(() => { const posts = document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]'); return posts.length > 0 ? posts.length : 0; })()`), { timeoutMs: 12000, intervalMs: 250 });
      // 点"作品"标签
      await conn.evaljs(`(() => { const tabs = [...document.querySelectorAll('[data-e2e="user-tab"],div,span')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.childElementCount <= 2 && /^作品\\s*\\d*$/.test((e.textContent||'').trim()); }); if (tabs[0]) { tabs[0].click(); return true; } return false; })()`);
      await sleep(800);
      let lastCount = 0;
      for (let i = 0; i < 3; i++) {
        const count = await conn.evaljs(`(() => { window.scrollBy(0, 1400); return document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]').length; })()`);
        if (count === lastCount && i > 0) break;
        lastCount = count;
        await sleep(700);
      }
      const data = await conn.evaljs(`(() => {
        const title = document.title;
        const t = document.body.innerText || '';
        const name = (title.match(/^(.+?)的抖音/) || [])[1] || (t.match(/^([^\\n]{1,20})$/m) || [])[1] || '';
        const fans = (t.match(/粉丝\\s*\\n?\\s*([\\d.万w]+)/) || [])[1] || null;
        const likes = (t.match(/获赞\\s*\\n?\\s*([\\d.万w]+)/) || [])[1] || null;
        const douyinId = (t.match(/抖音号[:：]\\s*([A-Za-z0-9_-]+)/) || [])[1] || null;
        const bio = (t.match(/抖音号[:：][^\\n]*\\n([^\\n]{1,80})/) || [])[1] || null;
        const seen = new Set(); const posts = [];
        for (const a of document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]')) {
          const href = a.getAttribute('href') || '';
          const id = (href.match(/(\\d{15,})/) || [])[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const img = a.querySelector('img');
          posts.push({ id, type: href.includes('/note/') ? 'note' : 'video', title: (img?.getAttribute('alt') || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) });
        }
        return { url: location.href, name, fans, likes, douyinId, bio, postCount: posts.length, posts: posts.slice(0, 30) };
      })()`);
      this.audit({ action: 'profile', target, postCount: data?.postCount ?? 0 });
      return data;
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }

  // 对外：读取这条作品「可以被 @ 的人」——作者 + 评论区已出现的用户。
  // 只读 DOM，不点 @ 、不改评论框；拿到的昵称给设置页做下拉，勾选后存进 @ 名单。
  async readMentionCandidates({ videoId } = {}) {
    const id = String(videoId || '').replace(/\D/g, '');
    const pages = await listPages();
    if (!pages.length) throw Object.assign(new Error('没有可用的抖音页面，请先打开抖音。'), { status: 409 });
    const { conn, page, navigated } = await this.pickPage(id || undefined);
    try {
      let video = null;
      try { video = await this.readVideo(conn, { timeoutMs: id ? 9000 : 4000 }); } catch { /* 推荐流页可能没作品，仍可读评论区 */ }
      // 展开评论区，让更多评论进入 DOM；最多滚 3 屏，找不到就按已有的算。
      await conn.evaljs(`(() => { const box = document.querySelector('[data-e2e="comment-list"]'); if (box) box.scrollTop = box.scrollHeight; return true; })()`).catch(() => {});
      const data = await conn.evaljs(`(() => {
        const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const names = new Map();
        const add = (name, role) => {
          const value = String(name || '').replace(/^@/, '').trim();
          if (!value || value.length > 40 || /[\\s@]/.test(value)) return;
          if (!names.has(value) || role === 'author') names.set(value, { name: value, role });
        };
        // 作者：作品标题区
        for (const sel of ['[data-e2e="video-author"]', '[data-e2e="user-name"]']) {
          const el = document.querySelector(sel);
          if (el && vis(el)) add(el.textContent, 'author');
        }
        for (const a of document.querySelectorAll('a[href*="/user/MS4w"],a[href^="/user/MS4w"]')) {
          if (!vis(a)) continue;
          const text = (a.textContent || '').trim();
          if (!text) continue;
          add(text, 'commenter');
          if (names.size >= 40) break;
        }
        return { current: location.href.split('?')[0], names: [...names.values()] };
      })()`);
      const videoIdOut = video?.id || id || null;
      this.audit({ action: 'mentions.read', videoId: videoIdOut, count: data?.names?.length || 0 });
      return { videoId: videoIdOut, page: video?.url || page.url, navigated: Boolean(navigated), candidates: (data?.names || []).slice(0, 40) };
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }

  // 对外：分享当前/指定作品给已核对会话（轻量回执）
  async share({ videoId, recipientName } = {}) {
    const name = String(recipientName || '').trim();
    if (!name) throw Object.assign(new Error('请填写接收好友昵称。'), { status: 400 });
    const id = String(videoId || '').replace(/\D/g, '');
    const { conn, page } = await this.pickPage(id || undefined);
    try {
      if (id) { const v = await this.readVideo(conn); if (v.id !== id) throw Object.assign(new Error('当前页面作品与目标不一致，未分享。'), { status: 409 }); }
      // 关消息面板（避免遮挡）
      await conn.evaljs(`(() => { const d = document.querySelector('[data-e2e="im-dialog"]'); if (d && d.getBoundingClientRect().width > 0) { document.querySelector('[data-e2e="im-entry"]')?.click(); return 'closed'; } return 'ok'; })()`);
      await sleep(700);
      const camera = () => conn.evaljs(`(() => { const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; return { rows: [...document.querySelectorAll('.otFjqQEX,[data-e2e="share-friend-row"],[data-e2e="share-group-row"]')].filter(vis).length, named: [...document.querySelectorAll('[data-e2e="video-share-container"],.lC5eOSqy')].filter(vis).length }; })()`);
      let probe = await camera();
      for (let i = 0; i < 4 && !(probe.rows || probe.named); i++) {
        const v = await conn.evaljs(`(() => { const v = document.querySelector('video'); if (!v) return null; const r = v.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
        if (v) { await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x, y: v.y, button: 'none' }); await sleep(800); }
        const sp = await conn.evaljs(`(() => {
          const exact = [...document.querySelectorAll('[data-e2e="feed-active-video"] [data-e2e="video-player-share"],[data-e2e="video-share-icon-container"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
          let el = exact[0] || null;
          if (!el) { const c = [...document.querySelectorAll('[data-e2e*="share"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.width * r.height < 9000 && !e.closest('[data-e2e="video-share-container"],.lC5eOSqy,[data-e2e="im-dialog"]'); }); el = c[0] || null; }
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.max(8, Math.min(window.innerWidth - 8, r.x + r.width/2)), y: Math.max(8, Math.min(window.innerHeight - 8, r.y + r.height/2)) };
        })()`);
        if (!sp) { await sleep(700); continue; }
        await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sp.x, y: sp.y, button: 'none' });
        for (let k = 0; k < 8 && !(probe.rows || probe.named); k++) { await sleep(220); probe = await camera(); }
        if (!(probe.rows || probe.named)) { await conn.clickAt(sp.x, sp.y); for (let k = 0; k < 10 && !(probe.rows || probe.named); k++) { await sleep(250); probe = await camera(); } }
      }
      if (!(probe.rows || probe.named)) throw Object.assign(new Error('分享面板没有打开，请确认作品页可见。'), { status: 409 });
      const tgt = await conn.evaljs(`(() => {
        const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const names = [...document.querySelectorAll('.EnYt_IKl,[data-e2e="share-friend-name"]')].filter(vis);
        const el = names.find(e => (e.textContent || '').includes(${JSON.stringify(name)}));
        if (!el) return { notFound: true, names: names.slice(0, 10).map(e => (e.textContent||'').trim().slice(0, 12)) };
        let row = el.closest('[data-e2e="share-friend-row"],[data-e2e="share-group-row"],.otFjqQEX') || el.parentElement?.parentElement;
        for (let i = 0; i < 6 && row; i++) {
          const btn = row.querySelector('.xu0OjnsQ,[data-e2e="share-friend-send"],[data-e2e="share-group-send"]');
          if (btn) { const r = btn.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }
          row = row.parentElement;
        }
        return { noBtn: true };
      })()`);
      if (tgt?.notFound || tgt?.noBtn) throw Object.assign(new Error(tgt?.notFound ? `分享面板里没有找到「${name}」。` : '好友行没有发送按钮。'), { status: 409 });
      await conn.clickAt(tgt.x, tgt.y);
      let closed = false;
      for (let i = 0; i < 24; i++) { await sleep(300); const p2 = await camera(); if (!(p2.rows || p2.named)) { closed = true; break; } }
      await sleep(1500);
      const preview = await conn.evaljs(`(() => {
        const row = [...document.querySelectorAll('[data-e2e="im-dialog"] [data-e2e="conversation-item"]')].find(r => (r.textContent || '').includes(${JSON.stringify(name)}));
        return row ? (row.textContent || '').replace(/\\s+/g, ' ').slice(0, 100) : null;
      })()`);
      const out = { sent: closed, recipient: name, preview, videoId: id || null, page: page.url };
      this.audit({ action: 'share', ...out });
      await this.notifyOwner({
        kind: 'share', action: out.sent ? '分享了一个作品' : '分享没有确认',
        title: out.videoId ? `作品 ${out.videoId}` : '当前作品',
        detail: `接收方：${name}${out.preview ? ` · 会话预览：${out.preview}` : ''}`,
        target: name, videoId: out.videoId || '',
        result: out.sent ? 'confirmed' : 'uncertain',
        dedupeKey: `share-manual:${out.videoId || 'current'}:${name}`,
      });
      return out;
    } finally { try { conn.ws.close(); } catch { /* ignore */ } }
  }
}
