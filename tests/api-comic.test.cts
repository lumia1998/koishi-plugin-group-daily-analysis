import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import {
    endpoint,
    extractText,
    requestJson,
    textRequest
} from '../src/service/api'
import { generateImage, imageMime, isPublicIPv4 } from '../src/service/image'
import { LLMService } from '../src/service/llm'
import { apply, todayWindow } from '../src/plugins/comic'
import { listModels } from '../src/models'
import { createTrace, errorKind } from '../src/diagnostics'
import { buildGroupComicImagePrompt } from '../src/comic-prompts'
import { isGroupComicEnabled, shouldListenToMessage } from '../src/utils'

test('API errors preserve provider details and network codes without credentials', async (t) => {
    t.mock.method(
        globalThis,
        'fetch',
        async () =>
            new Response(
                JSON.stringify({
                    error: {
                        message:
                            'model does not support image input; key=my-secret-key'
                    }
                }),
                { status: 400 }
            )
    )
    await assert.rejects(
        requestJson('https://example.com', 'my-secret-key', {}, 1),
        (error: Error) =>
            /HTTP 400/.test(error.message) &&
            error.message.includes('model does not support image input') &&
            !error.message.includes('my-secret-key')
    )
    t.mock.restoreAll()
    t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } })
    })
    await assert.rejects(
        requestJson('https://example.com', '', {}, 1),
        /ECONNREFUSED/
    )
})

test('group comic image prompt assigns report and character reference roles', () => {
    const imagePrompt = buildGroupComicImagePrompt(true, true, 1, 'md3')
    assert.match(imagePrompt, /附件 1 是完整的群分析报告图片/)
    assert.match(imagePrompt, /附件 2 是配置页中的主要主持角色参考图/)
    assert.match(imagePrompt, /应有 1 个话题/)
    assert.doesNotMatch(imagePrompt, /额外设定|及后续/)
    const withoutCharacter = buildGroupComicImagePrompt(true, false, 1)
    assert.match(withoutCharacter, /没有主持角色参考图/)
    assert.doesNotMatch(withoutCharacter, /附件 2/)
})

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
    'base64'
)
// A distinct provider result: the comic pipeline rejects an echoed reference.
const generatedPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQOlrxHwAEywJfL/28jwAAAABJRU5ErkJggg==',
    'base64'
)
const base = 'https://provider.example'
const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' }
    })

test('schema supplies nested API and disabled-comic defaults', () => {
    const config = Config({})
    assert.equal(config.llm.format, 'openai')
    assert.equal(config.llm.timeout, 120)
    assert.equal((config as any).preset, undefined)
    assert.ok(!JSON.stringify(Config).includes('"preset"'))
    assert.equal(config.comic.enabled, false)
    for (const key of [
        'referenceImages',
        'characters',
        'randomCharacterDaily',
        'characterDescription'
    ]) {
        assert.equal((config.comic as any)[key], undefined, key)
        assert.ok(!JSON.stringify(Config).includes(`"${key}"`), key)
    }
    assert.equal(config.comic.maxTopics, undefined)
    assert.equal(config.maxConcurrentTasks, 3)
    assert.equal(config.maxConcurrentLLM, 4)
    assert.equal(config.maxConcurrentRender, 2)
    assert.equal(config.maxTopics, undefined)
    assert.equal(config.maxUserTitles, undefined)
    assert.equal(config.maxGoldenQuotes, undefined)
    assert.equal(config.debug, false)
    assert.deepEqual(config.cronOutputFormats, [])
})

