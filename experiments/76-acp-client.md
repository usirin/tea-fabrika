# 76. A tea program as an ACP client: one flag swaps the harness

```
# The live check. Two harnesses, the same three-turn task, only --agent changed:
acp --agent claude --folder <scratch> --model haiku prompt=... prompt=... prompt=... & close %1 prompt; attach %1
acp --agent fake   --folder <scratch>               prompt=... prompt=... prompt=... & close %1 prompt; attach %1

# Both: [{tools: [completed, completed], said, end_turn, usage}, {said, end_turn, usage}, {said, end_turn, usage}]
```

## What we asked

Can a tea program be an ACP **client** (the Agent Client Protocol: a
harness, such as Claude Code or Codex, spoken to in JSON-RPC over stdio)?
Can it drive any ACP harness, swapped by one flag? Does ACP carry what our
programs need? Where it does not, say exactly what is missing and sketch our
own extension: `_meta` and `_`-prefixed methods first, a separate protocol
only if those fail.

## What was built

| File | What it is |
|---|---|
| `src/agents/acp/program.ts` | `acp`, made with `defineProgram`, listed in tsh. |
| `src/agents/acp/client.ts` | One ACP connection in Effect terms: the official `@agentclientprotocol/sdk` (1.6.1) over a child process that Effect's `ChildProcess` spawns and its scope kills. |
| `src/agents/acp/harness.ts` | The `--agent` table: command, environment and `_meta` per harness. Swapping is this table and nothing else. |
| `src/agents/acp/session.ts` | The kept machine: harness, ACP session id, prompts told and not answered. |
| `src/agents/acp/transcript.ts` | A plain Elm machine that folds `session/update` into a transcript. |
| `src/agents/acp/spans.ts` | One turn as agent events, so it draws as an agent span (experiment 70). |
| `src/agents/acp/fake-agent.ts` | A scripted ACP agent with no model: the second harness and the CI harness. |
| `adapters/` | The pinned adapters, with their own lockfile, installed apart from the workspace. |
| `experiments/76-acp-live.ts` | The live runs: `swap`, `long` and `ask`. |

`acp` takes:

- **Flags**: `--agent` (claude or fake), `--folder` (the scratch folder),
  `--model`, `--effort`, `--mode`, `--permissions` (refuse or ask),
  `--reopen` (load or resume), `--budget` (dollars, where the harness can cap).
- **Inputs**: `prompt` (one turn each, in order), `allow <ask>`,
  `refuse <ask>`, `cancel`.
- **Outputs**: `opened` (session, how it opened, how long it took, mode,
  model, updates replayed, prompts resent), `said` (the reply of a turn),
  `result` (stop reason, tokens, tool calls, cost so far), `ask` (a
  permission ask, when it comes and when it is answered).

The transcript holds messages, thoughts as a count only, tool calls with
their status, the plan, the mode, the title, notices, the context window and
cost, and per-turn usage. Its `statusLine` is the kind's status line (73 is
merged, so each kind now says one).

After 75b was merged, `acp` moved onto machine refs. `session` and
`transcript` are kinds. `main` starts the session with
`machines.session.get("session").start()`. It sends no Msg and has no
`recovered`, because `main` reads what was waiting and sends it again itself,
once the harness has opened the session.

### ACP and our ports, as used

