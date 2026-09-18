import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import {
    buildStoryboardPrompt,
    buildComicImagePrompt,
    formatGroupComicStoryboard
} from '../src/comic-prompts'
import { validateGroupComicStoryboard } from '../src/service/validation'
import { LLMService } from '../src/service/llm'

test('analysis and comic minimum defaults to 50 and accepts custom counts', () => {
    assert.equal(Config({}).minMessages, 50)
    assert.equal(Config({ minMessages: 20 }).minMessages, 20)
    assert.equal(Config({ minMessages: 100 }).minMessages, 100)
})

test('comic covers all topics even with the old three-topic limit saved', () => {
    const config = Config({}).comic
    const topics = Array.from({ length: 7 }, (_, i) => ({
        topic: `主题${i + 1}`,
        detail: '详情',
        contributors: []
    }))
    const prompt = buildStoryboardPrompt(
        { ...config, maxTopics: 3 } as any,
        topics,
        false
    )
    for (const topic of topics) assert.ok(prompt.includes(topic.topic))
    assert.match(prompt, /恰好 7 个 panels/)
    assert.match(prompt, /topicIndex 必须从 1 到 7/)
    assert.match(prompt, /topicTitle 必须逐字复制/)
    assert.match(
        buildComicImagePrompt('story', config, false, topics.length),
        /exactly 7 panels/
    )
})

test('group comic storyboard requires one unique panel for every topic', () => {
    const topics = [
        { topic: '话题一', detail: '详情一', contributors: [] },
        { topic: '话题二', detail: '详情二', contributors: [] }
    ]
    const valid = validateGroupComicStoryboard(
        {
            panels: [
                { topicIndex: 2, topicTitle: '话题二', scene: 'second scene', speech: '第二格', caption: '话题二' },
                { topicIndex: 1, topicTitle: '话题一', scene: 'first scene', speech: '第一格', caption: '话题一' }
            ]
        },
        topics
    )
    const imagePrompt = formatGroupComicStoryboard(valid, topics)
    assert.match(imagePrompt, /Panel 1: first scene/)
    assert.match(imagePrompt, /Source Topic .*话题一/)
    assert.throws(
        () =>
            validateGroupComicStoryboard(
                {
                    panels: [
                        { topicIndex: 2, topicTitle: '话题二', scene: 'a', speech: '甲', caption: '甲' },
                        { topicIndex: 2, topicTitle: '话题二', scene: 'b', speech: '乙', caption: '乙' }
                    ]
                },
                topics
            ),
        /恰好覆盖/
    )
    assert.throws(
        () =>
            validateGroupComicStoryboard(
                {
                    panels: [
                        { topicIndex: 1, topicTitle: '话题二', scene: 'a', speech: '甲', caption: '甲' },
                        { topicIndex: 2, topicTitle: '话题二', scene: 'b', speech: '乙', caption: '乙' }
                    ]
                },
                topics
            ),
        /标题与原始话题不一致/
    )
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
