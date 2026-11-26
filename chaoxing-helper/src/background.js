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
  ocrImages: true,
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
  const blob = new Blob([bytes], { type: payload.type || 'application/octet-stream' });
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
