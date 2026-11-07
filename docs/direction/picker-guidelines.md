# Pickers: Cmd-K is a picker, and search is one source of many

**Proposed 2026-11-06.** Nothing here is decided yet. It stands on these, decided before it and not
asked again: the palette is Cmd-K, every command by name, grouped, with its tsh word and keys
([the frame](./the-frame.md)); the palette and the keys panel are one component
([popovers](./popovers.md#7-keys-in-the-palette-and-the-keys-panel)); the palette is the one
desk-wide modal and the desk is inert under it ([layers](./layers.md), L4); Cmd-K is a binding like
any other ([keybindings](./keybindings-are-configurable.md)); the palette is a Zag dialog with our
own combobox and list inside ([UI on Manti](./ui-on-manti.md)); every command is a palette row and a
tsh word, and a program hands the desk `index(model)`, a pure function, so the desk keeps one index
and ranks once, and picking a row is `open program location`
([program guidelines](./program-guidelines.md), G3, G5, G7 and its R5, decided 2026-11-06).

Built from [experiment 219](../../experiments/219-picker-guidelines.md), which read about 20 makers
and tools, three of them outside software, and checked today's palette against them, and a Design
canvas, "Picker guidelines", that a second pass draws. Neither is a measurement.

```ts
// A sketch, next/, Tier 2. The tracker hands the desk two things: rows to find, and a word to narrow by.
const tracker = defineProgram({
	name: "tracker",
	// machine, msg, view, commands, location: as program guidelines
	index: (m) => m.tickets.map((t) => ({id: `#${t.number}`, location: `#${t.number}`, title: t.title, hint: t.state, open: t.state !== "done"})),
	find: {word: "t", noun: "tickets"}, // Q3: `t ` narrows the box to this program's rows
});

// The desk's picker. One model; the selected row is an id, never an index (Q4).
type Picker = {
	query: string;
	scope: Scope | null;                     // null: every source, grouped
	selected: RowId | null;                  // null only when no row matches
	agent: {_tag: "idle"} | {_tag: "asking"; run: RunId} | {_tag: "answered"; run: RunId};
	stack: ReadonlyArray<Level>;             // Q5: the row's actions, then a nested picker; Esc pops one
};
type Scope =
	| {_tag: "commands"}
	| {_tag: "program"; program: string}     // `t `, or Enter on "All 37 tickets"
	| {_tag: "agent"; agent: "claude"};
type Level = {_tag: "actions"; on: RowId} | {_tag: "picker"; scope: Scope; query: string};
```

```text
one sitting, traced (next/, a sketch)
Cmd-K          the box opens, empty                 Commands (5), then Recent; "24 results" said politely
t, Space       scope {program: "tracker"}            a chip "Tickets" before the cursor; "37 tickets"
stall          the desk ranks the tracker's rows    open work first; #193 "lane stalls at the test writer" selected
               claude's row, last, says "Ask claude about 'stall'"; nothing is sent
Cmd-K          stack + {actions, on: "#193"}        the ticket program's commands for #193: Open, Comment, Close
Esc            stack pops                            back on #193, the query kept
Enter          open {program: "ticket", location: "#193"} (G3)   the box closes; focus to the ticket tile
               the bottom line                       next time: C-b t, then #193
