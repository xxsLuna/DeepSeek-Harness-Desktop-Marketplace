// @ts-check
/**
 * dsh-plugin-liquid-glass — browser half: the stylesheet, and the card that
 * tunes it.
 *
 * Hand-written and shaped exactly like a built bundle, the same way
 * `dsh-plugin-background-color` is: the wrapper below is what
 * `scripts/build-client.mjs` emits in the desktop repo, with this package's id
 * substituted. It MUST stay a classic script — the client module system loads a
 * bundle with `document.createElement('script')` and then asserts the file
 * registered a factory synchronously, which an ES module would defer past.
 *
 * ## Why a stylesheet and not theme tokens
 *
 * `dsh-plugin-background-color` argues, correctly, that `overrideTokens` beats
 * CSS injection: the presenter writes tokens as inline custom properties on
 * `body`, which outranks the palette's own declarations with no specificity
 * argument to lose. That argument holds for *colours*, and only for colours.
 *
 * Glass is not a colour. `backdrop-filter`, a specular inset highlight, a
 * corner radius and a shadow are properties on the panels themselves, and no
 * token carries any of them. So this one injects a sheet — which upstream's own
 * client bundles also do (they tag theirs `data-plugin`, and this follows that
 * convention so the source of a rule is findable in the inspector).
 *
 * The cost is real and worth naming: an injected sheet has to out-specify
 * CSS-module rules on the very elements it is restyling, so the declarations
 * carry `!important`. That is a blunt instrument. It is confined to the four
 * properties that make the effect and never touches layout, so a rule that
 * loses is a panel that looks ordinary rather than a window that breaks.
 *
 * ## Why the anchors are declared rather than inlined
 *
 * Two of the three selectors are semantic and durable — `[role="dialog"]` is
 * ARIA, `[data-composer-card]` is a hook upstream put there on purpose. The
 * third is not: the sidebar column is only reachable through the hashed local
 * name its CSS module generates, and that string changes whenever upstream
 * renames the class. A stylesheet that quietly stops matching is exactly the
 * silent breakage this project keeps pinning in tests, and a plugin cannot add
 * a test to the app — so instead every anchor is named, counted at render time,
 * and reported in the settings card. When the sidebar stops frosting, the card
 * says `sidebar — no match` rather than leaving you to wonder.
 */
