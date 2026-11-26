/**
 * 超星辅助助手 - 内容脚本
 *
 * 运行在超星域名的页面主世界（MAIN world），因此可以直接访问页面里的
 * UEditor 实例（window.UE / UE.instants），调用其接口写入内容，绕过
 * 作业页面通过 beforepaste 监听实现的粘贴限制。
 *
 * 注意：脚本不依赖任何 chrome.* API，便于在普通页面中做本地联调。
 */
(() => {
  'use strict';

  const FLAG = '__CX_ASSISTANT_V1__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 单张图片 20MB，与超星图片上传限制一致
  const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024; // 图片总计 40MB
  const MAX_ATTACHMENTS = 50; // 与超星附件对话框一致
  const INLINE_IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif']);
  const AUDIO_TYPES = new Set([
    'aac', 'ac3', 'aif', 'amr', 'ape', 'asf', 'flac', 'm4a', 'm4r', 'mid',
    'mmf', 'mpa', 'mpc', 'ogg', 'pcm', 'mp3', 'ra', 'tta', 'voc', 'wav', 'wv', 'wma',
  ]);
  const POS_KEY = 'cx_assistant_panel_pos_v1';

  const LOGO_SVG = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="4.5" width="14" height="16.5" rx="3" stroke="currentColor" stroke-width="1.7"></rect>
      <path d="M9.2 3.2h5.6v3.2H9.2z" fill="currentColor"></path>
      <path d="M9 11h6M9 14.8h4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
    </svg>`;
  const REFRESH_SVG = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
      <path d="M20 4.5V11h-6.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;
  const MINUS_SVG = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>`;
  const GEAR_SVG = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.7"></circle>
      <path d="M19.4 13.2a7.6 7.6 0 0 0 0-2.4l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.1-1.2L14.7 3h-4l-.3 2.6c-.8.3-1.5.7-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2.1 1.2l.3 2.6h4l.3-2.6c.8-.3 1.5-.7 2.1-1.2l2.3.9 2-3.4-2-1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"></path>
    </svg>`;
  const FILE_SVG = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
      <path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
    </svg>`;

  const STYLES = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .cxh-root {
      position: absolute;
      right: 24px;
      bottom: 24px;
      width: 374px;
      max-width: calc(100vw - 24px);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #1b2a46;
      text-align: left;
      pointer-events: auto;
      --cxh-blue: #2f6fed;
      --cxh-blue-deep: #1f56c9;
      --cxh-line: #e2e8f4;
      --cxh-muted: #7a869a;
    }
    .cxh-panel {
      width: 100%;
      max-height: calc(100vh - 40px);
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 18px 48px rgba(16, 39, 86, .22), 0 2px 8px rgba(16, 39, 86, .08), 0 0 0 1px rgba(31, 86, 201, .08);
      animation: cxh-rise .22s ease-out;
    }
    @keyframes cxh-rise {
      from { opacity: 0; transform: translateY(10px) scale(.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .cxh-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex: none;
      padding: 12px 14px;
      color: #fff;
      cursor: grab;
      touch-action: none;
      user-select: none;
      background: linear-gradient(135deg, #16397d 0%, #245bc2 55%, #2f6fed 100%);
    }
    .cxh-head.is-dragging { cursor: grabbing; }
    .cxh-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .cxh-logo {
      width: 32px;
      height: 32px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      flex: none;
      color: #fff;
      background: rgba(255, 255, 255, .16);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12);
    }
    .cxh-logo svg { width: 21px; height: 21px; }
    .cxh-brand-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
    .cxh-brand-text strong { font-size: 14px; font-weight: 600; letter-spacing: .2px; }
    .cxh-brand-text span { margin-top: 2px; font-size: 11px; color: rgba(255, 255, 255, .74); }
    .cxh-head-actions { display: flex; gap: 2px; flex: none; }
    .cxh-icon {
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: #fff;
      background: transparent;
      cursor: pointer;
    }
    .cxh-icon:hover { background: rgba(255, 255, 255, .16); }
    .cxh-icon svg { width: 15px; height: 15px; }
    .cxh-status {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      flex: none;
      margin: 12px 14px 0;
      padding: 10px 11px;
      border: 1px solid var(--cxh-line);
      border-radius: 10px;
      background: #f4f6fb;
    }
    .cxh-dot {
      width: 8px;
      height: 8px;
      margin-top: 5px;
      border-radius: 50%;
      flex: none;
      background: #9aa7bd;
      box-shadow: 0 0 0 3px rgba(154, 167, 189, .16);
    }
    .cxh-status-body { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .cxh-status-title { font-size: 12.5px; font-weight: 600; }
    .cxh-status-sub { font-size: 11.5px; color: var(--cxh-muted); overflow-wrap: anywhere; }
    .cxh-status[data-state="blocked"] { background: #fff8ec; border-color: #f4dfb7; }
    .cxh-status[data-state="blocked"] .cxh-dot { background: #e59a1b; box-shadow: 0 0 0 3px rgba(229, 154, 27, .18); animation: cxh-pulse 1.8s ease-in-out infinite; }
    .cxh-status[data-state="blocked"] .cxh-status-title { color: #8a5600; }
    .cxh-status[data-state="clear"] { background: #eefaf3; border-color: #c8ecd9; }
    .cxh-status[data-state="clear"] .cxh-dot { background: #1f9d55; box-shadow: 0 0 0 3px rgba(31, 157, 85, .16); }
    .cxh-status[data-state="clear"] .cxh-status-title { color: #136b3c; }
    @keyframes cxh-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: .55; }
    }
    .cxh-text-btn {
      flex: none;
      padding: 2px 4px;
      border: 0;
      border-radius: 6px;
      color: var(--cxh-blue);
      background: transparent;
      font-size: 11.5px;
      cursor: pointer;
      white-space: nowrap;
    }
    .cxh-text-btn:hover { background: rgba(47, 111, 237, .08); }
    .cxh-content { display: flex; flex: 1 1 auto; flex-direction: column; gap: 10px; min-height: 0; overflow-y: auto; padding: 12px 14px 14px; }
    .cxh-mode-switch {
      display: flex;
      gap: 3px;
      flex: none;
      margin: 10px 14px 0;
      padding: 3px;
      border-radius: 9px;
      background: #f1f5fb;
    }
    .cxh-mode-btn {
      flex: 1;
      height: 28px;
      border: 0;
      border-radius: 7px;
      color: #6b7b93;
      background: transparent;
      font: 600 12px/1 "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
      cursor: pointer;
    }
    .cxh-mode-btn.is-active {
      color: #1f56c9;
      background: #fff;
      box-shadow: 0 2px 6px rgba(16, 39, 86, .10);
    }
    .cxh-ai-view { display: none; flex: 1 1 auto; min-height: 0; flex-direction: column; }
    .cxh-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cxh-label { font-size: 12px; font-weight: 600; color: #33415c; }
    .cxh-count { font-size: 11px; color: var(--cxh-muted); font-variant-numeric: tabular-nums; }
    .cxh-textarea {
      width: 100%;
      min-height: 96px;
      max-height: 240px;
      padding: 10px 11px;
      border: 1px solid #dfe6f2;
      border-radius: 10px;
      outline: none;
      resize: vertical;
      color: #1b2a46;
      background: #fbfcff;
      font: 13px/1.65 "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .cxh-textarea::placeholder { color: #a1abba; }
    .cxh-textarea:focus { border-color: #8db3f7; background: #fff; box-shadow: 0 0 0 3px rgba(47, 111, 237, .12); }
    .cxh-drop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 11px;
      border: 1px dashed #cfd9ea;
      border-radius: 10px;
      background: #f8faff;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease;
    }
    .cxh-drop:hover, .cxh-drop.is-over { border-color: #7fa9f3; background: #eff5ff; }
    .cxh-drop.is-over { box-shadow: inset 0 0 0 1px rgba(47, 111, 237, .18); }
    .cxh-drop-text { font-size: 11.5px; color: var(--cxh-muted); }
    .cxh-drop-text strong { font-weight: 600; color: #49618a; }
    .cxh-ghost-btn {
      flex: none;
      padding: 5px 10px;
      border: 1px solid #cfdcf5;
      border-radius: 7px;
      color: var(--cxh-blue-deep);
      background: #fff;
      font-size: 11.5px;
      cursor: pointer;
    }
    .cxh-ghost-btn:hover { border-color: #9dbcf5; background: #f4f8ff; }
    .cxh-attach-wrap { display: flex; flex-direction: column; gap: 6px; }
    .cxh-attach-head { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: #5b6b86; }
    .cxh-attach-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 160px;
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
    }
    .cxh-attach {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 6px 8px;
      border: 1px solid #e6ecf6;
      border-radius: 9px;
      background: #fbfcff;
    }
    .cxh-thumb {
      width: 34px;
      height: 34px;
      border-radius: 7px;
      flex: none;
      display: grid;
      place-items: center;
      overflow: hidden;
      color: #6b7f9e;
      background: #eef3fc;
    }
    .cxh-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .cxh-thumb svg { width: 18px; height: 18px; }
    .cxh-thumb.is-loading { font-size: 12px; color: #8fa1bd; }
    .cxh-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.35; }
    .cxh-name { overflow: hidden; font-size: 12px; color: #2b3a55; white-space: nowrap; text-overflow: ellipsis; }
    .cxh-size { font-size: 10.5px; color: var(--cxh-muted); }
    .cxh-del {
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      flex: none;
      color: #8492a8;
      background: transparent;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }
    .cxh-del:hover { color: #b23b3b; background: #fdf0f0; }
    .cxh-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex: none;
      padding: 0 14px 9px;
      color: #98a2b3;
      font-size: 10px;
      line-height: 1.4;
    }
    .cxh-hint-mini { flex: none; }
    .cxh-target-mini {
      overflow: hidden;
      max-width: 64%;
      color: #7b8aa3;
      white-space: nowrap;
      text-overflow: ellipsis;
      cursor: help;
    }
    .cxh-send {
      width: 100%;
      height: 40px;
      border: 0;
      border-radius: 10px;
      color: #fff;
      background: linear-gradient(135deg, #3b7bf2 0%, #1f56c9 100%);
      box-shadow: 0 8px 18px rgba(31, 86, 201, .24);
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: .4px;
      cursor: pointer;
      transition: filter .15s ease, transform .05s ease, opacity .15s ease;
    }
    .cxh-send:hover:not(:disabled) { filter: brightness(1.05); }
    .cxh-send:active:not(:disabled) { transform: translateY(1px); }
    .cxh-send:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
    .cxh-result {
      margin: 0;
      padding: 7px 9px;
      border-radius: 8px;
      background: #f4f8ff;
      border: 1px solid #dbe7fb;
      color: #2c4c7c;
      font-size: 11.5px;
      overflow-wrap: anywhere;
    }
    .cxh-result[data-type="success"] { background: #eefaf3; border-color: #c8ecd9; color: #136b3c; }
    .cxh-result[data-type="warn"] { background: #fff8ec; border-color: #f4dfb7; color: #8a5600; }
    .cxh-result[data-type="error"] { background: #fdf1f1; border-color: #f2cccc; color: #a13232; }
    .cxh-hint { margin: 0; color: #98a2b3; font-size: 10.5px; line-height: 1.55; }
    .cxh-fab {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 9px 14px 9px 10px;
      border: 0;
      border-radius: 999px;
      color: #fff;
      background: linear-gradient(135deg, #245bc2 0%, #2f6fed 100%);
      box-shadow: 0 10px 26px rgba(16, 39, 86, .3);
      font: 600 12.5px/1 "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .cxh-fab.is-dragging { cursor: grabbing; }
    .cxh-fab-logo { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: rgba(255, 255, 255, .18); }
    .cxh-fab-logo svg { width: 15px; height: 15px; }
    .cxh-root[data-collapsed="true"] { width: auto; }
    .cxh-root[data-mode="ai"][data-collapsed="false"] { width: 460px; }
    .cxh-root[data-mode="ai"] .cxh-status,
    .cxh-root[data-mode="ai"] .cxh-content,
    .cxh-root[data-mode="ai"] .cxh-footer { display: none; }
    .cxh-root[data-mode="ai"] .cxh-ai-view { display: flex; }
    .cxh-root[data-collapsed="true"] .cxh-panel { display: none; }
    .cxh-root[data-collapsed="true"] .cxh-fab { display: flex; }
    .cxh-toast {
      position: absolute;
      left: 50%;
      top: 20px;
      transform: translate(-50%, -10px);
      max-width: min(560px, calc(100vw - 32px));
      padding: 10px 16px;
      border-radius: 10px;
      color: #fff;
      background: #1f2c47;
      box-shadow: 0 12px 32px rgba(15, 32, 70, .28);
      font: 12.5px/1.5 "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease, transform .2s ease;
      z-index: 2;
    }
    .cxh-toast.is-show { opacity: 1; transform: translate(-50%, 0); }
    .cxh-toast[data-type="warn"] { background: #8a5600; }
    .cxh-toast[data-type="success"] { background: #136b3c; }
    .cxh-toast[data-type="error"] { background: #a13232; }
    @media (prefers-reduced-motion: reduce) {
      .cxh-panel { animation: none; }
      .cxh-status[data-state="blocked"] .cxh-dot { animation: none; }
      .cxh-toast { transition: none; }
    }
  `;

  const TEMPLATE = `
    <div class="cxh-root" data-collapsed="false">
      <section class="cxh-panel" aria-label="超星辅助助手">
        <header class="cxh-head" title="拖动移动，双击最小化">
          <div class="cxh-brand">
            <span class="cxh-logo">${LOGO_SVG}</span>
            <div class="cxh-brand-text">
              <strong>超星辅助助手</strong>
              <span>作业粘贴限制辅助填入</span>
            </div>
          </div>
          <div class="cxh-head-actions">
            <button type="button" class="cxh-icon" data-action="settings" title="扩展设置">${GEAR_SVG}</button>
            <button type="button" class="cxh-icon" data-action="collapse" title="收起窗口">${MINUS_SVG}</button>
          </div>
        </header>
        <div class="cxh-mode-switch" role="tablist" aria-label="面板模式">
          <button type="button" class="cxh-mode-btn is-active" data-mode="fill" role="tab">填入作业</button>
          <button type="button" class="cxh-mode-btn" data-mode="ai" role="tab">AI 对话</button>
        </div>
        <div class="cxh-status" data-state="checking">
          <span class="cxh-dot"></span>
          <div class="cxh-status-body">
            <strong class="cxh-status-title">正在检测粘贴限制…</strong>
            <span class="cxh-status-sub">正在读取当前作业的编辑器</span>
          </div>
          <button type="button" class="cxh-text-btn" data-action="rescan">重新检测</button>
        </div>
        <div class="cxh-content">
          <div class="cxh-field-head">
            <label class="cxh-label" for="cxh-input">要填入的内容</label>
            <span class="cxh-count" data-role="count">0 字</span>
          </div>
          <textarea id="cxh-input" class="cxh-textarea" rows="4" placeholder="在这里输入，或按 Ctrl+V 粘贴文字 / 截图"></textarea>
          <div class="cxh-drop" data-role="dropzone" data-action="pick" tabindex="0" role="button" aria-label="添加图片或文件">
            <span class="cxh-drop-text"><strong>拖拽图片或文件</strong>到这里，或 Ctrl+V 粘贴截图</span>
            <button type="button" class="cxh-ghost-btn" data-action="pick">选择文件</button>
            <input type="file" multiple hidden data-role="file">
          </div>
          <div class="cxh-attach-wrap" data-role="attach-wrap" hidden>
            <div class="cxh-attach-head">
              <span>待填入图片 / 附件</span>
              <button type="button" class="cxh-text-btn" data-action="clear">清空</button>
            </div>
            <ul class="cxh-attach-list" data-role="attach-list"></ul>
          </div>
          <button type="button" class="cxh-send" data-action="send" disabled>填入作业</button>
          <p class="cxh-result" data-role="result" hidden></p>
        </div>
        <div class="cxh-ai-view" data-role="ai-view"></div>
        <div class="cxh-footer">
          <span class="cxh-hint-mini">先点击作业输入框</span>
          <span class="cxh-target-mini" data-role="target" title="自动选择">自动选择</span>
        </div>
      </section>
      <button type="button" class="cxh-fab" data-action="expand" title="展开超星辅助助手">
        <span class="cxh-fab-logo">${LOGO_SVG}</span>
        <span>超星辅助助手</span>
      </button>
    </div>
    <div class="cxh-toast" data-role="toast" aria-live="polite"></div>
  `;

  const ui = {
    host: null,
    shadow: null,
    root: null,
    panel: null,
    status: null,
    statusTitle: null,
    statusSub: null,
    textarea: null,
    dropZone: null,
    fileInput: null,
    attachWrap: null,
    attachList: null,
    targetText: null,
    sendBtn: null,
    count: null,
    result: null,
    toast: null,
  };

  const state = {
    attachments: [],
    lastEditor: null,
    detection: null,
    lastSignature: '',
    busy: false,
    notified: false,
    url: location.href,
    seq: 0,
    toastTimer: 0,
    scanTimer: 0,
    mutationTimer: 0,
    manualTimer: 0,
    observer: null,
    resultTimer: 0,
    suppressFabClickUntil: 0,
    hasCaret: false,
    autoCollapsed: false,
    manualCollapsed: false,
    collapsedAnchor: null,
  };

  const savedRanges = new WeakMap();
  const boundDocs = new WeakSet();
  const bridgePending = new Map();
  let bridgeRequestSeq = 0;
  const aiStreams = new Map();
  let resolveAppReady;
  const appReady = new Promise((resolve) => { resolveAppReady = resolve; });

  function bridgeRequest(type, payload, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const requestId = `cxh_${Date.now()}_${++bridgeRequestSeq}`;
      const timer = setTimeout(() => {
        bridgePending.delete(requestId);
        reject(new Error('扩展后台未响应，请刷新页面后重试'));
      }, timeout);
      bridgePending.set(requestId, { resolve, reject, timer });
      window.postMessage({
        __cxh: 'cxh-v1',
        source: 'main',
        type,
        requestId,
        payload: payload || {},
      }, '*');
    });
  }

  function startAI(messages, handlers) {
    const requestId = `ai_${Date.now()}_${++bridgeRequestSeq}`;
    const streamHandlers = handlers || {};
    const timer = setTimeout(() => {
      const active = aiStreams.get(requestId);
      if (!active) return;
      aiStreams.delete(requestId);
      if (active.onError) active.onError(new Error('AI 响应超时，请检查网络或在设置中确认 API。'));
    }, 300000);
    streamHandlers.__timer = timer;
    aiStreams.set(requestId, streamHandlers);
    window.postMessage({
      __cxh: 'cxh-v1',
      source: 'main',
      type: 'ai:start',
      requestId,
      payload: { messages },
    }, '*');
    return {
      requestId,
      abort() {
        const active = aiStreams.get(requestId);
        if (active && active.__timer) clearTimeout(active.__timer);
        aiStreams.delete(requestId);
        window.postMessage({
          __cxh: 'cxh-v1',
          source: 'main',
          type: 'ai:abort',
          requestId,
          payload: {},
        }, '*');
      },
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__cxh !== 'cxh-v1' || data.source !== 'bridge') return;
    if (data.type === 'ai:chunk' || data.type === 'ai:done' || data.type === 'ai:error') {
      const handler = aiStreams.get(data.requestId);
      if (!handler) return;
      if (data.type === 'ai:chunk' && handler.onChunk) handler.onChunk(data.delta || '');
      else if (data.type === 'ai:done') {
        if (handler.__timer) clearTimeout(handler.__timer);
        aiStreams.delete(data.requestId);
        if (handler.onDone) handler.onDone();
      } else if (data.type === 'ai:error') {
        if (handler.__timer) clearTimeout(handler.__timer);
        aiStreams.delete(data.requestId);
        if (handler.onError) handler.onError(new Error(data.error || 'AI 调用失败'));
      }
      return;
    }
    if (data.requestId && bridgePending.has(data.requestId)) {
      const pending = bridgePending.get(data.requestId);
      bridgePending.delete(data.requestId);
      clearTimeout(pending.timer);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(data.error || '操作失败'));
    }
  });

  // ---------------------------------------------------------------------------
  // 通用工具
  // ---------------------------------------------------------------------------

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function truncate(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function formatSize(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function nextId() {
    state.seq += 1;
    return `cxh_${Date.now()}_${state.seq}`;
  }

  function isOurs(el) {
    if (!el || !ui.shadow) return false;
    return el === ui.host || ui.shadow.contains(el) || (ui.host && ui.host.contains(el));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = safe(() => el.getBoundingClientRect());
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    const style = view && safe(() => view.getComputedStyle(el));
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function isImageFile(file) {
    return !!file && /^image\//i.test(file.type || '');
  }

  function isChaoxingUrl(raw) {
    try {
      const url = new URL(String(raw));
      return /(^|\.)chaoxing\.(com|cn)$/i.test(url.hostname);
    } catch (err) {
      return false;
    }
  }

  function getFileExtension(name) {
    const matched = /\.([^./\\]+)$/.exec(String(name || ''));
    return matched ? matched[1].toLowerCase() : '';
  }

  function isInlineImageFile(file) {
    if (!file) return false;
    return INLINE_IMAGE_TYPES.has(getFileExtension(file.name))
      || /^image\/(jpeg|png|gif)$/i.test(file.type || '');
  }

  function readHiddenValue(id) {
    return safe(() => {
      const el = document.getElementById(id);
      return el && typeof el.value === 'string' ? el.value.trim() : '';
    }, '');
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function allDocuments() {
    const docs = [document];
    document.querySelectorAll('iframe').forEach((iframe) => {
      const doc = safe(() => iframe.contentDocument);
      if (doc) docs.push(doc);
    });
    return docs;
  }

  // ---------------------------------------------------------------------------
  // UEditor / 编辑器识别
  // ---------------------------------------------------------------------------

  function collectUEInstances() {
    const instances = [];
    const seen = new Set();

    const push = (candidate) => {
      if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
      if (typeof candidate.getContent !== 'function' || typeof candidate.execCommand !== 'function') return;
      seen.add(candidate);
      instances.push(candidate);
    };

    const scanWindow = (win) => {
      const UE = safe(() => win.UE);
      if (UE && UE.instants) {
        Object.values(UE.instants).forEach(push);
      }
    };

    scanWindow(window);
    document.querySelectorAll('iframe').forEach((iframe) => {
      const win = safe(() => iframe.contentWindow);
      if (win) scanWindow(win);
    });

    ['ue', 'editor'].forEach((name) => push(safe(() => window[name])));
    return instances;
  }

  function bindDocument(doc) {
    if (!doc || boundDocs.has(doc)) return;
    boundDocs.add(doc);

    doc.addEventListener('focusin', (event) => {
      const editor = findEditorFor(event.target);
      if (editor) {
        state.lastEditor = editor;
        state.hasCaret = true;
        updateTargetLabel();
        updateSendButton();
      }
    }, true);

    doc.addEventListener('selectionchange', () => {
      const selection = safe(() => doc.getSelection());
      if (!selection || selection.rangeCount === 0) return;
      const range = safe(() => selection.getRangeAt(0));
      if (!range) return;
      const node = range.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const editable = el && el.closest && el.closest('[contenteditable="true"],[contenteditable=""]');
      if (editable && !isOurs(editable)) {
        savedRanges.set(editable, range.cloneRange());
        state.hasCaret = true;
        updateSendButton();
      }
    }, true);
  }

  function collectEditors() {
    const editors = [];
    const seen = new Set();

    const add = (entry) => {
      const el = entry.el;
      if (!el || seen.has(el) || isOurs(el)) return;
      seen.add(el);
      editors.push(entry);
    };

    collectUEInstances().forEach((ue) => {
      let body = safe(() => ue.body);
      if (!body) {
        const iframe = safe(() => ue.iframe);
        const doc = safe(() => iframe && iframe.contentDocument);
        body = doc && doc.body;
      }
      if (body && isVisible(body)) {
        add({ kind: 'ue', el: body, doc: body.ownerDocument, ue });
      }
    });

    const visited = new Set();
    allDocuments().forEach((doc) => {
      if (visited.has(doc)) return;
      visited.add(doc);
      bindDocument(doc);
      const nodes = doc.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]');
      nodes.forEach((el) => {
        if (seen.has(el) || isOurs(el) || !isVisible(el)) return;
        if (el.tagName === 'TEXTAREA') {
          add({ kind: 'textarea', el, doc });
        } else {
          add({ kind: 'editable', el, doc });
        }
      });
    });

    // 优先使用顶层文档中的编辑器，通常就是作业答题区
    editors.sort((a, b) => {
      const ad = a.doc === document ? 0 : 1;
      const bd = b.doc === document ? 0 : 1;
      return ad - bd;
    });
    return editors;
  }

  function findEditorFor(target) {
    if (!target || isOurs(target)) return null;
    const editors = collectEditors();
    for (const editor of editors) {
      if (editor.el === target || editor.el.contains(target)) return editor;
      if (editor.ue) {
        const body = safe(() => editor.ue.body);
        if (body && (body === target || body.contains(target))) return editor;
      }
    }
    if (target.tagName === 'IFRAME') {
      return editors.find((editor) => safe(() => editor.ue && editor.ue.iframe === target)) || null;
    }
    return null;
  }

  function resolveTargetEditor() {
    const last = state.lastEditor;
    if (last && last.el && last.el.isConnected && isVisible(last.el)) {
      if (!last.ue && last.kind !== 'textarea') {
        const fresh = findEditorFor(last.el);
        if (fresh) {
          state.lastEditor = fresh;
          return fresh;
        }
      }
      return last;
    }
    const editors = collectEditors();
    state.lastEditor = editors[0] || null;
    return state.lastEditor;
  }

  function editorAnchor(editor) {
    if (!editor) return null;
    if (editor.ue) {
      const anchor = safe(() => editor.ue.container) || safe(() => editor.ue.iframe);
      if (anchor && anchor.isConnected) return anchor;
    }
    return editor.el || null;
  }

  function describeEditor(editor) {
    if (!editor) return '自动选择';
    const anchor = editorAnchor(editor);
    const question = anchor && safe(() => anchor.closest('.questionLi'));
    if (question) {
      const questions = safe(() => Array.from(question.ownerDocument.querySelectorAll('.questionLi')), []);
      const index = questions.indexOf(question) + 1;
      const rawTitle = safe(() => question.querySelector('h3') && question.querySelector('h3').innerText, '');
      const title = String(rawTitle || '').replace(/^\d+[.、\s]*/, '').replace(/\s+/g, ' ').trim();
      const suffix = title ? ` · ${truncate(title, 16)}` : '';
      return `第 ${index || '?'} 题${suffix}`;
    }
    if (editor.ue) return 'UEditor 编辑器';
    if (editor.kind === 'textarea') return '文本输入框';
    return '页面编辑器';
  }

  function signatureOf(editors) {
    return editors.map((editor) => {
      const el = editor.el;
      return `${editor.kind}|${el.id || ''}|${typeof el.className === 'string' ? el.className : ''}|${editor.ue ? 'ue' : ''}`;
    }).join('|');
  }

  function updateTargetLabel() {
    if (!ui.targetText) return;
    const editor = resolveTargetEditor();
    const label = editor ? describeEditor(editor) : '未找到编辑器';
    ui.targetText.textContent = label;
    ui.targetText.title = editor ? describeEditor(editor) : '未找到可编辑的作业区域';
  }

  // ---------------------------------------------------------------------------
  // 粘贴限制检测
  // ---------------------------------------------------------------------------

  function hasInlineBlock(attrText) {
    if (!attrText) return false;
    return /(return\s+false|preventDefault\s*\(|returnValue\s*=\s*false)/i.test(attrText);
  }

  function probePaste(editor) {
    const doc = editor.doc || document;
    const win = doc.defaultView || window;
    let event = null;
    try {
      const data = win.DataTransfer ? new win.DataTransfer() : null;
      if (data) data.setData('text/plain', '');
      event = new win.ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
    } catch (err) {
      event = safe(() => new win.Event('paste', { bubbles: true, cancelable: true }));
    }
    if (!event) return false;
    let notCanceled = true;
    try {
      notCanceled = editor.el.dispatchEvent(event);
    } catch (err) {
      return false;
    }
    return notCanceled === false;
  }

  function inspectRestrictions() {
    const editors = collectEditors();
    const evidence = new Set();
    const instances = collectUEInstances();

    instances.forEach((ue) => {
      const listeners = safe(() => ue.__allListeners && ue.__allListeners.beforepaste, null);
      const hasListener = Array.isArray(listeners)
        ? listeners.length > 0
        : (listeners && typeof listeners === 'object' && Object.keys(listeners).length > 0);
      if (hasListener) {
        evidence.add('UEditor 粘贴拦截监听');
      }
    });

    const nodes = [document.body, document.documentElement].concat(editors.slice(0, 4).map((editor) => editor.el));
    nodes.forEach((el) => {
      if (!el) return;
      ['onpaste', 'ondrop', 'onkeydown'].forEach((attr) => {
        if (hasInlineBlock(safe(() => el.getAttribute(attr), ''))) {
          evidence.add('页面内联粘贴限制');
        }
      });
    });

    // UEditor 的拦截发生在 beforepaste 事件中，直接检查监听即可；
    // 对普通输入框做一次空内容 paste 探测，判断事件是否被取消。
    editors
      .filter((editor) => editor.kind !== 'ue')
      .slice(0, 3)
      .forEach((editor) => {
        if (probePaste(editor)) evidence.add('paste 事件被页面拦截');
      });

    const mode = editors.length === 0 ? 'no-editor' : (evidence.size ? 'blocked' : 'clear');
    return {
      state: mode,
      evidence: Array.from(evidence),
      editors,
      time: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // 内容写入
  // ---------------------------------------------------------------------------

  function insertIntoTextarea(el, text) {
    const value = String(text || '');
    if (!value) return false;
    const start = Number.isInteger(el.selectionStart) ? el.selectionStart : el.value.length;
    const end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : start;
    let payload = value;
    const max = el.maxLength;
    if (typeof max === 'number' && max > 0) {
      const room = max - (el.value.length - (end - start));
      if (room <= 0) return false;
      if (payload.length > room) payload = payload.slice(0, room);
    }
    el.focus();
    el.setRangeText(payload, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function isRangeInside(el, range) {
    return safe(() => el.contains(range.startContainer) && el.contains(range.endContainer), false);
  }

  function placeCaretAtEnd(el) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || window;
    const selection = win.getSelection();
    if (!selection) return;
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertIntoEditable(editor, html) {
    const el = editor.el;
    const doc = editor.doc || el.ownerDocument;
    const win = doc.defaultView || window;
    safe(() => el.focus());

    const selection = win.getSelection ? win.getSelection() : doc.getSelection();
    const saved = savedRanges.get(el);
    if (selection) {
      if (saved && isRangeInside(el, saved)) {
        selection.removeAllRanges();
        selection.addRange(saved);
      } else {
        const current = selection.rangeCount ? selection.getRangeAt(0) : null;
        if (!current || !isRangeInside(el, current)) {
          placeCaretAtEnd(el);
        }
      }
    }

    let ok = false;
    safe(() => {
      ok = doc.execCommand('insertHTML', false, html);
    });
    if (!ok) {
      safe(() => {
        let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
        if (!range || !isRangeInside(el, range)) {
          placeCaretAtEnd(el);
          range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
        }
        if (range && isRangeInside(el, range)) {
          range.deleteContents();
          const fragment = range.createContextualFragment(html);
          range.insertNode(fragment);
          range.collapse(false);
        } else {
          el.insertAdjacentHTML('beforeend', html);
        }
        ok = true;
      });
    }

    if (ok) {
      const inputEvent = safe(() => new win.InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
        data: '',
      }), null);
      el.dispatchEvent(inputEvent || new Event('input', { bubbles: true }));
    }
    return ok;
  }

  function insertViaUEditor(ue, html) {
    const before = safe(() => ue.getContent(), '') || '';
    // focus(true) 会把光标强制移到正文末尾，导致图片/附件总插到末尾。
    // focus() 只恢复编辑器当前的选区/光标。
    safe(() => ue.focus && ue.focus());
    safe(() => ue.execCommand('insertHTML', html));

    let after = safe(() => ue.getContent(), '') || '';
    if (after === before) {
      safe(() => ue.execCommand('inserthtml', html));
      after = safe(() => ue.getContent(), '') || '';
    }
    if (after === before) {
      // execCommand 完全没生效时，按当前光标插入；没有选区再追加到末尾。
      safe(() => {
        const doc = ue.document;
        const selection = doc.getSelection();
        if (selection && selection.rangeCount) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const fragment = range.createContextualFragment(html);
          range.insertNode(fragment);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          ue.body.insertAdjacentHTML('beforeend', html);
        }
        if (typeof ue.sync === 'function') ue.sync();
      });
      after = safe(() => ue.getContent(), '') || '';
    }
    safe(() => ue.fireEvent && ue.fireEvent('contentchange'));
    return after !== before || html.trim() === '';
  }

  // ---------------------------------------------------------------------------
  // 超星 UEditor 上传：图片/附件走 /ueditorupload/attachment?uploadtype=work
  // ---------------------------------------------------------------------------

  function hasUploadConfig(ue) {
    return !!(
      safe(() => ue.getOpt('fileUrl'), '') ||
      safe(() => window.UEDITOR_CONFIG && window.UEDITOR_CONFIG.fileUrl, '')
    );
  }

  function collectUploadCredentials(ue) {
    let fromImageUrl = {};
    const imageUrl = safe(() => ue.getOpt('imageUrl'), '')
      || safe(() => window.UEDITOR_CONFIG && window.UEDITOR_CONFIG.imageUrl, '');
    if (imageUrl) {
      const parsed = safe(() => new URL(imageUrl, location.href));
      if (parsed) {
        fromImageUrl = {
          enc: parsed.searchParams.get('enc2') || '',
          time: parsed.searchParams.get('t') || '',
          uid: parsed.searchParams.get('uid') || '',
          type: parsed.searchParams.get('uploadtype') || '',
        };
      }
    }
    return {
      enc: readHiddenValue('uploadEnc')
        || String(safe(() => window.uploadEnc, '') || '')
        || fromImageUrl.enc
        || '',
      time: readHiddenValue('uploadTimeStamp')
        || String(safe(() => window.currentTime, '') || '')
        || fromImageUrl.time
        || '',
      uid: readHiddenValue('userId')
        || readHiddenValue('uploadUid')
        || String(safe(() => window.uid, '') || '')
        || fromImageUrl.uid
        || '',
      type: readHiddenValue('uploadtype')
        || String(safe(() => window.uploadType, '') || '')
        || fromImageUrl.type
        || 'work',
    };
  }

  function buildUploadUrl(ue, kind) {
    let raw = safe(() => ue.getOpt('fileUrl'), '') || '';
    if (!raw && kind === 'image') {
      raw = safe(() => ue.getOpt('imageUrl'), '') || '';
    }
    if (!raw) {
      raw = safe(() => window.UEDITOR_CONFIG && window.UEDITOR_CONFIG.fileUrl, '') || '';
    }
    if (!raw && kind === 'image') {
      raw = safe(() => window.UEDITOR_CONFIG && window.UEDITOR_CONFIG.imageUrl, '') || '';
    }
    if (!raw) throw new Error('未找到 UEditor 上传地址');

    const credentials = collectUploadCredentials(ue);
    if (!credentials.enc || !credentials.time || !credentials.uid) {
      throw new Error('未获取到上传凭证，请刷新作业页面后重试');
    }

    const url = new URL(raw, location.href);
    if (!url.searchParams.has('uploadtype')) {
      url.searchParams.set('uploadtype', credentials.type || 'work');
    }
    url.searchParams.set('source', '1');
    url.searchParams.set('enc2', credentials.enc);
    url.searchParams.set('t', credentials.time);
    url.searchParams.set('uid', credentials.uid);
    return url.href;
  }

  function uploadFileViaPage(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;
      xhr.responseType = 'text';
      xhr.timeout = 10 * 60 * 1000;
      if (xhr.upload && typeof onProgress === 'function') {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
      }
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`上传失败（HTTP ${xhr.status}），请刷新作业页面后重试`));
          return;
        }
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (err) {
          const matched = /\{[\s\S]*\}/.exec(xhr.responseText || '');
          if (matched) {
            try { data = JSON.parse(matched[0]); } catch (e) { /* ignore */ }
          }
        }
        if (!data) {
          reject(new Error('上传返回内容无法解析，请刷新作业页面后重试'));
          return;
        }
        if (String(data.state || '').toUpperCase() !== 'SUCCESS') {
          reject(new Error(String(data.state || '上传失败')));
          return;
        }
        if (!data.url) {
          reject(new Error('上传成功但未返回文件地址'));
          return;
        }
        resolve(data);
      };
      xhr.onerror = () => reject(new Error('上传请求失败，请检查网络后重试'));
      xhr.ontimeout = () => reject(new Error('上传超时，请重试'));

      const form = new FormData();
      form.append('upfile', file, file.name || 'file');
      xhr.send(form);
    });
  }

  async function uploadItems(ue, items, onProgress) {
    const results = [];
    const failures = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.uploadData) {
        results.push({ item, data: item.uploadData });
        onProgress?.(index + 1, items.length, 1);
        continue;
      }
      try {
        const kind = item.kind === 'image' ? 'image' : 'file';
        const url = buildUploadUrl(ue, kind);
        onProgress?.(index, items.length, 0);
        const data = await uploadFileViaPage(url, item.file, (percent) => {
          onProgress?.(index, items.length, percent);
        });
        item.uploadData = data;
        results.push({ item, data });
      } catch (err) {
        failures.push({ item, error: err });
      }
      onProgress?.(index + 1, items.length, 1);
    }
    return { results, failures };
  }

  function extractObjectId(url) {
    const text = String(url || '');
    const marker = 'objectId=';
    const index = text.indexOf(marker);
    if (index < 0) return '';
    return text.slice(index + marker.length).split('&')[0];
  }

  function normalizeFileType(value, fallbackName) {
    let type = String(value || '').trim().toLowerCase();
    if (type.includes('/')) type = type.split('/').pop();
    type = type.replace(/^\./, '');
    if (!type) type = getFileExtension(fallbackName || '');
    return type;
  }

  function formatUploadSize(size) {
    const bytes = Number(size) || 0;
    if (bytes <= 0) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}K`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}M`;
    if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}G`;
    return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)}T`;
  }

  function buildImageSrc(url, fileType) {
    const objectId = extractObjectId(url);
    if (!objectId) return String(url || '');
    const purl = String(
      safe(() => window.ServerHost && window.ServerHost.purl, '')
      || 'https://p.ananas.chaoxing.com',
    ).replace(/\/+$/, '');
    const parts = objectId.split('.');
    const ext = parts[1] || fileType || 'png';
    return `${purl}/star4/${parts[0]}/origin.${ext}`;
  }

  function buildImageAssetHtml(item, data) {
    const type = normalizeFileType(data.fileType, item.name);
    const name = String(data.original || item.name || '图片');
    const src = buildImageSrc(data.url, type);
    if (!src) throw new Error('未返回图片地址');
    return `<img class="ans-ued-img" src="${escapeHtml(src)}" alt="${escapeHtml(name)}">`;
  }

  function buildAudioAssetHtml(item, data) {
    const objectId = extractObjectId(data.url);
    if (!objectId) throw new Error('未返回音频 objectId');
    const name = String(data.original || item.name || '音频');
    return `<p><iframe data="${escapeHtml(objectId)}" height="62px" width="auto" frameborder="0" allowtransparency="true" style="background-color:transparent;border-radius: 3px;overflow: hidden;z-index: 0;" scrolling="no" src="/ananas/common-modules/audioplay/audioplay.html?objectid=${encodeURIComponent(objectId)}" name="${escapeHtml(name)}" class="ans-insertaudio-module" module="_insertaudio" filename="${escapeHtml(name)}"></iframe></p>`;
  }

  function buildAttachmentAssetHtml(item, data, type) {
    const objectId = extractObjectId(data.url);
    if (!objectId) throw new Error('未返回附件 objectId');
    const name = String(data.original || item.name || '未命名文件');
    const fileType = type || 'file';
    const sizeText = formatUploadSize(data.size != null ? data.size : item.size);
    const meta = btoa(encodeURIComponent(JSON.stringify({
      objectid: objectId,
      name,
      type: fileType,
      size: sizeText,
    })));
    const iframe = `<iframe frameborder="0" scrolling="no" src="/ananas/common-modules/attachment/insertCloud.html" class="attach-iframe" module="insertAttach" objectid="${escapeHtml(objectId)}" filename="${escapeHtml(name)}" filetype="${escapeHtml(fileType)}" filesize="${escapeHtml(sizeText)}" name="${meta}" style="display: block; max-width: 620px; width: 100%; height: 74px;"></iframe>`;
    return `<p><br></p><div class="editor-iframe" contenteditable="false">${iframe}</div><p><br></p>`;
  }

  function buildUploadedAssetHtml(item, data) {
    const type = normalizeFileType(data.fileType, item.name);
    if (INLINE_IMAGE_TYPES.has(type)) return buildImageAssetHtml(item, data);
    if (AUDIO_TYPES.has(type)) return buildAudioAssetHtml(item, data);
    return buildAttachmentAssetHtml(item, data, type);
  }

  function buildTextHtml(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n');
    if (!normalized.trim()) return '';
    // 不要给每行套 <p>：插入到已有段落时会额外产生段落/空行。
    // 用 <br> 保留换行，单行文本则原样插入。
    return normalized.split('\n').map((line) => escapeHtml(line)).join('<br>');
  }

  function buildHtml(text, images) {
    let html = buildTextHtml(text);
    (images || []).forEach((item) => {
      if (!item.dataUrl) return;
      html += `<p><img src="${item.dataUrl}" alt="${escapeHtml(item.name)}" style="max-width:100%;height:auto;"></p>`;
    });
    return html;
  }

  function insertTextIntoCurrentEditor(value) {
    const text = String(value || '');
    if (!text.trim()) return { ok: false, message: '内容为空' };
    if (!state.hasCaret) {
      return { ok: false, message: '请先点击作业输入框，出现光标后再填入' };
    }
    const editor = resolveTargetEditor();
    if (!editor) return { ok: false, message: '未找到作业编辑器' };

    let ok = false;
    if (editor.kind === 'textarea') {
      ok = insertIntoTextarea(editor.el, text);
    } else if (editor.ue) {
      ok = insertViaUEditor(editor.ue, buildTextHtml(text));
    } else {
      ok = insertIntoEditable(editor, buildTextHtml(text));
    }
    if (ok) state.hasCaret = true;
    updateSendButton();
    return { ok, message: ok ? '已填入当前光标' : '填入失败，请先点击目标输入框' };
  }

  // ---------------------------------------------------------------------------
  // 附件写入：复用页面自带的 file input / 拖放上传区域
  // ---------------------------------------------------------------------------

  function collectFileInputs(files) {
    const hasNonImage = (files || []).some((file) => !isImageFile(file));
    const scored = [];

    allDocuments().forEach((doc) => {
      doc.querySelectorAll('input[type="file"]').forEach((el) => {
        if (isOurs(el) || el.disabled) return;
        if (safe(() => el.closest('.edui, .edui-container, .edui-default'), null)) return;
        const accept = String(el.getAttribute('accept') || '').toLowerCase();
        if (accept.startsWith('image/') && hasNonImage) return;

        let score = 0;
        const context = [el.id, el.name, el.className, accept, el.getAttribute('title') || ''].join(' ');
        if (/attach|附件|upload|上传/i.test(context)) score += 4;
        if (el.multiple) score += 1;
        if (isVisible(el)) score += 2;
        const nearText = safe(() => {
          const box = el.closest('form, div, li');
          return box ? String(box.innerText || '').slice(0, 200) : '';
        }, '');
        if (/附件|上传/.test(nearText)) score += 3;
        scored.push({ el, score });
      });
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((item) => item.el);
  }

  function findDropZone() {
    const selector = '[class*="upload"],[class*="attach"],[id*="upload"],[id*="attach"],[class*="drag"],[class*="drop"]';
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((el) => !isOurs(el) && isVisible(el));
    const scored = candidates.map((el) => {
      const text = safe(() => String(el.innerText || '').slice(0, 120), '');
      let score = 0;
      if (/附件|上传|拖拽|点击添加/.test(text)) score += 3;
      if (/附件|上传|attach|upload/i.test(`${el.className} ${el.id}`)) score += 2;
      return { el, score };
    }).filter((item) => item.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].el : null;
  }

  function assignFilesToInput(input, files) {
    const data = new DataTransfer();
    files.forEach((file) => data.items.add(file));
    input.files = data.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function dropFilesToZone(zone, files) {
    const data = new DataTransfer();
    files.forEach((file) => data.items.add(file));
    ['dragenter', 'dragover', 'drop'].forEach((type) => {
      zone.dispatchEvent(new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }));
    });
  }

  function deliverFiles(files) {
    if (!files || !files.length) return { ok: false };
    const inputs = collectFileInputs(files);
    if (inputs.length) {
      try {
        assignFilesToInput(inputs[0], files);
        return { ok: true, target: inputs[0] };
      } catch (err) {
        console.warn('[超星辅助助手] 写入文件输入框失败', err);
      }
    }
    const zone = findDropZone();
    if (zone) {
      try {
        dropFilesToZone(zone, files);
        return { ok: true, target: zone };
      } catch (err) {
        console.warn('[超星辅助助手] 拖放上传失败', err);
      }
    }
    return { ok: false };
  }

  // ---------------------------------------------------------------------------
  // 面板构建与交互
  // ---------------------------------------------------------------------------

  function buildPanel() {
    if (ui.host) return;
    const host = document.createElement('div');
    host.id = 'cx-assistant-host';
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483600; pointer-events: none; display: block;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLES}</style>${TEMPLATE}`;

    ui.host = host;
    ui.shadow = shadow;
    ui.root = shadow.querySelector('.cxh-root');
    ui.panel = shadow.querySelector('.cxh-panel');
    ui.status = shadow.querySelector('.cxh-status');
    ui.statusTitle = shadow.querySelector('.cxh-status-title');
    ui.statusSub = shadow.querySelector('.cxh-status-sub');
    ui.textarea = shadow.querySelector('.cxh-textarea');
    ui.dropZone = shadow.querySelector('[data-role="dropzone"]');
    ui.fileInput = shadow.querySelector('[data-role="file"]');
    ui.attachWrap = shadow.querySelector('[data-role="attach-wrap"]');
    ui.attachList = shadow.querySelector('[data-role="attach-list"]');
    ui.targetText = shadow.querySelector('[data-role="target"]');
    ui.sendBtn = shadow.querySelector('[data-action="send"]');
    ui.count = shadow.querySelector('[data-role="count"]');
    ui.result = shadow.querySelector('[data-role="result"]');
    ui.toast = shadow.querySelector('[data-role="toast"]');

    bindPanelEvents();
    restorePosition();

    document.documentElement.appendChild(host);
  }

  function bindPanelEvents() {
    ui.shadow.addEventListener('click', (event) => {
      if (event.target === ui.fileInput) return;
      const modeEl = event.target.closest('[data-mode]');
      if (modeEl && modeEl.classList.contains('cxh-mode-btn')) {
        setMode(modeEl.dataset.mode);
        return;
      }
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'rescan') manualRescan();
      else if (action === 'collapse') {
        state.manualCollapsed = true;
        state.autoCollapsed = false;
        setCollapsed(true);
      } else if (action === 'expand') {
        if (Date.now() >= state.suppressFabClickUntil) {
          state.manualCollapsed = false;
          state.autoCollapsed = false;
          setCollapsed(false);
        }
      } else if (action === 'settings') {
        bridgeRequest('openOptions').catch((error) => toast(error.message, 'error'));
      } else if (action === 'pick') ui.fileInput.click();
      else if (action === 'clear') clearAttachments();
      else if (action === 'send') handleSend();
    });

    ui.textarea.addEventListener('paste', onPanelPaste, true);
    ui.shadow.addEventListener('paste', (event) => {
      if (event.target === ui.textarea) return;
      if (event.target.closest && event.target.closest('.cxh-ai-view')) return;
      const files = filesFromClipboard(event.clipboardData);
      if (files.length) {
        event.preventDefault();
        event.stopPropagation();
        addFiles(files);
      }
    }, true);

    ui.textarea.addEventListener('input', () => {
      updateCount();
      updateSendButton();
      hideResult();
    });

    ui.fileInput.addEventListener('change', () => {
      const files = Array.from(ui.fileInput.files || []);
      if (files.length) addFiles(files);
      ui.fileInput.value = '';
    });

    ui.dropZone.addEventListener('keydown', (event) => {
      if (event.target !== ui.dropZone) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        ui.fileInput.click();
      }
    });

    bindDropTarget(ui.root);
    ui.textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        handleSend();
      }
    });

    // 阻止页面把面板里的键盘/拖拽事件当成作业编辑器的快捷键处理
    ['keydown', 'keyup', 'keypress'].forEach((type) => {
      ui.root.addEventListener(type, (event) => event.stopPropagation());
    });
    ['dragenter', 'dragover', 'drop'].forEach((type) => {
      ui.root.addEventListener(type, (event) => event.stopPropagation());
    });

    bindDragHandle();
    window.addEventListener('resize', () => {
      const rect = ui.root.getBoundingClientRect();
      setRootPosition(rect.left, rect.top);
    });
  }

  function bindDragHandle() {
    const head = ui.shadow.querySelector('.cxh-head');
    const fab = ui.shadow.querySelector('.cxh-fab');
    if (head) {
      bindDragTarget(head, false);
      head.addEventListener('dblclick', (event) => {
        if (event.target.closest('button')) return;
        event.preventDefault();
        safe(() => {
          const selection = window.getSelection();
          if (selection) selection.removeAllRanges();
        });
        state.manualCollapsed = true;
        state.autoCollapsed = false;
        setCollapsed(true);
      });
    }
    if (fab) bindDragTarget(fab, true);
  }

  function bindDragTarget(handle, isFab) {
    let drag = null;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (!isFab && event.target.closest('button')) return;
      if (!isFab) event.preventDefault();
      const rect = ui.root.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      };
      safe(() => handle.setPointerCapture(event.pointerId));
      handle.classList.add('is-dragging');
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        drag.moved = true;
        if (isFab) event.preventDefault();
      }
      if (drag.moved) setRootPosition(drag.left + dx, drag.top + dy);
    });

    const finish = (event) => {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      const moved = drag.moved;
      safe(() => handle.releasePointerCapture(drag.pointerId));
      handle.classList.remove('is-dragging');
      if (moved) {
        savePosition();
        if (isFab) {
          const rect = ui.root.getBoundingClientRect();
          state.collapsedAnchor = { left: rect.left, top: rect.top };
          state.suppressFabClickUntil = Date.now() + 450;
        }
      }
      drag = null;
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function bindDropTarget(el) {
    const showOver = (event) => {
      if (!hasFiles(event)) return;
      if (event.target.closest && event.target.closest('.cxh-ai-view')) return;
      event.preventDefault();
      ui.dropZone.classList.add('is-over');
    };
    el.addEventListener('dragenter', showOver);
    el.addEventListener('dragover', showOver);
    el.addEventListener('dragleave', (event) => {
      if (event.relatedTarget && el.contains(event.relatedTarget)) return;
      ui.dropZone.classList.remove('is-over');
    });
    el.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      if (event.target.closest && event.target.closest('.cxh-ai-view')) return;
      event.preventDefault();
      event.stopPropagation();
      ui.dropZone.classList.remove('is-over');
      const files = filesFromClipboard(event.dataTransfer);
      if (files.length) addFiles(files);
    });
  }

  function hasFiles(event) {
    const dt = event.dataTransfer;
    if (!dt) return false;
    return Array.from(dt.types || []).includes('Files');
  }

  function filesFromClipboard(data) {
    if (!data) return [];
    let files = Array.from(data.files || []);
    if (!files.length && data.items) {
      files = Array.from(data.items)
        .filter((item) => item.kind === 'file')
        .map((item) => safe(() => item.getAsFile(), null))
        .filter(Boolean);
    }
    return files.filter((file) => file && file.size > 0);
  }

  function onPanelPaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files = filesFromClipboard(clipboard);
    const text = safe(() => clipboard.getData('text/plain'), '');
    const inTextarea = event.target === ui.textarea;
    if (inTextarea || files.length) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (files.length) addFiles(files);
    if (inTextarea && text) insertTextToPanel(text);
  }

  function insertTextToPanel(text) {
    const textarea = ui.textarea;
    const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
    const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
    let payload = text;
    const max = textarea.maxLength;
    if (typeof max === 'number' && max > 0) {
      const room = max - (textarea.value.length - (end - start));
      if (room <= 0) return;
      if (payload.length > room) payload = payload.slice(0, room);
    }
    textarea.setRangeText(payload, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function addFiles(list) {
    const files = Array.from(list || []).filter((file) => file && file.size > 0);
    if (!files.length) return;

    let added = 0;
    const warnings = [];

    files.forEach((file) => {
      if (state.attachments.length >= MAX_ATTACHMENTS) {
        warnings.push(`最多只能添加 ${MAX_ATTACHMENTS} 个内容`);
        return;
      }
      if (!isImageFile(file) && getFileExtension(file.name) === 'html') {
        warnings.push(`暂不支持上传 HTML 文件「${file.name}」`);
        return;
      }
      if (isImageFile(file)) {
        if (file.size > MAX_IMAGE_BYTES) {
          warnings.push(`图片「${file.name || '截图'}」超过 20MB，已跳过`);
          return;
        }
        const currentBytes = state.attachments
          .filter((item) => item.kind === 'image')
          .reduce((total, item) => total + item.size, 0);
        if (currentBytes + file.size > MAX_TOTAL_IMAGE_BYTES) {
          warnings.push('图片总大小超过 40MB，已跳过部分内容');
          return;
        }
        const item = {
          id: nextId(),
          kind: 'image',
          file,
          name: file.name || `粘贴的图片-${state.attachments.length + 1}.png`,
          size: file.size,
          dataUrl: '',
        };
        state.attachments.push(item);
        added += 1;
        readImageFile(file)
          .then((url) => {
            item.dataUrl = url;
            renderAttachments();
          })
          .catch(() => {
            item.failed = true;
            renderAttachments();
            toast('有一张图片读取失败，请重新添加', 'warn');
          });
      } else {
        state.attachments.push({
          id: nextId(),
          kind: 'file',
          file,
          name: file.name || '未命名文件',
          size: file.size,
        });
        added += 1;
      }
    });

    renderAttachments();
    if (added) {
      showResult(`已添加 ${added} 个内容`, 'info');
      hideResultSoon();
    }
    if (warnings.length) {
      toast(warnings[0], 'warn');
      showResult(warnings[0], 'warn');
      hideResultSoon(4800);
    }
  }

  function renderAttachments() {
    if (!ui.attachList) return;
    ui.attachList.textContent = '';
    state.attachments.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'cxh-attach';

      const thumb = document.createElement('div');
      thumb.className = 'cxh-thumb';
      if (item.kind === 'image') {
        if (item.dataUrl) {
          const img = document.createElement('img');
          img.src = item.dataUrl;
          img.alt = '';
          thumb.appendChild(img);
        } else if (item.failed) {
          thumb.textContent = '!';
        } else {
          thumb.textContent = '…';
          thumb.classList.add('is-loading');
        }
      } else {
        thumb.innerHTML = FILE_SVG;
      }

      const meta = document.createElement('div');
      meta.className = 'cxh-meta';
      const name = document.createElement('span');
      name.className = 'cxh-name';
      name.textContent = item.name;
      name.title = item.name;
      const size = document.createElement('span');
      size.className = 'cxh-size';
      size.textContent = item.failed ? '读取失败' : formatSize(item.size);
      meta.append(name, size);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cxh-del';
      remove.title = '移除';
      remove.textContent = '×';
      remove.addEventListener('click', () => removeAttachment(item.id));

      li.append(thumb, meta, remove);
      ui.attachList.appendChild(li);
    });
    ui.attachWrap.hidden = state.attachments.length === 0;
    updateSendButton();
  }

  function removeAttachment(id) {
    state.attachments = state.attachments.filter((item) => item.id !== id);
    renderAttachments();
    hideResult();
  }

  function clearAttachments() {
    state.attachments = [];
    renderAttachments();
    hideResult();
  }

  function updateCount() {
    if (!ui.count) return;
    ui.count.textContent = `${ui.textarea.value.length} 字`;
  }

  function hasContent() {
    return ui.textarea.value.trim().length > 0 || state.attachments.length > 0;
  }

  function updateSendButton() {
    if (!ui.sendBtn) return;
    ui.sendBtn.disabled = state.busy || !hasContent() || !state.hasCaret;
    ui.sendBtn.title = state.hasCaret ? '' : '请先点击作业输入框，出现光标后再填入';
  }

  function updateUploadProgress(done, total, percent) {
    if (!ui.sendBtn || !state.busy) return;
    const pct = Math.max(0, Math.min(100, Math.round((Number(percent) || 0) * 100)));
    const current = Math.min(Math.max(done + 1, 1), total || 1);
    ui.sendBtn.textContent = `上传中 ${current}/${total || 1} · ${pct}%`;
  }

  function setBusy(busy) {
    state.busy = busy;
    if (ui.sendBtn) {
      ui.sendBtn.textContent = busy ? '填入中…' : '填入作业';
    }
    updateSendButton();
  }

  function setCollapsed(collapsed) {
    if (!ui.root) return;
    const before = ui.root.getBoundingClientRect();
    const wasCollapsed = ui.root.dataset.collapsed === 'true';

    if (collapsed) {
      // 记住展开前小控件的位置，最小化时回到这里，而不是固定在面板右下角。
      const anchor = state.collapsedAnchor || { left: before.left, top: before.top };
      ui.root.dataset.collapsed = 'true';
      requestAnimationFrame(() => {
        setRootPosition(anchor.left, anchor.top);
        requestAnimationFrame(() => {
          const rect = ui.root.getBoundingClientRect();
          setRootPosition(rect.left, rect.top);
          state.collapsedAnchor = { left: rect.left, top: rect.top };
        });
      });
      return;
    }

    if (wasCollapsed) {
      state.collapsedAnchor = { left: before.left, top: before.top };
    }
    ui.root.dataset.collapsed = 'false';
    window.dispatchEvent(new CustomEvent('cxh-mode-change', {
      detail: { mode: ui.root.dataset.mode || 'fill' },
    }));
    requestAnimationFrame(() => {
      const after = ui.root.getBoundingClientRect();
      setRootPosition(before.right - after.width, before.bottom - after.height);
      // 面板展开后高度可能再变化，第二帧再按最终尺寸夹紧一次
      requestAnimationFrame(() => {
        const rect = ui.root.getBoundingClientRect();
        setRootPosition(rect.left, rect.top);
      });
    });
  }

  function setMode(mode) {
    if (!ui.root) return;
    const next = mode === 'ai' ? 'ai' : 'fill';
    ui.root.dataset.mode = next;
    ui.shadow.querySelectorAll('.cxh-mode-btn').forEach((button) => {
      const active = button.dataset.mode === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    requestAnimationFrame(() => {
      const rect = ui.root.getBoundingClientRect();
      setRootPosition(rect.left, rect.top);
    });
    window.dispatchEvent(new CustomEvent('cxh-mode-change', { detail: { mode: next } }));
    bridgeRequest('prefs:set', { patch: { mode: next } }, 5000).catch(() => {});
  }

  function setRootPosition(left, top) {
    if (!ui.root) return;
    const width = ui.root.offsetWidth || 374;
    const height = ui.root.offsetHeight || 200;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    const x = Math.max(8, Math.min(left, maxLeft));
    const y = Math.max(8, Math.min(top, maxTop));
    ui.root.style.left = `${x}px`;
    ui.root.style.top = `${y}px`;
    ui.root.style.right = 'auto';
    ui.root.style.bottom = 'auto';
  }

  function clampPanelPosition() {
    if (!ui.root) return;
    const rect = ui.root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setRootPosition(rect.left, rect.top);
  }

  function restorePosition() {
    const saved = safe(() => JSON.parse(localStorage.getItem(POS_KEY) || 'null'), null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      requestAnimationFrame(() => setRootPosition(saved.left, saved.top));
    }
  }

  function savePosition() {
    const rect = safe(() => ui.root.getBoundingClientRect());
    if (!rect) return;
    safe(() => localStorage.setItem(POS_KEY, JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
    })));
  }

  // ---------------------------------------------------------------------------
  // 状态、提示与结果
  // ---------------------------------------------------------------------------

  function toast(message, type = 'info', duration = 3600) {
    if (!ui.toast) return;
    ui.toast.textContent = message;
    ui.toast.dataset.type = type;
    ui.toast.classList.add('is-show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => ui.toast.classList.remove('is-show'), duration);
  }

  function showResult(message, type = 'info') {
    if (!ui.result) return;
    clearTimeout(state.resultTimer);
    ui.result.hidden = false;
    ui.result.dataset.type = type;
    ui.result.textContent = message;
  }

  function hideResult() {
    clearTimeout(state.resultTimer);
    if (!ui.result) return;
    ui.result.hidden = true;
    ui.result.textContent = '';
  }

  function hideResultSoon(delay = 6000) {
    clearTimeout(state.resultTimer);
    state.resultTimer = setTimeout(() => {
      if (ui.result && !state.busy) hideResult();
    }, delay);
  }

  function setStatusSub(text) {
    if (!ui.statusSub) return;
    ui.statusSub.textContent = text || '';
    ui.statusSub.hidden = !text;
  }

  function renderChecking() {
    if (!ui.status) return;
    ui.status.dataset.state = 'checking';
    ui.statusTitle.textContent = '正在检测粘贴限制…';
    setStatusSub('正在读取当前作业的编辑器');
  }

  function renderDetection(result) {
    state.detection = result;
    if (!ui.status) return;
    ui.status.dataset.state = result.state;

    if (result.state === 'blocked') {
      ui.statusTitle.textContent = '当前作业有防粘贴限制';
      setStatusSub('');
    } else if (result.state === 'clear') {
      ui.statusTitle.textContent = '当前作业没有防粘贴限制';
      setStatusSub('');
    } else {
      ui.statusTitle.textContent = '未找到可编辑的作业区域';
      setStatusSub('请先打开作业答题页面，再点击“重新检测”');
    }
    updateTargetLabel();
  }

  function notifyResult(result) {
    if (!result) return;
    if (result.state === 'blocked') {
      toast('检测到当前作业有防粘贴限制，可直接用面板填入', 'warn', 5200);
    } else if (result.state === 'clear') {
      toast('当前作业没有防粘贴限制，可直接粘贴或使用本助手', 'success', 5200);
    } else {
      toast('未找到作业编辑器，请先打开作业答题页面', 'info', 4200);
    }
  }

  function scan() {
    const previous = state.detection ? state.detection.state : 'unknown';
    const result = inspectRestrictions();
    state.lastSignature = signatureOf(result.editors);
    if (!result.editors.length) state.hasCaret = false;
    renderDetection(result);
    updateSendButton();
    if (previous === 'no-editor' && result.state !== 'no-editor'
      && ui.root && ui.root.dataset.collapsed === 'true'
      && state.autoCollapsed && !state.manualCollapsed) {
      state.autoCollapsed = false;
      setCollapsed(false);
      notifyResult(result);
      state.notified = true;
    }
    return result;
  }

  function manualRescan() {
    renderChecking();
    clearTimeout(state.manualTimer);
    state.manualTimer = setTimeout(() => {
      const result = scan();
      notifyResult(result);
      state.notified = result.state !== 'no-editor';
    }, 150);
  }

  // ---------------------------------------------------------------------------
  // 填入
  // ---------------------------------------------------------------------------

  async function handleSend() {
    if (state.busy) return;
    if (!state.hasCaret) {
      toast('请先点击作业输入框，出现光标后再填入', 'warn');
      return;
    }

    const text = ui.textarea.value;
    const hasText = text.trim().length > 0;
    const images = state.attachments.filter((item) => item.kind === 'image');
    const files = state.attachments.filter((item) => item.kind === 'file');

    if (!hasText && !images.length && !files.length) {
      toast('请先输入、粘贴或拖入要填入的内容', 'warn');
      return;
    }

    const editor = resolveTargetEditor();
    if ((hasText || images.length) && !editor) {
      scan();
      toast('未找到作业编辑器，请先打开作业答题页', 'error');
      return;
    }

    const failedImages = images.filter((item) => item.failed);
    const usableImages = images.filter((item) => !item.failed);

    setBusy(true);

    const successItems = [];
    const problems = [];
    let insertedText = false;
    let usedUploadApi = false;

    try {
      if (failedImages.length) {
        problems.push(`有 ${failedImages.length} 张图片读取失败，请移除后重试`);
      }

      const ue = editor && editor.ue;
      const canUploadAssets = !!ue && hasUploadConfig(ue);

      if (canUploadAssets) {
        usedUploadApi = true;
        const assetItems = usableImages.concat(files);
        let uploadResults = [];
        let uploadFailures = [];

        if (assetItems.length) {
          const result = await uploadItems(ue, assetItems, updateUploadProgress);
          uploadResults = result.results;
          uploadFailures = result.failures;
        }

        let html = buildTextHtml(text);
        const renderedItems = [];
        uploadResults.forEach(({ item, data }) => {
          try {
            html += buildUploadedAssetHtml(item, data);
            renderedItems.push(item);
          } catch (err) {
            problems.push(`「${item.name}」生成插入内容失败：${err.message}`);
          }
        });

        let insertedOk = false;
        if (html) {
          ui.sendBtn.textContent = '填入中…';
          insertedOk = insertViaUEditor(ue, html);
          if (!insertedOk) problems.push('写入编辑器失败，请先点击目标输入框再试');
        }

        if (insertedOk) {
          insertedText = hasText;
          renderedItems.forEach((item) => successItems.push(item));
        }

        uploadFailures.forEach(({ item, error }) => {
          const label = item.kind === 'image' ? '图片' : '附件';
          problems.push(`${label}「${item.name}」上传失败：${error.message}`);
        });
      } else {
        if (hasText || usableImages.length) {
          if (!editor) {
            problems.push('未找到可写入的编辑器');
          } else if (editor.kind === 'textarea') {
            if (usableImages.length) problems.push('当前目标为纯文本框，图片无法填入');
            if (hasText) {
              insertedText = insertIntoTextarea(editor.el, text);
              if (!insertedText) problems.push('文本写入失败，请先点击目标输入框');
            }
          } else {
            const readyImages = [];
            for (const item of usableImages) {
              if (!item.dataUrl) {
                try {
                  item.dataUrl = await readImageFile(item.file);
                } catch (err) {
                  problems.push(`图片「${item.name}」读取失败`);
                  continue;
                }
              }
              if (item.dataUrl) readyImages.push(item);
            }
            if (hasText || readyImages.length) {
              const html = buildHtml(text, readyImages);
              const ok = editor.ue
                ? insertViaUEditor(editor.ue, html)
                : insertIntoEditable(editor, html);
              if (ok) {
                insertedText = hasText;
                readyImages.forEach((item) => successItems.push(item));
              } else {
                problems.push('写入编辑器失败，请先点击目标输入框再试');
              }
            }
          }
        }

        if (files.length) {
          const result = deliverFiles(files.map((item) => item.file));
          if (result.ok) {
            files.forEach((item) => successItems.push(item));
          } else {
            problems.push('未找到附件上传入口，请先点击页面上的“添加附件”');
          }
        }
      }

      if (insertedText) ui.textarea.value = '';
      if (successItems.length) {
        const successIds = new Set(successItems.map((item) => item.id));
        state.attachments = state.attachments.filter((item) => !successIds.has(item.id));
      }
      renderAttachments();
      updateCount();
      updateSendButton();
      updateTargetLabel();

      const uniqueProblems = Array.from(new Set(problems));
      const insertedImages = successItems.filter((item) => item.kind === 'image').length;
      const insertedFiles = successItems.filter((item) => item.kind === 'file').length;
      const inserted = [];
      if (insertedText) inserted.push('文本');
      if (insertedImages) inserted.push(`${insertedImages} 张图片`);
      if (insertedFiles) inserted.push(`${insertedFiles} 个附件`);

      if (inserted.length) {
        let note = '';
        if (insertedFiles) {
          note = usedUploadApi ? '（附件已上传到超星）' : '（附件已交给页面，请确认上传完成）';
        }
        showResult(`已填入：${inserted.join('、')}${note}`, 'success');
        if (!uniqueProblems.length) toast('内容已填入作业', 'success');
        hideResultSoon(7000);
      }
      if (uniqueProblems.length) {
        if (inserted.length) {
          showResult(`已填入：${inserted.join('、')}；${uniqueProblems.join('；')}`, 'warn');
        } else {
          showResult(uniqueProblems.join('；'), 'warn');
        }
        toast(uniqueProblems[0], 'warn', 4800);
      }
      scan();
    } catch (err) {
      console.error('[超星辅助助手] 填入异常', err);
      showResult(`填入失败：${err && err.message ? err.message : '未知错误'}`, 'error');
      toast('填入失败，请查看面板提示', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // 启动与观察
  // ---------------------------------------------------------------------------

  function startObservers() {
    const observer = new MutationObserver(() => {
      clearTimeout(state.mutationTimer);
      state.mutationTimer = setTimeout(() => {
        const editors = collectEditors();
        if (signatureOf(editors) === state.lastSignature) return;
        const result = scan();
        if (!state.notified && result.state !== 'no-editor') {
          notifyResult(result);
          state.notified = true;
        }
      }, 800);
    });
    safe(() => observer.observe(document.documentElement, { childList: true, subtree: true }));
    state.observer = observer;

    setInterval(() => {
      if (location.href === state.url) return;
      state.url = location.href;
      state.lastEditor = null;
      state.notified = false;
      clearTimeout(state.scanTimer);
      state.scanTimer = setTimeout(() => {
        const result = scan();
        if (result.state !== 'no-editor') state.notified = true;
      }, 700);
    }, 1500);
  }

  function boot() {
    if (ui.host) return;
    buildPanel();
    const result = scan();
    if (result.state === 'no-editor') {
      ui.root.dataset.collapsed = 'true';
      state.autoCollapsed = true;
    } else {
      notifyResult(result);
      state.notified = true;
    }
    ui.host.hidden = false;
    updateCount();
    updateSendButton();
    updateTargetLabel();
    resolveAppReady();
    bridgeRequest('prefs:get', {}, 5000).then((prefs) => {
      if (prefs && prefs.mode === 'ai') setMode('ai');
    }).catch(() => {});

    startObservers();
    [2000, 5000].forEach((delay) => {
      setTimeout(() => {
        const next = scan();
        if (!state.notified && next.state !== 'no-editor') {
          notifyResult(next);
          state.notified = true;
        }
      }, delay);
    });
  }

  window.__CXH_APP__ = {
    ready: appReady,
    get shadow() { return ui.shadow; },
    get root() { return ui.root; },
    get panel() { return ui.panel; },
    get ui() { return ui; },
    bridgeRequest,
    startAI,
    insertTextIntoCurrentEditor,
    setMode,
    clampPanelPosition,
    isChaoxingUrl,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 600), { once: true });
  } else {
    setTimeout(boot, 600);
  }
})();
