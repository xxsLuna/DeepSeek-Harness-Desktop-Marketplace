// The catalog gate. Run by .github/workflows/validate.yml against a checkout
// of the desktop app, and runnable by hand the same way:
//
//   node scripts/validate-catalog.mjs --desktop ../deepseek-harness-desktop
//   node scripts/validate-catalog.mjs --desktop ../deepseek-harness-desktop --offline
//
// It does not contain a copy of the rules. Every decision the app makes about a
// plugin is imported from the app's own `packages/market/` and called here:
//
//   catalog.js   parseCatalog, MARKETPLACE_FILE, SUPPORTED_SOURCES
//                (the document's shape, and which source types can be offered)
//   kind.js      classifyPlugin  (what a downloaded tree IS, and the gate each
//                kind has to pass — the same call the installer makes)
//   git.js       resolveGitSource, fetchGit  (how a git source is reduced to a
//                URL/ref/sha, and the clone itself)
//   fetch.js     isAllowedSource, fetchTarball
//   registry.js  isPluginName    (what may be written into the profile manifest)
//
// A second implementation would drift, and it can only drift toward passing: it
// would accept a row the installer refuses (a wasted listing, discovered by
// users) or, worse, accept a package the installer treats differently. There is
// no version of "keep the two in sync by hand" that survives a year. So the app
// is the single authority, this repo owns only what the app cannot see from a
// catalog — what is INSIDE the plugin, and whether the row agrees with it — and
// a change to the app's rules shows up here as a red check on the next pull
// request.
//
// Exit code 1 on any failure. Every check prints a line either way, because a
// gate that only speaks up when it fails cannot be audited.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * This repository, as a catalog row spells it.
 *
 * Rows pointing here are the normal case and are allowed to track a branch;
 * rows pointing anywhere else must pin a `sha`. The asymmetry is not a double
 * standard — whoever can move this repository's branch can also rewrite the row
 * that points at it, so a pin here would be ceremony. A third-party row is the
 * opposite: the row is reviewed once and the branch it names can move
 * afterwards, which is precisely the thing a review cannot catch.
 */
const THIS_REPO = 'xxsLuna/DeepSeek-Harness-Desktop-Marketplace'

/** Where the catalog document lives, checked against the app's own constant. */
const CATALOG_PATH = ['.claude-plugin', 'marketplace.json']

/**
 * Fields a dsh plugin's patch row may carry, as repo policy. The Loader itself
 * also honours `isolate` and `intercept`; both re-label service realms for rows
 * other than their own, so a third-party plugin does not get them.
 */
const ALLOWED_ROW_FIELDS = new Set(['id', 'name', 'config', 'group', 'disabled', 'inject'])

const failures = []
const notes = []
const scratch = []

/**
 * Record one assertion.
 * @param {boolean} condition - whether the assertion held.
 * @param {string} what - what was asserted, phrased as the passing case.
 * @param {string} [detail] - what was actually seen, for a failure.
 * @returns {boolean} the condition, so a caller can stop on a failure.
 */
function check(condition, what, detail) {
  if (condition) {
    console.log(`  ok    ${what}`)
    return true
  }
  const line = detail === undefined ? what : `${what} — got ${detail}`
  console.log(`  FAIL  ${line}`)
  failures.push(line)
  return false
}

/**
 * Record something the gate could not check, so a skipped check is never read
 * as a passed one.
 * @param {string} what - what was skipped and why.
 */
function note(what) {
  console.log(`  note  ${what}`)
  notes.push(what)
}

/**
 * Read `--flag value` pairs and bare `--flag` switches off argv.
 * @param {string[]} argv - process arguments after the script name.
 * @returns {Record<string, string | true>} the parsed options.
 */
