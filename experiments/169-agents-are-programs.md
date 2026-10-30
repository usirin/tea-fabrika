# 169: `claude` and `codex` as tea programs

**Answer: yes. `claude` and `codex` are two programs, one package each in
`programs/`, each one plain `defineProgram` named after itself.** They share
their parts from the SDK: the kept conversation, the flags, inputs and outputs,
and `chat`, the main both run. Both ran the same tests on fake providers, and
one tiny live prompt each answered `{sum: 5}` for about $0.003 in all. A
pipeline stage (the real sort machine, unchanged) started the program as a
child run, decoded its plain answer with its own schema, and heard the same
Draft Msgs it hears today. A program costs about 0.8 ms a turn over
`Agents.run` on fake providers. Two gaps showed up, the same on both
providers: nobody can answer a permission ask, and a turn cannot run without an
answer schema.

The first version of this spike made both programs from one function
(`agentProgram(provider)`, `typedAgentProgram(provider, schema)`). The owner
rejected that API on 2026-10-30; section 11 says why and what replaced it.

```ts
// The whole idea: two programs, each its own package, wiring the same parts.
// programs/claude/src/index.ts  (programs/codex/src/index.ts is the same, with "codex")
export const claude = defineProgram({
	name: "claude",
	description: "Claude Code as a program: each prompt is a turn on one session, ...",
	flags, inputs, outputs,                         // from @kampus/fabrika/agents/program
	machines: {conversation: conversationKind},
	view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
	main: (io) => chat("claude", io),
});

// flags:   folder, session, model, effort, system, usd, tools, seconds, schema (a JSON Schema)
// inputs:  prompt (text), allow / refuse (an ask id), cancel (a turn number, or "now")
// outputs: started {provider, session, resumed, resent}
//          said {turn, text}   tool {turn, id, title, status}   ask {turn, id, title, answer}
//          ended {turn, stop, answer: Json | null, tokens, counted, usd, requests, ms, error}

// A stage holds its own schema: it hands the program the JSON Schema, and decodes the answer.
const sorted = decoder(SortReply);   // @kampus/pipeline/decoder
const runner = programRunner({name: "sort", program: claude, agents, keeping,
	flags: (run) => ({...settings, schema: sorted.schema})});
run(sort, {interpret, terminal,
	subscribe: {sort_run: (sub) => runner(sub.deps.run).pipe(Stream.map(sorted.decode))}});
// A misfit is `sort_failed`, "the answer did not fit the schema: ...": the stage ends stuck.
```

## Who did what

- **This repo's code:** the two programs (`programs/claude`, `programs/codex`),
  what they share (`packages/fabrika/src/agents/program/`: the kept
  conversation, the flags, inputs and outputs, `chat`, the child-run runner,
  the two fake providers), the stage's `decoder`
  (`packages/pipeline/src/decoder.ts`), the tests, the conversation's laws (it
  is kept, and an ended turn never changes), the stage tests
  (`programs/*/src/sort.test.ts`) and the script. No real stage changed.
- **Claude:** Claude Agent SDK through our adapter, model `haiku`, effort
  `low`, capped at $0.10, signed in as in 156.
- **Codex:** codex-cli through our adapter on the laptop's ChatGPT plan, model
  `gpt-6-luna`, effort `low`.
- **Today's fabrika:** not used.

## 1. The Elm answer first

An agent run is still a **Sub**, as in 156. What changes is who answers the
Sub: not the service straight away, but a program run, started as a child.
That is Elm's own shape for a child: the parent starts it, sends it Msgs, and
hears its outputs mapped into the parent's Msgs (`Html.map`, `Cmd.map`). The
parent machine does not change. Only the line that makes its runner does:

```ts
// before (156)
const runner = agentRunner("sort", agents, turnOf);
// after (169)
const runner = programRunner({name: "sort", program: claude, agents, flags, keeping});
const sub = (run: DraftRun) => runner(run).pipe(Stream.map(decoder(SortReply).decode));
// both: (run: DraftRun) => Stream<sort_tool | sort_finished | sort_failed>
```

