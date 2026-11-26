# 超星辅助助手 (Chaoxing Helper)

面向超星学习通的作业粘贴辅助 + AI 对话浏览器扩展，兼容 Chrome / Edge（Manifest V3，Chromium 111+）。

仓库：<https://github.com/WannaBeCute/chaoxing-helper>

> 仅用于个人学习辅助。使用前请遵守所在学校、教师和超星平台的规定。

## 功能

- **作业填入**：绕过页面粘贴限制，通过超星 UEditor 接口按光标插入文字、图片和附件。
- **粘贴限制检测**：自动识别当前作业是否存在 `beforepaste` / 内联 `onpaste` 拦截。
- **无编辑器收起**：没有作业输入框时只显示可拖动悬浮球，不自动展开。
- **题目提取**：支持 `.questionLi` 与章节测验 `.TiMu / .Zy_TItle`，递归扫描同源 iframe，并解密 `font-cxsecret` 字体；检测到题目图片时可选择调用多模态模型识别。
- **AI 对话**：OpenAI 兼容接口、流式输出、完整 Markdown 渲染、代码高亮与复制、重新生成，并在每条 AI 消息上方显示本次/累计 tokens。
- **多模态上传**：主模型支持多模态且开启“模型识图”时，可上传图片。
- **文件识别模型**：独立开关（默认关闭），可配置单独的 Endpoint、API Key 和多模态模型；开启后上传的图片/文档和题目图片优先调用该模型，不参与对话。
- **通用多模态调用**：自动区分 Chat Completions（`image_url` / `text`）与 Responses API（`input_image` / `input_text`），支持 OpenAI、DeepSeek、火山方舟等兼容端点。
- **文档解析**：DeepSeek 端点通过官方 Files API（`POST /files` + `file_id`）解析 PDF/Word/PPT；其他 Responses API 端点尝试 `input_file`。附件只保留当前页面，刷新后清除。
- **对话管理**：新建草稿、刷新列表、重命名/删除、绑定 Chaoxing 页面、跳转、最近绑定对话自动打开。
- **对话缓存**：本地 `chrome.storage.local`，8MB / 30 个对话软上限，超限提示清理；7 天清理默认关闭。
- **设置持久化**：API 配置、文件识别模型、面板模式、识图开关、最近对话均会保存。
- **更新检查**：设置页手动检查 GitHub Release；每日自动检测一次，发现新版本时在扩展面板显示非打断提醒，支持“不再提醒”和设置内恢复。
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

- OpenAI 兼容预设：OpenAI、DeepSeek、火山方舟（Ark）、月之暗面 Kimi、智谱 GLM、通义千问、硅基流动、Ollama、自定义。
- Endpoint、API Key、Model，以及“获取 API”链接。
- 预设模型的多模态能力与上下文长度由内置配置自动填写并只读；自定义模型可手动填写。
- 已包含 `deepseek-flash`、`gpt-4.1`、`doubao-seed-2-1-pro-260915`、`kimi-latest`、`glm-4v-flash`、`qwen-vl-max` 等模型。
- **文件识别模型**：独立开关，默认关闭。开启后可单独填写 Endpoint、API Key、模型和接口类型；模型下拉只列多模态模型，也可以手动填写模型名。
- **接口类型**：
  - `自动识别`：Endpoint 以 `/responses` 结尾时使用 Responses API，否则使用 Chat Completions。
  - `Chat Completions`：请求 `/chat/completions`，图片块 `image_url`，文本块 `text`。
  - `Responses API`：请求 `/responses`，图片块 `input_image`，文本块 `input_text`。
  - 两种块名不能混用，混用通常返回 HTTP 400。
- **文档解析**：
  - DeepSeek Endpoint：官方 Files API（`POST /files` + `file_id`）；Chat 引用 `{ "type": "file", "file_id": "..." }`，Responses 引用 `{ "type": "input_file", "file_id": "..." }`。
  - 其他 Responses API Endpoint：尝试 `input_file` + `file_data` 内联文件。
  - Chat Completions 的非 DeepSeek Endpoint 没有标准文档上传方式，只支持图片输入。
