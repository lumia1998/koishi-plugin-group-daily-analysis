/* eslint-disable @typescript-eslint/no-explicit-any */
import { Context, h, Service, Session } from 'koishi'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import {
    AnalysisPromptContext,
    GroupAnalysisResult,
    PersonaCache,
    PersonaRecord,
    QueryAction,
    QueryIntent,
    StoredMessage,
    UserPersonaProfile
} from '../types'
import { Config } from '..'
import {
    buildPersonaRecordId,
    calculateBasicStats,
    formatMessagesForPersona,
    formatPersonaForPrompt,
    generateActiveHoursChart,
    generateTextReport,
    getAvatarUrl,
    getStartTimeByDays,
    isAutoAnalysisGroup,
    isCacheExpiredByDays,
    mergePersona,
    shouldListenToMessage
} from '../utils'
import type { GuildMember } from '@satorijs/protocol'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ConcurrencyLimiter } from './limiter'
import { randomUUID } from 'node:crypto'
import {
    generateQQOfficialMarkdown,
    isQQOfficialPlatform
} from './platform-report'

type AnalysisTarget = {
    platform?: string
    guildId?: string
    channelId?: string
}

type AnalysisCheckpoint = {
    selfId: string
    target: AnalysisTarget
    days: number
    format: 'image' | 'pdf' | 'text' | 'html'
    startTime: string
    endTime: string
    result?: GroupAnalysisResult
    moduleResults?: Partial<
        Pick<
            GroupAnalysisResult,
            'topics' | 'userTitles' | 'goldenQuotes' | 'chatQuality'
        >
    >
    reportId?: string
}

type ModuleCheckpoint = {
    id: string
    payload: AnalysisCheckpoint
    write?: Promise<void>
}

const MAX_GOLDEN_QUOTES = 3

export class AnalysisService extends Service {
    static readonly inject = [
        'chatluna_group_analysis_llm',
        'chatluna_group_analysis_message',
        'chatluna_group_analysis_renderer'
    ]

