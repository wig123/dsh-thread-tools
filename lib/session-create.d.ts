/**
 * Session creation: a fresh top-level session, or a fork of the completed turns
 * of an existing one.
 *
 * @module @wig123/dsh-thread-tools/session-create
 */
import type { AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
/**
 * Mint an identity for a new session.
 * @returns a fresh session id in the harness's own shape.
 */
export declare function newSessionId(): SessionId;
/** Outcome of one creation attempt. */
/** One created Agent plus the handle the registry returned for it. */
export interface CreatedThread {
    /** Durable identity of the new session. */
    readonly sessionId: string;
    /** Disposer for the registry handle, when the registry returned one. */
    readonly dispose?: () => Promise<void>;
}
export type CreateOutcome = {
    readonly status: 'created';
    readonly sessionId: string;
    readonly handle: CreatedThread;
} | {
    readonly status: 'rejected';
    readonly reason: string;
};
/** Outcome of one fork attempt. */
export type ForkOutcome = {
    readonly status: 'forked';
    readonly sessionId: string;
    readonly inheritedEvents: number;
    readonly atSeq: number;
    readonly handle: CreatedThread;
} | {
    readonly status: 'unknown-session';
} | {
    readonly status: 'self';
} | {
    readonly status: 'subagent-session';
} | {
    readonly status: 'no-completed-turn';
} | {
    readonly status: 'rejected';
    readonly reason: string;
};
/** Creation request shared by both creation tools. */
export interface CreateRequest {
    /** Live agent registry that owns the new Agent. */
    readonly agents: AgentRegistry;
    /** Durable session store, used by the fork path. */
    readonly sessions: SessionPersistence;
    /** Calling session identity. */
    readonly callerSessionId: SessionId;
    /** Working directory for a fresh session; omit to inherit the caller's. */
    readonly cwd?: string;
    /** Agent preset for a fresh session; omit to let the deployment choose. */
    readonly agentPreset?: string;
    /** Model route the new session starts on; omit to let the deployment choose. */
    readonly agentOptions?: AgentOptions;
}
/** Fork request. */
export interface ForkRequest extends CreateRequest {
    /** Session to fork. */
    readonly sourceSessionId: SessionId;
    /** Exclusive upper event-seq bound; the fork keeps completed turns before it. */
    readonly atSeq?: number;
    /** Upper bound on inherited seed characters, so a fork cannot silently copy an unbounded log. */
    readonly maxSeedChars: number;
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
export declare function createThread(request: CreateRequest): Promise<CreateOutcome>;
/**
 * Find the last completed turn boundary of a stored log.
 *
 * A fork seed must be a balanced prefix: it may not contain an open turn, step,
 * or dangling tool call, and the harness accepts only a completed-turn prefix.
 * @param events - validated contiguous event log.
 * @param atSeq - exclusive upper event-seq bound, when the caller supplied one.
 * @returns the event count to inherit, or `0` when no completed turn qualifies.
 */
export declare function completedTurnPrefix(events: readonly SessionEvent[], atSeq?: number): number;
/**
 * Fork the completed turns of one session into a new top-level session.
 *
 * The new session inherits the source's working directory, agent preset, and
 * lineage, and it starts parked: the harness does not prompt it.
 * @param request - fork request resolved from the calling scope.
 * @returns the outcome of the attempt.
 */
export declare function forkThread(request: ForkRequest): Promise<ForkOutcome>;
