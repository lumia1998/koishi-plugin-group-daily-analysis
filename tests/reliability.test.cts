import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import { AnalysisService } from '../src/service/analysis'
import { ConcurrencyLimiter } from '../src/service/limiter'
import {
    advanceSnapshot,
    pendingMessages,
    mergeIncrementalResults
} from '../src/service/incremental'
import { LLMService } from '../src/service/llm'
import { apply as commands } from '../src/plugins/command'
import { RendererService } from '../src/service/renderer'
import { MessageService } from '../src/service/message'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { buildGroupAnalysisCacheKey } from '../src/utils'
import {
    generateQQOfficialMarkdown,
    isQQOfficialPlatform
} from '../src/service/platform-report'

function result(topic = 'new') {
    return {
        totalMessages: 1,
        totalChars: 1,
        totalParticipants: 1,
        emojiCount: 0,
        mostActiveUser: null,
        mostActivePeriod: '12:00',
        userStats: [],
        topics: [{ topic, detail: topic, contributors: [] }],
        userTitles: [],
        goldenQuotes: [],
        activeHoursChart: '',
        activeHoursData: {},
        analysisDate: 'today',
        groupName: 'g'
    }
}
function message(id: string, time: number) {
    return {
        id,
        messageId: id,
        platform: 'onebot',
        selfId: 'bot',
        channelId: 'g',
        guildId: 'g',
        userId: 'u',
        username: 'U',
        content: 'hello',
        timestamp: new Date(time),
        elements: []
    } as any
}
function fixture() {
    const tables = new Map<string, Map<string, any>>()
    const table = (name: string) => {
        if (!tables.has(name)) tables.set(name, new Map())
        return tables.get(name)!
    }
    const events: Record<string, Function[]> = {}
    const sent: any[] = []
    const bot = {
        selfId: 'bot',
        platform: 'onebot',
        sendMessage: async (...args: any[]) => {
            sent.push(args)
        },
        getGuild: async () => ({ name: 'g' })
    }
    const ctx: any = {
        bots: [bot],
        logger: { info() {}, warn() {}, error() {} },
        setInterval() {},
        on(name: string, fn: Function) {
            ;(events[name] ||= []).push(fn)
        },
        parallel: async () => {},
        database: {
            extend() {},
            async upsert(name: string, rows: any[]) {
                for (const row of rows)
                    table(name).set(row.id, {
                        ...table(name).get(row.id),
                        ...row
                    })
            },
            async set(name: string, query: any, data: any) {
                for (const row of table(name).values())
                    if (matches(row, query)) Object.assign(row, data)
            },
            select(name: string) {
                let query: any = {},
                    limit = Infinity
                return {
                    where(value: any) {
                        query = value
                        return this
                    },
                    orderBy() {
                        return this
                    },
                    limit(value: number) {
                        limit = value
                        return this
                    },
                    async execute() {
                        return [...table(name).values()]
                            .filter((row) => matches(row, query))
                            .slice(0, limit)
                    }
                }
            }
        },
        chatluna_group_analysis_message: {
            getHistoricalMessages: async () => [message('a', Date.now())],
            onUserMessage(fn: Function) {
                ;(events.message ||= []).push(fn)
            }
        },
        chatluna_group_analysis_renderer: {
            renderGroupAnalysis: async () => Buffer.from('image')
        },
        chatluna_group_analysis_llm: {
            summarizeTopics: async () => result().topics,
            analyzeUserTitles: async () => [],
            analyzeGoldenQuotes: async () => [],
            analyzeChatQuality: async () => null
        }
    }
    const service: any = Object.assign(
        Object.create(AnalysisService.prototype),
        {
            ctx,
            config: {
                ...Config({
                    enableAllGroupsByDefault: true,
                    outputFormat: 'text'
                }),
                minMessages: 1
            },
            taskLimiter: new ConcurrencyLimiter(1),
            groupAnalysisCache: new Map(),
            incrementalCounts: new Map(),
            incrementalResults: new Map(),
            incrementalSnapshots: new Map(),
            incrementalRunning: new Map(),
            incrementalWrites: new Map()
        }
    )
    ctx.chatluna_group_analysis = service
    return { service, ctx, bot, table, events, sent }
}
function matches(row: any, query: any) {
    return Object.entries(query).every(([key, value]) => row[key] === value)
}

