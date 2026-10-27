# 158: Why Claude wanders through our SDK adapter

**Answer: mostly it is not our adapter. The model wanders on every path, ACP's
included.** In 82 runs of 156's format-bytes job, Haiku 4.5's first draft was
wrong 33 times, 32 of them the same off-by-one. Each wrong draft cost about
28 s and 5 calls more to fix. In 7 more runs it thought for over 4,000 tokens
while writing its first edit. These two explain 40 of the 42 runs that took
over 30 s. Through ACP, 6 runs of 10 took over 30 s (median 35.5 s). 156's five
fast ACP runs were a lucky draw.

**One difference was ours, and it is fixed: the system prompt.** Our adapter
named none, so the Agent SDK sent an empty one. The agent never got Claude
Code's own instructions. ACP's adapter names them (about 27,000 characters).
The adapter now names them too. On this job that did not change how often the
slow mode came. It may have cut the very long thinks (9,000 to 19,000 tokens in
one request): 3 of 26 runs without the prompt had one, 1 of 56 with it
(p = 0.09).

**Not the cause:** the guard hook (1 refused call in the 52 runs that had it;
off, the same numbers), the effort (Haiku 4.5 takes none), the model (every
main request in every run went to `claude-haiku-4-5-20251001`), the SDK version
(our SDK on ACP's options was the fastest row), and `outputFormat` (p = 0.27).

```ts
// packages/fabrika/src/agents/claude/adapter.ts, the change.
const options: Options = {
	...base,
	systemPrompt: {type: "preset", preset: "claude_code"}, // was not named, so the SDK sent ""
	settings: {...base.settings, autoMemoryEnabled: false}, // the preset would ask for notes under ~/.claude
	cwd: turn.folder,
	permissionMode: "dontAsk",
	// ...the rest as before: the tools, the guard hook, the session, outputFormat
};
```

## Who did what

- **This repo's code:** the adapter change and its test, the script, the
  grading, the transcript reader.
- **Claude:** Claude Agent SDK 0.3.296 (its CLI is 2.1.296), model
  `claude-haiku-4-5`; through ACP, `@agentclientprotocol/claude-agent-acp`
  0.85.1 pinned in `adapters/` (its own SDK 0.3.286, CLI 2.1.286), model
  `haiku`. Signed in as in 156.
- **Today's fabrika:** not used.

## 1. What differs between the two paths

Both paths share `claudeOptions` (`packages/fabrika/src/agents/acp/harness.ts`):
no settings files, no MCP server, no connector, the builder's tools, the OS
sandbox, the dollar cap. Reading `acp-agent.js` in 0.85.1 (`createSession`)
beside our adapter, this is what is left:

```ts
// Ours (the adapter before this change):
{ systemPrompt: undefined,            // the SDK turns this into "": no instructions at all
  permissionMode: "dontAsk",
  hooks: {PreToolUse: [guardHook]},    // the shell guard
  outputFormat: {type: "json_schema"}, // a StructuredOutput tool carries the answer
  effort: "low",
  prompt: "<the job, as a string>" }

// ACP's adapter, on its Claude:
{ systemPrompt: {type: "preset", preset: "claude_code"},  // 27,212 characters on its CLI
  permissionMode: "acceptEdits", canUseTool,               // our ACP client refuses every ask
  hooks: {},                                               // only UI hooks of its own
  /* no outputFormat: the schema goes in the prompt */
  /* effort: none for Haiku 4.5 */
  includePartialMessages: true, extraArgs: {"replay-user-messages": ""},
  disallowedTools: ["AskUserQuestion"], env: {CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1"},
  prompt: "<a stream of user messages>" }
```

The empty prompt shows in each transcript. Claude Code saves a
`prompt_snapshot` of the system prompt it sent: 0 characters on our path, and
27,212 to 27,330 on ACP's, in 156's runs and in these. The first request of a
run had about 9,770 input tokens on ours and about 15,940 with the preset on
our CLI.

## 2. The runs

Each variant changes one thing, or as few as it can. Runs went in turn, one
variant after another each round, one run at a time. Each ran in a fresh copy
of `fixtures/format-bytes`, with 156's prompt, its 10 graded cases and a $0.20
cap a run.

- **ours:** the adapter as 156 ran it, the empty prompt pinned.
- **no-guard:** ours, with the guard hook off.
- **preset:** ours, with Claude Code's prompt, its memory part on (as ACP has it).
- **as-acp:** our adapter with ACP's options as far as they go: the preset,
  `acceptEdits` and a refusing `canUseTool`, no guard, no `outputFormat`,
  streamed input, partial messages, no effort.
- **acp:** Claude through ACP, as 156 ran it.
- **after:** the adapter as it is now (the preset, memory off).
- **no-format:** after, with no `outputFormat`.

| Variant | Runs | Right | First draft right | Over 30 s | Median s (spread) | Median calls | Median output tokens | Median $ | Refused | Failed calls |
|---|---|---|---|---|---|---|---|---|---|---|
| ours | 16 | 16 (15 typed) | 10 | 9 | 35.7 (18.2 to 159.9) | 6 | 4,298 | 0.049 | 1 | 7 |
| no-guard | 10 | 10 | 4 | 6 | 47.0 (19.4 to 64.6) | 10.5 | 6,088 | 0.064 | 0 | 6 |
| preset | 10 | 10 | 7 | 4 | 19.9 (13.8 to 65.5) | 5 | 2,233 | 0.037 | 0 | 4 |
| as-acp | 10 | 10 | 8 | 2 | 18.6 (15.8 to 52.0) | 4 | 1,906 | 0.037 | 0 | 2 |
| acp | 10 | 9 | 6 | 6 | 35.5 (18.2 to 70.5) | 5 | 4,324 | 0.058 | 0 | 6 |
| after | 16 | 16 | 8 | 10 | 38.8 (15.8 to 60.8) | 6 | 4,952 | 0.054 | 0 | 7 |
| no-format | 10 | 10 | 6 | 5 | 27.5 (16.1 to 79.5) | 4 | 3,382 | 0.039 | 0 | 3 |

- "Calls" counts every tool call. On the rows with `outputFormat` (ours,
  no-guard, preset, after) one of them is the StructuredOutput call that
  carries the answer.
- "Right" is all 10 cases right at the end. The one wrong end (acp, 7 of 10)
  still had a typed answer. The one untyped answer (ours) hit the $0.20 cap
  after 160 s.
- "First draft right" grades the first `bytes.js` the agent wrote, rebuilt
  from its first edit.
- At 10 runs a row, one row is too noisy to name a cause. preset and as-acp
  came out fast, acp and after slow, with the same prompt. Section 4 pools the
  rows.

## 3. What a wandering run does

The slow mode is the same on every path. Here is one ours run (46 s, 10 calls)
next to one acp run (45 s, 8 calls):

```text
ours 13 (46 s): Bash Read Edit Bash Edit! Read Edit Bash Bash StructuredOutput
acp 9 (45 s):   Bash Read Edit Bash Edit! Read Edit Bash

Edit    the first draft, off by one unit
Bash    the test prints "1.5 MB" for 1536
Edit!   fails: "String to replace not found"
Read    the file again
Edit    the fix, then more checks
```

The first draft, in short, as the agent wrote it 32 times in 82 runs (graded 3
of 10):

```js
export function formatBytes(n) {
	if (n < 1024) return `${n} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let size = n;        // the bug: the units start at KB, so size should start at n / 1024
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}
	return `${size.toFixed(1)} ${units[unitIndex]}`;  // formatBytes(1536) is "1.5 MB"
}
```

Then the agent edits again. It sends back its own draft as `old_string`, with
spaces on the blank lines, which the file does not have. The edit fails, the
agent reads the file and edits again. All 25 failed Edits looked like this,
and each came after a wrong first draft.

| First draft | Runs | Over 30 s | Median s | Median work calls | Median output tokens | Median $ |
|---|---|---|---|---|---|---|
| wrong | 33 | 33 | 46.5 | 9 | 5,977 | 0.068 |
| right | 49 | 9 (7 with a think over 4,000 tokens) | 18.9 | 4 | 2,030 | 0.035 |

"Work calls" leaves out the StructuredOutput call, so all rows count the same.
All 7 long thinks came in the request that wrote the first edit. The
transcripts keep no thinking text (Claude Code saves it as omitted), so we see
how long the agent thought, not what about.

## 4. The rows pooled

Each pool joins the rows that share one thing. The p value is a one-sided
permutation test (20,000 shuffles, a fixed seed): how often a random split of
the same runs gives the first pool a mean as high as it had.

| Pool (a vs b) | Runs | First draft wrong | Think over 9,000 tokens | Mean output tokens | Mean s | p (output, s) |
|---|---|---|---|---|---|---|
| empty prompt vs preset (any path) | 26 vs 56 | 46% vs 38% (p = 0.31) | 3 vs 1 (p = 0.09) | 6,054 vs 3,824 | 46.0 vs 31.6 | 0.005, 0.006 |
| ours vs after | 16 vs 16 | 38% vs 50% (p = 0.86) | 3 vs 0 (p = 0.11) | 6,513 vs 4,220 | 48.5 vs 34.3 | 0.10, 0.11 |
| memory off vs on | 26 vs 30 | 46% vs 30% (p = 0.17) | 0 vs 1 | 4,189 vs 3,508 | 34.4 vs 29.2 | 0.14, 0.13 |
| `outputFormat` vs schema in prompt | 26 vs 20 | 42% vs 30% (p = 0.29) | 0 vs 0 | 3,867 vs 3,450 | 32.0 vs 29.0 | 0.27, 0.28 |

- **Empty prompt vs preset:** the means differ clearly, but not through the
  slow mode's rate. The share of wrong first drafts is close, and so is the
  share of thinks over 4,000 tokens (19% vs 13%, p = 0.31). The gap in the
  means comes from the far tail: the three thinks of 9,000 to 19,000 tokens
  in one request were all without the prompt. The fourth, 9,361 tokens, came
  through ACP.
- **ours vs after:** our adapter before and after the fix, 16 runs each, the
  last 6 of each in turn. The medians are about the same (35.7 vs 38.8 s);
  the means are lower after, carried by ours' three longest runs (70, 120 and
  160 s).
- **Memory off vs on:** the rows with memory off were a little slower, not
  clearly (p = 0.13). They all ran in the last 20 minutes, after the rows with
  memory on.
- **`outputFormat`:** no clear effect.

## 5. What was ruled out

- **The guard hook.** One refused call in the 52 runs that had it: a `cat >
  /tmp/...` to write a test script outside the copy (ours 16; that run still
  took 25 s). With the hook off, no-guard was as slow as ours. ACP's runs had
  no ask at all.
- **The effort.** 156 set `low`. Haiku 4.5 takes no effort: the CLI's model
  list says so, and every transcript has no effort on its turns.
- **The model.** Every main request in all 82 runs went to
  `claude-haiku-4-5-20251001`. But the alias moves: CLI 2.1.296 reads `haiku`
  as `claude-haiku-5-5` (effort low to max), and CLI 2.1.286, inside ACP's
  adapter, as Haiku 4.5. So 156's `haiku` on the ACP row was the same model,
  by luck of the version. On our CLI, the SDK's result also lists
  `claude-haiku-5-5` for small side calls (such as the session title); their
  dollars are in the totals.
- **The SDK version.** as-acp ran on our SDK and CLI, and was the fastest row.
- **Failed calls as a hidden cause.** All 35 failed calls were the agent's
  own: 25 Edits whose `old_string` was not in the file, 6 `node -e` test lines
  that exited 1, 4 Reads of a folder. Only the one call above was refused.

## 6. Recommendations

- **Keep the adapter change.** Why: the empty prompt was the SDK's default,
  not a choice. Claude Code and ACP's adapter both send Claude Code's prompt,
  so now our two Claude paths run the same agent, and a comparison between
  them means something. The longest thinks were all without it. Cost: about
  3,200 more input tokens on the first request, mostly cached after; the mean
  dollars a run went down (0.063 to 0.048, p = 0.15). How sure: 85% that it
  should stay. Only about 30% that it changes the slow mode. The doubt: the
  tail claim rests on 3 of 26 against 1 of 56. What would settle it: 40 more
  runs of ours and after in turn, about $2.
- **Keep auto memory off.** Why: the preset tells the agent to keep notes in a
  memory folder under `~/.claude/projects/<folder>/memory`, outside its copy.
  Claude Code made that folder (empty) on all 30 runs that had memory on.
  Off, the prompt is 14,411 characters instead of 27,301, and no folder is
  made. Cost: none seen. How sure: 80%. The doubt: the memory-off rows were a
  little slower (p = 0.13) and all ran later. What would settle it: 20 runs of
  preset and after in turn, about $1.
- **Do not chase the slow mode in the adapter.** It is the model's first
  draft, on every path. 81 of 82 runs still ended right. If a stage needs less
  spread in time, measure a stronger model on the same job; Haiku 4.5 is the
  smallest. How sure: 85%.
- **Name models by full id.** `haiku` means a different model on the next CLI.
  The job here named `claude-haiku-4-5` on our SDK for that reason. How sure:
  90%.
- **Follow-up, not done here:** the pipeline's own Claude stages
  (`builder.ts`, `reviewer.ts`, `planner.ts`, `sorter.ts` under
  `packages/pipeline/src/stages/`) name no system prompt either, so they run
  on an empty one. Their own prompts are long, so the effect there is
  untested. That is its own change and its own run.

## 7. Found on the way

- Every transcript, on both paths, holds the signed-in account's email and
  organization id (`session_context` and `credential_org` entries). The
  transcripts stay on the laptop. This script saves only counts and scrubbed
  error text from them.
- 156's row said "the Claude speed gap is not explained". This is the
  explanation: mostly chance on few runs, plus the missing system prompt.

## 8. What it cannot tell us

- One small job, one fixture, one model. A longer job, with a longer prompt of
  its own, might feel the missing system prompt more, or less.
- 10 to 16 runs a row. A difference of 20 points in a share cannot be seen at
  this size. The pools mix runs that differ in more than the one thing pooled.
- The rows ran over 53 minutes: the first five in turn for 32 minutes, then
  after and no-format, then ours and after. Server speed can drift in that
  time and changes the seconds; output tokens and calls do not depend on it,
  which is why the pools also give them.
- What the agent thought in its long thinks: the transcripts do not keep it.
- Why 156's five ACP runs were all fast. At the rate seen here (6 right first
  drafts in 10), five in a row comes about 1 time in 13. It may also have been
  a quieter hour.
- ACP's CLI is 2.1.286 and ours 2.1.296. Their presets differ by about 90
  characters. as-acp, on our CLI, behaved like the fast ACP runs; that is all
  this says about the version.

## Cost

$4.37 of Claude for 82 runs (mean $0.053): 9.17 M input tokens (8.35 M of them
cached) and 0.37 M output tokens, as the SDK reports them. The pilot was 2
rounds ($0.58), looked at before the rest. The `models` and `old` steps called
no model. The cap was $5; the script stops at $4.75.

## How to run it

```sh
P='env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15'
$P node experiments/158-why-claude-wanders.ts models        # no model call: what `haiku` is, effort
node experiments/158-why-claude-wanders.ts old              # no model call: 156's saved transcripts
$P node experiments/158-why-claude-wanders.ts job all 10    # ours, no-guard, preset, as-acp, acp in turn
$P node experiments/158-why-claude-wanders.ts job after,no-format 10
$P node experiments/158-why-claude-wanders.ts job ours,after 6
node experiments/158-why-claude-wanders.ts report           # no model: the table and the pools
```

Claude signs in as in 156. Each run leaves its transcript under
`~/.claude/projects/` (read by the script, never saved here) and, with memory
on, an empty memory folder beside it. The copies are removed after each run.
