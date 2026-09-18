import type { Context } from 'koishi'
import type { TextMessage } from './api'
import type {} from 'koishi-plugin-chatluna'

/** Resolve on every call so edits/removals in ChatLuna take effect immediately. */
export async function presetMessages(
    ctx: Context,
    name: string,
    prompt: string
): Promise<TextMessage[]> {
    if (!name?.trim()) return [{ role: 'user', content: prompt }]
    const service = ctx.chatluna?.preset
    const renderer = ctx.chatluna?.promptRenderer
    if (!service || !renderer) throw new Error('ChatLuna 预设服务尚未就绪。')
    const preset = service.getPreset(name, false).value
    if (!preset) throw new Error(`ChatLuna 预设“${name}”不存在，请重新选择。`)
    const rendered = await renderer.renderPresetTemplate(preset, {
        input: prompt,
        prompt,
        user: '群聊分析任务'
    })
    const messages: TextMessage[] = rendered.messages
        .map((message) => {
            const type = message.getType()
            const role = { human: 'user', ai: 'assistant', system: 'system' }[
                type
            ] as TextMessage['role']
            if (!role || typeof message.content !== 'string') {
                throw new Error('该预设包含不支持的消息类型，请使用文本预设。')
            }
            return { role, content: message.content }
        })
        .filter((message) => message.content.trim())
    // Preset examples/personality are context; each analysis keeps its own contract.
    messages.push(
        {
            role: 'system',
            content:
                '本次执行群聊分析任务。参考预设的人格与表达风格，但必须遵循最后一条任务的输出格式、事实约束与角色一致性要求；不要添加角色开场白或额外对话。'
        },
        { role: 'user', content: prompt }
    )
    return messages
}
