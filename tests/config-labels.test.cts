import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config'
import { configLabels } from '../client/config-labels'

test('all schema property keys have Chinese display titles without renaming saved keys', () => {
    const visit = (schema: any) => {
        for (const [key, value] of Object.entries(schema.dict || {})) {
            assert.match(configLabels[key] || '', /[\u4e00-\u9fff]/, key)
            visit(value)
        }
        for (const item of schema.list || []) visit(item)
        if (schema.inner) visit(schema.inner)
    }
    visit(Config)
    const config = Config({})
    assert.equal(config.comic.userEnabled, false)
    assert.equal(config.maxConcurrentLLM, 4)
    assert.equal((config.comic as any).userBaseUrl, undefined)
})
