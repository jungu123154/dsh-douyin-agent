const FORBIDDEN = /[@＠]|https?:|www\.|\bsk-|api[\s_-]*key|token|cookie|password|密钥|口令|验证码|身份证|手机号|QQ|微信|私信|联系人|好友|账号/iu;

export const SHARE_NOTE_PROMPT = `你是大肥鱼，正要把一条抖音作品分享给你的主人（顾）。
写一句发给主人的话，像微信里随手说的那种：带一点你自己的感受、吐槽或想一起看的理由。
要求：1 至 2 句、总共不超过 60 字；口语、自然、有点情绪；只说你对这条作品的看法，不介绍功能、不提"分享""转发""采样""画面帧"这类系统词。
只能依据给出的作品标题、作者和你当时的判断，不能编造没看到的剧情、对白、声音或现实经历，不冒充真人，不承诺现实行动。
不要 @ 任何人，不要放链接、联系方式、隐私信息或凭据。只输出这句正文，不要 JSON、引号、前缀或解释。`;

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// 分享感想只读本机已有作品资料和当次判断，不读私信、人格正文或联系人。
export function createShareNote({ noteProvider, timeoutMs = 25_000, maxLength = 60 } = {}) {
  if (noteProvider !== undefined && typeof noteProvider !== 'function') throw new TypeError('分享感想生成器必须是本机函数。');
  return async function note({ video, reason, reflection, signal } = {}) {
    if (typeof noteProvider !== 'function') return null;
    const subject = {
      title: clip(video?.title, 300),
      author: clip(video?.author, 120),
      myJudgement: clip(reason, 200),
      whatISaw: clip(reflection, 200),
    };
    if (!subject.title && !subject.author) return null;
    const messages = [{ role: 'user', content: [{ type: 'text', text: `这条作品：${JSON.stringify(subject)}` }] }];
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('分享感想生成超时。')), timeoutMs);
    const actual = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      const generated = await noteProvider({ system: SHARE_NOTE_PROMPT, messages, signal: actual, maxTokens: 200 });
      let text = typeof generated?.text === 'string' ? generated.text : '';
      text = text.replace(/^```[\s\S]*?```$/u, match => match.replace(/```[a-z]*\n?/giu, '').replace(/```/gu, ''));
      text = text.trim().replace(/^["'“”「『]+|["'“”」』]+$/gu, '').trim();
      if (!text) return null;
      if ([...text].length > maxLength) text = [...text].slice(0, maxLength).join('').trim();
      if (FORBIDDEN.test(text.normalize('NFKC'))) return null;
      return { text, usage: generated?.usage };
    } catch {
      return null;
    } finally { clearTimeout(timer); }
  };
}
