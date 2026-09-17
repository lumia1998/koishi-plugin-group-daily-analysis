# 配置与数据库迁移

本版本移除了增量分析和可关闭的核心日报模块。HTML 报告仍可输出，但不再提供保存目录或外链前缀配置。升级前请备份数据库与 Koishi 配置文件。

## 配置变更

- 将 **llm.format** 设为 **openai**、**google** 或 **anthropic**。**openai** 使用 Responses API。
- 将 **comic.format** 设为 **openai** 或 **google**。
- 删除已废弃的增量、HTML 保存目录/外链前缀、用户过滤、ChatLuna Tools 开关和日报模块开关配置。
- 删除日报内容数量配置；三类并发上限仍保留，可在接口限流或机器内存不足时调小。
- 所有日报固定生成热门话题、用户称号、金句与聊天质量锐评；ChatLuna Tools 始终注册。

旧的协议级配置值不会由运行时代码兼容或读取。请在 Koishi 控制台保存新的配置格式。

## 数据库清理

运行时不再注册或读取 **chatluna_incremental_states**。确认升级后的手动分析与定时日报正常后，可通过所用数据库的管理工具删除这张表：

~~~sql
DROP TABLE chatluna_incremental_states;
~~~

先备份数据库；若数据库不支持直接删除，请按其管理工具的迁移流程执行。**chatluna_messages**、**chatluna_analysis_reports**、**chatluna_analysis_checkpoints** 和 **chatluna_user_personas** 必须保留。

旧报告仍保存在 **chatluna_analysis_reports**；重绘时会使用当前支持的图片、PDF 或文本格式。