function parseArgs(argv) {
  /** @type {Record<string, string | true>} */
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) options[key] = true
    else {
      options[key] = next
      index += 1
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const repoRoot = resolve(typeof options.repo === 'string' ? options.repo : process.cwd())
const desktopRoot = typeof options.desktop === 'string' ? resolve(options.desktop) : undefined
const offline = options.offline === true

if (desktopRoot === undefined) {
  console.error('validate-catalog: --desktop <path to a deepseek-harness-desktop checkout> is required')
  console.error('  the gate calls the app\'s own packages/market modules; there is no local copy of those rules')
  process.exit(2)
}

/**
 * Import one module out of the app's market package by path.
 * @param {string} file - filename under packages/market/lib.
 * @param {boolean} required - whether absence is fatal.
 * @returns {Promise<any>} the module, or undefined when absent and optional.
 */
async function marketModule(file, required) {
  const path = join(desktopRoot, 'packages', 'market', 'lib', file)
  if (existsSync(path)) return import(pathToFileURL(path).href)
  if (!required) return undefined
  console.error(`validate-catalog: ${path} does not exist`)
  console.error('  either --desktop points somewhere else, or the app moved the module this gate is built on')
  process.exit(2)
}

const catalogModule = await marketModule('catalog.js', true)
const kindModule = await marketModule('kind.js', true)
const fetchModule = await marketModule('fetch.js', true)
const gitModule = await marketModule('git.js', false)
const registry = await marketModule('registry.js', false)

console.log(`validate-catalog: driving ${join(desktopRoot, 'packages', 'market', 'lib')}`)
for (const [name, mod] of [
  ['catalog.js', catalogModule], ['kind.js', kindModule], ['fetch.js', fetchModule],
  ['git.js', gitModule], ['registry.js', registry],
]) {
  console.log(`  ${name.padEnd(12)} ${mod === undefined ? 'ABSENT' : `${Object.keys(mod).length} exports`}`)
}
console.log('')

// ---------------------------------------------------------------------------
// 1. The app and this repo still agree on where the catalog lives.
// ---------------------------------------------------------------------------
console.log('catalog source')
// Asserted against the app's own constant rather than trusted: moving this file
// silently orphans every installed client, and the app is the side that cannot
// be fixed by a commit here.
check(
  catalogModule.MARKETPLACE_FILE === CATALOG_PATH.join('/'),
  `the app looks for ${CATALOG_PATH.join('/')}`,
  String(catalogModule.MARKETPLACE_FILE),
)
const defaultCatalog = String(fetchModule.DEFAULT_CATALOG)
check(
  fetchModule.isAllowedSource(defaultCatalog),
  'the app accepts its own default catalog as a source',
  defaultCatalog,
)
check(
  defaultCatalog.includes(THIS_REPO) && defaultCatalog.endsWith(CATALOG_PATH.join('/')),
  `the app's default catalog is this repository's ${CATALOG_PATH.join('/')}`,
  defaultCatalog,
)
// Same policy from the other side: the app must refuse a plaintext spelling.
// Asserted because it is the check that would catch a fetch.js edit loosening
// the scheme rule.
check(
  !fetchModule.isAllowedSource(defaultCatalog.replace('https://', 'http://')),
  'the app refuses the http:// spelling of the same URL',
)
console.log('')

// ---------------------------------------------------------------------------
// 2. The envelope, through parseCatalog — the app's own shape rule.
// ---------------------------------------------------------------------------
const catalogPath = join(repoRoot, ...CATALOG_PATH)
const catalogText = readFileSync(catalogPath, 'utf8')
const catalog = catalogModule.parseCatalog(catalogText)
const sourceRows = JSON.parse(catalogText).plugins

console.log(`envelope (${CATALOG_PATH.join('/')})`)
check(typeof catalog.name === 'string' && catalog.name.length > 0, 'parseCatalog accepted the envelope')
// parseCatalog drops rather than throws, so a row count that shrank is the only
// evidence a submission was silently ignored.
check(catalog.dropped.length === 0, 'no row was dropped', JSON.stringify(catalog.dropped))
check(
  catalog.plugins.length === sourceRows.length,
  `all ${String(sourceRows.length)} row(s) survived validation`,
  `${String(catalog.plugins.length)} of ${String(sourceRows.length)}`,
)
console.log('')

/**
 * Read the single-row patch layer without a YAML parser of our own.
 *
 * js-yaml is the parser the harness uses for these files
 * (`@deepseek-ai/cordis-plugin-include` mounts its entry-list dialect on top of
 * it), so a file this accepts is a file the harness parses. The `!!js` tag of
 * that dialect is deliberately NOT registered: a marketplace plugin's row must
 * not carry an expression the harness would evaluate at activation, and an
 * unregistered tag makes js-yaml throw instead of passing it on.
 * @param {string} text - the patch file's contents.
 * @param {string} filename - for the error message.
 * @returns {Promise<unknown>} the parsed patch layer.
 */
async function readPatch(text, filename) {
  // js-yaml v4 is CJS: `default` is the whole module and is what a
  // bundler-free Node gives reliably.
  const imported = await import('js-yaml')
  const yaml = imported.default ?? imported
  return yaml.load(text, { schema: yaml.JSON_SCHEMA, filename })
}

/**
 * Every file under a directory, as posix paths relative to it.
 * @param {string} root - directory to walk.
 * @returns {string[]} the paths.
 */
function filesUnder(root) {
  /** @type {string[]} */
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
      else out.push(`${prefix}${entry.name}`)
    }
  }
  walk(root, '')
  return out
}

