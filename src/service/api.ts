/* eslint-disable @typescript-eslint/no-explicit-any */
import { errorKind, Trace } from '../diagnostics'
export type TextProtocol =
    | 'openai-responses'
    | 'anthropic-messages'
    | 'google-v1beta'
    | 'openai-chat'

export interface ApiConfig {
    protocol: TextProtocol
    baseUrl: string
    apiKey: string
    model: string
    timeout: number
    maxOutputTokens: number
    retryCount?: number
    retryBackoffSeconds?: number
    topicModel?: string
    titleModel?: string
    goldenQuoteModel?: string
    qualityModel?: string
    personaModel?: string
    queryModel?: string
    chatModel?: string
    comicModel?: string
}

export interface TextMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

// Accept either a versioned API base or a full endpoint; never append /v1 twice.
export function endpoint(base: string, path: string): string {
    const url = new URL(base)
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
    ) {
        throw new Error('API 地址必须是 HTTP(S) 地址，不能包含用户名或密码。')
    }
    // Strip a known operation before selecting the requested endpoint. This also
    // lets model discovery work when the user supplied a full inference URL.
    const current = url.pathname
        .replace(/\/$/, '')
        .replace(
            /\/(?:responses|chat\/completions|messages|images\/(?:edits|generations)|models(?:\/[^/]+:(?:generateContent|streamGenerateContent))?)$/,
            ''
        )
    const suffix = /\/v1(?:beta)?$/.test(current)
        ? path.replace(/^\/v1(?:beta)?/, '')
        : path
    url.pathname = current + suffix
    return url.toString()
}

export async function readJson(response: Response): Promise<any> {
    if (!response.ok)
        throw new Error(`API 请求失败（HTTP ${response.status}）。`)
    if (!response.body) throw new Error('API 响应为空。')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.length
            if (length > 32 * 1024 * 1024)
                throw new Error('API 响应超过大小限制。')
            chunks.push(value)
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } finally {
        await reader.cancel()
    }
}

export async function requestJson(
    url: string,
    key: string,
    body: unknown,
    timeout: number,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
    trace?: Trace
): Promise<any> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, timeout * 1000)
    const started = Date.now()
    trace?.('JSON 请求开始', { timeoutSeconds: timeout })
    try {
        const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            redirect: 'error',
            headers: {
                'Content-Type': 'application/json',
                ...(!('x-api-key' in headers || 'x-goog-api-key' in headers) &&
                key
                    ? { Authorization: `Bearer ${key}` }
                    : {}),
                ...headers
            },
            body: JSON.stringify(body)
        })
        trace?.('HTTP 响应', {
            status: response.status,
            elapsedMs: Date.now() - started
        })
        return await readJson(response)
    } catch (error) {
        trace?.('JSON 请求失败', {
            reason: controller.signal.aborted
                ? 'TimeoutOrCancelled'
                : errorKind(error),
            elapsedMs: Date.now() - started
        })
        if (controller.signal.aborted) throw new Error('API 请求超时或已取消。')
        // Do not propagate fetch errors containing URLs or provider response bodies.
        if (error instanceof Error && error.message.startsWith('API 请求失败'))
            throw error
        throw new Error('API 网络请求或响应解析失败。')
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
    }
}

export function textRequest(
    config: ApiConfig,
    model: string,
    prompt: string,
    temperature: number,
    messages?: TextMessage[]
) {
    const common = { model }
    const conversation = messages || [
        { role: 'user' as const, content: prompt }
    ]
    const system = conversation
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')
    const turns = conversation.filter((m) => m.role !== 'system')
    switch (config.protocol) {
        case 'openai-responses':
            return {
                url: endpoint(config.baseUrl, '/v1/responses'),
                headers: {},
                body: {
                    ...common,
                    input: messages ? conversation : prompt,
                    max_output_tokens: config.maxOutputTokens,
                    store: false
                }
            }
        case 'anthropic-messages':
            return {
                url: endpoint(config.baseUrl, '/v1/messages'),
                headers: {
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: {
                    ...common,
                    max_tokens: config.maxOutputTokens,
                    ...(system ? { system } : {}),
                    messages: turns
                }
            }
        case 'google-v1beta':
            return {
                url: endpoint(
                    config.baseUrl,
                    `/v1beta/models/${encodeURIComponent(model)}:generateContent`
                ),
                headers: { 'x-goog-api-key': config.apiKey },
                body: {
                    ...(system
                        ? { systemInstruction: { parts: [{ text: system }] } }
                        : {}),
                    contents: turns.map((m) => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    })),
                    generationConfig: {
                        maxOutputTokens: config.maxOutputTokens,
                        temperature
                    }
                }
            }
        case 'openai-chat':
            return {
                url: endpoint(config.baseUrl, '/v1/chat/completions'),
                headers: {},
                body: {
                    ...common,
                    messages: conversation,
                    max_tokens: config.maxOutputTokens,
                    temperature
                }
            }
        default:
            throw new Error('不支持的 LLM 协议。')
    }
}

export function extractText(protocol: TextProtocol, data: any): string {
    let text: string
    switch (protocol) {
        case 'openai-responses':
            if (data.status === 'incomplete' || data.status === 'failed')
                throw new Error('模型输出未完成。请检查输出长度限制。')
            text = (data.output ?? [])
                .filter((x: any) => x.type === 'message')
                .flatMap((x: any) => x.content ?? [])
                .filter((x: any) => x.type === 'output_text')
                .map((x: any) => x.text)
                .join('\n')
            break
        case 'anthropic-messages':
            if (data.stop_reason === 'max_tokens')
                throw new Error('模型输出达到长度限制。')
            text = (data.content ?? [])
                .filter((x: any) => x.type === 'text')
                .map((x: any) => x.text)
                .join('\n')
            break
        case 'google-v1beta':
            if (
                data.candidates?.[0]?.finishReason &&
                data.candidates[0].finishReason !== 'STOP'
            )
                throw new Error('模型未正常完成输出。')
            text = (data.candidates?.[0]?.content?.parts ?? [])
                .filter((x: any) => !x.thought && typeof x.text === 'string')
                .map((x: any) => x.text)
                .join('\n')
            break
        case 'openai-chat':
            if (data.choices?.[0]?.finish_reason === 'length')
                throw new Error('模型输出达到长度限制。')
            text = data.choices?.[0]?.message?.content
            break
    }
    if (typeof text !== 'string' || !text.trim())
        throw new Error('模型未返回有效文本。')
    return text
}
