# dsh-plugin-liquid-glass

Frosted, translucent panels in the spirit of Apple's Liquid Glass — the design
language introduced across Apple's platforms in the OS 26 generation. Backdrop
blur, a saturation lift so colour behind a panel blooms through it, a specular
hairline along the top edge, and generous corners.

Three surfaces are frosted: **dialogs**, the **composer**, and the **sidebar** —
and the sidebar is inset from the window on every side, with all four corners
rounded, so it floats rather than lining the edge.

## Tuning it

**Settings ▸ Plugins ▸ Plugin configuration ▸ Liquid Glass** — five sliders,
applied when you release each one. The values also live in
`$DSH_HOME/settings.yaml` and apply without a reload:

```yaml
ui-liquid-glass:
  blur: 20        # px,  0–60
  saturation: 180 # %,   100–300
  opacity: 45     # %,   25–100
  radius: 20      # px,  0–40
  inset: 8        # px,  0–24
```

Each bound has a reason a user would notice rather than a stylistic one. Blur
past ~60px reads as fog rather than glass, and every pixel of it is per-frame
GPU work on a surface the size of the window. Saturation is most of why glass
looks like glass and not like tracing paper; 100 is neutral. Opacity below ~25
leaves text sitting on whatever scrolls underneath. The schema clamps rather
than trusting the file, because these compose straight into CSS and a negative
blur is a typo, not a taste.

Set `opacity: 100` for the panels without the translucency, or `blur: 0` for
translucency without the blur.

**Reset to defaults** clears all five with `unset` rather than writing the
current defaults back in. Writing them would pin today's numbers into your
document, and a later change to a default would then never reach you — the
button would quietly mean "freeze these forever". It greys out when nothing is
overridden, so it also answers "have I changed anything?".

## Why the blur only shows on dialogs

Because a blur can only reveal what is behind it, and only one of the three
panels has anything varied back there. Measured in a running window, dark
scheme:

| Panel | Directly behind it |
| --- | --- |
| Dialog | a `rgba(0,0,0,.5)` scrim, and under that **the conversation** |
| Composer | the conversation root — flat `#151517` |
| Sidebar | the window frame — flat `#151517` |

Blurring a flat colour returns that same flat colour. So on the composer and
the sidebar the blur is doing exactly what it is asked to and producing nothing
visible, which is why they are the two that look untouched.

That is also why the surface is **lifted before it is made translucent**. Mixing
the plain `--dsw-alias-bg-layer-1` down over the frame lands on `#1b1b1c` at 42%
opacity — byte-identical to the colour the sidebar already was, and *darker*
than the composer's own elevated `#2c2c2e`, so the composer read as sunken
rather than raised. Glass is brighter than what it sits on. The surface is
mixed with a little white first, and a sheen fades down the top of each panel;
between them that is the whole of what makes a panel on a flat backdrop read as
glass at all.

Lifting the surface changed what a given `opacity` *means*, which the first
release did not account for: at the old default of 62 the lifted colour
composites brighter than the palette's own raised-surface token and reads as a
solid chip — the glass looked switched off. The default is 45, where it lands on
almost exactly that token, so a panel looks native and is still visibly
see-through.

## Why the main window needed more than a blur

The dialog looked right long before the main window did, and the reason is that
a dialog was the only panel doing anything a blur can show. The fix for the rest
was not more blur, it was geometry.

Flush to the window, the sidebar is a full-bleed column. Three of its four
corners have nothing to be round against, so rounding only the inner edge reads
as a mistake rather than a shape; and because no window shows around it, there
is no sense of a pane sitting *on* anything. Insetting it supplies exactly that,
and it is how the platform this imitates has drawn a sidebar since the look was
introduced. `inset` is the gap, and it is most of why the main window reads as
glass at all.

The gap is the same on all four sides. A floating pane with a different margin
at the top than the bottom does not read as floating, it reads as misaligned,
and the eye catches that before it can say why.

The contents come back up by exactly the inset — the column's padding is there
to clear the title band, and the inset was pushing everything down a second
time, so the sidebar sat lower with this plugin on than without it. It stops
precisely at the band's lower edge, and that limit is not caution:
`#dsh-drag-strip` covers the top `--dsh-title-band` pixels with
`pointer-events: auto` and `-webkit-app-region: drag`, so anything drawn under
it is unclickable. Measured — at y=20 the strip is the topmost element, at y=44
the sidebar is. Content raised past that line would look right and stop
responding.

The launcher's hamburger is hidden while this is on. It is the one piece of
chrome left sitting on the window rather than on a pane, and against a floating
sidebar it reads as left over. Removing the plugin brings it straight back.

**The sidebar was never actually glass**, and that took three attempts to see.
Its rendered root carries the opaque sidebar fill and covers the column from
just below the title band all the way down, so the frosting only ever showed in
the strip of padding above it — a lighter block ending in a hard edge, which is
precisely what "there is a grey bar at the top" was describing. It was not a
stray highlight; it was the only part of the panel that was not being painted
over. Clearing that fill is what turns the column into one continuous surface.

It has to be reached structurally (`> * > *`, through a `display: contents`
wrapper) rather than through the inline width the app writes, because that width
only exists while the sidebar is expanded — keying off it left the collapsed
rail painting its own fill and the grey bar came straight back.

An earlier version went further and zeroed the column's `padding-top` outright,
moving the band's clearance into the margin. That looked defensible and it was
wrong: the padding is the app's internal spacing, every child is positioned
against it, and taking it away rearranged the sidebar's contents. Adjusting it
by the amount this plugin itself added is a different thing from redistributing
it.

