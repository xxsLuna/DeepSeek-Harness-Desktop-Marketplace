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

**There is no settings UI, and that is a real limitation, not an omission.** The
app's Plugins tab lists the intersection of two ledgers — namespaces the host
serves, and `settings.plugin.item` slot cards that claim them by key. A card is a
React component, so a namespace with no card is served but never shown. Giving
this plugin a UI means giving it React and a bundler; the whole point of it is
that it needs neither.

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
