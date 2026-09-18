# 皮肤开发指南

一个皮肤同时定义群日报和长期用户档案，两者独立传入数据。群友称号只代表本期表现，不能代替长期用户画像。

## 当前结构

注册中心为 `src/skins/index.ts`，接口为 `src/skins/types.ts`，渲染入口为 `RendererService.renderGroupAnalysis()` 与 `renderUserPersona()`。HTML 与 PDF 群报告仍由同一套模板生成。

| 主题 | 群模板来源 | 用户模板来源 |
| --- | --- | --- |
| md3 / anime / newspaper / art / scrapbook | 各自目录 | 各自目录 |
| simple | md3 | simple |
| ATRI / BlueArchive / HatsuneMiku | anime | 各自目录 |
| retro_futurism / hack | newspaper | 各自目录 |
| art_nouveau | art | art_nouveau |
| spring_festival | scrapbook | spring_festival |

基础五套是实际独立模板；scrapbook 的源码明确标注从 AstrBot 手账移植。其他兼容主题通过 `skinSourceMap` 复用群日报布局和组件，再叠加主题样式；不是将上游所有资源原样复制。

## 资源加载

每个主题可包含 `template_group.html`、`template_user.html`、CSS 与图片。未覆盖的文件继续复用映射源，不需要重复复制目录。

初始化为全部注册主题准备资源：先复制映射源，再覆盖主题的独立资源。读取时依次尝试当前主题、映射源、md3。未知主题回退 md3。报告生成时使用实际模板所在目录解析相对资源，运行中切换主题也能保持配对。

八个映射主题新增的用户模板自带样式和独立布局，明确使用 `data-profile-theme`，避免群模板的别名覆盖层干扰独立用户模板。基础主题继续使用其原有 CSS 和档案布局。

## 模板数据

群日报字段：

- 纯文本：`groupName`、`analysisDate`、`totalMessages`、`totalParticipants`、`totalChars`、`emojiCount`、`mostActivePeriod`。
- 组件 HTML：`userStats`、`topics`、`userTitles`、`goldenQuotes`、`chatQuality`、`activeHoursChart`。

独立用户档案字段：

- 纯文本：`userId`、`username`、`analysisDate`（最近更新时间）、`summary`、`communicationStyle`。
- 组件 HTML：`keyTraits`、`interests`、`evidence`。
- 图片：`avatar`、`dynamicAvatarUrl`。
- 两类模板均可使用 `theme` 控制亮暗样式。

行为习惯、常见话题和社交特征分别组织在既有摘要、性格、兴趣、沟通字段中，不新增重复数据结构。

## 用户画像漫画

`src/skins/user-comic.ts` 定义用户画像漫画的视觉导演规范。漫画内容固定为总体概览、性格特质、兴趣爱好和沟通风格四个维度，当前皮肤只决定画布、布局、材质、色彩与主持方式。

五个基础主题各有一套规范，映射主题通过 `skinSourceMap` 继承基础族，再追加专属视觉覆盖。新增皮肤时应同步检查 `getUserComicVisualSpec()`：基础族皮肤需要增加完整规范，映射皮肤通常只需增加一段覆盖要求。

生图参考图顺序具有语义：第一张是当前皮肤渲染的用户画像报告，负责事实、被分析对象头像与主题语言；后续图片是主持角色参考。提示词必须维持两种人物的边界，不能把画像头像改造成主持角色。用户漫画使用独立竖版尺寸，不得改变群漫画的横版配置。

## 转义边界

注册中心在调用皮肤文本组件之前通过 `escapeSkinData()` 转义字符串。组件接收已安全处理的数据，仅生成可信 HTML 结构。不要对输入再次转义，也不要将未经过此边界的外部数据直接传入组件。

`renderTemplate()` 默认转义所有标量，仅上述组件字段允许原样插入。图片地址只接受 HTTP(S) 或 PNG/JPEG/WebP 的 base64 数据地址。群头像链接中的用户编号使用 URL 编码。

新模板必须保留核心日报模块及空状态，不能靠隐藏整个模块处理数据缺失。所有可见标题使用中文。

## 增加主题

1. 注册主题渲染器，或在映射表中指定已有源主题。
2. 增加独立资源，确保群报告和用户档案视觉协调。
3. 容器选择器须与注册的 `containerSelector` 一致。
4. 将主题加入中文配置选项。
5. 检查有内容、空内容、长文本和恶意 HTML 输入。
6. 执行下列检查：

```bash
npm test
npm run lint
npm run build
npm run test:ui
git diff --check
```

`tests/themes.test.cts` 遍历全部注册主题，使用实际渲染路径验证群图、PDF、HTML、用户画像与转义。浏览器验证覆盖每个主题的群/用户模板及亮暗两种模式，截图输出到 `artifacts/themes`。浏览器报告测试屏蔽外部字体与动态取色脚本，以验证离线布局；生产环境仍可加载这些可选资源。
