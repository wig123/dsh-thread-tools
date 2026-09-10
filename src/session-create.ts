/**
 * Session creation: a fresh top-level session, or a fork of the completed turns
 * of an existing one.
 *
 * @module @wig123/dsh-thread-tools/session-create
 */

import type { Agent, AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { SessionLogOffset } from '@deepseek-ai/dsh-session'

/**
 * Mint an identity for a new session.
 * @returns a fresh session id in the harness's own shape.
 */
export function newSessionId(): SessionId {
  return brandString<SessionId>(`session-${crypto.randomUUID()}`)
}

/** Outcome of one creation attempt. */
export type CreateOutcome =
  | { readonly status: 'created'; readonly sessionId: string }
  | { readonly status: 'rejected'; readonly reason: string }

/** Outcome of one fork attempt. */
export type ForkOutcome =
  | { readonly status: 'forked'; readonly sessionId: string; readonly inheritedEvents: number; readonly atSeq: number }
  | { readonly status: 'unknown-session' }
  | { readonly status: 'self' }
  | { readonly status: 'subagent-session' }
  | { readonly status: 'no-completed-turn' }
  | { readonly status: 'rejected'; readonly reason: string }

/** Creation request shared by both creation tools. */
export interface CreateRequest {
  /** Live agent registry that owns the new Agent. */
  readonly agents: AgentRegistry
  /** Durable session store, used by the fork path. */
  readonly sessions: SessionPersistence
  /** Calling session identity. */
  readonly callerSessionId: SessionId
  /** Working directory for a fresh session; omit to inherit the caller's. */
  readonly cwd?: string
  /** Agent preset for a fresh session; omit to let the deployment choose. */
  readonly agentPreset?: string
  /** Model route the new session starts on; omit to let the deployment choose. */
  readonly agentOptions?: AgentOptions
}

/** Fork request. */
export interface ForkRequest extends CreateRequest {
  /** Session to fork. */
  readonly sourceSessionId: SessionId
  /** Exclusive upper event-seq bound; the fork keeps completed turns before it. */
  readonly atSeq?: number
  /** Upper bound on inherited seed characters, so a fork cannot silently copy an unbounded log. */
  readonly maxSeedChars: number
}

/**
 * Read the live Agent a creation handle exposes.
 *
 * One DSH release line returns an owned handle and another returns the Agent
 * itself, so the handle is unwrapped when present.
 * @param created - value returned by the agent registry's `create`.
 * @returns the new Agent and an optional disposer for its handle.
 */
function unwrapCreated(created: unknown): { agent: Agent; dispose?: () => Promise<void> } {
  const holder = created as { readonly agent?: Agent; readonly dispose?: () => Promise<void> }
  if (holder?.agent !== undefined && typeof holder.dispose === 'function') {
    return { agent: holder.agent, dispose: () => holder.dispose!() }
  }
  return { agent: created as Agent }
}

/**
 * Create one fresh, idle top-level session.
 *
 * The new session starts empty and is not prompted: it appears in the session
 * list and in the UI immediately, and the caller or a person decides what it
 * should work on.
 * @param request - creation request resolved from the calling scope.
 * @returns the outcome of the attempt.
 */
export async function createThread(request: CreateRequest): Promise<CreateOutcome> {
  const meta = request.cwd === undefined && request.agentPreset === undefined
    ? undefined
    : {
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      }
  const created = unwrapCreated(await request.agents.create({
    sessionId: newSessionId(),
    ...(meta === undefined ? {} : { meta }),
    ...(request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }),
  }))
  if (created.dispose !== undefined) await created.dispose()
  return { status: 'created', sessionId: created.agent.id }
}

/**
 * Find the last completed turn boundary of a stored log.
 *
 * A fork seed must be a balanced prefix: it may not contain an open turn, step,
 * or dangling tool call, and the harness accepts only a completed-turn prefix.
 * @param events - validated contiguous event log.
 * @param atSeq - exclusive upper event-seq bound, when the caller supplied one.
 * @returns the event count to inherit, or `0` when no completed turn qualifies.
 */
export function completedTurnPrefix(events: readonly SessionEvent[], atSeq?: number): number {
  let prefix = 0
  for (const event of events) {
    if (atSeq !== undefined && event.seq >= atSeq) break
    if (event.type === 'turn/end') prefix = event.seq + 1
  }
  return prefix
}

/**
 * Fork the completed turns of one session into a new top-level session.
 *
 * The new session inherits the source's working directory, agent preset, and
 * lineage, and it starts parked: the harness does not prompt it.
 * @param request - fork request resolved from the calling scope.
 * @returns the outcome of the attempt.
 */
export async function forkThread(request: ForkRequest): Promise<ForkOutcome> {
  if (request.sourceSessionId === request.callerSessionId) return { status: 'self' }
  const headers = await request.sessions.list()
  const header = (Array.isArray(headers) ? headers : []).find(candidate => candidate.id === request.sourceSessionId) as
    | SessionHeader
    | undefined
  if (header === undefined) return { status: 'unknown-session' }
  if (header.parentSession !== undefined || (header.delegationDepth ?? 0) > 0) return { status: 'subagent-session' }

  const inspection = await request.sessions.inspect(request.sourceSessionId)
  const prefix = completedTurnPrefix(inspection.events, request.atSeq)
  if (prefix === 0) return { status: 'no-completed-turn' }
  const seed = inspection.events.slice(0, prefix)
  const seedChars = JSON.stringify(seed).length
  if (seedChars > request.maxSeedChars) {
    return {
      status: 'rejected',
      reason: `the inherited prefix is ${String(seedChars)} characters, above the deployment limit of ${String(request.maxSeedChars)}; pass at_seq to fork fewer turns`,
    }
  }

  const atSeq = seed[seed.length - 1]?.seq ?? 0
  const created = unwrapCreated(await request.agents.create({
    sessionId: newSessionId(),
    meta: {
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      parentSession: header.id,
      isSeeded: true,
    },
    inheritedEventCount: brandNumber<SessionLogOffset>(prefix),
    seed,
    ...(request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }),
  }))
  if (created.dispose !== undefined) await created.dispose()
  return { status: 'forked', sessionId: created.agent.id, inheritedEvents: prefix, atSeq }
}
