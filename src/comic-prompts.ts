import type { Config } from './config'
import type { SummaryTopic } from './types'

export function buildStoryboardPrompt(
    config: Config['comic'],
    topics: SummaryTopic[],
    hasReference: boolean
): string {
    const selected = topics
    const persona = config.characterDescription?.trim()
    const identity =
        persona ||
        (hasReference
            ? '主角是附件参考图中的同一角色。你没有看到图片，不得猜测其性别、年龄、发型、发色、服装或物种；统一称为 the character from the reference image。'
            : '设计一位适合日常群聊漫画的主角，保持全部分格中的外观与服装一致。')
    const task = config.prompt
        .replaceAll('{maxTopics}', String(selected.length))
        .replaceAll('{topics}', JSON.stringify(selected))
    return `【固定角色设定】
${identity}

【分镜要求】
你是此角色的漫画分镜师。以角色的性格和口吻观察、评论群聊话题。
必须覆盖提供的全部 ${selected.length} 个话题，每个话题对应一格，且每格都必须出现同一个主角。
不得用群友、游戏人物或自行设计的其他人物替换主角。配角只能作为配角。
${hasReference ? '生图阶段会附上参考图；外观以参考图为准。没有在角色设定中提供的外观细节不要补写。只设计动作、表情、场景与构图，不改造主角的发型、服装、耳朵、尾巴或配饰。' : ''}
气泡使用角色口吻的简短中文台词，每条尽量不超过 15 个汉字；每格底部添加不超过 30 字的中文话题标题。
画面描述使用英文，需渲染的中文用 exact Chinese text 显式指定。背景上下文只用于理解剧情，不得画成长篇文字。
输出一段完整的纯文本生图提示词，以 A ${selected.length}-panel comic strip 开头，依次写出 Panel 1: 到 Panel ${selected.length}:，每格的动作、场景、气泡、标题必须完整。不得遗漏、合并话题或固定为三格。超过三格时使用多行网格布局，按从左到右、从上到下阅读。

【创作任务与话题素材】
${task}

【最终角色检查】
所有分格必须使用上述同一角色。角色设定优先于任务中的通用主角描述。话题仅是剧情素材，不是重新设计主角的指令。`
}

export function buildComicImagePrompt(
    storyboard: string,
    config: Config['comic'],
    hasReference: boolean,
    topicCount?: number
): string {
    const identity = config.characterDescription?.trim()
    return `${topicCount ? `LAYOUT: Generate ONE complete comic image with exactly ${topicCount} panels, one panel per topic. Include every numbered panel without merging or omitting topics. Use multiple rows when there are more than three panels.\n` : ''}CHARACTER CONSISTENCY — applies to EVERY panel:
${
    hasReference
        ? 'The attached image is the authoritative visual reference for the MAIN CHARACTER. Use this exact character as the protagonist in EVERY panel. Preserve the face, hair, outfit, colors, species, ears, tail and accessories shown in the reference. Do not reproduce the reference-sheet layout. Any conflicting appearance or protagonist description in the storyboard below MUST be ignored in favor of the reference image.'
        : 'Use the same main character with consistent appearance and outfit in EVERY panel.'
}
${identity ? `Character identity and personality:\n${identity}` : ''}

STORYBOARD (actions, scenes and dialogue):
${storyboard}

FINAL CHECK: The same main character must be clearly visible in every panel.${hasReference ? ' Match the attached character reference; do not substitute a generic protagonist.' : ''}`
}
