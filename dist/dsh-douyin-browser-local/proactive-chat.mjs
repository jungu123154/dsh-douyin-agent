import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

// 主动私信：没有新消息时，大肥鱼自己找主人说一句话。
// 只读本机已核实的作品观察和人格，不读其他会话；发送失败只记录，不重试、不补发。

const VERSION = 1;
const DAY = 86_400_000;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const identifier = value => typeof value === 'string' && /^conv:[a-f0-9]{64}$/.test(value);
const shanghaiDay = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const shanghaiHour = now => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(now)));

const defaults = () => ({ version: VERSION, enabled: true, dailyLimit: 3, minGapMinutes: 90, quietStart: 0, quietEnd: 9, windows: [] });

function readFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw fail('主动私信记录无法读取，未继续发送。'); }
}
function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export const PROACTIVE_NOTE_PROMPT = `你是大肥鱼，正在主动给你的主人（顾）发一条私信，没有在回复他。
写 1 至 2 句，总共不超过 60 字，像忽然想到就发的口吻：可以说你刚看到的东西、此刻的心情，或随口问他一句。
只能用给你的本机资料（人格摘要、你最近真的看过的作品标题）；不能编造没看过的内容、没发生的事、没见过的人，不冒充真人，不做现实承诺。
不要 @ 人，不要放链接、联系方式、凭据、地址；不要提"系统""模型""采样""画面帧""自动""推送"这类词；不要每条都用"在吗""忙吗"开场。
只输出这句话本身，不要 JSON、引号或解释。`;

const FORBIDDEN = /[@＠]|https?:|www\.|\bsk-|api[\s_-]*key|token|cookie|password|密钥|口令|验证码|身份证|手机号|QQ|微信|私信|系统|模型|采样|画面帧|自动|推送/iu;

