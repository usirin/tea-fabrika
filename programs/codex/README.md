# codex: `@tea-fabrika/codex`

Codex as a tea program, on the `Agents` service. Each prompt is a turn on one session, until the
`prompt` input closes. A tile that keeps it open is a chat; a parent that tells one prompt and
closes it gets `codex exec`. The design and its numbers are in
[experiment 169](../../experiments/169-agents-are-programs.md).

```ts
// src/index.ts: one program, wired from the parts it shares with `claude`
export const codex = defineProgram({
	name: "codex",
	flags, inputs, outputs,                         // @kampus/fabrika-old/agents/program
	machines: {conversation: conversationKind},
	view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
	main: (io) => chat("codex", io),
});

// start(codex, {folder: "/work/copy", ...}, listeners, keeping)
// tell(run, "prompt", "what is 2+3?")
// started {provider: "codex", session: "codex/…", resumed: false, resent: 0}
// said {turn: 1, text: "5"}
// ended {turn: 1, stop: "end_turn", answer: …, usd: null, requests: null, …}
```

- **The answer is plain JSON.** With `--schema <JSON Schema>`, as `codex exec --output-schema`
  takes one, Codex is held to it and a misfit is `null`, with what it gave kept beside it as
  `misfit`. A stage decodes the answer with its own
  Effect schema when it arrives (`decoder` in `@kampus/pipeline/decoder`), so a check JSON
  Schema cannot say still holds.
- **What differs from `claude`** is data only: Codex says no dollars and no request count, says
  its answer again as a `said`, and fails a turn given a `--usd` cap at its start.
- **A kill loses no prompt it read.** Each is kept in the conversation before the next is read, and
  a start runs every one not ended, in order (`resent`).
- **Inputs are `prompt` and `cancel`.** A permission ask is refused at once and shown on `ask`;
  no input answers one ([one way to ask a person](../../docs/direction/one-ask-and-one-meter.md),
  proposed).
- **Not in the app yet.** It has no window, so the app does not list it: a stage starts it as a
  child run, and the tests run it. Its chat window is a later change.

| File | What it is |
|---|---|
| `src/index.ts` | The program. |
| `src/codex.test.ts` | The program on its fake provider: outputs, resume, cancel, a cap, its inputs, a restart, the answer. |
| `src/sort.test.ts` | The real sort stage with `codex` as its child run, the answer decoded, and a misfit. |
