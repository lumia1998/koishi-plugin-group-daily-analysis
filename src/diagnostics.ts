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
    const status = error.message.match(/^API 请求失败（HTTP (\d{3})）。$/)
    if (status) return `HTTP ${status[1]}`
    if (error.message === 'API 请求超时或已取消。') return 'TimeoutOrCancelled'
    return error instanceof SyntaxError
        ? 'InvalidJSON'
        : error.name === 'AbortError'
          ? 'Aborted'
          : 'RequestOrProcessingError'
}
