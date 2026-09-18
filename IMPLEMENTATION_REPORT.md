# 主题配对与用户画像漫画实施报告

基线：main，提交 9c24404。所有改动在本地工作区；本轮未改版本号、未发布 npm、未推送新提交。

## 1. 当前皮肤结构与来源

实际注册 13 个主题，基础资源目录原有 5 个。注册表和组件位于 src/skins，资源位于 resources，Renderer 独立处理群报告和用户画像。

scrapbook 的源码明确标注来自 AstrBot 手账移植。md3、anime、newspaper、art 是当前项目基础实现；anime 有纳西妲风格改版记录。其他八个名字是当前代码的兼容映射，而非八套完整的 AstrBot 原版资源。保留此映射事实和群报告布局，没有替换现有移植主题。

## 2. 每个主题的对应关系与新增视觉

| 标识            | 群报告源  | 用户模板目录    | 用户视觉                     | 本次新增独立用户模板 |
| --------------- | --------- | --------------- | ---------------------------- | -------------------- |
| md3             | md3       | md3             | 物料设计档案卡               | 否                   |
| anime           | anime     | anime           | 二次元人物档案               | 否                   |
| newspaper       | newspaper | newspaper       | 双栏人物专访                 | 否                   |
| art             | art       | art             | 极简人物画册                 | 否                   |
| scrapbook       | scrapbook | scrapbook       | 长期观察手账、便签、事实板   | 否                   |
| simple          | md3       | simple          | 简洁资料页                   | 是                   |
| ATRI            | anime     | ATRI            | 蓝白网格人格观测终端         | 是                   |
| BlueArchive     | anime     | BlueArchive     | 学生证与双栏学籍档案         | 是                   |
| HatsuneMiku     | anime     | HatsuneMiku     | 唱片、声波与编号音轨         | 是                   |
| retro_futurism  | newspaper | retro_futurism  | 星际居民控制台与圆弧舷窗     | 是                   |
| hack            | newspaper | hack            | 等宽字体观测终端日志         | 是                   |
| art_nouveau     | art       | art_nouveau     | 拱形人物藏书与植物纹样       | 是                   |
| spring_festival | scrapbook | spring_festival | 红金人物小传、性情签、雅趣录 | 是                   |

八套新用户档案分别组织版式、装饰和阅读顺序，而非统一模板换色。frontend-design 技能用于确定这些差异化布局。基础主题继续使用原有 CSS 与布局，补充用户编号、更新时间和中文说明。

## 3. Renderer 与数据边界

- 保留 renderGroupAnalysis、renderGroupAnalysisToPdf、renderGroupAnalysisHtml、renderUserPersona 入口。
- 启动时准备全部注册主题：复制基础资源，再覆盖主题专用资源。
- 查找次序为当前主题、映射源、md3；未知主题回退默认实现。
- 新用户模板有 data-profile-theme 标记，不被群报告别名样式覆盖。
- 继续使用现有 UserPersonaProfile，未新增重复画像字段或数据库表。
- 群称号明确为本期表现；长期行为、兴趣与社交习惯保留在独立用户档案。
- 群报告保留话题、称号、金句、锐评、活跃统计，手账补齐群名和活跃排行。实际分析时间范围现在进入报告，旧报告仍可按原保存结果重绘。
- 普通模板文本统一转义，注册皮肤的文本组件也统一转义输入；仅组件生成的 HTML 可原样插入。恶意昵称、话题、金句、画像特征和依据均有回归测试。

## 4. 用户画像漫画完整流程

1. 用户执行“用户画像 漫画 [@用户]”或“用户画像.漫画 [@用户]”；无参数时目标为本人。
2. 校验群聊、群分析启用状态、漫画服务和画像漫画开关。
3. 使用 Koishi 用户参数解析；无参数为本人，生成他人画像漫画只接受 @用户，不接受裸用户编号。
4. 查看他人需要权限等级 3；权限不足直接拒绝，不会静默转为本人。
5. 通过 getUserPersona(platform, selfId, userId) 读取缓存或数据库中的既有画像；正确使用其 profile 与 username 包装。
6. 无画像时明确提示先生成画像，不获取历史消息、不重新分析、不请求图像接口。
7. 进入现有漫画 run 流程，复用角色方案、本地参考图、群权限、运行锁和冷却。
8. 先按当前皮肤渲染普通用户画像报告，将其作为内容、头像、配色与主题参考；角色图片只负责主持角色的外观。
9. 独立用户漫画 Prompt Builder 将画像交给已有文本模型，一次完成“总体概览、性格特质、兴趣爱好、沟通风格”四维提炼与分镜设计。
10. 生图提示词固定四格、一个维度一格、同一主持角色，并明确区分被分析对象头像与主持角色；画像依据不画进气泡。
11. 调用现有 generateImage，复用 OpenAI/Google、请求超时、并发、取消信号、图像校验和发送逻辑。

用户画像漫画没有新增历史表，因为当前群漫画也没有独立漫画历史存储。群报告历史与检查点能力保持原状。

## 5. Prompt Builder 与分镜规则

src/user-comic-prompts.ts 定义 defaultUserComicPrompt、buildUserComicPrompt、buildUserComicImagePrompt；src/skins/user-comic.ts 为五个基础视觉族和八个映射主题提供布局、艺术方向与画布规格。没有将群话题提示词简单替换为用户提示词。

输入包含昵称、用户编号、summary、keyTraits、interests、communicationStyle、evidence、已有更新时间。模型按固定四维逐格注明画像依据和场景。角色配置只提供主持角色的表现建议，不得替换用户性格。

