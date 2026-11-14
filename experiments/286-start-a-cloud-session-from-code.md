---
date: "2026-11-14"
scripts: "none kept; a 20-line Agent SDK probe and CLI runs, the short output is in the write-up"
summary: "Both versions; about $0.14 at list price on the subscription. Yes only from inside a cloud session: its agent's `create_session` tool started one new cloud session with no click (it answered \"ready\" about 7 s later). From plain code, no: the Agent SDK 0.3.325 runs the agent as a local child process and has no cloud option, `claude -p --cloud` is refused, and `claude --cloud` behind a fake terminal got past every prompt but was refused with a 403 using the box's login. Nearest thing for fabrika: one coordinator cloud session that code feeds with messages, and that starts the workers. Its reports back to a laptop session need the owner's one-time, in-person yes per cloud session"
---

# 286. Can a program, with no person typing, start a Claude cloud session?

Run on 2026-11-14 (UTC) inside one Claude cloud session (Anthropic's own cloud, Linux, Claude Code
CLI 2.1.325, `@anthropic-ai/claude-agent-sdk` 0.3.325, Node 22). It is about both versions: today
the owner starts each cloud session by hand, and `next/` plans to start agents from code. No key,
token or login was added. No routine, schedule or trigger was made. Cost: two tiny model calls on
the subscription, **about $0.14 at list price** (the tools' own `costUSD` figures, list basis,
2026-11-14).

**The answer: one way worked, and only from inside a cloud session. An agent in a cloud session
started a new cloud session with its built-in `create_session` tool, and nothing a person typed
was involved. From plain code the answer is no: the Agent SDK only runs the agent where your code
runs, headless `claude -p --cloud` is refused, and interactive `claude --cloud` behind a fake
terminal got past every prompt but was refused with a 403 using this box's login.**

| Way | Starts a new cloud session? | Measured or read | What it needs |
|---|---|---|---|
| `create_session` tool of an agent already in a cloud session | **yes** | ran | a cloud session a person started once |
| Agent SDK `query()` | no, runs where it is called | ran, and read its types | a login on the calling machine |
| `--cloud` passed to the SDK through `extraArgs` | no, refused | ran | nothing helps |
| `claude -p "<task>" --cloud` | no, refused | ran | nothing helps |
| `claude --cloud "<task>"` behind a fake terminal (`script`) | no here (403); untested with a laptop login | ran | a real claude.ai login and a TTY |
| `claude -p "<msg>" --cloud <id>` | no, only messages a session that exists | ran (failed here on auth) | a real login |
| `claude -p --environment <ccpool_...>` | yes, says the help, on a self-hosted runner | read in help | Team or Enterprise, a self-hosted runner |
| SDK `/bridge` export `createCodeSession` | maybe; `@alpha`, not in public docs | read in types only | an OAuth token passed in by hand |
| Routines with an API trigger | yes, from a fixed saved prompt | read in docs | the owner said no to routines |
| Managed Agents | a different product | read in docs | an API key, API billing |

```text
// The whole idea, as it ran:
agent in cloud session A  --create_session(prompt: "Say ready and stop.")-->  cloud session B
B: environment_kind "anthropic_cloud", origin "claude_code_mcp_seed", parent = A
B answered "ready" about 7 s after it was created, then went idle.
```

## 1. What is in the box (ran)

`claude --version` printed `2.1.325 (Claude Code)`. `claude auth status` said `loggedIn: true`,
`authMethod: "oauth_token"`, `apiProvider: "firstParty"`. The flags in `claude --help` that name
cloud, remote, environment or session:

- `--cloud [description|session_id|url]`: "Create a cloud session with the given description, or
  attach to an existing one by session ID or claude.ai/code URL".
- `--environment <environment_id>`: "Create a new cloud session that runs on the given self-hosted
  environment (ccpool_...)".
- `--remote-control [name]` and `--remote-control-session-name-prefix`: steer a local session from
  claude.ai. They start no cloud session (the cloud docs say so too).
- `--teleport [session]`: pull a cloud session into this terminal.
- `--bg` and the `agents`, `attach`, `logs`, `stop`, `rm`, `respawn` commands: background sessions
  on the same machine.
- `ultrareview`: "Run a cloud-hosted multi-agent code review". It is a review, not a general
  session.
- `setup-token`: "Set up a long-lived authentication token (requires Claude subscription)". Not
  run: it would add a login, which the brief forbids.

The environment has about 60 variables whose names hold `CLAUDE` or `ANTHROPIC`. The ones that
matter here: `CLAUDE_CODE_REMOTE`, `CLAUDE_CODE_REMOTE_SESSION_ID`,
`CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`, `CLAUDE_CODE_REMOTE_SDK_URL`, `CLAUDE_CODE_USE_CCR_V2`,
`CLAUDE_SESSION_INGRESS_TOKEN_FILE`, `ANTHROPIC_BASE_URL`. No values were printed or written.

