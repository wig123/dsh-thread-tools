/**
 * Reading what another session said back.
 *
 * @module @wig123/dsh-thread-tools/session-reply
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** One reply read from a target session's log. */
export interface ThreadReply {
  /** Text of the target's latest assistant message, truncated to the caller's bound. */
  readonly text: string
  /** Whether the text was cut at the caller's bound. */
  readonly truncated: boolean
  /** Turn the message belongs to. */
  readonly turn: number
  /** Event sequence of the message. */
  readonly seq: number
}

/**
 * Extract the plain text of one assistant message event.
 * @param event - recorded event.
 * @returns the concatenated text blocks, or an empty string for a non-text message.
 */
function assistantText(event: SessionEvent): string {
  const data = event.data as { readonly message?: { readonly content?: readonly unknown[] } } | undefined
  const content = data?.message?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
  }
  return parts.join('\n').trim()
}

/**
 * Read the newest assistant text from a stored session log.
 *
 * A tool-call message carries no text, so the scan walks backwards for the last
 * assistant message that actually said something; a target that has only run
 * tools reports an empty reply rather than the tool call.
 * @param sessions - durable session store.
 * @param sessionId - session whose reply is read.
 * @param maxChars - bound on the returned text.
 * @returns the reply, or `undefined` when the session has no assistant text yet.
 */
export async function readLatestReply(
  sessions: SessionPersistence,
  sessionId: SessionId,
  maxChars: number,
): Promise<ThreadReply | undefined> {
  const inspection = await sessions.inspect(sessionId)
  const events = inspection.events
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'assistant/message') continue
    const text = assistantText(event)
    if (text.length === 0) continue
    const turn = (event.data as { readonly turn?: unknown } | undefined)?.turn
    return {
      text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
      truncated: text.length > maxChars,
      turn: typeof turn === 'number' ? turn : 0,
      seq: event.seq,
    }
  }
  return undefined
}
