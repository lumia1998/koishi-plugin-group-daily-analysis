import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Config } from '../src/config'
import { apply } from '../src/plugins/comic'

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
    'base64'
)
// 生图响应必须返回与任何参考图都不同的图片，否则会被回显校验拒绝。
const generated = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=',
    'base64'
)
const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' }
    })
const imageResponse = () =>
    json({
        candidates: [
            {
                content: {
                    parts: [
                        {
                            inlineData: {
                                data: generated.toString('base64')
                            }
                        }
                    ]
                }
            }
        ]
    })

function createContext(
    baseDir: string,
    options: {
        llm?: Record<string, unknown>
        renderer?: Record<string, unknown>
    } = {}
) {
    const state = { action: undefined as Function | undefined }
    const ctx: Record<string, unknown> = {
        baseDir,
        logger: { info() {}, warn() {}, error() {} },
        on() {},
        bots: [],
        command(name: string) {
            const chain: Record<string, Function> = {
                alias() {
                    return chain
                },
                shortcut() {
                    return chain
                },
                action(callback: Function) {
                    if (name.startsWith('群漫画')) state.action = callback
                    return chain
                }
            }
            return chain
        },
        chatluna_group_analysis_message: {
            async getHistoricalMessages() {
                return [
                    {
                        userId: 'test-user',
                        username: 'Test user',
                        content: 'fixture message',
                        timestamp: new Date()
                    }
                ]
            }
        },
        chatluna_group_analysis_llm: {
            async summarizeTopics() {
                return [{ topic: 'test topic', detail: 'test detail' }]
            },
            ...options.llm
        },
        chatluna_group_analysis_renderer: {
            async renderGroupAnalysis() {
                return png
            },
            ...options.renderer
        },
        chatluna_group_analysis: {
            async getUserPersona() {
                return {
                    username: 'persona-user',
                    profile: {
                        summary: 'summary',
                        keyTraits: ['trait'],
                        interests: ['interest'],
                        communicationStyle: 'style'
                    }
                }
            }
        }
    }
    return { ctx, getAction: () => state.action! }
}

function createSession(sent: unknown[], overrides: Record<string, unknown> = {}) {
    return {
        platform: 'onebot',
        selfId: 'test-bot',
        channelId: 'test-group',
        guildId: 'test-group',
        isDirect: false,
        async send(message: unknown) {
            sent.push(message)
            return [`receipt-${sent.length}`]
        },
        ...overrides
    }
}

async function tempBaseDir(t: import('node:test').TestContext) {
    const baseDir = await mkdtemp(path.join(tmpdir(), 'comic-migration-'))
    t.after(() => rm(baseDir, { recursive: true, force: true }))
    const referenceImage = path.join(baseDir, 'reference.png')
    await writeFile(referenceImage, png)
    return { baseDir, referenceImage }
}

const comicBase = {
    enabled: true,
    generationMode: 'direct' as const,
    format: 'google' as const,
    baseUrl: 'https://main.example',
    apiKey: 'key',
    model: 'chat-image',
    timeout: 5,
    cooldown: 0
}

test('storyboard is the default and only openai/google formats remain', () => {
    const config = Config({})
    assert.equal(config.comic.generationMode, 'storyboard')
    assert.equal(config.comic.format, 'google')
    assert.equal((config.comic as any).imageSize, undefined)
    for (const removed of ['openai-chat', 'xai', 'doubao', 'dashscope'])
        assert.ok(!JSON.stringify(Config).includes(removed), removed)
})

