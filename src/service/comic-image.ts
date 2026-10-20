import { ComicImageFormat, Config } from '../config'
import { Trace } from '../diagnostics'
import { ImageDownloadError } from './image-errors'
import { generateImage } from './image'

export class ComicImageError extends Error {
    constructor(
        message: string,
        readonly attempts: number,
        readonly fallbackUrl?: string,
        readonly contentRejected?: boolean
    ) {
        super(message)
        this.name = 'ComicImageError'
    }
}

interface ProviderEntry {
    format: ComicImageFormat
    baseUrl: string
    apiKey: string
    model: string
}

const NETWORK_HTTP = /^API 请求失败（HTTP (?:408|409|429|5\d\d)）/
const NETWORK_MESSAGE =
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i
const TIMEOUT_MESSAGE = 'API 请求超时或已取消。'
// 接口原样返回参考图视为无效生成，直接换接口不再重试。
const ECHOED_REFERENCE = '生图接口原样返回了参考图，已拒绝发送。'

function isNetworkError(message: string): boolean {
    if (message === TIMEOUT_MESSAGE || message.includes(TIMEOUT_MESSAGE))
        return false
    return NETWORK_HTTP.test(message) || NETWORK_MESSAGE.test(message)
}

function isContentError(message: string, keywords: string[]): boolean {
    const lower = message.toLowerCase()
    return keywords.some(
        (keyword) => keyword.trim() && lower.includes(keyword.toLowerCase())
    )
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
        rewrite?: (
            prompt: string,
            lastError: string
        ) => Promise<string | undefined>
    } = {}
): Promise<Buffer> {
    const { signal, trace } = options
    const providers: ProviderEntry[] = [
        {
            format: config.format,
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model
        },
        ...(config.fallbackProviders ?? []).filter(
            (provider) =>
                provider.enabled && provider.baseUrl?.trim() && provider.model
        )
    ]
    const references = reference
        ? Array.isArray(reference)
            ? reference
            : [reference]
        : []
    const networkRetries = config.networkRetries ?? 0
    const contentRetries = config.contentRetries ?? 0
    const keywords = config.contentRetryKeywords ?? []
    const delay = config.retryDelaySeconds ?? 2
    let attempts = 0
    let lastError: Error | undefined
    let lastDownload: ImageDownloadError | undefined
    let finalContent = false

    // 对每个接口各请求一次；contentRetries 用尽时返回 false 表示内容异常已终局。
    const attemptProvider = async (
        provider: ProviderEntry,
        providerIndex: number,
        currentPrompt: string
    ): Promise<Buffer | false | undefined> => {
        let contentUsed = 0
        let networkUsed = 0
        while (true) {
            throwIfAborted(signal)
            attempts++
            trace?.('接口尝试', {
                providerIndex,
                format: provider.format,
                attempts,
                reason: 'request'
            })
            try {
                const image = await generateImage(
                    { ...config, ...provider },
                    currentPrompt,
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
                lastError = failure
                if (failure instanceof ImageDownloadError)
                    lastDownload = failure
                if (failure.message === ECHOED_REFERENCE) return undefined
                const content = isContentError(failure.message, keywords)
                const network = isNetworkError(failure.message)
                if (content && contentUsed < contentRetries) {
                    contentUsed++
                    trace?.('接口重试', {
                        providerIndex,
                        kind: 'content',
                        attempts
                    })
                    await waitSeconds(delay, signal)
                    continue
                }
                if (!content && network && networkUsed < networkRetries) {
                    networkUsed++
                    trace?.('接口重试', {
                        providerIndex,
                        kind: 'network',
                        attempts
                    })
                    await waitSeconds(delay, signal)
                    continue
                }
                return content ? false : undefined
            }
        }
    }

    const runProviders = async (
        currentPrompt: string
    ): Promise<Buffer | undefined> => {
        for (let index = 0; index < providers.length; index++) {
            const result = await attemptProvider(
                providers[index],
                index,
                currentPrompt
            )
            if (Buffer.isBuffer(result)) return result
            if (result === false) finalContent = true
            if (index + 1 < providers.length)
                trace?.('切换备用接口', {
                    providerIndex: index + 1,
                    format: providers[index + 1].format,
                    attempts
                })
        }
        return undefined
    }

    let image = await runProviders(prompt)
    if (!image && config.promptRewrite && options.rewrite && finalContent) {
        throwIfAborted(signal)
        trace?.('改写提示词', { attempts })
        const rewritten = await options.rewrite(
            prompt,
            lastError?.message ?? ''
        )
        if (rewritten?.trim()) {
            finalContent = false
            image = await runProviders(rewritten)
        }
    }
    if (image) return image
    throw new ComicImageError(
        lastError?.message ?? '生图接口调用失败。',
        attempts,
        lastDownload?.url,
        finalContent
    )
}
