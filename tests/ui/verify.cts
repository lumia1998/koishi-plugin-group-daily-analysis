import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Config } from '../../src/config'
import { verifyReports } from './reports.cts'

async function main() {
    const { createServer } = require('vite')
    const vue = require('@vitejs/plugin-vue')
    const puppeteer = require('puppeteer-core')
    const candidates = [
        process.env.BROWSER_EXECUTABLE,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome'
    ].filter(Boolean)
    let executablePath: string | undefined
    for (const candidate of candidates) {
        try {
            await fs.access(candidate!)
            executablePath = candidate
            break
        } catch {}
    }
    assert.ok(
        executablePath,
        'Set BROWSER_EXECUTABLE to an installed Chromium browser.'
    )
    const headings = Config.list!.map((item) => item.meta.description)
    const server = await createServer({
        configFile: false,
        root: process.cwd(),
        optimizeDeps: { entries: ['tests/ui/index.html'] },
        plugins: [
            vue.default?.() || vue(),
            {
                name: 'test-headings',
                configureServer(server: any) {
                    server.middlewares.use(
                        '/test-headings.json',
                        (_req: any, res: any) => {
                            res.setHeader('Content-Type', 'application/json')
                            res.end(JSON.stringify(headings))
                        }
                    )
                }
            }
        ],
        server: { host: '127.0.0.1', port: 0 }
    })
    await server.listen()
    const browser = await puppeteer.launch({ executablePath, headless: true })
    try {
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('pageerror', (error: Error) => errors.push(error.message))
        await page.setViewport({ width: 1440, height: 1000 })
        await page.goto(`${server.resolvedUrls.local[0]}tests/ui/index.html`)
        async function assertCentered() {
            await page.waitForFunction(() => {
                const nav = document
                    .querySelector('.group-analysis-navigation')!
                    .getBoundingClientRect()
                const panel = document
                    .querySelector('.plugin-view')!
                    .getBoundingClientRect()
                const content = document.querySelector('.k-content')!
                const textLeft =
                    content.getBoundingClientRect().left +
                    parseFloat(getComputedStyle(content).paddingLeft)
                const expectedLeft = document
                    .querySelector('.group-analysis-navigation')!
                    .classList.contains('is-compact')
                    ? panel.left + 16
                    : Math.max(
                          panel.left + 16,
                          panel.left + (textLeft - panel.left - nav.width) / 2
                      )
                return (
                    Math.abs(nav.left - expectedLeft) < 1 &&
                    Math.abs(
                        nav.top + nav.height / 2 - panel.top - panel.height / 2
                    ) < 1
                )
            })
            const bounds = await page.$eval(
                '.group-analysis-navigation',
                (node: Element) => {
                    const nav = node.getBoundingClientRect()
                    const panel = document
                        .querySelector('.plugin-view')!
                        .getBoundingClientRect()
                    return {
                        left: nav.left,
                        panelLeft: panel.left,
                        center: nav.top + nav.height / 2,
                        panelCenter: panel.top + panel.height / 2,
                        top: nav.top,
                        bottom: nav.bottom,
                        panelTop: panel.top,
                        panelBottom: panel.bottom
                    }
                }
            )
            assert.ok(bounds.left >= bounds.panelLeft + 16)
            assert.ok(Math.abs(bounds.center - bounds.panelCenter) < 1)
            assert.ok(bounds.top >= bounds.panelTop)
            assert.ok(bounds.bottom <= bounds.panelBottom)
        }
        const links = '.navigation-links > a'
        await page.waitForFunction(
            (count: number) =>
                document.querySelectorAll('.navigation-links > a').length ===
                count,
            {},
            headings.length
        )
        assert.deepEqual(
            await page.$$eval(links, (nodes: Element[]) =>
                nodes.map((node) => node.textContent)
            ),
            headings
        )
        const desktopPosition = await page.$eval(
            '.group-analysis-navigation',
            (node: Element) => {
                const nav = node.getBoundingClientRect()
                const view = document.querySelector('.plugin-view')!
                const form = document.querySelector('.k-schema-left')!
                return {
                    left: nav.left,
                    right: nav.right,
                    top: nav.top,
                    panelLeft: view.getBoundingClientRect().left,
                    panelTop: view.getBoundingClientRect().top,
                    formLeft: form.getBoundingClientRect().left
                }
            }
        )
        assert.ok(desktopPosition.left > desktopPosition.panelLeft)
        assert.ok(desktopPosition.right < desktopPosition.formLeft)
        assert.ok(desktopPosition.top > desktopPosition.panelTop)
        await assertCentered()
        await page.click('.navigation-toggle')
        await assertCentered()
        await page.click('.navigation-toggle')
        await assertCentered()
        await page.click(`${links}:nth-child(5)`)
        assert.equal(
            await page.$eval(
                '.k-schema-left h3 > span:not(.prefix)',
                (node: HTMLElement) => node.dataset.configLabel
            ),
            '详细日志'
        )
        assert.equal(
            await page.$eval(
                '.k-schema-left h3 > span:not(.prefix)',
                (node: Element) => getComputedStyle(node, '::after').content
            ),
            '"详细日志"'
        )
        await page.waitForFunction(() => {
            const top = document
                .querySelectorAll('.k-schema-header')[4]
                .getBoundingClientRect().top
            const panelTop = document
                .querySelector('.plugin-view')!
                .getBoundingClientRect().top
            return top >= panelTop && top < panelTop + 60
        })
        assert.equal(
            await page.$eval(
                '.group-analysis-navigation',
                (node: Element) => node.getBoundingClientRect().top
            ),
            desktopPosition.top
        )
        assert.equal(
            await page.$eval(`${links}:nth-child(5)`, (node: Element) =>
                node.getAttribute('aria-current')
            ),
            'location'
        )
        await page.evaluate(() => (window as any).addSection())
        await page.waitForFunction(
            (count: number) =>
                document.querySelectorAll('.navigation-links > a').length ===
                count,
            {},
            headings.length + 1
        )
        await assertCentered()
        await page.evaluate(() => (window as any).addLegacySections())
        await page.waitForFunction(
            (count: number) =>
                document.querySelectorAll('.k-schema-header').length === count,
            {},
            headings.length + 3
        )
        assert.deepEqual(
            await page.$$eval(links, (nodes: Element[]) =>
                nodes.map((node) => node.textContent)
            ),
            [...headings, '延迟加载设置']
        )
        await page.evaluate(() =>
            (window as any).changePlugin('unrelated-plugin')
        )
        await page.waitForFunction(
            () => !document.querySelector('.group-analysis-navigation')
        )
        assert.equal(
            await page.$$eval(
                '[id^="group-analysis-config-"]',
                (nodes: Element[]) => nodes.length
            ),
            0
        )
        assert.equal(
            await page.$$eval(
                '.group-analysis-config-label, .group-analysis-config-prefix',
                (nodes: Element[]) => nodes.length
            ),
            0
        )
        assert.equal(
            await page.$eval(
                '.k-schema-left h3 > span:not(.prefix)',
                (node: Element) => node.getAttribute('aria-label')
            ),
            null
        )
        assert.equal(
            await page.$eval('.plugin-view', (node: Element) =>
                node.classList.contains('group-analysis-navigation-wide')
            ),
            false
        )
        await page.evaluate(() =>
            (window as any).changePlugin('group-analysis')
        )
        await page.waitForSelector('.group-analysis-navigation')
        assert.equal(
            await page.$$eval(links, (nodes: Element[]) =>
                nodes.some((node) =>
                    ['过滤器设置', '运行日志'].includes(node.textContent || '')
                )
            ),
            false
        )
        await page.evaluate(() =>
            document.querySelector('.el-scrollbar__wrap')!.scrollTo(0, 0)
        )
        await page.mouse.move(0, 0)
        await fs.mkdir('artifacts/navigation', { recursive: true })
        await page.screenshot({ path: 'artifacts/navigation/desktop.png' })
        await page.evaluate(() =>
            document.documentElement.classList.add('dark')
        )
        await page.screenshot({ path: 'artifacts/navigation/dark.png' })
        await page.evaluate(() =>
            document.documentElement.classList.remove('dark')
        )
        for (const width of [1920, 2560]) {
            await page.setViewport({ width, height: 1080 })
            await assertCentered()
            assert.ok(
                await page.$eval(
                    '.group-analysis-navigation',
                    (node: Element) =>
                        node.getBoundingClientRect().right <
                        document
                            .querySelector('.k-schema-left')!
                            .getBoundingClientRect().left
                )
            )
            if (width === 1920)
                await page.screenshot({
                    path: 'artifacts/navigation/desktop-wide.png'
                })
        }
        await page.setViewport({ width: 1280, height: 1000 })
        await page.waitForFunction(() =>
            document
                .querySelector('.group-analysis-navigation')
                ?.classList.contains('is-compact')
        )
        await assertCentered()
        assert.equal(
            await page.$eval('.navigation-toggle', (node: Element) =>
                node.getAttribute('aria-expanded')
            ),
            'false'
        )
        assert.equal(
            await page.$eval('.plugin-view', (node: Element) =>
                node.classList.contains('group-analysis-navigation-wide')
            ),
            false
        )
        await page.click('.navigation-toggle')
        await page.click(`${links}:nth-child(3)`)
        await page.waitForFunction(
            () =>
                document
                    .querySelector('.navigation-toggle')
                    ?.getAttribute('aria-expanded') === 'false'
        )
        await page.setViewport({ width: 1440, height: 1000 })
        await page.waitForFunction(() =>
            document
                .querySelector('.plugin-view')
                ?.classList.contains('group-analysis-navigation-wide')
        )
        await assertCentered()
        await page.setViewport({ width: 390, height: 844 })
        await page.reload()
        await page.waitForSelector('.navigation-toggle')
        assert.equal(
            await page.$eval('.navigation-toggle', (node: Element) =>
                node.getAttribute('aria-expanded')
            ),
            'false'
        )
        const mobilePosition = await page.$eval(
            '.group-analysis-navigation',
            (node: Element) => {
                const bounds = node.getBoundingClientRect()
                return { left: bounds.left, right: bounds.right }
            }
        )
        assert.equal(mobilePosition.left, 16)
        assert.ok(mobilePosition.right < 390 / 2 + 16)
        await assertCentered()
        await page.click('.navigation-toggle')
        await page.click(`${links}:nth-child(3)`)
        await page.waitForFunction(
            () =>
                document
                    .querySelector('.navigation-toggle')
                    ?.getAttribute('aria-expanded') === 'false'
        )
        await page.click('.navigation-toggle')
        await assertCentered()
        await page.screenshot({ path: 'artifacts/navigation/mobile.png' })
        await page.setViewport({ width: 390, height: 400 })
        await assertCentered()
        assert.deepEqual(errors, [])
        console.log(
            `UI passed: ${headings.length} actual schema sections, centered in left gutter and vertical centering, click/scroll highlight, dynamic sections, plugin isolation, cleanup, resize, desktop/wide/dark/mobile/short screen. Screenshots: ${path.resolve('artifacts/navigation')}`
        )
        await verifyReports(browser)
    } finally {
        await browser.close()
        await server.close()
    }
}
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
