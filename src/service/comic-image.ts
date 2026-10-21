import { Config } from '../config'
import { Trace } from '../diagnostics'
import { ImageDownloadError } from './image-errors'
import { generateImage } from './image'

export class ComicImageError extends Error {
    constructor(
        message: string,
        readonly attempts: number
    ) {
        super(message)
        this.name = 'ComicImageError'
    }
}

const NETWORK_HTTP = /^API 请求失败（HTTP (?:408|409|429|5\d\d)）/
const NETWORK_MESSAGE =
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i
const TIMEOUT_MESSAGE = 'API 请求超时或已取消。'
const NETWORK_RETRIES = 2
const RETRY_DELAY_SECONDS = 2
// 接口原样返回参考图视为无效生成，不重试。
const ECHOED_REFERENCE = '生图接口原样返回了参考图，已拒绝发送。'

function isNetworkError(message: string): boolean {
    if (
        message.includes(TIMEOUT_MESSAGE) ||
        /timeout|timed out|ETIMEDOUT|aborted/i.test(message)
    )
        return false
    if (message.startsWith('API 请求失败（HTTP '))
        return NETWORK_HTTP.test(message)
    return NETWORK_MESSAGE.test(message)
}

// 等待重试间隔，期间可被父信号中断。
function waitSeconds(seconds: number, signal?: AbortSignal): Promise<void> {
    if (seconds <= 0) {
        if (signal?.aborted) return Promise.reject(new Error(TIMEOUT_MESSAGE))
        return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
        let settled = false
        const finish = (action: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            action()
        }
        const timer = setTimeout(
            () =>
                finish(() =>
                    signal?.aborted
                        ? reject(new Error(TIMEOUT_MESSAGE))
                        : resolve()
                ),
            seconds * 1000
        )
        const onAbort = () => finish(() => reject(new Error(TIMEOUT_MESSAGE)))
        if (signal?.aborted) {
            finish(() => reject(new Error(TIMEOUT_MESSAGE)))
            return
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error(TIMEOUT_MESSAGE)
}

export async function generateComicImage(
    config: Config['comic'],
    prompt: string,
    reference: Buffer | Buffer[] | undefined,
    options: {
        signal?: AbortSignal
        trace?: Trace
        aspectRatio?: string
        referenceRoles?: string[]
    } = {}
): Promise<Buffer> {
    const { signal, trace } = options
    const references = reference
        ? Array.isArray(reference)
            ? reference
            : [reference]
        : []
    for (let attempt = 0; ; attempt++) {
        throwIfAborted(signal)
        const attempts = attempt + 1
        trace?.('接口尝试', {
            format: config.format,
            attempts,
            reason: 'request'
        })
        try {
            const image = await generateImage(
                config,
                prompt,
                references,
                signal,
                trace,
                {
                    aspectRatio: options.aspectRatio,
                    referenceRoles: options.referenceRoles
                }
            )
            if (references.some((item) => item.equals(image)))
                throw new Error(ECHOED_REFERENCE)
            return image
        } catch (error) {
            const failure =
                error instanceof Error ? error : new Error(String(error))
            // 已生图但下载失败时不重复生成；超时、内容错误也直接结束。
            if (
                signal?.aborted ||
                failure instanceof ImageDownloadError ||
                attempt >= NETWORK_RETRIES ||
                !isNetworkError(failure.message)
            )
                throw new ComicImageError(failure.message, attempts)
            const delay = RETRY_DELAY_SECONDS * Math.pow(2, attempt)
            trace?.('接口重试', {
                kind: 'network',
                attempts,
                delaySeconds: delay
            })
            await waitSeconds(delay, signal)
        }
    }
}
