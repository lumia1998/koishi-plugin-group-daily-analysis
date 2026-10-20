// 生图成功但返回地址无法下载时抛出，保留原始地址供上层回退直发。
export class ImageDownloadError extends Error {
    constructor(
        message: string,
        readonly url?: string
    ) {
        super(message)
        this.name = 'ImageDownloadError'
    }
}
