# Summon guidelines: naming agents in the shell, and the grammar for it

**Proposed 2026-11-06.** Nothing new here is decided. It stands on these, decided before it and not
asked again ([talk where you work](./talk-where-you-work.md)):

- **Decided 2026-11-05:** `@` is read off the line before tsh's shell words, like Claude Code's `!`,
  and the log keeps the line as typed and what the name meant then.
- **Decided 2026-11-06:** `summon <agent> [model] [effort] as <name>` starts an agent; `@` talks only
  to one summoned already; tab completes only names that exist; model and effort are set at the
  summon, and a later change is the agent program's own command; the log keeps who, the agent, the
  model, the effort, the name and both clocks.
- **Decided 2026-11-06:** a summoned agent lives on the desk, not in a tile; `dismiss` ends it; the
  top bar counts the agents and its list has a dismiss on each.
- **Decided 2026-11-06, for `next/`:** `summon` is an alias with a session, `on <hands>` pins where
  it runs, the brain keeps alias and session, names belong to a person, permissions ride on the
  alias, two messages queue in the run's one mailbox.
- **Decided 2026-11-05:** each harness's own permission words pass through, and the started agent
  works in the person's repo.
- **Proposed:** [fabsh grows into a language](./fabsh-grows-into-a-language.md), and
  [program guidelines](./program-guidelines.md) G7 R5 (decided) for the rows completion can read.

Built from [experiment 220](../../experiments/220-summon-guidelines.md), which read about 16 makers
and checked today's `@claude` line in tsh against them, and a Design canvas, "Summon guidelines",
that a second pass draws. Neither is a measurement.

```text
A sketch, today's version (tsh). The whole idea: two lines, one grammar.
tsh$ summon claude haiku high as scout
  scout · claude haiku (claude-haiku-5-5) · high · on this Mac · ready
tsh$ @scout why does post print #7 twice?
  ✦ scout  reading programs/tracker/post ... 2 tool calls · 14s          (a status, in place)
  ✦ scout  It formats the number in two places: ...                        (the reply, once whole)
tsh$ agents
  scout   claude haiku high   idle   since 10:42   $0.03
tsh$ dismiss scout
  scout dismissed
```

```text
One line traced, today's version: "@scout why does post print #7 twice?"
1. the grammar sees '@' as the line's first character: rule said. It reads the name "scout"
   [1,6) and stops reading words. The prose is [7,38), as typed: "#7 twice?" stays.
2. roles, for the editor: '@scout' = name-ref (known: plain) · the rest = prose (one color)
3. the check looks scout up in the desk's names: found, job 12, idle.
4. the host log: at_resolved cause=in-... name=scout agent=claude job=12
5. tsh tells job 12 its prompt input with the prose as a value (never a quoted tell line)
6. the turn runs in the foreground; Ctrl-C tells job 12 `cancel`; scout stays summoned
```

## Which version

- **Today's version** (tsh in `packages/fabrika/src/shell/`, the host, desk and frame in
  `apps/fabrika/src/`): all of it, as a tryout to feel before fabsh. One `acp` job per summoned
  name, on this Mac only.
- **`next/`:** the same grammar in fabsh, read as a lesson. What changes there is where the alias
  and session live (the brain) and that `on <hands>` runs.

## The shape

### The grammar

Additions to the EBNF at the top of `grammar.ts`. The first rule is new and comes before
everything; the rest are statements beside today's built-ins.

```text
line       said | statements                        a line whose first non-space character is '@' is said
said       '@' [name] prose                         prose: the rest of the line, as typed; no words, no #, no quotes
statements statement (sep statement)*               as today
statement  summon | dismiss | builtin word* ['&'] | pipeline ['&']
summon     'summon' agent [setting [setting]] 'as' name ['on' place]
dismiss    'dismiss' name
agent      word                                     checked: one of the harnesses (claude, codex)
setting    word                                     checked: a model or an effort of that agent, below
name       word                                     checked: the name rule (S3)
place      word                                     today: always refused (S5)
```

