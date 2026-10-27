# 156: Our own agent interface, with Claude, Codex and ACP as adapters

**Answer: yes, one interface holds all four paths.** The same format-bytes job
ran 5 of 5 right with a typed answer through each of them: Claude through its
SDK, Claude through ACP, Codex through `codex exec`, and Codex through ACP.
The things ACP lacks (a typed answer, a stop that ends child commands, turn
token totals, our own session id, limits) are added once, in the service, and
hold on every row. Each adapter is 130 to 210 lines.

```ts
// The whole idea: a stage asks one way, for any provider.
const agents = makeAgents({
	adapters: {claude: claudeAdapter(), codex: yield* codexAdapter({codex}), "acp-claude": yield* acpAdapter("claude")},
	sessions: yield* fileSessions(dir),   // our session id -> the maker's, on disk
	reaper: psReaper,                     // what is under the agent, killed if it outlives the stop
});
agents.run({provider: "codex", session: "build/42/r1", folder, prompt, answer: Built,
	model: "gpt-6-luna", effort: "low", limits: {usd: null, tools: 40, seconds: 900}});
// started -> said | tool | asked | tokens ... -> ended {stop, answer: Built | null, tokens, counted, usd}
// Leaving the stream early is the stop.
```

## Who did what

- **This repo's code:** the interface and the service
  (`packages/fabrika/src/agents/agent/`), the four adapters, the laws and the
  adapter tests, the script. No stage was moved onto it.
- **Claude:** Claude Agent SDK 0.3.296, model `claude-haiku-4-5` (ACP names it
  `haiku`), through our adapter, or through `@agentclientprotocol/claude-agent-acp`
  0.85.1 pinned in `adapters/`.
- **Codex:** codex-cli 0.163.0 on the laptop's ChatGPT plan, model
  `gpt-6-luna`, effort `low`; through ACP, `@agentclientprotocol/codex-acp`
  2.1.1, which bundles its own Codex.
- **Today's fabrika:** not used.

## 1. The Elm answer first

An agent run is a **Sub**, as a Draft is today
([`elm-first.md`](../docs/direction/elm-first.md)). The service is the
**effect manager** behind it: it owns the process, the session map and the
clock, and the machine never sees them. A Draft's runner maps the service's
updates into the Draft's own three Msgs, so a parent machine does not change:

```ts
const runner = agentRunner("builder", agents, (run) => ({
	provider: settings.provider, session: run.session.id, folder: tree,
	prompt: run.prompt, answer: Built, model, effort, limits,
}));
// (sub: Sub<"builder", DraftRun>) => Stream<builder_tool | builder_finished | builder_failed>
```

Leaving the phase turns the Sub off, and turning it off is the stop. Nothing
new is added to tea.

## 2. The study

### ACP's schema

- **Taken:** a session, a prompt, streamed `session/update`s
  (`agent_message_chunk`, `tool_call`, `tool_call_update`), a permission ask
  with its option kinds, the `StopReason` words, the `ToolCallStatus` words,
  and cancel.
- **Not there:** an answer schema; turn tokens (`PromptResponse.usage` is one
  request's, experiment 153); a session id the client picks (the agent picks
  it); a cancel that ends child commands (153: a cancel left `sleep` running).

### The phoenix interface (kamp-us/phoenix, read only)

