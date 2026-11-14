---
state: "proposed; threads, forks and rooms decided 2026-11-06; rooms not sticky decided 2026-11-07, for now; the `@` line decided 2026-11-07; walked at Tier 5"
summary: "Today's version first, as a tryout before fabsh. `@name` is the grammar's first rule: the rest of the line is the agent's words, as typed. `summon <agent> [model] [effort] as <name> [on <place>]` and `dismiss <name>` are statements, and one parse gives every span a role that colors, Tab and refusals all read. A name is the door's lower-case writer id, unique per person, refused on clash; model and effort are the harness's own words, checked at the summon against its live list; `on` is refused until the brain exists. A turn in front cancels on Ctrl-C, the turn, not the agent; `agents` lists, the top bar counts. Seven principles, leans 65% to 85%. From experiment 220. Decided 2026-11-06: `summon` starts the agent, keeps it running and puts it on the ledger. A talk is a room with members, people and agents, not an agent's thread (this walks back the `@scout#bug-17` and `@scout/<person>` addresses decided earlier that night): `#bug-17` names a room, `@scout` in it is a mention, and `@scout <text>` alone talks in your DM with scout, a room of two. Every room is readable by everyone on the project; you type only in rooms you belong to; another person's agent is talk only, on its owner's bill. Several mentions answer in order, left to right (walked back 2026-11-07). Decided 2026-11-07, the `@` line: it runs in the background, as if it ended in `&`, and `fg %scout` waits on it; a send always lands in the name's mailbox, and a busy agent queues it; the first `@name` answers and every later `@name` is a target that agent may use, so to ask two agents you write two lines (POSIX's first field, and one `@` as in Claude Code, Cursor, Zed and Linear, with VS Code's `@` participants now deprecated); every `@name` is a mailbox address, for an agent, a connector (`summon linear from linear`) or a person, in one list of names, wherever the process runs. This walks back S6's foreground turn and R4. Joining a room never moves the tile (decided 2026-11-07, for now, walking back the sticky `#bug-17 >` prompt): the prompt stays `fabsh$`, a plain line is a command, and a line to a room starts with `#bug-17` or `@name`; `fork #bug-17 [at <n>] as bar` records the parent as a fact."
---

# Summon guidelines: naming agents in the shell, and the grammar for it

