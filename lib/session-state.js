/**
 * Service slices and canonical values shared by the thread tools.
 *
 * @module @wig123/dsh-thread-tools/session-state
 */
/**
 * A persisted session is addressable as a thread when nothing created it as a
 * subagent child. Depth-zero sessions without a recorded parent are top-level
 * threads: the ones the Web sidebar lists.
 * @param header - session header observed from persistence.
 * @returns whether the header belongs to a top-level thread.
 */
export function isTopLevelSession(header) {
    return header.parentSession === undefined && (header.delegationDepth ?? 0) === 0;
}
/**
 * Read every stored session header.
 *
 * The persistence service lists either bare headers or per-log snapshots
 * carrying revision tokens, depending on the DSH release line, and the
 * cancellable form takes a signal on one line and an options object on the
 * other. This normalizes both into headers so the tools hold one shape.
 * @param persistence - durable session store.
 * @param signal - cancellation for the backend listing work.
 * @returns one header per stored session.
 */
export async function listSessionHeaders(persistence, signal) {
    const listed = await callPersistedList(persistence, signal);
    if (!Array.isArray(listed))
        return [];
    const headers = [];
    for (const entry of listed) {
        if (entry === null || typeof entry !== 'object')
            continue;
        const candidate = entry;
        if (typeof candidate.id === 'string')
            headers.push(entry);
        else if (candidate.header !== null && typeof candidate.header === 'object')
            headers.push(candidate.header);
    }
    return headers;
}
/**
 * Call the persistence listing with the call shape this release line expects.
 *
 * One DSH line takes the cancellation signal as the only argument and another
 * takes an options object carrying it; a wrong shape fails inside the backend
 * with a guard error rather than at the call site, so the unsupported shape is
 * detected by trying the other one.
 * @param persistence - durable session store.
 * @param signal - cancellation for the backend listing work.
 * @returns whatever the backend returned, normalized by the caller.
 */
async function callPersistedList(persistence, signal) {
    const list = persistence.list;
    const attempts = signal === undefined
        ? [() => list()]
        : [() => list(signal), () => list({ signal })];
    let lastError;
    for (const attempt of attempts) {
        try {
            return await attempt();
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
/**
 * Resolve one session's display title through the query engine, tolerating a
 * deployment that mounts no title source.
 * @param query - query engine, or `undefined` when the deployment mounts none.
 * @param sessionId - session whose title is read.
 * @param signal - cancellation for the underlying fold.
 * @returns the resolved title.
 */
export async function readThreadTitle(query, sessionId, signal) {
    const readTitle = query?.readTitle;
    if (readTitle === undefined)
        return { fromLog: false };
    try {
        const snapshot = signal === undefined ? await readTitle(sessionId) : await readTitle(sessionId, signal);
        const text = snapshot?.title;
        if (typeof text !== 'string' || text.length === 0)
            return { fromLog: false };
        return { text, fromLog: true };
    }
    catch {
        // A missing or unreadable title is a display degradation, not a tool failure.
        return { fromLog: false };
    }
}
/**
 * Read the thread tool services from the scope that issued a call.
 * @param exec - tool-run identity carrying the calling Agent.
 * @returns the service slices for that scope, or `undefined` for an agentless call.
 */
export function servicesFor(exec) {
    const scope = exec.agent?.ctx;
    if (scope === undefined)
        return undefined;
    const mounted = scope.get('sessionQuery');
    const query = mounted === undefined
        ? undefined
        : mounted;
    const sessions = scope.get('sessionPersistence');
    const agents = scope.get('agents');
    if (sessions === undefined || agents === undefined)
        return undefined;
    return query === undefined
        ? { sessions: bindService(sessions), agents: bindService(agents) }
        : { sessions: bindService(sessions), agents: bindService(agents), query };
}
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
export function bindService(service) {
    return new Proxy(service, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
/**
 * Collect every top-level thread, newest first.
 * @param services - session store and live registry.
 * @param currentSessionId - identity of the calling session, when one exists.
 * @param signal - cancellation for the underlying reads.
 * @returns thread rows ordered newest first.
 */
export async function collectThreads(services, currentSessionId, signal) {
    const headers = await listSessionHeaders(services.sessions, signal);
    const rows = [];
    for (const header of headers) {
        if (!isTopLevelSession(header))
            continue;
        const title = await readThreadTitle(services.query, header.id, signal);
        rows.push({
            sessionId: header.id,
            title: title.text ?? header.id,
            createdAt: header.createdAt,
            live: services.agents.get(header.id) !== undefined,
            current: header.id === currentSessionId,
            ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
        });
    }
    rows.sort((left, right) => right.createdAt - left.createdAt);
    return rows;
}
/**
 * Read one session header from the durable store.
 * @param services - session store.
 * @param sessionId - session to resolve.
 * @param signal - cancellation for the underlying read.
 * @returns the header, or `undefined` when the session is unknown.
 */
export async function findHeader(services, sessionId, signal) {
    const headers = await listSessionHeaders(services.sessions, signal);
    return headers.find(candidate => candidate.id === sessionId);
}
/**
 * Run one cross-session full-text search and keep only top-level hits.
 * @param services - query engine backing the search.
 * @param query - literal query text.
 * @param limit - maximum hits to return.
 * @param signal - cancellation for the search.
 * @returns ranked hits.
 */
export async function searchThreads(services, query, limit, signal) {
    const engine = services.query;
    if (engine === undefined)
        return [];
    const page = await engine.searchSessions({ query, limit }, signal === undefined ? undefined : { signal });
    const hits = [];
    for (const record of page.items) {
        if (!isTopLevelSession(record.header))
            continue;
        const title = await readThreadTitle(engine, record.header.id, signal);
        hits.push({
            sessionId: record.header.id,
            title: title.text ?? record.header.id,
            excerpt: record.bestMatch?.snippet ?? '',
            seq: record.bestMatch?.seq ?? 0,
        });
    }
    return hits;
}