**The inset costs sidebar width, and more than you would guess.** The app writes
an explicit pixel width inline on the sidebar's inner root — it is a resizable
column, so JS owns that number — and that number is the column's original width.
Narrow the panel and its own contents no longer fit, `overflow: hidden` takes
the difference, and the right edge of everything inside is quietly cut off. The
fix is one rule, `max-width: 100%`, which imposes no size and only stops one
exceeding the panel, so a column the user dragged narrower keeps the width they
chose. (An author `!important` outranks an inline declaration carrying none,
which is what lets a stylesheet correct a number JS wrote.) The app then
re-measures once per session and settles about `2 × inset` narrower than before.
It does not accumulate across restarts — each boot starts from the app's own
width — but `inset: 0` is there for anyone who wants every pixel back.

**Collapsed, the gap goes vertical-only.** The collapsed column is 56px and the
app lays its icons out at a fixed 11px from the left at 36px wide, so the panel
needs 47 of those 56 — measured. Insetting it 8px a side leaves 40 and clips six
buttons by 7px each; even 4px a side fits with exactly 1px to spare, which is
not a margin of safety but a bet on upstream never touching that padding. The
column is full height, though, so it can give at the top and bottom for free:
the rail keeps its rounded corners and its 8px above and below, flush to the
left edge, and nothing can be clipped by it. The state lives in an inline
`grid-template-columns` on the frame — no class, no attribute, nothing a
selector can see — so the browser half watches for it and marks `body`, and the
stylesheet keys off that mark.

Two things about that watch were arrived at the hard way, and both produced a
sidebar that stayed marked wrong with nothing in the log. A `ResizeObserver` on
the *column* fires once and then goes silent, so the frame is watched instead.
And the collapse is **animated**, so a reading taken while it runs returns an
interpolated track width — a real number that happens to be wrong, latched with
no further mutation to correct it. Every trigger therefore reads now and again
once the transition has settled.

Which is where the second surprise was. `@dsh-desktop/chrome` sets that padding
with `!important`, at exactly the same specificity as a bare
`[class*="sidebarCol"]` — and `!important` does not settle a fight between two
author rules that both carry it. Specificity does, and document order only after
that, so which sheet happened to be appended last was silently deciding the
layout. Every selector here is scoped under `body` for that reason: (0,1,1)
against (0,1,0) is an answer that does not depend on load order.

## Why a stylesheet, when the sibling plugin argues against one

`dsh-plugin-background-color` makes the case that `overrideTokens` beats CSS
injection: the theme presenter writes tokens as inline custom properties on
`body`, which outranks the palette's own declarations with no specificity
argument to lose. **That argument is right, and it is about colours.**

Glass is not a colour. `backdrop-filter`, an inset specular highlight, a corner
radius and a shadow are properties of the panels themselves, and no token
carries any of them. So this plugin injects a `<style>` tag — tagged
`data-plugin`, the same convention upstream's own bundles use, so a rule's owner
is findable in the inspector.

The cost is real: the sheet has to out-specify CSS-module rules on the elements
it restyles, so the declarations carry `!important`.

For the dialog and the composer that stays confined to colour, blur, border and
shadow — a rule that loses there leaves a panel looking ordinary rather than a
window that breaks. **The sidebar's inset does not have that property.** It is
`margin` and `padding-top`, which is layout, and getting it wrong moves things
rather than merely under-decorating them. That is the one place this plugin
takes a real risk, it is why the rule is scoped to raise its specificity rather
than trusting `!important` alone, and it is why `inset: 0` exists — it puts the
column back exactly where the app had it.

The panel colour itself is **not** imposed — it is
`color-mix(… var(--dsw-alias-bg-layer-1) …)`, so it follows the palette and
anything overriding it. Install this alongside Background Colour and the glass
takes on that colour.

## The fragile selector, named out loud

| Surface | Selector | Stable? |
| --- | --- | --- |
| Dialogs | `[role="dialog"]` | Yes — ARIA, and upstream cannot rename it without breaking screen readers too |
| Composer | `[data-composer-card]` | Yes — a hook upstream added deliberately |
| Sidebar | `[class*="sidebarCol"]` | **No** — a hashed CSS-module local name |

The third one will break. Not might: the string comes from a CSS module, and it
changes whenever upstream renames the class. A stylesheet that quietly stops
matching is the exact failure this project keeps pinning in tests, and a plugin
cannot add a test to the app.

So the settings card counts every anchor when it renders and says what it found:

```
Dialogs — 1 matched
Composer — 1 matched
Sidebar — no match (fragile selector)
```

with a line naming what has come unfrosted. That turns a rename from "the
sidebar looks wrong and I do not know why" into a sentence, which is the most a
third-party plugin can do about a seam it does not own.

## What it does not do

**It does not round the window.** That is the obvious next thing to want, and
from inside the page it does nothing at all. The frame is the outermost element
the page paints, so rounding it exposes what is behind — `body`, and behind that
the window — and both are the colour the frame just was. Tried with the page
backgrounds cleared to transparent as well: the corners came out
pixel-identical, because a window that is not `transparent: true` still
composites its own opaque background underneath. Shipping the rule anyway would
put an `overflow: hidden` on the app's outermost container, which is a real way
to clip a popover, in exchange for nothing visible.

**It does not give you real vibrancy.** The window is opaque, so this is glass
over the app's *own* background, not over your desktop.

Both are `BrowserWindow` properties, and a plugin runs inside the harness
process where there is no `BrowserWindow` to reach. They are the launcher's to
give, which is exactly the boundary this app draws everywhere else.