/**
 * Put a row's plugin somewhere the gate can read it, the way the app would.
 *
 * A `git-subdir` row pointing at this repository is read out of the WORKING
 * TREE instead of being cloned, and that is the point of the whole gate: on a
 * pull request the submitted commit is not on the branch the row names yet, so
 * cloning would check the code already on `main` and pass a submission it never
 * looked at.
 * @param {any} row - the parsed catalog row.
 * @returns {Promise<{root: string} | undefined>} where the plugin's files are,
 * or undefined when they could not be fetched.
 */
async function materialise(row) {
  const source = row.source
  if (source.source === 'git-subdir' && source.repo === THIS_REPO) {
    const local = join(repoRoot, ...source.path.split('/'))
    if (!check(existsSync(local) && statSync(local).isDirectory(), `${source.path} is a directory in this repository`)) {
      return undefined
    }
    return { root: local }
  }
  if (offline) {
    note(`--offline: not fetching ${row.name}, so its contents are UNCHECKED`)
    return undefined
  }
  if (source.source === 'archive') {
    const tar = await marketModule('tar.js', false)
    if (tar === undefined) {
      note('the app ships no tar.js, so an archive cannot be opened with the reader the installer uses')
      return undefined
    }
    // fetchTarball returns bytes ONLY after they verify, so reaching the next
    // line is itself the integrity assertion.
    const sri = `sha256-${Buffer.from(source.sha256, 'hex').toString('base64')}`
    const bytes = Buffer.from(await fetchModule.fetchTarball(source.url, sri))
    check(true, `${source.url} downloaded and matched its sha256`)
    const root = mkdtempSync(join(tmpdir(), 'market-gate-'))
    scratch.push(root)
    tar.readTarball(bytes, root, { stripPrefix: 'auto' })
    return { root }
  }
  if (gitModule === undefined) {
    note(`the app ships no git.js, so ${row.name} cannot be fetched the way the installer would`)
    return undefined
  }
  const holder = mkdtempSync(join(tmpdir(), 'market-gate-'))
  scratch.push(holder)
  const got = await gitModule.fetchGit(source, join(holder, 'tree'))
  check(true, `cloned at ${got.sha}`)
  return { root: join(holder, 'tree') }
}

