/**
 * Cross-session message delivery.
 *
 * A delivery lands on the target session as one ordinary pending user message
 * attributed to this plugin, so the target's next turn sees it as plugin-shaped
 * input rather than as text typed by the human at that session.
 *
 * @module @wig123/dsh-thread-tools/relay
 */
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
/** Plugin name stamped on relayed messages and injected context. */
export declare const RELAY_PLUGIN = "@wig123/dsh-thread-tools";
/**
 * Interpret a model-supplied session id as a session identity.
 *
 * The value crosses the tool-argument JSON boundary, so no cast can be proven
 * statically; every consumer treats an unknown id as a handled failure.
 * @param value - raw session id from tool arguments.
 * @returns the id as a session identity.
 */
export declare function asSessionId(value: string): SessionId;
/**
 * Compose the model-facing text of one relayed message.
 * @param senderSessionId - session that sent the message.
 * @param text - message body.
 * @returns the framed message text.
 */
export declare function frameRelayText(senderSessionId: string, text: string): string;
/** Outcome of one delivery attempt. */
export type RelayOutcome = {
    readonly delivery: 'delivered';
    readonly messageId: string;
} | {
    readonly delivery: 'unknown-session';
} | {
    readonly delivery: 'self';
} | {
    readonly delivery: 'subagent-session';
} | {
    readonly delivery: 'dormant';
};
/** Delivery request shared by the send tool. */
export interface RelayRequest {
    /** Durable session store used to resolve the target header. */
    readonly sessions: SessionPersistence;
    /** Live registry used to reach the target Agent. */
    readonly agents: AgentRegistry;
    /** Calling session identity. */
    readonly senderSessionId: SessionId;
    /** Target session identity. */
    readonly targetSessionId: SessionId;
    /** Message body. */
    readonly text: string;
    /** Cancellation for the header read. */
    readonly signal?: AbortSignal;
}
/**
 * Queue one ordinary follow-up turn on a live top-level session.
 * @param request - delivery request.
 * @returns the delivery outcome.
 */
export declare function deliverThreadMessage(request: RelayRequest): Promise<RelayOutcome>;
