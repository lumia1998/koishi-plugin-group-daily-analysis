import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import { LLMService } from '../src/service/llm'
import { formatChatQuality, generateTextReport } from '../src/utils'
import { skinRegistry } from '../src/skins'

const endpoint = 'https://provider.example'

test('chat quality review validates dimensions and appears in report formatters', async (t) => {
    const config = Config({})
    config.llm.baseUrl = endpoint
    config.llm.model = 'text-model'
    config.llm.retryCount = 0
    const service = Object.create(LLMService.prototype) as LLMService
    service.config = config
    service.ctx = { logger: { info() {}, warn() {}, error() {} } } as any
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'title: 质量\nsubtitle: 稳定\ndimensions:\n  - name: 互动性\n    percentage: 30\n    comment: 好\n  - name: 信息密度\n    percentage: 70\n    comment: 高\nsummary: 总体良好' }] }] }), { headers: { 'content-type': 'application/json' } }))
    const quality = await service.analyzeChatQuality('a message')
    assert.equal(quality?.dimensions.reduce((sum, item) => sum + item.percentage, 0), 100)
    assert.match(formatChatQuality(quality), /互动性/)
    assert.match(generateTextReport({ totalMessages: 1, totalChars: 1, totalParticipants: 1, emojiCount: 0, mostActiveUser: null, mostActivePeriod: '12:00', userStats: [], topics: [], userTitles: [], goldenQuotes: [], activeHoursChart: '', activeHoursData: {}, analysisDate: 'today', groupName: 'g', chatQuality: quality }), /聊天质量锐评/)
    t.mock.restoreAll()
})

test('text API retries with configured backoff and exposes additional skins', async (t) => {
    const config = Config({})
    config.llm.baseUrl = endpoint
    config.llm.model = 'text-model'
    config.llm.retryCount = 1
    config.llm.retryBackoffSeconds = 0
    const service = Object.create(LLMService.prototype) as LLMService
    service.config = config
    service.ctx = { logger: { info() {}, warn() {}, error() {} } } as any
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
        calls += 1
        if (calls === 1) return new Response('failed', { status: 503 })
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { headers: { 'content-type': 'application/json' } })
    })
    assert.equal(await service.generateText('hello'), 'ok')
    assert.equal(calls, 2)
    assert.ok(skinRegistry.has('BlueArchive'))
    t.mock.restoreAll()
})
