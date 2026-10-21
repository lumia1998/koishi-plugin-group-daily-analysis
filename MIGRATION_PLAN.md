# 配置与数据库迁移

## 当前配置精简

- 群分析、定时任务和漫画统一使用 `listenerGroups`，保留 `enableAllGroupsByDefault` 与每行 `comicEnabled`。`autoAnalysisGroupMode`、`autoAnalysisGroups`、`comic.groupMode`、`comic.groups` 不再读取。
- 导航只保留同级的“文本模型接口”和“漫画设置”；生成随机度合入文本模型接口，保存路径仍为顶层 `temperature`，`llm` 和 `comic` 接口配置路径不变。
- 群漫画固定使用文本分镜，用户画像漫画仍根据画像报告图直接生图。`comic.generationMode` 不再读取。
- 角色只保留单张 `comic.referenceImage`。`comic.characterProfiles`、`comic.characterSelection` 不再读取，也不再读写每日角色选择文件。旧方案中的图片需要自行选择一张填入角色参考图。
- 移除备用接口、内容重试、提示词改写与地址回退：`comic.fallbackProviders`、`comic.contentRetryKeywords`、`comic.contentRetries`、`comic.promptRewrite`、`comic.fallbackToUrl` 不再读取。
- 重试为内部默认行为：文本请求最多重试 2 次，退避 1 秒、2 秒；生图临时网络故障最多重试 2 次，退避 2 秒、4 秒，超时、取消、内容错误或下载失败直接结束。生图重试可能单独计费。
- `llm.retryCount`、`llm.retryBackoffSeconds`、`comic.networkRetries`、`comic.retryDelaySeconds` 不再读取，旧值可删除。
- 本次不涉及数据库迁移。以下章节记录此前版本变更；与本节冲突时以本节为准。

## 漫画上游能力迁移

本次从上游 AstrBot 插件 astrbot_plugin_qq_group_daily_analysis（https://github.com/SXP-Simon/astrbot_plugin_qq_group_daily_analysis ，MIT 许可）迁移漫画生成流程，实现按本项目风格重写。

新增配置键与默认值：

- `comic.generationMode`：`'storyboard'`（默认，文本分镜后生图，仅群漫画）或 `'direct'`（旧版兼容，报告图直接生图）；用户画像漫画始终 direct。
- `comic.characterProfiles`（默认 `[]`）：主持角色方案数组，每项含 `profileName`（`''`）、`enabled`（`true`）、`persona`（`''`）、`referenceFiles`（`[]`，最多取前 6 张）。
- `comic.characterSelection`：`'first'`（默认）或 `'daily'`（每天随机，记录在 `data/chatluna/group_analysis/comic-character.json`）。
- `comic.fallbackProviders`（默认 `[]`）：备用生图接口，每项含 `enabled`/`format`/`baseUrl`/`apiKey`/`model`，主接口失败后按顺序尝试。
- `comic.networkRetries`（`0`）、`comic.retryDelaySeconds`（`2`）：网络类错误重试与间隔；超时不重试。
- `comic.contentRetryKeywords`（`[]`）、`comic.contentRetries`（`0`）、`comic.promptRewrite`（`false`）：内容异常关键词、同接口重试次数与失败后文本改写。
- `comic.fallbackToUrl`（`false`）：图片下载失败时把返回地址直接交给平台发送。

生图格式仍仅支持 `openai` 和 `google`；上游的部分服务商协议（`openai-chat`、`xai`、`doubao`、`dashscope`）未纳入本项目。升级后群漫画默认从报告图直接生图切换为文本分镜后生图，如需保留旧行为请显式设置 `comic.generationMode = 'direct'`。

本版同时移除了群文件/群相册归档功能：`uploadGroupFile`、`uploadGroupAlbum`、`groupUploadTransport`、`groupAlbumName`、`comic.uploadAlbum`、`comic.albumName` 不再读取，旧配置可删除。

旧键 `comic.characters`、`comic.referenceImages`、`comic.randomCharacterDaily`、`comic.characterDescription` 仍不读取，可直接移除；需要多角色或多参考图时请改用 `comic.characterProfiles`。无需数据库迁移。

## 每群漫画开关

- 在“监听群组”表新增 `comicEnabled`（启用群漫画），默认 `true`；缺少字段的旧配置及没有对应列表项的群延续原有行为。
- 关闭某行后，对应群的手动群漫画和自动群漫画都会停止，自动任务静默跳过；普通群日报、消息监听和用户画像漫画继续按原权限运行。
- 群漫画开关按平台、机器人及频道/群组 ID 匹配，同一目标的重复配置以关闭为准；开启默认全群监听时仍遵守该开关。全局漫画开关和漫画白/黑名单继续生效。
- 无需数据库迁移。通过“群分析.启用”新建的监听行默认允许群漫画，重新启用已有行会保留其漫画开关值；“群分析.禁用”仅关闭监听，不删除该行及其漫画偏好。启用、禁用及状态命令均按平台和机器人定位对应行。

## 配置字段清理

