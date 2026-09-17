# koishi-plugin-group-daily-analysis

[![npm](https://img.shields.io/npm/v/koishi-plugin-group-daily-analysis?label=npm)](https://www.npmjs.com/package/koishi-plugin-group-daily-analysis)
[![license](https://img.shields.io/npm/l/koishi-plugin-group-daily-analysis)](./LICENSE)

基于 [Koishi](https://koishi.chat/) 与 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 的群聊日报插件。它会从已监听群组的消息记录中提取统计数据与内容脉络，生成日报、用户画像和可选的群聊漫画。

每次手动分析或 Cron 定时任务都会按目标时间范围重新读取消息并进行完整分析；不会复用旧的分析结果。核心日报固定包含活跃统计、热门话题、用户称号、金句与聊天质量锐评。

## 功能

- 手动日报、自然语言群聊查询与 Cron 定时日报
- 图片、PDF、文本三种报告输出，以及历史报告的免 Token 重绘
- 多套报告皮肤、明暗主题及 OneBot 群文件/相册归档
- 自动或手动生成用户画像，并提供 ChatLuna 工具与提示词函数
- 根据当天话题生成群聊漫画，支持角色设定、多张参考图与定时自动发送
- 文本 API 重试、超时、并发控制、Token 统计、结构校验与任务检查点恢复

最终 HTML 文件不会导出或保存；Puppeteer 仅在内部以临时 HTML 渲染图片和 PDF。增量批次分析也已移除。

## 前置条件

- Node.js 18 或更高版本
- 已运行的 Koishi 与数据库服务
- `koishi-plugin-chatluna`：必需，用于预设、工具和模型调用
- `koishi-plugin-puppeteer`：必需，用于图片、PDF 与用户画像卡片渲染

消息、历史报告、任务检查点和用户画像都会保存在 Koishi 数据库。请确认你已告知群成员消息会被存储，并且使用的模型服务符合你的隐私要求。

## 安装与启用

在 Koishi 插件市场安装 `koishi-plugin-group-daily-analysis`，或在你的 Koishi 项目中执行：

```bash
npm install koishi-plugin-group-daily-analysis
```

随后启用 `group-daily-analysis`，并完成以下最小配置：

1. 在“基础设置”中启用需要记录消息的群。可以填写 `listenerGroups`，也可以开启“为所有群默认启用群分析”。
2. 在“自定义 API 与漫画 → LLM”中填写 `format`、`baseUrl`、`apiKey` 与 `model`。
3. 选择默认输出格式，并按需设置保留天数、单次最大消息数和最低消息数量。

保存 API 地址和密钥后，插件会尝试读取模型列表；服务不支持模型列表时仍可以直接手动输入模型 ID。

## 文本模型与生图模型

文本与生图接口使用面向服务商的 `format`，不需要选择底层请求协议。

| 配置 | 可选值 | 插件调用的接口 |
| --- | --- | --- |
| `llm.format` | `openai`、`google`、`anthropic` | OpenAI Responses、Google Gemini、Anthropic Messages |
| `comic.format` | `openai`、`google` | OpenAI Images、Google Gemini 图片生成 |

`llm.model` 用于日报、自然语言查询、用户画像和漫画分镜；`comic.model` 只用于最终生图。对于 OpenAI 生图，有参考图时会调用 `images/edits`，无参考图时调用 `images/generations`；Google 模型必须具备图片输出能力。

`baseUrl` 可填写服务商基础地址、已带版本号的地址，或完整的推理接口地址。插件会规范化已知端点，避免重复拼接 `/v1`。

## ChatLuna 预设与工具

“ChatLuna 预设”用于向日报的文本分析注入人格、表达语气和示例对话。它会影响话题、称号、金句、聊天质量、用户画像、查询后的对话回复以及漫画分镜；不会替代 `llm.model`，也不负责启用模型、Agent、记忆或工具调用。未选择预设时，插件使用自身的提示词直接分析。

漫画可选择继承日报预设、不使用预设，或单独指定一个漫画预设。

插件始终向 ChatLuna 注册以下能力：

- `group_message_fetch`：在当前群/频道上下文中按时间和条件读取历史消息。
- `group_user_persona`：读取指定用户已保存的画像。
- `group_message_fetch(...)` 与 `group_user_persona(...)`：可在 ChatLuna 提示词中使用的函数提供者。

## 常用配置

| 分组 | 作用 |
| --- | --- |
| 基础设置 | 群监听规则、定时任务、冷却时间和默认时间窗口 |
| 消息存储设置 | 是否始终落库、消息与报告的保留天数 |
| 群分析设置 | 最大/最小消息数、报告内容数量、并发限制、检查点恢复 |
| 分析渲染设置 | 默认格式、Cron 输出格式、主题、皮肤和 OneBot 归档 |
| ChatLuna 预设 | 日报与漫画分镜使用的人格预设 |
| 自定义 API 与漫画 | 文本模型、生图模型、漫画群权限、角色和参考图 |
| 用户画像设置 | 自动更新阈值、缓存时长、回溯范围和消息数量 |
| 分析提示词 / 查询提示词 | 各项分析和自然语言查询的模板 |

### 定时日报

在 `cronSchedule` 中填写五段式 CRON 表达式，例如 `0 22 * * *` 表示每天 22:00。`cronAnalysisDays` 决定默认分析天数，`useCalendarDayWindow` 开启时，1 天表示当天 00:00 至执行时刻；关闭时表示向前滚动 24 小时。

`autoAnalysisGroupMode` 和 `autoAnalysisGroups` 可进一步限制定时日报的目标群。若设置了多个 `cronOutputFormats`，同一轮分析结果会渲染为多种格式，不会为额外格式再次调用文本模型。

### 群漫画

启用 `comic.enabled` 后，可用 `groupMode` 与 `groups` 单独控制哪些群能生成漫画。角色方案可以覆盖全局角色描述和参考图；开启“每天随机角色”后，同一个机器人当天会稳定选中同一名启用角色。`autoSend` 会在定时日报成功后异步生成并发送当天漫画。

漫画生成会遵守每群冷却时间；失败后不会自动重复调用付费生图接口。

## 命令

| 命令 | 说明 |
| --- | --- |
| `群分析` | 按默认天数生成当前群日报。私聊时需通过 `-g <群号>` 或 `-c <频道号>` 指定目标。 |
| `群分析 <自然语言请求>` | 解析时间范围、主题、关键词和用户，执行分析、对话或两者。 |
| `群分析.启用` / `群分析.禁用` | 启用或禁用当前群的消息监听与分析。 |
| `群分析.状态` | 查看当前群是否启用。 |
| `群分析.清理` | 删除当前群已存储的消息记录。 |
| `群分析.历史 [数量]` | 查看最近保存的报告，数量范围为 1–20。 |
| `群分析.重绘 [报告 ID] -f image\|pdf\|text` | 用保存的结果重新渲染，不消耗文本模型 Token。 |
| `群分析.主题 [皮肤 ID]` | 查看或切换报告皮肤；切换后可用重绘预览。 |
| `群分析.用户画像 [用户] -f` | 查看画像；`-f` 强制刷新。查看其他用户需要 Koishi 权限等级 3。 |
| `群漫画 [-d 天数]` | 从最近 1–7 天的群聊话题生成漫画。 |

英文别名分别包括 `group-analysis`、`group-comic`、`group-analysis.history`、`group-analysis.redraw`、`group-analysis.skin` 与 `group-analysis.persona`。

## 数据与恢复

- `chatluna_messages`：已监听群的消息记录。
- `chatluna_analysis_reports`：完整日报结果、格式、状态与 Token 用量。
- `chatluna_analysis_checkpoints`：运行中的任务检查点；重启后会恢复未完成任务。恢复时优先使用已完成的分析结果，不会重复付费生成漫画。
- `chatluna_user_personas`：按平台、机器人与用户区分的画像数据。

“群分析.重绘”读取的是 `chatluna_analysis_reports`，所以即使原始消息已清理，也可以重绘已保存的报告。消息与报告清理周期使用 `retentionDays`。

## 从旧版升级

此次版本移除了增量分析、最终 HTML 导出、核心日报模块开关、消息/用户过滤器和 ChatLuna Tools 开关。请先备份 Koishi 配置与数据库，再按 [配置与数据库迁移](./MIGRATION_PLAN.md) 更新 `format` 配置并清理废弃表。

## 开发

```bash
npm install
npm test
npm run lint
npm run build
npm run test:ui
```

## 许可

[AGPL-3.0](./LICENSE)
