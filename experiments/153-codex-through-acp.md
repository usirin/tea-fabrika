# 153: Codex through ACP, one more row in the harness table

**Answer: yes, Codex fits as a provider behind ACP.** The pinned
`@agentclientprotocol/codex-acp` adapter runs as a row `codex` in our ACP
harness table. It signs in with the plan, keeps the owner's config, MCP
servers, plugins, skills and global `AGENTS.md` out, and did the
experiment 152 job 5 of 5 right through `acp --agent codex`. Median 12.6 s,
next to 10.6 s for Codex run directly in 152.

```ts
// The whole idea: a stage asks the same way for every provider.
const harness = harnessOf("codex", folder, null);   // or "claude", or "fake"
yield* harness.prepare;                             // codex only: its own home, the plan checked
const conn = yield* connect(harness, handlers);     // our ACP client, the same for every row
const session = yield* open(conn, folder);
yield* prompt(conn, session, PROMPT);               // PROMPT asks for one JSON object last
const answer = reader(Answer)(lastMessage);         // our Effect schema, or null on a misfit
```

ACP does not carry everything a stage needs, though. Five things must live
in our own service above the protocol, the same for every provider: the typed
answer, a stop that ends the child commands, turn token totals, a session id
we pick, and containment per provider. The sketch is in section 8.

## Who did what

- **This repo's code:** the ACP client (`packages/fabrika/src/agents/acp/client.ts`),
  the new `codex` row in `harness.ts`, the `acp` program, and the script.
- **Codex:** `@agentclientprotocol/codex-acp` 2.1.1, pinned in `adapters/`.
  It bundles `@openai/codex` 0.159.3. Experiment 152 ran codex-cli 0.163.0, so
  the two Codex builds are not the same.
- **Model:** `gpt-6-luna` at effort `low`, on the laptop's ChatGPT plan.
- **Today's fabrika:** none of it ran. No ticket, no ledger, no real repository.
- **Where the agent worked:** a fresh copy of `fixtures/format-bytes` in a
  scratch folder per run. One run at a time, under `nice -n 15`.

## 1. What the row is

```ts
// packages/fabrika/src/agents/acp/harness.ts, the codex case
{
	name: "codex",
	...node(CODEX),                                   // the pinned adapter, by path
	env: codexEnv(parent, folder, "workspace-write"),  // the whole environment, a keep-list
	meta: undefined,
	prepare: codexHome(codexHomeOf(folder, parent), codexLogin(parent)),
}

// codexEnv gives the adapter exactly these variables:
// PATH, TMPDIR, USER, HOME, CODEX_HOME, NO_BROWSER, INITIAL_AGENT_MODE, CODEX_CONFIG
```

- **Its own Codex home.** `~/.cache/tea-fabrika/codex/<hash of the folder>`.
  At first it holds one thing: a symlink to the login file. The login is never
  copied or moved.
- **`HOME` is that home too.** Codex reads skills from `~/.agents/skills`,
  which is outside `CODEX_HOME` (case C below).
- **Mode `workspace-write`.** The program refuses `agent` (a Codex model
  answers the permission asks) and `agent-full-access` (no sandbox).
- **`CODEX_CONFIG`**, merged by the adapter into every session's config: core
  environment only, no login shell, no web search, a permission profile that
  makes home unreadable but for the folder and the toolchain, and Codex's
  features that reach past the folder turned off.
- **`NO_BROWSER`.** No browser login is offered.

Why under `~/.cache` and not beside the copy: the first limits run put the
home under the temp folder, and the agent wrote into its own Codex home. A
`config.toml` written there would load at the next start. Under home, the
profile denies it (section 3, limits).

### Never billed to a key

openai/codex issue 40871 reports Codex moving quietly from a plan login to a
stored API key, and a large overnight bill. A plan row needs two guards:

```ts
// 1. The keep-list never passes a key. Test: plant OPENAI_API_KEY,
//    CODEX_API_KEY and TYPESAFE_API_KEY in the parent; none reaches the adapter.
for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "TYPESAFE_API_KEY"])
	expect(h.env[key]).toBeUndefined();

// 2. Before the adapter starts, prepare reads two fields of the login, in code,
//    and only the answer leaves: never a value of the file.
planLogin(text): "plan" | "not_json" | "not_plan" | "has_key"
// "plan" only when auth_mode is "chatgpt" and no OPENAI_API_KEY is stored.
```

