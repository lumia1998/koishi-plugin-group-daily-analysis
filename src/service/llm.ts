import { Context, Service } from 'koishi'
import { Config } from '../index'
import {
    AnalysisPromptContext,
    GoldenQuote,
    QueryIntent,
    SummaryTopic,
    UserPersonaProfile,
    UserStats,
    UserTitle
} from '../types'
import { extractText, requestJson, textRequest } from './api'
import { load } from 'js-yaml'

export class LLMService extends Service {
    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_llm', true)
    }

    public async generateText(
        prompt: string,
        modelName?: string,
        signal?: AbortSignal
    ): Promise<string> {
        const model = modelName || this.config.llm.model
        const api = this.config.llm
        if (!api?.baseUrl || !model)
            throw new Error('请配置自定义 LLM API 地址和模型。')
        const request = textRequest(api, model, prompt, this.config.temperature)
        return extractText(
            api.protocol,
            await requestJson(
                request.url,
                api.apiKey,
                request.body,
                api.timeout,
                request.headers,
                signal
            )
        )
    }

    private async _callLLM<T>(
        prompt: string,
        taskName: string,
        modelName?: string,
        signal?: AbortSignal
    ): Promise<T> {
        const text = await this.generateText(prompt, modelName, signal)
        const fenced = text.match(
            /\x60\x60\x60(?:json|ya?ml)\s*([\s\S]*?)\x60\x60\x60/i
        )
        const data = load(fenced ? fenced[1] : text)
        if (!data || typeof data !== 'object')
            throw new Error(taskName + '未返回有效的 JSON/YAML 结构。')
        return data as T
    }

    private async _callText(
        prompt: string,
        taskName: string,
        modelName?: string
    ): Promise<string> {
        return this.generateText(prompt, modelName)
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
            undefined,
            signal
        ).then((data) => data ?? [])
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
        return this._callLLM<UserTitle[]>(prompt, '用户称号分析').then(
            (data) => data ?? []
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
        return this._callLLM<GoldenQuote[]>(prompt, '金句分析').then(
            (data) => data ?? []
        )
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
        >(filledPrompt, '用户画像分析')
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
                '群分析请求解析'
            )
            return intent ?? null
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

        return this._callText(prompt, '群分析对话回复')
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_llm: LLMService
    }
}