test('discovered groups obey scheduled allow/deny lists, including an empty whitelist', async () => {
    const { service, bot } = fixture()
    Object.assign(bot, { getGuildList: async () => [{ id: 'a' }, { id: 'b' }] })
    service.config.autoAnalysisGroupMode = 'whitelist'
    assert.deepEqual(await service.resolveAutoAnalysisGroups(), [])
    service.config.autoAnalysisGroups = ['b']
    assert.deepEqual(
        (await service.resolveAutoAnalysisGroups()).map((g: any) => g.guildId),
        ['b']
    )
    service.config.autoAnalysisGroupMode = 'blacklist'
    assert.deepEqual(
        (await service.resolveAutoAnalysisGroups()).map((g: any) => g.guildId),
        ['a']
    )
    service.config.enableAllGroupsByDefault = false
    assert.deepEqual(await service.resolveAutoAnalysisGroups(), [])
})

test('saved result survives send failure; recovery reuses it without fetching, LLM or comic', async () => {
    const { service, ctx, bot, table } = fixture()
    let comics = 0
    service.config.comic.enabled = service.config.comic.autoSend = true
    ctx.parallel = async () => {
        comics++
    }
    bot.sendMessage = async () => {
        throw new Error('offline')
    }
    const data = result()
    await service.executeGroupAnalysis(
        'bot',
        { channelId: 'g', guildId: 'g' },
        1,
        'text',
        false,
        true,
        data
    )
    assert.equal(comics, 1)
    const checkpoint = [...table('chatluna_analysis_checkpoints').values()][0]
    assert.equal(checkpoint.status, 'failed')
    assert.equal(
        table('chatluna_analysis_reports').get(checkpoint.id).status,
        'failed'
    )
    const payload = JSON.parse(checkpoint.payload)
    assert.deepEqual(payload.result, data)
    ctx.chatluna_group_analysis_message.getHistoricalMessages = async () => {
        throw new Error('must not fetch')
    }
    service.analyzeGroupMessages = async () => {
        throw new Error('must not use LLM')
    }
    bot.sendMessage = async () => {}
    await service.executeGroupAnalysis(
        'bot',
        payload.target,
        1,
        undefined,
        true,
        false,
        payload.result,
        { id: checkpoint.id, payload }
    )
    assert.equal(
        table('chatluna_analysis_checkpoints').get(checkpoint.id).status,
        'completed'
    )
    assert.equal(table('chatluna_analysis_reports').size, 1)
    assert.equal(comics, 1)
})

test('comic starts before report rendering and is not awaited', async () => {
    const { service, ctx } = fixture()
    let started = false
    service.config.comic.enabled = service.config.comic.autoSend = true
    ctx.parallel = () => {
        started = true
        return new Promise(() => {})
    }
    ctx.chatluna_group_analysis_renderer.renderGroupAnalysis = async () => {
        assert.equal(started, true)
        throw new Error('render failed')
    }
    await service.executeGroupAnalysis(
        'bot',
        { channelId: 'g' },
        1,
        'image',
        false,
        true,
        result()
    )
})

test('cursor survives serialization and accepts unseen messages at the same timestamp', () => {
    const initial = advanceSnapshot(
        undefined,
        [message('a', 1000)],
        result('old'),
        0
    )
    const restored = JSON.parse(JSON.stringify(initial))
    const delta = pendingMessages(
        [
            message('a', 1000),
            message('b', 1000),
            message('c', 2000),
            message('c', 2000)
        ],
        restored
    )
    assert.deepEqual(
        delta.map((m: any) => m.messageId),
        ['b', 'c']
    )
    const next = advanceSnapshot(restored, delta, result('new'), 1500)
    assert.equal(next.batches.length, 1)
    const merged = mergeIncrementalResults(next, result(), 1, 1)
    assert.equal(merged.topics[0].topic, 'new')
})