test('per-group comic switches default to enabled and isolate platform, bot and group', () => {
    const session = {
        platform: 'onebot',
        selfId: 'bot',
        channelId: 'g',
        guildId: 'g'
    }
    const config = Config({ listenerGroups: [{ ...session, enabled: true }] })
    assert.equal(config.listenerGroups[0].comicEnabled, true)
    const closed = { ...session, enabled: true, comicEnabled: false }
    assert.equal(isGroupComicEnabled(session, []), true)
    assert.equal(
        isGroupComicEnabled(session, [{ ...session, enabled: true }]),
        true
    )
    assert.equal(isGroupComicEnabled(session, [closed]), false)
    assert.equal(shouldListenToMessage(session, [closed]), true)
    for (const unrelated of [
        { ...closed, platform: 'other' },
        { ...closed, selfId: 'other' },
        { ...closed, channelId: 'other', guildId: 'other' }
    ])
        assert.equal(isGroupComicEnabled(session, [unrelated]), true)
    assert.equal(
        isGroupComicEnabled(session, [
            { ...closed, comicEnabled: true },
            closed
        ]),
        false,
        'an explicit disabled duplicate must take precedence'
    )
    assert.equal(
        isGroupComicEnabled({ ...session, channelId: 'thread' }, [closed]),
        false,
        'guild matching follows the listener group scope'
    )
})

test('detailed logging is opt-in and API traces omit secrets and bodies', async (t) => {
    const logs: string[] = []
    const ctx = {
        logger: { info: (message: string) => logs.push(message) }
    } as any
    createTrace(ctx, false, 'test')('hidden')
    assert.deepEqual(logs, [])
    const trace = createTrace(ctx, true, 'test')
    t.mock.method(globalThis, 'fetch', async () =>
        json({ content: 'private-response' })
    )
    await requestJson(
        base + '?key=private-url',
        'private-key',
        { prompt: 'private-prompt' },
        1,
        {},
        undefined,
        trace
    )
    assert.ok(logs.some((line) => line.includes('200')))
    assert.ok(!logs.join('').includes('private-'))
    t.mock.restoreAll()
    t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('private-error', { status: 401 })
    )
    await assert.rejects(
        requestJson(base, 'private-key', {}, 1, {}, undefined, trace)
    )
    assert.ok(logs.some((line) => line.includes('HTTP 401')))
    assert.ok(!logs.join('').includes('private-'))
    assert.equal(
        errorKind(new Error('private-error')),
        'RequestOrProcessingError'
    )
})

test('endpoint accepts root, version and full paths without duplicating versions', () => {
    for (const input of [
        base,
        base + '/v1',
        base + '/v1/',
        base + '/v1/responses'
    ]) {
        assert.equal(endpoint(input, '/v1/responses'), base + '/v1/responses')
    }
    assert.equal(
        endpoint(base + '/v1beta', '/v1beta/models/test:generateContent'),
        base + '/v1beta/models/test:generateContent'
    )
    assert.throws(() => endpoint('file:///tmp', '/v1/responses'))
    assert.throws(() => endpoint('https://user:secret@host', '/v1/responses'))
})

test('all text formats send and extract their native wire formats', async (t) => {
    const config = Config({}).llm
    config.baseUrl = base
    config.apiKey = 'test-key'
    const cases = [
        [
            'openai',
            '/v1/responses',
            {
                output: [
                    {
                        type: 'message',
                        content: [{ type: 'output_text', text: 'hello' }]
                    }
                ]
            }
        ],
        [
            'anthropic',
            '/v1/messages',
            {
                content: [
                    { type: 'thinking', thinking: 'hidden' },
                    { type: 'text', text: 'hello' }
                ]
            }
        ],
        [
            'google',
            '/v1beta/models/model:generateContent',
            {
                candidates: [
                    {
                        finishReason: 'STOP',
                        content: {
                            parts: [
                                { thought: true, text: 'hidden' },
                                { text: 'hello' }
                            ]
                        }
                    }
                ]
            }
        ]
    ] as const
    for (const [format, path, response] of cases) {
        config.format = format
        const request = textRequest(config, 'model', 'prompt', 1)
        assert.equal(request.url, base + path)
        t.mock.method(globalThis, 'fetch', async (_url, init) => {
            const headers = new Headers(init?.headers)
            if (format === 'anthropic' || format === 'google')
                assert.equal(headers.has('Authorization'), false)
            else assert.equal(headers.get('Authorization'), 'Bearer test-key')
            const body = JSON.parse(init!.body as string)
            if (format === 'openai') {
                assert.equal(body.input, 'prompt')
                assert.equal(body.store, false)
            }
            if (format === 'anthropic') {
                assert.equal(body.max_tokens, 32768)
                assert.equal(headers.get('x-api-key'), 'test-key')
            }
            if (format === 'google')
                assert.equal(body.contents[0].parts[0].text, 'prompt')
            return json(response)
        })
        assert.equal(
            extractText(
                format,
                await requestJson(
                    request.url,
                    config.apiKey,
                    request.body,
                    1,
                    request.headers
                )
            ),
            'hello'
        )
        t.mock.restoreAll()
    }
})

