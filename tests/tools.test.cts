import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref } from '@vue/reactivity'
import { apply } from '../src/plugins/tool'
import { Config } from '../src/config'

async function setup() {
    const events: Record<string, Function[]> = {}
    const disposers: Function[] = []
    const registry = new Map<string, any>()
    const filters: any[] = []
    const personaCalls: any[] = []
    let installed = 0
    const ctx: any = {
        on(name: string, cb: Function) {
            ;(events[name] ||= []).push(cb)
        },
        effect(cb: Function) {
            const dispose = cb()
            if (dispose) disposers.push(dispose)
        },
        chatluna: {
            installPlugin() {
                installed++
            },
            uninstallPlugin() {
                installed--
            },
            platform: {
                listPlatformModels: () => ref([]),
                registerTool(name: string, tool: any) {
                    registry.set(name, tool)
                    return () => registry.delete(name)
                }
            }
        },
        chatluna_group_analysis_message: {
            async getHistoricalMessages(filter: any) {
                filters.push(filter)
                return [
                    {
                        id: '1',
                        userId: 'u',
                        username: '用户',
                        timestamp: new Date(),
                        content: 'hello'
                    }
                ]
            }
        },
        chatluna_group_analysis: {
            async getUserPersona(...args: any[]) {
                personaCalls.push(args)
                return {
                    username: '用户',
                    profile: {
                        userId: args[2],
                        summary: '画像内容',
                        keyTraits: [],
                        interests: [],
                        evidence: []
                    }
                }
            }
        }
    }
    apply(ctx, Config({}))
    for (const cb of events.ready || []) await cb()
    return {
        registry,
        filters,
        personaCalls,
        installed: () => installed,
        async dispose() {
            for (const cb of disposers.reverse()) await cb()
            for (const cb of events.dispose || []) await cb()
        }
    }
}

test('real ChatLuna registration supports both tool invoke schemas and disposal', async () => {
    const fixture = await setup()
    const session = {
        platform: 'onebot',
        selfId: 'bot',
        guildId: 'g',
        channelId: 'c',
        isDirect: false
    }
    const options = { configurable: { session } }
    try {
        assert.deepEqual(
            [...fixture.registry.keys()],
            ['group_message_fetch', 'group_user_persona']
        )
        assert.equal(fixture.installed(), 1)
        const messages = fixture.registry
            .get('group_message_fetch')
            .createTool()
        assert.ok(fixture.registry.get('group_message_fetch').selector())
        const output = JSON.parse(
            await messages.invoke(
                { filter: { limit: 20, startTime: '1 hour ago' } },
                options
            )
        )
        assert.equal(output.count, 1)
        assert.equal(fixture.filters[0].platform, 'onebot')
        assert.equal(fixture.filters[0].selfId, 'bot')
        assert.equal(fixture.filters[0].channelId, 'c')
        assert.ok(fixture.filters[0].startTime instanceof Date)
        await assert.rejects(
            messages.invoke({ filter: { limit: -1 } }, options)
        )
        await assert.rejects(
            messages.invoke({ filter: { offset: 0.5 } }, options)
        )
        assert.match(await messages.invoke({}, {}), /Session context/)
        assert.match(
            await messages.invoke(
                {},
                { configurable: { session: { ...session, isDirect: true } } }
            ),
            /private messages/
        )
        const persona = fixture.registry.get('group_user_persona').createTool()
        assert.equal(
            JSON.parse(await persona.invoke({ user_id: 'u' }, options)).summary,
            '画像内容'
        )
        assert.deepEqual(fixture.personaCalls, [['onebot', 'bot', 'u']])
        assert.equal(fixture.personaCalls.length, 1)
        assert.match(
            await persona.invoke({ user_id: 'u' }, {}),
            /Session context/
        )
    } finally {
        await fixture.dispose()
    }
    assert.equal(fixture.registry.size, 0)
    assert.equal(fixture.installed(), 0)
})