```

## Which version

- **`next/`:** the desk's picker in Tier 2, with the desk and the first programs. Every principle
  below is for `next/`, built from the start.
- **Today's version:** the palette in `apps/fabrika/src/window/pop.tsx` and `frame.tsx` is the
  running example. Two small fixes are offered as a tryout (below); nothing else changes there.

## The shape

Two fields on a program, both optional, beside R5's `index`:

```ts
// A sketch. SearchableItem is R5's row with two fields added: an id, and `open` for ranking.
type SearchableItem = {id: string; location: string; title: string; hint: string; open: boolean};
type Find = {word: string; noun: string}; // `t`, `tickets`: the narrowing word and the group's name
```

- `id` is new: R5's sketch had `location`, which can repeat across programs. Q4 needs a key that is
  unique in the box, so the desk makes it `program + id`.
- `open` is new: Linear ranks "unstarted and in progress issues first" [l1]. A free `hint` string
  cannot rank, so the fact becomes a field.
- Checked by reading against R5's sketch and today's `Command` (`apps/fabrika/src/window/frame.ts:137`),
  not by `tsc`.

## The seven principles

### Q1: a picker is five parts, and a program writes only its sources

**Lean, 85%.**

- **What it means.** A source hands rows, the ranker scores them, each row has an id, a row has
  actions, and a row may have a preview. A program writes a source (`index`, `find`, `commands`).
  The desk owns the box, the ranker, the keys and the stack. No program draws its own Cmd-K.
- **Why.** Telescope: a `finder` "is a required field", and each row has an `ordinal` "used for
  sorting" [t1]. Emacs keeps UI, sources and actions in three packages that meet in one call [e1].
  Spotlight: apps "add items to the on-device index" [c1].
- **Linear as the builder.** Linear's menu is one box fed by every part of the product. On our
  pieces the desk is that box, and each program feeds it through R5, so a new program is findable
  the day it ships, with no change to the box.
- **Elm.** The picker is one model and one update in the desk, and `index` is a pure function like
  `view`. A program never runs code per keystroke.
- **Accessibility.** One box means one combobox to get right, once (Q7).
- **What holds it.** A law: every row in the box comes from a source; the box has no rows of its own
  but the agent's one (Q6).
- **Doubt and cost.** A source that must be asked live (a web search, a git grep) does not fit a
  pure `index`. Consult's async sources [e3] would be a second kind; none is needed in Tier 2.
  About 150 lines for the desk's picker model.
- **Today: breaks.** One source, written into the frame (`apps/fabrika/src/window/frame.ts:166`).

### Q2: one box, commands first, a few rows per program

**Lean, 70%.** This answers the chat lean: one box for commands and things, commands first.

- **What it means.** With no scope, the box shows every source as a group: Commands first, then one
  group per program, in a fixed order. Each program's group shows its top 5 rows and, under them, one
  row "All 37 tickets" that narrows to that program (Q3). The ranker is the desk's: match score,
  then `open` first, then recent picks. At most 500 rows in a narrowed box, as Linear [l1].
- **Why.** Superhuman: Cmd-K is where "you can instantly do any action", and one score filters and
  sorts [s1]. Linear: open work first, "500 results maximum" [l1]. G1000: "the 25 nearest airports"
  before any typing [f2]. Alfred learns from a row's `uid` "for subsequent sorting" [a1].
- **Linear as the builder.** Linear types its search prefixes in the command menu [l1], so its one box holds both. The
  fixed group order is ours, from Toast's fixed modifier order [f3]: hands learn where Tickets sit.
- **Elm.** The ranking is a pure function of the query, the index and the pick history.
- **Accessibility.** Groups are `role="group"` with a name [w2], so a screen reader says "Tickets"
  on entering one. A fixed order is WCAG 3.2.3, consistent navigation.
- **What holds it.** A law: with no scope, no group shows more than its cap plus its "All N" row.
- **Doubt and cost.** 5 is a guess. Commands first could bury the one ticket a person typed the
  number of: an exact `#193` match goes to the top, ahead of commands (smaller call 2). The build
  pass's shots and a day of use settle it. About 80 lines for the ranker.
- **Today: half.** Commands only, grouped (`apps/fabrika/src/window/frame.tsx:1014`); no score
  (`frame.ts:198-203`).

### Q3: narrow by a word and a space

**Lean, 70%.** This answers the chat lean on Linear's prefixes: yes, one word per program.

- **What it means.** A program's `find.word` and a space narrow the box to its rows: `t ` for
  tickets, `>` for commands only. The scope shows as a chip before the cursor, and Backspace on an
  empty query removes it. `?` lists every word, as VS Code does. The "All 37 tickets" row and the
  word do the same thing.
- **Why.** Consult: "type `f SPC` in order to narrow to recent files" [e3]. Linear: `i p u t l f d`
  with a space [l1]. VS Code: "Type `?` ... to get a list of available commands" [v3]. Ableton:
  a typed word and a picked tag narrow together [f1].
- **Linear as the builder.** Linear's prefixes, as they are. On our pieces the word is declared by
  the program, and the desk refuses two programs with one word at load, as the keys file refuses a
  clash.
- **Elm.** Scope is a field of the picker's model, a tagged union, never parsed again from the text.
- **Accessibility.** The chip is in the combobox's name ("Find tickets"), so it is read. 3.3.2: the
  placeholder names the words (`Type, or t for tickets`).
- **What holds it.** The load refuses a word two programs claim, and a word that is a tsh word.
- **Doubt and cost.** One letter per program runs out. Two letters, or the program's name, are the
  fallback. About 40 lines.
- **Today: breaks.** No scope.

### Q4: the row under the cursor never moves

**Lean, 85%.**

- **What it means.** The selection is a row id. When rows arrive late (a program sends a new index,
  the agent answers), the selected row keeps its place on screen; new rows land below it or in their
  own group. Only a typed key moves the selection to the top match.
