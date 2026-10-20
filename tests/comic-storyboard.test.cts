import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import {
    buildComicRewritePrompt,
    buildComicStoryboardPrompt,
    buildStoryboardImagePrompt,
    parseComicStoryboard
} from '../src/comic-storyboard'
import { LLMService } from '../src/service/llm'

const topics = [
    { topic: '云服务器又断网', contributors: ['a'], detail: '家里云深夜断连' },
    { topic: '新模型发布', contributors: ['b'], detail: '大家讨论新模型跑分' }
]

function createService(generateText: (prompt: string) => Promise<string>) {
    const config = Config({})
    const service: any = Object.assign(Object.create(LLMService.prototype), {
        config,
        ctx: { logger: { info() {}, warn() {}, error() {} } },
        generateText
    })
    return service as LLMService
}

test('storyboard prompt covers every topic with the persona voice', () => {
    const prompt = buildComicStoryboardPrompt(topics, '傲娇猫娘')
    assert.match(prompt, /资深漫画分镜师/)
    assert.match(prompt, /傲娇猫娘/)
    assert.match(prompt, /共有 2 个话题/)
    assert.match(prompt, /Panel 1 到 Panel 2/)
    assert.match(prompt, /1\. 话题：云服务器又断网/)
    assert.match(prompt, /详情：家里云深夜断连/)
    assert.match(prompt, /2\. 话题：新模型发布/)
    assert.match(prompt, /exact Chinese text/)
    assert.match(prompt, /STRICT RULE: DO NOT render the background context/)
    assert.match(prompt, /"scene"/)
    assert.match(prompt, /纯 JSON/)
})

test('storyboard prompt falls back to a neutral persona', () => {
    const prompt = buildComicStoryboardPrompt(topics)
    assert.match(prompt, /活泼、友好、偶尔嘴贫的群聊观察员/)
})

test('parse accepts a plain scene object', () => {
    const scene =
        'Panel 1: host reacts containing a speech bubble with exact Chinese text "又断网啦"'
    assert.equal(parseComicStoryboard(JSON.stringify({ scene })), scene)
})

test('parse strips json fences and merges sibling panel fields', () => {
    const text =
        '```json\n{"scene": "A 2-panel comic overview.", "panel1": "Panel 1: first joke", "panel2": "Panel 2: second joke"}\n```'
    const scene = parseComicStoryboard(text)
    assert.match(scene, /A 2-panel comic overview\./)
    assert.match(scene, /Panel 1: first joke/)
    assert.match(scene, /Panel 2: second joke/)
})

test('parse keeps a complete inline scene without merging extras', () => {
    const scene =
        'Panel 1: a. Panel 2: b containing a speech bubble with exact Chinese text "好"'
    const parsed = parseComicStoryboard(
        JSON.stringify({ scene, note: 'unused note text' })
    )
    assert.equal(parsed, scene)
})

test('parse consolidates nested objects and arrays without a scene field', () => {
    const nested = parseComicStoryboard(
        JSON.stringify({
            panels: [{ text: 'Panel one text' }, { text: 'Panel two text' }]
        })
    )
    assert.match(nested, /Panel one text/)
    assert.match(nested, /Panel two text/)

    const list = parseComicStoryboard(
        JSON.stringify(['Panel A details', 'Panel B details'])
    )
    assert.match(list, /Panel A details/)
    assert.match(list, /Panel B details/)
})

test('parse recovers the scene from broken json with a regex', () => {
    const text = '前置说明 {"scene": "Panel 1: host says \\"早\\"",, 垃圾'
    const scene = parseComicStoryboard(text)
    assert.match(scene, /Panel 1: host says "早"/)
})

test('parse rejects empty or too short scenes', () => {
    assert.throws(
        () => parseComicStoryboard(''),
        /分镜模型未返回有效的分镜内容/
    )
    assert.throws(
        () => parseComicStoryboard('{"scene": "短"}'),
        /分镜模型未返回有效的分镜内容/
    )
    assert.throws(
        () => parseComicStoryboard('not json'),
        /分镜模型未返回有效的分镜内容/
    )
})

test('storyboard image prompt includes the reference count or stays minimal', () => {
    const withRefs = buildStoryboardImagePrompt('Panel 1: host', 2)
    assert.match(withRefs, /共 2 张/)
    assert.match(withRefs, /角色外观以附件为准/)
    assert.match(withRefs, /每个分格都必须出现同一位主持角色/)
    assert.match(withRefs, /Panel 1: host/)

    const withoutRefs = buildStoryboardImagePrompt('Panel 1: host', 0)
    assert.doesNotMatch(withoutRefs, /附件/)
    assert.match(withoutRefs, /只输出最终图片/)
})

test('rewrite prompt keeps the contract fields', () => {
    const prompt = buildComicRewritePrompt('原提示词', '内容违规')
    assert.match(prompt, /原提示词/)
    assert.match(prompt, /内容违规/)
    assert.match(prompt, /can_fix/)
    assert.match(prompt, /new_prompt/)
    assert.match(prompt, /纯 JSON/)
})

test('generateComicStoryboard retries after a parse failure', async () => {
    let calls = 0
    const service = createService(async () => {
        calls += 1
        return calls === 1
            ? 'not json at all'
            : '{"scene": "Panel 1: ok scene"}'
    })
    const scene = await service.generateComicStoryboard(topics, '设定')
    assert.equal(scene, 'Panel 1: ok scene')
    assert.equal(calls, 2)
})

test('generateComicStoryboard respects the abort signal', async () => {
    const controller = new AbortController()
    let calls = 0
    const service = createService(async () => {
        calls += 1
        controller.abort()
        return 'still not json'
    })
    await assert.rejects(
        service.generateComicStoryboard(topics, undefined, controller.signal),
        /分镜模型未返回有效的分镜内容/
    )
    assert.equal(calls, 1)
})

test('rewriteComicPrompt returns a rewritten prompt only when fixable', async () => {
    const service = createService(
        async () => '{"can_fix": true, "new_prompt": "  新提示词  "}'
    )
    assert.equal(
        await service.rewriteComicPrompt('原提示词', '错误'),
        '新提示词'
    )

    const refuse = createService(
        async () => '{"can_fix": false, "new_prompt": ""}'
    )
    assert.equal(await refuse.rewriteComicPrompt('原提示词', '错误'), undefined)

    const invalid = createService(async () => '完全不是 JSON')
    assert.equal(
        await invalid.rewriteComicPrompt('原提示词', '错误'),
        undefined
    )

    const fenced = createService(
        async () => '```json\n{"can_fix":true,"new_prompt":"围栏里的"}\n```'
    )
    assert.equal(
        await fenced.rewriteComicPrompt('原提示词', '错误'),
        '围栏里的'
    )
})

test('rewriteComicPrompt swallows generation errors and warns', async () => {
    let warned = 0
    const config = Config({})
    const service: any = Object.assign(Object.create(LLMService.prototype), {
        config,
        ctx: {
            logger: {
                info() {},
                warn() {
                    warned += 1
                },
                error() {}
            }
        },
        async generateText() {
            throw new Error('网络失败')
        }
    })
    assert.equal(
        await service.rewriteComicPrompt('原提示词', '错误'),
        undefined
    )
    assert.equal(warned, 1)
})
