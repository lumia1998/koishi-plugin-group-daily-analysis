import { SummaryTopic } from './types'

const MIN_SCENE_LENGTH = 10

// Strip BOM and ```json fences before attempting structured parsing.
function stripFences(text: string): string {
    let result = text.replace(/^\uFEFF/, '').trim()
    const fenced = result.match(
        /\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/i
    )
    if (fenced) result = fenced[1].trim()
    return result
}

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

// Model output is untrusted; recover the largest plausible JSON fragment.
function parseLooseJson(text: string): unknown {
    const direct = tryParseJson(text)
    if (direct !== undefined) return direct
    const objectStart = text.indexOf('{')
    const objectEnd = text.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) {
        const parsed = tryParseJson(text.slice(objectStart, objectEnd + 1))
        if (parsed !== undefined) return parsed
    }
    const arrayStart = text.indexOf('[')
    const arrayEnd = text.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart)
        return tryParseJson(text.slice(arrayStart, arrayEnd + 1))
    return undefined
}

// Recursively collect string leaves from an arbitrary JSON tree (depth <= 8).
function collectStrings(
    value: unknown,
    depth = 0,
    out: string[] = []
): string[] {
    if (depth > 8 || value === null || value === undefined) return out
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed) out.push(trimmed)
        return out
    }
    if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, depth + 1, out)
        return out
    }
    if (typeof value === 'object') {
        for (const item of Object.values(value))
            collectStrings(item, depth + 1, out)
    }
    return out
}

function uniqueStrings(chunks: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const chunk of chunks) {
        if (!seen.has(chunk)) {
            seen.add(chunk)
            result.push(chunk)
        }
    }
    return result
}

// Models sometimes put the real panels in sibling fields next to `scene`.
function sceneFromObject(data: Record<string, unknown>): string {
    const scene = typeof data['scene'] === 'string' ? data['scene'].trim() : ''
    const others = { ...data }
    delete others['scene']
    const otherChunks = uniqueStrings(collectStrings(others))
    if (scene) {
        const sceneComplete = /panel\s*\d/i.test(scene)
        const missing = otherChunks.filter((chunk) => !scene.includes(chunk))
        if (missing.length && !sceneComplete)
            return `${scene}\n\n${missing.join('\n\n')}`
        return scene
    }
    return otherChunks.join('\n\n')
}

function sceneFromRegex(text: string): string {
    const match = text.match(/"scene"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (!match) return ''
    try {
        const parsed: unknown = JSON.parse(`"${match[1]}"`)
        return typeof parsed === 'string' ? parsed.trim() : ''
    } catch {
        return match[1].trim()
    }
}

export function parseComicStoryboard(text: string): string {
    const stripped = stripFences(String(text ?? ''))
    let scene = ''
    const data = parseLooseJson(stripped)
    if (data && typeof data === 'object' && !Array.isArray(data))
        scene = sceneFromObject(data as Record<string, unknown>)
    else if (data !== undefined)
        scene = uniqueStrings(collectStrings(data)).join('\n\n')
    if (!scene) scene = sceneFromRegex(stripped)
    scene = scene.trim()
    if (scene.length < MIN_SCENE_LENGTH)
        throw new Error('分镜模型未返回有效的分镜内容。')
    return scene
}

export function buildStoryboardImagePrompt(
    scene: string,
    referenceCount: number
): string {
    if (referenceCount > 0)
        return `附件是主持角色的外观参考图（共 ${referenceCount} 张），角色外观以附件为准。\n${scene}\n\n每个分格都必须出现同一位主持角色；只输出最终图片，不要输出 Markdown、分镜说明或幕后分析。`
    return `${scene}\n\n只输出最终图片，不要输出 Markdown、分镜说明或幕后分析。`
}

const DEFAULT_PERSONA = '一位活泼、友好、偶尔嘴贫的群聊观察员。'

export function buildComicStoryboardPrompt(
    topics: SummaryTopic[],
    persona?: string
): string {
    const count = topics.length
    const topicList = topics
        .map((item, index) => {
            const topic = String(item?.topic ?? '').trim()
            const detail = String(item?.detail ?? '').trim()
            return `${index + 1}. 话题：${topic}\n   详情：${detail}`
        })
        .join('\n')
    const character = persona?.trim() || DEFAULT_PERSONA
    return `你是一位资深漫画分镜师，也是 AI 绘画提示词专家。请把下面的群聊话题列表改编成一张多格连环漫画的完整生图指令。
主持角色设定：${character}
请始终用该设定的性格与说话口吻来吐槽和讲解每个话题；设定只决定主持角色的外观取向、性格和点评口吻，不是群聊事实。

待创作的话题列表：
${topicList}

分镜规则：
1. 话题列表共有 ${count} 个话题，必须为每一个话题分别设计一个分格（Panel 1 到 Panel ${count}），不允许遗漏、合并、挑选或额外增加话题。
2. 每个分格都要出现同一位主持角色，写明角色的动作与表情，并保持外观在全部 Panel 中一致。
3. 每格配一句主持角色的口语化台词（不超过 15 个汉字），放在圆角云朵形对白气泡里；台词要根据话题提炼改写，不得照抄详情原文，也不得虚构群友原话。
4. 每格底部配一条马卡龙色、圆角的字幕条，写 30 字以内的生动短标题，且短标题中不得出现“【事件】”字样。
5. 画面构图与场景描述使用英文，但气泡与字幕条里的中文必须逐字写出，严禁把中文翻译成英文；指令格式为
   containing a speech bubble with exact Chinese text "台词"
   and a cute pastel caption strip at bottom with exact Chinese text "短标题"。
6. 可以在每个分格后附 Background Context 帮助生图模型理解剧情（把话题详情翻译为英文），但必须紧跟这句警告：STRICT RULE: DO NOT render the background context text!
   ONLY render the exact Chinese text in the bubble and caption strip!
7. 画面中不得出现真实昵称、用户 ID、头像、大段聊天记录或分析报告版式。

输出格式：只输出纯 JSON {"scene": "..."}，不要输出 Markdown 代码块或任何额外说明。生图引擎只读取 scene 字段，因此必须把角色总设以及 Panel 1 到 Panel ${count} 的每一格完整描述全部内联写进 scene 字符串中，不允许把分格拆到其他字段。`
}

export function buildComicRewritePrompt(
    prompt: string,
    lastError: string
): string {
    return `你是一名注重安全合规的漫画提示词改写员。一段漫画生图提示词提交后失败，请诊断原因并在保持创作意图的前提下改写。

【原提示词】
${prompt}

【最后一次错误信息】
${lastError}

改写要求：
1. 如果错误属于色情、暴力、血腥、政治等严重违规，且原内容本质上无法改成健康画面，返回 {"can_fix": false, "new_prompt": ""}。
2. 如果可以通过去掉敏感词、把画面改成健康搞笑或委婉抽象的描述来避开审查，请进行脱敏改写。
3. 如果只是超时或未知错误，可以适当简化画面中的复杂元素。
4. 必须保留原提示词中的附件说明、参考图说明、话题数量、分格结构，以及气泡和字幕条中逐字指定的中文文字要求。
5. 只输出纯 JSON {"can_fix": boolean, "new_prompt": string}，不要输出 Markdown 代码块或其他说明。`
}
