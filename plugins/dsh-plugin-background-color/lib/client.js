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
var inject = ['theme', 'settingsScope', 'connection', 'slots']

/**
 * A CSS hex colour, in the three lengths a browser accepts.
 *
 * Only the card uses this, and the stored value stays unvalidated on purpose:
 * the presenter writes it straight into `body.style.setProperty`, where a value
 * the browser cannot parse is dropped and the palette declaration underneath
 * still applies, so a regex in the STORE would reject `oklch()` and every
 * colour function added after it was written. A text box is a different
 * situation — someone typing gets no feedback at all from a value that is
 * silently discarded, so the box refuses to save what it cannot show a swatch
 * of. Editing the YAML by hand still accepts anything.
 */
var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

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
 * The settings card: two hex boxes, one per scheme.
 *
 * Built with `React.createElement` and no JSX, because this bundle is still
 * hand-written and a build step is the one thing this plugin is demonstrating
 * you can do without. React itself is NOT a dependency — the client module
 * system hands it to the factory through `require`, the same way the desktop
 * app's own bundles take it as an external. So a card costs a function, not a
 * toolchain.
 *
 * The Plugins tab enumerates registered settings namespaces and dispatches
 * `settings.plugin.item` once per namespace, keyed by the namespace name; it
 * never interprets one. So the cell for `ui-background` is already being
 * dispatched — before this existed it simply rendered empty. Claiming the key
 * is the whole of "having a settings UI".
 *
 * @param {any} React - the React namespace, from the factory's `require`.
 * @param {any} scope - the bound settings scope for this namespace.
 * @returns {() => any} the card component.
 */
function makeCard(React, scope) {
  var h = React.createElement

  /**
   * One labelled hex field.
   * @param {{ field: 'light'|'dark', label: string, snapshot: any }} props - which field, and the current snapshot.
   * @returns the row.
   */
  function Field(props) {
    var stored = readPair(props.snapshot)[props.field]
    // The box holds a DRAFT while it is focused, so a half-typed `#ee` is not
    // written and then read back over the cursor. `undefined` means "showing
    // what is stored", which is what makes an edit from the YAML file appear
    // here without the box fighting it.
    var draftState = React.useState(undefined)
    var draft = draftState[0]
    var setDraft = draftState[1]
    var text = draft === undefined ? stored : draft
    var valid = HEX.test(text)
    var writable = props.snapshot && props.snapshot.writable === true

    var commit = function () {
      setDraft(undefined)
      if (!valid || text === stored) return
      // Fire and forget: `set` resolves after the host has written and the
      // mirror has folded the answer back in, and the subscription below is
      // what re-renders. Awaiting here would only delay the same result.
      scope.set(props.field, text)
    }

    return h('label', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', fontSize: '13px' },
    }, [
      h('span', { key: 'l', style: { width: '48px', opacity: 0.7 } }, props.label),
      // A live preview of what the text currently means. This is why the field
      // validates at all: without it an unparseable value is indistinguishable
      // from a colour that happens to look like the old one.
      h('span', {
        key: 's',
        style: {
          width: '20px',
          height: '20px',
          borderRadius: '5px',
          border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
          background: valid ? text : 'transparent',
        },
      }),
      h('input', {
        key: 'i',
        value: text,
        disabled: !writable,
        spellCheck: false,
        placeholder: FALLBACK[props.field],
        onChange: function (event) { setDraft(event.target.value) },
        onBlur: commit,
        onKeyDown: function (event) {
          if (event.key === 'Enter') commit()
          // Escape abandons the draft rather than committing it, which is the
          // only way back to the stored value once you have typed over it.
          if (event.key === 'Escape') setDraft(undefined)
        },
        style: {
          font: 'inherit',
          fontSize: '12px',
          fontFamily: 'ui-monospace, monospace',
          width: '100px',
          padding: '4px 8px',
          borderRadius: '6px',
          background: 'transparent',
          color: 'inherit',
          border: '1px solid color-mix(in srgb, '
            + (valid ? 'currentColor 25%' : 'red 60%') + ', transparent)',
        },
      }),
      h('button', {
        key: 'r',
        type: 'button',
        // `unset` clears this field from the user layer, so the value falls
        // back to the schema default rather than being written to it. Writing
        // the default would pin it, and a later change to the default would
        // then not reach anyone who had ever pressed this.
        onClick: function () { setDraft(undefined); scope.unset(props.field) },
        disabled: !writable,
        style: {
          font: 'inherit',
          fontSize: '11px',
          padding: '3px 8px',
          borderRadius: '5px',
          background: 'transparent',
          color: 'inherit',
          opacity: 0.6,
          cursor: 'pointer',
          border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
        },
      }, 'Reset'),
    ])
  }

  return function BackgroundColourCard() {
    // The scope is an external store already — the same `subscribe`/
    // `getSnapshot` pair the override subscription uses — so React reads it
    // directly and a YAML edit re-renders the card for free.
    var snapshot = React.useSyncExternalStore(
      function (listener) { return scope.subscribe(listener) },
      function () { return scope.getSnapshot() },
    )

    return h('li', {
      style: {
        listStyle: 'none',
        padding: '14px 16px',
        borderRadius: '10px',
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
      },
    }, [
      h('div', { key: 't', style: { fontSize: '13px', fontWeight: 500 } }, 'Background Colour'),
      h('div', { key: 'h', style: { fontSize: '12px', opacity: 0.6, lineHeight: 1.45, padding: '2px 0 8px' } },
        'One colour per scheme, painted over the frame, the sidebar and the conversation view. '
        + 'Applies as soon as you leave the box.'),
      h(Field, { key: 'light', field: 'light', label: 'Light', snapshot: snapshot }),
      h(Field, { key: 'dark', field: 'dark', label: 'Dark', snapshot: snapshot }),
    ])
  }
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

  // `slots.inject` rather than a bare register: the cell is declared by the
  // Plugins section, which may activate after this row. Injecting waits for the
  // declaration instead of racing it — and a card that loses that race does not
  // error, it just never appears, which is the worst way to find out.
  ctx.slots.inject('settings.plugin.item', function () {
    return ctx.slots.register(
      // The key IS the namespace. The tab dispatches one cell per registered
      // namespace and leaves the contents entirely to whoever owns it.
      { name: 'settings.plugin.item', key: NAMESPACE },
      makeCard(require('react'), scope),
    )
  })
}

exports.apply = apply
exports.inject = inject
exports.NAMESPACE = NAMESPACE
exports.TOKENS = TOKENS

return module.exports; } });
