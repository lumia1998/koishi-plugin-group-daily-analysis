import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { get } from 'node:https'
import { ImageDownloadError } from './image-errors'

export const MAX_IMAGE = 20 * 1024 * 1024

// 图片最多跟随的重定向次数，每一跳都重新做安全校验。
const MAX_REDIRECTS = 5

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

// 解码响应中的 base64 或 image/* Data URI，并通过魔数校验。
export function decodeBase64Image(text: string): Buffer {
    const value = text.trim()
    if (!value) throw new Error('生图 API 没有返回图片。')
    const comma = value.indexOf(',')
    const encoded = value.startsWith('data:image/')
        ? value.slice(comma + 1)
        : value
    if (encoded.length > MAX_IMAGE * 1.4) throw new Error('图片超过大小限制。')
    const data = Buffer.from(encoded, 'base64')
    imageMime(data)
    return data
}

// 接口返回的图片地址不可信：只允许公网 HTTPS，且固定到已验证的 IP 连接。
export async function downloadImage(
    url: string,
    signal: AbortSignal
): Promise<Buffer> {
    let current = url
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        try {
            const parsed = new URL(current)
            if (
                parsed.protocol !== 'https:' ||
                parsed.username ||
                parsed.password ||
                isIP(parsed.hostname)
            )
                throw new ImageDownloadError('图片下载地址不受支持。', current)
            const addresses = await lookup(parsed.hostname, {
                all: true,
                family: 4
            })
            if (
                !addresses.length ||
                addresses.some(({ address }) => !isPublicIPv4(address))
            )
                throw new ImageDownloadError('不允许下载内网图片。', current)
            // Connect to the checked IP while retaining the original hostname for TLS.
            const result = await new Promise<
                | { type: 'redirect'; location: string }
                | { type: 'data'; data: Buffer }
            >((resolve, reject) => {
                const request = get(
                    parsed,
                    {
                        signal,
                        agent: false,
                        family: 4,
                        lookup: (_hostname, _options, callback) =>
                            callback(null, addresses[0].address, 4)
                    },
                    (response) => {
                        const status = response.statusCode ?? 0
                        if ([301, 302, 303, 307, 308].includes(status)) {
                            const location = response.headers.location
                            response.destroy()
                            if (location)
                                resolve({
                                    type: 'redirect',
                                    location: new URL(
                                        location,
                                        parsed
                                    ).toString()
                                })
                            else
                                reject(
                                    new ImageDownloadError(
                                        '生成成功，但图片下载失败。',
                                        current
                                    )
                                )
                            return
                        }
                        if (status !== 200) {
                            response.destroy()
                            reject(
                                new ImageDownloadError(
                                    '生成成功，但图片下载失败。',
                                    current
                                )
                            )
                            return
                        }
                        const chunks: Buffer[] = []
                        let length = 0
                        response.on('data', (chunk: Buffer) => {
                            length += chunk.length
                            if (length > MAX_IMAGE)
                                response.destroy(
                                    new ImageDownloadError(
                                        '图片超过 20MB。',
                                        current
                                    )
                                )
                            else chunks.push(chunk)
                        })
                        response.on('end', () =>
                            resolve({
                                type: 'data',
                                data: Buffer.concat(chunks)
                            })
                        )
                        response.on('error', reject)
                    }
                )
                request.on('error', reject)
            })
            if (result.type === 'data') {
                imageMime(result.data)
                return result.data
            }
            if (redirect >= MAX_REDIRECTS)
                throw new ImageDownloadError(
                    '生成成功，但图片下载失败。',
                    current
                )
            current = result.location
        } catch (error) {
            if (error instanceof ImageDownloadError) throw error
            const detail =
                error instanceof Error ? error.message : String(error)
            throw new ImageDownloadError(
                `生成成功，但图片下载失败。${detail}`,
                current
            )
        }
    }
    throw new ImageDownloadError('生成成功，但图片下载失败。', current)
}
