import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

for (const target of ['lib', 'dist', 'tsconfig.tsbuildinfo']) {
    await rm(resolve(projectRoot, target), { recursive: true, force: true })
}
