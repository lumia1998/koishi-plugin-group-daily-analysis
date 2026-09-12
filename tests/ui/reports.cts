import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Config } from '../../src/config'
import { RendererService } from '../../src/service/renderer'
import { skinRegistry } from '../../src/skins'

async function main() {
    const puppeteer = require('puppeteer-core')
    const browser = await puppeteer.launch({
        headless: true,
        executablePath:
            process.env.BROWSER_EXECUTABLE ||
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    })
    const output = path.resolve('artifacts/report-layouts')
    await fs.mkdir(output, { recursive: true })
    const data: any = {
        groupName: '模板排版验收群',
        analysisDate: '2026-09-11',
        totalMessages: 1234,
        totalParticipants: 42,
        totalChars: 32100,
        emojiCount: 215,
        mostActivePeriod: '20:00–21:00',
        userStats: [
            {
                userId: 'test',
                nickname: '活跃群友',
                messageCount: 123,
                charCount: 2500,
                lastActive: new Date(),
                replyCount: 12,
                replyRatio: 0.1,
                emojiRatio: 0.2,
                atCount: 5,
                emojiStats: {},
                nightRatio: 0.1,
                avgChars: 20,
                nightMessages: 12,
                activeHours: { 12: 123 }
            }
        ],
        topics: Array.from({ length: 3 }, (_, i) => ({
            topic: `话题 ${i + 1}：模型体验与群友日常讨论`,
            detail: '这是一段用于检查多行文字换行的讨论详情。'.repeat(6),
            contributors: ['群友甲', '群友乙']
        })),
        userTitles: [
            {
                id: 1,
                name: '名字比较长的群友甲',
                title: '今日热心解答者',
                mbti: 'INTP',
                reason: '积极回答群友问题，并分享有用的信息。'.repeat(4)
            }
        ],
        goldenQuotes: [
            {
                sender: '群友甲',
                content: '这里是需要完整展示的金句内容。'.repeat(4),
                reason: '这句发言回应了当时的讨论，带动群友交流。'.repeat(4)
            }
        ],
        chatQuality: {
            title: '轻松交流与技术探讨',
            subtitle: '检验底部分析模块完整排版',
            dimensions: ['信息密度', '互动性', '幽默度', '建设性'].map(
                (name) => ({
                    name,
                    percentage: 25,
                    comment:
                        '这是维度点评，需要自然换行，不能挤成一列或与百分比重叠。'.repeat(
                            3
                        )
                })
            ),
            summary: '总体讨论气氛轻松，参与者围绕具体问题交换观点。'.repeat(4)
        },
        activeHoursData: Object.fromEntries(
            Array.from({ length: 24 }, (_, i) => [i, (i * 13) % 70])
        ),
        activeHoursChart: ''
    }
    const results: any[] = []
    try {
        for (const skin of skinRegistry.getAllIds()) {
            for (const theme of ['light', 'dark'] as const) {
                const config = Config({ skin, theme, htmlOutputDir: output })
                const renderer: any = Object.assign(
                    Object.create(RendererService.prototype),
                    {
                        config,
                        templateDir: path.resolve('resources'),
                        ctx: { baseDir: process.cwd() }
                    }
                )
                const file = await renderer.renderGroupAnalysisHtml(
                    data,
                    config
                )
                const page = await browser.newPage()
                // tsx preserves nested function names with this helper.
                await page.evaluateOnNewDocument(
                    'globalThis.__name = (value) => value'
                )
                await page.setViewport({ width: 1200, height: 900 })
                await page.setRequestInterception(true)
                page.on('request', (request: any) =>
                    /^https?:/.test(request.url())
                        ? request.abort()
                        : request.continue()
                )
                await page.goto(pathToFileURL(file).href, { waitUntil: 'load' })
                await page.evaluate((theme: string) => {
                    document.body.classList.remove(
                        'auto-theme',
                        'light-theme',
                        'dark-theme'
                    )
                    document.body.classList.add(theme + '-theme')
                }, theme)
                const metrics = await page.evaluate(() => {
                    const section = document.querySelector(
                        '.quality-section'
                    ) as HTMLElement
                    const parent = section.parentElement!
                    const text = section.querySelector('p')!
                    const luminance = (value: string) => {
                        const rgb = value
                            .match(/[\d.]+/g)!
                            .slice(0, 3)
                            .map(Number)
                            .map((n) => {
                                n /= 255
                                return n <= 0.04045
                                    ? n / 12.92
                                    : ((n + 0.055) / 1.055) ** 2.4
                            })
                        return (
                            rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
                        )
                    }
                    let node: Element | null = text
                    let background = 'rgb(255, 255, 255)'
                    while (node) {
                        const color = getComputedStyle(node).backgroundColor
                        if (
                            color !== 'rgba(0, 0, 0, 0)' &&
                            color !== 'transparent'
                        ) {
                            background = color
                            break
                        }
                        node = node.parentElement
                    }
                    const foregroundLum = luminance(
                        getComputedStyle(text).color
                    )
                    const backgroundLum = luminance(background)
                    return {
                        compressedBars: [
                            ...document.querySelectorAll<HTMLElement>(
                                '.activity-bar-bar'
                            )
                        ].some(
                            (el) =>
                                el.style.height.endsWith('px') &&
                                Math.abs(
                                    el.getBoundingClientRect().height -
                                        parseFloat(el.style.height)
                                ) > 1
                        ),
                        zeroBarBorder: [
                            ...document.querySelectorAll<HTMLElement>(
                                '.chart-column:not(.show-value) .bar-vertical'
                            )
                        ].some(
                            (el) =>
                                parseFloat(
                                    getComputedStyle(el).borderTopWidth
                                ) > 0
                        ),
                        contrast:
                            (Math.max(foregroundLum, backgroundLum) + 0.05) /
                            (Math.min(foregroundLum, backgroundLum) + 0.05),
                        width: section.getBoundingClientRect().width,
                        parentWidth: parent.getBoundingClientRect().width,
                        nested: !!section.parentElement?.closest(
                            '.quotes-grid, .bubble-container, .card-grid'
                        ),
                        overflow: [...section.querySelectorAll('p')].some(
                            (p) => p.scrollWidth > p.clientWidth + 2
                        ),
                        unresolved: document.body.innerText.includes('${')
                    }
                })
                assert.ok(
                    metrics.width > 500,
                    `${skin}/${theme}: quality section squeezed: ${JSON.stringify(metrics)}`
                )
                assert.equal(
                    metrics.compressedBars,
                    false,
                    `${skin}/${theme}: chart bar height distorted`
                )
                assert.equal(
                    metrics.zeroBarBorder,
                    false,
                    `${skin}/${theme}: zero bar has a visible border`
                )
                assert.equal(
                    metrics.nested,
                    false,
                    `${skin}: nested quality section`
                )
                assert.ok(
                    metrics.contrast >= 4.5,
                    `${skin}/${theme}: poor text contrast ${metrics.contrast}`
                )
                assert.equal(metrics.overflow, false, `${skin}: text overflow`)
                assert.equal(
                    metrics.unresolved,
                    false,
                    `${skin}: unresolved placeholders`
                )
                await page.screenshot({
                    path: path.join(output, `${skin}-${theme}.png`),
                    fullPage: true
                })
                await (
                    await page.$('.quality-section')
                ).screenshot({
                    path: path.join(output, `${skin}-${theme}-quality.png`)
                })
                results.push({ skin, theme, ...metrics })
                await page.close()
            }
        }
        await fs.writeFile(
            path.join(output, 'results.json'),
            JSON.stringify(results, null, 2)
        )
        const personaResults: any[] = []
        for (const skin of skinRegistry.getAllIds()) {
            for (const theme of ['light', 'dark'] as const) {
                const cleanup: Function[] = []
                const config = Config({ skin, theme })
                const avatar =
                    'data:image/svg+xml;base64,' +
                    Buffer.from(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#c6daee"/><circle cx="64" cy="48" r="24" fill="#6487aa"/><ellipse cx="64" cy="112" rx="40" ry="35" fill="#6487aa"/></svg>'
                    ).toString('base64')
                const renderer: any = Object.assign(
                    Object.create(RendererService.prototype),
                    {
                        config,
                        templateDir: path.resolve('resources'),
                        imageToBase64: async () => avatar,
                        ctx: {
                            baseDir: process.cwd(),
                            logger: { info() {}, debug() {}, warn() {} },
                            setTimeout(fn: Function) {
                                cleanup.push(fn)
                            },
                            puppeteer: {
                                async page() {
                                    const page = await browser.newPage()
                                    await page.setViewport({
                                        width: 1200,
                                        height: 900
                                    })
                                    await page.setRequestInterception(true)
                                    page.on('request', (request: any) =>
                                        /^https?:/.test(request.url())
                                            ? request.abort()
                                            : request.continue()
                                    )
                                    return page
                                }
                            }
                        }
                    }
                )
                const persona = {
                    userId: 'test',
                    username: '测试用户',
                    analysisDate: '2026-09-12',
                    summary:
                        '这是一段多行用户画像摘要，用于检查长内容是否被截断、挤压或溢出。'.repeat(
                            10
                        ),
                    keyTraits: [
                        '积极交流',
                        '善于分析',
                        '这是一个特别长的性格特质标签用来检查自动换行'
                    ],
                    interests: [
                        '技术讨论',
                        '阅读与写作',
                        'https://example.com/' + 'a'.repeat(90)
                    ],
                    communicationStyle:
                        '表达直接并且重视依据，也会通过举例帮助群友理解问题。'.repeat(
                            10
                        ),
                    evidence: Array.from({ length: 4 }, (_, i) =>
                        `依据 ${i + 1}：这是一段应完整展示的引用内容。`.repeat(
                            6
                        )
                    )
                }
                const page = await renderer._renderUserPersonaUnsafe(
                    persona,
                    '很长的用户昵称用于验证换行布局'.repeat(3),
                    avatar,
                    theme
                )
                try {
                    const metrics = await page.evaluate(() => ({
                        pageOverflow:
                            document.documentElement.scrollWidth >
                            window.innerWidth + 3,
                        skin: document.body.dataset.skin,
                        unresolved: document.body.innerText.includes('${'),
                        overflow: [
                            ...document.querySelectorAll(
                                'p, h1, .profile-name, .chip, .tag, .washi-tape-tag'
                            )
                        ]
                            .filter(
                                (el) =>
                                    (el as HTMLElement).clientWidth > 0 &&
                                    (el as HTMLElement).scrollWidth >
                                        (el as HTMLElement).clientWidth + 3
                            )
                            .map((el) => el.className || el.tagName)
                    }))
                    await page.screenshot({
                        path: path.join(output, `persona-${skin}-${theme}.png`),
                        fullPage: true
                    })
                    assert.equal(metrics.skin, skin)
                    assert.equal(metrics.unresolved, false)
                    assert.equal(
                        metrics.pageOverflow,
                        false,
                        `${skin}/${theme}: persona exceeds page width`
                    )
                    assert.deepEqual(
                        metrics.overflow,
                        [],
                        `${skin}/${theme}: persona text overflow`
                    )
                    personaResults.push({ skin, theme, ...metrics })
                } finally {
                    await page.close()
                    for (const fn of cleanup) await fn()
                }
            }
        }
        await fs.writeFile(
            path.join(output, 'persona-results.json'),
            JSON.stringify(personaResults, null, 2)
        )
        console.log(
            'Persona layout overflows:',
            JSON.stringify(
                personaResults.filter((item) => item.overflow.length)
            )
        )
        for (const theme of ['light', 'dark']) {
            const contact = await browser.newPage()
            await contact.setViewport({ width: 1600, height: 900 })
            const cards = await Promise.all(
                skinRegistry.getAllIds().map(async (skin) => {
                    const png = await fs.readFile(
                        path.join(output, `${skin}-${theme}-quality.png`)
                    )
                    return `<article><h2>${skin} / ${theme}</h2><img src="data:image/png;base64,${png.toString('base64')}"></article>`
                })
            )
            await contact.setContent(
                `<style>body{margin:0;padding:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;background:#ddd;font:16px sans-serif}article{background:white;padding:8px}img{width:100%}h2{font-size:18px}</style>${cards.join('')}`
            )
            await contact.screenshot({
                path: path.join(output, `contact-${theme}.png`),
                fullPage: true
            })
            await contact.close()
        }
        console.log(
            `Report layouts passed: ${results.length} group + ${personaResults.length} persona renders. ${output}`
        )
    } finally {
        await browser.close()
    }
}
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