- 从配置 Schema 删除七个已由内置提示词替代的字段及其重复默认文本：`promptTopic`、`promptUserTitles`、`promptGoldenQuotes`、`promptUserPersona`、`promptChatQuality`、`promptQueryParser`、`promptQueryChat`。文本分析继续使用 `src/analysis-prompts.ts`，无需重新配置提示词。
- 删除旧漫画预设来源的显示标签。配置文件中残留的 `comic.presetMode`、`comic.preset`、`comic.prompt` 和 `comic.userPrompt` 均可移除。
- 删除顶层 `preset` 配置、整个“ChatLuna 预设”配置组、预设读取与消息注入服务，以及文本接口中仅供注入使用的消息分支。所有文本任务直接使用内置提示词；旧配置中的 `preset` 可移除，残留值也不会读取。ChatLuna 消息工具和提示词函数继续保留。
- 删除 `comic.referenceImages`、`comic.characters`、`comic.randomCharacterDaily`、`comic.characterDescription` 及其角色选择、多图加载和设定注入逻辑。仅保留单张角色参考图 `comic.referenceImage`，群漫画和用户画像漫画共用；留空时由生图模型设计角色。旧配置中的四项可直接移除；若以前仅在角色方案或多图列表中放置图片，可自行选择一张填入 `comic.referenceImage`。
- 旧分模块模型字段 `llm.topicModel`、`llm.titleModel`、`llm.goldenQuoteModel`、`llm.qualityModel`、`llm.personaModel`、`llm.queryModel`、`llm.chatModel` 和 `llm.comicModel` 不再使用，均可移除。文本任务使用 `llm.model`，生图使用 `comic.model`。
- 仍有用途的条件配置继续保留：`temperature` 只作用于 Google 文本接口，`comic.size` 只控制 OpenAI 群漫画。配置说明补充单张角色参考图、自动漫画触发范围及并发限制。
- 本次清理不需要数据库迁移。旧配置残留值不再读取；插件不会自动修改 Koishi 配置文件或把旧角色图片迁移到单图配置。

## 主题配对与用户画像漫画

- 原有 13 个皮肤标识保持兼容。群日报沿用原来的基础模板和映射；新增八个映射主题专用的用户档案模板。
- 模板加载优先选择主题自己的文件，缺失时回退到映射源，再回退默认物料设计主题。初始化为全部主题先复制基础资源，再覆盖主题专用资源。
- `comic.userEnabled` 默认关闭；启用后可使用 `用户画像 漫画 [@用户]` 或 `用户画像.漫画 [@用户]`。不传参数时生成自己的漫画，生成他人的漫画必须使用 @ 并具备权限等级 3。
- 生图接口、密钥、模型、超时、角色图片、冷却及并发全部沿用漫画设置，不需要第二套接口配置。
- 用户画像漫画读取已保存画像，不自动刷新或重跑分析；已有画像结构与数据库表完全保留。不新增漫画历史表。
- 群日报中的“群友画像”改称“本期群友称号”。话题、称号、金句、锐评、统计均保留，手账补齐群名与活跃排行。
- 配置界面显示中文标题，保存的英文配置键不变。过滤器与运行日志仍不出现在侧边配置目录。
- 分析、查询以及两种漫画的生图提示词全部改为插件内置，配置界面不再显示提示词编辑项。旧配置中残留的提示词值会被忽略，升级后直接采用新版内置提示词。漫画不再调用单独的文本分镜模型。
- HTML 文本通过统一转义边界处理，只有皮肤生成的组件 HTML 保持原样。自定义皮肤应返回结构 HTML，不要提前把输入字段重复转义。

以下是此前版本的配置迁移说明；本次主题和画像漫画更新无需执行数据库清理。

本版本移除了增量分析和可关闭的核心日报模块。HTML 报告仍可输出，但不再提供保存目录或外链前缀配置。升级前请备份数据库与 Koishi 配置文件。

## 配置变更

- 将 **llm.format** 设为 **openai**、**google** 或 **anthropic**。**openai** 使用 Responses API。
- 将 **comic.format** 设为 **openai** 或 **google**。
- 删除已废弃的增量、HTML 保存目录/外链前缀、用户过滤、ChatLuna Tools 开关和日报模块开关配置。
- 删除日报内容数量配置；三类并发上限仍保留，可在接口限流或机器内存不足时调小。
- 删除全部提示词配置项；提示词随插件版本统一更新，旧值无需手动迁移。
- 所有日报固定生成热门话题、用户称号、金句与聊天质量锐评；ChatLuna Tools 始终注册。

旧的协议级配置值不会由运行时代码兼容或读取。请在 Koishi 控制台保存新的配置格式。

## 数据库清理

运行时不再注册或读取 **chatluna_incremental_states**。确认升级后的手动分析与定时日报正常后，可通过所用数据库的管理工具删除这张表：

```sql
DROP TABLE chatluna_incremental_states;
```

先备份数据库；若数据库不支持直接删除，请按其管理工具的迁移流程执行。**chatluna_messages**、**chatluna_analysis_reports**、**chatluna_analysis_checkpoints** 和 **chatluna_user_personas** 必须保留。

旧报告仍保存在 **chatluna_analysis_reports**；重绘时会使用当前支持的图片、PDF 或文本格式。
