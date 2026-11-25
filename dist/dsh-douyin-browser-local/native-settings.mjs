import { interactionStatus } from './interaction-status.mjs';
import { SETTINGS_SECTIONS } from './settings-sections.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { UsageLedger } from './usage-ledger.mjs';
import { WatchOptions } from './watch-options.mjs';
import { DiagnosticsService } from './diagnostics.mjs?v=18';
import { resolveRuntimePaths } from './runtime-paths.mjs';
import { InteractionService } from './interaction-service.mjs';
import { OwnerSettings } from './owner-settings.mjs';
import { OwnerNotifier } from './owner-notify.mjs';
import { VoiceSettings } from './voice-settings.mjs';
import { SpeechClient } from './speech-client.mjs';

const PREFIX = '/api/douyin-browser';
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('只接收JSON设置。'), { status: 400 });
  let size = 0; const chunks = []; for await (const bytes of req) { size += bytes.length; chunks.push(bytes); if (size > 262_144) throw Object.assign(new Error('设置请求过长。'), { status: 413 }); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0; return value; } catch { throw Object.assign(new Error('设置必须是JSON对象。'), { status: 400 }); }
}
const empty = value => { if (Object.keys(value).length) throw Object.assign(new Error('此操作不接收参数。'), { status: 400 }); };
const active = state => Boolean(state?.running || state?.starting || state?.busy || state?.worker?.alive);
const chatBusy = state => Boolean(state?.starting || state?.busy || state?.contacts?.some(item => item.pending?.phase === 'model'));

