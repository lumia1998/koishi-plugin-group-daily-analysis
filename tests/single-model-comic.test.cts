import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import { buildGroupComicImagePrompt } from '../src/comic-prompts'
import { LLMService } from '../src/service/llm'

test('analysis and comic minimum defaults to 50 and accepts custom counts', () => {
    assert.equal(Config({}).minMessages, 50)
    assert.equal(Config({ minMessages: 20 }).minMessages, 20)
    assert.equal(Config({ minMessages: 100 }).minMessages, 100)
})

test('group comic image prompt reads the complete report and keeps one panel per topic', () => {
    const prompt = buildGroupComicImagePrompt(
        Config({}).comic,
        true,
        true,
        2,
        'BlueArchive'
    )
    assert.match(prompt, /完整的群分析报告图片/)
    assert.match(prompt, /查看附件 1 的今日话题部分/)
    assert.match(prompt, /每个话题分别创作一个独立分镜/)
    assert.match(prompt, /当前报告中应有 2 个话题/)
    assert.match(prompt, /附件 2 及后续图片是配置页中的主要主持角色参考图/)
    assert.doesNotMatch(prompt, /JSON|storyboard|speech|caption/)
})

test('module model options are absent and saved overrides do not affect requests', async () => {
    const keys = [
        'topicModel',
        'titleModel',
        'goldenQuoteModel',
        'qualityModel',
        'personaModel',
        'queryModel',
        'chatModel',
        'comicModel'
    ]
    const schema = JSON.stringify(Config)
    for (const key of keys) assert.ok(!schema.includes(`"${key}"`))
    const config = Config({})
    Object.assign(config.llm, {
        model: 'main',
        topicModel: 'old-topic',
        titleModel: 'old-title',
        qualityModel: 'old-quality'
    })
    const service: any = Object.assign(Object.create(LLMService.prototype), {
        config,
        ctx: { logger: { info() {}, warn() {}, error() {} } }
    })
    const overrides: unknown[] = []
    service._callLLM = async (
        _prompt: string,
        _task: string,
        model: unknown
    ) => {
        overrides.push(model)
        return []
    }
    await service.summarizeTopics('messages')
    await service.analyzeUserTitles([])
    await service.analyzeGoldenQuotes('messages', 5)
    assert.deepEqual(overrides, [undefined, undefined, undefined])
})
