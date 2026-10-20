import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ComicCharacterProfile } from './config'
import { loadReference } from './service/image'

export interface SelectedComicCharacter {
    name: string
    persona: string
    referenceFiles: string[]
}

const MAX_CHARACTER_REFERENCES = 6

export function comicCharacterStatePath(baseDir: string): string {
    return path.join(
        baseDir,
        'data/chatluna/group_analysis/comic-character.json'
    )
}

// Only profiles that can actually affect the comic count as candidates.
function isUsableProfile(profile: ComicCharacterProfile): boolean {
    if (!profile?.enabled) return false
    return (
        Boolean(profile.persona?.trim()) ||
        (profile.referenceFiles ?? []).filter(Boolean).length > 0
    )
}

function profileName(profile: ComicCharacterProfile): string {
    return (
        profile.profileName?.trim() || profile.persona?.trim() || '未命名方案'
    )
}

function toSelected(profile: ComicCharacterProfile): SelectedComicCharacter {
    return {
        name: profileName(profile),
        persona: profile.persona ?? '',
        referenceFiles: (profile.referenceFiles ?? []).filter(Boolean)
    }
}

function localDate(now: Date): string {
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// Persist the daily pick atomically; a failed write must not break the comic.
function writeDailyState(statePath: string, date: string, name: string): void {
    try {
        mkdirSync(path.dirname(statePath), { recursive: true })
        const temp = `${statePath}.${process.pid}.tmp`
        writeFileSync(temp, JSON.stringify({ date, name }))
        renameSync(temp, statePath)
    } catch {
        // 写入失败时静默，下一次运行重新随机即可。
    }
}

export function selectComicCharacter(
    profiles: ComicCharacterProfile[] | undefined,
    selection: 'first' | 'daily',
    statePath: string,
    now: Date = new Date()
): SelectedComicCharacter | undefined {
    const candidates = (profiles ?? []).filter(isUsableProfile)
    if (!candidates.length) return undefined
    if (selection === 'first') return toSelected(candidates[0])

    const today = localDate(now)
    let saved: { date?: unknown; name?: unknown } | undefined
    try {
        // 状态文件很小且每次生成只读写一次，同步 IO 保证选择逻辑可重入。
        saved = JSON.parse(readFileSync(statePath, 'utf8'))
    } catch {
        saved = undefined
    }
    if (saved?.date === today && typeof saved?.name === 'string') {
        const reused = candidates.find(
            (profile) => profileName(profile) === saved!.name
        )
        if (reused) return toSelected(reused)
    }
    const picked = candidates[Math.floor(Math.random() * candidates.length)]
    const selected = toSelected(picked)
    writeDailyState(statePath, today, selected.name)
    return selected
}

export async function loadComicReferences(
    character: SelectedComicCharacter | undefined,
    fallbackImage: string,
    baseDir: string
): Promise<Buffer[]> {
    const files = character?.referenceFiles?.length
        ? character.referenceFiles.slice(0, MAX_CHARACTER_REFERENCES)
        : [fallbackImage].filter(Boolean)
    const references: Buffer[] = []
    for (const file of files) {
        const data = await loadReference(file, baseDir)
        if (data) references.push(data)
    }
    return references
}
