// @ts-check
/**
 * dsh-plugin-background-color — browser half: the whole visible effect.
 *
 * Hand-written, and shaped exactly like a built one. The wrapper below is the
 * banner/footer pair `scripts/build-client.mjs` in the desktop repo emits, with
 * this package's id substituted, so a version of this plugin that outgrows
 * hand-writing can adopt esbuild without touching anything else. The `require`
 * parameter is unused here on purpose — this bundle imports nothing, which is
 * what makes it safe to ship with no build step and no load-order declaration.
 *
 * It MUST stay a classic script. The client module system loads a bundle with
 * `document.createElement('script')` + `src` and then asserts the file
 * registered a factory (`bundle <url> loaded without registering <id> via
 * __ModuleLoader__.load`), so an ES module — which would defer and never call
 * a global synchronously — fails the arrival check rather than misbehaving
 * later.
 *
 * The mechanism, verified against the staged harness rather than assumed:
 *
 *   ctx.theme.overrideTokens(source, tokens)
 *     stacks a named layer over the active theme and republishes the snapshot.
 *     Every value must be a `{light, dark}` pair.
 *   @deepseek-ai/dsh-client-ui-layout's ThemePresenter
 *     receives that snapshot and writes each token with
 *     `document.body.style.setProperty(name, value)`.
 *
 * The second step is why this works and why CSS injection is the wrong tool:
 * the shipped palette declares these tokens on `body` and
 * `body[data-ds-dark-theme]`, and an inline custom property on the same element
 * outranks both without any specificity or document-order argument. A
 * stylesheet would have to out-specify a rule on the element it is trying to
 * beat.
 */
window.__ModuleLoader__.load({ id: "dsh-plugin-background-color", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/** Must equal the host half's `settingsNamespace('ui-background')`. */
var NAMESPACE = 'ui-background'

/**
 * Layer identity passed to `overrideTokens`. One layer per source: calling
 * again with the same source replaces this plugin's whole layer instead of
 * stacking a second one, which is what makes the re-push below cheap.
 */
var SOURCE = 'dsh-plugin-background-color'

/**
 * Three tokens, not one. In the shipped light palette `bg-base` and
 * `bg-layer-1` are the same colour (#fff) while `sidebar-fill` is one step off
 * it (#f9fafb); in dark all three differ (#151517 / #232324 / #1b1b1c).
 * Overriding only `bg-base` therefore leaves the sidebar column and the
 * conversation view on the old palette and the window reads as half-painted.
 */
var TOKENS = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-specific-sidebar-fill']

/**
 * Used until the host registration lands (a bound scope reports `loading`
 * first, and `unavailable` on a surface with no settings provider). These are
 * the palette's own `bg-base` values, so the fallback repaints nothing that was
 * not already that colour.
 */
var FALLBACK = { light: '#ffffff', dark: '#151517' }

/**
 * Cordis SERVICE names — a different namespace from the package names in this
 * package's `dsh.client.inject`, and the two are easy to confuse.
 *
 * `connection` is here because `settingsScope.bind()` reads it off the calling
 * context (`ctx.get('connection')`) to get the settings wire face. It is
 * deliberately NOT named in `dsh.client.inject`: on the desktop shell the
 * upstream `connection` row is disabled and the service is provided by
 * `@dsh-desktop/connection` instead, so the service name is portable and the
 * package name is not.
 */
var inject = ['theme', 'settingsScope', 'connection']

/**
 * Read one `{light, dark}` pair out of a settings-scope snapshot.
 * @param {any} snapshot - the scope snapshot from `getSnapshot()`.
 * @returns {{ light: string, dark: string }} the pair to publish.
 */
function readPair(snapshot) {
  var value = snapshot && snapshot.status === 'ready' ? snapshot.value : undefined
  var light = value && typeof value.light === 'string' && value.light !== '' ? value.light : FALLBACK.light
  var dark = value && typeof value.dark === 'string' && value.dark !== '' ? value.dark : FALLBACK.dark
  return { light: light, dark: dark }
}

/**
 * Expand one pair across the three tokens.
 * @param {{ light: string, dark: string }} pair - the colour pair.
 * @returns {Record<string, { light: string, dark: string }>} the override layer.
 */
function layerFor(pair) {
  var tokens = {}
  for (var i = 0; i < TOKENS.length; i += 1) {
    // A fresh object per token: `validateOverrides` copies defensively, but the
    // pair is ours and sharing one object across three keys invites a caller
    // further down to mutate all three at once.
    tokens[TOKENS[i]] = { light: pair.light, dark: pair.dark }
  }
  return tokens
}

/**
 * Bind the namespace and keep the override layer in step with it.
 * @param {any} ctx - client cordis context.
 */
function apply(ctx) {
  // At apply level, not inside the effect below, because `bind()` registers its
  // own teardown on the CALLING fiber — the service proxy rebinds `this.ctx` to
  // us — so the scope is already tied to this plugin's lifetime. Upstream's
  // ui-theme binds at the same depth.
  var scope = ctx.settingsScope.bind({ namespace: NAMESPACE })

  ctx.effect(function () {
    /** Disposer for the layer currently on screen. */
    var dispose
    /** Last pair published, so an unrelated settings change costs nothing. */
    var applied

    var push = function () {
      var pair = readPair(scope.getSnapshot())
      var key = pair.light + '|' + pair.dark
      if (key === applied) return
      applied = key
      // No need to dispose the previous layer first: `overrideTokens` replaces
      // this source's layer wholesale, and the disposer it returned goes inert
      // the moment a newer layer takes its place ("a no-op once the source has
      // re-overridden"). Only the newest disposer can retract what is on
      // screen, so only the newest is kept.
      dispose = ctx.theme.overrideTokens(SOURCE, layerFor(pair))
    }

    push()
    // The `applies: 'live'` the host registration declares is metadata; nothing
    // re-applies anything on our behalf. This subscription is what makes it
    // true — edit `$DSH_HOME/settings.yaml` and the colour changes without a
    // reload, because the file provider publishes, the host invalidates, the
    // shared describe mirror re-reads, and this fires.
    var off = scope.subscribe(push)

    return function () {
      off()
      // Restores whatever this layer covered, so uninstall and reload leave the
      // palette exactly as they found it. This is why the disposer is held at
      // all rather than the tokens being written and forgotten.
      if (dispose !== undefined) dispose()
    }
  }, 'background-color: theme token override')
}

exports.apply = apply
exports.inject = inject
exports.NAMESPACE = NAMESPACE
exports.TOKENS = TOKENS

return module.exports; } });
