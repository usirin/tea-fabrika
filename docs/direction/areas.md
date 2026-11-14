---
state: "decided 2026-11-03, 2026-11-04 and 2026-11-07"
summary: "Today's version first. An area is a person's data on the project's ledger: made, renamed and merged in the app or tsh, never a list in the program, never read from folders; the app suggests, a person picks the first ones in the tracker's onboarding (A1, decided 2026-11-04). A ticket holds an area's number; its area is a guess (the filer's, or its source's through `from`) until a person picks, and the guess says so (A2, decided 2026-11-04). The list narrows by one filter with three doors, `--area`, the chip and `f`, plus view tabs, with \"No area yet\" one of its values (A3, decided 2026-11-03); grouping is a Display option (A4, decided 2026-11-03). Decided 2026-11-07: don't say the area twice (a guessed row keeps a small \"?\"), the picker is a menu, a saved view is a named filter; an area can be deleted as well as merged, its tickets going to \"No area yet\"; a guess may come from Judge (Jev), a project setting off by default. Round 3 of design B3 ships with two fixes: the status bar follows the filter, and the menu reads the ledger. From experiment 205."
---

# Areas: what an area is, and how the tracker narrows to one

**Decided 2026-11-07.** Every principle and smaller call is now decided; the owner's walks:

- **2026-11-03, the look:** design B3 is the default. The tracker's list narrows to one area by an
  `--area` flag, a filter chip, the `f` menu and view tabs. B1's grouping stays as a Display option
  of the same list.
- **2026-11-04, call 5, what an area is:** an area's definition is data in the project's ledger,
  made, renamed and merged in the app or tsh, as Linear labels or Jira components are. It is never
  a list in the program and never read from folders. The app suggests areas (from folders, pull
  request files, past tickets) but never sets one. Picking the first areas is a step of the
  tracker's onboarding. Which area a ticket is in stays a guess, shown as a guess, and a person's
  pick wins.
- **2026-11-04, ship it:** round 3 of B3 ships, with call 5 and two fixes: the status bar must not
  name an area filter that is not on, and the menu's area names come from the ledger, not a fixed
  list.

- **2026-11-07, the rest:** A5, A6 and A7 as leaned. An area can be deleted, and merging stays
  (call 2). A guess may come from a small classifier, a project setting that is off by default
  (call 6).

Its decided rules are in: [0356](../../.decisions/0356-an-area-is-a-persons-data.md),
[0357](../../.decisions/0357-an-area-is-a-guess-until-picked.md),
[0358](../../.decisions/0358-one-area-filter-many-doors.md),
[0359](../../.decisions/0359-areas-say-it-once-in-a-menu.md),
[0360](../../.decisions/0360-an-area-can-be-deleted.md),
[0361](../../.decisions/0361-a-tab-only-for-pinned-areas.md),
[0362](../../.decisions/0362-a-jobs-line-follows-the-filter.md),
[0363](../../.decisions/0363-a-judge-area-guess-is-off.md).

Built from [experiment 205](../../experiments/205-organizing-work.md), which read about 40 makers
and tools and built four designs and three rounds in today's tracker, and a Design canvas, "Area
guidelines", which is not published yet. Neither is a measurement. A tag such as `[l10]` points at
that experiment's links.

```ts
// A sketch, today's version. The project's areas: one stream, a person's facts only.
// tracker/areas/inbox
{_tag: "area_made", area: 1, name: "pipeline", suggested: {_tag: "titles", word: "lane", tickets: 21}}
{_tag: "area_made", area: 2, name: "app", suggested: {_tag: "folder", path: "apps/fabrika"}}
{_tag: "area_made", area: 3, name: "lane"}            // typed by the person; no suggestion
{_tag: "area_merged", area: 3, into: 1}               // every ticket in "lane" now reads "pipeline"
{_tag: "area_renamed", area: 2, name: "desk"}         // no ticket changes: tickets hold the number

// tracker/ticket/193/inbox. An agent filed it, for a person.
{type: "filed", title: "Test writer: a failed run on base loses its cause ...", body: "...",
 from: {_tag: "run", ticket: 117, run: "lane 7"}, guess: 3}
// areaOf(193)  {_tag: "guessed", area: 1, why: "filer"}   the guess said "lane", merged into 1
{type: "area_picked", area: 1}                          // a person; the door refuses an agent
// areaOf(193)  {_tag: "picked", area: 1}
```

