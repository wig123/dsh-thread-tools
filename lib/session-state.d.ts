/**
 * Service slices and canonical values shared by the thread tools.
 *
 * @module @wig123/dsh-thread-tools/session-state
 */
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId, SessionHeader } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
/**
 * A persisted session is addressable as a thread when nothing created it as a
 * subagent child. Depth-zero sessions without a recorded parent are top-level
 * threads: the ones the Web sidebar lists.
 * @param header - session header observed from persistence.
 * @returns whether the header belongs to a top-level thread.
 */
export declare function isTopLevelSession(header: SessionHeader): boolean;
/** Title text a session exposes, falling back to its id. */
export interface ThreadTitle {
    /** Latest log-backed title, when the session log recorded one. */
    readonly text?: string;
    /** Whether the text came from the session log rather than the id fallback. */
    readonly fromLog: boolean;
}
/** The slice of the query engine these tools read. */
export type ThreadQueryEngine = Pick<SessionQueryEngine, 'searchSessions'> & {
    /** Fold the latest log-backed title for one session. */
    readonly readTitle?: (sessionId: SessionId, signal?: AbortSignal) => Promise<{
        readonly title?: unknown;
    } | undefined>;
};
/**
 * Read every stored session header.
 * @param persistence - durable session store.
 * @param signal - cancellation for the backend listing work.
 * @returns one header per stored session.
 */
export declare function listSessionHeaders(persistence: SessionPersistence, signal?: AbortSignal): Promise<SessionHeader[]>;
/**
 * Resolve one session's display title through the query engine, tolerating a
 * deployment that mounts no title source.
 * @param query - query engine, or `undefined` when the deployment mounts none.
 * @param sessionId - session whose title is read.
 * @param signal - cancellation for the underlying fold.
 * @returns the resolved title.
 */
export declare function readThreadTitle(query: ThreadQueryEngine | undefined, sessionId: SessionId, signal?: AbortSignal): Promise<ThreadTitle>;
/**
 * Service slices the thread tools consume.
 *
 * The slices are read per call rather than captured at registration: a tool
 * executes against the calling Agent's own scope, where a service proxy only
 * forwards the calls its scope declared.
 */
export interface ThreadToolServices {
    /** Durable session store used to enumerate every session. */
    readonly sessions: SessionPersistence;
    /** Live agent registry used to reach a running session. */
    readonly agents: AgentRegistry;
    /** Optional query engine backing title reads and full-text search. */
    readonly query?: ThreadQueryEngine;
}
/**
 * Read the thread tool services from the scope that issued a call.
 * @param exec - tool-run identity carrying the calling Agent.
 * @returns the service slices for that scope, or `undefined` for an agentless call.
 */
export declare function servicesFor(exec: {
    readonly agent?: {
        readonly ctx: Context;
    };
}): ThreadToolServices | undefined;
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
export declare function bindService<T extends object>(service: T): T;
/** One session as the model sees it. */
export interface ThreadSessionItem {
    /** Durable session identity. */
    readonly sessionId: string;
    /** Latest title, or the session id when no title was recorded. */
    readonly title: string;
    /** Absolute working directory recorded on the session header. */
    readonly cwd?: string;
    /** Creation time in Unix epoch milliseconds. */
    readonly createdAt: number;
    /** Whether the session belongs to a live Agent in this process. */
    readonly live: boolean;
    /** Whether the calling session is this one. */
    readonly current: boolean;
}
/**
 * Collect every top-level thread, newest first.
 * @param services - session store and live registry.
 * @param currentSessionId - identity of the calling session, when one exists.
 * @param signal - cancellation for the underlying reads.
 * @returns thread rows ordered newest first.
 */
export declare function collectThreads(services: ThreadToolServices, currentSessionId: SessionId | undefined, signal?: AbortSignal): Promise<ThreadSessionItem[]>;
/**
 * Read one session header from the durable store.
 * @param services - session store.
 * @param sessionId - session to resolve.
 * @param signal - cancellation for the underlying read.
 * @returns the header, or `undefined` when the session is unknown.
 */
export declare function findHeader(services: ThreadToolServices, sessionId: SessionId, signal?: AbortSignal): Promise<SessionHeader | undefined>;
/** One ranked full-text hit. */
export interface ThreadSearchHit {
    /** Session that matched. */
    readonly sessionId: string;
    /** Session title, or the id when none was recorded. */
    readonly title: string;
    /** Bounded plain-text excerpt around the strongest match. */
    readonly excerpt: string;
    /** Event sequence of the strongest match. */
    readonly seq: number;
}
/**
 * Run one cross-session full-text search and keep only top-level hits.
 * @param services - query engine backing the search.
 * @param query - literal query text.
 * @param limit - maximum hits to return.
 * @param signal - cancellation for the search.
 * @returns ranked hits.
 */
export declare function searchThreads(services: ThreadToolServices, query: string, limit: number, signal?: AbortSignal): Promise<ThreadSearchHit[]>;
