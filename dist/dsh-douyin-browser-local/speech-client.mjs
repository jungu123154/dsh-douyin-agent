import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

// 语音合成：按 OpenAI 兼容的 /audio/speech 调用（Boson Higgs TTS 同形）。
// 只把音频写到本机目录并返回路径与时长估计；发送到抖音由调用方决定，失败不假装成功。

const MAX_BYTES = 8 * 1024 * 1024;
const EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/opus': 'opus', 'audio/ogg': 'opus' };

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export class SpeechClient {
  constructor({ stateDir = resolveRuntimePaths().stateDir, fetchImpl = fetch, timeoutMs = 45_000 } = {}) {
    this.stateDir = stateDir;
    this.outputDir = path.join(stateDir, 'voice');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  // channel: 'speech' | 'sing'
  async synthesize({ channel, text, settings, signal } = {}) {
    if (!['speech', 'sing'].includes(channel)) throw fail('请选择说话或唱歌通道。', 400);
    const body = clean(text, channel === 'sing' ? 600 : 1200);
    if (!body) throw fail('要合成的文字不能为空。', 400);
    const config = settings?.speech && channel === 'speech' ? settings.speech : settings?.sing;
    const apiKey = channel === 'speech' ? settings?.speechKey : settings?.singKey;
    if (!config?.baseUrl) throw fail('还没有填写语音接口地址。', 400);
    if (!apiKey) throw fail(channel === 'speech' ? '还没有填写说话通道的 Key。' : '还没有填写唱歌通道的 Key。', 400);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('语音合成超时。')), this.timeoutMs);
    const actual = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    let bytes, contentType;
    try {
      const response = await this.fetchImpl(`${config.baseUrl}/audio/speech`, {
        method: 'POST', redirect: 'error', signal: actual,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: config.model, input: body, voice: config.voice, response_format: config.format || 'mp3' }),
      });
      if (!response.ok) {
        let detail = '';
        try { const data = await response.json(); detail = clean(data?.error?.message || data?.message, 200); } catch { /* 非 JSON 错误体 */ }
        throw fail(`语音接口请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`, 502);
      }
      contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw fail('语音接口没有返回音频内容。', 502);
      if (buffer.length > MAX_BYTES) throw fail('语音接口返回的音频超过 8 MB，已放弃保存。', 502);
      if (contentType && !EXT[contentType] && !contentType.startsWith('audio/')) throw fail(`语音接口返回的不是音频（${contentType}），可能 Key 或模型不对。`, 502);
      bytes = buffer;
    } catch (error) {
      if (timeout.signal.aborted && !signal?.aborted) throw fail('语音合成超时，未保存音频。', 504);
      throw error;
    } finally { clearTimeout(timer); }

    fs.mkdirSync(this.outputDir, { recursive: true });
    const ext = EXT[contentType] || config.format || 'mp3';
    const name = `${channel}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext}`;
    const file = path.join(this.outputDir, name);
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    return { channel, file, name, bytes: bytes.length, contentType: contentType || `audio/${ext}`, voice: config.voice, model: config.model, textLength: [...body].length };
  }
}