Nothing new is added to tea. The decode is Elm's own answer for a value from
outside: it comes in as JSON and is decoded at the boundary into a value or an
error the program must handle (`Json.Decode.decodeValue`).

## 2. The program

The program is a kept machine whose state is the conversation, and whose view
is that state. Its main reads inputs and runs one turn per prompt.

```ts
interface TurnSeen { n: number; prompt: string; said: string[]; tools: Tool[]; asks: Ask[]; end: End | null }
interface Conversation { provider: "claude" | "codex"; session: string; told: number; turns: TurnSeen[] }
// Msgs: opened, told, began, heard (one Update from the service), ended
```

- **Prompts queue.** Each prompt is a turn, run in order on one session.
  Since the port to the mailbox (12), the run's mailbox is that queue.
- **The input closing ends it.** A tile keeps `prompt` open: a chat. A parent
  tells one prompt and closes it: that is `claude -p` or `codex exec`. The
  program does the same thing in both.
- **Restart.** The conversation is kept. A turn cut off by a kill is sent
  again on start (`resent` counts them). A known session id resumes (`resumed`).
- **Cancel.** `cancel now` stops whatever turn runs when it is read. `cancel 2`
  stops turn 2 now if it runs, or when it comes up. `cancel` is a control
  input (12), so it is read at once while a turn runs. Cancel by id is how LSP
  does it (`$/cancelRequest`,
  https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#cancelRequest).
- **The provider is the name.** BusyBox is one binary that acts by the name it is
  started under (https://busybox.net/about.html). Here one `build` function
  made `claude` and `codex`, so neither was shaped around the other.
  **Rejected (2026-10-30), see 11:** each program is now its own package with
  one `defineProgram`; they share parts, not a maker.

## 3. Parity

Every difference between the two programs, from the tests on the fake providers
(which say a turn the way each real adapter does) and the live run. **Hidden**
means the program shows both the same way. **Shown** means a person or a stage
sees the difference.

| Part | claude | codex | Hidden or shown |
|---|---|---|---|
| Inputs | prompt, allow, refuse, cancel | the same | the same |
| `--usd` limit | held | refused at turn start: `failed`, `cannot_limit` | shown, on purpose |
| Outputs | started, said, tool, ended | the same, plus the answer again as a `said` | shown |
| Typed answer, how it comes | a `StructuredOutput` tool call, then the SDK's typed field | the last message, as JSON text | hidden in `ended.answer`; the tool call and the extra `said` are shown |
| Session resume | the SDK's session id | the thread id | hidden by the service |
| Permission asks | never sent (`dontAsk`) | never sent (approvals `never`) | the same: `allow` and `refuse` answer `not_waiting` on both |
| Cancel | interrupt, then the service's stop | the same | hidden |
| Usage | tokens, usd, requests | tokens; usd and requests are `null` | shown |
| `counted` | `turn` | `turn` | the same |

## 4. The live run

One turn each, `What is 2 + 3?` with the answer `{sum: Int}`, on the first
shape (the stage's schema at definition, way C in 5):

| | claude (haiku) | codex (gpt-6-luna) |
|---|---|---|
| Answer | `{sum: 5}` | `{sum: 5}` |
| Outputs | started, said, tool StructuredOutput x2, ended | started, said, ended |
| Tokens in / cached / out | 20,809 / 7,488 / 62 | 9,915 / 0 / 15 |
| Requests | 3 | null |
| Time | 3.5 s | 3.9 s |
| Cost | $0.0029 | null (ChatGPT plan, $0) |

## 5. The typed answer across the boundary

**Now (2026-10-30):** way B plus a decode at the stage. The program takes a
JSON Schema on `--schema`, as `claude -p --json-schema` and `codex exec
--output-schema` do, and its `ended.answer` is a plain JSON value. The stage
holds its own Effect schema: `decoder(schema)` gives the JSON Schema to hand
in, and `decode`, which reads each Draft Msg's answer by that Effect schema
when it arrives. A misfit becomes `<name>_failed` with the schema's own words,
so the stage handles it as it handles any failed draft. Today's Draft already
fails on a `null` answer ("the answer did not fit the schema"); the decode
fails the same way, says why, and also catches what JSON Schema cannot say.

```ts
// packages/pipeline/src/decoder.ts
export const decoder = <A>(answer: Schema.Codec<A, unknown>) => ({
	schema: /* jsonSchema(answer), as the --schema flag holds it */,
	decode: <N extends string>(msg: DraftMsg<N, unknown>): DraftMsg<N, A> => /* ... */,
});

sorted.decode({type: "sort_finished", output: {sort: {answer: "duplicate", of: 4, why}}, ...})
// -> the same Msg, its output typed SortReply
sorted.decode({type: "sort_finished", output: {sort: {answer: "duplicate", of: "four", ...}}, ...})
// -> {type: "sort_failed", error: "the answer did not fit the schema: ...", spend, ...}
```

The same three answers as below, now:

- **Right:** the program hands on the value; the decode types it, and the stage goes on.
- **Wrong label:** the program hands on `null`; the decode makes it `sort_failed`, and the stage
  ends `stuck`, `draft_failed`.
- **Ticket without `#`:** the program hands on the value, its filter lost in JSON Schema; the
  decode makes it `sort_failed`, naming the filter (`decoder.test.ts`).

The record below is the first version's, kept as it ran.

Three ways, each tested on both providers with three answers: a right one, one
with a wrong label, and one with a ticket that does not start with `#` (a
check JSON Schema cannot say).

```ts
// A: no schema. The program hands on the agent's last JSON value; the stage checks it.
agentProgram("claude")
// B: a JSON Schema as a flag. The provider is held to it, and the program reads by it.
agentProgram("claude"), flags: {answer: JSON.stringify(jsonSchemaOf(Reply))}
// C: the stage's own Effect schema, at definition. `ended.answer` is `Reply | null`.
typedAgentProgram("claude", Reply)
```

| Way | right | wrong label | ticket without `#` |
|---|---|---|---|
| A | passes | passes (the stage must catch it) | passes |
| B | passes | `null` | **passes**: the filter is lost in JSON Schema |
| C | passes | `null` | `null` |

- **C is the one to use for a stage.** A wrong answer cannot be sent, and a
  pipe checks the shapes with `fit`: C fits C, A does not fit C.
  **Wrong (2026-10-30):** C puts the stage's schema into the program's
  definition, so each stage needs a program made for it, and a program is
  code built by a function, not a package with one `defineProgram`. The owner
  rejected it. B with the stage's decode keeps every check C kept (the table
  above), with one program for every stage and for a person at tsh.
- **B is for a person at tsh**, who has no Effect schema to hand over. What a
  schema loses on the way to JSON Schema is lost here too. It is now the one
  way, for a stage too, with the stage's decode after it.

## 6. Order of prompt and cancel

Draft PR 166 (experiment 164) fixes this in tea with one mailbox. It is not
merged, and this spike does not build it. What the spike found: a cancel that
names its turn needs no mailbox for these cases. 50 trials per case per provider,
fake providers:

| Case | Meant | Got (both providers, 50 of 50) |
|---|---|---|
| `now`: a turn that hangs, `cancel now`, a second prompt, told at once | 1 cancelled, 2 runs | **nothing ended**: the cancel was read before turn 1 began, and turn 1 hangs |
| `numbered`: the same with `cancel 1` | 1 cancelled, 2 runs | right |
| `late_now`: a quick turn, a hanging turn, `cancel now` read after turn 1 ended | 1 ends, 2 goes on | **turn 2 cancelled**: the wrong turn |
| `late_numbered`: the same with `cancel 1` | 1 ends, 2 goes on | right |

- A cancel by number commutes with the prompt: the order the two inputs are
  read in does not change the answer. That is why LSP cancels by id.
- `cancel now` stays for a person at a tile, who means "what I see running".
  A stage should always cancel by number.
- **Again on the mailbox (12):** PR 195 merged the mailbox. The same 50
  trials per case per provider, on the ported programs, gave the same four
  answers, 50 of 50. A control cancel skips the order on purpose, so the
  mailbox does not fix `cancel now`; the number does.

## 7. Cost per stage

One turn that ends at once, n = 300, memory storage, one process, ms:

| Provider | `Agents.run` p50 / p95 | program call p50 / p95 | child run from a Draft p50 / p95 |
|---|---|---|---|
| claude | 0.135 / 0.228 | 1.006 / 1.968 | 0.892 / 1.769 |
| codex | 0.079 / 0.096 | 0.884 / 1.609 | 0.829 / 1.56 |

- About 0.8 ms more per turn. A real turn takes seconds, so this is noise.
- Not measured: storage on the real ledger. Each turn keeps 4 or more steps
  (opened or told, began, each heard, ended). 166 put a record call at 0.25 to
  0.5 ms here; across a network the round trips are what would count.

## 8. One stage end to end

`programs/claude/src/sort.test.ts` and `programs/codex/src/sort.test.ts` run
the real sort machine, its `sort_run` Sub answered by `claude` or `codex`, the
answer decoded by `decoder(SortReply)`. A program sits above the pipeline in
`layer-rules.json`, so this test lives with each program, not in the pipeline
(it was `packages/pipeline/src/agent-program.test.ts`). The pipeline keeps the
decode's own test, on the same sort machine with no program
(`packages/pipeline/src/decoder.test.ts`).

- The first answer says "duplicate of 40", a ticket the stage never listed.
  Sort's Check sends it back.
- The second says "duplicate of 4". It passes; the stage writes a comment, a
  label and a close, and ends `done`.
- Two child runs, `sort:12/1` and `sort:12/2`. The second resumes the first
  one's session (`fake-own-1`).
- A misfit (`of: "four"`): the program hands on `null`, the decode makes it
  `sort_failed`, and the stage ends `stuck`, `draft_failed`, writing nothing,
  its problem "the answer did not fit the schema: ...".
- The same on both providers.

## 9. Does a person watch? The isatty question

A Unix program asks `isatty(1)` to know if a person reads it, and acts the
same either way except for how it draws
(https://pubs.opengroup.org/onlinepubs/9799919799/functions/isatty.html).

What the host does today:

- tsh draws the view of a job in the foreground, and of each stage of a
  foreground pipe (`tracker | ticket | runs` draws all three).
- A run started with `start` inside another program's main is not in the job
  table. It gets no tile, and nobody can attach to it later.
- Nothing tells a program whether a person watches.

The smallest change, proposed and not built:

```ts
// sketch: the host passes one bit, as a shell passes a terminal.
interface Started { readonly tty: boolean }
// tty = tsh started it in the foreground, and no pipe feeds its `prompt`.
// The host draws the view only when tty is true. The program never reads it.
```

- **The program needs no bit at all.** It acts the same in both cases, as 2
  says. The bit is for the host: draw a tile or not.
- **Child runs go in the job table**, marked with their parent, so `jobs`
  lists them and `fg %3` attaches a tile to a running child, as `tmux attach`
  does to a session that ran with no client.

## 10. Recommendation

**Two programs, one package each: `programs/claude` and `programs/codex`, each
one `defineProgram`, wiring the same parts from `@kampus/fabrika/agents/program`.
A stage hands its JSON Schema on `--schema` and decodes the plain answer with
its own schema (`decoder`).**

The first recommendation, kept as it was, and **wrong**: "One definition, two
entries: `build({provider, ...})` makes `claude` and `codex`, with the
provider as the name." The owner rejected it (11).

- **Why:** the differences in 3 are all data (what the service holds, what
  usage a provider reports), not shape, so both programs wire the same parts,
  and parity shows in two short files side by side. Every other program here
  is its own package named after itself; these are too. The decode at the
  stage keeps every check the stage's schema has, which way C kept, without
  a program made per stage.
- **Cost:** two 35-line program files that repeat each other on purpose; 360
  lines for what they share (`chat` and the shapes), 100 for the runner, 180
  for the conversation, 80 for the fakes, 50 for the decoder. The program
  tests are written twice, one file per program. 0.8 ms a turn. A pipe can no
  longer check an answer's shape at the line with `fit`: `ended.answer` is
  JSON on every agent program, and the check happens at the stage. A new
  provider is its adapter, a row in `Provider`, and one more package.
- **How sure:** 80% for the shape (it is the owner's ruling and the repo's
  pattern); 75% that nothing else is missing. The doubts, and what would settle each:
  - The host side (the `tty` bit, children in the job table, attach) is not
    built. Building it in tsh would show whether a child tile is really
    cheap.
  - Warm sessions: each turn here is a fresh provider process. A chat tile may
    want one process kept warm across turns, which is the ACP program's shape.
    A run where a person chats ten turns would show if it matters.
  - Ledger storage per turn is not measured (7).

Two gaps to fix in the service, not in the program, the same on both providers:

- **No permission asks.** Neither adapter ever sends `asked`, and the service
  has no path to answer one. `allow` and `refuse` are wired but dead.
  They stay as they are until the proposed direction note in
  [PR 194](https://github.com/usirin/tea-fabrika/pull/194) settles them as ledger facts.
- **No chat turn without a schema.** `Turn.answer` is required, and
  `Schema.Json` makes the JSON Schema `{}`. Proposal: `answer: null` in `Turn`
  for a plain chat turn.

## 11. The rework (2026-10-30): programs live in `programs/`

The owner rejected the first API: `agentProgram(provider)`,
`typedAgentProgram(provider, schema, name)`, `claudeProgram` and
`codexProgram`, all made inside the SDK by one function.

- **Why:** every other program in this repo is its own package in
  `programs/<name>/`, with one `export const <name> = defineProgram({...})`
  named after itself (`programs/trace` is the model). A function that returns
  a program hides the program behind a maker, and a program made per stage
  schema (way C) is not something a person can type at tsh.
- **What replaced it:**
  - `programs/claude` and `programs/codex`, each one `defineProgram`. Some
    lines repeat between the two on purpose: parity is visible in the code.
  - What they share stays in the SDK as parts, the way `trace` uses `kind`
    and its machine from `@kampus/fabrika`: `Conversation`, `conversation` and
    `conversationKind`; `flags`, `inputs`, `outputs`; `chat`, the main;
    `programRunner`; the fake providers. No function there returns a program.
  - Way C is gone. The program takes `--schema` (a JSON Schema) and hands on
    plain JSON; the stage decodes it with its own schema (`decoder`, 5).
- **What moved:** the program tests went from
  `packages/fabrika/src/agents/program/program.test.ts` to
  `programs/claude/src/claude.test.ts` and `programs/codex/src/codex.test.ts`.
  The check that the fakes match each adapter stayed in the SDK
  (`fakes.test.ts`). The stage test went to each program (8).
- **What did not change:** the turn loop, the conversation, the runner and the
  fakes are the same code, so the measurements in 6 and 7 stand. The script
  ran `order 5` and `cost 20` on the new shape with keys unset: the same order
  answers as the saved 50, and costs in the same range. The saved results file
  is the first version's, unchanged.

## 12. The port to one mailbox (2026-10-30)

[PR 195](https://github.com/usirin/tea-fabrika/pull/195) gave every program
run one mailbox, served by `serve` with one handler per input. `chat` read
each input as its own stream before; it serves now.

```ts
cancel: input(Cancel, "...", {control: true}),        // its own bound of 16, beside the order

const handlers = {
	prompt: (prompt) => told(prompt).pipe(Effect.andThen(runTurn)),  // the turn runs in the handler
	allow: notWaiting,
	refuse: notWaiting,
	cancel: fork(cancel),                              // read at once, while a turn runs
};
yield* serve(handlers, {until: ["prompt"]});
```

- **The mailbox is the line of prompts.** The turn runs inside the `prompt`
  handler, as tsh runs a line. A prompt told during a turn waits in the
  mailbox, and `mailbox()` shows it. Past the program's capacity (1000) a
  tell fails `MailboxFull`. The program's own unbounded queue is gone.
- **`cancel` is a control input.** It must be read while a turn runs, and
  the turn now runs inside `serve`. It is tsh's Ctrl-C again.
- **Why not acp's shape.** 195 kept acp's cancel ordinary: its handlers only
  queue work, and the turns run beside `serve`. That works, but it keeps a
  second queue with no bound, and a full mailbox refuses the cancel. Here the
  mailbox stays the one queue.
- **`allow` and `refuse` are unchanged** (they wait on PR 194). They are
  ordinary inputs, so one told during a turn is said back as `not_waiting`
  once the turn ends. Nothing waits on them today (10).
- **A turn a kill cut off** runs again first, in a fiber of its own, while
  the mailbox is served, so a cancel reaches it. Every prompt waits for it.
  If `prompt` closes first, `chat` keeps serving until that turn ends.

**The proof** (`programs/claude/src/claude.test.ts` and
`programs/codex/src/codex.test.ts`, the same test): turn 1 hangs. 1000 prompts
are told behind it, `queued`, and the next one fails `MailboxFull`. Then
`cancel now` answers `queued`, and turn 1 ends `cancelled`. With `cancel` made
an ordinary input, that test fails `MailboxFull`, and the cancel-by-number
test hangs: the cancel waits behind the turn it should stop. The restart test
now runs twice, with `prompt` open and closed at the second start. Closed, the
cancel still stops the resent turn and the run ends; without the second
`serve`, that case hangs.

**Measured again, fake providers, $0:** `order 50` gave the same four answers
as 6. `cost 300` ran with the machine at load 18: the program's gap over
`Agents.run` was about 1.2 to 1.8 ms a turn, against 0.8 ms before, but
`Agents.run` alone was also 2 to 4 times slower than the saved run. The saved
results file is left as it was.

## What this cannot tell us

- One live prompt per provider. It shows the wiring, not quality or cost at
  scale. A real stage turn with tools was run only on the fake providers.
- The fake providers are written from the adapters' pure parts; a provider that
  changes its events would not show here.
- Nothing about a person using a chat tile: no tile was drawn.
- Cancel was tested on fake providers. A real provider's stop is 156's, untested
  again here.
- The order cases are four. A cancel told before its prompt (by number, for a
  turn not yet told) is tested once, not 50 times.
- No storage cost on a real ledger, no network.
- The live run was on the first shape, with the stage's schema at definition
  (way C). The new shape was not run live. The turn loop is the same code, but
  the `--schema` path (a JSON Schema read into a schema, then handed back to
  the provider as JSON Schema) never ran on a real provider.
- Nothing shows yet that the decode's error text helps a sorter that is sent
  back: today a failed draft ends the stage, it does not retry.
- The cost of the mailbox port is not measured cleanly: the rerun ran on a
  loaded machine (12).

## Cost

- Live: claude $0.0029, codex $0 on the ChatGPT plan (9,930 tokens). About
  $0.003 in all.
- Everything else: fake providers, $0.
- Left behind: nothing. The temp folders, the Codex home and the one Claude
  Code session record the live run made were removed.
