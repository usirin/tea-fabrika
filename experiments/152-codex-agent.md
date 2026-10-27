# 152. A Codex agent, run the way we run Claude

The question: the repo runs Claude Code through the Agent SDK as a Draft: a tea Sub over the SDK's
message stream, stopped by turning the Sub off, with a typed answer read by a schema. Can a Codex
agent (OpenAI's coding agent) be run the same way, so a stage could try either agent? This takes
the seven parts of that question one at a time, then runs one small job five times on each agent.

**Answer: yes, close enough for a second runner. Confidence 70%.**

- **Stream:** `codex exec --json` prints one JSON event per line: `thread.started`,
  `turn.started`, `item.started` and `item.completed` for each command, file change and message,
  then `turn.completed` with token counts. It folds into our Draft's three Msgs with no gap.
- **Stop:** SIGINT stops a run in about 0.2 s and ends its child commands. SIGTERM, which is what
  the TypeScript SDK's abort sends, ends Codex at once but **leaves the running command alive**.
- **Typed answer:** our Effect schema, turned to JSON Schema by the repo's own `jsonSchema`, works
  as Codex's `--output-schema`. Codex holds the model to it strictly. An optional field is refused
  before the run starts (HTTP 400).
- **Limits:** the sandbox has network off and writes held to the folder, as asked. Reads are open
  everywhere until a permission profile closes them. No turn limit, no time limit, no budget.
- **Conversation:** `codex exec resume <id>` continues a thread. But Codex picks the id, we cannot.
- **Counts:** tokens in, cached and out on every run. No dollars on a plan. The plan's weekly
  limit is only in the saved session file, not in the stream.
- **Sign-in:** a plan login works headless with device login or a moved login file, and OpenAI
  documents both. A person's own scripted runs on their own plan, on a machine only they use, are
  documented uses. One login is never shared between people. (Corrected 2026-10-26: this line
  first said a plan login was not for public repositories. That rule is about CI on a public
  repository, see section 6.)
- **Same job, 5 and 5:** both agents right 5 of 5, both typed answers fit 5 of 5. Codex took a
  median 11 s and Claude 41 s. Codex wrote about 470 output tokens a run, Claude about 4,900.

```ts
// The whole idea, as a sketch: Codex's events become the Draft's Msgs (152-codex-agent.ts, foldCodex).
for (const e of events) {
  if (e.type === "thread.started") thread = e.thread_id;          // the session, named by Codex
  if (e.type === "item.started") push({type: "job_tool", tool: toolOf(e.item)}); // shell, edit, mcp
  if (e.type === "item.completed" && e.item.type === "agent_message") last = e.item.text;
  if (e.type === "turn.completed")                                  // the end: read like Claude's
    push({type: "job_finished", output: readText(last), session: thread, usage: e.usage});
  if (e.type === "turn.failed" || e.type === "error") push({type: "job_failed", error: ...});
}
```

## Who did what

- **This repo's code:** the Claude side is the builder's own options (`builderOptions` from
  `packages/pipeline/src/stages/build/builder.ts`) and the Draft's schema and fold (`createDraft`,
  `jsonSchema`, `reader` from `@kampus/fabrika/agents/claude`). The Codex side is new, in the
  script only: how Codex is started, its fold, its temp home. Nothing in `packages/` changed.
- **Today's fabrika:** nothing of it ran. No ledger, no lane, no real ticket, no real repository.
- **Codex:** `codex-cli 0.163.0`, signed in with a ChatGPT plan. `@openai/codex-sdk` 0.164.0 was
  installed in a scratch folder and read, not run (see "Stream" for why).
