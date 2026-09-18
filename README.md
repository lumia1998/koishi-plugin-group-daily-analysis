# koishi-plugin-group-daily-analysis

[![npm](https://img.shields.io/npm/v/koishi-plugin-group-daily-analysis?label=npm)](https://www.npmjs.com/package/koishi-plugin-group-daily-analysis)
[![license](https://img.shields.io/npm/l/koishi-plugin-group-daily-analysis)](./LICENSE)

基于 Koishi、ChatLuna 和 Puppeteer 的群聊分析插件，提供群聊日报、自然语言查询、长期用户画像、群漫画与用户画像漫画。

群分析和用户画像由文本模型生成结构化结果；两种漫画都以当前皮肤渲染出的报告图片为内容参考，再由生图模型直接生成最终图片。漫画流程不包含额外的 JSON 文本分镜步骤。

## 主要功能

- 手动群分析、自然语言群聊查询和 Cron 定时分析
- 图片、PDF、文本、HTML 四种报告输出
- 历史报告保存与免 Token 重绘
- 热门话题、群友称号、金句、聊天质量、活跃排行和 24 小时分布
- 自动更新和手动查看长期用户画像
- 群漫画及用户画像四维观察漫画
- 13 个主题、明暗模式、角色方案和多张角色参考图
- 文本 API 重试、超时、并发限制、Token 统计和分析任务检查点
- ChatLuna 工具与提示词函数，可读取群消息和已保存画像

增量批次分析已经移除。每次新的群分析都会按目标时间范围重新读取消息；历史结果只用于“重绘”和任务恢复。

## 前置条件

- Node.js 18 或更高版本
- Koishi 4.18.9 或兼容版本
- Koishi 数据库服务
- `koishi-plugin-chatluna`
- `koishi-plugin-puppeteer`

插件会保存监听到的消息、分析报告、任务检查点和用户画像。部署前请向群成员说明数据用途，并确认文本及图片模型服务符合你的隐私要求。

## 安装

可从 Koishi 插件市场安装，或在 Koishi 项目中执行：

```bash
npm install koishi-plugin-group-daily-analysis
```

启用插件后，至少完成以下配置：

1. 使用 `listenerGroups` 添加允许监听的群，或开启 `enableAllGroupsByDefault`。
2. 配置 `llm.format`、`llm.baseUrl`、`llm.apiKey` 和 `llm.model`。
3. 确认 Puppeteer 和数据库服务可用。
4. 如需漫画，再开启 `comic.enabled` 并配置生图接口与模型。
5. 如需用户画像漫画，再开启 `comic.userEnabled`。

## 文本模型与生图模型

| 配置 | 可选格式 | 用途 |
| --- | --- | --- |
| `llm` | `openai`、`google`、`anthropic` | 话题、称号、金句、聊天质量、用户画像、查询解析与查询回复 |
| `comic` | `openai`、`google` | 根据报告图片和角色参考图直接生成最终漫画 |

文本接口分别使用 OpenAI Responses、Google Gemini `generateContent` 和 Anthropic Messages。生图接口使用 OpenAI Images 或 Google Gemini 图片输出。

OpenAI 在有参考图时调用 `images/edits`，无参考图时调用 `images/generations`。Google 会把参考图以内联图片形式发送，并要求模型返回图片。`baseUrl` 可以填写基础地址、版本地址或完整端点，插件会规范化常见路径。

当前漫画没有单独的文本分镜调用，也不使用 ChatLuna 漫画预设。手动群漫画在没有现成话题时仍会调用文本模型提取话题；用户画像漫画只读取已保存画像，不会重新分析聊天记录。

## 群分析

群分析会读取指定时间范围内的消息并生成：

- 基础消息、参与人数、字符和表情统计
- 最多 5 个主要话题
- 最多 6 个本期群友称号
- 金句和聊天质量锐评
- 活跃用户排行和小时分布

各文本模块独立执行。某个模块失败时，报告会保留已经成功的部分并记录 `failedModules`。完成后的结果写入 `chatluna_analysis_reports`，可以稍后重绘为其他格式。

HTML 报告保存在 Koishi 数据目录：

```text
data/chatluna/group_analysis/reports
```

### 时间范围

`useCalendarDayWindow=true` 时，1 天表示当天 00:00 到执行时刻；关闭后表示向前滚动 24 小时。手动群分析最多接受 7 天。定时任务使用 `cronAnalysisDays`。

## 群漫画

命令：

```text
群漫画
群漫画 3
群漫画 -d 3
```

手动群漫画的实际流程：

1. 读取最近 1–7 天的消息，并排除机器人自己的消息和分析/漫画命令。
2. 消息少于 `minMessages` 时停止。
3. 使用文本模型提取话题。
4. 用当前皮肤渲染一张群分析报告图片。
5. 将报告图片作为附件 1，将角色参考图作为后续附件。
6. 生图模型直接生成最终漫画并发送。

定时漫画复用本轮群分析已经生成的话题和完整报告结果，不会再次分析消息。开启 `comic.autoSend` 后，它会在群分析完成时异步启动。

生图提示词要求每个话题独立成格、主持角色保持一致，并继承报告皮肤的视觉语言。但最终格数、中文文字准确度和话题对应关系仍取决于生图模型；插件不会对生成后的图片做 OCR 或分镜数量校验。

`群漫画` 默认需要 Koishi 权限等级 3。群漫画与用户画像漫画共用每群运行锁和 `comic.cooldown`。生图失败后不会自动重复付费请求，且本次尝试仍会进入冷却时间。

## 长期用户画像

用户画像使用以下字段：

- `summary`：总体摘要
- `keyTraits`：性格和行为特点
- `interests`：兴趣与常见话题
- `communicationStyle`：沟通风格
- `evidence`：来自聊天记录的事实依据

插件按平台、机器人和用户保存画像。自动画像更新由 `personaAnalysisMessageInterval` 触发，并读取 `personaLookbackDays` 范围内、最多 `personaMaxMessages` 条消息；低于 `personaMinMessages` 时不会更新。

普通 `用户画像` 命令会使用缓存结果；缓存超过 `personaCacheLifetimeDays`、没有画像或指定 `-f` 时才尝试重新分析。新结果会和已有画像合并后保存。

## 用户画像漫画

命令：

```text
用户画像.漫画
用户画像 漫画
用户画像.漫画 @用户
用户画像 漫画 @用户
```

无参数时生成自己的画像漫画。生成其他用户的漫画必须使用 `@用户`，裸用户 ID 会被拒绝，并且调用者需要 Koishi 权限等级 3。

实际流程：

1. 从缓存或数据库读取已保存的用户画像。
2. 检查摘要、性格、兴趣、沟通风格四个维度中至少有三个有效。
3. 用当前皮肤渲染用户画像报告参考图，并隐藏较长的事实依据区域。
4. OneBot 下尝试把 QQ 头像嵌入这张报告图；头像不是单独上传的角色参考图。
5. 将画像报告作为附件 1，将配置的主持角色图片作为后续附件。
6. 生图模型直接生成竖版四维人物观察报告。

提示词固定要求“总体概览、性格特质、兴趣爱好、沟通风格”四个独立区域，并区分报告头像中的被分析对象与配置的主持角色。它不会重新调用用户画像文本分析，也没有中间 JSON 分镜。头像是否被准确复现、四个区域是否严格对应以及中文排版质量，最终取决于所选生图模型。

没有已保存画像时，插件会提示先运行 `用户画像`，不会调用生图接口。漫画命令也不会因画像过期而主动刷新；需要更新时先执行：

```text
用户画像 -f
```

## 角色和参考图

可以使用全局 `referenceImage`、`referenceImages` 和 `characterDescription`，也可以在 `characters` 中配置多套角色方案。

- 存在启用的角色方案时，优先使用角色方案的描述和图片。
- 角色方案没有图片时，会回退到全局多图 `referenceImages`。
- `randomCharacterDaily` 开启后，同一机器人在同一天稳定使用同一个角色方案。
- 每张参考图必须是 PNG、JPEG 或 WebP，最大 20 MB。
- 角色参考图只定义主持角色外观，报告图片提供话题或画像事实。

## ChatLuna 预设、工具与提示词函数

`preset` 只影响文本分析任务，包括话题、称号、金句、聊天质量、用户画像和分析后的对话回复。自然语言查询解析会绕过预设，漫画生图也不会使用预设。

插件向 ChatLuna 注册：

- 工具 `group_message_fetch`：读取当前群或频道的历史消息。
- 工具 `group_user_persona`：读取指定用户已经保存的画像。
- 提示词函数 `group_message_fetch(...)`。
- 提示词函数 `group_user_persona(...)`。

分析提示词和漫画生图提示词由源码内置。配置中遗留的旧版自定义提示词字段不会改变当前运行提示词。

## 常用配置

| 分组 | 主要内容 |
| --- | --- |
| 基础设置 | 群监听、定时任务、定时目标和时间窗口 |
| 消息存储设置 | 强制落库与保留天数 |
| 群分析设置 | 消息上下限、活跃用户数量、并发和检查点 |
| 分析渲染设置 | 输出格式、主题、皮肤和 OneBot 归档 |
| ChatLuna 预设 | 文本分析的人格和表达上下文 |
| 模型接口与漫画 | 文本接口、生图接口、漫画权限、角色和冷却 |
| 用户画像设置 | 自动更新阈值、缓存、回溯和消息数量 |

### 定时任务

`cronSchedule` 使用五段式 CRON，例如 `0 22 * * *` 表示每天 22:00。`autoAnalysisGroupMode` 和 `autoAnalysisGroups` 可以单独限制定时分析目标。

`cronOutputFormats` 可在同一轮分析中输出多个格式；额外格式只会重新渲染，不会再次调用文本模型。`autoAnalysisCooldown` 防止同一计划短时间重复运行。

## 主题

13 个主题都支持群报告和用户画像报告。5 个基础视觉族提供实际模板，其他主题通过映射复用基础模板并追加样式：

| 主题 | 模板来源 |
| --- | --- |
| `md3`、`simple` | `md3` |
| `anime`、`ATRI`、`BlueArchive`、`HatsuneMiku` | `anime` |
| `newspaper`、`retro_futurism`、`hack` | `newspaper` |
| `art`、`art_nouveau` | `art` |
| `scrapbook`、`spring_festival` | `scrapbook` |

`scrapbook` 是代码中明确标注的 AstrBot 手账移植模板；其他映射主题不是完整的 AstrBot 原版模板。扩展方式见 [皮肤开发指南](./SKIN_DEVELOPMENT.md)。

## 命令

| 命令 | 说明 |
| --- | --- |
| `群分析 [自然语言请求]` | 生成群报告，或解析自然语言后执行分析/回复。私聊需用 `-g` 或 `-c` 指定目标。 |
| `群分析.启用` / `群分析.禁用` | 启用或禁用当前群。 |
| `群分析.状态` | 查看当前群状态。 |
| `群分析.清理` | 删除当前群已保存的消息。 |
| `群分析.历史 [数量]` | 查看最近 1–20 条保存报告。 |
| `群分析.重绘 [报告 ID] -f image\|pdf\|text\|html` | 使用保存结果重新渲染，不调用文本模型。 |
| `群分析.主题 [主题 ID]` | 查看或切换报告主题。 |
| `用户画像 [-f]` | 查看自己的画像；`-f` 强制尝试更新。 |
| `群分析.用户画像 [-f]` | `用户画像` 的兼容别名。 |
| `群漫画 [天数]` / `群漫画 -d <天数>` | 生成最近 1–7 天的群漫画。 |
| `用户画像.漫画 [@用户]` / `用户画像 漫画 [@用户]` | 根据已保存画像生成漫画。 |

主要英文别名包括 `group-analysis`、`group-comic`、`group-analysis.history`、`group-analysis.redraw`、`group-analysis.skin` 和 `group-analysis.persona`。

## 数据表与恢复

- `chatluna_messages`：已监听群的消息。
- `chatluna_analysis_reports`：完整分析结果、输出格式、状态和 Token 用量。
- `chatluna_analysis_checkpoints`：运行中分析任务的检查点。
- `chatluna_user_personas`：按平台、机器人和用户保存的画像。

检查点恢复只恢复文本分析、报告渲染和发送，不会自动重复付费漫画。即使原始消息已经清理，只要历史报告仍在，就可以使用“群分析.重绘”。

## 已知限制

- 生图模型直接阅读报告图片，没有中间结构化分镜，也没有生成后视觉校验。
- 漫画中的格数、中文文字、角色一致性和头像还原程度依赖模型能力。
- 用户头像只嵌入画像报告参考图，不作为独立身份参考图上传。
- 外部字体、QQ 头像和部分主题资源受部署环境网络影响；头像读取失败时报告会使用透明占位图。
- OpenAI 兼容服务对多图 `images/edits` 的字段支持可能不同，请以服务商实现为准。

## 从旧版本升级

当前版本不再使用漫画 JSON 分镜、漫画专用 ChatLuna 预设和增量分析。旧配置中的 `comic.presetMode`、`comic.preset` 以及旧版自定义提示词字段可能仍留在配置文件中，但运行时会忽略。

升级前建议备份 Koishi 配置和数据库。接口格式与数据库迁移说明见 [MIGRATION_PLAN.md](./MIGRATION_PLAN.md)。

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
