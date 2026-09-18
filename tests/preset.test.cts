import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    AIMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { Config } from '../src/config'
import { presetMessages } from '../src/service/preset'
import { textRequest, type TextFormat } from '../src/service/api'
import { LLMService } from '../src/service/llm'

function fixture() {
    let current: any = {
        messages: [
            new SystemMessage('温柔的讲解员'),
            new HumanMessage('示例问题'),
            new AIMessage('示例回答')
        ]
    }
    const ctx: any = {
        chatluna: {
            preset: {
                getPreset: (name: string, throws: boolean) => {
                    assert.equal(name, 'narrator')
                    assert.equal(throws, false)
                    return {
                        get value() {
                            return current
                        }
                    }
                }
            },
            promptRenderer: {
                renderPresetTemplate: async (preset: any, variables: any) => {
                    assert.equal(variables.input, variables.prompt)
                    return { messages: preset.messages, variables: [] }
                }
            }
        },
        logger: { info() {}, warn() {}, error() {} }
    }
    return {
        ctx,
        set: (value: any) => {
            current = value
        }
    }
}

test('presets keep message roles and append the analysis contract; edits/removal apply on the next call', async () => {
    const { ctx, set } = fixture()
    const messages = await presetMessages(ctx, 'narrator', '只返回 YAML')
    assert.deepEqual(
        messages.map((m) => m.role),
        ['system', 'user', 'assistant', 'system', 'user']
    )
    assert.equal(messages[0].content, '温柔的讲解员')
    assert.match(messages[3].content, /输出格式/)
    assert.deepEqual(messages.at(-1), { role: 'user', content: '只返回 YAML' })
    set({ messages: [new SystemMessage('新的人格')] })
    assert.equal(
        (await presetMessages(ctx, 'narrator', 'task'))[0].content,
        '新的人格'
    )
    set(undefined)
    await assert.rejects(presetMessages(ctx, 'narrator', 'task'), /不存在/)
    await assert.rejects(
        presetMessages({} as any, 'narrator', 'task'),
        /尚未就绪/
    )
})

test('disabled and empty presets retain a usable task; unsupported content is explicit', async () => {
    assert.deepEqual(await presetMessages({} as any, '', 'task'), [
        { role: 'user', content: 'task' }
    ])
    const { ctx, set } = fixture()
    set({ messages: [] })
    assert.equal(
        (await presetMessages(ctx, 'narrator', 'task')).at(-1)?.content,
        'task'
    )
    set({ messages: [{ getType: () => 'tool', content: 'tool result' }] })
    await assert.rejects(presetMessages(ctx, 'narrator', 'task'), /不支持/)
})

test('all text formats preserve system persona, example roles and final task', async () => {
    const { ctx } = fixture()
    const messages = await presetMessages(ctx, 'narrator', 'task')
    for (const format of ['openai', 'anthropic', 'google'] as TextFormat[]) {
        const config = Config({
            llm: { format, baseUrl: 'https://example.com', model: 'text' }
        })
        const body: any = textRequest(
            config.llm,
            'text',
            'task',
            1,
            messages
        ).body
        if (format === 'openai')
            assert.deepEqual(body.input, messages)
        else if (format === 'anthropic') {
            assert.match(body.system, /温柔的讲解员/)
            assert.deepEqual(
                body.messages.map((m: any) => m.role),
                ['user', 'assistant', 'user']
            )
            assert.equal(body.messages.at(-1).content, 'task')
        } else {
            assert.match(body.systemInstruction.parts[0].text, /温柔的讲解员/)
            assert.deepEqual(
                body.contents.map((m: any) => m.role),
                ['user', 'model', 'user']
            )
            assert.equal(body.contents.at(-1).parts[0].text, 'task')
        }
    }
})

test('LLM requests actually include the preset; query parsing and explicit none bypass it', async (t) => {
    const { ctx } = fixture()
    const config = Config({
        preset: 'narrator',
        llm: { baseUrl: 'https://example.com', model: 'text' }
    })
    const service = Object.assign(Object.create(LLMService.prototype), {
        config,
        ctx
    }) as LLMService
    const bodies: any[] = []
    let output = '[{"topic":"test","contributors":[],"detail":"details"}]'
    t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
        bodies.push(JSON.parse(init.body))
        return new Response(
            JSON.stringify({
                output: [
                    {
                        type: 'message',
                        content: [{ type: 'output_text', text: output }]
                    }
                ]
            })
        )
    })
    assert.equal((await service.summarizeTopics('messages'))[0].topic, 'test')
    assert.equal(bodies[0].input[0].content, '温柔的讲解员')
    assert.match(bodies[0].input.at(-1).content, /messages/)
    output = '{"action":"只分析"}'
    await service.parseGroupQuery({
        query: '过去三小时',
        currentTime: '2026-09-11',
        timeZone: 'Asia/Hong_Kong',
        platform: 'onebot',
        groupName: '测试群'
    })
    assert.equal(typeof bodies[1].input, 'string')
    await service.generateText('task', undefined, undefined, '')
    assert.equal(bodies[2].input, 'task')
})