test('refused, truncated, failed, malformed and canceled responses fail safely', async (t) => {
    assert.throws(() => extractText('openai', { status: 'incomplete' }))
    assert.throws(() => extractText('anthropic', { stop_reason: 'max_tokens' }))
    assert.throws(() =>
        extractText('google', {
            candidates: [{ finishReason: 'SAFETY' }]
        })
    )
    assert.throws(() =>
        extractText('openai', {
            output: [{ type: 'message', content: [{ type: 'refusal' }] }]
        })
    )
    t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('secret provider error', { status: 401 })
    )
    await assert.rejects(
        requestJson(base, 'secret', {}, 1),
        /^Error: API 请求失败（HTTP 401）。\[已隐藏\] provider error$/
    )
    t.mock.restoreAll()
    t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('not json secret')
    )
    await assert.rejects(
        requestJson(base, 'secret', {}, 1),
        (error: Error) =>
            !error.message.includes('secret') && /JSON/.test(error.message)
    )
    t.mock.restoreAll()
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
        init!.signal!.throwIfAborted()
        return json({})
    })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
        requestJson(base, '', {}, 1, {}, controller.signal),
        /已取消/
    )
})

test('Google reference is inlineData; OpenAI reference is multipart edits', async (t) => {
    const config = Config({}).comic
    Object.assign(config, {
        baseUrl: base,
        apiKey: 'key',
        model: 'image-model'
    })
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        if (config.format === 'google') {
            const body = JSON.parse(init!.body as string)
            assert.equal(body.generationConfig.imageConfig.aspectRatio, '3:4')
            assert.equal(
                body.contents[0].parts[1].inlineData.data,
                png.toString('base64')
            )
            assert.equal(new Headers(init!.headers).has('Authorization'), false)
            return json({
                candidates: [
                    {
                        content: {
                            parts: [
                                { inlineData: { data: png.toString('base64') } }
                            ]
                        }
                    }
                ]
            })
        }
        assert.equal(url, base + '/v1/images/edits')
        const form = init!.body as FormData
        assert.equal(form.get('prompt'), 'storyboard')
        assert.equal(form.get('size'), null)
        assert.equal(form.get('quality'), null)
        assert.equal(form.get('aspect_ratio'), '3:4')
        assert.equal(form.get('n'), '1')
        assert.deepEqual(
            Buffer.from(await (form.get('image[]') as Blob).arrayBuffer()),
            png
        )
        return json({ data: [{ b64_json: png.toString('base64') }] })
    })
    const portrait = { aspectRatio: '3:4', size: '1024x1536' }
    assert.deepEqual(
        await generateImage(
            config,
            'storyboard',
            png,
            undefined,
            undefined,
            portrait
        ),
        png
    )
    config.format = 'openai'
    assert.deepEqual(
        await generateImage(
            config,
            'storyboard',
            png,
            undefined,
            undefined,
            portrait
        ),
        png
    )
    t.mock.restoreAll()
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, base + '/v1/images/generations')
        assert.equal(JSON.parse(init!.body as string).n, 1)
        return json({ data: [{ b64_json: png.toString('base64') }] })
    })
    assert.deepEqual(await generateImage(config, 'storyboard'), png)
})

test('rejects special IPs and non-image output', () => {
    for (const ip of [
        '127.0.0.1',
        '10.0.0.1',
        '172.16.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '198.18.0.1',
        '224.0.0.1',
        '::1'
    ])
        assert.equal(isPublicIPv4(ip), false, ip)
    assert.equal(isPublicIPv4('8.8.8.8'), true)
    assert.equal(imageMime(png), 'image/png')
    assert.throws(() => imageMime(Buffer.from('<html>error</html>')))
})

