/**
 * The model-facing thread tools.
 *
 * Each tool declares its complete canonical result, renders that value as
 * compact text for the model, and keeps the same fields available to
 * programmatic callers.
 *
 * @module @wig123/dsh-thread-tools/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { asSessionId, deliverThreadMessage } from './relay.js'
import { collectThreads, searchThreads, servicesFor, type ThreadSessionItem, type ThreadToolServices } from './session-state.js'

/** Resolved deployment policy for the thread tools. */
export interface ThreadToolsConfig {
  /** Registered name of the thread listing tool. */
  readonly listToolName: string
  /** Registered name of the cross-session search tool. */
  readonly searchToolName: string
  /** Registered name of the cross-session message tool. */
  readonly sendToolName: string
  /** Default maximum rows returned by one listing call. */
  readonly defaultLimit: number
  /** Hard maximum rows one call may request; bounds the prompt cost of a listing. */
  readonly maxLimit: number
  /** Default maximum hits returned by one search call. */
  readonly defaultSearchLimit: number
  /** Hard maximum hits one search call may request. */
  readonly maxSearchLimit: number
  /** Length bound for one relayed message body. */
  readonly maxMessageChars: number
}

/** Default policy; a deployment overrides these through plugin config. */
export const DEFAULT_THREAD_TOOLS_CONFIG: ThreadToolsConfig = Object.freeze({
  listToolName: 'thread_list',
  searchToolName: 'thread_search',
  sendToolName: 'thread_send',
  defaultLimit: 30,
  maxLimit: 200,
  defaultSearchLimit: 20,
  maxSearchLimit: 100,
  maxMessageChars: 8000,
})

/** One row of the thread listing result. */
interface ThreadListRow {
  sessionId: string
  title: string
  cwd?: string
  createdAt: number
  live: boolean
  current: boolean
}

/** Canonical result of the thread listing tool. */
interface ThreadListValue {
  total: number
  shown: number
  sessions: ThreadListRow[]
}

/** One hit of the cross-session content search. */
interface ThreadSearchRow {
  sessionId: string
  title: string
  seq: number
  excerpt: string
}

/** Canonical result of the cross-session search tool. */
interface ThreadSearchValue {
  available: boolean
  /** Why content search is unavailable, when the deployment disabled it. */
  reason?: string
  hits: ThreadSearchRow[]
}

/** Canonical result of the cross-session message tool. */
interface ThreadSendValue {
  delivery: 'delivered' | 'self' | 'unknown-session' | 'subagent-session' | 'dormant'
  targetSessionId: string
  messageId?: string
}

const THREAD_LIST_SCHEMA = {
  type: 'object' as const,
  additionalProperties: true,
  properties: {
    total: { type: 'integer' as const, required: true as const, description: 'Number of top-level sessions observed.' },
    shown: { type: 'integer' as const, required: true as const, description: 'Number of rows returned after filtering and limits.' },
    sessions: {
      type: 'array' as const,
      required: true as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' as const, required: true as const },
          title: { type: 'string' as const, required: true as const },
          cwd: { type: 'string' as const },
          createdAt: { type: 'integer' as const, required: true as const },
          live: { type: 'boolean' as const, required: true as const },
          current: { type: 'boolean' as const, required: true as const },
        },
      },
    },
  },
}

const THREAD_SEARCH_SCHEMA = {
  type: 'object' as const,
  additionalProperties: true,
  properties: {
    available: { type: 'boolean' as const, required: true as const, description: 'Whether this deployment serves session content search.' },
    reason: { type: 'string' as const, description: 'Why content search is unavailable, when the deployment disabled it.' },
    hits: {
      type: 'array' as const,
      required: true as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' as const, required: true as const },
          title: { type: 'string' as const, required: true as const },
          seq: { type: 'integer' as const, required: true as const },
          excerpt: { type: 'string' as const, required: true as const },
        },
      },
    },
  },
}

const THREAD_SEND_SCHEMA = {
  type: 'object' as const,
  additionalProperties: true,
  properties: {
    delivery: {
      type: 'string' as const,
      required: true as const,
      enum: ['delivered', 'self', 'unknown-session', 'subagent-session', 'dormant'],
    },
    targetSessionId: { type: 'string' as const, required: true as const },
    messageId: { type: 'string' as const },
  },
}

const LIST_PARAMETERS = {
  query: {
    type: 'string' as const,
    description: 'Optional case-insensitive substring matched against session title, session id, and working directory.',
  },
  limit: {
    type: 'integer' as const,
    description: 'Maximum rows to return. Defaults to the deployment default and is capped by its maximum.',
  },
}

const SEARCH_PARAMETERS = {
  query: {
    type: 'string' as const,
    required: true as const,
    description: 'Literal text searched across recorded session content.',
  },
  limit: {
    type: 'integer' as const,
    description: 'Maximum hits to return, capped by the deployment maximum.',
  },
}

