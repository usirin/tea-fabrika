# An agent run keeps its words in the trace, the way Langfuse does

Proposed 2026-10-29. An agent run is a conversation plus tool calls. Today its
spans keep only names: `chat`, `execute_tool Read`. The proposal is that they
also keep the words: each prompt, each reply, and each tool's input and
result. The words live in the job's own record, beside its spans, and they are
the one part of that record a person can wipe.

```ts
// A sketch. One tool span of a review run, as the JobRecord keeps it.
spans: { span: "7f2c…", name: "execute_tool Read", service: "review", start: 812, end: 840,
         tags: { "gen_ai.tool.name": "Read", "gen_ai.tool.call.id": "toolu_01…" } }
words: { span: "7f2c…",
         input:  { file_path: "packages/pipeline/src/stages/review/reviewer.ts" },
         output: "import {Effect} from \"effect\";\n…" }

// A person wipes one span's words. The span stays; the words become a row that says so.
words: { span: "7f2c…", wiped: { by: "owner", at: 1730000000, why: "a key in .env was read" } }
```

## Why

- **The words are what a person reads.** "Why did review send it back?" is
  answered by what the agent read and said, not by `execute_tool Read`.
- **tea already writes them.** `agentSpans` in `@demlik/tea/otel` puts every
  input and output on its spans, in Langfuse's names
  (`langfuse.observation.input`, `langfuse.observation.output`). Our harness
  turns each one into `[not exported]` before export
  (`packages/fabrika/src/agents/trace/agent.ts`, `mask: () => KEPT_OUT`). So
  this is mostly a change to one option, not new tracing.
- **Every way we run an agent already makes spans.** Claude through the Agent
  SDK's message stream (`sdk-events.ts`), ACP agents through `session/update`
  (`acp/spans.ts`). No Claude Code hooks are needed: the stream already says
  when each tool call starts and ends. Codex's `codex exec --json` events
  carry each tool call too; whether its runs reach `agentSpans` today is
  checked in the first change.
- **Langfuse works this way.** A span holds its input and output, and the UI
  shows them in place
  ([masking](https://langfuse.com/docs/observability/features/masking)).
  OpenTelemetry's GenAI conventions name the same content
  (`gen_ai.input.messages`, `gen_ai.output.messages`,
  `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`) and say a person
  must opt in to it
  ([GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md#content-capture-configuration)).
  We are the person, so the record opts in.

## The trace program still knows no program

- trace draws any span's tags the way it does today.
- It also knows two public names, Langfuse's input and output, and draws them
  as a conversation. A public convention is not a program: any agent traced
  by tea, or by anything that writes Langfuse's names, shows the same way.
- Nothing in trace imports from `agents/`.

## Where the words live

- **In the JobRecord, in a `words` table beside `spans`,** keyed by span id.
  One job's trace is still read from one place, so the conversation sits in
  order with the tsh line, the ticket and the review that started it
  ([a JobRecord holds each host job](./a-job-record-holds-its-trace.md)).
- **Not one Durable Object per agent run.** That would put one job's trace in
  two places, and every read would join them. It pays off only if one
  conversation outlives its job, for example a session resumed days later by
  another job. No real ticket has shown that yet.
- **A value too big for a row goes to `Blobs`.** A Durable Object row stops at
  2 MB ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
  A value over a cap (64 KB, a guess to measure) is written to `Blobs` by its
  hash, and the row keeps `{blob: "sha256:…", size}`. Langfuse does the same
  with media: it uploads it to object storage and leaves a reference string
  in the trace
  ([multi-modality](https://langfuse.com/docs/observability/features/multi-modality)).
  This happens where the record takes spans in, not inside tea's `mask`,
  which runs synchronously and cannot write.

## Secrets

The record keeps everything forever, so a secret that gets in stays in. Two
guards, and neither is enough alone.

- **Scrub what we know.** The harness's `mask` replaces the text of every
  `Redacted` value the run holds
  ([secrets are Redacted](./secrets-are-redacted.md)) with `[redacted]`, then
  runs tea's own `maskBase64DataUris`. This catches the keys fabrika handed
  the agent.
- **Wipe what we did not know.** A key the agent read from a file (`.env`,
  a config) is not one fabrika holds, so the scrub misses it. That is why the
  words sit in their own table: it is the one table in the JobRecord whose
  rows can be cleared. A wipe empties a span's input and output, deletes any
  blob it points to, and leaves the row with who wiped it, when and why. The
  spans, steps and facts stay untouched, so "nothing is deleted" still holds
  for everything a machine decided on.
- **Only a person wipes.** No agent is offered a wipe, for the same reason no
  agent answers a question the machine put to a person.

| Case | What happens |
|---|---|
| The agent echoes a key fabrika gave it | the scrub writes `[redacted]` before the span leaves the host |
| The agent reads a key from `.env` | it is kept; a person wipes that span's words |
| A tool returns a 5 MB log | `Blobs`, with a pointer in the row |
| A tool returns a screenshot as base64 | tea's default mask drops it before export |
| trace opens a Codex run | the same conversation view, if Codex's events reach `agentSpans` |

## What it costs

- The rule "spans carry names and ids, never words" flips. Its tests flip
  with it: `KEPT_OUT` in `agents/trace/agent.ts`, the secret checks in
  `pipeline/src/trace/sdk-events.test.ts` and `acp/program.test.ts`. They
  become "a known secret never reaches a span" instead of "no words do".
- A `words` table, a wipe that only a person can call, and the `Blobs` move
  for big values.
- More bytes per job. A review run of a few dozen tool calls is a few MB of
  words. A Durable Object holds 10 GB, so this is far from the limit, but the
  `Blobs` bill grows with it.

## How sure

- **80% on the shape** (words in the trace, in their own table, with a wipe).
  The doubt: whether a person ever wipes in practice, or a leaked key is
  rotated instead and the wipe is never used. A few weeks of real runs would
  show it.
- **60% on Langfuse's names over OpenTelemetry's `gen_ai.*` names.** tea
  writes Langfuse's today, and the GenAI conventions are still marked
  Development. Which one trace reads should follow what tea writes; that is
  a question for tea, not for this repo.
- **The 64 KB cap is a guess.** The first real job's sizes would set it.

## What this cannot tell us

- Whether reading the words in a tile is better than opening the agent's own
  transcript. No one has used either view on a real ticket yet.
- How often the scrub misses something. Only planted secrets in a few real
  runs would show that.
- Whether Codex's tool calls already reach the trace. That is read from the
  code in the first change, not guessed here.
