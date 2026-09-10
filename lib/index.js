/**
 * Cross-session thread tools for DeepSeek Harness.
 *
 * The plugin registers model-facing tools that enumerate the deployment's
 * top-level sessions and deliver a message to a live one. It reads durable
 * session state through the session persistence and session query seams and
 * reaches a running session through the agent registry.
 *
 * @module @wig123/dsh-thread-tools
 */
import Schema from '@deepseek-ai/schemastery';
import { DEFAULT_THREAD_TOOLS_CONFIG, createThreadToolDefinitions } from './tools.js';
/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-thread-tools';
/** Services the thread tools read at registration time. */
export const inject = ['tools', 'sessionPersistence', 'agents'];
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- schemastery returns unknown-typed parsed values. */
/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config = Schema.object({
    listToolName: Schema.string().default(DEFAULT_THREAD_TOOLS_CONFIG.listToolName),
    searchToolName: Schema.string().default(DEFAULT_THREAD_TOOLS_CONFIG.searchToolName),
    sendToolName: Schema.string().default(DEFAULT_THREAD_TOOLS_CONFIG.sendToolName),
    createToolName: Schema.string().default(DEFAULT_THREAD_TOOLS_CONFIG.createToolName),
    forkToolName: Schema.string().default(DEFAULT_THREAD_TOOLS_CONFIG.forkToolName),
    defaultLimit: Schema.number().step(1).min(1).max(1000).default(DEFAULT_THREAD_TOOLS_CONFIG.defaultLimit),
    maxLimit: Schema.number().step(1).min(1).max(1000).default(DEFAULT_THREAD_TOOLS_CONFIG.maxLimit),
    defaultSearchLimit: Schema.number().step(1).min(1).max(1000).default(DEFAULT_THREAD_TOOLS_CONFIG.defaultSearchLimit),
    maxSearchLimit: Schema.number().step(1).min(1).max(1000).default(DEFAULT_THREAD_TOOLS_CONFIG.maxSearchLimit),
    maxMessageChars: Schema.number().step(1).min(1).max(1_000_000).default(DEFAULT_THREAD_TOOLS_CONFIG.maxMessageChars),
    maxForkSeedChars: Schema.number().step(1).min(1).max(100_000_000).default(DEFAULT_THREAD_TOOLS_CONFIG.maxForkSeedChars),
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment */
/**
 * Resolve one deployment's effective policy from its committed config.
 * @param config - Loader-resolved plugin config, when the row declares one.
 * @returns the effective policy.
 */
export function resolveThreadToolsConfig(config) {
    return Object.freeze({ ...DEFAULT_THREAD_TOOLS_CONFIG, ...(config ?? {}) });
}
/**
 * Register the thread tools for the deployment.
 *
 * The definitions register once on the plugin fiber and resolve their calling
 * session from each execution, so every live Agent sees the same catalog. The
 * query engine is optional: a deployment without it still gets listing and
 * messaging, and the search tool reports itself unavailable.
 * @param ctx - plugin context carrying tools, session persistence, and agents.
 * @param config - deployment policy; omit to use the defaults.
 */
export function apply(ctx, config) {
    const definitions = createThreadToolDefinitions(resolveThreadToolsConfig(config));
    for (const definition of definitions) {
        ctx.effect(() => ctx.tools.register(definition));
    }
}