// 复用 DSH 原生 WebServer 和设置页插槽，不启动独立软件或第二个端口。
export function createNativeSettingsRoute({ getController, getComments, getReport, getSpark, getWatch, getMode, getShare, getChat, getMedia, getFriends, modelSettings, configureMode, startWatch, startSpark, startChat, watchSchedule, getDiagnostics, proactive, notifier: injectedNotifier } = {}) {
  const token = randomBytes(32).toString('hex');
  let diagnostics, owner, notifier, voice;
  return { kind: 'prefix', path: PREFIX, async handler(req, res) {
    try {
      const host = req.headers.host;
      if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return send(res, 403, { error: '设置页只接受本机来源。' });
      const origin = `${req.socket?.encrypted ? 'https' : 'http'}://${host}`, url = new URL(req.url, origin);
      if (url.origin !== origin || req.headers.origin && req.headers.origin !== origin || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(res, 403, { error: '拒绝跨来源设置请求。' });
      const controller = await getController();
      const stateDir = controller.limits().stateDir ?? resolveRuntimePaths().stateDir, usageLedger = new UsageLedger({ stateDir }), optionsService = new WatchOptions({ stateDir });
      notifier = injectedNotifier ?? notifier ?? new OwnerNotifier({ stateDir, getOwner: () => (owner ??= new OwnerSettings({ stateDir })).state() });
      voice ??= new VoiceSettings({ stateDir });
      const interactions = new InteractionService({ stateDir, getController, notifier });
      if (!url.pathname.startsWith(`${PREFIX}/diagnostics`)) for (const getter of [getChat]) if (getter) { const service = await getter(); if (service.agent) { service.agent.usageLedger = usageLedger; service.agent.source = 'dsh'; } }
      if (req.method === 'GET' && url.pathname === `${PREFIX}/state`) {
        const [spark,comments,reports,watch,chat,share,friends] = await Promise.all([getSpark?.(),getComments(),getReport(),getWatch(),getChat?.(),getShare?.(),getFriends?.()]);
        const chatState=chat?.state()||{}, watchState=watch.state(), shareState=share?.state()||{}, commentsState=comments.state(), video=controller.limits().state();
        const pendingWatch=watchState.pendingRequests||0,pendingChat=(chatState.contacts||[]).filter(item=>item.pending?.phase==='model').length;
        const usage={...usageLedger.state(),checkedAt:new Date().toISOString(),inProgress:{watch:pendingWatch,chat:pendingChat,total:pendingWatch+pendingChat},videoDaily:video.daily||null};
        return send(res,200,{token,schedule:watchSchedule?.state(),interactions:interactionStatus({friend:friends?.state(),chat:chatState,share:shareState,comments:commentsState,watch:watchState,modelReady:modelSettings.state().configured}),sections:SETTINGS_SECTIONS,usage,watchOptions:optionsService.state(),video,spark:spark?.state()||{enabled:false},comments:commentsState,reports:await reports.state(),persona:controller.getPersonaMemory().snapshot(),mode:(await getMode()).state(),model:typeof modelSettings.catalog==='function'?await modelSettings.catalog():modelSettings.state(),watch:watchState,...(share?{share:shareState}:{}),...(chat?{chat:chatState}:{}),...(getMedia?{media:await(await getMedia()).status()}:{}),setup:{browser:'Microsoft Edge',audioOptional:true,independentAppRequired:false,model:'可使用 DSH 已配置提供商，也可在设置页自己填写接口地址、模型和 API Key；可选音频 Key 单独保存。'},notify:(()=>{try{return notifier?notifier.state():null;}catch{return null;}})(),voice:(()=>{try{return (voice ??= new VoiceSettings({ stateDir })).state();}catch{return null;}})(),proactive:(()=>{try{return proactive?proactive.state():null;}catch{return null;}})(),owner:(owner ??= new OwnerSettings({stateDir})).state()});
      }
      if (req.method === 'GET' && url.pathname === `${PREFIX}/reports/read`) return send(res, 200, await (await getReport()).read({ date: url.searchParams.get('date') }));
      if (req.method === 'GET' && url.pathname === `${PREFIX}/chat/unanswered`) {
        const supplied = req.headers['x-douyin-settings-token'];
        if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return send(res, 403, { error: '请刷新原生设置页后重试。' });
        return send(res, 200, await (await getChat()).unanswered());
      }
      if (req.method !== 'POST') return send(res, 404, { error: '设置地址不存在。' });
      const supplied = req.headers['x-douyin-settings-token'];
      if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return send(res, 403, { error: '请刷新原生设置页后重试。' });
      const input = await body(req); let value;
      // 手动评论的 @：只认已保存的 @ 名单，避免把任意昵称拼进正文当联系方式。
      const resolveAtName = async atName => {
        if (atName === undefined || atName === null || atName === '') return '';
        if (typeof atName !== 'string' || !/^[^\s@\u0000-\u001f\u007f]{1,40}$/u.test(atName)) throw Object.assign(new Error('@ 对象昵称无效。'), { status: 400 });
        const comments = await getComments();
        const targets = comments.state()?.policy?.atTargets || [];
        if (!targets.includes(atName)) throw Object.assign(new Error(`「${atName}」不在已保存的 @ 名单里，请先在设置页读取并勾选。`), { status: 400 });
        return atName;
      };
      // 改模型、改自定义接口或换 Key 都要先停下正在用模型的流程。
      const assertModelIdle = async () => {
        const spark = getSpark ? (await getSpark()).state() : null, chat = getChat ? (await getChat()).state() : null;
        if (active((await getWatch()).state()) || active(spark) || chatBusy(chat)) throw Object.assign(new Error('请先停止自主观看或等待正在处理的私信完成，再修改模型。'), { status: 409 });
      };
      switch (url.pathname.slice(PREFIX.length)) {
        case '/diagnostics':
        case '/diagnostics/repair': {
          const service = getDiagnostics ? await getDiagnostics() : diagnostics ??= new DiagnosticsService({ source: 'dsh', controller, modeService: await getMode(), modelConfigured: () => modelSettings.state().configured, videoLimits: controller.limits(), watchService: getWatch, watchSchedule, usageLedger, optionsService, paths: { ...resolveRuntimePaths(), stateDir } });
          if (url.pathname.endsWith('/repair')) value = await service.repair(input);
          else { empty(input); value = await service.run(); }
          break;
        }
        case '/watch/schedule': if(!watchSchedule) throw new Error('自动观看调度尚未加载。'); value=await watchSchedule.configure(input,{explicit:true}); if(input.enabled===false){await(await getWatch()).stop({explicit:true});controller.limits().endSession({explicit:true,reason:'允许自动观看已关闭。'});await controller.pauseForLimits?.();} else void watchSchedule.tick();break;
        case '/watch/options': value = optionsService.configure(input, { explicit: true }); break;
        case '/video/configure': value = controller.limits().savePolicy(input, { explicit: true }); break;
        case '/video/start': empty(input); if ((await getWatch()).state().running) throw Object.assign(new Error('请先停止自主观看，再开始新一轮。'), { status: 409 }); await controller.pauseForLimits?.(); value = controller.limits().markSession('dsh', { explicit: true }); break;
        case '/video/stop': empty(input); value = controller.limits().endSession({ explicit: true }); await controller.pauseForLimits?.(); break;
        case '/browser/open': empty(input); value = await controller.openBrowser(); break;
        case '/persona/configure': {
          if (Object.keys(input).some(key => !['content', 'expectedRevision'].includes(key))) throw Object.assign(new Error('人格设置只接收正文和读取版本。'), { status: 400 });
          if (active((await getWatch()).state()) || active((await getSpark()).state()) || getChat && chatBusy((await getChat()).state())) throw Object.assign(new Error('请先停止自主观看或等待正在处理的私信完成，再保存人格。'), { status: 409 });
          const persona = controller.getPersonaMemory();
          persona.saveManualText({ text: input.content, expectedRevision: input.expectedRevision }, { explicit: true });
          value = persona.initialize({ importLegacy: false }); break;
        }
        case '/interactions/configure': { if(!getFriends)throw new Error('好友互动模块尚未加载。');const friends=await getFriends();await friends.configure(input,{explicit:true});value=interactionStatus({friend:friends.state(),chat:(await getChat()).state(),share:(await getShare()).state(),comments:(await getComments()).state(),watch:(await getWatch()).state(),modelReady:modelSettings.state().configured});break; }
        case '/model/configure': {
          await assertModelIdle();
          value = await modelSettings.configure(input, { explicit: true, beforeCommit: assertModelIdle }); if(getFriends)await(await getFriends()).reconcile();break;
        }
        case '/model/endpoint': {
          await assertModelIdle();
          value = await modelSettings.configureEndpoint(input, { explicit: true, beforeCommit: assertModelIdle }); if(getFriends)await(await getFriends()).reconcile();break;
        }
        case '/model/credentials': {
          await assertModelIdle();
          value = await modelSettings.saveEndpointKey(input, { explicit: true, beforeCommit: assertModelIdle }); if(getFriends)await(await getFriends()).reconcile();break;
        }
        case '/model/endpoint/clear': {
          empty(input); await assertModelIdle();
          value = await modelSettings.clearEndpoint({ explicit: true, beforeCommit: assertModelIdle }); if(getFriends)await(await getFriends()).reconcile();break;
        }
        case '/mode/configure': value = await configureMode(input); break;
        case '/owner/configure': value = (owner ??= new OwnerSettings({ stateDir })).configure(input, { explicit: true }); break;
        case '/proactive/configure': if (!proactive) throw Object.assign(new Error('主动私信尚未就绪。'), { status: 503 }); value = proactive.configure(input, { explicit: true }); break;
        case '/proactive/tick': empty(input); if (!proactive) throw Object.assign(new Error('主动私信尚未就绪。'), { status: 503 }); value = await proactive.tick(); break;
        case '/watch/start': {
          if (Object.keys(input).some(key => key !== 'maxRequests')) throw Object.assign(new Error('自主观看只接收本轮请求上限。'), { status: 400 });
          value = await startWatch(input); break;
        }
        case '/watch/stop': empty(input); value = await (await getWatch()).stop({ explicit: true }); break;
        case '/spark/configure': if(input.enabled!==false)throw Object.assign(new Error('自动续火花功能已移除。'),{status:410});value = await (await getSpark()).configure(input, { explicit: true }); break;
        case '/spark/stop': empty(input); value = await (await getSpark()).stop({ explicit: true }); break;
        case '/spark/start': throw Object.assign(new Error('自动续火花功能已移除。'),{status:410});
        case '/spark/resolve': value = await (await getSpark()).resolve(input, { explicit: true }); break;
        case '/comments/configure': value = await (await getComments()).configure(input, { explicit: true }); break;
        case '/comments/resolve': value = await (await getComments()).resolve(input, { explicit: true }); break;
        case '/share/configure': if(getFriends){if(Object.keys(input).some(key=>!['enabled','dailyLimit','allowedRecipientIds'].includes(key)))throw Object.assign(new Error('好友互动只接受总开关、每日分享上限和分享好友名单。'),{status:400});await(await getFriends()).configure({enabled:input.enabled},{explicit:true});value=await(await getShare()).configure({enabled:input.enabled,...(input.dailyLimit!==undefined?{dailyLimit:input.dailyLimit}:{}),...(input.allowedRecipientIds!==undefined?{allowedRecipientIds:input.allowedRecipientIds}:{})},{explicit:true});}else value=await(await getShare()).configure(input,{explicit:true});break;
        case '/share/recipients': {
          // 设置页「允许分享给谁」：只接收当前许可名单里的会话 ID 列表，不接受昵称。
          if (!input || !Array.isArray(input.recipientIds)) throw Object.assign(new Error('分享好友许可需要会话 ID 列表。'), { status: 400 });
          if (Object.keys(input).some(key => key !== 'recipientIds')) throw Object.assign(new Error('分享好友许可只接收 recipientIds。'), { status: 400 });
          if (input.recipientIds.some(id => typeof id !== 'string' || !/^conv:[a-f0-9]{64}$/.test(id))) throw Object.assign(new Error('分享好友许可需要已核对的会话 ID。'), { status: 400 });
          value = await (await getShare()).setShareRecipients(input.recipientIds, { explicit: true });
          break;
        }
        case '/share/recipients/clear': {
          // 「清空」= 取消单独圈定，回到全部许可会话都可分享（不是「一个都不允许」）。
          // 想表达「一个都不允许」：不解勾选全部保存，得到空数组。
          empty(input);
          value = await (await getShare()).resetShareRecipients({ explicit: true });
          break;
        }
        case '/comment/mentions': {
          // 候选优先取「可回复名单」里的人（本机已知，必成功）；作品评论区只作补充，读不到不影响。
          if (Object.keys(input).some(key => key !== 'videoId')) throw Object.assign(new Error('读取 @ 名单只接收作品 ID。'), { status: 400 });
          const rawId = input.videoId === undefined || input.videoId === null ? '' : String(input.videoId);
          const digits = rawId.replace(/\D/g, '');
          if (rawId.trim() && !/^\d{1,64}$/.test(digits)) throw Object.assign(new Error('作品 ID 无效：请填纯数字作品 ID 或抖音作品链接。'), { status: 400 });
          const candidates = [], seen = new Set();
          const push = (name, role) => {
            const clean = String(name || '').replace(/^@/, '').trim();
            if (!clean || clean.length > 40 || /[\s@]/.test(clean) || seen.has(clean)) return;
            seen.add(clean); candidates.push({ name: clean, role });
          };
          let source = 'allowlist', mentionError = '';
          try {
            const chat = await getChat();
            for (const item of chat?.state?.()?.policy?.allowlist || []) push(item.name, 'allowlist');
          } catch (error) { mentionError = String(error?.message || error); }
          if (!candidates.length) {
            source = 'comments';
            try {
              const read = await interactions.readMentionCandidates({ videoId: digits || undefined });
              for (const item of read?.candidates || []) push(item.name, item.role || 'commenter');
            } catch (error) { mentionError = String(error?.message || error); }
          }
          if (!candidates.length) throw Object.assign(new Error('可回复名单和评论区都没读到可 @ 的人' + (mentionError ? '：' + mentionError : '，请先在「好友互动」读取并勾选联系人。')), { status: 409 });
          value = { protocol: 'mention-candidates-v1', source, videoId: digits || null, candidates };
          break;
        }
        case '/comment/at-targets': {
          if (!input || !Array.isArray(input.names)) throw Object.assign(new Error('评论 @ 名单需要昵称列表。'), { status: 400 });
          if (Object.keys(input).some(key => key !== 'names')) throw Object.assign(new Error('评论 @ 名单只接收 names。'), { status: 400 });
          value = await (await getComments()).setAtTargets(input.names, { explicit: true });
          break;
        }
        case '/notify/clear': empty(input); value = notifier.clear({ explicit: true }); break;
        case '/voice/state': empty(input); value = (voice ??= new VoiceSettings({ stateDir })).state(); break;
        case '/voice/configure': value = (voice ??= new VoiceSettings({ stateDir })).configure(input, { explicit: true }); break;
        case '/voice/credentials': {
          const settings = (voice ??= new VoiceSettings({ stateDir }));
          if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['channel', 'apiKey'].includes(key))) throw Object.assign(new Error('语音 Key 只接收通道和 Key。'), { status: 400 });
          value = input.apiKey === undefined || input.apiKey === ''
            ? settings.clearKey({ channel: input.channel, explicit: true })
            : settings.saveKey(input, { explicit: true });
          break;
        }
        case '/voice/synth': {
          const settings = (voice ??= new VoiceSettings({ stateDir }));
          if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['channel', 'text'].includes(key))) throw Object.assign(new Error('语音合成只接收通道和文字。'), { status: 400 });
          const keys = settings.keys();
          const client = new SpeechClient({ stateDir });
          value = await client.synthesize({ channel: input.channel, text: input.text, settings: { ...settings.read(), speechKey: keys.speech, singKey: keys.sing } });
          break;
        }
        case '/chat/canary': {
          // 立即跑一次页面结构自检：只读 DOM，不点按钮、不发消息。
          empty(input);
          const chat = await getChat();
          if (typeof chat?.runCanary !== 'function') throw Object.assign(new Error('当前私信服务还不支持结构自检，请重启 DSH 后再试。'), { status: 503 });
          value = await chat.runCanary({ ensure: true, force: true, signal: AbortSignal.timeout(30_000) });
          break;
        }
        case '/share/resolve': value = await (await getShare()).resolve(input, { explicit: true }); break;
        case '/chat/contacts': {
          empty(input);
          // 抖音会话列表在滚动时元数据会抖动，偶发一次读不全；自动重试两次，不让用户手动反复点。
          let attempt = 0, lastError;
          for (;;) {
            try { value = await (await getChat()).listContacts({ signal: AbortSignal.timeout(45_000) }); break; }
            catch (error) {
              lastError = error; attempt += 1;
              if (attempt >= 3 || !/读取列表期间会话身份发生变化|容器发生变化|会话列表容器已消失/.test(String(error?.message || ''))) throw error;
              await new Promise(resolve => setTimeout(resolve, 600));
            }
          }
          break;
        }
        case '/chat/unanswered/resolve': { if(!getFriends)throw Object.assign(new Error('好友互动模块尚未加载。'),{status:503});if(Object.keys(input).some(key=>!['recordIds','snapshot'].includes(key)))throw Object.assign(new Error('待处理消息只接收记录标识和当前快照。'),{status:400});const chat=await getChat();value={...await(await getFriends()).resolveUnanswered(input),unanswered:await chat.unanswered()};break; }
        case '/chat/configure': {
          if (Object.keys(input).some(key => !['recipientIds', 'dailyReplyLimit', 'allowConversationOnly', 'groupMentionNames'].includes(key))) throw Object.assign(new Error('私信设置只接收许可名单、每日上限、本人会话授权和群聊响应昵称。'), { status: 400 });
          value = getFriends?await(await getFriends()).configureContacts(input):await(await getChat()).configure(input);break;
        }
        case '/chat/start': empty(input);if(getFriends){await(await getFriends()).configure({enabled:true},{explicit:true});value=(await getChat()).state();}else value=await startChat();break;
        case '/chat/prepare': empty(input); if(!getFriends)throw Object.assign(new Error('好友互动模块尚未加载。'),{status:503}); value=await(await getFriends()).prepareChat(); break;
        case '/chat/stop': empty(input);if(getFriends){await(await getFriends()).configure({enabled:false},{explicit:true});value=(await getChat()).state();}else value=await(await getChat()).stop();break;
        case '/chat/resolve': if (Object.keys(input).length !== 1 || typeof input.recipientId !== 'string') throw Object.assign(new Error('只接受已核对的许可联系人。'), { status: 400 }); value = getFriends ? await (await getFriends()).resumeContact(input.recipientId) : await (await getChat()).resumeContact(input.recipientId); break;
        case '/forward': {
          // P1-5 能力补丁：DSH 设置页「转发作品」按钮 —— 本人点击按钮即 humanAuthorized，补上独立软件有而 DSH 缺的入口。
          if (!input || typeof input.recipientId !== 'string' || !/^conv:[a-f0-9]{64}$/.test(input.recipientId)) throw Object.assign(new Error('转发需要已核对的会话 ID。'), { status: 400 });
          if (Object.keys(input).some(key => !['recipientId', 'url'].includes(key))) throw Object.assign(new Error('转发只接收会话与公开作品链接。'), { status: 400 });
          if (input.url !== undefined && !/^https:\/\/(?:www\.)?douyin\.com\/video\/\d+\/?(?:\?[^#]*)?(?:#.*)?$/.test(input.url)) throw Object.assign(new Error('转发链接必须是抖音公开 video 链接。'), { status: 400 });
          value = await controller.execute('douyin_forward_video', { recipientId: input.recipientId, ...(input.url ? { url: input.url } : {}) }, { humanAuthorized: true });
          break;
        }
        case '/media/configure': {
          if (Object.keys(input).some(key => !['enabled', 'backend'].includes(key)) || typeof input.enabled !== 'boolean' || !['local-whisper', 'mimo', 'minimax'].includes(input.backend)) throw Object.assign(new Error('音频只接收开关和有效后端。'), { status: 400 });
          const media = await getMedia(); await media.saveSettings(input, { explicit: true }); value = await media.status(); break;
        }
        case '/publish/status': {
          empty(input);
          value = await interactions.publishStatus();
          break;
        }
        case '/publish': {
          // 发布作品：只接受本机视频路径 + 标题/话题；dryRun 时只上传不点发布。
          if (!input || typeof input.filePath !== 'string' || !input.filePath.trim()) throw Object.assign(new Error('发布需要本机视频文件路径。'), { status: 400 });
          const allowed = ['filePath', 'title', 'tags', 'dryRun', 'publish'];
          if (Object.keys(input).some(key => !allowed.includes(key))) throw Object.assign(new Error('发布只接收文件路径、标题、话题与发布开关。'), { status: 400 });
          if (input.title !== undefined && typeof input.title !== 'string') throw Object.assign(new Error('标题必须是文字。'), { status: 400 });
          if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(t => typeof t !== 'string'))) throw Object.assign(new Error('话题必须是文字数组。'), { status: 400 });
          if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') throw Object.assign(new Error('dryRun 必须是布尔值。'), { status: 400 });
          value = await interactions.publish({
            filePath: input.filePath,
            title: input.title || '',
            tags: input.tags || [],
            dryRun: input.dryRun === true,
            publish: input.publish !== false,
          });
          break;
        }
        case '/interact/check': {
          empty(input);
          value = await interactions.check();
          break;
        }
        case '/interact': {
          // DFY 互动：点赞 + 收藏 + 评论（设置页一键操作）
          if (!input || typeof input.videoId !== 'string' || !/^\d{10,}$/.test(input.videoId.replace(/\D/g, ''))) throw Object.assign(new Error('互动需要作品 ID 或链接。'), { status: 400 });
          const allowed = ['videoId', 'comment', 'like', 'collect', 'atName'];
          if (Object.keys(input).some(key => !allowed.includes(key))) throw Object.assign(new Error('互动只接收作品、评论内容、@ 对象与两个开关。'), { status: 400 });
          for (const key of ['like', 'collect']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw Object.assign(new Error('互动开关必须是布尔值。'), { status: 400 });
          if (input.comment !== undefined && (typeof input.comment !== 'string' || input.comment.length > 300)) throw Object.assign(new Error('评论内容必须是 300 字以内的文字。'), { status: 400 });
          const atName = await resolveAtName(input.atName);
          const commentText = atName ? `${input.comment || ''} @${atName}`.trim() : (input.comment || '');
          if (commentText.length > 300) throw Object.assign(new Error('加上 @ 之后超过 300 字，请缩短评论。'), { status: 400 });
          value = await interactions.interact({ videoId: input.videoId, comment: commentText, like: input.like !== false, collect: input.collect !== false });
          break;
        }
        case '/comment': {
          if (!input || typeof input.videoId !== 'string' || typeof input.text !== 'string') throw Object.assign(new Error('评论需要作品与文字。'), { status: 400 });
          if (Object.keys(input).some(key => !['videoId', 'text', 'atName'].includes(key))) throw Object.assign(new Error('评论只接收作品、文字与 @ 对象。'), { status: 400 });
          const atName = await resolveAtName(input.atName);
          const text = atName ? `${input.text} @${atName}`.trim() : input.text;
          if ([...text].length > 200) throw Object.assign(new Error('加上 @ 之后超过 200 字，请缩短评论。'), { status: 400 });
          value = await interactions.comment({ videoId: input.videoId, text });
          break;
        }
        case '/profile': {
          if (Object.keys(input).some(key => !['userId', 'url'].includes(key))) throw Object.assign(new Error('主页查询只接收用户标识或链接。'), { status: 400 });
          value = await interactions.profile({ userId: input.userId || 'self', url: input.url || '' });
          break;
        }
        case '/share': {
          if (!input || typeof input.recipientName !== 'string' || !input.recipientName.trim()) throw Object.assign(new Error('分享需要接收好友昵称。'), { status: 400 });
          if (Object.keys(input).some(key => !['videoId', 'recipientName'].includes(key))) throw Object.assign(new Error('分享只接收作品与好友昵称。'), { status: 400 });
          value = await interactions.share({ videoId: input.videoId, recipientName: input.recipientName });
          break;
        }
        case '/reports/generate': empty(input); value = await (await getReport()).generate({ reason: 'manual' }); break;
        case '/media/credentials': {
          if (!getMedia) throw Object.assign(new Error('音频设置尚未就绪。'), { status: 503 });
          if (active((await getWatch()).state()) || active((await getSpark()).state()) || getChat && chatBusy((await getChat()).state())) throw Object.assign(new Error('请先停止自主观看或等待正在处理的私信完成，再修改音频密钥。'), { status: 409 });
          value = await (await getMedia()).saveCredentials(input, { explicit: true }); break;
        }
        default: return send(res, 404, { error: '设置地址不存在。' });
      }
      return send(res, 200, value);
    } catch (error) { return send(res, error.code === 'PERSONA_REVISION_CONFLICT' ? 409 : Number.isInteger(error.status) ? error.status : error.code?.startsWith('PERSONA_') ? 400 : 500, { error: error.message || String(error) }); }
  } };
}