test('incremental batches use cursor, serialize same-group work and preserve pending counts on failure', async () => {
    const { service, ctx, table } = fixture()
    const now = Date.now() - 1000
    const id = 'onebot:bot:g:g'
    service.incrementalCounts.set(id, 1)
    const filters: any[] = []
    let items = [message('a', now)]
    ctx.chatluna_group_analysis_message.getHistoricalMessages = async (
        filter: any
    ) => {
        filters.push(filter)
        return items
    }
    let calls = 0
    service.analyzeGroupMessages = async () => {
        calls++
        await Promise.resolve()
        return result()
    }
    const session = { platform: 'onebot', selfId: 'bot' }
    const target = { guildId: 'g', channelId: 'g' }
    await Promise.all([
        service.runIncrementalBatch('bot', session, target, id),
        service.runIncrementalBatch('bot', session, target, id)
    ])
    assert.equal(calls, 1)
    assert.equal(
        table('chatluna_incremental_states').get(id).cursor.getTime(),
        now
    )
    items = [message('a', now), message('b', now)]
    service.incrementalCounts.set(id, 1)
    await service.runIncrementalBatch('bot', session, target, id)
    assert.equal(filters[2].startTime.getTime(), now)
    assert.equal(calls, 2)
    service.config.incrementalFallbackFull = false
    service.incrementalCounts.set(id, 1)
    items = [message('c', now + 1)]
    service.analyzeGroupMessages = async () => {
        throw new Error('LLM failed')
    }
    await assert.rejects(
        service.runIncrementalBatch('bot', session, target, id),
        /LLM failed/
    )
    assert.equal(service.incrementalCounts.get(id), 1)
    assert.equal(service.incrementalSnapshots.get(id).cursor, now)
})

test('message counts below threshold are persisted', async () => {
    const { service, table, events } = fixture()
    service.config.incrementalEnabled = true
    service.setupIncrementalMessageListener()
    await events.message[0]({
        platform: 'onebot',
        selfId: 'bot',
        guildId: 'g',
        channelId: 'g'
    })
    assert.equal(
        table('chatluna_incremental_states').get('onebot:bot:g:g').count,
        1
    )
})

test('history/redraw are scoped to the current group and enable action belongs to enable command', async () => {
    const { ctx, service, table } = fixture()
    const registered = new Map<string, any>()
    ctx.command = (declaration: string) => {
        const name = declaration.split(' ')[0]
        const cmd: any = {
            actions: [],
            aliases: [],
            usage() {
                return this
            },
            option() {
                return this
            },
            alias(value: string) {
                this.aliases.push(value)
                return this
            },
            action(fn: Function) {
                this.actions.push(fn)
                return this
            },
            subcommand(value: string) {
                return ctx.command(name + value)
            }
        }
        registered.set(name, cmd)
        return cmd
    }
    commands(ctx, service.config)
    assert.equal(registered.get('群分析.enable').actions.length, 1)
    assert.ok(registered.get('群分析.enable').aliases.includes('.启用'))
    assert.equal(registered.get('群分析.主题').actions.length, 1)
    table('chatluna_analysis_reports').set('foreign', {
        id: 'foreign',
        selfId: 'bot',
        platform: 'onebot',
        channelId: 'other',
        result: JSON.stringify(result()),
        format: 'text'
    })
    const session = {
        selfId: 'bot',
        platform: 'onebot',
        channelId: 'g',
        guildId: 'g',
        isDirect: false
    }
    assert.match(
        await registered.get('群分析.历史').actions[0]({ session }, 5),
        /暂无/
    )
    assert.match(
        await registered
            .get('群分析.重绘')
            .actions[0]({ session, options: {} }, 'foreign'),
        /找不到/
    )
})

test('token accounting is isolated across concurrent tasks and supports Responses usage', async (t) => {
    const service: any = Object.assign(Object.create(LLMService.prototype), {
        config: Config({
            llm: { baseUrl: 'https://provider.example', model: 'm' }
        })
    })
    t.mock.method(
        globalThis,
        'fetch',
        async () =>
            new Response(
                JSON.stringify({
                    usage: { input_tokens: 10, output_tokens: 3 },
                    output: [
                        {
                            type: 'message',
                            content: [{ type: 'output_text', text: 'ok' }]
                        }
                    ]
                })
            )
    )
    const [a, b] = await Promise.all([
        service.measureUsage(() => service.generateText('a')),
        service.measureUsage(async () => {
            await service.generateText('b')
            return service.generateText('c')
        })
    ])
    assert.equal(a.usage.totalTokens, 13)
    assert.equal(b.usage.totalTokens, 26)
})

