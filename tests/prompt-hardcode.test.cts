import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import { buildStoryboardPrompt } from '../src/comic-prompts'
import { buildUserComicPrompt } from '../src/user-comic-prompts'
import { LLMService } from '../src/service/llm'
import { group, persona } from './theme-fixtures.cts'

test('saved prompt overrides are ignored in favor of built-in prompts', async () => {
    const sentinel = 'LEGACY_CUSTOM_PROMPT_MUST_NOT_RUN'
    const config: any = Config({})
    Object.assign(config, {
        promptTopic: sentinel,
        promptUserTitles: sentinel,
        promptGoldenQuotes: sentinel,
        promptUserPersona: sentinel,
        promptChatQuality: sentinel,
        promptQueryParser: sentinel,
        promptQueryChat: sentinel
    })
    config.comic.prompt = sentinel
    config.comic.userPrompt = sentinel

    const captured: string[] = []
    const service = Object.assign(Object.create(LLMService.prototype), {
        config,
        async _callLLM(prompt: string, label: string) {
            captured.push(prompt)
            if (label === '聊天质量锐评')
                return {
                    title: '质量画像',
                    subtitle: '',
                    dimensions: [],
                    summary: ''
                }
            if (label === '用户画像分析')
                return {
                    ...persona,
                    keyTraits: [...persona.keyTraits],
                    interests: [...persona.interests],
                    evidence: [...persona.evidence]
                }
            if (label === '群分析请求解析')
                return {
                    action: '只分析',
                    keywords: [],
                    topics: [],
                    nicknames: []
                }
            return []
        },
        async _callText(prompt: string) {
            captured.push(prompt)
            return '回复'
        }
    }) as LLMService

    await service.summarizeTopics('消息记录')
    await service.analyzeUserTitles([group.userStats[0]])
    await service.analyzeGoldenQuotes('消息记录', 3)
    await service.analyzeChatQuality('消息记录')
    await service.analyzeUserPersona('1', '用户', [], '消息记录')
    await service.parseGroupQuery({
        query: '今天聊了什么',
        currentTime: '2026-09-18 12:00:00',
        timeZone: 'Asia/Shanghai',
        platform: 'onebot',
        groupName: '测试群'
    })
    await service.replyGroupQuery({
        query: '你怎么看',
        analysisResult: '分析结果',
        currentTime: '2026-09-18 12:00:00',
        groupName: '测试群'
    })

    assert.equal(captured.length, 7)
    for (const prompt of captured) assert.doesNotMatch(prompt, /LEGACY_CUSTOM/)
    assert.match(captured[0], /群聊信息总结/)
    assert.match(captured[4], /专业的社群观察员/)
    assert.match(captured[5], /结构化查询/)

    const storyboard = buildStoryboardPrompt(
        config.comic,
        [{ topic: '测试话题', detail: '测试内容', contributors: [] }],
        false
    )
    assert.doesNotMatch(storyboard, /LEGACY_CUSTOM/)
    assert.match(storyboard, /群聊漫画编剧/)

    const userComic = buildUserComicPrompt(
        config.comic,
        persona,
        false,
        false,
        'md3'
    )
    assert.doesNotMatch(userComic, /LEGACY_CUSTOM/)
    assert.match(userComic, /四维人物观察报告/)
})
