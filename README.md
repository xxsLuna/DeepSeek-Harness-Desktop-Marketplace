# DeepSeek Harness Desktop — plugin marketplace

The plugin catalog for [DeepSeek Harness Desktop](https://github.com/xxsLuna/deepseek-harness-desktop),
served over GitHub Pages at

```
https://xxsluna.github.io/DeepSeek-Harness-Desktop-Marketplace/index.json
```

**The app ships that URL and nothing else.** No catalog content, no plugin code,
no bundled plugin. It holds one string — `DEFAULT_CATALOG` in
`packages/market/lib/fetch.js` — and everything installable arrives from here
over the network, at the user's explicit request, one plugin at a time. Nothing
in this repository is installed by default, by an update, or by opening the
Plugins tab. Installation is opt-in, per plugin, and reversible.

That also means this repository is the place a compromise would have to land, so
the rules below are not style guidance. Every one of them is enforced by CI, and
the parts that matter most are enforced by calling the app's own code rather than
a copy of it.

---

## What a plugin is

A harness plugin is an npm-shaped package that is **never published to npm**. It
is distributed as a GitHub Release asset of this repository, its bytes are
pinned by a `sha512` digest in `index.json`, and the app installs it into the
desktop profile as a *profile bundle*: the package name is added to
`dsh.profile.bundles` in `$DSH_HOME/profiles/desktop/package.json`, and the
harness reads `dsh.bundle.patch` from the package's manifest to find the one
patch row the plugin contributes.

Your plugin's patch layer is applied **after** the app's own rows and **before**
the launcher's hard overlays. So a plugin can add to what the app composed; it
cannot re-enable a row the desktop surface depends on having off.

`plugins/dsh-plugin-background-color/` is the reference implementation and the
end-to-end test subject. Read it alongside this document — it is short, it has no
build step, and every non-obvious line says why it is there.

---

## The catalog

`index.json`:

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "dsh-plugin-background-color",
      "name": "dsh-plugin-background-color",
      "version": "0.1.0",
      "publisher": "xxsLuna",
      "description": "One line, shown under the name in the app's plugin list.",
      "tarball": "https://github.com/xxsLuna/DeepSeek-Harness-Desktop-Marketplace/releases/download/dsh-plugin-background-color-v0.1.0/dsh-plugin-background-color-0.1.0.tgz",
      "integrity": "sha512-<base64 of those exact bytes>"
    }
  ]
}
```

All seven fields are required and must be non-empty strings (`version` is the
literal number `1`). The authority is `parseCatalog` in the app's
`packages/market/lib/fetch.js`, plus `isPluginName`/`isPluginVersion` in its
`registry.js`; `schema/index.schema.json` mirrors all three for your editor and
is **not** the gate.

| field | rule |
|---|---|
| `name` | **The npm package name.** Not a label. `^(?:@scope/)?[a-z0-9][a-z0-9._-]*$`, lowercase only, at most 214 characters, and not `node_modules` or `favicon.ico`. |
| `id` | `^(?:@scope/)?[A-Za-z0-9][A-Za-z0-9._-]*$`, and **this repo requires it to equal `name`**. A duplicate `id` is dropped — first row wins. |
| `version` | One concrete semver release, equal to the `version` in the tarball's `package.json`. Not a range, and not a `file:`/`git+` spec. |
| `publisher` | A label shown beside the name. Not an attestation, and not verified. |
| `description` | One sentence. The list gives it one row. |
| `tarball` | `https://` only, no credentials, and by this repo's policy a Release asset of this repository. |
| `integrity` | `sha512-<base64>` of the exact asset bytes. Exactly one hash. A missing or unparsable digest is a refusal, never a skipped check. |

**`name` is the package name, and this is the field most likely to be filled in
wrong.** `fetch.js` documents it as a display name, but the installer treats it
as an identifier throughout: it finds the listing by matching this field, refuses
the download unless the tarball's own `package.json` name equals it (*"the
package is X, not Y as the catalog said"*), writes the package to
`profiles/desktop/node_modules/<name>`, and records that name in the profile
manifest. It is *also* what the Plugins tab shows as the row label — so a plugin
cannot currently have a separate human-readable title, and a prose `name` is a
plugin that lists fine and cannot be installed.

`id` is not read by the installer at all. Requiring it to equal `name` is this
repo's rule, for the ordinary reason: two identities for one plugin is two
identities that eventually disagree. Note the two patterns differ — `SAFE_ID`
permits uppercase and `isPluginName` does not — so the tighter one wins.

The directory under `plugins/` is that same string again.

### The integrity placeholder

A row for a plugin that has never been released carries this exact string:

```
sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
```

Sixty-four zero bytes. It is shape-valid on purpose, so `parseCatalog` reports
the row as well-formed and the gate can fail it *by name* instead of the row
silently disappearing as a generic `bad-integrity` drop.

