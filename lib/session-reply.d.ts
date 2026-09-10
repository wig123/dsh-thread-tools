/**
 * Reading what another session said back.
 *
 * @module @wig123/dsh-thread-tools/session-reply
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
/** One reply read from a target session's log. */
export interface ThreadReply {
    /** Text of the target's latest assistant message, truncated to the caller's bound. */
    readonly text: string;
    /** Whether the text was cut at the caller's bound. */
    readonly truncated: boolean;
    /** Turn the message belongs to. */
    readonly turn: number;
    /** Event sequence of the message. */
    readonly seq: number;
}
/**
 * Read the newest assistant text from a stored session log.
 *
 * A tool-call message carries no text, so the scan walks backwards for the last
 * assistant message that actually said something; a target that has only run
 * tools reports an empty reply rather than the tool call.
 * @param sessions - durable session store.
 * @param sessionId - session whose reply is read.
 * @param maxChars - bound on the returned text.
 * @returns the reply, or `undefined` when the session has no assistant text yet.
 */
export declare function readLatestReply(sessions: SessionPersistence, sessionId: SessionId, maxChars: number): Promise<ThreadReply | undefined>;
