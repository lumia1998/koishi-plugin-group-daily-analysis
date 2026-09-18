import type { Config } from './config'

export function buildGroupComicImagePrompt(
    config: Config['comic'],
    hasReportReference: boolean,
    hasCharacterReference: boolean,
    topicCount: number,
    skin = 'md3'
): string {
    const character = config.characterDescription?.trim()
    const reportRole = hasReportReference
        ? '附件 1 是完整的群分析报告图片。它是本次创作的事实来源、主题视觉和版式参考；请重点阅读其中“今日话题”“热门话题”或同义的话题区域。'
        : '当前没有群分析报告图片，请根据可见的群聊话题素材完成报告式漫画。'
    const characterRole = hasCharacterReference
        ? '附件 2 及后续图片是配置页中的主要主持角色参考图。它们只决定主持角色的外观，主持角色必须在每个分镜中保持一致。'
        : '没有主持角色参考图，请设计一个统一的主持角色，并在所有分镜保持一致。'
    return `参考这些图片，直接生成一张群聊话题观察漫画报告。
${reportRole}
${characterRole}
请查看附件 1 的今日话题部分，根据其中的每个话题分别创作一个独立分镜。当前报告中应有 ${topicCount} 个话题，因此画面需要逐一覆盖这 ${topicCount} 个话题：不能遗漏、合并、改写成无关主题，也不要凭空增加话题。
每个分镜都由同一个主要角色观察、讲解并友善地吐槽对应话题；话题详情只能作为理解和创作依据，不要把长篇聊天记录、来源编号或虚构的群友原话直接塞进画面。
整体要像一份“今日群聊观察报告”或编辑部话题特刊，而不是普通连续剧情漫画。根据话题数量安排完整版式：少量话题可使用横向网格，话题较多时使用多行网格；每格都要有清晰的话题标题、角色动作表情和简短中文点评。
当前皮肤：${skin}。完整继承附件 1 的主题视觉语言、配色、纸张或界面质感、标题层级和装饰气质，但不要把所有主题强行画成手账、胶带或便签风格，也不要机械复制附件 1 的原始报告排版。
${character ? `主要主持角色的额外设定：${character}` : '主要主持角色的外观以附件 2 及后续参考图为准。'}
只输出最终图片，不要输出结构化数据、Markdown、幕后分析或文本分镜说明。不要混淆群分析报告中的头像、群友和主持角色；主持角色是观察者，不是被分析的群友。`
}
