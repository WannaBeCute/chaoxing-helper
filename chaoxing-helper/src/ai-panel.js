/**
 * 超星辅助助手 - AI 对话面板（页面主世界）
 *
 * 依赖 content.js 暴露的 window.__CXH_APP__：
 * - bridgeRequest / startAI：访问扩展后台
 * - insertTextIntoCurrentEditor：把 AI 答案填到当前光标
 *
 * 提供：AI 文本对话、对话列表、页面绑定、题目提取、图片/文档识别、
 * 对话缓存与简易多轮上下文。字体解码见 font-decode.js。
 */
(() => {
  'use strict';

  const app = window.__CXH_APP__;
  if (!app) return;
  if (window.__CXH_AI_PANEL_LOADED__) return;
  window.__CXH_AI_PANEL_LOADED__ = true;

  const CAP_BYTES = 8 * 1024 * 1024;
  const CAP_CHATS = 30;
  const MAX_TEXT_ATTACHMENT = 120000;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const KNOWN_AI_ACTIONS = new Set([
    'drawer', 'closeDrawer', 'refreshChats', 'new', 'newChat', 'extract', 'jump',
    'attach', 'send', 'stop', 'bannerSettings',
  ]);

  const state = {
    initialized: false,
    settings: null,
    prefs: null,
    chats: [],
    chat: null,
    messagesEl: null,
    inputEl: null,
    sendEl: null,
    attachments: [],
    streaming: null,
    vision: false,
    usage: null,
    draftTimer: 0,
    streamRenderTimer: 0,
    pendingStreamText: null,
    ocrBusy: false,
  };

  const AI_STYLES = `
    .cxh-ai-view { position: relative; overflow: hidden; }
    .cxh-ai-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: none;
      padding: 10px 12px;
      border-bottom: 1px solid #edf1f8;
      background: #fff;
    }
    .cxh-ai-heading { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .cxh-ai-heading strong {
      overflow: hidden;
      font-size: 12.5px;
      color: #24344f;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .cxh-ai-heading span {
      overflow: hidden;
      color: #8a97ab;
      font-size: 10px;
      white-space: nowrap;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .cxh-ai-icon {
      width: 28px; height: 28px; padding: 0; border: 1px solid #e2e8f4; border-radius: 8px;
      color: #4d6384; background: #fbfcff; font: 600 14px/1 "Microsoft YaHei", sans-serif;
      cursor: pointer; flex: none;
    }
    .cxh-ai-icon:hover { border-color: #b9ccf2; background: #f4f8ff; }
    .cxh-ai-icon:disabled { opacity: .45; cursor: not-allowed; }
    .cxh-ai-banner {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      flex: none; margin: 8px 12px 0; padding: 8px 10px; border-radius: 9px;
      border: 1px solid #f1d7a8; background: #fff8ec; color: #805200; font-size: 11px;
    }
    .cxh-ai-banner button {
      flex: none; border: 0; border-radius: 6px; padding: 4px 8px;
      background: #fff; color: #8a5600; font-size: 11px; cursor: pointer;
    }
    .cxh-ai-messages {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px;
      display: flex; flex-direction: column; gap: 10px;
      background: linear-gradient(180deg, #fbfdff 0%, #f7faff 100%);
    }
    .cxh-ai-empty {
      margin: auto; padding: 24px 10px; text-align: center; color: #8a97ab; font-size: 12px;
    }
    .cxh-ai-empty strong { display: block; margin-bottom: 6px; color: #4d6384; font-size: 13px; }
    .cxh-ai-msg { display: flex; flex-direction: column; gap: 4px; max-width: 100%; }
    .cxh-ai-msg.assistant { align-self: flex-start; width: fit-content; max-width: 92%; }
    .cxh-ai-msg.assistant .cxh-ai-msg-head { width: 100%; }
    .cxh-ai-msg.assistant .cxh-ai-msg-body { width: 100%; max-width: 100%; }
    .cxh-ai-msg-tokens {
      margin-left: auto; color: #98a2b3; font-weight: 400; font-size: 9.5px;
      white-space: nowrap; flex: none;
    }
    .cxh-ai-msg.user { align-items: flex-end; }
    .cxh-ai-msg-head { display: flex; align-items: center; gap: 6px; color: #8a97ab; font-size: 10px; }
    .cxh-ai-msg-body {
      max-width: 92%; padding: 8px 10px; border-radius: 10px;
      border: 1px solid #e4ebf7; background: #fff; color: #24344f;
      font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .cxh-ai-msg.user .cxh-ai-msg-body { background: #eef5ff; border-color: #d5e4fb; }
    .cxh-ai-msg.system .cxh-ai-msg-body { background: #fff8ec; border-color: #f1d7a8; color: #805200; }
    .cxh-ai-msg-actions { display: flex; gap: 8px; padding-left: 4px; }
    .cxh-ai-msg-actions button {
      border: 0; background: none; padding: 0; color: #2f6fed; font-size: 10.5px; cursor: pointer;
    }
    .cxh-ai-msg-actions button:hover { text-decoration: underline; }
    .cxh-ai-msg-attach { margin-top: 4px; color: #8a97ab; font-size: 10.5px; }
    .cxh-ai-cursor {
      display: inline-block; width: 7px; height: 13px; margin-left: 2px;
      vertical-align: -2px; background: #2f6fed; animation: cxh-ai-blink 1s steps(2) infinite;
    }
    @keyframes cxh-ai-blink { 50% { opacity: 0; } }
    .cxh-ai-composer {
      flex: none; padding: 10px 12px 11px; border-top: 1px solid #edf1f8; background: #fff;
      display: flex; flex-direction: column; gap: 7px;
    }
    .cxh-ai-chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .cxh-ai-chip {
      display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
      padding: 3px 7px; border-radius: 7px; background: #f3f7ff;
      border: 1px solid #dce8fb; color: #45608a; font-size: 10.5px;
    }
    .cxh-ai-chip span { overflow: hidden; max-width: 150px; white-space: nowrap; text-overflow: ellipsis; }
    .cxh-ai-chip button { border: 0; background: none; color: #8a97ab; cursor: pointer; font-size: 12px; line-height: 1; padding: 0; }
    .cxh-ai-input {
      width: 100%; min-height: 62px; max-height: 160px; padding: 8px 9px;
      border: 1px solid #dce4f2; border-radius: 9px; outline: none; resize: vertical;
      background: #fbfcff; color: #24344f;
      font: 12.5px/1.6 "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    }
    .cxh-ai-input:focus { border-color: #8db3f7; background: #fff; box-shadow: 0 0 0 3px rgba(47, 111, 237, .10); }
    .cxh-ai-tools {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    .cxh-ai-tools button {
      border: 1px solid #dce4f2; border-radius: 8px; height: 28px; padding: 0 9px;
      color: #45608a; background: #fff; font: 600 11px/1 "Microsoft YaHei", sans-serif; cursor: pointer;
    }
    .cxh-ai-tools button:hover { background: #f6f9ff; border-color: #b9ccf2; }
    .cxh-ai-tools button:disabled { opacity: .5; cursor: not-allowed; }
    .cxh-ai-tools .cxh-ai-send {
      margin-left: auto; border: 0; color: #fff;
      background: linear-gradient(135deg, #3b7bf2, #1f56c9);
      box-shadow: 0 6px 14px rgba(31, 86, 201, .22);
    }
    .cxh-ai-vision { display: inline-flex; align-items: center; gap: 4px; color: #5f7290; font-size: 10.5px; cursor: pointer; }
    .cxh-ai-vision input { width: 14px; height: 14px; accent-color: #2f6fed; }
    .cxh-ai-status { color: #98a2b3; font-size: 10.5px; flex: 1 1 100%; overflow-wrap: anywhere; }
    .cxh-ai-status.error { color: #a13232; }
    .cxh-ai-drawer, .cxh-ai-backdrop { position: absolute; inset: 0; z-index: 5; }
    .cxh-ai-backdrop { background: rgba(15, 32, 64, .24); }
    .cxh-ai-drawer-panel {
      position: absolute; inset: 0 auto 0 0; width: 86%; max-width: 360px; z-index: 6;
      display: flex; flex-direction: column; background: #fff; border-right: 1px solid #e2e8f4;
      box-shadow: 12px 0 30px rgba(16, 39, 86, .16);
    }
    .cxh-ai-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #edf1f8; font-size: 13px; }
    .cxh-ai-drawer-head button { border: 0; background: none; font-size: 18px; color: #8a97ab; cursor: pointer; }
    .cxh-ai-drawer-actions { display: flex; align-items: center; gap: 4px; }
    .cxh-ai-drawer-actions button {
      width: 26px; height: 26px; display: grid; place-items: center;
      border-radius: 6px; padding: 0; line-height: 1;
    }
    .cxh-ai-drawer-actions button:hover { color: #2f6fed; background: #f1f6ff; }
    .cxh-ai-drawer-actions .cxh-ai-refresh { font-size: 16px; }
    .cxh-ai-new-chat { margin: 10px 12px 6px; height: 32px; border: 1px dashed #b9ccf2; border-radius: 8px; color: #2f6fed; background: #f8fbff; font: 600 11.5px/1 "Microsoft YaHei", sans-serif; cursor: pointer; }
    .cxh-ai-chat-list { flex: 1; overflow-y: auto; padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 4px; }
    .cxh-ai-chat-item { padding: 7px 8px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; }
    .cxh-ai-chat-item:hover { background: #f6f9ff; }
    .cxh-ai-chat-item.is-active { background: #eef5ff; border-color: #d5e4fb; }
    .cxh-ai-chat-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11.5px; color: #2b3a55; }
    .cxh-ai-chat-title span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .cxh-ai-chat-actions { display: flex; gap: 2px; flex: none; }
    .cxh-ai-chat-actions button { border: 0; background: none; color: #8a97ab; font-size: 10px; cursor: pointer; padding: 1px 3px; }
    .cxh-ai-chat-actions button:hover { color: #2f6fed; }
    .cxh-ai-chat-meta { margin-top: 2px; color: #98a2b3; font-size: 9.5px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .cxh-ai-drawer-foot { padding: 9px 12px; border-top: 1px solid #edf1f8; color: #98a2b3; font-size: 10px; }
    .cxh-ai-modal { position: absolute; inset: 0; z-index: 8; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 32, 64, .28); }
    .cxh-ai-modal-card { width: 100%; max-width: 360px; max-height: 85%; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; background: #fff; box-shadow: 0 18px 44px rgba(16, 39, 86, .25); }
    .cxh-ai-modal-card strong { font-size: 12.5px; }
    .cxh-ai-modal-card input { width: 100%; height: 32px; padding: 0 9px; border: 1px solid #dce4f2; border-radius: 8px; outline: none; font: 12px/1.5 "Microsoft YaHei", sans-serif; }
    .cxh-ai-modal-text { flex: 1; min-height: 80px; max-height: 48vh; overflow: auto; margin: 0; padding: 9px; border: 1px solid #e2e8f4; border-radius: 8px; background: #fbfcff; color: #33415c; font: 11px/1.6 Consolas, "Microsoft YaHei", monospace; white-space: pre-wrap; }
    .cxh-ai-modal-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .cxh-ai-modal-actions button { height: 30px; padding: 0 10px; border: 1px solid #dce4f2; border-radius: 8px; background: #fff; color: #45608a; font: 600 11px/1 "Microsoft YaHei", sans-serif; cursor: pointer; }
    .cxh-ai-modal-actions button.primary { border: 0; color: #fff; background: linear-gradient(135deg, #3b7bf2, #1f56c9); }
    .cxh-ai-modal-actions button:disabled { opacity: .55; cursor: not-allowed; }
    .cxh-ai-note { color: #98a2b3; font-size: 10px; line-height: 1.6; }
    .cxh-ai-note.error { color: #a13232; }
    .cxh-ai-image-prompt {
      display: flex; flex-direction: column; gap: 7px; padding: 8px 9px;
      border: 1px solid #f1d7a8; border-radius: 8px; background: #fff8ec; color: #805200; font-size: 10.5px;
    }
    .cxh-ai-image-prompt .cxh-ai-modal-actions { justify-content: flex-start; }
    .cxh-ai-msg-body.markdown { white-space: normal; }
    .cxh-ai-msg-body.markdown > :first-child { margin-top: 0; }
    .cxh-ai-msg-body.markdown > :last-child { margin-bottom: 0; }
    .cxh-ai-msg-body.markdown p { margin: 5px 0; }
    .cxh-ai-msg-body.markdown h1,
    .cxh-ai-msg-body.markdown h2,
    .cxh-ai-msg-body.markdown h3,
    .cxh-ai-msg-body.markdown h4 { margin: 10px 0 5px; line-height: 1.4; color: #1b2a46; }
    .cxh-ai-msg-body.markdown h1 { font-size: 16px; }
    .cxh-ai-msg-body.markdown h2 { font-size: 14.5px; }
    .cxh-ai-msg-body.markdown h3 { font-size: 13.5px; }
    .cxh-ai-msg-body.markdown h4 { font-size: 12.5px; }
    .cxh-ai-msg-body.markdown ul,
    .cxh-ai-msg-body.markdown ol { margin: 5px 0; padding-left: 20px; }
    .cxh-ai-msg-body.markdown li { margin: 2px 0; }
    .cxh-ai-msg-body.markdown blockquote {
      margin: 6px 0; padding: 4px 8px; color: #5f7290;
      border-left: 3px solid #c9d8f3; background: #f7faff;
    }
    .cxh-ai-msg-body.markdown hr { border: 0; border-top: 1px solid #e4ebf7; margin: 8px 0; }
    .cxh-ai-msg-body.markdown table {
      display: block; width: 100%; margin: 7px 0; border-collapse: collapse;
      overflow-x: auto; font-size: 11px;
    }
    .cxh-ai-msg-body.markdown th,
    .cxh-ai-msg-body.markdown td { border: 1px solid #dce4f2; padding: 4px 6px; text-align: left; }
    .cxh-ai-msg-body.markdown th { background: #f2f6fc; font-weight: 600; }
    .cxh-ai-msg-body.markdown a { color: #2f6fed; text-decoration: underline; }
    .cxh-ai-msg-body.markdown img { max-width: 100%; height: auto; border-radius: 6px; margin: 4px 0; }
    .cxh-ai-msg-body.markdown code {
      font-family: Consolas, "SFMono-Regular", Menlo, monospace;
      font-size: 11px;
    }
    .cxh-ai-msg-body.markdown code:not(pre code) {
      padding: 1px 4px; border-radius: 4px; background: #f1f4f9; color: #b8336a;
    }
    .cxh-ai-msg-body.markdown pre {
      position: relative; margin: 7px 0; padding: 8px; overflow: auto;
      border: 1px solid #e1e8f3; border-radius: 8px; background: #f8fafc;
    }
    .cxh-ai-msg-body.markdown pre code {
      display: block; padding: 0; background: transparent; color: #24292e;
      white-space: pre; overflow-wrap: normal;
    }
    .cxh-code-copy {
      position: absolute; top: 5px; right: 5px; z-index: 1;
      height: 21px; padding: 0 6px; border: 1px solid #d5deeb; border-radius: 5px;
      background: rgba(255, 255, 255, .92); color: #5f7290;
      font: 10px/1 "Microsoft YaHei", sans-serif; cursor: pointer;
    }
    .cxh-code-copy:hover { color: #2f6fed; border-color: #b9ccf2; }
    .hljs { color: #24292e; background: transparent; }
    .hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: #d73a49; }
    .hljs-string, .hljs-regexp, .hljs-addition { color: #032f62; }
    .hljs-number, .hljs-variable, .hljs-template-variable, .hljs-attr { color: #005cc5; }
    .hljs-title, .hljs-title.class_, .hljs-title.function_ { color: #6f42c1; }
    .hljs-built_in, .hljs-symbol, .hljs-bullet { color: #e36209; }
    .hljs-meta, .hljs-deletion { color: #b31d28; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: 700; }
  `;

  function ready() {
    return app.ready.then(() => {
      injectStyles();
      build();
      bind();
      init();
      observePanelSize();
    });
  }

  function observePanelSize() {
    if (!window.ResizeObserver || !app.panel) return;
    const observer = new ResizeObserver(() => app.clampPanelPosition());
    observer.observe(app.panel);
  }

  function injectStyles() {
    if (!app.shadow) return;
    const style = document.createElement('style');
    style.textContent = AI_STYLES;
    app.shadow.appendChild(style);
  }

  function build() {
    const view = app.shadow.querySelector('[data-role="ai-view"]');
    if (!view || view.dataset.built === '1') return;
    view.dataset.built = '1';
    view.innerHTML = `
      <div class="cxh-ai-top">
        <button type="button" class="cxh-ai-icon" data-ai="drawer" title="对话列表">☰</button>
        <div class="cxh-ai-heading">
          <strong data-ai="title">新对话</strong>
          <span data-ai="binding">未绑定页面</span>
        </div>
        <button type="button" class="cxh-ai-icon" data-ai="jump" title="跳转到绑定页面">↗</button>
        <button type="button" class="cxh-ai-icon" data-ai="extract" title="提取当前页面题目">题</button>
        <button type="button" class="cxh-ai-icon" data-ai="new" title="新对话">＋</button>
      </div>
      <div class="cxh-ai-banner" data-ai="banner" hidden></div>
      <div class="cxh-ai-messages" data-ai="messages"></div>
      <div class="cxh-ai-composer">
        <div class="cxh-ai-chip-list" data-ai="attachments" hidden></div>
        <textarea class="cxh-ai-input" data-ai="input" placeholder="问点什么，或让 AI 完成当前页题目…"></textarea>
        <div class="cxh-ai-tools">
          <button type="button" data-ai="attach">+ 文件 / 图片</button>
          <label class="cxh-ai-vision" data-ai="visionWrap" hidden><input type="checkbox" data-ai="vision"> 模型识图</label>
          <span class="cxh-ai-status" data-ai="status"></span>
          <button type="button" class="cxh-ai-send" data-ai="send">发送</button>
        </div>
        <input type="file" multiple hidden data-ai="file">
      </div>
      <div class="cxh-ai-backdrop" data-ai="backdrop" hidden></div>
      <div class="cxh-ai-drawer" data-ai="drawerPanel" hidden>
        <div class="cxh-ai-drawer-panel">
          <div class="cxh-ai-drawer-head">
            <strong>对话</strong>
            <div class="cxh-ai-drawer-actions">
              <button type="button" class="cxh-ai-refresh" data-ai="refreshChats" title="刷新对话列表">↻</button>
              <button type="button" data-ai="closeDrawer" title="关闭">×</button>
            </div>
          </div>
          <button type="button" class="cxh-ai-new-chat" data-ai="newChat">＋ 新对话</button>
          <div class="cxh-ai-chat-list" data-ai="chatList"></div>
          <div class="cxh-ai-drawer-foot" data-ai="usage">统计中…</div>
        </div>
      </div>
      <div data-ai="modalRoot"></div>
    `;
    state.messagesEl = view.querySelector('[data-ai="messages"]');
    state.inputEl = view.querySelector('[data-ai="input"]');
    state.sendEl = view.querySelector('[data-ai="send"]');
  }

  function bind() {
    const view = app.shadow.querySelector('[data-role="ai-view"]');
    view.addEventListener('click', onClick);
    view.addEventListener('input', onInput);
    view.addEventListener('keydown', (event) => {
      if (event.target === state.inputEl && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    view.addEventListener('change', (event) => {
      if (event.target && event.target.matches('[data-ai="vision"]')) {
        state.vision = !!event.target.checked;
        updateAttachState();
        app.bridgeRequest('prefs:set', { patch: { vision: state.vision } }, 5000).catch(() => {});
        if (!state.vision) {
          const extract = extractModelName();
          if (extract) setStatus(`已关闭模型识图；上传的图片/文档将由 ${extract} 提取内容。`);
          else if (deepseekOcrAvailable()) setStatus('已关闭模型识图；图片/PDF/Word 将使用 DeepSeek OCR。');
          else setStatus('已关闭模型识图；未配置文件识别模型，图片上传已禁用。');
        }
      }
    });
    view.addEventListener('dragover', (event) => {
      if (!event.dataTransfer) return;
      const types = Array.from(event.dataTransfer.types || []);
      if (!types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
    });
    view.addEventListener('drop', (event) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      event.stopPropagation();
      addFiles(Array.from(event.dataTransfer.files || []));
    });
    view.addEventListener('paste', (event) => {
      if (event.target !== state.inputEl) return;
      const files = Array.from((event.clipboardData && event.clipboardData.files) || []);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      addFiles(files);
    }, true);
    const backdrop = view.querySelector('[data-ai="backdrop"]');
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    const fileInput = view.querySelector('[data-ai="file"]');
    fileInput.addEventListener('change', () => {
      addFiles(Array.from(fileInput.files || []));
      fileInput.value = '';
    });
    window.addEventListener('cxh-mode-change', (event) => {
      if (event.detail && event.detail.mode === 'ai') {
        if (app.root && app.root.dataset.collapsed !== 'true') {
          ensureLoaded();
          requestAnimationFrame(scrollToBottom);
        }
      }
    });
  }

  function onClick(event) {
    const el = event.target.closest('[data-ai]');
    if (el) {
      const action = el.dataset.ai;
      if (KNOWN_AI_ACTIONS.has(action)) {
        if (action === 'drawer') openDrawer();
        else if (action === 'closeDrawer') closeDrawer();
        else if (action === 'refreshChats') refreshChats();
        else if (action === 'new' || action === 'newChat') newChat();
        else if (action === 'extract') showExtraction();
        else if (action === 'jump') jumpToBound();
        else if (action === 'attach') {
          if (!state.vision && !imageExtractAvailable() && !deepseekOcrAvailable()) {
            setStatus('未开启多模态，且未配置文件识别模型，暂不支持文件上传。', true);
            return;
          }
          app.shadow.querySelector('[data-ai="file"]').click();
        }
        else if (action === 'send') sendMessage();
        else if (action === 'stop') stopStreaming();
        else if (action === 'bannerSettings') openSettings();
        return;
      }
    }

    const chatItem = event.target.closest('[data-chat-id]');
    if (chatItem) {
      const chatId = chatItem.dataset.chatId;
      const chatAction = event.target.closest('[data-chat-action]');
      if (chatAction) {
        event.stopPropagation();
        if (chatAction.dataset.chatAction === 'rename') renameChat(chatId);
        else if (chatAction.dataset.chatAction === 'delete') deleteChat(chatId);
        return;
      }
      selectChat(chatId);
      return;
    }

    const msgAction = event.target.closest('[data-msg-action]');
    if (msgAction) {
      const index = Number(msgAction.dataset.index);
      const message = state.chat && state.chat.messages[index];
      if (!message) return;
      if (msgAction.dataset.msgAction === 'copy') copyText(message.content);
      else if (msgAction.dataset.msgAction === 'fill') fillMessage(message.content);
      else if (msgAction.dataset.msgAction === 'regenerate') regenerateMessage(index);
    }
  }

  function onInput(event) {
    if (event.target === state.inputEl) updateSendState();
  }

  function setStatus(message, isError) {
    const el = app.shadow.querySelector('[data-ai="status"]');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
  }

  function openSettings() {
    app.bridgeRequest('openOptions').catch((error) => setStatus(error.message, true));
  }

  function jumpToBound() {
    if (!state.chat || !state.chat.boundUrl) return;
    if (state.chat.boundUrl === location.href) return;
    app.bridgeRequest('openUrl', { url: state.chat.boundUrl }).catch((error) => setStatus(error.message, true));
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    updateSendState();
    updateAttachState();
    if (app.root && app.root.dataset.mode === 'ai' && app.root.dataset.collapsed !== 'true') {
      ensureLoaded();
    }
  }

  async function ensureLoaded() {
    if (!state.settings) {
      try {
        state.settings = await app.bridgeRequest('settings:get');
      } catch (error) {
        setStatus(error.message, true);
        return;
      }
      if (state.settings.supportsVision) {
        const wrap = app.shadow.querySelector('[data-ai="visionWrap"]');
        if (wrap) wrap.hidden = false;
      }
      if (state.settings.autoDeleteDays > 0) {
        app.bridgeRequest('chat:cleanup', { days: state.settings.autoDeleteDays }).catch(() => {});
      }
    }
    if (!state.prefs) {
      try {
        state.prefs = await app.bridgeRequest('prefs:get');
      } catch (error) {
        state.prefs = { mode: 'fill', vision: false, lastChatId: '' };
      }
      const canVision = !!(state.settings && state.settings.supportsVision);
      state.vision = !!(state.prefs.vision && canVision);
      const visionBox = app.shadow.querySelector('[data-ai="vision"]');
      if (visionBox) visionBox.checked = state.vision;
      updateAttachState();
    }
    if (!state.chat) {
      await loadChats();
    }
    renderBanner();
  }

  async function loadChats() {
    try {
      state.chats = await app.bridgeRequest('chat:list');
    } catch (error) {
      setStatus(error.message, true);
      state.chats = [];
      return;
    }
    if (!state.chats.length) {
      await createDraftChat();
      renderChatList();
      updateUsage();
      return;
    }
    const bound = state.chats
      .filter((item) => item.boundUrl === location.href)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    if (bound.length) {
      await selectChat(bound[0].id);
    } else {
      await createDraftChat();
    }
    renderChatList();
    updateUsage();
  }

  function uniqueTitle(base, excludeId) {
    const value = String(base || '新对话').trim().slice(0, 60) || '新对话';
    const titles = new Set((state.chats || [])
      .filter((item) => item.id !== excludeId)
      .map((item) => item.title)
      .filter(Boolean));
    if (!titles.has(value)) return value;
    let index = 2;
    while (titles.has(`${value} ${index}`)) index += 1;
    return `${value} ${index}`;
  }

  async function createDraftChat() {
    if (state.streaming) return;
    const pageTitle = document.title || location.hostname;
    let memory = '';
    try {
      memory = (await extractQuestions()).slice(0, 20000);
    } catch (error) {
      memory = '';
    }
    const chat = {
      id: '',
      isDraft: true,
      title: uniqueTitle('新对话'),
      boundUrl: location.href,
      boundTitle: pageTitle,
      memory: memory ? `【当前页面题目】\n${memory}` : '',
      memoryUpdatedAt: memory ? Date.now() : 0,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.chat = chat;
    state.inputEl.value = '';
    state.attachments = [];
    closeDrawer();
    renderAttachments();
    renderChat();
    renderHeading();
    renderChatList();
    updateSendState();
    setStatus('新对话已准备好，发送第一条消息后才会保存并绑定当前页面。');
  }

  async function newChat() {
    await createDraftChat();
  }

  async function selectChat(id) {
    if (!id) return;
    if (state.streaming) {
      setStatus('请先停止当前回答再切换对话。', true);
      return;
    }
    try {
      const chat = await app.bridgeRequest('chat:get', { id });
      if (!chat) return;
      state.chat = chat;
      state.prefs = { ...(state.prefs || {}), lastChatId: chat.id };
      app.bridgeRequest('prefs:set', { patch: { lastChatId: chat.id } }, 5000).catch(() => {});
      state.attachments = [];
      closeDrawer();
      renderChat();
      renderHeading();
      renderAttachments();
      renderChatList();
      updateSendState();
      requestAnimationFrame(scrollToBottom);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function persistChat() {
    if (!state.chat || state.chat.isDraft) return;
    state.chat.updatedAt = Date.now();
    // 只持久化对话文本与附件名称；附件正文/图片 dataURL 仅保留在当前页面内存中。
    const payload = {
      ...state.chat,
      messages: (state.chat.messages || []).map((item) => ({
        role: item.role,
        content: item.content,
        display: item.display,
        attachments: item.attachments,
        extracted: item.extracted,
        usage: item.usage,
        ts: item.ts,
      })),
    };
    try {
      await app.bridgeRequest('chat:save', { chat: payload });
      state.chats = await app.bridgeRequest('chat:list');
      renderChatList();
      updateUsage();
      renderBanner();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function renameChat(id) {
    const target = state.chats.find((item) => item.id === id);
    if (!target) return;
    const value = await promptDialog('重命名对话', target.title || '未命名对话', '对话名称');
    if (value == null) return;
    const title = value.trim().slice(0, 80);
    if (!title) return;
    try {
      await app.bridgeRequest('chat:rename', { id, title });
      if (state.chat && state.chat.id === id) state.chat.title = title;
      state.chats = await app.bridgeRequest('chat:list');
      renderChatList();
      renderHeading();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function deleteChat(id) {
    if (state.streaming && state.chat && state.chat.id === id) {
      setStatus('请先停止当前回答再删除对话。', true);
      return;
    }
    if (!confirm('确定删除这个对话吗？此操作不可恢复。')) return;
    try {
      await app.bridgeRequest('chat:delete', { id });
      state.chats = await app.bridgeRequest('chat:list');
      if (state.chat && state.chat.id === id) {
        state.chat = null;
        await loadChats();
      }
      renderChatList();
      updateUsage();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function renderHeading() {
    const titleEl = app.shadow.querySelector('[data-ai="title"]');
    const bindingEl = app.shadow.querySelector('[data-ai="binding"]');
    const jumpEl = app.shadow.querySelector('[data-ai="jump"]');
    if (!titleEl || !bindingEl) return;
    if (!state.chat) {
      titleEl.textContent = '未选择对话';
      bindingEl.textContent = '未绑定页面';
      if (jumpEl) jumpEl.disabled = true;
      return;
    }
    titleEl.textContent = state.chat.title || '新对话';
    const same = state.chat.boundUrl === location.href;
    const page = state.chat.boundTitle || state.chat.boundUrl || '未绑定页面';
    if (state.chat.isDraft) {
      bindingEl.textContent = `新对话：${page}（发送后绑定，点击修改）`;
      bindingEl.title = `发送第一条消息后才会保存并绑定当前页面\n当前页：${location.href}`;
      bindingEl.onclick = () => showBindingDialog();
      if (jumpEl) {
        jumpEl.disabled = true;
        jumpEl.title = '发送后才会绑定页面';
      }
      return;
    }
    bindingEl.textContent = `记忆页面：${page}${same ? '（当前页）' : '（点击修改/跳转）'}`;
    bindingEl.title = `${state.chat.boundUrl || '未绑定'}\n当前页：${location.href}`;
    bindingEl.onclick = () => showBindingDialog();
    if (jumpEl) {
      const canJump = !!(state.chat.boundUrl && !same);
      jumpEl.disabled = !canJump;
      jumpEl.title = canJump ? '跳转到绑定页面' : (same ? '已在绑定页面' : '未绑定页面');
    }
  }

  function appendCursor(body) {
    if (!body || body.querySelector('.cxh-ai-cursor')) return;
    const cursor = document.createElement('span');
    cursor.className = 'cxh-ai-cursor';
    body.appendChild(cursor);
  }

  function decorateCodeBlocks(body) {
    if (!body) return;
    body.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.cxh-code-copy')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cxh-code-copy';
      button.textContent = '复制';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const code = pre.querySelector('code');
        copyText(code ? code.textContent : pre.textContent);
      });
      pre.appendChild(button);
    });
  }

  async function renderMarkdownInto(body, text, streaming) {
    if (!body) return;
    const seq = Number(body.dataset.renderSeq || 0) + 1;
    body.dataset.renderSeq = String(seq);
    try {
      const html = await app.bridgeRequest('markdown:render', { text: String(text || '') }, 10000);
      if (!body.isConnected || Number(body.dataset.renderSeq) !== seq) return;
      body.classList.add('markdown');
      body.innerHTML = html;
      decorateCodeBlocks(body);
      if (streaming) appendCursor(body);
      scrollToBottom();
    } catch (error) {
      if (!body.isConnected || Number(body.dataset.renderSeq) !== seq) return;
      body.textContent = String(text || '');
      if (streaming) appendCursor(body);
    }
  }

  function findStreamingBody() {
    if (!state.messagesEl) return null;
    const bodies = state.messagesEl.querySelectorAll('.cxh-ai-msg.assistant .cxh-ai-msg-body');
    return bodies.length ? bodies[bodies.length - 1] : null;
  }

  function scheduleStreamRender(text) {
    state.pendingStreamText = text;
    if (state.streamRenderTimer) return;
    state.streamRenderTimer = setTimeout(() => {
      state.streamRenderTimer = 0;
      const body = findStreamingBody();
      const value = state.pendingStreamText;
      state.pendingStreamText = null;
      if (body && value != null) renderMarkdownInto(body, value, true);
    }, 90);
  }

  function renderChat() {
    const box = state.messagesEl;
    if (!box) return;
    box.textContent = '';
    if (!state.chat) {
      box.innerHTML = '<div class="cxh-ai-empty"><strong>AI 对话</strong>选择一个对话或新建对话开始。</div>';
      return;
    }
    if (!state.chat.messages.length) {
      box.innerHTML = '<div class="cxh-ai-empty"><strong>让 AI 看看当前页面</strong>可以直接提问，或在输入框里要求 AI 完成当前页题目。</div>';
      return;
    }
    const markdownTasks = [];
    let cumulativeTokens = 0;
    state.chat.messages.forEach((message, index) => {
      const item = document.createElement('div');
      item.className = 'cxh-ai-msg ' + (message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user');
      const head = document.createElement('div');
      head.className = 'cxh-ai-msg-head';
      head.textContent = message.role === 'assistant' ? 'AI' : message.role === 'system' ? '提示' : '你';
      if (message.role === 'assistant' && message.usage) {
        const promptTokens = Number(message.usage.prompt_tokens ?? message.usage.input_tokens) || 0;
        const completionTokens = Number(message.usage.completion_tokens ?? message.usage.output_tokens) || 0;
        const totalTokens = Number(message.usage.total_tokens) || (promptTokens + completionTokens);
        if (totalTokens > 0) {
          cumulativeTokens += totalTokens;
          const tokenEl = document.createElement('span');
          tokenEl.className = 'cxh-ai-msg-tokens';
          tokenEl.textContent = `本次 ${totalTokens.toLocaleString('zh-CN')} · 累计 ${cumulativeTokens.toLocaleString('zh-CN')} tokens`;
          tokenEl.title = `输入 ${promptTokens.toLocaleString('zh-CN')} / 输出 ${completionTokens.toLocaleString('zh-CN')}`;
          head.appendChild(tokenEl);
        }
      }
      const body = document.createElement('div');
      body.className = 'cxh-ai-msg-body';
      if (message.role === 'assistant') {
        markdownTasks.push({ body, content: message.content || '', streaming: !!message.streaming });
      } else {
        body.textContent = message.display || message.content || '';
      }
      item.appendChild(head);
      if (message.extracted) {
        const note = document.createElement('div');
        note.className = 'cxh-ai-msg-attach';
        note.textContent = '本次已附带当前页题目文本（字体已解码）';
        item.appendChild(note);
      }
      if (message.attachments && message.attachments.length) {
        const note = document.createElement('div');
        note.className = 'cxh-ai-msg-attach';
        note.textContent = '附件：' + message.attachments.map((file) => file.name).join('、');
        item.appendChild(note);
      }
      item.appendChild(body);
      if (message.role === 'assistant' && message.content && !message.streaming) {
        const actions = document.createElement('div');
        actions.className = 'cxh-ai-msg-actions';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.dataset.msgAction = 'copy';
        copy.dataset.index = String(index);
        copy.textContent = '复制';
        const fill = document.createElement('button');
        fill.type = 'button';
        fill.dataset.msgAction = 'fill';
        fill.dataset.index = String(index);
        fill.textContent = '填入当前光标';
        actions.append(copy, fill);
        if (index === state.chat.messages.length - 1) {
          const regen = document.createElement('button');
          regen.type = 'button';
          regen.dataset.msgAction = 'regenerate';
          regen.dataset.index = String(index);
          regen.textContent = '重新生成';
          actions.appendChild(regen);
        }
        item.appendChild(actions);
      }
      box.appendChild(item);
    });
    markdownTasks.forEach((task) => {
      renderMarkdownInto(task.body, task.content, task.streaming);
    });
    scrollToBottom();
  }

  function scrollToBottom() {
    if (state.messagesEl) state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
  }

  function renderChatList() {
    const list = app.shadow.querySelector('[data-ai="chatList"]');
    if (!list) return;
    list.textContent = '';
    state.chats.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cxh-ai-chat-item' + (state.chat && state.chat.id === item.id ? ' is-active' : '');
      row.dataset.chatId = item.id;
      const title = document.createElement('div');
      title.className = 'cxh-ai-chat-title';
      const text = document.createElement('span');
      text.textContent = item.title || '未命名对话';
      const actions = document.createElement('div');
      actions.className = 'cxh-ai-chat-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.dataset.chatAction = 'rename';
      rename.textContent = '改名';
      const del = document.createElement('button');
      del.type = 'button';
      del.dataset.chatAction = 'delete';
      del.textContent = '删除';
      actions.append(rename, del);
      title.append(text, actions);
      const meta = document.createElement('div');
      meta.className = 'cxh-ai-chat-meta';
      const page = item.boundTitle || '';
      meta.textContent = `${page ? page + ' · ' : ''}${item.messageCount || 0} 条 · ${formatTime(item.updatedAt)}`;
      row.append(title, meta);
      list.appendChild(row);
    });
  }

  function formatTime(timestamp) {
    const value = Number(timestamp) || 0;
    if (!value) return '';
    const date = new Date(value);
    return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function renderBanner() {
    const banner = app.shadow.querySelector('[data-ai="banner"]');
    if (!banner) return;
    const noApi = state.settings && !state.settings.hasApiKey && state.settings.provider !== 'ollama';
    const usage = state.usage;
    const overCap = usage && (usage.bytes > CAP_BYTES || usage.chats > CAP_CHATS);
    if (!noApi && !overCap) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.textContent = '';
    const text = document.createElement('span');
    text.textContent = noApi
      ? '尚未配置 AI，请到设置填写 API Key / Endpoint / Model。'
      : '对话缓存较大，请在设置中清理旧对话。';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.ai = 'bannerSettings';
    button.textContent = noApi ? '打开设置' : '清理缓存';
    banner.append(text, button);
  }

  async function updateUsage() {
    try {
      state.usage = await app.bridgeRequest('storage:usage', {}, 5000);
      const foot = app.shadow.querySelector('[data-ai="usage"]');
      if (foot) {
        foot.textContent = `${formatBytes(state.usage.bytes)} / 8 MB · ${state.usage.chats} / ${CAP_CHATS} 个对话`;
      }
      renderBanner();
    } catch (error) {
      /* usage is optional */
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1024 / 1024).toFixed(2) + ' MB';
  }

  function openDrawer() {
    const panel = app.shadow.querySelector('[data-ai="drawerPanel"]');
    const backdrop = app.shadow.querySelector('[data-ai="backdrop"]');
    if (panel) panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    renderChatList();
    updateUsage();
  }

  function closeDrawer() {
    const panel = app.shadow.querySelector('[data-ai="drawerPanel"]');
    const backdrop = app.shadow.querySelector('[data-ai="backdrop"]');
    if (panel) panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }

  async function refreshChats() {
    try {
      state.chats = await app.bridgeRequest('chat:list');
      if (state.chat && !state.chat.isDraft) {
        const meta = state.chats.find((item) => item.id === state.chat.id);
        if (meta) {
          state.chat.title = meta.title || state.chat.title;
          state.chat.boundUrl = meta.boundUrl || state.chat.boundUrl;
          state.chat.boundTitle = meta.boundTitle || state.chat.boundTitle;
          renderHeading();
        }
      }
      renderChatList();
      updateUsage();
      setStatus('对话列表已刷新。');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function updateSendState() {
    if (!state.sendEl) return;
    if (state.ocrBusy) {
      state.sendEl.disabled = true;
      state.sendEl.dataset.ai = 'send';
      state.sendEl.textContent = '识别中…';
      return;
    }
    if (state.streaming) {
      state.sendEl.disabled = false;
      state.sendEl.dataset.ai = 'stop';
      state.sendEl.textContent = '停止';
      return;
    }
    const hasInput = state.inputEl && state.inputEl.value.trim().length > 0;
    state.sendEl.disabled = !hasInput && !state.attachments.length;
    state.sendEl.dataset.ai = 'send';
    state.sendEl.textContent = '发送';
  }

  function deepseekOcrAvailable() {
    const settings = state.settings;
    if (!settings || !settings.hasApiKey) return false;
    return settings.provider === 'deepseek'
      || /api\.deepseek\.com/i.test(String(settings.endpoint || ''));
  }

  function extractModelName() {
    return String((state.settings && state.settings.extractModel) || '').trim();
  }

  function isDeepSeekEndpoint() {
    return !!state.settings && /api\.deepseek\.com/i.test(String(state.settings.endpoint || ''));
  }

  function modelApiReady() {
    const settings = state.settings;
    return !!settings && (!!settings.hasApiKey || settings.provider === 'ollama');
  }

  function imageExtractAvailable() {
    const settings = state.settings;
    return !!settings && modelApiReady()
      && (!!extractModelName() || !!settings.supportsVision);
  }

  function documentExtractAvailable() {
    if (!state.settings || !modelApiReady()) return false;
    if (extractModelName() && isDeepSeekEndpoint()) return true;
    return deepseekOcrAvailable();
  }

  function questionImageModel() {
    const settings = state.settings;
    if (!settings || !modelApiReady()) return '';
    return extractModelName() || (settings.supportsVision ? String(settings.model || '').trim() : '');
  }

  function updateAttachState() {
    const attach = app.shadow.querySelector('[data-ai="attach"]');
    if (!attach) return;
    const vision = !!state.vision;
    const extract = extractModelName();
    const ocr = deepseekOcrAvailable();
    const enabled = vision || imageExtractAvailable() || ocr;
    attach.disabled = !enabled;
    if (!enabled) {
      attach.title = '未开启多模态，且未配置文件识别模型，暂不支持文件上传';
      return;
    }
    if (extract) {
      attach.title = `上传图片/PDF/Word：使用 ${extract} 提取内容（会消耗 API）；附件只用于当前页面`;
      return;
    }
    attach.title = ocr
      ? '上传图片/PDF/Word：图片可识图，文档使用 DeepSeek OCR（会消耗 API）'
      : '上传图片或文本文件；附件只用于当前页面，刷新后清除';
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const index = result.indexOf(',');
        resolve(index >= 0 ? result.slice(index + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  function addFiles(files) {
    if (!files.length) return;
    const extract = extractModelName();
    const ocr = deepseekOcrAvailable();
    if (!state.vision && !imageExtractAvailable() && !ocr) {
      setStatus('未开启多模态，且未配置文件识别模型，暂不支持文件上传。', true);
      return;
    }
    setStatus('');
    files.forEach((file) => {
      if (file.size <= 0) return;
      const lower = String(file.name || '').toLowerCase();
      const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(lower);
      if (isImage) {
        if (imageExtractAvailable() || state.vision) {
          const limit = imageExtractAvailable() ? 10 * 1024 * 1024 : MAX_IMAGE_BYTES;
          if (file.size > limit) {
            setStatus(`图片「${file.name}」超过 ${Math.round(limit / 1024 / 1024)}MB，已跳过。`, true);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            state.attachments.push({
              id: `att_${Date.now()}_${Math.random()}`,
              kind: 'image',
              name: file.name || '图片',
              dataUrl: String(reader.result || ''),
            });
            renderAttachments();
            updateSendState();
          };
          reader.readAsDataURL(file);
          return;
        }
        if (ocr) {
          if (file.size > 20 * 1024 * 1024) {
            setStatus(`图片「${file.name}」超过 20MB，已跳过。`, true);
            return;
          }
          state.attachments.push({
            id: `att_${Date.now()}_${Math.random()}`,
            kind: 'document',
            name: file.name || '图片',
            type: file.type || 'image/png',
            file,
          });
          renderAttachments();
          updateSendState();
          return;
        }
        setStatus('当前未配置文件识别模型，也未开启模型识图，图片无法识别。', true);
        return;
      }
      if (/\.(txt|md|csv|json|log|xml|html?)$/.test(lower)) {
        if (file.size > 1024 * 1024) {
          setStatus(`文件「${file.name}」超过 1MB，已跳过。`, true);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || '').slice(0, MAX_TEXT_ATTACHMENT);
          state.attachments.push({
            id: `att_${Date.now()}_${Math.random()}`,
            kind: 'text',
            name: file.name || '文本文件',
            text,
          });
          renderAttachments();
          updateSendState();
        };
        reader.readAsText(file);
        return;
      }
      if (/\.(pdf|docx?|pptx?)$/.test(lower)) {
        if (!documentExtractAvailable()) {
          setStatus('PDF/Word/PPT 需要 DeepSeek 文件识别模型或 DeepSeek OCR，当前不可用。', true);
          return;
        }
        if (file.size > 100 * 1024 * 1024) {
          setStatus(`文件「${file.name}」超过 100MB，已跳过。`, true);
          return;
        }
        state.attachments.push({
          id: `att_${Date.now()}_${Math.random()}`,
          kind: 'document',
          name: file.name || '文档',
          type: file.type || 'application/octet-stream',
          file,
        });
        renderAttachments();
        updateSendState();
        return;
      }
      setStatus('暂不支持该文件格式；支持图片、PDF、Word、PPT 和纯文本文件。', true);
    });
  }

  function renderAttachments() {
    const box = app.shadow.querySelector('[data-ai="attachments"]');
    if (!box) return;
    box.textContent = '';
    box.hidden = !state.attachments.length;
    state.attachments.forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'cxh-ai-chip';
      const label = document.createElement('span');
      label.textContent = item.kind === 'image'
        ? `图片：${item.name}`
        : item.kind === 'text'
          ? `文本：${item.name}`
          : `文档：${item.name}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        state.attachments = state.attachments.filter((file) => file.id !== item.id);
        renderAttachments();
        updateSendState();
      });
      chip.append(label, remove);
      box.appendChild(chip);
    });
  }

  function currentQuestionText() {
    return extractQuestions();
  }

  async function extractQuestions() {
    const raw = extractQuestionsRaw();
    if (!raw) return '';
    const decoder = window.__CXH_FONT__;
    if (!decoder) return raw;
    try {
      return await decoder.decode(raw);
    } catch (error) {
      return raw;
    }
  }

  function collectQuestionDocuments() {
    const docs = [];
    const seen = new Set();
    const visit = (doc) => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      docs.push(doc);
      try {
        doc.querySelectorAll('iframe').forEach((frame) => {
          let child = null;
          try { child = frame.contentDocument; } catch (error) { child = null; }
          if (child) visit(child);
        });
      } catch (error) {
        /* cross-origin or detached iframe */
      }
    };
    visit(document);
    return docs;
  }

  function collectQuestionNodes() {
    const questions = [];
    collectQuestionDocuments().forEach((doc) => {
      try {
        const questionLi = Array.from(doc.querySelectorAll('.questionLi'));
        if (questionLi.length) {
          questionLi.forEach((node) => questions.push({ node, type: 'questionLi', doc }));
          return;
        }
        doc.querySelectorAll('.TiMu').forEach((node) => questions.push({ node, type: 'TiMu', doc }));
      } catch (error) {
        /* ignore inaccessible document */
      }
    });
    return questions;
  }

  function extractQuestionsRaw() {
    const questions = collectQuestionNodes();
    if (!questions.length) return '';
    const blocks = [];
    questions.forEach(({ node, type }, index) => {
      if (type === 'TiMu') {
        const text = String(node.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        const images = Array.from(node.querySelectorAll('img')).map(() => '[图片：待 OCR/多模态识别]');
        const inputs = Array.from(node.querySelectorAll('input[type="text"], textarea'))
          .map((input) => String(input.value || '').trim())
          .filter(Boolean);
        const parts = [text];
        if (inputs.length) parts.push(`已填写：${inputs.join('；')}`);
        if (images.length) parts.push(...images);
        blocks.push(parts.join('\n'));
        return;
      }
      const titleEl = node.querySelector('h3');
      const title = titleEl ? String(titleEl.innerText || '').replace(/\s+/g, ' ').trim() : '';
      const options = Array.from(node.querySelectorAll('.answerBg, .answer_item, .options li'))
        .map((option) => String(option.innerText || '').replace(/^\s*[A-Za-z][.、]\s*/, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const inputs = Array.from(node.querySelectorAll('input[type="text"], textarea'))
        .map((input) => String(input.value || '').trim())
        .filter(Boolean);
      const images = Array.from(node.querySelectorAll('img')).map(() => '[图片：待 OCR/多模态识别]');
      const lines = [`第 ${index + 1} 题`];
      if (title) lines.push(title);
      options.forEach((option, optionIndex) => {
        lines.push(`${String.fromCharCode(65 + optionIndex)}. ${option}`);
      });
      if (inputs.length) lines.push(`已填写：${inputs.join('；')}`);
      if (images.length) lines.push(...images);
      blocks.push(lines.join('\n'));
    });
    return blocks.join('\n\n');
  }

  function resolveQuestionImageSrc(img, doc) {
    const raw = String(
      img.currentSrc
      || img.src
      || img.getAttribute('data-src')
      || img.getAttribute('data-original')
      || '',
    ).trim();
    if (!raw) return '';
    if (/^(data:image\/|blob:)/i.test(raw)) return raw;
    try {
      return new URL(raw, (doc && doc.baseURI) || location.href).href;
    } catch (error) {
      return '';
    }
  }

  function collectQuestionImages() {
    const images = [];
    const seen = new Set();
    collectQuestionNodes().forEach(({ node, doc }, index) => {
      let list = [];
      try {
        list = Array.from(node.querySelectorAll('img'));
      } catch (error) {
        list = [];
      }
      list.forEach((img) => {
        const src = resolveQuestionImageSrc(img, doc);
        if (!src || seen.has(src)) return;
        if (/^data:image\/gif;base64,R0lGODlhAQABA/i.test(src)) return;
        const width = Number(img.naturalWidth || img.width || 0);
        const height = Number(img.naturalHeight || img.height || 0);
        if (width && height && width <= 12 && height <= 12) return;
        const marker = `${img.className || ''} ${img.id || ''} ${img.alt || ''}`;
        if (/\b(icon|logo|avatar|emoji|loading|spacer)\b/i.test(marker)) return;
        seen.add(src);
        images.push({
          src,
          alt: String(img.alt || '').trim(),
          questionIndex: index + 1,
        });
      });
    });
    return images;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function questionImagePayload(image) {
    if (/^data:image\//i.test(image.src)) return { dataUrl: image.src };
    if (/^blob:/i.test(image.src)) {
      const response = await fetch(image.src);
      const blob = await response.blob();
      return { dataUrl: await blobToDataUrl(blob) };
    }
    return { url: image.src };
  }

  function shouldReadCurrentQuestions(text) {
    return /(完成|做|答|写|解).{0,14}(题|作业|一下)|答案|这页|本页|当前页|更新题目|重新读取题目|提取题目|更新记忆/.test(String(text || ''));
  }

  function believeApiReady() {
    return state.settings && (state.settings.hasApiKey || state.settings.provider === 'ollama');
  }

  function buildSystemPrompt() {
    return [
      '你是“超星辅助助手”的 AI 学习助手。请用中文、条理清晰地回答，直接给出可执行的解答。',
      `当前对话绑定页面：${state.chat.boundUrl || '未绑定'}（${state.chat.boundTitle || ''}）。`,
      state.chat.memory ? `绑定页面的题目记忆：\n${state.chat.memory}` : '',
      `你当前访问的页面：${location.href}`,
      '如果当前页与绑定页不同，仅把本次用户消息中的当前页题目用于本次回答，不要修改绑定记忆。',
    ].filter(Boolean).join('\n');
  }

  function historyMessage(item) {
    return {
      role: item.role,
      content: item.role === 'user' && item.sessionContext
        ? `${item.content}\n\n${item.sessionContext}`
        : item.content,
      images: item.role === 'user' && state.vision && Array.isArray(item.sessionImages) && item.sessionImages.length
        ? item.sessionImages
        : undefined,
    };
  }

  function startAssistant(apiMessages) {
    if (!state.chat) return;
    const assistant = { role: 'assistant', content: '', streaming: true, ts: Date.now() };
    state.chat.messages.push(assistant);
    renderChat();
    setStatus('AI 正在回答…');
    state.streaming = app.startAI(apiMessages, {
      onChunk(delta) {
        assistant.content += delta;
        scheduleStreamRender(assistant.content);
      },
      onUsage(usage) {
        if (usage) assistant.usage = usage;
      },
      onDone() {
        if (state.streamRenderTimer) {
          clearTimeout(state.streamRenderTimer);
          state.streamRenderTimer = 0;
        }
        state.pendingStreamText = null;
        assistant.streaming = false;
        state.streaming = null;
        setStatus('');
        renderChat();
        updateSendState();
        persistChat();
      },
      onError(error) {
        if (state.streamRenderTimer) {
          clearTimeout(state.streamRenderTimer);
          state.streamRenderTimer = 0;
        }
        state.pendingStreamText = null;
        assistant.streaming = false;
        state.streaming = null;
        const detail = error.message || '未知错误';
        const hint = /设置|API Key|Endpoint|Model/i.test(detail)
          ? ''
          : '。请到设置检查 API Key、Endpoint 和 Model。';
        if (!assistant.content) {
          assistant.role = 'system';
          assistant.content = `AI 调用失败：${detail}${hint}`;
        } else {
          assistant.content += `\n\n[AI 调用中断：${detail}${hint}]`;
        }
        renderChat();
        updateSendState();
        setStatus(`AI 调用失败：${detail}${hint}`, true);
        persistChat();
      },
    });
    updateSendState();
  }

  async function regenerateMessage(index) {
    if (state.streaming || !state.chat) return;
    let userIndex = -1;
    for (let i = Math.min(index, state.chat.messages.length - 1); i >= 0; i -= 1) {
      if (state.chat.messages[i].role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;
    const user = state.chat.messages[userIndex];
    state.chat.messages = state.chat.messages.slice(0, userIndex + 1);
    const history = state.chat.messages
      .slice(0, userIndex)
      .filter((item) => !item.streaming)
      .slice(-19)
      .map(historyMessage);
    const turnContent = user.sessionTurnContent
      || `${user.content || ''}${user.sessionContext ? '\n\n' + user.sessionContext : ''}`;
    const images = Array.isArray(user.sessionImages) ? user.sessionImages : [];
    const apiMessages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: turnContent, images: images.length ? images : undefined },
    ];
    renderChat();
    startAssistant(apiMessages);
  }

  async function sendMessage() {
    if (state.streaming || state.ocrBusy) return;
    if (!state.chat) await ensureLoaded();
    if (!state.chat) {
      setStatus('对话尚未准备好，请稍后重试。', true);
      return;
    }
    if (!believeApiReady()) {
      renderBanner();
      setStatus('请先在设置中填写有效的 API。', true);
      return;
    }
    const typed = state.inputEl.value.trim();
    if (!typed && !state.attachments.length) return;

    // 附件内容只用于当前页面内的对话，不写入 chrome.storage；刷新后清除。
    let turnContent = typed || '请查看附件内容。';
    let fileContext = '';
    const storedContent = typed || '（附件）';
    const display = typed || '（附件）';
    const attachments = state.attachments.map((item) => ({ name: item.name, kind: item.kind }));
    const imageAttachments = state.attachments.filter((item) => item.kind === 'image' && item.dataUrl);
    const appendBlock = (block) => {
      fileContext += (fileContext ? '\n\n' : '') + block;
      turnContent += `\n\n${block}`;
    };
    state.attachments.filter((item) => item.kind === 'text').forEach((item) => {
      appendBlock(`【附件：${item.name}】\n${item.text}`);
    });

    const extract = extractModelName();
    let nativeImages = [];
    if (imageAttachments.length) {
      if (extract) {
        state.ocrBusy = true;
        updateSendState();
        try {
          for (let i = 0; i < imageAttachments.length; i += 1) {
            const image = imageAttachments[i];
            setStatus(`正在调用 ${extract} 识别图片「${image.name}」（${i + 1}/${imageAttachments.length}）…`);
            let result;
            try {
              result = await app.bridgeRequest('extractImageText', {
                dataUrl: image.dataUrl,
                name: image.name,
              }, 240000);
            } catch (error) {
              setStatus(`图片识别失败：${error.message}`, true);
              return;
            }
            if (!result || !result.ok) {
              setStatus(`图片识别失败：${result && result.error || '未知错误'}`, true);
              return;
            }
            appendBlock(`【图片识别（${extract}）：${image.name}】\n${String(result.text || '').trim() || '（未识别到文字）'}`);
          }
        } finally {
          state.ocrBusy = false;
          updateSendState();
        }
      } else if (state.vision) {
        nativeImages = imageAttachments.map((item) => item.dataUrl);
        turnContent += `\n\n[已附带 ${nativeImages.length} 张图片，请结合图片内容回答。]`;
      }
    }

    const documents = state.attachments.filter((item) => item.kind === 'document');
    if (documents.length) {
      if (!documentExtractAvailable()) {
        setStatus('当前附件需要文件识别模型或 DeepSeek OCR，但当前 API 配置不可用。', true);
        return;
      }
      state.ocrBusy = true;
      updateSendState();
      try {
        for (const doc of documents) {
          let base64;
          try {
            base64 = await fileToBase64(doc.file);
          } catch (error) {
            setStatus(`读取附件失败：${doc.name}`, true);
            return;
          }
          const useExtractModel = !!extract && isDeepSeekEndpoint();
          if (useExtractModel) {
            setStatus(`正在调用 ${extract} 识别文档「${doc.name}」…`);
            let result;
            try {
              result = await app.bridgeRequest('extractDocumentText', {
                name: doc.name,
                type: doc.type,
                data: base64,
              }, 300000);
            } catch (error) {
              setStatus(`文档识别失败：${error.message}`, true);
              return;
            }
            if (!result || !result.ok) {
              setStatus(`文档识别失败：${result && result.error || '未知错误'}`, true);
              return;
            }
            appendBlock(`【文档识别（${extract}）：${doc.name}】\n${String(result.text || '').trim() || '（未识别到文字）'}`);
          } else {
            setStatus(`正在调用 DeepSeek OCR 识别文档「${doc.name}」…`);
            let result;
            try {
              result = await app.bridgeRequest('deepseekOcr', {
                name: doc.name,
                type: doc.type,
                data: base64,
              }, 240000);
            } catch (error) {
              setStatus(`文档识别失败：${error.message}`, true);
              return;
            }
            if (!result || !result.ok) {
              setStatus(`文档识别失败：${result && result.error || 'DeepSeek OCR 不可用'}`, true);
              return;
            }
            appendBlock(`【文档 OCR：${doc.name}】\n${String(result.text || '').trim() || '（未识别到文字）'}`);
          }
        }
      } finally {
        state.ocrBusy = false;
        updateSendState();
      }
    }

    let extracted = false;
    if (shouldReadCurrentQuestions(typed)) {
      setStatus('正在解析当前页题目…');
      const questionText = (await currentQuestionText()).slice(0, 30000);
      if (questionText) {
        turnContent += `\n\n【当前页面题目】\n${questionText}`;
        extracted = true;
        if (state.chat.boundUrl === location.href) {
          state.chat.memory = `【当前页面题目】\n${questionText}`;
          state.chat.memoryUpdatedAt = Date.now();
        }
      }
      setStatus('');
    }

    // 草稿在发送第一条消息时才真正创建、进入列表并绑定页面。
    if (state.chat.isDraft) {
      state.chat.id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      state.chat.isDraft = false;
      state.chat.createdAt = state.chat.createdAt || Date.now();
      state.chat.updatedAt = Date.now();
      state.prefs = { ...(state.prefs || {}), lastChatId: state.chat.id };
      app.bridgeRequest('prefs:set', { patch: { lastChatId: state.chat.id } }, 5000).catch(() => {});
    }

    const message = {
      role: 'user',
      content: storedContent,
      display,
      attachments,
      extracted,
      sessionContext: fileContext,
      sessionImages: nativeImages.length ? nativeImages : undefined,
      sessionTurnContent: turnContent,
      ts: Date.now(),
    };
    state.chat.messages.push(message);
    if (!state.chat.title || /^新对话( \d+)?$/.test(state.chat.title)) {
      state.chat.title = uniqueTitle(display.slice(0, 24) || '新对话', state.chat.id);
    }
    state.inputEl.value = '';
    state.attachments = [];
    renderAttachments();
    renderChat();
    renderHeading();
    await persistChat();
    updateSendState();

    const history = state.chat.messages
      .filter((item) => !item.streaming && item !== message)
      .slice(-19)
      .map(historyMessage);
    const apiMessages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: turnContent, images: nativeImages.length ? nativeImages : undefined },
    ];
    startAssistant(apiMessages);
  }

  function stopStreaming() {
    if (!state.streaming) return;
    try { state.streaming.abort(); } catch (error) { /* ignore */ }
    state.streaming = null;
    const last = state.chat && state.chat.messages[state.chat.messages.length - 1];
    if (last && last.streaming) {
      last.streaming = false;
      if (!last.content) last.content = '（已停止生成）';
    }
    renderChat();
    updateSendState();
    persistChat();
  }

  function copyText(text) {
    const value = String(text || '');
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setStatus('已复制到剪贴板。');
    }).catch(() => {
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); setStatus('已复制到剪贴板。'); }
      catch (error) { setStatus('复制失败，请手动选择文本。', true); }
      area.remove();
    });
  }

  function fillMessage(text) {
    const result = app.insertTextIntoCurrentEditor(text);
    setStatus(result.message, !result.ok);
  }

  function promptDialog(title, initialValue, placeholder) {
    return new Promise((resolve) => {
      const root = app.shadow.querySelector('[data-ai="modalRoot"]');
      if (!root) return resolve(null);
      root.textContent = '';
      const modal = document.createElement('div');
      modal.className = 'cxh-ai-modal';
      const card = document.createElement('div');
      card.className = 'cxh-ai-modal-card';
      const heading = document.createElement('strong');
      heading.textContent = title;
      const input = document.createElement('input');
      input.value = initialValue || '';
      input.placeholder = placeholder || '';
      const actions = document.createElement('div');
      actions.className = 'cxh-ai-modal-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'primary';
      save.textContent = '保存';
      const close = (value) => { root.textContent = ''; resolve(value); };
      cancel.addEventListener('click', () => close(null));
      save.addEventListener('click', () => close(input.value));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') close(input.value);
        if (event.key === 'Escape') close(null);
      });
      actions.append(cancel, save);
      card.append(heading, input, actions);
      modal.appendChild(card);
      root.appendChild(modal);
      input.focus();
      input.select();
    });
  }

  async function showBindingDialog() {
    if (!state.chat) return;
    const root = app.shadow.querySelector('[data-ai="modalRoot"]');
    if (!root) return;
    root.textContent = '';
    const modal = document.createElement('div');
    modal.className = 'cxh-ai-modal';
    const card = document.createElement('div');
    card.className = 'cxh-ai-modal-card';
    const heading = document.createElement('strong');
    heading.textContent = '修改对话绑定页面';
    const input = document.createElement('input');
    input.value = state.chat.boundUrl || location.href;
    input.placeholder = 'https://...chaoxing.com/...';
    const hint = document.createElement('div');
    hint.className = 'cxh-ai-note';
    hint.textContent = '只允许绑定 Chaoxing 页面。修改绑定会清空当前对话的题目记忆。';
    const actions = document.createElement('div');
    actions.className = 'cxh-ai-modal-actions';
    const bindCurrent = document.createElement('button');
    bindCurrent.type = 'button';
    bindCurrent.textContent = '绑定当前页面';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'primary';
    save.textContent = '保存';
    const close = () => { root.textContent = ''; };
    bindCurrent.addEventListener('click', () => { input.value = location.href; });
    cancel.addEventListener('click', close);
    save.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!app.isChaoxingUrl(url)) {
        hint.textContent = '只能绑定 Chaoxing（chaoxing.com / chaoxing.cn）页面。';
        hint.classList.add('error');
        return;
      }
      state.chat.boundUrl = url;
      state.chat.boundTitle = url === location.href ? (document.title || location.hostname) : new URL(url).hostname;
      state.chat.memory = '';
      state.chat.memoryUpdatedAt = 0;
      if (url === location.href) {
        const text = await currentQuestionText();
        if (text) {
          state.chat.memory = `【当前页面题目】\n${text}`;
          state.chat.memoryUpdatedAt = Date.now();
        }
      }
      close();
      await persistChat();
      renderHeading();
      renderChatList();
    });
    actions.append(bindCurrent, cancel, save);
    card.append(heading, input, hint, actions);
    modal.appendChild(card);
    root.appendChild(modal);
    input.focus();
  }

  function describeQuestionFrames() {
    const docs = collectQuestionDocuments();
    if (docs.length <= 1) return '';
    return docs.slice(0, 8).map((doc, index) => {
      let questionLi = 0;
      let tiMu = 0;
      try {
        questionLi = doc.querySelectorAll('.questionLi').length;
        tiMu = doc.querySelectorAll('.TiMu').length;
      } catch (error) {
        return `frame ${index}: 无法读取`;
      }
      const label = index === 0 ? '顶层' : `frame ${index}`;
      const url = String(doc.URL || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 80);
      return `${label}: .questionLi=${questionLi}, .TiMu=${tiMu}${url ? ` (${url})` : ''}`;
    }).join('；');
  }

  async function showExtraction() {
    if (!state.chat) return;
    if (!state.settings) {
      try { await ensureLoaded(); } catch (error) { /* keep extraction available */ }
    }
    setStatus('正在解析当前页题目…');
    const text = await currentQuestionText();
    const images = collectQuestionImages();
    setStatus('');
    const root = app.shadow.querySelector('[data-ai="modalRoot"]');
    if (!root) return;
    root.textContent = '';
    const modal = document.createElement('div');
    modal.className = 'cxh-ai-modal';
    const card = document.createElement('div');
    card.className = 'cxh-ai-modal-card';
    const heading = document.createElement('strong');
    heading.textContent = '当前页面题目文本';
    const pre = document.createElement('pre');
    pre.className = 'cxh-ai-modal-text';
    let extractionText = text || '';
    pre.textContent = extractionText || '当前页面没有解析到 .questionLi 题目结构。';
    const note = document.createElement('div');
    note.className = 'cxh-ai-note';
    const iframeCount = document.querySelectorAll('iframe').length;
    note.textContent = text
      ? '已解码超星加密字体；可复制，或更新到当前对话的题目记忆。'
      : iframeCount
        ? '当前页面包含 iframe，但没有找到 .questionLi；题目可能在跨域 iframe、课程文档或图片中，纯 DOM 提取无法读取。'
        : '当前页面没有找到 .questionLi 题目结构。';
    const imageNote = document.createElement('div');
    imageNote.className = 'cxh-ai-note';
    imageNote.hidden = !images.length;
    const imageModel = questionImageModel();
    if (images.length) {
      imageNote.textContent = imageModel
        ? `检测到 ${images.length} 张题目图片。`
        : `检测到 ${images.length} 张题目图片；如需识别，请在设置中填写“文件识别模型”或开启主模型多模态。`;
    }
    const progress = document.createElement('div');
    progress.className = 'cxh-ai-note';
    progress.hidden = true;
    const frameReport = text ? '' : describeQuestionFrames();
    let bindingNote = null;
    const actions = document.createElement('div');
    actions.className = 'cxh-ai-modal-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '复制全部';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    const closeFn = () => { root.textContent = ''; };
    copy.addEventListener('click', () => copyText(pre.textContent));
    close.addEventListener('click', closeFn);
    actions.append(copy);
    if (state.chat.boundUrl === location.href) {
      const update = document.createElement('button');
      update.type = 'button';
      update.className = 'primary';
      update.textContent = '更新记忆';
      update.addEventListener('click', async () => {
        const value = String(extractionText || '').trim();
        if (!value) {
          note.textContent = '当前没有可写入的题目内容。';
          return;
        }
        state.chat.memory = `【当前页面题目】\n${value.slice(0, 20000)}`;
        state.chat.memoryUpdatedAt = Date.now();
        await persistChat();
        closeFn();
        setStatus('已更新当前对话的题目记忆。');
      });
      actions.append(update);
    } else if (text) {
      const note2 = document.createElement('div');
      note2.className = 'cxh-ai-note';
      note2.textContent = '当前页与对话绑定页不同：本次提取只用于查看/本次回答，不会更新绑定记忆。';
      bindingNote = note2;
    }
    actions.append(close);

    let imagePrompt = null;
    if (images.length && imageModel) {
      imagePrompt = document.createElement('div');
      imagePrompt.className = 'cxh-ai-image-prompt';
      const promptText = document.createElement('span');
      promptText.textContent = `是否调用 ${imageModel} 识别这 ${images.length} 张图片中的文字？`;
      const promptActions = document.createElement('div');
      promptActions.className = 'cxh-ai-modal-actions';
      const recognize = document.createElement('button');
      recognize.type = 'button';
      recognize.className = 'primary';
      recognize.textContent = '识别图片';
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.textContent = '暂不识别';
      let recognizing = false;
      skip.addEventListener('click', () => imagePrompt.remove());
      recognize.addEventListener('click', async () => {
        if (recognizing) return;
        recognizing = true;
        recognize.disabled = true;
        skip.disabled = true;
        progress.hidden = false;
        progress.className = 'cxh-ai-note';
        state.ocrBusy = true;
        updateSendState();
        const blocks = [];
        let failed = 0;
        try {
          for (let i = 0; i < images.length; i += 1) {
            const image = images[i];
            progress.textContent = `正在调用 ${imageModel} 识别第 ${i + 1}/${images.length} 张图片…`;
            try {
              const payload = await questionImagePayload(image);
              const result = await app.bridgeRequest('extractImageText', payload, 240000);
              if (!result || !result.ok) throw new Error((result && result.error) || '图片识别失败');
              const value = String(result.text || '').trim();
              blocks.push(`【图片 ${i + 1}${image.questionIndex ? ` · 第 ${image.questionIndex} 题` : ''}】\n${value || '（未识别到文字）'}`);
            } catch (error) {
              failed += 1;
              blocks.push(`【图片 ${i + 1}】\n（识别失败：${error.message}）`);
            }
          }
        } finally {
          state.ocrBusy = false;
          updateSendState();
        }
        extractionText = [extractionText, '【图片识别文本】', ...blocks].filter(Boolean).join('\n\n');
        pre.textContent = extractionText;
        imagePrompt.remove();
        progress.className = 'cxh-ai-note' + (failed === images.length ? ' error' : '');
        progress.textContent = failed === images.length
          ? `图片识别失败：${images.length} 张图片均未识别成功，请检查文件识别模型设置。`
          : `识别完成：成功 ${images.length - failed} 张${failed ? `，失败 ${failed} 张` : ''}；题目内容已刷新。`;
        note.textContent = '已解码超星加密字体；图片识别文字已追加到下方。';
        setStatus(
          failed === images.length ? '题目图片识别失败，请检查文件识别模型设置。' : '题目图片识别完成。',
          failed === images.length,
        );
      });
      promptActions.append(recognize, skip);
      imagePrompt.append(promptText, promptActions);
    }

    card.append(heading, pre, note);
    if (imageNote && images.length) card.appendChild(imageNote);
    if (imagePrompt) card.appendChild(imagePrompt);
    if (images.length) card.appendChild(progress);
    if (bindingNote) card.appendChild(bindingNote);
    if (frameReport) {
      const frameNote = document.createElement('div');
      frameNote.className = 'cxh-ai-note';
      frameNote.textContent = `iframe 检测：${frameReport}`;
      card.appendChild(frameNote);
    }
    card.appendChild(actions);
    modal.appendChild(card);
    root.appendChild(modal);
  }

  ready().catch((error) => {
    console.warn('[CXH AI] 初始化失败', error);
  });
})();
