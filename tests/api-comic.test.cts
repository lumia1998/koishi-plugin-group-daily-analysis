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
import {
    buildStoryboardPrompt,
    buildComicImagePrompt
} from '../src/comic-prompts'

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

test('comic prompts inject persona and enforce reference identity without guessing appearance', () => {
    const config = Config({}).comic
    const topics = [{ topic: 'test', detail: 'details', contributors: [] }]
    let prompt = buildStoryboardPrompt(config, topics, true)
    assert.ok(prompt.includes('不得猜测'))
    assert.ok(prompt.includes('全部 1 个话题'))
    config.characterDescription = '灰发猫耳，草帽白裙，温柔俏皮'
    prompt = buildStoryboardPrompt(config, topics, true)
    assert.ok(prompt.includes(config.characterDescription))
    assert.ok(prompt.includes('每格都必须出现同一个主角'))
    const imagePrompt = buildComicImagePrompt(
        'a black-haired male protagonist',
        config,
        true
    )
    assert.ok(
        imagePrompt.includes('MUST be ignored in favor of the reference image')
    )
    assert.ok(imagePrompt.includes(config.characterDescription))
    assert.ok(
        !buildComicImagePrompt('scene', config, false).includes(
            'attached image'
        )
    )
})

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
    'base64'
)
const base = 'https://provider.example'
const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' }
    })

test('schema supplies nested API and disabled-comic defaults', () => {
    const config = Config({})
    assert.equal(config.llm.protocol, 'openai-responses')
    assert.equal(config.llm.timeout, 120)
    assert.equal(config.comic.enabled, false)
    assert.equal(config.comic.maxTopics, 3)
    assert.equal(config.debug, false)
    assert.equal(config.chatQualityAnalysis, true)
    assert.deepEqual(config.cronOutputFormats, [])
    assert.equal(config.incrementalEnabled, false)
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

test('all text protocols send and extract their native wire formats', async (t) => {
    const config = Config({}).llm
    config.baseUrl = base
    config.apiKey = 'test-key'
    const cases = [
        [
            'openai-responses',
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
            'anthropic-messages',
            '/v1/messages',
            {
                content: [
                    { type: 'thinking', thinking: 'hidden' },
                    { type: 'text', text: 'hello' }
                ]
            }
        ],
        [
            'google-v1beta',
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
        ],
        [
            'openai-chat',
            '/v1/chat/completions',
            {
                choices: [
                    { finish_reason: 'stop', message: { content: 'hello' } }
                ]
            }
        ]
    ] as const
    for (const [protocol, path, response] of cases) {
        config.protocol = protocol
        const request = textRequest(config, 'model', 'prompt', 1)
        assert.equal(request.url, base + path)
        t.mock.method(globalThis, 'fetch', async (_url, init) => {
            const headers = new Headers(init?.headers)
            if (
                protocol === 'anthropic-messages' ||
                protocol === 'google-v1beta'
            )
                assert.equal(headers.has('Authorization'), false)
            else assert.equal(headers.get('Authorization'), 'Bearer test-key')
            const body = JSON.parse(init!.body as string)
            if (protocol === 'openai-responses') {
                assert.equal(body.input, 'prompt')
                assert.equal(body.store, false)
            }
            if (protocol === 'anthropic-messages') {
                assert.equal(body.max_tokens, 32768)
                assert.equal(headers.get('x-api-key'), 'test-key')
            }
            if (protocol === 'google-v1beta')
                assert.equal(body.contents[0].parts[0].text, 'prompt')
            return json(response)
        })
        assert.equal(
            extractText(
                protocol,
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
    assert.throws(() =>
        extractText('openai-responses', { status: 'incomplete' })
    )
    assert.throws(() =>
        extractText('anthropic-messages', { stop_reason: 'max_tokens' })
    )
    assert.throws(() =>
        extractText('google-v1beta', {
            candidates: [{ finishReason: 'SAFETY' }]
        })
    )
    assert.throws(() =>
        extractText('openai-chat', { choices: [{ finish_reason: 'length' }] })
    )
    assert.throws(() =>
        extractText('openai-responses', {
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
        if (config.protocol === 'google-v1beta') {
            const body = JSON.parse(init!.body as string)
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
        assert.deepEqual(
            Buffer.from(await (form.get('image') as Blob).arrayBuffer()),
            png
        )
        return json({ data: [{ b64_json: png.toString('base64') }] })
    })
    assert.deepEqual(await generateImage(config, 'storyboard', png), png)
    config.protocol = 'openai-images'
    assert.deepEqual(await generateImage(config, 'storyboard', png), png)
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

test('comic pipeline passes topics to storyboard, enforces cooldown and group guards', async (t) => {
    const config = Config({
        enableAllGroupsByDefault: true,
        comic: { enabled: true, baseUrl: base, model: 'image-model' }
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
            },
            async generateText(prompt: string) {
                assert.ok(prompt.includes('topic details'))
                return 'storyboard'
            }
        }
    }
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
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
                            { inlineData: { data: png.toString('base64') } }
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
    config.protocol = 'google-v1beta'
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
