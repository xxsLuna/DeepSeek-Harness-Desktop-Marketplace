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
  opacity: 62     # %,   25–100
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
