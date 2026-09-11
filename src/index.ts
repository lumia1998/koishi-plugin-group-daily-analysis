import { Context } from 'koishi'

import { AnalysisService } from './service/analysis'
import { LLMService } from './service/llm'
import { RendererService } from './service/renderer'
import { MessageService } from './service/message'
import { plugin } from './plugin'
import type {} from 'koishi-plugin-puppeteer'
import type { Config as GroupAnalysisConfig } from './config'
import { cron } from './cron'
import { registerModelLists } from './models'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {} from '@koishijs/plugin-console'

export const usage = `
## 配置指南

右侧“配置目录”可跳转到各设置分组；小屏幕可展开目录。

- [参考图例](https://github.com/lumia1998/koishi-plugin-group-daily-analysis#截图)
- [使用说明](https://github.com/lumia1998/koishi-plugin-group-daily-analysis#使用)
- [ChatLuna 预设说明](https://chatluna.chat/guide/preset-system/introduction.html)

在 ChatLuna 导入预设后，从“ChatLuna 预设”分组选择。漫画可继承日报预设，也可单独选择；模型仍由本插件的自定义 API 设置决定。

报告支持聊天质量锐评、HTML 保存与外链；“群分析.历史”查看历史任务，“群分析.重绘”可在不消耗 Token 的情况下换格式重绘，“群分析.主题”可预览/切换皮肤。
`

export * from './config'
export * from './service/message'

export function apply(ctx: Context, config: GroupAnalysisConfig) {
    ctx.inject(['console'], (ctx) => {
        const directory =
            typeof __dirname === 'string'
                ? __dirname
                : path.dirname(fileURLToPath(import.meta.url))
        ctx.console.addEntry({
            dev: path.resolve(directory, '../client/index.ts'),
            prod: path.resolve(directory, '../dist')
        })
    })
    registerModelLists(ctx, config)
    ctx.plugin(MessageService, config)
    ctx.plugin(LLMService, config)
    ctx.plugin(AnalysisService, config)
    ctx.plugin(RendererService, config)

    ctx.inject(
        [
            'chatluna_group_analysis_message',
            'chatluna_group_analysis_llm',
            'chatluna_group_analysis_renderer'
        ],
        (ctx) => {
            plugin(ctx, config)
        }
    )

    ctx.inject(['chatluna_group_analysis'], (ctx) => {
        ctx.effect(() => scheduleAutoAnalysis(ctx, config))
    })
}

function scheduleAutoAnalysis(ctx: Context, config: GroupAnalysisConfig) {
    if (!config.cronSchedule?.trim()) {
        return () => {}
    }

    return cron(
        ctx,
        config.cronSchedule,
        () => ctx.chatluna_group_analysis.executeAutoAnalysisForEnabledGroups(),
        {
            cooldown: config.autoAnalysisCooldown,
            name: 'chatluna-group-analysis'
        }
    )
}
