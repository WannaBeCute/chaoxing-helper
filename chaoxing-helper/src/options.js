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
      { id: 'deepseek-flash', vision: true, context: 128000 },
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
  ark: {
    name: '火山方舟（Ark）',
    badge: 'OpenAI 兼容',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    keyUrl: 'https://ark.volcengine.com/region:cn-beijing/apiKey',
    models: [
      { id: 'doubao-seed-2-1-pro-260915', vision: true, context: 128000 },
    ],
    defaultModel: 'doubao-seed-2-1-pro-260915',
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

const EXTRACT_PROVIDERS = Object.keys(PROVIDERS).filter((key) => {
  const provider = PROVIDERS[key];
  return provider.custom || provider.models.some((model) => model.vision);
});

const $ = (id) => document.getElementById(id);
const providerEl = $('provider');
const endpointEl = $('endpoint');
const apiKeyEl = $('apiKey');
const getKeyEl = $('getKey');
const modelSelectEl = $('modelSelect');
const modelInputEl = $('modelInput');
const contextEl = $('contextWindow');
const visionEl = $('supportsVision');
const extractEnabledEl = $('extractEnabled');
const extractFieldsEl = $('extractFields');
const extractProviderEl = $('extractProvider');
const extractModelSelectEl = $('extractModelSelect');
const extractModelInputEl = $('extractModelInput');
const extractEndpointEl = $('extractEndpoint');
const extractApiKeyEl = $('extractApiKey');
const extractApiModeEl = $('extractApiMode');
const testExtractEl = $('testExtract');
const extractResultEl = $('extractResult');
const autoDeleteEl = $('autoDeleteDays');
const statusEl = $('status');
const providerBadgeEl = $('providerBadge');
const versionEl = $('version');
const usageTextEl = $('usageText');
const usageBarEl = $('usageBar');
const currentVersionEl = $('currentVersion');
const checkUpdateEl = $('checkUpdate');
const updateReminderEl = $('updateReminder');
const updateStatusEl = $('updateStatus');

let currentSettings = null;

function updateCapabilityControls(isCustom) {
  const custom = !!isCustom;
  visionEl.disabled = !custom;
  contextEl.disabled = !custom;
}

function updateExtractVisibility() {
  if (extractFieldsEl) extractFieldsEl.hidden = !extractEnabledEl.checked;
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

function fillExtractProviders() {
  extractProviderEl.textContent = '';
  EXTRACT_PROVIDERS.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = PROVIDERS[key].name;
    extractProviderEl.appendChild(option);
  });
}

function setExtractModelOptions(providerKey, selectedModel) {
  const provider = PROVIDERS[providerKey] || PROVIDERS.custom;
  const models = provider.models.filter((model) => model.vision);
  extractModelSelectEl.textContent = '';
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.id + ' · 多模态';
    extractModelSelectEl.appendChild(option);
  });
  if (models.length) {
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = '自定义模型…';
    extractModelSelectEl.appendChild(customOption);
  }
  const target = selectedModel || (models[0] ? models[0].id : '');
  if (models.some((model) => model.id === target)) {
    extractModelSelectEl.value = target;
    extractModelSelectEl.hidden = false;
    extractModelInputEl.hidden = true;
  } else {
    extractModelSelectEl.value = models.length ? '__custom__' : '';
    extractModelSelectEl.hidden = !models.length;
    extractModelInputEl.hidden = false;
    extractModelInputEl.value = target;
  }
}

function applyExtractProvider(providerKey, settings, fromLoad) {
  const key = EXTRACT_PROVIDERS.includes(providerKey)
    ? providerKey
    : (EXTRACT_PROVIDERS.includes('openai') ? 'openai' : 'custom');
  const provider = PROVIDERS[key] || PROVIDERS.custom;
  extractProviderEl.value = key;
  const savedEndpoint = settings && settings.extractEndpoint;
  if (provider.custom) {
    extractEndpointEl.value = fromLoad && savedEndpoint ? savedEndpoint : '';
  } else {
    extractEndpointEl.value = fromLoad && savedEndpoint ? savedEndpoint : provider.endpoint;
  }
  const savedModel = fromLoad && settings ? settings.extractModel : '';
  setExtractModelOptions(key, savedModel);
}

