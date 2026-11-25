import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

// 主人通知：插件每次对外的公开动作（点赞 / 收藏 / 发评论 / 分享给别人）都留一条记录。
// 记录先落本机，再从私信推给主人；推送失败只标注原因，绝不重试成重复消息，也不假装送达。

const VERSION = 1;
const MAX_ITEMS = 500;
const KINDS = new Set(['comment', 'like', 'collect', 'share', 'publish', 'dm', 'canary']);
const IDENTIFIER = /^[a-zA-Z0-9_.:@-]{1,120}$/;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

const clean = (value, max) => String(value ?? '')
  .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [凭据已隐藏]')
  .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, '[凭据已隐藏]')
  .replace(/\b(?:token|api[-_]?key|cookie|authorization)\s*[:=]\s*[^\s，。；]+/gi, '[凭据已隐藏]')
  .replace(/\b[A-Za-z]:\\[^\s，。；]+/g, '[本地路径]')
  .replace(/https?:\/\/[^\s，。；]+/gi, '[地址]')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, max);

function readFile(file) {
  let value;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_194_304) throw fail('主人通知记录类型或大小异常，未继续发送通知。');
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: VERSION, items: [] };
    if (error.status) throw error;
    throw fail('主人通知记录无法核对，未继续发送通知。');
  }
  if (!value || value.version !== VERSION || !Array.isArray(value.items)) throw fail('主人通知记录格式无效，未继续发送通知。');
  return value;
}

function writeFile(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export class OwnerNotifier {
  /**
   * @param {{stateDir?: string, getOwner?: () => {configured: boolean, name: string, recipientId: string}, push?: (entry: object, options: object) => Promise<object>, now?: () => number}} deps
   * push 负责把一条通知真正送到主人私信；返回 {confirmed, messageId} 表示送达，抛出或返回其它值一律按未送达记录。
   */
  constructor({ stateDir = resolveRuntimePaths().stateDir, getOwner, push, now = Date.now } = {}) {
    if (typeof stateDir !== 'string' || (getOwner !== undefined && typeof getOwner !== 'function') || (push !== undefined && typeof push !== 'function') || typeof now !== 'function') throw new TypeError('主人通知缺少状态目录、主人读取或推送接口。');
    Object.assign(this, { stateDir, getOwner, push, now });
    this.file = path.join(stateDir, 'owner-notifications.json');
  }

  ownerState() {
    try { return this.getOwner ? this.getOwner() : null; } catch { return null; }
  }

  ledger() { return readFile(this.file); }

  // 同一动作在短时间内重复触发（例如重试或两个入口同时收尾）只留一条，避免刷屏。
  recentDuplicate(ledger, entry) {
    const now = this.now();
    return ledger.items.find(item => item.dedupeKey === entry.dedupeKey
      && Number.isFinite(Date.parse(item.at)) && now - Date.parse(item.at) >= 0 && now - Date.parse(item.at) <= 60_000);
  }

  state({ limit = 40 } = {}) {
    const ledger = this.ledger();
    const items = ledger.items.slice(-Math.max(1, Math.min(200, Number(limit) || 40))).reverse()
      .map(({ id, at, kind, action, title, detail, target, videoId, result, pushStatus, pushReason, pushMessageId }) => ({ id, at, kind, action, title, detail, target, videoId, result, pushStatus, pushReason, pushMessageId }));
    return {
      protocol: 'owner-notify-v1',
      total: ledger.items.length,
      undelivered: ledger.items.filter(item => item.pushStatus === 'not-delivered').length,
      items,
      owner: (() => { const owner = this.ownerState(); return owner ? { configured: owner.configured === true, name: owner.name || '', hasRecipient: Boolean(owner.recipientId) } : null; })(),
    };
  }

  /**
   * 记录一次公开动作，并在需要时推给主人。
   * @param {{kind: string, action: string, title: string, detail?: string, target?: string, videoId?: string, result?: string, toOwner?: boolean, dedupeKey?: string}} entry
   */
  async notify(entry = {}) {
    const kind = String(entry.kind || '');
    if (!KINDS.has(kind)) throw fail('主人通知的动作类型不受支持。', 400);
    const action = clean(entry.action, 60) || kind;
    const title = clean(entry.title, 120) || action;
    const detail = clean(entry.detail, 400);
    const target = clean(entry.target, 80);
    const videoId = /^\d{1,64}$/.test(String(entry.videoId || '')) ? String(entry.videoId) : '';
    const result = clean(entry.result, 60);
    const dedupeKey = typeof entry.dedupeKey === 'string' && entry.dedupeKey.length <= 160 ? entry.dedupeKey : `${kind}:${action}:${target}:${videoId}`;

    const owner = this.ownerState();
    const toOwner = entry.toOwner === true;

    const ledger = this.ledger();
    const duplicate = this.recentDuplicate(ledger, { dedupeKey });
    if (duplicate) return { recorded: false, duplicate: true, id: duplicate.id, pushStatus: duplicate.pushStatus, state: this.state() };

    const item = {
      id: randomUUID(), at: new Date(this.now()).toISOString(), kind, action, title, detail, target, videoId, result,
      dedupeKey, toOwner, pushStatus: 'not-delivered', pushReason: '',
    };

    // 发送前先落盘：即使推送过程崩掉，主人也能在设置页看到这条动作。
    ledger.items.push(item);
    while (ledger.items.length > MAX_ITEMS) ledger.items.shift();
    fs.mkdirSync(this.stateDir, { recursive: true });
    writeFile(this.file, ledger);

    if (this.push && toOwner !== true && owner?.configured === true && owner?.recipientId) {
      try {
        const delivery = await this.push({ ...item }, { signal: this.pushSignal });
        if (delivery?.confirmed === true && typeof delivery.messageId === 'string' && delivery.messageId.length > 0) {
          item.pushStatus = 'delivered'; item.pushMessageId = delivery.messageId; item.pushReason = '';
        } else {
          item.pushStatus = 'not-delivered'; item.pushReason = clean(delivery?.reason || '推送通道没有给出可核对的送达凭据。', 200);
        }
      } catch (error) {
        item.pushStatus = 'not-delivered'; item.pushReason = clean(error?.message || String(error), 200);
      }
    } else if (toOwner === true) {
      item.pushStatus = 'not-required'; item.pushReason = '动作对象就是主人本人，不再重复通知。';
    } else if (owner?.configured !== true) {
      item.pushStatus = 'not-delivered'; item.pushReason = '尚未在设置页选择主人，只记录在本机。';
    } else {
      item.pushStatus = 'not-delivered';
      item.pushReason = owner?.recipientId ? '未配置私信推送通道，只记录在本机。' : '主人还没有对应的许可会话，无法推送，只记录在本机。';
    }

    writeFile(this.file, ledger);
    return { recorded: true, id: item.id, pushStatus: item.pushStatus, pushReason: item.pushReason, state: this.state() };
  }

  // 主人已在设置页核对过这批记录后清空；未送达的记录会一并清掉，需要时再自行补推。
  clear({ explicit = false } = {}) {
    if (!explicit) throw fail('主人通知记录只能由用户在本机清空。', 403);
    writeFile(this.file, { version: VERSION, items: [] });
    return this.state();
  }
}