**The gate fails on it, deliberately.** A catalog that names bytes nobody can
verify must not be servable, and a red check saying "run the release workflow"
is better than a green check over an unverifiable row. Running
`release-plugin.yml` replaces the placeholder and the tarball URL with real
values; you never type a digest by hand.

---

## The plugin contract

Nine rules. Each one has a failure mode, and most of those failures are silent —
which is why they are all checked.

### 1. `exports` must be an object, and must include `./client` and `./package.json`

```json
"exports": {
  ".": "./lib/index.js",
  "./client": "./lib/client.js",
  "./package.json": "./package.json"
}
```

A string `exports` resolves nothing under a subpath, so the client-module scan
finds no `./client` and throws *"declares `dsh.client` but exports no `./client`
bundle"* — while the package looks perfectly well-formed.

### 2. A node half must exist at `exports['.']`, even if it does nothing

`exports['.']` is what the Loader `import()`s for your row. Without it the row
cannot mount at all, however complete the browser half is. An inert
`export function apply() {}` is a legitimate node half — upstream's own
`@deepseek-ai/dsh-client-ui-layout` ships exactly that.

### 3. `dsh.client.platform` must be the literal `'web'`

Anything else and the scan records the package as "not a client package" and
moves on. No error, no log line, no browser half.

### 4. `dsh.client.inject` holds **package** names; the bundle's `export const inject` holds **service** names

They are different namespaces and mixing them up fails quietly.

```json
"dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-theme"] } }
```

```js
var inject = ['theme', 'settingsScope', 'connection']   // cordis services
```

Prefer a service name in the bundle and a package name in the manifest, and
remember that a service can be provided by a *different* package on the desktop
shell than on upstream's web surface — `connection` is provided by
`@dsh-desktop/connection` there, so naming `@deepseek-ai/dsh-client-connection`
in the manifest would be wrong. When in doubt, list fewer packages in the
manifest: what actually orders bundle arrival is `dsh.client.external`, and a
plugin that `require()`s nothing needs neither.

### 5. `lib/client.js` must be a classic script wrapping `window.__ModuleLoader__.load`

```js
window.__ModuleLoader__.load({ id: "<package name>", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/* … */

return module.exports; } });
```

The bundle is fetched with `document.createElement('script')` + `src`, and the
module system then asserts the file registered a factory under that id — *"bundle
`<url>` loaded without registering `<id>` via `__ModuleLoader__.load`"*. An ES
module defers past that assertion and fails the arrival check. The `id` **must**
equal the package name.

That banner and footer are byte-for-byte what `scripts/build-client.mjs` in the
desktop repo emits, so a plugin that outgrows hand-writing can adopt esbuild
without changing anything else.

### 6. `dsh.bundle.patch` points at the package's own `cordis.patch.yml`, holding one `- insert:` row

```yaml
- insert:
    - id: dsh-plugin-background-color
      name: dsh-plugin-background-color
```

A row accepts only `id`, `name`, `config`, `group`, `disabled` and `inject`.
(The Loader also honours `isolate` and `intercept`; both re-label service realms
for rows other than their own, so a third-party plugin does not get them.)

- **`name` MUST equal the package name.** The Loader resolves the row by
  `import(options.name)`, and the client-module scan matches your `dsh.client`
  declaration against that same `options.name`. A short name there means the
  browser half is never loaded and nothing says so.
- **`id` must be the package name too**, in this repo. A duplicate id anywhere in
  the composed tree throws `duplicate loader entry id` and the app does not
  start; the package name is the only string you can be sure nobody else took.
- One row per plugin. A catalog row is one thing to install, enable and remove.

Do **not** use the `!!js` tag. The harness would evaluate it at row activation;
the gate rejects it.

