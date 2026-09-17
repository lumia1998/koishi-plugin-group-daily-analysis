import { Context, Schema } from 'koishi'
import { Config } from './config'
import { endpoint, readJson } from './service/api'
import { createTrace, errorKind, Trace } from './diagnostics'

type ModelApi =
    | Pick<Config['comic'], 'format' | 'baseUrl' | 'apiKey' | 'timeout'>
    | Config['llm']

export async function listModels(
    config: ModelApi,
    signal?: AbortSignal,
    trace?: Trace
): Promise<string[]> {
    const google = config.format === 'google'
    const url = new URL(
        endpoint(config.baseUrl, google ? '/v1beta/models' : '/v1/models')
    )
    const headers: Record<string, string> = google
        ? { 'x-goog-api-key': config.apiKey }
        : config.format === 'anthropic'
          ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
          : config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, Math.min(config.timeout || 30, 30) * 1000)
    const ids = new Set<string>()
    const cursors = new Set<string>()
    try {
        for (let page = 0; page < 100; page++) {
            const response = await fetch(url, {
                headers,
                signal: controller.signal,
                redirect: 'error'
            })
            trace?.('模型列表 HTTP 响应', {
                page: page + 1,
                status: response.status
            })
            const data = await readJson(response)
            const models = google ? data.models : data.data
            if (!Array.isArray(models)) throw new Error('模型列表格式不正确。')
            for (const model of models) {
                const id = google
                    ? model.name?.replace(/^models\//, '')
                    : model.id
                if (typeof id === 'string' && id.trim()) ids.add(id)
            }
            const cursor = google
                ? data.nextPageToken
                : data.has_more
                  ? data.last_id
                  : undefined
            if (!cursor || cursors.has(cursor)) break
            cursors.add(cursor)
            url.searchParams.set(google ? 'pageToken' : 'after_id', cursor)
        }
        return [...ids].sort()
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
    }
}

export function registerModelLists(ctx: Context, config: Config) {
    const controller = new AbortController()
    ctx.on('dispose', () => controller.abort())
    const update = async (api: ModelApi, key: string, label: string) => {
        const trace = createTrace(ctx, !!config.debug, `${label}模型列表`)
        ctx.schema.set(key, Schema.string())
        if (!api.baseUrl?.trim()) return
        try {
            const started = Date.now()
            trace('获取开始', { format: api.format })
            const ids = await listModels(api, controller.signal, trace)
            trace('获取完成', {
                count: ids.length,
                elapsedMs: Date.now() - started
            })
            if (controller.signal.aborted) return
            ctx.schema.set(
                key,
                Schema.union([
                    ...ids.map((id) => Schema.const(id)),
                    Schema.string().description('手动输入模型 ID')
                ])
            )
        } catch (error) {
            trace('获取失败', { reason: errorKind(error) })
            if (!controller.signal.aborted)
                ctx.logger.warn(
                    `${label}模型列表获取失败，请检查地址、密钥及模型列表接口；仍可手动填写模型 ID。`
                )
        }
    }
    ctx.on('ready', async () => {
        await Promise.all([
            update(config.llm, 'group-daily-analysis.text-model', '文本'),
            update(config.comic, 'group-daily-analysis.image-model', '生图')
        ])
    })
}