test('limiter reserves the released slot for an already queued task', async () => {
    const limiter = new ConcurrencyLimiter(1)
    let active = 0,
        max = 0
    const work = () =>
        limiter.run(async () => {
            active++
            max = Math.max(max, active)
            await Promise.resolve()
            active--
        })
    await Promise.all(Array.from({ length: 20 }, work))
    assert.equal(max, 1)
})

test('scheduled multi-format output reuses one analysis even with caching disabled', async () => {
    const { service, ctx } = fixture()
    service.config.groupAnalysisCacheMinutes = 0
    service.config.cronOutputFormats = ['text', 'image']
    service.resolveAutoAnalysisGroups = async () => [
        {
            selfId: 'bot',
            platform: 'onebot',
            channelId: 'g',
            guildId: 'g',
            enabled: true
        }
    ]
    let calls = 0
    service.analyzeGroupMessages = async () => {
        calls++
        return result()
    }
    await service.executeAutoAnalysisForEnabledGroups()
    assert.equal(calls, 1)
    assert.ok(ctx)
})

test('scheduled report falls back after incremental failure and reuses its result for all formats', async () => {
    const { service } = fixture()
    service.config.incrementalEnabled = true
    service.config.cronOutputFormats = ['text', 'image']
    service.resolveAutoAnalysisGroups = async () => [
        { selfId: 'bot', platform: 'onebot', channelId: 'g', guildId: 'g' }
    ]
    service.prepareIncrementalReport = async () => {
        throw new Error('incremental unavailable')
    }
    const calls: any[][] = []
    const report = result()
    service.executeGroupAnalysis = async (...args: any[]) => {
        calls.push(args)
        return report
    }
    await service.executeAutoAnalysisForEnabledGroups()
    assert.equal(calls.length, 2)
    assert.equal(calls[0][3], 'text')
    assert.equal(calls[0][6], undefined)
    assert.equal(calls[0][5], true)
    assert.equal(calls[1][3], 'image')
    assert.equal(calls[1][5], false)
    assert.deepEqual(calls[1][6].topics, report.topics)
})

test('natural-language report also starts the comic', async () => {
    const { service, ctx } = fixture()
    service.config.comic.enabled = service.config.comic.autoSend = true
    ctx.chatluna_group_analysis_llm.parseGroupQuery = async () => ({
        action: '只分析'
    })
    service.analyzeGroupMessages = async () => result()
    let comics = 0
    ctx.parallel = async () => {
        comics++
    }
    await service.executeGroupQuery(
        { selfId: 'bot', platform: 'onebot', userId: 'u' },
        { channelId: 'g' },
        '昨天聊了什么'
    )
    assert.equal(comics, 1)
})

test('malformed module structures retry and valid replacement is returned', async (t) => {
    const service: any = Object.assign(Object.create(LLMService.prototype), {
        config: Config({
            llm: {
                baseUrl: 'https://provider.example',
                model: 'm',
                retryCount: 1,
                retryBackoffSeconds: 0
            }
        })
    })
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        const text = JSON.stringify(
            calls === 1 ? [{ topic: 'missing detail' }] : result().topics
        )
        return new Response(
            JSON.stringify({
                output: [
                    {
                        type: 'message',
                        content: [{ type: 'output_text', text }]
                    }
                ]
            })
        )
    })
    assert.deepEqual(await service.summarizeTopics('messages'), result().topics)
    assert.equal(calls, 2)
})

test('renderer limits entire screenshot lifecycle and closes a failed page', async () => {
    let active = 0,
        max = 0,
        closed = 0
    const renderer: any = Object.assign(
        Object.create(RendererService.prototype),
        {
            config: Config({}),
            limiter: new ConcurrencyLimiter(1),
            ctx: { logger: { info() {}, error() {} } },
            async _renderGroupAnalysis() {
                active++
                max = Math.max(max, active)
                return {
                    async $() {
                        return {
                            async screenshot() {
                                await Promise.resolve()
                                throw new Error('screenshot failed')
                            }
                        }
                    },
                    async close() {
                        active--
                        closed++
                    }
                }
            }
        }
    )
    await Promise.all([
        renderer.renderGroupAnalysis(result(), renderer.config),
        renderer.renderGroupAnalysis(result(), renderer.config)
    ])
    assert.equal(max, 1)
    assert.equal(closed, 2)
})

