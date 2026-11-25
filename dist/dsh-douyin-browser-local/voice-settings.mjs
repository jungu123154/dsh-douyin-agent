import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

// 语音与唱歌：两条独立通道，各自可填地址、模型、音色和 Key。
// Key 单独保存在本机，接口只回「是否已填」，不回显。

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const VOICE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export const DEFAULT_BASE_URL = 'https://api.boson.ai/v1';
export const DEFAULT_SPEECH = Object.freeze({ baseUrl: DEFAULT_BASE_URL, model: 'higgs-tts-3', voice: 'chloe', format: 'mp3' });
export const DEFAULT_SING = Object.freeze({ baseUrl: DEFAULT_BASE_URL, model: 'higgs-tts-3', voice: 'nora', format: 'mp3' });
export const VOICE_PRESETS = Object.freeze([
  { id: 'chloe', label: 'Chloe · 亲切清亮女声（可爱）' },
  { id: 'eleanor', label: 'Eleanor · 沉稳清晰女声' },
  { id: 'nora', label: 'Nora · 温柔叙事女声' },
  { id: 'jake', label: 'Jake · 热情男声' },
  { id: 'marcus', label: 'Marcus · 自信男声' },
  { id: 'oliver', label: 'Oliver · 平静男声' },
]);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) throw fail('请填写语音接口地址，例如 https://api.boson.ai/v1。');
  if (text.length > 500) throw fail('语音接口地址过长。');
  let url;
  try { url = new URL(text); } catch { throw fail('语音接口地址不是有效网址。'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname))) throw fail('语音接口地址必须使用 HTTPS，或本机 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw fail('语音接口地址不能包含账号、参数或片段。');
  return url.href.replace(/\/+$/, '');
}

export class VoiceSettings {
  constructor({ stateDir = resolveRuntimePaths().stateDir } = {}) {
    this.file = path.join(stateDir, 'voice-settings.json');
    this.keyFile = path.join(stateDir, 'voice-keys.json');
  }
  read() {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, speech: { ...DEFAULT_SPEECH }, sing: { ...DEFAULT_SING }, sendVoice: false };
      throw fail('语音设置损坏，请重新填写。', 500);
    }
    if (!saved || saved.version !== 1 || !saved.speech || !saved.sing) throw fail('语音设置格式无效，请重新填写。', 500);
    const pick = (value, fallback) => ({
      baseUrl: typeof value.baseUrl === 'string' && value.baseUrl ? value.baseUrl : fallback.baseUrl,
      model: typeof value.model === 'string' && value.model ? value.model : fallback.model,
      voice: typeof value.voice === 'string' && value.voice ? value.voice : fallback.voice,
      format: ['mp3', 'wav', 'opus'].includes(value.format) ? value.format : 'mp3',
    });
    return { version: 1, speech: pick(saved.speech, DEFAULT_SPEECH), sing: pick(saved.sing, DEFAULT_SING), sendVoice: saved.sendVoice === true };
  }
  keys() {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(this.keyFile, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { speech: '', sing: '' };
      throw fail('语音 Key 记录损坏，请重新填写。', 500);
    }
    return { speech: typeof saved?.speech === 'string' ? saved.speech : '', sing: typeof saved?.sing === 'string' ? saved.sing : '' };
  }
  state() {
    const settings = this.read(), keys = this.keys();
    return {
      protocol: 'voice-settings-v1',
      speech: { ...settings.speech, keyConfigured: Boolean(keys.speech) },
      sing: { ...settings.sing, keyConfigured: Boolean(keys.sing) },
      sendVoice: settings.sendVoice,
      presets: VOICE_PRESETS.map(item => ({ ...item })),
    };
  }
  configure(input, { explicit = false } = {}) {
    if (explicit !== true) throw fail('语音设置只能由用户在本机保存。', 403);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['speech', 'sing', 'sendVoice'].includes(key))) throw fail('语音设置只接收说话、唱歌两条通道和发送开关。', 400);
    const current = this.read();
    const pick = (value, base) => {
      if (value === undefined) return base;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['baseUrl', 'model', 'voice', 'format'].includes(key))) throw fail('通道设置只接收地址、模型、音色和格式。', 400);
      const baseUrl = value.baseUrl === undefined ? base.baseUrl : normalizeBaseUrl(value.baseUrl);
      const model = value.model === undefined ? base.model : String(value.model).trim();
      const voice = value.voice === undefined ? base.voice : String(value.voice).trim();
      const format = value.format === undefined ? base.format : String(value.format).trim();
      if (!MODEL.test(model)) throw fail('模型名只能用字母、数字和 . _ : / -。', 400);
      if (!VOICE.test(voice)) throw fail('音色名只能用字母、数字和 . _ : -。', 400);
      if (!['mp3', 'wav', 'opus'].includes(format)) throw fail('音频格式只支持 mp3、wav、opus。', 400);
      return { baseUrl, model, voice, format };
    };
    const next = { version: 1, speech: pick(input.speech, current.speech), sing: pick(input.sing, current.sing), sendVoice: input.sendVoice === undefined ? current.sendVoice : input.sendVoice === true };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return this.state();
  }
  saveKey(input, { explicit = false } = {}) {
    if (explicit !== true) throw fail('语音 Key 只能由用户在本机保存。', 403);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['channel', 'apiKey'].includes(key))) throw fail('语音 Key 只接收通道和 Key。', 400);
    if (!['speech', 'sing'].includes(input.channel)) throw fail('请选择说话或唱歌通道。', 400);
    if (typeof input.apiKey !== 'string') throw fail('API Key 必须是文字。', 400);
    const apiKey = input.apiKey.trim();
    if (!apiKey || apiKey.length > 4096 || /\s|\0/.test(apiKey)) throw fail('API Key 不能为空、不能含空白，最多 4096 个字符。', 400);
    const keys = this.keys();
    keys[input.channel] = apiKey;
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    const temporary = `${this.keyFile}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(keys, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.keyFile); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return this.state();
  }
  clearKey({ channel, explicit = false } = {}) {
    if (explicit !== true) throw fail('语音 Key 只能由用户在本机清除。', 403);
    if (!['speech', 'sing'].includes(channel)) throw fail('请选择说话或唱歌通道。', 400);
    const keys = this.keys();
    keys[channel] = '';
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    const temporary = `${this.keyFile}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(keys, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.keyFile); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return this.state();
  }
}
