import type { GroupAnalysisResult, UserPersonaProfile } from '../src/types'

export const persona: UserPersonaProfile = {
    userId: '123456',
    username: '夜班观察员',
    summary: '昼夜颠倒的铁路工作者，深夜在群里分享技术与生活。',
    keyTraits: ['经常熬夜写代码', '表面爱开玩笑，实际细心照顾群友'],
    interests: ['铁路摄影', '二次元音乐'],
    communicationStyle: '碎片化短句，开玩笑后常常自嘲解围。',
    evidence: [
        '凌晨三点仍在讨论程序故障。',
        '逐个回复新群友的问题，避免冷落任何人。'
    ],
    analysisDate: '2026-09-17 12:00'
}

export const group: GroupAnalysisResult = {
    totalMessages: 159,
    totalChars: 21774,
    totalParticipants: 17,
    emojiCount: 9,
    mostActiveUser: null,
    mostActivePeriod: '09:00—10:00',
    userStats: [
        {
            userId: '123456',
            nickname: '活跃排行测试员',
            messageCount: 36,
            charCount: 1200,
            replyRatio: 0.4,
            nightRatio: 0.2,
            avgChars: 33,
            emojiRatio: 0.1,
            emojiStats: {},
            nightMessages: 7,
            replyCount: 14,
            atCount: 2,
            lastActive: new Date(),
            activeHours: { 9: 36 }
        }
    ],
    topics: [
        {
            topic: '热门话题标记',
            contributors: ['夜班观察员'],
            detail: '大家讨论铁路摄影与程序排错。'
        }
    ],
    userTitles: [
        {
            id: 123456,
            name: '夜班观察员',
            title: '本期技术顾问标记',
            mbti: 'INTJ',
            reason: '本期帮助群友定位了程序问题。'
        }
    ],
    goldenQuotes: [
        {
            sender: '夜班观察员',
            content: '金句内容标记',
            reason: '准确概括讨论重点。'
        }
    ],
    chatQuality: {
        title: '锐评标题标记',
        subtitle: '讨论有来有往',
        summary: '锐评总结标记',
        dimensions: [
            { name: '技术讨论', percentage: 80, comment: '有充分事实支持。' }
        ]
    },
    activeHoursChart: '',
    activeHoursData: { 0: 18, 2: 20, 9: 36, 11: 30 },
    analysisDate: '2026-09-16 00:00 至 2026-09-17 12:00',
    groupName: '群名标记'
}
