# An agent is a program: `claude` and `codex`, at parity

Proposed 2026-10-29, reshaped 2026-10-30 after experiment 169 (tracker #87).
Each agent maker gets a tea program of its own, `claude` and `codex`, each its
own package in `programs/`, like `trace` and `tracker`. They are built
together so neither one's shape leaks into the other. A person runs one by
hand and gets a chat window. A stage starts one by name as a child run, hands
it a JSON Schema, and checks the answer with its own schema.

```ts
// programs/claude/src/index.ts. programs/codex/src/index.ts is the same, with "codex".
export const claude = defineProgram({
	name: "claude",
	description: "Claude Code as a program: each prompt is a turn on one session, ...",
	flags, inputs, outputs,                  // shared, from @kampus/fabrika-old/agents/program
	machines: {conversation: conversationKind},
	view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
	main: (io) => chat("claude", io),        // the main both programs run
});

// inputs:  prompt (text), cancel (a turn number, or "now")
// outputs: started, said, tool, ask, ended {turn, stop, answer: Json | null, misfit?, tokens, usd, ms, ...}

// By hand, in tsh (a sketch: no window yet, and the app does not list it): a tile with a prompt box.
//   claude --folder /work/copy --model haiku
// In a pipe (a sketch): no tile, outputs go down the pipe. --schema takes the JSON Schema itself.
//   ticket 41 --brief | claude --folder /work/copy --schema '{"type":"object",...}' | review-gate
// From a stage (a sketch): started by name through the host, its answer decoded by the stage.
const sorted = decoder(SortReply);                       // @kampus/pipeline/decoder
self.startChild("claude", {schema: sorted.schema, folder});
// ended.answer goes through sorted.decode: a misfit is `sort_failed`, and the stage ends stuck.
```

## Why

- **This is how the makers already ship them.** `claude` opens its window;
  `claude -p`, or a pipe into it, prints and ends. `codex` and `codex exec`
  are the same split. Unix programs such as `ls` and `git` check whether
  they write to a terminal (`isatty`) and act differently. We copy a split
  people know.
- **An agent run gets what every run gets.** Its own run id, its own trace
  with its content ([an agent run keeps its content](./an-agent-run-keeps-its-content.md)),
  a kept session that survives a restart, and a job a person can attach to
  while it works ([the host keeps terminals and jobs](./the-host-keeps-terminals-and-jobs.md)).
  Today a stage's agent call is a Sub inside the stage, and none of that is
  its own.
- **The chat window comes free.** The 10-26 note asked that the agent
  service allow a chat window later
  ([agents sit behind one service](./agents-behind-one-service.md)). The
  program run by hand is that window.
- **Both at once, for parity.** Experiment 169 built both and found every
  difference was data (what usage a provider reports, whether it holds a
  dollar limit), not shape. So both programs wire the same parts, and parity
  shows in two short files side by side.

## Two programs, not one program-maker

- The spike first made both from one function in the SDK,
  `agentProgram(provider)` and `typedAgentProgram(provider, schema)`. That
  was **rejected** on 2026-10-30, and the spike's lean for it is kept in
  experiment 169, marked wrong.
- Why: every program here is its own package with one `defineProgram` named
  after itself. A function that returns programs is a second way to make
  one, and it hid what each program is.
- The SDK holds the parts a program is built from: the conversation machine
  and its `kind`, the flags, inputs and outputs, `chat`, the fakes. Not
  ready-made programs. Other programs that live in the SDK today (`acp`,
  `shell/small.ts`) are tracker #93.

## The typed answer: a JSON Schema in, a decode at the stage

- The stage passes a JSON Schema on `--schema`, made from its own Effect
  schema. That is what the makers take already: `claude -p --json-schema`,
  `codex exec --output-schema`.
- The program's `answer` is plain JSON. The stage decodes it with its own
  Effect schema on arrival, Elm's own answer for a value from outside
  (`Json.Decode.decodeValue`).
- A misfit is a typed failure the stage must handle: "the answer did not fit
  the schema: ..." with the schema's own message. In sort it takes the same
  branch today's `null` answer takes, plus the reason.
- The decode also catches what JSON Schema cannot say, such as a ticket that
  must start with `#`.
- The spike's other way, the stage's schema given to the program at
  definition (its option C), needed a program made per stage. It was
  dropped with the program-maker.

## A stage starts an agent by name

- `programs/` sits above the pipeline in `layer-rules.json`, so a stage
  cannot import `claude`. It does not need to: a stage starts a child by
  name through the host, as `hosted/stage.ts` starts its agent and
  `hosted/lane.ts` starts each stage today (`self.startChild(name, ...)`).
  This is Erlang's supervisor `start_child`.
- The app is the one place that imports programs, and hands the host its
  list. The stage needs only its own schema, which `decoder` holds.
- In tests, the sort stage with a real program lives in `programs/*/src/`;
  the pipeline's own test runs the sort machine with the decoder and no
  program.

## What stays

- **The `Agents` service is still the only way to a maker's SDK.** The
  programs are thin, on top of it. A program never imports a maker's SDK;
  the adapters do, as today.

## What changes

- **The Draft move.** Today Draft is a Sub over the agent's stream
  (`packages/pipeline/src/primitives.ts`). It becomes: start the agent
  program as a child run, hear its outputs mapped into the stage's Msgs,
  decode `answer`. The parent machine does not change; only the line that
  makes its runner does. That is Elm's shape for a child (`Cmd.map`).
- **A run learns whether a person is watching**, proposed and not built: the
  host passes one bit, `tty`, true when tsh started the run in the
  foreground and no pipe feeds its `prompt`. The host draws a tile only then.
  The program never reads it: it acts the same either way.
- **Child runs go in the job table**, marked with their parent, so `jobs`
  lists them and `fg %3` attaches a tile to a running child, as `tmux
  attach` does. Not built.

## Cases

| Case | What happens |
|---|---|
| `claude` typed alone in tsh | a tile with the conversation and a prompt box |
| `codex` in the middle of a pipe | no tile; prompts come in, outputs go down the pipe |
| review starts `claude` by name as a child run | no tile; review decodes `answer` with `ReviewAnswer`; a misfit ends it stuck |
| the host restarts mid-turn | the kept session opens again, and the cut-off prompt and every prompt read behind it run again, in order (`resent`) |
| a child started again after its turn ended | no second turn: the runner hands on the kept end |
| a person attaches to a running build agent | the same tile as by hand, joined mid-conversation (needs children in the job table) |
| `cancel 1` sent right after `prompt` | right in 50 of 50 runs on both providers: a cancel by turn number does not depend on order, as LSP cancels by id |
| `cancel now` sent right after `prompt` | wrong in 50 of 50: read before the turn began, or after it ended, it cancels nothing or the wrong turn. It stays for a person at a tile; a stage always cancels by number |

## What experiment 169 measured

- **Cost per stage:** about 0.8 ms more per turn than calling `Agents.run`
  straight, on fake providers. A real turn takes seconds, so this is noise.
- **Live:** one tiny prompt each. Claude (`haiku`) answered in 3.5 s for
  $0.0029; Codex (`gpt-6-luna`, on a plan) in 3.9 s, $0 shown.
- **Size:** two 40-line program files; about 420 lines for what they share,
  130 for the runner, 185 for the conversation, 90 for the fakes, 60 for the
  decoder.
- **One gap, the same on both providers:** nobody can answer a permission ask
  yet (tracker #90, one way to ask a person). The other gap the spike named, a
  turn with no answer schema, closed in the review: no schema now reaches a
  provider as no schema (not run live).

## What it costs

- One more program start per stage, about 0.8 ms a turn.
- A pipe can no longer check an answer's shape at the line: `ended.answer` is
  JSON on every agent program, and the check is at the stage.
- A save per prompt read: the line of prompts is the kept conversation, so a
  kill loses none (experiment 169, section 14). The one mailbox holds a prompt
  only until it is read, and `cancel` is a control input beside it.
- A new provider is its adapter, a row in `Provider`, and one more package.

## How sure

- **80% on the shape.** It is the owner's ruling and the repo's pattern, and
  the spike ran it on both providers.
- **75% that nothing else is missing.** The doubts, and what would settle
  each:
  - The host side (the `tty` bit, children in the job table, attach) is not
    built. Building it in tsh would show whether a child tile is cheap.
  - Warm sessions: each turn is a fresh provider process. A chat tile may
    want one kept warm across turns, which is the `acp` program's shape.
  - The `--schema` path never ran on a real provider; the live run was on the
    spike's first shape.

## What this cannot tell us yet

- Whether a person uses the chat window more than the makers' own apps. Only
  using it on real tickets would show that.
- Whether the two programs drift apart once each gets features of its own.
