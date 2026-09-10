/**
 * Service slices and canonical values shared by the thread tools.
 *
 * @module @wig123/dsh-thread-tools/session-state
 */

import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionQueryEngine, SessionRecord } from '@deepseek-ai/dsh-session-query'

/**
 * A persisted session is addressable as a thread when nothing created it as a
 * subagent child. Depth-zero sessions without a recorded parent are top-level
 * threads: the ones the Web sidebar lists.
 * @param header - session header observed from persistence.
 * @returns whether the header belongs to a top-level thread.
 */
export function isTopLevelSession(header: SessionHeader): boolean {
  return header.parentSession === undefined && (header.delegationDepth ?? 0) === 0
}

/** Title text a session exposes, falling back to its id. */
export interface ThreadTitle {
  /** Latest log-backed title, when the session log recorded one. */
  readonly text?: string
  /** Whether the text came from the session log rather than the id fallback. */
  readonly fromLog: boolean
}

/** The slice of the query engine these tools read. */
export type ThreadQueryEngine = Pick<SessionQueryEngine, 'searchSessions'> & {
  /** Fold the latest log-backed title for one session. */
  readonly readTitle?: (sessionId: SessionId, signal?: AbortSignal) => Promise<{ readonly title?: unknown } | undefined>
}

/**
 * Read every stored session header.
 *
 * The persistence service lists either bare headers or per-log snapshots
 * carrying revision tokens, depending on the DSH release line, and the
 * cancellable form takes a signal on one line and an options object on the
 * other. This normalizes both into headers so the tools hold one shape.
 * @param persistence - durable session store.
 * @param signal - cancellation for the backend listing work.
 * @returns one header per stored session.
 */
export async function listSessionHeaders(
  persistence: SessionPersistence,
  signal?: AbortSignal,
): Promise<SessionHeader[]> {
  const listed = await callPersistedList(persistence, signal)
  if (!Array.isArray(listed)) return []
  const headers: SessionHeader[] = []
  for (const entry of listed as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object') continue
    const candidate = entry as { readonly id?: unknown; readonly header?: unknown }
    if (typeof candidate.id === 'string') headers.push(entry as SessionHeader)
    else if (candidate.header !== null && typeof candidate.header === 'object') headers.push(candidate.header as SessionHeader)
  }
  return headers
}

/**
 * Call the persistence listing with the call shape this release line expects.
 *
 * One DSH line takes the cancellation signal as the only argument and another
 * takes an options object carrying it; a wrong shape fails inside the backend
 * with a guard error rather than at the call site, so the unsupported shape is
 * detected by trying the other one.
 * @param persistence - durable session store.
 * @param signal - cancellation for the backend listing work.
 * @returns whatever the backend returned, normalized by the caller.
 */
