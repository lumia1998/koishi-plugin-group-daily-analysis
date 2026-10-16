import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Config } from '../src/config'
import { generateImage } from '../src/service/image'
import { apply } from '../src/plugins/comic'

// The provider returns a fixed valid PNG; these tests never call a paid model.
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwXnX3PwAFiAK6ob9qqgAAAABJRU5ErkJggg==',
    'base64'
)
const upstreamError =
    'Post "https://chatgpt.com/backend-api/codex/images/edits": EOF'

test('comic provider works over real local HTTP and does not retry failed edits', async (t) => {
    const requests: {
        path: string
        images: { field: string; name: string; data: Buffer }[]
    }[] = []
    let fail = false
    const server = createServer(async (request, response) => {
        try {
            assert.equal(request.method, 'POST')
            assert.equal(request.headers.authorization, 'Bearer local-test-key')
            const chunks: Buffer[] = []
            for await (const chunk of request) chunks.push(Buffer.from(chunk))
            const body = new Request('http://localhost' + request.url, {
                method: 'POST',
                headers: {
                    'Content-Type': request.headers['content-type'] || ''
                },
                body: new Uint8Array(Buffer.concat(chunks))
            })
            const images: (typeof requests)[number]['images'] = []
            if (request.url === '/v1/images/edits') {
                const form = await body.formData()
                assert.equal(form.get('model'), 'gpt-image-2.5-sunburst')
                assert.ok(String(form.get('prompt')).length > 0)
                assert.equal(form.get('size'), '1536x1024')
                for (const [field, value] of form) {
                    if (typeof value === 'string') continue
                    images.push({
                        field,
                        name: value.name,
                        data: Buffer.from(await value.arrayBuffer())
                    })
                }
                requests.push({ path: request.url, images })
                assert.ok(images.length > 0)
                assert.ok(
                    images.every(({ field }) => field === 'image'),
                    'all references must use repeated image fields in one request'
                )
            } else {
                assert.equal(request.url, '/v1/images/generations')
                const json = await body.json()
                assert.equal(json.model, 'gpt-image-2.5-sunburst')
                assert.equal(json.n, 1)
                assert.equal(json.size, '1536x1024')
                requests.push({ path: request.url!, images })
            }
            response.setHeader('Content-Type', 'application/json')
            if (fail) {
                response.writeHead(502)
                response.end(
                    JSON.stringify({ error: { message: upstreamError } })
                )
            } else {
                response.end(
                    JSON.stringify({
                        data: [{ b64_json: png.toString('base64') }]
                    })
                )
            }
        } catch (error) {
            response.writeHead(400, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify({ error: { message: String(error) } }))
        }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const config = Config({
        enableAllGroupsByDefault: true,
        minMessages: 1,
        comic: {
            enabled: true,
            format: 'openai',
            baseUrl,
            apiKey: 'local-test-key',
            model: 'gpt-image-2.5-sunburst',
            size: '1536x1024',
            timeout: 5
        }
    })

    await t.test(
        'single report reference uploads and decodes the returned PNG',
        async () => {
            assert.deepEqual(
                await generateImage(config.comic, 'test comic', png),
                png
            )
            const request = requests.at(-1)!
            assert.equal(request.path, '/v1/images/edits')
            assert.equal(request.images[0].field, 'image')
            assert.deepEqual(request.images[0].data, png)
        }
    )

    await t.test(
        'report and character references survive multipart serialization',
        async () => {
            const before = requests.length
            assert.deepEqual(
                await generateImage(config.comic, 'test comic', [png, png]),
                png
            )
            const images = requests.at(-1)!.images
            assert.equal(requests.length - before, 1)
            assert.deepEqual(
                images.map(({ name }) => name),
                ['reference-0.png', 'reference-1.png']
            )
            assert.deepEqual(
                images.map(({ data }) => data),
                [png, png]
            )
        }
    )

    await t.test(
        'generation without references uses JSON generations',
        async () => {
            assert.deepEqual(
                await generateImage(config.comic, 'test comic'),
                png
            )
            assert.equal(requests.at(-1)!.path, '/v1/images/generations')
        }
    )

    await t.test(
        '502 EOF is reported verbatim after exactly one edit request',
        async () => {
            fail = true
            const before = requests.length
            const events: {
                stage: string
                details: Record<string, unknown>
            }[] = []
            await assert.rejects(
                generateImage(
                    config.comic,
                    'test comic',
                    png,
                    undefined,
                    (stage, details = {}) => events.push({ stage, details })
                ),
                /HTTP 502.*backend-api\/codex\/images\/edits.*EOF/
            )
            assert.equal(requests.length - before, 1)
            const upload = events.find(
                (event) => event.stage === '图片编辑请求详情'
            )!
            assert.equal(upload.details.imageField, 'image')
            assert.equal(upload.details.referenceCount, 1)
            const attachment = events.find(
                (event) => event.stage === '图片编辑附件详情'
            )!
            assert.equal(attachment.details.dimensions, '1x1')
            const failure = events.find((event) => event.stage === '生图失败')!
            assert.match(String(failure.details.detail), /HTTP 502.*EOF/)
            assert.equal(failure.details.requestId, upload.details.requestId)
            assert.ok(!JSON.stringify(events).includes('local-test-key'))
            assert.ok(!JSON.stringify(events).includes(png.toString('base64')))
            fail = false
        }
    )

    await t.test(
        'group command sends the provider image and failure enters cooldown',
        async () => {
            const artifactDir = resolve('artifacts/comic-http')
            await mkdir(artifactDir, { recursive: true })
            config.comic.referenceImage = resolve(
                artifactDir,
                'character-reference.png'
            )
            await writeFile(config.comic.referenceImage, png)
            let action: Function
            const sent: any[] = []
            const ctx = {
                baseDir: process.cwd(),
                on() {},
                bots: [],
                command(name: string) {
                    return {
                        alias() {
                            return this
                        },
                        shortcut() {
                            return this
                        },
                        action(callback: Function) {
                            if (name.startsWith('群漫画')) action = callback
                        }
                    }
                },
                chatluna_group_analysis_message: {
                    async getHistoricalMessages() {
                        return [
                            {
                                userId: 'test-user',
                                username: 'Test user',
                                content: 'local fixture',
                                timestamp: new Date()
                            }
                        ]
                    }
                },
                chatluna_group_analysis_llm: {
                    async summarizeTopics() {
                        return [{ topic: 'test topic', detail: 'test detail' }]
                    }
                },
                chatluna_group_analysis_renderer: {
                    async renderGroupAnalysis() {
                        return png
                    }
                }
            }
            const session = {
                platform: 'onebot',
                selfId: 'test-bot',
                channelId: 'test-group',
                guildId: 'test-group',
                isDirect: false,
                async send(message: any) {
                    sent.push(message)
                    return [`local-${sent.length}`]
                }
            }
            apply(ctx as any, config)
            const before = requests.length
            assert.equal(await action!({ session }, 1), undefined)
            assert.equal(requests.length - before, 1)
            assert.equal(requests.at(-1)!.images.length, 2)
            assert.equal(sent[1].type, 'img')
            const output = Buffer.from(
                sent[1].attrs.src.split(',')[1],
                'base64'
            )
            assert.deepEqual(output, png)
            await writeFile(
                resolve(artifactDir, 'received-provider-image.png'),
                output
            )

            fail = true
            const failedSession = {
                ...session,
                channelId: 'failed-group',
                guildId: 'failed-group'
            }
            const beforeFailure = requests.length
            const failure = await action!({ session: failedSession }, 1)
            assert.equal(failure.type, 'text')
            assert.match(
                failure.attrs.content,
                /群漫画失败（调用生图 API）.*HTTP 502/
            )
            assert.match(
                failure.attrs.content,
                /backend-api\/codex\/images\/edits.*EOF/
            )
            assert.match(failure.attrs.content, /不会自动重复付费生图/)
            assert.match(await action!({ session: failedSession }, 1), /冷却/)
            assert.equal(requests.length - beforeFailure, 1)
            fail = false
            await writeFile(
                resolve(artifactDir, 'result.json'),
                JSON.stringify(
                    {
                        provider:
                            'local HTTP test double; fixed PNG, no AI model',
                        cases: 5,
                        requests: requests.map(({ path, images }) => ({
                            path,
                            imageCount: images.length,
                            fields: images.map(({ field }) => field)
                        })),
                        failureText: failure.attrs.content,
                        failureRequestCount: requests.length - beforeFailure
                    },
                    null,
                    2
                )
            )
        }
    )
})
