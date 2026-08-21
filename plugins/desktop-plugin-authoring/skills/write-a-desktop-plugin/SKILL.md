---
name: write-a-desktop-plugin
description: Write a plugin for DeepSeek Harness Desktop and get it listed in this marketplace. Covers the two plugin formats, which one a given feature needs, and the rules the catalog gate enforces.
---

# Writing a plugin for DeepSeek Harness Desktop

There are two formats. Pick by asking what the feature has to *reach*.

## Claude format — instructions the agent reads

A directory with `.claude-plugin/plugin.json` and a `skills/` tree:

```
my-plugin/
  .claude-plugin/plugin.json     name, version, description
  skills/
    do-the-thing/
      SKILL.md                   YAML frontmatter, then the body
      references/                optional, referenced from the body
      scripts/                   optional
```

`SKILL.md` frontmatter needs `name` (lowercase, hyphen-separated) and
`description`. The body is markdown, and it reaches the model as written — this
is instruction, not code, so it can steer the agent through tools it already
has and cannot add tools of its own.

Two things to know before you write one:

- **`allowed-tools` is not supported.** The harness has no way to enforce a tool
  restriction, so a skill declaring one is withheld rather than published with
  the restriction dropped. If you were reaching for it to keep a skill narrow,
  say the limit in the body instead — and know that the body is advice, not a
  fence.
- **`${CLAUDE_PLUGIN_ROOT}` works.** It expands to the plugin's directory on the
  machine it landed on, which is how you reference `scripts/` and `references/`.
  Quote it yourself: the path can contain spaces.

`agents/`, `hooks/` and `.mcp.json` are ignored. A plugin built around those
installs and does nothing, so do not build around them yet.

## dsh format — code the harness loads

An npm-shaped package, never published to npm, whose `package.json` declares
`dsh.bundle.patch`:

```json
{
  "name": "dsh-plugin-example",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./lib/index.js",
    "./package.json": "./package.json"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

The patch file inserts exactly one row, whose `id` and `name` are both the
package name:

```yaml
- insert:
    - id: dsh-plugin-example
      name: dsh-plugin-example
```

`lib/index.js` exports `name`, optionally `inject`, and `apply(ctx)` — a cordis
function plugin. **Do not add `export default apply`**: the loader unwraps a
default export to the bare function and your `inject` is discarded, after which
the row fails with "cannot get property … without inject".

Rules the gate enforces, each because the failure is otherwise silent:

- no runtime `dependencies` — the app ships no package manager, so they would
  resolve to nothing at load
- `exports` is an object, not a string — a string resolves nothing under a
  subpath, and a browser half would never be found
- a browser half declares `dsh.client.platform: "web"` and exports `./client`,
  built as a classic script that registers through `window.__ModuleLoader__.load`
- the patch layer touches no row it did not insert

A dsh plugin runs in the harness process with the same reach as the agent, and
it is composed at boot, so installing one asks the user to restart.

## Getting it listed

Add a directory under `plugins/` and a row to `.claude-plugin/marketplace.json`:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "description": "One sentence, in the imperative.",
  "version": "0.1.0",
  "metadata": { "kind": "claude" },
  "source": {
    "source": "git-subdir",
    "repo": "xxsLuna/DeepSeek-Harness-Desktop-Marketplace",
    "path": "plugins/my-plugin",
    "ref": "main"
  }
}
```

`metadata.kind` is a hint for the install confirmation, which words its warning
differently for the two formats. The installer decides the real kind from the
files it downloaded and refuses a package that disagrees with the row, so the
hint cannot be used to talk a user past the stronger warning.

A row pointing at a repository **other than this one** must pin a `sha`. This
one does not need to, because whoever can move this repository's branch can
also rewrite the row that points at it — a pin there would be ceremony, not a
guarantee.
