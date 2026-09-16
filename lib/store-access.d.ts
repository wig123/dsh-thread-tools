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
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
/** A stored session's header plus its complete validated event log. */
export interface StoredSessionLog {
    /** Current header for the session. */
    readonly header: SessionHeader;
    /** Contiguous validated events from seq 0. */
    readonly events: readonly SessionEvent[];
}
/**
 * List every stored session header.
 * @param service - the deployment's persistence service.
 * @param signal - cancellation for the backend listing work.
 * @returns one header per stored session.
 */
export declare function listStoredHeaders(service: SessionPersistence, signal?: AbortSignal): Promise<SessionHeader[]>;
/**
 * Read one stored session's complete event log.
 * @param service - the deployment's persistence service.
 * @param sessionId - session to read.
 * @param signal - cancellation for the backend read work.
 * @returns the header and events, or `undefined` when the session is unreadable.
 */
export declare function loadStoredSession(service: SessionPersistence, sessionId: SessionId, signal?: AbortSignal): Promise<StoredSessionLog | undefined>;
