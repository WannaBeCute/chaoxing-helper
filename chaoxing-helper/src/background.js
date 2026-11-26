/**
 * 超星辅助助手 - 后台 Service Worker
 *
 * 只负责需要扩展权限的网络请求：
 * - OpenAI 兼容接口的流式对话
 * - API 连接测试
 * - 后续阶段的 OCR / 文档解析（通过 offscreen 文档）
 *
 * API Key 只从 chrome.storage.local 读取，不暴露给页面。
 */
'use strict';

const SETTINGS_KEY = 'cxh_settings';
const AI_PORT = 'cxh-ai';
let fontMapText = '';

function isChaoxingUrl(raw) {
  try {
    const url = new URL(String(raw));
    return /(^|\.)chaoxing\.(com|cn)$/i.test(url.hostname);
  } catch (error) {
    return false;
  }
}

function openOptionsPage(sendResponse) {
  try {
    if (typeof chrome.runtime.openOptionsPage === 'function') {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') });
    }
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error && error.message ? error.message : '无法打开设置页' });
  }
}
const DEFAULT_SETTINGS = {
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  supportsVision: true,
  contextWindow: 128000,
  extractModel: '',
  autoDeleteDays: 0,
};

function readSettings(overrides) {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
      const stored = result && result[SETTINGS_KEY] ? result[SETTINGS_KEY] : {};
      resolve({ ...DEFAULT_SETTINGS, ...stored, ...(overrides || {}) });
    });
  });
}

function normalizeChatUrl(endpoint) {  const raw = String(endpoint || '').trim();
  if (!raw) throw new Error('请先在设置中填写 API Endpoint');
  const url = new URL(raw);
  let path = url.pathname.replace(/\/+$/, '');
  if (!/\/chat\/completions$/.test(path)) {
    path += '/chat/completions';
    url.pathname = path;
  }
  return url.toString();
}

function estimateTokens(text) {
  const value = String(text || '');
  let cjk = 0;
  let other = 0;
  for (const ch of value) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.5 + other / 4) + 4;
}

function trimMessages(messages, contextWindow) {
  const budget = Math.max(2000, Math.min(Number(contextWindow) || 128000, 1000000));
  const output = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const tokens = estimateTokens(message.content);
    if (message.role !== 'system' && output.length > 0 && used + tokens > budget) break;
    output.unshift(message);
    used += tokens;
  }
  const system = messages.filter((message) => message.role === 'system');
  const withoutSystem = output.filter((message) => message.role !== 'system');
  return system.concat(withoutSystem);
}

function buildApiMessages(messages, settings) {
  return messages.map((message) => {
    const images = Array.isArray(message.images) ? message.images.filter(Boolean) : [];
    if (images.length && settings.supportsVision) {
      return {
        role: message.role,
        content: [
          { type: 'text', text: String(message.content || '') },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      };
    }
    return { role: message.role, content: String(message.content || '') };
  });
}

function errorText(status, body) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error && (parsed.error.message || parsed.error) || parsed.message || '';
    if (typeof detail === 'object') detail = JSON.stringify(detail);
  } catch (err) {
    detail = String(body || '').slice(0, 300);
  }
  return `API 调用失败（HTTP ${status}）${detail ? '：' + detail : ''}。请到扩展设置检查 API Key、Endpoint 和 Model。`;
}

async function requestChat(payload, settings, onDelta, signal, onUsage) {  const endpoint = normalizeChatUrl(settings.endpoint);
  if (!settings.apiKey && settings.provider !== 'ollama') {
    throw new Error('尚未填写 API Key，请到扩展设置中填写有效的 API。');
  }
  if (!settings.model) {
    throw new Error('尚未选择模型，请到扩展设置中填写 Model。');
  }

  const body = {
    model: settings.model,
    messages: buildApiMessages(trimMessages(payload.messages || [], settings.contextWindow), settings),
    stream: !!onDelta,
    temperature: 0.3,
  };
  if (onDelta) body.stream_options = { include_usage: true };

  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(errorText(response.status, text));
  }

  if (!onDelta) {
    const data = await response.json();
    if (onUsage && data && data.usage) onUsage(data.usage);
    const content = data && data.choices && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    return typeof content === 'string' ? content : '';
  }

  const contentType = response.headers.get('content-type') || '';
  if (!/text\/event-stream/i.test(contentType)) {
    const data = await response.json();
    if (onUsage && data && data.usage) onUsage(data.usage);
    const content = data && data.choices && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    if (content) onDelta(String(content));
    return '';
  }

  if (!response.body) throw new Error('API 未返回可读取的流式内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataText = trimmed.slice(5).trim();
      if (!dataText || dataText === '[DONE]') continue;
      let data;
      try {
        data = JSON.parse(dataText);
      } catch (err) {
        continue;
      }
      if (onUsage && data.usage) onUsage(data.usage);
      const delta = data.choices && data.choices[0]
        && ((data.choices[0].delta && data.choices[0].delta.content)
          || (data.choices[0].message && data.choices[0].message.content));
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }
  return full;
}