function currentExtractModel() {
  if (!extractModelSelectEl.hidden
    && extractModelSelectEl.value
    && extractModelSelectEl.value !== '__custom__') {
    return extractModelSelectEl.value;
  }
  return extractModelInputEl.value.trim();
}

function collectSettings() {
  return {
    provider: providerEl.value,
    endpoint: endpointEl.value.trim(),
    model: currentModel(),
    apiKey: apiKeyEl.value.trim(),
    supportsVision: !!visionEl.checked,
    contextWindow: Math.max(1024, parseInt(contextEl.value, 10) || 128000),
    extractEnabled: !!extractEnabledEl.checked,
    extractProvider: extractProviderEl.value,
    extractEndpoint: extractEndpointEl.value.trim(),
    extractApiKey: extractApiKeyEl.value.trim(),
    extractModel: currentExtractModel(),
    extractApiMode: extractApiModeEl.value,
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

function validateExtractSettings(settings) {
  if (!settings.extractEnabled) return null;
  if (!settings.extractEndpoint) throw new Error('请填写文件识别模型 Endpoint。');
  let url;
  try {
    url = new URL(settings.extractEndpoint);
  } catch (err) {
    throw new Error('文件识别模型 Endpoint 不是有效的 URL。');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('文件识别模型 Endpoint 必须是 http(s) 地址。');
  if (!settings.extractModel) throw new Error('请选择或填写文件识别模型。');
  return url;
}

function isLocalUrl(url) {
  const host = String(url.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function requestHostPermissions(urls) {
  const origins = Array.from(new Set((urls || [])
    .filter(Boolean)
    .map((url) => url.origin + '/*')));
  if (!origins.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => resolve(!!granted));
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

function setUpdateStatus(message, type) {
  if (!updateStatusEl) return;
  updateStatusEl.textContent = message || '';
  updateStatusEl.className = 'hint' + (type ? ' ' + type : '');
}

function closeUpdateModal() {
  const existing = document.getElementById('cxhUpdateModal');
  if (existing) existing.remove();
}

function openExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (error) {
    setUpdateStatus('下载链接无效。', 'error');
    return;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    setUpdateStatus('只允许打开 http(s) 链接。', 'error');
    return;
  }
  chrome.tabs.create({ url: parsed.toString() });
}

function makeSourceButton(title, subtitle, url, password) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'update-source';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const sub = document.createElement('span');
  sub.textContent = subtitle || '';
  button.append(strong, sub);
  if (password) {
    const pwd = document.createElement('span');
    pwd.className = 'update-password';
    pwd.textContent = `密码：${password}`;
    button.appendChild(pwd);
  }
  button.addEventListener('click', () => openExternalUrl(url));
  return button;
}

function showUpdateModal(kind, data) {
  closeUpdateModal();
  const overlay = document.createElement('div');
  overlay.className = 'update-modal';
  overlay.id = 'cxhUpdateModal';
  const card = document.createElement('div');
  card.className = 'update-modal-card';
  const heading = document.createElement('h3');
  const meta = document.createElement('div');
  meta.className = 'update-modal-meta';
  const actions = document.createElement('div');
  actions.className = 'update-modal-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.textContent = '关闭';
  close.addEventListener('click', closeUpdateModal);
  const currentVersion = (data && data.currentVersion) || chrome.runtime.getManifest().version;
  const repoUrl = (data && data.repoUrl) || 'https://github.com/WannaBeCute/chaoxing-helper';

  if (kind === 'failure') {
    heading.textContent = '检查更新失败';
    meta.textContent = (data && data.error) || '无法获取 GitHub Release 信息。';
    const repo = document.createElement('button');
    repo.type = 'button';
    repo.className = 'btn';
    repo.textContent = '打开 GitHub 仓库';
    repo.addEventListener('click', () => openExternalUrl(repoUrl));
    actions.append(repo, close);
    card.append(heading, meta, actions);
  } else if (kind === 'latest') {
    heading.textContent = '已是最新版本';
    meta.textContent = `当前版本 v${currentVersion}，GitHub 上没有更新的 Release。`;
    actions.append(close);
    card.append(heading, meta, actions);
  } else {
    const state = (data && data.state) || {};
    heading.textContent = `发现新版本 v${state.latestVersion || ''}`;
    meta.textContent = `当前版本 v${currentVersion}。更新内容来自 GitHub Release。`;
    if (state.notes) {
      const notes = document.createElement('div');
      notes.className = 'update-modal-notes';
      notes.textContent = state.notes;
      card.appendChild(notes);
    }
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn primary';
    go.textContent = '去更新';
    const sourceList = document.createElement('div');
    sourceList.className = 'update-source-list';
    const showSources = () => {
      actions.remove();
      if (sourceList.childElementCount) return;
      sourceList.appendChild(makeSourceButton(
        '从 GitHub 下载',
        state.githubName || state.releaseUrl || repoUrl,
        state.githubUrl || state.releaseUrl || repoUrl,
      ));
      if (state.otherUrl) {
        const label = state.otherLabel || '其他渠道';
        sourceList.appendChild(makeSourceButton(
          `从 ${label} 下载`,
          state.otherUrl,
          state.otherUrl,
          state.otherPassword,
        ));
      } else {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Release 未提供其他下载源。';
        sourceList.appendChild(hint);
      }
      card.appendChild(sourceList);
    };
    go.addEventListener('click', showSources);
    actions.append(go, close);
    card.append(heading, meta, actions);
  }

  overlay.appendChild(card);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeUpdateModal();
  });
  document.body.appendChild(overlay);
}

function loadUpdateInfo() {
  if (currentVersionEl) {
    currentVersionEl.textContent = 'v' + chrome.runtime.getManifest().version;
  }
  chrome.runtime.sendMessage({ type: 'cxh:updateGet' }, (response) => {
    if (chrome.runtime.lastError) {
      setUpdateStatus(`检查更新失败：${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    if (!response) return;
    if (response.currentVersion && currentVersionEl) {
      currentVersionEl.textContent = 'v' + response.currentVersion;
    }
    if (updateReminderEl && typeof response.muted === 'boolean') {
      updateReminderEl.checked = !response.muted;
    }
    if (response.ok && response.hasUpdate) {
      setUpdateStatus(`发现新版本 v${response.state.latestVersion}，点击“检查更新”查看。`);
    } else if (response.ok) {
      setUpdateStatus(`当前 v${response.currentVersion}，已是最新版本。`);
    } else if (response.state && response.state.error) {
      setUpdateStatus(`上次检查失败：${response.state.error}`, 'error');
    }
  });
}

function load() {
  fillProviders();
  fillExtractProviders();
  chrome.storage.local.get([SETTINGS_KEY], (result) => {
    const settings = result[SETTINGS_KEY] || {};
    currentSettings = settings;
    autoDeleteEl.value = String(settings.autoDeleteDays || 0);
    apiKeyEl.value = settings.apiKey || '';
    visionEl.checked = settings.supportsVision !== false;
    contextEl.value = String(settings.contextWindow || 128000);
    const providerKey = PROVIDERS[settings.provider] ? settings.provider : 'custom';
    applyProvider(providerKey, settings);
    extractEnabledEl.checked = settings.extractEnabled === true;
    extractApiKeyEl.value = settings.extractApiKey || '';
    extractApiModeEl.value = settings.extractApiMode || 'auto';
    const defaultExtractProvider = EXTRACT_PROVIDERS.includes(providerKey) ? providerKey : 'openai';
    const extractProvider = EXTRACT_PROVIDERS.includes(settings.extractProvider)
      ? settings.extractProvider
      : defaultExtractProvider;
    applyExtractProvider(extractProvider, settings, true);
    updateExtractVisibility();
    updateUsage();
    versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
    loadUpdateInfo();
  });
}

providerEl.addEventListener('change', () => {
  applyProvider(providerEl.value, {});
  setStatus('');
});

extractEnabledEl.addEventListener('change', updateExtractVisibility);

extractProviderEl.addEventListener('change', () => {
  applyExtractProvider(extractProviderEl.value, {}, false);
  extractResultEl.textContent = '';
});

extractModelSelectEl.addEventListener('change', () => {
  if (extractModelSelectEl.value === '__custom__') {
    extractModelInputEl.hidden = false;
    extractModelInputEl.value = '';
    extractModelInputEl.focus();
  } else {
    extractModelInputEl.hidden = true;
  }
});

$('toggleExtractKey').addEventListener('click', () => {
  const visible = extractApiKeyEl.type === 'text';
  extractApiKeyEl.type = visible ? 'password' : 'text';
  $('toggleExtractKey').textContent = visible ? '显示' : '隐藏';
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
  requestHostPermissions([url]).then((granted) => {
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

testExtractEl.addEventListener('click', () => {
  let settings;
  let url;
  try {
    settings = collectSettings();
    if (!settings.extractEnabled) throw new Error('请先开启文件识别模型。');
    url = validateExtractSettings(settings);
  } catch (error) {
    extractResultEl.className = 'hint error';
    extractResultEl.textContent = error.message;
    return;
  }
  if (!settings.extractApiKey && !isLocalUrl(url)) {
    extractResultEl.className = 'hint error';
    extractResultEl.textContent = '请填写文件识别模型的 API Key。';
    return;
  }
  requestHostPermissions([url]).then((granted) => {
    if (!granted) {
      extractResultEl.className = 'hint error';
      extractResultEl.textContent = '未授权该 API 域名，无法检测。';
      return;
    }
    testExtractEl.disabled = true;
    extractResultEl.className = 'hint';
    extractResultEl.textContent = '正在检测图片/文档能力，会产生少量 API 调用费用…';
    chrome.runtime.sendMessage({ type: 'cxh:testExtractModel', settings }, (response) => {
      testExtractEl.disabled = false;
      if (chrome.runtime.lastError) {
        extractResultEl.className = 'hint error';
        extractResultEl.textContent = chrome.runtime.lastError.message;
        return;
      }
      if (!response || !response.ok) {
        extractResultEl.className = 'hint error';
        extractResultEl.textContent = response && response.error || '检测失败';
        return;
      }
      const modeLabel = response.mode === 'responses' ? 'Responses API' : 'Chat Completions';
      const docLabel = response.document
        ? '支持'
        : (response.documentTested === false ? '未检测' : '不支持');
      extractResultEl.className = 'hint sub ' + (response.vision || response.document ? 'ok' : 'error');
      extractResultEl.textContent = `${response.model}（${modeLabel}）：图片 ${response.vision ? '支持' : '不支持'} / 文档 ${docLabel}`;
      extractResultEl.title = [
        response.visionDetail ? `图片检测：${response.visionDetail}` : '',
        response.documentDetail ? `文档检测：${response.documentDetail}` : '',
      ].filter(Boolean).join('\n');
    });
  });
});

$('save').addEventListener('click', () => {
  let settings;
  let url;
  let extractUrl = null;
  try {
    settings = collectSettings();
    url = validateSettings(settings);
    extractUrl = validateExtractSettings(settings);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }
  requestHostPermissions([url, extractUrl]).then((granted) => {
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

checkUpdateEl.addEventListener('click', () => {
  checkUpdateEl.disabled = true;
  setUpdateStatus('正在检查更新…');
  chrome.runtime.sendMessage({ type: 'cxh:updateCheck' }, (response) => {
    checkUpdateEl.disabled = false;
    if (chrome.runtime.lastError) {
      const message = chrome.runtime.lastError.message;
      setUpdateStatus(`检查更新失败：${message}`, 'error');
      showUpdateModal('failure', { error: message });
      return;
    }
    if (!response || !response.ok) {
      const message = response && response.error || '无法获取 GitHub Release 信息。';
      setUpdateStatus(`检查更新失败：${message}`, 'error');
      showUpdateModal('failure', response || { error: message });
      return;
    }
    if (response.currentVersion && currentVersionEl) {
      currentVersionEl.textContent = 'v' + response.currentVersion;
    }
    if (response.hasUpdate) {
      setUpdateStatus(`发现新版本 v${response.state.latestVersion}。`);
      showUpdateModal('update', response);
    } else {
      setUpdateStatus(`当前 v${response.currentVersion}，已是最新版本。`, 'ok');
      showUpdateModal('latest', response);
    }
  });
});

updateReminderEl.addEventListener('change', () => {
  const muted = !updateReminderEl.checked;
  chrome.runtime.sendMessage({ type: 'cxh:updateSetMuted', muted }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      updateReminderEl.checked = !muted;
      setUpdateStatus('保存提醒设置失败。', 'error');
      return;
    }
    setUpdateStatus(
      muted ? '已关闭启动更新提醒，可在设置中重新开启。' : '已恢复启动更新提醒。',
      'ok',
    );
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
