import { SkinRenderer } from './types'
import { Md3SkinRenderer } from './md3'
import { AnimeSkinRenderer } from './anime'
import { NewspaperSkinRenderer } from './newspaper'
import { ArtSkinRenderer } from './art'
import { ScrapbookSkinRenderer } from './scrapbook'

export const skinSourceMap: Record<string, string> = {
    simple: 'md3',
    ATRI: 'anime',
    BlueArchive: 'anime',
    retro_futurism: 'newspaper',
    art_nouveau: 'art',
    spring_festival: 'scrapbook',
    HatsuneMiku: 'anime',
    hack: 'newspaper'
}

/**
 * The upstream names keep their own visual treatment even when they reuse a
 * native layout.  These small, self-contained layers are appended after the
 * native skin CSS for reports and exported HTML.
 */
export const skinAliasStyles: Record<string, string> = {
    simple: `
        body[data-skin="simple"] { background: #f7f7f7; color: #202124; }
        body[data-skin="simple"] .container { border-radius: 8px; box-shadow: none; }
    `,
    ATRI: `
        body[data-skin="ATRI"] { background: linear-gradient(145deg, #fff7e7, #dff7ff); color: #24495a; }
        body[data-skin="ATRI"] .nahida-container { filter: saturate(.9); }
    `,
    BlueArchive: `
        body[data-skin="BlueArchive"] { background: linear-gradient(145deg, #e9f5ff, #f4edff); color: #263b68; }
        body[data-skin="BlueArchive"] .nahida-container { border-color: #8ebdf0; }
    `,
    HatsuneMiku: `
        body[data-skin="HatsuneMiku"] { background: linear-gradient(145deg, #dffbfa, #f4ecff); color: #155b68; }
        body[data-skin="HatsuneMiku"] .nahida-container { border-color: #48c9c5; }
    `,
    retro_futurism: `
        body[data-skin="retro_futurism"] { background: #07111d; color: #9fffe0; }
        body[data-skin="retro_futurism"] .paper-container { border: 1px solid #3fffc1; background: #081c2a; }
    `,
    art_nouveau: `
        body[data-skin="art_nouveau"] { background: #f4ead8; color: #46321f; }
        body[data-skin="art_nouveau"] .container { border: 2px solid #b58b5a; border-radius: 18px; }
    `,
    spring_festival: `
        body[data-skin="spring_festival"] { background: #fff4e8; color: #8f1d1d; }
        body[data-skin="spring_festival"] .container { border: 2px solid #d77b45; }
    `,
    hack: `
        body[data-skin="hack"] { background: #050505; color: #50ff50; font-family: monospace; }
        body[data-skin="hack"] .paper-container { border: 1px solid #50ff50; background: #000; }
    `
}

export function applySkinAliasStyles(template: string, skin: string) {
    const css = skinAliasStyles[skin]
    if (!css) return template
    return template.replace(
        /<\/head>/i,
        `<style data-skin-alias="${skin}">${css}</style></head>`
    )
}

/**
 * Skin registry
 * Manages all available skin renderers
 */
class SkinRegistry {
    private skins: Map<string, SkinRenderer> = new Map()

    constructor() {
        // Register built-in skins
        this.register(new Md3SkinRenderer())
        this.register(new AnimeSkinRenderer())
        this.register(new NewspaperSkinRenderer())
        this.register(new ArtSkinRenderer())
        this.register(new ScrapbookSkinRenderer())
        for (const [id, source] of Object.entries(skinSourceMap)) {
            const renderer = this.skins.get(source)
            if (renderer) {
                const alias = Object.create(renderer) as SkinRenderer
                Object.defineProperties(alias, {
                    id: { value: id, enumerable: true },
                    name: {
                        value: `${renderer.name}（${id} 专题样式）`,
                        enumerable: true
                    }
                })
                this.skins.set(id, alias)
            }
        }
    }

    /**
     * Register a skin renderer
     * @param skin Skin renderer instance
     */
    register(skin: SkinRenderer): void {
        this.skins.set(skin.id, skin)
    }

    /**
     * Get a skin renderer by ID
     * @param id Skin ID
     * @returns Skin renderer or undefined if not found
     */
    get(id: string): SkinRenderer | undefined {
        return this.skins.get(id)
    }

    /**
     * Get a skin renderer by ID, falling back to default if not found
     * @param id Skin ID
     * @returns Skin renderer (never undefined, falls back to md3)
     */
    getSafe(id: string): SkinRenderer {
        return this.skins.get(id) || this.skins.get('md3')!
    }

    /**
     * Check if a skin exists
     * @param id Skin ID
     * @returns True if skin exists
     */
    has(id: string): boolean {
        return this.skins.has(id)
    }

    /**
     * Get all registered skin IDs
     * @returns Array of skin IDs
     */
    getAllIds(): string[] {
        return Array.from(this.skins.keys())
    }

    /**
     * Get all registered skin renderers
     * @returns Array of skin renderers
     */
    getAll(): SkinRenderer[] {
        return Array.from(this.skins.values())
    }
}

// Export singleton instance
export const skinRegistry = new SkinRegistry()

// Re-export types and individual skins
export { SkinRenderer, getAvatarUrl } from './types'
export { Md3SkinRenderer } from './md3'
export { AnimeSkinRenderer } from './anime'
export { NewspaperSkinRenderer } from './newspaper'
export { ArtSkinRenderer } from './art'
export { ScrapbookSkinRenderer } from './scrapbook'
