// The catalog gate. Run by .github/workflows/validate.yml against a checkout
// of the desktop app, and runnable by hand the same way:
//
//   node scripts/validate-catalog.mjs --desktop ../deepseek-harness-desktop
//   node scripts/validate-catalog.mjs --desktop ../deepseek-harness-desktop --offline
//
// It does not contain a copy of the rules. Every decision the app makes about a
// plugin is imported from the app's own `packages/market/` and called here:
//
//   fetch.js     isAllowedSource, parseCatalog, parseIntegrity, fetchTarball
//   registry.js  isPluginName, isPluginVersion  (what may be written into the
//                profile manifest, and therefore what may be installed at all)
//   tar.js       tarballFiles, readTarball      (the app's own reader, not
//                system tar — see unpack() below)
//
// A second implementation would drift, and it can only drift toward passing: it
// would accept a row the installer refuses (a wasted release, discovered by
// users) or, worse, accept a digest form the installer treats differently.
// There is no version of "keep the two in sync by hand" that survives a year.
// So the app is the single authority, this repo owns only what the app cannot
// see from a catalog — what is INSIDE the tarball, and whether the row agrees
// with it — and a change to the app's rules shows up here as a red check on the
// next pull request.
//
// Exit code 1 on any failure. Every check prints a line either way, because a
// gate that only speaks up when it fails cannot be audited.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The URL this repository is served at. Asserted against the app's own
 * DEFAULT_CATALOG rather than trusted: renaming this repo, or changing the
 * Pages path, silently orphans every installed client, and the app is the side
 * that cannot be fixed by a commit here.
 */
const PUBLISHED_AT = 'https://xxsluna.github.io/DeepSeek-Harness-Desktop-Marketplace/index.json'

/**
 * The bootstrap digest a row carries before its release exists — 64 zero bytes,
 * which is shape-valid so `parseCatalog` reports the row as good and the
 * failure below can name the real problem instead of appearing as a generic
 * `bad-integrity` drop.
 */
const PLACEHOLDER_INTEGRITY = `sha512-${Buffer.alloc(64).toString('base64')}`

/**
 * Fields a patch row may carry, as repo policy. The Loader itself also honours
 * `isolate` and `intercept`; both re-label service realms for rows other than
 * their own, so a third-party plugin does not get them.
 */
const ALLOWED_ROW_FIELDS = new Set(['id', 'name', 'config', 'group', 'disabled', 'inject'])

const failures = []
const notes = []

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

const fetchModule = await marketModule('fetch.js', true)
const registry = await marketModule('registry.js', false)
const tar = await marketModule('tar.js', false)

console.log(`validate-catalog: driving ${join(desktopRoot, 'packages', 'market', 'lib')}`)
console.log(`  fetch.js     ${Object.keys(fetchModule).length} exports`)
console.log(`  registry.js  ${registry === undefined ? 'ABSENT' : `${Object.keys(registry).length} exports`}`)
console.log(`  tar.js       ${tar === undefined ? 'ABSENT' : `${Object.keys(tar).length} exports`}`)
console.log('')

// ---------------------------------------------------------------------------
// 1. The app and this repo still agree on where the catalog lives.
// ---------------------------------------------------------------------------
console.log('catalog source')
check(
  fetchModule.isAllowedSource(PUBLISHED_AT),
  `the app accepts ${PUBLISHED_AT} as a catalog source`,
  `DEFAULT_CATALOG is ${String(fetchModule.DEFAULT_CATALOG)}`,
)
// Same policy from the other side: the app must refuse a plaintext spelling of
// this repo. Asserted because it is the check that would catch a fetch.js edit
// loosening the scheme rule.
check(
  !fetchModule.isAllowedSource(PUBLISHED_AT.replace('https://', 'http://')),
  'the app refuses the http:// spelling of the same path',
)
console.log('')

// ---------------------------------------------------------------------------
// 2. The envelope, through parseCatalog — the app's own shape rule.
// ---------------------------------------------------------------------------
const catalogPath = join(repoRoot, 'index.json')
const catalogText = readFileSync(catalogPath, 'utf8')
const catalog = fetchModule.parseCatalog(catalogText)
const sourceRows = JSON.parse(catalogText).plugins

