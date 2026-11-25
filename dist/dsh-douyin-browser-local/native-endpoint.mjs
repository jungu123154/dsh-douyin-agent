import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const IMAGE_DATA = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

// 用户在设置页自己填的接口：只保存地址、模型名和本机 Key，不读取 DSH 凭据。
export function normalizeEndpointUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('请填写接口地址，例如 https://api.deepseek.com/v1。');
  if (text.length > 2048) throw new Error('接口地址过长，最多 2048 个字符。');
  let url;
  try { url = new URL(text); } catch { throw new Error('接口地址不是有效网址。'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname))) throw new Error('接口地址必须使用 HTTPS，或本机 HTTP 地址。');
  if (url.username || url.password) throw new Error('接口地址不能包含账号或密码。');
  if (url.search || url.hash) throw new Error('接口地址不能包含查询参数或片段。');
  return url.href.replace(/\/+$/, '');
}

export function normalizeEndpointKey(value) {
  if (typeof value !== 'string') throw new Error('API Key 必须是文字。');
  const apiKey = value.trim();
  if (!apiKey) throw new Error('请填写 API Key。');
  if (apiKey.length > 4096 || /\s|\0/.test(apiKey)) throw new Error('API Key 不能包含空白字符，且最多 4096 个字符。');
  return apiKey;
}

export function normalizeEndpointModel(value) {
  const model = String(value ?? '').trim();
  if (!model) throw new Error('请填写接口的模型名称，例如 deepseek-chat。');
  if (!MODEL_NAME.test(model)) throw new Error('模型名称最多 128 个字符，只能用字母、数字和 . _ : / -。');
  return model;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('自定义接口设置损坏，请清除后重新填写。'); }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export class NativeEndpointSettings {
  constructor({ stateDir = resolveRuntimePaths().stateDir } = {}) {
    this.file = path.join(stateDir, 'native-endpoint.json');
    this.keyFile = path.join(stateDir, 'native-endpoint-key.json');
  }
  read() {
    const saved = readJson(this.file);
    if (saved === null) return { baseUrl: '', model: '', supportsImages: false };
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || typeof saved.baseUrl !== 'string' || typeof saved.model !== 'string' || (saved.supportsImages !== undefined && typeof saved.supportsImages !== 'boolean')) throw new Error('自定义接口设置格式无效，请清除后重新填写。');
    return { baseUrl: saved.baseUrl, model: saved.model, supportsImages: saved.supportsImages === true };
  }
  key() {
    const saved = readJson(this.keyFile);
    if (saved === null) return '';
    if (!saved || typeof saved !== 'object' || typeof saved.apiKey !== 'string') throw new Error('自定义接口的 Key 记录损坏，请重新填写。');
    return saved.apiKey;
  }
  // 对外只报告是否已填写，不回显 Key。
  state() {
    const endpoint = this.read(), apiKey = this.key();
    const configured = Boolean(endpoint.baseUrl && endpoint.model && apiKey);
    return { ...endpoint, keyConfigured: Boolean(apiKey), configured };
  }
  async configure(input, { explicit = false, beforeCommit } = {}) {
    if (explicit !== true) throw Object.assign(new Error('自定义接口只能由用户在设置页保存。'), { status: 400 });
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['baseUrl', 'model', 'supportsImages'].includes(key))) throw Object.assign(new Error('自定义接口只接收地址、模型名和图像输入开关。'), { status: 400 });
    let baseUrl, model;
    try { baseUrl = normalizeEndpointUrl(input.baseUrl); model = normalizeEndpointModel(input.model); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    if (input.supportsImages !== undefined && typeof input.supportsImages !== 'boolean') throw Object.assign(new Error('图像输入开关必须是布尔值。'), { status: 400 });
    if (beforeCommit) await beforeCommit();
    writeJson(this.file, { baseUrl, model, supportsImages: input.supportsImages === true });
    return this.state();
  }
  async saveKey(input, { explicit = false, beforeCommit } = {}) {
    if (explicit !== true) throw Object.assign(new Error('API Key 只能由用户在设置页保存。'), { status: 400 });
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'apiKey')) throw Object.assign(new Error('这里只接收 API Key。'), { status: 400 });
    let apiKey;
    try { apiKey = normalizeEndpointKey(input.apiKey); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    if (beforeCommit) await beforeCommit();
    writeJson(this.keyFile, { apiKey });
    return this.state();
  }
  async clear({ explicit = false, beforeCommit } = {}) {
    if (explicit !== true) throw Object.assign(new Error('自定义接口只能由用户在设置页清除。'), { status: 400 });
    if (beforeCommit) await beforeCommit();
    for (const file of [this.file, this.keyFile]) { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return this.state();
  }
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
}

