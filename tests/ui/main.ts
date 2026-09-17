import { createApp, h, provide, ref } from 'vue'
import Navigation from '../../client/ConfigNavigation.vue'

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
            h('main', { class: 'plugin-view' }, [
                h('h1', '群分析 · 插件配置'),
                h(Navigation),
                ...[
                    ...headings,
                    ...(delayed.value ? ['延迟加载设置'] : []),
                    ...(legacySections.value
                        ? ['过滤器设置', '运行日志']
                        : [])
                ].map((title) =>
                    h('section', [
                        h('h2', { class: 'k-schema-header' }, title),
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
    }
}).mount('#app')

const style = document.createElement('style')
style.textContent = `body{margin:0;background:#f4f5f7;color:#333;font:16px system-ui}.plugin-view{max-width:900px;margin:40px auto 300px;padding:0 220px 0 24px}section{min-height:340px;padding:20px;margin:20px 0;background:white;border-radius:12px}h2{scroll-margin-top:24px}input{padding:8px;border:1px solid #ddd;border-radius:6px}html.dark{--k-card-bg:#252529;--k-text-normal:#ddd;--k-color-divider:#444;--k-hover-bg:#34343a;--k-color-primary:#8caee0}html.dark body{background:#161619;color:#ddd}html.dark section{background:#252529}@media(max-width:999px){.plugin-view{padding:0 16px}}`
document.head.append(style)