test('LLM service parses plain JSON and fenced YAML without ChatLuna', async (t) => {
    const config = Config({ llm: { baseUrl: base, model: 'model' } })
    const service = Object.assign(Object.create(LLMService.prototype), {
        config
    }) as LLMService
    for (const output of [
        '[{"topic":"test","detail":"details","contributors":[]}]',
        '```yaml\n- topic: test\n  detail: details\n  contributors: []\n```'
    ]) {
        t.mock.method(globalThis, 'fetch', async () =>
            json({
                output: [
                    {
                        type: 'message',
                        content: [{ type: 'output_text', text: output }]
                    }
                ]
            })
        )
        assert.deepEqual(await service.summarizeTopics('messages'), [
            { topic: 'test', detail: 'details', contributors: [] }
        ])
        t.mock.restoreAll()
    }
})

test('text analysis and replies ignore saved presets in every provider format', async (t) => {
    for (const format of ['openai', 'anthropic', 'google'] as const) {
        const config = Config({ llm: { format, baseUrl: base, model: 'text' } })
        Object.assign(config, { preset: 'REMOVED_PRESET_MUST_NOT_RUN' })
        const ctx = {
            get chatluna() {
                assert.fail('text generation must not access ChatLuna presets')
            },
            logger: { info() {}, warn() {}, error() {} }
        }
        const service = Object.assign(Object.create(LLMService.prototype), {
            config,
            ctx
        }) as LLMService
        const prompts: string[] = []
        let output = '[{"topic":"test","contributors":[],"detail":"details"}]'
        t.mock.method(globalThis, 'fetch', async (_url, init) => {
            const body = JSON.parse(init!.body as string)
            let prompt: string
            if (format === 'openai') {
                assert.equal(typeof body.input, 'string')
                prompt = body.input
            } else if (format === 'anthropic') {
                assert.equal(body.system, undefined)
                assert.equal(body.messages.length, 1)
                assert.equal(body.messages[0].role, 'user')
                prompt = body.messages[0].content
            } else {
                assert.equal(body.systemInstruction, undefined)
                assert.equal(body.contents.length, 1)
                assert.equal(body.contents[0].role, 'user')
                assert.equal(body.contents[0].parts.length, 1)
                prompt = body.contents[0].parts[0].text
            }
            assert.doesNotMatch(prompt, /REMOVED_PRESET_MUST_NOT_RUN/)
            prompts.push(prompt)
            if (format === 'openai')
                return json({
                    output: [
                        {
                            type: 'message',
                            content: [{ type: 'output_text', text: output }]
                        }
                    ]
                })
            if (format === 'anthropic')
                return json({ content: [{ type: 'text', text: output }] })
            return json({
                candidates: [{ content: { parts: [{ text: output }] } }]
            })
        })
        assert.equal(
            (await service.summarizeTopics('messages'))[0].topic,
            'test'
        )
        output = '{"action":"只分析"}'
        assert.equal(
            (
                await service.parseGroupQuery({
                    query: '今天聊了什么',
                    currentTime: '2026-10-13 12:00:00',
                    timeZone: 'Asia/Singapore',
                    platform: 'onebot',
                    groupName: '测试群'
                })
            )?.action,
            '只分析'
        )
        output = 'reply'
        assert.equal(
            await service.replyGroupQuery({
                query: '你怎么看',
                analysisResult: '分析结果',
                currentTime: '2026-10-13 12:00:00',
                groupName: '测试群'
            }),
            'reply'
        )
        assert.equal(await service.generateText('direct task'), 'reply')
        assert.equal(prompts.length, 4)
        assert.match(prompts[0], /群聊信息总结/)
        assert.match(prompts[1], /结构化查询/)
        assert.match(prompts[2], /群聊分析对话助手/)
        assert.equal(prompts[3], 'direct task')
        t.mock.restoreAll()
    }
})

