import { Context } from '@koishijs/client'
import ConfigNavigation from './ConfigNavigation.vue'

export default (ctx: Context) => {
    ctx.slot({
        type: 'plugin-details',
        component: ConfigNavigation,
        order: -999
    })
}
