import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    comicCharacterStatePath,
    loadComicReferences,
    selectComicCharacter
} from '../src/comic-characters'

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwXnX3PwAFiAK6ob9qqgAAAABJRU5ErkJggg==',
    'base64'
)

function profiles() {
    return [
        {
            profileName: 'alpha',
            enabled: true,
            persona: '傲娇解说员',
            referenceFiles: []
        },
        {
            profileName: 'beta',
            enabled: true,
            persona: '',
            referenceFiles: ['b.png']
        },
        {
            profileName: 'disabled',
            enabled: false,
            persona: '不会入选',
            referenceFiles: []
        },
        {
            profileName: 'empty',
            enabled: true,
            persona: '   ',
            referenceFiles: []
        }
    ]
}

async function sandbox(t: import('node:test').TestContext) {
    const directory = path.join(
        tmpdir(),
        `comic-characters-${process.pid}-${Math.random().toString(36).slice(2)}`
    )
    await mkdir(directory, { recursive: true })
    t.after(() => rm(directory, { recursive: true, force: true }))
    return directory
}

test('first selection returns the first usable profile', () => {
    const selected = selectComicCharacter(profiles(), 'first', '/nowhere')
    assert.equal(selected?.name, 'alpha')
    assert.equal(selected?.persona, '傲娇解说员')
})

test('empty or unusable profiles fall back to undefined', () => {
    assert.equal(
        selectComicCharacter(undefined, 'first', '/nowhere'),
        undefined
    )
    assert.equal(
        selectComicCharacter(
            [
                {
                    profileName: 'off',
                    enabled: false,
                    persona: 'x',
                    referenceFiles: []
                },
                {
                    profileName: 'blank',
                    enabled: true,
                    persona: ' ',
                    referenceFiles: []
                }
            ],
            'daily',
            '/nowhere'
        ),
        undefined
    )
})

test('daily selection is stable within a day and varies across days', async (t) => {
    const directory = await sandbox(t)
    const statePath = path.join(directory, 'state.json')
    const morning = selectComicCharacter(
        profiles(),
        'daily',
        statePath,
        new Date('2026-10-21T08:00:00')
    )
    assert.ok(morning)
    const afternoon = selectComicCharacter(
        profiles(),
        'daily',
        statePath,
        new Date('2026-10-21T20:00:00')
    )
    assert.equal(afternoon?.name, morning?.name)

    const saved = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(saved.date, '2026-10-21')
    assert.equal(saved.name, morning?.name)

    // 跨天时每天重新随机；直到某天选中不同方案为止。
    let changed = false
    for (let day = 22; day <= 31 && !changed; day += 1) {
        const next = selectComicCharacter(
            profiles(),
            'daily',
            statePath,
            new Date(`2026-10-${day}T08:00:00`)
        )
        changed = next?.name !== morning?.name
    }
    assert.ok(changed, 'daily selection should pick a new profile on a new day')
})

test('a disabled saved profile is reselected on the same day', async (t) => {
    const directory = await sandbox(t)
    const statePath = path.join(directory, 'state.json')
    await writeFile(
        statePath,
        JSON.stringify({ date: '2026-10-21', name: 'disabled' })
    )
    const selected = selectComicCharacter(
        profiles(),
        'daily',
        statePath,
        new Date('2026-10-21T12:00:00')
    )
    assert.ok(selected)
    assert.notEqual(selected?.name, 'disabled')
})

test('a corrupted state file is ignored', async (t) => {
    const directory = await sandbox(t)
    const statePath = path.join(directory, 'state.json')
    await writeFile(statePath, '{broken json')
    const selected = selectComicCharacter(
        profiles(),
        'daily',
        statePath,
        new Date('2026-10-21T12:00:00')
    )
    assert.ok(selected)
    const saved = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(saved.date, '2026-10-21')
})

test('loadComicReferences falls back to the primary reference', async (t) => {
    const directory = await sandbox(t)
    await writeFile(path.join(directory, 'main.png'), png)
    const refs = await loadComicReferences(undefined, 'main.png', directory)
    assert.equal(refs.length, 1)
    assert.ok(refs[0].equals(png))

    const empty = await loadComicReferences(undefined, '', directory)
    assert.deepEqual(empty, [])
})

test('character references win and are truncated to six files', async (t) => {
    const directory = await sandbox(t)
    for (let index = 0; index < 8; index += 1)
        await writeFile(path.join(directory, `ref-${index}.png`), png)
    await writeFile(path.join(directory, 'main.png'), png)
    const character = {
        name: 'multi',
        persona: '',
        referenceFiles: Array.from(
            { length: 8 },
            (_, index) => `ref-${index}.png`
        )
    }
    const refs = await loadComicReferences(character, 'main.png', directory)
    assert.equal(refs.length, 6)
})

test('a broken character reference propagates the read error', async (t) => {
    const directory = await sandbox(t)
    const character = {
        name: 'broken',
        persona: '',
        referenceFiles: ['missing.png']
    }
    await assert.rejects(
        loadComicReferences(character, 'main.png', directory),
        /ENOENT/
    )
})

test('the state path follows the data directory convention', () => {
    const state = comicCharacterStatePath('/base')
    assert.match(
        state.replace(/\\/g, '/'),
        /data\/chatluna\/group_analysis\/comic-character\.json$/
    )
})