test('database history flushes buffered messages and filters robot/platform', async () => {
    let flushed = false,
        query: any
    const service: any = Object.assign(
        Object.create(MessageService.prototype),
        {
            config: Config({}),
            persistenceBuffers: new Map([
                ['key', { messages: [message('a', Date.now())] }]
            ]),
            async flushPendingBuffer() {
                flushed = true
            },
            ctx: {
                logger: { error() {} },
                database: {
                    select() {
                        return {
                            where(value: any) {
                                query = value
                                return this
                            },
                            offset() {
                                return this
                            },
                            limit() {
                                return this
                            },
                            orderBy() {
                                return this
                            },
                            async execute() {
                                assert.equal(flushed, true)
                                return []
                            }
                        }
                    }
                }
            }
        }
    )
    await service.getDatabaseHistoricalMessages({
        platform: 'onebot',
        selfId: 'bot',
        channelId: 'g'
    })
    assert.equal(query.selfId, 'bot')
    assert.equal(query.platform, 'onebot')
})

test('ready recovery preserves saved format and analysis results', async () => {
    const { service, table, events } = fixture()
    const payload = {
        selfId: 'bot',
        target: { channelId: 'g' },
        days: 1,
        format: 'text',
        result: result(),
        startTime: new Date(0).toISOString(),
        endTime: new Date().toISOString()
    }
    table('chatluna_analysis_checkpoints').set('task', {
        id: 'task',
        status: 'running',
        payload: JSON.stringify(payload)
    })
    let args: any[] = []
    service.executeGroupAnalysis = async (...input: any[]) => {
        args = input
    }
    service.setupReportDatabase()
    await events.ready[0]()
    assert.equal(args[5], false, 'recovery must not repeat paid comic')
    assert.deepEqual(args[6], payload.result)
    assert.equal(args[7].payload.format, 'text')
})

test('messages arriving during incremental analysis remain pending after commit', async () => {
    const { service, ctx, events } = fixture()
    service.config.incrementalEnabled = true
    service.setupIncrementalMessageListener()
    const id = 'onebot:bot:g:g'
    service.incrementalCounts.set(id, 5)
    let release!: () => void, started!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const entered = new Promise<void>((resolve) => {
        started = resolve
    })
    service.analyzeGroupMessages = async () => {
        started()
        await gate
        return result()
    }
    const session = {
        selfId: 'bot',
        platform: 'onebot',
        guildId: 'g',
        channelId: 'g'
    }
    const batch = service.runIncrementalBatch('bot', session, session, id)
    await entered
    await events.message[0](session)
    release()
    await batch
    assert.equal(service.incrementalCounts.get(id), 1)
    assert.ok(ctx)
})

test('failed delta falls back to full window once and commits only successful result', async () => {
    const { service, ctx } = fixture()
    service.config.incrementalFallbackFull = true
    const id = 'onebot:bot:g:g'
    const now = Date.now() - 1000
    service.incrementalSnapshots.set(
        id,
        advanceSnapshot(undefined, [message('a', now)], result('old'), 0)
    )
    service.incrementalCounts.set(id, 1)
    ctx.chatluna_group_analysis_message.getHistoricalMessages = async () => [
        message('a', now),
        message('b', now + 1)
    ]
    const sizes: number[] = []
    service.analyzeGroupMessages = async (messages: any[]) => {
        sizes.push(messages.length)
        if (sizes.length === 1) throw new Error('delta failed')
        return result('full')
    }
    await service.runIncrementalBatch(
        'bot',
        { platform: 'onebot' },
        { guildId: 'g', channelId: 'g' },
        id
    )
    assert.deepEqual(sizes, [1, 2])
    assert.equal(service.incrementalCounts.get(id), 0)
    assert.equal(service.incrementalSnapshots.get(id).batches.length, 1)
    assert.equal(
        service.incrementalSnapshots.get(id).batches[0].result.topics[0].topic,
        'full'
    )
})

