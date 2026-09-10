import { Context, h, Session } from 'koishi'
import { Config, GroupListener } from '../config'
import { calculateBasicStats, shouldListenToMessage } from '../utils'
import { generateImage, imageMime, loadReference } from '../service/image'
import { createTrace, errorKind } from '../diagnostics'

export const inject = [
    'chatluna_group_analysis_message',
    'chatluna_group_analysis_llm'
]

declare module 'koishi' {
    interface Events {
        'group-daily-analysis/auto-comic'(group: GroupListener): Promise<void>
    }
}

export function todayWindow(now = new Date()) {
    const startTime = new Date(now)
    startTime.setHours(0, 0, 0, 0)
    return { startTime, endTime: now }
}

export function apply(ctx: Context, config: Config) {
    const trace = createTrace(ctx, !!config.debug, '群漫画')
    const running = new Map<string, AbortController>()
    const lastRun = new Map<string, number>()
    ctx.on('dispose', () => {
        for (const controller of running.values()) controller.abort()
    })
    const run = async (
        session: Pick<
            Session,
            | 'platform'
            | 'selfId'
            | 'guildId'
            | 'channelId'
            | 'isDirect'
            | 'send'
        >
    ) => {
        if (!session || session.isDirect) return '请在群聊中使用群漫画。'
        if (!config.comic?.enabled) return '请先在插件配置中启用漫画功能。'
        if (
            !config.enableAllGroupsByDefault &&
            !shouldListenToMessage(session as Session, config.listenerGroups)
        )
            return '本群未启用分析，请先使用 群分析.启用。'
        if (!config.comic.baseUrl || !config.comic.model)
            return '请配置生图 API 地址和模型。'
        const key = [
            session.platform,
            session.selfId,
            session.guildId,
            session.channelId
        ].join(':')
        if (running.has(key)) return '本群已有漫画正在生成。'
        if (
            Date.now() - (lastRun.get(key) ?? 0) <
            config.comic.cooldown * 60000
        )
            return '漫画生成处于冷却时间，请稍后再试。'
        const controller = new AbortController()
        const started = Date.now()
        let stage = '读取参考图'
        trace('任务开始', { group: key })
        running.set(key, controller)
        try {
            const reference = await loadReference(
                config.comic.referenceImage,
                ctx.baseDir
            )
            trace('参考图读取完成', { bytes: reference?.length ?? 0 })
            stage = '获取当天消息'
            await session.send('正在提取群话题并生成漫画，请稍候。')
            const messages =
                await ctx.chatluna_group_analysis_message.getHistoricalMessages(
                    {
                        selfId: session.selfId,
                        guildId: session.guildId,
                        channelId: session.channelId,
                        ...todayWindow(),
                        limit: config.maxMessages,
                        purpose: 'group-analysis'
                    }
                )
            if (controller.signal.aborted) return
            const filtered = messages.filter(
                (message) =>
                    message.userId !== session.selfId &&
                    !/^\s*[/.]?(群漫画|group-comic|群分析|group-analysis)(\s|$)/.test(
                        message.content
                    )
            )
            trace('消息获取完成', {
                total: messages.length,
                filtered: filtered.length,
                minimum: config.minMessages
            })
            if (filtered.length < config.minMessages)
                return `消息不足，需要至少 ${config.minMessages} 条。`
            stage = '话题分析'
            const topics =
                await ctx.chatluna_group_analysis_llm.summarizeTopics(
                    calculateBasicStats(filtered).allMessagesText.join('\n'),
                    undefined,
                    controller.signal
                )
            if (controller.signal.aborted) return
            if (!Array.isArray(topics) || !topics.length)
                return '未提取到有效话题。'
            trace('话题分析完成', { topics: topics.length })
            stage = '生成分镜'
            const prompt = config.comic.prompt
                .replaceAll('{maxTopics}', String(config.comic.maxTopics))
                .replaceAll(
                    '{topics}',
                    JSON.stringify(topics.slice(0, config.comic.maxTopics))
                )
            const storyboard =
                await ctx.chatluna_group_analysis_llm.generateText(
                    prompt,
                    undefined,
                    controller.signal
                )
            lastRun.set(key, Date.now())
            trace('分镜生成完成', { chars: storyboard.length })
            stage = '调用生图 API'
            const image = await generateImage(
                config.comic,
                storyboard,
                reference,
                controller.signal,
                trace
            )
            stage = '发送漫画'
            if (!controller.signal.aborted) {
                await session.send(h.image(image, imageMime(image)))
                trace('发送完成', { bytes: image.length })
            }
        } catch (error) {
            trace('任务失败', {
                stage,
                reason: errorKind(error),
                cancelled: controller.signal.aborted
            })
            if (!controller.signal.aborted)
                return '漫画生成或发送失败，请检查 API 配置、三视图路径、模型图片输入能力和网络。不会自动重复付费生图。'
        } finally {
            trace('任务结束', { stage, elapsedMs: Date.now() - started })
            running.delete(key)
        }
    }
    ctx.command('群漫画', '将当天 00:00 至今的群话题生成漫画', {
        authority: 3,
        checkArgCount: true
    })
        .alias('group-comic')
        .action(async ({ session }) => run(session))

    ctx.on('group-daily-analysis/auto-comic', async (group) => {
        trace('定时漫画触发', {
            enabled: !!config.comic?.enabled,
            autoSend: !!config.comic?.autoSend
        })
        if (!config.comic?.enabled || !config.comic.autoSend) return
        const bot = ctx.bots.find(
            (bot) =>
                bot.selfId === group.selfId && bot.platform === group.platform
        )
        if (!bot) return
        const send = (content: Parameters<Session['send']>[0]) =>
            bot.sendMessage(group.channelId, content, group.guildId)
        const error = await run({
            platform: group.platform,
            selfId: group.selfId,
            guildId: group.guildId,
            channelId: group.channelId,
            isDirect: false,
            send
        })
        if (error) await send(error)
    })
}
