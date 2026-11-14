---
date: "2026-11-05"
scripts: "none"
summary: "Today's version; reading with file and line for each job, plus one check of tsh's word splitter. A wrapper, for an agent the host starts: `@claude hi` is `tell %n prompt \"hi\"` to an `acp` job, or the `acp ... &` line that starts one. Of 17 jobs, 4 exist, 11 are small changes, 0 are new; signing waits on the envelope build, and another person's agent is out of today's version. The desk's `agents` map is already a one-per-name registry; it gains the job. `@` must be read before the shell words, which drop `#7 twice?`, open a quote at `don't` and make `|` an operator, so it is a line prefix, not an alias or a built-in. Not a wrapper for a Claude Code the person started: reaching it needs a push into its session, and Claude Code's channels are a research preview that drops events silently and skips `-p` and the SDK. Erlang, IRC, Slack, another chat tool and POSIX agree the name form is sugar; a primitive comes only from what the layer below cannot do. No lost fact if the envelope wraps the line as typed, and the lookup and the cost line are written from day one. Lean 80%; the doubt is letting the `acp` harness out of its scratch folder into the repo, the owner's call. No model, $0."
---

# Is `@claude <words>` in tsh a wrapper over what exists, or a new primitive?

Read 2026-11-05. **This is reading, plus one small check run.** The check ran tsh's word splitter
on three `@` lines; nothing else ran, no agent and no model, $0. Today's version (tsh in
`packages/fabrika/src/shell/`, the host and desk in `apps/fabrika/src/`), main at `195bf672`, with
plan 185b's PR 3a (pull request 381) and PR 5 (pull request 382) merged. It checks
[talk where you work](../docs/direction/talk-where-you-work.md) and
[shared tiles](../docs/direction/shared-tiles.md) against the code, and re-decides nothing in them.

**The answer.** A wrapper, for an agent the host starts. `@claude hi` is tsh's own
`tell %n prompt "hi"` to an `acp` job, and with no such job, the `acp ... &` line that starts one.
Of the 17 jobs `@claude` must do, 4 exist, 11 are small changes, and none is new. One waits on the
envelope build ([inputs carry their sender](../docs/direction/inputs-carry-their-sender.md),
decided, not built), which every input needs, not only `@`. One needs two people, which today's
version does not have. No fact is lost, if the envelope wraps the line as typed and the start
carries that envelope as its cause.

Two catches. First, `@` must be read before tsh's shell words: they eat `#7`, open a quote at
`don't`, and turn `|` and `&` into operators (measured below). So `@` is a prefix on the line, as
Claude Code's `!` is, never an alias or a built-in. Second, the wrapper holds only for an agent the
host started. A Claude Code the person started in their own terminal, which dialed in with
`fabrika mcp --as claude`, has no input the host can tell. Reaching it needs a push into its
session. Claude Code's way to push is channels, a research preview that drops events silently, gives
no acknowledgment, and does not run under `-p` or the Agent SDK. That one would be a new primitive.

**How sure: 80%.** The one thing that would change it: if `@claude` must reach a Claude Code the
person started themselves, the verdict becomes "one new primitive, a push into an agent's session".

```text
A sketch, today's version. How `@claude why does post print #7 twice?` in t1 would run.
1. tsh's line door (apps/fabrika/src/tsh.ts:708) sees `@` before the shell words cut the line.
   The envelope wraps the line as typed:
     in-3f9a0c21-50  by user:github:42  {_tag: "line", text: "@claude why does post print #7 twice?"}
2. Look up claude on the desk: desk.agents.claude -> {tile: "t1", job: 12}
   found:      tell %12 prompt "why does post print #7 twice?"                (builtins.ts:135)
   not found:  t1 prints "starting claude: this starts a paid run"
               acp --agent claude --folder <repo> prompt="why does post print #7 twice?" &
               its `began` row carries cause in-3f9a0c21-50
