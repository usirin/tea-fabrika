---
state: "proposed, parts decided 2026-11-04, 2026-11-05, 2026-11-06 (`summon`) and 2026-11-07 (`@` in every box, every `@name` a mailbox address); walked at Tier 5"
summary: "Today's version first. `@claude <words>` in tsh talks to the agent in the tile (Claude Code's `!`, reversed); a bare `@` goes to the only agent here; Tab completes names. tsh is the chat: fabrika has no chat program. In any program, select a thing and press a key, or click a presence label, and the frame opens a small box anchored there; the spot rides with the message, frozen at send, and the reply stays at the spot, never copied into tsh. Decided 2026-11-07: `@` works in every text box, the command palette included, with no \"Summon claude here\" row; every `@name` is a mailbox address (`@x words` is `tell x <input> \"words\"`), for an agent, a connector or a person, whose inbox is a program under their name, and the sender never knows where it runs (Erlang's location transparency); a line from an agent nobody summoned is an inbox row. Still proposed 2026-11-05: the `@` menu lists agents on your desk first, then \"summon <name> here\", and a program opts in by building its box from the design package's shared text field. Decided 2026-11-05: `@claude` is a wrapper, tsh's own `tell` to an agent the host started (or the line that starts one), read off the line before tsh's shell words, and the claude it starts works in the person's repo with the fabrika connection (experiment 210). Decided 2026-11-05, from a private Design canvas: talking at a spot is a mix, the box for the first 1 or 2 turns, then one thread tile reused for every spot, which always names its spot (no blank one), with Esc and `C-b ;` back; while it shows a thread the spot is a chip, \"N replies · in t3\"; a spot is a program's `location` plus the lane or plan version it came from, and may be several rows; the tile lists the ticket's threads. \"No chat program\" now reads as no conversation without a spot or a tile. Lean, 70%: a reply goes to the inbox only when it ends in a real question. Open: is the box alone enough, a hearable name for non-text spots. From experiments 209 and 210."
---

# Talk where you work: `@claude` in tsh, and talking at a spot

**Proposed 2026-11-04, parts decided through 2026-11-07.** Walked when Tier 5 starts (owner, 2026-11-08): talking to agents at a spot. Leaned in the walk on 2026-11-04, where
the owner set three points, and more on 2026-11-05 to 2026-11-07, each marked decided below:

- **Decided, no chat program.** tsh is the chat. You summon different agents and talk to them in
  tsh, so they learn to compose with your programs. It also makes the first day easy.
- **Decided, a spot's reply stays at the spot.** It is not copied back into tsh.
- **Decided, the word:** the name tag on what an agent is writing is a presence label
  ([shared tiles](./shared-tiles.md)).
- **Decided 2026-11-05, `@claude` is a wrapper.** It is tsh's own `tell` to an agent the host
  started, and with none running, the line that starts one (walked back 2026-11-06: `summon` starts it, below). It is read off the line before tsh's
  shell words, like Claude Code's `!`. The log keeps the line as typed, the job the name meant then,
  and that the cost line was shown
  ([experiment 210](../../experiments/210-at-claude-wrapper-or-primitive.md)). A Claude Code the
  person started themselves is out: reaching it would need a new push.
- **Decided 2026-11-06, `summon` starts an agent, by name.** Starting an agent is its own line:
  `summon <agent> [model] [effort] as <name>`, such as `summon claude haiku as scout` or
  `summon codex gpt-6-astra xhigh as researcher`. It is a paid run, started on purpose. `@` talks only
  to an agent summoned already, and tab completes only the names that exist now, so two of the same
  agent can run side by side under two names. This walks back the line above where `@claude` with
  none running starts one. Model and effort are set at the summon; a change later is the agent
  program's own command, not the pipeline's. The log keeps each summon: who, the agent, model,
  effort, name and both clocks.

  ```text
  tsh> summon claude haiku as scout
    scout · claude haiku · ready
  tsh> @sc<tab>  ->  @scout find where the lane retries
  ```

- **Decided 2026-11-06, a summoned agent lives on the desk, not in a tile.** Closing the tile it was
  summoned in changes nothing: any tsh, comment box or spot can still `@scout`. `dismiss scout` ends
  it. An idle agent spends nothing, since it only spends when asked. The top bar counts the agents on
  the desk ("3 agents"), and its list has a dismiss on each, so none is forgotten. If an idle agent
  turns out to hold memory or a sandbox, the fallback is to save and stop it and wake it on the next
  `@`, as Claude Code's `--resume` does.

