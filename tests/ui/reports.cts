import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Config } from '../../src/config'
import { RendererService } from '../../src/service/renderer'
import { ConcurrencyLimiter } from '../../src/service/limiter'
import { skinRegistry } from '../../src/skins'
import { group, persona } from '../theme-fixtures.cts'

export async function verifyReports(browser: any) {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-ui-'))
    const output = path.resolve('artifacts/themes')
    await fs.mkdir(output, { recursive: true })
    try {
        await fs.cp(
            path.resolve('resources'),
            path.join(baseDir, 'resources'),
            { recursive: true }
        )
        for (const skin of skinRegistry.getAllIds()) {
            for (const theme of ['light', 'dark'] as const) {
                const config = Config({ skin, theme })
                const renderer: any = Object.assign(
                    Object.create(RendererService.prototype),
                    {
                        config,
                        templateDir: path.join(baseDir, 'resources'),
                        limiter: new ConcurrencyLimiter(1),
                        imageToBase64: async () =>
                            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                        ctx: {
                            baseDir,
                            setTimeout() {},
                            logger: {
                                info() {},
                                debug() {},
                                warn() {},
                                error() {}
                            },
                            puppeteer: {
                                page: async () => {
                                    const page = await browser.newPage()
                                    await page.setViewport({
                                        width: 1200,
                                        height: 1000
                                    })
                                    // 离线验证模板本身；第三方取色脚本和字体不是截图前提。
                                    await page.setJavaScriptEnabled(false)
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
                for (const kind of ['group', 'user']) {
                    const page =
                        kind === 'group'
                            ? await renderer._renderGroupAnalysis(group, theme)
                            : await renderer._renderUserPersona(
                                  persona,
                                  persona.username,
                                  '',
                                  theme
                              )
                    if (kind === 'user') {
                        const referenceImage =
                            await renderer.renderUserPersonaReferenceImage(
                                persona,
                                persona.username,
                                '',
                                config
                            )
                        assert.ok(
                            Buffer.isBuffer(referenceImage),
                            `${skin}/${theme}: reference image failed`
                        )
                    }
                    try {
                        const text = await page.$eval(
                            'body',
                            (body: HTMLElement) => body.innerText
                        )
                        for (const needle of kind === 'group'
                            ? [
                                  '热门话题标记',
                                  '本期技术顾问标记',
                                  '金句内容标记',
                                  '锐评总结标记',
                                  '活跃排行测试员'
                              ]
                            : [
                                  persona.summary,
                                  ...persona.keyTraits,
                                  ...persona.interests,
                                  persona.communicationStyle,
                                  ...persona.evidence
                              ]) {
                            assert.ok(
                                text.includes(needle),
                                `${skin}/${kind}: ${needle}`
                            )
                        }
                        const element = await page.$(
                            skinRegistry.getSafe(skin).containerSelector
                        )
                        assert.ok(element, `${skin}/${kind}: missing container`)
                        const bounds = await element.boundingBox()
                        assert.ok(bounds.width > 400 && bounds.height > 300)
                        const overflow = await element.evaluate(
                            (node: HTMLElement) => {
                                // 二次元模板的角落贴纸有意伸出容器，不属于正文溢出。
                                const decorations = [
                                    ...node.querySelectorAll<HTMLElement>(
                                        '.deco-tl, .deco-br'
                                    )
                                ]
                                for (const item of decorations)
                                    item.style.display = 'none'
                                const value =
                                    node.scrollWidth - node.clientWidth
                                for (const item of decorations)
                                    item.style.removeProperty('display')
                                return value
                            }
                        )
                        assert.ok(
                            overflow < 30,
                            `${skin}/${kind}: horizontal overflow ${overflow}`
                        )
                        await element.screenshot({
                            path: path.join(
                                output,
                                `${skin}-${kind}-${theme}.png`
                            )
                        })
                    } finally {
                        await page.close()
                    }
                }
            }
        }
        console.log(
            `Report UI passed: 13 themes × group/user × light/dark. Screenshots: ${output}`
        )
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true })
    }
}
