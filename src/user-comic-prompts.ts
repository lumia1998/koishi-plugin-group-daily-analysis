import {
    getUserComicVisualSpec,
    type UserComicVisualSpec
} from './skins/user-comic'

export function buildUserComicImagePrompt(
    hasReportReference: boolean,
    hasCharacterReference: boolean | number,
    skin = 'md3',
    character?: { name?: string; persona?: string }
): string {
    const visual = getUserComicVisualSpec(skin)
    const characterCount =
        typeof hasCharacterReference === 'number'
            ? hasCharacterReference
            : hasCharacterReference
              ? 1
              : 0
    const referenceRoles = hasReportReference
        ? characterCount > 1
            ? `附件 1 是用户画像报告截图（当前主题的报告版式），附件 2 至附件 ${characterCount + 1} 是配置页中同一主持角色的多张参考图。图 1 左上角头像是被分析对象，其余参考图的角色才是主持人；两种人物绝不能混淆、合并或互换。`
            : characterCount === 1
              ? '附件 1 是用户画像报告截图（当前主题的报告版式），附件 2 是配置页中的主要主持角色参考图。图 1 左上角头像是被分析对象，图 2 的角色才是主持人；两种人物绝不能混淆、合并或互换。'
              : '附件 1 是当前主题的用户画像报告截图，其中左上角头像是被分析对象；请另行设计统一的主持角色，不要把头像直接改造成主持角色。'
        : characterCount > 0
          ? '当前没有成功生成用户画像报告截图；附件是主持角色的外观参考，不得把主持角色当成画像本人。'
          : '没有图片参考；设计统一的主持角色，并让被分析对象与主持角色保持明确区分。'
    const personaRule = character?.persona?.trim()
        ? `\n主持角色设定：${character.persona.trim()}。该设定只影响主持角色的外观取向、性格和点评口吻，不是画像事实。`
        : ''
    return `参考这些图片，直接生成一张竖版“角色主持的四维人物观察报告”。
${referenceRoles}
请根据图 1 顶部用户画像中的四个维度来创作：01 总体概览、02 性格特质、03 兴趣爱好、04 沟通风格。每个维度单独一个分镜，四个分镜组成一张像报告一样的完整页面，不要画成普通连续剧情四格。
当前主题：${skin}（${visual.family}）。
版式：${visual.layout}
视觉语言：${visual.artDirection}
不要把所有主题都固定成手账、胶带或便签风格；应继承图 1 当前主题的布局气质，同时按本主题重新组织页面。
主持角色要在四个分镜中逐格观察、吐槽和讲解图 1 左上角头像人物的性格；吐槽友善、有趣，但必须以图 1 的实际内容为依据，不得编造画像事实。
四格保持同一主持角色的脸、发型、服装、颜色和配饰。报告中的头像是被分析对象，配置的主要角色参考图是吐槽者。
只需要输出最终图片，不要输出结构化数据、Markdown、分镜说明或幕后分析文字。图片内可以有清晰的中文标题、标签、对白和报告式短句，但不要塞入大段聊天记录、虚构链接、价格、战绩、设备参数或伪造原话。
请保证四个维度都出现且各自独立成格，整体看起来像一份有角色吐槽的用户画像报告。${personaRule}`
}

export function getUserComicImageOptions(
    skin = 'md3'
): Pick<UserComicVisualSpec, 'aspectRatio' | 'size'> {
    const { aspectRatio, size } = getUserComicVisualSpec(skin)
    return { aspectRatio, size }
}