test('storyboard mode skips the report render and sends only character references', async (t) => {
    const { baseDir, referenceImage } = await tempBaseDir(t)
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        debug: true,
        comic: {
            ...comicBase,
            generationMode: 'storyboard',
            referenceImage,
            characterProfiles: [
                {
                    profileName: 'host',
                    enabled: true,
                    persona: '一只毒舌猫娘主持人',
                    referenceFiles: []
                }
            ]
        }
    })
    const sent: unknown[] = []
    const logs: string[] = []
    const storyboards: { topics: unknown; persona?: string }[] = []
    let storyboardCalls = 0
    const { ctx, getAction } = createContext(baseDir, {
        llm: {
            async generateComicStoryboard(
                topics: unknown,
                persona?: string,
                signal?: AbortSignal
            ) {
                storyboardCalls++
                storyboards.push({ topics, persona })
                assert.ok(!signal?.aborted)
                return 'Panel 1: a host explains topic with bubble text "好"'
            }
        },
        renderer: {
            async renderGroupAnalysis() {
                throw new Error(
                    'storyboard mode must not render the group report'
                )
            }
        }
    })
    ;(ctx.logger as { info: (m: string) => void }).info = (message) =>
        logs.push(message)
    const bodies: Record<string, unknown>[] = []
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: unknown) => {
        bodies.push(
            JSON.parse((init as { body: string }).body) as Record<
                string,
                unknown
            >
        )
        return imageResponse()
    })
    apply(ctx as never, config)
    const result = await getAction()(
        { session: createSession(sent) },
        undefined
    )
    assert.equal(result, undefined)
    assert.equal(storyboardCalls, 1)
    assert.equal(storyboards[0].persona, '一只毒舌猫娘主持人')
    assert.equal(bodies.length, 1)
    const parts = (
        bodies[0].contents as {
            parts: { text?: string; inlineData?: { data: string } }[]
        }[]
    )[0].parts
    const images = parts.filter((item) => item.inlineData)
    assert.equal(images.length, 1)
    assert.equal(images[0].inlineData!.data, png.toString('base64'))
    assert.match(parts[0].text!, /Panel 1/)
    const image = sent.find(
        (item) => (item as { type?: string }).type === 'img'
    ) as { attrs: { src: string } }
    assert.ok(image)
    assert.match(logs.join('\n'), /"mode":"storyboard"/)
})

test('direct mode keeps the report image first and never calls the storyboard LLM', async (t) => {
    const { baseDir, referenceImage } = await tempBaseDir(t)
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        debug: true,
        comic: { ...comicBase, referenceImage }
    })
    const sent: unknown[] = []
    const logs: string[] = []
    let storyboardCalls = 0
    const { ctx, getAction } = createContext(baseDir, {
        llm: {
            async generateComicStoryboard() {
                storyboardCalls++
                return 'should not run'
            }
        }
    })
    ;(ctx.logger as { info: (m: string) => void }).info = (message) =>
        logs.push(message)
    const bodies: Record<string, unknown>[] = []
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: unknown) => {
        bodies.push(
            JSON.parse((init as { body: string }).body) as Record<
                string,
                unknown
            >
        )
        return imageResponse()
    })
    apply(ctx as never, config)
    const result = await getAction()(
        { session: createSession(sent) },
        undefined
    )
    assert.equal(result, undefined)
    assert.equal(storyboardCalls, 0)
    const parts = (
        bodies[0].contents as {
            parts: { text?: string; inlineData?: { data: string } }[]
        }[]
    )[0].parts
    assert.equal(parts.filter((item) => item.inlineData).length, 2)
    assert.match(parts[0].text!, /附件 1 是完整的群分析报告图片/)
    assert.ok(sent.some((item) => (item as { type?: string }).type === 'img'))
    assert.match(logs.join('\n'), /"mode":"direct"/)
})

test('fallback providers run in order after the primary fails', async (t) => {
    const { baseDir } = await tempBaseDir(t)
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        comic: {
            ...comicBase,
            fallbackProviders: [
                {
                    enabled: true,
                    format: 'google',
                    baseUrl: 'https://backup.example',
                    apiKey: 'backup-key',
                    model: 'backup-model'
                }
            ]
        }
    })
    const sent: unknown[] = []
    const { ctx, getAction } = createContext(baseDir)
    const urls: string[] = []
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
        urls.push(String(url))
        if (urls.length === 1)
            return json({ error: { message: 'primary down' } }, 503)
        return imageResponse()
    })
    apply(ctx as never, config)
    const result = await getAction()(
        { session: createSession(sent) },
        undefined
    )
    assert.equal(result, undefined)
    assert.equal(urls.length, 2)
    assert.match(urls[1], /^https:\/\/backup\.example\//)
    assert.ok(sent.some((item) => (item as { type?: string }).type === 'img'))
})

