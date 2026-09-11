/**
 * Keyless checks that run in CI: nothing here needs a dsh installation, a
 * profile, or an API key. Integration behavior is covered separately by
 * dev/verify.mjs, which does need a local dsh.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { completedTurnPrefix, newSessionId } from '../lib/session-create.js'
import { DEFAULT_THREAD_TOOLS_CONFIG, createThreadToolDefinitions } from '../lib/tools.js'

test('every tool name the deployment can register is distinct', () => {
  const names = [
    DEFAULT_THREAD_TOOLS_CONFIG.listToolName,
    DEFAULT_THREAD_TOOLS_CONFIG.searchToolName,
    DEFAULT_THREAD_TOOLS_CONFIG.sendToolName,
    DEFAULT_THREAD_TOOLS_CONFIG.replyToolName,
    DEFAULT_THREAD_TOOLS_CONFIG.createToolName,
    DEFAULT_THREAD_TOOLS_CONFIG.forkToolName,
  ]
  assert.equal(names.length, 6)
  assert.equal(new Set(names).size, 6)
})

test('the registry receives six definitions with declared results', () => {
  const definitions = createThreadToolDefinitions(DEFAULT_THREAD_TOOLS_CONFIG)
  assert.equal(definitions.length, 6)
  for (const definition of definitions) {
    assert.equal(typeof definition.name, 'string')
    assert.ok(definition.description.length > 0)
    assert.equal(typeof definition.output.schema, 'object')
    assert.equal(typeof definition.execute, 'function')
  }
  assert.deepEqual(definitions.map(entry => entry.name), [
    'thread_list',
    'thread_search',
    'thread_send',
    'thread_create',
    'thread_fork',
    'thread_reply',
  ])
})

test('a forked prefix ends on a completed turn', () => {
  const events = [
    { seq: 0, type: 'session' },
    { seq: 1, type: 'turn/start' },
    { seq: 2, type: 'assistant/message' },
    { seq: 3, type: 'turn/end' },
    { seq: 4, type: 'turn/start' },
    { seq: 5, type: 'assistant/message' },
  ]
  assert.equal(completedTurnPrefix(events), 4, 'the unfinished second turn is excluded')
  assert.equal(completedTurnPrefix(events, 4), 4, 'the bound is exclusive')
  assert.equal(completedTurnPrefix(events, 3), 0, 'a bound before the first turn/end inherits nothing')
  assert.equal(completedTurnPrefix([{ seq: 0, type: 'turn/start' }]), 0)
  assert.equal(completedTurnPrefix([]), 0)
})

test('a new session id keeps the harness id shape', () => {
  const id = newSessionId()
  assert.match(id, /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.notEqual(id, newSessionId())
})
