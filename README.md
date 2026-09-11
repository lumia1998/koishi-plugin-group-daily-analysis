<div align="center">

# koishi-plugin-group-daily-analysis

_Koishi 群聊分析插件_

## [![npm](https://img.shields.io/npm/v/koishi-plugin-group-daily-analysis/alpha)](https://www.npmjs.com/package/koishi-plugin-group-daily-analysis) ![node version](https://img.shields.io/badge/node-%3E=18-green)

</div>

> 本版基于 [ChatLunaLab/chatluna-group-analysis](https://github.com/ChatLunaLab/chatluna-group-analysis) 改造；其源自 lumia1998 的群分析插件。保留原作者贡献与 AGPL-3.0 许可。
> `0.0.1-alpha.4` 为自定义 API 与群漫画的预发布版本。

一个为 Koishi 设计的群聊分析插件，灵感来源于 `astrbot-qq-group-daily-analysis`，支持多维度统计和智能话题总结。

## 截图

<img src="./screenshots/default.png" width="300" /> <img src="./screenshots/newspaper.png" width="300" /> <img src="./screenshots/anime.png" width="300" />

## 特性

1. **多维度统计** - 分析群聊的总消息数、参与人数、总字数、最活跃时段、发言排行榜等
2. **智能话题总结** - 集成大语言模型（LLM），自动从聊天记录中总结出核心讨论话题
3. **自然语言对话** - 基于 LLM 能力，用自然语言就可以从指定的时间，关注的话题等进行群分析（如 「群分析 过去三小时都聊了什么话题」）
4. **图片报告** - 将分析结果渲染成美观的图片报告，直观易读（使用 Material Design 3 动态配色系统，支持明暗主题切换）
5. **灵活触发** - 支持通过命令手动触发，也支持通过 CRON 表达式定时自动发送
6. **高度可配置** - 支持群组白名单，自定义定时任务等配置选项
7. **独立模型 API** - 支持 OpenAI Responses、Anthropic Messages、Google v1beta 和 OpenAI Chat Completions
8. **群漫画** - 群消息 → 话题提取 → 自定义分镜提示词 → 生图 API，可附带角色三视图
9. **ChatLuna 预设** - 直接选择已导入的预设作为分析人格，漫画支持继承、关闭或独立选择
10. **配置目录** - 配置页侧边目录可定位各设置分组，并提供参考图例、使用说明与预设文档链接
11. **聊天质量锐评** - 独立模块输出主题、维度占比、点评和总评，失败不影响其他模块
12. **历史报告与重绘** - 报告结果持久化，支持 HTML 外链、定时多格式、`群分析.历史` 和无 Token `群分析.重绘`
13. **高消息量保护** - 增量批次、滑动窗口、话题/金句去重、检查点恢复、重试退避和全局并发限制

### ChatLuna 预设与配置目录

1. 先在 ChatLuna 中导入或编辑预设，操作见 [ChatLuna 预设系统](https://chatluna.chat/guide/preset-system/introduction.html)。本插件复用 ChatLuna 的动态预设列表，不需要重复复制预设文件。
2. 在本插件的 **ChatLuna 预设** 分组选择 `preset`。默认“不使用预设”，保持现有行为。预设作用于话题、称号、金句、用户画像和分析后对话；自然语言查询的时间/意图解析不使用人格预设。
3. 漫画的 `comic.presetMode` 可选择“继承日报预设”“不使用预设”或“指定漫画预设”；选择第三项时填写 `comic.preset`。漫画角色描述与参考图仍负责主角外观和一致性。
4. 模型仍使用本插件配置的自定义文本 API。预设的 system/user/assistant 多条文本消息通过 ChatLuna 渲染服务处理，再按各 API 的原生消息格式发送；分析任务的 YAML/JSON 格式约束继续保留。此接入不启动 Agent 对话，也不执行其世界书检索、长期记忆、工具或会话专用管线。依赖 Session 的自定义预设函数不在此任务中提供会话上下文。
5. 每次实际调用模型时读取最新预设。编辑预设后，如遇到原有日报/画像缓存，可使用 `群分析 -f` 或 `用户画像 -f` 强制刷新；已删除的预设会报错，不会偷偷换成其他人格。

启用 Koishi 控制台后，本插件配置页会显示 **配置目录**：点击跳转、滚动高亮，可折叠；手机等窄屏默认折叠。目录从当前配置标题生成，修改分组会同步更新；只在本插件详情页显示，不创建独立后台。

后续移植顺序与验收范围见 [分阶段移植计划](./MIGRATION_PLAN.md)。

## 部署

安装预发布版：`npm install koishi-plugin-group-daily-analysis@alpha`，在 Koishi 中启用 `group-analysis`。不要与 `chatluna-group-analysis` 同时启用，以免服务和命令重复注册。

**插件依赖 Puppeteer 和 ChatLuna，请确保已安装并配置了 koishi-plugin-puppeteer 和 koishi-plugin-chatluna 插件。**

本分支的群分析、画像、查询解析和漫画分镜均直接调用下述自定义 API，不经过 ChatLuna 模型服务。ChatLuna 依赖用于预设读取/渲染，以及原有工具和提示词变量注册：`group_message_fetch`、`group_user_persona` 保持不变。原有 Puppeteer 图片/PDF 报告不受漫画开关影响。

### 从旧配置迁移

在插件配置中填写 `llm.protocol`、`llm.baseUrl` 和 `llm.apiKey` 并保存，插件会自动获取模型列表，然后在 `llm.model` 中选择模型。生图模型同样在保存 `comic` 地址和密钥后获取。模型列表接口不可用时仍支持手动输入供应商的模型 ID；不会自动替你选择或调用模型。插件只需要两个模型：一个 `llm.model` 负责文本分析、查询和漫画分镜；一个 `comic.model` 负责生图。缺少 API 配置时不会回退 ChatLuna。

| `llm.protocol` | 请求接口 |
| --- | --- |
| `openai-responses` | `/v1/responses` |
| `anthropic-messages` | `/v1/messages` |
| `google-v1beta` | `/v1beta/models/{model}:generateContent` |
| `openai-chat` | `/v1/chat/completions` |

`baseUrl` 推荐填写 API 根地址或带版本的地址（例如 `https://your-provider.example/v1`）。也可填完整接口。`llm.timeout` 默认 120 秒，`llm.maxOutputTokens` 默认 32768，为思考模型预留输出空间。Responses 和 Messages 不发送温度参数，以兼容限制温度的模型；其余文本协议使用 `temperature`。

### 配置角色三视图漫画

在 `comic.characterDescription` 中填写主角外观、服装、性格和口吻。分镜阶段会先注入此角色设定，要求每格出现同一主角并用其口吻说话；参考图在生图阶段上传，不发送给文本分镜模型。未填写角色设定但提供了参考图时，分镜禁止猜测角色外观。生图请求还会固定添加参考图优先的角色一致性约束，避免分镜擅自替换主角。此流程借鉴 AstrBot 原项目的角色设定注入方式。

1. 启用 `comic.enabled`；单独填写 `comic.baseUrl`、`comic.apiKey` 和生图 `comic.model`。
2. `comic.protocol` 选择 `google-v1beta` 或 `openai-images`。Google 模型须支持图片输入/输出；OpenAI 带参考图时使用 `/v1/images/edits`（multipart），不带时使用 `/v1/images/generations`。并非所有兼容代理都支持参考图，失败时不会静默丢弃参考图。
3. 将 PNG/JPEG/WebP 三视图放在 Koishi 所在机器上，通过 `comic.referenceImage` 文件选择控件选择图片（最大 20MB）。远程部署时选择的是服务器文件，不是浏览器所在电脑的文件。该图片会上传给生图供应商；留空则无参考图。三视图不发送给文本模型。
4. 编辑 `comic.prompt` 控制分镜。`{topics}` 替换为提取的话题，`{maxTopics}` 替换为实际话题数量，一话题一分镜，全部分镜一次生成在同一张漫画中。默认要求英文画面描述、简短中文气泡和旁白，以及角色外观一致性。最终分镜全文连同三视图发送到生图 API。
5. 在已启用分析的群发送 `群漫画`，无需天数参数。需要 Koishi 权限等级 3，仅分析 Koishi 所在时区当天 00:00 至今的消息，不受 `useCalendarDayWindow` 和 `cronAnalysisDays` 影响；受 `maxMessages`、`minMessages` 和现有消息过滤规则限制。
6. 如需日报附带漫画，开启 `comic.autoSend`（默认关闭）。手动、自然语言、定时和增量即时日报会复用报告话题，在渲染前启动漫画后台任务；报告发送失败不阻止生图。定时日报还需要配置 `cronSchedule`。空话题不会自动重新调用模型提取；手动 `群漫画 -d 3` 可独立提取近期话题。

手动与定时漫画共用每群并发限制和冷却时间。每群同时只运行一个漫画任务，调用生图接口后默认冷却 10 分钟（`comic.cooldown`），失败也不自动重复付费生图。冷却状态仅在内存中，重载后重置。`comic.timeout` 默认 300 秒；OpenAI 使用 `comic.size`（默认 `1536x1024`，须按模型支持调整），Google 使用 16:9。

地址示例：OpenAI 文本和生图的 `baseUrl` 都可以填 `http://10.1.2.30:8317/v1`。生图也可以填完整的 `http://10.1.2.30:8317/v1/images/edits`；插件会根据是否有参考图选用 `edits` 或 `generations`，不会重复拼接路径。Google 推荐填写 `https://generativelanguage.googleapis.com/v1beta`。模型列表从同一服务的 `/v1/models` 或 `/v1beta/models` 获取；服务商返回的列表可能包含不支持生图的模型，请选择支持图片输出的模型。

生图响应支持 base64 图片，或公开 HTTPS 域名返回的图片 URL；URL 下载不跟随重定向，仅连接经校验的公网 IPv4。内网/仅 IPv6 下载地址不支持。输出图片最大 20MB，API JSON 响应最大 32MB。群聊消息会发给文本供应商，话题/分镜和参考图会发给生图供应商，请事先确认群成员知情。

## 使用

### 详细日志

在插件基础设置中开启 `debug`（详细日志开关）并保存，即可在 Koishi 日志中查看带 `[详细日志]` 前缀的诊断信息，无需修改全局日志等级。默认关闭，关闭后保留原有常规日志。

详细日志包括模型列表获取数量、HTTP 状态、文本输入输出长度、漫画消息数量、参考图大小、话题/分镜/生图/发送阶段、失败阶段及耗时。不输出 API 密钥、完整 URL、聊天正文、提示词和图片内容。排查完成后可关闭。

### 命令

- `群分析 <query: string>` - 分析群聊记录，可以用自然语言指定分析的时间，关键词，或者人物，话题。
- `群分析.启用` - 在发送的群中启用群聊分析
- `群分析.禁用` - 在发送的群中禁用群聊分析
- `群漫画` / `group-comic` - 从当天 00:00 至今的群话题生成漫画
- `群漫画 -d 3` - 分析最近 3 天的群话题并生成漫画
- `群分析.历史 [数量]` - 在当前群查看该平台、机器人和群/频道的历史报告（权限 2）
- `群分析.重绘 [报告ID] -f html` - 复用历史结果重绘，不调用 LLM
- `群分析.主题 [主题ID]` - 列出或切换插件的报告主题（权限 3）；使用重绘命令预览

### 增量与恢复的实际行为

增量模式把新消息计数、消费时间游标和同时间戳消息 ID 保存到数据库，重启后继续使用。同群批次串行，新到消息保留到下一批；失败不推进游标。`incrementalFallbackFull` 允许一次窗口全量回退，仍受 `maxMessages` 限制。增量批次结果保存为 `incremental` 历史记录；话题与金句跨批次去重，称号和质量采用最近批次结果。定时日报会检查批次是否覆盖报告时间范围，不完整时进行普通分析。

报告渲染前保存完整分析结果。每个 LLM 模块成功后也会写入中间检查点；进程重启可复用已完成模块继续分析，随后渲染发送。如果中断发生在文本分析完成前，则重新分析原时间范围。发送失败的结果可用 `群分析.重绘` 取回。恢复不会再次执行付费漫画；发送已成功但完成状态尚未落库的极短窗口内，重启可能重复发送报告。

Token 记录按分析调用计量，增量批次单独记录；缓存重发和同一结果的其他输出格式记为零新增消耗。它不是供应商账单：生图费用、供应商未返回用量的失败请求，以及自然语言解析/对话回复不包含在日报分析 Token 中。

当前原生布局为 `md3`、`anime`、`newspaper`、`art`、`scrapbook`；`ATRI`、`BlueArchive`、`HatsuneMiku`、`retro_futurism`、`art_nouveau`、`spring_festival`、`hack` 在这些布局上叠加独立专题样式。QQ 官方平台的文本报告使用专用 Markdown 生成器，真实适配器投递、Telegram/Discord 专用能力和平台归档仍需部署验收，详见 [实施计划](MIGRATION_PLAN.md)。

### 配置

- `listenerGroups` - 消息监听群组；`autoAnalysisGroupMode`/`autoAnalysisGroups` 单独控制定时目标，避免迁移后扩大定时发送范围
- `cronSchedule` - 定时发送报告的 CRON 表达式
- `cronAnalysisDays` - 定时任务分析的天数
- `promptTopic` - 用于话题总结的 Prompt 模板

聊天质量模块、话题/称号/金句模块都可独立关闭；所有文本分析、查询、用户画像和漫画分镜统一使用 `llm.model` 主模型；旧版各模块的模型覆盖配置不再生效。漫画绘图仍使用独立的生图模型。`llm.retryCount` 与 `retryBackoffSeconds` 控制失败重试。开启 `incrementalEnabled` 后按 `incrementalBatchSize` 累积消息，在 `incrementalWindowHours` 滑动窗口内合并去重；失败按 `incrementalFallbackFull` 回退全量分析。

启用 `outputFormat: html` 或填写 `cronOutputFormats` 可保存 HTML/图片/PDF/文本；`htmlBaseUrl` 设置外链前缀。OneBot 下可按需打开 `uploadGroupFile`/`uploadGroupAlbum`，插件只在适配器暴露相应能力时调用。

## 感谢

- [lumia1998/koishi-plugin-group-daily-analysis](https://github.com/lumia1998/koishi-plugin-group-daily-analysis) 本项目仓库
- [SXP-Simon/astrbot-qq-group-daily-analysis](https://github.com/SXP-Simon/astrbot-qq-group-daily-analysis) AstrBot 的原始项目灵感来源，部分代码参考。
