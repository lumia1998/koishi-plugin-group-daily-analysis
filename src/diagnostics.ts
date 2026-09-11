import type { Context } from 'koishi'

export type Trace = (
    stage: string,
    details?: Record<string, string | number | boolean>
) => void

// Callers supply operational metadata only, never prompts, credentials or bodies.
export function createTrace(
    ctx: Context,
    enabled: boolean,
    scope: string
): Trace {
    return (stage, details = {}) => {
        if (enabled)
            ctx.logger.info(
                `[详细日志][${scope}] ${stage} ${JSON.stringify(details)}`
            )
    }
}

export function errorKind(error: unknown): string {
    if (!(error instanceof Error)) return 'UnknownError'
    const status = error.message.match(/^API 请求失败（HTTP (\d{3})）。/)
    if (status) return `HTTP ${status[1]}`
    if (error.message === 'API 请求超时或已取消。') return 'TimeoutOrCancelled'
    return error instanceof SyntaxError
        ? 'InvalidJSON'
        : error.name === 'AbortError'
          ? 'Aborted'
          : 'RequestOrProcessingError'
}

export function errorDetail(error: unknown, secrets: string[] = []): string {
    let message =
        error instanceof Error ? error.message : String(error ?? '未知错误')
    const cause =
        error instanceof Error
            ? (error as Error & { cause?: { code?: unknown } }).cause
            : undefined
    if (typeof cause?.code === 'string') message += ` (${cause.code})`
    for (const secret of secrets.filter(Boolean)) {
        message = message.split(secret).join('[已隐藏]')
        message = message.split(encodeURIComponent(secret)).join('[已隐藏]')
    }
    return message
        .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
        .replace(
            /([?&](?:key|api_key|token|access_token)=)[^\s&#]+/gi,
            '$1[已隐藏]'
        )
        .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[已隐藏]')
        .slice(0, 1500)
}
