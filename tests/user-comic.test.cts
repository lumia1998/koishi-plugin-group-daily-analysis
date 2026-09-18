import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'koishi'
import { Config } from '../src/config'
import { apply } from '../src/plugins/comic'
import {
    buildUserComicPrompt,
    buildUserComicImagePrompt,
    defaultUserComicPrompt,
    formatUserComicStoryboard
} from '../src/user-comic-prompts'
import { validateUserComicStoryboard } from '../src/service/validation'
import { getUserComicVisualSpec } from '../src/skins/user-comic'
import { persona } from './theme-fixtures.cts'

test('user comic combines structured panels with themed four-dimension reporting', () => {
    const prompt = buildUserComicPrompt(
        Config({}).comic,
        persona,
        true,
        true,
        'BlueArchive'
    )
    assert.equal(prompt.split(defaultUserComicPrompt).length, 2)
    for (const text of [
        '核心人设',
        '语言风格',
        '兴趣',
        '行为特点',
        '总体概览',
        '性格特质',
        '兴趣爱好',
        '沟通风格',
        '固定四维',
        '学院档案',
        'category',
        persona.summary,
        ...persona.evidence
    ])
        assert.ok(prompt.includes(text), text)
    assert.match(prompt, /必须恰好输出 4 格/)
    assert.match(prompt, /不能覆盖此用户的性格/)
    assert.match(prompt, /不得虚构价格、链接、成绩/)
    const imagePrompt = buildUserComicImagePrompt(
        '分镜',
        true,
        true,
        'BlueArchive'
    )
    assert.match(imagePrompt, /附件 1 是用户画像报告/)
    assert.match(imagePrompt, /附件 2 及后续图片/)
    assert.match(imagePrompt, /固定四个编号分镜/)
    const plan = validateUserComicStoryboard({
        panels: [
            {
                category: 'interests',
                scene: 'interest',
                speech: '兴趣',
                caption: '爱好'
            },
            {
                category: 'summary',
                scene: 'summary',
                speech: '总结',
                caption: '用户总结'
            },
            {
                category: 'communicationStyle',
                scene: 'style',
                speech: '说话',
                caption: '沟通风格'
            },
            {
                category: 'keyTraits',
                scene: 'trait',
                speech: '特质',
                caption: '性格特质'
            }
        ]
    })
    const storyboard = formatUserComicStoryboard(plan, persona)
    assert.match(storyboard, /Panel 1 — 总体概览: summary/)
    assert.match(storyboard, /Panel 4 — 沟通风格: style/)
    assert.throws(
        () =>
            validateUserComicStoryboard({
                panels: [
                    {
                        category: 'summary',
                        scene: 'a',
                        speech: 'a',
                        caption: 'a'
                    },
                    {
                        category: 'summary',
                        scene: 'b',
                        speech: 'b',
                        caption: 'b'
                    },
                    {
                        category: 'interests',
                        scene: 'c',
                        speech: 'c',
                        caption: 'c'
                    },
                    {
                        category: 'keyTraits',
                        scene: 'd',
                        speech: 'd',
                        caption: 'd'
                    }
                ]
            }),
        /恰好覆盖/
    )
})

test('all selectable skins resolve to themed user comic direction', () => {
    const skins = [
        'md3',
        'anime',
        'newspaper',
        'art',
        'scrapbook',
        'simple',
        'ATRI',
        'BlueArchive',
        'retro_futurism',
        'art_nouveau',
        'spring_festival',
        'HatsuneMiku',
        'hack'
    ]
    for (const skin of skins) {
        const spec = getUserComicVisualSpec(skin)
        assert.equal(spec.aspectRatio, '3:4', skin)
        assert.equal(spec.size, '1024x1536', skin)
        assert.ok(spec.layout.length > 20, skin)
        assert.ok(spec.artDirection.length > 30, skin)
    }
    assert.notEqual(
        getUserComicVisualSpec('md3').artDirection,
        getUserComicVisualSpec('scrapbook').artDirection
    )
    assert.match(getUserComicVisualSpec('hack').artDirection, /终端审计报告/)
})