```text
one sitting, traced (today's version, after the build; counts made up)
tracker          the ledger has no area yet: the list opens on its onboarding step
                 suggested: pipeline (21 titles start "Lane", "pipeline", ...), app (apps/fabrika), ...
Space, Enter     the person ticks three; three area_made facts, by the person
f                the Filter menu: the ledger's areas, then "No area yet"
j, Enter         filter {area: 1}: chip "Area is pipeline", the Pipeline tab fills
                 status bar job item: tracker --area pipeline | ticket
[                the All open tab: the chip goes; status bar: tracker | ticket      (fix 1)
Enter on #193    ticket tile: Area  pipeline?  a guess: the filer's   [Pick]
p, Enter         area_picked {area: 1}; the row and the ticket drop the "?"
```

## Which version

- **Today's version (`programs/tracker`, `programs/ticket`, `packages/pipeline`, `apps/fabrika`):**
  built first, in four pull requests. See [the build](#the-build-in-todays-version).
- **`next/`:** the same facts when its tracker is built, in a later tier. There every fact's case
  key is `_tag`, the ticket's facts too, and each entry also keeps `sentAt`, the writer's own clock (`said` until 2026-11-05).
  Nothing about areas is in `next/` yet.

## The shape

```ts
// A sketch, today's version, in Effect Schema. Ran on effect 4.1.1 with sample values (below).
const AreaNumber = Schema.Int.check(Schema.isGreaterThan(0)); // 1, 2, 3, in the order made
const AreaName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(32));

// What the app suggested, when the area came from a suggestion: what the person saw and took.
const Suggested = Schema.Union([
	Schema.TaggedStruct("folder", {path: Schema.String}),
	Schema.TaggedStruct("titles", {word: Schema.String, tickets: Schema.Int}),
]);

// The project's areas, on their own stream. A person writes all three.
const AreaFact = Schema.Union([
	Schema.TaggedStruct("area_made", {area: AreaNumber, name: AreaName, suggested: Schema.optionalKey(Suggested)}),
	Schema.TaggedStruct("area_renamed", {area: AreaNumber, name: AreaName}),
	Schema.TaggedStruct("area_merged", {area: AreaNumber, into: AreaNumber}),
	Schema.TaggedStruct("area_deleted", {area: AreaNumber}), // call 2, decided 2026-11-07
]);

// On the ticket's stream. They join today's `Fact` union, so they keep its `type` key.
// `filed` gains one optional key: the filer's guess, which only the filer knows, then.
Schema.Struct({type: Schema.Literal("filed"), title: Title, body: Body,
	from: Schema.optionalKey(From), guess: Schema.optionalKey(AreaNumber)});
Schema.Struct({type: Schema.Literal("area_picked"), area: Schema.NullOr(AreaNumber)}); // a person; null: no area

// The fold's answer. Nobody writes it; it rebuilds from the log.
const TicketArea = Schema.Union([
	Schema.TaggedStruct("picked", {area: Schema.NullOr(AreaNumber)}),        // the last pick wins
	Schema.TaggedStruct("guessed", {area: AreaNumber, why: Schema.Literals(["filer", "source", "judge"])}),
	Schema.TaggedStruct("none", {}),
]);
```

- **Who writes.** `area_made`, `area_renamed`, `area_merged` and `area_picked` join the door's
  `PERSON_KINDS` (`packages/fabrika/src/host/door.ts:118`), as `answered` and `duplicate_rated`
  are. An agent's session is refused at the door. `filed` stays anyone's, so an agent that files
  may write its `guess`.
- **`by` and `at`.** Each row keeps its writer (`by`, a person or an agent for a person) and the
  ledger's own time (`at`), as every ticket fact does today (`packages/pipeline/src/tickets/ticket.ts:481-489`).
  Today's rows have no writer's clock; `next/`'s keep it as `sentAt`.
- **A number, not a name.** A ticket holds the area's number, so a rename touches no ticket, and a
  merge moves every ticket at once, as Jira's delete "substitute[s]" another component [j2]. The
  name a ticket was guessed under stays in the log.
- **What the fold refuses,** into `problems`, as today's fold does: an `area_made` whose number is
  not the next one; a name already taken, ignoring case; a rename or merge of an area that does
  not exist or is merged already; a merge into itself. A pick or guess of a merged area reads its
  `into`, followed to the end.
- **The guess, in order.** A person's pick wins, even a pick of no area. Else the filer's `guess`.
  Else the area of its source: for `from: {_tag: "run", ticket}`, that ticket's area; for
  `from: {_tag: "pr", url}`, the area of the ticket whose `pr` fact names that pull request. Else
  none.

How it was checked: the schemas and a small `areasOf` and `areaOf` ran on effect 4.1.1 in a
scratch file, not kept. A merge of 3 into 1 read 1; a rename kept the number; a number out of
order and a taken name ("Pipeline" after "pipeline") went to `problems`; area 0, a name with a
leading space, and a ticket fact on the areas stream were refused. No type check of the whole
tracker ran.

## The seven principles

Kind: **law** (the test writer can check it), **lint** (`pnpm lint` can hold it) or **taste**
(only a shot beside Linear checks it).

### A1: an area is a person's data on the project's ledger

**Decided 2026-11-04 (call 5). Kind: law.**

- **What it means.** The list of areas is folded from the `tracker/areas` stream. A person makes,
  renames and merges areas, in the app or from tsh. The program holds no list, and no area is read
  from folders.
- **Why.** Jira: "You can change the component's name, lead, description, and default assignee",
  and a delete in use substitutes another component [j2]. Kubernetes keeps even its labels-as-code
  this way: "previous labels should be migrated to it" [g8]. A part of the code merges and splits,
  so the list must be cheap to change, by the person who knows (experiment 205, "What does not
  carry over").
- **Linear as the builder.** A label is workspace data, made in its settings or from the picker
  (Linear's labels page was 404 twice; **secondary**). On our pieces: the tracker owns the facts
  and the menu, tsh reaches the same inputs, and every view that filters reads the same fold.
- **Elm.** The areas are a field of the tracker's model, folded from a stream it subscribes to,
  as its tickets are.
- **What holds it.** The door's `PERSON_KINDS`; a law that the Filter menu's names equal
  `areasOf` of the stream, for any list of facts; no `AREAS` constant in the program.
- **Round 3 breaks it:** the menu's names are a fixed list (`AREAS` in experiment 205's
  `designs.patch`). That is fix 2.

### A2: a ticket's area is a guess until a person picks, and the guess says so

**Decided 2026-11-04 (call 5). Kind: law, and taste for the look.**

- **What it means.** The fold gives `picked`, `guessed` or `none`. A guess shows as a guess, with
  why ("the filer's", "its source's"), on the ticket and in the row. A person's pick wins over
  every guess, and the app never writes a pick.
- **Why.** Linear's triage intelligence: "Accept, decline, or view more information about why a
  suggestion was made before making a decision" [l6b]. The makers name the area at filing, by the
  filer [o2], and a follow-up takes its source's place [o4].
- **Linear as the builder.** Suggestions sit beside the real value and a person takes them. Ours
  differs: the guess is shown in place of the empty value, marked, since most of our tickets are
  filed by an agent and a blank area would hide them all in "No area yet".
- **Elm.** `areaOf` is a pure function of the ticket's timeline and the areas. Picking sends one
  Msg, which writes one fact.
- **Accessibility.** The mark is a word or a sign, never color alone (WCAG 1.4.1). The row's
  accessible name says "a guess". A screen reader run is owed.
- **What holds it.** A law over generated timelines: any `area_picked` decides; else `guess`; else
  the source; else `none`. The door refuses `area_picked` from an agent.
- **Round 3, half:** the ticket says "pipeline, the filer's guess"; a row does not mark it, and
  nothing can pick.

### A3: narrowing is one filter with three doors, and "No area yet" is one of its values

**Decided 2026-11-03 (B3), for the doors. "No area yet": lean, 80%. Kind: law.**

- **What it means.** `tracker --area pipeline`, the chip "Area is pipeline", the `f` menu and a
  view tab all set one field, `area`, in the tracker's model. `--area none` and the "No area yet"
  tab are the same filter's value for tickets the fold gives `none` (or a pick of no area). The
  status bar's line follows the filter (fix 1).
- **Why.** Linear: "Open the filter menu or type `F` shortcut to choose the criteria you want to
  apply" [l10]. Linear's own "no labels" takes several presses [l10]; ours is one, since agent-filed
  tickets with no area are what triage must see.
- **Linear as the builder.** Linear's URL holds the filter. Ours is the tsh line, so the line in the
  status bar must say the filter that is on.
- **Elm.** One Msg, one field. The flag, the chip, the key and the tab all send it.
- **Accessibility.** The chip's remove is a button named "Remove filter: area is pipeline" (WCAG
  2.1.1, 4.1.2).
- **What holds it.** A law: for every area and every list, the four doors give the same rows.
- **Round 3 follows,** except that the status bar shows the typed line on "All open" and "No area
  yet" (experiment 205, `shots/r3-dark/all-open-one.jpg`).

### A4: grouping is a Display option of the same list

**Decided 2026-11-03 (B1 as an option). Kind: law for the headings, taste for the look.**

- **What it means.** Display, then "Group by area", groups the filtered list. Each group has a
  heading with a fold button; "Fold all" and "Unfold all" sit under it.
- **Why.** Linear: "No grouping removes all categorization and is especially useful when applying
  ordering and filters" [l11].
- **Elm.** Grouping is a view over the same rows. Folds are model state, a set of area numbers.
  Today a zoom rebuilds the window and drops them (tracker ticket 197).
- **Accessibility.** A heading is an `h3` with a button inside that says `aria-expanded` (WCAG
  1.3.1, 4.1.2).
- **What holds it.** A law that grouped and ungrouped views hold the same tickets, and a render test
  for the heading's roles.
- **Round 3 follows.**

### A5: don't say it twice

**Decided 2026-11-07, as leaned. Kind: taste.** Round 3, which the owner said yes to, follows it.

- **What it means.** A row drops the area word when the view already names the area. On "All open"
  each row says its area.
- **Why.** Linear: "Choose what issue properties are displayed on individual issues on lists or
  the board" [l11]; Linear leaves it to the person, we decide it by the view.
- **Doubt.** The "?" of a guess lived on that word. Under the Pipeline view a guessed row loses it.
  Decided: a guessed row keeps a small "?" where the area word was dropped. A shot still checks
  the look.
- **B3 as first built broke it:** 21 rows said "Pipeline" under the Pipeline view.

### A6: picking an area is a menu, not a program, until areas have a job of their own

**Decided 2026-11-07, as leaned. Kind: taste.**

- **What it means.** The area menu lives in the tracker. No `areas` program on a pipe.
- **Why.** Program guidelines G1, one job per program
  ([program guidelines](./program-guidelines.md)). B2's `areas` tile cost a tile at 2x2 and at
  1024x700 and gave a list of names.
- **Doubt.** Call 5 gives areas a job: make, rename, merge. If that grows (an owner per area, a
  description, suggestions to review), an `areas` program may earn its place. Settled by a week of
  use after the build.
- **Round 3 follows.**

### A7: a saved view is a named filter, never a title search

**Decided 2026-11-07, as leaned. Kind: law.**

- **What it means.** A view tab sets the same filter as the chip it shows. No view matches title
  words.
- **Why.** Design C's view found 28 tickets by title words where the area found 21 (on made-up
  guesses): a match nobody can check.
