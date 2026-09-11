import { GroupAnalysisResult, StoredMessage } from '../types'

export interface IncrementalSnapshot {
    version: 1
    cursor: number
    cursorIds: string[]
    batches: { start: number; end: number; result: GroupAnalysisResult }[]
}

export function messageIdentity(message: StoredMessage) {
    return message.messageId || message.id
}

export function pendingMessages(
    messages: StoredMessage[],
    state?: IncrementalSnapshot
) {
    const seen = new Set<string>()
    const boundary = new Set(state?.cursorIds || [])
    return messages
        .filter((message) => {
            const id = messageIdentity(message)
            const time = new Date(message.timestamp).getTime()
            if (seen.has(id) || !Number.isFinite(time)) return false
            seen.add(id)
            return (
                !state ||
                time > state.cursor ||
                (time === state.cursor && !boundary.has(id))
            )
        })
        .sort(
            (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime()
        )
}

export function advanceSnapshot(
    state: IncrementalSnapshot | undefined,
    messages: StoredMessage[],
    result: GroupAnalysisResult,
    cutoff: number
): IncrementalSnapshot {
    const times = messages.map((message) =>
        new Date(message.timestamp).getTime()
    )
    const cursor = Math.max(...times)
    return {
        version: 1,
        cursor,
        cursorIds: [
            ...new Set([
                ...(state?.cursor === cursor ? state.cursorIds : []),
                ...messages
                    .filter(
                        (message) =>
                            new Date(message.timestamp).getTime() === cursor
                    )
                    .map(messageIdentity)
            ])
        ],
        // Drop batches crossing the window boundary rather than retaining stale topics.
        batches: [
            ...(state?.batches || []).filter((batch) => batch.start >= cutoff),
            { start: Math.min(...times), end: cursor, result }
        ]
    }
}

export function mergeIncrementalResults(
    state: IncrementalSnapshot,
    base: GroupAnalysisResult,
    maxTopics: number,
    maxQuotes: number,
    maxTitles = 20
) {
    const batches = [...state.batches].reverse()
    const unique = <T>(items: T[], key: (item: T) => string, limit: number) => {
        const seen = new Set<string>()
        return items
            .filter((item) => {
                const value = key(item).trim().toLowerCase()
                if (!value || seen.has(value)) return false
                seen.add(value)
                return true
            })
            .slice(0, limit)
    }
    const titles = new Map<string, GroupAnalysisResult['userTitles'][number]>()
    for (const batch of [...state.batches].sort((a, b) => a.start - b.start)) {
        for (const title of batch.result.userTitles || []) {
            const key = String(title.id ?? title.name ?? title.title)
                .trim()
                .toLowerCase()
            if (key) titles.set(key, title)
        }
    }
    const qualitySamples = state.batches
        .filter((batch) => batch.result.chatQuality?.dimensions?.length)
        .map((batch) => ({
            quality: batch.result.chatQuality!,
            weight: Math.max(1, batch.result.totalMessages || 1)
        }))
    let chatQuality = base.chatQuality
    if (qualitySamples.length) {
        const dimensionMap = new Map<
            string,
            {
                name: string
                percentage: number
                comment: string
            }
        >()
        for (const sample of qualitySamples) {
            for (const dimension of sample.quality.dimensions) {
                const key = dimension.name.trim().toLowerCase()
                const current = dimensionMap.get(key) || {
                    name: dimension.name,
                    percentage: 0,
                    comment: ''
                }
                current.name = dimension.name
                current.percentage += dimension.percentage * sample.weight
                current.comment = dimension.comment
                dimensionMap.set(key, current)
            }
        }
        const dimensions = [...dimensionMap.entries()]
            .map(([, value]) => ({
                name: value.name,
                percentage: value.percentage,
                comment: value.comment
            }))
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 8)
        const total = dimensions.reduce((sum, item) => sum + item.percentage, 0)
        // Missing dimensions contribute zero in other batches. Normalize the
        // retained weighted totals, then distribute rounding by largest remainder.
        const shares = dimensions.map((dimension) =>
            total > 0
                ? (dimension.percentage / total) * 100
                : 100 / dimensions.length
        )
        dimensions.forEach((dimension, index) => {
            dimension.percentage = Math.floor(shares[index])
        })
        const remainder =
            100 - dimensions.reduce((sum, item) => sum + item.percentage, 0)
        const order = shares
            .map((share, index) => ({
                index,
                fraction: share - Math.floor(share)
            }))
            .sort((a, b) => b.fraction - a.fraction)
        for (let index = 0; index < remainder && index < order.length; index++)
            dimensions[order[index].index].percentage++
        const latest = qualitySamples[qualitySamples.length - 1].quality
        chatQuality = { ...latest, dimensions }
    }
    return {
        ...base,
        topics: unique(
            batches.flatMap((batch) => batch.result.topics || []),
            (item) => item.topic,
            maxTopics
        ),
        goldenQuotes: unique(
            batches.flatMap((batch) => batch.result.goldenQuotes || []),
            (item) => item.content,
            maxQuotes
        ),
        userTitles: [...titles.values()].slice(0, maxTitles),
        chatQuality
    }
}
