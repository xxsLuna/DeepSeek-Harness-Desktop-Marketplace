// @ts-check
/**
 * dsh-plugin-background-color — host half: owns the `ui-background` settings
 * namespace and nothing else.
 *
 * The visible work all happens in the browser (`lib/client.js`), because the
 * thing being changed is a CSS custom property on `document.body`. A node half
 * still has to exist: `exports['.']` is what the Loader imports for the row, so
 * a package with no node entry cannot be a row at all. Upstream's own
 * browser-only plugins solve that with an inert `apply` (see
 * `@deepseek-ai/dsh-client-ui-layout`'s `lib/index.js`, which is literally
 * `function apply() {}`).
 *
 * This one is not inert, for one reason: a settings namespace is registered on
 * the HOST. The browser can read and write a namespace through
 * `ctx.settingsScope.bind(...)`, but only a host registration puts it in the
 * document at all — an unregistered namespace reports `status: 'unavailable'`
 * to every bound scope. So the schema, the defaults and the durable document
 * section live here, and the browser half consumes them.
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/**
 * Stable Cordis plugin name. Deliberately the package name rather than a short
 * slug: the patch row's `id` and `name` are both the package name too (see
 * `cordis.patch.yml`), so there is exactly one identity to get wrong.
 */
export const name = 'dsh-plugin-background-color'

/**
 * The settings namespace. `settingsNamespace()` brands the string and enforces
 * `/^[a-z][a-z0-9-]*$/` — a raw string is a type error at the registration
 * boundary, and a namespace with an underscore or a capital throws here rather
 * than at first read.
 */
export const NAMESPACE = settingsNamespace('ui-background')

/**
 * Defaults are the upstream palette's own `--dsw-alias-bg-base` values, read
 * out of the shipped stylesheet in `@deepseek-ai/dsh-client-ui-theme`:
 * `--dsw-static-neutral-bluish-00` (#fff) for light and
 * `--dsw-static-neutral-bluish-950` (#151517) for dark.
 *
 * That makes a fresh install a no-op on the frame, but NOT a no-op overall —
 * the browser half writes the same pair over three tokens, and two of them
 * (`bg-layer-1`, `specific-sidebar-fill`) are not #fff/#151517 in the shipped
 * palette. Installing this plugin therefore flattens the sidebar and the
 * conversation view onto the frame colour before the user has picked anything.
 * That is the intended effect and the reason all three are overridden: leaving
 * one out is what looks broken, not what looks default.
 */
export const DEFAULT_LIGHT = '#ffffff'
export const DEFAULT_DARK = '#151517'

/**
 * One colour per scheme. The theme service requires a `{light, dark}` pair for
 * every token it is handed — a bare string throws a teaching error — so the
 * schema is shaped the same way rather than making the browser half invent the
 * second half of a pair.
 *
 * Values are unvalidated CSS colour strings on purpose. The presenter writes
 * them straight into `body.style.setProperty`, where a value the browser
 * cannot parse is simply dropped and the palette declaration underneath still
 * applies; a regex here would reject `oklch()`, `color-mix()` and every colour
 * function added after it was written.
 */
export const BackgroundSettings = z.object({
  light: z.string().default(DEFAULT_LIGHT),
  dark: z.string().default(DEFAULT_DARK),
})

/**
 * Register the namespace when a settings provider is composed.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  // `settings` is OPTIONAL: a surface can be composed without a settings
  // provider (`dsh --dump-default-config` is one), and a static `inject` list
  // would leave this row pending forever there instead of degrading. Upstream's
  // own ui-theme host half reaches the same service the same way.
  ctx.inject(['settings'], (settingsCtx) => {
    // `applies` is advisory metadata — it is stored on the registration and
    // reported by `settings.describe()`, and nothing in the harness reloads
    // anything on the strength of it. Saying 'live' here is a promise the
    // BROWSER half keeps, by subscribing to the scope and re-pushing the
    // override itself.
    settingsCtx.settings.register(NAMESPACE, BackgroundSettings, { applies: 'live' })
  })
}