test('comic pipeline uses the group report image and enforces cooldown and group guards', async (t) => {
    const config = Config({
        enableAllGroupsByDefault: true,
        comic: {
            enabled: true,
            generationMode: 'direct',
            baseUrl: base,
            model: 'image-model'
        }
    })
    let action: any
    let calls = 0
    const events: Record<string, Function> = {}
    const sent: unknown[] = []
    const session = {
        platform: 'onebot',
        selfId: 'bot',
        guildId: 'group',
        channelId: 'group',
        isDirect: false,
        send: async (value: unknown) => sent.push(value)
    }
    const ctx = {
        baseDir: process.cwd(),
        on(name: string, callback: Function) {
            events[name] = callback
        },
        bots: [
            {
                platform: 'onebot',
                selfId: 'bot',
                sendMessage: async (_channel: string, value: unknown) =>
                    sent.push(value)
            }
        ],
        command(name: string, _description: string, options: any) {
            if (name.startsWith('用户画像.漫画'))
                return {
                    shortcut() {
                        return this
                    },
                    action() {}
                }
            assert.equal(name, '群漫画 [days:number]')
            assert.equal(options.checkArgCount, true)
            return {
                alias() {
                    return this
                },
                action(fn: any) {
                    action = fn
                }
            }
        },
        chatluna_group_analysis_message: {
            async getHistoricalMessages(options: any) {
                assert.equal(options.startTime.getHours(), 0)
                assert.equal(
                    options.startTime.toDateString(),
                    options.endTime.toDateString()
                )
                return Array.from({ length: 100 }, () => ({
                    userId: 'user',
                    username: 'User',
                    content: 'hello',
                    timestamp: new Date()
                }))
            }
        },
        chatluna_group_analysis_llm: {
            async summarizeTopics(text: string) {
                assert.equal(typeof text, 'string')
                return [{ topic: 'test', detail: 'topic details' }]
            }
        },
        chatluna_group_analysis_renderer: {
            async renderGroupAnalysis(result: any, passedConfig: any) {
                assert.equal(result.topics[0].topic, 'test')
                assert.equal(passedConfig.skin, config.skin)
                return png
            }
        }
    }
    t.mock.method(globalThis, 'fetch', async (_url: any, request: any) => {
        const body = JSON.parse(request.body)
        assert.match(
            body.contents[0].parts[0].text,
            /查看附件 1 的今日话题部分/
        )
        assert.doesNotMatch(body.contents[0].parts[0].text, /JSON|storyboard/)
        assert.equal(body.contents[0].parts.length, 2)
        assert.equal(
            body.contents[0].parts[1].inlineData.data,
            png.toString('base64')
        )
        calls++
        return json({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inlineData: {
                                    data: generatedPng.toString('base64')
                                }
                            }
                        ]
                    }
                }
            ]
        })
    })
    apply(ctx as any, config)
    assert.match(
        await action({ session: { ...session, isDirect: true } }),
        /群聊/
    )
    const first = action({ session }, 1)
    assert.match(await action({ session }, 1), /正在生成/)
    await first
    assert.equal(sent.length, 2)
    assert.equal(calls, 1)
    assert.match(await action({ session }, 1), /冷却/)
    assert.equal(calls, 1)
    config.listenerGroups.push({
        platform: session.platform,
        selfId: session.selfId,
        guildId: session.guildId,
        channelId: session.channelId,
        enabled: true,
        comicEnabled: false
    })
    const sentBeforeClosed = sent.length
    assert.match(await action({ session }, 1), /本群已关闭群漫画/)
    assert.equal(calls, 1, 'a disabled row overrides default all-group access')
    assert.equal(sent.length, sentBeforeClosed)
    config.comic.groupMode = 'whitelist'
    config.comic.groups = [session.guildId]
    assert.match(await action({ session }, 1), /本群已关闭群漫画/)
    config.listenerGroups[0].comicEnabled = true
    config.comic.groupMode = 'blacklist'
    assert.match(await action({ session }, 1), /本群未开放群漫画/)
    config.comic.groupMode = 'inherit'
    config.comic.enabled = false
    assert.match(await action({ session }, 1), /启用漫画功能/)
    config.comic.enabled = true
    assert.equal(calls, 1, 'the row switch must respect global permissions')
    t.mock.restoreAll()
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        return new Response('upstream failed', { status: 503 })
    })
    const other = { ...session, channelId: 'other' }
    const failure = await action({ session: other }, 1)
    assert.equal(failure.type, 'text')
    assert.match(failure.attrs.content, /群漫画失败（调用生图 API）/)
    assert.match(failure.attrs.content, /HTTP 503.*upstream failed/)
    assert.equal(calls, 2)
    assert.match(await action({ session: other }, 1), /冷却/)
    assert.equal(calls, 2)
    t.mock.restoreAll()
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        return json({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inlineData: {
                                    data: generatedPng.toString('base64')
                                }
                            }
                        ]
                    }
                }
            ]
        })
    })
    const group = {
        platform: 'onebot',
        selfId: 'bot',
        guildId: 'scheduled',
        channelId: 'scheduled',
        enabled: true
    }
    await events['group-daily-analysis/auto-comic'](group)
    assert.equal(calls, 2, 'automatic comics are opt-in')
    config.comic.autoSend = true
    config.listenerGroups.push({ ...group, comicEnabled: false })
    const sentBeforeAutoClosed = sent.length
    await events['group-daily-analysis/auto-comic'](group)
    assert.equal(calls, 2, 'a disabled group must not call the image API')
    assert.equal(
        sent.length,
        sentBeforeAutoClosed,
        'automatic skips are silent'
    )
    config.listenerGroups[1].comicEnabled = true
    await events['group-daily-analysis/auto-comic'](group)
    assert.equal(calls, 3)
    await events['group-daily-analysis/auto-comic'](group)
    assert.equal(calls, 3, 'scheduled comics share the cooldown')
    ctx.chatluna_group_analysis_message.getHistoricalMessages = async () => {
        throw new Error('reused topics must not fetch current-day history')
    }
    await events['group-daily-analysis/auto-comic']({
        group: { ...group, channelId: 'reused', guildId: 'reused' },
        topics: [{ topic: 'test', detail: 'topic details', contributors: [] }]
    })
    assert.equal(calls, 4)
    await events['group-daily-analysis/auto-comic']({
        group: { ...group, channelId: 'empty', guildId: 'empty' },
        topics: []
    })
    assert.equal(
        calls,
        4,
        'disabled or empty topic module must not start paid generation'
    )
})

