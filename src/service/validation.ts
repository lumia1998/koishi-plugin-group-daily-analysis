import { z } from 'zod'

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
