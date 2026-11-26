'use strict';

const SETTINGS_KEY = 'cxh_settings';
const CHAT_PREFIX = 'cxh_chat_';
const CHAT_INDEX_KEY = 'cxh_chat_index';
const CAP_BYTES = 8 * 1024 * 1024;
const CAP_CHATS = 30;

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    badge: 'OpenAI 兼容',
    endpoint: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', vision: true, context: 128000 },
      { id: 'gpt-4o', vision: true, context: 128000 },
      { id: 'gpt-4.1', vision: true, context: 1047576 },
      { id: 'gpt-4.1-mini', vision: true, context: 1047576 },
      { id: 'gpt-4.1-nano', vision: true, context: 1047576 },
    ],
    defaultModel: 'gpt-4o-mini',
  },
  deepseek: {
    name: 'DeepSeek',
    badge: 'OpenAI 兼容',
    endpoint: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-chat', vision: false, context: 64000 },
      { id: 'deepseek-reasoner', vision: false, context: 64000 },
      { id: 'deepseek-flash', vision: false, context: 128000 },
    ],
    defaultModel: 'deepseek-chat',
  },
  moonshot: {
    name: '月之暗面 Kimi',
    badge: 'OpenAI 兼容',
    endpoint: 'https://api.moonshot.cn/v1',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'moonshot-v1-8k', vision: false, context: 8192 },
      { id: 'moonshot-v1-32k', vision: false, context: 32768 },
      { id: 'kimi-k2', vision: false, context: 131072 },
      { id: 'kimi-latest', vision: true, context: 131072 },
    ],
    defaultModel: 'moonshot-v1-32k',
  },
  zhipu: {
    name: '智谱 GLM',
    badge: 'OpenAI 兼容',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-4-flash', vision: false, context: 128000 },
      { id: 'glm-4-plus', vision: false, context: 128000 },
      { id: 'glm-4.5', vision: false, context: 131072 },
      { id: 'glm-4.5-air', vision: false, context: 131072 },
      { id: 'glm-4v-flash', vision: true, context: 8192 },
    ],
    defaultModel: 'glm-4-flash',
  },
  qwen: {
    name: '阿里通义千问',
    badge: 'OpenAI 兼容',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    models: [
      { id: 'qwen-plus', vision: false, context: 131072 },
      { id: 'qwen-max', vision: false, context: 32768 },
      { id: 'qwen-vl-max', vision: true, context: 32768 },
    ],
    defaultModel: 'qwen-plus',
  },
  siliconflow: {
    name: '硅基流动',
    badge: 'OpenAI 兼容',
    endpoint: 'https://api.siliconflow.cn/v1',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', vision: false, context: 64000 },
      { id: 'Qwen/Qwen2.5-VL-72B-Instruct', vision: true, context: 32768 },
    ],
    defaultModel: 'deepseek-ai/DeepSeek-V3',
  },
  ollama: {
    name: 'Ollama（本地）',
    badge: '本地模型',
    endpoint: 'http://localhost:11434/v1',
    keyUrl: 'https://ollama.com/download',
    models: [
      { id: 'llama3.1', vision: false, context: 128000 },
      { id: 'llama3.2', vision: false, context: 128000 },
      { id: 'llava', vision: true, context: 4096 },
      { id: 'qwen2.5vl', vision: true, context: 32768 },
    ],
    defaultModel: 'llama3.1',
  },
  custom: {
    name: '自定义（OpenAI 兼容）',
    badge: '自定义',
    endpoint: '',
    keyUrl: '',
    models: [],
    defaultModel: '',
    custom: true,
  },
};

const $ = (id) => document.getElementById(id);
const providerEl = $('provider');
const endpointEl = $('endpoint');
const apiKeyEl = $('apiKey');
const getKeyEl = $('getKey');
const modelSelectEl = $('modelSelect');
const modelInputEl = $('modelInput');
const contextEl = $('contextWindow');
const visionEl = $('supportsVision');
const ocrEl = $('ocrImages');
const autoDeleteEl = $('autoDeleteDays');
const statusEl = $('status');
const providerBadgeEl = $('providerBadge');
const versionEl = $('version');
const usageTextEl = $('usageText');
const usageBarEl = $('usageBar');
const capabilityHintEl = $('capabilityHint');

let currentSettings = null;

function updateCapabilityControls(isCustom) {
  const custom = !!isCustom;
  visionEl.disabled = !custom;
  contextEl.disabled = !custom;
  if (!capabilityHintEl) return;
  capabilityHintEl.textContent = custom
    ? '自定义模型：请按 API 文档手动填写是否支持图片/多模态及上下文长度。'
    : '预设模型：多模态能力与上下文长度来自内置 API 配置，无需手动修改。';
}

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