async function callPersistedList(persistence: SessionPersistence, signal?: AbortSignal): Promise<unknown> {
  const list = persistence.list as unknown as (options?: unknown) => Promise<unknown>
  const attempts: readonly (() => Promise<unknown>)[] = signal === undefined
    ? [() => list()]
    : [() => list(signal), () => list({ signal })]
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/**
 * Resolve one session's display title through the query engine, tolerating a
 * deployment that mounts no title source.
 * @param query - query engine, or `undefined` when the deployment mounts none.
 * @param sessionId - session whose title is read.
 * @param signal - cancellation for the underlying fold.
 * @returns the resolved title.
 */
export async function readThreadTitle(
  query: ThreadQueryEngine | undefined,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<ThreadTitle> {
  const readTitle = query?.readTitle
  if (readTitle === undefined) return { fromLog: false }
  try {
    const snapshot = signal === undefined ? await readTitle(sessionId) : await readTitle(sessionId, signal)
    const text = snapshot?.title
    if (typeof text !== 'string' || text.length === 0) return { fromLog: false }
    return { text, fromLog: true }
  } catch {
    // A missing or unreadable title is a display degradation, not a tool failure.
    return { fromLog: false }
  }
}

/**
 * Service slices the thread tools consume.
 *
 * The slices are read per call rather than captured at registration: a tool
 * executes against the calling Agent's own scope, where a service proxy only
 * forwards the calls its scope declared.
 */
export interface ThreadToolServices {
  /** Durable session store used to enumerate every session. */
  readonly sessions: SessionPersistence
  /** Live agent registry used to reach a running session. */
  readonly agents: AgentRegistry
  /** Optional query engine backing title reads and full-text search. */
  readonly query?: ThreadQueryEngine
}

/**
 * Read the thread tool services from the scope that issued a call.
 * @param exec - tool-run identity carrying the calling Agent.
 * @returns the service slices for that scope, or `undefined` for an agentless call.
 */
export function servicesFor(exec: { readonly agent?: { readonly ctx: Context } }): ThreadToolServices | undefined {
  const scope = exec.agent?.ctx
  if (scope === undefined) return undefined
  const mounted = scope.get('sessionQuery')
  const query: ThreadQueryEngine | undefined = mounted === undefined
    ? undefined
    : (mounted as unknown as ThreadQueryEngine)
  const sessions = scope.get('sessionPersistence')
  const agents = scope.get('agents')
  if (sessions === undefined || agents === undefined) return undefined
  return query === undefined
    ? { sessions: bindService(sessions), agents: bindService(agents) }
    : { sessions: bindService(sessions), agents: bindService(agents), query }
}

/**
 * Bind a service's methods to its own instance.
 *
 * A service resolved from a scope reaches a tool through the scope's lookup, so
 * an unbound method can run with the receiver dropped. Handing back a proxy that
 * binds every function member keeps one identity per resolution and lets the
 * tools call any declared method without enumerating it here.
 * @param service - service instance resolved from the calling scope.
 * @returns the same service with its methods bound to it.
 */
export function bindService<T extends object>(service: T): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

/** One session as the model sees it. */
export interface ThreadSessionItem {
  /** Durable session identity. */
  readonly sessionId: string
  /** Latest title, or the session id when no title was recorded. */
  readonly title: string
  /** Absolute working directory recorded on the session header. */
  readonly cwd?: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Whether the session belongs to a live Agent in this process. */
  readonly live: boolean
  /** Whether the calling session is this one. */
  readonly current: boolean
}

/**
 * Collect every top-level thread, newest first.
 * @param services - session store and live registry.
 * @param currentSessionId - identity of the calling session, when one exists.
 * @param signal - cancellation for the underlying reads.
 * @returns thread rows ordered newest first.
 */
export async function collectThreads(
  services: ThreadToolServices,
  currentSessionId: SessionId | undefined,
  signal?: AbortSignal,
): Promise<ThreadSessionItem[]> {
  const headers = await listSessionHeaders(services.sessions, signal)
  const rows: ThreadSessionItem[] = []
  for (const header of headers) {
    if (!isTopLevelSession(header)) continue
    const title = await readThreadTitle(services.query, header.id, signal)
    rows.push({
      sessionId: header.id,
      title: title.text ?? header.id,
      createdAt: header.createdAt,
      live: services.agents.get(header.id) !== undefined,
      current: header.id === currentSessionId,
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    })
  }
  rows.sort((left, right) => right.createdAt - left.createdAt)
  return rows
}

/**
 * Read one session header from the durable store.
 * @param services - session store.
 * @param sessionId - session to resolve.
 * @param signal - cancellation for the underlying read.
 * @returns the header, or `undefined` when the session is unknown.
 */
export async function findHeader(
  services: ThreadToolServices,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<SessionHeader | undefined> {
  const headers = await listSessionHeaders(services.sessions, signal)
  return headers.find(candidate => candidate.id === sessionId)
}

/** One ranked full-text hit. */
export interface ThreadSearchHit {
  /** Session that matched. */
  readonly sessionId: string
  /** Session title, or the id when none was recorded. */
  readonly title: string
  /** Bounded plain-text excerpt around the strongest match. */
  readonly excerpt: string
  /** Event sequence of the strongest match. */
  readonly seq: number
}

/**
 * Run one cross-session full-text search and keep only top-level hits.
 * @param services - query engine backing the search.
 * @param query - literal query text.
 * @param limit - maximum hits to return.
 * @param signal - cancellation for the search.
 * @returns ranked hits.
 */
export async function searchThreads(
  services: ThreadToolServices,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<ThreadSearchHit[]> {
  const engine = services.query
  if (engine === undefined) return []
  const page = await engine.searchSessions({ query, limit }, signal === undefined ? undefined : { signal })
  const hits: ThreadSearchHit[] = []
  for (const record of page.items as readonly (SessionRecord & {
    readonly bestMatch?: { readonly snippet?: string; readonly seq?: number }
  })[]) {
    if (!isTopLevelSession(record.header)) continue
    const title = await readThreadTitle(engine, record.header.id, signal)
    hits.push({
      sessionId: record.header.id,
      title: title.text ?? record.header.id,
      excerpt: record.bestMatch?.snippet ?? '',
      seq: record.bestMatch?.seq ?? 0,
    })
  }
  return hits
}