export class ProactiveChat {
  constructor({ stateDir = resolveRuntimePaths().stateDir, getOwner, getPersona, sendText, noteProvider, now = Date.now } = {}) {
    if (typeof getOwner !== 'function') throw new TypeError('主动私信需要读取主人设置。');
    if (sendText !== undefined && typeof sendText !== 'function') throw new TypeError('主动私信需要本机发送函数。');
    if (noteProvider !== undefined && typeof noteProvider !== 'function') throw new TypeError('主动私信需要本机生成函数。');
    Object.assign(this, { stateDir, getOwner, getPersona, sendText, noteProvider, now });
    this.policyFile = path.join(stateDir, 'proactive-policy.json');
    this.ledgerFile = path.join(stateDir, 'proactive-ledger.json');
    this.busy = false;
  }
  policy() {
    const value = readFile(this.policyFile, defaults());
    if (!value || value.version !== VERSION || typeof value.enabled !== 'boolean') throw fail('主动私信设置损坏，未继续发送。');
    return {
      version: VERSION,
      enabled: value.enabled,
      dailyLimit: Number.isSafeInteger(value.dailyLimit) && value.dailyLimit >= 1 && value.dailyLimit <= 10 ? value.dailyLimit : 3,
      minGapMinutes: Number.isSafeInteger(value.minGapMinutes) && value.minGapMinutes >= 15 && value.minGapMinutes <= 1440 ? value.minGapMinutes : 90,
      quietStart: Number.isSafeInteger(value.quietStart) && value.quietStart >= 0 && value.quietStart <= 23 ? value.quietStart : 0,
      quietEnd: Number.isSafeInteger(value.quietEnd) && value.quietEnd >= 0 && value.quietEnd <= 23 ? value.quietEnd : 9,
    };
  }
  ledger() {
    const value = readFile(this.ledgerFile, { version: VERSION, operations: [] });
    if (!value || value.version !== VERSION || !Array.isArray(value.operations) || value.operations.some(item => !item || typeof item.at !== 'string' || !['sent', 'not-sent', 'uncertain'].includes(item.status))) throw fail('主动私信收据损坏，未继续发送。');
    return value;
  }
  state() {
    let owner = null;
    try { owner = this.getOwner(); } catch { owner = null; }
    const policy = (() => { try { return this.policy(); } catch { return defaults(); } })();
    const ledger = (() => { try { return this.ledger(); } catch { return { operations: [] }; } })();
    const today = shanghaiDay(this.now());
    const sentToday = ledger.operations.filter(item => item.day === today && item.status === 'sent').length;
    const last = ledger.operations.filter(item => item.status === 'sent').at(-1) || null;
    return {
      protocol: 'proactive-chat-v1',
      enabled: policy.enabled,
      policy: { dailyLimit: policy.dailyLimit, minGapMinutes: policy.minGapMinutes, quietStart: policy.quietStart, quietEnd: policy.quietEnd },
      ownerReady: Boolean(owner?.configured && identifier(owner.recipientId) && owner.proactiveChat !== false),
      daily: { date: today, sent: sentToday, limit: policy.dailyLimit, remaining: Math.max(0, policy.dailyLimit - sentToday) },
      last,
      recent: ledger.operations.slice(-5).map(({ at, status, text, reason }) => ({ at, status, text: text ? text.slice(0, 60) : '', reason: reason || '' })),
    };
  }
  configure(input = {}, { explicit = false } = {}) {
    if (explicit !== true) throw fail('主动私信设置只能由用户在本机保存。', 403);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['enabled', 'dailyLimit', 'minGapMinutes'].includes(key))) throw fail('主动私信只接受开关、每日次数和最短间隔。', 400);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw fail('主动私信开关必须是布尔值。', 400);
    const current = this.policy();
    const next = { ...current, ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.dailyLimit === undefined ? {} : { dailyLimit: input.dailyLimit }), ...(input.minGapMinutes === undefined ? {} : { minGapMinutes: input.minGapMinutes }) };
    if (!Number.isSafeInteger(next.dailyLimit) || next.dailyLimit < 1 || next.dailyLimit > 10) throw fail('每日主动私信须为 1 至 10 次。', 400);
    if (!Number.isSafeInteger(next.minGapMinutes) || next.minGapMinutes < 15 || next.minGapMinutes > 1440) throw fail('最短间隔须为 15 至 1440 分钟。', 400);
    writeFile(this.policyFile, { version: VERSION, enabled: next.enabled, dailyLimit: next.dailyLimit, minGapMinutes: next.minGapMinutes, quietStart: next.quietStart, quietEnd: next.quietEnd });
    return this.state();
  }
  // 是否现在适合开口：开关、主人、额度、间隔、安静时段。
  due() {
    const policy = this.policy();
    if (!policy.enabled) return { due: false, reason: '主动私信已关闭。' };
    const owner = this.getOwner();
    if (!owner?.configured || !identifier(owner.recipientId)) return { due: false, reason: '还没有选择主人。' };
    if (owner.proactiveChat === false) return { due: false, reason: '主人设置里关闭了主动聊天。' };
    const hour = shanghaiHour(this.now());
    const quiet = policy.quietStart <= policy.quietEnd ? hour >= policy.quietStart && hour < policy.quietEnd : hour >= policy.quietStart || hour < policy.quietEnd;
    if (quiet) return { due: false, reason: '现在是安静时段，不打扰主人。' };
    const ledger = this.ledger(), today = shanghaiDay(this.now());
    const sentToday = ledger.operations.filter(item => item.day === today && item.status === 'sent').length;
    if (sentToday >= policy.dailyLimit) return { due: false, reason: '今天的主动私信次数已用完。' };
    const last = ledger.operations.filter(item => item.status === 'sent').at(-1);
    if (last) {
      const gap = this.now() - Date.parse(last.at);
      if (Number.isFinite(gap) && gap < policy.minGapMinutes * 60_000) return { due: false, reason: `距上次主动私信还不到 ${policy.minGapMinutes} 分钟。` };
    }
    return { due: true, owner, policy };
  }
  context() {
    try {
      const persona = this.getPersona?.()?.snapshot?.() || null;
      const interests = (persona?.interests || []).filter(item => item && item.signal !== 'neutral').slice(-6).map(item => ({ topic: String(item.topic || '').slice(0, 40), signal: item.signal }));
      const watched = (persona?.recentObservations || []).slice(-6).map(item => ({ title: String(item.title || '').slice(0, 60), author: String(item.author || '').slice(0, 30) }));
      return { interests, watched };
    } catch { return { interests: [], watched: [] }; }
  }
  async tick({ signal } = {}) {
    if (this.busy) return { skipped: 'busy' };
    const check = (() => { try { return this.due(); } catch (error) { return { due: false, reason: error.message }; } })();
    if (!check.due) return { skipped: check.reason };
    if (typeof this.noteProvider !== 'function' || typeof this.sendText !== 'function') return { skipped: '没有可用的生成或发送通道。' };
    this.busy = true;
    const at = new Date(this.now()).toISOString(), day = shanghaiDay(this.now());
    try {
      let text = '', generateError = '';
      for (const budget of [600, 900]) {
        try {
          const generated = await this.noteProvider({ system: PROACTIVE_NOTE_PROMPT, context: this.context(), signal, maxTokens: budget });
          text = String(generated?.text || '').trim().replace(/^["'“”「『]+|["'“”」』]+$/gu, '').trim();
          if (text) break;
          generateError = '模型返回空内容';
        } catch (error) { text = ''; generateError = String(error?.message || error).slice(0, 160); }
      }
      if (!text || [...text].length > 60 || FORBIDDEN.test(text.normalize('NFKC'))) {
        const ledger = this.ledger();
        ledger.operations.push({ at, day, status: 'not-sent', reason: text ? '生成内容不符合主动私信要求，未发送。' : (generateError ? '生成失败：' + generateError : '没有生成可用内容，未发送。') });
        writeFile(this.ledgerFile, ledger);
        return { sent: false, reason: '生成内容不可用，未发送。' };
      }
      let delivery = null, failure = '';
      try { delivery = await this.sendText(check.owner.recipientId, text, { signal }); }
      catch (error) { failure = String(error?.message || error).slice(0, 200); }
      const confirmed = delivery?.confirmed === true;
      const ledger = this.ledger();
      ledger.operations.push({ at, day, status: confirmed ? 'sent' : delivery?.deliveryUncertain === true ? 'uncertain' : 'not-sent', text, ...(confirmed ? { messageId: String(delivery.messageId || '') } : { reason: failure || String(delivery?.reason || '发送通道没有给出可核对的送达凭据。').slice(0, 200) }) });
      while (ledger.operations.length > 200) ledger.operations.shift();
      writeFile(this.ledgerFile, ledger);
      return { sent: confirmed, text, ...(confirmed ? {} : { reason: failure || '未确认送达。' }) };
    } finally { this.busy = false; }
  }
}
