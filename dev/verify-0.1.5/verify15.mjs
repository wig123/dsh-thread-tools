/**
 * Verification against the 0.1.5 host line.
 *
 * Boots the same profile composition as the 0.1.2 harness, then exercises the
 * store access the log-reading tools depend on: list stored sessions, read one
 * session's events, and deliver a message into a live session. No model call is
 * involved, so no API key is needed.
 *
 * Usage: node verify15.mjs <profileName>
 */

import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const profileName = process.argv[2] ?? 'probe15'
// Point these at an installation of the 0.1.5 line and its harness home. The
// harness mounts the base bundle itself, so the profile only needs this plugin.
const dshInstall = process.env.DSH15_INSTALL ?? '/tmp/dsh15/node_modules/@deepseek-ai/dsh'
const home = process.env.DSH15_HOME ?? '/tmp/dsh15home'
const profileDir = join(home, 'profiles', profileName)

const boot = await import('@deepseek-ai/dsh-app-boot')
const brand = await import('@deepseek-ai/dsh-brand')
const llm = await import('@deepseek-ai/dsh-llm')
// The installation carries the YAML parser the loader uses; a harness has no
// manifest of its own, so it borrows that one by path.
const installRequire = createRequire(join(dshInstall, '..', 'dsh-base', 'cordis.patch.yml'))
const parseYaml = installRequire('yaml').parse

const pluginPath = process.env.THREAD_TOOLS_ENTRY ?? join(profileDir, 'node_modules/@wig123/dsh-thread-tools/lib/store-access.js')
const store = await import(pluginPath)

/**
 * The base bundle's patch list, read straight from the install.
 *
 * The bundle carries `!!js` expressions for deployment paths and permission
 * modes; a harness has no expression evaluator, so every such value is dropped
 * and the entry keeps only literal configuration.
 */
function baseBasePatches() {
  const text = readFileSync(join(dshInstall, '..', 'dsh-base/cordis.patch.yml'), 'utf8')
  const literal = (value) => {
    if (Array.isArray(value)) return value.map(literal)
    if (value !== null && typeof value === 'object') {
      if ('__jsExpr' in value) return undefined
      const out = {}
      for (const [key, entry] of Object.entries(value)) {
        const next = literal(entry)
        if (next !== undefined) out[key] = next
      }
      return out
    }
    return value
  }
  const notEvaluable = new Set(['session-telemetry-otel', 'sandbox-policy', 'approval', 'permission', 'tool-bash', 'tool-pwsh', 'pwsh-sandbox', 'bash-sandbox', 'fs-sandbox', 'tool-fs'])
  /** Drop every entry with one of those ids, wherever it sits in the layer list. */
  const prune = (value) => {
    if (Array.isArray(value)) {
      return value.map(prune).filter(entry => !(entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && notEvaluable.has(entry.id)))
    }
    if (value !== null && typeof value === 'object') {
      const out = {}
      for (const [key, entry] of Object.entries(value)) out[key] = prune(entry)
      return out
    }
    return value
  }
  const rows = prune(parseYaml(text).map(layer => literal(layer))).filter(layer => layer !== undefined)
  // The bundle points storage at the harness home through a `!!js` expression;
  // the harness states the same path literally.
  const withRoots = (value) => {
    if (Array.isArray(value)) return value.map(withRoots)
    if (value !== null && typeof value === 'object') {
      const out = {}
      for (const [key, entry] of Object.entries(value)) out[key] = withRoots(entry)
      // The harness home is the store root. Sessions live under a directory keyed
      // by the working directory, so run this from the directory whose sessions
      // the checks should see.
      if (out.id === 'session-persistence-jsonl') out.config = { ...(out.config ?? {}), root: join(home, 'sessions') }
      if (out.id === 'storage-json') out.config = { ...(out.config ?? {}), root: join(home, 'storages') }
      return out
    }
    return value
  }
  return withRoots(rows)
}

const results = []
if (process.env.VERIFY_DEBUG === '1') console.log('[debug] base layer ids:', baseRows().join(', '))