test('network retries exhaust and report the configured attempt count', async (t) => {
    const { baseDir } = await tempBaseDir(t)
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        comic: {
            ...comicBase,
            networkRetries: 1,
            retryDelaySeconds: 0
        }
    })
    const sent: unknown[] = []
    const { ctx, getAction } = createContext(baseDir)
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        return json({ error: { message: 'overloaded' } }, 503)
    })
    apply(ctx as never, config)
    const failure = await getAction()(
        { session: createSession(sent) },
        undefined
    )
    assert.equal(calls, 2)
    assert.equal((failure as { type: string }).type, 'text')
    assert.match(
        (failure as { attrs: { content: string } }).attrs.content,
        /已按配置尝试 2 次生图请求，不会再自动重试。/
    )
})

test('download failure falls back to sending the returned image URL', async (t) => {
    const { baseDir } = await tempBaseDir(t)
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        comic: {
            ...comicBase,
            format: 'openai',
            fallbackToUrl: true
        }
    })
    const sent: unknown[] = []
    const { ctx, getAction } = createContext(baseDir)
    t.mock.method(globalThis, 'fetch', async () =>
        json({ data: [{ url: 'http://127.0.0.1/a.png' }] })
    )
    apply(ctx as never, config)
    const result = await getAction()(
        { session: createSession(sent) },
        undefined
    )
    assert.equal(result, undefined)
    const image = sent.at(-1) as { type: string; attrs: { src: string } }
    assert.equal(image.type, 'img')
    assert.equal(image.attrs.src, 'http://127.0.0.1/a.png')
})

test('single-attempt failures keep the no-repeat billing message', async (t) => {
    const { baseDir } = await tempBaseDir(t)
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        comic: comicBase
    })
    const { ctx, getAction } = createContext(baseDir)
    t.mock.method(
        globalThis,
        'fetch',
        async () => json({ error: { message: 'bad request' } }, 400)
    )
    apply(ctx as never, config)
    const failure = await getAction()(
        { session: createSession([]) },
        undefined
    )
    assert.match(
        (failure as { attrs: { content: string } }).attrs.content,
        /不会自动重复付费生图。/
    )
    assert.doesNotMatch(
        (failure as { attrs: { content: string } }).attrs.content,
        /已按配置尝试/
    )
})

test('user persona comics stay on the direct flow under storyboard mode', async (t) => {
    const { baseDir } = await tempBaseDir(t)
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        comic: {
            ...comicBase,
            generationMode: 'storyboard',
            userEnabled: true
        }
    })
    const sent: unknown[] = []
    const calls: string[] = []
    // 捕获两个命令的 action；用户画像.漫画命令内部以 profile 调用 run()。
    const state: Record<string, Function> = {}
    const { ctx } = createContext(baseDir, {
        llm: {
            async generateComicStoryboard() {
                calls.push('storyboard')
                return 'should not run for persona comics'
            }
        },
        renderer: {
            async renderUserPersonaReferenceImage() {
                calls.push('persona-render')
                return png
            }
        }
    })
    const original = ctx.command as (
        name: string,
        ...rest: unknown[]
    ) => { action: (fn: Function) => unknown }
    ctx.command = (name: string, ...rest: unknown[]) => {
        const chain = original(name, ...rest)
        const wrapped = chain.action.bind(chain)
        chain.action = (fn: Function) => {
            state[name.split(' ')[0]] = fn
            return wrapped(fn)
        }
        return chain
    }
    const bodies: Record<string, unknown>[] = []
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: unknown) => {
        bodies.push(
            JSON.parse((init as { body: string }).body) as Record<
                string,
                unknown
            >
        )
        return imageResponse()
    })
    apply(ctx as never, config)
    const session = createSession(sent, { userId: 'test-user' })
    const result = await state['用户画像.漫画']!({ session })
    assert.equal(result, undefined)
    assert.deepEqual(calls, ['persona-render'])
    const parts = (
        bodies.at(-1)!.contents as { parts: { text?: string }[] }[]
    )[0].parts
    assert.match(parts[0].text!, /四维人物观察报告/)
    assert.doesNotMatch(parts[0].text!, /分格|Panel/)
    assert.ok(sent.some((item) => (item as { type?: string }).type === 'img'))
})
