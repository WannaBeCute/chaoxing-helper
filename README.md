# 超星辅助助手 (Chaoxing Helper)

面向超星学习通的作业粘贴辅助 + AI 对话浏览器扩展，兼容 Chrome / Edge（Manifest V3，Chromium 111+）。

> 仅用于个人学习辅助。使用前请遵守所在学校、教师和超星平台的规定。

## 功能

- **作业填入**：绕过页面粘贴限制，通过超星 UEditor 接口按光标插入文字、图片和附件。
- **粘贴限制检测**：自动识别当前作业是否存在 `beforepaste` / 内联 `onpaste` 拦截。
- **无编辑器收起**：没有作业输入框时只显示可拖动悬浮球，不自动展开。
- **题目提取**：支持 `.questionLi` 与章节测验 `.TiMu / .Zy_TItle`，递归扫描同源 iframe，并解密 `font-cxsecret` 字体；检测到题目图片时可选择调用多模态模型识别。
- **AI 对话**：OpenAI 兼容接口、流式输出、完整 Markdown 渲染、代码高亮与复制、重新生成，并在每条 AI 消息上方显示本次/累计 tokens。
- **多模态上传**：模型支持多模态且开启“模型识图”时，可上传图片；DeepSeek 厂商还可通过官方 OCR API 上传 PDF/Word/PPT/图片并提取文本。
- **文件识别模型**：可单独配置一个只负责内容提取、不参与对话的多模态模型；填写后，上传的图片/文档和题目图片优先调用该模型。
- **DeepSeek 文档解析 / OCR**：文件识别模型为 DeepSeek 时，通过官方 Files API（`POST /files` + `file_id`）解析 PDF/Word/PPT；也可使用官方 OCR（`https://api.deepseek.com/v1/tools/ocr`）。附件只保留当前页面，刷新后清除。
- **对话管理**：新建草稿、刷新列表、重命名/删除、绑定 Chaoxing 页面、跳转、最近绑定对话自动打开。
- **对话缓存**：本地 `chrome.storage.local`，8MB / 30 个对话软上限，超限提示清理；7 天清理默认关闭。
- **设置持久化**：API 配置、文件识别模型、面板模式、识图开关、最近对话均会保存。
- **双击标题栏最小化**：最小化后悬浮球回到展开前的位置。

## 安装

### 方式一：GitHub Releases（推荐）

1. 打开本仓库的 **Releases**，下载 `chaoxing-helper.crx`。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，将 `.crx` 拖入页面。

> 新版 Chrome/Edge 可能拦截非商店来源的 CRX。若安装失败，请使用下面的解压目录方式。

### 方式二：加载已解压目录

1. 下载仓库源码，找到 `chaoxing-helper/` 目录。
2. 扩展管理页开启开发者模式。
3. 点击“加载已解压的扩展程序”（Edge 为“加载解压缩的扩展”），选择 `chaoxing-helper/`。

扩展只会在 `*.chaoxing.com` / `*.chaoxing.cn` 页面运行。

## 使用

### 填入作业

1. 打开作业作答页，先点击目标答题框，让编辑器出现光标。
2. 在扩展面板中输入/粘贴文字，或拖入图片、文件。
3. 点击“填入作业”。图片和附件会先上传到超星，再按光标位置插入。
4. 如果按钮是灰色，说明目标编辑器还没有获得光标，或内容为空。

### AI 对话

1. 点击面板顶部“AI 对话”。
2. 首次使用先点右上角齿轮，在设置页填写 API 配置。
3. 可以直接提问，也可以说“完成当前页题目”，扩展会读取当前页题目文本作为上下文。
4. AI 回复支持 Markdown、表格、代码高亮、代码复制、链接、图片和“重新生成”。

### 题目提取