- **Elm.** A view is data, `{name, filter}`; opening it sends the same Msg as the `f` menu.
- **Accessibility.** The current tab is filled and weight 500, and says `aria-selected` or
  `aria-pressed`; never color alone.
- **What holds it.** The law of A3 covers the tab door.
- **Round 3 follows,** on a made-up list of tabs (call 4 below).

## The smaller calls

### 1. Where make, rename and merge live

```text
tsh       tracker takes make_area {name}, rename_area {area, name}, merge_area {area, into}
window    the f menu: each area row takes r (rename) and m (merge into ...); the last row is "New area ..."
```

**Decided 2026-11-04 by the owner: both.** The tsh inputs are the program's inputs, so they exist
anyway. The menu is where a person already looks. Keys inside a menu row are new here; a sheet
over the tile ([layers](./layers.md), L2) was the other way.

### 2. An area can be deleted, and merged

```ts
// A sketch, today's version. One more person fact on tracker/areas.
Schema.TaggedStruct("area_deleted", {area: AreaNumber})
// areaOf(193) before: {_tag: "picked", area: 1}; after area_deleted {area: 1}: {_tag: "none"}
```

```text
f menu row   d on Pipeline   Delete Pipeline? 21 tickets go to No area yet.   [Delete] [Cancel]
```

