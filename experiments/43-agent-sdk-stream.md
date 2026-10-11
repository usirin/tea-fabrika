# 43. Claude through the Agent SDK: can a tea machine judge a running agent?

The Draft step (enricher, builder, reviewer) runs `claude -p`: prompt in,
typed answer out, nothing in between. The question: keep Claude's own loop,
but run it through the Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.296,
which ships Claude Code 2.1.296, the same version as the CLI here) and compose
it from outside at three points: its message stream as a tea Sub, a per-call
Check before each tool runs, and its session id. Does the stream give enough to
judge a run, or only to log it?

**Answer: enough to judge and stop a run, not enough to prevent a step.** The
stream holds every tool call, with its full input, a few ms before the call
runs; every result, with an error flag and the tool's own structured output;
and a final result with cost, tokens, time and turns. A machine fed by it
stopped a real run 2 ms after the call it judged. But the step that tripped the
rule still landed on disk. Prevention belongs in the PreToolUse hook, which
runs before each call and whose refusal the agent reads and works around.

Four SDK runs on the duration toy with `criteria.test.js` written in (sonnet,
`acceptEdits`, tools Read, Edit, Write, Glob, Grep and Bash, with Read, Glob
and Grep pre-approved, project settings only), plus one `claude -p` call for
startup. `experiments/43-sdk-stream-spike.ts`; the logs are in
`results/sdk-stream-*.json`.

| Run | What | Cost | Turns | Time |
|---|---|---|---|---|
| observe | builder turn, through the watch machine, canUseTool as the Check | $0.0451 | 8 | 9.9 s |
| feedback | resume of observe's conversation with "your draft has problems" | $0.0500 | 3 | 9.8 s |
| stop | fresh toy; the machine may let it write `duration.js` only | $0.0067 | 5 | 3.6 s |
| hook | second resume; the PreToolUse hook as the Check | $0.0134 | 3 | 5.2 s |
| startup | `claude -p`, haiku, "reply OK" | $0.0006 | 1 | 0.8 s |

$0.116 in all. A resumed run's `total_cost_usd` carries the conversation's
earlier total, so a resume's own cost is the difference between two results.

**1. The API, from the types.** `query({ prompt, options })` returns an async
generator of `SDKMessage`, plus control methods: `interrupt()`, `close()`,
`setPermissionMode`, `setModel`, `streamInput` and more. The options that matter
here:

- Session: `sessionId` *picks* the id (a UUID) for a new conversation; `resume`
  continues one; the two only combine with `forkSession`, to name the fork.
  So the restart lane can name the builder's conversation before its first
  build, as it does with `--session-id` today.
- Tools: `tools` is the set the agent has (like `--tools`), `allowedTools`
  only pre-approves (like `--allowedTools`), `disallowedTools` removes.
- `canUseTool(toolName, input, { signal, decisionReason, blockedPath, ... })`
  answers `{ behavior: "allow", updatedInput }` or `{ behavior: "deny", message,
  interrupt? }`. It is a permission prompt, so it is asked only about calls
  nothing else has decided.
- `hooks: { PreToolUse: [{ matcher?, hooks: [callback] }] }`; a callback gets
  `{ tool_name, tool_input, tool_use_id, ... }` and may answer
  `permissionDecision: "allow" | "deny" | "ask"` with a reason, rewrite the
  input, add context, or stop the whole run (`continue: false`).
- `permissionMode`: left out, the session takes the mode `claude -p` would,
  which is `auto` (a classifier) where that is the default. Always set it.
- Also: `outputFormat` (a JSON Schema, the answer comes back as
  `structured_output`, as with `--json-schema`), `maxTurns`, `maxBudgetUsd`,
  `settingSources`, `strictMcpConfig`, `abortController`, `sandbox`.

**2. The stream.** In order, for observe: `system/init` 0.9 s after the query
opened (session id, model, mode, the tool list), then one `assistant` message
per tool call and one `user` message per result, a few `rate_limit_event` and
`thinking_tokens` messages, and `result`. What each carries:

- A tool call: name, id and the full input (the whole `Write` content, the
  whole Bash command), before the call runs. The PreToolUse hook fired 1 to 6 ms
  after each call reached the stream; a `Write`'s result came 10 to 14 ms after it.
- A result: `is_error`, the text the model reads, and `tool_use_result`, the
  tool's own output object. For `Edit` and `Write` that holds the diff
  (`structuredPatch`) and the file before (`originalFile`); for `Bash`,
  `stdout`, `stderr` and `interrupted`.
- `result`: `total_cost_usd`, `usage` and `modelUsage`, `duration_ms`,
  `duration_api_ms`, `num_turns`, `permission_denials` (each refused call with
  its input), `terminal_reason`, `structured_output`, `session_id`.

What is missing for judging: a Bash exit code (there is `is_error`, and the
text, but no number in the structured output); which files a shell command
changed (feedback's agent appended to `NOTES.md` with `echo >>`, and no file
event says so); and, after an interrupt, the truth about the last call (below).

**3. The Sub.** `src/watch.ts` is a tea machine whose one Sub, `agent`, is on
while the state is `running`; its deps are the run's id, prompt and session.
The Effect engine's runner (in the spike) opens the query inside
`Stream.callback` and turns each SDK message into Msgs (`msgsOf`):
`tool_called`, `tool_returned`, `finished`, or `ended` when the stream fails.
The reducer keeps a picture (calls so far, files asked to be written, Bash
commands, calls still waiting for a result, the current run of failures of one
command) and judges each Msg with two rules: a write or an edit to a file off
the allowed list, and the same Bash command failing 3 times in a row (reads in
between do not break the run; a pass or another command does). A verdict moves
the state to `stopped`; the Sub's deps go null; the engine closes the runner,
whose finalizer calls `interrupt()`. That is Elm's answer: a subscription ends
when the model stops asking for it, so the stop needs no Cmd and no handle kept
outside the machine. A Cmd could not hold the run at all: the engine waits on a
Cmd before it folds anything else (the cmd-or-sub page), so nothing could be
judged until the run was over. `src/watch.test.ts` covers both rules and
`msgsOf`.