window.__ModuleLoader__.load({ id: "dsh-plugin-liquid-glass", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/** Must equal the host half's `settingsNamespace('ui-liquid-glass')`. */
var NAMESPACE = 'ui-liquid-glass'

/** Identifies our `<style>` tag, and matches upstream's `data-plugin` convention. */
var TAG_ID = 'dsh-plugin-liquid-glass'

/**
 * Cordis SERVICE names — a different namespace from the package names in
 * `dsh.client.inject`, and the two are easy to confuse.
 *
 * `connection` is here because `settingsScope.bind()` reads it off the calling
 * context to reach the settings wire. It is deliberately NOT in
 * `dsh.client.inject`: on the desktop shell the upstream `connection` row is
 * disabled and `@dsh-desktop/connection` provides the service instead, so the
 * service name is portable across surfaces and the package name is not.
 */
var inject = ['settingsScope', 'connection', 'slots']

/** Falls back to the schema's own defaults until the host registration lands. */
var FALLBACK = { blur: 20, saturation: 180, opacity: 45, radius: 20, inset: 8 }

/**
 * What gets frosted, in the order the card lists them.
 *
 * `stable: false` is the honest label on an anchor that depends on a string
 * upstream did not promise. Everything about how this degrades — the card's
 * warning, the "no match" line — reads from this flag rather than from a
 * comment nobody will re-check.
 */
var ANCHORS = [
  {
    id: 'dialog',
    label: 'Dialogs',
    selector: '[role="dialog"]',
    stable: true,
    blur: true,
    note: 'ARIA, so upstream cannot rename it without breaking screen readers too.',
  },
  {
    id: 'composer',
    label: 'Composer',
    selector: '[data-composer-card]',
    stable: true,
    blur: true,
    note: 'A hook upstream added deliberately.',
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    selector: '[class*="sidebarCol"]',
    stable: false,
    // NOT a preference, and not a thing to "fix" by switching it on. An element
    // with `backdrop-filter` becomes the containing block for every
    // position:fixed descendant, and the Settings dialog is rendered INSIDE the
    // sidebar — its overlay hangs off the Settings button in the sidebar
    // footer rather than being portalled to the body. Blurring this column
    // therefore reparents that fixed overlay onto a 280px box and the whole
    // Settings dialog collapses into the sidebar's width. Measured, not feared.
    //
    // Nothing is lost by leaving it off: the sidebar sits on the flat window
    // frame, so there is no content behind it for a blur to reveal. What makes
    // it read as glass is the inset, the four rounded corners, the specular
    // edge and the translucency — none of which need a backdrop-filter.
    blur: false,
    note: 'Matches a hashed CSS-module local name; an upstream rename silently unfrosts it.',
  },
]

/**
 * Read the four numbers out of a settings-scope snapshot.
 * @param {any} snapshot - the scope snapshot from `getSnapshot()`.
 * @returns {{blur: number, saturation: number, opacity: number, radius: number, inset: number}} the values to render.
 */
function readSettings(snapshot) {
  var value = snapshot && snapshot.status === 'ready' ? snapshot.value : undefined
  var out = {}
  for (var key in FALLBACK) {
    var candidate = value === undefined ? undefined : value[key]
    out[key] = typeof candidate === 'number' && isFinite(candidate) ? candidate : FALLBACK[key]
  }
  return /** @type {any} */ (out)
}

/**
 * Compose the stylesheet.
 *
 * Everything variable is a custom property on `body`, so the rules below are
 * constant text and only the numbers change — which also means the effect can
 * be inspected and poked at in devtools without going through this plugin at
 * all.
 *
 * The scheme split is `body[data-ds-dark-theme]`, the same selector the shipped
 * palette uses for its own dark declarations. A specular highlight that reads
 * as glass on a dark panel is a white haze on a light one, so the two schemes
 * get different highlight strengths rather than one compromise.
 * @param {{blur: number, saturation: number, opacity: number, radius: number, inset: number}} s - the current settings.
 * @returns {string} the sheet.
 */
function sheetFor(s) {
  // Every selector is scoped under `body`, and that is a specificity move
  // rather than a tidiness one. `!important` does not settle a fight between
  // two author rules that both carry it — specificity decides, and document
  // order only after that. @dsh-desktop/chrome declares
  // `[class*="_sidebarCol"] { padding-top: var(--dsh-title-band) !important }`
  // at exactly the same specificity as a bare `[class*="sidebarCol"]`, so which
  // sheet happened to be appended last silently decided the layout — and it was
  // not this one. One element to the left makes it (0,1,1) against (0,1,0) and
  // the answer stops depending on load order.
  var scope = function (list) {
    return list.map(function (one) { return 'body ' + one }).join(',\n')
  }
  var selectors = scope(ANCHORS.map(function (a) { return a.selector }))
  var blurred = scope(ANCHORS.filter(function (a) { return a.blur }).map(function (a) { return a.selector }))
  return [
    // Declared on `body`, NOT `:root`, and that is load-bearing rather than
    // stylistic: `--dsw-alias-bg-layer-1` is declared by the palette on `body`,
    // so a `color-mix` referencing it from `:root` has nothing to resolve and
    // the whole custom property becomes invalid at computed-value time. In dark
    // the second block below happens to sit on `body` and covered for it; in
    // light there was no second block, `--lg-surface` resolved to nothing, and
    // every panel lost its background. Measured, after shipping it.
    'body {',
    '  --lg-blur: ' + s.blur + 'px;',
    '  --lg-saturate: ' + s.saturation + '%;',
    '  --lg-opacity: ' + s.opacity + '%;',
    '  --lg-radius: ' + s.radius + 'px;',
    '  --lg-inset: ' + s.inset + 'px;',
    // Light scheme: the panel sits on pale surfaces, so the edge is a thin grey
    // rather than white, which would be invisible.
    '  --lg-edge: color-mix(in srgb, #000 12%, transparent);',
    '  --lg-specular: color-mix(in srgb, #fff 70%, transparent);',
    '  --lg-shadow: 0 10px 34px color-mix(in srgb, #000 14%, transparent);',
    // The surface is LIFTED off the token before it is made translucent, and
    // that is not a taste — without it the effect is invisible or backwards.
    // Composited over the window frame, the plain token lands on exactly the
    // colour the sidebar already was (measured: #1b1b1c on #1b1b1c in dark at
    // 42%), and it lands BELOW the composer's own elevated colour, so the
    // composer reads as sunken rather than raised. Glass is brighter than what
    // it sits on; this is what makes it so.
    // Light: the palette's layer-1 is already #fff, so there is no headroom to
    // lift into. The panel reads as glass here through the edge, the shadow and
    // the sheen rather than through being brighter than its backdrop.
    '  --lg-surface: var(--dsw-alias-bg-layer-1);',
    // A sheen down the top of the panel. On a varied backdrop the blur alone
    // sells the effect; on a flat one — which is what the sidebar and the
    // composer sit on — there is nothing for a blur to reveal, and this
    // gradient is the whole of what makes them read as glass rather than as a
    // slightly different rectangle.
    '  --lg-sheen: color-mix(in srgb, #fff 45%, transparent);',
    '}',
    'body[data-ds-dark-theme] {',
    '  --lg-edge: color-mix(in srgb, #fff 12%, transparent);',
    '  --lg-specular: color-mix(in srgb, #fff 24%, transparent);',
    '  --lg-shadow: 0 12px 40px color-mix(in srgb, #000 45%, transparent);',
    '  --lg-surface: color-mix(in srgb, #fff 8%, var(--dsw-alias-bg-layer-1));',
    '  --lg-sheen: color-mix(in srgb, #fff 7%, transparent);',
    '}',
    selectors + ' {',
    // The panel keeps its own colour and only loses opacity, so this follows
    // the palette (and anything overriding it, such as the background-colour
    // plugin) instead of imposing a colour of its own.
    '  background-color: color-mix(in srgb, var(--lg-surface) var(--lg-opacity), transparent) !important;',
    // Sheen over the tint, fading out by 40% of the panel's height. Not a
    // decoration: it is what a panel on a flat backdrop has instead of a blur.
    '  background-image: linear-gradient(to bottom, var(--lg-sheen), transparent 40%) !important;',
    '  border: 1px solid var(--lg-edge) !important;',
    '  border-radius: var(--lg-radius) !important;',
    // Two shadows: the outer one lifts the panel off what is behind it, the
    // inset hairline along the top is the specular edge that makes it read as
    // a physical sheet rather than a translucent rectangle.
    '  box-shadow: var(--lg-shadow), inset 0 1px 0 var(--lg-specular) !important;',
    '}',
    // The blur is a SEPARATE rule, over a subset, and the split is load-bearing.
    // `backdrop-filter` makes an element the containing block for every
    // position:fixed descendant, so putting it on a panel that hosts one
    // reparents that panel's overlay and collapses it. See the `blur` flag on
    // ANCHORS for the case that proved it.
    blurred + ' {',
    '  backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate)) !important;',
    '  -webkit-backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate)) !important;',
    '}',
    // The sidebar floats, and that is the whole difference between this reading
    // as glass and reading as a wall.
    //
    // Left flush to the window it is a full-bleed column: three of its four
    // corners have nothing to be round against, so rounding only the inner edge
    // looks like a mistake rather than a shape, and — more to the point —
    // nothing of the window shows around it, so there is no sense of a pane
    // sitting ON something. Insetting it is what creates that, and it is how
    // the platform this imitates has drawn a sidebar since the look was
    // introduced.
    //
    // OUTER spacing only. An earlier version also zeroed the column's own
    // `padding-top` and moved the title-band clearance into this margin, so
    // that the panel would begin below the band. It looked defensible and it
    // was wrong: that padding is the app's internal spacing, every child is
    // positioned against it, and taking it away rearranged the sidebar's
    // contents. A third-party stylesheet gets to say where a panel sits; it
    // does not get to redistribute the space inside it.
    //
    // So the margin is uniform and the padding is left alone. The panel's top
    // edge tucks under the title band, which is where a floating sidebar sits
    // on the platform this imitates anyway, and the band's own clearance keeps
    // doing the one job it was already doing.
    'body ' + ANCHORS[2].selector + ' {',
    // The same gap on all four sides. A floating pane with a different margin
    // at the top than the bottom does not read as floating, it reads as
    // misaligned — and the eye catches that immediately even when it cannot say
    // why. An earlier version sat flush at the top to keep clear of the title
    // bar; the gap that fixed was 46px, not 8, and 8 is small enough that the
    // panel still belongs to the top of the window.
    '  margin: var(--lg-inset) !important;',
    // No hairline and no specular along the TOP of this one. That edge runs
    // through the title-bar strip, where a bright 1px line spanning the column
    // reads as a grey bar someone added rather than as the lit edge of a pane.
    // The other three sides keep theirs, and the dialog and composer keep all
    // four — neither of them runs through the title bar.
    '  border-top-color: transparent !important;',
    '  box-shadow: var(--lg-shadow) !important;',
    // Pull the contents back up by exactly the inset, and no further. The
    // column's padding exists to clear the title band; the inset then pushed
    // everything down a second time, which is why the sidebar's contents sat
    // lower with this plugin on than without it. Subtracting the inset from the
    // padding puts the first row back on the band's bottom edge.
    //
    // It stops there for a hard reason, not a cautious one. `#dsh-drag-strip`
    // covers the top `--dsh-title-band` pixels with `pointer-events: auto` and
    // `-webkit-app-region: drag`, so anything drawn under it is unclickable —
    // measured: at y=20 the strip is the topmost element, at y=44 the sidebar
    // is. Content raised past that line would look right and stop responding.
    //
    // `max()` because a platform that kept its native title bar has no band at
    // all, and a negative padding is not a smaller one, it is an ignored
    // declaration.
    '  padding-top: max(0px, calc(var(--dsh-title-band, 0px) - var(--lg-inset))) !important;',
    '}',
    // The launcher's hamburger, which opens the same menu the app already
    // offers from inside the sidebar. Flush against a floating panel it is the
    // one piece of chrome left sitting on the window rather than on a pane, and
    // hiding it is why the top-left reads as one surface. Hidden only while
    // this plugin is on; removing the plugin brings it straight back.
    'body #dsh-menu-button {',
    '  display: none !important;',
    '}',
    // Collapsed: the gap goes vertical-only, and the rail keeps its corners.
    //
    // The state lives in an inline `grid-template-columns` on the frame, which
    // no selector can see, so the browser half watches for it and marks the
    // body — see `watchLayout`.
    //
    // The HORIZONTAL inset is what cannot survive here. The collapsed track is
    // 56px and the app lays its icons out at a fixed 11px from the left at 36px
    // wide, so the panel needs 47 of those 56 — measured — and 8px a side
    // leaves 40 and clips six buttons by 7px each. Even 4px a side fits with
    // exactly 1px to spare, which is not a margin of safety, it is a bet on
    // upstream never touching that padding.
    //
    // Vertical costs nothing: the column is full height and has room to give at
    // the top and bottom, so the rail still reads as a pane sitting on the
    // window rather than lining its edge, and nothing can be clipped by it.
    'body[data-lg-narrow] ' + ANCHORS[2].selector + ' {',
    '  margin: var(--lg-inset) 0 !important;',
    // Flush to the left edge, so the border there would be a line against the
    // window rather than the side of a pane.
    '  border-left-color: transparent !important;',
    '}',
    // The app writes an explicit pixel width inline on the sidebar's inner root
    // — it is a resizable column, so JS owns that number — and that width is
    // the column's ORIGINAL width. Once the panel is inset it is narrower than
    // its own contents, `overflow: hidden` takes the difference, and the right
    // edge of everything inside is quietly cut off.
    //
    // `max-width` rather than `width`, and this is the whole reason it is safe:
    // it does not impose a size, it only stops one from exceeding the panel. A
    // sidebar the user has dragged narrower keeps exactly the width they chose.
    // An author `!important` outranks an inline declaration that has none, which
    // is what lets a stylesheet correct a number JS wrote.
    'body ' + ANCHORS[2].selector + ' [style*="width"] {',
    '  max-width: 100% !important;',
    '}',
    // The sidebar's rendered root must not paint over the glass.
    //
    // It carries the opaque sidebar fill and covers the column from just below
    // the title band all the way down, so the only place the frosting was ever
    // visible was the strip of padding above it — which is exactly why that
    // strip read as a grey bar someone had added. The panel was never glass. It
    // was an opaque column with a lit edge on top of it.
    //
    // Reached structurally rather than through the inline width, because the
    // app only writes that width while the sidebar is expanded: keying off it
    // left the collapsed rail painting its own fill and the grey bar came
    // straight back. The wrapper in between is `display: contents`, so this is
    // one element in both states — checked in both.
    //
    // Cleared rather than re-tinted: the column underneath already carries the
    // colour, the translucency and the sheen, and painting the same thing twice
    // would double the tint.
    'body ' + ANCHORS[2].selector + ' > * > * {',
    '  background-color: transparent !important;',
    '}',
    // NOT here: rounding the window itself.
    //
    // It is the obvious next thing to want, and from inside the page it does
    // nothing. The frame is the outermost element the page paints, so rounding
    // it exposes whatever is behind — `body`, and behind that the BrowserWindow
    // — and both are the same colour the frame was. Tried with the page
    // backgrounds cleared to transparent as well: the corners came out
    // pixel-identical, because a window that is not `transparent: true` still
    // composites its own opaque background underneath.
    //
    // Making a window genuinely round is a BrowserWindow option, which belongs
    // to the launcher; a plugin runs in the harness process and cannot reach
    // it. Shipping the rule anyway would add an `overflow: hidden` on the app's
    // outermost container — a real way to clip a popover — in exchange for
    // nothing visible, so it is left out and written down instead.
    // Motion is part of the look, but only for people who have not asked for
    // less of it.
    '@media (prefers-reduced-motion: no-preference) {',
    '  ' + selectors + ' { transition: background-color 160ms ease, box-shadow 160ms ease; }',
    '}',
  ].join('\n')
}

/**
 * Install or replace the sheet.
 * @param {string} css - the composed stylesheet.
 * @returns {() => void} a disposer that removes it again.
 */
function installSheet(css) {
  var tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(TAG_ID) + ']')
  if (tag === null) {
    tag = document.createElement('style')
    tag.setAttribute('data-plugin', TAG_ID)
    tag.setAttribute('data-plugin-css', TAG_ID)
    document.head.appendChild(tag)
  }
  tag.textContent = css
  var installed = tag
  return function () {
    // Removed rather than emptied: an empty sheet left in the document is a
    // thing the next reader has to rule out, and uninstall should leave no
    // trace of a plugin that is gone.
    if (installed.parentNode !== null) installed.parentNode.removeChild(installed)
  }
}

/**
 * Below this, the sidebar is showing icons only and has no room to give away.
 *
 * Chosen so the decision cannot oscillate. Expanded, the column is ~280 and the
 * panel ~264 once the inset is taken; collapsed it is a few dozen pixels either
 * way. Both readings of each state land on the same side of this number, so
 * removing the inset can never widen the panel back over the line and put it
 * straight back.
 */
var NARROW_PX = 140

/**
 * How long after a layout change to look again.
 *
 * Comfortably past the collapse animation, and short enough that a wrong
 * reading taken mid-transition is never on screen long enough to notice.
 */
var SETTLE_MS = 400

/**
 * Mark the body while the sidebar is collapsed.
 *
 * The collapsed state is an inline `grid-template-columns` on the frame — no
 * class, no attribute, nothing a selector can reach — so a stylesheet can only
 * respond to it if something watches and writes a hook. The attribute this sets
 * is the plugin's own and lives on `body`, where it cannot collide with
 * anything upstream owns.
 *
 * Two things here were arrived at the hard way.
 *
 * **The frame is watched, not the sidebar.** A `ResizeObserver` on the column
 * fires once and then never again: collapsing re-mounts that element, the
 * observed node is detached, and observation goes with it. Measured — the
 * observer reported 262px and stayed silent through a 264 → 40 collapse. The
 * frame is not re-mounted, and it is the node the state actually lives on.
 *
 * **The track is read, not the panel.** The first grid track is the width the
 * app decided; the panel is that minus this plugin's own inset. Keying off the
 * panel would mean this rule's input depends on the rule's output, and the
 * threshold could then chase itself. The track is independent of anything here.
 * @param {Element} frame - the layout frame, whose inline style carries the state.
 * @returns {() => void} a disposer that stops watching and clears the mark.
 */
function watchLayout(frame) {
  /** Pending re-read once the collapse animation has settled. */
  var settle = 0

  var mark = function () {
    var first = getComputedStyle(frame).gridTemplateColumns.split(' ')[0]
    var width = parseFloat(first)
    // A track that is not a plain px value means the layout is doing something
    // this does not understand, and quietly guessing "collapsed" would strip
    // the inset off a perfectly normal sidebar. Leave it alone instead.
    if (isFinite(width) && width > 0 && width < NARROW_PX) {
      document.body.setAttribute('data-lg-narrow', '')
    } else {
      document.body.removeAttribute('data-lg-narrow')
    }
  }
  /**
   * Read now, and read again once the column has stopped moving.
   *
   * The collapse is animated, so `getComputedStyle` during it returns an
   * interpolated track width — and an interpolated width is a real number that
   * happens to be wrong. Measured: a startup pass latched 56px mid-transition
   * and the sidebar stayed marked collapsed at its full 280px, because the
   * animation finishing writes no attribute and fires no mutation, so nothing
   * ever asked again.
   *
   * `transitionend` is the precise signal and does not fire when the change was
   * not animated; the timeout is the one that always arrives. Running both,
   * with the immediate read as well, means the mark is right within a frame in
   * the common case and right within `SETTLE_MS` in every case.
   */
  var schedule = function () {
    mark()
    if (settle !== 0) clearTimeout(settle)
    settle = setTimeout(function () {
      settle = 0
      mark()
    }, SETTLE_MS)
  }

  mark()
  // The inline `style` is where the collapse is written, so that attribute is
  // the signal. `ResizeObserver` covers the other way the tracks change — the
  // window being resized. Both nodes survive a collapse (checked: the frame and
  // the column keep their identity across a toggle), so observing them directly
  // is enough and no subtree watch is needed.
  var mutations = new MutationObserver(schedule)
  mutations.observe(frame, { attributes: true, attributeFilter: ['style'] })
  var resizes = new ResizeObserver(schedule)
  resizes.observe(frame)
  frame.addEventListener('transitionend', schedule)
  return function () {
    if (settle !== 0) clearTimeout(settle)
    frame.removeEventListener('transitionend', schedule)
    mutations.disconnect()
    resizes.disconnect()
    document.body.removeAttribute('data-lg-narrow')
  }
}

/**
 * The settings card: four numbers, and an honest report on the anchors.
 * @param {any} React - the React namespace, from the factory's `require`.
 * @param {any} scope - the bound settings scope for this namespace.
 * @returns {() => any} the card component.
 */
function makeCard(React, scope) {
  var h = React.createElement

  var FIELDS = [
    { field: 'blur', label: 'Blur', min: 0, max: 60, suffix: 'px' },
    { field: 'saturation', label: 'Saturation', min: 100, max: 300, suffix: '%' },
    { field: 'opacity', label: 'Opacity', min: 25, max: 100, suffix: '%' },
    { field: 'radius', label: 'Corner', min: 0, max: 40, suffix: 'px' },
    { field: 'inset', label: 'Inset', min: 0, max: 24, suffix: 'px' },
  ]

  /**
   * One slider plus its number, both writing the same field.
   * @param {any} props - the field spec and the current snapshot.
   * @returns the row.
   */
  function Row(props) {
    var stored = readSettings(props.snapshot)[props.field]
    var writable = props.snapshot && props.snapshot.writable === true
    // The slider writes on release rather than on every pixel of the drag:
    // each write is a round trip to the host and a document commit, and a drag
    // would queue a hundred of them to reach the value you stopped at.
    var liveState = React.useState(undefined)
    var live = liveState[0]
    var setLive = liveState[1]
    var shown = live === undefined ? stored : live

    var commit = function (next) {
      setLive(undefined)
      if (next !== stored) scope.set(props.field, next)
    }

    return h('label', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', fontSize: '13px' },
    }, [
      h('span', { key: 'l', style: { width: '76px', opacity: 0.7 } }, props.label),
      h('input', {
        key: 'r',
        type: 'range',
        min: props.min,
        max: props.max,
        value: shown,
        disabled: !writable,
        onChange: function (e) { setLive(Number(e.target.value)) },
        onMouseUp: function (e) { commit(Number(e.target.value)) },
        onKeyUp: function (e) { commit(Number(e.target.value)) },
        style: { flex: '1 1 auto', accentColor: 'currentColor', minWidth: 0 },
      }),
      h('span', {
        key: 'v',
        style: {
          width: '54px',
          textAlign: 'right',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '12px',
          opacity: 0.75,
          fontVariantNumeric: 'tabular-nums',
        },
      }, String(shown) + props.suffix),
    ])
  }

  return function LiquidGlassCard() {
    var snapshot = React.useSyncExternalStore(
      function (listener) { return scope.subscribe(listener) },
      function () { return scope.getSnapshot() },
    )

    // Counted at render time rather than once at install: a dialog only exists
    // while it is open, and this card is itself inside one — so the dialog
    // anchor reporting a match is the card looking at its own container.
    var health = ANCHORS.map(function (a) {
      var found = document.querySelectorAll(a.selector)
      // A blurred panel that has grown a position:fixed descendant is the
      // failure that collapsed the Settings dialog once already: the blur makes
      // the panel that descendant's containing block. Upstream can introduce
      // one at any time by moving where an overlay mounts, so it is checked
      // here rather than assumed to stay true.
      var trapped = 0
      if (a.blur) {
        for (var i = 0; i < found.length; i += 1) {
          var inner = found[i].querySelectorAll('*')
          for (var j = 0; j < inner.length; j += 1) {
            if (getComputedStyle(inner[j]).position === 'fixed') { trapped += 1; break }
          }
        }
      }
      return { a: a, n: found.length, trapped: trapped }
    })
    var missing = health.filter(function (row) { return row.n === 0 && !row.a.stable })
    var trapping = health.filter(function (row) { return row.trapped > 0 })

    // Which fields the user layer actually carries. Read from `user` rather
    // than compared against the defaults: a value deliberately set to the
    // default is still a value the user wrote, and Reset should clear it.
    var userLayer = snapshot && snapshot.user !== undefined && snapshot.user !== null ? snapshot.user : {}
    var overridden = FIELDS
      .map(function (f) { return f.field })
      .filter(function (field) { return userLayer[field] !== undefined })

    return h('li', {
      style: {
        listStyle: 'none',
        padding: '14px 16px',
        borderRadius: '10px',
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
      },
    }, [
      h('div', {
        key: 't',
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      }, [
        h('span', { key: 'n', style: { fontSize: '13px', fontWeight: 500 } }, 'Liquid Glass'),
        h('button', {
          key: 'r',
          type: 'button',
          // Disabled when nothing is overridden, so the button also answers
          // "have I changed anything?" without needing to remember the
          // defaults. `snapshot.user` is the user layer alone, which is exactly
          // that question.
          disabled: overridden.length === 0 || !(snapshot && snapshot.writable === true),
          // `unset` per field, not a write of the default values. Writing them
          // would pin today's defaults into the user's document, and a later
          // change to a default would then never reach anyone who had pressed
          // this — the button would quietly become "freeze the current
          // defaults forever".
          onClick: function () {
            for (var i = 0; i < overridden.length; i += 1) scope.unset(overridden[i])
          },
          title: overridden.length === 0
            ? 'Everything is already at its default'
            : 'Clear ' + overridden.join(', '),
          style: {
            font: 'inherit',
            fontSize: '11px',
            padding: '3px 9px',
            borderRadius: '5px',
            background: 'transparent',
            color: 'inherit',
            opacity: overridden.length === 0 ? 0.35 : 0.75,
            cursor: overridden.length === 0 ? 'default' : 'pointer',
            border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
          },
        }, 'Reset to defaults'),
      ]),
      h('div', { key: 'h', style: { fontSize: '12px', opacity: 0.6, lineHeight: 1.45, padding: '2px 0 8px' } },
        'Frosted panels over what is behind them. Applies as you release each slider.'),
      h('div', { key: 'f' }, FIELDS.map(function (f) {
        return h(Row, {
          key: f.field, field: f.field, label: f.label,
          min: f.min, max: f.max, suffix: f.suffix, snapshot: snapshot,
        })
      })),
      h('div', {
        key: 'a',
        style: { fontSize: '11px', opacity: 0.55, lineHeight: 1.5, paddingTop: '8px' },
      }, health.map(function (row) {
        return h('div', { key: row.a.id },
          row.a.label + ' — ' + (row.n === 0 ? 'no match' : row.n + ' matched')
          + (row.a.blur ? '' : ', no blur')
          + (row.a.stable ? '' : ' (fragile selector)'))
      })),
      missing.length === 0 ? null : h('div', {
        key: 'w',
        style: { fontSize: '11px', lineHeight: 1.5, paddingTop: '6px', opacity: 0.85 },
      }, 'An upstream rename has unfrosted: ' + missing.map(function (row) { return row.a.label }).join(', ')
        + '. Everything else still works; this plugin needs a new selector.'),
      trapping.length === 0 ? null : h('div', {
        key: 'x',
        style: { fontSize: '11px', lineHeight: 1.5, paddingTop: '6px', opacity: 0.85 },
      }, 'Blur is trapping a floating panel inside: '
        + trapping.map(function (row) { return row.a.label }).join(', ')
        + '. Anything that floats out of it will be clipped to its box — that anchor needs its blur turned off.'),
    ])
  }
}

