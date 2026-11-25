window.__ModuleLoader__.load({
  id: 'dsh-douyin-browser-local',
  factory: require => {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { createElement: h, useEffect, useRef, useState } = React;
    const Button = primitives.Button, Input = primitives.Input || 'input';
    const PREFIX = '/api/douyin-browser';
    const routes = new Set(['/interactions/configure', '/state', '/diagnostics', '/diagnostics/repair', '/watch/schedule', '/watch/options', '/video/configure', '/video/start', '/video/stop', '/browser/open', '/persona/configure', '/model/configure', '/model/endpoint', '/model/credentials', '/model/endpoint/clear', '/owner/configure', '/proactive/configure', '/proactive/tick', '/voice/state', '/voice/configure', '/voice/credentials', '/voice/synth', '/mode/configure', '/watch/start', '/watch/stop', '/spark/configure', '/spark/start', '/spark/stop', '/spark/resolve', '/comments/configure', '/comments/resolve', '/share/configure', '/share/resolve', '/share/recipients', '/share/recipients/clear', '/comment/mentions', '/comment/at-targets', '/notify/clear', '/chat/canary', '/chat/contacts', '/chat/configure', '/chat/start', '/chat/stop', '/chat/prepare', '/chat/resolve', '/forward', '/interact/check', '/interact', '/comment', '/profile', '/share', '/publish', '/publish/status', '/chat/unanswered', '/chat/unanswered/resolve', '/media/configure', '/media/credentials', '/reports/generate']);
    const column = { display: 'flex', flexDirection: 'column', gap: 12 };
    const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
    const muted = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, margin: 0 };
    const formControl = { font: 'inherit', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 9, maxWidth: '100%', width: '100%', boxSizing: 'border-box' };
    const videoPolicyKey = policy => policy && JSON.stringify([Array.isArray(policy.windows) ? [...new Set(policy.windows)] : null, policy.weekendWindows || null, policy.sessionMinutes]);
    const fallbackCategories = { '基础设置': ['人格与兴趣', 'DSH 模型'], '视频观看': ['观看主题', '视频时间与自主观看'], '作品互动': ['点赞收藏评论', '查看主页'], '自检与用量': ['自检与用量'], '好友互动': ['好友互动'], '公开评论': ['自主公开视频评论'], '音频与密钥': ['可选音频'], '观看日报': ['观看日报'] };

    const OPERATIONS = {
      '/bootstrap': '连接本机服务', '/state': '刷新运行状态', '/interactions/state': '读取好友在线状态', '/interactions/configure': '设置好友互动',
      '/browser/open': '打开抖音', '/watch/state': '读取自主观看状态', '/watch/schedule': '设置自动观看', '/watch/options': '保存观看主题', '/watch/start': '开始自主观看', '/watch/stop': '停止自主观看',
      '/video/status': '读取观看时段与用量', '/video/configure': '保存观看时段与额度', '/video/start': '开始观看', '/video/stop': '结束观看',
      '/chat/state': '读取自动回复状态', '/chat/contacts': '读取当前会话列表', '/chat/configure': '保存许可名单', '/chat/start': '启动自动回复', '/chat/stop': '停止自动回复', '/chat/prepare': '准备回复通道', '/chat/resolve': '解除会话暂停', '/chat/unanswered': '读取遗留待处理消息', '/chat/unanswered/resolve': '标记遗留待处理消息',
      '/share/state': '读取分享状态', '/share/configure': '设置自主分享', '/share/resolve': '核对分享结果', '/share/recipients': '保存分享好友许可', '/share/recipients/clear': '清空分享好友许可', '/comment/mentions': '读取可 @ 的人', '/comment/at-targets': '保存评论 @ 名单', '/notify/clear': '清空主人通知', '/chat/canary': '私信页面结构自检', '/comments/state': '读取评论状态', '/comments/configure': '保存评论设置', '/comments/resolve': '核对评论结果',
      '/mode/state': '读取静默观看设置', '/mode/configure': '保存静默观看设置', '/media/state': '读取音频设置', '/media/configure': '保存音频设置', '/media/credentials': '保存音频密钥',
      '/persona': '读取人格', '/persona/card': '保存人格', '/persona/configure': '保存人格', '/model/configure': '保存模型设置', '/model/endpoint': '保存自定义接口', '/model/credentials': '保存模型 API Key', '/model/endpoint/clear': '清除自定义接口', '/owner/configure': '保存主人设置', '/proactive/configure': '保存主动私信设置', '/voice/configure': '保存语音设置', '/voice/credentials': '保存语音 Key', '/voice/synth': '生成语音', '/proactive/tick': '让大肥鱼主动说一句', '/task/limits': '读取任务额度', '/task/limits/configure': '保存任务额度',
      '/task': '提交对话任务', '/stop': '停止对话任务', '/forward/contacts': '读取转发会话', '/forward': '转发作品', '/interact/check': '检查页面能否互动', '/interact': '点赞收藏并评论', '/publish': '发布作品', '/publish/status': '检查发布通道', '/comment': '发表评论', '/profile': '查看主页作品', '/share': '分享作品', '/memory': '检索共享记忆',
      '/usage': '读取用量', '/diagnostics': '一键自检', '/diagnostics/repair': '修复自检问题', '/reports/generate': '生成观看日报', '/reports/read': '读取观看日报', '/reports/state': '读取日报目录',
    };

    function requestOperation(route, body) {
      const path = route.split('?')[0].replace(/^\/api/, '');
      if (path === '/task/limits' && body !== undefined) return '保存任务额度';
      if (path === '/watch/schedule' && typeof body?.enabled === 'boolean') return body.enabled ? '开始自主观看' : '暂停观看';
      return OPERATIONS[path] || '本机操作';
    }

    function requestFailure(failure, operation, { timeoutMs, write = false, signal } = {}) {
      failure = failure || new Error('操作未完成。');
      if (failure.operation) return failure;
      const timedOut = !Number.isInteger(failure.status) && (failure.name === 'TimeoutError' || signal?.reason?.name === 'TimeoutError' || /^(?:signal timed out|the operation was aborted due to timeout)\.?$/i.test(failure.message || ''));
      const cancelled = failure.name === 'AbortError';
      const transport = timedOut || cancelled || Boolean(timeoutMs && (failure instanceof TypeError || failure.name === 'TypeError'));
      const detail = timedOut ? `等待本机服务超时${timeoutMs ? `（${Math.round(timeoutMs / 1000)} 秒）` : ''}。` : cancelled ? '请求已取消。' : transport ? '未能连接本机服务。' : /^signal timed out\.?$/i.test(failure.message || '') ? `服务处理超时（${failure.message}）。` : failure.message || '操作未完成。';
      const error = new Error(`${operation}：${detail}${transport && write ? '请求结果尚未确认，请先刷新状态核对，勿重复提交。' : ''}`);
      error.operation = operation; error.requestError = transport; error.unconfirmed = transport && write;
      if (failure.status !== undefined) error.status = failure.status;
      if (failure.code !== undefined) error.code = failure.code;
      return error;
    }

    function operationLabel(name) {
      return ({ browserOpen:'打开抖音', browser:'打开抖音', refresh:'刷新连接', task:'提交对话任务', stop:'停止对话任务', settings:'保存模型设置', modelKey:'保存模型 API Key', voiceSpeech:'试用说话音色', voiceSing:'试用唱歌音色', modelClear:'清除自定义接口', clearKey:'移除模型密钥', openMemory:'打开记忆文件夹', memory:'检索共享记忆', watchSchedule:'设置自动观看', schedule:'设置自动观看', interactions:'设置好友互动', chatList:'读取当前会话列表', chatPrepare:'准备回复通道', forwardList:'读取转发会话', forward:'转发作品', personaReload:'载入最新人格', diagnostics:'一键自检或修复', reportGenerate:'生成观看日报', reportRead:'读取观看日报' })[name] || (/^resolve-|^chatResolve:/.test(name) ? '解除会话暂停' : name.startsWith('key:') ? '保存音频密钥' : '本机操作');
    }

    function createSettingsTransport(globals = globalThis, rpc = globals.__DSH_TRANSPORT__?.rpc) {
      const carrier = globals.__DSH_TRANSPORT__;
      const address = globals.location;
      const http = address && ['http:', 'https:'].includes(address.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
      const desktop = ['dsh-app:', 'dsh:'].includes(address?.protocol) && address.hostname === 'app';
      const fetcher = typeof carrier?.fetch === 'function' ? carrier.fetch.bind(carrier) : (http || desktop) && typeof globals.fetch === 'function' ? globals.fetch.bind(globals) : null;
      let token = '';
      const writing = new Set();
      return {
        async request(route, input) {
          if (!routes.has(route) && !/^\/reports\/read\?date=\d{4}-\d{2}-\d{2}$/.test(route)) throw new Error('只允许本插件的原生设置接口。');
          if (!fetcher && typeof rpc?.call !== 'function') throw new Error('当前 DSH 页面没有可用的插件设置通信接口。请更新插件后完全退出并重开 DSH；若仍失败，请核对 DSH 版本与来源。可点击“刷新插件状态”重试。');
          if (input !== undefined && !token) throw new Error('请先刷新原生设置页，核实当前状态。');
          if (route === '/chat/unanswered' && !token) throw new Error('请先刷新原生设置页，核实当前状态。');
          const operation = requestOperation(route, input), write = input !== undefined, timeoutMs = route === '/state' ? 20_000 : 65_000;
          if (write && writing.has(route)) throw Object.assign(new Error(`${operation}正在处理，请等待当前请求完成。`), { operation, code: 'UI_OPERATION_BUSY' });
          if (write) writing.add(route);
          const signal = AbortSignal.timeout(timeoutMs);
          try {
          let response;
          if (!fetcher && typeof rpc?.call === 'function') {
            const reply = await rpc.call('/douyin-settings', 'request', { path: route, ...(input === undefined ? (route === '/chat/unanswered' ? { token } : {}) : { input, token }) }, signal);
            if (!reply?.ok) throw new Error(reply?.error?.message || 'DSH 设置通信失败，请确认插件后端已加载新版；操作不会自动重试。');
            const outcome = reply.value;
            if (!Number.isInteger(outcome?.status) || !outcome.body || typeof outcome.body !== 'object') throw new Error('DSH 设置接口版本不匹配，请完全退出后重开 DSH。');
            response = { status: outcome.status, ok: outcome.status >= 200 && outcome.status < 300, json: async () => outcome.body };
          } else response = await fetcher(PREFIX + route, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'content-type': 'application/json', ...(input !== undefined || route === '/chat/unanswered' ? { 'x-douyin-settings-token': token } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
          let value;
          try { value = await response.json(); }
          catch (failure) { if (signal.aborted || failure.name === 'TimeoutError') throw failure; const error = new Error(`插件设置接口未返回 JSON（HTTP ${response.status || '未知'}）。请检查插件后端是否启用、DSH 的 WebServer 服务及版本兼容性。`); error.status = response.status; throw error; }
          if (!response.ok) { const error = new Error(value.error || '原生设置操作未完成。'); error.status = response.status; throw error; }
          if (route === '/state') { if (typeof value.token !== 'string' || !value.token) throw new Error('原生设置未取得有效会话。'); token = value.token; const { token: hidden, ...state } = value; return state; }
          return value;
          } catch (failure) { throw requestFailure(failure, operation, { timeoutMs, write, signal }); }
          finally { if (write) writing.delete(route); }
        },
      };
    }

    function useAutosave({ value, initial, read, encode, write, canonical = (_result, payload) => payload, available = true }) {
      const [draft, setDraft] = useState(() => value ? read(value) : initial), [status, setStatus] = useState({});
      const current = useRef(draft), dirty = useRef(false), version = useRef(0), ack = useRef(null), timer = useRef(null), writing = useRef(false), queued = useRef(false), requested = useRef(false), alive = useRef(true), options = useRef(null);
      options.current = { read, encode, write, canonical, available };
      const schedule = immediate => { requested.current = true; clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, immediate ? 0 : 600); };
      async function flush() {
        requested.current = true; clearTimeout(timer.current); if (!alive.current || !dirty.current || !options.current.available) return;
        if (writing.current) { queued.current = true; return; }
        let payload; try { payload = options.current.encode(current.current); } catch (error) { setStatus({ kind: 'editing', message: error.message || '填写完整后自动生效。' }); return; }
        const submitted = version.current; writing.current = true; queued.current = false; requested.current = false; setStatus({ kind: 'saving', message: '正在保存…' });
        try { const result = await options.current.write(payload), expected = options.current.canonical(result, payload); if (alive.current && submitted === version.current) { ack.current = { version: submitted, key: JSON.stringify(expected) }; setStatus({ kind: 'saved', message: '已保存，等待状态同步。' }); } }
        catch (error) { if (alive.current) setStatus({ kind: 'error', message: `${error.message || '保存失败。'} 草稿已保留。` }); }
        finally { writing.current = false; if (alive.current && queued.current) schedule(true); }
      }
      function edit(patch, { immediate = false, blurOnly = false } = {}) {
        current.current = { ...current.current, ...patch }; version.current++; dirty.current = true; ack.current = null; setDraft(current.current); setStatus({ kind: 'editing', message: blurOnly ? '离开输入框后自动保存。' : '修改后自动保存。' }); clearTimeout(timer.current); requested.current = !blurOnly; if (blurOnly) queued.current = false; else schedule(immediate);
      }
      useEffect(() => {
        if (!value) return; let incoming, key; try { incoming = options.current.read(value); key = JSON.stringify(options.current.encode(incoming)); } catch { return; }
        if (ack.current?.version === version.current && ack.current.key === key) { dirty.current = false; ack.current = null; setStatus({ kind: 'saved', message: '已生效。' }); }
        if (!dirty.current && !writing.current) { current.current = incoming; setDraft(incoming); }
      }, [value]);
      useEffect(() => { if (available && requested.current && dirty.current) schedule(true); }, [available]);
      useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
      return { draft, edit, flush, status };
    }

    function SettingsPage({ rpc } = {}) {
      const [api] = useState(() => createSettingsTransport(globalThis, rpc));
      const [state, setState] = useState(null), [ready, setReady] = useState(false), [connectionError, setConnectionError] = useState(''), [notice, setNotice] = useState(''), [category, setCategory] = useState('基础设置');
      const [operationErrors, setOperationErrors] = useState({});
      const [busy, setBusy] = useState(new Set()), [contacts, setContacts] = useState(null), [discovery, setDiscovery] = useState(null), [diagnostics, setDiagnostics] = useState(null), [repairResult, setRepairResult] = useState(''), [report, setReport] = useState(null), [reportDate, setReportDate] = useState('');
      const [credentials, setCredentials] = useState({ mimo: '', minimax: '' }), [keyStatus, setKeyStatus] = useState({}), [reviews, setReviews] = useState(new Set());
      const [endpointKey, setEndpointKey] = useState(''), [endpointKeyStatus, setEndpointKeyStatus] = useState('');
      const [voiceKeys, setVoiceKeys] = useState({ speech: '', sing: '' }), [voiceTestText, setVoiceTestText] = useState(''), [voiceResult, setVoiceResult] = useState(null);
      const [forward, setForward] = useState({ recipientId: '', url: '' });
      const [interact, setInteract] = useState({ videoId: '', comment: '', like: true, collect: true }), [interactResult, setInteractResult] = useState(null);
      const [shareTo, setShareTo] = useState({ videoId: '', recipientName: '' }), [shareResult, setShareResult] = useState(null);
      // 分享好友许可（谁可以被分享）与评论 @ 名单：都要先「读取列表」，勾选后保存。
      const [shareAllowedDraft, setShareAllowedDraft] = useState(null);
      const [mentionCandidates, setMentionCandidates] = useState(null), [mentionPick, setMentionPick] = useState('');
      const [atTargetsDraft, setAtTargetsDraft] = useState(null);
      const [profileQuery, setProfileQuery] = useState({ userId: 'self', url: '' }), [profileData, setProfileData] = useState(null);
      const [publishDraft, setPublishDraft] = useState({ filePath: '', title: '', tagsText: '' }), [publishResult, setPublishResult] = useState(null);
      // 发布草稿只在本页保存，不落到插件设置里。
      const publish = { draft: publishDraft, edit: patch => setPublishDraft(old => ({ ...old, ...patch })), flush: () => {} };
      const existingAuthorization = useRef(false); const alive = useRef(true), refreshing = useRef(null), refreshAgain = useRef(false), locks = useRef(new Set()), submitted = useRef(new Set()), keyValues = useRef(credentials);
      const active = value => value?.running || value?.starting || value?.busy || value?.worker?.alive;
      const operationActive = active(state?.watch) || state?.chat?.starting || state?.chat?.busy || state?.share?.busy;
      async function refresh(fresh = false) {
        if (refreshing.current) { if (fresh) refreshAgain.current = true; return refreshing.current; }
        const work = (async () => {
          let latest;
          do {
            refreshAgain.current = false;
            try { const value = await api.request('/state'); if (alive.current && !refreshAgain.current) { latest = value; setState(value); setReady(true); setConnectionError(''); } }
            catch (failure) { if (alive.current && !refreshAgain.current) { setReady(false); setConnectionError(failure.message); } }
          } while (alive.current && refreshAgain.current);
          return latest;
        })();
        refreshing.current = work; try { return await work; } finally { if (refreshing.current === work) refreshing.current = null; }
      }
      useEffect(() => { alive.current = true; void refresh(); const timer = setInterval(() => { void refresh(); }, 2500); return () => { alive.current = false; clearInterval(timer); }; }, [api]);
      useEffect(() => { if (!reportDate && state?.reports?.date) setReportDate(state.reports.date); }, [state]);
      const write = route => async payload => { const result = await api.request(route, payload); void refresh(true); return result; };
      const list = text => String(text || '').split(/[\n,;，；]+/).map(item => item.trim()).filter(Boolean);
      const positive = (value, label) => { const number = Number(value); if (String(value).trim() === '' || !Number.isSafeInteger(number) || number < 1) throw new Error(`${label}请填写正整数。`); return number; };
      const model = useAutosave({ value: state?.model, initial: { provider: '', model: '' }, read: value => ({ provider: value.provider || '', model: value.model || '' }), encode: value => { if (!value.provider || !value.model) throw new Error('请选择提供商和模型。'); return value; }, write: write('/model/configure'), available: ready && !operationActive });
      const endpoint = useAutosave({ value: state?.model?.endpoint, initial: { baseUrl: '', model: '', supportsImages: false }, read: value => ({ baseUrl: value?.baseUrl || '', model: value?.model || '', supportsImages: value?.supportsImages === true }), encode: value => { if (!String(value.baseUrl || '').trim()) throw new Error('请填写接口地址，例如 https://api.deepseek.com/v1。'); if (!String(value.model || '').trim()) throw new Error('请填写该接口的模型名称。'); return { baseUrl: String(value.baseUrl).trim(), model: String(value.model).trim(), supportsImages: value.supportsImages === true }; }, write: write('/model/endpoint'), canonical: (saved, payload) => saved && typeof saved.baseUrl === 'string' ? { baseUrl: saved.baseUrl, model: saved.model || '', supportsImages: saved.supportsImages === true } : payload, available: ready && !operationActive });
      const owner = useAutosave({ value: state?.owner, initial: { recipientId: '', name: '', commentMention: true, shareToOwner: true, proactiveChat: true, shareNote: true }, read: value => ({ recipientId: value?.recipientId || '', name: value?.name || '', atCriteria: value?.atCriteria || '', commentMention: value?.commentMention !== false, shareToOwner: value?.shareToOwner !== false, proactiveChat: value?.proactiveChat !== false, shareNote: value?.shareNote !== false }), encode: value => ({ recipientId: value.recipientId || '', name: String(value.name || '').trim(), atCriteria: String(value.atCriteria || '').trim().slice(0, 500), commentMention: value.commentMention === true, shareToOwner: value.shareToOwner === true, proactiveChat: value.proactiveChat === true, shareNote: value.shareNote !== false }), write: write('/owner/configure'), canonical: (saved, payload) => saved && typeof saved.name === 'string' ? { recipientId: saved.recipientId || '', name: saved.name, atCriteria: saved.atCriteria || '', commentMention: saved.commentMention !== false, shareToOwner: saved.shareToOwner !== false, proactiveChat: saved.proactiveChat !== false, shareNote: saved.shareNote !== false } : payload, available: ready && !operationActive });
      const voice = useAutosave({ value: state?.voice, initial: { speechVoice: 'chloe', speechModel: 'higgs-tts-3', speechBaseUrl: 'https://api.boson.ai/v1', singVoice: 'nora', singModel: 'higgs-tts-3', singBaseUrl: 'https://api.boson.ai/v1', sendVoice: false }, read: value => ({ speechVoice: value?.speech?.voice || 'chloe', speechModel: value?.speech?.model || 'higgs-tts-3', speechBaseUrl: value?.speech?.baseUrl || 'https://api.boson.ai/v1', singVoice: value?.sing?.voice || 'nora', singModel: value?.sing?.model || 'higgs-tts-3', singBaseUrl: value?.sing?.baseUrl || 'https://api.boson.ai/v1', sendVoice: value?.sendVoice === true }), encode: value => ({ speech: { voice: value.speechVoice, model: value.speechModel, baseUrl: value.speechBaseUrl }, sing: { voice: value.singVoice, model: value.singModel, baseUrl: value.singBaseUrl }, sendVoice: value.sendVoice === true }), write: write('/voice/configure'), canonical: (saved, payload) => saved?.speech ? { speechVoice: saved.speech.voice, speechModel: saved.speech.model, speechBaseUrl: saved.speech.baseUrl, singVoice: saved.sing.voice, singModel: saved.sing.model, singBaseUrl: saved.sing.baseUrl, sendVoice: saved.sendVoice === true } : payload, available: ready && !operationActive });
      const persona = useAutosave({ value: state?.persona, initial: { content: '', expectedRevision: null }, read: value => ({ content: value.manualText || '', expectedRevision: value.revision }), encode: value => value, write: write('/persona/configure'), canonical: (saved, payload) => saved?.revision ? { content: saved.manualText || '', expectedRevision: saved.revision } : payload, available: ready && !operationActive });
      const readVideo = snapshot => { const policy = snapshot?.policy || {}, minutes = Object.hasOwn(policy, 'dailyMinutes') ? policy.dailyMinutes : Object.hasOwn(policy, 'sessionMinutes') ? policy.sessionMinutes : 10, requests = Object.hasOwn(policy, 'dailyRequests') ? policy.dailyRequests : 30; return { windows: (policy.windows || ['00:00-24:00']).join('\n'), weekendAll: policy.weekendWindows?.join() === '00:00-24:00', dailyMinutes: minutes ?? '', unlimitedMinutes: minutes === null, dailyRequests: requests ?? '', unlimitedRequests: requests === null, rhythmEnabled: policy.rhythmEnabled !== false, watchMinutes: policy.rhythmWatchMinutes ?? 30, restMinutesMin: policy.rhythmRestMinutesMin ?? 20, restMinutesMax: policy.rhythmRestMinutesMax ?? 80, keywordsText: (policy.rhythmContinueKeywords || ['继续看']).join('、') }; };
      const encodeVideo = value => { const windows = list(value.windows); if (!windows.length || windows.some(item => !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(item))) throw new Error('时段请填写完整的 HH:MM-HH:MM。'); return { windows, weekendWindows: value.weekendAll ? ['00:00-24:00'] : null, dailyMinutes: value.unlimitedMinutes ? null : positive(value.dailyMinutes, '每日观看分钟数'), dailyRequests: value.unlimitedRequests ? null : positive(value.dailyRequests, '每日模型请求次数'), rhythmEnabled: value.rhythmEnabled === true, rhythmWatchMinutes: positive(value.watchMinutes, '每次观看分钟数'), rhythmRestMinutesMin: positive(value.restMinutesMin, '最短休息分钟数'), rhythmRestMinutesMax: positive(value.restMinutesMax, '最长休息分钟数'), rhythmContinueKeywords: list(value.keywordsText) }; };
      const video = useAutosave({ value: state?.video, initial: readVideo(null), read: readVideo, encode: encodeVideo, write: write('/video/configure'), canonical: (saved, payload) => saved?.policy ? encodeVideo(readVideo(saved)) : payload, available: ready });
      const readTopics = value => ({ mode: value?.policy?.mode || 'recommend', topics: (value?.policy?.topics || []).join('\n'), exclude: (value?.policy?.exclude || []).join('\n'), fastSkip: value?.policy?.fastSkip !== false });
      const topics = useAutosave({ value: state?.watchOptions, initial: readTopics(null), read: readTopics, encode: value => ({ mode: value.mode, topics: list(value.topics), exclude: list(value.exclude), fastSkip: value.fastSkip !== false }), write: write('/watch/options'), canonical: (saved, payload) => saved?.policy ? { mode: saved.policy.mode, topics: saved.policy.topics || [], exclude: saved.policy.exclude || [], fastSkip: saved.policy.fastSkip !== false } : payload, available: ready });
      const mode = useAutosave({ value: state?.mode, initial: { silent: false }, read: value => ({ silent: value?.silent === true }), encode: value => value, write: write('/mode/configure'), canonical: (saved, payload) => typeof saved?.silent === 'boolean' ? { silent: saved.silent } : payload, available: ready });
      const comments = useAutosave({ value: state?.comments, initial: { enabled: false, dailyLimit: 3, perSessionLimit: 1 }, read: value => ({ enabled: value.enabled === true, dailyLimit: value.policy?.dailyLimit ?? 3, perSessionLimit: value.policy?.perSessionLimit ?? 1 }), encode: value => ({ enabled: value.enabled, dailyLimit: positive(value.dailyLimit, '每日评论次数'), perSessionLimit: positive(value.perSessionLimit, '每次观看评论次数') }), write: write('/comments/configure'), canonical: (saved, payload) => saved?.policy ? { enabled: saved.enabled === true, dailyLimit: saved.policy.dailyLimit, perSessionLimit: saved.policy.perSessionLimit } : payload, available: ready });
      const shareLimit = useAutosave({ value: state?.share, initial: { enabled: true, dailyLimit: 10 }, read: value => ({ enabled: value?.enabled === true, dailyLimit: value?.dailyLimit ?? 10 }), encode: value => ({ enabled: value.enabled, dailyLimit: positive(value.dailyLimit, '每日分享上限') }), write: write('/share/configure'), canonical: (saved, payload) => saved && typeof saved.enabled === 'boolean' ? { enabled: saved.enabled, dailyLimit: saved.dailyLimit ?? 10 } : payload, available: ready && !operationActive });
      const media = useAutosave({ value: state?.media, initial: { enabled: false, backend: 'local-whisper' }, read: value => ({ enabled: value.enabled === true, backend: value.backend || 'local-whisper' }), encode: value => value, write: write('/media/configure'), available: ready });
      const readChat = value => ({ recipientIds: (value?.policy?.allowlist || []).map(item => item.id), allowConversationOnly: existingAuthorization.current || (value?.policy?.allowlist || []).some(item => ['existing-conversation', 'existing-group'].includes(item.authorizationKind)), groupMentionNamesText: (value?.policy?.groupMentionNames || ['大肥鱼']).join('\n') });
      const encodeChat = value => ({ recipientIds: value.recipientIds, allowConversationOnly: value.allowConversationOnly, groupMentionNames: list(value.groupMentionNamesText) });
      const chat = useAutosave({ value: state?.chat, initial: readChat(null), read: readChat, encode: encodeChat, write: write('/chat/configure'), canonical: (saved, payload) => saved?.policy ? encodeChat(readChat(saved)) : payload, available: ready });
      const shownContacts = [...new Map([...(state?.chat?.policy?.allowlist || []).map(item => ({ ...item, notListed: Boolean(contacts) && !contacts.some(found => found.id === item.id) })), ...(contacts || [])].map(item => [item.id, item])).values()];
      // 分享好友许可：null 表示「还没单独圈过」，按全部可分享会话显示为已勾选。
      const shareCandidates = state?.share?.candidateRecipients || [];
      const shareAllowedIds = Array.isArray(shareAllowedDraft) ? shareAllowedDraft : Array.isArray(state?.share?.allowedRecipientIds) ? state.share.allowedRecipientIds : shareCandidates.filter(item => item.sharable === true).map(item => item.id);
      const atTargets = Array.isArray(atTargetsDraft) ? atTargetsDraft : (state?.comments?.policy?.atTargets || []);
      const notifyState = state?.notify || { items: [], total: 0, undelivered: 0 };
      async function perform(key, action) {
        if (!ready || locks.current.has(key)) return; locks.current.add(key); setBusy(new Set(locks.current)); setNotice('');
        setOperationErrors(old => { const next = { ...old }; delete next[key]; return next; });
        try { const value = await action(); if (alive.current) setNotice(`${operationLabel(key)}已完成。`); await refresh(true); return value; }
        catch (failure) { if (alive.current) { const detail = requestFailure(failure, operationLabel(key)); setOperationErrors(old => ({ ...old, [key]: { message: detail.message, requestError: detail.requestError === true, unconfirmed: detail.unconfirmed === true } })); } await refresh(true); }
        finally { locks.current.delete(key); if (alive.current) setBusy(new Set(locks.current)); }
      }
      const button = (label, key, action, disabled = false, needsReady = true) => h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: (needsReady && !ready) || busy.has(key) || disabled, onClick: action }, busy.has(key) ? '处理中…' : label);
      const note = text => text ? h('p', { style: muted }, text) : null;
      const status = form => form.status.message && h('p', { role: form.status.kind === 'error' ? 'alert' : 'status', style: muted }, form.status.message);
      const section = (title, ...children) => h('section', { role: 'tabpanel', 'aria-label': title, style: { ...column, marginBottom: 24 } }, h('h3', null, title), ...children);
      const field = (label, form, key, extra = {}) => h('label', { style: column }, h('span', null, label), h(Input, { 'aria-label': label, value: form.draft[key], disabled: !ready, onChange: event => form.edit({ [key]: event.target.value }), ...extra }));
      const area = (label, form, key, rows = 2, blurOnly = false, disabled = false) => h('label', { style: column }, label, h('textarea', { 'aria-label': label, rows, value: form.draft[key], disabled: !ready || disabled, style: formControl, onChange: event => form.edit({ [key]: event.target.value }, { blurOnly }), onBlur: blurOnly ? () => { void form.flush(); } : undefined }));
      const toggle = (label, checked, onChange, disabled = false) => h('label', { style: row }, h('input', { type: 'checkbox', 'aria-label': label, checked: checked === true, disabled: !ready || disabled, onChange: event => onChange(event.target.checked) }), label);
      const select = (label, value, options, onChange, disabled = false) => h('label', { style: column }, label, h('select', { 'aria-label': label, value, style: formControl, disabled: !ready || disabled, onChange: event => onChange(event.target.value) }, ...options.map(([key, text]) => h('option', { key, value: key }, text))));
      const reviewList = kind => (state?.[kind]?.needsReview || []).map(item => { const key = `${kind}:${item.operationId}`; return h('div', { key, style: column }, note(`待核对：${item.videoId ? `作品 ${item.videoId}` : '消息'} · ${item.status || ''}`), submitted.current.has(key) ? note('核对结果已提交，等待回读。') : h('div', { style: row }, ...[['confirmed', '已核对发送成功'], ['not-sent', '已核对未发送']].map(([outcome, label]) => button(label, key, () => { submitted.current.add(key); setReviews(new Set(submitted.current)); void perform(key, async () => { try { return await api.request(`/${kind}/resolve`, { operationId: item.operationId, outcome }); } catch (error) { submitted.current.delete(key); setReviews(new Set(submitted.current)); throw error; } }); }, state?.[kind]?.busy)))); });
      const shareFailureMessage = item => typeof item?.failure?.message === 'string' && item.failure.message.trim() ? item.failure.message : item?.status === 'not-sent' ? '旧记录没有保存详细失败原因。' : '';
      function credentialForm(backend, label) {
        return h('div', { style: column }, h('label', { style: column }, `${label} API Key`, h(Input, { 'aria-label': `${label} API Key`, type: 'password', autoComplete: 'off', maxLength: 4096, value: credentials[backend], disabled: !ready || operationActive || busy.has(`key:${backend}`), onChange: event => { keyValues.current = { ...keyValues.current, [backend]: event.target.value }; setCredentials(keyValues.current); }, onBlur: () => { const secret = keyValues.current[backend].trim(); if (!secret) return; void perform(`key:${backend}`, async () => { const result = await api.request('/media/credentials', { backend, apiKey: secret }); if (keyValues.current[backend].trim() === secret) { keyValues.current = { ...keyValues.current, [backend]: '' }; setCredentials(keyValues.current); } setKeyStatus(old => ({ ...old, [backend]: 'Key 已保存，不回显。' })); return result; }); } })), note(keyStatus[backend] || (state?.media?.backends?.[backend]?.credential?.configured ? '已配置；填写新 Key 后离开输入框即可替换。' : '填写 Key，离开输入框后保存。')));
      }
      const friendEnabled = state?.interactions?.policy?.enabled === true, watchEnabled = state?.schedule?.policy?.enabled === true;
      const presence = ready ? state?.interactions?.presence : null, replyPresence = presence?.reply || presence, watchState = presence?.watch, presenceLabel = replyPresence?.label || '状态待核实', presenceReason = replyPresence?.reason || '正在读取好友回复服务状态。', watchLabel = watchState?.active ? watchState.label : '';
      return h('div', { style: { ...column, maxWidth: 900, paddingBottom: 32 } },
        h('h2', null, '大肥鱼抖音助手'), !ready && h('p', { role: 'status' }, '正在核实插件状态。'), connectionError && h('p', { role: 'alert' }, connectionError),
        ...Object.entries(operationErrors).map(([key, failure]) => h('div', { key, role: 'alert', style: row }, h('span', null, `${failure.requestError ? '上次操作：' : ''}${failure.message}${failure.requestError && ready ? failure.unconfirmed ? ' 本机服务当前已连接；请核对上述操作是否生效。' : ' 本机服务当前已连接。' : ''}`), h('button', { type: 'button', 'aria-label': `清除${operationLabel(key)}提示`, onClick: () => setOperationErrors(old => { const next = { ...old }; delete next[key]; return next; }) }, '×'))), notice && h('p', { role: 'status' }, notice),
        h('div', { role: 'status', 'aria-live': 'polite', style: { ...row, position: 'sticky', top: 0, zIndex: 5, background: 'var(--dsw-alias-bg-base, #fff)', padding: '8px 0' }, title: [presenceReason, watchState?.active ? watchState.reason : ''].filter(Boolean).join(' ') }, h('span', { 'aria-label': '好友互动状态', title: presenceReason, style: { border: '1px solid currentColor', borderRadius: 20, padding: '6px 12px', whiteSpace: 'nowrap' } }, `${replyPresence?.online === true ? '●' : '○'} ${presenceLabel}`), watchState?.active && h('small', { role: 'status', 'aria-label': '自主观看状态', title: watchState.reason, style: muted }, `◉ ${watchLabel}`), (['attention', 'preparing'].includes(replyPresence?.status) || watchState?.active && replyPresence?.online !== true) && h('small', { role: replyPresence?.status === 'attention' ? 'alert' : 'status', style: muted }, presenceReason)),
        h('div', { style: row }, button('刷新插件状态', 'refresh', () => { void refresh(); }, false, false), button('打开抖音', 'browser', () => { void perform('browser', () => api.request('/browser/open', {})); })),
        h('div', { role: 'tablist', 'aria-label': '抖音设置分类', style: row }, ...Object.keys(fallbackCategories).map(name => h(Button, { key: name, role: 'tab', type: 'button', size: 'sm', variant: category === name ? 'primary' : 'outline', 'aria-selected': category === name, onClick: () => setCategory(name) }, name))),
        category === '基础设置' && h('div', null,
          section('DSH 模型',
            state?.model?.mode === 'custom' && note('当前生效：你自己填写的接口；下方 DSH 模型选择暂不使用。'),
            select('模型提供商', model.draft.provider, [['', '请选择 DSH 提供商'], ...(state?.model?.providers || []).map(item => [item.id, item.name || item.id])], provider => model.edit({ provider, model: '' }, { immediate: true }), operationActive),
            select('模型名称', model.draft.model, [['', '请选择模型'], ...(state?.model?.models || []).filter(item => item.provider === model.draft.provider).map(item => [item.id, item.name || item.id])], value => model.edit({ model: value }, { immediate: true }), operationActive),
            status(model),
            note(state?.model?.mode === 'custom' ? '自定义接口已配置完整，插件直接调用它。' : state?.model?.configured ? '模型已配置。' : '请选择已配置的 DSH 模型，或在下方填写自定义接口。'),
            h('details', null, h('summary', null, '自定义接口（自己填接口地址、模型和 API Key）'),
              h('label', { style: column }, '接口地址', h(Input, { 'aria-label': '接口地址', value: endpoint.draft.baseUrl, placeholder: 'https://api.deepseek.com/v1', disabled: !ready || operationActive, onChange: event => endpoint.edit({ baseUrl: event.target.value }, { blurOnly: true }), onBlur: () => { void endpoint.flush(); } })),
              h('label', { style: column }, '接口模型名称', h(Input, { 'aria-label': '接口模型名称', value: endpoint.draft.model, placeholder: '例如 deepseek-chat', disabled: !ready || operationActive, onChange: event => endpoint.edit({ model: event.target.value }, { blurOnly: true }), onBlur: () => { void endpoint.flush(); } })),
              toggle('该接口支持图像输入（视频画面会直接发给它）', endpoint.draft.supportsImages, value => endpoint.edit({ supportsImages: value }, { immediate: true })),
              status(endpoint),
              h('label', { style: column }, '模型 API Key', h(Input, { 'aria-label': '模型 API Key', type: 'password', autoComplete: 'off', maxLength: 4096, value: endpointKey, disabled: !ready || operationActive || busy.has('modelKey'), onChange: event => setEndpointKey(event.target.value), onBlur: () => { const secret = endpointKey.trim(); if (!secret) return; void perform('modelKey', async () => { const result = await api.request('/model/credentials', { apiKey: secret }); setEndpointKey(''); setEndpointKeyStatus('Key 已保存，不回显。'); return result; }); } })),
              note(endpointKeyStatus || (state?.model?.endpoint?.keyConfigured ? '已保存 Key；填写新 Key 后离开输入框即可替换。' : '填写 Key，离开输入框后保存。')),
              h('div', { style: row }, button('清除自定义接口', 'modelClear', () => { void perform('modelClear', async () => { const result = await api.request('/model/endpoint/clear', {}); setEndpointKeyStatus(''); return result; }); }, !state?.model?.endpoint?.baseUrl && !state?.model?.endpoint?.keyConfigured)),
              note('填好地址、模型名称并保存 Key 后，插件直接请求该地址的 /chat/completions，不再转用 DSH 供应商；自主观看需要勾选图像输入，否则看不到画面会停止。Key 只保存在本机状态目录，不回显。')
            )),
          section('主人',
            select('主人（从许可名单里选）', owner.draft.recipientId, [['', '请选择主人'], ...(state?.chat?.policy?.allowlist || []).map(item => [item.id, item.name])], id => { const hit = (state?.chat?.policy?.allowlist || []).find(item => item.id === id); owner.edit({ recipientId: id, name: hit?.name || '' }, { immediate: true }); }, operationActive),
            note('选好后自动带上昵称，默认开启下面三项：评论时在评论里 @ 你、把好看的作品分享给你、主动找你聊天。'),
            area('什么样的作品 @ 主人（可写指令，例如：看到好看的美女@我）', owner, 'atCriteria', 2, true),
            toggle('评论时 @ 主人', owner.draft.commentMention, value => owner.edit({ commentMention: value }, { immediate: true })),
            toggle('把好看的作品分享给主人', owner.draft.shareToOwner, value => owner.edit({ shareToOwner: value }, { immediate: true })),
            toggle('主动和主人聊天', owner.draft.proactiveChat, value => owner.edit({ proactiveChat: value }, { immediate: true })),
            toggle('分享作品时带一句感想', owner.draft.shareNote, value => owner.edit({ shareNote: value }, { immediate: true })),
            status(owner),
            note(state?.owner?.configured ? `当前主人：${state.owner.name}` : '尚未选择主人：评论 @、分享给主人和主动聊天都不会生效。需要先在「好友互动」读取联系人并勾选许可。')
          ),
          section('主人通知',
            note(`每次点赞、发评论、分享给别人都会留一条记录。共 ${notifyState.total || 0} 条${notifyState.undelivered ? `，其中 ${notifyState.undelivered} 条没能推送到私信` : ''}。`),
            note('记录只在本机；推送需要「主人」里选好对应的许可会话。推送失败的记录会写清原因，不会假装送达。'),
            h('div', { style: row }, button('清空通知记录', 'notifyClear', () => { void perform('notifyClear', () => api.request('/notify/clear', {})); }, !notifyState.total)),
            ...(notifyState.items || []).slice(0, 20).map(item => h('div', { key: item.id, style: column },
              note(`${new Date(item.at).toLocaleString('zh-CN', { hour12: false })} · ${({ comment: '评论', like: '点赞', collect: '收藏', share: '分享', publish: '发布', dm: '私信', canary: '页面自检' })[item.kind] || item.kind} · ${item.action}`),
              item.title && note(`内容：${item.title}`),
              item.detail && note(item.detail),
              note(`结果：${{ confirmed: '已确认', uncertain: '未确认', 'not-sent': '未发出' }[item.result] || item.result || '—'}${item.pushStatus === 'delivered' ? ' · 已推送到主人私信' : item.pushStatus === 'not-required' ? ' · 对象是主人本人，不重复通知' : item.pushReason ? ` · 未推送：${item.pushReason}` : ''}`))))
          ,
          section('人格与兴趣', area('大肥鱼人格正文', persona, 'content', 14, true, operationActive), status(persona), persona.status.kind === 'error' && button('载入最新人格（替换草稿）', 'personaReload', () => { void perform('personaReload', async () => { const latest = await refresh(true); if (!latest?.persona?.revision) throw new Error('未读到最新人格，原草稿已保留。'); persona.edit({ content: latest.persona.manualText || '', expectedRevision: latest.persona.revision }, { blurOnly: true }); return latest.persona; }); }), note('离开输入框后保存。插件与软件共用人格，未保存草稿不会被轮询覆盖。'), note(state?.persona?.personaFolder))),
        category === '视频观看' && h('div', null,
          section('视频观看', toggle('允许自动观看', watchEnabled, enabled => { void perform('schedule', () => api.request('/watch/schedule', { enabled })); }, typeof state?.schedule?.policy?.enabled !== 'boolean' || busy.has('schedule')), note('在允许时段内自动观看，离开时段或用完每日预算会停止。DSH 需保持运行。'),
            h('div', { style: row }, button('开始自主观看', 'schedule', () => { void perform('schedule', () => api.request('/watch/schedule', { enabled: true })); }, typeof state?.schedule?.policy?.enabled !== 'boolean' || typeof state?.watch?.running !== 'boolean' || !state?.model?.configured || active(state?.watch) || state?.schedule?.busy), button('暂停观看', 'schedule', () => { void perform('schedule', () => api.request('/watch/schedule', { enabled: false })); }, typeof state?.schedule?.policy?.enabled !== 'boolean' || typeof state?.watch?.running !== 'boolean' || !watchEnabled && !active(state?.watch) && !state?.schedule?.busy)),
            note('不在允许时段会等待；按钮与开关共用设置，每日已用时长和模型次数不会重置。'),
            h('div', { style: row }, button('谷时段（DeepSeek）', 'valley', () => video.edit({ windows: '00:00-09:00\n12:00-14:00\n18:00-24:00', weekendAll: true }, { immediate: true })), button('全天', 'all', () => video.edit({ windows: '00:00-24:00', weekendAll: false }, { immediate: true })), button('晚间 20–22 点', 'evening', () => video.edit({ windows: '20:00-22:00', weekendAll: false }, { immediate: true }))), toggle('周末全天允许', video.draft.weekendAll, value => video.edit({ weekendAll: value }, { immediate: true })), area('每日允许视频时段（北京时间）', video, 'windows'),
            h('details', null, h('summary', null, '高级选项'), toggle('不限每日观看时长', video.draft.unlimitedMinutes, value => video.edit({ unlimitedMinutes: value }, { immediate: true })), field('每日观看上限（分钟）', video, 'dailyMinutes', { type: 'number', min: 1, value: video.draft.unlimitedMinutes ? '' : video.draft.dailyMinutes, placeholder: video.draft.unlimitedMinutes ? '不限；输入分钟数可设置上限' : '正整数分钟数', onChange: event => video.edit({ dailyMinutes: event.target.value, ...(event.target.value !== '' ? { unlimitedMinutes: false } : {}) }) }), toggle('不限每日模型请求次数', video.draft.unlimitedRequests, value => video.edit({ unlimitedRequests: value }, { immediate: true })), field('每日观看模型请求上限', video, 'dailyRequests', { type: 'number', min: 1, value: video.draft.unlimitedRequests ? '' : video.draft.dailyRequests, placeholder: video.draft.unlimitedRequests ? '不限；输入次数可设置上限' : '正整数次数', onChange: event => video.edit({ dailyRequests: event.target.value, ...(event.target.value !== '' ? { unlimitedRequests: false } : {}) }) })), toggle('启用观看节律（看一阵、歇一阵）', video.draft.rhythmEnabled, value => video.edit({ rhythmEnabled: value }, { immediate: true })), field('每次观看分钟数', video, 'watchMinutes', { type: 'number', min: 1, value: video.draft.watchMinutes }), field('最短休息分钟数', video, 'restMinutesMin', { type: 'number', min: 1, value: video.draft.restMinutesMin }), field('最长休息分钟数', video, 'restMinutesMax', { type: 'number', min: 1, value: video.draft.restMinutesMax }), field('要求继续的关键词（顿号或逗号分隔）', video, 'keywordsText', { value: video.draft.keywordsText, placeholder: '继续看、接着看、去看吧' }), status(video), note(`今日已观看 ${Math.floor(state?.video?.daily?.usedSeconds || 0)} 秒 · 已请求 ${state?.video?.daily?.requests || 0} 次模型。`), note(state?.video?.reason), note(state?.schedule?.lastError), state?.watch?.lastError && h('p', { role: 'status' }, `上次自主观看停止原因：${state.watch.lastError}`)),
          section('观看主题', toggle('只挑感兴趣的看（先看几秒，不对口就换）', topics.draft.fastSkip, value => topics.edit({ fastSkip: value }, { immediate: true })), select('观看方式', topics.draft.mode, [['recommend', '自主挑选推荐'], ['topic', '围绕指定主题观看']], value => topics.edit({ mode: value }, { immediate: true })), area('想看的主题，每行一个', topics, 'topics'), area('排除关键词，每行一个', topics, 'exclude'), status(topics)),
          section('静默观看', toggle('静默观看', mode.draft.silent, value => mode.edit({ silent: value }, { immediate: true })), status(mode), note(state?.mode?.application?.message || state?.mode?.note))),
        category === '好友互动' && section('好友互动', toggle('允许好友互动', friendEnabled, enabled => { void perform('interactions', () => api.request('/interactions/configure', { enabled })); }, typeof state?.interactions?.policy?.enabled !== 'boolean' || busy.has('interactions')), note('只与下方许可的好友和群聊互动，不设人数和次数上限。模型和名单就绪后自动准备回复；观看中可自主分享。群聊仅在被 @ 或叫到响应昵称时回复。'), note(state?.interactions?.friend?.message), state?.interactions?.friend?.lastError && h('p', { role: 'alert' }, state.interactions.friend.lastError),
          state?.interactions?.friend?.waitReason && note(`${state.interactions.friend.preparing ? '正在准备：' : '等待准备：'}${state.interactions.friend.waitReason}${state.interactions.friend.lastErrorCode ? `（${state.interactions.friend.lastErrorCode}）` : ''}${state.interactions.friend.nextRetryAt ? ` · 下次自动检查 ${new Date(state.interactions.friend.nextRetryAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`),
          state?.interactions?.friend?.waitReason && h('div', { style: row }, h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !ready || busy.has('chatPrepare') || state.interactions.friend.canPrepare === false, onClick: () => { void perform('chatPrepare', () => api.request('/chat/prepare', {})); } }, busy.has('chatPrepare') || state.interactions.friend.preparing ? '正在准备…' : '准备回复通道/重新连接并重试')),
          button('读取联系人与群聊', 'chatList', () => { void perform('chatList', async () => { const result = await api.request('/chat/contacts', {}); if (result.blocked || result.loginRequired || result.verificationRequired || !Array.isArray(result.contacts)) throw new Error('请在专用浏览器完成登录或验证。'); setContacts(result.contacts); setDiscovery(result.listDiscovery || null); return result; }); }, chat.status.kind === 'saving'),
          h('div', { style: row },
            button('私信页面结构自检', 'chatCanary', () => { void perform('chatCanary', () => api.request('/chat/canary', {})); }, !ready),
            note(`轮询间隔 ${state?.chat?.pollSeconds ?? 2} 秒（带 ±${Math.round((state?.chat?.pollJitterRatio ?? 0.2) * 100)}% 抖动）`)),
          state?.chat?.canary && note(`上次结构自检：${state.chat.canary.ok ? '页面正常' : `认不出页面（${state.chat.canary.code}）`} · ${state.chat.canary.message}${state.chat.canary.failures ? ` · 连续失败 ${state.chat.canary.failures}/${state.chat.canary.threshold}` : ''}${state.chat.canary.checkedAt ? ` · ${new Date(state.chat.canary.checkedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`),
          note('读取范围是抖音网页版当前会话，不代表全部关注好友或所有群。要授权群聊，请先让群会话出现在抖音消息列表，再刷新。'), contacts && note(`本次读取：个人 ${contacts.filter(item => item.isGroup === false).length} 个 · 群聊 ${contacts.filter(item => item.isGroup === true).length} 个。${discovery?.scannedToEnd === false ? ` 当前列表尚未完整读取。${discovery.reason || ''}` : ''}`),
          contacts?.some(item => item.relationshipStatus === 'unavailable' || item.isGroup === true || typeof item.isGroup !== 'boolean') && toggle('授权已核对的现有会话', chat.draft.allowConversationOnly, value => { existingAuthorization.current = value; chat.edit({ allowConversationOnly: value, ...(!value ? { recipientIds: chat.draft.recipientIds.filter(id => shownContacts.some(item => item.id === id && item.followed === true && item.isGroup === false)) } : {}) }, value ? { blurOnly: true } : { immediate: true }); }),
          ...[false, true, null].flatMap(kind => { const items = shownContacts.filter(item => item.isGroup === kind || kind === null && typeof item.isGroup !== 'boolean'); return items.length ? [note(kind === false ? '个人会话' : kind === true ? '群聊（仅被 @ 或叫到响应昵称时回复）' : '旧记录类型待核对（暂不可选）'), ...items.map(item => h('label', { key: item.id, style: row }, h('input', { type: 'checkbox', 'aria-label': `许可联系人 ${item.name || item.displayName || '联系人'}`, checked: chat.draft.recipientIds.includes(item.id), disabled: !ready, onChange: event => { const checked = event.target.checked; const needsAuthorization = checked && typeof item.isGroup === 'boolean' && !(item.followed === true && item.isGroup === false); if (needsAuthorization && chat.draft.allowConversationOnly !== true) existingAuthorization.current = true; chat.edit({ recipientIds: checked ? [...new Set([...chat.draft.recipientIds, item.id])] : chat.draft.recipientIds.filter(id => id !== item.id), ...(needsAuthorization ? { allowConversationOnly: true } : {}) }, { immediate: true }); } }), item.name || item.displayName || '许可会话'))] : []; }),
          area('群聊响应昵称（逗号或换行分隔）', chat, 'groupMentionNamesText', 2, true), status(chat), note(`今日回复模型请求 ${state?.chat?.daily?.requests || 0} 次 · 今日分享 ${state?.share?.daily?.attempts || 0} 次。未确认发送会暂停，不自动重发。`), ...(state?.chat?.contacts || []).filter(item => item.identityReviewRequired === true || item.recovery?.requiresUserAction === true || /登录|验证码|未授权|许可.*(?:不足|失效|撤销)|身份.*(?:变化|不一致|未通过|不明|不足)/.test(item.reason || '') || ['paused', 'delivery-uncertain'].includes(item.status) && !(item.recovery?.autoPendingCount > 0 || item.recovery?.autoRetryCount > 0)).map(item => h('div', { key: item.id }, note(item.reason || '该会话暂缓处理，状态会继续更新。'), item.identityReviewRequired === true && note('请重新读取联系人并确认许可名单；身份未通过前不会发送。'))), ...(state?.share?.unavailableRecipients || []).map(item => note(`暂不能自主分享：${item.name || '许可会话'} · ${item.reason}`)), h('div', { style: row }, h('select', { 'aria-label': '转发目标会话', style: formControl, value: forward.recipientId, onChange: event => setForward(value => ({ ...value, recipientId: event.target.value })) }, h('option', { value: '' }, '选择转发目标（先点“读取联系人与群聊”）'), ...(contacts || []).filter(item => typeof item.isGroup === 'boolean').map(item => h('option', { key: item.id, value: item.id }, item.name || item.displayName || item.id))), h('input', { 'aria-label': '转发作品链接', placeholder: '可选：抖音 video 链接，留空转当前作品', style: formControl, value: forward.url, onChange: event => setForward(value => ({ ...value, url: event.target.value })) })), button('转发作品', 'forward', () => { void perform('forward', async () => { if (!forward.recipientId) throw new Error('请先选择转发目标会话。'); const payload = { recipientId: forward.recipientId, ...(forward.url.trim() ? { url: forward.url.trim() } : {}) }; const result = await api.request('/forward', payload); setForward(value => ({ ...value, url: '' })); return result; }); }, !ready || busy.has('forward')), note('点击“转发作品”即视为你本人授权：转发当前正在看的作品，或上方填写的公开链接；目标仅限已读取到的许可会话。'),
          h('div', { style: column }, field('每日分享上限（1 到 50 次）', shareLimit, 'dailyLimit', { type: 'number', min: 1 }), status(shareLimit), note(`今日已分享 ${state?.share?.daily?.attempts || 0} 次，上限 ${state?.share?.dailyLimit ?? 10} 次。分享不用人工逐条核对：插件会自行收尾旧记录，只有仍在发送的锁定才继续等待。`)),
          ...reviewList('share'), h('details', null, h('summary', null, '回复处理记录'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, JSON.stringify({ recovery: state?.chat?.recovery, contacts: (state?.chat?.contacts || []).map(item => ({ id: item.id, status: item.status, reason: item.reason, recovery: item.recovery, pending: Boolean(item.pending), unanswered: item.unanswered?.length || 0 })), events: state?.chat?.events || [] }, null, 2))), h('details', null, h('summary', null, '最近分享记录'), ...(state?.share?.recent || []).slice().reverse().map(item => h('div', { key: item.operationId }, note(`作品 ${item.videoId} · ${state?.share?.inProgress && state.share.activity?.operationId === item.operationId ? '正在分享' : ({ confirmed: '已确认送达', 'not-sent': '未发出', uncertain: '送达未确认', reserved: '已预留，待核对', clicking: '处理中，待核对', 'resolved-confirmed': '人工已确认送达', 'resolved-not-sent': '人工已确认未送达' }[item.status] || item.status)}`), shareFailureMessage(item) && note(`原因：${shareFailureMessage(item)}`))))),
        category === '公开评论' && section('自主公开视频评论', toggle('允许自主发布评论', comments.draft.enabled, value => comments.edit({ enabled: value }, { immediate: true })), field('评论每日尝试上限', comments, 'dailyLimit', { type: 'number', min: 1 }), field('评论每次观看尝试上限', comments, 'perSessionLimit', { type: 'number', min: 1 }), status(comments), note(`今日已尝试 ${state?.comments?.daily?.attempts || 0} 次。`), ...reviewList('comments')),
        category === '音频与密钥' && h('div', null,
          section('语音与唱歌',
            note('说话和唱歌是两条独立通道，各自可以填地址、模型、音色和 Key。默认指向 Boson Higgs TTS（接口 /audio/speech）。'),
            select('说话音色', voice.draft.speechVoice, [['', '请选择音色'], ...((state?.voice?.presets || []).map(item => [item.id, item.label]))], value => voice.edit({ speechVoice: value }, { immediate: true }), operationActive),
            field('说话模型', voice, 'speechModel', { placeholder: 'higgs-tts-3' }),
            field('说话接口地址', voice, 'speechBaseUrl', { placeholder: 'https://api.boson.ai/v1' }),
            h('label', { style: column }, '说话 Key', h(Input, { 'aria-label': '说话 Key', type: 'password', autoComplete: 'off', maxLength: 4096, value: voiceKeys.speech, disabled: !ready || operationActive || busy.has('key:speech'), onChange: event => setVoiceKeys(old => ({ ...old, speech: event.target.value })), onBlur: () => { const secret = String(voiceKeys.speech || '').trim(); if (!secret) return; void perform('key:speech', async () => { const result = await api.request('/voice/credentials', { channel: 'speech', apiKey: secret }); setVoiceKeys(old => ({ ...old, speech: '' })); return result; }); } })),
            note(state?.voice?.speech?.keyConfigured ? '说话 Key 已保存，不回显。' : '填写 Key，离开输入框后保存。'),
            select('唱歌音色', voice.draft.singVoice, [['', '请选择音色'], ...((state?.voice?.presets || []).map(item => [item.id, item.label]))], value => voice.edit({ singVoice: value }, { immediate: true }), operationActive),
            field('唱歌模型', voice, 'singModel', { placeholder: 'higgs-tts-3' }),
            field('唱歌接口地址', voice, 'singBaseUrl', { placeholder: 'https://api.boson.ai/v1' }),
            h('label', { style: column }, '唱歌 Key', h(Input, { 'aria-label': '唱歌 Key', type: 'password', autoComplete: 'off', maxLength: 4096, value: voiceKeys.sing, disabled: !ready || operationActive || busy.has('key:sing'), onChange: event => setVoiceKeys(old => ({ ...old, sing: event.target.value })), onBlur: () => { const secret = String(voiceKeys.sing || '').trim(); if (!secret) return; void perform('key:sing', async () => { const result = await api.request('/voice/credentials', { channel: 'sing', apiKey: secret }); setVoiceKeys(old => ({ ...old, sing: '' })); return result; }); } })),
            note(state?.voice?.sing?.keyConfigured ? '唱歌 Key 已保存，不回显。' : '填写 Key，离开输入框后保存。'),
            toggle('允许在私信里发语音', voice.draft.sendVoice, value => voice.edit({ sendVoice: value }, { immediate: true })),
            status(voice),
            h('label', { style: column }, '试听文字', h(Input, { 'aria-label': '试听文字', value: voiceTestText, onChange: event => setVoiceTestText(event.target.value) })),
            h('div', { style: row },
              button('试用说话音色', 'voiceSpeech', () => { void perform('voiceSpeech', async () => { const v = await api.request('/voice/synth', { channel: 'speech', text: String(voiceTestText || '').trim() || '主人，我是大肥鱼，今天也要开心呀。' }); setVoiceResult(v); return v; }); }, busy.has('voiceSpeech')),
              button('试用唱歌音色', 'voiceSing', () => { void perform('voiceSing', async () => { const v = await api.request('/voice/synth', { channel: 'sing', text: String(voiceTestText || '').trim() || '一闪一闪亮晶晶，满天都是小星星。' }); setVoiceResult(v); return v; }); }, busy.has('voiceSing'))),
            voiceResult && h('div', { style: { ...column }, role: 'status' }, note('已生成：' + voiceResult.name + '（' + Math.round((voiceResult.bytes || 0) / 1024) + ' KB · ' + voiceResult.voice + '）'), note('本机路径：' + voiceResult.file)),
            note('生成的音频保存在本机 state/voice 目录。私信里直接发语音还需要页面适配，确认后再开启。')
          )
        ) ||
        category === '音频与密钥' && section('可选音频', toggle('读取视频声音', media.draft.enabled, value => media.edit({ enabled: value }, { immediate: true })), select('音频后端', media.draft.backend, [['local-whisper', '本机 Whisper'], ['mimo', 'MiMo'], ['minimax', 'MiniMax']], value => media.edit({ backend: value }, { immediate: true })), status(media), note('Key 离开输入框后保存；保存 Key 不会开启音频或下载模型。'), credentialForm('mimo', 'MiMo'), credentialForm('minimax', 'MiniMax')),
        category === '观看日报' && section('观看日报', note(state?.reports?.folder), button('生成今天日报', 'reportGenerate', () => { void perform('reportGenerate', async () => { const value = await api.request('/reports/generate', {}); setReport(value); return value; }); }), h('label', { style: column }, '日报日期', h('input', { type: 'date', 'aria-label': '日报日期', style: formControl, value: reportDate, onChange: event => setReportDate(event.target.value) })), button('读取所选日报', 'reportRead', () => { void perform('reportRead', async () => { if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error('请选择有效日期。'); const value = await api.request(`/reports/read?date=${reportDate}`); setReport(value); return value; }); }), report && h('pre', { 'aria-label': '日报内容', style: { whiteSpace: 'pre-wrap' } }, report.markdown || '暂无内容')),
        category === '作品互动' && h('div', null,
          section('点赞 · 收藏 · 评论',
            h('label', { style: column }, '作品链接或 ID', h(Input, { 'aria-label': '作品链接或 ID', value: interact.videoId, placeholder: 'https://www.douyin.com/video/7694290986088974970 或纯数字', onChange: event => setInteract(old => ({ ...old, videoId: event.target.value })) })),
            h('label', { style: column }, '评论内容（留空只点赞收藏）', h('textarea', { 'aria-label': '评论内容', rows: 2, maxLength: 300, value: interact.comment, style: formControl, onChange: event => setInteract(old => ({ ...old, comment: event.target.value })) })),
            h('div', { style: row }, h('label', { style: row }, h('input', { type: 'checkbox', 'aria-label': '点赞', checked: interact.like, onChange: event => setInteract(old => ({ ...old, like: event.target.checked })) }), '点赞'), h('label', { style: row }, h('input', { type: 'checkbox', 'aria-label': '收藏', checked: interact.collect, onChange: event => setInteract(old => ({ ...old, collect: event.target.checked })) }), '收藏')),
            h('div', { style: row },
              button('从可回复名单读取', 'mentionRead', () => { void perform('mentionRead', async () => {
                const id = String(interact.videoId).match(/(\d{10,})/);
                const result = await api.request('/comment/mentions', { ...(id ? { videoId: id[1] } : {}) });
                setMentionCandidates(result.candidates || []);
                if (!(result.candidates || []).length) throw new Error('可回复名单和评论区都没读到可 @ 的人，请先在「好友互动」读取并勾选联系人。');
                return result;
              }); }, busy.has('mentionRead')),
              button('保存为可 @ 名单', 'atSave', () => { void perform('atSave', async () => {
                if (!atTargets.length) throw new Error('请先勾选至少一个可 @ 的人。');
                const result = await api.request('/comment/at-targets', { names: atTargets });
                setAtTargetsDraft(null); return result;
              }); }, !ready || !atTargets.length)),
            mentionCandidates && mentionCandidates.length > 0 && h('div', { style: column },
              note('勾选后保存为「可 @ 名单」；只有名单里的昵称才允许出现在评论的 @ 后面。候选默认来自可回复名单。'),
              ...mentionCandidates.map(item => h('label', { key: item.name, style: row },
                h('input', { type: 'checkbox', 'aria-label': `允许 @ ${item.name}`, checked: atTargets.includes(item.name), disabled: !ready, onChange: event => setAtTargetsDraft(event.target.checked ? [...new Set([...atTargets, item.name])] : atTargets.filter(name => name !== item.name)) }),
                `${item.name}${item.role === 'author' ? '（作者）' : ''}`))),
            h('label', { style: column }, '这次评论 @ 谁（可不选）',
              h('select', { 'aria-label': '评论 @ 对象', style: formControl, value: mentionPick, disabled: !ready || operationActive, onChange: event => setMentionPick(event.target.value) },
                h('option', { value: '' }, atTargets.length ? '不 @ 任何人' : '先“读取可 @ 的人”并保存名单'),
                ...atTargets.map(name => h('option', { key: name, value: name }, `@${name}`))),
              atTargets.length > 0 && note(`已保存的可 @ 名单：${atTargets.join('、')}`)),
            h('div', { style: row },
              button('检查当前页面能否互动', 'interactCheck', () => { void perform('interactCheck', async () => { const result = await api.request('/interact/check', {}); setInteractResult({ check: result }); return result; }); }, busy.has('interactCheck')),
              button('执行点赞收藏评论', 'interact', () => { void perform('interact', async () => { const id = String(interact.videoId).match(/(\d{10,})/); if (!id) throw new Error('请填写作品链接或 ID。'); const result = await api.request('/interact', { videoId: id[1], comment: interact.comment.trim(), like: interact.like, collect: interact.collect, ...(mentionPick ? { atName: mentionPick } : {}) }); setInteractResult(result); return result; }); }, busy.has('interact')),
              button('只发评论', 'comment', () => { void perform('comment', async () => { const id = String(interact.videoId).match(/(\d{10,})/); if (!id) throw new Error('请填写作品链接或 ID。'); if (!interact.comment.trim()) throw new Error('请填写评论内容。'); const result = await api.request('/comment', { videoId: id[1], text: interact.comment.trim(), ...(mentionPick ? { atName: mentionPick } : {}) }); setInteractResult(result); return result; }); }, busy.has('comment'))),
            note('点赞、收藏、评论三条分别核对：点赞数变化 / 收藏弹层 / 评论输入框清空。任一条未确认会在下方列出。'),
            interactResult?.check && h('div', { style: column, role: interactResult.check.ok ? 'status' : 'alert' },
              note(`页面：${interactResult.check.page || '—'}`),
              interactResult.check.video && note(`作品 ${interactResult.check.video.id}${interactResult.check.video.author ? ` · 作者 ${interactResult.check.video.author}` : ''}`),
              note(`互动按钮：${interactResult.check.railFound ? `已找到（${(interactResult.check.buttons || []).filter((v, i, a) => a.indexOf(v) === i).join(' / ')}）${interactResult.check.inViewport ? '，在可视区内' : '，需要滚动'} ` : '未找到'}`),
              note(interactResult.check.ok ? '当前可以正常互动。' : `当前不能互动：${interactResult.check.reason || interactResult.check.hint || '原因未知'}`)),
            interactResult && h('div', { style: column, role: 'status' },
              note(`作品 ${interactResult.videoId || ''}${interactResult.video?.author ? ` · 作者 ${interactResult.video.author}` : ''}`),
              interactResult.like && note(`点赞：${interactResult.like.liked ? '已确认' : '未确认'}（${interactResult.like.before ?? '?'} → ${interactResult.like.after ?? '?'}）`),
              interactResult.collect && note(`收藏：${interactResult.collect.dialog ? '已弹出收藏夹，需选择分组' : '已点击收藏'}${interactResult.collect.before ? `（原 ${interactResult.collect.before}）` : ''}`),
              (interactResult.comment || interactResult.after) && note(`评论：${(interactResult.comment?.ok ?? interactResult.ok) ? '已发布' : '未确认'}${(interactResult.comment?.text || interactResult.text) ? `「${interactResult.comment?.text || interactResult.text}」` : ''}`),
              interactResult.collect?.dialog && note(`收藏夹提示：${interactResult.collect.dialog.txt}`))),
          section('分享给好友',
            h('div', { style: row },
              button('读取可分享好友', 'shareRead', () => { void perform('shareRead', async () => {
                // 先读抖音当前会话列表刷新许可名单，再回读状态拿可分享候选。
                const result = await api.request('/chat/contacts', {});
                if (result.blocked || result.loginRequired || result.verificationRequired || !Array.isArray(result.contacts)) throw new Error('请在专用浏览器完成登录或验证后再读取。');
                setContacts(result.contacts); setDiscovery(result.listDiscovery || null); setShareAllowedDraft(null);
                return result;
              }); }, operationActive),
              button('保存分享好友许可', 'shareSave', () => { void perform('shareSave', async () => {
                const result = await api.request('/share/recipients', { recipientIds: shareAllowedIds });
                setShareAllowedDraft(null); return result;
              }); }, !ready || operationActive || !shareCandidates.length),
              button('清空名单（= 全部允许）', 'shareClear', () => { void perform('shareClear', async () => {
                const result = await api.request('/share/recipients/clear', {});
                setShareAllowedDraft(null); return result;
              }); }, operationActive)),
            !shareCandidates.length && note('还没有可分享的会话。先点上方「读取可分享好友」，或在「好友互动」里读取联系人与群聊并保存许可名单。'),
            shareCandidates.length > 0 && note(`当前许可名单里 ${shareCandidates.length} 个会话，可分享 ${shareCandidates.filter(item => item.sharable === true).length} 个。勾选下面这些决定「允许分享给谁」；清空后按全部允许处理。`),
            ...shareCandidates.map(item => h('label', { key: item.id, style: row },
              h('input', {
                type: 'checkbox', 'aria-label': `允许分享给 ${item.name || '会话'}`,
                checked: shareAllowedIds.includes(item.id),
                disabled: !ready || item.sharable !== true,
                onChange: event => setShareAllowedDraft(event.target.checked ? [...new Set([...shareAllowedIds, item.id])] : shareAllowedIds.filter(id => id !== item.id)),
              }),
              `${item.name || item.id}${item.isGroup ? '（群聊）' : ''}${item.sharable === true ? '' : ' · 缺少稳定会话身份，不能分享'}`)),
            h('label', { style: column }, '分享给（从这个列表里选）',
              h('select', { 'aria-label': '分享目标', style: formControl, value: shareTo.recipientName, disabled: !ready || operationActive, onChange: event => setShareTo(old => ({ ...old, recipientName: event.target.value })) },
                h('option', { value: '' }, shareCandidates.length ? '请选择接收好友' : '先点“读取可分享好友”'),
                ...shareCandidates.filter(item => item.sharable === true).map(item => h('option', { key: item.id, value: item.name }, item.name || item.id)))),
            h('label', { style: column }, '作品链接或 ID（留空用当前页）', h(Input, { 'aria-label': '分享作品链接', value: shareTo.videoId, placeholder: '留空表示分享当前正在看的作品', onChange: event => setShareTo(old => ({ ...old, videoId: event.target.value })) })),
            button('分享作品', 'shareTo', () => { void perform('shareTo', async () => { if (!shareTo.recipientName.trim()) throw new Error('请先选择接收好友。'); const id = String(shareTo.videoId).match(/(\d{10,})/); const result = await api.request('/share', { recipientName: shareTo.recipientName.trim(), ...(id ? { videoId: id[1] } : {}) }); setShareResult(result); return result; }); }, busy.has('shareTo')),
            note('分享以“面板关闭 + 会话列表预览出现分享卡片”双信号确认，不依赖会失败的全量身份回读。分享给别人后会在「主人通知」里留一条记录。'),
            shareResult && h('div', { style: column, role: 'status' }, note(`分享：${shareResult.sent ? '已发送' : '未确认'} → ${shareResult.recipient}`), shareResult.preview && note(`会话预览：${shareResult.preview}`))),
          section('查看主页作品',
            h('div', { style: row }, field('用户 ID（填 self 表示本人）', { draft: profileQuery, edit: patch => setProfileQuery(old => ({ ...old, ...patch })), status: { message: '' } }, 'userId'), button('查看主页', 'profile', () => { void perform('profile', async () => { const result = await api.request('/profile', { userId: profileQuery.userId.trim() || 'self' }); setProfileData(result); return result; }); }, busy.has('profile'))),
            profileData && h('div', { style: column, role: 'status' },
              note(`${profileData.name || '未读到昵称'}${profileData.douyinId ? ` · 抖音号 ${profileData.douyinId}` : ''}`),
              note(`粉丝 ${profileData.fans || '—'} · 获赞 ${profileData.likes || '—'} · 作品 ${profileData.postCount} 条`),
              ...(profileData.posts || []).slice(0, 8).map(item => h('div', { key: item.id, style: row }, h('span', { style: muted }, `${item.id}`), h('span', null, item.title || (item.type === 'note' ? '图文' : '视频')), h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !ready || busy.has('interact'), onClick: () => { setInteract(old => ({ ...old, videoId: item.id })); setNotice(`已把作品 ${item.id} 填入上方互动区。`); } }, '填入互动区'))))),
          section('发布作品',
            h('label', { style: column }, '本机视频文件路径', h(Input, { 'aria-label': '视频文件路径', value: publish.draft.filePath, placeholder: '例如 D:\\videos\\my.mp4', onChange: event => publish.edit({ filePath: event.target.value }) })),
            h('label', { style: column }, '作品说明（标题）', h('textarea', { 'aria-label': '作品说明', rows: 2, maxLength: 500, value: publish.draft.title, style: formControl, onChange: event => publish.edit({ title: event.target.value }, { blurOnly: true }), onBlur: () => { void publish.flush(); } })),
            h('label', { style: column }, '话题（逗号分隔，不用写 #）', h(Input, { 'aria-label': '话题', value: publish.draft.tagsText, placeholder: '例如 日常,vlog', onChange: event => publish.edit({ tagsText: event.target.value }, { blurOnly: true }), onBlur: () => { void publish.flush(); } })),
            h('div', { style: row },
              button('检查发布通道', 'publishStatus', () => { void perform('publishStatus', async () => { const result = await api.request('/publish/status', {}); setPublishResult({ status: result }); return result; }); }, busy.has('publishStatus')),
              button('上传并填好（不发布）', 'publishDry', () => { void perform('publishDry', async () => { const path = publish.draft.filePath.trim(); if (!path) throw new Error('请填写本机视频文件路径。'); const result = await api.request('/publish', { filePath: path, title: publish.draft.title, tags: list(publish.draft.tagsText), dryRun: true }); setPublishResult(result); return result; }); }, busy.has('publishDry')),
              button('上传并发布', 'publishReal', () => { void perform('publishReal', async () => { const path = publish.draft.filePath.trim(); if (!path) throw new Error('请填写本机视频文件路径。'); const result = await api.request('/publish', { filePath: path, title: publish.draft.title, tags: list(publish.draft.tagsText), dryRun: false }); setPublishResult(result); return result; }); }, busy.has('publishReal'))),
            note('发布走创作者中心上传页，需要专用浏览器已登录抖音创作者中心。建议先用"上传并填好（不发布）"确认内容无误，再点发布。'),
            publishResult?.status && h('div', { style: column, role: publishResult.status.ok ? 'status' : 'alert' }, note(`发布通道：${publishResult.status.ok ? '可用' : '不可用'} · ${publishResult.status.page || ''}`), !publishResult.status.ok && note(publishResult.status.reason || '')),
            publishResult && !publishResult.status && h('div', { style: column, role: publishResult.published ? 'status' : 'alert' },
              note(publishResult.dryRun ? '已上传并填好说明，未点击发布。' : publishResult.published ? '已点击发布并核对到成功信号。' : '未确认发布结果，请到创作者中心核对。'),
              publishResult.steps?.titleFilled && note(`已填说明：${publishResult.steps.titleFilled}`),
              publishResult.timings && note(`耗时：等待上传页 ${publishResult.timings['等待上传页'] ?? '—'} ms · 上传处理 ${publishResult.timings['等待上传处理'] ?? '—'} ms · 总计 ${publishResult.timings['总计'] ?? '—'} ms`)),
            note(state?.publish?.lastError || ''))),
        category === '自检与用量' && section('自检与用量', button('一键自检', 'diagnostics', () => { void perform('diagnostics', async () => { const value = await api.request('/diagnostics', {}); setDiagnostics(value); setRepairResult(''); return value; }); }), diagnostics && h('div', { style: column }, ...(diagnostics.checks || []).map(item => h('div', { key: item.id }, note(`${({ pass: '通过', warning: '待核对', fail: '未通过' })[item.status]} · ${item.label}：${item.message} [${item.code || ''}]`), ...(item.resolution?.steps || []).map(step => note(step)))), ...(diagnostics.repairableActions || []).map(action => button(`修复：${action.label}`, 'diagnostics', () => { void perform('diagnostics', async () => { const value = await api.request('/diagnostics/repair', { reportId: diagnostics.reportId, action: action.id }); setDiagnostics(value.after); setRepairResult(value.message); return value; }); })), note(repairResult), h('details', null, h('summary', null, '查看或复制诊断报告'), h('textarea', { 'aria-label': '诊断报告', readOnly: true, rows: 12, style: formControl, value: JSON.stringify(diagnostics, null, 2) }))), h('h3', null, '今日用量'), note(`模型响应 ${state?.usage?.today?.requests || 0} 次 · 已报告 ${state?.usage?.today?.totalTokens || 0} Token`), note(`输入 ${state?.usage?.today?.promptTokens || 0} · 输出 ${state?.usage?.today?.completionTokens || 0} · 缓存命中 ${state?.usage?.today?.cacheReportedRequests ? state.usage.today.cachedTokens : '未报告'} · 用量未知 ${state?.usage?.today?.unknownRequests || 0} 次`), state?.usage?.inFlight > 0 && note(`请求中 ${state.usage.inFlight} 次，Token 等模型返回后记录。`), ...(state?.usage?.groups || []).map(item => note(`${item.model} · ${item.requests} 次响应 · ${item.totalTokens} Token`)), note(state?.usage?.note))
      );
    }

    function apply(ctx) {
      let rpc;
      try { rpc = (ctx.get?.('connection') || ctx.connection)?.rpc; } catch {}
      const Page = rpc ? () => h(SettingsPage, { rpc }) : SettingsPage;
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'douyin-browser', order: 16, label: () => '刷抖音' }, Page));
    }
    return { name: 'douyin-browser-settings', inject: ['slots', 'connection'], apply, SettingsPage, createSettingsTransport };
  },
});
