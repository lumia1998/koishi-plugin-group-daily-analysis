import { createApp, h, provide, ref } from 'vue'
import Navigation from '../../client/ConfigNavigation.vue'
import { configLabels } from '../../client/config-labels'

const headings: string[] = await fetch('/test-headings.json').then((r) =>
    r.json()
)
const plugin = ref('group-daily-analysis')
const delayed = ref(false)
const legacySections = ref(false)
Object.assign(window, {
    changePlugin: (name: string) => {
        plugin.value = name
    },
    addSection: () => {
        delayed.value = true
    },
    addLegacySections: () => {
        legacySections.value = true
    }
})
createApp({
    setup() {
        provide('plugin:name', plugin)
        return () =>
            h('div', [
                h('aside', { class: 'fixture-sidebar' }, 'Koishi · 插件列表'),
                h(
                    'header',
                    { class: 'fixture-header' },
                    'group-daily-analysis'
                ),
                h('main', { class: 'plugin-view' }, [
                    h('div', { class: 'el-scrollbar__wrap' }, [
                        h('div', { class: 'k-content' }, [
                            h('h1', '群分析 · 插件配置'),
                            h(Navigation),
                            h(
                                'div',
                                { class: 'k-schema-left' },
                                Object.keys(configLabels)
                                    .slice(0, 3)
                                    .map((key) =>
                                        h('h3', [
                                            h(
                                                'span',
                                                { class: 'prefix' },
                                                'comic.'
                                            ),
                                            h('span', key)
                                        ])
                                    )
                            ),
                            ...[
                                ...headings,
                                ...(delayed.value ? ['延迟加载设置'] : []),
                                ...(legacySections.value
                                    ? ['过滤器设置', '运行日志']
                                    : [])
                            ].map((title) =>
                                h('section', [
                                    h(
                                        'h2',
                                        { class: 'k-schema-header' },
                                        title
                                    ),
                                    h(
                                        'p',
                                        '配置目录交互验证页面：使用实际配置分组标题与实际导航组件。'
                                    ),
                                    h('label', [
                                        '示例配置项 ',
                                        h('input', { value: '配置值' })
                                    ])
                                ])
                            )
                        ])
                    ])
                ])
            ])
    }
}).mount('#app')

const style = document.createElement('style')
style.textContent = `body{margin:0;background:#f4f5f7;color:#333;font:16px system-ui}.fixture-sidebar{position:fixed;inset:0 auto 0 0;width:300px;box-sizing:border-box;padding:24px;background:#e8ebef}.fixture-header{position:fixed;top:0;left:300px;right:0;height:64px;box-sizing:border-box;padding:20px 24px;background:white}.plugin-view{position:fixed;top:64px;left:300px;right:0;bottom:0}.el-scrollbar__wrap{height:100%;overflow:auto}.k-content{--content-padding:3rem;max-width:55rem;box-sizing:border-box;margin:auto;padding:3rem var(--content-padding)}section{min-height:340px;padding:20px;margin:20px 0;background:white;border-radius:12px}h2{scroll-margin-top:24px}input{padding:8px;border:1px solid #ddd;border-radius:6px}html.dark{--k-card-bg:#252529;--k-text-normal:#ddd;--k-color-divider:#444;--k-hover-bg:#34343a;--k-color-primary:#8caee0}html.dark body{background:#161619;color:#ddd}html.dark section,html.dark .fixture-header{background:#252529}html.dark .fixture-sidebar{background:#202024}@media(max-width:768px){.fixture-sidebar{display:none}.fixture-header,.plugin-view{left:0}.k-content{--content-padding:2rem}}@media(max-width:480px){.k-content{--content-padding:1.5rem}}`
document.head.append(style)
