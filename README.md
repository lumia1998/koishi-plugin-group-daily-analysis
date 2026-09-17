# koishi-plugin-group-daily-analysis

[![npm](https://img.shields.io/npm/v/koishi-plugin-group-daily-analysis?label=npm)](https://www.npmjs.com/package/koishi-plugin-group-daily-analysis)
[![license](https://img.shields.io/npm/l/koishi-plugin-group-daily-analysis)](./LICENSE)

基于 [Koishi](https://koishi.chat/) 与 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 的群聊日报插件。支持群分析报告、独立长期用户画像、群漫画和用户画像漫画。每个可选皮肤同时提供群日报与用户档案视觉。

每次手动分析或 Cron 定时任务都会按目标时间范围重新读取消息并进行完整分析；不会复用旧的分析结果。核心日报固定包含活跃统计、热门话题、用户称号、金句与聊天质量锐评。

## 功能

- 手动日报、自然语言群聊查询与 Cron 定时日报
- 图片、PDF、文本与 HTML 文件四种报告输出，以及历史报告的免 Token 重绘
- 多套报告皮肤、明暗主题及 OneBot 群文件/相册归档
- 自动或手动生成用户画像，并提供 ChatLuna 工具与提示词函数
- 根据当天话题生成群聊漫画，支持角色设定、多张参考图与定时自动发送
- 根据已保存的长期用户画像生成三至四格人物漫画，不重复分析聊天记录
- 文本 API 重试、超时、并发控制、Token 统计、结构校验与任务检查点恢复

HTML 报告会固定保存至 Koishi 数据目录 `data/chatluna/group_analysis/reports`，并作为附件发送；不再提供目录与外链前缀配置。Puppeteer 仍会使用内部临时 HTML 渲染图片和 PDF。增量批次分析已移除。

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
2. 在“模型接口与漫画 → 文本模型接口”中填写接口类型、接口地址、密钥与模型。
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
| 群分析设置 | 最大/最小消息数、报告活跃用户数量、并发控制与检查点恢复 |
| 分析渲染设置 | 图片/PDF/文本/HTML 输出、主题、皮肤和 OneBot 归档 |
| ChatLuna 预设 | 日报与漫画分镜使用的人格预设 |
| 模型接口与漫画 | 文本模型、共享生图接口、群漫画与用户画像漫画、角色和参考图 |
| 用户画像设置 | 自动更新阈值、缓存时长、回溯范围和消息数量 |
| 分析提示词 / 查询提示词 | 各项分析和自然语言查询的模板 |

### 定时日报

在 `cronSchedule` 中填写五段式 CRON 表达式，例如 `0 22 * * *` 表示每天 22:00。`cronAnalysisDays` 决定默认分析天数，`useCalendarDayWindow` 开启时，1 天表示当天 00:00 至执行时刻；关闭时表示向前滚动 24 小时。

`autoAnalysisGroupMode` 和 `autoAnalysisGroups` 可进一步限制定时日报的目标群。若设置了多个 `cronOutputFormats`，同一轮分析结果会渲染为多种格式，不会为额外格式再次调用文本模型。

### 群漫画

启用 `comic.enabled` 后，可用 `groupMode` 与 `groups` 单独控制哪些群能生成漫画。角色方案可以覆盖全局角色描述和参考图；开启“每天随机角色”后，同一个机器人当天会稳定选中同一名启用角色。`autoSend` 会在群分析产生话题后异步生成并发送漫画，报告渲染不必等待生图完成。

漫画生成会遵守每群冷却时间；失败后不会自动重复调用付费生图接口。

### 群分析与长期用户画像

群分析总结指定时间范围内的群聊，保留热门话题、本期群友称号、金句、聊天质量锐评、活跃排行和时间分布。群友称号是本期群聊表现，不等同于长期用户画像；附带的 MBTI 也只是本期印象。

独立用户画像维护长期积累的个人档案，展示摘要、性格与行为特点、兴趣与常见话题、沟通和社交习惯、事实依据与代表记录。继续使用已有 `summary`、`keyTraits`、`interests`、`communicationStyle`、`evidence` 数据，不另外保存重复字段。

### 用户画像漫画

启用“漫画服务”和“启用用户画像漫画”后，使用 `用户画像.漫画`。它会从已有画像中提取 3～4 个最鲜明的特点，并将每个特点转换成一个漫画分镜；可以突出核心人设、说话方式、兴趣、典型行为或反差感。每格都应能对应回画像依据，属于人物切片式漫画，不是随机故事生成器。

分镜模型在同一次调用中完成“提取特点 → 逐格映射”，随后调用已有生图服务。事实依据用于设计场景，不会要求把大段原始记录画进气泡。无法提取三个有依据的特点时提示数据不足。

无画像时会提示“当前用户还没有用户画像，请先生成用户画像。”，不会自动执行画像分析，也不会请求生图接口。画像过期也直接使用已保存版本；需要更新时先执行 `用户画像 -f`。

两个漫画入口共用接口、密钥、模型、超时、参考图、角色方案、并发限制与每群冷却。此次只新增 `comic.userEnabled`（默认关闭）和 `comic.userPrompt` 两项配置。角色方案用于统一漫画化身外观，用户的性格与行为以画像为准。当前参考图链路读取本地文件，继续使用配置的角色图片，不自动下载用户头像。没有新增漫画历史表。

### 主题与模板

现有 13 个主题全部支持群日报与独立用户画像，缺少主题专用模板时回退到映射源。基础模板不会因新增用户档案而被替换。

| 主题标识 | 群日报模板来源 | 用户档案视觉 |
| --- | --- | --- |
| `md3` | 物料设计基础模板 | 物料设计档案卡 |
| `anime` | 二次元基础模板 | 二次元人物档案 |
| `newspaper` | 报纸基础模板 | 人物专访 |
| `art` | 艺术基础模板 | 极简人物画册 |
| `scrapbook` | AstrBot 手账移植模板 | 长期观察手账 |
| `simple` | `md3` 映射 | 简洁资料页 |
| `ATRI` | `anime` 映射 | 蓝白人格观测终端 |
| `BlueArchive` | `anime` 映射 | 学生档案 |
| `HatsuneMiku` | `anime` 映射 | 音乐声轨与兴趣歌单 |
| `retro_futurism` | `newspaper` 映射 | 星际居民控制台 |
| `hack` | `newspaper` 映射 | 用户观测终端日志 |
| `art_nouveau` | `art` 映射 | 植物纹样人物藏书 |
| `spring_festival` | `scrapbook` 映射 | 新春人物小传 |

来源说明：当前代码中明确标记从 AstrBot 移植的是 `scrapbook`；其余上述兼容主题名通过映射复用基础布局，不能视为 AstrBot 原版模板完整移植。皮肤结构与扩展方法见 [皮肤开发指南](./SKIN_DEVELOPMENT.md)。

## 命令

| 命令 | 说明 |
| --- | --- |
| `群分析` | 按默认天数生成当前群日报。私聊时需通过 `-g <群号>` 或 `-c <频道号>` 指定目标。 |
| `群分析 <自然语言请求>` | 解析时间范围、主题、关键词和用户，执行分析、对话或两者。 |
| `群分析.启用` / `群分析.禁用` | 启用或禁用当前群的消息监听与分析。 |
| `群分析.状态` | 查看当前群是否启用。 |
| `群分析.清理` | 删除当前群已存储的消息记录。 |
| `群分析.历史 [数量]` | 查看最近保存的报告，数量范围为 1–20。 |
| `群分析.重绘 [报告 ID] -f image\|pdf\|text\|html` | 用保存的结果重新渲染，不消耗文本模型 Token。 |
| `群分析.主题 [皮肤 ID]` | 查看或切换报告皮肤；切换后可用重绘预览。 |
| `群分析.用户画像 [用户] -f` | 查看画像；`-f` 强制刷新。查看其他用户需要 Koishi 权限等级 3。 |
| `群漫画 [-d 天数]` | 从最近 1–7 天的群聊话题生成漫画。 |
| `用户画像.漫画 [用户]` | 不传用户时生成自己的画像漫画；支持 @用户或用户编号。查看他人需要权限等级 3，权限不足转为自己的画像。 |

英文别名分别包括 `group-analysis`、`group-comic`、`group-analysis.history`、`group-analysis.redraw`、`group-analysis.skin` 与 `group-analysis.persona`。

## 数据与恢复

- `chatluna_messages`：已监听群的消息记录。
- `chatluna_analysis_reports`：完整日报结果、格式、状态与 Token 用量。
- `chatluna_analysis_checkpoints`：运行中的任务检查点；重启后会恢复未完成任务。恢复时优先使用已完成的分析结果，不会重复付费生成漫画。
- `chatluna_user_personas`：按平台、机器人与用户区分的画像数据。

“群分析.重绘”读取的是 `chatluna_analysis_reports`，所以即使原始消息已清理，也可以重绘已保存的报告。消息与报告清理周期使用 `retentionDays`。

## 从旧版升级

此次版本移除了增量分析、核心日报模块开关、消息/用户过滤器和 ChatLuna Tools 开关。HTML 仍可输出，但目录与外链前缀配置已移除。请先备份 Koishi 配置与数据库，再按 [配置与数据库迁移](./MIGRATION_PLAN.md) 更新 `format` 配置并清理废弃表。

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
