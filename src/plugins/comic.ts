import { Context, h, Session, User } from 'koishi'
import { Config, GroupListener } from '../config'
import type { SummaryTopic, UserPersonaProfile } from '../types'
import {
    buildUserComicImagePrompt,
    buildUserComicPrompt,
    formatUserComicStoryboard
} from '../user-comic-prompts'
import {
    calculateBasicStats,
    matchesGroupList,
    shouldListenToMessage
} from '../utils'
import {
    generateImage,
    imageMime,
    loadQQAvatar,
    loadReference,
    loadReferences
} from '../service/image'
import { createTrace, errorDetail, errorKind } from '../diagnostics'
import {
    buildComicImagePrompt,
    buildStoryboardPrompt,
    formatGroupComicStoryboard
} from '../comic-prompts'
import { comicPreset } from '../service/preset'
import { ConcurrencyLimiter } from '../service/limiter'
import { createHash } from 'node:crypto'

export const inject = [
    'chatluna_group_analysis_message',
    'chatluna_group_analysis_llm',
    'chatluna_group_analysis'
]

declare module 'koishi' {
    interface Events {
        'group-daily-analysis/auto-comic'(payload: {
            group: GroupListener
            topics?: SummaryTopic[]
        }): Promise<void>
    }
}

export function todayWindow(now = new Date(), days = 1) {
    const startTime = new Date(now)
    if (days <= 1) startTime.setHours(0, 0, 0, 0)
    else startTime.setTime(startTime.getTime() - days * 24 * 60 * 60 * 1000)
    return { startTime, endTime: now }
}