// ---------------------------------------------------------------------------
// 3. Per row: identity, pinning, and what is actually in the plugin.
// ---------------------------------------------------------------------------
for (const row of catalog.plugins) {
  console.log(`row ${row.name}`)

  // The name is the install key, not a label: it names the directory the plugin
  // lands in, and for a dsh plugin it is written into the profile manifest.
  if (registry === undefined) {
    note('the app ships no registry.js, so the installable-name rule is UNCHECKED')
  } else {
    check(registry.isPluginName(row.name), 'name is an installable package name', JSON.stringify(row.name))
  }
  check(
    catalogModule.SUPPORTED_SOURCES.includes(row.source.source),
    `source type ${row.source.source} is one the app can install from`,
    catalogModule.SUPPORTED_SOURCES.join(', '),
  )

  // A row this repository does not own can have its branch moved after review.
  const foreign = row.source.source !== 'archive' && row.source.repo !== THIS_REPO
  if (foreign) {
    check(
      typeof row.source.sha === 'string',
      `${row.name} points outside this repository, so it must pin a sha`,
      JSON.stringify(row.source.ref ?? null),
    )
  }
  if (gitModule !== undefined && row.source.source !== 'archive') {
    // Not a re-check of the catalog rule: the transport applies its own, and a
    // row the catalog offers but the transport refuses is a listing that fails
    // only at install time.
    try {
      const resolved = gitModule.resolveGitSource(row.source)
      const where = resolved.path === undefined ? '' : ` (${resolved.path})`
      check(true, `the transport resolves it to ${resolved.url}${where}`)
    } catch (error) {
      check(false, 'the git transport accepts this source', String(error))
    }
  }

  // Repo convention: the row's `metadata.kind` is what the app shows in the
  // install confirmation before anything is downloaded, so it has to be there
  // and it has to be right — `classifyPlugin` below is what decides "right".
  const hinted = row.metadata?.kind
  check(hinted === 'claude' || hinted === 'dsh', 'metadata.kind is declared', JSON.stringify(hinted ?? null))

  let located
  try {
    located = await materialise(row)
  } catch (error) {
    check(false, `${row.name} could be fetched the way the app fetches it`, String(error))
    console.log('')
    continue
  }
  if (located === undefined) {
    console.log('')
    continue
  }

  // The installer's own decision, made here instead of at a user's machine.
  let kind
  try {
    kind = kindModule.classifyPlugin(located.root, { name: row.name, version: row.version })
    check(true, `the app classifies it as a ${kind.kind} plugin, version ${kind.version}`)
  } catch (error) {
    check(false, `${row.name} passes the installer's kind gate`, String(error))
    console.log('')
    continue
  }
  check(kind.kind === hinted, 'the declared kind is the kind it actually is', `${String(hinted)} vs ${kind.kind}`)
  if (row.version !== undefined) {
    check(
      kind.version === row.version,
      "the plugin's own version equals the row version",
      `${kind.version} vs ${row.version}`,
    )
  }

  const files = filesUnder(located.root)

  if (kind.kind === 'claude') {
    // A Claude plugin that publishes nothing installs cleanly and does nothing,
    // which is the failure this catches: the row promised a capability.
    const skills = files.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path))
    check(skills.length > 0, 'it ships at least one skills/<name>/SKILL.md', files.slice(0, 10).join(', '))
    for (const path of skills) {
      const text = readFileSync(join(located.root, ...path.split('/')), 'utf8')
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      if (!check(frontmatter !== null, `${path} opens with YAML frontmatter`)) continue
      const body = frontmatter[1]
      check(/^name:\s*\S/m.test(body), `${path} declares a name`)
      check(/^description:\s*\S/m.test(body), `${path} declares a description`)
      // Withheld by the app rather than published with the restriction dropped,
      // so a plugin whose only skill declares it installs and does nothing.
      check(
        !/^allowed-tools:/m.test(body),
        `${path} declares no allowed-tools (the app cannot enforce one, so it withholds the skill)`,
      )
    }
    // Named rather than silently accepted: these install and do nothing.
    for (const ignored of ['agents', 'hooks']) {
      if (files.some((path) => path.startsWith(`${ignored}/`))) {
        note(`${row.name} ships ${ignored}/, which this app ignores — say so in its description`)
      }
    }
    if (files.includes('.mcp.json')) note(`${row.name} ships .mcp.json, which this app ignores`)
    console.log('')
    continue
  }

  // ------------------------------------------------------------------
  // dsh: the manifest, the browser half, and the patch layer.
  // ------------------------------------------------------------------
  const manifest = JSON.parse(readFileSync(join(located.root, 'package.json'), 'utf8'))
  check(
    Object.keys(manifest.optionalDependencies ?? {}).length === 0,
    'the manifest declares no optionalDependencies',
    Object.keys(manifest.optionalDependencies ?? {}).join(', '),
  )
  check(
    (manifest.bundleDependencies ?? manifest.bundledDependencies ?? []).length === 0,
    'the manifest bundles no dependencies',
  )

  // A string `exports` resolves nothing under a subpath, so the client-module
  // scan finds no './client' and throws "declares dsh.client but exports no
  // './client' bundle" — with the plugin looking perfectly well-formed.
  const exportsField = manifest.exports
  const exportsIsObject = typeof exportsField === 'object' && exportsField !== null && !Array.isArray(exportsField)
  check(exportsIsObject, 'exports is an object, not a string')

  /**
   * Resolve one export target, accepting the string and one-level conditional
   * forms the client-module scan accepts.
   * @param {string} subpath - the export subpath.
   * @returns {string | undefined} the relative target, if any.
   */
  const exportTarget = (subpath) => {
    if (!exportsIsObject) return undefined
    const value = exportsField[subpath]
    if (typeof value === 'string') return value
    if (typeof value === 'object' && value !== null && typeof value.default === 'string') return value.default
    return undefined
  }
  /**
   * Whether an export target is actually present.
   * @param {string | undefined} target - the relative target.
   * @returns {boolean} whether the file shipped.
   */
  const shipped = (target) => typeof target === 'string' && files.includes(target.replace(/^\.\//, ''))

  // The node half is what the Loader imports for the row; without it the row
  // cannot mount at all, however complete the browser half is.
  const nodeEntry = exportTarget('.')
  check(typeof nodeEntry === 'string', 'exports["."] names a node entry', JSON.stringify(exportsField?.['.']))
  check(shipped(nodeEntry), `${String(nodeEntry)} is present`)
  check(exportsIsObject && exportsField['./package.json'] === './package.json', 'exports["./package.json"] is declared')

  const clientDecl = manifest.dsh?.client
  if (clientDecl === undefined) {
    note(`${row.name} declares no dsh.client, so it contributes no browser half`)
  } else {
    check(clientDecl.platform === 'web', 'dsh.client.platform is the literal "web"', JSON.stringify(clientDecl.platform))
    const clientEntry = exportTarget('./client')
    check(
      typeof clientEntry === 'string',
      'exports["./client"] names a browser bundle',
      JSON.stringify(exportsField?.['./client']),
    )
    if (check(shipped(clientEntry), `${String(clientEntry)} is present`)) {
      const bundle = readFileSync(join(located.root, ...String(clientEntry).replace(/^\.\//, '').split('/')), 'utf8')
      // The bundle is fetched with a classic <script src>, and the module system
      // then asserts a factory was registered under this exact id. An ES module
      // defers past that assertion; a mismatched id fails it.
      check(
        bundle.includes('window.__ModuleLoader__.load('),
        'the client bundle registers through window.__ModuleLoader__.load',
      )
      check(
        bundle.includes(JSON.stringify(manifest.name)),
        `the client bundle's registered id is the package name (${String(manifest.name)})`,
      )
      check(
        !/^\s*(?:import|export)\s/m.test(bundle),
        'the client bundle has no top-level ESM syntax (it must be a classic script)',
      )
    }
  }

  // Resolved the way classifyPlugin resolved it, and the way loadProfile will.
  const patchKey = manifest.dsh.bundle.patch.replace(/^\.\//, '')
  let patch
  try {
    patch = await readPatch(readFileSync(join(located.root, ...patchKey.split('/')), 'utf8'), patchKey)
  } catch (error) {
    check(false, `${patchKey} parses as plain YAML (no !!js expressions)`, String(error))
    console.log('')
    continue
  }
  check(Array.isArray(patch), 'the patch file is an entry-patch list')
  const layer = Array.isArray(patch) ? patch : []
  check(layer.length === 1, 'the patch layer holds exactly one patch', String(layer.length))
  check(
    layer.every((entry) => entry !== null && typeof entry === 'object'
      && Object.keys(entry).length === 1 && 'insert' in entry),
    'the patch layer touches no row it did not insert',
  )

  const insert = layer[0]?.insert
  check(Array.isArray(insert), 'the one patch is an `insert:` group')
  const rows = Array.isArray(insert) ? insert : []
  // One row is policy, not a harness limit: a catalog row is one thing to
  // install, enable and remove, and a package that inserts three of them
  // cannot be reasoned about from the list.
  check(rows.length === 1, 'the insert group holds exactly one row', String(rows.length))

  for (const entry of rows) {
    const rejected = Object.keys(entry ?? {}).filter((field) => !ALLOWED_ROW_FIELDS.has(field))
    check(rejected.length === 0, `the row carries only ${[...ALLOWED_ROW_FIELDS].join('/')}`, rejected.join(', '))
    // The Loader resolves a row by `import(options.name)`, and the
    // client-module scan matches a package's dsh.client against that same
    // name. A short name there loads no browser half and logs nothing.
    check(entry?.name === manifest.name, 'the row name is the package name', JSON.stringify(entry?.name))
    // A duplicate id anywhere in the composed tree throws `duplicate loader
    // entry id` and the app does not start, so the id is the package name too.
    check(entry?.id === manifest.name, 'the row id is the package name', JSON.stringify(entry?.id))
    check(entry?.disabled !== true, 'the row is not shipped disabled')
  }

  console.log('')
}

// ---------------------------------------------------------------------------
// 4. The editor-time schema, checked against the file it advertises.
// ---------------------------------------------------------------------------
console.log('schema/marketplace.schema.json')
// `ajv/dist/2020` and not the package root: the root export only knows
// draft-07, and compiling a 2020-12 document against it fails with
// `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`,
// which reads like a network problem and is not one.
const { default: Ajv } = await import('ajv/dist/2020.js')
const schema = JSON.parse(readFileSync(join(repoRoot, 'schema', 'marketplace.schema.json'), 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)
check(
  validate(JSON.parse(catalogText)),
  `${CATALOG_PATH.join('/')} validates against schema/marketplace.schema.json`,
  JSON.stringify(validate.errors),
)
console.log('')

for (const dir of scratch) rmSync(dir, { recursive: true, force: true })

console.log(`validate-catalog: ${String(failures.length)} failure(s), ${String(notes.length)} note(s)`)
for (const line of failures) console.log(`  FAIL  ${line}`)
process.exit(failures.length === 0 ? 0 : 1)