- **Decided 2026-11-05, the started claude works in the repo.** The agent `@claude` starts gets the
  person's repo folder and the fabrika connection, not today's scratch folder. It still has no
  `answer` tool ([experiment 211](../../experiments/211-started-claude-sandbox.md)).
- **Decided 2026-11-05, its network is an allow list.** Not fully off: it reaches the hosts the
  repo's `.fabrika/fabrika.toml` names (the package registry, GitHub, docs) and nothing else, the
  way GitHub's coding agent has a firewall. The agent cannot write `.fabrika/`, so it cannot widen
  its own list; a change to the list is a person's.
- **Decided 2026-11-05, hidden files are a list too.** The same file names paths the agent cannot
  read, with `.env` and `.env.*` hidden by default, and a repo may change the list. The sandbox
  hides them, so claude cannot read them by any tool, not a rule it is asked to keep. The industry
  does this as config too (Claude Code's deny rules, Copilot's paths to exclude), but none hides
  `.env` unless asked; ours runs while nobody watches, so the default is on.

  ```toml
  # A sketch: the key names are not settled.
  [agent.network]
  allow = ["registry.npmjs.org", "github.com", "api.github.com", "docs.github.com"]

  [agent.files]
  hide = [".env", ".env.*"] # the default; a repo may change it
  ```

- **Decided 2026-11-05, each harness's own permission words pass through.** The same file carries
  one block per harness, in that harness's own words: Claude Code's permission mode and its
  `allow`, `ask` and `deny` rules, Codex's approval policy. Fabrika does not make up a shared set
  of words to translate, so nothing breaks when a harness changes, and any example in a harness's
  docs can be copied in. That settles the paid run: by default, the tool that starts a pipeline is
  in `ask`, so a run the agent wants shows on the person's tile and waits for Enter. A repo that
  moves it to `allow` gets runs without a prompt, and the log keeps that the repo chose it
  ([principle 5](./principles.md)). The host still refuses a rule that would open one of its own
  walls, such as allowing an `answer` tool: a wall is never a setting.

  ```toml
  # A sketch: the block names are not settled. The values are each harness's own words.
  [agent.claude]
  mode = "default"                 # Claude Code's permission mode, such as "auto"
  allow = ["Bash(pnpm test *)"]
  ask = ["mcp__fabrika__line"]     # starting a pipeline asks first; the tool name is unchecked
  deny = ["Bash(git push *)"]

  [agent.codex]
  approval_policy = "on-request"   # codex-cli 0.165.0 offers "on-request" and "never"
  sandbox = "workspace-write"      # or "read-only", "danger-full-access"
  ```

- **Decided 2026-11-05, talking at a spot is a mix: the box first, then one thread tile.** The
  owner walked a private Design canvas that drew three ways (the box alone, a thread view alone,
  and a mix) with a clickable try-it page, and picked the mix. The box at the spot holds the first
  1 or 2 turns. After that the talk moves to one thread tile, reused for every spot
  (`reuse: "program"`, [program guidelines](./program-guidelines.md)), opened by open or focus
  beside. The tile always names its spot ("claude on plan · turn 4"); there is no way to open a
  blank one. Esc and `C-b ;` go back to the spot. tsh stays the place for open-ended talk. So
  every conversation is about something: tsh, or a spot.
- **Decided 2026-11-05, never twice.** While the thread tile shows a thread, the spot shrinks to a
  chip, "2 replies · in t3", and does not show the talk again.
- **Decided 2026-11-05, what a spot is.** A spot is a program's `location`
  ([program guidelines](./program-guidelines.md), G2) plus the version it came from (the lane, or
  the plan version), and it may be a list of several rows. When the spot goes away, as on a rerun,
  the thread says "old lane" and its way back opens that lane.
