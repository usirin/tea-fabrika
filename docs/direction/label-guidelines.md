---
state: "decided 2026-11-06"
summary: "`next/`'s tracker; today's areas unchanged. A label is a person's word for finding work, and six principles say when something must be its own field or fact: nothing decides on a label (L1); state that moves is a fold, never a label (L2); a typed value (a person, ticket, date, number, ordered level) is a field or a link (L3); pick-one is a group fixed at making, and the fold refuses two (L4); a label is a number with a name, people make, rename, merge and apply it, an agent only guesses at filing (L5); a label that grows an owner or a rule graduates to its own concept, keeping its numbers (L6). Area is the first label group, pick-one and guessable, not its own concept. D1 (the label menu in the ticket, Manti's `Combobox` in a `Popover`) and D4 (chips plus a tsh line) are built first; D2, bulk accept of guesses, is the second slice. From experiment 218, with kamp-us/phoenix's labels as the evidence."
---

# Label guidelines: when something is a label, and when it is its own field or fact

**Decided 2026-11-06.** The owner approved the six principles, the shape and the smaller calls
below with their leans, after a walk of each part. The leans' confidence numbers stay as written.
It builds on points the owner decided earlier, each named where it is used:

- **2026-10-21:** labels never gate a build; the approved plan is the only go
  ([sort answers yes or no](./sort-answers-yes-or-no.md)).
- **2026-11-04, areas call 5:** an area is a person's data on the ledger, made, renamed and merged,
  never read from folders; a ticket's area is a guess until a person picks
  ([areas](./areas.md), A1 and A2).
- **2026-11-06:** status, done included, is a fold of facts, and `moved` cannot spell done
  ([tracker views are programs](./tracker-views-are-programs.md)).
- **2026-11-06:** a person is the assignee and their agent the delegate; whose turn it is is a fold
  of asks and answers ([a ticket runs from the app](./a-ticket-runs-from-the-app.md)).

Its decided rules are in: [0364](../../.decisions/0364-nothing-decides-on-a-label.md),
[0365](../../.decisions/0365-pick-one-groups-never-change.md),
[0366](../../.decisions/0366-a-label-is-the-projects-number.md),
[0367](../../.decisions/0367-a-label-that-acts-graduates.md),
[0368](../../.decisions/0368-area-is-the-first-label-group.md),
[0369](../../.decisions/0369-no-kind-label-ships-or-routes.md),
[0370](../../.decisions/0370-a-follow-up-inherits-only-guesses.md),
[0371](../../.decisions/0371-the-label-menu-comes-first.md).

Built from [experiment 218](../../experiments/218-label-guidelines.md), which read about 20
makers and counted labels on the 3,000 newest issues of kamp-us/phoenix, and a Design canvas,
"Label guidelines", not drawn yet. Neither is a measurement. A tag such as `[l1]` points at that
experiment's links.

```ts
// A sketch, next/. The project's labels: one stream, a person's facts only.
// tracker/labels
{_tag: "group_made", group: 1, name: "Area", pick: "one", guess: true}
{_tag: "label_made", label: 1, name: "pipeline", group: 1, suggested: {_tag: "titles", word: "lane", tickets: 21}}
{_tag: "label_made", label: 2, name: "desk", group: 1}
{_tag: "label_made", label: 3, name: "flaky"}                 // no group: any number per ticket
{_tag: "label_made", label: 4, name: "lane", group: 1}
{_tag: "label_merged", label: 4, into: 1}                     // every ticket on "lane" now reads "pipeline"

// tracker/ticket/193. An agent filed it, for a person.
{_tag: "filed", title: "Test writer: a failed run on base loses its cause", body: "...",
 from: {_tag: "run", ticket: 117, run: "lane 7"}, guess: [4]}
// TicketLabels.fromTimeline(193)  {area: {_tag: "guessed", label: 1, why: "filer"}, others: []}
{_tag: "labeled", add: [1, 3], drop: []}                     // a person; the door refuses an agent
// TicketLabels.fromTimeline(193)  {area: {_tag: "picked", label: 1}, others: [3]}
{_tag: "labeled", add: [2], drop: []}                        // refused into problems: two in a pick-one group
```

