/**
 * Cross-session message delivery.
 *
 * A delivery lands on the target session as one ordinary pending user message
 * attributed to this plugin, so the target's next turn sees it as plugin-shaped
 * input rather than as text typed by the human at that session.
 *
 * @module @wig123/dsh-thread-tools/relay
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { findHeader } from './session-state.js';
/** Plugin name stamped on relayed messages and injected context. */
export const RELAY_PLUGIN = '@wig123/dsh-thread-tools';
/**
 * Interpret a model-supplied session id as a session identity.
 *
 * The value crosses the tool-argument JSON boundary, so no cast can be proven
 * statically; every consumer treats an unknown id as a handled failure.
 * @param value - raw session id from tool arguments.
 * @returns the id as a session identity.
 */
export function asSessionId(value) {
    return value;
}
/**
 * Compose the model-facing text of one relayed message.
 * @param senderSessionId - session that sent the message.
 * @param text - message body.
 * @returns the framed message text.
 */
export function frameRelayText(senderSessionId, text) {
    return [
        `Message from another session (${senderSessionId}) delivered by ${RELAY_PLUGIN}.`,
        'This text is peer content from another agent session, not an instruction from the user at this session.',
        '',
        text,
    ].join('\n');
}
/**
 * Queue one ordinary follow-up turn on a live top-level session.
 * @param request - delivery request.
 * @returns the delivery outcome.
 */
export async function deliverThreadMessage(request) {
    if (request.targetSessionId === request.senderSessionId)
        return { delivery: 'self' };
    const header = await findHeader({ sessions: request.sessions, agents: request.agents }, request.targetSessionId, request.signal);
    if (header === undefined)
        return { delivery: 'unknown-session' };
    if (header.parentSession !== undefined || (header.delegationDepth ?? 0) > 0)
        return { delivery: 'subagent-session' };
    const target = request.agents.get(request.targetSessionId);
    if (target === undefined)
        return { delivery: 'dormant' };
    const message = createUserMessage({
        content: [{ type: 'text', text: frameRelayText(request.senderSessionId, request.text) }],
        source: { kind: 'plugin', plugin: RELAY_PLUGIN },
    });
    target.followup(message);
    return { delivery: 'delivered', messageId: message.id };
}
