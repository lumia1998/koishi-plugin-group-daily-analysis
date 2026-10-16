import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Config } from '../config'
import { errorDetail } from '../diagnostics'

interface ArchiveBot {
    platform: string
    internal?: {
        _request?: (
            action: string,
            params: Record<string, unknown>
        ) => Promise<unknown>
    }
}

interface ArchiveLogger {
    info(message: string): void
    warn(message: string): void
}

class ActionError extends Error {
    constructor(
        message: string,
        readonly unsupported = false
    ) {
        super(message)
    }
}

/** Raw OneBot requests resolve even when the protocol returns a failure. */
async function call(
    bot: ArchiveBot,
    action: string,
    params: Record<string, unknown>
) {
    const response = await bot.internal!._request!.call(
        bot.internal,
        action,
        params
    )
    if (!response || typeof response !== 'object')
        throw new ActionError(`${action}: 返回了无效响应`)
    const value = response as Record<string, unknown>
    if (value.retcode === 0 && value.status !== 'failed') return value.data
    const detail = String(value.wording || value.message || value.msg || '')
    throw new ActionError(
        `${action}: retcode=${String(value.retcode)}, status=${String(value.status)} ${detail}`,
        value.retcode === 1404 ||
            /(?:unsupported action|action.*not (?:supported|found)|unknown action|不支持.*(?:接口|API)|(?:接口|API).*不支持|不存在的接口|未实现)/i.test(
                detail
            )
    )
}

async function callSupported(
    bot: ArchiveBot,
    actions: string[],
    params: Record<string, unknown>
) {
    for (let i = 0; i < actions.length; i++) {
        try {
            return await call(bot, actions[i], params)
        } catch (error) {
            // Only an explicit unsupported action is safe to try under another name.
            if (
                !(error instanceof ActionError) ||
                !error.unsupported ||
                i === actions.length - 1
            )
                throw error
        }
    }
}

function albumList(data: unknown): Record<string, unknown>[] {
    if (Array.isArray(data))
        return data.filter((item) => item && typeof item === 'object')
    if (!data || typeof data !== 'object') return []
    const value = data as Record<string, unknown>
    return albumList(
        value.album_list ?? value.albums ?? value.list ?? value.data
    )
}

export async function archiveOneBotReport(
    bot: ArchiveBot,
    groupId: string,
    payload: Buffer,
    format: string,
    config: Config,
    baseDir: string,
    logger: ArchiveLogger
): Promise<void> {
    if (
        bot?.platform !== 'onebot' ||
        (!config.uploadGroupFile && !config.uploadGroupAlbum)
    )
        return
    if (typeof bot.internal?._request !== 'function') {
        logger.warn('报告归档失败：OneBot 未连接或缺少请求接口。')
        return
    }
    const group = Number(groupId)
    if (!/^\d+$/.test(groupId) || !Number.isSafeInteger(group) || group <= 0) {
        logger.warn('报告归档失败：目标群号无效。')
        return
    }
    const name = `report-${Date.now()}-${randomUUID().slice(0, 8)}.${format === 'pdf' ? 'pdf' : 'png'}`
    let localFile: string | undefined
    const mode = config.groupUploadTransport || 'base64'
    let content = `base64://${payload.toString('base64')}`
    const failure = (target: string, error: unknown) => {
        // Adapter errors may echo the full request; never log image bytes or credentials.
        const message = errorDetail(error, [content]).replace(
            /base64:\/\/[^\s"'<>]+/g,
            '[图片数据已隐藏]'
        )
        logger.warn(`${target}归档失败（群 ${groupId}，${mode}）：${message}`)
    }
    try {
        if (mode === 'path') {
            const dir = path.resolve(
                baseDir,
                'data/chatluna/group_analysis/archive'
            )
            await mkdir(dir, { recursive: true })
            localFile = path.join(dir, name)
            await writeFile(localFile, payload)
            content = localFile
        }
        if (config.uploadGroupFile) {
            try {
                await call(bot, 'upload_group_file', {
                    group_id: group,
                    file: content,
                    name
                })
                logger.info(
                    `群文件归档成功（群 ${groupId}，${mode}，${payload.length} 字节）。`
                )
            } catch (error) {
                failure('群文件', error)
            }
        }
        if (config.uploadGroupAlbum && format !== 'pdf') {
            try {
                const data = await callSupported(
                    bot,
                    [
                        'get_qun_album_list',
                        'get_group_album_list',
                        'get_group_albums',
                        'get_group_root_album_list'
                    ],
                    { group_id: group }
                )
                const albums = albumList(data)
                const targetName = config.groupAlbumName?.trim()
                const album = targetName
                    ? albums.find(
                          (item) =>
                              item.name === targetName ||
                              item.album_name === targetName
                      )
                    : albums[0]
                const id = album?.album_id ?? album?.id
                if (id === undefined || id === null || id === '')
                    throw new Error(
                        targetName
                            ? `未找到指定相册：${targetName}`
                            : '群内没有可用相册，请先创建相册。'
                    )
                let llbot = false
                try {
                    const version = (await call(
                        bot,
                        'get_version_info',
                        {}
                    )) as Record<string, unknown> | undefined
                    llbot = /llonebot|llbot/i.test(
                        String(version?.app_name || '')
                    )
                } catch {
                    /* Unknown implementations use the NapCat-compatible actions. */
                }
                const params = { group_id: group, album_id: String(id) }
                if (llbot) {
                    await call(bot, 'upload_group_album', {
                        ...params,
                        files: [content]
                    })
                } else {
                    await callSupported(
                        bot,
                        [
                            'upload_image_to_qun_album',
                            'upload_group_album',
                            'upload_qun_album'
                        ],
                        { ...params, file: content }
                    )
                }
                logger.info(
                    `群相册归档成功（群 ${groupId}，相册 ${String(id)}，${mode}）。`
                )
            } catch (error) {
                failure('群相册', error)
            }
        }
    } catch (error) {
        failure('报告', error)
    } finally {
        if (localFile) await unlink(localFile).catch(() => {})
    }
}
