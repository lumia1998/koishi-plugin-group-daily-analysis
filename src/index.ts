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

配置页仅保留实际会影响群聊日报的设置。报告默认输出为图片；“群分析.历史”可查看历史任务，“群分析.重绘”可在不消耗 Token 的情况下以图片、PDF 或文本重新渲染。
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
