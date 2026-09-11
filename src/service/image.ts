/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { get } from 'node:https'
import { Config } from '../config'
import { endpoint, readJson, requestJson } from './api'
import { errorKind, Trace } from '../diagnostics'

const MAX_IMAGE = 20 * 1024 * 1024

// Be conservative: downloads need a public IPv4 address, not local/special ranges.
export function isPublicIPv4(address: string): boolean {
    if (isIP(address) !== 4) return false
    const [a, b, c] = address.split('.').map(Number)
    return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 &&
            (b === 168 ||
                (b === 0 && (c === 0 || c === 2)) ||
                (b === 88 && c === 99))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113)
    )
}

export function imageMime(data: Buffer): string {
    if (data.length > MAX_IMAGE) throw new Error('图片超过 20MB 限制。')
    if (
        data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
        return 'image/png'
    if (data[0] === 255 && data[1] === 216 && data[2] === 255)
        return 'image/jpeg'
    if (
        data.toString('ascii', 0, 4) === 'RIFF' &&
        data.toString('ascii', 8, 12) === 'WEBP'
    )
        return 'image/webp'
    throw new Error('图片必须是有效的 PNG、JPEG 或 WebP 文件。')
}

export async function loadReference(
    path: string,
    baseDir: string
): Promise<Buffer | undefined> {
    if (!path?.trim()) return undefined
    const absolute = resolve(baseDir, path)
    if ((await stat(absolute)).size > MAX_IMAGE)
        throw new Error('三视图超过 20MB。')
    const data = await readFile(absolute)
    imageMime(data)
    return data
}

export async function loadReferences(
    paths: string[] | undefined,
    baseDir: string
): Promise<Buffer[]> {
    const loaded: Buffer[] = []
    for (const file of paths || []) {
        const data = await loadReference(file, baseDir)
        if (data) loaded.push(data)
    }
    return loaded
}

async function decodeImage(item: any, signal: AbortSignal): Promise<Buffer> {
    if (typeof item?.b64_json === 'string') {
        if (item.b64_json.length > MAX_IMAGE * 1.4)
            throw new Error('图片超过大小限制。')
        const data = Buffer.from(item.b64_json, 'base64')
        imageMime(data)
        return data
    }
    if (typeof item?.url !== 'string')
        throw new Error('生图 API 没有返回图片。')
    const url = new URL(item.url)
    // Provider-returned URLs are untrusted; allow public HTTPS only.
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        isIP(url.hostname)
    )
        throw new Error('图片下载地址不受支持。')
    const addresses = await lookup(url.hostname, { all: true, family: 4 })
    if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicIPv4(address))
    )
        throw new Error('不允许下载内网图片。')
    // Connect to the checked IP while retaining the original hostname for TLS.
    const data = await new Promise<Buffer>((resolve, reject) => {
        const request = get(
            url,
            {
                signal,
                agent: false,
                family: 4,
                lookup: (_hostname, _options, callback) =>
                    callback(null, addresses[0].address, 4)
            },
            (response) => {
                if (response.statusCode !== 200) {
                    response.destroy()
                    reject(new Error('生成成功，但图片下载失败。'))
                    return
                }
                const chunks: Buffer[] = []
                let length = 0
                response.on('data', (chunk: Buffer) => {
                    length += chunk.length
                    if (length > MAX_IMAGE)
                        response.destroy(new Error('图片超过 20MB。'))
                    else chunks.push(chunk)
                })
                response.on('end', () => resolve(Buffer.concat(chunks)))
                response.on('error', reject)
            }
        )
        request.on('error', reject)
    })
    imageMime(data)
    return data
}

export async function generateImage(
    config: Config['comic'],
    prompt: string,
    reference?: Buffer | Buffer[],
    parentSignal?: AbortSignal,
    trace?: Trace
): Promise<Buffer> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (parentSignal?.aborted) abort()
    parentSignal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, config.timeout * 1000)
    const started = Date.now()
    trace?.('生图请求开始', {
        protocol: config.protocol,
        model: config.model,
        referenceBytes: Array.isArray(reference)
            ? reference.reduce((sum, item) => sum + item.length, 0)
            : (reference?.length ?? 0),
        promptChars: prompt.length,
        timeoutSeconds: config.timeout
    })
    try {
        let item: any
        const references = reference
            ? Array.isArray(reference)
                ? reference
                : [reference]
            : []
        if (config.protocol === 'google-v1beta') {
            const parts: any[] = [{ text: prompt }]
            for (const item of references)
                parts.push({
                    inlineData: {
                        mimeType: imageMime(item),
                        data: item.toString('base64')
                    }
                })
            const data = await requestJson(
                endpoint(
                    config.baseUrl,
                    `/v1beta/models/${encodeURIComponent(config.model)}:generateContent`
                ),
                config.apiKey,
                {
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        responseModalities: ['TEXT', 'IMAGE'],
                        imageConfig: { aspectRatio: '16:9' }
                    }
                },
                config.timeout,
                { 'x-goog-api-key': config.apiKey },
                controller.signal,
                trace
            )
            const image = data.candidates?.[0]?.content?.parts?.find(
                (part: any) => part.inlineData?.data || part.inline_data?.data
            )
            item = {
                b64_json: image?.inlineData?.data ?? image?.inline_data?.data
            }
        } else if (config.protocol === 'openai-images') {
            if (references.length) {
                const url = endpoint(
                    config.baseUrl.replace(
                        /\/images\/generations\/?$/,
                        '/images/edits'
                    ),
                    '/v1/images/edits'
                )
                const body = new FormData()
                body.append('model', config.model)
                body.append('prompt', prompt)
                body.append('size', config.size)
                references.forEach((item, index) =>
                    body.append(
                        'image',
                        new Blob([new Uint8Array(item)], {
                            type: imageMime(item)
                        }),
                        `reference-${index}.${imageMime(item).split('/')[1]}`
                    )
                )
                const response = await fetch(url, {
                    method: 'POST',
                    body,
                    signal: controller.signal,
                    redirect: 'error',
                    headers: { Authorization: `Bearer ${config.apiKey}` }
                })
                trace?.('图片编辑 HTTP 响应', {
                    status: response.status,
                    elapsedMs: Date.now() - started
                })
                item = (await readJson(response)).data?.[0]
            } else {
                const data = await requestJson(
                    endpoint(config.baseUrl, '/v1/images/generations'),
                    config.apiKey,
                    { model: config.model, prompt, size: config.size, n: 1 },
                    config.timeout,
                    {},
                    controller.signal,
                    trace
                )
                item = data.data?.[0]
            }
        } else throw new Error('不支持的生图协议。')
        trace?.('读取图片', {
            source: typeof item?.b64_json === 'string' ? 'base64' : 'url'
        })
        const image = await decodeImage(item, controller.signal)
        trace?.('生图完成', {
            bytes: image.length,
            elapsedMs: Date.now() - started
        })
        return image
    } catch (error) {
        trace?.('生图失败', {
            reason: controller.signal.aborted
                ? 'TimeoutOrCancelled'
                : errorKind(error),
            elapsedMs: Date.now() - started
        })
        throw error
    } finally {
        clearTimeout(timer)
        parentSignal?.removeEventListener('abort', abort)
    }
}