console.log(`envelope (${catalogPath})`)
check(catalog.version === 1, 'parseCatalog accepted the envelope')
check(catalog.dropped.length === 0, 'no row was dropped', JSON.stringify(catalog.dropped))
// parseCatalog drops rather than throws, so a row count that shrank is the only
// evidence a submission was silently ignored.
check(
  catalog.plugins.length === sourceRows.length,
  `all ${String(sourceRows.length)} row(s) survived validation`,
  `${String(catalog.plugins.length)} of ${String(sourceRows.length)}`,
)
console.log('')

/**
 * Read a tarball into `path -> bytes`, with `package/` already stripped.
 *
 * Uses the app's own `tar.js` when it exists, and that is the point: it is a
 * dependency-free ustar reader that refuses rather than repairs (absolute
 * paths, symlinks, traversal, gzip bombs, a missing end-of-archive marker), and
 * a tarball the gate accepted through system tar but the installer would refuse
 * is a release that fails at the user. System tar is a fallback that says so.
 * @param {Buffer} bytes - the .tgz bytes.
 * @returns {Promise<Map<string, Buffer>> | Map<string, Buffer>} the file table.
 */
async function tarballFiles(bytes) {
  if (tar !== undefined && typeof tar.tarballFiles === 'function') return tar.tarballFiles(bytes)
  note(
    'the app ships no packages/market/lib/tar.js with a tarballFiles export'
      + ` (${tar === undefined ? 'no tar.js' : Object.keys(tar).join(', ')}), so extraction here is system tar,`
      + ' not the installer\'s own reader; its path and bomb refusals are UNCHECKED',
  )
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, readdirSync, statSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const work = mkdtempSync(join(tmpdir(), 'market-gate-'))
  writeFileSync(join(work, 'a.tgz'), bytes)
  const result = spawnSync('tar', ['-xzf', 'a.tgz'], { cwd: work, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`tar exited ${String(result.status)}`)
  /** @type {Map<string, Buffer>} */
  const files = new Map()
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
      else files.set(`${prefix}${name}`, readFileSync(full))
    }
  }
  walk(join(work, 'package'), '')
  return files
}

/**
 * Read the single-row patch layer without a YAML parser of our own.
 *
 * js-yaml is the parser the harness uses for these files
 * (`@deepseek-ai/cordis-plugin-include` mounts its entry-list dialect on top of
 * it), so a file this accepts is a file the harness parses. The `!!js` tag of
 * that dialect is deliberately NOT registered: a marketplace plugin's row must
 * not carry an expression the harness would evaluate at activation, and an
 * unregistered tag makes js-yaml throw instead of passing it on.
 * @param {Buffer} bytes - the patch file's contents.
 * @param {string} filename - for the error message.
 * @returns {Promise<unknown>} the parsed patch layer.
 */
async function readPatch(bytes, filename) {
  // js-yaml v4 is CJS: `default` is the whole module and is what a
  // bundler-free Node gives reliably.
  const imported = await import('js-yaml')
  const yaml = imported.default ?? imported
  return yaml.load(bytes.toString('utf8'), { schema: yaml.JSON_SCHEMA, filename })
}

