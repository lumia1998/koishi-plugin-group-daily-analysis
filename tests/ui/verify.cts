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
            return top >= 0 && top < 60
        })
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
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.mouse.move(0, 0)
        await fs.mkdir('artifacts/navigation', { recursive: true })
        await page.screenshot({ path: 'artifacts/navigation/desktop.png' })
        await page.evaluate(() =>
            document.documentElement.classList.add('dark')
        )
        await page.screenshot({ path: 'artifacts/navigation/dark.png' })
        await page.setViewport({ width: 390, height: 844 })
        await page.reload()
        await page.waitForSelector('.navigation-toggle')
        assert.equal(
            await page.$eval('.navigation-toggle', (node: Element) =>
                node.getAttribute('aria-expanded')
            ),
            'false'
        )
        await page.click('.navigation-toggle')
        await page.click(`${links}:nth-child(3)`)
        await page.waitForFunction(
            () =>
                document
                    .querySelector('.navigation-toggle')
                    ?.getAttribute('aria-expanded') === 'false'
        )
        await page.click('.navigation-toggle')
        await page.screenshot({ path: 'artifacts/navigation/mobile.png' })
        assert.deepEqual(errors, [])
        console.log(
            `UI passed: ${headings.length} actual schema sections, click/scroll highlight, dynamic sections, plugin isolation, cleanup, links, desktop/dark/mobile. Screenshots: ${path.resolve('artifacts/navigation')}`
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