function isDeepSeekEndpoint(endpoint) {
  return /api\.deepseek\.com/i.test(String(endpoint || ''));
}

function extractModelName(settings) {
  const model = String(settings && settings.extractModel || '').trim();
  if (model) return model;
  return settings && settings.supportsVision ? String(settings.model || '').trim() : '';
}

function completionContent(data) {
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part && part.text) || ''))
      .join('');
  }
  return '';
}

function base64ToBlob(base64, type) {
  const raw = atob(String(base64 || ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function utf8ToBase64(text) {
  return arrayBufferToBase64(new TextEncoder().encode(String(text || '')).buffer);
}

async function requestJson(settings, body, timeoutMs) {
  const endpoint = normalizeChatUrl(settings.endpoint);
  if (!settings.apiKey && settings.provider !== 'ollama') {
    throw new Error('尚未填写 API Key，请到扩展设置中填写有效的 API。');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 180000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(errorText(response.status, raw));
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error('API 返回内容无法解析');
    }
    if (data && data.error) {
      const detail = data.error.message || data.error;
      throw new Error(`API 返回错误：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('文件识别请求超时，请尝试更小的文件或稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveImageDataUrl(payload) {
  const direct = String(payload && (payload.dataUrl || payload.url) || '').trim();
  if (!direct) throw new Error('图片内容为空');
  if (/^data:image\//i.test(direct)) {
    if (direct.length > 48 * 1024 * 1024) throw new Error('图片超过 32MB，已跳过。');
    return direct;
  }
  if (!isChaoxingUrl(direct)) throw new Error('只允许识别超星域名下的题目图片。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(direct, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
    const type = String(response.headers.get('content-type') || 'image/png').split(';')[0];
    if (!/^image\//i.test(type)) throw new Error('题目图片地址返回的不是图片');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 10 * 1024 * 1024) throw new Error('题目图片超过 10MB');
    return `data:${type};base64,${arrayBufferToBase64(buffer)}`;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('题目图片读取超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function extractImageText(payload) {
  const settings = await readSettings();
  const model = extractModelName(settings);
  if (!model) throw new Error('未配置文件识别模型，主模型也不支持多模态。');
  if (!settings.apiKey && settings.provider !== 'ollama') {
    throw new Error('请先在设置中填写 API Key。');
  }
  const dataUrl = await resolveImageDataUrl(payload || {});
  const prompt = String(payload && payload.prompt || '').trim()
    || '请提取这张图片中的全部文字，按原有顺序输出；如果是题目截图，请保留题号、选项和公式；不要解题，不要添加解释。';
  const data = await requestJson(settings, {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    stream: false,
    temperature: 0,
  }, 180000);
  return {
    ok: true,
    model,
    text: completionContent(data).trim(),
  };
}

async function uploadDeepSeekFile(settings, base64, name, type, purpose) {
  const origin = new URL(settings.endpoint).origin;
  const blob = base64ToBlob(base64, type);
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', blob, name || 'attachment');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch(`${origin}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      let detail = rawText.slice(0, 300);
      try {
        const parsed = JSON.parse(rawText.trim());
        detail = parsed.error && (parsed.error.message || parsed.error) || detail;
      } catch (error) { /* keep raw */ }
      throw new Error(`DeepSeek 文件上传失败（HTTP ${response.status}）：${detail}`);
    }
    let data;
    try {
      data = JSON.parse(rawText.trim());
    } catch (error) {
      throw new Error('DeepSeek 文件上传返回内容无法解析');
    }
    if (!data || !data.id) throw new Error('DeepSeek 文件上传未返回 file_id');
    return data.id;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('DeepSeek 文件上传/解析超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function extractDocumentText(payload) {
  const settings = await readSettings();
  const model = String(settings.extractModel || '').trim();
  if (!model) throw new Error('未配置文件识别模型。');
  if (!settings.apiKey && settings.provider !== 'ollama') {
    throw new Error('请先在设置中填写 API Key。');
  }
  if (!isDeepSeekEndpoint(settings.endpoint)) {
    throw new Error('当前 Endpoint 不支持标准文档解析；请把文件识别模型配置为 DeepSeek 模型（如 deepseek-flash）。');
  }
  const base64 = String(payload && payload.data || '');
  if (!base64) throw new Error('附件内容为空');
  if (base64.length > 140 * 1024 * 1024) throw new Error('附件过大，请上传不超过 100MB 的文件。');
  const name = String(payload && payload.name || 'attachment');
  const type = String(payload && (payload.mimeType || payload.fileType) || 'application/octet-stream');
  const isText = /^text\//i.test(type) || /\.(txt|md|csv|json|log|xml|html?)$/i.test(name);
  const fileId = await uploadDeepSeekFile(settings, base64, name, type, isText ? 'user_data' : 'text_recognition');
  const data = await requestJson(settings, {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'file', file_id: fileId },
        { type: 'text', text: '请提取并输出这个文档中的全部可见文字，保留题号、选项、表格和公式；不要总结，不要解题，不要添加解释。' },
      ],
    }],
    stream: false,
    temperature: 0,
  }, 180000);
  return {
    ok: true,
    model,
    text: completionContent(data).trim(),
    fileId,
  };
}

const TEST_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsCvlw/5Z7GEE38JgBZbpei0CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApcFJeExPOuMXn0AAAAASUVORK5CYII=';

async function testExtractModel(payload) {
  const settings = await readSettings(payload && payload.settings);
  const model = String(settings.extractModel || '').trim() || String(settings.model || '').trim();
  if (!model) throw new Error('请先填写文件识别模型。');
  const result = {
    ok: true,
    model,
    vision: false,
    document: false,
    visionDetail: '',
    documentDetail: '',
  };
  try {
    const data = await requestJson(settings, {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '这张纯色图片的主色是什么？只回复颜色名称。' },
          { type: 'image_url', image_url: { url: TEST_IMAGE_DATA_URL } },
        ],
      }],
      stream: false,
      temperature: 0,
    }, 90000);
    result.vision = true;
    result.visionDetail = completionContent(data).trim().slice(0, 80);
  } catch (error) {
    result.visionDetail = error && error.message ? error.message : '图片检测失败';
  }

  if (isDeepSeekEndpoint(settings.endpoint)) {
    try {
      const fileId = await uploadDeepSeekFile(
        settings,
        utf8ToBase64('超星辅助助手文件识别能力检测，文档中的数字是 42。'),
        'cxh-test.txt',
        'text/plain',
        'user_data',
      );
      const data = await requestJson(settings, {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'file', file_id: fileId },
            { type: 'text', text: '文档中的数字是多少？只回复数字。' },
          ],
        }],
        stream: false,
        temperature: 0,
      }, 120000);
      result.document = true;
      result.documentDetail = completionContent(data).trim().slice(0, 80);
    } catch (error) {
      result.documentDetail = error && error.message ? error.message : '文档检测失败';
    }
  } else {
    result.documentDetail = '当前 Endpoint 未提供标准文档解析，仅检测了图片；PDF/Word 请使用 DeepSeek 模型或 DeepSeek OCR。';
  }
  return result;
}

