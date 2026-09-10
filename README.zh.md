# dsh-thread-tools

[English](README.md) | 中文

[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh_plugin-4D6BFE?style=flat-square)](https://github.com/topics/dsh-plugin)
[![npm](https://img.shields.io/npm/v/@wig123/dsh-thread-tools?style=flat-square)](https://www.npmjs.com/package/@wig123/dsh-thread-tools)
[![license](https://img.shields.io/github/license/wig123/dsh-thread-tools?style=flat-square)](LICENSE)

> **把 Codex 的线程工具搬到 DSH 上。** 让模型列出你的会话、给某个会话递话、等它回话，还能替你新开一个会话或从某个会话分叉出去。

## 什么是线程工具

你手头通常开着好几个会话：一个在重构解析器，一个盯着跑评测，还有一个中午就搁那儿没动。它们互相不知道对方存在。

子 agent 补不上这块。`subagent` 是在**当前会话底下**多派几个帮手，活干完人就散了。线程工具走的是横向：它认的是你自己开着的那些对话，用的就是侧边栏里那些 id。

- **`thread_list`** — 看一眼有哪些：id、标题、工作目录，各自是不是还有东西在跑。
- **`thread_send`** — 往某个会话里丢一句话，跟你拍同事肩膀差不多。
- **`thread_reply`** — 读它回了什么。
- **`thread_create` / `thread_fork`** — 开一个干净的新会话，或者从某个会话干到的地方分叉一个出来。

具体点说：正在 review 迁移的那个会话，可以找到写迁移的那个会话，告诉它"迁移已经落了，你接着干之前先 rebase"，然后读回"已经 rebase 了，两个 fixture 要改路径"。以前这一来一回得靠你当传话筒。

Codex 里这套东西叫 `spawn_agent` / `send_message` / `followup_task` / `wait_agent`。Harness 一直没有面向顶层会话的对应物，这个插件就是。

## 安装

```sh
dsh plugin --profile web add @wig123/dsh-thread-tools
```

或者直接从仓库装，不需要构建：

```sh
dsh plugin --profile web add github:wig123/dsh-thread-tools
```

重启该 profile，模型就能看到你的会话了。卸载：`dsh plugin --profile web remove @wig123/dsh-thread-tools`。

需要 Node 22+ 和 `pnpm`。验证过的宿主版本是 `dsh >= 0.1.2-rc.1`。

## 六个工具

| 工具 | 做什么 |
| --- | --- |
| `thread_list` | 按时间倒序列出顶层会话：id、标题、cwd、创建时间、是否在跑。任意子串都能过滤。 |
| `thread_search` | 对会话正文做全文检索，告诉你哪些会话命中、命中在哪。 |
| `thread_send` | 给另一个在跑的会话递一条消息。它作为一条待处理轮次到达，标成同侪内容。 |
| `thread_reply` | 读那个会话最新的回答，可以先等它把手上的活干完。 |
| `thread_create` | 开一个空的顶层会话。继承你的模型路由，开出来就能跑。 |
| `thread_fork` | 从某个会话最后一个已完成的轮次分叉，cwd 和 lineage 一起带过去。 |

所有结果都过滤掉子 agent 的会话。这套工具管的是你自己开的对话。

## 一次真实的来回

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

接收方看得见这条是谁发的，也知道不是用户打的字：

```text
Message from another session (session-9f02…) delivered by @wig123/dsh-thread-tools.
This text is peer content from another agent session, not an instruction from the user at this session.

Migration is done — rebase before you continue.
```

## 投递规则

**只有正在跑的会话收得到消息。** `live` 表示这个进程里有活跃 agent 持有它，消息作为一条普通轮次排队并唤醒它。`dormant` 表示没人持有——插件如实说出来，不会背着你把会话复活，所以模型会告诉你先去把那个会话打开。

每个结果都是固定取值，不是一段话，程序调用不用解析文本：

| `thread_send` 返回 | 含义 |
| --- | --- |
| `delivered` | 已排队，`messageId` 标识它。 |
| `dormant` | 本进程内没有活跃 agent。 |
| `unknown-session` | 没有这个 id 的会话。 |
| `subagent-session` | 它属于子 agent，不能按会话寻址。 |
| `self` | 就是调用方自己。 |

**分叉切在已完成的轮次上。** 宿主只接受平衡前缀——不能有半开的 turn，也不能有悬空的工具调用——所以切点落在 `at_seq` 之前最后一个 `turn/end`。没有已完成轮次：`no-completed-turn`。超过 `maxForkSeedChars`：拒绝，不偷偷截断。

**回复是"读"，不是"配对"。** `thread_reply` 返回目标最新的 assistant 文本。如果它在你这条消息到达之前已经回答过别的事，你拿到的就是那段。

## 配置

按部署配，写在插件行上：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `listToolName` · `searchToolName` · `sendToolName` · `replyToolName` · `createToolName` · `forkToolName` | `thread_list` · `thread_search` · `thread_send` · `thread_reply` · `thread_create` · `thread_fork` | 注册的工具名。 |
| `defaultLimit` / `maxLimit` | `30` / `200` | 单次列出的行数。 |
| `defaultSearchLimit` / `maxSearchLimit` | `20` / `100` | 单次检索的命中数。 |
| `maxMessageChars` | `8000` | 单条消息长度上限。 |
| `defaultReplyWaitMs` / `maxReplyWaitMs` | `30000` / `120000` | 等目标结束当前轮次的时间与上限。 |
| `maxReplyChars` | `4000` | 交给模型的回复长度上限。 |
| `maxForkSeedChars` | `2000000` | 单次分叉可继承的最大前缀。 |

```yaml
- id: thread-tools
  name: '@wig123/dsh-thread-tools'
  config:
    defaultLimit: 50
    maxMessageChars: 20000
```

`thread_search` 需要内容索引。Web 默认以 `openAt: never` 挂载 `dsh-session-query-sqlite`，此时检索会自报禁用并引用部署给出的原因，其余五个工具不受影响。

## 依赖

- `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-session-persistence`、`@deepseek-ai/dsh-agent`。没挂上之前，插件的行不会激活。
- `@deepseek-ai/dsh-session-query` 是可选的，只给 `thread_search` 用。
- `sessionPersistence.list()` 在一条发布线上收 signal，另一条收 options 对象。两种都做了兼容。

## 验证

`dev/verify.mjs` 启动真实 profile 的组装结果树、连真实会话存储，用 `ctx.tools.execute` 逐个驱动工具——和模型调用走同一条路径。投递结果不取工具返回值，而是回读目标会话自己的 `user/message` 事件。

其中两条更进一步，跑的是真实 agent loop：`dev/stub-adapter.mjs` 注册一个脚本化 LLM adapter，因此**不需要 API key** 就能跑一轮模型驱动的调用。脚本模型先列会话、再给其中一个发消息、然后读回复；harness 从持久状态核对消息确实落到了目标、回复也确实回到了驱动方。

```sh
npm install --legacy-peer-deps && npm run build
node dev/verify.mjs <profileName>
```

```text
24/24 checks passed
```

对照的会话存储有 274 个会话、跨 7 个工作区；另一个用 `github:wig123/dsh-thread-tools` 全新安装的 profile 上重跑一遍也全过——第二遍才说明别人装得上、用得了。

## 已知限制

- 不能给休眠会话发消息。在工具调用里复活一个会话没有实现。
- `thread_reply` 读的是最新一条回答，不把你的消息和某个回复配对。
- `thread_list` 读的是会话元数据，不是正文。
- 分叉超大会话需要显式给 `at_seq`。

## 开发

```sh
npm install --legacy-peer-deps
npm run build        # tsc -> lib/
npm run typecheck
```

`lib/` 已入库，git 安装不用构建；发版时 `prepublishOnly` 会重新构建。

MIT