function providerKeys() {
  return Object.keys(PROVIDERS);
}

function fillProviders() {
  PROVIDERS && providerKeys().forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = PROVIDERS[key].name;
    providerEl.appendChild(option);
  });
}

function setModelOptions(providerKey, selectedModel) {
  const provider = PROVIDERS[providerKey] || PROVIDERS.custom;
  modelSelectEl.textContent = '';
  provider.models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.id + (model.vision ? ' · 多模态' : ' · 文本');
    option.dataset.vision = model.vision ? '1' : '0';
    option.dataset.context = String(model.context || 128000);
    modelSelectEl.appendChild(option);
  });
  if (provider.models.length) {
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = '自定义模型…';
    modelSelectEl.appendChild(customOption);
  }
  const target = selectedModel || provider.defaultModel;
  if (provider.models.some((model) => model.id === target)) {
    modelSelectEl.value = target;
    modelSelectEl.hidden = false;
    modelInputEl.hidden = true;
    applyModelMeta(providerKey);
  } else {
    modelSelectEl.value = provider.models.length ? '__custom__' : '';
    modelSelectEl.hidden = !provider.models.length;
    modelInputEl.hidden = false;
    modelInputEl.value = target || '';
    updateCapabilityControls(true);
  }
}

function applyModelMeta(providerKey) {
  const option = modelSelectEl.selectedOptions && modelSelectEl.selectedOptions[0];
  if (option && option.value !== '__custom__') {
    visionEl.checked = option.dataset.vision === '1';
    contextEl.value = option.dataset.context || '128000';
    updateCapabilityControls(false);
  }
}

function applyProvider(providerKey, settings) {
  const provider = PROVIDERS[providerKey] || PROVIDERS.custom;
  providerEl.value = providerKey;
  providerBadgeEl.textContent = provider.badge;
  endpointEl.value = provider.custom ? (settings && settings.endpoint) || '' : provider.endpoint;
  if (provider.keyUrl) {
    getKeyEl.href = provider.keyUrl;
    getKeyEl.hidden = false;
  } else {
    getKeyEl.hidden = true;
    getKeyEl.removeAttribute('href');
  }
  if (provider.custom) {
    modelSelectEl.hidden = true;
    modelSelectEl.textContent = '';
    modelInputEl.hidden = false;
    modelInputEl.value = (settings && settings.model) || '';
    visionEl.checked = !!(settings && settings.supportsVision);
    contextEl.value = String((settings && settings.contextWindow) || 128000);
    updateCapabilityControls(true);
    return;
  }
  setModelOptions(providerKey, settings && settings.model);
  const isPresetModel = !modelSelectEl.hidden && modelSelectEl.value && modelSelectEl.value !== '__custom__';
  if (isPresetModel) {
    // 预设模型的能力来自内置 API 配置，不使用用户旧的手填值。
    updateCapabilityControls(false);
    return;
  }
  if (settings && settings.supportsVision != null) visionEl.checked = !!settings.supportsVision;
  if (settings && settings.contextWindow) contextEl.value = String(settings.contextWindow);
  updateCapabilityControls(true);
}

function currentModel() {
  if (!modelSelectEl.hidden && modelSelectEl.value && modelSelectEl.value !== '__custom__') {
    return modelSelectEl.value;
  }
  return modelInputEl.value.trim();
}

function collectSettings() {
  return {
    provider: providerEl.value,
    endpoint: endpointEl.value.trim(),
    model: currentModel(),
    apiKey: apiKeyEl.value.trim(),
    supportsVision: !!visionEl.checked,
    contextWindow: Math.max(1024, parseInt(contextEl.value, 10) || 128000),
    ocrImages: !!ocrEl.checked,
    autoDeleteDays: parseInt(autoDeleteEl.value, 10) || 0,
  };
}

function validateSettings(settings) {
  if (!settings.endpoint) throw new Error('请填写 API Endpoint。');
  let url;
  try {
    url = new URL(settings.endpoint);
  } catch (err) {
    throw new Error('Endpoint 不是有效的 URL。');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Endpoint 必须是 http(s) 地址。');
  if (!settings.model) throw new Error('请选择或填写模型名称。');
  return url;
}

function requestHostPermission(url) {
  const origin = url.origin + '/*';
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [origin] }, (granted) => resolve(!!granted));
  });
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / 1024 / 1024).toFixed(2) + ' MB';
}