test('exported HTML embeds local stylesheets for every native skin', async () => {
    for (const skin of ['md3', 'anime', 'newspaper', 'art', 'scrapbook']) {
        const config = Config({ skin, htmlOutputDir: 'artifacts/html-tests' })
        const renderer: any = Object.assign(
            Object.create(RendererService.prototype),
            {
                config,
                templateDir: path.resolve('resources'),
                ctx: { baseDir: process.cwd() }
            }
        )
        const file = await renderer.renderGroupAnalysisHtml(result(), config)
        const html = await readFile(file, 'utf8')
        assert.match(html, /<style>/)
        assert.doesNotMatch(html, /href=["']\.\/css\//)
    }
    for (const skin of [
        'ATRI',
        'BlueArchive',
        'HatsuneMiku',
        'retro_futurism',
        'art_nouveau',
        'spring_festival',
        'hack'
    ]) {
        const config = Config({ skin, htmlOutputDir: 'artifacts/html-tests' })
        const renderer: any = Object.assign(
            Object.create(RendererService.prototype),
            {
                config,
                templateDir: path.resolve('resources'),
                ctx: { baseDir: process.cwd() }
            }
        )
        const file = await renderer.renderGroupAnalysisHtml(result(), config)
        const html = await readFile(file, 'utf8')
        assert.match(html, new RegExp(`data-skin-alias="${skin}"`))
    }
})

test('analysis cache distinguishes platforms and channels in the same guild', () => {
    const a = buildGroupAnalysisCacheKey(
        'bot',
        { platform: 'onebot', guildId: 'g', channelId: 'a' },
        1
    )
    assert.notEqual(
        a,
        buildGroupAnalysisCacheKey(
            'bot',
            { platform: 'onebot', guildId: 'g', channelId: 'b' },
            1
        )
    )
    assert.notEqual(
        a,
        buildGroupAnalysisCacheKey(
            'bot',
            { platform: 'discord', guildId: 'g', channelId: 'a' },
            1
        )
    )
})

test('module checkpoints save successful LLM outputs and rerun only the failed module', async () => {
    const { service, ctx } = fixture()
    let topicCalls = 0
    let quoteCalls = 0
    let qualityCalls = 0
    let titleCalls = 0
    ctx.chatluna_group_analysis_llm = {
        async summarizeTopics() {
            topicCalls++
            return [{ topic: 'topic', detail: 'detail', contributors: [] }]
        },
        async analyzeUserTitles() {
            titleCalls++
            throw new Error('title unavailable')
        },
        async analyzeGoldenQuotes() {
            quoteCalls++
            return [{ content: 'quote', sender: 'u', reason: 'reason' }]
        },
        async analyzeChatQuality() {
            qualityCalls++
            return {
                title: 'quality',
                subtitle: 'stable',
                dimensions: [{ name: '互动', percentage: 100, comment: 'ok' }],
                summary: 'good'
            }
        }
    }
    const checkpoint: any = {
        id: 'checkpoint',
        payload: {
            selfId: 'bot',
            target: { channelId: 'g' },
            days: 1,
            format: 'text',
            startTime: new Date(0).toISOString(),
            endTime: new Date().toISOString()
        }
    }
    const first = await service.analyzeGroupMessages(
        [message('a', Date.now())],
        'bot',
        { channelId: 'g' },
        undefined,
        undefined,
        checkpoint
    )
    assert.deepEqual(first.failedModules, ['称号'])
    assert.ok(checkpoint.payload.moduleResults.topics)
    assert.ok(checkpoint.payload.moduleResults.goldenQuotes)
    assert.ok(checkpoint.payload.moduleResults.chatQuality)
    assert.equal(topicCalls, 1)
    assert.equal(quoteCalls, 1)
    assert.equal(qualityCalls, 1)
    ctx.chatluna_group_analysis_llm.analyzeUserTitles = async () => {
        titleCalls++
        return [
            { name: 'u', id: 1, title: 'title', mbti: 'INTP', reason: 'reason' }
        ]
    }
    const second = await service.analyzeGroupMessages(
        [message('a', Date.now())],
        'bot',
        { channelId: 'g' },
        undefined,
        checkpoint.payload.moduleResults,
        checkpoint
    )
    assert.deepEqual(second.failedModules, [])
    assert.equal(topicCalls, 1)
    assert.equal(quoteCalls, 1)
    assert.equal(qualityCalls, 1)
    assert.equal(titleCalls, 2)
})

test('incremental merge combines latest titles and weighted quality dimensions', () => {
    const first = result('old')
    first.totalMessages = 10
    first.userTitles = [
        {
            name: 'alice',
            id: 1,
            title: 'old title',
            mbti: 'INTP',
            reason: 'old'
        },
        { name: 'bob', id: 2, title: 'bob title', mbti: 'ENFP', reason: 'old' }
    ]
    first.chatQuality = {
        title: 'quality',
        subtitle: 'old',
        dimensions: [
            { name: '互动', percentage: 80, comment: 'old' },
            { name: '信息', percentage: 20, comment: 'old' }
        ],
        summary: 'old'
    }
    const second = result('new')
    second.totalMessages = 30
    second.userTitles = [
        {
            name: 'alice',
            id: 1,
            title: 'new title',
            mbti: 'INTJ',
            reason: 'new'
        }
    ]
    second.chatQuality = {
        title: 'quality',
        subtitle: 'new',
        dimensions: [
            { name: '互动', percentage: 40, comment: 'new' },
            { name: '信息', percentage: 60, comment: 'new' }
        ],
        summary: 'new'
    }
    const merged = mergeIncrementalResults(
        {
            version: 1,
            cursor: 2,
            cursorIds: [],
            batches: [
                { start: 1, end: 1, result: first },
                { start: 2, end: 2, result: second }
            ]
        },
        result(),
        5,
        5,
        5
    )
    assert.equal(
        merged.userTitles.find((item) => item.id === 1)?.title,
        'new title'
    )
    assert.equal(merged.userTitles.length, 2)
    assert.equal(
        merged.chatQuality?.dimensions.reduce(
            (sum, item) => sum + item.percentage,
            0
        ),
        100
    )
    assert.ok(
        (merged.chatQuality?.dimensions.find((item) => item.name === '互动')
            ?.percentage || 0) < 60
    )
})

test('incremental quality normalizes disjoint dimensions by message weight including rounding and truncation', () => {
    for (const weights of [[1, 1, 1], [1, 2, 7], Array(10).fill(1)]) {
        const batches = weights.map((weight, index) => ({
            start: index,
            end: index,
            result: {
                ...result(),
                totalMessages: weight,
                chatQuality: {
                    title: 'quality',
                    subtitle: '',
                    summary: '',
                    dimensions: [
                        { name: String(index), percentage: 100, comment: '' }
                    ]
                }
            }
        }))
        const merged = mergeIncrementalResults(
            { version: 1, cursor: 10, cursorIds: [], batches },
            result(),
            5,
            5
        )
        const dimensions = merged.chatQuality!.dimensions
        assert.equal(dimensions.length, Math.min(8, weights.length))
        assert.equal(
            dimensions.reduce((sum, item) => sum + item.percentage, 0),
            100
        )
        assert.ok(
            dimensions.every(
                (item) =>
                    Number.isInteger(item.percentage) &&
                    item.percentage >= 0 &&
                    item.percentage <= 100
            )
        )
        if (weights[2] === 7) {
            assert.equal(
                dimensions.find((item) => item.name === '0')!.percentage,
                10
            )
            assert.equal(
                dimensions.find((item) => item.name === '1')!.percentage,
                20
            )
            assert.equal(
                dimensions.find((item) => item.name === '2')!.percentage,
                70
            )
        }
    }
})

test('QQ official reports use a platform-specific Markdown payload while other platforms stay generic', () => {
    const data = result('topic * unsafe')
    data.userTitles = [
        { name: 'alice', id: 1, title: 'title', mbti: 'INTP', reason: 'reason' }
    ]
    data.goldenQuotes = [
        { content: 'quote', sender: 'alice', reason: 'reason' }
    ]
    const markdown = generateQQOfficialMarkdown(data)
    assert.ok(isQQOfficialPlatform('qq'))
    assert.ok(isQQOfficialPlatform('qq_official'))
    assert.equal(isQQOfficialPlatform('onebot'), false)
    assert.match(markdown, /群聊日常分析报告/)
    assert.match(markdown, /topic \\\* unsafe/)
    assert.match(markdown, /群友称号/)
})
