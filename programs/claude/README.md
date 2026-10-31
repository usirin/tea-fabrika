# claude: `@tea-fabrika/claude`

Claude Code as a tea program, on the `Agents` service. Each prompt is a turn on one session,
until the `prompt` input closes. A tile that keeps it open is a chat; a parent that tells one
prompt and closes it gets `claude -p`. The design and its numbers are in
[experiment 169](../../experiments/169-agents-are-programs.md).

```ts
// src/index.ts: one program, wired from the parts it shares with `codex`
export const claude = defineProgram({
	name: "claude",
	flags, inputs, outputs,                         // @kampus/fabrika/agents/program
	machines: {conversation: conversationKind},
	view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
	main: (io) => chat("claude", io),
});

// tsh> claude --folder /work/copy prompt="what is 2+3?"
// started {provider: "claude", session: "claude/…", resumed: false, resent: 0}
// said {turn: 1, text: "5"}
// ended {turn: 1, stop: "end_turn", answer: …, usd: 0.0029, requests: 3, …}
```

- **The answer is plain JSON.** With `--schema <JSON Schema>`, as `claude -p --json-schema`
  takes one, Claude is held to it and a misfit is `null`. A stage decodes the answer with its own
  Effect schema when it arrives (`decoder` in `@kampus/pipeline/decoder`), so a check JSON
  Schema cannot say still holds.
- **What differs from `codex`** is data only: Claude says its dollars and its request count, and
  holds a `--usd` cap.
- **Inputs are `prompt` and `cancel`.** A permission ask is refused at once and shown on `ask`;
  no input answers one ([one way to ask a person](../../docs/direction/one-ask-and-one-meter.md),
  proposed).
- **Not in the app yet.** It has no window, so the app does not list it: a stage starts it as a
  child run, and the tests run it. Its chat window is a later change.

| File | What it is |
|---|---|
| `src/index.ts` | The program. |
| `src/claude.test.ts` | The program on its fake provider: outputs, resume, cancel, a cap, its inputs, a restart, the answer. |
| `src/sort.test.ts` | The real sort stage with `claude` as its child run, the answer decoded, and a misfit. |
