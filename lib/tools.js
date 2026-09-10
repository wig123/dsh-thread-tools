/**
 * The model-facing thread tools.
 *
 * Each tool declares its complete canonical result, renders that value as
 * compact text for the model, and keeps the same fields available to
 * programmatic callers.
 *
 * @module @wig123/dsh-thread-tools/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { asSessionId, deliverThreadMessage } from './relay.js';
import { createThread, forkThread } from './session-create.js';
import { collectThreads, searchThreads, servicesFor } from './session-state.js';
/** Default policy; a deployment overrides these through plugin config. */
export const DEFAULT_THREAD_TOOLS_CONFIG = Object.freeze({
    listToolName: 'thread_list',
    searchToolName: 'thread_search',
    sendToolName: 'thread_send',
    createToolName: 'thread_create',
    forkToolName: 'thread_fork',
    defaultLimit: 30,
    maxLimit: 200,
    defaultSearchLimit: 20,
    maxSearchLimit: 100,
    maxMessageChars: 8000,
    maxForkSeedChars: 2_000_000,
});
const THREAD_LIST_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
        total: { type: 'integer', required: true, description: 'Number of top-level sessions observed.' },
        shown: { type: 'integer', required: true, description: 'Number of rows returned after filtering and limits.' },
        sessions: {
            type: 'array',
            required: true,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sessionId: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    cwd: { type: 'string' },
                    createdAt: { type: 'integer', required: true },
                    live: { type: 'boolean', required: true },
                    current: { type: 'boolean', required: true },
                },
            },
        },
    },
};
const THREAD_SEARCH_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
        available: { type: 'boolean', required: true, description: 'Whether this deployment serves session content search.' },
        reason: { type: 'string', description: 'Why content search is unavailable, when the deployment disabled it.' },
        hits: {
            type: 'array',
            required: true,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sessionId: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    seq: { type: 'integer', required: true },
                    excerpt: { type: 'string', required: true },
                },
            },
        },
    },
};
const THREAD_SEND_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
        delivery: {
            type: 'string',
            required: true,
            enum: ['delivered', 'self', 'unknown-session', 'subagent-session', 'dormant'],
        },
        targetSessionId: { type: 'string', required: true },
        messageId: { type: 'string' },
    },
};
const THREAD_CREATE_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
        status: { type: 'string', required: true, enum: ['created', 'rejected'] },
        sessionId: { type: 'string', description: 'Durable id of the new session, when it was created.' },
        reason: { type: 'string', description: 'Why creation was refused, when it was.' },
    },
};
const THREAD_FORK_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
        status: {
            type: 'string',
            required: true,
            enum: ['forked', 'unknown-session', 'self', 'subagent-session', 'no-completed-turn', 'rejected'],
        },
        sourceSessionId: { type: 'string', required: true },
        sessionId: { type: 'string', description: 'Durable id of the forked session, when the fork succeeded.' },
        inheritedEvents: { type: 'integer', description: 'Number of inherited events in the fork seed.' },
        atSeq: { type: 'integer', description: 'Highest inherited event sequence.' },
        reason: { type: 'string', description: 'Why the fork was refused, when it was.' },
    },
};
const CREATE_PARAMETERS = {
    cwd: {
        type: 'string',
        description: 'Absolute working directory for the new session. Omit to inherit the calling session working directory.',
    },
    agent_preset: {
        type: 'string',
        description: 'Agent preset for the new session. Omit to let the deployment choose.',
    },
};
const FORK_PARAMETERS = {
    session_id: {
        type: 'string',
        required: true,
        description: 'Exact source session id as reported by the thread listing tool.',
    },
    at_seq: {
        type: 'integer',
        description: 'Exclusive event-sequence bound; the fork keeps completed turns before it. Omit to keep every completed turn.',
    },
};
const LIST_PARAMETERS = {
    query: {
        type: 'string',
        description: 'Optional case-insensitive substring matched against session title, session id, and working directory.',
    },
    limit: {
        type: 'integer',
        description: 'Maximum rows to return. Defaults to the deployment default and is capped by its maximum.',
    },
};
const SEARCH_PARAMETERS = {
    query: {
        type: 'string',
        required: true,
        description: 'Literal text searched across recorded session content.',
    },
    limit: {
        type: 'integer',
        description: 'Maximum hits to return, capped by the deployment maximum.',
    },
};
const SEND_PARAMETERS = {
    session_id: {
        type: 'string',
        required: true,
        description: 'Exact target session id as reported by the thread listing tool.',
    },
    message: {
        type: 'string',
        required: true,
        description: 'Message body delivered to the target session.',
    },
};
const TEXT_OUTPUT = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
};
function formatCreatedAt(createdAt) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()))
        return 'unknown-time';
    return date.toISOString();
}
function renderThreadList(value) {
    const header = `Sessions (${value.shown} shown of ${value.total}):`;
    if (value.sessions.length === 0) {
        return value.total === 0 ? 'No session exists in this deployment.' : `No session matched the filter. ${value.total} session(s) exist.`;
    }
    const lines = [header];
    for (const row of value.sessions) {
        const state = [row.live ? 'live' : 'dormant', row.current ? 'current' : undefined]
            .filter((marker) => marker !== undefined)
            .join(',');
        lines.push(`- id=${row.sessionId} title=${JSON.stringify(row.title)} created=${formatCreatedAt(row.createdAt)} cwd=${row.cwd ?? 'unrecorded'} state=${state}`);
    }
    lines.push('A dormant session holds no live agent in this process, so only a live session accepts a message.');
    return lines.join('\n');
}
function renderSearch(value) {
    if (!value.available) {
        return value.reason === undefined
            ? 'Content search is unavailable: this deployment mounts no session content index.'
            : `Content search is unavailable: ${value.reason}`;
    }
    if (value.hits.length === 0)
        return 'No session content matched this query.';
    const lines = [`Session content matches (${value.hits.length}):`];
    for (const hit of value.hits) {
        lines.push(`- id=${hit.sessionId} title=${JSON.stringify(hit.title)} seq=${hit.seq}`);
        if (hit.excerpt.length > 0)
            lines.push(`  ${hit.excerpt.replaceAll('\n', ' ')}`);
    }
    return lines.join('\n');
}
function renderSend(value) {
    switch (value.delivery) {
        case 'delivered':
            return `Message delivered to session ${value.targetSessionId} as message ${value.messageId ?? 'unknown'}. The target answers in its own session, not through this tool.`;
        case 'self':
            return `Session ${value.targetSessionId} is the session you are running in; nothing was delivered.`;
        case 'unknown-session':
            return `No session with id ${value.targetSessionId} exists.`;
        case 'subagent-session':
            return `Session ${value.targetSessionId} belongs to a subagent, so it is not addressable as a thread.`;
        case 'dormant':
            return `Session ${value.targetSessionId} holds no live agent in this process, so nothing was delivered.`;
    }
}
/**
 * Read the reason a deployment refuses content search.
 * @param error - failure thrown by the query engine.
 * @returns the refusal message, or `undefined` when the failure is operational.
 */
