import { GroupAnalysisResult } from '../types'

export function isQQOfficialPlatform(platform?: string) {
    return (
        platform === 'qq' ||
        platform === 'qq-official' ||
        platform === 'qq_official'
    )
}

function text(value: unknown) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/([*_`~])/g, '\\$1')
        .trim()
}

export function generateQQOfficialMarkdown(result: GroupAnalysisResult) {
    const lines = [
        '# 🎯 群聊日常分析报告',
        `📅 ${text(result.analysisDate)}`,
        '',
        '## 📊 基础统计',
        `- **消息总数**：${result.totalMessages}`,
        `- **参与人数**：${result.totalParticipants}`,
        `- **总字符数**：${result.totalChars}`,
        `- **表情数量**：${result.emojiCount}`,
        `- **最活跃时段**：${text(result.mostActivePeriod)}`,
        '',
        '## 💬 热门话题'
    ]
    if (result.topics?.length) {
        result.topics.forEach((topic, index) => {
            lines.push(`### ${index + 1}. ${text(topic.topic)}`)
            if (topic.contributors?.length)
                lines.push(
                    `**参与者**：${topic.contributors.map(text).join('、')}`
                )
            if (topic.detail) lines.push(text(topic.detail))
            lines.push('')
        })
    } else lines.push('暂无明显讨论话题。', '')

    lines.push('## 🏆 群友称号')
    if (result.userTitles?.length) {
        result.userTitles.forEach((title) => {
            const mbti =
                title.mbti && title.mbti !== 'N/A'
                    ? ` · ${text(title.mbti)}`
                    : ''
            lines.push(`- **${text(title.name)}：${text(title.title)}${mbti}**`)
            if (title.reason) lines.push(`  > ${text(title.reason)}`)
        })
    } else lines.push('暂无群友称号。')

    lines.push('', '## 💬 群圣经')
    if (result.goldenQuotes?.length) {
        result.goldenQuotes.forEach((quote, index) => {
            lines.push(
                `- **${index + 1}. ${text(quote.content)}** — ${text(quote.sender)}`
            )
            if (quote.reason) lines.push(`  > ${text(quote.reason)}`)
        })
    } else lines.push('暂无精彩发言。')

    if (result.chatQuality) {
        lines.push(
            '',
            '## 🧭 聊天质量锐评',
            `**${text(result.chatQuality.title)}**：${text(result.chatQuality.subtitle)}`
        )
        for (const dimension of result.chatQuality.dimensions || [])
            lines.push(
                `- ${text(dimension.name)}：${dimension.percentage}% — ${text(dimension.comment)}`
            )
        if (result.chatQuality.summary)
            lines.push(`> ${text(result.chatQuality.summary)}`)
    }
    return lines.join('\n').trim()
}