**Decided 2026-11-07 by the owner.** **Changed 2026-11-07:** the lean was "never deleted, only
merged". Now both stay, as Jira's delete offers "substitute" or "remove ... from all issues" [j2].
A ticket needs no area, since "No area yet" is a normal value (A3), so deleting moves its tickets
there. The menu row asks first, with the count. The ledger keeps the `area_deleted` fact, so
history still shows a ticket's old area, and the fold maps a deleted area's tickets, picked or
guessed, to `none`. The fold refuses a delete of an area that does not exist, is merged or is
deleted already, and a merge into a deleted area.

### 3. How a guess looks

```text
row        Pipeline?          accessible name: "area pipeline, a guess: the filer's"
ticket     Area  pipeline?  a guess: the filer's   [Pick]
```

**Decided 2026-11-04 by the owner.** A "?" is a shape cue, not color, and it goes once a person
picks. Still to check in the build's shots: noise on a list where most rows are guesses.

### 4. Which areas get a view tab

**Decided 2026-11-04 by the owner, against the lean.** A tab only for an area a person pinned:
All open, the pinned areas, then "No area yet". Every other area is reached through the `f`
filter. Pins are each person's own, as Linear's favorites are, so nobody's tabs change because
someone else pinned. Two person facts, `area_pinned {area}` and `area_unpinned {area}`; the
ledger's `by` says whose, and the tracker folds only the reader's. "Pin as tab" and "Unpin" sit
on an `f` menu row. The lean was every area while the row fits, which lets ledger order decide
what a person sees.