const SEND_PARAMETERS = {
  session_id: {
    type: 'string' as const,
    required: true as const,
    description: 'Exact target session id as reported by the thread listing tool.',
  },
  message: {
    type: 'string' as const,
    required: true as const,
    description: 'Message body delivered to the target session.',
  },
}

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

function formatCreatedAt(createdAt: number): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'unknown-time'
  return date.toISOString()
}

function renderThreadList(value: ThreadListValue): string {
  const header = `Sessions (${value.shown} shown of ${value.total}):`
  if (value.sessions.length === 0) {
    return value.total === 0 ? 'No session exists in this deployment.' : `No session matched the filter. ${value.total} session(s) exist.`
  }
  const lines = [header]
  for (const row of value.sessions) {
    const state = [row.live ? 'live' : 'dormant', row.current ? 'current' : undefined]
      .filter((marker): marker is string => marker !== undefined)
      .join(',')
    lines.push(`- id=${row.sessionId} title=${JSON.stringify(row.title)} created=${formatCreatedAt(row.createdAt)} cwd=${row.cwd ?? 'unrecorded'} state=${state}`)
  }
  lines.push('A dormant session holds no live agent in this process, so only a live session accepts a message.')
  return lines.join('\n')
}

function renderSearch(value: ThreadSearchValue): string {
  if (!value.available) {
    return value.reason === undefined
      ? 'Content search is unavailable: this deployment mounts no session content index.'
      : `Content search is unavailable: ${value.reason}`
  }
  if (value.hits.length === 0) return 'No session content matched this query.'
  const lines = [`Session content matches (${value.hits.length}):`]
  for (const hit of value.hits) {
    lines.push(`- id=${hit.sessionId} title=${JSON.stringify(hit.title)} seq=${hit.seq}`)
    if (hit.excerpt.length > 0) lines.push(`  ${hit.excerpt.replaceAll('\n', ' ')}`)
  }
  return lines.join('\n')
}

function renderSend(value: ThreadSendValue): string {
  switch (value.delivery) {
    case 'delivered':
      return `Message delivered to session ${value.targetSessionId} as message ${value.messageId ?? 'unknown'}. The target answers in its own session, not through this tool.`
    case 'self':
      return `Session ${value.targetSessionId} is the session you are running in; nothing was delivered.`
    case 'unknown-session':
      return `No session with id ${value.targetSessionId} exists.`
    case 'subagent-session':
      return `Session ${value.targetSessionId} belongs to a subagent, so it is not addressable as a thread.`
    case 'dormant':
      return `Session ${value.targetSessionId} holds no live agent in this process, so nothing was delivered.`
  }
}

/**
 * Read the reason a deployment refuses content search.
 * @param error - failure thrown by the query engine.
 * @returns the refusal message, or `undefined` when the failure is operational.
 */
function searchUnavailableReason(error: unknown): string | undefined {
  const disabledCode = 'SESSION_QUERY_SEARCH_DISABLED'
  const codeOf = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return undefined
    const holder = value as { readonly code?: unknown; readonly info?: { readonly code?: unknown } }
    return holder.code ?? holder.info?.code
  }
  // The engine may hand back its typed error or a plain carrier object, so both
  // the error itself and its nested cause are inspected for the refusal code.
  const cause = error !== null && typeof error === 'object' ? (error as { readonly cause?: unknown }).cause : undefined
  if (codeOf(error) !== disabledCode && codeOf(cause) !== disabledCode) return undefined
  const message = error instanceof Error ? error.message : undefined
  return message ?? 'the session content index is disabled'
}

function clampLimit(requested: unknown, fallback: number, maximum: number): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return fallback
  return Math.min(Math.max(Math.floor(requested), 1), maximum)
}

function matchesQuery(row: ThreadListRow, query: string): boolean {
  const needle = query.toLowerCase()
  return row.title.toLowerCase().includes(needle)
    || row.sessionId.toLowerCase().includes(needle)
    || (row.cwd?.toLowerCase().includes(needle) ?? false)
}

function toListRow(row: ThreadSessionItem): ThreadListRow {
  const item: ThreadListRow = {
    sessionId: row.sessionId,
    title: row.title,
    createdAt: row.createdAt,
    live: row.live,
    current: row.current,
  }
  return row.cwd === undefined ? item : { ...item, cwd: row.cwd }
}

/** The part of a tool execution these tools read. */
interface ExecutionScope {
  /** Calling Agent, absent for an agentless execution. */
  readonly agent?: {
    /** Agent-scoped context that resolves the session services. */
    readonly ctx: Context
    /** Durable identity of the calling session. */
    readonly id: SessionId
  }
  /** Cooperative cancellation for the call. */
  readonly signal: AbortSignal
}

/**
 * Resolve the session that issued a tool call.
 * @param exec - tool-run identity carrying the calling Agent.
 * @returns the calling session identity, or `undefined` for an agentless call.
 */
function callerSessionId(exec: ExecutionScope): SessionId | undefined {
  return exec.agent?.id
}

