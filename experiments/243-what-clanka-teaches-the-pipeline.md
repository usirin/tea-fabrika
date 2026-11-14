---
date: "2026-11-09"
scripts: "none"
summary: "`next/`, reading [clanka](https://github.com/Effectful-Tech/clanka) v0.24.4, not a measurement. clanka is one agent, not a factory: no plan, tests, review, ledger, asks or signing. It shows the inside of one Draft. Top leans: keep the loop and the model call outside the box and only the hands inside, over Effect RPC (65%, walks back part of programs run in a box); drive Claude Code one model step at a time with its tool parked (55%, walks back the Tier 5 resume law); transcripts leave as history events (70%); limits as `Context.Reference` and one named `Schedule` (75%); executor state as a value the caller holds (80%). Not taken: loop state outside tea, history outside the ledger, free-text done, 20 retries, `bash` and `gh` from the agent, tokens with no dollars. Two owner questions for the Tier 5 walk, both answered no ([0026](../.decisions/0026-fabrika-never-owns-the-agent-loop.md)); borrows 3 to 5 decided ([0030](../.decisions/0030-copy-clankas-shapes-where-better.md))."
---

# 243. What clanka teaches `next/`'s pipeline

Read 2026-11-09. **This is reading, not a measurement.** Nothing ran. It reads
[clanka](https://github.com/Effectful-Tech/clanka) at v0.24.4 (head `44eb97a4`), a coding agent
built on Effect and written mostly by [one of Effect's maintainers](https://github.com/tim-smart),
against our side on origin/main at `399cf26f`. The owner asked for it as a reference design for
`next/`'s pipeline side, not only for code style; code style is settled in
[0023](../.decisions/0023-next-follows-effects-code-style.md). Claims about our pipeline are about `next/` unless they say today's version;
`drive.ts` and `box.sh` are today's lead tooling. clanka paths are cited as `clanka/<path>:<line>`.

**The answer.** clanka is one agent, not a factory. It has no plan, tests, mutation or review
step, no ledger, no person to ask, and no signing. So it does not show how our pipeline should
look. It shows, in detail, how the inside of one `Draft` should run: the agent step that our step
machines wrap. Five things are worth taking, in this order:

1. **The loop and the model call stay outside the box; only the hands go in.** clanka runs its
   agent loop, its model calls and its key-holding tools in the trusted process, and runs scripts,
   shell and files in an executor it can reach over Effect RPC. For us that would put no model
   login in a box at all. Lean 65%. It walks back part of [programs run in a box](../docs/direction/programs-run-in-a-box.md).
2. **Drive the maker one model step at a time.** clanka runs Claude Code as a model, not as an
   agent: one model step per call, its one tool parked, its own loop between steps. Steering,
   stops, retries, budget checks and the transcript are then ours at every step. Lean 55%. It walks
   back a Tier 5 law: "when hands restart, they resume the maker's session".
3. **The transcript leaves as events.** Every change to history goes out on the output stream as
   `HistoryAppended` or `HistoryReplaced`, so the caller keeps the transcript without reading the
   agent's memory. Lean 70%. **Decided** (owner, 2026-11-09, [0030](../.decisions/0030-copy-clankas-shapes-where-better.md)). It fits [an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md).
4. **Limits are `Context.Reference`s, retries are one named `Schedule`, and a typed error says the
   tries ran out.** Lean 75% on the shape. Not its numbers: they have no source. **Decided** (owner,
   2026-11-09, [0030](../.decisions/0030-copy-clankas-shapes-where-better.md)).
5. **The executor's state is a Schema value the caller holds and hands back.** Store it beside the
   transcript, and a resume needs nothing in memory. Lean 80%. **Decided** (owner, 2026-11-09,
   [0030](../.decisions/0030-copy-clankas-shapes-where-better.md)). Fits P6 of the
   [pipeline guidelines](../docs/direction/pipeline-guidelines.md).

What not to take: its loop state in `let` and `MutableRef` (ours is a tea machine), its in-memory
history (ours is the ledger), an agent that says it is done in free text, 20 model retries in a row,
`bash` and `gh` straight from the agent, and token counts with no dollars. Two owner questions are
at the end, one for each walk-back. **How sure: 70%** overall. I read about 12 of its 40 source
files closely and nothing ran.

```ts
// The whole idea in one sketch (ours, not clanka's code). A step machine's Draft, rethought.
//   outside the box:  the step machine, the agent loop, the model call, the loop-side tools
//   inside the box:   the executor: run a script, shell, files, tests
// One model step is one Cmd. The machine steps between model steps, so a stop, a steer or a
// budget check lands there, and every history change becomes a fact in the ledger.
const modelStep = Cmd.make("model_step", {input: StepInput, ok: StepOutput, err: ["retries_exhausted", "unknown"]});
const execute = Cmd.make("script_run", {input: Script, ok: ScriptResult, err: ["timeout", "unknown"]}); // passed into the box
```

## What was read

| clanka file | What it is |
|---|---|
| `src/Agent.ts` (2,196 lines) | the agent loop: history, steering, sub-agents, retries, compaction |
| `src/AgentExecutor.ts` (1,687) | runs the model's scripts, locally or over RPC |
| `src/AgentTools.ts` (1,426) | the built-in tools: `bash`, `gh`, `readFile`, `applyPatch`, tasks, `taskComplete` |
| `src/AgentOutput.ts` (402) | the output events and the two errors that end a run |
| `src/ClaudeAgent.ts` (1,254) and `.specs/claude-agent.md` | Claude Code as a model provider |
| `src/Codex.ts`, `src/Acp.ts` | the Codex provider, and the ACP server that saves sessions |
| `.specs/README.md`, `shared-tasks.md`, `caller-tools.md` | the specs folder |
| `src/AgentSubagents.test.ts` | how one suite runs over both executors |

On our side: `docs/direction/` (the notes linked below), `docs/plan/tiers.md` (Tier 5), the
`.decisions/` list, and today's `drive.ts` and `box.sh` as the map of jobs.

## How clanka is built

### Two services: the loop and the hands

The `Agent` owns the loop. The `AgentExecutor` runs scripts and keeps their environment.

```ts
// clanka/src/Agent.ts:97-147 (trimmed)
export interface Agent {
  readonly history: MutableRef.MutableRef<Prompt.Prompt>
  readonly environment: MutableRef.MutableRef<AgentExecutor.ExecutionEnvironment>
  send(options: { readonly prompt: Prompt.RawInput; readonly system?: ... }): Effect.Effect<
    Stream.Stream<Output, AgentFinished | AiError.AiError | RetriesExhausted>, never,
    Scope.Scope | LanguageModel.LanguageModel | Model.ProviderName | Model.ModelName>
  steer(message: string): Effect.Effect<void>
}
```

```ts
// clanka/src/AgentExecutor.ts:72-106 (trimmed)
export class AgentExecutor extends Context.Service<AgentExecutor, {
  readonly capabilities: Effect.Effect<Capabilities>
  execute(options: ExecuteOptions): Stream.Stream<string>
  readonly renderEnvironment?: ...
}>()("clanka/AgentExecutor") {}
```

The executor has three layers: `layerLocal` (in process), `layerRpc` (a client) and
`layerRpcServer` (`clanka/src/AgentExecutor.ts:883-894`). The wire is an Effect `RpcGroup` with
`capabilities`, `execute` (streamed), `awaitTask`, `claimTask`, `renderEnvironment` and
`executeUnsafe` (`clanka/src/AgentExecutor.ts:1173` on). The tests run every executor law twice,
once per transport, over HTTP with NDJSON:

```ts
// clanka/src/AgentSubagents.test.ts:260-263
const executors = [
  ["local", localExecutorLayer],
  ["rpc", rpcExecutorLayer],
] as const
```

Tools come in two kinds ([`caller-tools.md`](https://github.com/Effectful-Tech/clanka/blob/master/.specs/caller-tools.md)).
Executor tools run where the scripts run. **Loop-side tools** run "next to the `Agent` rather than
in the executor", in the trusted process; a script calls them like any other function, and their
arguments are decoded with the tool's schema first (`clanka/src/Agent.ts:175-180`).

### The model writes one script, and the tools are functions in it

The model gets one tool, `execute`, and writes JavaScript that calls the real tools:

```ts
// clanka/src/Agent.ts:1981-1990
const SingleTools = Toolkit.make(
  Tool.make("execute", {
    description: "Execute javascript code and return the output",
    parameters: Schema.Struct({ script: Schema.String }),
    success: Schema.String,
    dependencies: [ScriptExecutor],
  }),
)
```

The tools are typed with Schema and shown to the model as TypeScript declarations
(`toolsDts`, `clanka/src/Agent.ts:223-226`). The script runs in a worker thread inside a `vm`
context (`clanka/src/AgentExecutor.ts:549-567`, `:1622`), so a busy script can be stopped. Each
tool call goes back to the parent and runs there as an Effect.

### State: a Schema value handed back each step

```ts
// clanka/src/AgentExecutor.ts:187-199
export class ExecutionEnvironment extends Schema.Class<ExecutionEnvironment>(
  "clanka/AgentExecutor/ExecutionEnvironment",
)({
  cwd: Schema.String,
  baseline: Schema.Array(Schema.String), // context items already in the system prompt
  seen: Schema.Array(Schema.String),     // context items sent since
}) {}
```

The loop never reads it. It passes the value to `execute` and keeps what `onEnvironment` hands
back, "also called when the script fails, times out or is interrupted"
(`clanka/src/AgentExecutor.ts:121-127`). "Store it next to `history` to resume a session where it
left off" (`clanka/src/Agent.ts:101-107`).

### Steering and interruption

```ts
// clanka/src/Agent.ts:1524-1530
steer: (message) =>
  Effect.callback((resume) => {
    const entry = { message, resume }
    rootMailbox.messages.add(entry)
    rootMailbox.notify()
    return Effect.sync(() => rootMailbox.messages.delete(entry))
  }),
```

A steer waits in the agent's mailbox and goes into history only between model steps
(`clanka/src/Agent.ts:1142` on). The effect ends once the message is sent. Interrupting it takes
the message back: the cleanup removes it from the mailbox. Nobody writes a cancel flag. A stop is
plain fiber interruption of `send`'s scope.

### How a run ends

The agent ends its own run by calling `taskComplete(summary)`, and `send`'s stream then fails with
`AgentFinished { summary }` (`clanka/src/AgentOutput.ts:381-388`, `clanka/src/Agent.ts:1128-1140`).
The call is refused while sub-agents still run (`clanka/src/Agent.ts:738-750`). The summary is a
free string; nothing checks it against a schema.

### Retries and limits

```ts
// clanka/src/Agent.ts:2104-2130 (trimmed)
export class TurnTimeout extends Context.Reference<Duration.Duration>(
  "clanka/Agent/TurnTimeout", { defaultValue: () => Duration.minutes(5) },
) {
  static readonly layer = (timeout: Duration.Input) =>
    Layer.succeed(TurnTimeout, Duration.fromInputUnsafe(timeout))
}
export class MaxRetries extends Context.Reference<number>(
  "clanka/Agent/MaxRetries", { defaultValue: () => 20 },
) { static readonly layer = (retries: number) => Layer.succeed(MaxRetries, retries) }

// clanka/src/Agent.ts:1692-1695
const retryPolicy = Schedule.min([
  Schedule.exponential(100, 1.5),
  Schedule.spaced(5000),
]).pipe(Schedule.jittered)
```

- `TurnTimeout` is an inactivity limit: the clock pauses while a tool runs (a latch,
  `clanka/src/Agent.ts:782-792`), and it races each model call (`:1353`).
- A model call is retried while its error is retryable, with that schedule, up to `MaxRetries` in
  a row. The count resets after a call succeeds. When it runs out, the stream fails with
  `RetriesExhausted { retries, error }`, the last error kept (`clanka/src/Agent.ts:1351-1393`,
  `clanka/src/AgentOutput.ts:396-402`).
- A context-length error is never retried as is: the history is compacted first, once.
- For a tool the model called wrong (`ToolNotFoundError`, `InvalidOutputError`), the retry adds a
  turn: "There was an error, please try again using the `execute` tool" (`:1366-1377`).
- Shell commands have their own limits, `CommandLimits` (timeout, output characters), another
  `Context.Reference` (`clanka/src/AgentTools.ts:288-301`).

### Claude Code as a model, one step at a time

[`.specs/claude-agent.md`](https://github.com/Effectful-Tech/clanka/blob/master/.specs/claude-agent.md)
runs the user's own, unmodified Claude Code through the Agent SDK, but keeps clanka's loop:

```ts
// clanka/src/ClaudeAgent.ts:107-128 (trimmed)
=> ({
  pathToClaudeCodeExecutable, cwd, model, ...effortOptions(options.effort),
  systemPrompt: { type: "custom", prompt: systemText(options.prompt) },
  env: { ...process.env, ...isolationEnv, CLAUDE_AGENT_SDK_CLIENT_APP: `clanka/${version}` },
  settingSources: [], settings: { disableAllHooks: true }, strictMcpConfig: true,
  skills: [], tools: [], permissionMode: "dontAsk", allowedTools: [`${toolPrefix}*`],
  verbatimPrompts: true, includePartialMessages: true, persistSession: false,
})
```

- Claude Code gets no tools of its own (`tools: []`). Its only tool is clanka's `execute`, served
  by an in-process MCP server.
- **The tool is parked.** The SDK cannot stop after a tool call, so the MCP handler does not run
  the script; it waits. The step ends when the model's message is done and every call has parked.
  clanka then runs the real `execute`, and the next model call answers the parked handlers.
- **One live process, continued only when the prompt matches.** The next call reuses the process
  only if its prompt is exactly the last prompt, plus that step's reply and results, plus user
  messages. Anything else (compaction, a load, a retry) closes the process and starts a new one
  with the whole history, rendered as one user message.
- **A step that does not finish closes its process,** because its state is unknown.
- `persistSession: false`: "clanka owns history, so nothing is written under `~/.claude/projects`".
- Rate limits become retryable errors and go through clanka's own retry schedule.

### Codex

clanka does not run the Codex command line. Its `openai` provider calls the Codex backend with the
person's Codex sign-in, through Effect's OpenAI client (`clanka/src/Codex.ts:18-20`), so the loop and
the tools are clanka's, as with every provider. Our steps run `codex exec` today, with Codex's own
loop, tools and sandbox (`box.sh:496`).

### Sandboxing

There is no OS wall. The worker and `vm` context are there so a script can be stopped, not to fence
it. `bash` runs `bash -c` in the working directory (`clanka/src/AgentTools.ts:904`) and `gh` runs
the real `gh` (`:1027`). The fence is where you run the executor: with `layerRpcServer`, it can run
somewhere else, while the loop stays home.

### History and transcripts

History is a `MutableRef<Prompt>` on the agent. Every commit to the root agent's history goes out
on the output stream:

```ts
// clanka/src/AgentOutput.ts:329-352 (trimmed)
export class HistoryAppended extends Schema.TaggedClass<HistoryAppended>()("HistoryAppended", {
  messages: Schema.Array(Prompt.Message),
}) {}
/** Emitted when compaction rewrites the agent's history. `messages` is the whole new history. */
export class HistoryReplaced extends Schema.TaggedClass<HistoryReplaced>()("HistoryReplaced", {
  messages: Schema.Array(Prompt.Message),
}) {}
```

The ACP server saves one `SessionRecord` per session in a `KeyValueStore`: model, history and the
executor's environment (`clanka/src/Acp.ts:150-162`, `:564-575`). A failed save is logged as a
warning and skipped.

### Cost

`Usage` counts tokens: context, input, output, cache reads and writes (`clanka/src/AgentOutput.ts:87-100`).
For Claude it keeps each count's largest value per API message. There are no dollars: the Claude
spec lists "cost display" as out of scope.

### The specs folder as a way of working

One file per feature in `.specs/`, listed in `.specs/README.md`. Each opens with the public API as a
TypeScript block, then the behavior in bullets, then what is out of scope, then a list of the tests
by name. When a feature replaces another, the old spec stays and says what replaced it
(`background-bash.md` and `background-subagents.md` point to `shared-tasks.md`). Its `AGENTS.md`
asks for one changeset per pull request and tells agents to read Effect's own `AGENTS.md` first.
This is close to our `docs/direction` notes, but per feature and API first.

## Job by job

Each job our pipeline does, what clanka does for it, and what `next/` decided.

| Job | clanka | What `next/` decided |
|---|---|---|
| Plan | none: one prompt to one agent | a plan step with Properties, approved before tests ([the plan stage](../docs/direction/the-plan-stage.md), [the steps](../docs/direction/next-is-a-pipeline-pre-run.md)) |
| Tests | none | written first by their own agent ([the test writer](../docs/direction/the-test-writer.md), [nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)) |
| Build | all of clanka is this: one agent loop with tools | an agent drafts inside a step machine; code checks, commits and signs ([code commits and signs each step](../docs/direction/code-commits-and-signs-each-step.md), proposed) |
| Mutation | none | its own step, a fixed sample ([fast and daily mutation](../docs/direction/fast-and-daily-mutation.md)) |
| Review | none (a sub-agent could) | one review by another agent ([nobody grades their own work](../docs/direction/nobody-grades-their-own-work.md)) |
| Drive's loop | `send`'s loop in one fiber: model step, scripts, steers, compaction, until `taskComplete` | a tea machine holds the loop ([tea is the engine](../docs/direction/tea-is-the-engine.md), [control lives in code](../docs/direction/control-in-code.md)); drive is the lab and never retries ([0007](../.decisions/0007-drive-is-the-pipeline-lab.md)) |
| Retries | 20 model retries in a row, backoff to 5 s | three kinds, each bounded, each with a source (P8 of the [pipeline guidelines](../docs/direction/pipeline-guidelines.md), 65%) |
| Boxes | no OS wall; the executor can run elsewhere over RPC | the box goes around the whole program; keys stay out, Cmds pass out ([programs run in a box](../docs/direction/programs-run-in-a-box.md), [0020](../.decisions/0020-programs-get-hard-walls.md)) |
| Signing | none; the agent runs git and `gh` itself | code signs each step (proposed, above) |
| Ledger | none; history in memory, ACP saves a record in a key-value store | facts in the ledger ([the ledger behind a service](../docs/direction/ledger-behind-a-service.md), [a job record holds its trace](../docs/direction/a-job-record-holds-its-trace.md)) |
| Transcripts | `HistoryAppended` and `HistoryReplaced` events | content beside the spans, deletable ([an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md), proposed) |
| Asks to a person | none; `permissionMode: "dontAsk"`, and `steer` is the only way in | one ask with the hash of what was shown ([one ask and one meter](../docs/direction/one-ask-and-one-meter.md), [ask for decisions](../.decisions/0415-ask-a-person-for-decisions.md)) |
| Money | tokens, no dollars | one meter, list dollars on every run (same note) |
| Helpers | the agent starts sub-agents itself; tasks belong to their starter | an agent asks through one tool; tea-host's `DynamicSupervisor` starts it with limits ([0417](../.decisions/0417-fabrika-has-no-supervisor-of-its-own.md)) |
| Providers | a model layer per provider, picked by a flag | one `Agents` service, providers swapped by config ([agents behind one service](../docs/direction/agents-behind-one-service.md)) |

## What to borrow

### 1. The loop and the model call outside the box; only the hands inside

- **What.** Split the agent step the way clanka splits `Agent` and `AgentExecutor`. Outside the box,
  in the trusted process: the step machine, the agent loop, the model call and its login, and the
  loop-side tools (our typed reads, the ask tool, anything that needs a key). Inside the box: an
  executor that runs scripts, shell, files and tests, reached over Effect RPC. Claude Code runs
  outside with `tools: []`, so it can do nothing on the host but call our parked tool.
- **Why.** Today's rule has a hole it admits: since 2026-10-25 the box holds the starter's
  `CLAUDE_CODE_OAUTH_TOKEN`, "against the rule above" that no real key goes into a box
  ([programs run in a box](../docs/direction/programs-run-in-a-box.md)). With the model call
  outside, the box holds no login. It still runs the unmodified Claude Code on the person's own
  login, which is the reading of Anthropic's terms that clanka's spec gives and that our note
  relies on. clanka's loop-side tools are already our "key stays outside" way B, named.
- **What it changes.** It walks back part of [programs run in a box](../docs/direction/programs-run-in-a-box.md):
  "the box goes around a fabrika program, not around an agent harness" and the 2026-10-25 token in
  the box. The box would go around the hands, not the whole agent. It also gives
  "a port into the box is a hole in the wall" a case to weigh: clanka's RPC server is a port. Our
  Cmd lines over stdio would carry the same RPC.
- **Cost.** An executor service with a local and an RPC layer, and one Claude adapter in clanka's
  shape. clanka's are about 1,700 and 1,250 lines with their tests beside them; ours would be
  rethought, not ported.
- **How sure: 65%.** The doubt: Codex. Our steps use `codex exec` with Codex's own sandbox. clanka
  calls the Codex backend directly, so its tools are its own. Doing the same for us means our
  executor owns `applyPatch` and shell for Codex too, and whether calling that backend directly
  fits Codex's terms for a factory is not read here.

### 2. Drive the maker one model step at a time

- **What.** The `Agents` service's Claude adapter runs Claude Code as a model: one model step per
  call, the tool parked, our loop between steps. In tea terms, each model step is a Cmd and the
  machine steps between them, so a person's stop, a steer, a budget check (`ledger.hold` before the
  next step) and a transcript fact all land between steps, in code.
- **Why.** It is [control lives in code](../docs/direction/control-in-code.md) carried one level
  down: today the maker's loop decides when to call the next tool, and we see it only through its
  events. A step that does not finish closes its process, the same rule as the Tier 5 law "a
  person's stop is final". And `persistSession: false` means the only transcript is ours.
- **What it changes.** It walks back the Tier 5 law "when hands restart, they resume the maker's
  session, as an agent is a program says: the kept session opens again"
  ([tiers](../docs/plan/tiers.md#tier-5-laws-decided-2026-11-07)). With this, a restart starts a
  new process and sends our kept history, the way clanka does after a cut-off step. The
  [agents are programs](../docs/direction/agents-are-programs.md) note (walked when Tier 5 starts)
  would change with it.
- **Cost.** The parked tool has real edges: Claude Code sometimes answers a call itself, retries
  start a new message, and a call can arrive before its `tool_use`. clanka's spec lists each one, and
  its test file is about 950 lines. A restart that resends the whole history costs a fresh cache
  write each time.
- **How sure: 55%.** It depends on Claude Code features (`verbatimPrompts`, the
  `claudecode/toolUseId` tag) that clanka pins to version 2.1.248 and up. One experiment settles
  most of it: one real step both ways, counting tokens, dollars and how a stop lands.

### 3. The transcript leaves as events

- **What.** The `Agents` service emits every history change as a typed event, appended or
  replaced, and the step writes each as a fact beside the run's spans.
- **Why.** The caller never reads the agent's memory, so a crash loses at most one step. A
  replace (a compaction) is a fact we would lose forever if only the final history were kept,
  which [record wide](../AGENTS.md) forbids.
- **What it changes.** **Decided** (owner, 2026-11-09, [0030](../.decisions/0030-copy-clankas-shapes-where-better.md)): the events and the compaction
  record, read from the harness's own stream. *It said: nothing decided.* It gives [an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md)
  (proposed) its event shape.
- **Cost.** Small, in the service. **How sure: 70%.** The doubt is volume on a long step; content
  is already the deletable part.

### 4. Limits as `Context.Reference`, retries as one named `Schedule`

- **What.** Each limit of a step's agent run (the inactivity timeout, model retries, shell timeout,
  output cap) is a `Context.Reference` with a default and a `static layer`, so a test or a step's
  config overrides one line. A model-call retry is one named `Schedule`, its count resets after a
  success, and running out is a typed `RetriesExhausted` that keeps the last error.
- **Why.** `next/` has one `Context.Reference` and no `Schedule` today (`rg` on main: one, in `next/packages/libfabrika/src/workers/runtime.ts:269`).
  An inactivity limit that pauses while a tool runs is also a better stop than drive's one
  60-minute wall clock, which cannot tell a long test run from a stalled model.
- **What it changes.** **Decided** (owner, 2026-11-09, [0030](../.decisions/0030-copy-clankas-shapes-where-better.md)), for `next/` and the new
  `drive.ts`, with our own numbers from field rows. *It said: nothing decided.* A model call's 429 retry is P8's first row (the service
  that owns the call retries, with backoff), so it lives in `Agents`, never in the lane.
- **Cost.** Small. **How sure: 75%** on the shape. clanka's numbers (20 tries, 5 minutes, 5 s cap)
  have no source given, so P8 still needs ours.

### 5. The executor's state is a value the caller holds

- **What.** The box's state for a step (working directory, which rule files the agent has seen) is
  a Schema value. The machine stores it beside the transcript and hands it back on the next call,
  never reading inside it.
- **Why.** P6 says every stop saves what a resume needs. With this, a resume needs nothing in
  memory, in the box or in the maker's session files.
- **What it changes.** **Decided** (owner, 2026-11-09, [0030](../.decisions/0030-copy-clankas-shapes-where-better.md)): the parent stores it in the
  lane's record before and after each box step. *It said: nothing decided.* **Cost.** Small. **How sure: 80%.**

### Smaller ones

- **One test suite over both transports.** clanka runs every executor law locally and over RPC.
  `next/`'s door could run its laws in process and over the wire the same way. 70%, small.
- **Steering as an interruptible effect.** A steer waits for the next step, and interrupting it
  takes it back. It fits the chat needs in [agents behind one service](../docs/direction/agents-behind-one-service.md).
  65%, small. A steer is not a stop: a person's stop stays final.
- **Specs.** Our notes already open with code. Two habits worth copying into plans: an "out of
  scope" line, and the tests listed by name. 50%; plans already list Properties.

## What not to borrow

- **Loop state in `let` and `MutableRef` inside one fiber.** In `next/`, the loop is a tea machine
  that steps on Msgs ([tea is the engine](../docs/direction/tea-is-the-engine.md): "nothing replaces
  a tea machine"). clanka's fiber is a fine inside for one Cmd, never the loop.
- **History in memory, saved by the caller.** Ours is facts in the ledger. A host can die mid-spend
  ([0418](../.decisions/0418-limits-are-counted-by-the-ledger.md), experiment 102), so the ledger keeps
  the count and the record.
- **The agent says it is done, in free text.** Our step's answer is checked by its schema, and a
  misfit ends the step `stuck`, with no "fix your answer" turn (Tier 5 law). clanka's "please try
  again" turn is about a broken tool call, not the answer, so it does not break that law, but its
  `taskComplete` would never be our `done`.
- **20 model retries in a row with nobody told.** Fine for a rate limit inside the service; never
  for a step. A step that could not run starts at most twice (P8).
- **`bash` and `gh` straight from the agent.** Ours talks to typed services, never to `gh`
  ([the backend is a library](../docs/direction/backend-as-a-library.md)), and the box is the fence.
- **No OS wall.** Its worker stops a busy script; it fences nothing. Our box stays ([0020](../.decisions/0020-programs-get-hard-walls.md)).
- **Sub-agents the agent starts with no limits.** Ours go through tea-host's `DynamicSupervisor`,
  with limits counted by the ledger.
- **Tokens with no dollars.** Every run of ours records list dollars, even on a subscription.
- **Compaction inside a step.** A step that needs its history rewritten is too big; split it. Not
  needed now. 60%.

## Questions for the owner

Both are for the Tier 5 walk, where these notes are scheduled. Each is one a no answers without
contradicting a decision: a no keeps the note as it is.

1. Should the box hold only the hands (script runner, shell, files, tests), with the agent loop,
   the model call and its login outside, so no login ever goes in a box? This walks back "the box
   goes around a fabrika program, not around an agent harness" in
   [programs run in a box](../docs/direction/programs-run-in-a-box.md).

   **Answered no** (owner, 2026-11-09,
   [0026](../.decisions/0026-fabrika-never-owns-the-agent-loop.md)): fabrika never owns the agent
   loop. The harness and the user's subscription login stay in the box, and the box is the
   protection.
2. Should the Claude adapter drive Claude Code one model step at a time and own the history, so a
   restart sends our kept history to a new process instead of resuming the maker's session? This
   walks back the Tier 5 law "when hands restart, they resume the maker's session".

   **Answered no** (owner, 2026-11-09,
   [0026](../.decisions/0026-fabrika-never-owns-the-agent-loop.md)): the adapter does not own the
   history, and a restart resumes the harness's own session. Borrows 3 to 5 do not need our own
   loop. *It said: they stay open leads.* All three were then decided ([0030](../.decisions/0030-copy-clankas-shapes-where-better.md)).

## What it cannot tell us

- **Nothing ran.** No step went through clanka's shape. Every lean above is a reading of code and
  specs, and the 55% and 65% ones need a run.
- **clanka is one person's interactive agent, not a factory.** It has no lanes, no second person and
  no asks. What holds for one chat may not hold for twelve agents at once on one laptop.
- **I read about 12 of its 40 source files closely.** Compaction, MCP, skills, images and the CLI
  were read only where they touched the loop.
- **Its bounds have no source.** 20 retries, 5 minutes and the 5 s backoff cap are defaults in its
  code, not measured.
- **Terms.** Whether calling the Codex backend directly fits Codex's terms for a factory was not
  read. For Claude, clanka's spec gives its reading; ours is in [programs run in a box](../docs/direction/programs-run-in-a-box.md).
- **The parked tool's edges on our versions** of Claude Code and the Agent SDK are not checked.
- **Effect RPC and a browser.** clanka's tests use RPC over HTTP with NDJSON, which a browser can
  speak. That a browser tab could be the client of a box's executor is a reading, not a test.