- **Why.** Every tool had to add this as a setting: Telescope's `selection_strategy` "Determines how
  the cursor acts after each sort iteration" [t2]; fzf's `--track` [z1]; VS Code's
  `keepScrollPosition`, off by default [v1]. WCAG 3.2.2: input never causes a change on its own [w6].
- **Linear as the builder.** No Linear answer read on late rows. On our
  pieces the index is local (R5), so only the agent and a running program add rows late.
- **Elm.** `selected: RowId | null` in the model; an index of rows never is the state.
- **Accessibility.** `aria-activedescendant` points at the id [w1], so a screen reader is never told
  a different row is selected than the one it last read.
- **What holds it.** A property test: for any late batch of rows, the selected id and its screen
  position before equal those after, unless a key was pressed.
- **Doubt and cost.** A row that disappears (a ticket closed elsewhere) must move the selection;
  the rule then is "the next row down". About 30 lines.
- **Today: half.** No row arrives late, but the selection is an index reset on every key
  (`apps/fabrika/src/window/frame.ts:921`).

### Q5: Enter acts, Cmd-K shows the rest, Esc goes back one

**Lean, 75%.** This is G5 inside the box.

- **What it means.** Enter does a row's first action: `open program location` for a thing, the
  command for a command. Cmd-Enter does the second. Cmd-K inside the box opens the row's actions, a
  nested list drawn from its program's `commands` (G7), scoped to that row. A row may open a nested
  picker (pick a label, then a ticket). Each level is pushed on the stack; Esc pops one, and Esc at
  the top closes the box and puts focus back (popovers, layers L4).
- **Why.** Raycast: Enter primary, Cmd-Enter secondary, Cmd-K "showing all available actions for
  the selected item", and "When a user presses `ESC`, we automatically pop" [r2][r3]. Embark: a
  "keyboard-based version of a right-click contextual menu" [e2]. G1000: pick the row, then
  Direct-to [f2].
- **Linear as the builder.** Linear's menu on a selected issue lists that issue's actions. On our
  pieces the actions are the row's program's `commands`, so nothing is written twice.
- **Elm, OTP.** The stack is a list in the model. No OTP answer.
- **Accessibility.** The actions list is the same combobox with a new name ("Actions for #193"), so
  focus never leaves the input [w1]; 2.1.2 holds because Esc always leaves [w5].
- **What holds it.** A law: Esc from any level reaches the closed box in at most `stack.length + 1`
  presses, and focus lands where it was before Cmd-K.
- **Doubt and cost.** Cmd-K inside Cmd-K reads oddly to a newcomer. Raycast ships it; the footer
  shows it. About 100 lines.
- **Today: half.** Enter runs and Esc closes (`apps/fabrika/src/window/pop.tsx:563`); no actions,
  no stack.

### Q6: the agent is one more source, last, and only on a press

**Lean, 65%.** This is where the intelligence point sits.

- **What it means.** Claude is a source with one row, always last and always in the same place:
  "Ask claude about 'stall'". Nothing is sent while typing. Enter or Tab on that row asks; the row
  becomes the answer, which streams in under it, in its own group, while the rows above never move
  (Q4). Enter on the answer opens a claude tile beside, with the question and answer (G3). Narrowed
  with `@claude ` (the word experiment 210 uses in tsh), the whole box asks.
- **Why.** Raycast's Quick AI asks "a one-off question from Root Search" [r4]. NN/g: past 1 s show
  work, past 10 s show progress and a way to stop [n2]. Ableton previews free samples on each arrow
  [f1]; an agent's answer is not free, so it waits for a press.
- **Linear as the builder.** No Linear answer read: its AI pages were not fetched (guess: it sits beside the issue, not in search). On our
  pieces the agent is a program (agents are programs), so its row is its source and its tile is its
  own.
- **Elm, OTP.** The ask is a Cmd; the answer arrives as Msgs to the picker. If the box closes, the
  run is monitored and canceled, as an OTP link would.
- **Accessibility.** One polite status when the ask starts ("Asking claude") and one when it ends
  ("Claude answered, 4 lines"), never each token [w4]. Esc cancels the ask first.
- **What holds it.** G4: an ask carries the press's `via`; a law that typing never starts a run.
- **Doubt and cost.** A person may want the agent to rank the rows, not only answer. That puts
  money and seconds on every keystroke; a test with real queries would show if the plain ranker
  misses. About 120 lines, Tier 5 with agents.
- **Today: breaks.** No agent in the palette.

### Q7: the accessibility floor

**Lean, 90%** on the floor; the VoiceOver run is required before it is decided.