function searchUnavailableReason(error) {
    const disabledCode = 'SESSION_QUERY_SEARCH_DISABLED';
    const codeOf = (value) => {
        if (value === null || typeof value !== 'object')
            return undefined;
        const holder = value;
        return holder.code ?? holder.info?.code;
    };
    // The engine may hand back its typed error or a plain carrier object, so both
    // the error itself and its nested cause are inspected for the refusal code.
    const cause = error !== null && typeof error === 'object' ? error.cause : undefined;
    if (codeOf(error) !== disabledCode && codeOf(cause) !== disabledCode)
        return undefined;
    const message = error instanceof Error ? error.message : undefined;
    return message ?? 'the session content index is disabled';
}
function renderCreate(value) {
    switch (value.status) {
        case 'created':
            return `Created session ${value.sessionId}. It starts empty and unprompted; list the sessions to see it.`;
        case 'rejected':
            return `The session was not created: ${value.reason}`;
    }
}
function renderFork(value) {
    switch (value.status) {
        case 'forked':
            return `Forked ${value.sourceSessionId} into session ${value.sessionId}, inheriting ${String(value.inheritedEvents)} events through seq ${String(value.atSeq)}. The new session starts unprompted.`;
        case 'unknown-session':
            return `No session with id ${value.sourceSessionId} exists.`;
        case 'self':
            return 'A session cannot be forked from itself.';
        case 'subagent-session':
            return `Session ${value.sourceSessionId} belongs to a subagent, so it is not addressable as a thread.`;
        case 'no-completed-turn':
            return `Session ${value.sourceSessionId} has no completed turn to fork.`;
        case 'rejected':
            return `The session was not forked: ${value.reason}`;
    }
}
function clampLimit(requested, fallback, maximum) {
    if (typeof requested !== 'number' || !Number.isFinite(requested))
        return fallback;
    return Math.min(Math.max(Math.floor(requested), 1), maximum);
}
function matchesQuery(row, query) {
    const needle = query.toLowerCase();
    return row.title.toLowerCase().includes(needle)
        || row.sessionId.toLowerCase().includes(needle)
        || (row.cwd?.toLowerCase().includes(needle) ?? false);
}
function toListRow(row) {
    const item = {
        sessionId: row.sessionId,
        title: row.title,
        createdAt: row.createdAt,
        live: row.live,
        current: row.current,
    };
    return row.cwd === undefined ? item : { ...item, cwd: row.cwd };
}
/**
 * Resolve the session that issued a tool call.
 * @param exec - tool-run identity carrying the calling Agent.
 * @returns the calling session identity, or `undefined` for an agentless call.
 */
