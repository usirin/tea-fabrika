# 169: `claude` and `codex` as tea programs

**Answer: yes, and they are one definition with two entries.** One function
makes both programs on the `Agents` service; the provider is the program's name.
Both ran the same tests on fake providers, and one tiny live prompt each
answered `{sum: 5}` for about $0.003 in all. A pipeline stage (the real sort
machine, unchanged) started the program as a child run and heard its typed
answer as the same Draft Msg it hears today. A program costs about 0.8 ms a
turn over `Agents.run` on fake providers. Two gaps showed up, the same on both
providers: nobody can answer a permission ask, and a turn cannot run without an
answer schema.

```ts
// The whole idea: one definition, two entries, a typed answer out.
const claude = typedAgentProgram("claude", SortReply, "claude-sort");
const codex = typedAgentProgram("codex", SortReply, "codex-sort");

// inputs:  prompt (text), allow / refuse (an ask id), cancel (a turn number, or "now")
// outputs: started {provider, session, resumed, resent}
//          said {turn, text}   tool {turn, id, title, status}   ask {turn, id, title, answer}
//          ended {turn, stop, answer: SortReply | null, tokens, counted, usd, requests, ms, error}

// A stage starts it as a child run; the stage hears sort_tool, sort_finished, sort_failed.
const runner = programRunner({name: "sort", program: claude, agents, flags, keeping});
run(sort, {interpret, subscribe: {sort_run: (sub) => runner(sub.deps.run)}, terminal});
```

## Who did what

- **This repo's code:** the program, its kept conversation, the two fake
  providers, the child-run runner (`packages/fabrika/src/agents/program/`), the
  tests, the conversation's laws (it is kept, and an ended turn never
  changes), the stage test (`packages/pipeline/src/agent-program.test.ts`) and
  the script. No real stage changed.
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
const runner = programRunner({name: "sort", program: typedAgentProgram(provider, SortReply), agents, flags, keeping});
// both: (run: DraftRun) => Stream<sort_tool | sort_finished | sort_failed>
```

Nothing new is added to tea.

## 2. The program

The program is a kept machine whose state is the conversation, and whose view
is that state. Its main reads inputs and runs one turn per prompt.

```ts
interface TurnSeen { n: number; prompt: string; said: string[]; tools: Tool[]; asks: Ask[]; end: End | null }
interface Conversation { provider: "claude" | "codex"; session: string; told: number; turns: TurnSeen[] }
// Msgs: opened, told, began, heard (one Update from the service), ended
```

- **Prompts queue.** Each prompt is a turn, run in order on one session.
- **The input closing ends it.** A tile keeps `prompt` open: a chat. A parent
  tells one prompt and closes it: that is `claude -p` or `codex exec`. The
  program does the same thing in both.
- **Restart.** The conversation is kept. A turn cut off by a kill is sent
  again on start (`resent` counts them). A known session id resumes (`resumed`).
- **Cancel.** `cancel now` stops whatever turn runs when it is read. `cancel 2`
  stops turn 2 now if it runs, or when it comes up. Cancel by id is how LSP
  does it (`$/cancelRequest`,
  https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#cancelRequest).
- **The provider is the name.** BusyBox is one binary that acts by the name it is
  started under (https://busybox.net/about.html). Here one `build` function
  makes `claude` and `codex`, so neither is shaped around the other.

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

One turn each, `What is 2 + 3?` with the answer `{sum: Int}`:

| | claude (haiku) | codex (gpt-6-luna) |
|---|---|---|
| Answer | `{sum: 5}` | `{sum: 5}` |
| Outputs | started, said, tool StructuredOutput x2, ended | started, said, ended |
| Tokens in / cached / out | 20,809 / 7,488 / 62 | 9,915 / 0 / 15 |
| Requests | 3 | null |
| Time | 3.5 s | 3.9 s |
| Cost | $0.0029 | null (ChatGPT plan, $0) |

## 5. The typed answer across the boundary

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
- **B is for a person at tsh**, who has no Effect schema to hand over. What a
  schema loses on the way to JSON Schema is lost here too.

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

`packages/pipeline/src/agent-program.test.ts` runs the real sort machine, its
`sort_run` Sub answered by `claude-sort` or `codex-sort`:

- The first answer says "duplicate of 40", a ticket the stage never listed.
  Sort's Check sends it back.
- The second says "duplicate of 4". It passes; the stage writes a comment, a
  label and a close, and ends `done`.
- Two child runs, `sort:12/1` and `sort:12/2`. The second resumes the first
  one's session (`fake-own-1`).
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

**One definition, two entries: `build({provider, ...})` makes `claude` and
`codex`, with the provider as the name.**

- **Why:** the differences in 3 are all data (what the service holds, what
  usage a provider reports), not shape. Two programs would drift; one function
  keeps them at parity by construction, and the fake providers keep the tests
  honest for both.
- **Cost:** about 520 lines for the program and runner, 150 for the
  conversation, 80 for the fakes. 0.8 ms a turn. A new provider is a row in
  `PROVIDERS` plus its adapter.
- **How sure:** 75%. The doubts, and what would settle each:
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
- **No chat turn without a schema.** `Turn.answer` is required, and
  `Schema.Json` makes the JSON Schema `{}`. Proposal: `answer: null` in `Turn`
  for a plain chat turn.

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

## Cost

- Live: claude $0.0029, codex $0 on the ChatGPT plan (9,930 tokens). About
  $0.003 in all.
- Everything else: fake providers, $0.
- Left behind: nothing. The temp folders, the Codex home and the one Claude
  Code session record the live run made were removed.
