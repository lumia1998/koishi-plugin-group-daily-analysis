import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import { generateImage } from '../src/service/image'
import { ImageDownloadError } from '../src/service/image-errors'
import { ComicImageError, generateComicImage } from '../src/service/comic-image'

// 测试用固定 1x1 PNG；所有用例都通过 mock fetch，不访问真实服务。
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwXnX3PwAFiAK6ob9qqgAAAABJRU5ErkJggg==',
    'base64'
)
const png2 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
    'base64'
)
const base = 'https://provider.example'
const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' }
    })
const googleImage = (image: Buffer) =>
    json({
        candidates: [
            {
                content: {
                    parts: [{ inlineData: { data: image.toString('base64') } }]
                }
            }
        ]
    })

const comicConfig = (
    format: 'openai' | 'google' = 'google',
    overrides: Record<string, unknown> = {}
) =>
    Config({
        comic: {
            enabled: true,
            generationMode: 'direct',
            format,
            baseUrl: base,
            apiKey: 'provider-key',
            model: 'image-model',
            aspectRatio: '16:9',
            timeout: 5,
            ...overrides
        }
    }).comic

test('orchestration: default config sends a single request on 502', async (t) => {
    const config = comicConfig('google')
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        return json({ error: { message: 'bad gateway' } }, 502)
    })
    await assert.rejects(
        generateComicImage(config, 'p', png),
        (error: ComicImageError) =>
            error instanceof ComicImageError &&
            error.attempts === 1 &&
            /HTTP 502/.test(error.message)
    )
    assert.equal(calls, 1)
})

test('orchestration: networkRetries resends on 502 and 429 but not on 400', async (t) => {
    const config = comicConfig('google', {
        networkRetries: 2,
        retryDelaySeconds: 0
    })
    let calls = 0
    let status = 502
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        return json({ error: { message: 'upstream' } }, status)
    })
    await assert.rejects(
        generateComicImage(config, 'p'),
        (error: ComicImageError) => error.attempts === 3
    )
    assert.equal(calls, 3)
    calls = 0
    status = 400
    await assert.rejects(
        generateComicImage(config, 'p'),
        (error: ComicImageError) => error.attempts === 1
    )
    assert.equal(calls, 1)
    calls = 0
    status = 429
    await assert.rejects(
        generateComicImage(config, 'p'),
        (error: ComicImageError) => error.attempts === 3
    )
    assert.equal(calls, 3)
})

test('orchestration: content keywords retry within the provider cap', async (t) => {
    const config = comicConfig('google', {
        contentRetryKeywords: ['content_policy'],
        contentRetries: 1,
        retryDelaySeconds: 0
    })
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        return json({ error: { message: 'rejected by content_policy' } }, 400)
    })
    const error = await generateComicImage(config, 'p').then(
        () => undefined,
        (failure: unknown) => failure as ComicImageError
    )
    assert.equal(error.attempts, 2)
    assert.equal(error.contentRejected, true)
    assert.equal(calls, 2)
})

test('orchestration: fallback providers run in order after the primary fails', async (t) => {
    const config = comicConfig('google', {
        retryDelaySeconds: 0,
        fallbackProviders: [
            {
                enabled: true,
                format: 'google',
                baseUrl: 'https://backup.example',
                apiKey: 'backup-key',
                model: 'backup-model'
            },
            {
                enabled: false,
                format: 'google',
                baseUrl: 'https://disabled.example',
                apiKey: 'x',
                model: 'x'
            }
        ]
    })
    const urls: string[] = []
    t.mock.method(globalThis, 'fetch', async (url: any) => {
        urls.push(String(url))
        if (String(url).includes('backup')) return googleImage(png2)
        return json({ error: { message: 'primary failed' } }, 500)
    })
    assert.deepEqual(await generateComicImage(config, 'p', png), png2)
    assert.deepEqual(urls, [
        base + '/v1beta/models/image-model:generateContent',
        'https://backup.example/v1beta/models/backup-model:generateContent'
    ])
})

