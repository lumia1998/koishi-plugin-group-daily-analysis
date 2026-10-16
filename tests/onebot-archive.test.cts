import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Config } from '../src/config'
import { archiveOneBotReport } from '../src/service/onebot-archive'

const payload = Buffer.from('report image bytes')
const ok = (data: unknown = {}) => ({ retcode: 0, status: 'ok', data })
function fixture(
    handler: (action: string, params: any) => unknown,
    overrides = {}
) {
    const calls: { action: string; params: any }[] = []
    const warnings: string[] = []
    const infos: string[] = []
    const config = Config({
        uploadGroupFile: true,
        uploadGroupAlbum: true,
        ...overrides
    })
    const bot = {
        platform: 'onebot',
        internal: {
            async _request(action: string, params: any) {
                calls.push({ action, params })
                return handler(action, params)
            }
        }
    }
    return {
        calls,
        warnings,
        infos,
        run: (baseDir = '.', format = 'image') =>
            archiveOneBotReport(
                bot,
                '123456',
                payload,
                format,
                config,
                baseDir,
                { warn: (s) => warnings.push(s), info: (s) => infos.push(s) }
            )
    }
}

test('archives bytes across hosts and resolves the selected NapCat album', async () => {
    const f = fixture(
        (action) => {
            if (action === 'get_qun_album_list')
                return ok({
                    album_list: [
                        { album_id: 'a', name: 'other' },
                        { album_id: 'b', name: 'daily' }
                    ]
                })
            if (action === 'get_version_info') return ok({ app_name: 'NapCat' })
            return ok()
        },
        { groupAlbumName: 'daily' }
    )
    await f.run()
    const file = f.calls.find((c) => c.action === 'upload_group_file')!.params
    const album = f.calls.find(
        (c) => c.action === 'upload_image_to_qun_album'
    )!.params
    assert.equal(file.group_id, 123456)
    assert.equal(file.file, `base64://${payload.toString('base64')}`)
    assert.equal(album.file, file.file)
    assert.equal(album.album_id, 'b')
    assert.equal(f.infos.length, 2)
    assert.deepEqual(f.warnings, [])
})

test('failed file retcode is reported but LLBot album still uploads via files', async () => {
    const f = fixture((action) => {
        if (action === 'upload_group_file')
            return {
                retcode: 100,
                status: 'failed',
                wording: 'permission denied'
            }
        if (action === 'get_qun_album_list')
            return { retcode: 1404, status: 'failed' }
        if (action === 'get_group_album_list') return ok([{ album_id: 'a' }])
        if (action === 'get_version_info') return ok({ app_name: 'LLOneBot' })
        return ok()
    })
    await f.run()
    assert.match(f.warnings[0], /retcode=100/)
    const upload = f.calls.find((c) => c.action === 'upload_group_album')!
    assert.deepEqual(upload.params.files, [
        `base64://${payload.toString('base64')}`
    ])
    assert.equal(upload.params.file, undefined)
    assert.equal(f.infos.length, 1)
})

test('missing named album never silently uploads to another album', async () => {
    const f = fixture(() => ok([{ album_id: 'a', name: 'other' }]), {
        uploadGroupFile: false,
        groupAlbumName: 'daily'
    })
    await f.run()
    assert.equal(f.calls.length, 1)
    assert.match(f.warnings[0], /未找到指定相册/)
})

test('only explicit unsupported actions allow fallback; timeouts do not retry', async () => {
    for (const timeout of [true, false]) {
        const f = fixture(
            (action, params) => {
                if (action === 'get_qun_album_list')
                    return ok([{ album_id: 'a' }])
                if (action === 'get_version_info')
                    return ok({ app_name: 'NapCat' })
                if (action === 'upload_image_to_qun_album') {
                    if (timeout) throw new Error(`timeout file=${params.file}`)
                    return { retcode: 1404, status: 'failed' }
                }
                return ok()
            },
            { uploadGroupFile: false }
        )
        await f.run()
        assert.equal(
            f.calls.some((c) => c.action === 'upload_group_album'),
            !timeout
        )
        assert.ok(!f.warnings.join('').includes(payload.toString('base64')))
    }
})

test('shared path is readable during upload and cleaned afterwards; PDF skips albums', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'onebot-archive-'))
    let filename = ''
    try {
        const f = fixture(
            async (action, params) => {
                assert.equal(action, 'upload_group_file')
                filename = params.file
                assert.deepEqual(await readFile(filename), payload)
                assert.ok(params.name.endsWith('.pdf'))
                return ok()
            },
            { groupUploadTransport: 'path' }
        )
        await f.run(dir, 'pdf')
        await assert.rejects(access(filename))
        assert.deepEqual(f.warnings, [])
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