test('a parameterless persona root allows the spaced comic subcommand', () => {
    const ctx = new Context()
    const root = ctx.command('用户画像')
    const comic = ctx.command('用户画像.漫画 [user:user]')
    assert.equal((root as any)._arguments.length, 0)
    const argv: any = {
        session: {
            isDirect: true,
            stripped: { appel: true, prefix: '' },
            resolve(value: unknown) {
                return typeof value === 'function'
                    ? (value as Function)(this)
                    : value
            }
        },
        tokens: [
            { content: '用户画像', inters: [] },
            { content: '漫画', inters: [] }
        ]
    }
    ctx.$commander.inferCommand(argv)
    assert.equal(argv.command, comic)
})

test('user comic reads saved profile, shares provider/cooldown and respects persona permissions', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'user-comic-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const reference = path.join(directory, 'reference.png')
    const characterReference = Buffer.from('iVBORw0KGgo=', 'base64')
    const reportReference = Buffer.concat([
        characterReference,
        Buffer.from('report')
    ])
    await fs.writeFile(reference, characterReference)
    const commands: Record<string, Function> = {}
    const events: Record<string, Function> = {}
    let saved: any = { profile: persona, username: persona.username }
    const ids: string[] = []
    let imageCalls = 0
    let textCalls = 0
    const sent: any[] = []
    const storyboard = {
        panels: [
            {
                category: 'summary',
                scene: 'summary scene',
                speech: '总结',
                caption: '用户总结'
            },
            {
                category: 'keyTraits',
                scene: 'traits scene',
                speech: '特质',
                caption: '性格特质'
            },
            {
                category: 'interests',
                scene: 'interests scene',
                speech: '兴趣',
                caption: '兴趣爱好'
            },
            {
                category: 'communicationStyle',
                scene: 'style scene',
                speech: '沟通',
                caption: '沟通风格'
            }
        ]
    }
    const config = Config({
        enableAllGroupsByDefault: true,
        comic: {
            enabled: true,
            userEnabled: true,
            baseUrl: 'https://example.test',
            model: 'image',
            format: 'google'
        }
    })
    const ctx: any = {
        baseDir: process.cwd(),
        on(name: string, callback: Function) {
            events[name] = callback
        },
        bots: [],
        command(name: string) {
            return {
                option() {
                    return this
                },
                alias() {
                    return this
                },
                shortcut() {
                    return this
                },
                action(fn: Function) {
                    commands[name.split(' ')[0]] = fn
                    return this
                }
            }
        },
        chatluna_group_analysis: {
            async getUserPersona(platform: string, selfId: string, id: string) {
                assert.equal(platform, 'onebot')
                assert.equal(selfId, 'bot')
                ids.push(id)
                return saved
            },
            executeUserPersonaAnalysis() {
                assert.fail('must not reanalyze')
            }
        },
        chatluna_group_analysis_message: {
            getHistoricalMessages() {
                assert.fail('must not fetch messages')
            }
        },
        chatluna_group_analysis_renderer: {
            async renderUserPersona(
                profile: any,
                username: string,
                avatar: string,
                passedConfig: any
            ) {
                assert.equal(profile.username, username)
                assert.match(avatar, /qlogo\.cn/)
                assert.equal(passedConfig.skin, config.skin)
                return reportReference
            }
        },
        chatluna_group_analysis_llm: {
            summarizeTopics() {
                assert.fail('must not summarize topics')
            },
            async generateUserComicStoryboard(prompt: string) {
                textCalls++
                assert.match(prompt, /铁路工作者/)
                assert.match(prompt, /必须恰好输出 4 格/)
                return storyboard
            }
        }
    }
    t.mock.method(globalThis, 'fetch', async (_url: any, request: any) => {
        imageCalls++
        const body = JSON.parse(request.body)
        assert.match(body.contents[0].parts[0].text, /固定四个编号分镜/)
        assert.equal(body.generationConfig.imageConfig.aspectRatio, '3:4')
        assert.equal(
            body.contents[0].parts[1].inlineData.data,
            reportReference.toString('base64')
        )
        assert.equal(
            body.contents[0].parts[2].inlineData.data,
            characterReference.toString('base64')
        )
        return new Response(
            JSON.stringify({
                candidates: [
                    {
                        content: {
                            parts: [{ inlineData: { data: 'iVBORw0KGgo=' } }]
                        }
                    }
                ]
            }),
            { headers: { 'Content-Type': 'application/json' } }
        )
    })
    config.comic.referenceImage = reference
    apply(ctx, config)
    const action = commands['用户画像.漫画']
    const session: any = {
        platform: 'onebot',
        selfId: 'bot',
        guildId: 'g',
        channelId: 'g',
        userId: 'self',
        user: { authority: 1 },
        isDirect: false,
        send: async (value: any) => {
            sent.push(value)
            return ['message-id']
        }
    }
    saved = null
    assert.equal(
        await action({ session }),
        '该用户还没有已保存的用户画像，请先使用“用户画像”生成普通画像。'
    )
    assert.equal(imageCalls, 0)
    assert.equal(textCalls, 0)
    saved = { profile: persona, username: persona.username }
    await action({ session })
    assert.equal(ids.at(-1), 'self')
    assert.equal(imageCalls, 1)
    assert.equal(textCalls, 1)
    assert.ok(sent.some((item) => String(item).includes('<img')))
    assert.match(
        await action(
            { session: { ...session, channelId: 'unauthorized' } },
            'onebot:other'
        ),
        /权限等级 3/
    )
    assert.equal(ids.at(-1), 'self')
    assert.equal(imageCalls, 1)
    assert.match(await action({ session }), /冷却/)
    assert.match(
        await commands['群漫画']({ session }),
        /冷却/,
        'group command shares user comic cooldown'
    )
    assert.equal(imageCalls, 1)
    await action(
        {
            session: { ...session, channelId: 'second', user: { authority: 3 } }
        },
        'onebot:other'
    )
    assert.equal(ids.at(-1), 'other')
    assert.equal(imageCalls, 2)
    assert.match(
        await action(
            {
                session: {
                    ...session,
                    channelId: 'third',
                    user: { authority: 3 }
                }
            },
            '123456'
        ),
        /@用户/
    )
    assert.equal(ids.at(-1), 'other')
    assert.equal(imageCalls, 2)
    assert.match(
        await action({ session: { ...session, isDirect: true } }),
        /群聊/
    )
    config.enableAllGroupsByDefault = false
    assert.match(await action({ session }), /未启用群分析/)
    config.enableAllGroupsByDefault = true
    config.comic.userEnabled = false
    assert.match(await action({ session }), /启用漫画服务/)
    assert.equal(imageCalls, 2)

    config.comic.userEnabled = true
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
        started = resolve
    })
    let finish!: (result: typeof storyboard) => void
    ctx.chatluna_group_analysis_llm.generateUserComicStoryboard = async (
        _prompt: string,
        signal: AbortSignal
    ) => {
        assert.equal(signal.aborted, false)
        started()
        return new Promise<typeof storyboard>((resolve) => {
            finish = resolve
        })
    }
    const fresh = { ...session, channelId: 'cancel' }
    const pending = action({ session: fresh })
    await entered
    assert.match(
        await commands['群漫画']({ session: fresh }),
        /正在生成/,
        'cross-input lock'
    )
    const imagesBefore = sent.filter((item) =>
        String(item).includes('<img')
    ).length
    events.dispose()
    finish(storyboard)
    await pending
    assert.equal(imageCalls, 2)
    assert.equal(
        sent.filter((item) => String(item).includes('<img')).length,
        imagesBefore
    )
})
