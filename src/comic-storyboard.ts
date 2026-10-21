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
        return `【主持角色身份与外观：最高优先级】
附件 1${referenceCount > 1 ? ` 至附件 ${referenceCount}` : ''}是同一位主持角色的身份与外观参考，不是可自由替换的画风示例。若附件包含正面、侧面、背面或三视图，它们展示的是同一个角色，不是三个人，也不要照搬三视图的站姿或网格背景。
所有分格中的主持角色必须复现参考图人物的脸型、发色、发型、瞳色、体型比例、服装颜色与款式、帽子、饰品及耳朵、尾巴等特征。参考图里有的关键特征不可擅自删去或换成新造型；只允许按剧情改变姿势、表情、视角和场景。
场景主题、画风和话题人物都不能成为给主持人换装、换发型或改变物种的理由。不得擅自增加参考图中没有的眼镜、发饰或其他身份特征；背景与手持道具可以随剧情变化，主持人的原有服装和配饰必须保留。
以下分镜只负责话题、动作、构图和中文台词。如其中的主持角色外观描述与参考图冲突，忽略该外观描述，以附件人物为准。话题中的群友、虚构人物或其他配角不能替代主持角色。
Character identity lock: the host in EVERY panel must be the exact same character shown in the attached reference. Preserve the reference character's face, hair, eyes, outfit, headwear, accessories and species features. Textual storyboard descriptions must NEVER override this identity.

【分镜内容】
${scene}

生成前逐格核对脸型、发色发型、服装、帽子、耳朵和尾巴均与附件人物一致，修正冲突后再输出；不要把主持人重新设计成其他角色。只输出最终图片，不要输出 Markdown、分镜说明或幕后分析。`
    return `${scene}\n\n只输出最终图片，不要输出 Markdown、分镜说明或幕后分析。`
}

const DEFAULT_PERSONA = '一位活泼、友好、偶尔嘴贫的群聊观察员。'

export function buildComicStoryboardPrompt(
    topics: SummaryTopic[],
    hasCharacterReference = false
): string {
    const count = topics.length
    const topicList = topics
        .map((item, index) => {
            const topic = String(item?.topic ?? '').trim()
            const detail = String(item?.detail ?? '').trim()
            return `${index + 1}. 话题：${topic}\n   详情：${detail}`
        })
        .join('\n')
    const identityRule = hasCharacterReference
        ? '生图阶段会另外附上主持角色参考图，你在当前文本任务中看不到该图片。主持角色身份与外观完全由该图片决定；不要猜测或编写主持角色的姓名、性别、年龄、脸型、发色、发型、瞳色、服装、帽子、饰品、耳朵或尾巴。每格统一称为 "the same host from the attached character reference"，只描述其动作、表情、视角与互动，不得另行设计主持角色。不要因游戏、魔法、赛博朋克等话题给主持人换装或重设计；话题人物必须明确标为 separate supporting character，不得把他们的外观赋给主持人。'
        : '当前没有配置主持角色参考图，请设计一位统一的主持角色，在 scene 开头定义其外观，并在全部分格保持一致。'
    const hostPanelRule = hasCharacterReference
        ? '每个分格都要出现同一位主持角色，并逐格使用 "the same host from the attached character reference" 指代；只写动作和表情，不得附加任何自创外观形容词。'
        : '每个分格都要出现同一位主持角色，写明角色的动作与表情，并保持外观在全部 Panel 中一致。'
    const sceneRule = hasCharacterReference
        ? 'scene 开头先写 "Host identity: use exactly the character from the attached reference; preserve all appearance details and the original outfit; do not redesign."，随后内联写入每个 Panel 的动作、场景与台词。输出前删除任何自创的主持角色外观或换装描述；每个 Panel 都必须引用参考图中的同一主持角色。'
        : '必须把角色总设以及每一格的完整描述全部内联写进 scene 字符串中。'
    return `你是一位资深漫画分镜师，也是 AI 绘画提示词专家。请把下面的群聊话题列表改编成一张多格连环漫画的完整生图指令。
主持角色性格与点评口吻：${DEFAULT_PERSONA}
该设定只决定性格和点评口吻，不决定人物外观，也不是群聊事实。
${identityRule}

待创作的话题列表：
${topicList}

分镜规则：
1. 话题列表共有 ${count} 个话题，必须为每一个话题分别设计一个分格（Panel 1 到 Panel ${count}），不允许遗漏、合并、挑选或额外增加话题。
2. ${hostPanelRule}
3. 每格配一句主持角色的口语化台词（不超过 15 个汉字），放在圆角云朵形对白气泡里；台词要根据话题提炼改写，不得照抄详情原文，也不得虚构群友原话。
4. 每格底部配一条马卡龙色、圆角的字幕条，写 30 字以内的生动短标题，且短标题中不得出现“【事件】”字样。
5. 画面构图与场景描述使用英文，但气泡与字幕条里的中文必须逐字写出，严禁把中文翻译成英文；指令格式为
   containing a speech bubble with exact Chinese text "台词"
   and a cute pastel caption strip at bottom with exact Chinese text "短标题"。
6. 可以在每个分格后附 Background Context 帮助生图模型理解剧情（把话题详情翻译为英文），但必须紧跟这句警告：STRICT RULE: DO NOT render the background context text!
   ONLY render the exact Chinese text in the bubble and caption strip!
7. 画面中不得出现真实昵称、用户 ID、头像、大段聊天记录或分析报告版式。

输出格式：只输出纯 JSON {"scene": "..."}，不要输出 Markdown 代码块或任何额外说明。生图引擎只读取 scene 字段，Panel 1 到 Panel ${count} 必须全部写入 scene，不允许把分格拆到其他字段。${sceneRule}`
}
