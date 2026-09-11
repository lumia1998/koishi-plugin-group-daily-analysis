export class ConcurrencyLimiter {
    private active = 0
    private queue: (() => void)[] = []

    constructor(private readonly limit = 1) {}

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= Math.max(1, this.limit)) {
            await new Promise<void>((resolve) => this.queue.push(resolve))
        } else this.active += 1
        try {
            return await task()
        } finally {
            const next = this.queue.shift()
            if (next) next()
            else this.active -= 1
        }
    }
}
