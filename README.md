<div align="center">

# koishi-plugin-group-daily-analysis

_Koishi 群聊分析插件_

## [![npm](https://img.shields.io/npm/v/koishi-plugin-group-daily-analysis/alpha)](https://www.npmjs.com/package/koishi-plugin-group-daily-analysis) ![node version](https://img.shields.io/badge/node-%3E=18-green)

</div>

> 本版基于 [ChatLunaLab/chatluna-group-analysis](https://github.com/ChatLunaLab/chatluna-group-analysis) 改造；其源自 lumia1998 的群分析插件。保留原作者贡献与 AGPL-3.0 许可。
> `0.0.1-alpha.2` 为自定义 API 与群漫画的预发布版本。

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

## 部署

安装预发布版：`npm install koishi-plugin-group-daily-analysis@alpha`，在 Koishi 中启用 `group-analysis`。不要与 `chatluna-group-analysis` 同时启用，以免服务和命令重复注册。

**插件依赖 Puppeteer 和 ChatLuna，请确保已安装并配置了 koishi-plugin-puppeteer 和 koishi-plugin-chatluna 插件。**

本分支的群分析、画像、查询解析和漫画分镜均直接调用下述自定义 API，不经过 ChatLuna 模型服务。ChatLuna 依赖仍用于原有工具和提示词变量注册：`group_message_fetch`、`group_user_persona` 保持不变。原有 Puppeteer 图片/PDF 报告不受漫画开关影响。

### 从旧配置迁移

在插件配置中填写 `llm.protocol`、`llm.baseUrl` 和 `llm.apiKey` 并保存，插件会自动获取模型列表，然后在 `llm.model` 中选择模型。生图模型同样在保存 `comic` 地址和密钥后获取。模型列表接口不可用时仍支持手动输入供应商的模型 ID；不会自动替你选择或调用模型。插件只需要两个模型：一个 `llm.model` 负责文本分析、查询和漫画分镜；一个 `comic.model` 负责生图。缺少 API 配置时不会回退 ChatLuna。

| `llm.protocol` | 请求接口 |
| --- | --- |
| `openai-responses` | `/v1/responses` |
| `anthropic-messages` | `/v1/messages` |
| `google-v1beta` | `/v1beta/models/{model}:generateContent` |
| `openai-chat` | `/v1/chat/completions` |

`baseUrl` 推荐填写 API 根地址或带版本的地址（例如 `https://your-provider.example/v1`）。也可填完整接口。`llm.timeout` 默认 120 秒，`llm.maxOutputTokens` 默认 8192。Responses 和 Messages 不发送温度参数，以兼容限制温度的模型；其余文本协议使用 `temperature`。

### 配置角色三视图漫画

1. 启用 `comic.enabled`；单独填写 `comic.baseUrl`、`comic.apiKey` 和生图 `comic.model`。
2. `comic.protocol` 选择 `google-v1beta` 或 `openai-images`。Google 模型须支持图片输入/输出；OpenAI 带参考图时使用 `/v1/images/edits`（multipart），不带时使用 `/v1/images/generations`。并非所有兼容代理都支持参考图，失败时不会静默丢弃参考图。
3. 将 PNG/JPEG/WebP 三视图放在 Koishi 所在机器上，通过 `comic.referenceImage` 文件选择控件选择图片（最大 20MB）。远程部署时选择的是服务器文件，不是浏览器所在电脑的文件。该图片会上传给生图供应商；留空则无参考图。三视图不发送给文本模型。
4. 编辑 `comic.prompt` 控制分镜。`{topics}` 替换为提取的话题，`{maxTopics}` 替换为漫画话题上限（默认 3）。默认要求英文画面描述、简短中文气泡和旁白，以及角色外观一致性。最终分镜全文连同三视图发送到生图 API。
5. 在已启用分析的群发送 `群漫画`，无需天数参数。需要 Koishi 权限等级 3，仅分析 Koishi 所在时区当天 00:00 至今的消息，不受 `useCalendarDayWindow` 和 `cronAnalysisDays` 影响；受 `maxMessages`、`minMessages` 和现有消息过滤规则限制。
6. 如需定时附带漫画，开启 `comic.autoSend`（默认关闭）并配置 `cronSchedule`。定时群报告处理完成后，向同一群发送当天漫画。

手动与定时漫画共用每群并发限制和冷却时间。每群同时只运行一个漫画任务，调用生图接口后默认冷却 10 分钟（`comic.cooldown`），失败也不自动重复付费生图。冷却状态仅在内存中，重载后重置。`comic.timeout` 默认 300 秒；OpenAI 使用 `comic.size`（默认 `1536x1024`，须按模型支持调整），Google 使用 16:9。

地址示例：OpenAI 文本和生图的 `baseUrl` 都可以填 `http://10.1.2.30:8317/v1`。生图也可以填完整的 `http://10.1.2.30:8317/v1/images/edits`；插件会根据是否有参考图选用 `edits` 或 `generations`，不会重复拼接路径。Google 推荐填写 `https://generativelanguage.googleapis.com/v1beta`。模型列表从同一服务的 `/v1/models` 或 `/v1beta/models` 获取；服务商返回的列表可能包含不支持生图的模型，请选择支持图片输出的模型。

生图响应支持 base64 图片，或公开 HTTPS 域名返回的图片 URL；URL 下载不跟随重定向，仅连接经校验的公网 IPv4。内网/仅 IPv6 下载地址不支持。输出图片最大 20MB，API JSON 响应最大 32MB。群聊消息会发给文本供应商，话题/分镜和参考图会发给生图供应商，请事先确认群成员知情。

## 使用

### 命令

- `群分析 <query: string>` - 分析群聊记录，可以用自然语言指定分析的时间，关键词，或者人物，话题。
- `群分析.启用` - 在发送的群中启用群聊分析
- `群分析.禁用` - 在发送的群中禁用群聊分析
- `群漫画` / `group-comic` - 从当天 00:00 至今的群话题生成漫画

### 配置

- `allowedGroups` - 允许使用此插件的群号列表
- `cronSchedule` - 定时发送报告的 CRON 表达式
- `cronAnalysisDays` - 定时任务分析的天数
- `promptTopic` - 用于话题总结的 Prompt 模板

## 感谢

- [lumia1998/koishi-plugin-group-daily-analysis](https://github.com/lumia1998/koishi-plugin-group-daily-analysis) 本项目仓库
- [SXP-Simon/astrbot-qq-group-daily-analysis](https://github.com/SXP-Simon/astrbot-qq-group-daily-analysis) AstrBot 的原始项目灵感来源，部分代码参考。