3. The turn ends: acp's `said` output prints under claude's name in t1       (program.ts:195)
```

## The question

The owner and the lead agent both leaned "wrapper", 75%. The way to settle it: list every job the
notes give `@claude`, look for each one in code with a file and line, and mark it. A job with no
line to cite is not marked as existing.

## The verdict rule, set before the tally

- **Wrapper** if every job is EXISTS or a small change, and no fact is lost forever.
- **Not a wrapper** otherwise. Then name exactly which parts are primitive.
- **Two kinds of job are kept out of the count,** and named. A job that waits on a build already
  decided for every input (the envelope) is a dependency, not part of `@`. A job only two people
  can have is out of today's version (one person per app, as inputs carry their sender says).
- **A small change** is under about 50 lines, in a file that already does the same kind of thing,
  with no new design call. A change that is small in lines but needs the owner's call is marked
  small, with the call named.

## Which claude `@claude` reaches

Today's code has two kinds of claude. The tally depends on which one `@` means.

- **A claude the host starts, as a job.** The `acp` program starts an agent harness over the Agent
  Client Protocol and runs each prompt it is told as a turn:
  `acp --agent claude --folder /tmp/s prompt="read a.txt" &`, then `tell %1 prompt "and b.txt?"`
  (`packages/fabrika/src/agents/acp/program.ts:31-36`). Its prompt is a tsh input, so the host can
  tell it words.
- **A claude the person started.** The person runs Claude Code in their own terminal with
  `claude mcp add ... -- fabrika mcp --as claude` (`apps/fabrika/README.md`, "An agent drives a
  program"; the window says the same, `apps/fabrika/src/window/frame.tsx:593-600`). It dials the
  host and calls tools. Every call goes from the agent to the host (`apps/fabrika/src/host/agents.ts`).
  The host has no path back: nothing in `packages/fabrika/src/mcp/` sends the agent anything but
  answers and `notifications/tools/list_changed` (`bridge.ts:84`).

[Shared tiles](../docs/direction/shared-tiles.md) decided "with no claude on the desk, the @ starts
it first". So the host starts it, and the first kind fits. The same note decided `summon` takes any
agent that speaks the agent link. An `acp` job can speak it too, if the host lends the session the
bridge as an MCP server: the ACP client already takes MCP servers to lend
(`acp/client.ts:84`, `client.ts:256-259`), and `program.ts:361` passes none today.

The table below is for the first kind. The second kind's new parts are listed after it.

## The jobs, and what code has today

| # | Job | Today's code | Mark |
|---|---|---|---|
| 1 | Read `@name` off a line | tsh gives `@` no meaning. `@claude` reads as a program and is refused "no program named @claude" (`shell/check.ts:183`). The shell words would eat the prose: `#` starts a comment (`shell/words.ts:56`), a quote opens at `'` (`words.ts:97`), `\|` `&` `;` are operators (`words.ts:72`). | SMALL: a prefix test where the person's line enters tsh (`apps/fabrika/src/tsh.ts:708-710`), before `words`. |
| 2 | Find the running agent by name | Jobs are named only by `%n` or a run id (`host/jobs.ts:260-265`). The desk keeps one tile per agent name, so two tiles for one name cannot be written down, and keeps it across restarts (`desk/desk.ts:133-141`, `:182`, `:657-666`, `:1022-1036`). | SMALL: the desk's `agents` map gains the job beside the tile. |
| 3 | Tab completes agent names | `complete(line, list, jobs)` is pure and completes `tell ` with the jobs (`shell/complete.ts:21-22`, `:44`). | SMALL: hand it the names from job 2. |
| 4 | A bare `@` with one agent | Nothing. It is a count over job 2's map. | SMALL |
| 5 | Start the agent if it is absent | `acp --agent claude ... &` is an ordinary job start. The app does not list `acp` (`apps/fabrika/src/tsh.ts:269-286`). Its folder must be in no git repository (`acp/program.ts:103-114`). Its claude harness lends no MCP server (`acp/harness.ts:741-744`). | SMALL in lines (list it, lend the bridge). **The owner's call:** letting the harness work in the repo, out of its scratch folder and its sandbox. |
| 6 | Start it only if it is yours | The person's tsh starts jobs as the person (`shell/execute.ts:641`, `by: shell.by`). `stop` already refuses an agent's tsh by its writer (`shell/builtins.ts:190-191`). | SMALL: the same check, so an agent's tsh cannot start a paid run with `@codex`. |
| 7 | Say the cost before starting | `acp` takes `--budget` (`program.ts:179`) and says each turn's cost (`program.ts:461`). Nothing says "this starts a paid run" before a start. | SMALL: one printed line, and one recorded fact (below). |
| 8 | Deliver the words | `tell %n prompt <words>` checks the input and its shape, refuses in words, and handles a full mailbox (`shell/builtins.ts:135-180`). `prompt` is acp's input (`program.ts:185`). | EXISTS |
| 9 | The words are signed by the person | A job keeps who started it (`host/jobs.ts:68-72`). No input carries its sender: no `InputId` or `cause` anywhere in `packages/fabrika/src` or `apps/fabrika/src`. | Dependency: the envelope build, decided for every input. |
| 10 | The reply shows in the tile | acp sends `said` once a turn ends (`program.ts:195`, `:451-452`). tsh prints a background job's output as `[n] said ...`, or by a line form the output declares (`shell/execute.ts:308-318`). | SMALL: give `said` a line form under the agent's name. |
| 11 | The agent's own lines show | With the bridge lent, its `line` tool runs lines in its own tile today (`apps/fabrika/src/host/serve.ts:529-541`). | EXISTS. Shared tiles moves them into the person's tile; that is its build, not `@`'s. |
| 12 | `@` from another tile | `tell` reaches only runs this tsh started (`shell/execute.ts:53`, `live`), and calls any other job "detached", which is wrong here (`builtins.ts:140-145`). The host already routes a stop to the tile that owns the job (`serve.ts:508`, `tiles.stopJob`). | SMALL: route a tell the way stop is routed. |
| 13 | Unknown name | `didYouMean` (`shell/did-you-mean.ts:41`), as `tell` uses it (`builtins.ts:56-61`). | SMALL |
| 14 | Two agents with one name | Job 2's map holds one per name by its shape. The host's own list of dialed-in agents keeps two of one name as two (`serve.ts:390-393`). | SMALL: refuse a second start under a name in use, in words. |
| 15 | Another person's agent, not running | One person per app today. | Out of today's version. |
| 16 | The link drops mid-send | acp, started again, opens the same session and sends the prompt a kill cut off (`program.ts:44-47`). `tell` to a job from an earlier tsh is refused with "attach %n &" (`builtins.ts:141-145`). The bridge answers -32000 while no host answers (`mcp/bridge.ts:45`, `:72`). | EXISTS |
| 17 | The person stops it | `stop %n` stops any job from a person's tsh (`shell/builtins.ts:182-199`); an `acp` job is a job like any other. | EXISTS |

