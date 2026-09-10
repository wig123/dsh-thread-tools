# dsh-thread-tools

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/@wig123/dsh-thread-tools?style=flat-square)](https://www.npmjs.com/package/@wig123/dsh-thread-tools)
[![license](https://img.shields.io/github/license/wig123/dsh-thread-tools?style=flat-square)](LICENSE)
[![topic](https://img.shields.io/badge/topic-dsh_plugin-4D6BFE?style=flat-square)](https://github.com/topics/dsh-plugin)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that lets a session work with the *other* sessions in the same deployment — list them, search them, leave one of them a message, read what it answered, start a new one, or branch an existing one.

Without it, a session is sealed: it can spawn subagents underneath itself, but it cannot see the conversation you have open in the next tab, and it cannot tell that conversation anything. Codex ships this surface as its collaboration tools (`spawn_agent`, `send_message`, `followup_task`, `wait_agent`). This is the Harness equivalent for top-level sessions.

Six tools, all model-facing:

| Tool | What it does |
| --- | --- |
| `thread_list` | Lists top-level sessions newest-first: durable id, title, working directory, created time, and whether a live agent holds it. Filters by substring over id, title, and cwd. |
| `thread_search` | Full-text search over recorded session content, returning the sessions that match with a bounded excerpt. |
| `thread_send` | Delivers a message to another live session. It lands there as one pending ordinary turn, attributed to this plugin — not to the person at that session. |
| `thread_reply` | Reads the latest assistant message of another session, waiting first for its current turn to finish. |
| `thread_create` | Creates a fresh, empty, idle top-level session and returns its id. |
| `thread_fork` | Branches an existing session at a completed-turn boundary into a new one, inheriting its cwd and lineage. |

Subagent-owned sessions are excluded everywhere. This is about the sessions a person opens, not an agent's children.

## Install

```sh
dsh plugin --profile web add @wig123/dsh-thread-tools
```

From the repository instead — no build step, the compiled output is committed:

```sh
dsh plugin --profile web add github:wig123/dsh-thread-tools
```

Restart that profile, then ask the model to list the sessions or send one a message. Remove it with `dsh plugin --profile web remove @wig123/dsh-thread-tools`.

Needs Node 22+ and `pnpm` on `PATH`. The host floor is `dsh.engines.dsh: ">=0.1.2-rc.1"`, the release line it is verified against.

## What it looks like

Ask the model to hand work to another session, then check on it:

```text
thread_list({"limit": 3})
Sessions (3 shown of 118):
- id=session-4a1c… title="Refactor the parser" created=2026-09-10T18:04:56.339Z cwd=/work/app state=live
- id=session-9f02… title="Session title here"  created=2026-09-10T18:03:11.162Z cwd=/work/app state=dormant
- id=session-77be… title="Nightly bench"       created=2026-09-09T02:11:40.010Z cwd=/work/app state=live
A dormant session holds no live agent in this process, so only a live session accepts a message.

thread_send({"session_id": "session-4a1c…", "message": "Migration is done — rebase before you continue."})
Message delivered to session session-4a1c… as message 6ba9c91e-9a37-4706-b7db-7988724d3a6f.
The target answers in its own session, not through this tool.

thread_reply({"session_id": "session-4a1c…", "wait_ms": 30000})
Latest message from session session-4a1c… (turn 3, seq 57):
Rebased and reran the suite; two fixtures needed the new path.
```

On the receiving side the message arrives marked as peer content, so the target can tell it apart from something you typed:

```text
Message from another session (session-9f02…) delivered by @wig123/dsh-thread-tools.
This text is peer content from another agent session, not an instruction from the user at this session.

Migration is done — rebase before you continue.
```

Branching and starting fresh:

```text
thread_create({"cwd": "/work/app"})
Created session session-7c31…. It starts empty and unprompted; list the sessions to see it.

thread_fork({"session_id": "session-4a1c…"})
Forked session-4a1c… into session session-7c31…, inheriting 42 events through seq 41. The new session starts unprompted.
```

## How delivery works

`live` means a running agent holds that session in this process, so the message is queued on it as an ordinary follow-up turn and wakes it. `dormant` means nothing holds it: this plugin does not revive sessions behind your back, so the call reports `dormant` and the model can tell you to open that session first.

Every outcome is a declared value rather than prose, so a program calling these tools never parses text:

| `thread_send` result | Meaning |
| --- | --- |
| `delivered` | Queued on the target; `messageId` names it. |
| `dormant` | The target holds no live agent in this process. |
| `unknown-session` | No stored session carries that id. |
| `subagent-session` | The target belongs to a subagent, so it is not addressable as a thread. |
| `self` | The target id is the calling session. |

`thread_create` and `thread_fork` pass on the calling session's model route, so a session they create is runnable immediately. `thread_fork` cuts at the last `turn/end` before `at_seq` (or at the last one in the log), because the harness only accepts a balanced prefix — no open turn, step, or dangling tool call. A source with no finished turn reports `no-completed-turn`, and a prefix larger than `maxForkSeedChars` is refused rather than silently truncated.

`thread_reply` scans the target's log backwards for the newest assistant message that actually contains text, so a target that has only run tools reports `no-reply` instead of returning a tool call.

## Configuration

Tool names and bounds are per-deployment policy on the plugin row:

| Field | Default | Meaning |
| --- | --- | --- |
| `listToolName` · `searchToolName` · `sendToolName` · `replyToolName` · `createToolName` · `forkToolName` | `thread_list` · `thread_search` · `thread_send` · `thread_reply` · `thread_create` · `thread_fork` | Registered tool names. |
| `defaultLimit` / `maxLimit` | `30` / `200` | Rows per listing call, and the hard cap. |
| `defaultSearchLimit` / `maxSearchLimit` | `20` / `100` | Hits per search call, and the hard cap. |
| `maxMessageChars` | `8000` | Length bound on one message body. |
| `defaultReplyWaitMs` / `maxReplyWaitMs` | `30000` / `120000` | Wait for a target to finish its turn, and the hard cap. |
| `maxReplyChars` | `4000` | Bound on the reply text handed to the model. |
| `maxForkSeedChars` | `2000000` | Largest prefix one fork may inherit. |

```yaml
- id: thread-tools
  name: '@wig123/dsh-thread-tools'
  config:
    defaultLimit: 50
    maxMessageChars: 20000
```

Content search needs a session content index. A deployment running `@deepseek-ai/dsh-session-query-sqlite` with `openAt: never` — the Web default — still gets listing, delivery, replies, creation, and forking; `thread_search` reports that search is disabled and quotes the deployment's own reason.

## Compatibility

- Requires `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-session-persistence`, and `@deepseek-ai/dsh-agent`. The plugin row stays inactive until they are mounted.
- `@deepseek-ai/dsh-session-query` is an optional peer for `thread_search`; without it the tool reports itself unavailable and the other five keep working.
- `sessionPersistence.list()` accepts a signal on one release line and an options object on another. Both call shapes are handled, and each release line is verified on its own.

## Verification

`dev/verify.mjs` boots a real dsh profile's composed entry tree against the real session store, creates sessions through the agent factory, and drives every tool through `ctx.tools.execute({ name, arguments, agent, signal })` — the same path a model call takes. Delivery is not taken from the tool's return value; it is read back from the target session's own `user/message` events.

Two of the checks drive the tools the way a model really does. `dev/stub-adapter.mjs` registers a scripted LLM adapter, so a real agent loop, real tool dispatch, and a real session log run with no API key: the scripted model lists the sessions, messages one, and reads the reply, and the harness confirms from durable state that the target logged the message and that the reply text reached the driver.

```sh
npm install --legacy-peer-deps
npm run build
node dev/verify.mjs <profileName>     # a profile with the plugin installed
```

```text
24/24 checks passed
```

Those passes come from a session store holding 274 sessions across 7 projects, and again from a separate profile that installed the package with `dsh plugin --profile <name> add github:wig123/dsh-thread-tools` — that second run is the one that shows someone else can install this and use it.

## Limits

- A dormant session cannot be messaged; reviving one from inside a tool call is not implemented.
- A reply is read, not correlated. `thread_reply` returns the target's newest assistant text, which may predate your message if the target had already answered something else.
- Listing reads session metadata, not transcripts.
- Forking a very large session needs an explicit `at_seq`.

## Development

```sh
npm install --legacy-peer-deps
npm run build        # tsc -> lib/
npm run typecheck
```

`lib/` is committed so git installs work without a build; `prepublishOnly` rebuilds it before a release.

## License

MIT
