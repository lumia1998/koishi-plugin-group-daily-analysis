import { skinSourceMap } from './index'

export interface UserComicVisualSpec {
    family: string
    aspectRatio: string
    size: string
    layout: string
    artDirection: string
}

const familySpecs: Record<string, UserComicVisualSpec> = {
    md3: {
        family: '现代信息卡片',
        aspectRatio: '3:4',
        size: '1024x1536',
        layout: '竖版分析仪表盘：顶部身份摘要，下方四张清晰的编号卡片按 2×2 排列，底部是一句总评。',
        artDirection:
            '现代 Material Design 3 视觉，留白充足，圆角信息卡、柔和层级阴影、清晰的主题色和数据图标；像精致的产品洞察报告，不使用胶带、便签或手账拼贴。'
    },
    anime: {
        family: '二次元角色观察杂志',
        aspectRatio: '3:4',
        size: '1024x1536',
        layout: '竖版角色杂志页：顶部人物档案与导语，四个编号分镜组成紧凑的 2×2 观察页，角色在每格用动作和短评主持。',
        artDirection:
            '清爽的日系角色杂志与视觉小说资料页，细腻赛璐璐插画、柔和渐变、角色标签与轻量 UI 装饰；保持报告感，不做普通连续剧情四格。'
    },
    newspaper: {
        family: '编辑部人物调查档案',
        aspectRatio: '3:4',
        size: '1024x1536',
        layout: '竖版报纸特刊：顶部主标题和人物导语，下方四个带编号的专栏分镜以两栏网格编排，底部放编辑点评。',
        artDirection:
            '编辑部调查档案与报纸特刊风格，强标题、细分隔线、专栏、印刷网点和有限强调色；信息密度高但层级清楚，不使用手账胶带。'
    },
    art: {
        family: '艺术展览人物海报',
        aspectRatio: '3:4',
        size: '1024x1536',
        layout: '竖版展览海报：标题与人物引言形成视觉中心，四个画像章节用有节奏的非对称画框环绕排列，底部以题签收束。',
        artDirection:
            '策展级艺术海报与画册内页，优雅装饰边框、克制的纹样、纸张肌理和富有节奏的构图；每个分镜仍须可独立阅读。'
    },
    scrapbook: {
        family: '手账人物观察报告',
        aspectRatio: '3:4',
        size: '1024x1536',
        layout: '竖版手账观察报告：顶部照片与摘要便签，下方四个大号编号分镜按 2×2 排列，底部用纸条写一句总结。',
        artDirection:
            '方格纸、胶带、剪贴纸、便签、手写标记和柔和粉彩，像精心制作的长期观察手账；丰富但不杂乱。'
    }
}

const aliasDirections: Record<string, string> = {
    simple: '进一步简化为黑白灰与单一强调色，细边框、极少装饰、扁平卡片和高可读性排版。',
    ATRI: '加入海水蓝、暖日光与视觉小说界面细节，氛围轻盈通透，避免照搬手账材质。',
    BlueArchive:
        '使用学院档案、蓝白战术 UI、几何光环和任务简报元素，形成轻快的学生人物观察档案。',
    HatsuneMiku:
        '使用青绿色与粉色的音乐界面、节拍和舞台灯光元素，像虚拟歌姬主题人物杂志。',
    retro_futurism:
        '转换为深色复古未来终端、琥珀与青绿色荧光、扫描线和航天档案面板。',
    hack: '转换为黑底绿色终端审计报告，等宽字体、命令行窗口和系统状态框；信息仍按四维清晰分区。',
    art_nouveau:
        '强化新艺术风格的植物曲线、拱形画框、米金与墨绿配色，让四个章节像装饰画册。',
    spring_festival:
        '使用红金节庆配色、剪纸、灯笼和印章，把基础拼贴转为春节人物观察册，而不是日常粉彩手账。'
}

export function getUserComicVisualSpec(skin = 'md3'): UserComicVisualSpec {
    const family = skinSourceMap[skin] || skin
    const base = familySpecs[family] || familySpecs.md3
    const aliasDirection = aliasDirections[skin]
    if (!aliasDirection) return base
    return {
        ...base,
        artDirection: `${base.artDirection}\n当前具体皮肤覆盖要求：${aliasDirection}`
    }
}
