import { getAvatarUrl, SkinRenderer } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

/**
 * Scrapbook Skin Renderer
 * Ported from AstrBot's scrapbook template.
 * Features a hand-drawn, colorful, and playful aesthetic.
 */
export class ScrapbookSkinRenderer implements SkinRenderer {
    readonly id = 'scrapbook'
    readonly name = '手账风格'
    readonly containerSelector = '.container'

    formatUserStats(userStats: UserStats[]): string {
        if (!userStats?.length)
            return '<div class="empty-state">暂无活跃用户记录</div>'
        return userStats
            .map(
                (user, index) => `
            <div class="user-card"><strong>${index + 1}. ${user.nickname}</strong>
            <p>发言 ${user.messageCount} 条 · 字数 ${user.charCount}</p></div>
        `
            )
            .join('')
    }

    formatGoldenQuotes(quotes: GroupAnalysisResult['goldenQuotes']): string {
        if (!quotes || quotes.length === 0) {
            return `
            <section class="quotes-section empty-analysis-section">
                <div class="section-title">群聊金句</div>
                <div class="empty-state">本次未生成可展示的群聊金句。</div>
            </section>
            `
        }

        const itemsHtml = quotes
            .map(
                (quote) => `
        <div class="quote-wrapper">
            <div class="q-flex-container">
                <div class="q-user-col">
                </div>

                <div class="q-content-col">
                    <div class="q-sender-name">${quote.sender}</div>
                    <div class="q-bubble">
                        <div class="q-quote-mark">"</div>
                        <div class="q-content">${quote.content}</div>
                    </div>
                    <div class="q-analysis-note">
                        <span class="note-label">AI 锐评：</span>
                        ${quote.reason}
                    </div>
                </div>
            </div>
        </div>
        `
            )
            .join('')

        return `
        <div class="quotes-section">
            <div class="section-title" style="justify-content: center;">
                <svg class="doodle" viewBox="0 0 24 24">
                    <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
                </svg>
                群聊金句
            </div>
            ${itemsHtml}
        </div>
        `
    }

    formatUserTitles(userTitles: GroupAnalysisResult['userTitles']): string {
        if (!userTitles || userTitles.length === 0) {
            return `
            <section class="user-section empty-analysis-section">
                <div class="section-title">本期群友称号</div>
                <div class="empty-state">本次未生成可展示的群友称号。</div>
            </section>
            `
        }

        const itemsHtml = userTitles
            .map(
                (title) => `
        <div class="user-card">
            <div class="card-tape"></div>
            <div class="user-header">
                <div class="u-avatar">
                    <img src="${getAvatarUrl(title.id)}" alt="头像" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
                <div class="u-info">
                    <div class="u-name">${title.name}</div>
                    <div class="badges">
                        <span class="badge title">${title.title}</span>
                        ${title.mbti && title.mbti !== 'N/A' ? `<span class="badge mbti">${title.mbti}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="u-reason">
                ${title.reason}
            </div>
        </div>
        `
            )
            .join('')

        return `
        <div class="user-section">
            <div class="section-title" style="justify-content: center;">
                <svg class="doodle" viewBox="0 0 24 24">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
                本期群友称号
            </div>
            <div class="masonry-grid">
                ${itemsHtml}
            </div>
        </div>
        `
    }

    formatTopics(topics: GroupAnalysisResult['topics']): string {
        if (!topics || topics.length === 0) {
            return `
            <section class="topic-section empty-analysis-section">
                <div class="section-title">本期热门话题</div>
                <div class="empty-state">本次未生成有效话题，请检查文本模型的并发与日志。</div>
            </section>
            `
        }

        const itemsHtml = topics
            .map((topic, index) => {
                const indexStr = String(index + 1).padStart(2, '0')
                return `
        <div class="topic-item">
            <div class="check-box">
                <div class="check-tick"></div>
            </div>
            <div class="topic-content">
                <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px;">
                    <span class="topic-title">${topic.topic}</span>
                    <span style="font-size: 0.85em; color: #999; font-family: var(--font-body);">#${indexStr}</span>
                </div>
                <div style="font-family: var(--font-hand); font-size: 1.05em; color: var(--ink-secondary); margin-bottom: 8px;">
                    🙋‍♀️ 参与者： ${topic.contributors.join(', ')}
                </div>
                <div class="topic-detail">${topic.detail}</div>
            </div>
        </div>
        `
            })
            .join('')

        return `
        <div class="topic-section">
            <div class="paper-holes">
                <div class="hole"></div>
                <div class="hole"></div>
                <div class="hole"></div>
            </div>
            <div class="section-title">
                <svg class="doodle" viewBox="0 0 24 24">
                    <path d="M14 17H4v2h10v-2zm6-8H4v2h16V9zM4 15h16v-2H4v2zM4 5v2h16V5H4z" />
                </svg>
                本期热门话题
            </div>
            ${itemsHtml}
        </div>
        `
    }

    formatTags(tags: string[]): string {
        if (!tags || tags.length === 0)
            return '<div class="empty-state">暂无记录</div>'
        const colors = ['c1', 'c2', 'c3', 'c4']
        return tags
            .map((tag, i) => {
                const colorClass = colors[i % colors.length]
                return `<div class="washi-tape-tag ${colorClass}">${tag}</div>`
            })
            .join('')
    }

    formatEvidence(evidence: string[]): string {
        if (!evidence || evidence.length === 0)
            return '<div class="empty-state">暂无证据</div>'
        return evidence
            .map((item, index) => {
                // Random rotation between -3 and 3 degrees
                const rot = (Math.random() * 6 - 3).toFixed(1) + 'deg'
                return `
            <div class="evidence-card-pin" style="--rot: ${rot};">
                ${item}
            </div>
            `
            })
            .join('')
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        const items = []
        let maxCount = 0
        for (const count of Object.values(activeHours)) {
            if (count > maxCount) maxCount = count
        }

        for (let i = 0; i < 24; i++) {
            const count = activeHours[i] || 0
            const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0

            let colorVar = 'var(--color-purple)'
            // Min height 4px to show the bar even if small
            let height = `max(4px, ${percentage}%)`

            if (count === 0) {
                height = '0px; border: 0'
            } else if (percentage >= 70) {
                colorVar = 'var(--accent-orange)'
            } else if (percentage >= 30) {
                colorVar = 'var(--color-green)'
            } else {
                colorVar = 'var(--color-blue)'
            }

            // Add a class to conditionally show values if count > 0
            const columnClass =
                count > 0 ? 'chart-column show-value' : 'chart-column'

            items.push(`
            <div class="${columnClass}" title="${String(i).padStart(2, '0')}:00 - ${count}条">
                <div class="bar-value-top">${count > 0 ? count : ''}</div>
                <div class="bar-vertical" style="height: ${height}; background: ${colorVar};"></div>
                <div class="bar-label-x">${String(i).padStart(2, '0')}</div>
            </div>
            `)
        }

        return `
        <div class="chart-container-horizontal">
            ${items.join('')}
        </div>
        `
    }
}
