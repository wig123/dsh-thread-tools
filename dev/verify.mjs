/**
 * Real-runtime verification for @wig123/dsh-thread-tools.
 *
 * Boots the composed entry tree of a real dsh profile (base bundle plus this
 * plugin) against the real session store, creates two live sessions through the
 * agent factory, and drives the plugin's tool definitions exactly as the model
 * would: `execute(args, exec)` with the real tool-run identity.
 *
 * Usage: node dev/verify.mjs [profileName]
 */

import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const profileName = process.argv[2] ?? 'probe-session-tools'
const dshInstall = process.env.DSH_INSTALL_DIR ?? '/Users/oneway/.npm-global/lib/node_modules/@deepseek-ai/dsh'
const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
const profileDir = join(home, 'profiles', profileName)

import {
  STUB_MODEL,
  STUB_PROVIDER,
  TARGET_MODEL,
  TARGET_PROVIDER,
  scriptedTargetAdapter,
  scriptedThreadAdapter,
} from './stub-adapter.mjs'

const boot = await import('@deepseek-ai/dsh-app-boot')
const llm = await import('@deepseek-ai/dsh-llm')
const brand = await import('@deepseek-ai/dsh-brand')

const profile = boot.loadProfile('verify', profileName, join(dshInstall, 'package.json'), home)
const patches = profile.layers.flatMap(layer => layer.patches)

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`)
}

const ctx = await boot.boot(
  'verify',
  join(profile.dir, 'cordis.yml'),
  [...patches, profile.patches],
  undefined,
  pathToFileURL(`${profile.dir}/`).href,
)

console.log(`booted profile ${profileName} (${ctx.agents.list().length} live agent(s))\n`)

// --- observe every durable session write so delivery is checked from the log ---
const writes = []
const eventLog = []
ctx.on('session/event', (session, event) => {
  eventLog.push(`${session.id}:${event.type}`)
  if (event.type === 'user/message') {
    writes.push({ sessionId: session.id, text: JSON.stringify(event.data?.content ?? null) })
  }
})

const dispose = []
try {
  const create = async (cwd) => {
    const handle = await ctx.agents.create({
      sessionId: brand.brandString(`verify-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      meta: { cwd },
      agentOptions: { provider: STUB_PROVIDER, model: STUB_MODEL },
    })
    dispose.push(handle)
    return handle.agent
  }

  const source = await create(process.cwd())
  const target = await create(process.cwd())
  console.log(`source=${source.id}\ntarget=${target.id}\n`)

  // --- drive the tools the way the harness does: through a real model request ---
  const seenTools = []
  ctx.llm.registerAdapter([STUB_PROVIDER], scriptedThreadAdapter(target.id, seenTools))
  // The session the model messages draws from this adapter, so its answer is
  // scripted independently of the driver's request sequence.
  ctx.llm.registerAdapter([TARGET_PROVIDER], scriptedTargetAdapter('Acknowledged from the scripted target.', seenTools))
  // Only the target session is rerouted; the driver keeps its own adapter so the
  // two sessions' request sequences cannot interleave.
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    if (payload.agent.id !== target.id) return config
    return { ...config, provider: TARGET_PROVIDER, model: TARGET_MODEL }
  })
  // A session created by the plugin carries no model of its own, so the harness
  // supplies the scripted route for any request that has none.
  const driven = await ctx.agents.create({
    sessionId: brand.brandString(`verify-model-${Date.now()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: STUB_PROVIDER, model: STUB_MODEL },
  })
  dispose.push(driven)
  driven.agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text: 'Find the session and send it a message.' }],
    source: { kind: 'user' },
  }))
  // The scripted model answers instantly; wait for its third request rather than
  // for one status transition, since the loop goes idle between tool batches.
  for (let waited = 0; waited < 180_000; waited += 250) {
    await new Promise(resolve => setTimeout(resolve, 250))
    if (seenTools.includes('final')) break
  }
  record(
    'a real model request drives the tools through the agent loop',
    ['thread_list', 'thread_send', 'thread_reply'].every(step => seenTools.includes(step)),
    `scripted requests: ${seenTools.join(' -> ')}`,
  )
  record('the driven turn reached a final answer', seenTools.includes('final'), `requests=${seenTools.length}`)
  // The reply text reaches the model as a tool result of the driven session; its
  // own log is the authority on what the loop actually handed back.
  const drivenEvents = (await ctx.sessionPersistence.inspect(driven.agent.id)).events
  const replyEvent = drivenEvents.find(event => event.type === 'tool/result'
    && event.data?.message?.source?.callId === 'verify-call-3')
  const replyText = JSON.stringify(replyEvent?.data?.message?.content ?? '')
  record(
    'the model-issued reply tool returns the target text',
    replyText.includes('Acknowledged from the scripted target.'),
    `driven-session tool result: ${replyText.slice(0, 200)}`,
  )
  await new Promise(resolve => setTimeout(resolve, 1500))
  // The plugin registers scoped tools through the caller's own ctx; resolve the
  // definitions through the tool registry the way a model call would.
  const sourceTools = ctx.tools.schemas({ agent: source })
  const names = sourceTools.map(entry => entry.name)
  const listName = names.find(name => name === 'thread_list')
  const searchName = names.find(name => name === 'thread_search')
  const sendName = names.find(name => name === 'thread_send')
  record('plugin registers thread_list', listName === 'thread_list', `tool names: ${names.join(', ')}`)
  record('plugin registers thread_search', searchName === 'thread_search')
  record('plugin registers thread_send', sendName === 'thread_send')
  const createName = names.find(name => name === 'thread_create')
  const forkName = names.find(name => name === 'thread_fork')
  record('plugin registers thread_create', createName === 'thread_create')
  record('plugin registers thread_fork', forkName === 'thread_fork')
  record('plugin registers thread_reply', names.includes('thread_reply'))
  if (listName === undefined || sendName === undefined) throw new Error('thread tools are not registered')

  // DEMO=1 prints the delivered surface and a live listing call, for use as
  // evidence in a review.
  if (process.env.DEMO === '1') {
    const threadTools = ctx.tools.schemas({ agent: source }).filter(entry => entry.name.startsWith('thread_'))
    console.log('tools registered in this profile:')
    for (const entry of threadTools) console.log(`  ${entry.name}: ${entry.description.split('.')[0]}.`)
  }

  const callTool = async (agent, name, args) => {
    const result = await ctx.tools.execute({
      callId: brand.brandString(`call-${Math.random().toString(16).slice(2)}`),
      name,
      arguments: args,
      agent,
      signal: new AbortController().signal,
    })
    if (process.env.VERIFY_DEBUG === '1') {
      console.log(`[debug] ${name} ->`, JSON.stringify(result, (_key, value) => (typeof value === 'object' && value !== null && typeof value.id === 'string' ? `[agent ${value.id}]` : value))?.slice(0, 600))
    }
    if (result.isError) {
      const message = result.content.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
      return { isError: true, value: undefined, content: message }
    }
    return { isError: false, value: result.value, content: result.content }
  }

  // --- listing sees real sessions from the durable store ---
  const listResult = await callTool(source, listName, { limit: 5 })
  const listValue = listResult.value ?? {}
  const listedIds = (listValue.sessions ?? []).map(row => row.sessionId)
  if (process.env.DEMO === '1') {
    console.log('\nthread_list output from a live call:')
    console.log(listResult.content.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n'))
  }
  record(
    'thread_list returns stored sessions',
    listedIds.length > 0 && listedIds.includes(target.id),
    `total=${listValue.total} shown=${listValue.shown} includesTarget=${listedIds.includes(target.id)}`,
  )
  record(
    'thread_list marks the caller as current',
    (listValue.sessions ?? []).some(row => row.sessionId === source.id && row.current === true),
  )

  // --- delivery lands on the target session's own log ---
  const before = writes.length
  const sendResult = await callTool(source, sendName, { session_id: target.id, message: 'verification ping from thread tools' })
  await new Promise(resolve => setTimeout(resolve, 2000))
  const relayed = writes.slice(before).filter(entry => entry.sessionId === target.id)
  record(
    'thread_send reports delivery',
    sendResult.value?.delivery === 'delivered',
    `value=${JSON.stringify(sendResult.value)}`,
  )
  // The target's own turn also admits runtime-context and skill notices, so the
  // relayed body is matched among everything the target recorded after the send.
  const relayedBody = relayed.find(entry => entry.text.includes('verification ping from thread tools'))
  record(
    'the target session records the relayed message',
    relayedBody !== undefined,
    relayedBody === undefined
      ? `no relayed user/message observed on the target session (${relayed.length} other writes)`
      : relayedBody.text.slice(0, 180),
  )

  // The model's own request reaches the same target; its body lands on the
  // target's log once that session's loop admits the queued turn.
  let modelRelayed
  for (let waited = 0; waited < 30_000; waited += 250) {
    modelRelayed = writes.find(entry => entry.sessionId === target.id && entry.text.includes('hello from the scripted model'))
    if (modelRelayed !== undefined) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  console.log(`[dbg] target=${target.id} status=${target.status} writes=${JSON.stringify(writes.map(w => w.sessionId))}`)
  record(
    'a model-issued message lands on the target session log',
    modelRelayed !== undefined,
    modelRelayed === undefined ? 'the scripted model\'s message never reached the target log' : modelRelayed.text.slice(0, 140),
  )


  // --- failure paths ---
  const unknown = await callTool(source, sendName, { session_id: 'session-does-not-exist', message: 'x' })
  record('unknown target id is a reported failure', unknown.value?.delivery === 'unknown-session', JSON.stringify(unknown.value))
  const self = await callTool(source, sendName, { session_id: source.id, message: 'x' })
  record('self delivery is refused', self.value?.delivery === 'self', JSON.stringify(self.value))

  const search = await callTool(source, searchName, { query: 'verification' })
  record(
    'thread_search reports a disabled index as unavailable',
    search.isError === false && search.value?.available === false && typeof search.value?.reason === 'string',
    `available=${search.value?.available} reason=${search.value?.reason}`,
  )

  // --- session creation and forking ---
  const created = await callTool(source, createName, { cwd: process.cwd() })
  record('thread_create reports a new session', created.value?.status === 'created' && typeof created.value?.sessionId === 'string', JSON.stringify(created.value))
  const createdId = created.value?.sessionId
  if (typeof createdId === 'string') {
    const listedAfterCreate = await callTool(source, listName, { query: createdId, limit: 5 })
    const row = (listedAfterCreate.value?.sessions ?? []).find(entry => entry.sessionId === createdId)
    record('the new session is a listed top-level session', row !== undefined, `row=${JSON.stringify(row)}`)
    record('the new session inherits the requested cwd', row?.cwd === process.cwd(), `cwd=${row?.cwd}`)
  }

  const forked = await callTool(source, forkName, { session_id: target.id })
  record(
    'thread_fork inherits the completed turns of a live session',
    forked.value?.status === 'forked' && forked.value?.inheritedEvents > 0,
    JSON.stringify(forked.value),
  )
  const forkUnknown = await callTool(source, forkName, { session_id: 'session-does-not-exist' })
  record('forking an unknown session is refused', forkUnknown.value?.status === 'unknown-session', JSON.stringify(forkUnknown.value))
  const forkSelf = await callTool(source, forkName, { session_id: source.id })
  record('forking the calling session is refused', forkSelf.value?.status === 'self', JSON.stringify(forkSelf.value))

  const filtered = await callTool(source, listName, { query: target.id, limit: 5 })
  record(
    'listing filters by session id',
    (filtered.value?.sessions ?? []).length === 1 && filtered.value.sessions[0].sessionId === target.id,
    `shown=${filtered.value?.shown}`,
  )
} finally {
  for (const handle of dispose.reverse()) {
    try {
      await handle.dispose()
    } catch (error) {
      console.error(`dispose failed: ${String(error)}`)
    }
  }
  await ctx.dispose?.()
}

const failed = results.filter(entry => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