### 5. The status bar's line follows the filter (fix 1)

```text
a   the tracker tells the host its line as the filter changes; the job item shows that line
b   the job item keeps the typed line, as tsh's jobs table does; only the tab row shows the filter
```

**Decided 2026-11-04 by the owner: a.** The line is our URL (A3). It changes what tsh's `jobs`
prints: a job's line means how to get back to where it is now, not what was typed. The job item
is the frame's, and the frame note leaves it to nobody yet ([the frame](./the-frame.md)).

### 6. A guess may come from a small classifier, off by default

```toml
# the project's settings
[areas]
guess = "off"   # or "jev": costs money and sends titles and file paths to Jev
```

```ts
// A sketch. The pipeline's Judge primitive answers one narrow question.
// in:  {title, files?: string[], areas: [{area, name}]}   files: a pull request's, when there is one
// out: {_tag: "area", area: 1} | {_tag: "dont_know"}
// areaOf(193)  {_tag: "guessed", area: 1, why: "judge"}   still a "?" until a person picks
```

**Decided 2026-11-07 by the owner.** **Changed 2026-11-07:** the lean was no files guess in v0.
Now a guess may come from Judge (Jev), given the ticket's title, a pull request's changed files
when there is one, and the project's areas. Its answer is still a guess with "?" (A2) until a
person picks. It is a project-level setting, off by default. Before it is ever on by default, it is
measured on this repo's tickets against the areas people picked. With it off, v0 guesses from the
filer and the source only, as before.

### 7. The onboarding step

When the ledger has no area, the tracker's window opens on a list of suggestions, each with why
("21 titles start with Lane", "the folder `apps/fabrika`"). Space ticks, Enter makes the ticked
ones, Esc skips. Skipping leaves every ticket in "No area yet", and "New area ..." stays in the
menu. **Decided 2026-11-04 by the owner: a checklist in the list page.** The skip is window
state on the person's desk, not a fact.