async function deepseekOcr(payload) {
  const settings = await readSettings();
  const isDeepSeek = settings.provider === 'deepseek'
    || /api\.deepseek\.com/i.test(String(settings.endpoint || ''));
  if (!isDeepSeek) throw new Error('当前 AI 厂商不是 DeepSeek，不能使用 DeepSeek OCR。');
  if (!settings.apiKey) throw new Error('请先在设置中填写 DeepSeek API Key。');
  const base64 = String(payload && payload.data || '');
  if (!base64) throw new Error('附件内容为空');
  if (base64.length > 36 * 1024 * 1024) throw new Error('附件过大，请上传不超过 20MB 的文件。');
  let bytes;
  try {
    const raw = atob(base64);
    bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  } catch (error) {
    throw new Error('附件编码读取失败');
  }
  const blob = new Blob([bytes], { type: payload.mimeType || payload.fileType || 'application/octet-stream' });
  const form = new FormData();
  form.append('purpose', 'text_recognition');
  form.append('file', blob, payload.name || 'attachment');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 220000);
  try {
    const response = await fetch('https://api.deepseek.com/v1/tools/ocr', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      let detail = rawText.slice(0, 300);
      try {
        const parsed = JSON.parse(rawText.trim());
        detail = parsed.error && (parsed.error.message || parsed.error) || detail;
      } catch (error) { /* keep raw */ }
      throw new Error(`DeepSeek OCR 失败（HTTP ${response.status}）：${detail}`);
    }
    let data;
    try {
      data = JSON.parse(rawText.trim());
    } catch (error) {
      throw new Error('DeepSeek OCR 返回内容无法解析');
    }
    if (data.error) {
      throw new Error(`DeepSeek OCR 失败：${data.error.message || data.error}`);
    }
    if (!Array.isArray(data.pages)) {
      throw new Error('DeepSeek OCR 未返回分页结果');
    }
    const text = data.pages
      .map((page) => String(page.text || ''))
      .join('\n\n')
      .replace(/<｜ref｜>[\s\S]*?<｜\/ref｜>/g, '')
      .replace(/<｜box｜>[\s\S]*?<｜\/box｜>/g, '')
      .replace(/<｜[^｜]+｜>/g, '')
      .trim();
    return {
      ok: true,
      text,
      pageCount: data.page_count || data.pages.length,
      usage: data.usage || null,
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('DeepSeek OCR 超时，请尝试更小的文件。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== AI_PORT) return;
  let controller = null;

  port.onMessage.addListener(async (message) => {
    if (!message || !message.type) return;
    if (message.type === 'abort') {
      if (controller) controller.abort();
      return;
    }
    if (message.type !== 'start') return;

    controller = new AbortController();
    try {
      const settings = await readSettings();
      await requestChat(message, settings, (delta) => {
        port.postMessage({ type: 'chunk', delta });
      }, controller.signal, (usage) => {
        if (usage) port.postMessage({ type: 'usage', usage });
      });
      port.postMessage({ type: 'done' });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        port.postMessage({ type: 'done' });
      } else {
        port.postMessage({
          type: 'error',
          error: error && error.message ? error.message : 'AI 调用失败，请到扩展设置检查 API。',
        });
      }
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'cxh:deepseekOcr') {
    deepseekOcr(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : 'DeepSeek OCR 失败' }));
    return true;
  }
  if (message && message.type === 'cxh:extractImageText') {
    extractImageText(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : '图片识别失败' }));
    return true;
  }
  if (message && message.type === 'cxh:extractDocumentText') {
    extractDocumentText(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : '文档识别失败' }));
    return true;
  }
  if (message && message.type === 'cxh:testExtractModel') {
    testExtractModel(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : '文件识别模型检测失败' }));
    return true;
  }
  if (message && message.type === 'cxh:openOptions') {
    openOptionsPage(sendResponse);
    return true;
  }
  if (message && message.type === 'cxh:openUrl') {
    const url = String(message.url || '');
    if (!isChaoxingUrl(url)) {
      sendResponse({ ok: false, error: '只允许打开 Chaoxing 页面' });
      return true;
    }
    try {
      chrome.tabs.create({ url });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error && error.message ? error.message : '无法打开页面' });
    }
    return true;
  }
  if (message && message.type === 'cxh:fontMap') {
    (async () => {
      try {
        if (!fontMapText) {
          const response = await fetch(chrome.runtime.getURL('src/font-map.json'));
          if (!response.ok) throw new Error('无法读取字体映射表');
          fontMapText = await response.text();
        }
        const offset = Math.max(0, Number(message.offset) || 0);
        const size = Math.max(1, Math.min(Number(message.size) || 262144, 1024 * 1024));
        sendResponse({
          ok: true,
          text: fontMapText.slice(offset, offset + size),
          total: fontMapText.length,
          offset,
        });
      } catch (error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : '字体映射加载失败' });
      }
    })();
    return true;
  }
  if (!message || message.type !== 'cxh:testApi') return false;
  (async () => {
    try {
      const settings = await readSettings(message.settings || {});
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const content = await requestChat({
        messages: [{ role: 'user', content: '回复 ok 两个字符即可。' }],
      }, { ...settings, contextWindow: 4096 }, null, controller.signal);
      clearTimeout(timer);
      sendResponse({ ok: true, message: content ? `连接成功：${String(content).slice(0, 40)}` : '连接成功' });
    } catch (error) {
      sendResponse({
        ok: false,
        message: error && error.message ? error.message : '连接失败，请检查 API 配置。',
      });
    }
  })();
  return true;
});
