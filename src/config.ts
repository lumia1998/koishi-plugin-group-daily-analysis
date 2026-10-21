import { Schema } from 'koishi'
import { ApiConfig } from './service/api'

export interface GroupListener {
    selfId: string
    channelId: string
    platform: string
    guildId?: string
    enabled: boolean
    comicEnabled?: boolean
}

export type ComicImageFormat = 'openai' | 'google'

const GroupListener: Schema<GroupListener> = Schema.object({
    platform: Schema.string().required().description('平台名称'),
    selfId: Schema.string().required().description('机器人 ID'),
    channelId: Schema.string().required().description('频道 ID'),
    guildId: Schema.string().description('群组 ID'),
    enabled: Schema.boolean().default(true).description('是否在此频道启用监听'),
    comicEnabled: Schema.boolean().default(true).description('启用群漫画')
})

const comicImageFormat = () =>
    Schema.union([
        Schema.const('openai').description('OpenAI Images'),
        Schema.const('google').description('Google Gemini')
    ])

export interface Config {
    llm: ApiConfig
    comic: {
        enabled: boolean
        userEnabled: boolean
        autoSend: boolean
        format: ComicImageFormat
        baseUrl: string
        apiKey: string
        model: string
        referenceImage: string
        timeout: number
        cooldown: number
        aspectRatio: string
    }
    enableAllGroupsByDefault: boolean
    listenerGroups: GroupListener[]
    alwaysPersistMessages: boolean
    retentionDays: number
    outputFormat: 'image' | 'pdf' | 'text' | 'html'
    cronOutputFormats: ('image' | 'pdf' | 'text' | 'html')[]
    maxMessages: number
    temperature: number
    minMessages: number
    maxUsersInReport: number
    maxConcurrentTasks: number
    maxConcurrentLLM: number
    maxConcurrentRender: number
    checkpointEnabled: boolean
    cronSchedule: string
    autoAnalysisCooldown: number
    cronAnalysisDays: number
    useCalendarDayWindow: boolean
    personaAnalysisMessageInterval: number
    personaCacheLifetimeDays: number
    personaLookbackDays: number
    personaMaxMessages: number
    personaMinMessages: number
    theme: 'light' | 'dark' | 'auto'
    skin: string

