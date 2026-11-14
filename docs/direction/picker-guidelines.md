---
state: "decided 2026-11-07"
summary: "`next/`, Tier 2, with today's palette as the example. `pick` is one program: Cmd-K runs it over the desk's index in the palette layer, with no dim; `/` on the tracker, or typing `pick`, runs it in a tile as `tracker | pick | ticket`, rows in and one row out (Q9). A program writes only its sources: `index(model)`, a `prefix` and its `commands` (Q1). One box, Commands first, 5 per group with an \"All N\" row, Recent when empty (Q2); an exact id such as `#193` goes on top (Q3); `t ` and a space narrow, `?` lists the prefixes (Q4); `@` lists people and summoned agents, and the plain Ask row asks your default agent only on a press (Q5); fabsh is a source, and `>` makes the box a fabsh line whose rows you then find in (Q6); the selected row never moves (Q7); Enter acts, Cmd-K in the box shows the row's actions, Esc pops one (Q8); the APG combobox with a spoken count as the floor (Q10). Rooms and DMs are the summon note's. Built from experiment 219 and a prototype the owner pressed."
---

# Pickers: Cmd-K is a picker, and search is one source of many

**Decided 2026-11-07.** The owner approved the ten principles, the shape and the smaller calls below
with their leans, after pressing the prototype. The leans' confidence numbers stay as written. It
stands on these, decided before it and not asked again: the palette is Cmd-K, every command by
name, grouped, with its tsh word and keys ([the frame](./the-frame.md)); the palette and the keys
panel are one component ([popovers](./popovers.md#7-keys-in-the-palette-and-the-keys-panel)); the
palette has no dim behind it ([popovers](./popovers.md), the owner, 2026-11-06); the palette is the
one desk-wide modal and the desk is inert under it ([layers](./layers.md), L4); Cmd-K is a binding
like any other ([keybindings](./keybindings-are-configurable.md)); the palette is a Zag dialog with
our own combobox and list inside ([UI on Manti](./ui-on-manti.md)); every command is a palette row
and a tsh word, and a program hands the desk `index(model)`, a pure function, so the desk keeps one
index and ranks once, and picking a row is `open program location`
([program guidelines](./program-guidelines.md), G3, G5, G7 and its R5, decided 2026-11-06).

Its decided rules are in: [0512](../../.decisions/0512-a-picker-is-five-parts.md),
[0513](../../.decisions/0513-the-picker-is-one-ranked-box.md),
[0514](../../.decisions/0514-a-prefix-narrows-the-picker.md),
[0515](../../.decisions/0515-enter-acts-esc-goes-back-one.md),
[0516](../../.decisions/0516-each-pick-is-a-picked-fact.md).

Rooms, direct messages, mentions, summon and forks belong to the summon note
([PR 425](https://github.com/usirin/tea-fabrika/pull/425), proposed). The picker only lists them as
a source.

Built from [experiment 219](../../experiments/219-picker-guidelines.md), which read about 20 makers
and tools, three of them outside software, and checked today's palette against them, and a Design
canvas, "Picker guidelines": round 1 built four designs in today's app and shot 74 states, the walk
joined three of them into one `pick`, and a clickable prototype of it was pressed through all 34
presses. Neither is a measurement.

```ts
// A sketch, next/, Tier 2. The tracker hands the desk a pure function, a prefix and its commands.
// (updated 2026-11-08 to Program.make, and to one id per thing: the row's id was `#${t.number}`)
const tracker = Program.make({
	name: "tracker",
	prefix: "t", // Q4: `t ` narrows the box to this program's rows
	index: (m) =>
		m.tickets.map((t) => ({
			id: t.id, // the ticket's one id; data points at it (one id per thing)
			label: `#${t.n}`, // Q3: typed exactly, this row goes on top; only the tracker prints n
			location: {ticket: t.id},
			title: t.title,
			hint: t.state,
			open: t.state !== "done", // Q2: open work ranks first
		})),
	// machine (its own Machine.make value), view, commands, location: as program guidelines
});

// pick's model: one program, in the palette layer or in a tile (Q9). The selection is an id (Q7).
type Pick = {
	query: string;
	scope: Scope | null; // null: every source, grouped (Q2)
	selected: RowId | null; // null only when no row matches
	ask: {_tag: "idle"} | {_tag: "asking"; run: RunId} | {_tag: "answered"; run: RunId} | {_tag: "stopped"; run: RunId};
	stack: ReadonlyArray<{_tag: "actions"; on: RowId}>; // Q8: Esc pops one
};
type Scope =
	| {_tag: "commands"} // Enter on "All 22 commands"
	| {_tag: "program"; program: string} // `t `, or Enter on "All 23 tickets"
	| {_tag: "prefixes"} // `?`
	| {_tag: "people"} // `@`: people and summoned agents
	| {_tag: "agent"; agent: string} // `@scout`, Tab: your direct message with scout
	| {_tag: "person"; person: string} // `@` a teammate, Tab: a direct message, answered later
	| {_tag: "room"; room: string} // `#bug-17`, Tab
	| {_tag: "line"} // `>`: a fabsh line
	| {_tag: "rows"; line: string}; // `>tracker |`: find in the line's rows
```

```text
one sitting, traced (next/, a sketch)
Cmd-K          pick opens in the palette layer        Commands (5), then Recent (5); "22 commands, 5 recent"
#193           an exact id                            #193 on top, above Commands; selected
               the trace program's rows arrive late   "Trace of ticket 193" lands under its own group; #193 stays
Cmd-K          stack + {actions, on: "#193"}          the same box: "Actions for #193": Open, Comment, Close
Esc            stack pops                             back on #193, the query kept
Enter          open ticket {ticket: 193} (G3)         the box closes; focus goes back; the ticket shows #193

in a tile
/              on the tracker                         the tracker folds to a strip; pick takes its place
test writer    pick finds in the tracker's rows       tracker | pick | ticket: the ticket tile follows the selection
Enter          pick sends the row on                  the ticket tile shows #193; pick stays
Esc, Esc       clears the box, then leaves            the tracker comes back, on #193

talking
@sc, Tab       scope {agent: "scout"}                 a chip "@scout": your direct message with scout
a question     Enter                                  "Asking scout"; the answer streams in the box; "Scout answered, 4 lines"
```

## Which version

- **`next/`:** `pick` and the desk's index, in Tier 2 with the desk and the first programs. Every
  principle below is for `next/`, built from the start.
- **Today's version:** the palette in `apps/fabrika/src/window/pop.tsx` and `frame.tsx` is the
  running example. Two small fixes are offered as a tryout (below); nothing else changes there.

## The shape

One new field on a program, `prefix`, beside R5's `index` and G7's `commands`, all optional:

```ts
// A sketch. SearchableItem is R5's row with two fields added: an id, and `open` for ranking.
type SearchableItem = {id: string; location: Location; title: string; hint: string; open: boolean};
type Program = {
	// name, machine, view, location: as program guidelines
	index?: (model: Model) => ReadonlyArray<SearchableItem>; // R5
	prefix?: string; // `t`: a word and a space narrow the box to this program's rows (Q4)
	commands?: Commands; // G7: they are also the actions on this program's rows (Q8)
};
```

- `id` is new: R5's sketch had `location`, which can repeat across programs. The desk keys a row
  by `program + id`, so two programs may share an id (Q3) and the selection still names one row.
- `open` is new: Linear ranks "unstarted and in progress issues first" [l1]. A free `hint` string
  cannot rank, so the fact becomes a field. The deck's sketch leaves it out; the ranker needs it.
- `prefix` replaces the proposed `find: {word, noun}`. The chip shows the program's name. The
  group's heading ("Tickets") still needs a plural word; the build plan picks between a `noun`
  field and the program's name.
- Checked by reading against R5's sketch and today's `Command`
  (`apps/fabrika/src/window/frame.ts:137`), not by `tsc`.

## The ten principles

### Q1: a picker is five parts, and a program writes only its sources

**Decided 2026-11-07. Lean, 85%.** A law.

- **What it means.** A source hands rows, the desk ranks them, each row has an id, a row has
  actions, and a row may have a preview. A program writes `index`, `prefix` and `commands`, nothing
  else. The desk owns the box, the ranker, the keys and the stack. No program draws its own Cmd-K.
  `index(model)` is pure, so no program code runs per key.
- **Why.** Telescope: a `finder` "is a required field", and each row has an `ordinal` "used for
  sorting" [t1]. Emacs keeps UI, sources and actions in three packages that meet in one call [e1].
  Spotlight: apps "add items to the on-device index" [c1].
- **Linear as the builder.** One box fed by every part of the product. On our pieces the desk is
  that box, and each program feeds it through R5, so a new program is findable the day it ships,
  with no change to the box.
- **Elm.** `pick` is one model and one update (Q9), and `index` is a pure function like `view`.
- **Accessibility.** One box means one combobox to get right, once (Q10).
- **What holds it.** A law: every row in the box comes from a source. The box's own rows are only
  the Ask row (Q5) and the "All N" rows (Q2).
- **Doubt and cost.** A source that must be asked live (a web search, a git grep) does not fit a
  pure `index`. Consult's async sources [e3] would be a second kind; none is needed in Tier 2. About
  150 lines for the desk's index and pick's model.
- **Today: breaks.** One source, written into the frame (`apps/fabrika/src/window/frame.ts:168`).

### Q2: one box, Commands first, 5 per group

**Decided 2026-11-07. Lean, 70%.** A law, with taste on the 5.

- **What it means.** Empty, the box shows Commands (5) and Recent (5), the last things picked. Once
  you type, every source is a group in a fixed order: Commands, Tickets, Tiles, Traces, fabsh, Ask.
  Each group shows its top 5 and an "All 23 tickets" row that narrows the box to that program (Q4).
  Rows rank by a match at a word start, then open work, then newest. A narrowed box shows at most
  500 rows, as Linear does [l1].
- **Why.** Superhuman: Cmd-K is where "you can instantly do any action", and one score filters and
  sorts [s1]. Linear: open work first, "500 results maximum" [l1]. G1000: "the 25 nearest airports"
  before any typing [f2]. Vertico sorts by history [e1]. Toast's fixed order: "Groups with lower
  numbers appear before groups with higher numbers" [f3], so hands learn where Tickets sit.
- **Linear as the builder.** Linear shows recent issues before you type, and caps what it shows;
  Raycast's sections keep one line per row. We copy the cap and add a "show more" row per group.
- **Elm.** The ranking is a pure function of the query, the index and the pick history.
- **Accessibility.** Groups are `role="group"` with a name [w2], so a screen reader says "Tickets"
  on entering one. A fixed order is WCAG 3.2.3, consistent navigation.
- **What holds it.** A law: with no scope, no group shows more than its cap plus its "All N" row.
- **Doubt and cost.** 5 comes from design A's shots (smaller call 2); a day of use settles it.
  About 80 lines for the ranker.
- **Today: half.** Commands only, grouped (`apps/fabrika/src/window/frame.tsx:1014`), with no score
  (`frame.ts:198-203`). In round 1's shot of today's app, "test writer" finds nothing.

### Q3: an exact id goes on top

**Decided 2026-11-07. Lean, 75%.** A law.

- **What it means.** Every row has an id. Typing one exactly, in any case, puts that row above
  Commands. Ids look like `#193` (a ticket), `t1` (a tile), `split` (a command) and `#bug-17` (a
  room). The desk does this for every program from the rows' ids; no program writes it. Two
  programs may share an id, as a ticket and its trace share `#193`: both rows go on top, each under
  its own group. Exact means the whole text, never a part of it. A room name may group with `/`:
  `#tea-fabrika/` lists the rooms under it, such as `#tea-fabrika/pr/425`.
- **Why.** A number is a thing, not a word: Commands first is for words. Alfred keys a row by its
  `uid`, which "allows Alfred to learn about the item for subsequent sorting" [a1]. No source read
  puts an exact id first by rule; this part is ours.
- **Linear as the builder.** No Linear page read on ids. The summon note's rooms say `/` "groups for
  the eye and for Tab", and the names stay flat; the box follows that.
- **Elm.** One pure check in the ranker, the whole query against the whole id, before any score.
- **What holds it.** A property test: for any index and any id in it, typing that id puts every row
  with it above every other row.
- **Doubt and cost.** A room whose name starts with a digit (smaller call 1). About 20 lines.
- **Today: breaks.** Commands have no id; the box matches words in a name or tsh word
  (`apps/fabrika/src/window/frame.ts:198-203`).

### Q4: a prefix narrows the box

**Decided 2026-11-07. Lean, 70%.** A law.

- **What it means.** A program declares `prefix: "t"`. `t` and a space turn into a chip with the
  program's name, "tracker", and the box shows only its rows. Backspace on an empty box removes the
  chip. `?` lists every prefix. Symbols need no space: `@` people and agents (Q5), `>` fabsh (Q6),
  `?` help, `#` rooms. The "All 23 tickets" row and the prefix do the same thing.
- **Why.** Consult: "type `f SPC` in order to narrow to recent files" [e3]. Linear: `i p u t l f d`
  with a space [l1]. VS Code: "Type `?` ... to get a list of available commands" [v3]. Ableton: a
  typed word and a picked tag narrow together [f1].
- **Linear as the builder.** Linear's search prefixes, typed with a space. On our pieces the program
  declares its prefix, and the desk refuses two programs with one, as the keys file refuses a clash.
- **Elm.** Scope is a field of pick's model, a tagged union, never parsed again from the text.
- **Accessibility.** The chip is in the combobox's name ("Find tickets"), so it is read. 3.3.2: the
  placeholder names the prefixes ("Type, or t for tickets, @ for people and agents, > for fabsh, ?
  for more").
- **What holds it.** The load refuses a prefix two programs claim, a prefix that is a tsh word, and
  a prefix that is one of the four symbols.
- **Doubt and cost.** One letter per program runs out. Two letters, or the program's name, are the
  fallback. The word "prefix" already names `C-b` in the frame's glossary; that clash is listed
  there until it is settled. About 40 lines.
- **Today: breaks.** No scope.

### Q5: people and agents: `@` is one prefix, Ask is one row

**Decided 2026-11-07. Lean, 65%.** A law.

- **What it means.** `@` lists people and summoned agents. An agent answers now; a person answers
  later, in their inbox.
  - `@sc` filters, Tab completes `@scout`, and text after it asks scout in your direct message (DM)
    with it. The answer streams in the box.
  - `@` and a teammate's name, Tab, then text, is a direct message to a person: "Sent. They'll see
    it in their inbox." No instant reply is drawn.
  - `#bug-17` and Tab scope the box to a room. `@scout` inside it is a mention, and scout answers in
    `#bug-17`.
  - The plain Ask row, always last and in the same place, asks your default agent. Nothing is sent
    until you press it. The answer streams under it in its own group, and the rows above never
    move (Q7). Enter on the answer opens that talk in a tile beside, focused. Esc while it streams
    stops it.
- **Why.** Raycast's Quick AI asks "a one-off question from Root Search" [r4]. NN/g: past 1 s show
  work, past 10 s show progress and a way to stop [n2]. Ableton previews free samples on each arrow
  [f1]; an agent's answer is not free, so it waits for a press.
- **Linear as the builder.** No Linear answer read. Raycast's Quick AI moves the answer to its own
  view; we keep it under the row, so the rows above stay put.
- **Elm, OTP.** The ask is a Cmd; the answer arrives as Msgs to pick. pick monitors the run, as an
  OTP monitor would: Esc sends a cancel, and the run's end reaches pick as a Msg.
- **Accessibility.** Two polite messages, "Asking scout" when it starts and "Scout answered, 4
  lines" when it ends, never each token [w4].
- **What holds it.** G4: an ask carries the press's `via`. A law: typing never starts a run. A
  person's row never shows "answering".
- **Doubt and cost.** A person may want the agent to rank the rows, not only answer; that puts money
  and seconds on every key. A paragraph inside one option strains Q10; the screen reader run
  settles it. About 120 lines, Tier 5 with agents, and the rooms wait on the summon note.
- **Today: breaks.** No agent in the palette.

### Q6: fabsh is a source

**Decided 2026-11-07, the owner's call.** A law.

- **What it means.** Any command becomes a list source for the picker.
  - If what you type parses as a fabsh line, a "Run: <line>" row appears, ranked like any row, never
    forced first.
  - `>` makes the whole box a fabsh line, and Tab completes a program's name.
  - `|` at the end of a line that outputs rows, or Enter on it, turns the line into a chip, and the
    box fuzzy-finds its rows, as fzf does. Both work.
  - Then a program's name adds "Run: tracker | ticket".
  - A quoted stage is short for `pick "…"`: `>tracker | "stall"` runs `tracker | pick "stall"`, pick
    in a tile with "stall" typed (Q9).
- **Why.** fzf "consumes the input stream asynchronously", and `reload` swaps the list [z1][z2]. VS
  Code's `>` turns its box into the command palette [v3].
- **Linear as the builder.** No Linear answer. fzf filters any command's rows; VS Code's `>`
  switches the box to commands.
- **Elm.** fabsh's own parser reads the line, never a regex in pick, and the chip holds the parsed
  line. A Run row runs only on Enter (WCAG 3.2.2).
- **What holds it.** The Run row shows only when fabsh's parser accepts the line, its types
  included: a stage takes the rows the one before it gives, and pick passes the type through.
- **Doubt and cost.** The quoted stage is a new word in fabsh's grammar, which
  [fabsh grows into a language](./fabsh-grows-into-a-language.md) (proposed) has to take. About 80
  lines, after fabsh's parser exists in `next/`.
- **Today: breaks.** The palette runs only listed commands
  (`apps/fabrika/src/window/frame.tsx:1015-1020`); a typed line is tsh's alone.

### Q7: the selected row never moves

**Decided 2026-11-07. Lean, 85%.** A law, with a property test.

- **What it means.** The selection is a row id. Rows that arrive late (a program sends a new index,
  the trace's rows land, an agent answers) land below it or in their own group. Only typing resets
  it to the top match. If the selected row leaves, the next row down is selected. A streaming answer
  never moves it. Up and Down wrap.
- **Why.** Every tool had to add this as a setting: Telescope's `selection_strategy` "Determines how
  the cursor acts after each sort iteration" [t2]; fzf's `--track` [z1]; VS Code's
  `keepScrollPosition`, off by default [v1]. WCAG 3.2.2: input never causes a change on its own [w6].
- **Linear as the builder.** No Linear answer read. On our pieces the index is local (R5), so only
  an agent, a running program and a fabsh line add rows late.
- **Elm.** `selected: RowId | null` in the model; an index into the rows never is the state.
- **Accessibility.** `aria-activedescendant` points at the id [w1], so a screen reader is never told
  a different row is selected than the one it last read.
- **What holds it.** A property test: for any late batch of rows, the selected id and its place on
  screen before equal those after, unless a key was pressed.
- **Doubt and cost.** About 30 lines.
- **Today: half.** No row arrives late, but the selection is an index reset on every key
  (`apps/fabrika/src/window/frame.ts:921`).

### Q8: Enter acts, Cmd-K shows the rest, Esc goes back one

**Decided 2026-11-07. Lean, 75%.** A law. This is G5 inside the box.

- **What it means.** Enter does a row's first action: `open program location` for a thing, the
  command for a command. Cmd-Enter does the second. Cmd-K inside the box swaps the list to "Actions
  for #193", in the same box, even when the row has only one action: a press must visibly do
  something. The actions are the row's program's `commands` (G7), scoped to that row: Open, Comment,
  Close. The footer's "Actions" is a button that does the same. Esc pops one level: it stops a
  streaming answer, then leaves the actions, then removes the chip; at the top it closes the box,
  and focus goes back (popovers, layers L4). A click outside the box closes it too.
- **Why.** Raycast: Enter primary, Cmd-Enter secondary, Cmd-K "showing all available actions for
  the selected item", and "When a user presses `ESC`, we automatically pop" [r2][r3]. Raycast
  opens its panel for a row with one action too (said in the walk, 2026-11-07; no page read here
  says it). Embark: a "keyboard-based version of a right-click contextual menu" [e2]. G1000: pick
  the row, then Direct-to [f2].
- **Linear as the builder.** Raycast's action panel, but in the same box, not a floating panel.
  Linear's menu on a selected issue lists that issue's actions; on our pieces they are the row's
  program's `commands`, so nothing is written twice.
- **Elm, OTP.** The stack is a list in the model. No OTP answer.
- **Accessibility.** The actions list is the same combobox with a new name ("Actions for #193"), so
  focus never leaves the input [w1]; 2.1.2 holds because Esc always leaves [w5].
- **What holds it.** A law: Esc from any state reaches the closed box in at most one press per
  level (a streaming answer, each stack entry, the chip) plus one, and focus lands where it was
  before Cmd-K.
- **Doubt and cost.** Cmd-K inside Cmd-K reads oddly to a newcomer. Raycast ships it, and the footer
  shows it. In the prototype, Ctrl-K and Ctrl-Enter do all that Cmd-K and Cmd-Enter do, since the
  page that hosts it may take Cmd-K first; in the app Cmd-K is a binding like any other, so Ctrl-K
  is one more line in a person's keys file. About 100 lines.
- **Today: half.** Enter runs and Esc closes (`apps/fabrika/src/window/pop.tsx:563`); no actions,
  no stack.

### Q9: pick is one program

**Decided 2026-11-07. Lean, 60%.** A law.

- **What it means.** `pick` is a filter program: rows in, one row out, and the type passes through.
  - Cmd-K runs pick over the desk's index in the palette layer. The frame draws the Zag dialog
    shell; pick's view draws the inside. Nothing behind it dims.
  - `/` on the tracker, or typing `pick` yourself, runs it in a tile: `tracker | pick | ticket`. The
    tracker folds to a strip and pick takes its place. Picking a row pipes it on to `ticket`.
  - The ticket tile follows the selection. It is the only preview; the Cmd-K box has none.
  - pick sends exactly one row in v1; picking many rows comes later.
  - In a tile, Esc clears the box, then leaves, and the tracker keeps the picked row.
- **Why.** fzf "consumes the input stream asynchronously" and prints the picked row [z1]. Consult
  previews by default, beside the list [e3], as Telescope's previewer does [t1].
- **Linear as the builder.** No Linear answer: its menu is only a box. fzf in a shell; Telescope
  and Consult beside a live preview. Linear draws no dim behind its menu (popovers, from its
  public video).
- **Elm, OTP.** One model and one update, drawn in two places. In the palette the desk starts pick
  and it ends when the box closes; in a tile it is one process on the pipe.
- **What holds it.** One `pick` program in both places, and a test that the same rows and keys give
  the same picked row in the palette and in a tile.
- **Doubt and cost.** The palette is a layer and a tile is not, so one program in both may fight
  layers L4; the palette's pick is modal and a tile's is not. About 120 lines.
- **Today: breaks.** The palette is frame code (`apps/fabrika/src/window/pop.tsx:519`,
  `frame.tsx:1012`).

### Q10: the accessibility floor

**Decided 2026-11-07. Lean, 90%.** A law, plus a VoiceOver and NVDA run before it ships.

- **What it means.** One combobox, done once, so every source gets it free. The input keeps DOM
  focus and is a combobox; rows are options in a listbox, grouped with names;
  `aria-activedescendant` names the selected row's id [w1][w2]. The count is a polite status,
  said once after typing pauses ("23 tickets", "No results"), never inside `aria-hidden` [w4]. Every
  state has a word, never color alone (1.4.1). Esc always leaves (2.1.2); typing never runs anything
  (3.2.2). Focus goes back on close [w3]. A row's keys are in `aria-keyshortcuts`.
- **Why.** APG and WCAG as quoted; cmdk was tested with VoiceOver only [m3], so a second reader is
  on us.
- **Linear as the builder.** Linear's menu is a combobox. On our pieces the floor lives in pick, so
  every source gets it free (G7).
- **Elm.** The status words are a pure function of the model, so a test reads them.
- **What holds it.** The existing role tests (`apps/fabrika/src/window/pop.test.ts:334`) plus one for
  the live count; a VoiceOver and an NVDA run before the build ships.
- **Doubt and cost.** How long to wait before saying the count (smaller call 3). About 30 lines.
- **Today: half.** The combobox and focus back follow (`apps/fabrika/src/window/pop.tsx:550`,
  `:127-142`). The count sits in `aria-hidden` (`pop.tsx:159`, `:614`), so no one hears it.

## The smaller calls

The proposed note's four calls were folded into principles in the walk: is a picker a program on a
pipe became Q9; an exact match beats commands first became Q3; a preview became Q9's ticket tile,
with none in the Cmd-K box (it was lean A, 55%); and what the empty box shows became Q2. Three calls
stayed, each approved with its lean.

### 1. `#` and a digit is a ticket id; `#` and a letter is a room

```text
#193       a ticket's id: exact, on top (Q3)
#bug-17    a room: Tab scopes the box to it (Q5)
```

**Lean, 70%.** It keeps `#193` exact while `#bug-17` scopes. It costs one rule to learn. The doubt
is a room named with a digit first; the prototype does this today.

### 2. 5 rows per group

**Lean, 60%.** From design A's shots; a day of use settles it, and it is cheap to change.

### 3. Say the count 500 ms after typing stops

**Lean, 60%.** A guess; the VoiceOver and NVDA run sets it.

## What the ledger records

One fact per pick: `{_tag: "picked", query, scope, row, rank, via, sentAt}`, with the ledger's own
`arrivedAt`. If it is not recorded now, what people typed and what they took is lost, and a ranker
that learns (Alfred's `uid` [a1]) has nothing to learn from. The query is content a person may want
gone, so it stays deletable
([an agent run keeps its content](./an-agent-run-keeps-its-content.md)). A message sent from the box
is the summon note's fact, and a Run line is fabsh's; pick records only that it was picked.

## A tryout in today's version

Offered, not filed:

- The count in a polite live region instead of an `aria-hidden` footer: about 10 lines, under an
  agent hour (Q10).
- The selection kept by command name, not index: about 15 lines, under an agent hour (Q7).

## Where this differs from settled notes

- **R5's row gets two fields,** `id` and `open`, and a program gets `prefix`. R5 is decided; this
  changes its sketch, not its rule. R5's open question, one box for commands and things, is Q2.
- **The palette's `Over` type** in popovers (`{kind: "palette"; ... at: number}`) keeps an index;
  Q7 makes it a row id. Popovers is settled on looks, and this is behavior.
- **Popovers says the palette and the keys panel are one component.** That holds: the keys panel is
  pick with the commands scope and every key shown.
- **The prototype draws a dim behind the box** (its scrim, at 35% black). Popovers ruled the palette
  has no dim (the owner, 2026-11-06). The canvas is off, not the design.
- **"Prefix" already means `C-b`** in the frame's glossary. Q4 gives it a second meaning in the same
  context, so it is listed as an open clash in `.glossary/TERMS.md` until one of the two is renamed.
- **The summon note (PR 425, proposed)** owns rooms, mentions, direct messages and `/` in room
  names. If it changes them, Q5 and Q3's room rows follow it.

## What it costs

About 770 lines in `next/`'s desk and `pick`, 9 to 11 agent hours. Q1 to Q4 and Q7 to Q10, about 570
lines, are Tier 2. Q5 waits on agents in Tier 5 and on the summon note's rooms, about 120 lines. Q6
waits on fabsh's parser in `next/`, about 80 lines.

## What it cannot tell us

- The joined `pick` is not built in the app: agents, rooms, fabsh, actions, Recent and `/` have no
  app shot yet. Round 1's 74 shots are of the four separate designs.
- 5 rows per group, 500 at most and a 500 ms count delay are guesses or copied numbers, not ours.
- Whether one index ranks thousands of rows inside 0.1 s.
- How VoiceOver and NVDA read a streamed answer and an actions list.
- The prototype's tracker and ticket bodies are simpler than the app's, and its answers are canned:
  no model is called.
- A limit of the canvas, not the design: in Claude Design's Play mode, Esc leaves Play before the
  prototype sees it.
- Linear's command menu pages did not load, so its nested actions are from program guidelines'
  sources.

## Links

Tags are experiment 219's: [t1] [t2] Telescope, [r2] [r3] [r4] Raycast, [v1] [v3] VS Code, [z1] [z2]
fzf, [e1] [e2] [e3] Vertico, Embark, Consult, [l1] Linear search, [s1] Superhuman, [a1] Alfred,
[c1] Core Spotlight, [m3] cmdk, [w1] to [w6] APG and WCAG, [n2] NN/g, [f1] Ableton, [f2] G1000, [f3]
Toast.