## 2. The Agent SDK (ran, and read its types)

`npm install @anthropic-ai/claude-agent-sdk@latest` in a scratch folder outside the repo gave
0.3.325. The package has five entry points: `.` (`query`), `./core`, `./browser`, `./bridge` and
`./sdk-tools`.

**`query()` options.** All 69 keys were read. The ones near "run somewhere else":

- `spawnClaudeCodeProcess`: "Custom function to spawn the Claude Code process. Use this to run
  Claude Code in VMs, containers, or remote environments." You bring the VM and the process
  yourself; the SDK still talks to it over stdin and stdout. It does not start a cloud session.
- `pathToClaudeCodeExecutable`, `executable`, `executableArgs`, `extraArgs`, `env`: which binary
  runs and with what flags. Still a child process of the caller.
- `sandbox`: "commands are executed in a sandboxed environment that restricts" file and network
  access, on the same machine.
- `toolAliases`: its comment gives the example "a host that runs Bash inside a remote sandbox via
  an MCP tool". The agent loop stays local.

No option is named remote, cloud, environment, host or URL in the sense of "run there".

**The smallest call** (prompt "Say ready.", `tools: []`, `maxTurns: 1`), with a spawn hook that
logs the child:

```text
caller pid 929 host vm
child pid 936 argv has --cloud false
init apiKeySource none model claude-opus-5-5 cwd-is-local true
assistant ["Ready."]
result success is_error false usage {"in":2,"out":6,"cr":0,"cc":1092} cost 0.008864
```

It ran as a child process on the same machine, with the box's own login (`apiKeySource: none`
means no API key; the login came from the box). That matches the hosting page's "spawns and
supervises a `claude` CLI subprocess".

**`--cloud` through the SDK.** The same call with `extraArgs: { cloud: null }` put `--cloud` on the
child's command line. The child exited 1:

```text
Error: --cloud requires an interactive terminal.
Non-interactive invocations (piped stdout, --init-only, --sdk-url) run locally and would silently ignore --cloud. Drop --cloud, or run from a TTY.
```

**MCP tools in an SDK child.** An SDK child started here reported `mcp_servers: []`, and
`claude mcp list` said "No MCP servers configured". The session tools this agent has
(`create_session`, `send_message` and the like) come from the cloud session's host. A process
that code starts does not get them.

**The `./bridge` export (read in types only, not called).** Every item is marked `@alpha`, "a
separate versioning universe from the main `query()` surface". It has
`createCodeSession(baseUrl, accessToken, title, ...)`, whose comment says "`POST /v1/code/sessions`:
create a fresh CCR session ... Callers supply their own OAuth token, this is a thin HTTP wrapper
with no implicit auth, so it works from any process". It also has `fetchRemoteCredentials` and
`attachBridgeSession`, which make the calling process the session's worker. Read that way, a
session made this way runs its agent on the caller's machine and shows it in claude.ai, much like
Remote Control. That is a guess from the types. It was not called: the endpoint is not in the
public docs, and it needs a raw OAuth token handed in by hand. The `./browser` export is a client
for a session that already exists: it takes `streamUrl` and `sendUrl` for
`/v1/code/sessions/{id}/events`.

**Docs read this time:** the SDK quickstart, the TypeScript and Python reference pages and the
env-vars page say nothing about starting a cloud session from the SDK. The TypeScript page names
cloud sessions only as a place the SDK can run in (`CLAUDE_CODE_REMOTE`), and lists cloud
scheduled tasks and messages from other sessions as inputs a session can receive.

## 3. The headless CLI (ran)

| Command | Exit | Output |
|---|---|---|
| `claude -p "say ready" --cloud` | 1 | `Error: --cloud cannot be combined with --print.` then "Starting a new cloud session with --cloud is interactive only: drop --print, or drop --cloud to run locally. To message an existing cloud session instead, pass its ID" |
| the same, stdin from `/dev/null` | 1 | the same text |
| `claude -p "<msg>" --cloud <this session's id>` | 1 | `Error: failed to send message to cloud session cse_…: Session expired. Please run /login to sign in again.` |
| `claude -p "say ready" --environment` (no id) | 1 | `error: option '--environment <environment_id>' argument missing` |
| the same, stdin from `/dev/null` | 1 | the same text |

The third row turned this session's `session_…` id into a `cse_…` id, so the form is real. But the
box's login is scoped to this one session and cannot use the sessions API. On the owner's laptop,
with a real claude.ai login, this row should work: the CLI reference says so, and it was not
tested here.

## 4. Interactive `--cloud` from code, behind a fake terminal (ran)

`--cloud` asks for a TTY, so the test gave it one. `script -qec 'claude --cloud "Say ready and
stop."'` was run with key presses piped in (Enter, a down arrow, Enter):

