import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Config } from '../src/config'
import { RendererService } from '../src/service/renderer'
import { ConcurrencyLimiter } from '../src/service/limiter'
import { ScrapbookSkinRenderer } from '../src/skins/scrapbook'
import type { GroupAnalysisResult } from '../src/types'

const report = (): GroupAnalysisResult => ({
    totalMessages: 3,
    totalChars: 42,
    totalParticipants: 2,
    emojiCount: 1,
    mostActiveUser: null,
    mostActivePeriod: '09:00 - 10:00',
    userStats: [],
    topics: [
        {
            topic: '话题内容没有丢失',
            contributors: ['小明'],
            detail: '这是一条用于验证静态 HTML 导出的讨论记录。'
        }
    ],
    userTitles: [
        {
            id: 1,
            name: '小明',
            title: '测试员',
            mbti: 'INTJ',
            reason: '写了可靠的回归测试。'
        }
    ],
    goldenQuotes: [
        { sender: '小明', content: '内容必须完整。', reason: '明确的约束。' }
    ],
    chatQuality: {
        title: '聊天质量',
        subtitle: '稳定',
        dimensions: [{ name: '互动性', percentage: 100, comment: '良好' }],
        summary: '所有日报模块都已写入模板。'
    },
    activeHoursChart: '',
    activeHoursData: { 9: 3 },
    analysisDate: '2026/9/17',
    groupName: '测试群'
})

test('HTML output keeps all report modules without HTML directory settings', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'group-report-'))
    try {
        const config = Config({ skin: 'scrapbook', outputFormat: 'html' })
        assert.equal(config.outputFormat, 'html')
        assert.equal((config as any).htmlOutputDir, undefined)
        assert.equal((config as any).htmlBaseUrl, undefined)

        const renderer = Object.create(RendererService.prototype) as RendererService
        Object.assign(renderer as any, {
            ctx: { baseDir },
            config,
            limiter: new ConcurrencyLimiter(1),
            templateDir: path.resolve(process.cwd(), 'resources')
        })

        const file = await renderer.renderGroupAnalysisHtml(report(), config)
        const html = await fs.readFile(file, 'utf8')
        assert.match(html, /话题内容没有丢失/)
        assert.match(html, /测试员/)
        assert.match(html, /内容必须完整/)
        assert.match(html, /聊天质量/)
        assert.doesNotMatch(html, /\$\{(?:topics|userTitles|goldenQuotes|chatQuality)\}/)
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true })
    }
})

test('Scrapbook keeps empty report modules visible instead of removing them', () => {
    const renderer = new ScrapbookSkinRenderer()
    assert.match(renderer.formatTopics([]), /未生成有效话题/)
    assert.match(renderer.formatUserTitles([]), /未生成可展示的群友称号/)
    assert.match(renderer.formatGoldenQuotes([]), /未生成可展示的群聊金句/)
})