- 设置页提供“检测图片/文档能力”按钮，会实际发起少量调用，判断该模型是否支持图片输入和文档解析；也可用 `chaoxing-helper/scripts/test-extract-model.mjs` 在命令行检测。
- 参考：[DeepSeek Responses API](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)、[DeepSeek 文件解析](https://api-docs.deepseek.com/zh-cn/guides/document_parsing/)、[火山方舟](https://ark.volcengine.com/region:cn-beijing/docs/quick-start)。
- 测试连接、保存设置。

主对话仍使用 OpenAI 兼容 Chat Completions；文件识别模型可选 Chat Completions 或 Responses API。暂不支持 Claude / Gemini 原生协议。

## 隐私与安全

- 主模型与文件识别模型的 API Key 都保存在本机 `chrome.storage.local`，**不加密**，不会回传给网页；请勿在共享电脑上保存密钥。
- AI 对话会把题目文本、你发送的文本/图片和对话内容发送给你配置的 API 服务商。
- 使用文件识别模型时，上传的图片/文档和题目图片会发送给该模型所在的 API；使用 DeepSeek 文档解析或 OCR 时，文件会发送到 DeepSeek 官方接口，仅用于提取文字。
- 上传给 AI 的附件只存在于当前页面内存，不写入对话缓存；刷新页面后清除。对话缓存只保留文字和附件名称。
- 填入作业的图片/附件会通过超星页面自身接口上传到超星，这是作业内容的一部分。
- 本扩展不收集统计、不上传浏览记录。

## 更新检查与 Release 格式

- 更新源固定为 `WannaBeCute/chaoxing-helper` 的 latest Release，接口为 `https://api.github.com/repos/WannaBeCute/chaoxing-helper/releases/latest`。
- 版本比较使用 `manifest.version` 与 Release tag（自动忽略前导 `v`），只有 Release 版本更高时才提示更新。
- 设置页最底部提供“检查更新”；扩展每 24 小时自动检查一次，发现新版本时在超星页面面板内显示非打断提醒。
- 面板提醒可以直接选择 GitHub 或其他下载源；勾选“不再提醒”后永久关闭，可在设置页“接收启动更新提醒”重新开启；直接关闭则次日继续提醒。
- GitHub 下载源优先使用 Release 中上传的 `.crx` / `.zip` 附件，没有附件时回退到 Release 页面。
- 其他下载源和更新内容从 Release 正文按以下固定格式提取：

```markdown
## 📥 下载
[夸克网盘，密码：1234](https://example.com/download)

## 更新内容
- 新增功能 A
- 修复问题 B

## 致谢
```

- “更新内容”只提取 `## 更新内容` 到下一个 `##` 之间的文字；“下载”栏目中的链接和“密码：”后的值会用于第二个下载源。
- 如果 Release 没有“更新内容”，提醒中只显示版本信息；如果其他下载源提取失败，则只提供 GitHub 源。

## 版本号

- 采用 `MAJOR.MINOR.PATCH`：新增功能升 MINOR，修复升 PATCH，不兼容变更升 MAJOR。
- `manifest.version` 使用纯数字版本（如 `1.4.0`），Release tag 与之对应（如 `v1.4.0`）；更新检查会自动忽略前导 `v`。
- Chrome / Edge 的 `manifest.version` 只接受 1～4 段数字，不能包含 `-beta` 等后缀；预发布可把 Release 标记为 prerelease，latest 接口会忽略它。

## 已知限制

- 题目提取只支持 `.questionLi` / `.TiMu` 结构及同源 iframe；跨域 iframe、PDF/PPT/图片课件无法纯 DOM 提取。
- 文件识别模型的图片能力取决于所选模型；纯文本模型会在能力检测或调用时报错。
- 文档解析取决于服务商接口：DeepSeek 使用 Files API，Responses API 端点尝试 `input_file`；Chat Completions 的非 DeepSeek 端点不支持直接上传 PDF/Word。
- DeepSeek Files API 文档最大 100MB、最多 1000 页；DeepSeek OCR 回退单个附件限制 20MB。
- 各厂商对 Responses API 的字段支持可能不同，混用 `image_url` 与 `input_image` 会返回 HTTP 400；请在设置中选择正确的接口类型。
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