As built in PR 1 (today's version): the desk keeps no window state for a program yet, so PR 1
holds the skip in the tracker machine's own state, `skip_onboarding`, until the desk keeps window
state. Tracker ticket 217 tracks that. Until then the skip lasts while that tracker runs, every
window on it agrees, and a new tracker asks again. The
step shows only when the ledger holds a ticket, since with none there is nothing to sort. A
"type a name" box sits under the suggestions (the lead's call, 2026-11-04). The folders come from
one GitHub call per connected repository, the first time the step shows; if it fails, the titles'
suggestions stay and nothing is said.

On this repository's own 15 top folders and 13 real pull request titles filed as tickets, the
shots (`programs/tracker/docs/areas/`) show 14 suggestions: 2 from titles, 12 from folders. At
1440 by 900 in one tile the whole step fits above the list. In a stacked pipe, a 2x2 or a 1024 by
700 window it is taller than the tile, so its buttons stick to the tile's bottom edge and the rows
scroll past under them, in the view's one scroll (no box in a view scrolls on its own). The list
stays out of sight until the step goes. Once areas are made, the tracker's status line names them:
`13 open, 0 closed; areas: direction, pipeline, desk`. The app's `jobs` does not print that line
today, so on screen PR 1 still shows no area anywhere.

## What the ledger records

| Fact | Lost if not written now? |
|---|---|
| `guess` on `filed` | **Yes.** Only the filer knows its guess at filing. |
| `suggested` on `area_made` | **Yes.** What the person saw and took exists only at that moment. |
| `area_picked`, with its `by` and `at` | Yes: who placed a ticket, and when. |
| `area_renamed`, `area_merged`, `area_deleted` | Yes: the old names, so old tickets and old talk still read. |
| A ticket's area | No: a fold, it rebuilds from the log. |

## The build in today's version

Four pull requests, in the order the owner sees them: (1) areas on the ledger, with tsh inputs and
the onboarding step; (2) a ticket's area, guessed and picked, on the ticket; (3) the list by area,
round 3 of B3, with both fixes; (4) group by area as a Display option. Each goes through the
pipeline's steps. The plan carries the files, the tests and the shots.

## Where this differs from settled notes

- **[Tracker views are programs](./tracker-views-are-programs.md)** sketches labels as one
  `labeled` fact, a person's only. An area is not a label in a group: it is one per ticket, it
  carries a guess, and it merges by number. The person-only rule is kept.
- **Experiment 205's phase 1** leaned toward an area folded from code paths (shape D, and the
  designs' working shape). Call 5 overrules it: never read from folders.
- **[A ticket says where it came from](./a-ticket-says-where-it-came-from.md)** said area waits for
  this study. `from` now feeds the source guess. Its shape is still the plan's (tracker ticket 196,
  [PR 366](https://github.com/usirin/tea-fabrika/pull/366)).
- **[Sort answers yes or no](./sort-answers-yes-or-no.md)** holds: no stage reads an area, and an
  area never routes or gates a build.

## What it costs

About 1,950 lines with tests over four pull requests, and about 13 agent hours with the steps (a
guess, from the design branch's size less its made-up table and its `areas` program, plus the
laws and the shots). One new stream, four new person kinds at the door, one new key on `filed`.

## Made up here

`tracker/areas`, `AreaNumber`, `AreaName`, `AreaFact`, `area_made`, `area_renamed`, `area_merged`, `area_deleted`, the `d` key, `[areas] guess`, `dont_know`, the `judge` why,
`suggested` and its two cases, `guess`, `area_picked`, `TicketArea` and its cases, `areasOf`,
`areaOf`, the inputs `make_area`, `rename_area`, `merge_area`, the `p` key, the "?" mark, the
onboarding words, and every count in the trace.

## What it cannot tell us

- Whether a "?" on most rows is calm or noisy. Only a shot of the build shows it.
- Whether the filer's guess is often right. No agent has filed with a `guess` yet.
- Whether the Judge guess is right often enough to be on by default. Not measured yet.
- Whether the owner filters by area day to day. One person pressed a draft; a week of use answers it.
- Whether the onboarding suggestions are good. PR 1 built them; on this repository most are
  folders, and whether a person wants twelve folder rows is not known until one uses it.
- No screen reader run: the menus, the group headings and a row's "a guess" need VoiceOver.
- The shape ran only as a scratch fold; the tracker's own fold and door were not changed.
