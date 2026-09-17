// 配置键保持兼容；仅替换本插件配置页的显示标题。
export const configLabels: Record<string, string> = {
    debug: '详细日志',
    enableAllGroupsByDefault: '默认监听全部群',
    listenerGroups: '监听群组',
    platform: '平台',
    selfId: '机器人编号',
    channelId: '频道编号',
    guildId: '群组编号',
    enabled: '启用',
    autoAnalysisGroupMode: '定时分析群组范围',
    autoAnalysisGroups: '定时分析群组列表',
    cronSchedule: '定时计划',
    autoAnalysisCooldown: '自动分析冷却',
    cronAnalysisDays: '定时分析天数',
    useCalendarDayWindow: '按自然日统计',
    alwaysPersistMessages: '持续保存消息',
    retentionDays: '消息保留天数',
    maxMessages: '最大分析消息数',
    minMessages: '最低消息条数',
    maxUsersInReport: '活跃排行人数',
    maxConcurrentTasks: '任务并发上限',
    maxConcurrentLLM: '文本模型并发上限',
    maxConcurrentRender: '报告渲染并发上限',
    checkpointEnabled: '保存分析进度',
    outputFormat: '默认报告格式',
    cronOutputFormats: '定时报表格式',
    uploadGroupFile: '上传群文件',
    uploadGroupAlbum: '上传群相册',
    theme: '明暗模式',
    skin: '报告主题',
    preset: '角色预设',
    temperature: '生成随机度',
    llm: '文本模型',
    comic: '漫画',
    format: '接口类型',
    baseUrl: '接口地址',
    apiKey: '接口密钥',
    model: '模型',
    retryCount: '失败重试次数',
    retryBackoffSeconds: '重试等待秒数',
    timeout: '请求超时',
    maxOutputTokens: '最大生成长度',
    userEnabled: '启用用户画像漫画',
    userPrompt: '用户画像漫画提示词',
    presetMode: '漫画预设来源',
    autoSend: '自动发送群漫画',
    groupMode: '漫画群组范围',
    groups: '漫画群组列表',
    referenceImage: '主要角色参考图',
    referenceImages: '角色参考图列表',
    characters: '角色方案',
    name: '名称',
    description: '角色描述',
    randomCharacterDaily: '每日随机角色',
    characterDescription: '主角设定',
    cooldown: '漫画冷却时间',
    size: '漫画尺寸',
    prompt: '群漫画提示词',
    personaAnalysisMessageInterval: '画像更新消息阈值',
    personaCacheLifetimeDays: '画像缓存天数',
    personaLookbackDays: '画像回溯天数',
    personaMaxMessages: '画像最大消息数',
    personaMinMessages: '画像最低消息数',
    promptTopic: '话题提示词',
    promptUserTitles: '本期称号提示词',
    promptGoldenQuotes: '金句提示词',
    promptUserPersona: '长期画像提示词',
    promptChatQuality: '聊天质量提示词',
    promptQueryParser: '查询解析提示词',
    promptQueryChat: '分析对话提示词'
}

export function localizeConfigLabels(view: HTMLElement) {
    for (const element of view.querySelectorAll<HTMLElement>(
        '.k-schema-left h3 > span:not(.prefix), .k-schema-table th'
    )) {
        const key =
            element.dataset.configOriginal || element.textContent?.trim() || ''
        const label = configLabels[key]
        if (!label || element.dataset.configLabel === label) continue
        element.dataset.configOriginal = key
        element.dataset.configLabel = label
        element.setAttribute('aria-label', label)
        element.classList.add('group-analysis-config-label')
        const prefix = element.previousElementSibling as HTMLElement | null
        if (prefix?.classList.contains('prefix'))
            prefix.classList.add('group-analysis-config-prefix')
    }
}

export function clearConfigLabels(view?: HTMLElement) {
    for (const element of view?.querySelectorAll<HTMLElement>(
        '.group-analysis-config-label'
    ) || []) {
        element.classList.remove('group-analysis-config-label')
        element.removeAttribute('aria-label')
        delete element.dataset.configOriginal
        delete element.dataset.configLabel
    }
    for (const element of view?.querySelectorAll(
        '.group-analysis-config-prefix'
    ) || [])
        element.classList.remove('group-analysis-config-prefix')
}