- **`as`, `on` and `summon` are keywords only in their slot,** as POSIX keeps reserved words to
  "certain positions" [p1]. `as` is a keyword only after `summon`'s settings, so `tell %1 as` is
  untouched.
- **`said` is a lexer mode, not a word.** POSIX does the same for a here-document, whose body is
  read by other rules [p1]. It writes the decided "read before shell words" as a rule of the
  grammar, so the editor knows where prose starts.
- **`@` with no name** stays as decided: the only agent summoned, or refused in words.

### Tokens with roles

Today every token keeps `start` and `end` (`words.ts:22-32`). The parse adds one thing: a role per
span. Highlighting, completion and refusals all read this one list, as fish and Nushell do [f2]
[n1], so they cannot disagree.

```ts
// A sketch, today's version. One span per token, from the parse, never from a regex over the line.
type Role =
	| "verb"        // summon, dismiss, a built-in, a program
	| "keyword"     // as, on
	| "agent"       // claude, codex
	| "setting"     // haiku, high
	| "name-new"    // the name after `as`
	| "name-ref"    // the name after `@` or `dismiss`
	| "prose"       // what a said line sends, as typed
	| "unknown";    // anything the check refused, with its why
type Span = {start: number; end: number; role: Role; why?: string};
type Read = {spans: ReadonlyArray<Span>; expects: ReadonlyArray<Role>}; // expects: at the cursor
```

```text
complete, by what the cursor expects
"summon "                    agent      claude codex                      the harness list (harness.ts:94)
"summon claude "             setting    haiku sonnet opus ... low ... max  the last list claude gave, then `as`
"summon claude haiku as "    name-new   nothing: a new name is the person's; the hint says "a name"
"@"                          name-ref   scout researcher                  this person's names, from the desk
"dismiss sc"                 name-ref   scout
```