**Proposed 2026-11-06.** Walked when Tier 5 starts (owner, 2026-11-08): summoned agents, names and rooms. The seven principles below are proposed. Two sections are decided: the
owner settled threads, forks and who may talk to whose agent the same night, in
[threads, forks and the verbs](#threads-forks-and-the-verbs), and later that night made a talk a
room with members, in [rooms, mentions and turns in order](#rooms-mentions-and-turns-in-order),
which walks back parts of the first (each marked **Walked back** where it stands). On 2026-11-07
the owner decided, for now, that joining a room never moves the tile ([R5](#r5-joining-a-room-never-moves-the-tile-a-line-to-a-room-starts-with-room)),
which walks back the sticky room prompt of the night before. Later on 2026-11-07 the owner decided
[the `@` line](#the--line-decided-2026-11-07): an `@` line runs in the background, the first
`@name` is who answers and every later one is a target, and every `@name` is a mailbox address.
That walks back S6's foreground turn and R4's mentions in order, each marked where it stands. The
note stands
on these, decided before it and not asked again
([talk where you work](./talk-where-you-work.md)):

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
  alias, two messages queue in the run's one mailbox. That note first said nothing runs between
  turns; the owner corrected it the same night (below), and the note now says so.
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
6. the turn runs in the background, as if the line ended in `&` (decided 2026-11-07); `fg %scout`
   waits on it, and Ctrl-C then tells job 12 `cancel`; scout stays summoned
   (walked back 2026-11-07: "the turn runs in the foreground; Ctrl-C tells job 12 `cancel`")
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
said       '@' [address] prose                      prose: the rest of the line, as typed; no words, no #, no quotes
address    name ['/' person] ['#' thread]           read with no spaces inside; the first space ends it
statements statement (sep statement)*               as today
statement  summon | dismiss | fork | builtin word* ['&'] | pipeline ['&']
summon     'summon' agent [setting [setting]] 'as' name ['on' place]
dismiss    'dismiss' name                           your own agents only
fork       'fork' '@' address 'as' thread ['at' match]
agent      word                                     checked: one of the harnesses (claude, codex)
setting    word                                     checked: a model or an effort of that agent, below
name       word                                     checked: the name rule (S3)
person     word                                     checked: a member of this ledger
thread     segment ('/' segment)*                   flat: '/' groups for the eye and for Tab, nothing more
segment    word                                     checked: the name rule (S3)
match      quoted                                   the newest message holding these words; Tab after `at ` picks one
place      word                                     today: always refused (S5)
```

- **Walked back 2026-11-06 (R1, R3):** the `address`, `person` and `thread` rules and `fork`'s
  `'@' address`. A said line is now `'@' name prose` (several names in a row are several mentions,
  R4), a room is `'#' room` with flat names, and `fork '#' room 'as' room ['at' match]`. The rest of
  this block stands.
- **`summon`, `dismiss` and `fork` are verbs; `as`, `on` and `at` are keywords only in their slot,**
  as POSIX keeps reserved words to "certain positions" [p1]. `as` is a keyword only after
  `summon`'s settings or `fork`'s address, and `at` only after `fork`'s address, so `tell %1 as` and
  a prose line that says "at 5" are untouched.
- **The address reads left to right as a sentence** (walked back, R1): whose agent (`/<person>`), then which talk
  (`#<thread>`). `@scout` alone is your own scout, on the tile's current thread (below).
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
	| "verb"        // summon, dismiss, fork, a built-in, a program
	| "keyword"     // as, on, at
	| "person"      // the member after `/` in an address
	| "thread"      // the thread after `#`, or the new one after fork's `as`
	| "match"       // the words after fork's `at` that pick a message
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
"@scout#"                    thread     bug-17 bug-17/repro main          the threads of scout on this ledger
"@scout/"                    person     the members whose scout exists    never a member without one
"fork #bug-17 as bar at "    match      the picker opens on that room's messages; a key on a message writes it
```

- **Walked back (R1, R5):** the `"@scout#"` and `"@scout/"` rows. After `#` Tab completes rooms;
  after `fork #bug-17 as bar at ` it is the picker on that room's messages, never a number.
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
- **Two people. Decided 2026-11-06.** Today's version has one person per app. In `next/`, names
  belong to a person, so my `scout` and another person's never collide. Theirs is
  `@scout/<person>`: I may talk to it, never summon, dismiss or re-model it, and its turns are on
  its owner's bill, where the owner sees them (rule T3 below). This replaces the earlier lean here,
  which refused it.
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

**Walked back in part 2026-11-07,** later the same day, by [the `@` line](#the--line-decided-2026-11-07):
an `@` line now runs in the background, and `fg %scout` brings it to the front. What a turn does
once in front stands: the status line, the reply printed once whole, Ctrl-C cancels the turn and
not the agent, Ctrl-Z holds it at the next ask, the `done` line, and an ask that holds a background
turn. The lines below that say a turn starts in the foreground are the walked-back part.

**Decided 2026-11-07, by the owner.** The lean before it was 65%. Ctrl-Z was reopened and settled
the same day, after a walk with a worked example: it holds the turn at the agent's next ask.

```text
fabsh$ @scout why does post print #7 twice?
scout: reading post.ts… (3s)
^Z
[1]+ held  @scout why does post print #7 twice?
fabsh$ bg
[1]+ @scout why does post print #7 twice? &
fabsh$ git log -3
[1]+ done  @scout  (fg 1 to read the answer)
```

- **Ctrl-Z holds.** The prompt comes back at once. The host stops answering the agent's
  `session/request_permission` asks, the ones its rules would answer by themselves included, so
  the agent waits at its next tool call that asks. It runs nothing and edits nothing; it may read a
  little more first (below).
- **`fg` answers the held ask** and the turn goes on in front of you. **`bg` answers it** and the
  turn goes on behind you.
- **A turn in the background prints one line when it ends,** before the next prompt, as bash does:
  `done` or `failed`, and `fg 1` prints the reply. It never prints the reply over your work.
- **An ask that needs a person holds a background turn** and says `[1]+ waiting: scout needs you`;
  `fg` brings the `allow? [y/N]` up. This is POSIX's SIGTTIN: a background job that reads the
  keyboard stops.

- **Why it reopened.** ACP has no pause. A client may only cancel a turn with `session/cancel`
  ([prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)), so "Ctrl-Z suspends the
  waiting turn" cannot mean what it means in POSIX, where a stopped job does nothing until `fg`.
  Giving the prompt back while the agent keeps editing files breaks that promise.
- **What can stop it.** The agent waits on the client's answer to `session/request_permission`, and
  the spec and the Claude adapter set no timer on it (adapter `src/acp-agent.ts`, read 2026-11-07).
  So holding that answer stops the agent at its next tool call that asks. Today's harness turns off
  the client's file and terminal methods (`packages/fabrika/src/agents/acp/client.ts:240-241`), and
  in `default` mode reads inside the working copy do not ask, so those pass a hold. A turn that
  never asks never stops, and `held` says so if no ask comes. Not yet checked in a live process: a
  hold of about 10 minutes would show any hidden timer, and the tryout's first pull request runs it.

- **What.** `@scout ...` runs like any fabsh line: the prompt waits. A status line shows progress in
  place (tool calls, seconds), and the reply prints once whole, under the name, words faint. Ctrl-C
  tells the job `cancel` (ACP's `session/cancel`); scout stays summoned and idle. An ask from the
  agent takes the prompt as a person-only answer, `allow? [y/N]`, which the host records as the
  person's input; an agent never answers it (decided).
- **Backgrounding a turn never parses the message.** Ctrl-Z holds the waiting turn and `bg`
  lets it finish in the background, as in POSIX job control (how it holds is above). Or start the line with `bg`:
  `bg @scout why does post print #7 twice?`. `jobs` and `fg %n` work as for any job.
- **Everything after `@name` goes to the agent exactly as typed,** `&`, `|` and `;` included. This
  keeps S2. A trailing `&` to background a turn is walked back on 2026-11-07: it would take a
  character from the message.
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
- **Not taken.** Design C, a turn as a background job by default. `bg` and Ctrl-Z give the prompt
  back when a person wants it. **Walked back 2026-11-07:** design C's default is now the decided
  one ([the `@` line](#the--line-decided-2026-11-07)).
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

## Threads, forks and the verbs

**Decided 2026-11-06,** by the owner, the same night as the summon itself. These hold for both
versions; what today's version can build of them is under T7.

**Walked back in part, later the same night:** a talk is now a room with members, not a thread of
an agent ([rooms](#rooms-mentions-and-turns-in-order)). T1 and T6 stand. The addresses in T2, T3's
`@scout/<person>`, T4's prompt and T5's `fork @scout#...` are walked back; each place says so, and
the old text stays so its meaning is on the record. The sketch below is the walked-back one.

```text
A sketch. One person, one tile, one agent, two threads.
tsh$ summon claude haiku as scout
  scout · claude haiku (claude-haiku-5-5) · high · on this Mac · ready
tsh$ @scout why does post print #7 twice?            (your default thread, scout#<you>; the UI may show it as scout)
tsh$ @scout#bug-17 here is the failing run           (a named thread: the tile switches to it)
scout#bug-17 > @scout and the second run?            (plain @scout stays on bug-17, like a working directory)
scout#bug-17 > fork @scout#bug-17 as bar at "footer"  (a new thread #bar from the newest message with "footer")
  bar · forked from #bug-17 at "the footer adds #7 again"
scout#bar > @scout/<person>#review is this right?     (another member's scout: talk yes, on its owner's bill)
```

### T1: summon starts the agent, keeps it running, and puts it on the ledger

- **What.** `summon` is more than an alias. It starts the agent, keeps it running between turns, and
  writes it on the ledger, where every member can see it: who summoned it, which agent, model and
  effort, since when. `dismiss` ends it, and that is on the ledger too.
- **Corrects.** [Talk where you work](./talk-where-you-work.md) said, for `next/`, that nothing runs
  between turns. That was wrong, and that note now says so.
- **OTP.** `spawn` plus `register`: a running process with a name others can look up.

### T2: every message goes to a named thread of an agent

**Walked back (R1).** A talk is a room with members, and an agent is mentioned in it. Your default
`scout#<person>` is now your DM with scout, and `@scout#bug-17` is `#bug-17` with `@scout` mentioned.

- **What.** A thread is one talk with one agent, with a name. Plain `@scout` goes to your default
  thread, named after you: `scout#<person>`. The UI may hide your own name there, so you see
  `scout`. `@scout#bug-17` names a thread anyone on the ledger can join, on purpose, by typing its
  name.
- **The address.** `@<agent>[/<person>][#<thread>]`. The `/` right after the agent says whose agent;
  the `#` says which thread. `@scout #7 twice?`, with a space, is prose: the address ends at the
  first space (S2).
- **Clash with a word we have.** The glossary's `thread` (decided 2026-11-05) is the talk with an
  agent about one spot, and "cannot open without a spot". A named thread typed in tsh has no spot.
  The row needs the owner's word on whether a spot thread is one kind of this thread (see
  [where this differs](#where-this-differs-from-settled-notes)).

### T3: you may talk to another person's agent, never run it

**Partly walked back (R1, R2).** The rule stands: talk yes, run no, on its owner's bill. The address
`@scout/<person>` is walked back, and the open question below is settled by R2: every room is
readable by everyone on the project.

- **What.** `@scout/<person>` talks to another member's scout. You may never summon, dismiss or
  re-model it. Its turn is on the agent owner's bill, and the owner sees it.
- **Still open, lean yes, 70%.** Whether the agent's owner can read another person's thread with
  their agent, read-only, with a notice both of them can see. The doubt: the thread may hold the
  other person's private notes. What settles it: a week of two people sharing one ledger.

### T4: the current thread sticks to the tile, like a working directory

**Walked back (R5).** On 2026-11-06 it was walked back in part: the tile still kept its place like a
working directory, but the place was a room, with the prompt `#bug-17 >`, not `scout#bug-17 >`, and
the model `{room}`. On 2026-11-07 the rest went too: no room or thread sticks to a tile, and the
prompt stays `fabsh$`.

- **What.** `@scout#bug-17` once switches the tile to that thread. A later plain `@scout ...` keeps
  going there, and the prompt shows `scout#bug-17 >`, as a shell's prompt shows its folder after
  `cd`. Tab completes agent names, and after `#`, that agent's threads.
- **Why per tile.** Two tiles of tsh are two shells, each with its own folder; each keeps its own
  current thread the same way.
- **Elm.** The current thread is the tile's model, `{agent, thread}`; a said line reads it in
  `update`, never from a global.

### T5: fork makes a new thread, with its origin as a fact, not in its name

**Partly walked back (R3).** Fork stays, on rooms: `fork #bug-17 as bar at "footer"`. The forked thing is
no longer an agent's thread. Flat names and the origin as a fact stand.

- **What.** `fork @scout#bug-17 as bar` makes a new thread `#bar` from the latest message and
  switches the tile into it. `fork @scout#bug-17 as bar at "footer"` forks from the
  newest message holding "footer" (message numbers walked back, R3). The thread
  view's "fork from here" key writes that line at the prompt, so the key and the typed line are one
  path.
- **Names are flat.** The parent and the fork point are recorded facts, shown as "forked from
  #bug-17 at \"the footer adds #7 again\"", as git keeps a branch's origin in its history, not in its name. A `/` inside a
  thread name (`bug-17/repro`) is grouping only, for the eye and for Tab; it says nothing about
  where the thread came from.

### T6: every act that changes something is a verb you can read and script

- **What.** The family is `summon`, `dismiss`, `fork`, and, as a lean, `join` (R5's sketch, IRC's
  and Matrix's word). A button or key that changes something writes
  one of these lines, so the log reads as a script and a script can do what a person did.
- **Why.** The same rule as the "fork from here" key: one path, typed or pressed.

### T7: what today's version can build

- Today's version has one person per app and runs agents as `acp` jobs on this Mac. It can build
  named threads, the sticky tile thread, Tab after `#`, and `fork` with `at` inside one person's
  app. `/<person>` and the shared ledger need `next/`'s brain, so today the check refuses `/` in an
  address in words, as it refuses `on` (S5).
- Whether an `acp` session can fork at a given message is the harness's call. Claude Code resumes a
  session by id [c1]. Read 2026-11-07: forking at a message needs a new session fed the talk up to
  it (R3).

## Rooms, mentions and turns in order

**Decided 2026-11-06,** by the owner, later the same night as the threads above. A talk is a room,
not something an agent owns. This walks back parts of T2 to T5; each walked-back line is kept above
and marked, so the old meaning stays readable. These hold for both versions; what today's version
can build is under R7.

**Amended 2026-11-13** by [0158](../../.decisions/0158-no-dms-only-rooms.md): fabrika has no DMs.
The word goes. The room of two stays, readable like any room. A line below that says DM is kept as
it was decided, and now means the room of two with that agent.

```text
A sketch. One person, one tile, two agents, a DM and a room. Updated 2026-11-07: the prompt stays
tsh$, and every line to a room starts with #room (R5). The 2026-11-06 sketch had the prompt #bug-17 >.
tsh$ summon claude haiku as scout
tsh$ @scout why does post print #7 twice?                (your DM with scout: a room of two, you and scout)
tsh$ join #bug-17                                        (the verb is a lean, below; you are a member, nothing moves)
tsh$ #bug-17 @scout here is the failing run              (a mention: scout answers in #bug-17, for everyone)
tsh$ #bug-17 @scout @researcher why did this stall?      (scout answers, with a handle to researcher; 2026-11-07)
tsh$ fork #bug-17 as bar at "footer"                     (#bar, with its origin message as a fact)
  #bar · forked from #bug-17 at "the footer adds #7 again"
tsh$
```

### R1: a room is a place, with members; an agent is mentioned in it

- **What.** A room is one talk with a name, such as `#bug-17`. Its members are people and agents.
  `#bug-17` names the room; `@scout` inside it is a mention, which asks scout for a turn there. The
  room comes first and the agent is mentioned; no agent owns a room.
- **Your DM.** Your default talk with an agent is a DM: a room with two members, you and that agent.
  `@scout <text>` typed outside any room still talks to scout, in your DM with it.
  **The word is walked back 2026-11-13**
  ([0158](../../.decisions/0158-no-dms-only-rooms.md)): fabrika has no DMs. The room of two stays,
  and what it is called on screen is not decided.
- **Walks back.** T2's address `@<agent>[/<person>][#<thread>]`, `@scout#bug-17` and the default
  thread `scout#<person>`. A thread no longer belongs to an agent. The `@` line's own rule stays: the
  name ends at the first space, and the rest is the agent's words, as typed (S2).
- **The known shapes.** Slack and Discord have channels and DMs; a Slack DM is a conversation like a
  channel, with two members. Matrix has only rooms: a DM is an ordinary room marked as direct in the
  account's data (`m.direct`). Linear lets an issue mention several agents, each with its own agent
  session there. All of them put the place first and mention who should answer.
- **Open: two agents with one name in a room.** Names are unique per person (S3), so two members may
  each bring a scout into `#bug-17`. Lean, 60%: the mention is refused in words and names both
  owners, and the second one joins under another name. The doubt: renaming on join adds a step.
- **Open, lean 70%: becoming a member is `join #bug-17`.** IRC and Matrix call it join, and joining
  changes who is a member, so it is a verb (T6). Since 2026-11-07 it only adds you to the room; it
  never moves the tile (R5). The 2026-11-06 text here said that typing in a room you already belong
  to only moves the tile there; that is walked back with R5's sticky prompt.

### R2: every room is readable by everyone on the project

- **What.** No private rooms, no privacy toggle, no categories. Anyone on the project can read any
  room, your DMs with your agents included. You type only in rooms you are a member of: your DMs,
  and named rooms you join.
- **Still as decided.** An agent's name belongs to a person (S3). Talking to another person's agent
  bills its owner, and you never summon, dismiss or re-model it (T3). The content stays deletable
  ([an agent run keeps its content](./an-agent-run-keeps-its-content.md)).
- **Settles.** T3's open question (may an agent's owner read another person's talk with it): yes,
  and so may everyone on the project. The doubt there, private notes in a talk, is answered by the
  rule: nothing in a room is private.

### R3: fork stays, on rooms

- **What.** `fork #bug-17 as bar` makes `#bar` from the latest message, and
  `fork #bug-17 as bar at "footer"` takes the newest message holding "footer". The line reads as a
  sentence, and `at` always takes words: a bare `at` would mean something only while a picker is
  open, and a line in the history must read the same as one typed (owner, 2026-11-07). The parent and the message's id are a recorded fact, shown by the
  message's own words, never put in the name (T5's rule, kept).
- **Decided 2026-11-07, by the owner: no message numbers.** Nobody working in tsh knows which
  message is number 12. Every tool read points at the message or searches its words: Slack, Discord
  and ChatGPT fork from the message itself, Claude Code's rewind is a list to pick from, git's `:/text`
  finds a commit by its words (secondary: read from memory, not checked against each page). So `at`
  is optional and comes last; Tab after `at ` opens the picker on the room's messages, newest first,
  and the pick writes its words into the line, as fzf does over a zsh prompt
  ([picker guidelines](./picker-guidelines.md)); a quoted string jumps to the newest match, as a
  quoted string is short for pick there; a key on a message in the room writes the line. The data
  points at the message's id, never a count.
- **The picker's look and keys need a pressable test** (owner, 2026-11-07): the syntax is
  settled, the UX is not, and a prototype the owner presses settles it before fork's build.
  **Pressed and approved 2026-11-07.** Tab after `at ` opens pick in the line's flow, just above
  the prompt, and pushes the scrollback up rather than covering it, as fzf's `--height` does. Rows
  are newest first: who said it, then the words on one line, cut to fit. Typed words filter; Up and
  Down wrap; Enter writes the message's words, cut to about 40 characters, with a leading
  `@name` dropped; Esc puts the line back as it was; a click picks. The input keeps focus, the box
  is a listbox read through `aria-activedescendant`, and a polite live region says how many
  messages match. The picked row is a full-row fill with stronger text. Still open: how tall the
  box is in a short tile, and a real screen reader run.
- **Built in its own pull request, after rooms are in daily use** (lead's lean, 75%). ACP's stable
  `session/new` takes no prior messages, and `session/fork` is still unstable and copies the whole
  session (schema `v1/schema.unstable.json`, read 2026-11-07); the Claude adapter can cut at a message
  only through a vendor `_meta` key. The portable way is a new session whose first prompt holds the
  copied talk as text, so the agent keeps the words but not its own tool history.
- **Walks back.** T5's `fork @scout#bug-17 ...`: the thing forked is a room, not an agent's thread.
- **Open, lean 65%: the fork's members are the parent's,** so the agents who knew the talk can go on
  in it. The doubt: a fork made to try a different agent would then have to drop one.

### R4: several mentions on one line answer in order, like a pipe

**Walked back 2026-11-07** by [the `@` line](#the--line-decided-2026-11-07): the first `@name`
answers, and every later one is a target that agent may use. To ask two agents, write two lines.
Kept as it was decided.

- **What.** `@scout @researcher why did this stall?` gives scout the turn first, then researcher.
  Each agent sees the room as it stands when its turn starts, so researcher reads scout's reply.
  They answer one after another, left to right, never at once.
- **Why.** A shell pipe reads left to right and each stage gets what the one before it made. People
  read a second answer that builds on the first more easily than two that cross.
- **Differs from Linear,** where each mentioned agent gets its own session and they run side by side.
- **Lean, 75%: Ctrl-C stops the whole line,** the turn running and the ones not started, as a shell
  stops the whole foreground pipeline. Each agent that already answered stays a member. The doubt:
  a person may want to skip only the slow one; a later key could do that.
- **Bills.** Each turn is on its own agent owner's bill, as decided (T3).

### R5: joining a room never moves the tile; a line to a room starts with `#room`

**Decided 2026-11-07, for now,** by the owner. It walks back the R5 decided on 2026-11-06, which is
kept below, marked.

```text
fabsh$ join #bug-17                          you joined #bug-17. The prompt stays fabsh$.
fabsh$ #bug-17 is this #193 again?           → #bug-17 · message 16
fabsh$ #bug-17 @scout why did this stall?    scout answers in #bug-17, in the background (2026-11-07)
fabsh$ @scout and the second run?            your DM with scout
fabsh$ agents                                a plain line is still a command
fabsh$ leave #bug-17                         you left #bug-17; the bottom line drops it
t1 fabsh · in #stall                         the bottom line: the rooms you are in
```

- **What.** `join #bug-17` only makes you a member. The prompt stays `fabsh$`, and a plain line is
  still a command. To talk, a line always starts with `#room` or `@name`; Tab completes both, and
  up-arrow brings the last line back, so the prefix is cheap to repeat. `#bug-17` alone shows the
  room, read only, and tells nobody. The bottom line may list the rooms you are in; `join` adds one
  and `leave` drops one.
- **Why.** fabsh is a shell first. IRC and Slack go chat first, with `/` for a command, and that
  makes a person join and leave just to switch between commands and talk.
- **Elm.** A fabsh tile's model has no room. `update` reads the room from the line it is given,
  never from the tile; who is a member lives on the room, and the bottom line is a view of it.
- **The doubt.** Long chats may find the prefix tiring. What settles it: a week of real use. For a
  long talk there is already a chat-first view: the room tile (`room #bug-17`), where a plain line is
  a message.
- **Settles.** The old R5's open question below takes branch (a), shell first, with `#room` as well
  as `@name` starting a message. A message to a room's people with no agent in it starts with
  `#bug-17`, which answers that branch's doubt.
- **A bug it removes.** In the prototype, after `leave #bug-17` the prompt still read `#bug-17 >`
  and the bottom line still read `t1 fabsh · #bug-17`. With no room on the tile the prompt cannot
  go stale, and the bottom line lists rooms by membership, so `leave` drops it.

### R5, as decided 2026-11-06: a room is a fabsh session its members share

**Walked back 2026-11-07** by the R5 above. Kept as it was decided, so its meaning stays on the
record.

- **What.** Entering a room sticks to the tile, like a working directory: the prompt shows
  `#bug-17 >`. Lines typed there are commands or messages, and what they print lands in the room,
  where every member sees it. Another tile can be in another room, as two shells can be in two
  folders.
- **Walks back.** T4's prompt `scout#bug-17 >` and its tile model `{agent, thread}`. The tile's model
  is now `{room}`; the stickiness is kept. Tab after `#` completes rooms, not one agent's threads.
- **The known shapes.** tmux lets several clients attach to one session, and each sees the same
  output; a Slack channel shows a bot's reply to everyone in it; a Matrix room is the same for
  every member.
- **Open, lean 55%: how a line in a room says "this is a message".** Three branches. (a) Shell
  first: the line is read as fabsh reads it today, and a message is a line that starts with `@`.
  (b) Chat first: a line is a message, and a command starts with `/`, as in IRC and Slack.
  (c) Guess by the first word: a known command runs, anything else is a message. Lean (a): it keeps
  the decided rule that `@` is read before shell words, and nothing is guessed. The doubt: a
  message to the people in a room, with no agent in it, has no `@` to start with. What settles it:
  the owner's pick, then a week of use.

### R6: names, checked against the industry

- **`room` is the word.** It is Matrix's word for exactly this: a named place with members, where a
  DM is one kind. Slack's "thread" means a chain of replies under one message, so "thread" for this
  would mean two things. Slack's and Discord's "channel" is close, but a person does not call a DM a
  channel, and the glossary already uses "channel" loosely for a transport (its ephemeral lane row).
  "Room" covers both the named place and the DM with one word. Lean, 80%.
- **`DM`** is Slack's, Discord's and Matrix's word for a room with two members.
  **Walked back 2026-11-13** ([0158](../../.decisions/0158-no-dms-only-rooms.md)): fabrika does not
  use the word. In those three a DM is read by its members only, and no room here is private.
- **`mention`** is the word Slack, Discord, Matrix and Linear all use for `@name` in a message.
- **The glossary** gets rows for `room` and `DM`, and its `thread` row now says what it is not: a
  room. Whether the spot talk of [talk where you work](./talk-where-you-work.md) becomes a room is
  not decided here (see [where this differs](#where-this-differs-from-settled-notes)).

### R7: what today's version can build

- Today's version has one person per app, so "readable by everyone" is true with no extra work. It
  can build DMs, named rooms, mentions in order, the `#room` prefix with the bottom line's list of
  rooms, and `fork` with `at`. Rooms read
  by other people, and agents of other people as members, need `next/`'s brain.
- Whether an `acp` session can start from a room's first 12 messages is the same open question as
  in T7.

### R8: what the ledger records for rooms (a lean)

**Lean, 80%.** The facts below exist only when they happen. If they are not written now, they are
gone, and no later field brings them back for the entries already written.

```ts
// A sketch, `next/`. Effect Schema writes `_tag`; `arrivedAt` is the referee's clock, `sentAt` the writer's.
{_tag: "roomMade", by: "<person>", room: "bug-17", direct: false, arrivedAt, sentAt}
{_tag: "joined",   by: "<person>", room: "bug-17", member: "scout", owner: "<person>", arrivedAt, sentAt}
{_tag: "forked",   by: "<person>", room: "bar", from: {room: "bug-17", at: 12}, arrivedAt, sentAt}
{_tag: "said",     by: "<person>", room: "bug-17", at: 14, line: "@scout @researcher why did this stall?",
 mentions: [{name: "scout", owner: "<person>"}, {name: "researcher", owner: "<other person>"}],
 arrivedAt, sentAt}
{_tag: "replied",  by: "scout", room: "bug-17", at: 15, to: 14, saw: 14, bill: "<person>", arrivedAt, sentAt}
{_tag: "replied",  by: "researcher", room: "bug-17", at: 16, to: 14, saw: 15, bill: "<other person>", arrivedAt, sentAt}
```

- **Who joined, and who added them.** Lost if not recorded: who could read and answer a message at
  the time it was sent. Membership changes, and today's member list says nothing about last week's.
- **Who mentioned whom, as resolved then.** `mentions` keeps what each name meant at send, as the
  decided `@` log does, since a name can be dismissed and summoned again as another agent. Re-parsing
  the line later gives today's meaning, not that day's.
- **Walked back 2026-11-07, with R4:** the next line. `mentions[0]` is now who answers, and the rest
  are targets, as each name was resolved then ([the `@` line](#the--line-decided-2026-11-07)).
- **Mention order.** The array's order is the order of the turns. Lost if not recorded: why the
  second agent said what it said, since it saw the first reply.
- **What each turn saw.** `saw` is the last message in the room when the turn started. Lost if not
  recorded: an agent's context, once more messages land in the room.
- **Whose bill.** `bill` follows the agent's owner, not `by` of the mention (T3).
- `direct: true` marks a DM, as Matrix's `m.direct` does; a DM is still a room, so it needs no
  other entry.

## The `@` line, decided 2026-11-07

**Decided 2026-11-07,** by the owner. It holds for both versions; each part says where it runs.
It walks back [S6](#s6-a-turn-is-a-foreground-job-and-ctrl-c-cancels-the-turn-not-the-agent)'s
foreground turn and [R4](#r4-several-mentions-on-one-line-answer-in-order-like-a-pipe); each is
kept above, marked.

```text
A sketch, fabsh. tsh reads the same lines in today's version.
fabsh$ @scout why does post print #7 twice?   [1] scout: runs behind you, as if the line ended in &
fabsh$ git log -3                             your prompt is yours
fabsh$ fg %scout                              wait on it; Ctrl-C stops the turn, scout stays summoned
fabsh$ @scout @researcher what changed?       scout answers; researcher is a target
fabsh$ @scout talk to @researcher             scout may message researcher
fabsh$ #bug-17 @scout why did this stall?     #room still says where
fabsh$ @ana the plan is ready                 ana's inbox program gets it
fabsh$ summon linear from linear              a connector, registered under the name linear
fabsh$ @linear what is open in this cycle?    the same as any name: a letter to linear's mailbox
```

```ts
// A sketch, both versions. What the grammar makes of one `@` line, before anything runs.
const At = Schema.Struct({
	to: Schema.String, // the first @name: who answers
	targets: Schema.Array(Schema.String), // every later @name, in order: handles `to` may use
	words: Schema.String, // the rest of the line, as typed, later @names included (S2)
	room: Schema.optionalKey(Schema.String), // from a leading #room
});
// "@scout talk to @researcher" expands to: tell scout <input> "talk to @researcher"
// with {to: "scout", targets: ["researcher"], words: "talk to @researcher"}
```

### A1: an `@` line runs in the background

- **What.** An `@` line is like a shell command with other defaults. A plain command runs in the
  foreground. An `@name` line runs in the background, as if it ended in `&`. It is never refused,
  and the person's prompt is never taken over.
- **When it ends,** one line prints before the next prompt, as S6 already says: `done` or `failed`,
  and `fg %scout` prints the reply. An ask that needs a person still holds the turn and says so.
- **Why.** The person keeps working while the agent works, and an agent's line never waits on the
  person's job (shared tiles' smaller call 3, decided the same day).

### A2: to wait on it, use job control

- **What.** `fg %scout` brings the turn to the front; Ctrl-C then stops it, and scout stays
  summoned. `jobs` lists the turns. `%scout` names a job by its name, as bash's `%ce` names the job
  whose command begins with `ce`
  ([bash, job control basics](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)).
- **Ctrl-Z** on a turn in front still holds it at the next ask (S6).

### A3: a send always lands in the name's mailbox

- **What.** Every `@` line becomes a letter in its name's mailbox. A busy agent queues it and takes
  it when the turn before ends. Nothing is refused because the agent is busy.
- **Why.** It is what OTP does: a send puts the message in the process's mailbox, and the process
  takes it when it is ready ([Erlang processes](https://www.erlang.org/doc/system/ref_man_processes.html)).
  Zed queues a message sent during a turn, and Linear hands a follow-up into the running session
  ([Zed's agent panel](https://zed.dev/docs/ai/agent-panel),
  [Linear's agent interaction](https://linear.app/developers/agent-interaction)).

### A4: the first `@name` answers; every later `@name` is a target

- **What.** In `@scout @researcher what changed?`, scout answers. In `@scout talk to @researcher`,
  scout gets a handle to researcher and may use it, for example to message it. `#room` still says
  where. To ask two agents, write two lines.
- **The words stay as typed.** A later `@researcher` stays in the words scout reads (S2); the
  grammar only also gives scout the handle.
- **Why position.** POSIX makes the first field of a simple command the command name, and the rest
  are its arguments ([Shell Command Language, 2.9.1.1](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)).
  fabsh is a shell, so position says who runs.
- **Why one `@`.** Claude Code puts subagents, files and MCP resources all under one `@`
  ([subagents](https://code.claude.com/docs/en/sub-agents), [MCP](https://code.claude.com/docs/en/mcp)).
  Cursor and Zed use `@` for every kind of context
  ([Cursor's mentions](https://cursor.com/docs/context/mentions),
  [Zed's agent panel](https://zed.dev/docs/ai/agent-panel)), and Linear `@`mentions people and
  agents alike ([agents in Linear](https://linear.app/docs/agents-in-linear)). VS Code split
  `@participant` from `#context`, and its docs now mark `@` participants deprecated
  ([Copilot chat context](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context),
  [chat participants API](https://code.visualstudio.com/api/extension-guides/ai/chat)).
- **What no maker documents.** None we read writes "the first `@` answers" as a rule. It is our
  rule, on the shell's. Read 2026-11-07.

### A5: every `@name` is a mailbox address

- **What.** An agent, a connector and a person all work the same way. The grammar expands
  `@x words` to `tell x <input> "words"`, and `tell` delivers to x's mailbox. A connector is
  registered under a name by `summon linear from linear`, then `@linear` reaches it like any name;
  the `from` slot's grammar is not written yet.
- **A person's inbox is a program registered under their name.** So `@ana hi` reaches ana's inbox
  program, and her windows show it ([the ask desk](./ask-desk.md)'s `inbox`).
- **One list of names.** People, agents and connectors share it, so no two are the same name.
- **The sender never knows where the process runs:** one Mac, another, a browser tab or the brain.
  This is Erlang's location transparency: a send to a registered name looks the same wherever the
  process is
  ([Erlang processes, registered names](https://www.erlang.org/doc/system/ref_man_processes.html),
  [distributed Erlang](https://www.erlang.org/doc/system/distributed.html),
  [`global`, names across nodes](https://www.erlang.org/doc/apps/kernel/global.html)).
- **Today's version.** tsh's `tell` goes to the job the name meant then, and the letter queues in
  that run's one mailbox ([tea-program](./tea-program.md)). One person per app, so a person's
  inbox is this app's `inbox` program. All of it is on this Mac; connectors and other people need
  the brain.
- **`next/`.** `tell` sends through P9's `Mailbox` into the `<name>/inbox` stream on the ledger,
  at least once (`next/packages/libfabrika/src/coordination/mailbox.ts`). The five layers' `Registry`
  names the process; it is not built yet. The brain keeps the names, so a person
  on a phone and an agent on a cloud host reach the same `@scout`.

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
  `@scout ... ` then `jobs`. Not taken: S6 was decided foreground on 2026-11-07. **Walked back
  2026-11-07,** later that day: C's background default is decided
  ([the `@` line](#the--line-decided-2026-11-07)), with `fg %scout` in place of `attach %3`.
- **D, a quoted prompt on a typed pipe.** `ask scout "why does post print #7 twice?" | outline`:
  the prompt is a quoted value, so the reply is a typed output that pipes, Nushell-style [n1]. Pipe
  line: `ask scout prompt="..." | outline`. It gives up the prose mode for pipes, and quoting prose
  is where experiment 210 found the bugs.

## What the ledger records

A summon goes on the ledger, where every member sees it (T1, decided). The `thread` and `owner`
keys on a thread below are walked back with T2; rooms record what [R8](#r8-what-the-ledger-records-for-rooms-a-lean)
gives. In today's version there is
one person per app, so the tryout keeps it in the host log and on the host's desk (the shape
above); the ledger entries below are `next/`'s. The facts lost forever if not written when they
happen: the model a typed alias resolved to, since aliases move between CLI versions; who
summoned; who made or forked a thread, from which thread and at which message; and on whose bill
a turn ran. Each turn already keeps the line as typed and what the name meant then (decided).

```ts
// A sketch, `next/`. Effect Schema writes `_tag`; `arrivedAt` is the referee's clock, `sentAt` the writer's.
{_tag: "summoned",   by: "<person>", name: "scout", agent: "claude",
 model: {typed: "haiku", resolved: "claude-haiku-5-5"}, effort: "high", arrivedAt, sentAt}
{_tag: "threadMade", by: "<person>", agent: "scout", owner: "<person>", thread: "bug-17", arrivedAt, sentAt}
{_tag: "forked",     by: "<person>", agent: "scout", owner: "<person>", thread: "bar",
 from: {thread: "bug-17", at: 12}, arrivedAt, sentAt}
{_tag: "said",       by: "<other person>", agent: "scout", owner: "<person>", thread: "review",
 line: "@scout/<person>#review is this right?", bill: "<person>", arrivedAt, sentAt}
{_tag: "dismissed",  by: "<person>", name: "scout", cut: null, arrivedAt, sentAt}
```

- **`owner` and `by` are two facts.** `by` is who wrote the entry; `owner` is whose agent it is.
  For your own agent they match; for `@scout/<person>` they differ, and `bill` follows `owner`.
- **A default thread is made by the first message,** with `thread` set to the caller's own id, so
  `scout#<person>` needs no extra verb.
- **`from.at` is the id of a message in the parent room** (R3: never a number), fixed at the fork, so a later message in
  `#bug-17` never moves where `#bar` began.

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
- **The settled sketch** shows the prompt free while claude answers. S6 is decided foreground
  (2026-11-07), so that part of the sketch is walked back; `bg` gives the prompt back by choice.
- **Talk where you work, `next/` section,** said nothing runs between turns. The owner corrected it
  (T1), and this pull request fixes that sentence there, saying the earlier line was wrong. A walk
  back, by the owner.
- **S3's two-people lean** refused talking to another person's agent. T3 allows it. A walk back,
  by the owner.
- **The glossary's `thread` row** said a thread cannot open without a spot, and T2's named threads
  had none. R1 settles the clash for tsh: a named talk is a room, and the glossary now has `room` and
  `DM` rows and a `thread` row that says it is not a room. Still open: whether the spot talk of
  [talk where you work](./talk-where-you-work.md) (the box, then the thread tile) becomes a room
  with the spot recorded on it. Lean yes, 65%, since one word for one idea; the doubt is that a
  spot talk has a home on the thing, which a room does not. A `fork` row waits for the build's pull
  request.
- **T2 to T5,** decided earlier the same night, are walked back in part by R1 to R5, by the owner.
  Each place is marked.
- **R5's sticky room prompt,** decided 2026-11-06, is walked back on 2026-11-07, for now, by the
  owner: joining never moves the tile, and a line to a room starts with `#room`.
- **S6's foreground turn and R4's mentions in order,** both decided earlier, are walked back on
  2026-11-07 by [the `@` line](#the--line-decided-2026-11-07), by the owner. Each place is marked.
- **S3 makes a name unique per person.** The `@` line puts people, agents and connectors in one
  list of names, so an agent's name is also refused when it is a person's or a connector's.
- **Today's mailbox has a bound.** Past its `capacity` (1000 by default), today's `tell` fails
  `MailboxFull` ([tea-program](./tea-program.md)). "Never refused" holds up to that bound in
  today's version; what a full mailbox says to the sender is not settled.

## What it costs

The tryout above. In `next/`, the grammar and roles carry over to fabsh; the desk names move to the
brain.

## What it cannot tell us

- Nothing was built and nobody typed a summon. The positional settings, the foreground lean (65%)
  and the reserved words are reasoned, not tried.
- No screen reader ran: the status and reply regions are a plan.
- Whether opening a session is free for every harness was read in code, not on a bill.
- The rooms section is the owner's decisions plus leans. The maker shapes it names (Slack, Discord,
  Matrix's `m.direct`, tmux shared sessions, Linear's agent sessions) were not re-read for it. Nobody
  has typed in a shared room, and the 55% lean on how a line says "message" is the weakest call.
- Two people's names are reasoned from the settled note, and T3 is decided without a second person
  having tried it.
- Threads and forks (T1 to T7) are decisions, not findings: no maker was read for them, and
  whether a harness can fork a session at a message is not checked.
- Several makers' pages did not load or came through a summarizer (experiment 220 lists them).