Each refusal has a planted mistake in `harness.test.ts`:

| Planted login | The run ends with |
|---|---|
| `auth_mode: "apikey"` | the codex login is not a ChatGPT plan login: this row runs only on the plan |
| `auth_mode: "chatgpt"` with a key stored | the codex login holds an API key: a plan run could be billed to it; run `codex logout` and `codex login` |
| no mode | not a ChatGPT plan login |
| not JSON | the codex login file is not one codex wrote: run `codex login` |
| no login file | codex is not signed in on this machine: run `codex login` |

In each case no home is made and the adapter never starts. The real login
passed the check on every run after it was added.

## 2. Containment: proved, with a control

The script reads the owner's own Codex setup only to count it: the MCP server
and plugin names in `config.toml`, the lines of the global `AGENTS.md`, the
skill names in `~/.agents/skills`. Then it looks for each in what the run
shows: `/mcp`, `/skills` (both answer through ACP with no model call), and the
session's saved rollout, which holds every prompt the model saw.

| Kept out | Row A (the row) | Control B (a home we filled) | C (`HOME` left as the owner's) |
|---|---|---|---|
| MCP servers | 0 of 5 listed, 0 in the rollout | our probe server listed | |
| Plugins | 0 of 10 plugin ids in the rollout | | |
| `~/.agents` skills | 0 of 4 | | **4 of 4 leak** |
| Global `AGENTS.md` | 0 of 26 lines in the rollout | our marker found | |
| Project `AGENTS.md` | found (the detector works) | | |
| Owner's sessions folder | 275 files before and after | | |

- **B proves the detector.** A home of our own with an MCP server and a global
  `AGENTS.md` shows both. So 0 in A means kept out, not missed.
- **C is why `HOME` is set.** With `CODEX_HOME` alone, every owner skill in
  `~/.agents/skills` was listed.
- **The login stayed a symlink** after every run. Nothing in `~/.codex` was
  changed. `~/.cache/tea-fabrika/codex` is empty after the script's clean-up.

Three things are not owner leaks, but are worth knowing:

- **`codex_apps` is still listed by `/mcp`**, Codex's own ChatGPT apps server,
  with `apps` off. It appears 0 times in the rollout, so the model is not
  shown it.
- **Codex downloads its curated plugins into a fresh home**, with features off.
  `/skills` listed 35 entries: Codex's five system skills, plus 5 more names
  from those downloads, each repeated. None of the 5 is in the rollout. Two
  plugin names match names in the owner's config only because both come from
  the same public list. An earlier run with the same row listed 5 skills, so
  the download is not on every start.
- **A hidden title turn.** After the first turn the adapter asks another
  model, `gpt-5.6-luna`, to name the session from the first prompt. It runs in
  a thread without our config and shows only as `session_info_update`. The
  first prompt goes to a second model we did not pick.

Sign-in: the adapter offers only `api-key` with `NO_BROWSER`. The plan login
works through the link.

## 3. The seven parts through ACP

| Part | What came back |
|---|---|
| Stream | `session/update` carries message chunks, tool calls with status, `usage_update`, plan and title updates. 8.1 s, 10 of 10 right. |
| Stop | `session/cancel` ends the turn in 307 ms, `stopReason: "cancelled"`. **The running command does not end**: a `sleep` was still alive 2 s later. Closing the adapter ends it, `app-server` (2 processes) and the `sleep` in 27 ms, 0 left after 3 s. |
| Typed answers | No schema field through ACP. The adapter can send Codex an `outputSchema`, but uses it only for its title turn, never for a prompt. Our reader on the last message works (fit read, misfit `null`). An MCP form tool works too. |
| Limits | With the profile: the owner's `~/.codex` unreadable, `~/.ssh` not listable, the Codex home neither listable nor writable, home not writable, the copy writable, `node` runs, no network. **Temp folders stay writable.** Reads outside home are open. |
| Conversation | `session/load` (567 ms, 4 updates replayed) and `session/resume` (430 ms, none replayed) both remembered a word in a new process. Codex picks the session id. |
| Token counts | `PromptResponse.usage` is the **last model request** only, not the turn. `usage_update` carries only used and size of the context. No dollars on the plan. |
| Sign-in | The plan login through the symlink. No browser offered. The plan check refuses a key login. |

### Stop, in detail

```ts
// The stop that ends everything: cancel the turn, then close the process.
yield* cancel(conn, session);    // the turn ends; its child command keeps running
// ...closing the scope closes stdin, then kills: adapter, app-server and command end
```

A stop that only cancels leaves work running in the folder. The service must
close the process too, or end the session in a way the adapter must honour.

### Typed answers, in detail

| Way | Fit | Asked to misfit |
|---|---|---|
| Text: the prompt asks for one JSON object last, our `reader(Answer)` reads it | read | `null` (Codex obeyed and wrote a misfit; no strict mode) |
| MCP tool `hand_in`, served by this process, lent in `mcpServers` | taken, 1 call | refused before it reached our server, 0 calls |

- The MCP way needs an ask for every call, and the ask does not name the
  tool. The title comes from the earlier `tool_call` update, joined by
  `toolCallId`.
- The text way must read the **last** agent message. A turn has 2 or 3. The
  first five job runs read all messages joined (`said`) and none fit; the
  answer was right in all five. Kept as `jobFirst` in the results.

### Limits, in detail

| Probe | Row (with the profile) | Row without the profile |
|---|---|---|
| Read the owner's `~/.codex/config.toml` | no | **yes** (so the login file too) |
| List `~/.ssh` | no | yes |
| List or write the Codex home | no | list yes, write no |
| Write home | no | no |
| Write the copy | yes | yes |
| Write the temp folders | **yes** | yes |
| Network | no | no |
| Asks | 0 | 0 |

The config's `exclude_slash_tmp` does nothing here: the adapter sends its own
sandbox policy with every turn, and that one keeps the temp folders open. The
Claude row also allows the temp folders, so this matches, but it is not ours
to close.

## 4. The job: 5 runs through `acp --agent codex`

`fixtures/format-bytes`, the same task and grader as 152.

| | Codex through ACP (153) | Codex direct (152) | Claude haiku (152) |
|---|---|---|---|
| Right | 5 of 5 | 5 of 5 | 5 of 5 |
| Answer fits the schema | 5 of 5 (last message) | | |
| Median time | 12.6 s | 10.6 s | 41.1 s |
| Range | 9.1 to 37.7 s | 9.5 to 13.8 s | 17.7 to 70.2 s |
| Tool calls | 4 | 4 | 9 |
| Input tokens | 509 + 14,592 cached, last request | 63,276 (37,248 cached), turn | 105,307 |
| Output tokens | 72, last request | 471, turn | 4,897 |
| Asks | 0 | | |
| Dollars | none shown (plan) | none shown (plan) | $0.28 for 5 |

- **Speed is about the same as direct.** The first five runs (`jobFirst`) had
  a median of 10.9 s (8.6 to 25.4). Over all ten, about 12.3 s. One slow run
  in each set.
- **Tokens cannot be compared.** ACP gives the last request's numbers, not the
  turn's. 152 counted the turn.

## 5. Codex as an ACP provider, or a runner of its own

| | Behind ACP, a row in the table | A runner of its own (`codex exec`, 152) |
|---|---|---|
| Code a stage sees | the same client as Claude and the fake | a second client |
| Typed answer | our reader on the last message; no native schema | native `--output-schema`, plus our reader |
| Stop | cancel, then close the process | kill the process |
| Turn tokens | last request only | the turn's totals |
| Conversation | load and resume work; Codex picks the id | resume by id |
| Containment | the row: home, `HOME`, config, modes, plan check | the same home and flags, written again |
| Hidden title turn | yes, on another model | no |

**Verdict: behind ACP.** What a runner of its own gives (a native schema, turn
totals) the service can add once for every provider. What it costs (a second
client, containment written twice) is paid for each provider.

## 6. What the builder's ACP path lacks next to the SDK path

`packages/pipeline/src/stages/build/builder-acp.ts` (experiment 77) runs the
builder through ACP for Claude. Before ACP can be the only path:

- **No conversation carry-on.** The adapter picks the session id;
  `BuildBrief.session` cannot name it. The service must keep a map from our id
  to the provider's.
- **The guard hook is Claude Code's.** The fence runs as a Claude command hook
  in `_meta`. Codex has no matching hook through ACP. For Codex, the fence can
  only be the permission asks and the sandbox.
- **The dollar cap is Claude's.** `maxBudgetUsd` goes in through
  `_meta.claudeCode.options`. Codex on the plan has no cap through ACP.
- **The cost is Claude's.** It comes from `_claude/sdkMessage`, a Claude
  extension. Codex gives no dollars, and its token count is the last request.
- **The form is an MCP tool.** That works for Codex too (section 3), but
  needs an ask per call. Reading the last message is simpler and the same for
  every provider.

## 7. What it means for Draft

`packages/fabrika/src/agents/claude/draft.ts` runs on the Agent SDK directly.
Its shape already fits the service: a Sub over a stream, the prompt and
conversation as data, the answer read with an Effect schema, `null` on a
misfit. Moving it behind the service changes where the stream comes from, not
what the parent sees.

- **The reader moves up, unchanged.** Draft's `reader(schema)` on the last
  message is what this experiment used for Codex.
- **The stop gets stronger.** Today, leaving the phase interrupts the SDK
  query. Over ACP it must cancel, then close the process, or the child
  command lives on.
- **The session id becomes ours.** `DraftRun.session` names the conversation
  before the run; the service maps it to the provider's id.

## 8. The service, a sketch

A sketch, not built in this pull request. The name is a working name until
the naming pass.

```ts
// SKETCH. One service; the default layer is our ACP client over the harness table.
interface AgentRun<A> {
	readonly prompt: string;
	readonly folder: string;
	readonly schema: Schema.Codec<A, unknown>;     // the answer, read from the last message
	readonly session: {readonly id: string; readonly continues: boolean}; // our id, not the provider's
	readonly provider: AgentName;                  // "claude" | "codex" | "fake", from settings
	readonly model: string;
	readonly effort: string;
}

type Heard =
	| {kind: "said"; text: string}
	| {kind: "tool"; id: string; title: string; status: string}
	| {kind: "ask"; id: string; title: string}     // the title joined by toolCallId
	| {kind: "tokens"; input: number; cached: number; output: number}; // added up per turn

interface Ended<A> {
	readonly answer: A | null;                     // null: the last message did not fit
	readonly stop: "done" | "cancelled" | "refused" | "failed";
	readonly tokens: {input: number; cached: number; output: number}; // the turn's, not the last request's
	readonly dollars: number | null;               // null on a plan
}

class Agents extends Context.Service<Agents, {
	readonly run: <A>(run: AgentRun<A>) => Stream.Stream<Heard, AgentFailed, Scope.Scope>;
	readonly ended: <A>(run: AgentRun<A>) => Effect.Effect<Ended<A>, AgentFailed>;
}>()("Agents") {}

// What the service owns, the same for every provider:
// - the answer: our schema on the last message; a native schema only as an extra
// - stop: cancel, then close the process, so no child command lives on
// - tokens: add each request's numbers up into the turn's
// - session: our id, mapped to the provider's, kept beside the folder
// - asks: refused unless the stage says; a title found by toolCallId
// - containment: the row's prepare runs first; unsafe modes are refused
// - each provider row lists its known side traffic (Codex: the title turn)
```

## Recommendation

**Make Codex a row behind the one service, as built here, and keep its
containment and plan check in the row.**

- **Why:** it ran the job as well as Codex direct, through the same client as
  Claude. Containment held, with a control that shows the detector works.
  What ACP lacks is the same list for every provider, so it belongs in the
  service once.
- **Cost:** the row is about 130 lines and its tests. The service's
  additions (last-message reader, cancel then close, token sums, an id map)
  are small each. The stages move behind it one by one.
- **Confidence: 75%.** The doubts:
  - **The hidden title turn** sends the first prompt to a model we did not
    pick, outside our config. Settle it: look for an adapter switch, or ask
    upstream for one.
  - **Temp folders stay writable**, and the adapter's own per-turn sandbox
    wins over our config. Settle it: an upstream option, or accept it as the
    Claude row does.
  - **One toy job.** Settle it: the same build cases through both providers,
    as the direction note asks for the SDK path.
  - **The adapter's Codex is older** than the CLI 152 ran. Behaviour may
    change with a bump.

## What this cannot tell us

- How Codex does on a real ticket. One small fixture, five runs.
- Whether containment holds for things the owner does not have. We proved it
  for the MCP servers, plugins, skills and `AGENTS.md` this laptop has.
- The turn's real token count through ACP. Only the last request is given.
- Whether the curated plugin download is a risk. It fetched names from a
  public list into the fresh home; the model was not shown them here.
- What the title turn costs on the plan, and whether it counts against limits.
- Anything about Windows or Linux. macOS only.