- **Claude:** Agent SDK 0.3.296, signed in with a Claude token from the environment.
- **Models:** `gpt-6-luna` at effort low ("fast and affordable model for easier tasks" in
  Codex's own model list) and `claude-haiku-4-5` at effort low. Both are the small, cheap model of
  their maker. They are not the same size or price; this is not a model contest.
- **The script:** `152-codex-agent.ts`. Its answers: `results/152-codex-agent.json`.
- **Research:** OpenAI's Codex docs and Terms of Use, read on the web. Codex's docs moved from
  developers.openai.com to learn.chatgpt.com; the links below are the pages read.

## How it was measured

- **The job.** A fresh copy of `fixtures/format-bytes` in a temp folder, for each run. The agent
  makes `formatBytes(n)` turn bytes into a readable size (`512 B`, `1.5 KB`, up to TB), checks two
  calls with one `node` command, and fills a form: `done`, `ran` (each call and what it printed),
  `summary`. The prompt gives three examples.
- **The right answer** is checked by code after the run, not by the agent: ten calls, from `0` to
  `1024 ** 5`, seven of them never shown to the agent. A run is right when all ten match.
- **The form** is one Effect schema for both agents:

  ```ts
  const Answer = Schema.Struct({
    done: Schema.Boolean,
    ran: Schema.Array(Schema.Struct({call: Schema.String, printed: Schema.String})),
    summary: Schema.String,
  });
  const draft = createDraft({name: "job", output: Answer});
  // Claude: outputFormat {type: "json_schema", schema: draft.schema}
  // Codex:  --output-schema <file holding jsonSchema(Answer)>
  ```

- **Codex was started straight**, the way the SDK starts it:

  ```sh
  CODEX_HOME=<temp home> codex exec --json --skip-git-repo-check -s workspace-write -C <copy> \
    -m gpt-6-luna -c model_reasoning_effort="low" -c web_search="disabled" \
    -c approval_policy="never" -c sandbox_workspace_write.network_access=false \
    --output-schema <file> "<prompt>"
  ```

  Its environment is a keep-list (`runEnv()` plus `USER` and `CODEX_HOME`), never this process's.
- **Two at once at most:** in the job, one Codex run beside one Claude run, under `nice -n 15`.
- **The owner's own settings were kept out of both sides.** See the next section.

## Keeping the owner's settings out

Codex loads a global instructions file, `~/.codex/AGENTS.md`, into every run, as Claude Code
loads `~/.claude/CLAUDE.md`. A run must not carry one person's own instructions.

- **`--ignore-user-config` is not enough.** It skips `config.toml` (here: 7 MCP servers and 10
  plugins). But the global `AGENTS.md` still reached the model. The test: a saved session, and
  three lines of the global file counted in it with `grep -c`. Each line was there, with the
  `# AGENTS.md instructions` header. `-c project_doc_max_bytes=0` did not remove it either.
- **A temp home does it.** Each run gets its own `CODEX_HOME`, which holds one thing: a symlink to
  the login file. The login file is never read, copied or moved. In that home the same three lines
  were found 0 times, and the login still worked. The script checks after every run that the link
  is still a link (it was, in all runs) and then removes the home.
- **What the temp home still has.** Codex installs its own bundled skills there on first start
  (`skill-creator`, `skill-installer`, `openai-docs`, `review-agent`), and adds short skill,
  plugin and multi-agent instructions to the prompt. These are Codex's, not the owner's. They are a
  small bias. A run that only answers "ok" still sends about 14,000 input tokens (11,520 cached):
  Codex's own instructions, these lists, and the environment.
- **The Claude side** uses the builder's options: `settingSources: []`, no MCP server, connectors
  off. So no user or project `CLAUDE.md` reached it.
- **Three probe runs were saved in the owner's `~/.codex/sessions`** before the temp home was
  used (the ones that found the problem). Codex writes these itself. They were left as they are.

## What came back

### 1. Stream

One job run (`stream` in the results) printed 14 events in 12.7 s:

```
thread.started
turn.started
item.completed:agent_message        "I'll check the existing `bytes.js`, make the smallest change, ..."
item.started:command_execution      /bin/zsh -lc "rg --files -g 'bytes.js' -g 'AGENTS.md'"
item.completed:command_execution
item.started:command_execution      /bin/zsh -lc 'cat bytes.js'
item.completed:command_execution
item.started:file_change
item.completed:file_change          {kind: "update", path: "<run>/copy/bytes.js"}
item.completed:agent_message
item.started:command_execution      node --input-type=module -e '...'
item.completed:command_execution
item.completed:agent_message        the form, as JSON text
turn.completed                      {input_tokens, cached_input_tokens, output_tokens, ...}
```

- **Start, tool calls, text and end are all there.** A tool call starts and completes as two
  events, a file change too. Codex has no `init` event: nothing says which tools the run has.
- **The SDK adds nothing we need.** `@openai/codex-sdk` 0.164.0 spawns `codex exec
  --experimental-json` and reads its stdout line by line (read in its `dist/index.js`). It cannot
  pass `--ignore-user-config` or `--ephemeral`, and its `env` option replaces the whole
  environment. Starting `codex exec` ourselves is as simple and gives every flag.
- **Stopping, measured** (`stop`). The run is told to run `sleep <random seconds>`; 1.5 s after
  the command starts, the script signals Codex.

| Signal | Codex ended after | Exit | The `sleep` left running |
|---|---|---|---|
| SIGTERM (what the SDK's abort sends) | 8 ms | killed by signal | **yes, 1 process, still there after 3 s** |
| SIGINT | 198 ms | code 1 | no |

  So a runner must stop Codex with SIGINT, wait, and only then kill. The SDK's own abort leaves
  the agent's command running on the machine. The script killed the one it left.

### 2. Typed answer

Four cases, each one run (`schema`):

| Case | What came back | Our reader |
|---|---|---|
| Fit: "fill the form" | `{"done":true,"ran":[],"summary":"nothing to do"}` | the typed value |
| Asked to break the form: "reply with `{"done": "maybe", "extra": 1}`" | `{"done":false,"ran":[],"summary":"Unable to return the requested JSON verbatim because the required response format is codex_output_schema."}` | the typed value |
| A schema with an optional field (`Schema.optional`) | no run: HTTP 400, "'schema.required' is required to include every key in properties. Missing 'note'." | `null`, the run fails |
| No schema, "reply ok" | `ok` | `null` |

- **Codex holds the model to the schema strictly** (OpenAI's strict structured output). Asked to
  misfit, the model still fit, and said so in a field. So with Codex a misfit cannot reach our
  reader; the `null` path is for runs with no schema, or a broken one.
- **Strict mode is stricter than Claude Code.** Every field must be listed as required, and every
  object closed. The repo's `jsonSchema` already closes objects. But it leaves an optional field
  out of `required`, which Codex refuses. A Codex runner needs optional fields written as "always
  there, may be null", or a check that refuses such a schema before the run.
- One failed run printed both an `error` event and a `turn.failed` event, so the fold made two
  failed Msgs. A runner keeps the first.

### 3. Limits

Six commands in the copy, judged by each command's own exit and output (`limits`):

| | workspace-write | + core env, no login shell | + no temp roots, core env | permission profile, home denied |
|---|---|---|---|---|
| Read a file outside the copy | **yes** | **yes** | **yes** | no |
| List `~/.ssh` (count only) | **yes** | **yes** | **yes** | no |
| Write a file beside the copy | **yes**, via `/tmp` | **yes**, via `/tmp` | no | no |
| Write in the copy | yes | yes | yes | yes |
| Reach `example.com` | no (DNS fails) | no | no | no |
| An env variable of Codex's own reaches the shell | **yes** | no | no | no |
| Shell | `/bin/zsh -lc` (login) | `/bin/zsh -c` | `/bin/zsh -c` | `/bin/zsh -lc` |

- **Network off and writes held work by flag.** But `workspace-write` also lets every command
  write `/tmp` and `$TMPDIR`, shared with every other program. Our scratch folder was under
  `/tmp`, so "outside" was writable until `exclude_slash_tmp` and `exclude_tmpdir_env_var` were set.
- **Reads are open everywhere by default.** This is what OpenAI's sandbox source does on a Mac
  (a plain `allow file-read*`,
  [seatbelt.rs](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt.rs)).
  The repo's Claude builder denies home reads (`filesOf`); Codex needs a
  [permission profile](https://learn.chatgpt.com/docs/permissions.md) for the same:

  ```sh
  -c default_permissions="box" -c 'permissions.box.extends=":workspace"' \
  -c 'permissions.box.filesystem={"<home>"="deny", "<home>/.local/bin"="read", "<home>/.codex/packages"="read"}'
  ```

  Codex runs its own binary inside the box, so the folders that hold it must stay readable, or
  the run fails at start ("sandbox-exec: execvp() ... Operation not permitted"). Profiles are
  beta, and do not combine with `--sandbox`. In the profile run the agent ran 4 of the 6 commands.
- **The environment.** By default the shell gets Codex's whole environment, and runs as a login
  shell, which reads the user's shell profile. `shell_environment_policy.inherit="core"` and
  `allow_login_shell=false` turn both off. Names holding KEY, SECRET or TOKEN are dropped by
  default ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference)).
- **Tools.** Codex has no tool list to pass, as `tools` is for Claude. Its tools are a shell,
  file edits, MCP servers, web search, and features turned on by default (`codex features list`:
  multi-agent, apps, browser and computer use, image generation, among others). A runner names
  features off with `--disable <name>`; this run did not, and the job used only shell and edits.
- **Turn, time and money.** Nothing found: no turn limit, no time limit, no budget
  (`maxBudgetUsd` has no match). The runner holds the clock and stops the run with SIGINT.
- **Model and effort:** `-m <model>` and `-c model_reasoning_effort=...`, per run.

### 4. Conversation

- A first run was told a word; a second run, `codex exec resume <id> "Which word..."`, answered
  it (`resume`). Same thread id, word remembered.
- The second run's input was 25,183 tokens (18,176 cached), against 11,584 for the first: the
  whole thread is sent again, as with Claude.
- **The gap:** our `DraftRun.session` names the id before the run starts (`sessionId`), so a
  parent can keep it in its state at once. Codex makes the id and tells it in `thread.started`. A
  Codex runner has to turn that event into a Msg, and the parent keeps the id from there.
- A resumed thread needs the same `CODEX_HOME`: the sessions live there.

### 5. Counts

- `turn.completed` carries `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`,
  `output_tokens` and `reasoning_output_tokens`. Cached is part of input
  (`total_tokens` = input + output in the saved session).
- **No dollars.** On a plan there is no price per run. There is no turn count either.
- **The plan's usage** is in the saved session's `token_count` lines, not in the `--json` stream:
  a limit with a window of 10,080 minutes (a week) and how much of it is used. After every run here
  it read 0% used: this whole experiment did not move the plan's weekly counter by one percent.
  OpenAI's docs name `/status` and a usage page in ChatGPT as the places to see it
  ([pricing](https://learn.chatgpt.com/docs/pricing)).

### 6. Sign-in, local and remote

Nothing remote was run. This is from OpenAI's own pages.

- **What a headless box needs:** a login made there with `codex login --device-auth` (a code typed
  into a browser elsewhere), or `~/.codex/auth.json` copied from a machine that has a browser. Both
  are documented ([auth](https://learn.chatgpt.com/docs/auth)). Codex refreshes the token itself,
  and writes it back to the file. There is also `codex login --with-access-token`, "intended for
  trusted scripts, schedulers, and private CI runners" (same page).
- **What OpenAI says about automation on a plan:**
  - "API keys are still the recommended default for automation"
    ([non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)).
  - A plan login in CI is an "advanced workflow for enterprise and other trusted private
    automation", and: "Do not use this workflow for public or open-source repositories." Also: "Do
    not share the same file across concurrent jobs or multiple machines."
    ([CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth))
  - The Terms of Use forbid sharing "your account credentials" or making "your account available
    to anyone else" ([terms](https://openai.com/policies/terms-of-use/)).
- **Said plainly (corrected 2026-10-26):** a plan login is for one person's own runs: on their
  laptop, or on a remote box only they control. Each person signs in with their own plan, and one
  login is never shared between people. An API key (`CODEX_API_KEY`) is for a shared service, or
  for a public repository's own CI.
- **Wrong, kept for the record:** the first version of this line said a plan login was "not for
  public repositories" and that "this repo is public". The CI guide's rule is about putting a login
  file on a CI runner of a public repository, where a stranger's pull request could reach it. A
  person using their own plan to work on a public repository is not that case.
- **Checked again on 2026-10-26,** by a Codex run with live web search, read-only, then by hand
  where marked:
  - Scripted runs: "`codex exec` reuses saved CLI authentication by default", and the page covers
    scripts and scheduled jobs ([non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)).
  - A remote box: "If you can complete the login flow on a machine with a browser, you can copy
    your cached credentials to the headless machine", and `codex login --device-auth`
    ([auth](https://learn.chatgpt.com/docs/auth#login-on-headless-devices)).
  - Sign in with ChatGPT, OpenAI's route for an app to run on a person's plan: "ChatGPT plan usage
    is available to all open-source partners and selected private clients" (checked by hand,
    [quickstart](https://developers.openai.com/siwc/quickstart)). Its terms say requests "must
    originate from the user's local runtime or a remote runtime only that user controls", and
    forbid pooling usage ([terms](https://openai.com/policies/sign-in-with-chatgpt-terms/); the
    page refused our fetch, so this one is from the Codex run only).
  - A plain API key never draws on the plan: "API usage is billed separately from your ChatGPT
    subscription" ([billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)).
  - Sharing: "If someone else needs to use OpenAI's products, they should sign up for their own
    account" ([account sharing](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy)).
  - Codex's app-server takes a login a host app hands it (`chatgptAuthTokens`, experimental), and
    its page says it "has never been permitted for commercial or hosted services"
    ([app-server](https://learn.chatgpt.com/docs/app-server#auth-endpoints)).
  - Not settled: the Sign in with ChatGPT terms forbid keeping tokens in a remote environment,
    while its own VM guide moves a login file there. The two pages do not agree.
- **For a box of ours:** the temp home above already works. A remote box would get a login file of
  its own (device login there), never the laptop's, and one box at a time per login file.

### 7. Same job, both agents

| | Codex (gpt-6-luna, low) | Claude (haiku, low, builder options) |
|---|---|---|
| Right, all 10 checks | 5 of 5 | 5 of 5 |
| Typed answer fit the schema | 5 of 5 | 5 of 5 |
| Said done, was wrong | 0 | 0 |
| Seconds, median (range) | 10.6 (9.5 to 13.8) | 41.1 (17.7 to 70.2) |
| Tool calls, median | 4 | 9 |
| Input tokens, median (cached) | 63,276 (37,248) | 105,307 (97,875) |
| Output tokens, median | 471 | 4,897 |
| Dollars | none shown (plan, 0% of the week) | $0.28 for 5 |

- Codex made four tool calls in every run. In the stream run they were: find files, read, edit,
  check. (The first looks for an `AGENTS.md`, as Codex's own instructions tell it to.) Claude used more calls and
  wrote ten times the output tokens (its output counts its thinking).
- Claude's time had a wide range. Both ran side by side, so they shared the laptop.

## A `codex` runner beside `claude`: a sketch

Nothing of this is built. It is where it would go, and what it would need.

```ts
// packages/fabrika/src/agents/codex/draft.ts (sketch)
// The same Draft (createDraft: name, Msgs, schema, reader); only the runner is new.
export const codexRunner =
  <N extends string, O>(draft: Draft<N, O>, options: (run: DraftRun) => CodexOptions) =>
  (sub: Sub<N, DraftRun>) =>
    Stream.callback<DraftMsg<N, O>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const run = sub.deps;
          const home = codexHome(run);            // temp CODEX_HOME: a link to the login, nothing else
          const child = spawn(CODEX, argsOf(run, options(run), draft.schema), {env: codexEnv(home)});
          readLines(child.stdout, (e) => {
            for (const msg of codexMsgsOf(draft, e, run)) Queue.offerUnsafe(queue, msg);
          });
          return {child, home};
        }),
        // Leaving the phase: SIGINT first (SIGTERM leaves the command running), then a kill.
        ({child, home}) => stopGently(child, {after: 10_000}).pipe(Effect.andThen(cleanHome(home))),
      ),
    );

// argsOf: exec --json, the profile (home denied, no temp roots), core env, no login shell,
// web search off, features off, -m and effort, --output-schema, `resume <id>` when continued.
```

`packages/fabrika/src/agents/codex.ts` would export it as `@kampus/fabrika/agents/codex`, as
`claude.ts` does for Claude. `env.ts` would gain a `codexEnv` keep-list (`CODEX_HOME`, `USER`).

What in our Draft contract has no Codex match:

| Ours (Claude) | Codex | What a runner does |
|---|---|---|
| `session.id` picked before the run | Codex picks it, in `thread.started` | a new Msg, `<name>_started {session}` |
| `agent`: a named agent | none in `exec`; a profile file in `CODEX_HOME` comes closest | write the agent's prompt into the prompt |
| `tools`: the whole list, checked against `init` (`extraTools`) | no list, no `init` event | features off by name; count unknown tool items |
| `PreToolUse` hooks: the builder's code Checks | Codex has hooks, not run here | an experiment of its own |
| `maxBudgetUsd` | none | the runner's own clock, then SIGINT |
| `Spend.costUsd`, `turns` | none on a plan | 0, and say so |
| `Spend.context`: size at the last turn | only in the saved session's `last_token_usage` | read it there, or leave 0 |
| `interrupt()` then `close()` | a signal only | SIGINT, wait, SIGKILL |
| An optional field in the answer | refused by strict mode | write it as required and nullable |
| A misfit answer comes back `null` | cannot happen with a schema | keep the path for no-schema runs |

## Verdict

**Recommendation: build a `codex` runner beside `claude`, behind the same Draft Msgs, and try it
first on a read-only stage (triage or the review judge), with a plan login only on the owner's own
machine. Confidence 70%.**

**Changed 2026-10-26** by the owner's ruling in
[Agents sit behind one service](../docs/direction/agents-behind-one-service.md): every stage
reaches an agent through one Effect service whose default layer is our ACP client, so Codex
becomes one provider row there, not a runner of its own. Experiment 153 tries Codex through ACP.
What this experiment found a Codex row needs still holds: the temp home, a read rule that closes
the home folder, a SIGINT stop, the `jsonSchema` fix, and our own clock.

- **Why:** the stream folds into our Msgs with no new idea. The typed answer works from the same
  Effect schema. It ran the job right every time, about four times faster than our haiku builder.
  A temp home keeps the owner's settings out, which experiment 76 thought could not be done
  (it found codex-acp loading the user's config, and no login in an empty home).
- **What it costs:** one runner file and its test, a profile for reads, a SIGINT stop, the
  started-session Msg, and a fix to `jsonSchema` for optional fields. About a day. Runs on the plan
  cost no dollars we can see.
- **The doubt, under 80%:**
  - one tiny job, five runs: a real stage brief may show gaps this one did not;
  - the code Checks (`PreToolUse`) have no tested Codex match, so the builder cannot move yet;
  - the plan login is for one person's own runs, never one login shared between people;
  - permission profiles are beta.
- **What would settle it:** the same runner on a stage's saved cases (the replay set of triage or
  review), 20 or more, both agents; and a hooks experiment for the Checks.

## What it cannot tell us

- **Whether Codex is as good on real work.** One toy job with a known answer, five runs a side.
  Both were right every time, so this cannot tell the two apart on quality.
- **Model against model.** `gpt-6-luna` and `claude-haiku-4-5` are each maker's small model, not
  a matched pair. The speed gap may be the models, the CLIs, or our builder's sandbox.
- **The plan's real cost.** The weekly counter stayed at 0%. How many such runs a week fit is not
  measured.
- **Hooks, MCP servers, subagents, images.** Not run.
- **Remote.** Nothing ran off this laptop. The sign-in section is from OpenAI's docs only.
- **Linux.** Codex's sandbox there is different (Landlock and seccomp); every limit above is the
  Mac's.
- **Versions.** Codex is moving fast: 0.163.0 here, the SDK at 0.164.0. Event names and flags may
  change.
