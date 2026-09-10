import { Context, h } from 'koishi'
import { Config } from '../config'
import { calculateBasicStats, shouldListenToMessage } from '../utils'
import { generateImage, imageMime, loadReference } from '../service/image'

export const inject = [
    'chatluna_group_analysis_message',
    'chatluna_group_analysis_llm'
]

export function apply(ctx: Context, config: Config) {
    const running = new Map<string, AbortController>()
    const lastRun = new Map<string, number>()
    ctx.on('dispose', () => {
        for (const controller of running.values()) controller.abort()
    })
    ctx.command('群漫画 [days:number]', '提取群话题并使用角色三视图生成漫画', {
        authority: 3
    })
        .alias('group-comic')
        .action(async ({ session }, days = 1) => {
            if (!session || session.isDirect) return '请在群聊中使用群漫画。'
            if (!config.comic?.enabled) return '请先在插件配置中启用漫画功能。'
            if (!Number.isInteger(days) || days < 1 || days > 7)
                return '天数必须是 1 到 7 的整数。'
            if (
                !config.enableAllGroupsByDefault &&
                !shouldListenToMessage(session, config.listenerGroups)
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
            running.set(key, controller)
            try {
                const reference = await loadReference(
                    config.comic.referenceImage,
                    ctx.baseDir
                )
                await session.send('正在提取群话题并生成漫画，请稍候。')
                const messages =
                    await ctx.chatluna_group_analysis_message.getHistoricalMessages(
                        {
                            selfId: session.selfId,
                            guildId: session.guildId,
                            channelId: session.channelId,
                            startTime: new Date(Date.now() - days * 86400000),
                            endTime: new Date(),
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
                if (filtered.length < config.minMessages)
                    return `消息不足，需要至少 ${config.minMessages} 条。`
                const topics =
                    await ctx.chatluna_group_analysis_llm.summarizeTopics(
                        calculateBasicStats(filtered).allMessagesText.join(
                            '\n'
                        ),
                        undefined,
                        controller.signal
                    )
                if (controller.signal.aborted) return
                if (!Array.isArray(topics) || !topics.length)
                    return '未提取到有效话题。'
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
                const image = await generateImage(
                    config.comic,
                    storyboard,
                    reference,
                    controller.signal
                )
                if (!controller.signal.aborted)
                    await session.send(h.image(image, imageMime(image)))
            } catch {
                if (!controller.signal.aborted)
                    return '漫画生成或发送失败，请检查 API 配置、三视图路径、模型图片输入能力和网络。不会自动重复付费生图。'
            } finally {
                running.delete(key)
            }
        })
}