### 7. No runtime `dependencies` — `peerDependencies` only

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "*",
  "@deepseek-ai/dsh-settings": "*",
  "@deepseek-ai/schemastery": "*"
}
```

A runtime dependency would have to be fetched and resolved on the user's machine
at install time, from a registry this catalog says nothing about and no digest
covers — the whole integrity chain would end at your tarball. `peerDependencies`
are the opposite: they resolve upward against packages the app already shipped
and install nothing. `optionalDependencies` and bundled dependencies are refused
for the same reason.

The practical consequence: import only `@deepseek-ai/*` packages the app already
composes, and in the browser bundle, prefer importing nothing at all.

### 8. No React, and no build step

The client kernel never looks for a component. An object with a callable `apply`
is a complete plugin. React is available to the page and reachable through the
factory's `require`, but reaching for it means you now have a bundle to build,
and a plugin that needs no UI of its own should not have one.

### 9. `files` must ship the patch file

`npm pack` reads `files`. A `cordis.patch.yml` left out of it produces a tarball
whose manifest declares a patch that is not there.

---

## What CI checks

`.github/workflows/validate.yml` runs on every pull request and every push to
`main`. It checks out **two** repositories — this one, and
`xxsLuna/deepseek-harness-desktop` — and calls the app's own `packages/market`:

| module | what the gate uses it for |
|---|---|
| `fetch.js` | `isAllowedSource`, `parseCatalog`, `parseIntegrity`, `fetchTarball` |
| `registry.js` | `isPluginName`, `isPluginVersion` — what may be written into the profile manifest, and therefore what may be installed at all |
| `tar.js` | `tarballFiles` — the app's own dependency-free ustar reader, not system `tar` |

It contains no copy of those rules. A gate holding its own copy can only ever
drift toward passing: it would accept a row the installer refuses (a wasted
release, found by users) or, worse, accept a digest form the installer treats
differently. Using `tar.js` matters for the same reason — it *refuses* rather
than repairs (absolute paths, symlinks, traversal, gzip bombs, a missing
end-of-archive marker), so a tarball a lenient extractor accepts and the
installer would reject cannot pass the gate.

Per catalog row, the gate asserts:

- the envelope parses through `parseCatalog` with **zero dropped rows**, and the
  surviving row count equals the source row count;
- the URL this repo is served at is still a source the app accepts, and the
  `http://` spelling of it still is not;
- `name` passes `isPluginName` and `version` passes `isPluginVersion` — both
  catch things `parseCatalog` does not, since it never parses the version and
  its id pattern permits uppercase;
- `id` equals `name`;
- `integrity` is `sha512`, and is not the bootstrap placeholder;
- `plugins/<name>/` exists here, and its `package.json` `name` and `version`
  match the row;
- the tarball **downloads and matches its digest** — through `fetchTarball`, so
  the redirect to `objects.githubusercontent.com`, the byte cap and the
  constant-time comparison are all exercised exactly as on a user's machine;
- the tarball's `package.json` `name` and `version` equal the row's — the
  installer's own two equality checks, run here instead of at a user's machine;
- `dependencies`, `optionalDependencies` and bundled dependencies are all empty;
- `exports` is an object, `exports['.']` names a file that is in the tarball,
  `exports['./package.json']` is declared;
- when `dsh.client` is present: `platform` is `'web'`, `exports['./client']`
  names a file that is in the tarball, that file calls
  `window.__ModuleLoader__.load` with the package name as its id and contains no
  top-level ESM syntax, and `dsh.client.inject` holds package names;
- `dsh.bundle.patch` is declared, the file is in the tarball, and it parses (with
  js-yaml, the same parser the harness uses, and without the `!!js` tag) to
  exactly one `- insert:` patch holding exactly one row, whose fields are within
  the allowed set, whose `id` and `name` are both the package name, and which is
  not shipped `disabled`;
- `index.json` still validates against `schema/index.schema.json`, so the
  editor-time mirror cannot rot.

Every check prints a line whether it passes or fails, and anything the gate
could **not** check prints as a `note` — a missing `tar.js`, a skipped download.
A skipped check is never reported as a passed one.

Run the same gate locally:

```sh
git clone https://github.com/xxsLuna/deepseek-harness-desktop .desktop   # once
npm install
npm run validate -- --desktop .desktop
npm run validate -- --desktop .desktop --offline   # skip the downloads
```

`--offline` reports each skipped download as a note. A skipped check is never
reported as a passed one.

---

## Submitting a plugin

1. Fork this repository.
2. Add `plugins/<package-name>/` with your plugin source. The directory name,
   the `package.json` `name`, the catalog row's `name` and `id`, and the patch
   row's `name` and `id` are all the **same string**. Five places, one value; CI
   checks every one of them.
3. Add one row to `index.json`. Use the placeholder integrity — you cannot know
   the real digest before the release exists, and you should not try.
4. Open a pull request. The gate will fail on the placeholder; that is expected
   for a new plugin and the maintainer resolves it by cutting the release, which
   rewrites the row with the real digest and its own PR.
5. Everything after that is the same gate, on the released bytes.

A maintainer cuts the release by running the `release-plugin` workflow with the
plugin id. It packs, refuses to overwrite an existing tag, publishes the asset,
rewrites the row, and opens a PR — so the digest that reaches the served catalog
is one nobody typed, verified against the bytes GitHub is actually serving rather
than the bytes the packing job produced.

---

## Repository layout

```
index.json                       the catalog — the one file the app reads
schema/index.schema.json         editor-time mirror of parseCatalog (not the gate)
plugins/<name>/                  plugin source, one directory per catalog row
scripts/validate-catalog.mjs     the gate; drives the app's own market module
scripts/pack-plugin.mjs          npm pack + digest + row rewrite
.github/workflows/validate.yml   the gate, on every PR and every push to main
.github/workflows/release-plugin.yml   cut one plugin's release
.nojekyll                        Pages must serve these files, not build a site
package.json                     the gate's two devDependencies. Not a plugin.
```

`.nojekyll` matters: without it Pages runs Jekyll over the repository, which
ignores files and directories beginning with `_` and can rewrite what it thinks
is a site. The catalog is data, and it must be served byte-for-byte.

## Licence

MIT, for this repository's own files. Each plugin carries its own licence in its
manifest.
