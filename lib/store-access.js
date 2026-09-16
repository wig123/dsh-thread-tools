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
/** Read one header out of whatever a listing call returned. */
function headerOf(entry) {
    if (entry === null || typeof entry !== 'object')
        return undefined;
    const candidate = entry;
    if (typeof candidate.id === 'string')
        return entry;
    if (candidate.header !== null && typeof candidate.header === 'object')
        return candidate.header;
    return undefined;
}
/** Whether a value looks like a header rather than a listing snapshot. */
function isHeader(value) {
    return value !== null && typeof value === 'object' && typeof value.id === 'string';
}
/**
 * List every stored session header.
 * @param service - the deployment's persistence service.
 * @param signal - cancellation for the backend listing work.
 * @returns one header per stored session.
 */
export async function listStoredHeaders(service, signal) {
    const list = service.list;
    if (typeof list !== 'function')
        return [];
    // A service reached through a scope hands back an unbound member; calling it
    // without a receiver drops `this` inside the backend.
    const call = list.bind(service);
    // The cancellable form takes a bare signal on one line and an options object on
    // the other; a wrong shape fails inside the backend, so the other is tried.
    const attempts = signal === undefined
        ? [() => call(), () => call(undefined)]
        : [() => call(signal), () => call({ signal }), () => call()];
    let listed;
    for (const attempt of attempts) {
        try {
            listed = await attempt();
            break;
        }
        catch {
            listed = undefined;
        }
    }
    if (!Array.isArray(listed))
        return [];
    const headers = [];
    for (const entry of listed) {
        const header = headerOf(entry);
        if (header !== undefined)
            headers.push(header);
    }
    return headers;
}
/**
 * Read one stored session's complete event log.
 * @param service - the deployment's persistence service.
 * @param sessionId - session to read.
 * @param signal - cancellation for the backend read work.
 * @returns the header and events, or `undefined` when the session is unreadable.
 */
export async function loadStoredSession(service, sessionId, signal) {
    const holder = service;
    const load = typeof holder.load === 'function' ? holder.load.bind(service) : undefined;
    const inspect = typeof holder.inspect === 'function' ? holder.inspect.bind(service) : undefined;
    const open = typeof holder.open === 'function' ? holder.open.bind(service) : undefined;
    // Service-level read, used by the line that keeps log access on the service.
    for (const call of [load, inspect]) {
        if (call === undefined)
            continue;
        try {
            const value = await call(sessionId, signal);
            if (value !== undefined && value !== null && typeof value === 'object') {
                const inspection = value;
                if (Array.isArray(inspection.events) && isHeader(inspection.meta)) {
                    return { header: inspection.meta, events: inspection.events };
                }
            }
        }
        catch {
            // Fall through to the handle-based line below.
        }
    }
    if (open === undefined)
        return undefined;
    let handle;
    try {
        handle = await open(sessionId, 'read', signal === undefined ? undefined : { signal });
        const events = [];
        while (true) {
            const slice = await handle.read(events.length, 1000, signal === undefined ? undefined : { signal });
            if (slice.events.length === 0)
                break;
            for (const event of slice.events)
                events.push(event);
        }
        const headers = await listStoredHeaders(service, signal);
        const header = headers.find(candidate => candidate.id === sessionId);
        return header === undefined ? undefined : { header, events };
    }
    catch {
        return undefined;
    }
    finally {
        try {
            await handle?.close();
        }
        catch {
            // A handle that cannot close has already lost its channel.
        }
    }
}