function updateUsage() {
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    chrome.storage.local.get([CHAT_INDEX_KEY], (result) => {
      const chats = Array.isArray(result[CHAT_INDEX_KEY]) ? result[CHAT_INDEX_KEY].length : 0;
      const percent = Math.min(100, Math.max(0, (bytes / CAP_BYTES) * 100));
      usageBarEl.style.width = percent.toFixed(1) + '%';
      usageTextEl.textContent = `${formatBytes(bytes)} / 8 MB · ${chats} / ${CAP_CHATS} 个对话`;
      usageBarEl.style.background = percent > 85
        ? 'linear-gradient(90deg, #f0a020, #d9534f)'
        : 'linear-gradient(90deg, #7fa9f3, #2f6fed)';
    });
  });
}

function cleanupChats(days) {
  const value = Number(days) || 0;
  if (value <= 0) return;
  const cutoff = Date.now() - value * 24 * 60 * 60 * 1000;
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all).filter((key) => key.startsWith(CHAT_PREFIX));
    const index = Array.isArray(all[CHAT_INDEX_KEY]) ? all[CHAT_INDEX_KEY] : [];
    const keep = [];
    const remove = [];
    index.forEach((item) => {
      if ((item.updatedAt || 0) < cutoff) remove.push(CHAT_PREFIX + item.id);
      else keep.push(item);
    });
    if (remove.length) {
      chrome.storage.local.remove(remove.concat([CHAT_INDEX_KEY]), () => {
        chrome.storage.local.set({ [CHAT_INDEX_KEY]: keep }, updateUsage);
      });
    }
    keys.forEach((key) => {
      const chat = all[key];
      if (chat && chat.updatedAt && chat.updatedAt < cutoff && !remove.includes(key)) {
        chrome.storage.local.remove(key);
      }
    });
  });
}

function load() {
  fillProviders();
  chrome.storage.local.get([SETTINGS_KEY], (result) => {
    const settings = result[SETTINGS_KEY] || {};
    currentSettings = settings;
    ocrEl.checked = settings.ocrImages !== false;
    autoDeleteEl.value = String(settings.autoDeleteDays || 0);
    apiKeyEl.value = settings.apiKey || '';
    visionEl.checked = settings.supportsVision !== false;
    contextEl.value = String(settings.contextWindow || 128000);
    const providerKey = PROVIDERS[settings.provider] ? settings.provider : 'custom';
    applyProvider(providerKey, settings);
    updateUsage();
    versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
  });
}

providerEl.addEventListener('change', () => {
  applyProvider(providerEl.value, {});
  setStatus('');
});

modelSelectEl.addEventListener('change', () => {
  if (modelSelectEl.value === '__custom__') {
    modelInputEl.hidden = false;
    modelInputEl.value = '';
    modelInputEl.focus();
    updateCapabilityControls(true);
  } else {
    modelInputEl.hidden = true;
    applyModelMeta(providerEl.value);
  }
});

$('toggleKey').addEventListener('click', () => {
  const visible = apiKeyEl.type === 'text';
  apiKeyEl.type = visible ? 'password' : 'text';
  $('toggleKey').textContent = visible ? '显示' : '隐藏';
});

$('test').addEventListener('click', () => {
  let settings;
  let url;
  try {
    settings = collectSettings();
    url = validateSettings(settings);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }
  requestHostPermission(url).then((granted) => {
    if (!granted) {
      setStatus('未授权该 API 域名，无法测试连接。', 'error');
      return;
    }
    setStatus('正在测试连接…');
    $('test').disabled = true;
    chrome.runtime.sendMessage({ type: 'cxh:testApi', settings }, (response) => {
      $('test').disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, 'error');
        return;
      }
      if (response && response.ok) setStatus(response.message || '连接成功', 'ok');
      else setStatus(response && response.message || '连接失败', 'error');
    });
  });
});

$('save').addEventListener('click', () => {
  let settings;
  let url;
  try {
    settings = collectSettings();
    url = validateSettings(settings);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }
  requestHostPermission(url).then((granted) => {
    if (!granted) {
      setStatus('未授权该 API 域名，设置未保存。请允许域名权限后重试。', 'error');
      return;
    }
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, 'error');
        return;
      }
      currentSettings = settings;
      cleanupChats(settings.autoDeleteDays);
      updateUsage();
      setStatus('设置已保存。', 'ok');
    });
  });
});

$('clearChats').addEventListener('click', () => {
  if (!confirm('确定清理全部 AI 对话吗？此操作不可恢复。')) return;
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all).filter((key) => key.startsWith(CHAT_PREFIX));
    keys.push(CHAT_INDEX_KEY);
    chrome.storage.local.remove(keys, () => {
      updateUsage();
      setStatus('对话已清理。', 'ok');
    });
  });
});

load();