/** Row ids the harness applies, for diagnosing loader refusals. */
function baseRows() {
  const rows = []
  const walk = (value) => {
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return }
    if (value !== null && typeof value === 'object') {
      if (typeof value.id === 'string') rows.push(`${value.id} (${String(value.name ?? '')})`)
      for (const entry of Object.values(value)) walk(entry)
    }
  }
  walk(baseBasePatches())
  return rows
}
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`)
}

// The harness mounts the base bundle's entries over an empty root, then this
// package's own layer, with the 0.1.5 install as the bare-name base.
const profile = boot.loadProfile('verify15', profileName, join(dshInstall, 'package.json'), home)
const pluginLayer = profile.layers.find(layer => layer.packageName === '@wig123/dsh-thread-tools')
const ctx = await boot.boot(
  'verify15',
  join(profile.dir, 'cordis-harness.yml'),
  [...baseBasePatches(), ...(pluginLayer?.patches ?? [])],
  undefined,
  pathToFileURL(`${dshInstall}/`).href,
)
console.log(`booted ${profileName} on the 0.1.5 line\n`)

const dispose = []
const writes = []
ctx.on('session/event', (session, event) => {
  if (event.type === 'user/message') writes.push({ sessionId: session.id, text: JSON.stringify(event.data?.content ?? null) })
})

try {
  const persistence = ctx.get('sessionPersistence')
  record('the profile mounts session persistence', persistence !== undefined, `shape: ${persistence === undefined ? 'absent' : Object.getOwnPropertyNames(Object.getPrototypeOf(persistence)).slice(0, 6).join(', ')}`)


  const headers = await store.listStoredHeaders(persistence)
  record('listing stored sessions works on this line', headers.length > 0, `${headers.length} stored session(s), first id=${headers[0]?.id ?? 'none'}`)

  // The agent's own log is written by the loop, so the store access is exercised
  // through a read handle on it.
  const created = await ctx.agents.create({
    sessionId: brand.brandString(`verify15-${Date.now()}`),
    meta: { cwd: process.cwd() },
  })
  dispose.push(created)
  const stored = await store.loadStoredSession(persistence, created.agent.id)
  record(
    'reading a stored log works on this line',
    stored !== undefined && stored.events !== undefined,
    stored === undefined ? 'loadStoredSession returned undefined' : `header=${stored.header.id}, events=${stored.events.length}`,
  )

  // A session the tool creates is an addressable target: the delivery path and
  // the log path are checked against it, with no hand-built events.
  const created202 = await ctx.tools.execute({
    callId: brand.brandString(`call-${Date.now()}`),
    name: 'thread_create',
    arguments: {},
    agent: created.agent,
    signal: new AbortController().signal,
  })
  const targetId = created202.isError ? undefined : created202.value?.sessionId
  record('thread_create runs on this line', typeof targetId === 'string', JSON.stringify(created202.isError ? created202.content : created202.value))

  if (typeof targetId === 'string') {
    const delivery = await ctx.tools.execute({
      callId: brand.brandString(`call-${Date.now()}`),
      name: 'thread_send',
      arguments: { session_id: targetId, message: 'hello from the 0.1.5 harness' },
      agent: created.agent,
      signal: new AbortController().signal,
    })
    const value = delivery.isError ? undefined : delivery.value
    record(
      'thread_send runs on this line',
      delivery.isError === false && value?.delivery === 'delivered',
      delivery.isError ? `error: ${JSON.stringify(delivery.content).slice(0, 200)}` : JSON.stringify(value),
    )

    let recorded = false
    for (let waited = 0; waited < 20_000 && !recorded; waited += 500) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const stored = await store.loadStoredSession(persistence, targetId)
      // This line records the queued delivery on the inbox splice; the session's
      // own user message is admitted when the target's turn starts.
      recorded = (stored?.events ?? []).some(event => JSON.stringify(event.data).includes('hello from the 0.1.5 harness'))
    }
    record('the target session recorded the message on its own log', recorded, recorded ? 'the relayed body is in the target log' : 'no relayed body in the target log')
  }
} finally {
  for (const handle of dispose.reverse()) {
    try {
      await handle.dispose()
    } catch (error) {
      console.error(`dispose failed: ${String(error)}`)
    }
  }
}

const failed = results.filter(entry => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
