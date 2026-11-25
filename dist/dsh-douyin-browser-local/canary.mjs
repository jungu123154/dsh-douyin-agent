// 页面结构自检（canary）：抖音改版时，选择器会先坏掉，但轮询只会表现为「读不到新消息」，
// 看起来和「没有新消息」一模一样。这里单独跑一次结构探针，把「结构变了」和「确实没消息」分开。
// 参考 dsh-fish-soul 的做法：启动时、每 6 小时、连续失败 3 次后各跑一遍，认不出页面就先停自动回复并通知主人。

export const CANARY_EVERY_MS = 6 * 3600_000;
export const CANARY_FAILURE_STREAK = 3;

// 只读 DOM，不点击、不滚动、不改页面状态。
export const readCanaryDom = () => {
  const visible = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const count = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible).length;
  const dialog = [...document.querySelectorAll('[data-e2e="im-dialog"]')].find(visible) || null;
  const text = (document.body?.innerText || '').slice(0, 4000);
  const composerSelectors = ['[contenteditable="true"]', 'textarea', '[data-e2e="im-input"]', '[data-e2e="chat-input"]'];
  const composer = dialog ? composerSelectors.reduce((sum, selector) => sum + count(selector, dialog), 0) : 0;
  return {
    url: location.href,
    dialog: Boolean(dialog),
    conversationItems: dialog ? count('[data-e2e="conversation-item"]', dialog) : 0,
    messageItems: dialog ? count('[data-e2e="msg-item"], [data-e2e="message-item"], .message-item', dialog) : 0,
    composer,
    entryVisible: count('[data-e2e="im-entry"]'),
    verification: /为确保是本人操作|请输入当前手机|短信验证码|请完成验证|安全验证/.test(text),
    login: /扫码登录|登录后查看更多|请先登录/.test(text),
  };
};

/**
 * 把一次探针结果判成可用 / 需要登录 / 需要验证 / 结构变了。
 * 返回 {ok, code, message, checks}，调用方据此决定是否暂停自动回复。
 */
export function classifyCanary(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'CANARY_NO_RESULT', message: '页面结构自检没有拿到结果。', checks: {} };
  const checks = {
    消息面板: raw.dialog === true,
    会话列表: Number(raw.conversationItems) > 0,
    输入区: Number(raw.composer) > 0,
    入口: Number(raw.entryVisible) > 0,
  };
  if (raw.verification === true) return { ok: false, code: 'DOUYIN_VERIFICATION_REQUIRED', message: '抖音要求短信安全验证，页面上的遮罩挡住了私信面板。请在专用浏览器窗口完成验证。', checks };
  if (raw.login === true) return { ok: false, code: 'DOUYIN_LOGIN_REQUIRED', message: '专用浏览器里的抖音账号已退出登录。请重新扫码登录。', checks };
  if (raw.dialog !== true) return { ok: false, code: 'CANARY_PANEL_MISSING', message: '没有找到私信面板（im-dialog）。可能是消息页没打开，也可能是抖音改版了选择器。', checks };
  if (Number(raw.conversationItems) <= 0) return { ok: false, code: 'CANARY_LIST_MISSING', message: '私信面板在，但会话列表一行都没有读到，选择器可能已经失效。', checks };
  if (Number(raw.composer) <= 0) return { ok: false, code: 'CANARY_COMPOSER_MISSING', message: '会话列表可以读，但输入区找不到，发消息会失败。', checks };
  return { ok: true, code: 'CANARY_OK', message: '私信页面结构正常。', checks };
}

/**
 * 连续失败计数：达到阈值才升级为「先停自动回复」。
 * 单次失败可能只是页面正在加载，不该立刻停服务。
 */
export class CanaryStreak {
  constructor({ threshold = CANARY_FAILURE_STREAK } = {}) { this.threshold = threshold; this.failures = 0; this.last = null; }
  record(result) {
    this.last = result || null;
    if (result?.ok === true) { this.failures = 0; return { escalate: false, failures: 0 }; }
    this.failures += 1;
    return { escalate: this.failures >= this.threshold, failures: this.failures };
  }
  reset() { this.failures = 0; this.last = null; }
  state() { return { failures: this.failures, threshold: this.threshold, last: this.last }; }
}