```text
one sitting, traced (next/, after the build; counts made up)
tracker               193 shows "pipeline?" in its row: the filer guessed "lane", merged into pipeline
Enter on #193         the ticket tile; Labels row: Area pipeline? (the filer's), no other labels
l                     the label menu: Area as a radio list (pipeline marked "guess"), then flaky, stale, ...
Space on pipeline     the guess becomes a pick
Space on flaky        a checkbox: flaky added
Enter                 one labeled {add: [1, 3], drop: []}, by the person, for nobody else
                      the row loses its "?"; the status, the delegate and the turn did not change
```

## Which version

- **`next/`:** what this note is for. Its tracker is not built. Every shape here is a sketch for
  it, with `_tag`, `by`, `arrivedAt` and `sentAt` on every entry, as `next/`'s ledger keeps them.
- **Today's version:** nothing changes. Its areas are on main
  ([PR 377](https://github.com/usirin/tea-fabrika/pull/377), `packages/pipeline/src/tickets/area.ts`)
  as their own stream; they already follow L1, L4 and L5. When `next/` takes the tracker over,
  each area becomes a label in the Area group with the same number, and that pull request deletes
  today's area code ([rethink, do not port](./rethink-do-not-port.md)).

## The shape

```ts
// A sketch, next/, in Effect Schema. Not run: shaped on today's area.ts, which ran.
const LabelNumber = Schema.Int.check(Schema.isGreaterThan(0));
const GroupNumber = Schema.Int.check(Schema.isGreaterThan(0));
const LabelName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(32));

// tracker/labels. A person writes every one; the door refuses an agent.
const LabelFact = Schema.TaggedUnion({
	group_made: {group: GroupNumber, name: LabelName, pick: Schema.Literals(["one", "many"]), guess: Schema.Boolean},
	group_renamed: {group: GroupNumber, name: LabelName},
	label_made: {label: LabelNumber, name: LabelName, group: Schema.optionalKey(GroupNumber), suggested: Schema.optionalKey(Suggested)},
	label_renamed: {label: LabelNumber, name: LabelName},
	label_merged: {label: LabelNumber, into: LabelNumber},
	label_archived: {label: LabelNumber},
});

// On the ticket's stream.
// filed gains `guess: Array<LabelNumber>`, the filer's, any writer.
// labeled {add: Array<LabelNumber>, drop: Array<LabelNumber>}, a person.

// The fold's answer per pick-one group. Nobody writes it.
const Pick = Schema.TaggedUnion({
	picked: {label: Schema.NullOr(LabelNumber)},
	guessed: {label: LabelNumber, why: Schema.Literals(["filer", "source"])},
	none: {},
});
```

- **`pick` is fixed when the group is made.** No `group_repicked`: changing one to many would
  make old picks mean something else. A person makes a new group and merges labels across.
- **What the fold refuses,** into `problems`: a `labeled` that would leave two labels of a
  pick-one group on a ticket (the writer names the old one in `drop`, so the fact says what the
  person did); a label number not made yet; a merge into itself, into another group, or into a
  merged label; a name taken in its group, ignoring case.
- **A guess** applies only to groups made with `guess: true`. A pick wins over every guess, even
  a pick of none. Else the filer's `guess`. Else the source's pick in that group, through `from`.
- **Archive, not delete.** An archived label stays on its tickets and leaves the menu, as Linear
  and Shortcut do [l2] [s1]. GitHub's delete removes it from every issue [g1], which loses data.
  **Changed 2026-11-07:** for areas, today's version, a delete is decided too. It moves the
  area's tickets to "No area yet" and keeps an `area_deleted` fact, so no history is lost
  ([areas](./areas.md), call 2).

## The six principles

Kind: **law** (the test writer can check it), **lint** (`pnpm lint` can hold it) or **taste**
(only a shot beside Linear checks it).

### L1: nothing decides on a label

**Decided 2026-11-06** (lean was 90%). **Kind: law and lint.** Builds the decided "labels never gate a build".

- **What it means.** No step, gate, lane, turn, notification or sort order branches on a label. A
  label is for people to find, filter and group work. If code needs to branch on a thing, the
  thing is a fact with its own type.
- **Why.** Kubernetes: labels "do not directly imply semantics to the core system" [k1]. On
  phoenix, `ready-for:agent` was what the build read, and a ruled decision stayed at
  `ready-for:human` with no way back but a hand relabel
  ([#5842](https://github.com/kamp-us/phoenix/issues/5842)). Experiment 85 found
  the lane read one label and ignored four.
- **Linear as the builder.** The tracker owns labels; filters, grouping and views read them. No
  pipeline program subscribes to the labels stream. Linear's workflow moves on status (a guess
  from use, not from a page read).
- **Elm.** Labels are model data the `view` reads. No `update` outside the tracker sees them.
- **What holds it.** A lint rule: no pipeline step module imports the labels fold. A law: a step's
  answer is the same for a timeline with every `labeled` removed.
- **Doubt.** A pack (on-call, say) may want to read a label. Settled when one asks; the answer
  then is L6, a field it owns.
- **Today's example:** phoenix #7727 breaks it (`ready-for:agent` routed the build).

### L2: state that moves is a fold, never a label

**Decided 2026-11-06** (lean was 90%). **Kind: law.** Builds the decided status and turn folds.

- **What it means.** If a value changes because work moved (status, done, whose turn, claimed,
  blocked, waiting on a person, a planning lock), it is folded from the facts that moved it. The
  test: would it go stale if nobody touched it? Then it is not a label.
- **Why.** On phoenix, 1,463 of the 2,158 closed issues read still say `status:triaged`,
  `ready-for:agent` or `status:needs-triage`. Notion makes status its own property [n1];
  Kubernetes keeps state in `status`, "the most recent observations of actual state" [k2]; Gmail
  reserves `SENT` and `DRAFT` so no hand can set them [m2].
- **Linear as the builder.** Status is its own property with its own workflow; labels sit beside
  it and never move it.
- **Elm.** A pure fold of the timeline, as the tracker's `Column` is.
- **Accessibility.** State shows as words in the status line, never as a label's color (WCAG
  1.4.1).
- **What holds it.** The ledger has no label-shaped fact for any state; the status and turn laws
  in tracker views already cover the folds.
- **Today's example:** #7727 breaks it twice; it closed on 2026-09-10 and still says triaged and
  ready for an agent.

### L3: a typed value is a field or a link

**Decided 2026-11-06** (lean was 85%). **Kind: law.**

- **What it means.** A person, a ticket, a pull request, a date, a number, or a level with an
  order is its own fact: `assigned`, `nested`, `related`, `linked`, `due`, `prioritized`. A label
  value comes from a short, closed list of words.
- **Why.** GitHub, about labels like `priority/p0`: "no types, no validation, no consistency across
  repositories, and no way to report on them" [g2]. Prometheus: never "user IDs, email addresses,
  or other unbounded sets of values" [p1]. Phoenix needed a decision ticket for a stray `p3`
  ([#2413](https://github.com/kamp-us/phoenix/issues/2413)) and code at two writers to hold
  `p0`, `p1`, `p2` ([#2616](https://github.com/kamp-us/phoenix/issues/2616)).
- **Linear as the builder.** Priority, estimate, due date, assignee and relations are each their
  own property with their own picker. Same here.
- **Elm.** Each is its own case of the ticket's `Fact` union; the schema is the check.
- **What holds it.** The schema: `prioritized {level}` takes one of four levels, so a fifth cannot
  be written.
- **Which facts are decided.** Only `linked`, `nested`, `moved`, `assigned` and `delegated` are
  decided facts. `related`, `due` and `prioritized` are examples here, decided when the tracker
  slice that adds each one is planned.
- **Doubt.** Priority as a field is the lean for that slice, not decided now. If the owner then
  wants priority as a pick-one group, L3 says no because it is ordered and sorts. 85%.
- **Today's example:** #7727's `p1` breaks it.

### L4: pick-one is a group, and the fold holds it

**Decided 2026-11-06** (lean was 80%). **Kind: law, and taste for the menu.**

- **What it means.** A group is made as `one` or `many`, and never changes. A ticket has at most
  one label per `one` group. The fold refuses a fact that would leave two, so no writer's care is
  needed. Labels outside any group are `many`.
- **Why.** Linear: "only one label from each group may be applied" [l1]. Kubernetes: "Each Key must
  be unique for a given object" [k1]. Library facets are "mutually exclusive" [x2]. On phoenix the
  bag let two priorities sit on one issue ([#3771](https://github.com/kamp-us/phoenix/issues/3771)),
  and 35 issues had two homes ([#9075](https://github.com/kamp-us/phoenix/issues/9075)).
- **Linear as the builder.** One label menu, groups as sections. Picking in a one-group replaces.
  Pick-many is a toggle: a click adds, a second click removes. A D1 reshoot of the real app
  confirmed both: a second pick replaced the area and left the pick-many labels alone.
- **Elm.** The menu sends one Msg; the tracker writes one `labeled` with the replaced label in
  `drop`.
- **Accessibility.** A one-group is a radio group, a many-group checkboxes, each with its name
  (WCAG 4.1.2, 1.3.1).
- **What holds it.** A law over generated timelines: for every one-group, `TicketLabels.fromTimeline` gives at most
  one label.
- **Fixes for the build,** two look oddities the D1 reshoot found. The reopened menu highlights
  the picked item, but the first ↓ jumps past it. After a swap the menu shifts left, because the
  shorter chip moves the Labels button it is anchored to.
- **Today's example:** today's areas follow it (one area per ticket); #7727 breaks it.

### L5: a label is a number with a name; people make it, agents guess

**Decided 2026-11-06** (lean was 80%). **Kind: law for the door, taste for "few".** Extends decided A1 and A2 to every label.

- **What it means.** A ticket holds a label's number, so a rename touches no ticket and a merge
  moves every ticket at once. A person makes, renames, merges, archives and applies labels. An
  agent may write a `guess` when it files, for groups made guessable; it never applies one. The
  list stays short: a label nobody used in a long while is offered for archive (a later call).
- **Why.** Phoenix: 59 labels, 27 on any of the 3,000 newest issues, two spellings of one
  (`wayfinder:map`, `wayfinding:map`), one named `1`, and no record of whether an agent or a
  person wrote any of them ([#4780](https://github.com/kamp-us/phoenix/issues/4780)). Free text
  makes people "add it as a new one" [j2]. Kubernetes moves items to a renamed label rather than
  lose them (experiment 205, [g8]). Shirky's controlled lists work with "Coordinated users" and a
  "Small corpus" [x1], which is two people on one project. Hospitals cut wristband colors and
  printed the word, after one color meant two things [x3].
- **Linear as the builder.** Labels made in settings or from the picker; triage suggests labels,
  a person accepts [l3]. Ours keeps make in the menu, as areas call 1 decided.
- **Elm.** The labels stream is a subscription of the tracker; `TicketLabels.fromTimeline` is pure, as tracker views'
  `Column.fromTimeline` is.
- **Accessibility.** A label's color is never the only cue; its name is always shown (WCAG 1.4.1),
  and text on a colored fill meets 4.5:1 (WCAG 1.4.3).
- **What holds it.** The door's person kinds gain the six label facts and `labeled`; a law that
  a rename changes no ticket's labels and a merge moves all of them.
- **Today's example:** today's areas follow it (`packages/pipeline/src/tickets/area.ts:54-60`).

### L6: a label that grows behavior graduates to its own concept

**Decided 2026-11-06** (lean was 70%). **Kind: taste for when, law for the carry-over.**

- **What it means.** The day a group needs an owner, a default assignee, a strategy, a date or a
  rule that acts, it stops being labels. It becomes its own facts, and its labels keep their
  numbers so no ticket moves.
- **Why.** Jira's components have "component owners" and "auto-assign" [j1]; its labels have
  neither. GitHub moved priority and dates out of labels into typed fields [g2]. Shortcut keeps
  its structured values in admin-made fields [s1].
- **Linear as the builder.** No Linear answer: Linear puts ownership on teams, not on labels. We
  have no team; Jira's component is the model.
- **OTP.** As `code_change` moves a process's state to a new shape without stopping it, the
  graduation is one fold that reads old label facts into the new concept's state.
- **Doubt.** [Pipeline strategies](./pipeline-strategies.md) asks whether a strategy belongs to
  the area. A yes graduates Area on day one, and then areas' own shape was right.
- **Today's example:** nothing has graduated; phoenix's `axis:` labels are the reverse, milestones
  that were demoted to labels and then fought them (#9075).

## The smaller calls

### 1. Is an area its own concept or the first label group?

```text
a  its own concept: area_made, area_picked, its own menu, filter and tsh inputs (areas' proposed shape)
b  the first label group: group_made {name: "Area", pick: "one", guess: true}; the tracker ships it
```

**Decided 2026-11-06: b, Area is the first label group** (lean was 65%). Labels are coming (`labeled` is in tracker views' sketch), and two systems would
double make, rename, merge, pickers and filter doors for one act
([reuse before special rules](../../.decisions/0421-reuse-before-special-rules.md)). Area's best parts (numbers,
merge, the guess) are what phoenix's labels lacked, so every label gets them. Linear does it this
way [l1]; Jira and Shortcut do not [j1] [s1]. The doubt: an area may need an owner or a strategy
(L6), and the glossary already says an area has an owner, which no decided note gives it. Since
numbers carry over, a later graduation moves no ticket. What would settle it: the pipeline
strategies call.

### 2. `--area` stays as a short form

```text
tracker --area pipeline          the short form, for the group the tracker ships
tracker --label area=pipeline    the general form, any group; --label flaky for a groupless one
```

**Decided 2026-11-06** (lean was 60%): keep both. Areas' A3 decided `--area` as one of three doors; it stays, as the Area
group's name.

### 3. Does a kind group (bug, feature, chore) ship?

**Decided 2026-11-06: no** (lean was 60%). Sort's rule keeps kind labels out of the ledger for routing; a person may still make
a "Kind" group for finding work (L1 keeps it from routing). Experiment 205 said the same. The
tracker ships Area only.

### 4. Does a follow-up inherit labels?

**Decided 2026-11-06** (lean was 70%): only guessable groups, and only as a guess
(`why: "source"`). Other labels are the
person's words about that ticket, not its source's.

### 5. Who sees a label

**Decided 2026-11-06.** Every label is the project's, for everyone on it. No per-person labels: a person's own marks are
pins and saved views, which stay on their desk (areas call 4).

## The design to build first

**Decided 2026-11-06,** from experiment 218's step 5 designs.

- **D1 and D4 are built first.** D1 is the label menu in the ticket: `l` opens it over the Labels
  row, groups as sections, Area first. D4 is chips in the ticket tile plus a tsh line,
  `label 193 area=pipeline +flaky -stale`, with Tab completing names. Both write the same
  `labeled`.
- **D2 is kept, as the second slice.** Bulk accept of guesses in the list waits until guessing at
  filing exists, since before that there is nothing to accept. Its "select all" needs a
  half-checked state when some rows are picked. Manti 0.13.0's `Checkbox` has an `indeterminate`
  prop: when it is true the box draws a dash and its `checked` is set to `"indeterminate"`, over a
  controlled `checked`. Manti's own data table already drives it with "some rows, not all". So no
  Manti change is needed for D2.
- **D3 is mostly the decided filter.** A labels tile that sets the tracker's filter adds little
  over `--label` and `--area`; rename, merge and make stay in D1's menu.
- **The menu is built on Manti, with one Manti change.** The searchable menu is Manti's
  `Combobox` (it takes `multiple`) inside a `Popover`. In Manti 0.13.0 a `ComboboxItem` is only
  `{value, label: string, disabled?}`: no groups and no custom row content
  ([UI on Manti](./ui-on-manti.md) already says Combobox and Listbox take string labels only).
  The menu needs groups (Area first, as radio items) and a guess marker on a row. So we patch
  Manti's `Combobox` with `pnpm patch` to take groups and custom row content, and send the same
  change to Manti by pull request. The picker (`pick`, picker guidelines, pull request 419)
  needs the same thing, so one Manti change serves both.
- *Corrected 2026-11-06:* this note first said Manti 0.13.0's `Combobox` worked as it is and no
  Manti pull request was needed. That was wrong: its items take a string label only, with no
  groups. The `Checkbox` `indeterminate` point for D2 stands.

## What the ledger records

| Fact | Lost if not written now? |
|---|---|
| `guess` on `filed` | **Yes.** Only the filer knows its guess at filing. |
| `suggested` on `label_made` | **Yes.** What the person saw and took exists only then. |
| `by` and `for` on every `labeled` | **Yes.** Phoenix cannot tell an agent's label from a person's; that is gone for good. |
| `sentAt` on every label fact | Yes: the writer's own clock. Recorded, never trusted by the fold. |
| old names on `label_renamed`, `label_merged` | Yes: old talk and old tickets still read. |
| a ticket's labels, a group's counts | No: folds, rebuilt from the log. |

## A tryout in today's version

None offered. Today's areas already follow L1, L4 and L5, and today's tracker has no other
labels. A general label system there would be new work in today's version, which AGENTS.md rules
out unless the owner picks it.

## Where this differs from settled notes

- **[Areas](./areas.md)**, its proposed "where this differs": "An area is not a label in a group."
  This note decides the other way (call 1). A1 and A2, which are decided, hold either way.
- **[Tracker views are programs](./tracker-views-are-programs.md)** sketches
  `labeled {add, drop}` with label strings. Here they are numbers, as areas taught.
- **The glossary's `area` row** says "Not a label that gates a build". That holds: a label in the
  Area group gates nothing. Its `project` row calls an area "the long-lived grouping with an
  owner"; no decided note gives an area an owner, and L6 says what happens if one does.

## What it costs

In `next/`'s tracker, when it is built: one labels stream with six person facts, one ticket fact
(`labeled`), one optional key on `filed`, one fold, one menu, and the filter's `--label` form.
About 900 lines with tests, about 6 agent hours with the steps (a guess, from areas PR 1 at about
500 lines for one group's facts and fold). It replaces areas' own facts in `next/`, so it is not
on top of them.

## Made up here

`tracker/labels`, `group_made`, `group_renamed`, `label_made`, `label_renamed`, `label_merged`,
`label_archived`, `LabelNumber`, `GroupNumber`, `LabelName`, `Pick` and its cases, `TicketLabels` and its `fromTimeline`, the
`pick` and `guess` keys on a group, `--label`, labels 1 to 4 and every count in the trace.

## What it cannot tell us

- Whether two people will ever make a group besides Area. If not, the general system is shape
  ahead of need, and call 1's lean of 65% was generous.
- Whether an area will need an owner or a strategy; that is pipeline strategies' open call.
- Whether "replace on pick" in a one-group surprises anyone over time. The D1 reshoot showed it
  works; only a week of use tells.
- Phoenix's counts cover its 3,000 newest issues, not all, and did not count which stale labels
  something read.
- No screen reader run: the label menu's radio and checkbox groups need VoiceOver.
