import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Config } from '../src/config'
import { apply } from '../src/plugins/comic'
import {
    buildUserComicPrompt,
    buildUserComicImagePrompt,
    defaultUserComicPrompt
} from '../src/user-comic-prompts'
import { persona } from './theme-fixtures.cts'

test('user prompt maps grounded traits to panels, keeping evidence behind the scenes', () => {
    const prompt = buildUserComicPrompt(Config({}).comic, persona, true)
    assert.equal(prompt.split(defaultUserComicPrompt).length, 2)
    for (const text of [
        '核心人设',
        '语言风格',
        '兴趣',
        '行为特点',
        '反差感',
        '一个特点对应一个分镜',
        persona.summary,
        ...persona.evidence
    ])
        assert.ok(prompt.includes(text), text)
    assert.match(prompt, /不足四个.*三格/)
    assert.match(prompt, /不要把大段聊天记录画进气泡/)
    assert.match(prompt, /不能覆盖此用户的性格/)
    assert.doesNotMatch(buildUserComicImagePrompt('分镜', true), /per topic/)
})

test('user comic reads saved profile, shares provider/cooldown and respects persona permissions', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'user-comic-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const reference = path.join(directory, 'reference.png')
    await fs.writeFile(reference, Buffer.from('iVBORw0KGgo=', 'base64'))
    const commands: Record<string, Function> = {}
    const events: Record<string, Function> = {}
    let saved: any = { profile: persona, username: persona.username }
    const ids: string[] = []
    let imageCalls = 0
    let textCalls = 0
    const sent: any[] = []
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
        chatluna_group_analysis_llm: {
            summarizeTopics() {
                assert.fail('must not summarize topics')
            },
            async generateText(prompt: string) {
                textCalls++
                assert.match(prompt, /铁路工作者/)
                return '四格布局：核心人设、语言风格、兴趣与反差，每格有画像依据。'
            }
        }
    }
    t.mock.method(globalThis, 'fetch', async (_url: any, request: any) => {
        imageCalls++
        const body = JSON.parse(request.body)
        assert.match(body.contents[0].parts[0].text, /一个特点对应一个分镜/)
        assert.equal(body.contents[0].parts[1].inlineData.data, 'iVBORw0KGgo=')
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
        send: async (value: any) => sent.push(value)
    }
    saved = null
    assert.equal(
        await action({ session }),
        '当前用户还没有用户画像，请先生成用户画像。'
    )
    assert.equal(imageCalls, 0)
    assert.equal(textCalls, 0)
    saved = { profile: persona, username: persona.username }
    await action({ session }, 'onebot:other')
    assert.equal(ids.at(-1), 'self')
    assert.equal(imageCalls, 1)
    assert.equal(textCalls, 1)
    assert.ok(sent.some((item) => String(item).includes('<img')))
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
    await action(
        { session: { ...session, channelId: 'third', user: { authority: 3 } } },
        '123456'
    )
    assert.equal(ids.at(-1), '123456')
    assert.match(
        await action({ session: { ...session, isDirect: true } }),
        /群聊/
    )
    config.enableAllGroupsByDefault = false
    assert.match(await action({ session }), /未启用群分析/)
    config.enableAllGroupsByDefault = true
    config.comic.userEnabled = false
    assert.match(await action({ session }), /启用漫画服务/)
    assert.equal(imageCalls, 3)

    config.comic.userEnabled = true
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
        started = resolve
    })
    let finish!: (text: string) => void
    ctx.chatluna_group_analysis_llm.generateText = async (
        _prompt: string,
        _model: unknown,
        signal: AbortSignal
    ) => {
        assert.equal(signal.aborted, false)
        started()
        return new Promise<string>((resolve) => {
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
    finish('四格漫画')
    await pending
    assert.equal(imageCalls, 3)
    assert.equal(
        sent.filter((item) => String(item).includes('<img')).length,
        imagesBefore
    )
    ctx.chatluna_group_analysis_llm.generateText = async () =>
        '画像资料不足，无法生成三个有依据的分镜。'
    assert.match(await action({ session: fresh }), /画像资料不足/)
    assert.equal(imageCalls, 3)
})
