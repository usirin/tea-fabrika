# An agent is a program: `claude` and `codex`, at parity

Proposed 2026-10-29. Each agent maker gets a tea program of its own, `claude`
and `codex`, built together so neither one's shape leaks into the other. A
person runs one by hand and gets a chat window. A stage starts one as a child
run and hears its typed answer. Experiment 169 is the spike (tracker #87).

```ts
// A sketch. Both programs have one shape; only the provider row differs.
const Agent = {
	inputs: {
		prompt: input(Schema.String),          // one turn
		allow: input(AskId), refuse: input(AskId), // a permission ask, answered once
		cancel: input(Schema.Null),            // the running turn stops
	},
	outputs: {
		said: output(Schema.String),           // the agent's text, as it streams
		tool: output(ToolCall),                // a tool call started or settled
		ask: output(Ask),                      // a permission ask, waiting
		answer: output(Schema.Unknown),        // the typed answer; the stage reads it with its own schema
		ended: output(Ended),                  // end_turn, cancelled, failed; tokens and time
	},
};

// By hand, in tsh: a tile opens with the conversation and a prompt box.
//   claude --model haiku
// In a pipe: no tile, outputs go down the pipe.
//   ticket 41 --brief | claude --schema review | review-gate
// From a stage: a child run, its answer heard as a message.
//   yield* start(codex, {schema: BuildAnswer, folder}, {prompt})
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
- **Both at once, for parity.** Building one first would make its maker's
  shape the program's shape. The spike builds both and counts every place
  they differ.

## What stays

- **The `Agents` service is still the only way to a maker's SDK.** The
  programs are thin, on top of it. A program never imports a maker's SDK;
  the adapters do, as today.
- **`acp` stays** (`packages/fabrika/src/agents/acp/program.ts`). It is
  already an agent as a tea program, and the spike starts from it.

## What changes

- **The Draft move.** Today Draft is a Sub over the agent's stream
  (`packages/pipeline/src/primitives.ts`). It becomes: start the agent
  program as a child run, listen to its outputs, hear `answer` and `ended`.
  The lane already starts each stage as a child run
  ([a ticket runs from the app](./a-ticket-runs-from-the-app.md)), so a
  stage starting an agent is the same move one level down.
- **A run learns whether a person is watching.** That is `isatty` for us:
  is a tile attached at the start. How the host says it is read from the
  code in the spike.

## Cases

| Case | What happens |
|---|---|
| `claude` typed alone in tsh | a tile with the conversation and a prompt box |
| `codex` in the middle of a pipe | no tile; prompts come in, outputs go down the pipe |
| review starts `claude` as a child run | no tile; review hears `answer`, checks it against `ReviewAnswer` |
| the host restarts mid-turn | the kept session opens again, and the cut-off prompt is sent again, as `acp` does today |
| a person attaches to a running build agent | the same tile as by hand, joined mid-conversation |
| `cancel` sent right after `prompt` | must arrive in that order: needs the one mailbox (PR 166) first |

## What it costs

- One more program start per stage. The spike measures how long.
- The answer crosses the program boundary as a plain value, so the stage
  checks it against its schema on arrival. A misfit must stay as loud as
  today's `null`. The spike tries this against handing the schema in at the
  start.
- The one mailbox (draft PR 166) lands first, or `prompt` and `cancel` can
  arrive out of order.

## How sure

- **75%.** The doubts, each one a measurement in experiment 169:
  - whether the typed answer stays impossible to miss across the boundary;
  - whether the start cost per stage is small next to an agent turn;
  - how many differences between Claude and Codex the program can hide.

## What this cannot tell us yet

- Whether a person uses the chat window more than the makers' own apps. Only
  using it on real tickets would show that.
- Whether one program with two provider rows is better than two programs.
  The spike says which it built and why.