/**
 * Build the thread tool definitions for one deployment policy.
 *
 * The definitions register once for the whole plugin and resolve both their
 * caller and their services from each execution's own scope, so every live
 * Agent sees the same catalog while every call runs against its own session.
 * @param config - resolved deployment policy.
 * @returns the model-facing tool definitions.
 */
export function createThreadToolDefinitions(config: ThreadToolsConfig): ToolDefinition[] {
  const requireServices = (exec: ExecutionScope): ThreadToolServices => {
    const services = servicesFor(exec)
    if (services === undefined) {
      throw new Error('This tool needs a calling session whose scope provides session persistence; agentless calls are not supported.')
    }
    return services
  }
  const listTool = defineTool({
    name: config.listToolName,
    description: [
      'List the top-level sessions of this deployment, newest first, including sessions other than the one you are running in.',
      'Each row reports the durable session id, its latest title, its working directory, its creation time, and whether a live agent currently holds it.',
      'Use this tool to find the id of a session you want to search or message. It reads session metadata only and never message bodies.',
      'Subagent-owned sessions are excluded.',
    ].join(' '),
    parameters: LIST_PARAMETERS,
    output: {
      schema: THREAD_LIST_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderThreadList(value) }],
      presentationMeta: (_args, value) => ({ total: value.total, shown: value.shown }),
    },
    async execute(args, exec) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const limit = clampLimit(args.limit, config.defaultLimit, config.maxLimit)
      const services = requireServices(exec)
      const all = await collectThreads(services, callerSessionId(exec), exec.signal)
      const matched = query.length === 0 ? all : all.filter(row => matchesQuery(toListRow(row), query))
      const sessions = matched.slice(0, limit).map(toListRow)
      return { total: all.length, shown: sessions.length, sessions }
    },
  })

  const searchTool = defineTool({
    name: config.searchToolName,
    description: [
      'Search the recorded content of the sessions in this deployment and return the sessions whose history matches a literal query.',
      'Use this tool to find which session discussed a topic before you message it.',
      'The deployment must mount a session content index; without one this tool reports that search is unavailable.',
    ].join(' '),
    parameters: SEARCH_PARAMETERS,
    output: {
      schema: THREAD_SEARCH_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    async execute(args, exec) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (query.length === 0) throw new Error('The search query must not be empty.')
      const limit = clampLimit(args.limit, config.defaultSearchLimit, config.maxSearchLimit)
      const services = requireServices(exec)
      if (services.query === undefined) return { available: false, hits: [] }
      try {
        const hits = await searchThreads(services, query, limit, exec.signal)
        return { available: true, hits: [...hits] }
      } catch (error) {
        // A mounted but disabled search index is a deployment choice, so it is
        // reported as an unavailable capability rather than a tool failure.
        const reason = searchUnavailableReason(error)
        if (reason === undefined) throw error
        return { available: false, reason, hits: [] }
      }
    },
  })

  const sendTool = defineTool({
    name: config.sendToolName,
    description: [
      'Send a message to another session of this deployment by session id.',
      'The message becomes one pending ordinary turn on the target session and is attributed to this plugin, not to the human at that session.',
      'This call reports delivery only; the target answers in its own session and never through this tool.',
      'Only a live session accepts a message, so list the sessions and check the reported state first.',
    ].join(' '),
    parameters: SEND_PARAMETERS,
    output: {
      schema: THREAD_SEND_SCHEMA,
      render: (_args, value: ThreadSendValue) => [{ type: 'text', text: renderSend(value) }],
    },
    async execute(args, exec) {
      const targetId = typeof args.session_id === 'string' ? args.session_id.trim() : ''
      const message = typeof args.message === 'string' ? args.message : ''
      if (targetId.length === 0) throw new Error('The target session id must not be empty.')
      if (message.trim().length === 0) throw new Error('The message must not be empty.')
      if (message.length > config.maxMessageChars) {
        throw new Error(`The message exceeds the deployment limit of ${String(config.maxMessageChars)} characters.`)
      }
      const sender = callerSessionId(exec)
      if (sender === undefined) throw new Error('This tool needs a calling session; agentless calls are not supported.')
      const services = requireServices(exec)
      const outcome = await deliverThreadMessage({
        sessions: services.sessions,
        agents: services.agents,
        senderSessionId: sender,
        targetSessionId: asSessionId(targetId),
        text: message,
        ...(exec.signal === undefined ? {} : { signal: exec.signal }),
      })
      switch (outcome.delivery) {
        case 'delivered':
          return { delivery: 'delivered', targetSessionId: targetId, messageId: outcome.messageId }
        case 'self':
          return { delivery: 'self', targetSessionId: targetId }
        case 'unknown-session':
          return { delivery: 'unknown-session', targetSessionId: targetId }
        case 'subagent-session':
          return { delivery: 'subagent-session', targetSessionId: targetId }
        case 'dormant':
          return { delivery: 'dormant', targetSessionId: targetId }
      }
    },
  })

  return [listTool, searchTool, sendTool]
}
