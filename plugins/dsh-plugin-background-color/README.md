# dsh-plugin-background-color

Repaints the app background. One colour per scheme, over the three `--dsw-*`
surface tokens that make up the window.

This is the marketplace's reference plugin: no dependencies, no build step, no
React, two files. If you are writing a plugin, read `lib/index.js` and
`lib/client.js` — between them they exercise every part of the contract in the
[repository README](../../README.md).

## Changing the colour

The plugin owns the `ui-background` settings namespace. Edit
`$DSH_HOME/settings.yaml` (`~/.dsh/settings.yaml` by default):

```yaml
ui-background:
  light: '#eef2ff'
  dark: '#101018'
```

The change applies **without a reload**: the settings file provider watches the
document, the host invalidates the namespace, the browser's shared settings
mirror re-reads, and this plugin's subscription re-pushes the override. Defaults
are `#ffffff` / `#151517`, which are the palette's own `--dsw-alias-bg-base`
values.

## The settings card

**Settings ▸ Plugins ▸ Plugin configuration** shows two hex boxes, one per
scheme, with a live swatch and a Reset. A colour applies as soon as the box
loses focus; Enter commits, Escape abandons the draft. Reset uses `unset`, which
clears the field from the user layer rather than writing the default into it —
writing it would pin the value, and a later change to the default would then
never reach anyone who had pressed the button.

The card is here because it turned out to cost almost nothing, which is worth
saying plainly since this README previously claimed the opposite:

- **React is not a dependency.** The client module system hands it to the
  bundle's factory through `require`, exactly as the app's own bundles take it
  as an external. `require('react')` inside the factory is the whole of it.
- **No bundler.** `React.createElement` instead of JSX keeps this a
  hand-written classic script, which is the thing this plugin exists to show
  you can go without.

The one real constraint is that nothing generates a form from the schema —
there is no schemastery-to-UI renderer anywhere in the app, so a control is
drawn by whoever owns it. That is also why this is two text boxes and not a
colour picker with an alpha slider.

The Plugins tab lists the **intersection** of two ledgers: namespaces the host
serves, and `settings.plugin.item` cards that claim them by key. The key is the
namespace name, and the tab dispatches one cell per served namespace without
interpreting any of them — so before this card existed, the `ui-background`
cell was already being dispatched and simply rendered empty.

Editing the YAML still works and still accepts anything. The box only refuses
what it cannot show you a swatch of.

## What it changes, and why three tokens

```js
ctx.theme.overrideTokens('dsh-plugin-background-color', {
  '--dsw-alias-bg-base':         { light, dark },
  '--dsw-alias-bg-layer-1':      { light, dark },
  '--dsw-specific-sidebar-fill': { light, dark },
})
```

- `--dsw-alias-bg-base` — the frame and body.
- `--dsw-alias-bg-layer-1` — the conversation view.
- `--dsw-specific-sidebar-fill` — the sidebar column and title row.

In the shipped light palette the first two are the same colour (`#fff`) and the
third is one step off it (`#f9fafb`); in dark all three differ (`#151517`,
`#232324`, `#1b1b1c`). Overriding only the first leaves the sidebar and the
conversation view on the old palette, and the window reads as half-painted — so
all three move together, and installing this plugin deliberately flattens them
onto one colour.

Values must be `{light, dark}` pairs. A bare string throws: *"a single value goes
illegible when the user switches color scheme"*.

## Why the theme service and not CSS

`overrideTokens` hands the theme runtime a named layer; the layout plugin's
`ThemePresenter` receives the recomposed snapshot and writes each token with
`document.body.style.setProperty(...)`. The shipped palette declares these same
tokens on `body` and `body[data-ds-dark-theme]` — and an inline custom property
on that element outranks both, with no specificity argument to lose. An injected
stylesheet would have to out-specify a rule on the element it is trying to beat.

The override also returns a **disposer that restores the previous values**, which
is why it is held inside `ctx.effect`: uninstall, disable and reload all leave
the palette exactly as they found it.