function callerSessionId(exec) {
    return exec.agent?.id;
}
/**
 * Build the thread tool definitions for one deployment policy.
 *
 * The definitions register once for the whole plugin and resolve both their
 * caller and their services from each execution's own scope, so every live
 * Agent sees the same catalog while every call runs against its own session.
 * @param config - resolved deployment policy.
 * @returns the model-facing tool definitions.
 */
export function createThreadToolDefinitions(config) {
    const requireServices = (exec) => {
        const services = servicesFor(exec);
        if (services === undefined) {
            throw new Error('This tool needs a calling session whose scope provides session persistence; agentless calls are not supported.');
        }
        return services;
    };
    const listTool = defineTool({
        name: config.listToolName,
        description: [
            'List the top-level sessions of this deployment, newest first, including sessions other than the one you are running in.',
            'Each row reports the durable session id, its latest title, its working directory, its creation time, and whether a live agent currently holds it.',
            'Use this tool to find the id of a session you want to search or message. It reads session metadata only and never message bodies.',
            'Subagent-owned sessions are excluded.',
        ].join(' '),
        parameters: LIST_PARAMETERS,
        output: {
            schema: THREAD_LIST_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderThreadList(value) }],
            presentationMeta: (_args, value) => ({ total: value.total, shown: value.shown }),
        },
        async execute(args, exec) {
            const query = typeof args.query === 'string' ? args.query.trim() : '';
            const limit = clampLimit(args.limit, config.defaultLimit, config.maxLimit);
            const services = requireServices(exec);
            const all = await collectThreads(services, callerSessionId(exec), exec.signal);
            const matched = query.length === 0 ? all : all.filter(row => matchesQuery(toListRow(row), query));
            const sessions = matched.slice(0, limit).map(toListRow);
            return { total: all.length, shown: sessions.length, sessions };
        },
    });
    const searchTool = defineTool({
        name: config.searchToolName,
        description: [
            'Search the recorded content of the sessions in this deployment and return the sessions whose history matches a literal query.',
            'Use this tool to find which session discussed a topic before you message it.',
            'The deployment must mount a session content index; without one this tool reports that search is unavailable.',
        ].join(' '),
        parameters: SEARCH_PARAMETERS,
        output: {
            schema: THREAD_SEARCH_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
        },
        async execute(args, exec) {
            const query = typeof args.query === 'string' ? args.query.trim() : '';
            if (query.length === 0)
                throw new Error('The search query must not be empty.');
            const limit = clampLimit(args.limit, config.defaultSearchLimit, config.maxSearchLimit);
            const services = requireServices(exec);
            if (services.query === undefined)
                return { available: false, hits: [] };
            try {
                const hits = await searchThreads(services, query, limit, exec.signal);
                return { available: true, hits: [...hits] };
            }
            catch (error) {
                // A mounted but disabled search index is a deployment choice, so it is
                // reported as an unavailable capability rather than a tool failure.
                const reason = searchUnavailableReason(error);
                if (reason === undefined)
                    throw error;
                return { available: false, reason, hits: [] };
            }
        },
    });
    const sendTool = defineTool({
        name: config.sendToolName,
        description: [
            'Send a message to another session of this deployment by session id.',
            'The message becomes one pending ordinary turn on the target session and is attributed to this plugin, not to the human at that session.',
            'This call reports delivery only; the target answers in its own session and never through this tool.',
            'Only a live session accepts a message, so list the sessions and check the reported state first.',
        ].join(' '),
        parameters: SEND_PARAMETERS,
        output: {
            schema: THREAD_SEND_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderSend(value) }],
        },
        async execute(args, exec) {
            const targetId = typeof args.session_id === 'string' ? args.session_id.trim() : '';
            const message = typeof args.message === 'string' ? args.message : '';
            if (targetId.length === 0)
                throw new Error('The target session id must not be empty.');
            if (message.trim().length === 0)
                throw new Error('The message must not be empty.');
            if (message.length > config.maxMessageChars) {
                throw new Error(`The message exceeds the deployment limit of ${String(config.maxMessageChars)} characters.`);
            }
            const sender = callerSessionId(exec);
            if (sender === undefined)
                throw new Error('This tool needs a calling session; agentless calls are not supported.');
            const services = requireServices(exec);
            const outcome = await deliverThreadMessage({
                sessions: services.sessions,
                agents: services.agents,
                senderSessionId: sender,
                targetSessionId: asSessionId(targetId),
                text: message,
                ...(exec.signal === undefined ? {} : { signal: exec.signal }),
            });
            switch (outcome.delivery) {
                case 'delivered':
                    return { delivery: 'delivered', targetSessionId: targetId, messageId: outcome.messageId };
                case 'self':
                    return { delivery: 'self', targetSessionId: targetId };
                case 'unknown-session':
                    return { delivery: 'unknown-session', targetSessionId: targetId };
                case 'subagent-session':
                    return { delivery: 'subagent-session', targetSessionId: targetId };
                case 'dormant':
                    return { delivery: 'dormant', targetSessionId: targetId };
            }
        },
    });
    const createTool = defineTool({
        name: config.createToolName,
        description: [
            'Create one new empty top-level session and return its durable id.',
            'The new session is persisted and idle: it appears in the session list and the UI immediately, and nothing prompts it.',
            'Use the thread listing tool afterwards if you need to see it in context.',
        ].join(' '),
        parameters: CREATE_PARAMETERS,
        output: {
            schema: THREAD_CREATE_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderCreate(value) }],
        },
        async execute(args, exec) {
            const cwd = typeof args.cwd === 'string' && args.cwd.trim().length > 0 ? args.cwd.trim() : undefined;
            const agentPreset = typeof args.agent_preset === 'string' && args.agent_preset.trim().length > 0
                ? args.agent_preset.trim()
                : undefined;
            const services = requireServices(exec);
            const caller = callerSessionId(exec);
            if (caller === undefined)
                throw new Error('This tool needs a calling session; agentless calls are not supported.');
            try {
                const outcome = await createThread({
                    agents: services.agents,
                    sessions: services.sessions,
                    callerSessionId: caller,
                    ...(cwd === undefined ? {} : { cwd }),
                    ...(agentPreset === undefined ? {} : { agentPreset }),
                });
                return outcome.status === 'created'
                    ? { status: 'created', sessionId: outcome.sessionId }
                    : { status: 'rejected', reason: outcome.reason };
            }
            catch (error) {
                return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
            }
        },
    });
    const forkTool = defineTool({
        name: config.forkToolName,
        description: [
            'Fork an existing session into a new one, inheriting its completed turns up to an optional event-sequence bound.',
            'The fork keeps the source working directory and lineage, and starts unprompted.',
            'Only a completed turn can be a fork boundary, so a source with no finished turn cannot be forked.',
        ].join(' '),
        parameters: FORK_PARAMETERS,
        output: {
            schema: THREAD_FORK_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: renderFork(value) }],
        },
        async execute(args, exec) {
            const sourceId = typeof args.session_id === 'string' ? args.session_id.trim() : '';
            if (sourceId.length === 0)
                throw new Error('The source session id must not be empty.');
            const atSeq = typeof args.at_seq === 'number' && Number.isFinite(args.at_seq) ? Math.floor(args.at_seq) : undefined;
            const services = requireServices(exec);
            const caller = callerSessionId(exec);
            if (caller === undefined)
                throw new Error('This tool needs a calling session; agentless calls are not supported.');
            const source = asSessionId(sourceId);
            const outcome = await forkThread({
                agents: services.agents,
                sessions: services.sessions,
                callerSessionId: caller,
                sourceSessionId: source,
                maxSeedChars: config.maxForkSeedChars,
                ...(atSeq === undefined ? {} : { atSeq }),
            });
            switch (outcome.status) {
                case 'forked':
                    return {
                        status: 'forked',
                        sourceSessionId: sourceId,
                        sessionId: outcome.sessionId,
                        inheritedEvents: outcome.inheritedEvents,
                        atSeq: outcome.atSeq,
                    };
                case 'rejected':
                    return { status: 'rejected', sourceSessionId: sourceId, reason: outcome.reason };
                default:
                    return { status: outcome.status, sourceSessionId: sourceId };
            }
        },
    });
    return [listTool, searchTool, sendTool, createTool, forkTool];
}