    private personaCache = new Map<string, PersonaCache>()
    private personaProcessing = new Set<string>()
    private readonly taskLimiter: ConcurrencyLimiter

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis', true)
        this.taskLimiter = new ConcurrencyLimiter(
            config.maxConcurrentTasks || 3
        )
        this.setupPersonaDatabase()
        this.setupReportDatabase()
        this.setupPersonaMessageListener()
    }

    private setupPersonaDatabase() {
        this.ctx.database.extend(
            'chatluna_user_personas',
            {
                id: {
                    type: 'char',
                    length: 100
                },
                platform: {
                    type: 'char',
                    length: 30
                },
                selfId: { type: 'char', length: 100 },
                userId: { type: 'char', length: 100 },
                username: { type: 'char', length: 254 },
                persona: { type: 'text', nullable: true },
                lastAnalysisAt: { type: 'timestamp', nullable: true },
                updatedAt: { type: 'timestamp', nullable: true }
            },
            {
                primary: 'id'
            }
        )
    }

    private setupReportDatabase() {
        this.ctx.database.extend(
            'chatluna_analysis_reports',
            {
                id: { type: 'char', length: 180 },
                platform: { type: 'char', length: 30 },
                selfId: { type: 'char', length: 100 },
                guildId: { type: 'char', length: 100, nullable: true },
                channelId: { type: 'char', length: 100, nullable: true },
                days: 'integer',
                format: { type: 'char', length: 20 },
                result: 'text',
                promptTokens: 'integer',
                completionTokens: 'integer',
                totalTokens: 'integer',
                createdAt: 'timestamp',
                status: { type: 'char', length: 20 }
            },
            { primary: 'id' }
        )
        this.ctx.setInterval(
            async () => {
                const days = this.config.retentionDays
                if (!days) return
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
                await this.ctx.database
                    .remove('chatluna_analysis_reports', {
                        createdAt: { $lt: cutoff }
                    })
                    .catch((error) =>
                        this.ctx.logger.warn('清理历史分析报告失败。', error)
                    )
                await this.ctx.database
                    .remove('chatluna_analysis_checkpoints', {
                        updatedAt: { $lt: cutoff }
                    })
                    .catch((error) =>
                        this.ctx.logger.warn('清理分析检查点失败。', error)
                    )
            },
            6 * 60 * 60 * 1000
        )
        this.ctx.database.extend(
            'chatluna_analysis_checkpoints',
            {
                id: { type: 'char', length: 180 },
                stage: { type: 'char', length: 40 },
                payload: 'text',
                updatedAt: 'timestamp',
                status: { type: 'char', length: 20 }
            },
            { primary: 'id' }
        )
        this.ctx.on('ready', async () => {
            if (this.config.checkpointEnabled === false) return
            const pending = await this.ctx.database
                .select('chatluna_analysis_checkpoints')
                .where({ status: 'running' })
                .execute()
                .catch(() => [])
            for (const row of pending as any[]) {
                try {
                    const payload = JSON.parse(row.payload || '{}')
                    const target = payload.target
                    const selfId = payload.selfId || row.id.split(':')[0]
                    const bot = target && this._getBot(selfId, target.platform)
                    if (
                        target &&
                        bot &&
                        shouldListenToMessage(
                            { ...target, selfId, platform: bot.platform },
                            this.config.listenerGroups,
                            this.config.enableAllGroupsByDefault
                        )
                    ) {
                        const days = Number(
                            payload.days || this.config.cronAnalysisDays || 1
                        )
                        this.ctx.logger.info(
                            `恢复未完成的群分析任务：${row.id}`
                        )
                        this.executeGroupAnalysis(
                            selfId,
                            target,
                            days,
                            undefined,
                            false,
                            payload.result,
                            { id: row.id, payload }
                        ).catch((error) =>
                            this.ctx.logger.warn(
                                `恢复分析任务失败：${row.id}`,
                                error
                            )
                        )
                    } else {
                        await this.ctx.database.upsert(
                            'chatluna_analysis_checkpoints',
                            [
                                {
                                    ...row,
                                    status: 'failed',
                                    updatedAt: new Date()
                                }
                            ]
                        )
                    }
                } catch (error) {
                    this.ctx.logger.warn(`恢复分析检查点失败：${row.id}`, error)
                }
            }
        })
    }

    private async saveCheckpoint(
        id: string,
        stage: string,
        payload: unknown,
        status = 'running'
    ) {
        if (this.config.checkpointEnabled === false) return
        await this.ctx.database
            .upsert('chatluna_analysis_checkpoints', [
                {
                    id,
                    stage,
                    payload: JSON.stringify(payload),
                    updatedAt: new Date(),
                    status
                }
            ])
            .catch((error) =>
                this.ctx.logger.warn('保存分析检查点失败。', error)
            )
    }

    private async persistReport(
        selfId: string,
        target: AnalysisTarget,
        days: number,
        format: string,
        result: GroupAnalysisResult,
        taskId?: string
    ) {
        const id = taskId || randomUUID()
        await this.ctx.database.upsert('chatluna_analysis_reports', [
            {
                id,
                platform:
                    this._getBot(selfId, target.platform)?.platform ||
                    'unknown',
                selfId,
                guildId: target.guildId,
                channelId: target.channelId,
                days,
                format,
                result: JSON.stringify(result),
                promptTokens: result.tokenUsage?.promptTokens || 0,
                completionTokens: result.tokenUsage?.completionTokens || 0,
                totalTokens: result.tokenUsage?.totalTokens || 0,
                createdAt: new Date(),
                status: 'ready'
            }
        ])
        return id
    }

    private startComic(
        selfId: string,
        target: AnalysisTarget,
        result: GroupAnalysisResult
    ) {
        if (
            !this.config.comic?.enabled ||
            !this.config.comic.autoSend ||
            !result.topics?.length
        )
            return
        this.ctx
            .parallel('group-daily-analysis/auto-comic', {
                group: {
                    ...target,
                    platform:
                        this._getBot(selfId, target.platform)?.platform ||
                        'unknown',
                    selfId,
                    channelId: target.channelId || target.guildId || '',
                    enabled: true
                },
                topics: result.topics
            })
            .catch((error) => this.ctx.logger.warn('自动漫画任务失败。', error))
    }

    private async archiveOneBotReport(
        bot: any,
        groupId: string,
        payload: Buffer,
        format: string
    ) {
        if (
            bot?.platform !== 'onebot' ||
            (!this.config.uploadGroupFile && !this.config.uploadGroupAlbum)
        )
            return
        const request = bot.internal?._request
        const albumOwner =
            typeof bot.uploadGroupAlbum === 'function' ? bot : bot.internal
        const album = albumOwner?.uploadGroupAlbum
        const canUploadFile =
            this.config.uploadGroupFile && typeof request === 'function'
        const canUploadAlbum =
            this.config.uploadGroupAlbum &&
            format !== 'pdf' &&
            typeof album === 'function'
        if (!canUploadFile && !canUploadAlbum) return
        const dir = path.resolve(
            this.ctx.baseDir,
            'data/chatluna/group_analysis/archive'
        )
        await fs.mkdir(dir, { recursive: true })
        const extension = format === 'pdf' ? 'pdf' : 'png'
        const file = path.join(dir, `report-${Date.now()}.${extension}`)
        await fs.writeFile(file, payload)
        try {
            if (canUploadFile) {
                await request.call(bot.internal, 'upload_group_file', {
                    group_id: groupId,
                    file,
                    name: path.basename(file)
                })
            }
            if (canUploadAlbum) {
                await album.call(albumOwner, groupId, file)
            }
        } catch (error) {
            this.ctx.logger.warn('OneBot 报告归档接口不可用，已跳过。', error)
        }
    }

    private setupPersonaMessageListener() {
        if (this.config.personaAnalysisMessageInterval === 0) {
            this.ctx.logger.info('已关闭自动用户画像分析。')
            return
        }

        this.ctx.chatluna_group_analysis_message.onUserMessage(
            async (session) => {
                if (
                    !shouldListenToMessage(
                        session,
                        this.config.listenerGroups,
                        this.config.enableAllGroupsByDefault
                    )
                )
                    return

                await this.handleIncomingMessageForPersona(session)
            }
        )
    }

    private async handleIncomingMessageForPersona(session: Session) {
        if (this.config.personaAnalysisMessageInterval === 0) return
        if (!session.userId) return

        const recordId = buildPersonaRecordId(
            session.platform,
            session.selfId,
            session.userId
        )

        const cache = await this.ensurePersonaCache(recordId, {
            platform: session.platform,
            selfId: session.selfId,
            userId: session.userId,
            username: session.username || session.userId
        })

        cache.pendingMessages += 1
        cache.record.username = session.username || cache.record.username

        if (
            cache.pendingMessages >=
                this.config.personaAnalysisMessageInterval &&
            !this.personaProcessing.has(recordId)
        ) {
            this.personaProcessing.add(recordId)

            const sourceGroup = {
                guildId: session.guildId || undefined,
                channelId: session.channelId || undefined,
                platform: session.platform,
                selfId: session.selfId
            }

            // eslint-disable-next-line no-void
            void this.runPersonaAnalysis(cache, sourceGroup)
                .catch((error) =>
                    this.ctx.logger.error(
                        `执行用户画像分析失败 (${recordId}):`,
                        error
                    )
                )
                .finally(() => {
                    this.personaProcessing.delete(recordId)
                    cache.pendingMessages = 0
                })
        }
    }

    private async ensurePersonaCache(
        id: string,
        defaults: Pick<
            PersonaRecord,
            'platform' | 'selfId' | 'userId' | 'username'
        >
    ): Promise<PersonaCache> {
        const cached = this.personaCache.get(id)
        if (cached) return cached

        const existing = await this.ctx.database
            .select('chatluna_user_personas')
            .where({ id })
            .execute()
            .then((records) => records[0])

        if (existing) {
            if (
                existing.lastAnalysisAt &&
                !(existing.lastAnalysisAt instanceof Date)
            ) {
                existing.lastAnalysisAt = new Date(existing.lastAnalysisAt)
            }
            if (existing.updatedAt && !(existing.updatedAt instanceof Date)) {
                existing.updatedAt = new Date(existing.updatedAt)
            }
        }

        let parsedPersona: UserPersonaProfile | null
        if (existing?.persona) {
            try {
                parsedPersona = yamlLoad(existing.persona) as UserPersonaProfile
            } catch (error) {
                this.ctx.logger.warn(
                    `解析用户画像 YAML 失败 (${id})，将忽略历史画像。`,
                    error
                )
                parsedPersona = null
            }
        }

        const cache: PersonaCache = {
            record:
                existing ||
                ({
                    id,
                    ...defaults
                } as PersonaRecord),
            pendingMessages: 0,
            parsedPersona
        }

        /* if (!existing) {
            await this.ctx.database.create(
                'chatluna_user_personas',
                cache.record
            )
        } */

        this.personaCache.set(id, cache)
        return cache
    }

    private async runPersonaAnalysis(
        cache: PersonaCache,
        sourceGroup?: {
            guildId?: string
            channelId?: string
            platform: string
            selfId: string
        }
    ) {
        const { record } = cache
        const lookbackStart = getStartTimeByDays(
            this.config.personaLookbackDays,
            this.config.useCalendarDayWindow
        )

        const historyMessages = await this.collectUserMessagesForPersona(
            record,
            lookbackStart,
            sourceGroup
        )

        if (historyMessages.length < this.config.personaMinMessages) {
            this.ctx.logger.info(
                `用户 ${record.userId} 在设定时间窗内仅收集到 ${historyMessages.length} 条消息，低于触发阈值 ${this.config.personaMinMessages}，跳过画像分析。`
            )
            return false
        }

        const promptMessages = formatMessagesForPersona(historyMessages)

        this.ctx.logger.info(
            `开始分析用户 ${record.userId} 的画像 (${record.username})，收集到 ${historyMessages.length} 条消息。`
        )

        const previousText = formatPersonaForPrompt(cache.parsedPersona)

        const persona =
            await this.ctx.chatluna_group_analysis_llm.analyzeUserPersona(
                record.userId,
                record.username,
                record.roles,
                promptMessages,
                previousText
            )

        if (!persona) {
            this.ctx.logger.warn(`LLM 未返回用户画像结果 (${record.userId})。`)
            return false
        }

        const merged = mergePersona(cache.parsedPersona, persona)
        cache.parsedPersona = merged

        await this.persistPersona(record, merged)
        return true
    }

    private async collectUserMessagesForPersona(
        record: PersonaRecord,
        startTime: Date,
        sourceGroup?: {
            guildId?: string
            channelId?: string
            platform: string
            selfId: string
        }
    ): Promise<StoredMessage[]> {
        const results: StoredMessage[] = []
        const relevantGroups = this.config.enableAllGroupsByDefault
            ? [
                  {
                      enabled: true,
                      platform: sourceGroup?.platform,
                      selfId: sourceGroup?.selfId,
                      channelId: sourceGroup?.channelId,
                      guildId: sourceGroup?.guildId
                  }
              ].filter(
                  (group) =>
                      !!group.platform &&
                      !!group.selfId &&
                      (!!group.channelId || !!group.guildId)
              )
            : this.config.listenerGroups.filter(
                  (group) =>
                      group.enabled &&
                      group.platform === record.platform &&
                      group.selfId === record.selfId
              )

        if (!relevantGroups.length) {
            const reason = this.config.enableAllGroupsByDefault
                ? '未提供可用的当前群组信息'
                : '未在配置中找到监听群组'
            this.ctx.logger.warn(
                `用户 ${record.userId} 画像分析缺少群组上下文（${reason}），跳过画像分析。`
            )
            return []
        }

        const totalLimit = this.config.personaMaxMessages

        for (const group of relevantGroups) {
            const bot = this._getBot(group.selfId, group.platform)

            let userGroupInfo: GuildMember | null = null

            try {
                if (bot.platform === 'onebot') {
                    userGroupInfo = await (
                        bot as OneBotBot<Context>
                    ).internal.getGroupMemberInfo(
                        group.guildId,
                        record.userId,
                        true
                    )
                } else {
                    userGroupInfo = await bot.getGuildMember(
                        group.channelId || group.guildId,
                        record.userId
                    )
                }
            } catch (error) {
                this.ctx.logger.warn(
                    `获取用户 ${record.userId} 的群组资料失败 (${group.channelId || group.guildId})，将继续尝试获取历史消息。`,
                    error
                )
            }

            if (userGroupInfo) {
                record.roles =
                    userGroupInfo.roles?.map(
                        (role: string | { name?: string; id: string }) =>
                            typeof role === 'string'
                                ? role
                                : role.name || role.id
                    ) ?? []
            }

            const remainingLimit = totalLimit - results.length
            if (remainingLimit <= 0) break

            const history =
                await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                    {
                        guildId: group.guildId,
                        channelId: group.channelId,
                        userId: [record.userId],
                        selfId: group.selfId,
                        startTime,
                        endTime: new Date(),
                        limit: remainingLimit,
                        purpose: 'user-persona'
                    }
                )

            results.push(
                ...history.map((message) => ({
                    ...message,
                    guildId: message.guildId ?? group.guildId,
                    channelId: message.channelId ?? group.channelId
                }))
            )

            if (results.length >= totalLimit) {
                break
            }
        }

        results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

        return results
    }

    private async persistPersona(
        record: PersonaRecord,
        persona: UserPersonaProfile
    ) {
        const now = new Date()
        record.persona = yamlDump(persona, {
            indent: 2,
            lineWidth: -1,
            noRefs: true
        })
        record.lastAnalysisAt = now
        record.updatedAt = now

        await this.ctx.database.upsert('chatluna_user_personas', [record])
    }

    private async _getGroupHistoryFromMessageService(
        selfId: string,
        target: AnalysisTarget,
        days: number
    ): Promise<StoredMessage[]> {
        const targetId = target.guildId || target.channelId
        if (!targetId) {
            this.ctx.logger.warn('执行群分析时缺少有效的群组或频道标识。')
            return []
        }

        this.ctx.logger.info(
            `开始从消息服务获取群组 ${targetId} 近 ${days} 天的消息记录...`
        )

        const startTime = getStartTimeByDays(
            days,
            this.config.useCalendarDayWindow
        )

        const endTime = new Date()

        const messages =
            await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                {
                    guildId: target.guildId,
                    channelId: target.channelId,
                    platform: target.platform,
                    startTime,
                    selfId,
                    endTime,
                    limit: this.config.maxMessages,
                    purpose: 'group-analysis'
                }
            )

        this.ctx.logger.info(`从消息服务获取到 ${messages.length} 条消息。`)
        return messages
    }

    private async _getGroupHistoryFromMessageServiceByTimeRange(
        selfId: string,
        target: AnalysisTarget,
        startTime: Date,
        endTime: Date
    ): Promise<StoredMessage[]> {
        const targetId = target.guildId || target.channelId
        if (!targetId) {
            this.ctx.logger.warn('执行群分析时缺少有效的群组或频道标识。')
            return []
        }

        this.ctx.logger.info(
            `开始从消息服务获取群组 ${targetId} ${startTime.toLocaleString()} - ${endTime.toLocaleString()} 的消息记录...`
        )

        const messages =
            await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                {
                    guildId: target.guildId,
                    channelId: target.channelId,
                    platform: target.platform,
                    startTime,
                    selfId,
                    endTime,
                    limit: this.config.maxMessages,
                    purpose: 'group-analysis'
                }
            )

        this.ctx.logger.info(`从消息服务获取到 ${messages.length} 条消息。`)
        return messages
    }

    private async resolveGroupName(
        selfId: string,
        target: AnalysisTarget
    ): Promise<string> {
        const bot = this._getBot(selfId, target.platform)
        const fallbackName = target.guildId || target.channelId || 'unknown'
        let groupName = fallbackName
        if (bot) {
            try {
                if (target.guildId) {
                    groupName =
                        (await bot.getGuild(target.guildId)).name || groupName
                } else if (target.channelId && bot.getChannel) {
                    const channel = await bot.getChannel(
                        target.channelId,
                        target.guildId
                    )
                    groupName = channel?.name || groupName
                }
            } catch (err) {
                this.ctx.logger.warn(
                    `获取群组 ${fallbackName} 名称失败: ${err}`
                )
            }
        }
        return groupName
    }

    private normalizeQueryAction(action?: string): QueryAction {
        const normalized = action?.trim()
        if (normalized === '分析加对话' || normalized === '只对话') {
            return normalized
        }
        return '只分析'
    }

    private resolveQueryTimeRange(
        intent: QueryIntent | null,
        fallbackDays: number
    ): { start: Date; end: Date; description?: string } {
        const now = new Date()
        let start: Date | undefined
        let end: Date | undefined

        if (intent?.targetTime?.startTime) {
            const parsed = new Date(intent.targetTime.startTime)
            if (!isNaN(parsed.getTime())) start = parsed
        }

        if (intent?.targetTime?.endTime) {
            const parsed = new Date(intent.targetTime.endTime)
            if (!isNaN(parsed.getTime())) end = parsed
        }

        if (!end) end = now
        if (!start)
            start = getStartTimeByDays(
                fallbackDays,
                this.config.useCalendarDayWindow
            )

        if (start > end) {
            const temp = start
            start = end
            end = temp
        }

        return {
            start,
            end,
            description: intent?.targetTime?.description
        }
    }

    public async executeGroupAnalysis(
        selfId: string,
        target: AnalysisTarget,
        days: number,
        outputFormat?: 'image' | 'pdf' | 'text' | 'html',
        triggerComic = true,
        suppliedResult?: GroupAnalysisResult,
        recovery?: { id: string; payload: AnalysisCheckpoint }
    ) {
        const limiter =
            this.taskLimiter ||
            new ConcurrencyLimiter(this.config.maxConcurrentTasks || 3)
        return limiter.run(() =>
            this.executeGroupAnalysisInternal(
                selfId,
                target,
                days,
                outputFormat,
                triggerComic,
                suppliedResult,
                recovery
            )
        )
    }

    private async executeGroupAnalysisInternal(
        selfId: string,
        target: AnalysisTarget,
        days: number,
        outputFormat?: 'image' | 'pdf' | 'text' | 'html',
        triggerComic = true,
        suppliedResult?: GroupAnalysisResult,
        recovery?: { id: string; payload: AnalysisCheckpoint }
    ) {
        const bot = this._getBot(selfId, target.platform)
        const targetChannel = target.channelId ?? target.guildId
        target = { ...target, platform: bot?.platform || target.platform }
        const targetGuildContext =
            target.channelId && target.guildId ? target.guildId : undefined
        const checkpointId = recovery?.id || randomUUID()
        const format =
            outputFormat ||
            recovery?.payload.format ||
            this.config.outputFormat ||
            'image'
        const checkpoint: AnalysisCheckpoint = {
            ...recovery?.payload,
            selfId,
            target,
            days,
            format,
            startTime:
                recovery?.payload.startTime ||
                getStartTimeByDays(
                    days,
                    this.config.useCalendarDayWindow
                ).toISOString(),
            endTime: recovery?.payload.endTime || new Date().toISOString()
        }

        if (!targetChannel) {
            this.ctx.logger.warn('执行群分析需要提供 channelId 或 guildId。')
            return
        }

        const sendStatus = async (content: string | h) =>
            bot?.sendMessage(targetChannel, content, targetGuildContext)

        let message: h
        let completedResult: GroupAnalysisResult | undefined
        let archivePayload: Buffer | undefined

        try {
            let analysisResult: GroupAnalysisResult

            if (suppliedResult || checkpoint.result) {
                analysisResult = suppliedResult || checkpoint.result
            } else {
                await this.saveCheckpoint(checkpointId, 'fetching', checkpoint)
                await sendStatus(
                    `开始分析群聊近 ${days} 天的活动，请稍候...`
                ).catch(() => {})

                const messages =
                    await this._getGroupHistoryFromMessageServiceByTimeRange(
                        selfId,
                        target,
                        new Date(checkpoint.startTime),
                        new Date(checkpoint.endTime)
                    )
                await this.saveCheckpoint(checkpointId, 'analyzing', checkpoint)

                if (messages.length < this.config.minMessages) {
                    await this.saveCheckpoint(
                        checkpointId,
                        'skipped',
                        checkpoint,
                        'skipped'
                    )
                    await sendStatus(
                        `消息数量（${messages.length}/${this.config.minMessages}）不足于进行有效分析。`
                    )
                    return
                }

                this.ctx.logger.info(
                    `群分析已获取 ${messages.length} 条消息，开始智能分析。`
                )

                analysisResult = await this.analyzeGroupMessages(
                    messages,
                    selfId,
                    target,
                    undefined,
                    recovery?.payload.moduleResults,
                    { id: checkpointId, payload: checkpoint }
                )
            }

            completedResult = analysisResult
            checkpoint.result = analysisResult
            await this.saveCheckpoint(checkpointId, 'rendering', checkpoint)
            checkpoint.reportId = await this.persistReport(
                selfId,
                target,
                days,
                format,
                analysisResult,
                checkpointId
            )
            // Launch before rendering or sending. Recovery never repeats paid drawing.
            if (triggerComic && !recovery)
                this.startComic(selfId, target, analysisResult)

            switch (format) {
                case 'image':
                    {
                        const image =
                            await this.ctx.chatluna_group_analysis_renderer.renderGroupAnalysis(
                                analysisResult,
                                this.config
                            )
                        if (typeof image === 'string') throw new Error(image)
                        message = h.image(image, 'image/png')
                        if (Buffer.isBuffer(image)) archivePayload = image
                    }
                    break
                case 'pdf': {
                    const pdfBuffer =
                        await this.ctx.chatluna_group_analysis_renderer.renderGroupAnalysisToPdf(
                            analysisResult
                        )
                    if (!pdfBuffer) throw new Error('PDF 渲染失败。')
                    message = h.file(pdfBuffer, 'application/pdf')
                    archivePayload = pdfBuffer
                    break
                }
                case 'html': {
                    const reportPath =
                        await this.ctx.chatluna_group_analysis_renderer.renderGroupAnalysisHtml(
                            analysisResult,
                            this.config
                        )
                    message = h.file(reportPath)
                    break
                }
                default: {
                    message = isQQOfficialPlatform(bot?.platform)
                        ? h('markdown', {
                              content:
                                  generateQQOfficialMarkdown(analysisResult)
                          })
                        : h.text(generateTextReport(analysisResult))
                }
            }
            await this.saveCheckpoint(checkpointId, 'sending', checkpoint)
            if (!bot) throw new Error('机器人不可用。')
            await bot.sendMessage(targetChannel, message, targetGuildContext)
            await this.ctx.database.set(
                'chatluna_analysis_reports',
                { id: checkpointId },
                {
                    status: analysisResult.failedModules?.length
                        ? 'partial'
                        : 'completed'
                }
            )
            await this.saveCheckpoint(
                checkpointId,
                'completed',
                checkpoint,
                'completed'
            )
            if (archivePayload)
                await this.archiveOneBotReport(
                    bot,
                    targetChannel,
                    archivePayload,
                    format
                ).catch(() => {})
        } catch (error) {
            await this.saveCheckpoint(
                checkpointId,
                'failed',
                checkpoint,
                'failed'
            )
            if (checkpoint.reportId)
                await this.ctx.database
                    .set(
                        'chatluna_analysis_reports',
                        { id: checkpoint.reportId },
                        { status: 'failed' }
                    )
                    .catch(() => {})
            this.ctx.logger.error(
                `为群组 ${target.guildId || target.channelId} 执行分析任务时发生错误:`,
                error
            )
            const errorMessage =
                error instanceof Error ? error.message : '未知错误。'

            message = h.text(
                `分析失败: ${errorMessage}。请检查网络连接和 LLM 配置，或联系管理员。`
            )
            await sendStatus(message).catch(() => {})
        }
        return completedResult
    }

    public async executeGroupQuery(
        session: Session,
        target: AnalysisTarget,
        query: string,
        outputFormat?: 'image' | 'pdf' | 'text' | 'html'
    ) {
        const limiter =
            this.taskLimiter ||
            new ConcurrencyLimiter(this.config.maxConcurrentTasks || 3)
        return limiter.run(() =>
            this.executeGroupQueryInternal(session, target, query, outputFormat)
        )
    }

    private async executeGroupQueryInternal(
        session: Session,
        target: AnalysisTarget,
        query: string,
        outputFormat?: 'image' | 'pdf' | 'text' | 'html'
    ) {
        const bot = this._getBot(session.selfId, session.platform)
        target = { ...target, platform: session.platform }
        const targetChannel = target.channelId ?? target.guildId
        const targetGuildContext =
            target.channelId && target.guildId ? target.guildId : undefined

        if (!targetChannel) {
            this.ctx.logger.warn('执行群分析需要提供 channelId 或 guildId。')
            return
        }

        const sendStatus = async (content: string | h) =>
            bot?.sendMessage(targetChannel, content, targetGuildContext)

        const currentTime = new Date()
        const timeZone =
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        const groupName = await this.resolveGroupName(session.selfId, target)

        this.ctx.logger.info(`收到群分析请求，开始解析用户请求: ${query}`)

        const intent =
            await this.ctx.chatluna_group_analysis_llm.parseGroupQuery({
                query,
                currentTime: currentTime.toLocaleString('zh-CN', {
                    hour12: false
                }),
                timeZone,
                platform: session.platform,
                groupName,
                guildId: target.guildId,
                channelId: target.channelId,
                currentUserId: session.userId,
                currentUserName: session.username || session.userId
            })

        if (!intent) {
            await sendStatus('未能解析你的请求，请换个说法再试。')
            return
        }

        const action = this.normalizeQueryAction(intent.action)
        const timeRange = this.resolveQueryTimeRange(
            intent,
            this.config.cronAnalysisDays || 1
        )

        this.ctx.logger.info(
            `准备获取消息记录: ${timeRange.start.toLocaleString()} - ${timeRange.end.toLocaleString()}`
        )

        const messages =
            await this._getGroupHistoryFromMessageServiceByTimeRange(
                session.selfId,
                target,
                timeRange.start,
                timeRange.end
            )

        if (messages.length < this.config.minMessages) {
            await sendStatus(
                `消息数量（${messages.length}/${this.config.minMessages}）不足于进行有效分析。`
            )
            return
        }

        this.ctx.logger.info(
            `群分析已获取 ${messages.length} 条消息，开始智能分析。`
        )

        const keywords = Array.isArray(intent.keywords)
            ? intent.keywords.filter(Boolean)
            : intent.keywords
              ? [String(intent.keywords)]
              : []
        const topics = Array.isArray(intent.topics)
            ? intent.topics.filter(Boolean)
            : intent.topics
              ? [String(intent.topics)]
              : []
        const nicknames = Array.isArray(intent.nicknames)
            ? intent.nicknames.filter(Boolean)
            : intent.nicknames
              ? [String(intent.nicknames)]
              : []

        const analysisContext: AnalysisPromptContext = {
            keywords,
            topics,
            nicknames,
            query,
            timeRange
        }

        const analysisResult = await this.analyzeGroupMessages(
            messages,
            session.selfId,
            target,
            analysisContext
        )

        const queryDays = Math.max(
            1,
            Math.ceil(
                (timeRange.end.getTime() - timeRange.start.getTime()) /
                    (24 * 60 * 60 * 1000)
            )
        )
        const textReport = generateTextReport(analysisResult)
        const format = outputFormat || this.config.outputFormat || 'image'

        if (action !== '只对话') {
            await this.executeGroupAnalysisInternal(
                session.selfId,
                target,
                queryDays,
                format,
                true,
                analysisResult
            )
        }

        if (action !== '只分析') {
            const reply =
                await this.ctx.chatluna_group_analysis_llm.replyGroupQuery({
                    query,
                    analysisResult: textReport,
                    currentTime: currentTime.toLocaleString('zh-CN', {
                        hour12: false
                    }),
                    groupName,
                    guildId: target.guildId,
                    channelId: target.channelId,
                    currentUserId: session.userId,
                    currentUserName: session.username || session.userId
                })

            if (reply?.length) {
                await sendStatus(reply)
            } else {
                await sendStatus('对话生成失败，请稍后再试。')
            }
        }
    }

    public async executeAutoAnalysisForEnabledGroups() {
        const enabledGroups = await this.resolveAutoAnalysisGroups()
        const maxConcurrentAnalyses = Math.max(
            1,
            this.config.maxConcurrentTasks || 3
        )
        const formats = (
            this.config.cronOutputFormats?.length
                ? this.config.cronOutputFormats
                : [this.config.outputFormat || 'image']
        ) as ('image' | 'pdf' | 'text' | 'html')[]

        for (
            let index = 0;
            index < enabledGroups.length;
            index += maxConcurrentAnalyses
        ) {
            const currentBatch = enabledGroups.slice(
                index,
                index + maxConcurrentAnalyses
            )

            await Promise.allSettled(
                currentBatch.map(async (group) => {
                    try {
                        const result = await this.executeGroupAnalysis(
                            group.selfId,
                            {
                                guildId: group.guildId,
                                channelId: group.channelId,
                                platform: group.platform
                            },
                            this.config.cronAnalysisDays,
                            formats[0],
                            true
                        )
                        if (!result) return
                        for (const format of formats.slice(1)) {
                            await this.executeGroupAnalysis(
                                group.selfId,
                                {
                                    guildId: group.guildId,
                                    channelId: group.channelId,
                                    platform: group.platform
                                },
                                this.config.cronAnalysisDays,
                                format,
                                false,
                                {
                                    ...result,
                                    tokenUsage: {
                                        promptTokens: 0,
                                        completionTokens: 0,
                                        totalTokens: 0
                                    }
                                }
                            )
                        }
                    } catch (err) {
                        this.ctx.logger.error(
                            `群 ${group.guildId || group.channelId} 自动分析失败:`,
                            err
                        )
                    }
                })
            )
        }
    }

    private async resolveAutoAnalysisGroups() {
        const configured = this.config.listenerGroups.filter((group) =>
            isAutoAnalysisGroup(group, this.config)
        )
        if (!this.config.enableAllGroupsByDefault) return configured
        if (
            this.config.autoAnalysisGroupMode === 'whitelist' &&
            !this.config.autoAnalysisGroups.length
        )
            return []
        const discovered: typeof configured = []
        for (const bot of this.ctx.bots) {
            const getGuildList = (bot as any).getGuildList
            if (typeof getGuildList !== 'function') continue
            try {
                const response = await getGuildList.call(bot)
                const guilds = Array.isArray(response)
                    ? response
                    : response?.data || []
                for (const guild of guilds) {
                    const id = String(guild.id)
                    discovered.push({
                        platform: bot.platform,
                        selfId: bot.selfId,
                        channelId: id,
                        guildId: id,
                        enabled: true
                    })
                }
            } catch (error) {
                this.ctx.logger.warn(
                    `发现 ${bot.platform} 群组失败，跳过该机器人的自动发现。`,
                    error
                )
            }
        }
        return discovered.filter((group) =>
            isAutoAnalysisGroup(group, this.config)
        )
    }

    public async getUserPersona(
        platform: string,
        selfId: string,
        userId: string
    ): Promise<{ profile: UserPersonaProfile; username: string } | null> {
        const recordId = buildPersonaRecordId(platform, selfId, userId)

        // First, check the cache
        const cached = this.personaCache.get(recordId)
        if (cached?.parsedPersona) {
            return {
                profile: cached.parsedPersona,
                username: cached.record.username
            }
        }

        // If not in cache, query the database
        const record = await this.ctx.database
            .select('chatluna_user_personas')
            .where({ id: recordId })
            .execute()
            .then((records) => records[0])

        if (!record?.persona) {
            return null
        }

        try {
            const profile = yamlLoad(record.persona) as UserPersonaProfile
            return { profile, username: record.username }
        } catch (error) {
            this.ctx.logger.warn(
                `解析用户画像 YAML 失败 (${recordId})，无法提供画像。`,
                error
            )
            return null
        }
    }

    public async executeUserPersonaAnalysis(
        session: Session,
        userId: string,
        force?: boolean
    ) {
        const bot = session.bot

        await session.send('正在查询用户画像数据，请稍候...')

        let message: h

        try {
            const recordId = buildPersonaRecordId(
                session.platform,
                session.selfId,
                userId
            )

            let avatar: string | undefined
            let user: GuildMember

            try {
                user = await bot.getGuildMember(
                    session.channelId || session.guildId,
                    userId
                )
            } catch (error) {
                this.ctx.logger.warn(`获取用户 ${userId} 信息失败: ${error}`)
            }

            const cache = await this.ensurePersonaCache(recordId, {
                platform: session.platform,
                selfId: session.selfId,
                userId,
                username: user?.nick || user?.name || userId
            })

            let displayName = cache.record.username

            const cacheExpired = isCacheExpiredByDays(
                cache.record.lastAnalysisAt,
                this.config.personaCacheLifetimeDays
            )
            const shouldRefresh = force || cacheExpired || !cache.parsedPersona

            if (shouldRefresh) {
                if (!force && cache.parsedPersona && cacheExpired) {
                    const ttlDays = this.config.personaCacheLifetimeDays
                    if (ttlDays > 0) {
                        await session.send(
                            `上次用户画像更新已超过 ${ttlDays} 天，正在重新生成画像。`
                        )
                    }
                }

                const sourceGroup = {
                    guildId: session.guildId || undefined,
                    channelId: session.channelId || undefined,
                    platform: session.platform,
                    selfId: session.selfId
                }

                const refreshed = await this.runPersonaAnalysis(
                    cache,
                    sourceGroup
                )

                if (!cache.parsedPersona) {
                    message = h.text(
                        '暂未收集到足够的聊天记录来生成该用户的画像，请稍后再试。'
                    )
                    await session.send(message)
                    return
                }

                if (!refreshed) {
                    await session.send('本次未更新，展示旧画像。')
                }

                cache.pendingMessages = 0
            }

            const profile = cache.parsedPersona!

            if (user) {
                avatar = user.avatar
                const resolvedName =
                    (user as { nick?: string; name?: string }).nick ||
                    (user as { name?: string }).name
                if (resolvedName) {
                    displayName = resolvedName
                    cache.record.username = resolvedName
                }
            }

            if (session.platform === 'onebot') {
                avatar = getAvatarUrl(userId)
            }

            profile.analysisDate = cache.record.lastAnalysisAt.toLocaleString()

            const image =
                await this.ctx.chatluna_group_analysis_renderer.renderUserPersona(
                    profile,
                    displayName,
                    avatar,
                    this.config
                )

            message =
                typeof image === 'string'
                    ? h.text(image)
                    : h.image(image, 'image/png')
        } catch (error) {
            this.ctx.logger.error(
                `为用户 ${userId} 执行画像分析时发生错误:`,
                error
            )
            const errorMessage =
                error instanceof Error ? error.message : '未知错误。'

            message = h.text(
                `分析失败: ${errorMessage}。请检查服务状态或联系管理员。`
            )
        }

        await session.send(message)
    }

    public async analyzeGroupMessages(
        messages: StoredMessage[],
        selfId: string,
        target: AnalysisTarget,
        context?: AnalysisPromptContext,
        resume?: Partial<
            Pick<
                GroupAnalysisResult,
                'topics' | 'userTitles' | 'goldenQuotes' | 'chatQuality'
            >
        >,
        checkpoint?: ModuleCheckpoint
    ): Promise<GroupAnalysisResult> {
        const llm = this.ctx.chatluna_group_analysis_llm
        const task = () =>
            this.analyzeGroupMessagesInternal(
                messages,
                selfId,
                target,
                context,
                undefined,
                resume,
                checkpoint
            )
        if (!llm.measureUsage) return task()
        const { value, usage } = await llm.measureUsage(task)
        value.tokenUsage = usage
        return value
    }

    private async analyzeGroupMessagesInternal(
        messages: StoredMessage[],
        selfId: string,
        target: AnalysisTarget,
        context?: AnalysisPromptContext,
        existing?: GroupAnalysisResult,
        resume?: Partial<
            Pick<
                GroupAnalysisResult,
                'topics' | 'userTitles' | 'goldenQuotes' | 'chatQuality'
            >
        >,
        checkpoint?: ModuleCheckpoint
    ): Promise<GroupAnalysisResult> {
        this.ctx.logger.info(`开始分析 ${messages.length} 条消息...`)

        const { userStats, totalChars, totalEmojiCount, allMessagesText } =
            calculateBasicStats(messages)

        const messagesText = allMessagesText.join('\n')

        // LLM analyses in parallel
        const users = Object.values(userStats)

        const saveModule = <T>(
            key: keyof NonNullable<AnalysisCheckpoint['moduleResults']>,
            task: Promise<T>
        ) =>
            task.then(async (value) => {
                if (!checkpoint) return value
                checkpoint.write = (checkpoint.write || Promise.resolve()).then(
                    async () => {
                        checkpoint.payload.moduleResults = {
                            ...(checkpoint.payload.moduleResults || {}),
                            [key]: value
                        }
                        await this.saveCheckpoint(
                            checkpoint.id,
                            `module:${String(key)}`,
                            checkpoint.payload
                        )
                    }
                )
                await checkpoint.write
                return value
            })

        const [topicResult, titleResult, quoteResult, qualityResult] =
            await Promise.allSettled([
                existing
                    ? Promise.resolve(existing.topics)
                    : resume?.topics !== undefined
                      ? Promise.resolve(resume.topics)
                      : saveModule(
                            'topics',
                            this.ctx.chatluna_group_analysis_llm.summarizeTopics(
                                messagesText,
                                context
                            )
                        ),
                existing
                    ? Promise.resolve(existing.userTitles)
                    : resume?.userTitles !== undefined
                      ? Promise.resolve(resume.userTitles)
                      : saveModule(
                            'userTitles',
                            this.ctx.chatluna_group_analysis_llm.analyzeUserTitles(
                                users,
                                context
                            )
                        ),
                existing
                    ? Promise.resolve(existing.goldenQuotes)
                    : resume?.goldenQuotes !== undefined
                      ? Promise.resolve(resume.goldenQuotes)
                      : saveModule(
                            'goldenQuotes',
                            this.ctx.chatluna_group_analysis_llm.analyzeGoldenQuotes(
                                messagesText,
                                MAX_GOLDEN_QUOTES,
                                context
                            )
                        ),
                existing
                    ? Promise.resolve(existing.chatQuality)
                    : resume?.chatQuality !== undefined
                      ? Promise.resolve(resume.chatQuality)
                      : saveModule(
                            'chatQuality',
                            this.ctx.chatluna_group_analysis_llm.analyzeChatQuality(
                                messagesText
                            )
                        )
            ])
        const topics =
            topicResult.status === 'fulfilled' ? topicResult.value : []
        const userTitles =
            titleResult.status === 'fulfilled' ? titleResult.value : []
        const goldenQuotes =
            quoteResult.status === 'fulfilled' ? quoteResult.value : []
        const chatQuality =
            qualityResult.status === 'fulfilled' ? qualityResult.value : null
        for (const [name, result] of [
            ['话题', topicResult],
            ['称号', titleResult],
            ['金句', quoteResult],
            ['聊天质量', qualityResult]
        ] as const) {
            if (result.status === 'rejected')
                this.ctx.logger.error(
                    `${name}分析失败，保留其他模块结果。`,
                    result.reason
                )
        }

        // Final statistics
        const sortedUsers = users.sort(
            (a, b) => b.messageCount - a.messageCount
        )
        const overallActiveHours = users.reduce(
            (acc, user) => {
                for (const hour in user.activeHours) {
                    acc[hour] = (acc[hour] || 0) + user.activeHours[hour]
                }
                return acc
            },
            {} as Record<number, number>
        )
        const mostActiveHourEntry = Object.entries(overallActiveHours).sort(
            (a, b) => b[1] - a[1]
        )[0]
        const mostActiveHour = mostActiveHourEntry
            ? mostActiveHourEntry[0]
            : 'N/A'

        // Generate chart using the renderer service
        const activeHoursChartHtml =
            generateActiveHoursChart(overallActiveHours)

        const groupName = await this.resolveGroupName(selfId, target)

        const result: GroupAnalysisResult = {
            failedModules: [
                ['话题', topicResult],
                ['称号', titleResult],
                ['金句', quoteResult],
                ['聊天质量', qualityResult]
            ]
                .filter(
                    ([, item]) =>
                        (item as PromiseSettledResult<unknown>).status ===
                        'rejected'
                )
                .map(([name]) => String(name)),
            totalMessages: messages.length,
            totalChars,
            totalParticipants: users.length,
            emojiCount: totalEmojiCount,
            mostActiveUser: sortedUsers[0] || null,
            mostActivePeriod:
                mostActiveHour !== 'N/A'
                    ? `${mostActiveHour.padStart(2, '0')}:00 - ${String(parseInt(mostActiveHour) + 1).padStart(2, '0')}:00`
                    : 'N/A',
            userStats: sortedUsers.slice(0, this.config.maxUsersInReport),
            topics,
            userTitles,
            goldenQuotes,
            chatQuality,
            activeHoursChart: activeHoursChartHtml,
            activeHoursData: overallActiveHours,
            analysisDate: new Date().toLocaleDateString('zh-CN'),
            groupName
        }

        this.ctx.logger.info('消息分析完成。')
        return result
    }

    private _getBot(selfId: string, platform?: string) {
        const bots = this.ctx.bots.filter(
            (bot) =>
                bot.selfId === selfId &&
                (!platform || bot.platform === platform)
        )
        return bots.length === 1 ? bots[0] : undefined
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis: AnalysisService
    }

    interface Tables {
        chatluna_user_personas: PersonaRecord
        chatluna_analysis_reports: {
            id: string
            platform: string
            selfId: string
            guildId?: string
            channelId?: string
            days: number
            format: string
            result: string
            createdAt: Date
            status: string
            promptTokens: number
            completionTokens: number
            totalTokens: number
        }
        chatluna_analysis_checkpoints: {
            id: string
            stage: string
            payload: string
            updatedAt: Date
            status: string
        }
    }
}
