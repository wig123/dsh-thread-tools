/**
 * A scripted LLM adapter for keyless end-to-end runs.
 *
 * It answers a session's model requests with a fixed script instead of calling a
 * provider, so a real agent loop, real tool dispatch, and a real session log can
 * be exercised without an API key. The script decides what to call from the
 * conversation it receives, so the tool arguments can depend on the result of an
 * earlier call.
 */

import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

/** Provider route the scripted adapter owns. */
export const STUB_PROVIDER = 'verify-stub'

/** Model id the scripted adapter answers. */
export const STUB_MODEL = 'verify-model'

/** Provider route owned by the target-session adapter. */
export const TARGET_PROVIDER = 'verify-target-stub'

/** Model id the target-session adapter answers. */
export const TARGET_MODEL = 'verify-target-model'

/**
 * Answer every conversation with one fixed reply.
 *
 * A relayed message starts a turn on the target session, and that session draws
 * from the same adapter registry as its sender, so it needs its own adapter:
 * sharing one would interleave the two sessions' request counters.
 * @param text - the reply text every target turn produces.
 * @param seen - records that the target answered.
 * @returns an adapter that always answers with `text`.
 */
export function scriptedTargetAdapter(text, seen) {
  return new (class extends LlmAdapter {
    async * stream(options) {
      if (options?.purpose !== undefined) {
        yield * textScript('Scripted session')
        return
      }
      seen.push('target-reply')
      yield * textScript(text)
    }
  })()
}

/** Build the chunks that ask the loop to run one tool. */
function toolCallScript(name, args, id) {
  const callId = ToolCallId(id)
  const payload = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: payload },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: payload } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Build the chunks that end a turn with assistant text. */
function textScript(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Run a script that drives the thread tools end to end.
 *
 * The first request lists sessions filtered to one known id, the second sends a
 * message to that id, and the third ends the turn. The ids are the harness's, so
 * the script needs no parsing: what it proves is that a model request reaches
 * these tools and that the message lands on the target's own log.
 * @param targetSessionId - session the script lists and then messages.
 * @param seen - filled with every step the script requested, in order.
 * @returns an adapter that answers model requests with that script.
 */
export function scriptedThreadAdapter(targetSessionId, seen) {
  let request = 0
  return new (class extends LlmAdapter {
    async * stream(options) {
      // Auxiliary calls (a session title) share this adapter; only conversation
      // requests advance the script, or the first tool call would be skipped.
      if (options?.purpose !== undefined) {
        yield * textScript('Scripted session')
        return
      }
      const conversation = JSON.stringify(options?.messages ?? [])
      // The target is the adapter instance whose session is not the driver's;
      // it answers the relayed message so a reply exists to read back.
      if (conversation.includes('delivered by @wig123/dsh-thread-tools')) {
        seen.push('target-reply')
        yield * textScript('Acknowledged from the scripted target.')
        return
      }
      request += 1
      if (request === 1) {
        seen.push('thread_list')
        yield * toolCallScript('thread_list', { query: targetSessionId, limit: 5 }, 'verify-call-1')
        return
      }
      if (request === 2) {
        seen.push('thread_send')
        yield * toolCallScript(
          'thread_send',
          { session_id: targetSessionId, message: 'hello from the scripted model' },
          'verify-call-2',
        )
        return
      }
      if (request === 3) {
        seen.push('thread_reply')
        yield * toolCallScript('thread_reply', { session_id: targetSessionId, wait_ms: 10000 }, 'verify-call-3')
        return
      }
      seen.push('final')
      yield * textScript('The thread tools ran.')
    }
  })()
}