    debug?: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        debug: Schema.boolean()
            .default(false)
            .description(
                '详细日志开关。开启后记录模型列表、文本 API、漫画各阶段、HTTP 状态与耗时，可在 Koishi 日志中查看；不记录密钥、聊天正文、提示词或图片内容。'
            ),
        enableAllGroupsByDefault: Schema.boolean()
            .default(false)
            .description(
                '为所有群默认启用群分析和监听，仍遵循监听群组列表中的群漫画开关。数据库只会记录实际触发的群消息。'
            ),
        listenerGroups: Schema.array(GroupListener)
            .role('table')
            .description(
                '群分析、定时任务和漫画共用的群组列表。每行可独立关闭群漫画。'
            )
            .default([]),
        cronSchedule: Schema.string().description(
            '定时发送分析报告的 CRON 表达式。留空则禁用。例如 "0 22 * * *" 表示每天22点。'
        ),
        autoAnalysisCooldown: Schema.number()
            .min(0)
            .max(1440)
            .step(1)
            .default(1)
            .description(
                '自动分析冷却时间（分钟）。冷却期间即使定时任务多次触发，也只会执行一次。'
            ),
        cronAnalysisDays: Schema.number()
            .description('定时任务分析的默认天数。')
            .default(1),
        useCalendarDayWindow: Schema.boolean()
            .default(true)
            .description(
                '按自然日计算默认分析时间窗。开启时，1 天从当天 00:00 开始；关闭时，1 天表示从当前时间向前推 24 小时。'
            )
    }).description('基础设置'),
    Schema.object({
        alwaysPersistMessages: Schema.boolean()
            .description(
                '启用后，无论平台能力如何都会将监听到的消息写入数据库。'
            )
            .default(false),
        retentionDays: Schema.number()
            .description('数据库中消息、历史报告和分析检查点的保留时间（天）。')
            .min(1)
            .default(7)
    }).description('消息存储设置'),
    Schema.object({
        maxMessages: Schema.number()
            .description('单次分析的最大消息数量。')
            .default(2000),
        minMessages: Schema.number()
            .description(
                '群分析和群漫画共用的最低消息条数，可自定义；达到此数量即可执行，默认 50 条。'
            )
            .min(1)
            .step(1)
            .max(1000)
            .default(50),
        maxUsersInReport: Schema.number()
            .description('报告中显示的最大活跃用户数量。')
            .default(10),
        maxConcurrentTasks: Schema.number()
            .min(1)
            .max(32)
            .default(3)
            .description(
                '群分析与查询共用的任务并发上限；漫画生图另按此数值限制请求并发。接口容易限流时请调小。'
            ),
        maxConcurrentLLM: Schema.number()
            .min(1)
            .max(32)
            .default(4)
            .description('同时请求文本模型的数量。接口不支持并发时请设为 1。'),
        maxConcurrentRender: Schema.number()
            .min(1)
            .max(16)
            .default(2)
            .description(
                '同时使用 Puppeteer 渲染报告的数量。内存不足时请调小。'
            ),
        checkpointEnabled: Schema.boolean()
            .default(true)
            .description(
                '保存固定时间范围和分析结果；重启后恢复未结束任务。已有结果直接重绘发送，未完成分析则重跑文本分析；不会重试付费漫画。'
            )
    }).description('群分析设置'),
    Schema.object({
        outputFormat: Schema.union([
            Schema.const('image').description('图片'),
            Schema.const('pdf').description('PDF'),
            Schema.const('text').description('文本'),
            Schema.const('html').description('HTML 文件')
        ])
            .description('默认输出格式。')
            .default('image'),
        cronOutputFormats: Schema.array(
            Schema.union([
                Schema.const('image'),
                Schema.const('pdf'),
                Schema.const('text'),
                Schema.const('html')
            ])
        )
            .role('table')
            .default([])
            .description('定时分析输出格式；留空时使用默认输出格式。'),
        theme: Schema.union([
            Schema.const('light').description('亮色主题'),
            Schema.const('dark').description('暗色主题'),
            Schema.const('auto').description('自动模式')
        ])
            .description(
                '渲染模板的主题。auto 会在 19:00-06:00 期间自动切换到暗色模式。'
            )
            .default('auto'),
        skin: Schema.union([
            Schema.const('md3').description('物料设计'),
            Schema.const('anime').description('二次元风格'),
            Schema.const('newspaper').description('报纸风格'),
            Schema.const('art').description('艺术风格'),
            Schema.const('scrapbook').description('手账风格'),
            Schema.const('simple').description('简洁'),
            Schema.const('ATRI').description('亚托莉'),
            Schema.const('BlueArchive').description('碧蓝档案'),
            Schema.const('retro_futurism').description('复古未来'),
            Schema.const('art_nouveau').description('新艺术'),
            Schema.const('spring_festival').description('节日'),
            Schema.const('HatsuneMiku').description('初音未来'),
            Schema.const('hack').description('终端')
        ])
            .description('渲染界面皮肤。')
            .default('md3')
    }).description('分析渲染设置'),
    Schema.object({
        temperature: Schema.number()
            .description(
                'Google 文本接口的生成随机度。数值越高，表达越发散；OpenAI 和 Anthropic 接口不使用此项。'
            )
            .min(0)
            .max(2)
            .default(1.5),
        llm: Schema.object({
            format: Schema.union([
                Schema.const('openai').description('OpenAI Responses'),
                Schema.const('google').description('Google Gemini'),
                Schema.const('anthropic').description('Anthropic Messages')
            ])
                .default('openai')
                .description('文本接口类型。'),
            baseUrl: Schema.string().description(
                '文本接口基础地址。支持填写带版本的地址或完整接口地址；保存地址和密钥后会自动获取模型列表。'
            ),
            apiKey: Schema.string()
                .role('secret')
                .default('')
                .description('文本接口密钥。'),
            model: Schema.dynamic('group-daily-analysis.text-model')
                .default('')
                .description(
                    '文本模型。接口不提供模型列表时可手动填写模型 ID。'
                ),
            timeout: Schema.number()
                .min(1)
                .max(600)
                .default(120)
                .description('请求超时（秒）。'),
            maxOutputTokens: Schema.number()
                .min(1)
                .default(32768)
                .description('单次生成的最大长度（Token）。')
        })
    }).description('文本模型接口'),
    Schema.object({
        comic: Schema.object({
            enabled: Schema.boolean()
                .default(false)
                .description('启用漫画服务，群漫画与用户画像漫画共用接口。'),
            userEnabled: Schema.boolean()
                .default(false)
                .description(
                    '启用用户画像漫画。读取已有长期画像，不重复执行画像分析。'
                ),
            autoSend: Schema.boolean()
                .default(false)
                .description(
                    '手动、自然语言或定时群分析生成报告后，异步生成并发送群漫画。需要启用漫画功能。'
                ),
            format: comicImageFormat()
                .default('google')
                .description('生图接口类型，群漫画和用户画像漫画共用。'),
            baseUrl: Schema.string().description(
                '生图接口基础地址。支持填写带版本的地址或完整接口地址；保存地址和密钥后会自动获取模型列表。'
            ),
            apiKey: Schema.string()
                .role('secret')
                .default('')
                .description('生图接口密钥。'),
            model: Schema.dynamic('group-daily-analysis.image-model')
                .default('')
                .description(
                    '选择支持图片输出的模型。列表由生图服务提供，可能包含文本模型；请根据服务商说明选择，也可手动输入。'
                ),
            referenceImage: Schema.path({ filters: ['file'] }).description(
                '角色参考图（PNG、JPEG 或 WebP，最大 20MB）。两种漫画共用；留空时由模型设计角色。'
            ),
            timeout: Schema.number()
                .min(1)
                .max(600)
                .default(300)
                .description('生图请求超时（秒）。'),
            cooldown: Schema.number()
                .min(0)
                .default(10)
                .description('每群漫画冷却时间（分钟）。'),
            aspectRatio: Schema.string()
                .pattern(/^[1-9]\d*:[1-9]\d*$/)
                .default('16:9')
                .description('群漫画宽高比（如 16:9），用户画像漫画使用 3:4。')
        })
    }).description('漫画设置'),
    Schema.object({
        personaAnalysisMessageInterval: Schema.number()
            .description(
                '跨群用户画像分析的触发阈值，新消息累计达到该条数时尝试更新画像。设置为 0 则关闭自动画像分析。'
            )
            .min(0)
            .default(50),
        personaCacheLifetimeDays: Schema.number()
            .description(
                '用户画像缓存结果的保留天数。超过此时长后再次请求会重新生成画像。'
            )
            .min(0)
            .default(3),
        personaLookbackDays: Schema.number()
            .description('画像分析回溯的天数窗口（建议保持在 1-4 天）。')
            .min(1)
            .max(7)
            .default(2),
        personaMaxMessages: Schema.number()
            .description('单次用户画像分析最多提取的历史消息数量。')
            .min(100)
            .max(1500)
            .default(400),
        personaMinMessages: Schema.number()
            .description('触发用户画像分析所需的最少历史消息数量。')
            .min(10)
            .default(20)
    }).description('用户画像设置')
])

export const name = 'group-analysis'

export const inject = {
    required: ['puppeteer', 'chatluna', 'database']
}