- **Decided 2026-11-05, the thread tile also lists the threads on this ticket.**
- **Decided 2026-11-05, `@` does not clash.** `packages/fabrika/src/shell/grammar.ts` reads no `@`.
- **Decided 2026-11-07, `@` works in every text box, the command palette included.** There is no
  separate "Summon claude here" palette row ([below](#every-text-box-can-summon)).
- **Decided 2026-11-07, the `@` line.** It runs in the background, as if it ended in `&`, and
  `fg %scout` waits on it. The first `@name` answers; every later `@name` is a target that agent
  may use. Every `@name` is a mailbox address: an agent, a connector or a person
  ([below](#every-name-is-a-mailbox-address), and in full in
  [summon guidelines](./summon-guidelines.md#the--line-decided-2026-11-07)).
- **Decided 2026-11-07, a line from an agent nobody summoned is an inbox row.** It lands in the
  person's `inbox` program, the person replies inline on that row, and no tile opens on its own
  ([shared tiles](./shared-tiles.md#the-smaller-calls)).

The canvas's lean for the mix was 70% sure. It is a drawing: nothing ran in the app.

This walks back one thing, and only in how it reads: "no chat program" now means "no conversation
without a spot or a tile". tsh is still the chat for open-ended talk, and the thread tile is not a
chat program, since it cannot open without a spot. Nothing else above changes.

Proposed: clicking a presence label as one way to talk at a spot, the syntax, the frame owning the
box, the keys, and the accessibility wiring.

Built from [experiment 209](../../experiments/209-talking-to-agents-in-place.md) and the Design
canvas "Shared tile guidelines". Neither is a measurement.

```text
A sketch, today's version. t1 is the owner's tsh, with claude summoned into it.
tsh$ @claude why does post print #7 twice?        you, in-3f9a0c21-50
✦ claude  It formats the number in two places. I'll run the tests.     words, faint
✦ claude  pnpm exec vitest run programs/tracker/post      claude's own input, in-3f9a0c21-51
tsh$ git log --oneline -3                          you keep working; your prompt is yours
```

## Which version

- **Today's version** (tsh in `packages/fabrika/src/shell/`, the frame in `apps/fabrika`): this
  note.
- **`next/`:** the same rules in `fabsh` and Tuval's frame, read as a lesson. The spot's shape
  (below) is written for both, on `next/`'s `location`.

## `@claude` in tsh

- **`@claude <words>` talks to the agent in the tile.** It is Claude Code's `!`, reversed: there,
  `!` runs a shell line from a chat; here, `@` sends words to an agent from the shell
  ([Claude Code](https://code.claude.com/docs/en/interactive-mode)). The shell stays home and the
  agent is the escape.
- **A bare `@ <words>` goes to the only agent present.** With two agents, a bare `@` is refused in
  words: "two agents here: @claude or @codex".
- **Tab completes agent names,** the ones in this tile.
- **Replies are words, shown faint under the agent's presence label.** Lines the agent runs are
  commands under its label, shown plain. The person's prompt is never touched.
- **An explicit address beats a guess.** Warp guesses words or a command with a local classifier,
  and ships a denylist for commands it wrongly took for English
  ([Warp](https://docs.warp.dev/terminal/input/universal-input/)). `@` never guesses.
- **In a program with a text box,** such as a ticket's comment, `@claude` works there too, as
  Linear's agent mentions do ([Linear agents](https://linear.app/developers/agents)). See
  [every text box can summon](#every-text-box-can-summon) below.
- **In the data:** your `@` line is an input by you (`in-3f9a0c21-50`). Each line claude runs is
  its own input, by claude, so its writes are signed by claude. The open lean adds your message as
  its stated reason, recorded and never deciding
  ([inputs carry their sender](./inputs-carry-their-sender.md#open-an-agents-stated-reason)).

```ts
// A sketch, today's version. What tsh reads from a line that starts with `@`.
const Said = Schema.TaggedUnion({
	to: {agent: Schema.String, words: Schema.String}, // @claude why ...
	only: {words: Schema.String}, // @ why ...  -> the one agent here, or refused
});
```

## In `next/`: `summon` is an alias with a session

**Decided 2026-11-06.** In `next/` the shell is fabsh, and `claude` and `codex` are fabrika's own
programs, not the vendors' command lines. `summon` defines an alias, the shell's oldest known way;
each `@name` expands to one turn of that program on the alias's session. A turn can stop and ask the
person, since our program owns the turn.

**Corrected 2026-11-06, the same night.** This section first said "nothing runs between turns, so an
idle agent costs nothing". That was wrong. `summon` is more than an alias: it starts the agent, keeps
it running, and puts it on the ledger, where every member can see it. The alias is still how `@name`
reads; the agent behind it is a running program. Rooms, mentions, forks and the rest are in
[summon guidelines](./summon-guidelines.md): a talk is a room with members (a DM is a room of two),
decided later the same night.

```text
fabsh> summon claude haiku as scout on cloud
fabsh> @scout why is this slow?
```

- **Where each part lives.** The alias (name, agent, model, effort, permissions, session id, where it
  runs) and the session's content are kept by the brain, so any client can `@scout`, a phone
  included, while the Mac sleeps. The turn runs on hands. Using fabrika from a phone is one of the
  owner's first needs, which is why the session is not kept on the Mac. The content stays deletable
  ([an agent run keeps its content](./an-agent-run-keeps-its-content.md)).
- **Two messages at once** queue in the run's one mailbox, as every program's do
  ([tea program](./tea-program.md)). Nothing new for agents.
- **Names belong to a person.** On a shared desk, another person's scout is theirs, shown with their
  name.
- **Permissions ride on the alias,** so every turn of scout runs with the rights it was summoned
  with.
- **The log keeps both lines:** the line as typed and what it expanded to, like `set -x`.
- **Where it runs.** A turn needs files and agents, so a browser tab never takes it. Beyond that, the
  person sets an ordered list of hands, such as their Mac, then their cloud host. The brain offers a
  turn to the first; if it is not taken within a short wait (10 seconds, a guess to tune), the next
  gets it. `on <hands>` on the summon pins one agent. Each turn records which hands ran it and why. The
  known ways: GitHub Actions' `runs-on` labels, Buildkite's queues, and Kubernetes' required and
  preferred node affinity.

## Every text box can summon

**Decided 2026-11-07:** `@` works in every text box, the command palette included, and there is
no separate "Summon claude here" palette row. It was proposed 2026-11-05, when the owner leaned for
it. Every text box is a place to call in your agents, not only tsh. The rows below are still
proposed.

- **The `@` menu lists agents already on your desk first,** then a "summon <name> here" row for one
  that is not.
- **Picking that row is the summon, said in words.** It starts a paid run and gets permissions, so
  it is never a silent side effect of finishing a name.
- **A program opts in with one prop.** It builds its box from fabrika's shared text field in the
  design package ([one design package](./fabrika-design-package.md)) instead of a plain textarea.
  The field does the `@` list and the summon, sends the words as the person's input, and shows the
  reply. A plain box stays plain text.
- **A program with no text box** gets the frame's spot box instead (below).
- **In the data:** the person's words are their input. The reply is the agent's own write, signed
  by the agent; under the open lean, the person's words are its stated reason
  ([inputs carry their sender](./inputs-carry-their-sender.md#open-an-agents-stated-reason)).

```tsx
// A sketch, today's version. `TextField` and its props are made up.
// Before: a plain box, plain text.
<textarea value={m.draft} onInput={draftChanged} />
// After: the shared field. `agents` is the whole opt-in.
<TextField value={m.draft} onInput={draftChanged} agents />
// The @ menu it opens in ticket #7's comment box, claude on the desk, codex not:
//   ✦ claude                 on your desk
//   ✦ summon codex here      starts a run
```

## Every `@name` is a mailbox address

**Decided 2026-11-07.** The grammar expands `@x words` to `tell x <input> "words"`, and `tell`
delivers to x's mailbox. An agent, a connector and a person all work the same way, and their names
share one list. The full rules are in
[summon guidelines](./summon-guidelines.md#the--line-decided-2026-11-07).

```text
A sketch, both versions. Three kinds of name, one way to reach them.
@scout why is this slow?      ->  tell scout <input> "why is this slow?"      an agent
@linear what is open?         ->  tell linear <input> "what is open?"         a connector (summon linear from linear)
@ana the plan is ready        ->  tell ana <input> "the plan is ready"        ana's inbox program
```

- **A person's inbox is a program registered under their name,** so `@ana hi` reaches ana's inbox
  program, and her windows show it.
- **The sender never knows where the process runs,** one Mac, another, a browser tab or the brain:
  Erlang's location transparency ([distributed Erlang](https://www.erlang.org/doc/system/distributed.html)).
- **Today's version:** `tell` goes to a job on this Mac, into that run's mailbox, and a person's
  inbox is this app's `inbox` program. **`next/`:** `tell` sends through P9's `Mailbox` into the
  `<name>/inbox` stream, and the brain keeps the names.

## Talking at a spot

In any program, select a thing and press a key, or click a presence label. A small box opens
anchored there. The spot rides with the message as context, so "why is this slow?" needs no
copy-paste. The reply stays at the spot for the first 1 or 2 turns, then the talk moves to the
thread tile (below). It is never copied into tsh.

```text
A sketch, today's version. trace in t2 beside tsh in t1; ticket #7's lane, the plan step.
select the span "plan · turn 4"         trace tells the frame what is selected
press the key (C-b @, made up)          the frame opens a box at the span: "Ask claude about plan · turn 4"
type "why is this slow?", Enter         an input by you, in-3f9a0c21-60, the spot frozen at send
claude replies                          claude's own input, in-3f9a0c21-61, so the reply's write
                                        is claude's; in-3f9a0c21-60 is its stated reason (the
                                        open lean); kept on the spot
the span shows "1 reply"                a polite status says "claude replied on plan · turn 4"; focus stays
```

- **The frame owns the box,** so every program gets it, a third-party one too. A program only says
  what is selected. Anchored Conversations ran the same way in 2000: a coordinator outside the
  apps, "uniform across different applications" (Churchill et al., CHI 2000).
- **Freeze the spot at send.** What was selected when you pressed Enter is what the agent gets,
  whatever you select after. Claude Code does this for a queued message with an editor selection.
- **When the spot changes or goes, say so.** Never drop the thread silently. AnchoredAI needed an
  update step so comments stayed right after edits.
- **Keys:** one key opens the box at the selection, Esc closes it and puts focus back, one key
  jumps to the next and previous thread, as Google Docs' Ctrl+Alt+M (Cmd+Option+M) opens a comment
  on a selection ([Docs](https://support.google.com/docs/answer/179738)).

```ts
// A sketch, both versions. What a program tells the frame about its selection (decided
// 2026-11-05). `program` and `location` are G2's words; `Spot`, `Version` and `name` are made up.
const Version = Schema.TaggedUnion({
	lane: {lane: Schema.String}, // the lane run it came from; a rerun is a new lane
	plan: {plan: Schema.Number}, // the plan version: 2
});
const Spot = Schema.Struct({
	program: Schema.String, // "trace"
	location: Schema.Unknown, // the program's own location.data decodes it, as an open does
	version: Version,
	name: Schema.String, // what a person and a screen reader hear: "plan · turn 4"
});
const Spots = Schema.NonEmptyArray(Spot); // several rows selected: one thread about all of them

// One value, traced: the span in ticket #7's lane, plan step, turn 4.
// {program: "trace", location: {span: "7f3a"}, version: {_tag: "lane", lane: "..."},
//  name: "plan · turn 4"}
// After a rerun the lane is gone: the thread says "old lane", and back opens that lane.
```

## The thread tile, and replies

Decided 2026-11-05, except replies, which are a lean.

```text
A sketch, today's version. The same span, turn 3: the talk outgrew the box.
claude replies a second time            the box at the span holds 2 turns; the next send opens
                                        the thread tile beside, by open or focus: "claude on plan · turn 4"
the span                                shrinks to a chip "2 replies · in t3"; the talk is shown once
Esc, or C-b ;                           back to the span, focus where it was
another span, another talk              the same thread tile, now on that spot; one tile per workspace
```

```ts
// A sketch, both versions. The thread tile in program guidelines' shape. `thread`,
// `ThreadLocation` and its fields are made up.
const ThreadLocation = Schema.Union([
	Schema.Struct({spots: Spots}), // one thread, always on a spot
	Schema.Struct({ticket: Schema.String}), // "threads on this ticket": the list, never a blank chat
]);
// (updated 2026-11-08 to Program.make; in today's version it is defineProgram)
const thread = Program.make({
	name: "thread",
	location: {data: ThreadLocation, select: (m) => m.location},
	reuse: "program", // open or focus: every spot's talk lands in the same tile
	// ...machine (its own Machine.make value), view as any program
});
```

- **It always names its spot,** in its title and its accessible name. With no spot, there is
  nothing to open: the palette has no "new thread" row.
- **The same tile lists the threads on this ticket,** one row per spot, so a talk from another tile
  is found again.
- **When the spot goes,** the thread stays and says "old lane"; its way back opens that lane's
  location, not today's.
- **Replies (a lean, not decided, 70%).** A reply marks its spot "N replies", in words. A polite
  status line says it once, without moving focus. The ticket's thread list shows it. A reply never
  goes to the inbox, unless it ends in a real question; then that question becomes an ask
  ([the ask desk](./ask-desk.md)).

## Why

- **Ownership.** Anchored AI comments gave writers more ownership and control than a side chat
  (AnchoredAI, 22 people: 4.0 vs 2.3 on "main contributor"). Chat users pasted about six times more
  words per paste. The cost was more effort.
- **Agents reply in threads in the field.** In a one-week CHI 2026 study (30 people, 14 teams),
  agents replied only in comment threads and never edited text directly.
- **Presence helps.** In Codellaborator (18 people), presence indicators "alleviated disruptions
  and improved users' awareness of AI processes".
- **It meets the principles:** spend the person's attention well, and talk to people where they
  already are, then bring them into fabrika ([principles](./principles.md)).

## Accessibility

- The selected thing gets `aria-details` pointing at its thread. ARIA 1.3 adds `role="comment"`,
  replies nested; it is a draft, and screen reader support is not confirmed
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/Comment_role)).
- A finished reply is announced once, politely, without moving focus
  ([WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)). Streaming tokens
  into a live region would flood the reader. "Announce once complete" is our inference, not a
  sourced rule.
- Select, then key, works in every program
  ([WCAG 2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)). The box is labeled
  with its target.
- Needs a real VoiceOver run in the built app. Nothing here proves it works.

## Linear as the builder

Linear's agent session is a comment thread with typed activities, and a mention starts it. Built as
fabrika programs: tsh is the thread for the tile, a spot's box is the thread for a thing, and the
frame owns the box so no program builds its own chat. Where we differ: Linear has no shell, and
Linear keeps the agent's reply on the issue; ours stays at the spot.

## Where this differs from settled notes

- **[An agent is a program](./agents-are-programs.md)** (proposed) gives `claude` and `codex` a
  chat window. This note says fabrika has no chat program, read since 2026-11-05 as no
  conversation without a spot or a tile. If the owner settles this note, that part
  of the older one goes; its "an agent is a program" part stays.
- **The `@` menu's "summon <name> here" row** (proposed 2026-11-05, below the decided `@` in every
  box) clashes with the decision of 2026-11-06 that `@` talks only to an agent summoned already.
  Not settled here.
- **The plan's Tier 5 line** (the closed [PR 192](https://github.com/usirin/tea-fabrika/pull/192)'s
  code "rethought when a chat window needs it") changes the same way.

## Open

- **Is the box alone enough?** If most talks stay 1 to 3 turns, the thread tile is extra. A log of
  real spot talks, turns per talk, settles it.
- **The hearable name of a spot that is not text,** such as a span or a chart point. `name` above
  is a placeholder.
- **What the agent may see of the spot.** That is the box's call
  ([programs run in a box](./programs-run-in-a-box.md)), not this note's.
- **Replies:** the lean above (70%). Whether people miss a reply left at a spot in another tile
  is not known.
- **A `@` inside a flag's value,** such as an email, is not checked.

## What it costs

A guess. `@` in tsh, about 200 lines with tests. The frame's box, the spot data and its keys, about
500. The thread tile, the chip and the ticket's thread list: about 450 more than the box alone,
the canvas's own guess. Sure: 50%; the spot's shape is now set, but nothing is built.

## Made up here

The `C-b @` key, `TextField` and its props, the `@` menu's row words, `Said` and its cases, `Spot`,
`Spots`, `Version`, `name`, `thread`, `ThreadLocation`, the chip's and title's words, the refusal's
words, the span names past the lane's real steps, claude's words, the
ids, and the vitest path.

## What it cannot tell us

- The mix was picked from a private Design canvas and its try-it page. That is a drawing: nothing
  ran in the app, and no real spot talk was logged, so the 1-or-2-turn cut is a guess.
- Nothing ran. Nobody has tested `@` addressing an agent inside a live shell, with both writers in
  one scrollback. No study either.
- Talking at a spot in a non-text program (a span, a log row) is not studied. Text and images are.
- The studies are small (18 to 30 people), mostly about writing.
- No screen reader run.