**Tally, of 17 jobs: 4 EXISTS, 11 SMALL, 0 NEW, 1 dependency, 1 out of today's version.**

- EXISTS (4): deliver (8), the agent's own lines (11), the link drop (16), stop (17).
- SMALL (11): read `@` (1), find by name (2), Tab (3), bare `@` (4), start (5), only yours (6),
  the cost line (7), the reply's form (10), from another tile (12), an unknown name (13), two of one
  name (14). One of them, job 5, carries an owner's call.
- Kept out: signing (9), a dependency; another person's agent (15), out of today's version.

By the rule: a wrapper.

## The claude the person started

For a Claude Code that dialed in by itself, three jobs have nothing in code, and nothing small
would do them.

- **Deliver the words.** Nothing sends into the agent. Claude Code's channels can: an MCP server
  declares `claude/channel` and sends `notifications/claude/channel`
  ([channels reference](https://code.claude.com/docs/en/channels-reference)). But channels are in
  research preview. A channel not on the allowlist needs `--dangerously-load-development-channels`,
  with a full-screen warning at start. "Claude Code doesn't acknowledge notifications." If the
  session did not load the server as a channel, "Claude Code drops the events silently." And under
  `-p` or the Agent SDK, "Claude Code ignores the flag and the channel doesn't register."
- **Show the reply.** Its words stay in its own terminal. The host sees only its tool calls. A
  reply would need a reply tool the agent is told to call, which channels also describe.
- **Start it.** The host cannot start the person's own Claude Code in their own terminal.

So for this kind, the push is a new primitive, and it rests on a preview feature with silent drops.
That is why the lean below keeps `@` to agents the host starts.

## The known way

| Maker | Name form, id form | Sugar? | What forces a primitive |
|---|---|---|---|
| Erlang | `Name ! Msg` and `Pid ! Msg`. `Expr1` "must evaluate to a pid, an alias (reference), a port, a registered name (atom), or a tuple `{Name,Node}`"; for a name not registered, "a `badarg` run-time error occurs" ([expressions](https://www.erlang.org/doc/system/expressions.html)). `whereis/1` "returns the pid registered under `Name`, or `undefined`" ([processes](https://www.erlang.org/doc/system/ref_man_processes.html)). | Yes: by name is `whereis` then send. | The registry, `register/2`. A `via` registry must export `register_name/2`, `unregister_name/1`, `whereis_name/1` and `send/2`; `gen_server:cast` answers `ok` "ignoring if the destination node or `gen_server` process does not exist", `call` exits `noproc` ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)). |
| IRC | `/msg nick text` is the client's word for `PRIVMSG <msgtarget>`, where msgtarget "is usually the nickname of the recipient". Nicknames are unique; a miss is `401 :No such nick/channel` ([RFC 2812](https://www.rfc-editor.org/rfc/rfc2812)). | Yes: `/msg` is client sugar; the server resolves the nick. | Uniqueness on the server (`433 :Nickname is already in use`). Services such as NickServ are only nicks. |
| Slack | "To mention a user, provide their user ID": `<@U012AB3CD>`. Parsing mentions by name is deprecated ([formatting](https://docs.slack.dev/messaging/formatting-message-text/)). | Yes: the client turns `@name` into the id. | Nothing new. The server only ever gets the id. |
| Discord | `<@USER_ID>`, for example `<@80351110224678912>` ([reference](https://docs.discord.com/developers/reference)). | Yes, the same. | Nothing new. |
| Unix shells | A builtin is "necessary to implement functionality impossible or inconvenient to obtain with separate utilities" ([bash](https://www.gnu.org/software/bash/manual/html_node/Shell-Builtin-Commands.html)). "Since cd affects the current shell execution environment, it is always provided as a shell regular built-in" ([POSIX cd](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/cd.html)). An alias replaces the first word of a command, after the line is cut into words ([bash aliases](https://www.gnu.org/software/bash/manual/html_node/Aliases.html)). | An alias or a function is sugar; `cd` is not. | Changing the shell's own state. `cd` in a child process changes the child. |

**What they agree on.** The name form is sugar over the id form everywhere. Something becomes a
primitive only when the layer below cannot do it at all: hold a name to id binding (Erlang's
registry), keep names unique (IRC's server), or change the caller's own state (`cd`). For
`@claude`, the binding exists (the desk's `agents` map, job 2), the uniqueness exists (the same
map), and the target's inbox exists for a host-started agent (acp's `prompt`). The one thing with no
layer below is a push into a session the host did not start.

**One thing they do not cover.** Each of them reads the name off a line already cut into words.
tsh cannot: its words were made for programs and flags, and they mangle prose. Claude Code's `!`
takes the rest of the line raw ([interactive mode](https://code.claude.com/docs/en/interactive-mode)),
and `@` has to do the same. The check:

```text
words(line), from packages/fabrika/src/shell/words.ts at 195bf672, run with node 26.13
"@claude why does post print #7 twice?"  ->  @claude · why · does · post · print          "#7 twice?" is gone
"@claude don't touch main"                ->  @claude · dont touch main (quote left open)
"@claude run a | b & tell me"             ->  @claude · run · a · <|> · b · <&> · tell · me
```

So `@` is not a tsh alias and not a built-in in `BUILTINS` (`shell/grammar.ts:79-89`), whose
words are cut the same way. It is a prefix the line door reads first. And the wrapper should call
`tell`'s own code with the words as a value, never write a quoted `tell` line and parse it again:
quoting prose into a shell line is where the bugs would come from.

## Data shape

What the host log and the rows record under each answer.

```ts
// A sketch, today's version. The facts, under the wrapper.
// The input: the line as typed, wrapped at the door. The person wrote `@claude`, by name.
{id: "in-3f9a0c21-50", by: "user:github:42", at: 1767225600000,
 input: {_tag: "line", text: "@claude why does post print #7 twice?"}}
// What the name meant at that moment. Gone forever if not written: the desk's map changes later.
host/log  message=at_resolved cause=in-3f9a0c21-50 agent=claude job=12 tile=t1
// A start caused by a mention, with the cost said first.
{type: "began", n: 12, by: "user:github:42", text: "@claude why does ...", cause: "in-3f9a0c21-50",
 warned: "paid_run"}

// Under a primitive: one input kind of its own.
{id: "in-3f9a0c21-50", by: "user:github:42", at: 1767225600000,
 input: {_tag: "to", agent: "claude", words: "why does post print #7 twice?"}}
```

| Fact, true only when it is written | Wrapper keeps it? | How |
|---|---|---|
| The person wrote `@claude`, not `tell %12` | Yes | The envelope's input is the line as typed, not its expansion. |
| The words exactly as typed, `#7` and `'` included | Yes | The same line; the words are never re-quoted. |
| Which job the name meant then | Only if written | One log line, or a field, at the lookup. |
| A start was caused by a mention | Yes | The `began` row's `cause` names the line's envelope. |
| The person was told it costs a paid run | Only if written | A field on `began`, or a log line. |
| The agent's reply answers this line | Yes | Its `said` is the job's output; the turn follows the prompt. |

**Lost facts.** None, on two conditions. The envelope must wrap the line before the expansion,
which the line door already allows: the person's line is tsh's `line` input
(`apps/fabrika/src/tsh.ts:710`). And the two "only if written" facts must be written in the first
build, since a later field never reaches the rows written before it. A wrapper that wrote only the
expanded `tell %12 prompt ...` would lose the first, third and fifth facts for good.

A primitive's own input kind (`{_tag: "to", ...}`) holds the same facts in a typed field instead of
in the text. That is a real gain for reading, not a fact the wrapper loses: the line as typed holds
it, and the typed field can be read out of it later. Today's tsh keeps no input kinds per line, so
the wrapper fits what is there.

## Verdict

**A wrapper, for agents the host starts.** Every job is there or a small change, and with the two
"only if written" facts written, nothing is lost. The parts:

- the line door reads `@` first, before the shell words (job 1);
- the desk's `agents` map, which is already a one-per-name registry, gains the job (job 2);
- `tell`'s code delivers, and `acp`'s `said` answers (jobs 8, 10);
- `acp` is listed in the app and lent the bridge (job 5).

**Not a wrapper, for a Claude Code the person started:** a push into its session is a new
primitive, and today the only way is a research preview.

**How sure: 80%.** The doubt is job 5. It is small in lines, but letting an `acp` harness work in
the repo with the agent link lent is a security call: today that harness is held to a scratch
folder in no repository, sandboxed, with no MCP server. If the owner keeps it there, the
host-started claude cannot work on the repo, and the verdict holds only for scratch work.

**The one thing that would change it:** the owner saying `@claude` must reach the Claude Code he
started himself. Then a push into the agent's session is a new primitive, on a preview feature that
drops events silently.

## Leans

- **Build `@` as a line prefix that calls `tell`'s code with the words as a value.** Why: it reuses
  delivery, refusals and the mailbox bound, and never re-parses prose. Cost: about 150 to 250 lines
  with tests, close to the note's guess of 200. How sure: 80%.
- **`@` reaches only agents the host started.** A Claude Code that dialed in by itself stays listed
  in the top bar, and `@` to it is refused in words, until channels leave preview. Why: the push
  drops events silently and has no acknowledgment, and "a reply never shows" is the worst failure
  for a chat. Cost: a person who starts Claude Code themselves cannot `@` it. How sure: 65%. The
  doubt is the daily habit: if the owner starts Claude Code himself every day, this lean fights it.
  A week of his use settles it.
- **Write the lookup and the cost line from day one.** Why: both are true only at the moment.
  Cost: one log line and one field. How sure: 85%.

## For `next/`

In `fabsh` the same shape holds, one layer out. `@reviewer <words>` is a `Talk` to
`agents/<member>/reviewer` ([the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md#10-how-agents-talk-to-each-other-across-two-people)):
a write to a registered name's inbox, as today's `cast` writes one (`host/host.ts:140-150`), with
`whereis` saying whether it runs (`host/observer.ts:23`). That is Erlang's `gen_server:cast`
answering `ok` whether or not the process exists, which is the note's "the talk waits in its inbox".
The new rule `next/` adds is "never start another person's agent", a check at the door, not a new
kind of message. Still open there: which thread a tsh `@` line's talk goes in.

## Made up here

The `at_resolved` log message and its keys, `warned` and `paid_run`, the `{_tag: "line"}` and
`{_tag: "to"}` input kinds, `desk.agents.claude -> {tile, job}`, job `%12`, the ids
`in-3f9a0c21-50` and the account number `42`, the time value, and the words "starting claude: this
starts a paid run".

## What it cannot tell us

- Nothing ran but the word splitter. No `acp` job was started, no prompt told, no reply shown.
- Whether an `acp` claude with the agent link lent works in practice: two links in one session, its
  tool calls as `agent:claude`, its asks on `ask`. [Experiment 76](./76-acp-client.md) ran `acp`
  live with claude, but in a scratch folder and with no MCP server lent.
- Whether the harness should leave its sandbox for the repo. That is the owner's security call,
  and this reading does not make it.
- Whether people will start Claude Code themselves more often than through `@`. Only use says.
- The line counts are guesses from reading.
- Channels were read in their docs only. Their behavior on this laptop was not tried.
