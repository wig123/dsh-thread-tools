/**
 * The model-facing thread tools.
 *
 * Each tool declares its complete canonical result, renders that value as
 * compact text for the model, and keeps the same fields available to
 * programmatic callers.
 *
 * @module @wig123/dsh-thread-tools/tools
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/** Resolved deployment policy for the thread tools. */
export interface ThreadToolsConfig {
    /** Registered name of the thread listing tool. */
    readonly listToolName: string;
    /** Registered name of the cross-session search tool. */
    readonly searchToolName: string;
    /** Registered name of the cross-session message tool. */
    readonly sendToolName: string;
    /** Registered name of the session creation tool. */
    readonly createToolName: string;
    /** Registered name of the session fork tool. */
    readonly forkToolName: string;
    /** Registered name of the reply reading tool. */
    readonly replyToolName: string;
    /** Default maximum rows returned by one listing call. */
    readonly defaultLimit: number;
    /** Hard maximum rows one call may request; bounds the prompt cost of a listing. */
    readonly maxLimit: number;
    /** Default maximum hits returned by one search call. */
    readonly defaultSearchLimit: number;
    /** Hard maximum hits one search call may request. */
    readonly maxSearchLimit: number;
    /** Length bound for one relayed message body. */
    readonly maxMessageChars: number;
    /** Upper bound on the seed a fork may inherit from one source session. */
    readonly maxForkSeedChars: number;
    /** Default wait, in milliseconds, for a target to finish before its reply is read. */
    readonly defaultReplyWaitMs: number;
    /** Hard cap on the wait one reply call may request. */
    readonly maxReplyWaitMs: number;
    /** Bound on the reply text returned to the model. */
    readonly maxReplyChars: number;
}
/** Default policy; a deployment overrides these through plugin config. */
export declare const DEFAULT_THREAD_TOOLS_CONFIG: ThreadToolsConfig;
/**
 * Build the thread tool definitions for one deployment policy.
 *
 * The definitions register once for the whole plugin and resolve both their
 * caller and their services from each execution's own scope, so every live
 * Agent sees the same catalog while every call runs against its own session.
 * @param config - resolved deployment policy.
 * @returns the model-facing tool definitions.
 */
export declare function createThreadToolDefinitions(config: ThreadToolsConfig): ToolDefinition[];