// ---------------------------------------------------------------------------
// 3. Per row: identity, the bytes, and what is inside them.
// ---------------------------------------------------------------------------
for (const row of catalog.plugins) {
  console.log(`row ${row.id}`)

  // `name` is the npm package name, not a label. The installer looks a listing
  // up by it (`view.plugins.find((p) => p.name === wanted)`), asserts the
  // tarball's own manifest name equals it, and writes the package to
  // `profiles/desktop/node_modules/<name>`. A display name here is a plugin
  // that cannot be installed.
  //
  // Both predicates come from the app's registry.js, and both catch things
  // parseCatalog does not: `isPluginName` is lowercase-only and refuses the
  // reserved names, while SAFE_ID permits uppercase; `isPluginVersion` demands
  // one concrete semver release, and parseCatalog does not parse the version at
  // all — so a row with a range passes the catalog and 422s at install.
  if (registry === undefined) {
    note('the app ships no packages/market/lib/registry.js, so the installable-name and exact-version rules are UNCHECKED')
  } else {
    check(registry.isPluginName(row.name), 'name is an installable package name (registry.isPluginName)', JSON.stringify(row.name))
    check(registry.isPluginVersion(row.version), 'version is one concrete semver release (registry.isPluginVersion)', JSON.stringify(row.version))
  }
  // Repo convention, not an app rule: `id` is unused by the installer, so
  // letting it differ from `name` gives two identities for one plugin and
  // guarantees they eventually disagree.
  check(row.id === row.name, 'id equals name', `${row.id} vs ${row.name}`)

  // Named separately from parseCatalog's own digest check so the message says
  // "sha512" rather than "dropped".
  const digest = fetchModule.parseIntegrity(row.integrity)
  check(digest.algorithm === 'sha512', 'integrity is sha512', digest.algorithm)

  const pluginDir = join(repoRoot, 'plugins', row.name)
  if (check(existsSync(pluginDir), `plugins/${row.name}/ exists in this repo`)) {
    const source = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
    check(source.name === row.name, `plugins/${row.name}/package.json name is the row name`, String(source.name))
    check(
      source.version === row.version,
      `plugins/${row.name}/package.json version matches the row`,
      `${String(source.version)} vs ${row.version}`,
    )
  }

  if (row.integrity === PLACEHOLDER_INTEGRITY) {
    // Deliberately a failure, not a skip. The served catalog names bytes that
    // cannot be verified, which is the exact state this gate exists to keep off
    // the default branch. The fix is a release, not an exemption.
    check(
      false,
      `${row.name} carries a real integrity digest`,
      'the bootstrap placeholder — run the release-plugin workflow, which computes the digest and rewrites this row',
    )
    console.log('')
    continue
  }

  if (offline) {
    note(`--offline: not downloading ${row.tarball}, so integrity and manifest are UNCHECKED for ${row.name}`)
    console.log('')
    continue
  }

  // fetchTarball parses the digest first, follows redirects by hand re-checking
  // the scheme on every hop, caps the body as it arrives, and returns bytes
  // ONLY after they verify — so reaching the next line is itself the integrity
  // assertion, and no caller of it can hold unverified bytes.
  let bytes
  try {
    bytes = Buffer.from(await fetchModule.fetchTarball(row.tarball, row.integrity))
    check(true, `${row.tarball} downloaded and matched its ${digest.algorithm}`)
  } catch (error) {
    check(false, `${row.tarball} downloaded and matched its ${digest.algorithm}`, String(error))
    console.log('')
    continue
  }
  // Printed so a maintainer fixing a mismatch has the value without re-running.
  console.log(`  note  ${String(bytes.byteLength)} bytes, sha512-${createHash('sha512').update(bytes).digest('base64')}`)

  let files
  try {
    files = await tarballFiles(bytes)
  } catch (error) {
    check(false, 'the tarball is a readable npm tarball', String(error))
    console.log('')
    continue
  }

  const manifestBytes = files.get('package.json')
  if (!check(manifestBytes !== undefined, 'the tarball contains package.json')) {
    console.log('')
    continue
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'))

  // The installer's own two equality checks, run here instead of at a user's
  // machine: "the package is X, not Y as the catalog said".
  check(manifest.name === row.name, 'the tarball manifest name equals the row name', String(manifest.name))
  check(manifest.version === row.version, 'the tarball manifest version equals the row version', String(manifest.version))

  // The no-dependencies rule, and the installer refuses on exactly this. A
  // runtime dependency would have to be fetched and resolved on the user's
  // machine at install time — but the packaged app ships no package manager, so
  // it would resolve to nothing at load, and no digest in this catalog would
  // have covered it either way.
  const runtimeDeps = Object.keys(manifest.dependencies ?? {})
  check(runtimeDeps.length === 0, 'the manifest declares no runtime dependencies', runtimeDeps.join(', '))
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
   * Whether an export target is actually in the tarball.
   * @param {string | undefined} target - the relative target.
   * @returns {boolean} whether the file shipped.
   */
  const shipped = (target) => typeof target === 'string' && files.has(target.replace(/^\.\//, ''))

  // The node half is what the Loader imports for the row; without it the row
  // cannot mount at all, however complete the browser half is.
  const nodeEntry = exportTarget('.')
  check(typeof nodeEntry === 'string', 'exports["."] names a node entry', JSON.stringify(exportsField?.['.']))
  check(shipped(nodeEntry), `${String(nodeEntry)} is in the tarball (check the manifest's "files")`)
  check(exportsIsObject && exportsField['./package.json'] === './package.json', 'exports["./package.json"] is declared')

  const clientDecl = manifest.dsh?.client
  if (clientDecl === undefined) {
    note(`${row.name} declares no dsh.client, so it contributes no browser half`)
  } else {
    check(clientDecl.platform === 'web', 'dsh.client.platform is the literal "web"', JSON.stringify(clientDecl.platform))
    const clientEntry = exportTarget('./client')
    check(typeof clientEntry === 'string', 'exports["./client"] names a browser bundle', JSON.stringify(exportsField?.['./client']))
    if (check(shipped(clientEntry), `${String(clientEntry)} is in the tarball`)) {
      const bundle = files.get(String(clientEntry).replace(/^\.\//, '')).toString('utf8')
      // The bundle is fetched with a classic <script src>, and the module system
      // then asserts a factory was registered under this exact id. An ES module
      // defers past that assertion; a mismatched id fails it.
      check(bundle.includes('window.__ModuleLoader__.load('), 'the client bundle registers through window.__ModuleLoader__.load')
      check(
        bundle.includes(JSON.stringify(manifest.name)),
        `the client bundle's registered id is the package name (${String(manifest.name)})`,
      )
      check(
        !/^\s*(?:import|export)\s/m.test(bundle),
        'the client bundle has no top-level ESM syntax (it must be a classic script)',
      )
    }
    if (Array.isArray(clientDecl.inject)) {
      // The manifest field holds PACKAGE names; the bundle's own
      // `export const inject` holds cordis SERVICE names. A bare service name
      // here is the usual way to get that backwards, and it resolves to nothing
      // rather than failing.
      const bare = clientDecl.inject.filter((entry) => !String(entry).includes('/'))
      check(bare.length === 0, 'dsh.client.inject holds package names, not service names', bare.join(', '))
    }
  }

  // ------------------------------------------------------------------
  // The patch layer: one row, named for the package.
  // ------------------------------------------------------------------
  const declaredPatch = manifest.dsh?.bundle?.patch
  if (!check(typeof declaredPatch === 'string', 'dsh.bundle.patch is declared', JSON.stringify(declaredPatch))) {
    console.log('')
    continue
  }
  // Resolved the way the installer resolves it, and the way loadProfile will.
  const patchKey = declaredPatch.replace(/^\.\//, '')
  if (!check(files.has(patchKey), `${declaredPatch} is in the tarball`)) {
    console.log('')
    continue
  }

  let patch
  try {
    patch = await readPatch(files.get(patchKey), patchKey)
  } catch (error) {
    check(false, `${declaredPatch} parses as plain YAML (no !!js expressions)`, String(error))
    console.log('')
    continue
  }
  check(Array.isArray(patch), 'the patch file is an entry-patch list')
  const layer = Array.isArray(patch) ? patch : []
  check(layer.length === 1, 'the patch layer holds exactly one patch', String(layer.length))
  check(
    layer.every((entry) => entry !== null && typeof entry === 'object' && Object.keys(entry).length === 1 && 'insert' in entry),
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
console.log('schema/index.schema.json')
// `ajv/dist/2020` and not the package root: the root export only knows
// draft-07, and compiling a 2020-12 document against it fails with
// `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`,
// which reads like a network problem and is not one.
const { default: Ajv } = await import('ajv/dist/2020.js')
const schema = JSON.parse(readFileSync(join(repoRoot, 'schema', 'index.schema.json'), 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)
check(validate(JSON.parse(catalogText)), 'index.json validates against schema/index.schema.json', JSON.stringify(validate.errors))
console.log('')

console.log(`validate-catalog: ${String(failures.length)} failure(s), ${String(notes.length)} note(s)`)
for (const line of failures) console.log(`  FAIL  ${line}`)
process.exit(failures.length === 0 ? 0 : 1)
