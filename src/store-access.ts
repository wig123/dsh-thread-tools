/**
 * Store access that spans the DSH release lines this package supports.
 *
 * Durable session storage changed shape between the lines: one addresses a log
 * through the service itself (`list()` plus `load()`/`inspect()`), the other
 * opens a per-session handle (`open(id, access)`) and reads events from it. The
 * tools only need headers and one session's events, so this module resolves
 * whichever shape the running deployment mounts and keeps that difference here.
 *
 * @module @wig123/dsh-thread-tools/store-access
 */

import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** A stored session's header plus its complete validated event log. */
export interface StoredSessionLog {
  /** Current header for the session. */
  readonly header: SessionHeader
  /** Contiguous validated events from seq 0. */
  readonly events: readonly SessionEvent[]
}

/** One session handle, as the handle-based release line exposes it. */
interface StoreHandle {
  /** Read a slice of the stored log. */
  read(offset: number, length: number, options?: { readonly signal?: AbortSignal }): Promise<{ readonly events: readonly SessionEvent[] }>
  /** Release the handle. Idempotent. */
  close(): Promise<void>
}

interface ListCall {
  (options?: unknown): Promise<unknown>
}

interface LoadCall {
  (id: SessionId, second?: unknown): Promise<unknown>
}

interface OpenCall {
  (id: SessionId, access: 'read', options?: { readonly signal?: AbortSignal }): Promise<StoreHandle>
}

/** Read one header out of whatever a listing call returned. */
function headerOf(entry: unknown): SessionHeader | undefined {
  if (entry === null || typeof entry !== 'object') return undefined
  const candidate = entry as { readonly id?: unknown; readonly header?: unknown }
  if (typeof candidate.id === 'string') return entry as SessionHeader
  if (candidate.header !== null && typeof candidate.header === 'object') return candidate.header as SessionHeader
  return undefined
}

/** Whether a value looks like a header rather than a listing snapshot. */
function isHeader(value: unknown): value is SessionHeader {
  return value !== null && typeof value === 'object' && typeof (value as { readonly id?: unknown }).id === 'string'
}

/**
 * List every stored session header.
 * @param service - the deployment's persistence service.
 * @param signal - cancellation for the backend listing work.
 * @returns one header per stored session.
 */
export async function listStoredHeaders(
  service: SessionPersistence,
  signal?: AbortSignal,
): Promise<SessionHeader[]> {
  const list = (service as unknown as { readonly list?: unknown }).list
  if (typeof list !== 'function') return []
  // A service reached through a scope hands back an unbound member; calling it
  // without a receiver drops `this` inside the backend.
  const call = (list as ListCall).bind(service)
  // The cancellable form takes a bare signal on one line and an options object on
  // the other; a wrong shape fails inside the backend, so the other is tried.
  const attempts: readonly (() => Promise<unknown>)[] = signal === undefined
    ? [() => call(), () => call(undefined)]
    : [() => call(signal), () => call({ signal }), () => call()]
  let listed: unknown
  for (const attempt of attempts) {
    try {
      listed = await attempt()
      break
    } catch {
      listed = undefined
    }
  }
  if (!Array.isArray(listed)) return []
  const headers: SessionHeader[] = []
  for (const entry of listed as readonly unknown[]) {
    const header = headerOf(entry)
    if (header !== undefined) headers.push(header)
  }
  return headers
}

/**
 * Read one stored session's complete event log.
 * @param service - the deployment's persistence service.
 * @param sessionId - session to read.
 * @param signal - cancellation for the backend read work.
 * @returns the header and events, or `undefined` when the session is unreadable.
 */
export async function loadStoredSession(
  service: SessionPersistence,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<StoredSessionLog | undefined> {
  const holder = service as unknown as {
    readonly load?: unknown
    readonly inspect?: unknown
    readonly open?: unknown
  }
  const load = typeof holder.load === 'function' ? (holder.load as LoadCall).bind(service) : undefined
  const inspect = typeof holder.inspect === 'function' ? (holder.inspect as LoadCall).bind(service) : undefined
  const open = typeof holder.open === 'function' ? (holder.open as OpenCall).bind(service) : undefined

  // Service-level read, used by the line that keeps log access on the service.
  for (const call of [load, inspect]) {
    if (call === undefined) continue
    try {
      const value = await call(sessionId, signal)
      if (value !== undefined && value !== null && typeof value === 'object') {
        const inspection = value as { readonly events?: unknown; readonly meta?: unknown }
        if (Array.isArray(inspection.events) && isHeader(inspection.meta)) {
          return { header: inspection.meta, events: inspection.events as readonly SessionEvent[] }
        }
      }
    } catch {
      // Fall through to the handle-based line below.
    }
  }

  if (open === undefined) return undefined
  let handle: StoreHandle | undefined
  try {
    handle = await open(sessionId, 'read', signal === undefined ? undefined : { signal })
    const events: SessionEvent[] = []
    while (true) {
      const slice = await handle.read(events.length, 1000, signal === undefined ? undefined : { signal })
      if (slice.events.length === 0) break
      for (const event of slice.events) events.push(event)
    }
    const headers = await listStoredHeaders(service, signal)
    const header = headers.find(candidate => candidate.id === sessionId)
    return header === undefined ? undefined : { header, events }
  } catch {
    return undefined
  } finally {
    try {
      await handle?.close()
    } catch {
      // A handle that cannot close has already lost its channel.
    }
  }
}
