/**
 * Session creation: a fresh top-level session, or a fork of the completed turns
 * of an existing one.
 *
 * @module @wig123/dsh-thread-tools/session-create
 */
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand';
/**
 * Mint an identity for a new session.
 * @returns a fresh session id in the harness's own shape.
 */
export function newSessionId() {
    return brandString(`session-${crypto.randomUUID()}`);
}
/**
 * Read the live Agent a creation handle exposes.
 *
 * One DSH release line returns an owned handle and another returns the Agent
 * itself, so the handle is unwrapped when present.
 * @param created - value returned by the agent registry's `create`.
 * @returns the new Agent and an optional disposer for its handle.
 */
function unwrapCreated(created) {
    const holder = created;
    if (holder?.agent !== undefined && typeof holder.dispose === 'function') {
        return { agent: holder.agent, dispose: () => holder.dispose() };
    }
    return { agent: created };
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
export async function createThread(request) {
    const meta = request.cwd === undefined && request.agentPreset === undefined
        ? undefined
        : {
            ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
            ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
        };
    const created = unwrapCreated(await request.agents.create({
        sessionId: newSessionId(),
        ...(meta === undefined ? {} : { meta }),
        ...(request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }),
    }));
    if (created.dispose !== undefined)
        await created.dispose();
    return { status: 'created', sessionId: created.agent.id };
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
export function completedTurnPrefix(events, atSeq) {
    let prefix = 0;
    for (const event of events) {
        if (atSeq !== undefined && event.seq >= atSeq)
            break;
        if (event.type === 'turn/end')
            prefix = event.seq + 1;
    }
    return prefix;
}
/**
 * Fork the completed turns of one session into a new top-level session.
 *
 * The new session inherits the source's working directory, agent preset, and
 * lineage, and it starts parked: the harness does not prompt it.
 * @param request - fork request resolved from the calling scope.
 * @returns the outcome of the attempt.
 */
export async function forkThread(request) {
    if (request.sourceSessionId === request.callerSessionId)
        return { status: 'self' };
    const headers = await request.sessions.list();
    const header = (Array.isArray(headers) ? headers : []).find(candidate => candidate.id === request.sourceSessionId);
    if (header === undefined)
        return { status: 'unknown-session' };
    if (header.parentSession !== undefined || (header.delegationDepth ?? 0) > 0)
        return { status: 'subagent-session' };
    const inspection = await request.sessions.load(request.sourceSessionId);
    const prefix = completedTurnPrefix(inspection.events, request.atSeq);
    if (prefix === 0)
        return { status: 'no-completed-turn' };
    const seed = inspection.events.slice(0, prefix);
    const seedChars = JSON.stringify(seed).length;
    if (seedChars > request.maxSeedChars) {
        return {
            status: 'rejected',
            reason: `the inherited prefix is ${String(seedChars)} characters, above the deployment limit of ${String(request.maxSeedChars)}; pass at_seq to fork fewer turns`,
        };
    }
    const atSeq = seed[seed.length - 1]?.seq ?? 0;
    const created = unwrapCreated(await request.agents.create({
        sessionId: newSessionId(),
        meta: {
            ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
            parentSession: header.id,
            isSeeded: true,
        },
        inheritedEventCount: brandNumber(prefix),
        seed,
        ...(request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }),
    }));
    if (created.dispose !== undefined)
        await created.dispose();
    return { status: 'forked', sessionId: created.agent.id, inheritedEvents: prefix, atSeq };
}