The stop run was told to write `PLAN.md` before any code. The timeline:

| ms | What |
|---|---|
| 4102 | `Write PLAN.md` reaches the stream; the machine stops |
| 4104 | the Sub's finalizer runs |
| 4109 | `interrupt()` answers (`still_queued: []`) |
| 4112 | the call's result: "The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)" |
| 4114 | `result`: `error_during_execution`, `terminal_reason: aborted_streaming`, $0.0067 |
| 4764 | the generator throws "Claude Code returned an error result"; the process is gone |

Left behind: `PLAN.md` on disk, whole, and `duration.js` untouched. The result
text says the write did not happen; it did. So a stop is fast and clean (the
conversation ends, nothing more runs), but the step that tripped it may already
be done, and the transcript is no witness of that: read the folder, not the
log. And the SDK throws after an error result, so a runner has to turn that
into a Msg of its own.

**4. The Check: canUseTool or a PreToolUse hook.** Observe gave the rule
(`git commit|push|checkout`, or a write to anything but `duration.js`) to
canUseTool and a log-only hook. canUseTool was asked about the two Bash calls
only: never about `Write NOTES.md` (`acceptEdits` approves edits inside the
folder), nor about Read, Glob and Grep (pre-approved; the SDK even warns:
"canUseTool will not be invoked for: Read, Glob, Grep"). So `NOTES.md` was
written. The `git commit` was denied; the agent said "Git is handled for me, so
I'll just run the tests", ran them, and finished `done`, its summary saying it
did not commit. The hook fired on every call, `StructuredOutput` included.

Hook run, the same rule in the hook: both calls refused, before either ran. The
agent read "PreToolUse:Write hook error: NOTES.md is outside this issue: change
only duration.js.", tried the commit, read the git refusal, and ended its turn
saying both steps were blocked. canUseTool was never asked: the hook's deny
comes first. Both refusals are in `permission_denials`. The hook is the cleaner
Check: it sees every call whatever the mode and the allow list, and it is a
pure function of the call. canUseTool is for answering a permission prompt,
which is not the question here. One wording catch: the agent reads a hook's
refusal as a "hook error".

Neither stops a shell from writing files. A check on `Write` and `Edit` is no
file boundary while the agent has Bash; the end state (the lane's diff check of
files no criterion names) still has to be read, or the shell taken away, or the
`sandbox` option's write limits used (not tried).

**5. Session.** Observe ran under an id picked before it started, and
`system/init` reported that id. Feedback resumed it with the note and kept the
same id. It held the whole context: no Read at all, straight to a `Write` of
`duration.js` that fixed all three, then one Bash call that appended to
`NOTES.md`, ran the tests and printed the three cases (5400, 5400, 90). It did
not try git again: it remembered the refusal. Hook resumed it a second time,
same id. So refine's same-conversation feedback works, and so does naming the
conversation up front. The SDK has the same split as the CLI (`sessionId` for a
new one, `resume` for an old one), so the "guess wrong, try the other way" in
`src/claude.ts` stays. Not tried: resuming an id that does not exist.

**6. Against `claude -p`.** The SDK runs the same Claude Code, from a binary it
ships (a 230 MB platform package beside a 5 MB SDK), so its version is pinned in
the lockfile instead of whatever `claude` is on the path. Startup is the same:
`system/init` came 0.5 to 0.9 s after opening (0.9 s cold, about 0.55 s after),
and 0.54 s for `claude -p`. From open to result, the SDK added 0.84 s to
observe's 9.9 s; `claude -p` took 1.98 s for a 0.79 s turn, 0.67 s of that
after its result, waiting for the process to exit (the SDK hands over the
result at once). Gained: the live stream, tool checks as plain functions in
our process instead of shell hooks, a stop that ends the conversation instead
of killing a process, typed tool outputs with diffs, `maxBudgetUsd`. Lost: the
box. `claude -p` is a process and a JSON line, easy to fake; the SDK is a
dependency whose defaults bite (the `auto` mode, a canUseTool that is quietly
skipped), and whose generator throws on an error result.

**What the Draft primitive would look like.** A Sub, not a Cmd. The parent
states what it wants as data and the engine holds the run open while the state
asks for it:

```ts
{ type: "draft", deps: { attempt, session: { id, continues }, prompt, tools, schema, check } }
```

`check` is data too (the files it may write, the commands it may not run), and
the runner enforces it in a PreToolUse hook, so a refused call never runs; each
refusal also comes back as a Msg. The stream comes in as `draft_called`,
`draft_returned`, `draft_finished` (the typed answer, cost, turns) and
`draft_failed`. Judging across calls (repeats, budget, drift) is the parent's
reducer, and stopping is the state leaving `drafting`. After a stop or a
finish, what changed is read from the folder, as the lane does now. Two things
to settle before building it: a restarted machine reopens the Sub with the same
deps, so the runner must resume a conversation that already exists rather than
start it again; and a hook that asks the machine (instead of a pure `check`)
would make the Check a round trip through the fold, which nothing here tried.
