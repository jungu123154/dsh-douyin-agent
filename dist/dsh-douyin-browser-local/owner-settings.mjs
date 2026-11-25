import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

const NAME = /^[^\s@\u0000-\u001f\u007f]{1,40}$/u;
const CONV = /^conv:[a-f0-9]{64}$/;

const defaults = () => ({ version: 1, name: '', recipientId: '', atCriteria: '', commentMention: true, shareToOwner: true, proactiveChat: true, shareNote: true });

// 主人是独立账号：这里只保存昵称和三个默认开启的互动授权，不保存任何凭据。
export class OwnerSettings {
  constructor({ stateDir = resolveRuntimePaths().stateDir } = {}) { this.file = path.join(stateDir, 'owner.json'); }
  read() {
    let value;
    try { value = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return defaults(); throw Object.assign(new Error('主人设置损坏，请重新填写。'), { status: 500 }); }
    if (!value || value.version !== 1 || typeof value.name !== 'string' || value.name.length > 40 || typeof value.commentMention !== 'boolean' || typeof value.shareToOwner !== 'boolean' || typeof value.proactiveChat !== 'boolean') throw Object.assign(new Error('主人设置格式无效，请重新填写。'), { status: 500 });
    return { version: 1, name: value.name, recipientId: typeof value.recipientId === 'string' ? value.recipientId : '', atCriteria: typeof value.atCriteria === 'string' ? value.atCriteria.slice(0, 500) : '', commentMention: value.commentMention, shareToOwner: value.shareToOwner, proactiveChat: value.proactiveChat, shareNote: value.shareNote !== false };
  }
  state() {
    const value = this.read();
    return { ...value, configured: Boolean(value.name.trim()) };
  }
  configure(input, { explicit = false } = {}) {
    if (explicit !== true) throw Object.assign(new Error('主人设置只能由用户在本机保存。'), { status: 403 });
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['name', 'recipientId', 'atCriteria', 'commentMention', 'shareToOwner', 'proactiveChat', 'shareNote'].includes(key))) throw Object.assign(new Error('主人设置只接收昵称、会话和三个开关。'), { status: 400 });
    const current = this.read();
    const name = input.name === undefined ? current.name : String(input.name).trim();
    if (name && !NAME.test(name)) throw Object.assign(new Error('主人昵称需为 1 至 40 个字符，不能含空白或 @。'), { status: 400 });
    const recipientId = input.recipientId === undefined ? current.recipientId : String(input.recipientId).trim();
    const atCriteria = input.atCriteria === undefined ? current.atCriteria : String(input.atCriteria).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
    if (recipientId && !CONV.test(recipientId)) throw Object.assign(new Error('主人会话必须是已核对的会话 ID。'), { status: 400 });
    for (const key of ['commentMention', 'shareToOwner', 'proactiveChat', 'shareNote']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw Object.assign(new Error('主人开关必须是布尔值。'), { status: 400 });
    const next = { version: 1, name, recipientId, atCriteria, commentMention: input.commentMention ?? current.commentMention, shareToOwner: input.shareToOwner ?? current.shareToOwner, proactiveChat: input.proactiveChat ?? current.proactiveChat, shareNote: input.shareNote ?? current.shareNote !== false };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return this.state();
  }
}