test('comic window always starts at local midnight', () => {
    const now = new Date(2026, 8, 10, 15, 30)
    const window = todayWindow(now)
    assert.equal(window.startTime.getTime(), new Date(2026, 8, 10).getTime())
    assert.equal(window.endTime, now)
})

test('full image endpoints switch operations without duplicate paths', () => {
    assert.equal(
        endpoint(base + '/v1/images/edits', '/v1/images/generations'),
        base + '/v1/images/generations'
    )
    assert.equal(
        endpoint(base + '/v1/images/edits', '/v1/models'),
        base + '/v1/models'
    )
    assert.equal(
        endpoint(
            base + '/v1beta/models/old:generateContent',
            '/v1beta/models/new:generateContent'
        ),
        base + '/v1beta/models/new:generateContent'
    )
})

test('model discovery handles authentication, full endpoints and pagination', async (t) => {
    const config = Config({}).llm
    config.baseUrl = base + '/v1/responses'
    config.apiKey = 'test-key'
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(String(url), base + '/v1/models')
        assert.equal(
            new Headers(init?.headers).get('Authorization'),
            'Bearer test-key'
        )
        return json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })
    })
    assert.deepEqual(await listModels(config), ['a', 'b'])
    t.mock.restoreAll()
    config.format = 'google'
    config.baseUrl = base + '/v1beta/models/old:generateContent'
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(
            new Headers(init?.headers).get('x-goog-api-key'),
            'test-key'
        )
        const parsed = new URL(String(url))
        assert.equal(parsed.pathname, '/v1beta/models')
        return parsed.searchParams.has('pageToken')
            ? json({ models: [{ name: 'models/image-b' }] })
            : json({
                  models: [{ name: 'models/text-a' }],
                  nextPageToken: 'next'
              })
    })
    assert.deepEqual(await listModels(config), ['image-b', 'text-a'])
})
