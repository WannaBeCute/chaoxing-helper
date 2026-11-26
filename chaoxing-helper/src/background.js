/**
 * 超星辅助助手 - 后台 Service Worker
 *
 * 只负责需要扩展权限的网络请求：
 * - OpenAI 兼容接口的流式对话
 * - API 连接测试
 * - 文件识别模型（Chat Completions / Responses API）
 * - DeepSeek 官方 OCR（可选回退）
 *
 * API Key 只从 chrome.storage.local 读取，不暴露给页面。
 */
'use strict';

const SETTINGS_KEY = 'cxh_settings';
const AI_PORT = 'cxh-ai';
const UPDATE_REPO = 'WannaBeCute/chaoxing-helper';
const UPDATE_REPO_URL = `https://github.com/${UPDATE_REPO}`;
const UPDATE_STATE_KEY = 'cxh_update_state';
const UPDATE_PREFS_KEY = 'cxh_update_prefs';
const UPDATE_ALARM = 'cxh-update-check';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
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
  extractEnabled: false,
  extractProvider: 'openai',
  extractEndpoint: 'https://api.openai.com/v1',
  extractModel: 'gpt-4o-mini',
  extractApiKey: '',
  extractApiMode: 'auto',
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

function isLocalEndpoint(endpoint) {
  try {
    const host = new URL(String(endpoint || '')).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch (error) {
    return false;
  }
}

function resolveApiTarget(endpoint, mode) {
  const raw = String(endpoint || '').trim();
  if (!raw) throw new Error('请先填写文件识别模型 Endpoint');
  const url = new URL(raw);
  let path = url.pathname.replace(/\/+$/, '');
  const requested = mode === 'chat' || mode === 'responses' ? mode : '';
  let detected = '';
  if (/\/responses$/i.test(path)) detected = 'responses';
  else if (/\/chat\/completions$/i.test(path)) detected = 'chat';
  const finalMode = requested || detected || 'chat';
  path = path.replace(/\/chat\/completions$/i, '').replace(/\/responses$/i, '');
  path += finalMode === 'responses' ? '/responses' : '/chat/completions';
  url.pathname = path || (finalMode === 'responses' ? '/responses' : '/chat/completions');
  return { url: url.toString(), mode: finalMode };
}

function getExtractConfig(settings) {
  if (!settings || !settings.extractEnabled) return null;
  const endpoint = String(settings.extractEndpoint || '').trim();
  const model = String(settings.extractModel || '').trim();
  if (!endpoint || !model) throw new Error('文件识别模型已开启，请填写 Endpoint 和模型。');
  return {
    endpoint,
    model,
    apiKey: String(settings.extractApiKey || '').trim(),
    mode: settings.extractApiMode || 'auto',
  };
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

function responsesContent(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string') return data.output_text;
  const parts = [];
  if (Array.isArray(data.output)) {
    data.output.forEach((item) => {
      if (typeof item === 'string') {
        parts.push(item);
        return;
      }
      if (!item || !Array.isArray(item.content)) return;
      item.content.forEach((part) => {
        if (!part) return;
        if (typeof part.text === 'string') parts.push(part.text);
        else if (typeof part.output_text === 'string') parts.push(part.output_text);
      });
    });
  }
  if (parts.length) return parts.join('');
  return completionContent(data);
}

async function requestJsonTo(url, apiKey, body, timeoutMs) {
  if (!apiKey && !isLocalEndpoint(url)) {
    throw new Error('请填写文件识别模型的 API Key。');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 180000);
  try {
    const response = await fetch(url, {
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
  let config = getExtractConfig(settings);
  if (!config) {
    if (!settings.supportsVision || !settings.model) {
      throw new Error('未开启文件识别模型，主模型也不支持多模态。');
    }
    config = {
      endpoint: settings.endpoint,
      model: settings.model,
      apiKey: settings.apiKey,
      mode: 'chat',
    };
  }
  const target = resolveApiTarget(config.endpoint, config.mode);
  const dataUrl = await resolveImageDataUrl(payload || {});
  const prompt = String(payload && payload.prompt || '').trim()
    || '请提取这张图片中的全部文字，按原有顺序输出；如果是题目截图，请保留题号、选项和公式；不要解题，不要添加解释。';
  let data;
  if (target.mode === 'responses') {
    data = await requestJsonTo(target.url, config.apiKey, {
      model: config.model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: dataUrl },
        ],
      }],
    }, 180000);
  } else {
    data = await requestJsonTo(target.url, config.apiKey, {
      model: config.model,
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
  }
  return {
    ok: true,
    model: config.model,
    mode: target.mode,
    text: (target.mode === 'responses' ? responsesContent(data) : completionContent(data)).trim(),
  };
}

async function uploadDeepSeekFile(config, base64, name, type, purpose) {
  const origin = new URL(config.endpoint).origin;
  const blob = base64ToBlob(base64, type);
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', blob, name || 'attachment');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch(`${origin}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
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

const DOCUMENT_EXTRACT_PROMPT = '请提取并输出这个文档中的全部可见文字，保留题号、选项、表格和公式；不要总结，不要解题，不要添加解释。';

async function extractDocumentText(payload) {
  const settings = await readSettings();
  const config = getExtractConfig(settings);
  if (!config) throw new Error('未开启文件识别模型。');
  const target = resolveApiTarget(config.endpoint, config.mode);
  const base64 = String(payload && payload.data || '');
  if (!base64) throw new Error('附件内容为空');
  if (base64.length > 140 * 1024 * 1024) throw new Error('附件过大，请上传不超过 100MB 的文件。');
  const name = String(payload && payload.name || 'attachment');
  const type = String(payload && (payload.mimeType || payload.fileType) || 'application/octet-stream');
  const isText = /^text\//i.test(type) || /\.(txt|md|csv|json|log|xml|html?)$/i.test(name);
  const deepSeek = isDeepSeekEndpoint(config.endpoint);
  if (!deepSeek && target.mode !== 'responses') {
    throw new Error('当前文件识别接口为 Chat Completions，不支持直接上传 PDF/Word；请把接口类型改为 Responses API，或改用图片附件。');
  }
  let fileId = '';
  let body;
  if (deepSeek) {
    fileId = await uploadDeepSeekFile(
      config,
      base64,
      name,
      type,
      isText ? 'user_data' : 'text_recognition',
    );
    if (target.mode === 'responses') {
      body = {
        model: config.model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_file', file_id: fileId },
            { type: 'input_text', text: DOCUMENT_EXTRACT_PROMPT },
          ],
        }],
      };
    } else {
      body = {
        model: config.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'file', file_id: fileId },
            { type: 'text', text: DOCUMENT_EXTRACT_PROMPT },
          ],
        }],
        stream: false,
        temperature: 0,
      };
    }
  } else {
    body = {
      model: config.model,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: name,
            file_data: `data:${type};base64,${base64}`,
          },
          { type: 'input_text', text: DOCUMENT_EXTRACT_PROMPT },
        ],
      }],
    };
  }
  const data = await requestJsonTo(target.url, config.apiKey, body, 180000);
  return {
    ok: true,
    model: config.model,
    mode: target.mode,
    text: (target.mode === 'responses' ? responsesContent(data) : completionContent(data)).trim(),
    fileId,
  };
}

