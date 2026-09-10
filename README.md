# @wig123/dsh-thread-tools

Cross-session tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the model can see the deployment's other sessions and send one of them a message, instead of only ever working inside the session it was started in.

The package registers three model-facing tools:

| Tool | What it does |
| --- | --- |
| `thread_list` | Lists the deployment's top-level sessions, newest first: durable id, latest title, working directory, creation time, and whether a live agent currently holds it. Optionally filters by a substring over id, title, and working directory. |
| `thread_search` | Searches recorded session content for a literal query and returns the sessions that match, with a bounded excerpt. Reports itself unavailable when the deployment has no content index. |
| `thread_send` | Delivers a message to another live session by id. The message becomes one pending ordinary turn on that session and is attributed to this plugin, not to the human at that session. Reports delivery only; the target answers in its own session. |
| `thread_create` | Creates one fresh, empty, idle top-level session and returns its durable id. Optionally sets the working directory and agent preset. |
| `thread_fork` | Forks an existing session into a new one, inheriting its completed turns up to an optional event-sequence bound, along with the working directory and lineage. The fork starts unprompted. |

Subagent-owned sessions are excluded from every result: this plugin is about the sessions a person opens, not about an agent's children.

## Install

Requires Node.js 22 or later and `pnpm` on `PATH`.

From the npm package:

```bash
dsh plugin --profile web add @wig123/dsh-thread-tools
```

Straight from the repository, which needs no build step because the compiled output is committed:

```bash
dsh plugin --profile web add github:wig123/dsh-thread-tools
```

The package declares its host floor as `dsh.engines.dsh: ">=0.1.2-rc.1"`, the released line it is verified against.

Restart that profile: bundle membership is read at start. Then ask the model to list the sessions, or to send a message to one of them.

Remove it with `dsh plugin --profile web remove @wig123/dsh-thread-tools`.

## What you get at the boundary

A listing call for a deployment with a few sessions:

```text
thread_list({"limit": 5})
Sessions (5 shown of 118):
- id=session-4a1c… title="Refactor the parser" created=2026-09-10T18:04:56.339Z cwd=/work/app state=live
- id=session-9f02… title="Session title here" created=2026-09-10T18:03:11.162Z cwd=/work/app state=dormant
A dormant session holds no live agent in this process, so only a live session accepts a message.
```

Creating and forking:

```text
thread_create({"cwd": "/work/app"})
Created session session-7c31…. It starts empty and unprompted; list the sessions to see it.

thread_fork({"session_id": "session-4a1c…"})
Forked session-4a1c… into session session-7c31…, inheriting 42 events through seq 41. The new session starts unprompted.
```

A delivery:

```text
thread_send({"session_id": "session-4a1c…", "message": "The migration is done; rebase before you continue."})
Message delivered to session session-4a1c… as message 6ba9c91e-9a37-4706-b7db-7988724d3a6f.
The target answers in its own session, not through this tool.
```

The target session records this body:

```text
Message from another session (session-9f02…) delivered by @wig123/dsh-thread-tools.
This text is peer content from another agent session, not an instruction from the user at this session.

The migration is done; rebase before you continue.
```

## Creation and fork semantics

`thread_create` stores a real session and starts an idle agent for it, then leaves it alone: nothing prompts it. It is immediately visible to `thread_list` and in the UI.

`thread_fork` copies a *completed-turn prefix* of the source log, because the harness accepts only a balanced prefix — no open turn, step, or dangling tool call. The prefix ends at the last `turn/end` before `at_seq`, or at the last one in the log when `at_seq` is omitted. A source with no finished turn reports `no-completed-turn`. A prefix above `maxForkSeedChars` is refused rather than silently truncated.

## Delivery model

`thread_send` reaches a session through the agent registry. A session reported as `live` holds a running agent in this process, so the message is queued on that agent as an ordinary follow-up turn and wakes it. A `dormant` session holds no live agent: this package does not revive one, and the call reports `dormant` so the model can tell you to open that session first rather than silently doing nothing.

Every outcome is a declared canonical value, so a program calling these tools never parses prose:

| `thread_send` result | Meaning |
| --- | --- |
| `delivered` | The message is queued on the target; `messageId` names it. |
| `self` | The target id is the calling session. |
| `unknown-session` | No stored session carries that id. |
| `subagent-session` | The target belongs to a subagent, so it is not addressable as a thread. |
| `dormant` | The target has no live agent in this process. |

