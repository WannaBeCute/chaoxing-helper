/**
 * 超星辅助助手 - 隔离世界桥接层
 *
 * 负责把页面主世界（UI/编辑器）的请求转交给扩展环境：
 * - chrome.storage 读写设置与对话
 * - 后台 Service Worker 的 AI 请求与流式输出
 * - 打开设置页 / 跳转 Chaoxing 页面
 *
 * API Key 只存在扩展存储和后台，不会回传给页面主世界。
 */
(() => {
  'use strict';

  if (window.__CXH_BRIDGE_LOADED__) return;
  window.__CXH_BRIDGE_LOADED__ = true;

  const CHANNEL = 'cxh-v1';
  const SETTINGS_KEY = 'cxh_settings';
  const PREFS_KEY = 'cxh_prefs';
  const CHAT_INDEX_KEY = 'cxh_chat_index';
  const CHAT_PREFIX = 'cxh_chat_';
  const AI_PORT = 'cxh-ai';

  const DEFAULT_SETTINGS = {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
    supportsVision: true,
    contextWindow: 128000,
    extractEnabled: false,
    extractProvider: 'openai',
    extractEndpoint: 'https://api.openai.com/v1',
    extractModel: 'gpt-4o-mini',
    extractApiKey: '',
    extractApiMode: 'auto',
    autoDeleteDays: 0,
  };

  const activePorts = new Map();
  let fontMapCache = '';

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: '扩展后台无响应' });
      });
    });
  }

  function escapeFallback(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
  }

  function renderMarkdown(text) {
    const raw = String(text || '');
    if (!raw) return '';
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      return escapeFallback(raw);
    }
    let html;
    try {
      html = marked.parse(raw, { gfm: true, breaks: true });
    } catch (error) {
      return escapeFallback(raw);
    }
    const template = document.createElement('template');
    template.innerHTML = html;
    if (typeof hljs !== 'undefined') {
      template.content.querySelectorAll('pre code').forEach((code) => {
        try {
          const cls = Array.from(code.classList).find((name) => name.startsWith('language-'));
          const lang = cls ? cls.slice('language-'.length) : '';
          const result = lang && hljs.getLanguage(lang)
            ? hljs.highlight(code.textContent, { language: lang })
            : hljs.highlightAuto(code.textContent);
          code.innerHTML = result.value;
          code.classList.add('hljs');
        } catch (error) {
          /* keep plain code */
        }
      });
    }
    const clean = DOMPurify.sanitize(template.innerHTML, {
      ADD_ATTR: ['target', 'rel'],
    });
    const container = document.createElement('div');
    container.innerHTML = clean;
    container.querySelectorAll('a').forEach((link) => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    });
    container.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) img.remove();
    });
    return container.innerHTML;
  }

  async function loadFontMapChunked() {
    if (fontMapCache) return fontMapCache;
    const chunkSize = 262144;
    const parts = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'cxh:fontMap', offset, size: chunkSize }, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      });
      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : '字体映射加载失败');
      }
      const text = response.text || '';
      parts.push(text);
      total = Number(response.total) || 0;
      if (!text) break;
      offset += text.length;
    }
    fontMapCache = parts.join('');
    return fontMapCache;
  }

  function post(message) {
    window.postMessage({ __cxh: CHANNEL, source: 'bridge', ...message }, '*');
  }

  function reply(requestId, ok, result, error) {
    post({ requestId, ok, result, error: error ? String(error.message || error) : undefined });
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result || {});
      });
    });
  }

  function storageSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  async function getSettingsRaw() {
    const result = await storageGet([SETTINGS_KEY]);
    return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  }

  function sanitizeSettings(settings) {
    const copy = { ...settings };
    copy.hasApiKey = !!copy.apiKey;
    copy.hasExtractApiKey = !!copy.extractApiKey;
    delete copy.apiKey;
    delete copy.extractApiKey;
    return copy;
  }

  function defaultPrefs() {
    return { mode: 'fill', vision: false, lastChatId: '' };
  }

  async function getPrefs() {
    const result = await storageGet([PREFS_KEY]);
    return { ...defaultPrefs(), ...(result[PREFS_KEY] || {}) };
  }

  async function setPrefs(patch) {
    const current = await getPrefs();
    const next = { ...current, ...(patch || {}) };
    await storageSet({ [PREFS_KEY]: next });
    return next;
  }

  async function getChatIndex() {
    const result = await storageGet([CHAT_INDEX_KEY]);
    const index = result[CHAT_INDEX_KEY];
    return Array.isArray(index) ? index : [];
  }

  function indexMeta(chat) {
    return {
      id: chat.id,
      title: chat.title || '未命名对话',
      boundUrl: chat.boundUrl || '',
      boundTitle: chat.boundTitle || '',
      createdAt: chat.createdAt || Date.now(),
      updatedAt: chat.updatedAt || Date.now(),
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    };
  }

  async function saveChatIndexEntry(meta) {
    const index = await getChatIndex();
    const next = index.filter((item) => item.id !== meta.id);
    next.unshift(meta);
    await storageSet({ [CHAT_INDEX_KEY]: next });
    return next;
  }

  async function listChats() {
    const index = await getChatIndex();
    return index.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function saveChat(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) throw new Error('对话数据无效');
    const chat = {
      id: String(raw.id),
      title: String(raw.title || '未命名对话').slice(0, 80),
      boundUrl: String(raw.boundUrl || ''),
      boundTitle: String(raw.boundTitle || ''),
      memory: String(raw.memory || ''),
      memoryUpdatedAt: Number(raw.memoryUpdatedAt) || 0,
      messages: Array.isArray(raw.messages) ? raw.messages.slice(-200) : [],
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
    await storageSet({ [CHAT_PREFIX + chat.id]: chat });
    await saveChatIndexEntry(indexMeta(chat));
    return indexMeta(chat);
  }

  async function getChat(id) {
    if (!id) throw new Error('缺少对话 ID');
    const result = await storageGet([CHAT_PREFIX + id]);
    return result[CHAT_PREFIX + id] || null;
  }

  async function renameChat(id, title) {
    const chat = await getChat(id);
    if (!chat) throw new Error('对话不存在');
    chat.title = String(title || '未命名对话').trim().slice(0, 80) || '未命名对话';
    chat.updatedAt = Date.now();
    await storageSet({ [CHAT_PREFIX + chat.id]: chat });
    await saveChatIndexEntry(indexMeta(chat));
    return indexMeta(chat);
  }

  async function deleteChat(id) {
    await storageRemove([CHAT_PREFIX + id]);
    const index = await getChatIndex();
    await storageSet({ [CHAT_INDEX_KEY]: index.filter((item) => item.id !== id) });
  }

  async function clearChats() {
    const all = await new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result || {});
      });
    });
    const keys = Object.keys(all).filter((key) => key.startsWith(CHAT_PREFIX));
    keys.push(CHAT_INDEX_KEY);
    if (keys.length) await storageRemove(keys);
  }

  async function cleanupChats(days) {
    const value = Number(days) || 0;
    if (value <= 0) return { removed: 0 };
    const cutoff = Date.now() - value * 24 * 60 * 60 * 1000;
    const index = await getChatIndex();
    const expired = index.filter((item) => (item.updatedAt || 0) < cutoff);
    for (const item of expired) {
      await storageRemove([CHAT_PREFIX + item.id]);
    }
    if (expired.length) {
      await storageSet({ [CHAT_INDEX_KEY]: index.filter((item) => (item.updatedAt || 0) >= cutoff) });
    }
    return { removed: expired.length };
  }

  async function usage() {
    const bytes = await new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (value) => resolve(value || 0));
    });
    const index = await getChatIndex();
    return { bytes, chats: index.length };
  }

  function isChaoxingUrl(raw) {
    try {
      const url = new URL(String(raw));
      return /(^|\.)chaoxing\.(com|cn)$/i.test(url.hostname);
    } catch (err) {
      return false;
    }
  }

  function startAI(payload, requestId) {
    const port = chrome.runtime.connect({ name: AI_PORT });
    activePorts.set(requestId, port);
    port.onMessage.addListener((message) => {
      if (!message || !message.type) return;
      if (message.type === 'chunk') {
        post({ type: 'ai:chunk', requestId, delta: message.delta || '' });
      } else if (message.type === 'usage') {
        post({ type: 'ai:usage', requestId, usage: message.usage });
      } else if (message.type === 'done') {
        post({ type: 'ai:done', requestId });
        activePorts.delete(requestId);
        try { port.disconnect(); } catch (err) { /* ignore */ }
      } else if (message.type === 'error') {
        post({ type: 'ai:error', requestId, error: message.error || 'AI 调用失败' });
        activePorts.delete(requestId);
        try { port.disconnect(); } catch (err) { /* ignore */ }
      }
    });
    port.onDisconnect.addListener(() => {
      if (activePorts.get(requestId) === port) {
        activePorts.delete(requestId);
        post({ type: 'ai:error', requestId, error: 'AI 连接已断开，请重试' });
      }
    });
    port.postMessage({
      type: 'start',
      requestId,
      messages: payload.messages || [],
    });
  }

  async function handleMessage(data) {
    const { type, requestId, payload } = data;
    switch (type) {
      case 'ping':
        reply(requestId, true, { ready: true });
        return;
      case 'settings:get': {
        const settings = await getSettingsRaw();
        reply(requestId, true, sanitizeSettings(settings));
        return;
      }
      case 'prefs:get':
        reply(requestId, true, await getPrefs());
        return;
      case 'prefs:set':
        reply(requestId, true, await setPrefs(payload && payload.patch));
        return;
      case 'chat:list':
        reply(requestId, true, await listChats());
        return;
      case 'chat:get':
        reply(requestId, true, await getChat(payload && payload.id));
        return;
      case 'chat:save':
        reply(requestId, true, await saveChat(payload && payload.chat));
        return;
      case 'chat:rename':
        reply(requestId, true, await renameChat(payload && payload.id, payload && payload.title));
        return;
      case 'chat:delete':
        await deleteChat(payload && payload.id);
        reply(requestId, true, { ok: true });
        return;
      case 'chat:clear':
        await clearChats();
        reply(requestId, true, { ok: true });
        return;
      case 'chat:cleanup': {
        const days = payload && payload.days;
        reply(requestId, true, await cleanupChats(days));
        return;
      }
      case 'storage:usage':
        reply(requestId, true, await usage());
        return;
      case 'ai:start':
        try {
          startAI(payload || {}, requestId);
          reply(requestId, true, { started: true });
        } catch (error) {
          post({ type: 'ai:error', requestId, error: error.message || '无法连接 AI 后台' });
          reply(requestId, false, null, error);
        }
        return;
      case 'ai:abort': {
        const port = activePorts.get(requestId);
        if (port) {
          try { port.postMessage({ type: 'abort' }); } catch (err) { /* ignore */ }
          activePorts.delete(requestId);
          try { port.disconnect(); } catch (err) { /* ignore */ }
        }
        reply(requestId, true, { aborted: true });
        return;
      }
      case 'fontMap': {
        const text = await loadFontMapChunked();
        reply(requestId, true, text);
        return;
      }
      case 'update:get': {
        const response = await sendRuntimeMessage({ type: 'cxh:updateGet' });
        reply(requestId, true, response);
        return;
      }
      case 'update:check': {
        const response = await sendRuntimeMessage({ type: 'cxh:updateCheck' });
        reply(requestId, true, response);
        return;
      }
      case 'update:dismiss': {
        const response = await sendRuntimeMessage({
          type: 'cxh:updateDismiss',
          mute: !!(payload && payload.mute),
          version: payload && payload.version,
        });
        if (!response.ok) throw new Error(response.error || '无法保存提醒设置');
        reply(requestId, true, response);
        return;
      }
      case 'update:setMuted': {
        const response = await sendRuntimeMessage({
          type: 'cxh:updateSetMuted',
          muted: !!(payload && payload.muted),
        });
        if (!response.ok) throw new Error(response.error || '无法保存提醒设置');
        reply(requestId, true, response);
        return;
      }
      case 'openExternal': {
        const response = await sendRuntimeMessage({
          type: 'cxh:openExternal',
          url: payload && payload.url,
        });
        if (!response.ok) throw new Error(response.error || '无法打开链接');
        reply(requestId, true, { ok: true });
        return;
      }
      case 'deepseekOcr': {
        const response = await sendRuntimeMessage({
          type: 'cxh:deepseekOcr',
          name: payload && payload.name,
          mimeType: payload && payload.type,
          data: payload && payload.data,
        });
        if (!response.ok) throw new Error(response.error || 'DeepSeek OCR 失败');
        reply(requestId, true, response);
        return;
      }
      case 'extractImageText': {
        const response = await sendRuntimeMessage({
          type: 'cxh:extractImageText',
          dataUrl: payload && payload.dataUrl,
          url: payload && payload.url,
          prompt: payload && payload.prompt,
        });
        if (!response.ok) throw new Error(response.error || '图片识别失败');
        reply(requestId, true, response);
        return;
      }
      case 'extractDocumentText': {
        const response = await sendRuntimeMessage({
          type: 'cxh:extractDocumentText',
          name: payload && payload.name,
          mimeType: payload && payload.type,
          data: payload && payload.data,
        });
        if (!response.ok) throw new Error(response.error || '文档识别失败');
        reply(requestId, true, response);
        return;
      }
      case 'markdown:render':
        reply(requestId, true, renderMarkdown(payload && payload.text));
        return;
      case 'openOptions': {
        const response = await sendRuntimeMessage({ type: 'cxh:openOptions' });
        if (!response.ok) throw new Error(response.error || '无法打开设置页');
        reply(requestId, true, { ok: true });
        return;
      }
      case 'openUrl': {
        const url = payload && payload.url;
        const response = await sendRuntimeMessage({ type: 'cxh:openUrl', url });
        if (!response.ok) throw new Error(response.error || '无法打开页面');
        reply(requestId, true, { ok: true });
        return;
      }
      case 'bridge:ready':
        reply(requestId, true, { ready: true });
        return;
      default:
        throw new Error('未知的桥接请求：' + type);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__cxh !== CHANNEL || data.source !== 'main' || !data.requestId) return;
    if (data.type === 'ai:start' || data.type === 'ai:abort') {
      handleMessage(data).catch((error) => reply(data.requestId, false, null, error));
      return;
    }
    handleMessage(data).catch((error) => reply(data.requestId, false, null, error));
  });

  // 通知主世界桥接层已就绪
  post({ type: 'bridge:ready' });
})();