1. First run, no keys: it stopped at the first-run theme picker. Killed by the timeout (exit 124).
2. Enter keys: past the theme and the security notes, then stopped at "Is this a project you
   created or one you trust?", where the default is "No, exit". Exit 1.
3. Down arrow and Enter: past the trust prompt, then
   `Error: Cloud session create failed: Request failed with status code 403`. Exit 1.

So the TTY is not the wall. Code can drive the prompts. The wall here was the login: this box's
token may not create sessions. With the owner's own login on the laptop, the same driving could
work: once the theme and the folder trust are saved, only the create call is left. That was not
tested, so it is a guess, about 60% sure. Even if it works, it leans on the screen text of an
interactive program, which can change with any release.

## 5. The one that worked: `create_session` from inside a cloud session (ran)

Every Claude cloud session's agent has tools from its host (`claude-code-remote`):
`create_session`, `send_message`, `list_events`, `get_session`, `interrupt_session`,
`archive_session` and more. This agent called `create_session` once, with the prompt "Say ready
and stop." and no repository. What came back, with the ids left out:

```text
create_session: session_status SESSION_STATUS_PENDING, environment_kind "anthropic_cloud",
                origin "claude_code_mcp_seed", parent_session_id = this session
B, first user event: "Say ready and stop.", inbound_origin "mcp_create_session"
B, assistant: "ready" (input 2, output 4, cache read 56,657, cache write 14,518 tokens)
B, result: success in 4.3 s of turn time, about 7 s after creation; costUSD 0.1276 (list basis)
B, after: SESSION_STATUS_IDLE, status_bucket COMPLETED, rate limit "allowed", no overage
```

B ran on the owner's subscription, in the same cloud environment as its parent, with the same
model. Its prompt carried about 71,000 tokens of system prompt and tools before the five words, so
even an empty session costs about $0.13 at list price for its first turn. B's own tool list
(`turn_handoff.tools` in its metadata) has the trigger and repository tools but not
`create_session` or `send_message`. So a child may not be able to start its own children. That
was read from metadata and not tried.

The docs support the same shape: a Claude project is "one coordinating conversation" that "starts
a thread for each task", each thread usually a cloud session
(<https://code.claude.com/docs/en/claude-projects.md>). Messages between sessions are a documented
input (the TypeScript SDK page).

## The nearest thing that works today for fabrika

**One long-lived coordinator cloud session, started once by a person. Code feeds it work, and it
starts the worker cloud sessions with `create_session`.** This experiment ran that way: the lead
session on the laptop sent the brief to this cloud session as a message, and this session started
a child with no click. The laptop side can feed the coordinator in two ways: a session-to-session
message, as here, or `claude -p "<msg>" --cloud <coordinator id>` with the owner's laptop login
(documented, not tested here). About 85% sure this holds for daily use. The doubts: the coordinator
is a model and not code, so "start a session for brief X" is a request it follows, not a function
call. Its container is reclaimed when idle, so it must be resumed by a message. And how many
children it may start, and how fast, was not measured.

The way back has one gate (ran). When this session first sent its report to the lead session on
the laptop, `send_message` was refused with `elevated_session_untrusted_device`: a cloud session
may message a session on the owner's own computer only once the owner allows it, in person, on a
trusted device. The owner allowed it from a card in the Claude app, and the second send was
delivered. That yes cannot be undone, and it limits that cloud session to the owner's trusted
devices from then on. So each coordinator cloud session needs one tap from the owner before it can
report to the laptop. Messages from the laptop to the cloud session needed no such step.

If code with no model in the middle must create the session, the candidates are, in order:

1. `claude --cloud` driven through a pseudo-terminal on the laptop, with the owner's login.
   Untested; fragile.
2. The SDK's `@alpha` `createCodeSession`. Not public, and it looks like a Remote Control style
   session whose worker is the caller, not a cloud container.
3. `--environment` on a self-hosted runner (Team or Enterprise).
4. Routines with an API trigger, which the owner ruled out.

## What this cannot tell us

- Whether `claude --cloud` behind a fake terminal works with a real laptop login. Here the 403 came
  from this box's session-scoped login, so it says nothing about the owner's.
- Whether `claude -p "<msg>" --cloud <id>` works from the laptop. It failed here on auth only.
- What `createCodeSession` really creates, since it was not called.
- How many sessions a coordinator may start, how fast, and what the subscription's limits are. One
  child was started, and the brief allowed no more.
- Whether a child can start its own children. Only its tool list was read.
- How a coordinator session behaves after its container is reclaimed and it is woken by a message.
- The probe script and raw output are not kept. The short lines above are all there is; the SDK
  probe was a 20-line `query()` loop with a `spawnClaudeCodeProcess` hook that logs the child's pid
  and argv.