- AI 对话页右上角点击“题”。
- 支持工作/考试页 `.questionLi`，以及章节测验 `.TiMu / .Zy_TItle`。
- 支持同源嵌套 iframe；跨域 iframe、PDF/PPT/图片课件暂不支持。
- 会解码超星 `font-cxsecret` 字体。
- 检测到题目图片时，如果配置了文件识别模型或主模型支持多模态，会提示“是否识别图片”。选择识别后，下方显示“正在调用 {模型名} 识别第 N/M 张图片…”，完成后自动刷新题目内容并追加图片识别文字。

### 对话列表

- 打开被对话绑定的页面时，自动打开该页面**最新**的绑定对话。
- 页面没有被任何对话绑定时显示“新对话”草稿，**不会创建列表、不会绑定**，直到发送第一条消息。
- 点击“新对话”同样只创建草稿；发送第一条消息后才保存并绑定。
- 列表顶部 `↻` 可刷新，看到其他页面新建的对话；`×` 关闭列表。
- 草稿标题重复时自动编号：`新对话 2`、`新对话 3`……

## AI 配置

设置页支持：

- OpenAI 兼容预设：OpenAI、DeepSeek、月之暗面 Kimi、智谱 GLM、通义千问、硅基流动、Ollama、自定义。
- Endpoint、API Key、Model，以及“获取 API”链接。
- 预设模型的多模态能力与上下文长度由内置配置自动填写并只读；自定义模型可手动填写。
- 已包含 `deepseek-flash`、`gpt-4.1`、`kimi-k2`、`glm-4.5`、`qwen2.5vl` 等模型。
- `deepseek-flash` 按官方文档标记为支持图像理解/多模态。
- **文件识别模型（可选）**：填写一个模型名后，上传的图片和题目图片会优先调用它提取内容；它不参与对话。若当前 Endpoint 是 DeepSeek，PDF/Word/PPT 也会优先用该模型解析。留空时图片使用主模型（若支持多模态），文档使用 DeepSeek OCR。
- 设置页提供“检测图片/文档能力”按钮，会实际发起少量调用，判断该模型是否支持图片输入和文档解析；也可用仓库中的 `chaoxing-helper/scripts/test-extract-model.mjs` 在命令行检测。
- 文件识别模型为 DeepSeek 时，文档通过官方 Files API 解析：
  - 上传：`POST https://api.deepseek.com/files`（`purpose=text_recognition`，纯文本用 `user_data`）
  - 对话：在 `deepseek-flash` 请求中引用 `{ "type": "file", "file_id": "..." }`
  - PDF/Word/PPT 解析按页计费；单个文件最大 100MB。
