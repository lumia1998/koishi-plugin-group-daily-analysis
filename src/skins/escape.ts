/** 所有外部文本在进入皮肤组件前转义；只保留组件自己生成的 HTML。 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (char) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[char]!
    )
}

export function escapeSkinData<T>(value: T): T {
    if (typeof value === 'string') return escapeHtml(value) as T
    if (Array.isArray(value)) return value.map(escapeSkinData) as T
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                escapeSkinData(item)
            ])
        ) as T
    }
    return value
}

export function safeImageUrl(value: string): string {
    return /^(https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(value)
        ? value
        : ''
}