export function apply(ctx: Context, config: Config) {
    const trace = createTrace(ctx, !!config.debug, '群漫画')
    const running = new Map<string, AbortController>()
    const lastRun = new Map<string, number>()
    const dailyCharacters = new Map<string, { day: string; index: number }>()
    const imageLimiter = new ConcurrencyLimiter(config.maxConcurrentTasks || 3)
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
        >,
        topics?: SummaryTopic[],
        days = 1,
        profile?: UserPersonaProfile
    ) => {
        if (!session || session.isDirect) return '请在群聊中使用群漫画。'
        if (!config.comic?.enabled) return '请先在插件配置中启用漫画功能。'
        const inherited =
            config.comic.groupMode === 'inherit' || !config.comic.groupMode
        if (
            inherited &&
            !config.enableAllGroupsByDefault &&
            !shouldListenToMessage(session as Session, config.listenerGroups)
        )
            return '本群未启用分析，请先使用 群分析.启用。'
        const groupId = session.guildId || session.channelId
        if (
            !matchesGroupList(
                groupId,
                config.comic.groupMode,
                config.comic.groups,
                inherited
            )
        )
            return '本群未开放群漫画功能。'
        if (!config.comic.baseUrl || !config.comic.model)
            return '请配置生图 API 地址和模型。'
        const enabledCharacters = (config.comic.characters || []).filter(
            (item) => item.enabled
        )
        const now = new Date()
        const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
        const characterKey = `${session.platform}:${session.selfId}`
        let selected = enabledCharacters[0]
        if (enabledCharacters.length) {
            let choice = dailyCharacters.get(characterKey)
            if (!choice || choice.day !== day) {
                choice = {
                    day,
                    index: config.comic.randomCharacterDaily
                        ? createHash('sha256')
                              .update(`${characterKey}:${day}`)
                              .digest()
                              .readUInt32BE(0) % enabledCharacters.length
                        : 0
                }
                dailyCharacters.set(characterKey, choice)
            }
            selected =
                enabledCharacters[choice.index % enabledCharacters.length]
        }
        const comicConfig = selected
            ? {
                  ...config.comic,
                  characterDescription:
                      selected.description || config.comic.characterDescription,
                  referenceImages: selected.referenceImages?.length
                      ? selected.referenceImages
                      : config.comic.referenceImages
              }
            : config.comic
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
            const presetName = comicPreset(config)
            const primaryReference = await loadReference(
                selected ? '' : config.comic.referenceImage,
                ctx.baseDir
            )
            const extraReferences = await loadReferences(
                comicConfig.referenceImages,
                ctx.baseDir
            )
            const characterReferences = primaryReference
                ? [primaryReference, ...extraReferences]
                : extraReferences
            const avatarReference =
                profile && session.platform === 'onebot'
                    ? await loadQQAvatar(
                          profile.userId,
                          controller.signal
                      ).catch((error) => {
                          trace('用户头像读取失败', {
                              reason: errorKind(error)
                          })
                          return undefined
                      })
                    : undefined
            const references = avatarReference
                ? [avatarReference, ...characterReferences]
                : characterReferences
            trace('参考图读取完成', {
                bytes: references.reduce((sum, item) => sum + item.length, 0),
                count: references.length,
                avatar: !!avatarReference
            })
            stage = profile ? '读取已有画像' : '获取当天消息'
            await session.send(
                profile
                    ? '正在将已有画像特点转化为漫画分镜，请稍候。'
                    : '正在提取群话题并生成漫画，请稍候。'
            )
            let resolvedTopics = topics
            if (!profile && resolvedTopics === undefined) {
                const messages =
                    await ctx.chatluna_group_analysis_message.getHistoricalMessages(
                        {
                            selfId: session.selfId,
                            guildId: session.guildId,
                            channelId: session.channelId,
                            ...todayWindow(new Date(), days),
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
                resolvedTopics =
                    await ctx.chatluna_group_analysis_llm.summarizeTopics(
                        calculateBasicStats(filtered).allMessagesText.join(
                            '\n'
                        ),
                        undefined,
                        controller.signal
                    )
            }
            if (controller.signal.aborted) return
            if (
                !profile &&
                (!Array.isArray(resolvedTopics) || !resolvedTopics.length)
            )
                return '未提取到有效话题。'
            trace('素材读取完成', {
                topics: resolvedTopics?.length || 0,
                persona: !!profile
            })
            stage = '生成分镜'
            const prompt = profile
                ? buildUserComicPrompt(
                      comicConfig,
                      profile,
                      !!avatarReference,
                      characterReferences.length > 0
                  )
                : buildStoryboardPrompt(
                      comicConfig,
                      resolvedTopics,
                      references.length > 0
                  )
            const storyboard = profile
                ? formatUserComicStoryboard(
                      await ctx.chatluna_group_analysis_llm.generateUserComicStoryboard(
                          prompt,
                          controller.signal,
                          presetName
                      ),
                      profile
                  )
                : formatGroupComicStoryboard(
                      await ctx.chatluna_group_analysis_llm.generateGroupComicStoryboard(
                          prompt,
                          resolvedTopics,
                          controller.signal,
                          presetName
                      ),
                      resolvedTopics
                  )
            if (controller.signal.aborted) return
            lastRun.set(key, Date.now())
            trace('分镜生成完成', { chars: storyboard.length })
            stage = '调用生图 API'
            const image = await imageLimiter.run(() =>
                generateImage(
                    comicConfig,
                    profile
                        ? buildUserComicImagePrompt(
                              storyboard,
                              !!avatarReference,
                              characterReferences.length > 0
                          )
                        : buildComicImagePrompt(
                              storyboard,
                              comicConfig,
                              references.length > 0,
                              resolvedTopics.length
                          ),
                    references,
                    controller.signal,
                    trace
                )
            )
            stage = '发送漫画'
            if (!controller.signal.aborted) {
                const receipts = await session.send(
                    h.image(image, imageMime(image))
                )
                const messageIds = Array.isArray(receipts)
                    ? receipts.filter((id): id is string =>
                          Boolean(id && id !== 'undefined' && id !== 'null')
                      )
                    : []
                // Satori 的 send() 应返回至少一条消息回执。此前无论适配器是否
                // 确认投递都会记录“发送完成”，导致 OneBot 的静默发送失败难以定位。
                if (Array.isArray(receipts) && !messageIds.length)
                    throw new Error(
                        '平台未确认图片消息：发送接口没有返回有效消息 ID。'
                    )
                trace('发送完成', {
                    bytes: image.length,
                    receiptCount: Array.isArray(receipts)
                        ? receipts.length
                        : undefined,
                    messageIdCount: messageIds.length,
                    messageIds: messageIds.join(',')
                })
            }
        } catch (error) {
            const detail = errorDetail(error, [
                config.comic.apiKey,
                config.llm?.apiKey
            ])
            trace('任务失败', {
                stage,
                reason: errorKind(error),
                detail,
                cancelled: controller.signal.aborted
            })
            if (!controller.signal.aborted)
                return h.text(
                    `${profile ? '用户画像漫画' : '群漫画'}失败（${stage}）：${detail}\n不会自动重复付费生图。`
                )
        } finally {
            trace('任务结束', { stage, elapsedMs: Date.now() - started })
            running.delete(key)
        }
    }
    const comicCommand = ctx.command(
        '群漫画 [days:number]',
        '将近期群话题生成漫画',
        {
            authority: 3,
            checkArgCount: true
        }
    )
    comicCommand.option?.('days', '-d <days:number> 分析最近几天')
    comicCommand
        .alias('group-comic')
        .action(async ({ session, options }, positionalDays) => {
            const days =
                (options as { days?: number } | undefined)?.days ??
                positionalDays
            const count =
                days == null ? 1 : Math.max(1, Math.min(7, Number(days)))
            return run(session, undefined, count)
        })

    const userComicCommand = ctx.command(
        '用户画像.漫画 [user:user]',
        '将已保存的长期用户画像生成三至四格漫画'
    )
    // “用户画像”主命令本身带参数，Koishi 在空格形式下会把“漫画”当成
    // 用户参数而不再继续匹配子命令；用快捷匹配改写为真正的子命令调用。
    userComicCommand.shortcut('用户画像 漫画', {
        prefix: true,
        fuzzy: true
    })
    userComicCommand.action(async ({ session }, user) => {
        if (session.isDirect) return '请在群聊中使用此命令。'
        if (
            !shouldListenToMessage(
                session,
                config.listenerGroups,
                config.enableAllGroupsByDefault
            )
        )
            return '本群未启用群分析功能，请使用 群分析.启用 来启用本群的群分析功能。'
        if (!config.comic.enabled || !config.comic.userEnabled)
            return '请先在插件配置中启用漫画服务和用户画像漫画。'
        let userId = user?.split(':').pop() || session.userId
        if (
            userId !== session.userId &&
            ((session as Session<User.Field>).user?.authority ?? 0) < 3
        ) {
            await session.send(
                '你没有权限查看其他用户的画像。当前需要的权限为 3 级。将转为查看自己的画像。'
            )
            userId = session.userId
        }
        if (!userId) return '无法获取目标用户信息。'
        try {
            const saved = await ctx.chatluna_group_analysis.getUserPersona(
                session.platform,
                session.selfId,
                userId
            )
            if (!saved?.profile)
                return '当前用户还没有用户画像，请先生成用户画像。'
            return await run(session, undefined, 1, {
                ...saved.profile,
                userId,
                username: saved.username || saved.profile.username
            })
        } catch (error) {
            return h.text(
                `读取用户画像失败：${errorDetail(error, [config.comic.apiKey, config.llm?.apiKey])}`
            )
        }
    })

    ctx.on('group-daily-analysis/auto-comic', async (payload) => {
        const { group, topics } =
            'group' in payload ? payload : { group: payload, topics: undefined }
        trace('定时漫画触发', {
            enabled: !!config.comic?.enabled,
            autoSend: !!config.comic?.autoSend
        })
        if (!config.comic?.enabled || !config.comic.autoSend) return
        if (topics !== undefined && !topics.some((item) => item?.topic?.trim()))
            return
        const bot = ctx.bots.find(
            (bot) =>
                bot.selfId === group.selfId && bot.platform === group.platform
        )
        if (!bot) return
        const send = (content: Parameters<Session['send']>[0]) =>
            bot.sendMessage(group.channelId, content, group.guildId)
        const error = await run(
            {
                platform: group.platform,
                selfId: group.selfId,
                guildId: group.guildId,
                channelId: group.channelId,
                isDirect: false,
                send
            },
            topics
        )
        if (error) await send(error)
    })
}
