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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type ThreadToolsConfig } from './tools.js';
/** Cordis plugin name used by Loader diagnostics. */
export declare const name = "dsh-thread-tools";
/** Services the thread tools read at registration time. */
export declare const inject: string[];
/** Schemastery config for Loader defaults and generated configuration docs. */
export declare const Config: Schema<Schemastery.ObjectS<{
    listToolName: Schema<string, string>;
    searchToolName: Schema<string, string>;
    sendToolName: Schema<string, string>;
    createToolName: Schema<string, string>;
    forkToolName: Schema<string, string>;
    replyToolName: Schema<string, string>;
    defaultLimit: Schema<number, number>;
    maxLimit: Schema<number, number>;
    defaultSearchLimit: Schema<number, number>;
    maxSearchLimit: Schema<number, number>;
    maxMessageChars: Schema<number, number>;
    maxForkSeedChars: Schema<number, number>;
    defaultReplyWaitMs: Schema<number, number>;
    maxReplyWaitMs: Schema<number, number>;
    maxReplyChars: Schema<number, number>;
}>, Schemastery.ObjectT<{
    listToolName: Schema<string, string>;
    searchToolName: Schema<string, string>;
    sendToolName: Schema<string, string>;
    createToolName: Schema<string, string>;
    forkToolName: Schema<string, string>;
    replyToolName: Schema<string, string>;
    defaultLimit: Schema<number, number>;
    maxLimit: Schema<number, number>;
    defaultSearchLimit: Schema<number, number>;
    maxSearchLimit: Schema<number, number>;
    maxMessageChars: Schema<number, number>;
    maxForkSeedChars: Schema<number, number>;
    defaultReplyWaitMs: Schema<number, number>;
    maxReplyWaitMs: Schema<number, number>;
    maxReplyChars: Schema<number, number>;
}>>;
/**
 * Resolve one deployment's effective policy from its committed config.
 * @param config - Loader-resolved plugin config, when the row declares one.
 * @returns the effective policy.
 */
export declare function resolveThreadToolsConfig(config?: Partial<ThreadToolsConfig>): ThreadToolsConfig;
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
export declare function apply(ctx: Context, config?: Partial<ThreadToolsConfig>): void;
