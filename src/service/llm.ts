import { Context, Service } from 'koishi'
import { Config } from '../index'
import {
    AnalysisPromptContext,
    ChatQualityReview,
    GoldenQuote,
    QueryIntent,
    SummaryTopic,
    UserPersonaProfile,
    UserStats,
    UserTitle
} from '../types'
import { extractText, requestJson, textRequest } from './api'
import { load } from 'js-yaml'
import { createTrace } from '../diagnostics'
import { presetMessages } from './preset'
import { ConcurrencyLimiter } from './limiter'
import { AsyncLocalStorage } from 'node:async_hooks'
import { validateAnalysisOutput } from './validation'

export class LLMService extends Service {
    private usageScope = new AsyncLocalStorage<{
        promptTokens: number
        completionTokens: number
        totalTokens: number
    }>()

    private limiter?: ConcurrencyLimiter
    private usageTotals = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    }

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_llm', true)
        this.limiter = new ConcurrencyLimiter(config.maxConcurrentLLM || 4)
    }

    public async generateText(
        prompt: string,
        modelName?: string,
        signal?: AbortSignal,
        presetName = this.config.preset || ''
    ): Promise<string> {
        const model = modelName || this.config.llm.model
        const api = this.config.llm
        if (!api?.baseUrl || !model)
            throw new Error('请配置自定义 LLM API 地址和模型。')
        const messages = presetName
            ? await presetMessages(this.ctx, presetName, prompt)
            : undefined
        const request = textRequest(
            api,
            model,
            prompt,
            this.config.temperature,
            messages
        )
        const trace = createTrace(this.ctx, !!this.config.debug, '文本 API')
        trace('开始生成', {
            protocol: api.protocol,
            model,
            inputChars: prompt.length
        })
        const retries = Math.max(0, Number(api.retryCount ?? 2))
        const backoff = Math.max(0, Number(api.retryBackoffSeconds ?? 1))
        let text = ''
        const limiter =
            this.limiter ||
            (this.limiter = new ConcurrencyLimiter(
                this.config.maxConcurrentLLM || 4
            ))
        await limiter.run(async () => {
            let lastError: unknown
            for (let attempt = 0; attempt <= retries; attempt += 1) {
                try {
                    const response = await requestJson(
                        request.url,
                        api.apiKey,
                        request.body,
                        api.timeout,
                        request.headers,
                        signal,
                        trace
                    )
                    const usage =
                        response?.usage || response?.usageMetadata || {}
                    const promptTokens = Number(
                        usage.prompt_tokens ??
                            usage.input_tokens ??
                            usage.promptTokenCount ??
                            0
                    )
                    const completionTokens = Number(
                        usage.completion_tokens ??
                            usage.output_tokens ??
                            usage.candidatesTokenCount ??
                            0
                    )
                    const totalTokens = Number(
                        usage.total_tokens ??
                            usage.totalTokenCount ??
                            promptTokens + completionTokens
                    )
                    this.usageTotals ||= {
                        promptTokens: 0,
                        completionTokens: 0,
                        totalTokens: 0
                    }
                    this.usageTotals.promptTokens += promptTokens
                    this.usageTotals.completionTokens += completionTokens
                    this.usageTotals.totalTokens += totalTokens
                    const scoped = this.usageScope?.getStore()
                    if (scoped) {
                        scoped.promptTokens += promptTokens
                        scoped.completionTokens += completionTokens
                        scoped.totalTokens += totalTokens
                    }
                    text = extractText(api.protocol, response)
                    return
                } catch (error) {
                    lastError = error
                    if (signal?.aborted || attempt >= retries) break
                    const delay = backoff * 1000 * Math.pow(2, attempt)
                    if (delay > 0)
                        await new Promise((resolve) =>
                            setTimeout(resolve, delay)
                        )
                }
            }
            throw lastError instanceof Error
                ? lastError
                : new Error('文本 API 请求失败。')
        })
        trace('生成完成', { outputChars: text.length })
        return text
    }

    public getUsage() {
        return {
            ...(this.usageTotals || {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0
            })
        }
    }

    public async measureUsage<T>(task: () => Promise<T>) {
        this.usageScope ||= new AsyncLocalStorage()
        const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        const value = await this.usageScope.run(usage, task)
        return { value, usage }
    }

    private async _callLLM<T>(
        prompt: string,
        taskName: string,
        modelName?: string,
        signal?: AbortSignal,
        presetName = this.config.preset || ''
    ): Promise<T> {
        const attempts = Math.max(0, this.config.llm.retryCount ?? 2)
        for (let attempt = 0; ; attempt++) {
            const text = await this.generateText(
                prompt,
                modelName,
                signal,
                presetName
            )
            const fenced = text.match(
                /\x60\x60\x60(?:json|ya?ml)\s*([\s\S]*?)\x60\x60\x60/i
            )
            try {
                const data = load(fenced ? fenced[1] : text)
                return validateAnalysisOutput(taskName, data) as T
            } catch (error) {
                if (attempt >= attempts || signal?.aborted) throw error
                const delay =
                    Math.max(0, this.config.llm.retryBackoffSeconds ?? 1) *
                    1000 *
                    Math.pow(2, attempt)
                if (delay)
                    await new Promise((resolve) => setTimeout(resolve, delay))
            }
        }
    }

    private async _callText(
        prompt: string,
        taskName: string,
        modelName?: string
    ): Promise<string> {
        return this.generateText(prompt, modelName)
    }

    private moduleModel(
        name: keyof Pick<
            NonNullable<Config['llm']>,
            | 'topicModel'
            | 'titleModel'
            | 'goldenQuoteModel'
            | 'qualityModel'
            | 'personaModel'
            | 'queryModel'
            | 'chatModel'
            | 'comicModel'
        >
    ): string | undefined {
        const value = this.config.llm?.[name]
        return value?.trim() || undefined
    }

    private formatTimeRange(context?: AnalysisPromptContext): string {
        if (!context?.timeRange) return '（未指定）'

        const { start, end, description } = context.timeRange
        const format = (date?: Date) =>
            date ? date.toLocaleString('zh-CN', { hour12: false }) : '（未知）'
        const rangeText = `${format(start)} ~ ${format(end)}`
        return description ? `${description} (${rangeText})` : rangeText
    }

    private fillAnalysisPrompt(
        template: string,
        context?: AnalysisPromptContext
    ): string {
        const keywordsText =
            context?.keywords?.length > 0
                ? context.keywords.join('、')
                : '（无）'
        const topicsText =
            context?.topics?.length > 0 ? context.topics.join('、') : '（无）'
        const nicknamesText =
            context?.nicknames?.length > 0
                ? context.nicknames.join('、')
                : '（无）'
        const queryText = context?.query || '（无）'
        const timeRangeText = this.formatTimeRange(context)

        return template
            .replace('{keywords}', keywordsText)
            .replace('{topics}', topicsText)
            .replace('{nicknames}', nicknamesText)
            .replace('{query}', queryText)
            .replace('{timeRange}', timeRangeText)
    }

    public async summarizeTopics(
        messagesText: string,
        context?: AnalysisPromptContext,
        signal?: AbortSignal
    ): Promise<SummaryTopic[]> {
        const prompt = this.fillAnalysisPrompt(
            this.config.promptTopic
                .replace('{messages}', messagesText)
                .replace('{maxTopics}', this.config.maxTopics.toString()),
            context
        )
        return this._callLLM<SummaryTopic[]>(
            prompt,
            '话题分析',
            this.moduleModel('topicModel'),
            signal
        ).then((data) =>
            Array.isArray(data)
                ? data
                      .filter((item) => item && typeof item.topic === 'string')
                      .slice(0, this.config.maxTopics)
                : []
        )
    }

    public async analyzeUserTitles(
        users: UserStats[],
        context?: AnalysisPromptContext
    ): Promise<UserTitle[]> {
        const userSummaries = users
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, this.config.maxUserTitles)
            .map(
                (user) =>
                    `- ${user.nickname} (QQ:${user.userId}): ` +
                    `发言${user.messageCount}条, 平均${user.avgChars}字, ` +
                    `表情比例${user.emojiRatio}, 夜间发言比例${user.nightRatio}, ` +
                    `回复比例${user.replyRatio}`
            )
            .join('\n')

        const prompt = this.fillAnalysisPrompt(
            this.config.promptUserTitles.replace('{users}', userSummaries),
            context
        )
        return this._callLLM<UserTitle[]>(
            prompt,
            '用户称号分析',
            this.moduleModel('titleModel')
        ).then((data) =>
            Array.isArray(data)
                ? data
                      .filter((item) => item && typeof item.name === 'string')
                      .slice(0, this.config.maxUserTitles)
                : []
        )
    }

    public async analyzeGoldenQuotes(
        messagesText: string,
        maxQuotes: number,
        context?: AnalysisPromptContext
    ): Promise<GoldenQuote[]> {
        const prompt = this.fillAnalysisPrompt(
            this.config.promptGoldenQuotes
                .replace('{messages}', messagesText)
                .replace('{maxGoldenQuotes}', String(maxQuotes)),
            context
        )
        return this._callLLM<GoldenQuote[]>(
            prompt,
            '金句分析',
            this.moduleModel('goldenQuoteModel')
        ).then((data) =>
            Array.isArray(data)
                ? data
                      .filter(
                          (item) => item && typeof item.content === 'string'
                      )
                      .slice(0, maxQuotes)
                : []
        )
    }

    public async analyzeChatQuality(
        messagesText: string
    ): Promise<ChatQualityReview | null> {
        const prompt = this.config.promptChatQuality.replace(
            '{messages}',
            messagesText
        )
        const response = await this._callLLM<
            ChatQualityReview | ChatQualityReview[]
        >(prompt, '聊天质量锐评', this.moduleModel('qualityModel'))
        const value = Array.isArray(response) ? response[0] : response
        if (!value || typeof value !== 'object') return null
        const dimensions = Array.isArray(value.dimensions)
            ? value.dimensions
                  .filter((item) => item && typeof item.name === 'string')
                  .map((item) => ({
                      name: String(item.name),
                      percentage: Math.max(
                          0,
                          Math.min(100, Number(item.percentage) || 0)
                      ),
                      comment: String(item.comment || '')
                  }))
                  .slice(0, 8)
            : []
        const total = dimensions.reduce((sum, item) => sum + item.percentage, 0)
        if (total > 0 && Math.abs(total - 100) > 0.5) {
            const factor = 100 / total
            dimensions.forEach((item) => {
                item.percentage = Math.round(item.percentage * factor)
            })
            const difference =
                100 - dimensions.reduce((sum, item) => sum + item.percentage, 0)
            const largest = dimensions.reduce((a, b) =>
                a.percentage >= b.percentage ? a : b
            )
            largest.percentage += difference
        }
        return {
            title: String(value.title || '群聊质量画像'),
            subtitle: String(value.subtitle || ''),
            dimensions,
            summary: String(value.summary || '')
        }
    }

    public async analyzeUserPersona(
        userId: string,
        username: string,
        roles: string[],
        recentMessages: string,
        previousAnalysis?: string
    ): Promise<UserPersonaProfile | null> {
        const filledPrompt = this.config.promptUserPersona
            .replace('{messages}', recentMessages || '（最近暂无发言记录）')
            .replace(
                '{previousAnalysis}',
                previousAnalysis || '（无历史画像，请从零开始）'
            )
            .replace('{roles}', roles?.join(', ') || '（未知角色）')
            .replace('{userId}', userId)
            .replace('{username}', username || userId)
            .replace(
                '{personaLookbackDays}',
                String(this.config.personaLookbackDays)
            )

        const response = await this._callLLM<
            UserPersonaProfile | UserPersonaProfile[]
        >(filledPrompt, '用户画像分析', this.moduleModel('personaModel'))
        const result = Array.isArray(response) ? response[0] : response
        if (!result) return null
        result.userId = userId
        result.username = username
        result.keyTraits = Array.isArray(result.keyTraits)
            ? result.keyTraits
            : []
        result.interests = Array.isArray(result.interests)
            ? result.interests
            : []
        result.evidence = Array.isArray(result.evidence) ? result.evidence : []
        return result
    }

    public async parseGroupQuery(promptContext: {
        query: string
        currentTime: string
        timeZone: string
        platform: string
        groupName: string
        guildId?: string
        channelId?: string
        currentUserId?: string
        currentUserName?: string
    }): Promise<QueryIntent | null> {
        const prompt = this.config.promptQueryParser
            .replace('{currentTime}', promptContext.currentTime)
            .replace('{timeZone}', promptContext.timeZone)
            .replace('{platform}', promptContext.platform)
            .replace('{groupName}', promptContext.groupName || '未知群聊')
            .replace('{guildId}', promptContext.guildId || '')
            .replace('{channelId}', promptContext.channelId || '')
            .replace('{currentUserId}', promptContext.currentUserId || '')
            .replace('{currentUserName}', promptContext.currentUserName || '')
            .replace('{query}', promptContext.query)

        try {
            const intent = await this._callLLM<QueryIntent>(
                prompt,
                '群分析请求解析',
                this.moduleModel('queryModel'),
                undefined,
                ''
            )
            if (!intent || typeof intent !== 'object') return null
            return {
                ...intent,
                keywords: Array.isArray(intent.keywords)
                    ? intent.keywords.filter(Boolean).map(String)
                    : [],
                topics: Array.isArray(intent.topics)
                    ? intent.topics.filter(Boolean).map(String)
                    : [],
                nicknames: Array.isArray(intent.nicknames)
                    ? intent.nicknames.filter(Boolean).map(String)
                    : []
            }
        } catch (error) {
            this.ctx.logger.warn('解析群分析请求失败:', error)
            return null
        }
    }

    public async replyGroupQuery(promptContext: {
        query: string
        analysisResult: string
        currentTime: string
        groupName: string
        guildId?: string
        channelId?: string
        currentUserId?: string
        currentUserName?: string
    }): Promise<string | null> {
        const prompt = this.config.promptQueryChat
            .replace('{currentTime}', promptContext.currentTime)
            .replace('{groupName}', promptContext.groupName || '未知群聊')
            .replace('{guildId}', promptContext.guildId || '')
            .replace('{channelId}', promptContext.channelId || '')
            .replace('{currentUserId}', promptContext.currentUserId || '')
            .replace('{currentUserName}', promptContext.currentUserName || '')
            .replace('{query}', promptContext.query)
            .replace('{analysisResult}', promptContext.analysisResult || '')

        return this._callText(
            prompt,
            '群分析对话回复',
            this.moduleModel('chatModel')
        )
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_llm: LLMService
    }
}
