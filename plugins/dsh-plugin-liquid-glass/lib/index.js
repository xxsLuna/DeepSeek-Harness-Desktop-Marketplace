// @ts-check
/**
 * dsh-plugin-liquid-glass — host half: owns the `ui-liquid-glass` settings
 * namespace and nothing else.
 *
 * All the visible work is in the browser (`lib/client.js`), because what is
 * being changed is a stylesheet. A node half still has to exist — `exports['.']`
 * is what the Loader imports for the row, so a package with no node entry
 * cannot be a row at all — and this one is not inert only because a settings
 * namespace has to be registered on the HOST: the browser can read and write a
 * namespace through `ctx.settingsScope.bind(...)`, but an unregistered one
 * reports `status: 'unavailable'` to every bound scope.
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name; the patch row's `id` and `name` are the same string. */
export const name = 'dsh-plugin-liquid-glass'

/**
 * The settings namespace. `settingsNamespace()` enforces `/^[a-z][a-z0-9-]*$/`,
 * so a capital or an underscore throws here rather than at first read.
 */
export const NAMESPACE = settingsNamespace('ui-liquid-glass')

/**
 * The four numbers the look is made of.
 *
 * Bounded rather than free, and each bound has a reason a user would care
 * about rather than a stylistic one:
 *
 * - `blur` past ~60px stops reading as glass and starts reading as fog, and
 *   every pixel of it is per-frame GPU work on a surface that covers the
 *   window. 0 turns the blur off while keeping the translucency.
 * - `saturation` is what makes colour behind the panel bloom slightly through
 *   it, which is most of why Apple's version looks like glass and not like
 *   tracing paper. 100 is neutral.
 * - `opacity` below ~25 leaves text sitting on whatever scrolls underneath and
 *   becomes unreadable; 100 is fully opaque, i.e. the plugin's off switch for
 *   translucency alone.
 * - `radius` is clamped where the composer's own 22px sits comfortably.
 *
 * The schema clamps because these reach CSS as numbers this plugin composes
 * into a value; a negative blur or a 900% opacity is not a taste to respect,
 * it is a typo that would silently produce an unreadable window.
 */
export const GlassSettings = z.object({
  blur: z.number().min(0).max(60).default(20).description('Backdrop blur radius, in pixels.'),
  saturation: z.number().min(100).max(300).default(180).description('Backdrop saturation, as a percentage.'),
  opacity: z.number().min(25).max(100).default(62).description('Panel opacity, as a percentage.'),
  radius: z.number().min(0).max(40).default(20).description('Panel corner radius, in pixels.'),
})

/**
 * Register the namespace when a settings provider is composed.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  // Optional, not a static `inject`: a surface can be composed with no settings
  // provider at all (`dsh --dump-default-config` is one), where a static inject
  // would leave this row pending forever instead of degrading to its defaults.
  ctx.inject(['settings'], (settingsCtx) => {
    // `applies: 'live'` is advisory metadata — nothing in the harness re-applies
    // anything on the strength of it. The browser half is what makes it true, by
    // subscribing to the scope and rewriting its stylesheet.
    settingsCtx.settings.register(NAMESPACE, GlassSettings, { applies: 'live' })
  })
}