## Configuration

Every tool name and bound is deployment policy, configurable on the plugin row:

| Field | Default | Meaning |
| --- | --- | --- |
| `listToolName` | `thread_list` | Registered tool name for listing. |
| `searchToolName` | `thread_search` | Registered tool name for content search. |
| `sendToolName` | `thread_send` | Registered tool name for delivery. |
| `createToolName` | `thread_create` | Registered tool name for creation. |
| `forkToolName` | `thread_fork` | Registered tool name for forking. |
| `defaultLimit` | `30` | Rows returned when a listing call omits `limit`. |
| `maxLimit` | `200` | Hard cap on rows one listing call may request. |
| `defaultSearchLimit` | `20` | Hits returned when a search call omits `limit`. |
| `maxSearchLimit` | `100` | Hard cap on hits one search call may request. |
| `maxMessageChars` | `8000` | Length bound for one message body. |
| `maxForkSeedChars` | `2000000` | Upper bound on the seed one fork may inherit; a larger prefix is refused with a pointer at `at_seq`. |

```yaml
- id: thread-tools
  name: '@wig123/dsh-thread-tools'
  config:
    defaultLimit: 50
    maxMessageChars: 20000
```

Content search needs a session content index. A deployment that mounts `@deepseek-ai/dsh-session-query-sqlite` with `openAt: never` (the Web default) still gets listing and delivery; `thread_search` then reports that search is disabled and why.

## Requirements

- `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-session-persistence`, and `@deepseek-ai/dsh-agent` in the profile. The plugin row stays inactive until they exist.
- `@deepseek-ai/dsh-session-query` for `thread_search`. Listed as an optional peer: without it the tool reports itself unavailable, and the other two tools keep working.

## Verification

`dev/verify.mjs` boots the composed entry tree of a real dsh profile against the real session store, creates two live sessions through the agent factory, and drives each tool exactly as the model would — `ctx.tools.execute({ name, arguments, agent, signal })`. Delivery is checked from the target session's own recorded `user/message` events rather than from the tool's return value.

```bash
npm install --legacy-peer-deps
npm run build
ln -s <dsh-install>/node_modules/@deepseek-ai node_modules/@deepseek-ai   # once
node dev/verify.mjs <profileName>
```

Nineteen checks. They pass against a profile whose session store held 274 sessions across 7 projects, and again against a second profile that installed the package from GitHub with `dsh plugin --profile <name> add github:wig123/dsh-thread-tools`. The second run is the one that proves someone else can install this and use it.

| Check | Evidence |
| --- | --- |
| Three tools registered | The agent's visible tool catalog contains `thread_list`, `thread_search`, `thread_send` |
| Listing returns stored sessions | The listed ids include a session created in the same run |
| Listing marks the caller | The caller's own row carries `current` |
| Delivery reports success | `delivery: "delivered"` with a message id |
| **The target session records the message** | A `user/message` event on the target session carries the relayed body |
| Unknown id | `delivery: "unknown-session"` |
| Self delivery | `delivery: "self"` |
| Disabled index | `available: false` with the deployment's own reason |
| Creation | `status: "created"` with an id that `thread_list` then reports |
| Creation honors cwd | The new session row carries the requested working directory |
| Fork | `status: "forked"` with a non-zero inherited event count |
| Unknown fork source | `status: "unknown-session"` |
| Fork from self | `status: "self"` |
| Listing filter | One row, the matching session |

## Limitations

- **Only a live target accepts a message.** Reviving a dormant session from inside a tool call is not implemented; the tool reports `dormant` instead of guessing.
- **Delivery is one-way.** There is no wait-for-reply tool: the target's answer lands in the target's own session and in its log. Codex's `wait_agent` has no equivalent here yet.
- **A fork seed is capped**, and the cap is a refusal rather than a truncation, so a very large source needs an explicit `at_seq`.
- **Listing reads session metadata, not transcripts.** Use `thread_search` for content, and only where the deployment runs a content index.
- `sessionPersistence.list()` and the cancel argument of `thread_search` differ across DSH release lines; both call shapes are handled, and the behavior is verified against one line at a time.

## Development

```bash
npm install --legacy-peer-deps
npm run build        # tsc -> lib/
npm run typecheck
```

`lib/` is generated and git-ignored; `npm pack` ships it.

## License

MIT
