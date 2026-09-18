import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Config } from '../src/config'
import { RendererService } from '../src/service/renderer'
import { ConcurrencyLimiter } from '../src/service/limiter'
import { skinRegistry, skinSourceMap } from '../src/skins'
import { group, persona } from './theme-fixtures.cts'

test('production initialization installs paired themes and retains source/default fallback', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skin-init-'))
    try {
        const config = Config({ skin: 'md3' })
        const renderer: any = Object.assign(
            Object.create(RendererService.prototype),
            {
                config,
                templateDir: path.join(baseDir, 'templates'),
                ctx: {
                    puppeteer: {
                        page: async () => ({
                            goto: async () => {},
                            close: async () => {}
                        })
                    },
                    setTimeout() {},
                    logger: { error() {} }
                }
            }
        )
        await renderer.init()
        for (const skin of skinRegistry.getAllIds()) {
            config.skin = skin
            const groupPath = await renderer.getSkinPath('template_group.html')
            const userPath = await renderer.getSkinPath('template_user.html')
            assert.equal(path.basename(path.dirname(groupPath)), skin)
            assert.equal(path.basename(path.dirname(userPath)), skin)
            assert.match(await fs.readFile(groupPath, 'utf8'), /\$\{topics\}/)
            if (skinSourceMap[skin])
                assert.match(
                    await fs.readFile(userPath, 'utf8'),
                    new RegExp(`data-profile-theme="${skin}"`)
                )
        }
        config.skin = 'ATRI'
        await fs.unlink(
            path.join(renderer.templateDir, 'ATRI/template_user.html')
        )
        assert.equal(
            path.basename(
                path.dirname(await renderer.getSkinPath('template_user.html'))
            ),
            'anime'
        )
        config.skin = 'unregistered-old-theme'
        assert.equal(
            path.basename(
                path.dirname(await renderer.getSkinPath('template_user.html'))
            ),
            'md3'
        )
    } finally {
        await fs.rm(baseDir, { recursive: true, force: true })
    }
})

for (const skin of skinRegistry.getAllIds()) {
    test(`${skin}: actual group/user render paths preserve fields, empty states and escape text`, async () => {
        const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skin-pair-'))
        let html = ''
        try {
            await fs.cp(
                path.resolve('resources'),
                path.join(baseDir, 'resources'),
                { recursive: true }
            )
            const config = Config({ skin, theme: 'light' })
            const page = {
                goto: async (url: string) => {
                    html = await fs.readFile(fileURLToPath(url), 'utf8')
                },
                evaluate: async () => {},
                close: async () => {},
                $: async (selector: string) => {
                    assert.equal(
                        selector,
                        skinRegistry.getSafe(skin).containerSelector
                    )
                    assert.ok(html.includes(selector.slice(1)))
                    return { screenshot: async () => Buffer.from('image') }
                },
                pdf: async () => Buffer.from('pdf')
            }
            const renderer: any = Object.assign(
                Object.create(RendererService.prototype),
                {
                    config,
                    templateDir: path.join(baseDir, 'resources'),
                    limiter: new ConcurrencyLimiter(1),
                    imageToBase64: async () =>
                        'data:image/png;base64,iVBORw0KGgo=',
                    ctx: {
                        baseDir,
                        puppeteer: { page: async () => page },
                        logger: {
                            info() {},
                            debug() {},
                            warn() {},
                            error() {}
                        },
                        setTimeout() {}
                    }
                }
            )
            for (const theme of ['light', 'dark'] as const) {
                config.theme = theme
                assert.ok(
                    Buffer.isBuffer(
                        await renderer.renderGroupAnalysis(group, config)
                    )
                )
                for (const text of [
                    '群名标记',
                    '热门话题标记',
                    '本期技术顾问标记',
                    '金句内容标记',
                    '锐评总结标记',
                    '活跃排行测试员',
                    group.analysisDate
                ])
                    assert.ok(html.includes(text), `${skin}: ${text}`)
                assert.ok(
                    Buffer.isBuffer(
                        await renderer.renderGroupAnalysisToPdf(group)
                    )
                )
                const file = await renderer.renderGroupAnalysisHtml(
                    group,
                    config
                )
                assert.match(await fs.readFile(file, 'utf8'), /热门话题标记/)
                assert.ok(
                    Buffer.isBuffer(
                        await renderer.renderUserPersona(
                            persona,
                            persona.username,
                            '',
                            config
                        )
                    )
                )
                assert.ok(
                    Buffer.isBuffer(
                        await renderer.renderUserPersonaReferenceImage(
                            persona,
                            persona.username,
                            '',
                            config
                        )
                    )
                )
                for (const text of [
                    persona.userId,
                    persona.username,
                    persona.summary,
                    ...persona.keyTraits,
                    ...persona.interests,
                    persona.communicationStyle,
                    ...persona.evidence,
                    persona.analysisDate!
                ])
                    assert.ok(html.includes(text), `${skin}: ${text}`)
                if (skinSourceMap[skin])
                    assert.ok(html.includes(`data-profile-theme="${skin}"`))
            }
            const attack = '<script>alert(1)</script>" onerror="alert(2)'
            const hostile = JSON.parse(
                JSON.stringify(group).replaceAll(
                    '标记',
                    attack.replaceAll('"', '\\"')
                )
            )
            await renderer.renderGroupAnalysis(hostile, config)
            assert.ok(!html.includes('<script>alert(1)</script>'))
            assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
            await renderer.renderUserPersona(
                {
                    ...persona,
                    summary: attack,
                    keyTraits: [attack],
                    interests: [attack],
                    communicationStyle: attack,
                    evidence: [attack]
                },
                attack,
                '',
                config
            )
            assert.ok(!html.includes('<script>alert(1)</script>'))
            assert.ok(!html.includes('" onerror="alert(2)'))
            assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
            await renderer.renderGroupAnalysis(
                {
                    ...group,
                    topics: [],
                    userTitles: [],
                    goldenQuotes: [],
                    chatQuality: undefined,
                    userStats: []
                },
                config
            )
            assert.match(html, /未生成聊天质量锐评/)
            assert.ok((html.match(/暂无|本次|本期/g) || []).length >= 4)
            await renderer.renderUserPersona(
                {
                    ...persona,
                    summary: '',
                    keyTraits: [],
                    interests: [],
                    communicationStyle: '',
                    evidence: []
                },
                '',
                '',
                config
            )
            assert.ok((html.match(/暂无/g) || []).length >= 5)
        } finally {
            await fs.rm(baseDir, { recursive: true, force: true })
        }
    })
}