const TEST_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsCvlw/5Z7GEE38JgBZbpei0CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApcFJeExPOuMXn0AAAAASUVORK5CYII=';

async function testExtractModel(payload) {
  const settings = await readSettings(payload && payload.settings);
  const config = getExtractConfig(settings);
  if (!config) throw new Error('请先开启并填写文件识别模型。');
  const target = resolveApiTarget(config.endpoint, config.mode);
  const result = {
    ok: true,
    model: config.model,
    mode: target.mode,
    vision: false,
    document: false,
    documentTested: false,
    visionDetail: '',
    documentDetail: '',
  };

  try {
    let data;
    if (target.mode === 'responses') {
      data = await requestJsonTo(target.url, config.apiKey, {
        model: config.model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: '这张纯色图片的主色是什么？只回复颜色名称。' },
            { type: 'input_image', image_url: TEST_IMAGE_DATA_URL },
          ],
        }],
      }, 90000);
    } else {
      data = await requestJsonTo(target.url, config.apiKey, {
        model: config.model,
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
    }
    result.vision = true;
    result.visionDetail = (target.mode === 'responses' ? responsesContent(data) : completionContent(data))
      .trim().slice(0, 80);
  } catch (error) {
    result.visionDetail = error && error.message ? error.message : '图片检测失败';
  }

  const deepSeek = isDeepSeekEndpoint(config.endpoint);
  const testBase64 = utf8ToBase64('超星辅助助手文件识别能力检测，文档中的数字是 42。');
  const testName = 'cxh-test.txt';
  try {
    let data;
    if (deepSeek) {
      result.documentTested = true;
      const fileId = await uploadDeepSeekFile(
        config,
        testBase64,
        testName,
        'text/plain',
        'user_data',
      );
      if (target.mode === 'responses') {
        data = await requestJsonTo(target.url, config.apiKey, {
          model: config.model,
          input: [{
            role: 'user',
            content: [
              { type: 'input_file', file_id: fileId },
              { type: 'input_text', text: '文档中的数字是多少？只回复数字。' },
            ],
          }],
        }, 120000);
      } else {
        data = await requestJsonTo(target.url, config.apiKey, {
          model: config.model,
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
      }
      result.document = true;
      result.documentDetail = (target.mode === 'responses' ? responsesContent(data) : completionContent(data))
        .trim().slice(0, 80);
    } else if (target.mode === 'responses') {
      result.documentTested = true;
      data = await requestJsonTo(target.url, config.apiKey, {
        model: config.model,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: testName,
              file_data: `data:text/plain;base64,${testBase64}`,
            },
            { type: 'input_text', text: '文档中的数字是多少？只回复数字。' },
          ],
        }],
      }, 120000);
      result.document = true;
      result.documentDetail = responsesContent(data).trim().slice(0, 80);
    } else {
      result.documentDetail = '当前接口为 Chat Completions，未检测文档上传；PDF/Word 请使用 Responses API 端点或 DeepSeek Files API。';
    }
  } catch (error) {
    result.documentDetail = error && error.message ? error.message : '文档检测失败';
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

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function storageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

function normalizeUpdatePrefs(value) {
  return {
    muted: !!(value && value.muted),
    dismissedVersion: String(value && value.dismissedVersion || ''),
    dismissedAt: Number(value && value.dismissedAt) || 0,
  };
}

async function readUpdatePrefs() {
  const stored = await storageGet([UPDATE_PREFS_KEY]);
  return normalizeUpdatePrefs(stored[UPDATE_PREFS_KEY]);
}

function versionParts(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => {
      const match = String(part).match(/^\d+/);
      return match ? Number(match[0]) : 0;
    });
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length, 3);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkdownSection(body, heading) {
  const lines = String(body || '').split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s*${escapeRegExp(heading)}\\s*$`, 'i');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headingRe.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return '';
  const result = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    result.push(lines[i]);
  }
  return result.join('\n').trim();
}

function extractDownloadInfo(body) {
  const section = extractMarkdownSection(body, '📥 下载')
    || extractMarkdownSection(body, '下载');
  if (!section) {
    return { otherLabel: '', otherUrl: '', otherPassword: '' };
  }
  const link = section.match(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/);
  const password = section.match(/密码[：:]\s*([^\s\]\)]+)/);
  const label = link
    ? link[1].replace(/[，,]\s*密码[：:].*$/, '').trim()
    : '';
  return {
    otherLabel: label,
    otherUrl: link ? link[2] : '',
    otherPassword: password ? password[1].replace(/[，,。.]$/, '') : '',
  };
}

function describeUpdateState(state, prefs, currentVersion) {
  const version = currentVersion || chrome.runtime.getManifest().version;
  const latestVersion = String(state && state.latestVersion || '').replace(/^v/i, '');
  const hasUpdate = !!latestVersion && compareVersions(latestVersion, version) > 0;
  const dismissedRecently = prefs.dismissedVersion === latestVersion
    && prefs.dismissedAt
    && Date.now() - prefs.dismissedAt < UPDATE_INTERVAL_MS;
  return {
    ok: true,
    currentVersion: version,
    repoUrl: UPDATE_REPO_URL,
    hasUpdate,
    shouldPrompt: hasUpdate && !prefs.muted && !dismissedRecently,
    muted: prefs.muted,
    state: {
      ...(state || {}),
      latestVersion,
      hasUpdate,
    },
  };
}

let updateCheckPromise = null;

async function checkForUpdate(force) {
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = (async () => {
    const stored = await storageGet([UPDATE_STATE_KEY, UPDATE_PREFS_KEY]);
    const prefs = normalizeUpdatePrefs(stored[UPDATE_PREFS_KEY]);
    const previous = stored[UPDATE_STATE_KEY] || {};
    if (!force && previous.checkedAt && Date.now() - previous.checkedAt < UPDATE_INTERVAL_MS) {
      return describeUpdateState(previous, prefs);
    }
    try {
      const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'chaoxing-helper',
        },
      });
      if (response.status === 404) throw new Error('仓库尚未发布 Release');
      if (!response.ok) throw new Error(`GitHub 请求失败（HTTP ${response.status}）`);
      const data = await response.json();
      const latestVersion = String(data.tag_name || data.name || '').replace(/^v/i, '').trim();
      if (!latestVersion) throw new Error('Release 缺少版本号');
      const currentVersion = chrome.runtime.getManifest().version;
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
      const notes = extractMarkdownSection(data.body || '', '更新内容');
      const download = extractDownloadInfo(data.body || '');
      const assets = Array.isArray(data.assets) ? data.assets : [];
      const asset = assets.find((item) => /\.crx$/i.test(item.name || ''))
        || assets.find((item) => /\.zip$/i.test(item.name || ''))
        || assets[0];
      const next = {
        checkedAt: Date.now(),
        error: '',
        latestVersion,
        currentVersion,
        hasUpdate,
        title: data.name || `v${latestVersion}`,
        releaseUrl: data.html_url || `${UPDATE_REPO_URL}/releases/latest`,
        notes,
        githubUrl: asset && asset.browser_download_url
          ? asset.browser_download_url
          : (data.html_url || `${UPDATE_REPO_URL}/releases/latest`),
        githubName: asset && asset.name ? asset.name : 'GitHub Release',
        otherLabel: download.otherLabel,
        otherUrl: download.otherUrl,
        otherPassword: download.otherPassword,
        publishedAt: data.published_at || '',
      };
      await storageSet({ [UPDATE_STATE_KEY]: next });
      return describeUpdateState(next, prefs);
    } catch (error) {
      const failed = {
        ...previous,
        checkedAt: Date.now(),
        error: error && error.message ? error.message : '检查更新失败',
      };
      await storageSet({ [UPDATE_STATE_KEY]: failed });
      return {
        ok: false,
        error: failed.error,
        currentVersion: chrome.runtime.getManifest().version,
        repoUrl: UPDATE_REPO_URL,
        muted: prefs.muted,
        state: failed,
      };
    }
  })();
  try {
    return await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }
}

async function getUpdateInfo() {
  const stored = await storageGet([UPDATE_STATE_KEY, UPDATE_PREFS_KEY]);
  const prefs = normalizeUpdatePrefs(stored[UPDATE_PREFS_KEY]);
  const state = stored[UPDATE_STATE_KEY] || {};
  if (!state.checkedAt || Date.now() - state.checkedAt >= UPDATE_INTERVAL_MS) {
    return checkForUpdate(false);
  }
  return describeUpdateState(state, prefs);
}

async function dismissUpdate(payload) {
  const prefs = await readUpdatePrefs();
  if (payload && payload.mute) {
    prefs.muted = true;
  } else {
    prefs.dismissedVersion = String(payload && payload.version || '');
    prefs.dismissedAt = Date.now();
  }
  await storageSet({ [UPDATE_PREFS_KEY]: prefs });
  return { ok: true, muted: !!prefs.muted };
}

async function setUpdateMuted(payload) {
  const prefs = await readUpdatePrefs();
  prefs.muted = !!(payload && payload.muted);
  if (!prefs.muted) {
    prefs.dismissedVersion = '';
    prefs.dismissedAt = 0;
  }
  await storageSet({ [UPDATE_PREFS_KEY]: prefs });
  return { ok: true, muted: prefs.muted };
}

function ensureUpdateAlarm() {
  try {
    if (chrome.alarms && chrome.alarms.create) {
      chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 24 * 60 });
    }
  } catch (error) { /* alarms are optional */ }
}

function openExternal(payload, sendResponse) {
  let url;
  try {
    url = new URL(String(payload && payload.url || ''));
  } catch (error) {
    sendResponse({ ok: false, error: '链接格式不正确' });
    return;
  }
  if (!/^https?:$/.test(url.protocol)) {
    sendResponse({ ok: false, error: '只允许打开 http(s) 链接' });
    return;
  }
  try {
    chrome.tabs.create({ url: url.toString() });
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error && error.message ? error.message : '无法打开链接' });
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
  if (message && message.type === 'cxh:updateCheck') {
    checkForUpdate(true)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : '检查更新失败' }));
    return true;
  }
  if (message && message.type === 'cxh:updateGet') {
    getUpdateInfo()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : '检查更新失败' }));
    return true;
  }
  if (message && message.type === 'cxh:updateDismiss') {
    dismissUpdate(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : '无法保存提醒设置' }));
    return true;
  }
  if (message && message.type === 'cxh:updateSetMuted') {
    setUpdateMuted(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : '无法保存提醒设置' }));
    return true;
  }
  if (message && message.type === 'cxh:openExternal') {
    openExternal(message, sendResponse);
    return true;
  }
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

if (chrome.runtime.onInstalled && chrome.runtime.onInstalled.addListener) {
  chrome.runtime.onInstalled.addListener(() => {
    ensureUpdateAlarm();
    checkForUpdate(false).catch(() => {});
  });
}

if (chrome.runtime.onStartup && chrome.runtime.onStartup.addListener) {
  chrome.runtime.onStartup.addListener(() => {
    ensureUpdateAlarm();
    checkForUpdate(false).catch(() => {});
  });
}

if (chrome.alarms && chrome.alarms.onAlarm && chrome.alarms.onAlarm.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === UPDATE_ALARM) {
      checkForUpdate(true).catch(() => {});
    }
  });
}

ensureUpdateAlarm();
