// Pack one plugin directory and write its catalog row.
//
//   node scripts/pack-plugin.mjs --plugin dsh-plugin-background-color --out dist
//
// Prints the tag, the tarball filename and the `sha512-` integrity, and — with
// --write — rewrites the matching row in index.json so the digest is never
// retyped. A hash copied by hand is a hash that can be copied wrong, and a
// wrong one fails at the user's install rather than in CI, so the only human
// step left here is reviewing the diff.
//
// The digest is taken from the file this script produced, and the gate later
// takes its digest from the file GitHub SERVED. Those are two different reads
// of what should be the same bytes, which is the point: a truncated upload
// cannot pass as a release.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

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
const id = typeof options.plugin === 'string' ? options.plugin : undefined
if (id === undefined) {
  console.error('pack-plugin: --plugin <id> is required (the directory name under plugins/, which is also the package name)')
  process.exit(2)
}
const repoRoot = resolve(typeof options.repo === 'string' ? options.repo : process.cwd())
const pluginDir = join(repoRoot, 'plugins', id)
const outDir = resolve(typeof options.out === 'string' ? options.out : join(repoRoot, 'dist'))

if (!existsSync(join(pluginDir, 'package.json'))) {
  console.error(`pack-plugin: ${join(pluginDir, 'package.json')} does not exist`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))

// The three-way identity rule this repo enforces, checked here as well as in
// the gate: it costs nothing and it stops a release being cut from a directory
// whose name drifted from its package name.
if (manifest.name !== id) {
  console.error(`pack-plugin: plugins/${id}/ declares name ${JSON.stringify(manifest.name)}; the two must match`)
  process.exit(2)
}

// `--pack-destination` does not create the directory. Left absent, npm fails
// with an ENOENT naming the tarball it was about to write, which reads like a
// packing failure rather than a missing directory.
mkdirSync(outDir, { recursive: true })
const before = new Set(readdirSync(outDir))

// `npm pack` and not `git archive`: the manifest's `files` list is the
// authority on what ships, and only npm reads it. That also means the archive
// is rooted at `package/`, which is what the installer and the gate expect.
const pack = spawnSync('npm', ['pack', '--pack-destination', outDir], {
  cwd: pluginDir,
  stdio: ['ignore', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
})
if (pack.status !== 0) {
  console.error(`pack-plugin: npm pack exited ${String(pack.status)}`)
  process.exit(1)
}
// npm prints the filename on stdout, but it also prints it inside a summary on
// some versions; diffing the directory is the version-independent read.
const produced = readdirSync(outDir).filter((file) => file.endsWith('.tgz') && !before.has(file))
const filename = produced.length === 1
  ? produced[0]
  : `${manifest.name}-${manifest.version}.tgz`
const tarball = join(outDir, filename)
if (!existsSync(tarball)) {
  console.error(`pack-plugin: expected ${tarball}, npm pack printed:\n${String(pack.stdout)}`)
  process.exit(1)
}

const bytes = readFileSync(tarball)
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const tag = `${id}-v${String(manifest.version)}`
const url = `https://github.com/xxsLuna/DeepSeek-Harness-Desktop-Marketplace/releases/download/${tag}/${filename}`

console.log(`plugin     ${id}`)
console.log(`version    ${String(manifest.version)}`)
console.log(`tag        ${tag}`)
console.log(`file       ${tarball}`)
console.log(`bytes      ${String(bytes.byteLength)}`)
console.log(`integrity  ${integrity}`)
console.log(`tarball    ${url}`)

// Machine-readable for the workflow, which needs the tag and the filename for
// `gh release`. Written to GITHUB_OUTPUT when the workflow provides it.
if (typeof process.env.GITHUB_OUTPUT === 'string' && process.env.GITHUB_OUTPUT !== '') {
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    [`tag=${tag}`, `filename=${filename}`, `tarball=${tarball}`, `url=${url}`, `integrity=${integrity}`, ''].join('\n'),
    { flag: 'a' },
  )
}

if (options.write !== true) {
  console.log('')
  console.log('index.json not touched (pass --write to rewrite the row)')
  process.exit(0)
}

const catalogPath = join(repoRoot, 'index.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const row = Array.isArray(catalog.plugins) ? catalog.plugins.find((entry) => entry?.id === id) : undefined
if (row === undefined) {
  console.error(`pack-plugin: index.json has no row with id ${JSON.stringify(id)}; add it before releasing`)
  process.exit(1)
}
// `name` is not rewritten, because it is not a release fact — it is the npm
// package name the installer matches the tarball against, and the submitter set
// it. A mismatch here would be published as a plugin that downloads and then
// refuses to install, so it stops the release instead.
if (row.name !== manifest.name) {
  console.error(`pack-plugin: index.json row names ${JSON.stringify(row.name)} but the package is ${JSON.stringify(manifest.name)}`)
  process.exit(1)
}
row.version = manifest.version
row.tarball = url
row.integrity = integrity
// The placeholder note is the one field a real release makes false, so it goes
// with the placeholder rather than lingering as a lie about a verified row.
if (typeof row.$comment === 'string' && row.$comment.startsWith('PLACEHOLDER')) delete row.$comment

// Two spaces and a trailing newline, matching the file as committed: a
// formatting change in the same commit as a digest change makes the diff
// unreviewable, and reviewing that diff is the last human check in this path.
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
console.log('')
console.log(`index.json row ${id} rewritten`)