- **`@` names reuse the picker's source.** The desk already keeps one index of rows
  (G7 R5); summoned agents are one more source in it. tsh matches those rows by prefix, as
  readline does; a text box's `@` menu is the picker
  ([PR 419](https://github.com/usirin/tea-fabrika/pull/419), its Q1: a source, the desk's ranker,
  rows with an id) with that source narrowed to agents. One list, two ways to match.

### What a summon records

```ts
// A sketch, today's version. One row in the host log, and the name on the host's desk.
{message: "summoned", by: "user:github:42", name: "scout", agent: "claude",
 model: {typed: "haiku", resolved: "claude-haiku-5-5"}, effort: {typed: "high", set: "high"},
 place: "this-mac", job: 12, at: 1767225600000, said: 1767225599870}
{message: "dismissed", by: "user:github:42", name: "scout", job: 12, cut: null}  // cut: the turn cancelled, if one ran
```

## The seven principles

### S1: one grammar, typed tokens, every view reads it

**Lean, 85%.**

- **What.** The parse gives every span a role; the editor's colors, Tab, the refusal's caret and
  the did-you-mean all read that one list. No regex over the line anywhere.
- **Why.** fish "interprets the command line as it is typed" [f2]; Nushell: "Type checks are a
  parser feature" [n1].
- **Linear as the builder.** Linear's filter bar reads typed words and shows each as a chip of its
  kind. On our pieces: the parse is tsh's, the colors are the editor's, and the roles are the
  piece every line gets for free, `summon` or `ship`.
- **Elm.** The roles are `view` of the parse, which is a pure function of the line.
- **What holds it.** A law: for any line, every character sits in at most one span, and a refused
  line has exactly one `unknown` span at its refusal's `at`.
- **Doubt.** Whether the roles are worth it before a second keyword-heavy command
  ([fabsh grows into a language](./fabsh-grows-into-a-language.md) asks the same). Settled by
  whether `summon` alone needs four colors in use.
- **Today.** Half: positions exist (`words.ts:22-32`); nothing gives a span a role.

### S2: the words after `@name` are the agent's, as typed

**Lean, 85%; the reading order is decided.**

- **What.** A said line's prose is never cut into shell words. `#`, `'`, `|`, `&` and `;` are text.
  So a said line cannot pipe or go to the background: it is one turn.
- **Why.** Experiment 210 and 220 ran it: `#7 twice?` vanishes, `what's` opens a quote. Warp
  guesses and misfires both ways [w1]; an explicit sigil never guesses.
- **Linear.** A mention in a comment box: the rest of the box is the message. Same here.
- **OTP.** `Name ! Msg`: the message is one value, whatever is in it.
- **What holds it.** A law over random prose: the value told equals the line from the first
  character after the name and its one space, exactly.
- **Doubt.** A person who wants `@scout ... | outline` cannot have it (design D below answers it).
- **Today.** Breaks: `words.ts:56-76` acts on prose.

### S3: a name is a lower-case writer id, unique per person, refused on clash

**Lean, 80%.**

- **What.** A name follows the door's writer rule, `^[a-z0-9][a-z0-9._-]{0,63}$`
  (`door.ts:347`), since the name becomes the agent's writer (`agent:scout for:github:42`). Upper
  case is refused with the lower-case name as its did-you-mean, never folded. A taken name is
  refused: "scout is already claude haiku, since 10:42: dismiss scout first, or pick another name."
  Reserved: `all`, `here`, `everyone`, `me` (kept for later, as Slack's `@here` shows people expect
  them). The agent's own word is allowed: `summon claude as claude` is fine, since agents and names
  never share a slot.
- **Why.** IRC: 433 "Nickname is already in use" and 401 "No such nick" are two errors [i1].
  Discord: lower case where a letter has one [d1]. Slack's last-installed-wins is the trap [s1].
  Radio asks the second of two like call signs to change [o1].
- **Linear.** No Linear answer: Linear's agents are installed by a workspace admin, one name each.
  Where we differ: a person names their own, many of one kind.
- **OTP.** `register(Name, Pid)` fails on a taken name; `Name ! Msg` fails on an unknown one.
- **What holds it.** The desk's names are a map keyed by name; `summon` on a taken key is a refusal
  in the update, not a check in the view.
- **Doubt.** Dots in a name read badly at a sentence's end in a text box (`thanks @scout.`). 60% on
  keeping dots; dropping them changes the door's rule too.
- **Two people.** Today's version has one person per app. In `next/`, names belong to a person, so
  my `scout` and another person's never collide; theirs shows with their name, and `@`-ing it is
  refused, since its permissions are theirs. Lean 70%.
- **Today.** Half: the rule exists for writers; nothing names a summoned agent.

### S4: the shell owns the slots, the harness owns the words

**Lean, 75%.**

- **What.** `summon`, `as`, `on`, `dismiss` and `@` are the shell's and mean the same for every
  agent. `haiku`, `gpt-5-codex`, `xhigh`, `ultracode` are each harness's own, checked against what
  that model offers now. Nothing else goes on the summon line: permissions, budget and mode stay in
  `.fabrika/fabrika.toml`'s harness blocks (decided), and a later change is the agent program's own
  command.
- **How it checks, today.** `summon` starts the `acp` job and opens the session, which calls no
  model, then sets model and effort with ACP's config options, as `acp` already does
  (`client.ts:279-293`). A bad word is refused at the summon, before any paid turn, with the
  harness's list as its did-you-mean. Completion reads the last list each harness gave, kept per
  harness version, and says so in the hint.
- **Two settings, one slot each by type.** With one setting word, the check asks the agent's lists:
  a model or an effort, never both (no list shares a word today). With two, model then effort.
- **Never a silent fallback.** Claude Code falls back to a lower effort in silence [c2]; we refuse
  it in words: "haiku takes no effort" or "opus takes low to max, not ultra".
- **Why.** Codex's effort is what "the selected model" advertises [x1]; Claude's top word is
  `ultracode`, Codex's `ultra` [c1] [x1]; `haiku` meant two models across two CLI versions
  (experiment 158). A shared list of ours would be wrong within weeks.
- **Linear.** Linear's agent picker shows the agent's own settings. On our pieces: the agent program
  owns its words, and the shell only routes them.
- **What holds it.** The check has no list of models in its code; a test with a fake harness that
  offers made-up words passes.
- **Doubt.** Whether opening a session is free for every harness: read in code, not on a bill.
- **Today.** Half: checked by the harness's list, but only after a run starts (`program.ts:367-369`).

### S5: say where it runs, and never claim a place it is not

**Lean, 85%.**

- **What.** Today's version runs every summoned agent as an `acp` job on this Mac. The grammar
  takes `on <place>` so the line matches fabsh, and the check refuses it in words: "today's fabrika
  runs agents on this Mac only; `on` needs the brain". The summon's answer and the `agents` list say
  "on this Mac". A phone cannot reach it, and the note says so instead of hiding it.
- **Honest in today's version:** a name kept on the host's desk; the session kept by `acp`, which
  reopens it after a restart (`program.ts:41-47`); the record in the host log; Ctrl-C and `cancel`.
- **Not honest in today's version:** `on cloud`, a phone, a session kept while the Mac sleeps, a
  second person's names. Each is refused or absent, never drawn.
- **Why.** [Principle 5](./principles.md) and the public rule of this repo's notes: a sketch is
  marked a sketch. GitHub Actions refuses a `runs-on` label no runner has, and waits; it never runs
  elsewhere.
- **Today.** Passes by absence.

### S6: a turn is a foreground job, and Ctrl-C cancels the turn, not the agent

**Lean, 65%.**

- **What.** `@scout ...` runs like any tsh line: the prompt waits. A status line shows progress in
  place (tool calls, seconds), and the reply prints once whole, under the name, words faint. Ctrl-C
  tells the job `cancel` (ACP's `session/cancel`); scout stays summoned and idle. An ask from the
  agent takes the prompt as a person-only answer, `allow? [y/N]`, which the host records as the
  person's input; an agent never answers it (decided).
- **Why.** The kitchen: say "heard" at once, then work [o2]; Slack: acknowledge within 3 seconds,
  then the work [s1]. Ctrl-C already means "stop the foreground" in tsh (`shell.ts:94-95`).
- **Accessibility.** The status line is a status message: a `role=status` region outside the
  terminal, polite, updated at most every few seconds, which never takes focus (WCAG 4.1.3 [a1]).
  The reply is announced once, when whole, as a log entry, polite [a2]; never the stream, which
  would read every chunk. Color is never the only cue: the name is a word on each line (1.4.1).
  Today's terminal text region is not live on purpose (`terminal.ts:87-92`), so a reply needs its
  own region. Needs a VoiceOver run.
- **Linear.** Linear's agent session shows typed activities (thinking, an action, a reply) in
  order. On our pieces: the status and the reply are tsh's lines; the activity kinds come from
  `acp`'s outputs (`said`, `result`, `ask`).
- **OTP.** The turn is one message in the run's mailbox; a second `@scout` while one runs queues
  (decided for `next/`, kept here).
- **Doubt.** People may want the prompt back at once (design C). A week of use settles it.
- **Today.** Half: Ctrl-C and `cancel` exist; the reply is not shown in tsh.

### S7: you can always see and end what you summoned

**Lean, 80%.**

- **What.** `agents`, a built-in beside `jobs` and `programs`, lists each name: agent, model,
  effort, idle or in a turn or asking, since when, dollars so far. `dismiss scout` ends it; during a
  turn it cancels the turn first and says so ("dismissed scout; its turn was cancelled"). The top
  bar's existing `agents` item (`frame.tsx:278-292`) counts summoned agents, and its panel's rows
  each get a dismiss; an agent that only dialed in over MCP is listed under its own heading, not
  counted twice.
- **Why.** tmux has `list-sessions` and `kill-session` beside `new-session -s` [t1]; the kitchen
  rail shows every ticket [o2].
- **Linear.** One list, reachable from anywhere, with the action on the row.
- **OTP.** `registered()` and `unregister/1`.
- **Today.** Half: the count exists, for a different thing.

## The smaller calls

### 1. Summoning a name that already is exactly that

```text
A: refused, like any taken name          B: a no-op that says so, status 0 (tmux's new -A)
tsh$ summon claude haiku as scout         tsh$ summon claude haiku as scout
  scout is already claude haiku              scout is already claude haiku · ready
```

Lean B, 65%: a script can summon at its top and run twice.

### 2. `@Scout` and `@scuot`

Both refused, each with one guess: "no agent named Scout here. Did you mean scout?". Exact match only,
never a prefix, since a turn costs money ([t1]'s `=`). Lean 80%.

### 3. Where `dismiss` and `agents` live

Built-ins in `BUILTINS` (`grammar.ts:79-89`), plain words, as `stop` and `jobs` are. Lean 80%.

### 4. A name across a host restart

The name stays on the desk and its job is detached, as any job is; the next `@scout` reopens the
session (`acp`'s `reopen`), as the decided fallback says. Lean 70%.

## The four designs, for step 5

Each is a different answer to how a turn is typed and shown in today's tsh. The builder shoots each.

- **A, a said line in the foreground.** `@scout why does post print #7 twice?`. The prose is the
  agent's; the prompt waits; Ctrl-C cancels; the reply prints under the name. The note's lean.
  Pipe line: none; tsh owns the whole turn.
- **B, the alias shows what it expands to.** `@scout why ...` expands on Space, fish-style [f1], to
  `tell scout prompt "why ..."`, shown faint before Enter; the log keeps both lines. Pipe line:
  `tell scout prompt "..."`, a built-in on the job.
- **C, a turn is a background job.** `@scout why ...` prints `[3] scout` and gives the prompt back;
  the reply lands above the prompt when whole; `jobs` and `attach %3` bring it forward. Pipe line:
  `@scout ... ` then `jobs`.
- **D, a quoted prompt on a typed pipe.** `ask scout "why does post print #7 twice?" | outline`:
  the prompt is a quoted value, so the reply is a typed output that pipes, Nushell-style [n1]. Pipe
  line: `ask scout prompt="..." | outline`. It gives up the prose mode for pipes, and quoting prose
  is where experiment 210 found the bugs.

## What the ledger records

Nothing in the project's ledger in today's version: a summon is a person's, kept in the host log
and on the host's desk (the shape above). The fact lost forever if not written at the summon: the
model a typed alias resolved to, since aliases move between CLI versions, and who summoned. Each
turn already keeps the line as typed and what the name meant then (decided).

## A tryout in today's version

Offered, not filed. A guess: about 650 lines with tests, 5 to 7 agent hours, 55% sure.

| Part | Where | Lines |
|---|---|---|
| `said`, `summon`, `dismiss` in the grammar, and roles | `shell/grammar.ts`, a new `shell/roles.ts` | 160 |
| The checks: agent, settings, name, `on` | `shell/check.ts` | 90 |
| Completion by expected role | `shell/complete.ts` | 70 |
| Names on the host's desk; `agents`, `dismiss` | `apps/fabrika/src/desk/`, `shell/builtins.ts` | 150 |
| `acp` opened at the summon, settings checked then | `agents/acp/program.ts` | 40 |
| The reply and status lines in tsh, their regions | `apps/fabrika/src/tsh.ts`, `window/` | 140 |

## Where this differs from settled notes

- **Talk where you work** says `@` is read "before tsh's shell words". This keeps that and writes
  it as the grammar's first rule. Not a walk back.
- **The glossary's `summon` row** (`.glossary/TERMS.md`) still says there is no `summon` word in
  tsh; the 2026-11-06 decision changed that. The row needs updating, in this pull request or the
  build's.
- **The settled sketch** shows the prompt free while claude answers; S6 leans foreground. If the
  owner prefers the sketch, design C is it.

## What it costs

The tryout above. In `next/`, the grammar and roles carry over to fabsh; the desk names move to the
brain.

## What it cannot tell us

- Nothing was built and nobody typed a summon. The positional settings, the foreground lean (65%)
  and the reserved words are reasoned, not tried.
- No screen reader ran: the status and reply regions are a plan.
- Whether opening a session is free for every harness was read in code, not on a bill.
- Two people's names are reasoned from the settled note.
- Several makers' pages did not load or came through a summarizer (experiment 220 lists them).
