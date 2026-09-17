/* eslint-disable max-len, @typescript-eslint/no-explicit-any */
import { Context, h, Session, User } from 'koishi'
import { Config } from '../config'
import { generateTextReport, shouldListenToMessage } from '../utils'
import { skinRegistry } from '../skins'
import {
    generateQQOfficialMarkdown,
    isQQOfficialPlatform
} from '../service/platform-report'

export const inject = {
    chatluna_group_analysis: {
        required: true
    }
}

export function apply(ctx: Context, config: Config) {
    const checkGroup = (
        session: Session,
        target?: { guildId?: string | null; channelId?: string | null }
    ) => {
        if (config.enableAllGroupsByDefault) return true
        if (!config.listenerGroups) return false
        return shouldListenToMessage(
            {
                guildId: target?.guildId ?? session.guildId ?? undefined,
                channelId: target?.channelId ?? session.channelId ?? undefined,
                platform: session.platform,
                selfId: session.selfId
            },
            config.listenerGroups
        )
    }

    const settings = ctx
        .command('群分析 [query:text]', '分析本群的近期聊天记录')
        .usage(
            '本功能会分析本群的近期聊天记录，并生成一份报告。\n' +
                '默认情况下，本功能会分析最近 1 天的聊天记录。\n' +
                '也可以直接输入自然语言进行查询和对话。\n' +
                '例如：/群分析 告诉我最近三小时都聊了什么'
        )
        .alias('group-analysis')

        .option('group', '-g <guildId:string> 指定群号', {
            authority: 3
        })
        .option('channel', '-c <channelId:string> 指定频道号', {
            authority: 3
        })
        .action(async ({ session, options }, query) => {
            if (session.isDirect && !options.group && !options.channel) {
                return '私聊中请使用 -g 或 -c 指定目标群或频道。'
            }

            const targetGuildId = options.group ?? session.guildId ?? undefined
            const targetChannelId =
                options.channel ??
                (options.group ? undefined : session.channelId) ??
                undefined

            if (!targetGuildId && !targetChannelId) {
                return '请使用 -g 或 -c 指定目标群或频道。'
            }

            if (
                !checkGroup(session, {
                    guildId: targetGuildId,
                    channelId: targetChannelId
                })
            )
                return '目标群未启用分析功能，请使用 群分析.启用 来启用目标群的分析功能。'

            const queryText =
                typeof query === 'string' ? query.trim() : undefined

            try {
                if (queryText) {
                    await ctx.chatluna_group_analysis.executeGroupQuery(
                        session,
                        {
                            guildId: targetGuildId || undefined,
                            channelId: targetChannelId || undefined,
                            platform: session.platform
                        },
                        queryText
                    )
                } else {
                    const analysisDays = ctx.config?.cronAnalysisDays || 1
                    if (analysisDays > 7)
                        return '出于性能考虑，最多只能分析 7 天的数据。'

                    await ctx.chatluna_group_analysis.executeGroupAnalysis(
                        session.selfId,
                        {
                            guildId: targetGuildId || undefined,
                            channelId: targetChannelId || undefined,
                            platform: session.platform
                        },
                        analysisDays
                    )
                }
            } catch (err) {
                ctx.logger.error('执行分析时发生未捕获的错误:', err)
                return '群分析执行失败，请检查日志。'
            }
        })

    const historyScope = (session: Session) => ({
        platform: session.platform,
        selfId: session.selfId,
        ...(session.channelId
            ? { channelId: session.channelId }
            : { guildId: session.guildId })
    })
    ctx.command('群分析.历史 [count:number]', '查看最近的历史分析报告', {
        authority: 2
    })
        .alias('group-analysis.history')
        .action(async ({ session }, count) => {
            if (session.isDirect) return '请在目标群聊中查看历史报告。'
            if (!checkGroup(session)) return '本群未启用分析功能。'
            const rows = await ctx.database
                .select('chatluna_analysis_reports')
                .where(historyScope(session))
                .orderBy(($: any) => $.createdAt, 'desc')
                .limit(Math.max(1, Math.min(20, Number(count) || 5)))
                .execute()
            if (!rows.length) return '暂无历史分析报告。'
            return rows
                .map(
                    (row: any) =>
                        `${row.id} | ${row.createdAt?.toLocaleString?.() || row.createdAt} | ${row.format} | ${row.status || '已保存'}`
                )
                .join('\n')
        })

    ctx.command(
        '群分析.重绘 [reportId:text]',
        '使用已保存结果重新渲染报告（不调用 Token）',
        { authority: 2 }
    )
        .alias('group-analysis.redraw')
        .option('format', '-f <format:string> 输出 image/pdf/text')
        .action(async ({ session, options }, reportId) => {
            if (session.isDirect) return '请在目标群聊中重绘历史报告。'
            if (!checkGroup(session)) return '本群未启用分析功能。'
            const rows = await ctx.database
                .select('chatluna_analysis_reports')
                .where({
                    ...historyScope(session),
                    ...(reportId ? { id: reportId } : {})
                })
                .orderBy(($: any) => $.createdAt, 'desc')
                .limit(1)
                .execute()
            const row: any = reportId
                ? rows.find((item: any) => item.id === reportId)
                : rows[0]
            if (!row) return '找不到历史分析报告。'
            let result: any
            try {
                result = JSON.parse(row.result)
            } catch {
                return '历史报告数据损坏。'
            }
            const storedFormat = ['image', 'pdf', 'text'].includes(row.format)
                ? row.format
                : config.outputFormat
            const format = (options as any)?.format || storedFormat
            if (
                (options as any)?.format &&
                !['image', 'pdf', 'text'].includes(format)
            )
                return '输出格式必须是 image、pdf 或 text。'
            if (format === 'pdf') {
                const pdf =
                    await ctx.chatluna_group_analysis_renderer.renderGroupAnalysisToPdf(
                        result
                    )
                return pdf ? h.file(pdf, 'application/pdf') : 'PDF 渲染失败。'
            }
            if (format === 'text')
                return isQQOfficialPlatform(row.platform)
                    ? h('markdown', {
                          content: generateQQOfficialMarkdown(result)
                      })
                    : generateTextReport(result)
            const image =
                await ctx.chatluna_group_analysis_renderer.renderGroupAnalysis(
                    result,
                    config
                )
            return typeof image === 'string'
                ? image
                : h.image(image, 'image/png')
        })

    ctx.command('群分析.主题 [skin:string]', '预览或切换报告主题', {
        authority: 3
    })
        .alias('group-analysis.skin')
        .action(async ({ session }, skin) => {
            const ids = skinRegistry.getAllIds()
            if (!skin)
                return `当前主题：${config.skin || 'md3'}\n可用主题：${ids.join('、')}`
            if (!skinRegistry.has(skin))
                return `主题不存在。可用主题：${ids.join('、')}`
            config.skin = skin
            ctx.scope.parent.scope.parent.scope.update(config, true)
            return `已切换报告主题为 ${skin}。可使用 群分析.重绘 预览最近报告。`
        })

    settings
        .subcommand('.enable', '启用本群的分析功能', {
            authority: 3
        })
        .alias('.启用')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const config = ctx.config as Config

            const originalGroupSetting = config.listenerGroups.find(
                (settings) =>
                    (settings.channelId === session.channelId &&
                        session.channelId != null) ||
                    (settings.guildId !== null &&
                        settings.guildId === session.guildId)
            )

            if (originalGroupSetting) {
                originalGroupSetting.enabled = true
            } else {
                config.listenerGroups.push({
                    guildId: session.guildId,
                    channelId: session.channelId,
                    selfId: session.selfId,
                    enabled: true,
                    platform: session.platform
                })
            }

            ctx.scope.parent.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            return `已为当前群 ${guildName} (${guildId}) 启用日常分析功能。`
        })

    settings
        .subcommand('.disable', '禁用本群的分析功能', {
            authority: 3
        })
        .alias('.禁用')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const config = ctx.config as Config

            const originalGroupSetting = config.listenerGroups.findIndex(
                (settings) =>
                    (settings.channelId === session.channelId &&
                        session.channelId != null) ||
                    (settings.guildId !== null &&
                        settings.guildId === session.guildId)
            )

            if (originalGroupSetting !== -1) {
                config.listenerGroups.splice(originalGroupSetting, 1)
            }

            ctx.scope.parent.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            return `已为当前群 ${guildName} (${guildId}) 禁用日常分析功能。`
        })

    settings
        .subcommand('clear', '清理当前群分析的某些缓存')
        .alias('.清理')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            ctx.database.remove('chatluna_messages', {
                guildId: session.guildId,
                channelId: session.channelId || session.guildId
            })

            return `已清理当前群 ${guildName} (${guildId}) 的分析缓存。`
        })

    settings
        .subcommand('.status', '查看当前分析设置')
        .alias('.状态')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const config = ctx.config as Config

            const originalGroupSetting = config.listenerGroups.find(
                (settings) =>
                    (settings.channelId === session.channelId &&
                        session.channelId != null) ||
                    (settings.guildId !== null &&
                        settings.guildId === session.guildId)
            )

            ctx.scope.parent.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            const enabled = originalGroupSetting?.enabled ? '已启用' : '未启用'
            return `当前群 ${guildName} (${guildId}) 分析功能状态: ${enabled}`
        })

    ctx.command('用户画像 [user:user]', '查看指定用户的画像')
        .alias('group-analysis.persona')
        .alias('群分析.用户画像')
        .usage(
            '使用方法：/群分析.用户画像 @用户 或 /群分析.用户画像 <用户ID> 或 /群分析.用户画像。不带参数时查看当前用户。查看其他用户需要为 bot 管理员。'
        )
        .option('force', '-f 是否强制更新用户画像')
        .action(async ({ session, options }, user) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            if (!checkGroup(session))
                return '本群未启用群分析功能，请使用 群分析.启用 来启用本群的群分析功能。'

            let userId = user?.split(':')?.[1] ?? session.userId

            if (
                userId !== session.userId &&
                ((session as Session<User.Field>).user?.authority ?? 0) < 3
            ) {
                await session.send(
                    '你没有权限查看其他用户的画像。当前需要的权限为 3 级。将转为查看自己的画像。'
                )
                userId = session.userId
            }

            if (!userId) {
                return '无法获取目标用户信息。'
            }

            try {
                await ctx.chatluna_group_analysis.executeUserPersonaAnalysis(
                    session,
                    userId,
                    options.force ?? false
                )
            } catch (err) {
                ctx.logger.error(
                    `执行用户画像分析时发生未捕获的错误 (用户: ${userId}):`,
                    err
                )
                return '用户画像分析执行失败，请检查日志。'
            }
        })
}
