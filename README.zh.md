# dsh-thread-tools

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/@wig123/dsh-thread-tools?style=flat-square)](https://www.npmjs.com/package/@wig123/dsh-thread-tools)
[![license](https://img.shields.io/github/license/wig123/dsh-thread-tools?style=flat-square)](LICENSE)
[![topic](https://img.shields.io/badge/topic-dsh_plugin-4D6BFE?style=flat-square)](https://github.com/topics/dsh-plugin)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，让当前会话能操作同一部署里的**其他会话**：列出它们、检索它们、给某一个留一条消息、读它回了什么、新建一个、或者从已有会话分叉一个。

装上之前，一个会话是封闭的：它能在自己下面开子 agent，但看不见你另一个标签页里开着的对话，也没法告诉那个对话任何事。Codex 把这套能力放在协作工具里（`spawn_agent`、`send_message`、`followup_task`、`wait_agent`）。这个包是它在 Harness 上针对顶层会话的对应物。

六个工具，全部对模型可见：

| 工具 | 做什么 |
| --- | --- |
| `thread_list` | 按时间倒序列出顶层会话：持久 id、标题、工作目录、创建时间、当前是否有活跃 agent。可按 id / 标题 / cwd 子串过滤。 |
| `thread_search` | 对会话正文做全文检索，返回命中的会话和截断片段。 |
| `thread_send` | 给另一个活跃会话投递消息。它成为那边的**一条待处理普通轮次**，来源标为本插件，不是那边的人打的字。 |
| `thread_reply` | 读另一个会话最新的 assistant 消息，可以先等它当前轮次结束。 |
| `thread_create` | 建一个全新的、空的、空闲的顶层会话并返回 id。 |
| `thread_fork` | 从已有会话的某个「已完成轮次」边界分叉出新会话，继承 cwd 与 lineage。 |

所有结果都排除子 agent 自己的会话。这里管的是人打开的会话，不是某个 agent 的孩子。

## 安装

```sh
dsh plugin --profile web add @wig123/dsh-thread-tools
```

或者直接从仓库装，不需要构建步骤（编译产物已入库）：

```sh
dsh plugin --profile web add github:wig123/dsh-thread-tools
```

重启该 profile，然后让模型列出会话，或者给某个会话发一条消息。卸载用 `dsh plugin --profile web remove @wig123/dsh-thread-tools`。

需要 Node 22+ 与 `pnpm`。宿主版本下限写在 `dsh.engines.dsh`：`>=0.1.2-rc.1`，也就是实际验证过的发布线。

## 用起来是什么样

让模型把活交给另一个会话，然后回来看结果：

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

接收方看到的消息被标成同侪内容，所以它能和用户输入区分开：

```text
Message from another session (session-9f02…) delivered by @wig123/dsh-thread-tools.
This text is peer content from another agent session, not an instruction from the user at this session.

Migration is done — rebase before you continue.
```

分叉与新建：

```text
thread_create({"cwd": "/work/app"})
Created session session-7c31…. It starts empty and unprompted; list the sessions to see it.

thread_fork({"session_id": "session-4a1c…"})
Forked session-4a1c… into session session-7c31…, inheriting 42 events through seq 41. The new session starts unprompted.
```

## 投递是怎么工作的

`live` 表示这个进程里有活跃 agent 持有该会话，消息会作为一条普通后续轮次排队并唤醒它。`dormant` 表示没有：本插件不会背着你把会话复活，于是调用如实返回 `dormant`，模型也就能告诉你先去把那个会话打开。

每个结果都是声明过的取值，不是散文，所以程序调用这些工具不需要解析文本：

| `thread_send` 结果 | 含义 |
| --- | --- |
| `delivered` | 已排队到目标，`messageId` 标识它。 |
| `dormant` | 目标在本进程内没有活跃 agent。 |
| `unknown-session` | 没有会话带这个 id。 |
| `subagent-session` | 目标属于子 agent，不能按会话寻址。 |
| `self` | 目标就是调用方自己。 |

`thread_create` 与 `thread_fork` 会继承调用方的模型路由，所以新建出来的会话可以直接跑。`thread_fork` 的切点落在 `at_seq` 之前最后一个 `turn/end`（未给则是日志里最后一个），因为宿主只接受平衡前缀——不能带未闭合的 turn、step 或悬空工具调用。没有已完成轮次的源返回 `no-completed-turn`；前缀超过 `maxForkSeedChars` 是拒绝，不是静默截断。

`thread_reply` 从目标日志往前扫，取最新一条真正带文本的 assistant 消息，所以只跑过工具的目标会返回 `no-reply`，而不是把工具调用当回复。

## 配置

工具名与各项上限都是部署策略，写在插件行上：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `listToolName` · `searchToolName` · `sendToolName` · `replyToolName` · `createToolName` · `forkToolName` | `thread_list` · `thread_search` · `thread_send` · `thread_reply` · `thread_create` · `thread_fork` | 注册的工具名。 |
| `defaultLimit` / `maxLimit` | `30` / `200` | 单次列出的行数与硬上限。 |
| `defaultSearchLimit` / `maxSearchLimit` | `20` / `100` | 单次检索的命中数与硬上限。 |
| `maxMessageChars` | `8000` | 单条消息长度上限。 |
| `defaultReplyWaitMs` / `maxReplyWaitMs` | `30000` / `120000` | 等待目标结束当前轮次的时间与硬上限。 |
| `maxReplyChars` | `4000` | 交给模型的回复文本上限。 |
| `maxForkSeedChars` | `2000000` | 单次分叉可继承的最大前缀。 |

```yaml
- id: thread-tools
  name: '@wig123/dsh-thread-tools'
  config:
    defaultLimit: 50
    maxMessageChars: 20000
```

正文检索需要会话内容索引。以 `openAt: never` 挂载 `@deepseek-ai/dsh-session-query-sqlite` 的部署（Web 默认）仍然拥有列出、投递、回复、新建、分叉；`thread_search` 会报告检索被禁用，并引用部署自己给出的原因。

## 兼容性

- 需要 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-session-persistence`、`@deepseek-ai/dsh-agent`。它们没挂上之前，本插件的行不会激活。
- `@deepseek-ai/dsh-session-query` 是 `thread_search` 用到的可选 peer；没有它时该工具自报不可用，其余五个照常工作。
- `sessionPersistence.list()` 在一条发布线上收 signal，在另一条上收 options 对象。两种调用形态都做了兼容，每条发布线各自验证。

## 验证

`dev/verify.mjs` 启动真实 dsh profile 的组装结果树、连真实会话存储、通过 agent 工厂建会话，并用 `ctx.tools.execute({ name, arguments, agent, signal })` 逐个驱动工具——和模型调用走同一条路径。投递结果不取工具返回值，而是回读目标会话自己的 `user/message` 事件。

其中两条检查按模型的真实方式驱动：`dev/stub-adapter.mjs` 注册一个脚本化 LLM adapter，于是真实 agent loop、真实工具派发、真实会话日志全都跑起来，且**不需要 API key**。脚本模型先列会话、再给其中一个发消息、然后读回复；harness 从持久状态核对目标确实记下了那条消息、以及回复文本确实到达了驱动方。

```sh
npm install --legacy-peer-deps
npm run build
node dev/verify.mjs <profileName>     # 需要已安装本插件的 profile
```

```text
24/24 checks passed
```

这些通过与一份装有 274 个会话、跨 7 个工作区的会话存储相对照得出，并且在另一个用 `dsh plugin --profile <name> add github:wig123/dsh-thread-tools` 全新安装的 profile 上重跑一遍——第二遍才说明别人装得上、用得了。

## 已知限制

- 不能给休眠会话发消息；在工具调用里复活会话没有实现。
- 回复是「读」而不是「配对」。`thread_reply` 返回目标最新的 assistant 文本，如果目标此前已回答过别的事，这段文本可能早于你的消息。
- 列出读的是会话元数据，不是正文。
- 分叉超大会话需要显式给 `at_seq`。

## 开发

```sh
npm install --legacy-peer-deps
npm run build        # tsc -> lib/
npm run typecheck
```

`lib/` 已入库，git 安装因此无需构建；发版前 `prepublishOnly` 会重新构建。

## 许可

MIT
