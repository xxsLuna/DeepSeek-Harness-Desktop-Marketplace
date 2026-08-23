# dsh-plugin-liquid-glass

Frosted, translucent panels in the spirit of Apple's Liquid Glass — the design
language introduced across Apple's platforms in the OS 26 generation. Backdrop
blur, a saturation lift so colour behind a panel blooms through it, a specular
hairline along the top edge, and generous corners.

Three surfaces are frosted: **dialogs**, the **composer**, and the **sidebar**.

## Tuning it

**Settings ▸ Plugins ▸ Plugin configuration ▸ Liquid Glass** — four sliders,
applied when you release each one. The values also live in
`$DSH_HOME/settings.yaml` and apply without a reload:

```yaml
ui-liquid-glass:
  blur: 20        # px,  0–60
  saturation: 180 # %,   100–300
  opacity: 45     # %,   25–100
  radius: 20      # px,  0–40
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

**Reset to defaults** clears all four with `unset` rather than writing the
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
it restyles, so the declarations carry `!important`. It is confined to the four
properties that make the effect and never touches layout, so a rule that loses
leaves a panel looking ordinary rather than a window that breaks.

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

The window itself is opaque, so this is glass over the app's *own* background,
not over your desktop. Real window vibrancy is the launcher's to give — a
plugin runs inside the harness process and cannot reach the `BrowserWindow`.