- **What it means.** The input keeps DOM focus and is a combobox; rows are options in a listbox,
  grouped with names; `aria-activedescendant` names the selected id [w1][w2]. The count is a polite
  status after typing pauses, "37 tickets", "No results" [w4]. Every state has a word, never color
  alone (1.4.1). Esc always leaves (2.1.2); the prefix and F6 still work under the box (layers).
  Typing never runs anything (3.2.2). Focus goes back on close [w3]. A row's keys are in
  `aria-keyshortcuts`.
- **Why.** APG and WCAG as quoted; cmdk tested with VoiceOver only [m3], so a second reader is on
  us.
- **Linear as the builder.** Linear's menu is a combobox. On our pieces the floor lives in the one
  component, so every source gets it free (G7).
- **Elm.** The status words are a pure function of the model, so a test reads them.
- **What holds it.** The existing role tests (`apps/fabrika/src/window/pop.test.ts:334`) plus one for
  the live count; a VoiceOver and an NVDA run before the note is decided.
- **Doubt and cost.** How long to wait before saying the count is a guess (about 500 ms); the
  screen reader run sets it. About 30 lines.
- **Today: half.** The combobox and focus back follow (`apps/fabrika/src/window/pop.tsx:550`,
  `:127-142`). The count sits in `aria-hidden` (`pop.tsx:159`, `:614`), so no one hears it.

## The smaller calls

### 1. Is a picker a program on a pipe?

```text
A  only the desk's box        Cmd-K, nothing else
B  pick is a filter program   tracker --all | pick | ticket     rows in, one row out (C5)
```

**Lean B, 60%.** `pick` is a filter: rows in, the picked row out, as fzf is in a shell [z1]. Cmd-K is
the desk running the same `pick` over its index in the palette layer. It costs a second way to draw
the box; it buys a picker in a tile, beside its preview, which Telescope and Consult users keep
open. The doubt: the palette is a layer, a tile is not, and one component in both may fight layers
L4.

### 2. An exact match beats commands first

```ts
// `#193` or `193` typed: the ticket goes on top, ahead of Commands
```

**Lean, 75%.** Commands first is for words; a number is a thing.

### 3. A preview

```text
A  none in the box; Enter opens the tile beside (G3)
B  a pane at the right, from the row program's glance, as Raycast's List.Item.Detail
```

**Lean A, 55%.** Layers L6 says a look opens in place before it floats, and the box is a float.
The doubt: Telescope and Raycast users expect B. The build pass shoots both.

### 4. What the empty box shows

**Lean, 70%:** Commands (5) and Recent (5), the last things picked, as Vertico sorts by history [e1].

## What the ledger records

One fact per pick: `{_tag: "picked", query, scope, row, rank, via, sentAt}`. If it is not recorded
now, what people typed and what they took is lost, and a ranker that learns (Alfred's `uid` [a1])
has nothing to learn from. The query is content a person may want gone, so it stays deletable
([an agent run keeps its content](./an-agent-run-keeps-its-content.md)).

## A tryout in today's version

Offered, not filed:

- The count in a polite live region instead of an `aria-hidden` footer: about 10 lines, under an
  agent hour (Q7).
- The selection kept by command name, not index: about 15 lines, under an agent hour (Q4).

## Where this differs from settled notes

- **R5's row gets two fields,** `id` and `open`. R5 is decided; this changes its sketch, not its
  rule.
- **The palette's `Over` type** in popovers (`{kind: "palette"; ... at: number}`) keeps an index;
  Q4 makes it a row id. Popovers is settled on looks, and this is behavior.
- **Popovers says the palette and the keys panel are one component.** That holds: the keys panel is
  the commands scope with every key shown.

## What it costs

About 550 lines in `next/`'s desk for Q1 to Q5 and Q7, 6 to 8 agent hours, in Tier 2. Q6 waits on
agents in Tier 5, about 120 lines.

## What it cannot tell us

- Nothing here was built or used. The four designs in experiment 219 are for the build pass.
- 5 rows per group, 500 at most and a 500 ms count delay are guesses or copied numbers, not ours.
- Whether one index ranks thousands of rows inside 0.1 s.
- How VoiceOver and NVDA read a streamed answer and a nested actions list.
- Linear's own command menu pages did not load, so its nested actions are from program guidelines'
  sources.

## Links

Tags are experiment 219's: [t1] [t2] Telescope, [r2] [r3] [r4] Raycast, [v1] [v3] VS Code, [z1] fzf,
[e1] [e2] [e3] Vertico, Embark, Consult, [l1] Linear search, [s1] Superhuman, [a1] Alfred, [c1] Core
Spotlight, [m3] cmdk, [w1] to [w6] APG and WCAG, [n2] NN/g, [f1] Ableton, [f2] G1000, [f3] Toast.