test('orchestration: echoed reference image is rejected per provider', async (t) => {
    const config = comicConfig('google', {
        networkRetries: 3,
        retryDelaySeconds: 0,
        fallbackProviders: [
            {
                enabled: true,
                format: 'google',
                baseUrl: 'https://backup.example',
                apiKey: 'backup-key',
                model: 'backup-model'
            }
        ]
    })
    const urls: string[] = []
    t.mock.method(globalThis, 'fetch', async (url: any) => {
        urls.push(String(url))
        return googleImage(String(url).includes('backup') ? png2 : png)
    })
    assert.deepEqual(await generateComicImage(config, 'p', png), png2)
    assert.equal(urls.length, 2)
})

test('orchestration: rewrite runs once only when enabled and content-final', async (t) => {
    const rewrites: string[] = []
    const rewrite = async (prompt: string, lastError: string) => {
        rewrites.push(`${prompt}|${lastError.slice(0, 40)}`)
        return 'rewritten prompt'
    }
    let calls = 0
    t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
        calls++
        const body = JSON.parse(init.body)
        const text = body.contents[0].parts[0].text
        if (text.startsWith('rewritten')) return googleImage(png2)
        return json({ error: { message: 'flagged sensitive' } }, 400)
    })
    const config = comicConfig('google', {
        contentRetryKeywords: ['sensitive'],
        promptRewrite: true,
        retryDelaySeconds: 0
    })
    assert.deepEqual(
        await generateComicImage(config, 'p', undefined, { rewrite }),
        png2
    )
    assert.equal(rewrites.length, 1)
    assert.equal(calls, 2)
    // 改写未启用或无内容终局时不调用回调。
    const disabled = comicConfig('google', {
        contentRetryKeywords: ['sensitive'],
        retryDelaySeconds: 0
    })
    await assert.rejects(
        generateComicImage(disabled, 'p', undefined, { rewrite })
    )
    assert.equal(rewrites.length, 1)
    const noCallback = comicConfig('google', {
        contentRetryKeywords: ['sensitive'],
        promptRewrite: true,
        retryDelaySeconds: 0
    })
    await assert.rejects(generateComicImage(noCallback, 'p'))
    assert.equal(rewrites.length, 1)
    // 非内容终局（400 无关键词命中）不改写。
    const other = comicConfig('google', {
        promptRewrite: true,
        retryDelaySeconds: 0
    })
    await assert.rejects(generateComicImage(other, 'p', undefined, { rewrite }))
    assert.equal(rewrites.length, 1)
})

test('orchestration: download failures keep the last URL and do not retry', async (t) => {
    const config = comicConfig('openai', {
        networkRetries: 2,
        retryDelaySeconds: 0
    })
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        return json({ data: [{ url: 'http://127.0.0.1/a.png' }] })
    })
    const error = await generateComicImage(config, 'p').then(
        () => undefined,
        (failure: unknown) => failure as ComicImageError
    )
    assert.equal(calls, 1)
    assert.equal(error.fallbackUrl, 'http://127.0.0.1/a.png')
    assert.equal(error.attempts, 1)
    assert.ok(!error.contentRejected)
    assert.match(error.message, /图片下载地址不受支持|没有返回图片/)
})

test('orchestration: aborted signal stops before the next request', async (t) => {
    const config = comicConfig('google', {
        networkRetries: 5,
        retryDelaySeconds: 30,
        fallbackProviders: [
            {
                enabled: true,
                format: 'google',
                baseUrl: 'https://backup.example',
                apiKey: 'k',
                model: 'm'
            }
        ]
    })
    let calls = 0
    const controller = new AbortController()
    t.mock.method(globalThis, 'fetch', async () => {
        calls++
        controller.abort()
        return json({ error: { message: 'fail' } }, 500)
    })
    await assert.rejects(
        generateComicImage(config, 'p', undefined, {
            signal: controller.signal
        }),
        /已取消|超时/
    )
    assert.equal(calls, 1)
})

test('generateImage keeps the openai/google guard', async () => {
    const config = comicConfig('google')
    ;(config as any).format = 'openai-chat'
    await assert.rejects(generateImage(config, 'p'), /不支持的生图格式/)
})

test('ImageDownloadError carries the failing url', () => {
    const error = new ImageDownloadError('boom', 'https://x.example/a.png')
    assert.equal(error.name, 'ImageDownloadError')
    assert.equal(error.url, 'https://x.example/a.png')
})