/**
 * Bind the namespace, keep the sheet in step with it, and offer the card.
 * @param {any} ctx - client cordis context.
 */
function apply(ctx) {
  // At apply level rather than inside the effect: `bind()` registers its own
  // teardown on the calling fiber, so the scope is already tied to this
  // plugin's lifetime.
  var scope = ctx.settingsScope.bind({ namespace: NAMESPACE })

  ctx.effect(function () {
    /** Removes whatever sheet is currently installed. */
    var remove
    /** Last sheet written, so an unrelated settings change costs no DOM work. */
    var applied

    var push = function () {
      var css = sheetFor(readSettings(scope.getSnapshot()))
      if (css === applied) return
      applied = css
      remove = installSheet(css)
    }

    push()
    // What makes the host's `applies: 'live'` true: nothing re-applies anything
    // on our behalf, so this subscription is the live path. Editing
    // `$DSH_HOME/settings.yaml` reaches here without a reload.
    var off = scope.subscribe(push)

    return function () {
      off()
      // Uninstall, disable and reload all leave the document as they found it.
      if (remove !== undefined) remove()
    }
  }, 'liquid-glass: stylesheet')

  ctx.effect(function () {
    /** @type {(() => void) | undefined} */
    var stop
    /** @type {number | undefined} */
    var frame

    // Retried rather than looked for once. This row activates before React has
    // painted the shell, so a single deferred query finds nothing and the
    // collapsed sidebar then clips its icons with no sign of why — measured,
    // after shipping exactly that. Retrying costs one query per frame for as
    // long as the column is missing, and stops the moment it is found.
    var look = function () {
      var layout = document.querySelector('[class*="_frame"]')
      if (layout !== null) {
        stop = watchLayout(layout)
        frame = undefined
        return
      }
      frame = requestAnimationFrame(look)
    }
    look()

    return function () {
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (stop !== undefined) stop()
    }
  }, 'liquid-glass: collapsed-sidebar watch')

  // `slots.inject` rather than a bare register: the cell is declared by the
  // Plugin configuration tab and only exists while that tab is mounted, so
  // injecting waits for the declaration instead of losing a race it would
  // report as nothing at all.
  ctx.slots.inject('settings.plugin.item', function () {
    return ctx.slots.register(
      // The key is the namespace: the tab dispatches one cell per served
      // namespace and leaves the contents entirely to whoever owns it.
      { name: 'settings.plugin.item', key: NAMESPACE },
      makeCard(require('react'), scope),
    )
  })
}

exports.apply = apply
exports.inject = inject
exports.NAMESPACE = NAMESPACE
exports.ANCHORS = ANCHORS

return module.exports; } });
