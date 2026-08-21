# DeepSeek Harness Desktop — plugin marketplace

The plugin catalog for [DeepSeek Harness Desktop](https://github.com/xxsLuna/deepseek-harness-desktop).
It is a standard agent-plugin marketplace: one document at

```
.claude-plugin/marketplace.json
```

read straight out of this repository over `raw.githubusercontent.com`. There is
no site build, no release step and no `.nojekyll` — a marketplace is a
repository with that file in it, and an edit here is live as soon as it is
pushed.

**The app ships that URL and nothing else.** No catalog content, no plugin code,
no bundled plugin. It holds one string — `DEFAULT_CATALOG` in
`packages/market/lib/fetch.js` — and everything installable arrives from here
over the network, at the user's explicit request, one plugin at a time. Nothing
in this repository is installed by default, by an update, or by opening the
Plugins tab. Installation is opt-in, per plugin, and reversible.

That also means this repository is the place a compromise would have to land, so
the rules below are not style guidance. Every one of them is enforced by CI, and
the parts that matter most are enforced by calling the app's own code rather
than a copy of it.

---

## Two kinds of plugin

Both are listed in the same catalog. The installer decides which is which from
the files it downloaded, never from what the row claimed.

| | **Claude format** | **dsh format** |
| --- | --- | --- |
| identified by | `.claude-plugin/plugin.json` | `dsh.bundle.patch` in `package.json` |
| what it is | markdown the agent reads | code the harness loads |
| what it can reach | the agent's judgement, through tools it already has | anything the harness process can |
| lands in | `~/.dsh/claude-plugins/` | `~/.dsh/profiles/desktop/` |
| takes effect | immediately | after a restart |

A Claude-format plugin works here unmodified because the harness's skill format
*is* Claude's: `skills/<name>/SKILL.md`, the same frontmatter keys, the same
`references/` and `scripts/` beside it. Two limits, both enforced by the gate:

- a skill declaring **`allowed-tools` is withheld** by the app rather than
  published with the restriction dropped, so a plugin whose only skill declares
  one installs and does nothing;
- **`agents/`, `hooks/` and `.mcp.json` are ignored** — the harness has no
  counterpart for them. A plugin shipping them is listed with a note, not
  rejected, but its description has to say what will and will not work.

`${CLAUDE_PLUGIN_ROOT}` is substituted for the plugin's directory on the machine
it landed on, so scripts and references can be addressed.

A dsh-format plugin is an npm-shaped package that is **never published to npm**.
Its `lib/index.js` exports `name`, optionally `inject`, and `apply(ctx)` — a
cordis function plugin. It must not `export default apply`: the loader unwraps a
default export to the bare function, the `inject` is discarded, and the row then
fails with "cannot get property … without inject".

The full authoring guide is itself a plugin in this repository —
[`plugins/desktop-plugin-authoring`](plugins/desktop-plugin-authoring), listed
as **Plugin Authoring**.

---

## Adding a plugin

1. Put it in `plugins/<name>/`.
2. Add a row to `.claude-plugin/marketplace.json`.
3. Open a pull request. The gate runs against your working tree, not against
   `main`, so it checks what you submitted.

A row:

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

`name` is the **install key**, not a label: it names the directory the plugin
lands in, and for a dsh plugin it is written into the profile manifest. Put the
human-readable name in `displayName`.

`metadata.kind` is what the app's install confirmation reads *before* anything is
downloaded, which is how it words its warning: a dsh plugin runs code, a Claude
plugin enters the prompt. It is a hint — the installer classifies the downloaded
files itself and refuses a package that disagrees with the row, so the hint
cannot be used to talk a user past the stronger warning. The gate requires it and
checks it against the actual files.

### Source types

The app can install from `git-subdir`, `github`, `url` (a clone URL ending
`.git`) and `archive` (a tarball plus a `sha256`). It refuses `npm`, `command`
and a bare relative path, and says so by name in the tab rather than dropping
the row silently.

**A row pointing at a repository other than this one must pin a `sha`.** Rows
pointing here may track `main`. That is not a double standard: whoever can move
this repository's branch can also rewrite the row that points at it, so a pin
here would be ceremony. A third-party row is reviewed once and the branch it
names can move afterwards — which is exactly what a review cannot catch.

---

## The gate

```bash
node scripts/validate-catalog.mjs --desktop ../deepseek-harness-desktop
```

`--offline` skips anything that needs the network, and says so per row rather
than passing quietly.

It imports the app's own modules and calls them:

| module | what it decides |
| --- | --- |
| `catalog.js` | the document's shape, and which source types may be offered |
| `kind.js` | what a plugin tree *is*, and the gate each kind has to pass |
| `git.js` | how a source becomes a URL/ref/sha, and the clone itself |
| `fetch.js` | which sources may be read at all, and archive integrity |
| `registry.js` | what may be written into the profile manifest |

There is no second copy of those rules here, and there must not be one. A gate
holding its own copy can only drift toward passing: it would accept a row the
installer refuses, or — worse — accept a package the installer treats
differently. What this repository owns is what the app cannot see from a
catalog: what is inside the plugin, and whether the row tells the truth about
it.

If the app's rules change, the next pull request here goes red and names the
rule. That is the intended behaviour, not a breakage.