| ACP | Our side |
|---|---|
| `initialize` with `fs: false`, `terminal: false`, `session.notices` | `connect`. The client lends the harness no file access and no terminal: the harness uses its own tools, contained. |
| `session/new` | The first start. The id the harness picks goes into `session` (`opened`). |
| `session/load` / `session/resume` | Any later start. `--reopen` picks one; a harness that has only the other falls back. |
| `session/set_config_option`, categories `model`, `thought_level`, `mode` | `--model`, `--effort`, `--mode`. Set again at every start: the harness does not keep them with the session. |
| `session/prompt` | One `prompt` input = one turn. Turns run one after another. |
| `PromptResponse.stopReason` + `usage` | The `result` output, and `TurnSettled` / `RunDone` agent events. |
| `session/update`, every kind | The transcript fold. `tool_call` and `tool_call_update` also become `ToolStarted` / `ToolSettled` / `ToolFailed`. |
| `usage_update.cost` | `result.cost` (the session's cost so far). |
| `session/request_permission` | The `ask` output. Refused at once by default; with `--permissions ask`, waits for `allow` or `refuse`. Allow picks `allow_once`, never `allow_always`. |
| `session/cancel` | The `cancel` input. Open asks are answered `cancelled` first, as ACP asks a client to. |
| `_meta.claudeCode.options` (Claude adapter only) | The builder's Agent SDK options that are plain data: sandbox, tools, no setting sources, no MCP, `maxBudgetUsd`. |

## Harnesses and versions

| Harness | Version | Ran? | Why |
|---|---|---|---|
| `@agentclientprotocol/claude-agent-acp` | 0.85.1 (published 2026-10-02; latest is 0.93.0 from 2026-10-16) | Yes | The official Claude adapter. It started at Zed and is now published from the `agentclientprotocol` GitHub org; the npm repository field points there and it is published by that repo's GitHub Actions. Picked 15 days old, not the latest. |
| `@agentclientprotocol/codex-acp` | 2.1.1 (2026-10-01) | No | Installed and probed, not run. It cannot be contained (see below). |
| Gemini CLI | none | No | Not installed here, and it needs its own login. |
| `fake` | this repo | Yes | Scripted, no model: the second harness, and CI's. |
| `@agentclientprotocol/sdk` | 1.6.1 (2026-10-02) | client | Pinned in the workspace catalog. |

The adapters are installed with `pnpm --dir adapters install
--ignore-workspace --frozen-lockfile` and started by path from there. No
`npx`. No community adapter.

### Containment

The Claude adapter is run the builder's way, as far as ACP lets it:

- **Environment**: `agentEnv()`, the same stripped one the builder gets.
  `extendEnv: false`, so nothing else leaks in.
- **Folder**: a scratch folder outside any repository. `acp` refuses a folder
  with a `.git` anywhere above it.
- **SDK options** through `_meta.claudeCode.options` on every `session/new`,
  `load` and `resume`: `settingSources: []`, `strictMcpConfig`, no MCP
  servers, connectors off, the builder's six tools, and the builder's OS
  sandbox (no network, writes only in the folder and temp folders, the login
  files unreadable). The adapter spreads these over its own defaults.
- **Permissions**: every ask refused unless `--permissions ask`.
- **Mode**: the adapter's default, `auto`, as asked. It is recorded in the
  transcript and in `opened`.

What the adapter still read from the signed-in user's own Claude setup, past
`settingSources: []`:

- The user's settings file and any managed settings, read by the adapter's
  own settings manager (not the SDK's). It uses them for its defaults: the
  default permission mode, the models offered and any model overrides, and
  the effort level.
- The account's commands: `available_commands_update` still listed the
  user's own slash commands.
- The session files. The SDK writes each conversation to the user's Claude
  projects folder, under the scratch folder's name, with prompt and reply
  text. `session/load` and `session/resume` read them from there.

**codex-acp is skipped.** It loaded the user's Codex config (its MCP servers
and plugins), and no setting removed them. Pointed at an empty `CODEX_HOME`
it fails with "Authentication required"; making it work would mean copying a
login file, which this experiment does not touch. So it could not be
contained the builder's way, and it was not run. The fake agent is the second
harness.

## What the builder needs, and whether ACP can carry it

| Builder need | Can ACP or the adapter carry it? | How |
|---|---|---|
| 1. The SDK's OS sandbox + `agentEnv()` stripped env | **Yes, through the Claude adapter only.** | The env is ours: we spawn the adapter. The sandbox crosses as `_meta.claudeCode.options.sandbox`. Plain ACP has no word for either; another adapter would need its own `_meta`. |
| 2. The PreToolUse guard hook | **No.** Permission asks cannot replace it. | Hooks are functions; `_meta` is JSON, and the adapter marks `hooks` as "cannot cross JSON-RPC". In `auto` mode the adapter asks nothing: live on sonnet, a Bash write and an Edit ran with no ask at all. In `default` mode only edits ask. A guard must see every tool call before it runs, whatever the mode. Needs an extension method (sketch below). |
| 3. Experiment 71's guarded spawn of `claude` | **Partly, untested.** | `spawnClaudeCodeProcess` is a function and cannot cross. The adapter starts the CLI from `process.env.CLAUDE_CODE_EXECUTABLE` when it is set, so the guard could be put there as a wrapper script in the env we hand it. Not tried here. |
| 4. Structured output (`StructuredOutput`) | **Half.** | `outputFormat` crosses in `_meta.claudeCode.options`. The answer does not come back: `PromptResponse` has no field for it, and the adapter does not put one in `_meta`. At best it shows as a tool call's raw input. Needs `_meta` on the response. |
| 5. The dollar cap (`maxBudgetUsd`) | **Yes, through the Claude adapter.** | `--budget` sends it in `_meta`. `usage_update.cost` reports the spend. Never run to the cap here. Plain ACP has no cap. |
| 6. Choosing the session id, and resume | **Resume yes; choosing the id no.** | `session/load` and `session/resume` both work. The harness picks the id; the adapter marks `sessionId` as its own to manage. We keep the id it picked in the kept `session` machine. |
| 7. Model and effort | **Yes.** | `session/set_config_option` with categories `model` and `thought_level`. Haiku offers no effort option; sonnet took `low`. |

## What ACP lacked, and a `_meta` sketch

What our programs needed and plain ACP does not have:

1. **A typed final answer.** No field for one on `PromptResponse`.
2. **A guard on every tool call.** `request_permission` is asked only when the
   harness's mode wants to ask.
3. **Containment words.** No env, sandbox, settings or budget in the
   protocol. One adapter's `_meta` carries them; the next adapter will not.
4. **A safe resend.** A prompt has no key. After a kill mid turn, the client
   cannot tell whether the harness kept the cut turn. Live, it had: the
   model answered "I already read b.txt" after the resend.
5. **Mode as asked.** The Claude adapter turns `auto` into `acceptEdits` for a
   model without auto (haiku). It says so only in a `notice` update, which is
   new and needs a client capability. Without that capability, the notice was
   written into the model's reply as bold text.

None of this needs a separate protocol. A `tea` namespace in `_meta` and two
`_tea/` methods would do it:

```jsonc
// initialize: the client offers, the harness answers which it honors.
{"_meta": {"tea": {"guard": true, "output": true, "turnKeys": true, "contain": true}}}

// session/new, load, resume: what a builder is handed today as SDK options.
{"_meta": {"tea": {
  "contain": {"env": "given", "writable": ["<folder>", "<temp>"], "network": "none", "userSettings": "none"},
  "budget": {"usd": 2},
  "output": {"schema": {"type": "object", "properties": {"verdict": {"enum": ["pass", "fail"]}}}}
}}}

// session/prompt: a key per turn, so a resend after a kill is dropped if the harness has it.
{"sessionId": "s-1", "prompt": [...], "_meta": {"tea": {"turn": "run-7#2"}}}

// PromptResponse: the typed answer, and where the budget stands.
{"stopReason": "end_turn", "usage": {...}, "_meta": {"tea": {"output": {"verdict": "pass"}, "cost": {"usd": 0.02}, "budget": "ok"}}}
```

```jsonc
// _tea/tool_check, harness -> client, before every tool call, whatever the mode (PreToolUse):
{"sessionId": "s-1", "toolCallId": "t1", "name": "Bash", "input": {"command": "git push"}}
// -> {"decision": "deny", "reason": "a builder does not push"}

// _tea/turns, client -> harness: the turn keys it holds, to know whether a cut prompt landed.
{"sessionId": "s-1"}  // -> {"turns": ["run-7#1", "run-7#2"]}
```

The cost: each adapter has to implement these. For the Claude adapter that is
a patch or a fork; `_tea/tool_check` maps onto a PreToolUse hook inside it,
and `output` onto the SDK's result. A harness that ignores the namespace says
so in `initialize`, and the client can refuse to run it.

## Proofs

| # | The job | Where | Result |
|---|---|---|---|
| 1 | Three turns (read two files, answer, two follow-ups), on two harnesses, only `--agent` changed | `program.test.ts` (fake), `76-acp-live.ts swap` (claude haiku, fake), and tsh by hand | Same turn shapes on both. Claude: 3 answers, 2 Read tool calls in turn 1, $0.025. |
| 2 | `kill -9` tsh mid turn, new tsh on the same home, `attach %1`: no retyping | `kill.test.ts` (fake, load and resume), live on claude haiku | Same session opened again; the cut prompt and the next one sent again (`resent: 2`); turns 2 and 3 answered. |
| 3 | A 32-turn session, opened again three times by load and three by resume | `76-acp-live.ts long` | Timings below. |
| 4 | A permission ask: shown, refused by default, allowed only when told | `program.test.ts` (fake), `76-acp-live.ts ask` (claude haiku in `default` mode, and fake) | Refused: no file written. With `--permissions ask` and `allow ask-1`: written once. The same ask shape on both harnesses. |
| 5 | Cancel | `program.test.ts` | The running turn ends `cancelled`; the next one runs. |
| 6 | The fold | `transcript.test.ts`, 12 rows | Chunks by message id; tool status; plan replaced whole; thoughts counted, words not kept; a live echo is not a second message; load replay rebuilds messages; cancel fails open tools; notices kept apart from replies. |
| 7 | No prompt, reply or file text in any span | `program.test.ts` | Checked in spans as made and as viewed. |
| 8 | Traced | `program.test.ts`, live with `TSH_TRACE=1` | The turn is an agent span with its tool calls under it. Shown in Jaeger under service `acp`: `acp session`, `acp transcript`, `acp turn · 1 turn`. |
| 9 | A folder in a repository | `program.test.ts` | Refused before any harness starts. |

Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test` green after the rebase onto
75b (1507 tests). One full run of four failed one test of 75b's
(`src/stages/review/program.test.ts`, the review-into-ship kill test); it
passed alone five times and in the next three full runs. It is not in this
change.

## Live

All on haiku, except one sonnet probe.

### The swap

| | claude (haiku) | fake |
|---|---|---|
| Open (`session/new`) | 626 ms | 2 ms |
| Turn 1: read two files, answer | 4.0 s, 2 tool calls, completed | 10 ms, 2 tool calls, completed |
| Turns 2 and 3 | 1.2 s, 0.9 s | 2 ms, 1 ms |
| Stop, usage, reply on every turn | yes | yes |
| Mode reported | `acceptEdits` (auto clamped for haiku) | `auto` |
| Cost | $0.025 | none |

### Resume

Killed with `kill -9` in turn 2 of 3, then `attach %1` in a new tsh:

| | load | resume |
|---|---|---|
| Open | 892 ms, 8 updates replayed | 1031 ms, nothing replayed |
| Attach, two turns included | 12.4 s | 9.3 s |
| Transcript after | earlier turns back | only what came after |

A 32-turn session ($0.081 to build, 0.8 to 2.5 s a turn), opened again six
times in fresh starts on the same storage:

| | load | resume |
|---|---|---|
| Open, three tries | 794, 819, 775 ms | 843, 802, 799 ms |
| Updates replayed | 64 | 0 |
| Messages in the transcript after | 64 | 0 |

On the fake agent the same session opens in 5 to 8 ms by load (96 updates)
and 1 to 2 ms by resume.

So at 32 turns, load costs nothing over resume on the Claude adapter. The
time is the adapter starting its SDK session, not the replay. The timing
covers the open call only, not spawning the adapter and `initialize`.

### Permission asks

| | claude, `--mode default` | fake |
|---|---|---|
| Default (refuse) | `ask-1 Write edit refused`; file not written | same |
| `--permissions ask`, then `allow ask-1` | `waiting`, then `allowed`; file written | same |

And the sonnet probe in `auto` mode, `--effort low`: "run `echo hi >
shell.txt` with Bash", then "change a word in a.txt with Edit". Both ran. No
ask came. $0.059.

Total live spend: under $1.

## Findings

1. **The swap holds.** The client, the fold and the program did not change
   between harnesses. The harness table is the only difference.
2. **Load is as fast as resume at 32 turns** (about 0.8 s each on Claude),
   and load brings the transcript back. Resume brings nothing back.
3. **A resent prompt can be a duplicate.** The Claude adapter had kept the
   turn the kill cut off. Our resend made a second user message, and the
   model said it had already read the file. ACP gives no way to ask.
4. **In auto mode, permission asks are not a guard.** Nothing asked, for a
   shell write or an edit. Refuse-by-default only covers what the harness
   chooses to ask. The OS sandbox is what kept those writes in the folder.
5. **Auto is clamped silently for haiku.** The adapter turned it into
   `acceptEdits` and said so in a notice. Without the `notices` capability,
   that notice landed in the model's reply. Fixed by taking notices and
   keeping them apart in the transcript.
6. **Model, effort and mode are not kept by the harness across a restart.**
   `acp` sets them again at every start.
7. **The adapter reads the user's own settings for its defaults**, past
   `settingSources: []`, and keeps conversations in the user's Claude
   projects folder.
8. **codex-acp cannot be contained** the builder's way (user config loaded,
   no login without a login file).
9. **`CLAUDE_CODE_EXECUTABLE` is a wrap point** for experiment 71's guard
   process. It is the one function-shaped thing that has a data-shaped door.
10. **Killing `bin/tsh` by `$!` can miss.** On a machine where `node` is a
    version-manager shim, `$!` is the shim; the real tsh lives on and holds
    the home's lock. Kill its children too.

## Recs

1. **Use `acp` for agent runs that need no guard** (70%). Why: the swap,
   the fold, resume and traces all work, on official, pinned adapters. Cost:
   containment is per adapter, through its own `_meta`. Doubt: only one real
   harness ran. A Gemini run, contained, would lift this.
2. **Keep the builder on the Agent SDK directly for now** (80%). Why: the
   guard hook, the guarded spawn and structured output do not cross ACP
   today (table above). Cost: two ways to run Claude in one repo.
3. **If the builder should move to ACP, prove the guard first** (55%):
   point `CLAUDE_CODE_EXECUTABLE` at experiment 71's guard, and add
   `_tea/tool_check` to a patched adapter. Doubt: a patched adapter is a fork
   to keep up with. One build through it, with a refused `git push`, would
   settle it.
4. **Keep `load` as the default reopen** (70%). Why: same time as resume at
   32 turns, and the transcript comes back. Doubt: a 300-turn session may
   load slower. One long run would show it.
5. **Give each prompt a key and record what the harness kept** (65%). Why:
   finding 3. Cost: needs `_meta.tea.turn` honored by the adapter. Until
   then, the resend is at least once, like 75b's review pipe.

## Holes

| Hole | Owner |
|---|---|
| No guard hook: in auto mode the harness writes with no ask. The OS sandbox is the only fence. | tea-fabrika / the adapter |
| The adapter reads the user's own Claude settings and keeps conversations in the user's Claude folder, with prompt and reply text. | the adapter |
| A resend after a kill can duplicate a turn the harness kept. | ACP (no turn key) |
| A prompt told and not yet dispatched as `told` is lost on a kill (the same window as experiment 74's). | tea-program |
| `--budget` was never run to its cap. | this experiment |
| Codex and Gemini not run. | this experiment |
| Load and resume timings exclude spawn and `initialize`. | this experiment |
| 75b's review kill test failed once in four full runs. | tea-program |

## Not done

- Codex (cannot be contained) and Gemini (not installed, needs a login).
- The guard through `CLAUDE_CODE_EXECUTABLE`, and structured output through
  `outputFormat`.
- A session past 32 turns.
- A patched adapter with the `tea` namespace.

## Where Node is used

- `src/agents/acp/client.ts`: none. Effect's `ChildProcess` spawns and kills;
  the only bridge is Web Streams, which the ACP library reads and writes.
- `src/agents/acp/harness.ts`: `node:url` to find the adapter's script, and
  `process.execPath` / `process.env` to run it under the same node.
- `src/agents/acp/fake-agent.ts`: a Node program over stdio, with `node:fs`
  for its history. A test tool, not a part of `acp`.
- `src/agents/acp/kill.test.ts`: `node:child_process` to `SIGKILL` a real
  tsh, `node:fs` to read the fake's log. Test only.
- `experiments/76-acp-live.ts`: `node:fs` to write results and check a file.
