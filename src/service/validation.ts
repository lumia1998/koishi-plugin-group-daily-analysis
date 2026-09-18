import { z } from 'zod'
import type {
    GroupComicStoryboard,
    SummaryTopic,
    UserComicStoryboard
} from '../types'

const text = z.string().trim().min(1)
const schemas: Record<string, z.ZodTypeAny> = {
    话题分析: z.array(
        z.object({
            topic: text,
            detail: text,
            contributors: z.array(z.string()).default([])
        })
    ),
    用户称号分析: z.array(
        z.object({
            name: text,
            id: z.union([z.number(), text]),
            title: text,
            mbti: z.string().default(''),
            reason: text
        })
    ),
    金句分析: z.array(z.object({ content: text, sender: text, reason: text })),
    聊天质量锐评: z.object({
        title: text,
        subtitle: z.string().default(''),
        summary: text,
        dimensions: z
            .array(
                z.object({
                    name: text,
                    percentage: z.number().finite().min(0).max(100),
                    comment: text
                })
            )
            .min(1)
            .max(8)
            .refine((items) => items.some((item) => item.percentage > 0))
    })
}

export function validateAnalysisOutput(
    taskName: string,
    data: unknown
): unknown {
    const value =
        taskName === '聊天质量锐评' && Array.isArray(data) ? data[0] : data
    const schema = schemas[taskName]
    if (schema) return schema.parse(value)
    if (!value || typeof value !== 'object')
        throw new Error(taskName + '未返回有效的 JSON/YAML 结构。')
    return value
}

/**
 * 校验群漫画分镜与输入话题的严格一对一关系。
 * 这一步在调用生图 API 前执行，因此格式或覆盖错误只会重试文本模型。
 */
export function validateGroupComicStoryboard(
    value: unknown,
    topics: SummaryTopic[]
): GroupComicStoryboard {
    const topicCount = topics.length
    const panel = z
        .object({
            topicIndex: z.number().int().min(1).max(topicCount),
            topicTitle: text,
            scene: text.max(4000),
            speech: text.max(15),
            caption: text.max(30)
        })
        .strict()
    // zod 3 的类型声明在此项目的 exactOptionalPropertyTypes 配置下会把
    // 已 required 的对象字段标成可选；运行时 parse 已完成严格校验。
    const storyboard = z
        .object({ panels: z.array(panel).length(topicCount) })
        .strict()
        .parse(value) as GroupComicStoryboard
    const indexes = storyboard.panels
        .map((item) => item.topicIndex)
        .sort((a, b) => a - b)

    if (indexes.some((index, position) => index !== position + 1))
        throw new Error(
            `群漫画分镜必须恰好覆盖每个话题一次，期望话题编号 1-${topicCount}。`
        )

    for (const panel of storyboard.panels) {
        const expectedTitle = topics[panel.topicIndex - 1].topic.trim()
        if (panel.topicTitle !== expectedTitle)
            throw new Error(
                `群漫画分镜 ${panel.topicIndex} 的话题标题与原始话题不一致。`
            )
    }

    return storyboard
}

const userComicCategories = [
    'summary',
    'keyTraits',
    'interests',
    'communicationStyle'
] as const

/** 用户画像漫画固定覆盖四个画像字段，不允许模型自行删减或重复类别。 */
export function validateUserComicStoryboard(
    value: unknown
): UserComicStoryboard {
    const panel = z
        .object({
            category: z.enum(userComicCategories),
            scene: text.max(4000),
            speech: text.max(15),
            caption: text.max(30)
        })
        .strict()
    const storyboard = z
        .object({ panels: z.array(panel).length(userComicCategories.length) })
        .strict()
        .parse(value) as UserComicStoryboard
    const categories = new Set(storyboard.panels.map((item) => item.category))
    if (
        categories.size !== userComicCategories.length ||
        userComicCategories.some((category) => !categories.has(category))
    )
        throw new Error(
            '用户画像漫画必须恰好覆盖总结、性格特质、兴趣爱好和沟通风格四类。'
        )
    return storyboard
}