// 与 native-watch-decision 相同的调用接口：用用户填写的 OpenAI 兼容接口生成一次文本。
export function createEndpointDecision({ endpoint, fetchImpl = fetch, timeoutMs = 90_000, maxTokens = 1200, purpose = 'watch' } = {}) {
  if (!endpoint?.configured) throw new Error('自定义接口尚未填写完整，请先在设置页填写地址、模型和 API Key。');
  if (!['watch', 'chat'].includes(purpose)) throw new Error('自定义接口用途无效。');
  const { baseUrl, model, apiKey } = endpoint;
  const redact = text => (typeof text === 'string' ? text.replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [凭据已隐藏]').split(apiKey).join('[凭据已隐藏]') : text);
  return async function decide({ system, messages, signal } = {}) {
    signal?.throwIfAborted();
    if (typeof system !== 'string' || !system.trim() || system.length > 40_000) throw new Error('自定义接口只接收有限的系统提示。');
    if (!Array.isArray(messages) || !messages.length) throw new Error('自定义接口需要有效的消息列表。');
    const hasImages = messages.some(message => Array.isArray(message?.content) && message.content.some(part => part?.type === 'image_url'));
    if (hasImages && !endpoint.supportsImages && purpose !== 'chat') throw Object.assign(new Error('自定义接口未声明支持图像输入，已停止自主观看；请在设置页勾选“接口支持图像输入”。'), { code: 'NATIVE_IMAGE_UNSUPPORTED' });
    const converted = [];
    for (const message of messages) {
      if (message?.role === 'system') { if (message.content !== system) throw new Error('模型系统提示不一致。'); continue; }
      if (!['user', 'assistant'].includes(message?.role)) throw new Error('只接收本次公开视频或私信的用户与模型消息。');
      const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content || [];
      const blocks = [];
      for (const part of parts) {
        if (part?.type === 'text') { blocks.push({ type: 'text', text: String(part.text) }); continue; }
        if (part?.type !== 'image_url') throw new Error('请求含未允许的内容类型。');
        const url = part.image_url?.url || '', match = IMAGE_DATA.exec(url);
        if (!match) throw new Error('画面不是支持的图片格式或有效 base64。');
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > 2_000_000 || bytes.toString('base64') !== match[2]) throw new Error('画面超出 2 MB 限制或编码无效。');
        if (!endpoint.supportsImages) { blocks.push({ type: 'text', text: '本条图片未交给模型：自定义接口没有勾选图像输入。你没有看到这张图；忽略前文关于可见画面或采样帧的描述，只依据文字聊天，不猜测图片或表情内容。' }); continue; }
        blocks.push({ type: 'image_url', image_url: { url, detail: 'high' } });
      }
      converted.push({ role: message.role, content: blocks });
    }
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('自定义接口请求超时。')), timeoutMs);
    const actual = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: actual,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...converted], max_tokens: maxTokens, stream: false }),
      });
      let data;
      try { data = await response.json(); }
      catch { throw new Error(`自定义接口未返回 JSON（HTTP ${response.status}），无法核实模型输出。`); }
      if (!response.ok) { const detail = typeof data?.error?.message === 'string' ? redact(data.error.message).slice(0, 300) : ''; throw new Error(`自定义接口请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`); }
      const choice = data?.choices?.[0];
      if (choice?.message?.tool_calls?.length) throw new Error('自定义接口返回了未授权的工具调用，已停止。');
      if (!['stop', undefined, null].includes(choice?.finish_reason)) throw Object.assign(new Error(`自定义接口${purpose === 'chat' ? '聊天回复' : '观看决策'}未完整返回（${choice?.finish_reason || '缺少完成标记'}）。`), { code: 'WATCH_DECISION_INCOMPLETE' });
      const text = contentText(choice?.message?.content);
      if (!text.trim()) throw new Error('自定义接口没有返回可用文本。');
      if (text.includes(apiKey)) throw new Error('自定义接口返回了本机 Key，已停止且未执行动作。');
      return { text, usage: data.usage };
    } catch (error) {
      if (timeout.signal.aborted && !signal?.aborted) throw new Error('自定义接口请求超时，未执行动作。');
      throw Object.assign(new Error(redact(error instanceof Error ? error.message : String(error))), { code: error?.code, cause: error });
    } finally { clearTimeout(timer); }
  };
}