[kamp-us/phoenix](https://github.com/kamp-us/phoenix) has `TuvalAiAgent` with
`tuval-claude`, `tuval-codex` and `tuval-pi`.

- **Right:** one ordered stream of events per turn; no maker's type in the
  interface; the process tied to a scope, so it ends when the scope does.
- **Wrong for us:** it was shaped for a chat window: paging, about 15 event
  kinds, a transcript to replay. It had no typed answer. "One end per turn" was
  a convention, not something the types or a test held.
- **Kept:** the one stream, the maker-free types, the scope. Dropped: paging,
  the chat-only events, the transcript.

### Our own code

- `primitives.ts`'s Draft is a Sub with three Msgs: `_tool`, `_finished`,
  `_failed`. That stays the stage's view.
- `builder.ts` reaches the Agent SDK straight: its options, a shell guard hook,
  a lock spawn, a trace and a "does this session continue" check on disk.
- `builder-acp.ts` reaches ACP straight, with its own answer reading and stop.
- Each of them does by hand what the service now does once.

### Codex: `exec` or `app-server`

**Pick: `codex exec --json`, one process per turn.**

- **Why:** it has the typed answer (`--output-schema`, OpenAI strict mode),
  `exec resume <id>`, and a clean stop (SIGINT; experiment 152 found SIGTERM
  leaves the command running). It is the steady surface: `app-server` is
  marked experimental, and `exec` is itself a client of it.
- **Cost:** a process per turn (about 1 s of start, inside the 10 s median);
  no live config change mid-session.
- **Confidence: 80%.** The doubt: if a later stage needs many short turns on
  one warm session, `app-server` would start once. A run of 20 short turns
  both ways would settle it.

## 3. Taken from ACP, added by us, dropped

| | What |
|---|---|
| Taken from ACP | A session; a prompt; updates: a whole message, a tool call by id with ACP's status words, a permission ask; ACP's stop words (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`); cancel by leaving |
| Added by us | A typed answer read by the stage's Effect schema (`null` on a misfit, never text); our own session id, mapped to the maker's on disk; a session stays on its provider; the turn's tokens, with where they came from (`counted`: `turn`, `requests`, `last`, `none`); dollars where the maker says; limits: dollars (only where the maker holds a cap, else the turn fails at start), tool calls and a clock (held by us, for every maker); two stop words, `over_budget` and `over_time`; a stop that reaps what outlives the maker's own stop; exactly one end, and nothing after it |
| Dropped | ACP's plans, modes and config options as part of the interface (an adapter sets them inside); message chunks (joined into whole messages); file system and terminal requests from the agent; `session/load` replay as a stage concern; the phoenix chat events and paging |

The interface, short (in `agent/turn.ts`):

```ts
type Update =
	| {_tag: "started"; session: string}               // ours, never the maker's
	| {_tag: "said"; text: string}
	| {_tag: "tool"; id: string; title: string; status: ToolStatus}
	| {_tag: "asked"; id: string; title: string}      // refused: a contained run asks nobody
	| {_tag: "tokens"; tokens: Tokens};
interface Ended<A> {_tag: "ended"; stop: Stop; answer: A | null; tokens: Tokens;
	counted: Counted; usd: number | null; requests: number | null}

interface Adapter {
	name: string;
	holds: {usd: boolean; schema: boolean};           // what the maker does on its own
	start: (t: AdapterTurn) => Effect<Running, AgentFailed, Scope>;
}
interface Running {updates: Stream<Raw, AgentFailed>; pid: number | null; stop: Effect<void>}
```

An adapter only starts its maker's agent and says what it heard, as `Raw`.
Everything above is in `agent/core.ts`, once.

## 4. The laws

`agent/laws.test.ts` runs 10 laws as property tests (fast-check) on the fake
adapter. Each law also runs against a **planted mistake**, a service bent in
one way, and must fail there. All 20 pass.

| Law | Planted mistake that must fail it |
|---|---|
| A turn ends exactly once, last; a stream with no end fails as broken | Every end sent twice |
| The answer is the last message read by the schema, `null` on a misfit | The first message read |
| The turn's tokens: the maker's total, else every request added up | A maker's total taken as one more request |
| The session is ours; the next turn carries the maker's on | A map that forgets |
| A session stays on its provider; a cap the adapter cannot hold fails at start | The provider check skipped |
| A tool limit of k lets at most k calls through, then `max_turn_requests` | The limit dropped |
| Leaving at any point stops the maker once and closes it once | The gentle stop never asked for |
| A turn stuck past its clock ends as `over_time` | The clock dropped |
| The prompt carries the schema only when the maker has no schema field | Every adapter told it has one |
| What outlives the maker's own stop is killed; what it ended is left alone | No reaping |

`agent/adapters.test.ts` checks each adapter's pure part with no agent: Claude's
SDK messages, Codex's JSON lines, the `-c` flags, strict mode, the Codex
environment (planted keys must not pass), ACP's updates, and the reaper's tree.

## 5. The parity numbers

5 runs a row of the experiment 152 job (fix `formatBytes`, 10 graded cases).
One run at a time, under `nice -n 15`.

| | Claude, our adapter | Claude, ACP | Codex, our adapter | Codex, ACP |
|---|---|---|---|---|
| Right, typed | 5/5, 5/5 | 5/5, 5/5 | 5/5, 5/5 | 5/5, 5/5 |
| Median time | 47.1 s | 19.7 s | 10.7 s | 9.8 s |
| Median tool calls | 10 | 5 | 4 | 4 |
| Tokens per turn (median) | 130.0k in, 6.4k out | 102.1k in, 2.1k out | 52.4k in, 0.5k out | 15.1k in, 68 out |
| Tokens counted as | the turn | the turn (Claude's raw result) | the turn | **the last request only** |
| Dollars, 5 runs | $0.414 | $0.218 | plan | plan |
| Stop: tree gone after leaving | 0.74 s | 1.11 s | 0.22 s | 0.36 s |
| Stop: commands left after 3 s | 0 | 0 | 0 | 0 |
| Resume, our id, a new process | yes, 6.3 s | yes, 3.9 s | yes, 3.1 s | yes, 3.6 s |
| Dollar cap $0.005 | `over_budget` at $0.0085 | `over_budget` at $0.018 | refused at start, 1 ms | refused at start, 2 ms |
| Tool limit 1 | not run | not run | `max_turn_requests` after 1 | `max_turn_requests` after 1 |
| Owner's settings that got in | 0 (see below) | 0 | 0 of 5 MCP, 10 plugins, 26 lines, 4 skills | 0 of the same |
| Adapter lines | 134 | 191 (+ the client 249, the harness 157) | 212 | the same 191 |

What the rows say:

- **Typed answers held everywhere.** Claude and Codex direct use the maker's
  schema field. The two ACP rows carry the schema in the prompt and our reader
  reads the last message; 10 of 10 fit.
- **The stop.** In each row the agent ran `sh wait.sh`, which runs a long
  `sleep`, and the test left the stream 1.5 s after the `sleep` showed up.
  The process tree (3 to 5 processes) was gone in 0.2 to 1.1 s. The maker's own
  stop, then closing the process, was enough every time: **the reaper killed
  nothing in any live run.** It is there for the case 153 saw, and only the
  fake proves it works.
- **Tokens.** Codex through ACP still gives only the last request, so its 15k
  is not the turn's 52k. `counted: "last"` says so, so nobody adds it up as if
  it were the turn.
- **The dollar cap goes past its number.** Claude checks it after each model
  request, so a $0.005 cap ended at $0.0085 and $0.018. It is a stop, not a
  ceiling.
- **Claude through our adapter was slower** in these 5 (47 s against 20 s).
  The spread is large: one of our runs took 17.7 s, two took 78 s and 127 s.
  Three more runs with no effort set took 18, 18 and 47 s, so effort is not
  the cause. Section 9 has what would settle it.

### Containment

- **Codex, both paths:** in every Codex run (10 jobs, the stop, resume, budget
  and the control), the login stayed a link, the owner's own Codex sessions
  did not change, and 153's detector found none of the owner's MCP servers,
  plugins, global `AGENTS.md` lines or skills in the saved session. The
  control (a marker `AGENTS.md` put in our own Codex home on purpose) was
  found, so the detector works.
- **Claude through our adapter:** the start message lists 7 tools, 0 MCP
  servers, 3 plugins, 19 skills and 55 commands, even with
  `settingSources: []`. All 3 plugins have the path `builtin`, and the 19
  skills are Claude Code's own: none came from the owner's folder.

## 6. What broke on the way

- **A bug in the script's job loop ran 37 Codex runs instead of 5.** The loop
  bound grew as it saved rows. It was stopped by hand. Those runs are kept
  under `loop:codex` in the results, marked, and are not the parity set:
  34 of 37 right, 37 typed, 0 leaks, the login a link every time. Two of its
  temp Codex homes were left behind and were removed.
- **Codex could not start its own binary** inside the permission profile, as
  in 152: the standalone install runs from `~/.codex/packages`. The adapter
  opens that one folder, read only, and no other part of `~/.codex`.
- **A dead Codex run kept the turn open for 300 s,** because the clock
  stream kept the merge alive. Fixed in the service (`haltStrategy: "left"`),
  and the Codex adapter now fails with the exit code and the end of its stderr.
- **ACP's Claude adapter takes no full model id** (`haiku`, not
  `claude-haiku-4-5`) **and has no `dontAsk` mode** (`default`, `acceptEdits`,
  `plan`, `auto`). The adapter uses `acceptEdits`: edits run, the sandbox lets
  the shell run, and any other ask comes to us and is refused.
- **ACP's Claude adapter answers a spent cap with an RPC error,** not a stop
  reason. The adapter reads the SDK result Claude forwards first, and ends the
  turn `over_budget`.
- **Claude Code's Bash tool refuses a long `sleep` typed as the command.**
  The stop test puts it in `wait.sh`. Codex through ACP said nothing about
  the tool call until it ended, so the test leaves on what the process list
  shows, not on an event.

## 7. How a stage moves onto it (a sketch, not done here)

No stage was moved. For the build stage:

```ts
// Sketch. Today (builder.ts): sdkTrace(...).runner(builderDraft, () => builderOptions(...), {...})
// On the interface:
const continues = (yield* agents.knows(brief.session)) !== null;   // was keptOnDisk
const runner = agentRunner("builder", agents, (run) => ({
	provider: settings.provider,             // "claude" | "codex" | "acp-claude" ...: config
	session: brief.session,
	folder: brief.tree,
	prompt: run.prompt,
	answer: Built,
	model: settings.model,
	effort: settings.effort,
	limits: {usd: settings.budget, tools: null, seconds: settings.minutes * 60},
}));
const msgs = runner({id: "builder", type: "builder", deps: run} as Sub<"builder", DraftRun>);
// The rest of draftLive reads the same three Msgs as today.
```

Steps, one at a time, each its own pull request:

1. **build:** as above. Two things the builder has today need a home first:
   - its lock spawn (`guard.spawn`) and the adapter's own spawn (for the pid)
     both want `spawnClaudeCodeProcess`; the adapter should take a spawn to
     wrap;
   - its trace (`sdkTrace`) reads raw SDK messages; it should read `Heard`
     instead, the same for every maker.
2. **plan, review, sort:** the same move. They are smaller: no lock, no guard
   hook of their own.
3. **Drop `builder-acp.ts`:** ACP is now the `acp-claude` row.
4. **The Claude adapter moves from `settingSources: []` to `ownRules`** from
   experiment 155 (https://github.com/usirin/tea-fabrika/pull/124), as the
   stages do, when that lands.

## 8. Leans on the open points

- **The interface is ours, ACP is one adapter.** This run backs the
  direction: four paths, one interface, the same laws. **Cost:** about
  1,000 lines (service, types, four adapters) plus tests. **Confidence: 85%.**
  The doubt is a maker with a shape none of these has (a remote agent with no
  process to reap); the `pid: null` path covers it on paper only.
- **Codex: our adapter on `exec`, not ACP, for stages.** Both paths were right
  and as fast, but ACP's Codex gives only the last request's tokens and has no
  schema field. **Cost:** 212 lines to keep against a CLI that changes.
  **Confidence: 80%.** If codex-acp gains turn tokens, the ACP row is enough.
- **Claude: keep our SDK adapter for stages.** It carries the shell guard hook
  and `dontAsk`, which the ACP row cannot. **Cost:** it was slower here, and
  that is not explained. **Confidence: 70%.** The doubt is the speed: if the
  gap holds at 20 runs, find its cause before moving the build stage.
- **The dollar cap is a stop, not a ceiling.** A stage that needs a true
  ceiling sets the cap below it. **Confidence: 90%,** seen in both Claude
  rows.
- **Keep the reaper,** though it killed nothing here. It costs one `ps` at a
  stop, and 153 saw an ACP cancel leave a command running. **Confidence: 75%.**
  A run where the gentle stop is skipped on purpose would show it on a real
  agent.

## 9. What it cannot tell us

- **Five runs a row is small.** The Claude speed gap (47 s against 20 s) is
  inside the spread of our own runs. 20 runs a row, and a run with the guard
  hook off, would say whether the gap is real and whether the hook, `dontAsk`
  or the schema field causes it.
- **One job, one kind of work.** A long build, a review, a plan were not run.
- **The reaper is proven on the fake only.** No live run left a process for
  it.
- **Tool limit on Claude was not run;** it is the same code as for Codex,
  held by the service, and the law covers it.
- **One machine, one Codex version, one Claude SDK version.** The
  `~/.codex/packages` fix depends on how Codex is installed.
- **No stage was moved,** so the sketch in section 7 is untried.

## Cost

- Claude: $0.80 measured (the 10 job runs $0.63, three no-effort runs $0.12,
  four cap runs $0.04), plus the stop and resume turns, which report no
  dollars in the script: under $0.10 more by their size. **Under $0.90 in all.**
- Codex: the laptop's ChatGPT plan, no dollars shown. About 70 runs, 37 of
  them the loop bug.
- Tokens per row are in the parity table; every run's are in
  `results/156-own-agent-interface.json`.

## How to run it

```sh
CLAUDE_CODE_OAUTH_TOKEN=<token> env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 \
  node experiments/156-own-agent-interface.ts job codex 5
# rows: claude, acp-claude, codex, acp-codex; steps: job <row> [n], stop <row>, resume <row>,
# budget <row>, control, loc, report. EFFORT=none runs a job with no effort, saved apart.
```
