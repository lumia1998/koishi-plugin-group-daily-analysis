<template>
    <nav
        v-if="isOwn"
        ref="navigation"
        class="group-analysis-navigation"
        aria-label="群分析配置目录"
    >
        <button
            type="button"
            class="navigation-toggle"
            :aria-expanded="expanded"
            @click="expanded = !expanded"
        >
            配置目录
            <span aria-hidden="true">{{ expanded ? '−' : '+' }}</span>
        </button>
        <div v-show="expanded" class="navigation-links">
            <a
                v-for="section in sections"
                :key="section.id"
                :href="`#${section.id}`"
                :aria-current="active === section.id ? 'location' : undefined"
                @click.prevent="navigate(section)"
            >
                {{ section.title }}
            </a>
        </div>
    </nav>
</template>

<script setup lang="ts">
import {
    computed,
    inject,
    nextTick,
    onBeforeUnmount,
    ref,
    watch,
    type ComputedRef
} from 'vue'

const pluginName = inject<ComputedRef<string>>('plugin:name')
const isOwn = computed(() =>
    [
        'group-analysis',
        'group-daily-analysis',
        'koishi-plugin-group-daily-analysis'
    ].includes(pluginName?.value || '')
)
const navigation = ref<HTMLElement>()
const expanded = ref(typeof window !== 'undefined' && window.innerWidth >= 1000)
type Section = { id: string; title: string; element: HTMLElement }
const sections = ref<Section[]>([])
const active = ref('')
let mutation: MutationObserver | undefined
let intersection: IntersectionObserver | undefined
let view: HTMLElement | undefined
const assignedIds = new Map<HTMLElement, string>()
let nextId = 0
const excludedSectionTitles = new Set(['过滤器设置', '运行日志'])

function cleanup() {
    mutation?.disconnect()
    intersection?.disconnect()
    for (const [element, id] of assignedIds) {
        if (element.id === id) element.removeAttribute('id')
    }
    assignedIds.clear()
    view = undefined
    sections.value = []
}

function collect() {
    if (!view) return
    const headers = [
        ...view.querySelectorAll<HTMLElement>('.k-schema-header')
    ].filter(
        (element) =>
            !navigation.value?.contains(element) &&
            !!element.textContent?.trim() &&
            !excludedSectionTitles.has(element.textContent.trim())
    )
    if (
        headers.length === sections.value.length &&
        headers.every(
            (element, index) =>
                sections.value[index].element === element &&
                sections.value[index].title === element.textContent?.trim()
        )
    )
        return
    intersection?.disconnect()
    sections.value = headers.map((element) => {
        if (!element.id) {
            element.id = `group-analysis-config-${nextId++}`
            assignedIds.set(element, element.id)
        }
        return { id: element.id, title: element.textContent!.trim(), element }
    })
    intersection = new IntersectionObserver(
        (entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort(
                    (a, b) =>
                        a.boundingClientRect.top - b.boundingClientRect.top
                )
            if (visible[0]) active.value = visible[0].target.id
        },
        { rootMargin: '-5% 0px -65% 0px' }
    )
    for (const section of sections.value) intersection.observe(section.element)
    if (!sections.value.some((section) => section.id === active.value))
        active.value = sections.value[0]?.id || ''
}

function navigate(section: Section) {
    active.value = section.id
    section.element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (window.innerWidth < 1000) expanded.value = false
}

watch(
    isOwn,
    async (own, _previous, onCleanup) => {
        let cancelled = false
        onCleanup(() => {
            cancelled = true
            cleanup()
        })
        if (!own) return
        await nextTick()
        if (cancelled) return
        view =
            navigation.value?.closest<HTMLElement>('.plugin-view') || undefined
        if (!view) return
        collect()
        mutation = new MutationObserver(collect)
        mutation.observe(view, {
            childList: true,
            subtree: true,
            characterData: true
        })
    },
    { immediate: true, flush: 'post' }
)

onBeforeUnmount(cleanup)
</script>

<style scoped>
.group-analysis-navigation {
    position: fixed;
    right: 24px;
    top: 100px;
    z-index: 20;
    width: 180px;
    border: 1px solid var(--k-color-divider, #dce0e5);
    border-radius: 18px;
    background: var(--k-card-bg, #fff);
    color: var(--k-text-normal, #333);
    box-shadow: 0 4px 20px #0000000d;
    font-size: 14px;
}
.navigation-toggle {
    width: 100%;
    padding: 12px 16px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
}
.navigation-toggle span {
    float: right;
}
.navigation-links {
    max-height: calc(100vh - 190px);
    overflow-y: auto;
    padding: 0 8px 8px;
}
.navigation-links a {
    display: block;
    padding: 9px 12px;
    border-radius: 20px;
    color: inherit;
    text-decoration: none;
    line-height: 1.4;
}
.navigation-links a:hover,
.navigation-links a[aria-current] {
    background: var(--k-hover-bg, #f3f5f8);
    color: var(--k-color-primary, #527ca6);
}
.navigation-links a:focus-visible,
.navigation-toggle:focus-visible {
    outline: 2px solid var(--k-color-primary, #527ca6);
}
@media (max-width: 999px) {
    .group-analysis-navigation {
        top: auto;
        bottom: 24px;
        right: 16px;
    }
    .navigation-links {
        max-height: 55vh;
    }
}
</style>