例如测试画像会把总体状态、行为特质、具体兴趣和表达方式分别组织进四个分镜。缺少某个字段时明确标记资料不足；四个维度中少于三个有效维度时停止生成。Evidence 用来理解特点形成的依据，不要求把长聊天原文画成台词。

## 6. 配置与命令

用户画像漫画仅新增一项业务配置：

| 保存键            | 显示名称         | 默认  |
| ----------------- | ---------------- | ----- |
| comic.userEnabled | 启用用户画像漫画 | false |

接口、密钥、模型、尺寸、超时、角色方案、图片、并发和冷却均共用。已有 comic.enabled 作为漫画服务开关。配置组显示为“模型接口与漫画”“漫画设置”。

话题、称号、金句、聊天质量、长期画像、查询解析、分析对话、群漫画分镜和用户画像漫画提示词全部由源码内置，配置界面不再提供编辑项。旧配置键可残留在配置文件中，但运行时不会读取；升级插件会自动切换到新版提示词。角色描述与 ChatLuna 预设不是任务提示词，继续保留为可配置项。

命令层级调整为：`用户画像` 生成普通画像，`用户画像 漫画 [@用户]` 与 `用户画像.漫画 [@用户]` 生成漫画版。无参数为本人，生成他人版本需要 @用户与权限等级 3；没有已保存画像时不调用模型或生图接口。

全部 schema 字段有中文显示标题；英文保存键不改名。侧边目录继续排除“过滤器设置”和“运行日志”。中文标题清理、恢复及插件隔离由浏览器测试验证。

## 7. 实际修改文件

业务和模板基础设施：

- src/config.ts
- src/plugins/comic.ts
- src/service/analysis.ts
- src/service/renderer.ts
- src/skins/art.ts
- src/skins/index.ts
- src/skins/md3.ts
- src/skins/newspaper.ts
- src/skins/scrapbook.ts
- src/skins/types.ts
- src/skins/escape.ts（新增）
- src/user-comic-prompts.ts（新增）
- src/analysis-prompts.ts（新增）
- src/skins/user-comic.ts（新增）
- src/utils.ts
- client/ConfigNavigation.vue
- client/config-labels.ts（新增）

原有模板：

- resources/anime/template_group.html
- resources/anime/template_user.html
- resources/art/template_group.html
- resources/art/template_user.html
- resources/md3/template_group.html
- resources/md3/template_user.html
- resources/newspaper/template_group.html
- resources/newspaper/template_user.html
- resources/scrapbook/template_group.html
- resources/scrapbook/template_user.html

新增用户模板：

- resources/ATRI/template_user.html
- resources/BlueArchive/template_user.html
- resources/HatsuneMiku/template_user.html
- resources/art_nouveau/template_user.html
- resources/hack/template_user.html
- resources/retro_futurism/template_user.html
- resources/simple/template_user.html
- resources/spring_festival/template_user.html

测试和文档：

- tests/api-comic.test.cts
- tests/reliability.test.cts
- tests/ui/main.ts
- tests/ui/verify.cts
- tests/config-labels.test.cts（新增）
- tests/theme-fixtures.cts（新增）
- tests/themes.test.cts（新增）
- tests/ui/reports.cts（新增）
- tests/user-comic.test.cts（新增）
- tests/prompt-hardcode.test.cts（新增）
- README.md
- MIGRATION_PLAN.md
- SKIN_DEVELOPMENT.md
- IMPLEMENTATION_REPORT.md（本报告）

## 8. 验证结果

| 检查                      | 结果                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| npm test                  | 61 项通过                                                                     |
| npm run lint              | 0 错误，15 项长行警告                                                         |
| npm run build             | 成功，生成服务端双格式与前端资源                                              |
| npm run test:ui           | 配置页 10 个实际分组与中文标题通过；13 主题 × 群/用户 × 亮/暗，共 52 组合通过 |
| git diff --check          | 通过                                                                          |
| npm pack --dry-run --json | 包含 5 个群模板、13 个用户模板及对应资源                                      |

新增覆盖包括初始化、运行时切换、源模板回退、未知主题回退，全部皮肤群图片/PDF/HTML 和用户图片路径，字段完整性、空状态和注入文本。画像漫画测试验证无画像无模型请求、权限降级、原始编号解析、参考图实际上传、共用冷却/运行锁、取消不生图、不重分析和特点提示词。

报告浏览器测试使用离线字体回退并关闭第三方取色脚本，检查正文可见、容器和正文横向溢出。二次元角落贴纸的设计性外伸不作为正文溢出。截图位于 artifacts/themes；配置页截图位于 artifacts/navigation。

## 9. 兼容性与技术限制

- 图像接口按需求使用 Mock 验证，没有调用真实付费服务；最终画面质量、中文文字准确度和模型对分镜要求的服从度依赖服务商模型。
- 四维提取和场景对应由一次文本模型调用完成，不使用硬编码人格分类，也不保证模型事实判断绝对正确。
- 用户画像报告由现有渲染器生成并作为首张参考图；角色参考图仍沿用已有本地文件链路，没有新增自动下载 QQ 头像。
- 旧保存的自定义提示词不再生效；所有任务提示词以当前插件版本中的内置实现为准。
- HTML 外部字体、原有动态取色资源在生产环境可能受网络影响；本次验证不依赖这些外部资源。
- 中文配置标题适配当前 Koishi 配置组件的 DOM 结构；未来上游组件结构变化时需重新核对选择器。
- 构建保留工具链的 CJS/import.meta 与 Vite 兼容性提示。没有更改文本协议、数据库结构、增量分析机制或 UI 技术栈。
