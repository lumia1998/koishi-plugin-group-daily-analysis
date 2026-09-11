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
    return template.replace(
        /<\/head>/i,
        `<style data-report-layout>
        .quality-section { grid-column: 1 / -1; min-width: 0; margin: 28px 0; padding: 24px; border: 1px solid currentColor; border-radius: 16px; box-sizing: border-box; }
        .quality-section:has(> .empty-state) { display: none; }
        .quality-section h2 { font-size: 24px; margin: 0 0 18px; }
        .quality-review h3 { font-size: 20px; margin: 0 0 12px; }
        .quality-review p { line-height: 1.7; margin: 10px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .quality-dimensions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .quality-dimension { min-width: 0; padding: 16px; border: 1px solid currentColor; border-radius: 10px; }
        .quality-dimension > span { float: right; font-weight: 700; margin-left: 12px; }
        .quality-dimension > strong { overflow-wrap: anywhere; }
        .quality-summary { padding-top: 16px; border-top: 1px dashed currentColor; }
        .grid-layout > *, .card-grid > *, .quotes-grid > * { min-width: 0; overflow-wrap: anywhere; }
        .user-card img, .char-card img, .u-avatar { flex-shrink: 0; }
        .bubble-reason { margin-top: 12px; padding-top: 12px; border-top: 1px dashed currentColor; line-height: 1.7; overflow-wrap: anywhere; }
        body[data-skin="scrapbook"] .quality-section, body[data-skin="spring_festival"] .quality-section { background: #fffdf7; color: #40352d; box-shadow: 5px 5px 0 #e5d4f0; }
        @media (max-width: 600px) { .quality-dimensions { grid-template-columns: 1fr; } }
        </style>${
            css
                ? `<style data-skin-alias="${skin}">${css}
        body.dark-theme[data-skin="simple"] { background: #18191c; color: #ececf2; }
        body.dark-theme[data-skin="ATRI"], body.dark-theme[data-skin="BlueArchive"],
        body.dark-theme[data-skin="HatsuneMiku"] { background: #102b2c; color: #e0f7fa; }
        body.dark-theme[data-skin="art_nouveau"] { background: #211c17; color: #f5e6ce; }
        </style>`
                : ''
        }</head>`
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
                        value: id,
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