- 未配置文件识别模型时，DeepSeek 用户仍可使用官方 OCR：`https://api.deepseek.com/v1/tools/ocr`，单个附件限制 20MB。
- 参考：[OCR 文档](https://api-docs.deepseek.com/zh-cn/guides/ocr/)、[文件解析](https://api-docs.deepseek.com/zh-cn/guides/document_parsing/)。
- 测试连接、保存设置。

当前仅支持 OpenAI 兼容接口，不支持 Claude / Gemini 原生协议。自定义厂商请填写兼容 `/chat/completions` 的 Endpoint。

## 隐私与安全

- API Key 保存在本机 `chrome.storage.local`，**不加密**，不会回传给网页；请勿在共享电脑上保存密钥。
- AI 对话会把题目文本、你发送的文本/图片和对话内容发送给你配置的 API 服务商。
- 使用文件识别模型时，上传的图片/文档和题目图片会发送给该模型所在的 API；使用 DeepSeek 文档解析或 OCR 时，文件会发送到 DeepSeek 官方接口，仅用于提取文字。
- 上传给 AI 的附件只存在于当前页面内存，不写入对话缓存；刷新页面后清除。对话缓存只保留文字和附件名称。
- 填入作业的图片/附件会通过超星页面自身接口上传到超星，这是作业内容的一部分。
- 本扩展不收集统计、不上传浏览记录。

## 本地识别依赖（计划中）

主 CRX 约 **0.83MB**。OCR / PDF / Word 依赖体积较大，不会直接打进主包。

计划中的方式：

- 单独提供可选的“本地识别依赖包”；
- 设置页显示安装状态、版本，支持验证和卸载；
- 安装并验证后，本地 OCR / PDF / Word 可用，AI 文件上传不再受“必须多模态”的限制；
- 卸载后恢复仅多模态上传；
- DeepSeek 用户当前可以直接使用官方 OCR / 文档解析处理 AI 附件，不依赖本地 OCR 包。
- 需要完全离线的 OCR / PDF / Word 时，仍需等待本地识别依赖包。

> 当前版本 **尚未实现依赖包安装器**。由于 Chrome MV3 不允许扩展直接执行任意外部 JS，依赖包需要采用独立扩展包或沙箱运行时方案，具体形式将在后续版本确定。设置页暂不显示未完成的本地 OCR/题目图片自动识别开关。

## 已知限制

- 题目提取只支持 `.questionLi` / `.TiMu` 结构及同源 iframe；跨域 iframe、PDF/PPT/图片课件无法纯 DOM 提取。
- 本地 OCR、PDF、Word 识别尚未接入；DeepSeek 用户可使用官方文档解析/OCR，但需要有效的 DeepSeek API Key，并按官方页面计费。
- 文件识别模型处理 PDF/Word 目前要求 DeepSeek Endpoint（如 `deepseek-flash`）；其他厂商的模型可用于图片识别，但文档需走 DeepSeek OCR。
- DeepSeek OCR 单个附件当前限制 20MB；Files API 文档最大 100MB、最多 1000 页。
- 预设模型能力来自内置配置，服务商调整 API 后可能需要更新；请以官方文档为准。
- API Key 只保存在本地扩展存储，不加密。
- 本项目与超星学习通官方无关。

## 项目结构

```text
chaoxing-helper/
├── manifest.json
├── icons/
├── src/
│   ├── content.js        # 页面主世界：编辑器识别、填入、面板 UI
│   ├── ai-panel.js       # AI 对话、题目提取、对话列表、Markdown 渲染
│   ├── font-decode.js    # font-cxsecret TTF 解析与解密
│   ├── font-map.json     # 字体哈希映射表（GPL-3.0）
│   ├── bridge.js         # 隔离世界桥接 + Markdown 渲染 + 高亮
│   ├── background.js     # 后台 AI 请求、文件识别、OCR、字体表、设置/跳转
│   ├── options.html/css/js
│   └── ...
├── scripts/
│   └── test-extract-model.mjs  # 命令行检测文件识别模型的图片/文档能力
├── vendor/               # marked / DOMPurify / highlight.js
├── LICENSE
└── THIRD_PARTY_NOTICES.txt
```

## 开发与打包

本项目无构建步骤，直接加载目录即可开发。

```powershell
chrome.exe --pack-extension="C:\path\to\chaoxing-helper" `
  --pack-extension-key="C:\path\to\private.pem" `
  --no-message-box
```

- `.pem` 私钥**绝不提交到仓库**；`.gitignore` 已排除。
- `.crx` 作为 GitHub Release 资产上传，不放入源码仓库。
- 发布前请确认 `LICENSE`、`THIRD_PARTY_NOTICES.txt` 和字体映射表许可证。

## 许可证

本项目以 **GNU GPL v3.0** 开源，详见 [LICENSE](LICENSE)。

字体解码算法与 `src/font-map.json` 参考自 [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing)（GPL-3.0）。

Markdown/高亮等第三方依赖的许可证见 [THIRD_PARTY_NOTICES.txt](chaoxing-helper/THIRD_PARTY_NOTICES.txt)。

## 贡献

欢迎提交 Issue / PR。提交前请：

- 不要提交任何 API Key、Cookie、`.pem` 或包含个人作业内容的截图；
- 说明复现步骤和预期行为；
- 保持现有 GPL-3.0 许可证与第三方声明。
