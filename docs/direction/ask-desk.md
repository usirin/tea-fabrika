---
state: "decided 2026-11-02"
summary: "`next/`, with tryouts in today's version. Most asks take one key: `y` takes the step's rec, `n` refuses it with a required note, `o` opens every pick, each key has a button, and the keys work only where focus is. One asks program with two views: the top bar's popup as the glance, with the rec and `y` and `n` on its rows, and \"open all\" as a tile, a list beside the selected ask, with the ticket tile following on a pipe; five rules for the first tile the app opens with content. Six principles: one queue as a list beside the selected ask, with a count and minutes; the question in one line with the rec's why, cost and percent sure, the evidence folded; three keys; the rec written before the ask and what the person did recorded (`took`: key, time on screen, what was opened, rec shown or hidden), attention counted per merged ticket (from experiment 185); autonomy offered per narrow kind after 30 blind agreements in a row (the rule of three), one press to make and undo, never for the exam, spend or security kinds; code answers what code can, and a stop shows as a stop. An answer may carry an optional `needed` mark: the ask really needed the person, or the agent could have worked it out (decided 2026-11-07). Ticket 117's three asks and its `no_review` stop are the running example. From experiment 196."
---

# The ask desk: most asks are one key, and the desk learns from the answers

**Decided 2026-11-02.** The owner approved the whole note after a walk of each part: one asks
program with two views, the five rules for opening a tile, the six principles A1 to A6 and the
smaller calls 1 to 5, each with its lean. The leans' confidence numbers stay as written, and each
doubt names what settles it.

Its decided rules are in: [0480](../../.decisions/0480-the-inbox-is-one-program-two-views.md),
[0481](../../.decisions/0481-a-tile-opened-with-content.md),
[0482](../../.decisions/0482-every-ask-sits-in-one-queue.md),
[0483](../../.decisions/0483-an-ask-is-one-line-with-its-rec.md),
[0484](../../.decisions/0484-y-takes-the-rec-n-refuses-it.md),
[0485](../../.decisions/0485-the-rec-is-written-before-the-ask.md),
[0486](../../.decisions/0486-an-answer-may-say-it-needed-you.md),
[0487](../../.decisions/0487-a-kind-goes-automatic-by-one-press.md),
[0488](../../.decisions/0488-a-stop-shows-as-a-stop.md),
[0489](../../.decisions/0489-the-ask-is-one-quiet-bar.md).

Decided by the owner before this note, and not asked again: asks to the
owner are fine, even many; the owner's call of 2026-10-30 stands
([triage asks when worth is unclear](../../.decisions/0377-triage-asks-when-worth-is-unclear.md): about 130 to 190 asks
a week, with no ask budget set yet); the owner makes every decision the system thinks needs them. What is needed is a desk where
most asks are one key in one sitting ("approve", "do your rec", or "no, with a note"), and a desk
that learns from the owner's answers so the system automates better over time. Folded in the same
day, from [experiment 185](../../experiments/185-dsh-superagent-study.md)'s "steal 1": attention is
a counted cost, per merged ticket, and a design that asks a person says what it costs them a week.
It is data the desk records, not a budget that cuts asks. **Decided 2026-11-02**, later the same day,
after a look step of six rounds: [the look](#the-look) (the selected row, one quiet box, the rec as a
labeled row, two text grays) and five calls, Q1 to Q5, with their leans' numbers kept.

Built from [experiment 196](../../experiments/196-ask-desk.md), which read about 18 makers and
papers and checked ticket 117's real asks against them, and a private page, "Ask desk guidelines",
with a small desk you can click and key through. Neither is a measurement. Round 2, the same day,
after the owner's review: the desk is one asks program with two views, a glance in the top bar and a
list and detail in a tile, not a second desk beside today's asks popup and not a card in the middle
([one asks program, two views](#one-asks-program-two-views)). It builds on
[one ask, one meter](./one-ask-and-one-meter.md) (proposed, tickets 90 and 91), whose `asked` and
`answered` facts it grows.

```ts
// A sketch, next/. Ticket 117's plan v2 ask, in the new shape. One field is new on `asked`: `rec`.
// On `answered`, `answer` (a union that holds the note) takes the place of `pick` and `note`, and
// `took` is new. The rest is one ask, one meter's shape.
{_tag: "asked", ask: "a-approve-8", for: "approve", what: "Approve plan version 2?",
 picks: ["approve", "no"],
 rec: {_tag: "pick", pick: "approve", why: "3 open questions, each with a lean (99, 95, 95)",
       cost: "the exam step runs next, about 4 agent minutes", sure: 95},
 shows: {plan: 2, questions: 3, criteria: 8}, saw: "sha256:…", until: null}

{_tag: "answered", ask: "a-approve-8", answer: {_tag: "rec"}, saw: "sha256:…",
 via: {_tag: "window"},
 took: {key: "y", rec: "shown", ms: 41_000, opened: ["questions"], said: 1793649030000}}
```

```text
one sitting, traced
Ctrl-B a          the top bar's popup: 4 asks, about 2 min  the glance: each row has its rec
  Enter           the asks tile opens beside the focused    the popup closes; focus is on the same ask
                  tile, on the same ask; the ticket tile    in the tile; the ticket tile follows it
                  follows by pipe
  ask 1 of 4      #117 Approve plan version 2?              rec: approve, 95%; evidence folded
  space           the three open questions unfold           took.opened gains "questions"
  y               takes the rec                             answered {answer: rec}; status "Approved. 3 left."
  ask 2 of 4      #117 Merge these rule changes?            rec: merge; an exam kind: never automatic
  n               not the rec: a note opens                 the note is required; Enter sends
                  "wait, the second file needs a look"      answered {answer: against, pick: "no", note}
  ask 3 of 4      #117 Build ran out of its limit. Go on?   no rec: the price is unknown; y does nothing
  o               every pick: more, stop                    answered {answer: chose, pick: "stop"}
  ...             done, "Nothing waits on you."
```

## Which version

- **`next/`:** all of it, as one asks program: its tile from Tier 2, its glance in the top bar with
  the asks list in Tier 5 ([tiers](../plan/tiers.md)). The facts land with the one ask (ticket 90) in whatever tier first asks a
  person; `rec` and `took` go on from that day, since what they hold exists only then.
- **Today's version (`apps/fabrika`, `programs/tracker`, `packages/pipeline`):** not changed by this
  note. Ticket 117's asks are the running example, read on main. Four small tryouts are offered at
  [a tryout in today's version](#a-tryout-in-todays-version), none filed. Ticket 102 (answer an ask
  from the asks list) is the first.

## The shape

```ts
// A sketch, next/. Effect Schema writes every _tag. The kind list is jidoka's closed Judgment list.
const Rec = Schema.TaggedUnion({
	/** The step's own pick, written before the ask is shown. `pick` is one of the ask's picks. */
	pick: {pick: Pick, why: Line, cost: Line, sure: Percent},
	/** The step cannot say. The desk offers no `y`; the person picks from all. */
	none: {why: Line},
});

/** How the person answered. A pick against a shown rec needs a note; the type says so. */
const Answer = Schema.TaggedUnion({
	rec: {},                                 // y: the rec's pick, whatever it is
	against: {pick: Pick, note: NonEmptyLine}, // n or o, with the rec in view: say why
	chose: {pick: Pick, note: Schema.optionalKey(NonEmptyLine)}, // no rec in view: pick freely, a note if you like
});

/** What the window saw the person do. Its own clock, so it is never used to decide. */
const Took = Schema.Struct({
	key: Schema.Literals(["y", "n", "o", "click", "chat"]),
	rec: Schema.Literals(["shown", "hidden", "none"]), // hidden: a blind ask
	ms: Schema.Finite,                       // the ask on screen, with focus, before the answer
	opened: Schema.Array(Schema.String),     // the evidence parts unfolded, in order
	said: Schema.Finite,                     // the window's clock at the press
});

/** A person's rule: this kind, with this rec, is taken without asking. Person-only, as `answered`. */
const RuleMade = Schema.TaggedStruct("rule_made", {
	rule: Id,
	match: Schema.Struct({for: Automatable, step: LaneStep, rec: Pick, repo: Repo}),
	seen: Schema.Struct({blind: Count, agreed: Count}), // what the offer showed: 30 of 30
	from: Schema.Array(Id),                  // the blind asks it was offered on
});
const RuleDropped = Schema.TaggedStruct("rule_dropped", {rule: Id, why: Line});

/** Code took the rec under a rule. Never in PERSON_KINDS: it is not a person's answer. */
const Auto = Schema.TaggedStruct("auto", {ask: Id, rule: Id, pick: Pick});

/** The kinds a rule may ever cover: every Judgment but the exam, spend and security ones. */
type Automatable = Exclude<Judgment,
	"exam_merge" | "exam_touched" | "exam_conflict" | "check_change" | "disable" | "spend">;
```

Decided by the owner, 2026-11-08: a `chose` answer may carry an optional note, so a person can
still tell the planner or the builder something once the made-up rec is gone. Ask desk PR 1
(ticket 102) builds it.


- **Checked against the settled notes by reading, not by `tsc`.** `Judgment` is jidoka's closed list
  ([jidoka](./jidoka-and-andon.md#three-kinds-of-stop-and-the-andon-stop)). `shows`, `saw`, `via`
  and `withdrawn` are one ask, one meter's. A security triage ask is `for: "ruling"` with
  `why: "security"`, so the security cut is a refusal in the rule's fold, not a literal in the type:
  a rule's `match` never matches an ask whose `why` is security.
- **`rec.pick` is one of `picks`.** The asker's `refuse` turns away an `asked` whose rec is not, as
  the fold already refuses a pick not offered (`ticket.ts:579`).
- **One rec, not a rec and a separate guess.** An automatic kind would do the rec, so the rec is what
  agreement must measure. A second "what will the owner pick" field would be a number nothing acts
  on. The lean from the owner's brief, a guess written before the ask, is the rec, sealed before the
  desk draws it.

## One asks program, two views

**Lean, 80%.** One program owns the asks: the queue, the selection and the answer. It has two views.
The top bar's popup is its glance: every row shows its rec, and `y` and `n` answer from there.
"Open all" (or `Enter` on a row) opens its full view as a tile, a list beside a detail. Both views
draw one selection, so moving from one to the other keeps your place. The ticket tile takes the
selection on a pipe, so the ticket you are answering about sits beside the ask. This replaces round
1's single card in the middle of the desk.

```ts
// A sketch, next/. One program, one model, two views. Names are a sketch.
type Asks = {
	queue: ReadonlyArray<AskId>; // from the one asks machine: one source, as asks.ts is today
	selected: AskId | null;      // one selection, drawn by both views
	open: ReadonlyArray<Part>;   // evidence parts unfolded on the selected ask
	note: Draft | null;          // the "not the rec" note being typed
};
const glance = (m: Asks) => popup(m.queue.map((id) => row(id, {rec: true, keys: ["y", "n", "h"]})));
const full = (m: Asks, width: number) =>
	width < 520 ? onePane(m) : listAndDetail(m); // the same rows, the same detail, at two sizes
// out on the pipe: the selected ask's ticket, which the ticket tile shows
const out = (m: Asks): TicketId | null => (m.selected ? ticketOf(m.selected) : null);
```

### How Linear would build it in fabrika

Linear's own triage is one screen: a list "side by side with the focused issue" [l5], one key per
action [l1], and an inbox where you "click into the notification to view the individual issue" [l2].
We do not copy that screen. We ask how Linear's team builds: they pick "few things to do well" [m4],
define "the behaviors of the main components of the app" once [m8], and keep "consistent,
high-quality experiences" [m10]. Built on fabrika's own parts (programs in tiles, a top bar, pipes,
one asks machine), that gives one program and reusable pieces, not a triage screen.

| Screen | How Linear would build it in fabrika | Where it differs from Linear's triage, and why |
|---|---|---|
| The top bar's popup | The asks program's glance view: the rows of today's popup, plus the rec and `y`, `n`, `h` on the selected row. One component for a row. | Linear has no popup inbox: Triage and Inbox are pages. We keep the popup, since today's top bar already holds the count and the owner glances there between other work. |
| The asks tile | Its full view: a list and a detail, from one reusable list-and-detail piece. It folds to one pane under about 520px. | Linear's split view is a page. Ours is a tile, so it sits beside a terminal or the map, under the desk's own split rules. |
| The ticket tile on the pipe | The ticket program, unchanged, reading the asks program's output: `asks \| ticket`. | Linear draws the focused issue inside triage. We compose two programs, so the ticket view is the one you already know, not a second copy. |
| An ask in a ticket | The same ask component, at its third size: the ticket's ask box. | Linear answers triage from triage only. Here any of the three answers, through the same `answered` fact. |

- **Reusable, so other programs get it free.** The list-and-detail piece that folds to one pane, the
  action bar built from a program's commands with each key shown on its button, and "open or focus"
  for any program that opens a tile with content (the patterns below).
- **Doubt.** Whether `y` in a small popup is safe for a plan ask, which wants the plan read first.
  The popup shows the rec and its sure; `Enter` takes you to the full view. A live week says how
  often a plan is answered from the glance.

### Opening a tile with content

Today nothing in the app opens a tile with content: the asks list only jumps to a tile that shows
the ticket, turns the tracker to it, or says no tile shows it (`apps/fabrika/src/window/frame.ts:357-382`),
and [popovers](./popovers.md) records that it "never opens a new tile: the app has no path for that
yet". "Open all" is the first. It needs five rules, each tried in the page's demo and written up in
[experiment 196's patterns found](../../experiments/196-ask-desk.md#patterns-found).

| Rule | Lean |
|---|---|
| Open or focus: a second "open all" focuses the asks tile already open, never a second one. | 90% |
| Where it lands: it takes half of the focused tile's share, after it, side by side. In a row it is a sibling; in a column it nests ([fold, not tabs](./fold-not-tabs.md)). A zoom ends first. If it would be under 220px wide, the others in its row fold, the tile it came from last. | 65% |
| The handoff: the popup closes, the new tile is focused, on the same selected ask. | 85% |
| The way back: `Esc` at the tile's top level, or closing it, returns focus to the tile it was opened from. | 60% |
| What is said: the focus move speaks for itself; an answer is a polite status; the bottom line names the tile. | 80% |

## The look

**Decided 2026-11-02.** The owner said yes after a look step
([guidelines skill](../../.claude/skills/guidelines/SKILL.md), step 5): six rounds of shots of the
desk built in today's app, each beside today's app and the closest Linear docs image
([experiment 196, round 3](../../experiments/196-ask-desk.md#round-3-the-look-step)). The chassis (the
top bar, the bottom line, each tile's title bar) is unchanged.

```ts
// A sketch of what the look holds, in words a test or a shot can check. Not a token file.
const look = {
	selectedRow: {mark: "full-row fill", text: "stronger"}, // never a colored bar on one side
	meta: {font: "sans", gray: "low step"},                 // #117, the rec word, the time
	card: {fill: "slate 3", edge: null, radius: 8, nested: 0, indigo: 1}, // every card, one box
	rec: ["Recommended", "Approve", "95% sure"],            // a labeled row, then the reason's own line
	textGrays: ["step 12", "low step"],                     // two, never a third
};
```

- **The selected row** is a full-row fill with stronger text, in the popup and in the asks tile,
  never a colored bar on one side. The meta line is sans: mono is only for what a person types
  ([color principles](./color-principles.md)).
- **The "Your turn" card** is one quiet box: slate 3 fill, no edge, 8px corners, nothing nested in
  it, and one indigo button. The running, stuck and done cards share that box.
- **The rec reads as a labeled row,** Linear's Triage Intelligence shape [l3]: "Recommended → Approve
  · 95% sure". The label is the low text step, the value is step 12 at weight 600, and the reason is
  on its own line. Its exact type follows the typography roles a separate study is defining on Manti
  `Text` and `Heading`; the row is the evidence, not a set of fixed sizes.
- **Two text grays only:** step 12 and the low step. A third, quieter gray for the meta was tried
  and failed contrast (experiment 196 keeps it as a wrong guess).

The five calls the look step raised, each decided 2026-11-02 with its lean kept:

| Call | Decided | Lean |
|---|---|---|
| Q1. A press in the popup, today | Until tracker ticket 102 gives the popup a write, `y`, a note and a pick in the popup open the ticket and finish there. | 75% |
| Q2. `Enter` on a popup row | Opens the asks tile, as [one asks program](#one-asks-program-two-views) says. The asks tile is built as part of the ask desk. | 85% |
| Q3. The cards | Every card shares one box. | none recorded |
| Q4. The selected row, to a screen reader | `aria-selected`, from the WAI-ARIA listbox and grid patterns [w1], not `aria-current`. A VoiceOver run settles it. | 85% |
| Q5. The box around the ticket's properties | It goes too, in the same ask desk build, as AGENTS.md's "no extra containers" asks. Doubt: where the properties drop below the card in a narrow tile, they must still read as their own group without the box (spacing, the label and value rows); the pull request's narrow shots check it. | 80% |

**Changed 2026-11-08 by the owner (ticket 102), after the look step for the ask desk build: design
E.** The ask is one quiet bar under the ticket's title, where the "Your turn" card sat. It has no
box and scrolls with the ticket. Two fixes go with it: a lighter line under the picks, and
"Recommended" shown once. This replaces the "Your turn" card above for the ask; the running, stuck
and done cards are not changed by it. Where the "Did this need you?" mark sits is in
[did this ask need you](#did-this-ask-need-you).

```ts
// A sketch of E, in the words of the look above.
const ask = {
	place: "under the ticket title", box: null, scroll: "with the ticket",
	rec: ["Recommended", "Approve", "95% sure", "Did this need you?"], // "Recommended" once; the mark at the end
	picksRule: "lighter line",
};
```

## The six principles

### A1: one queue, a list beside the selected ask

**Lean, 85%.** Every ask a person owes is in one queue, oldest first, with how many and about how
long at the top. The queue is a list; the selected ask is drawn whole beside it.

- **What it means.** In the asks tile, the list on the left and the selected ask on the right; in the
  popup, the rows with the selected one opened under its row. The header says "4 asks, 1 stop · about
  2 min". After an answer, the next ask is selected, and focus stays where it was, on the list or in
  the popup. `j` and `k` (or the arrows) move; a click on a row selects it; `h` sets one aside, as
  the asks list's `H` does today. Under about 520px the tile shows one pane: the list, or the detail
  with "All asks" (`Esc`) to go back.
- **Why.** Linear's triage puts the list "side by side with the focused issue" [l5], with one key per
  action [l1]; Superhuman: "Mark Done with E and keep triaging from the next conversation" [s1]. The
  minutes come from the person's own past answers per kind (`took.ms`, below); until there are 20 of
  a kind, 30 seconds a kind, experiment 163's guess, marked "about".
- **Tried and replaced.** Round 1 drew the head ask whole as one card in the middle and the rest as
  a count, closer to Superhuman than to Linear. The owner's review: it was not how Linear would build
  it, a click on a row did nothing, and it was a second desk beside today's popup. The list beside
  the detail lets a person see what is waiting and pick any of it with the mouse or the keys.
- **Linear.** One triage list per team, `J` and `K` to move, `H` to snooze [l1][l2], in a split view
  [l5]. We match the list and the split, with one queue across every ticket and repository, since
  one person answers them all, and we build it as a program in a tile
  ([one asks program](#one-asks-program-two-views)).
- **Elm or OTP.** The queue is a view of a fold over the ledger, as today's asks machine is
  (`asks.ts:1-40`). Each ask is a parked `gen_server:call` waiting for one reply [o1]; the desk is
  where the reply is made.
- **What holds it.** One source: the asks machine feeds the top bar, the badge, the popup and the
  tile alike, so they cannot tell two stories (`asks.ts:15-20`). A law: the tile's count equals the
  popup's, and both views draw the same `selected`.
- **Accessibility.** The list's rows are buttons with one tab stop, the selected row (a roving
  tabindex: one element has `tabindex="0"`, "all other focusable elements contained in the composite
  have `tabindex="-1"`" [w3]). The selected row is marked by `aria-selected`, a full-row fill and
  its weight, never by color alone (1.4.1). **Changed 2026-11-02** (Q4, 85%, and [the look](#the-look)):
  this line said `aria-current` and a bar. A list a person picks one row from is the listbox or grid
  pattern's selection, which `aria-selected` names [w1]; and a bar on one side marks the row a second
  time, when the fill already does. After each answer, a polite status says what happened and what is
  next, without moving focus (WCAG 4.1.3 [w2]); focus stays on the list (2.4.3).
- **Doubt.** Same-kind grouping reorders a queue that [every wait is a queue](./every-wait-is-a-queue.md)
  says is first in, first out (call 4).
- **Cost.** In `next/`, the asks program's list, both views and the list-and-detail piece, about 250
  to 400 lines with laws, 3 to 4 agent hours.
- **Today.** **Half.** The asks list is one queue, oldest first (`asks.ts:250-276`), in a popup from
  the top bar, but an answer means opening the ticket (`frame.tsx:431`), nothing opens a list beside
  the ask, and the top bar says how many, not how long.

### A2: the question in one line, the rec beside it, the evidence folded

**Lean, 85%.** The ask is one line. Beside it sits the step's rec: the pick, why, what it costs and
how sure, in words. The evidence is folded under it, one press to open.

- **What it means.** "Approve plan version 2?" then the rec as a labeled row, "Recommended → Approve
  · 95% sure", and the reason on its own line: "3 open questions, each with a lean. The exam step
  runs next, about 4 agent minutes" ([the look](#the-look), decided 2026-11-02). `space` unfolds the evidence (the
  plan's questions and leans, the diff, what each pick does) under the question, which stays in
  view. An ask with no rec says so in words ("No rec: the price is unknown"), and `y` is not offered.
- **Why.** Linear: "Accept, decline, or view more information about why a suggestion was made" [l3].
  Goddard: showing confidence beside advice and making the person accountable lower automation bias
  [a3]. SRE: "Every page should be actionable" [t1].
- **Linear.** Triage Intelligence shows a suggestion; "Hover over the suggestion to see why it's
  appearing" [l3], and auto-applied ones are "clearly marked in the suggestions header" [l9]. We add
  cost and how sure, which Linear does not show, and the rec is a word on the popup row too, so the
  glance already says it.
- **Elm or OTP.** The fold is view state in the desk's own machine: `opened` is part of the model,
  never `useState` ([Elm first](./elm-first.md)).
- **What holds it.** `Rec` is a union: an ask with a rec has all four parts, and one without has a
  why. `what` is a `Line`, a string with no newline and at most 120 characters, checked by the
  schema.
- **Accessibility.** "Rec" is a word, never a color or a primary button alone (1.4.1 [w2]). The
  region is labeled by the question, so a screen reader hears the question first, then the rec.
- **Doubt.** Whether one line is enough for a plan: field note 2026-11-01-34 says the person read the
  plan before answering. The fold keeps the question in view while the plan is open, which is the
  fix that note asked for. A timed live batch settles it.
- **Cost.** The rec field on `asked` and its writer per kind, about 60 to 120 lines, 1 to 2 agent
  hours (the plan already writes leans).
- **Today.** **Half.** One line each (`machine.ts:799-800`), and the plan's leans with why, cost and
  sure exist (`stages/plan/plan.ts:136-149`; 117's were 99, 95, 95). But no ask has a rec field; the
  first pick is drawn primary with no why (`programs/tracker/src/window.tsx:813`), a default
  people take "simply because it's first" [n1]; and the card scrolls away from the plan.

### A3: three keys, a button for each, and only where focus is

**Lean, 80%.** `y` takes the rec. `n` refuses it and opens a note, which is required. `o` opens
every pick. Each key has a button with the key printed on it. The keys work only while the popup or
the asks tile has focus.

- **What it means.** One press for most asks. `n` means "not the rec": with two picks it takes the
  other one, with more it opens the rest; either way a one-line note says why, and it goes to the
  step that runs next. `o` lists every pick by number, rec included, for a person who wants to see
  them all. Every key has a click that does the same: a row, "Take rec · approve `y`", "Not the
  rec… `n`", "Every pick `o`", each pick `1` `2`, "Evidence `space`", "Later `h`", "Open the lane
  `↵`". The buttons come from the program's `commands` ([modes](./modes.md)), so a key
  and its button cannot drift, and each carries `aria-keyshortcuts`, which only names the key: "the
  keyboard behavior must be added via JavaScript event handlers" [w5]. The demo's 132 click and key checks pass in Chromium
  (experiment 196).
- **Why.** Linear: one key per action, and "Accepting an issue will offer the option to leave a
  comment" [l1]. A no carries a one-line reason, as
  [sort answers yes or no](./sort-answers-yes-or-no.md) decided and the old desk pack required
  (`packages/pipeline/src/asks/ask.ts:126`). A no with a note is what lets the next step fix it
  without asking again.
- **Linear.** Number keys per action (1 accept, 2 decline, 3 duplicate) [l1]. Our picks differ by
  kind, so our keys mean "the rec" and "not the rec", not one action each. `y` and `n` are already
  the house keys for a question: the tile's asking marker answers with them
  ([tile guidelines](./tile-guidelines.md#asking-marker)).
- **Elm or OTP.** A key is a Msg. The desk's `refuse` turns away `y` on an ask with no rec, and an
  `against` with an empty note.
- **What holds it.** `Answer` is a union: `against` has a `NonEmptyLine` note, so a refusal with no
  why does not decode. A law: on every ask kind, `y` gives the rec's pick.
- **Accessibility.** Single letters pass WCAG 2.1.4 only "when that component has focus", or when a
  person can turn them off or remap them [w2]. Both hold: the keys live on the popup and the asks
  tile, and [keybindings](./keybindings-are-configurable.md) remaps them. Every key has a button
  (2.1.1). A `y` pressed in a terminal tile or outside the window does nothing; the demo checks it.
- **Doubt.** What `n` means when the rec is itself the pause (call 1).
- **Cost.** The keys and the note, about 80 to 120 lines with tests, 1 agent hour.
- **Today.** **Breaks.** No keys on an ask: a click on a pick. The note is optional on `no`
  (`window.tsx:801`).

### A4: write the rec before the ask, and record what the person saw and did

**Lean, 90%.** The rec is on the `asked` fact, written before the desk draws it. The answer records
which key, how long the ask was on screen, what was opened, and whether the rec was in view. A yes
covers what the desk drew. Attention is counted per merged ticket.

- **What it means.** The fields in [the shape](#the-shape). `took.said` is the window's clock, kept
  out of the deciding code's types; the ledger's `at` stays the referee. The yes's `saw` is the hash
  of `shows`, the data the desk drew, as one ask, one meter says.
- **Why.** Record wide ([AGENTS.md](../../AGENTS.md#before-you-design-anything)). Each of these exists
  only at the moment of the press; agreement, minutes per kind and the header's estimate are folds
  that can wait. GitHub dismisses "stale pull request approvals when commits are pushed that affect
  the diff" [g2]: a yes covers what was seen.
- **Count attention, from experiment 185.** One view per merged ticket: asks, messages a person got
  (each `nudged` fact and each notice), and minutes from ask to answer, plus the sum of `took.ms`.
  It is a count. It never caps or cuts an ask.
- **Linear.** No Linear answer: Linear does not publish what it records about a triage action.
- **Elm or OTP.** Data first: the facts are the model, and every view is a fold.
- **What holds it.** `took` is required on `answered` from a window, optional only on `via: chat`.
  A law: an ask's `rec` is written before its first draw, so the fold never sees an answer whose ask
  had no `rec` field.
- **Accessibility.** Nothing new. No screen reader output is recorded.
- **Doubt.** `took.ms` counts focus time, so a person who reads the plan in another tile is
  undercounted. Record `opened` too, and read both.
- **Cost.** About 60 to 100 lines, 1 agent hour, on top of the one ask.
- **Today.** **Breaks.** No rec, key, time on screen or opened parts. All three of ticket 117's
  answers carry the same hash, `sha256:a747…`, of the ticket's title and body
  (`tickets/approval.ts:32-38`, `programs/tracker/src/window.tsx:672`), so neither yes covers the plan
  or the rule changes it was about. Asked and answered `at` exist, so minutes to answer are a view
  today: 71, 97 and 121 seconds.

### A5: autonomy is offered per narrow kind, after blind agreement, and undone with one press

**Lean, 70%.** When one kind of ask agrees with the person often enough on blind asks, the desk
offers one press to make that kind automatic. One press undoes it. Some kinds never go automatic.

- **What it means.** A share of asks hide the rec until the person picks (a blind ask, `took.rec:
  "hidden"`); the rec is still sealed on `asked`. Only blind asks count. When a kind (`for`, `step`,
  the rec's pick and the repository) has 30 blind asks in a row that matched, the desk shows an offer
  under the ask: "30 blind asks of this kind in a row went your way. At worst about 1 in 10 would
  not. `a` makes it automatic." `a` writes `rule_made`, a person's fact. From then on, code takes the
  rec and writes `auto`; the ask is still written, so the count stays whole. The rule's row in the
  desk's rules list has one press to drop it. The `never` pick (one ask, one meter) is a rule too:
  a standing refusal.
- **Why.** Gmail makes a rule from one real example, "Filter messages like these" [g1]; Linear lets
  a suggestion "auto-apply" [l3]; both are a manual switch with no count. Selective prediction lets
  you "set a desired risk level" and act on the share you are sure of [a2]; Parasuraman 2000 makes
  "high reliability" the test [a1]. Blind, because automation bias "cannot be prevented by training
  or instructions" [a3]. 30, because 0 misses in n gives a 95% upper bound of about 3/n [a4]: 30 is
  10%, this repo's advise line (Google CACM 2018). The owner's example, 19 of 20, still allows about
  22% (experiment 196's arithmetic).
- **The ladder.** Today's asks are Sheridan's level 5, "executes that suggestion if the human
  approves". A rule moves one kind to level 7, "executes automatically, then necessarily informs
  humans" [a1]: each `auto` shows as a quiet row in the ticket and the desk's "done for you" line.
- **Never automatic.** The exam kinds ([nobody writes their own exam](./nobody-writes-their-own-exam.md)),
  `spend` (a dollar limit points at a person's yes; its automation is the project's standing limit,
  [one meter](./one-ask-and-one-meter.md#limits-that-point-at-a-yes)) and a security triage ask
  ([triage asks](../../.decisions/0377-triage-asks-when-worth-is-unclear.md)). The type says so: `Automatable`.
- **Linear.** Auto-apply per team and per property, set by hand [l3]. We differ: we offer it only
  after a measured, blind count, and show the bound in words, because we record every answer and
  Linear's setting does not say what it is based on.
- **Elm or OTP.** A rule is a pure fold over `rule_made` and `rule_dropped`; the asker checks it
  before it parks. It reads like an event handler a person adds to and removes from a manager (our
  comparison; gen_event was not read here).
- **What holds it.** `Automatable` excludes the kinds that never go. `rule_made` is person-only at
  the door, as `answered` is (`packages/fabrika/src/host/door.ts:118`); `auto` is code's and never a
  person kind, so an automatic pick never looks like a person's yes. A law: no `auto` on an ask
  whose `why` is security.
- **Accessibility.** The offer is a line of words with its key, never a badge alone (1.4.1). Each
  automatic pick is told politely once per sitting, joined ("2 done for you"), not one by one
  (4.1.3).
- **Doubt.** Whether kinds are narrow enough to match on (the owner's own doubt). Experiment 163 part
  5 found files and pull requests say where code is, not what to decide, and precedents found 0 of
  68. Kind plus rec is narrower than content, and nobody has counted it. Two live weeks of blind
  asks settle it: if no kind reaches 30 in a row, kinds are too wide or recs too weak.
- **Cost.** The blind share, the streak fold, the offer, the rules list and `auto`, about 250 to 400
  lines with laws, 4 to 6 agent hours. Nothing to build before a live week has asks with `rec`.
- **Today.** **Not there.** 117 gives 3 of 3 first picks and 6 of 6 leans taken, every one with the
  rec in view: too few, and not blind.

### A6: code answers what code can; a stop shows as a stop

**Lean, 85%.** A stop a step can fix never reaches the desk. A stop that does is drawn as a stop,
with its why and where the lane goes on, never as a yes or no. A design that adds an ask says what
it costs a person a week.

- **What it means.** The desk's asks are jidoka's `judgment` kind only. An andon stop sits in the
  same queue as its own row: "#117 stopped at exam_merge: no review at this head", with `↵` to open
  the lane, and no `y` or `n`. A new ask kind's change says why only a person can answer it, as
  jidoka already asks, and now also its weekly cost: asks a week times the person's minutes per ask.
- **Why.** "Pages with rote, algorithmic responses should be a red flag" [t1]. A rote ask trains a
  rubber stamp [n1], and that stamp would then pollute A5's count.
- **Linear.** No Linear answer: Linear's triage holds issues people filed, not a machine's stops.
- **Elm or OTP.** A supervisor restarts what it can and escalates what it cannot; the desk is where
  the escalation lands ([jidoka](./jidoka-and-andon.md)).
- **What holds it.** PR 11's route table, where a fixable row cannot be a stop and a missing row
  fails `pnpm typecheck` ([self-fix PR 11](../plan/pipeline-self-fix.md#pr-11-every-outcome-has-a-route-and-a-fixable-stop-never-stops)).
  The desk's row type is `ask | stop`, so a stop cannot be answered `y`.
- **Accessibility.** A stop is told once, politely; an ask that needs a person now is the asking
  marker's assertive line ([tile guidelines](./tile-guidelines.md#what-a-screen-reader-is-told)).
- **Doubt.** None that changes the lean; the weekly cost needs `took.ms` before it is more than a
  guess.
- **Cost.** The stop row, about 40 to 60 lines; the rest is PR 11.
- **Today.** **Breaks.** Ticket 117's `send:reviewer:no_review` at `exam_merge` was a step code could
  take (PR 11 routes it to `run("review")`). It stopped the lane `stuck:sent_back`, and the asks list
  never showed it: the tracker's head says stuck only when the last end is `stuck`
  (`programs/tracker/src/head.ts:115`), and this one was a `send`.

## The smaller calls

### 1. What `n` does when the rec is the pause

```ts
// a: n is "not the rec", always (lean)
spend, rec "stop"   -> n takes "more", and the note says why
// b: n is the kind's pause pick, always
spend, rec "stop"   -> n takes "stop", the same as y; "more" only through o
```

**Lean a, 70%.** One meaning for `n` on every kind, and a person refusing a rec always says why.
Cost: on a spend ask, `n` spends money after a typed note, which is a speed bump, not a press. Doubt:
a person may read `n` as "no" whatever the rec. A blind batch where the owner says what they meant
settles it.

### 2. How many blind agreements before the offer

```ts
// a: 30 in a row, blind (lean): at worst about 1 in 10, the advise line
// b: 19 of 20: at worst about 1 in 4.5
// c: 60 in a row: at worst about 1 in 20
```

**Lean a, 65%.** Why: the rule of three [a4] with this repo's 10% advise line. Cost: at 10 to 30
asks a week of one kind, 1 to 3 weeks before an offer. Doubt: a wrong automatic merge costs more
than a wrong automatic plan approval, so one number for every kind may be wrong. Per-kind numbers,
set by the owner once the first offer comes, settle it.

### 3. How many asks are blind

```ts
// a: 1 in 5, by a seeded draw per ask (lean)
// b: none: count every answer, and compare fast yeses
// c: every ask of a kind until it has 30, then 1 in 5
```

**Lean a, 60%.** Why: blind is the only clean count [a3], and 1 in 5 keeps most asks one key. Cost:
1 in 5 asks loses `y` and takes a number key instead. Doubt: how much a blind ask slows the person.
Timing a live week, blind against shown, settles it.

### 4. Group same-kind asks

```ts
// a: runs of one kind together, the oldest kind first (lean)
[approve #117, approve #141, merge #117]
// b: strictly oldest first
[approve #117, merge #117, approve #141]
```

**Lean a, 70%.** Why: one kind in a row is one frame of mind, and 163 part 5 found bundling by
content saved only 2 in 10, while grouping by kind changes the order, not the answers. Cost: it bends
[every wait is a queue](./every-wait-is-a-queue.md)'s first in, first out (proposed); the oldest ask
still leads its group. Doubt: untested on reading speed.

### 5. After a kind goes automatic

```ts
// a: still ask 1 in 10 of that kind, blind (lean)
// b: never ask again until the rule is dropped
// c: level 6: show it with a short window to veto, then act
```

**Lean a, 60%.** Why: an automatic kind stops making the count it was earned on, so a drift goes
unseen; 1 in 10 keeps it. Cost: one ask in ten stays. Doubt: c is the textbook middle rung [a1] but
adds a timer, and a timer that acts on silence clashes with "silence is never a yes" in
[one ask, one meter](./one-ask-and-one-meter.md#branches), so this note does not lean to it.

### 6. Where today's version tries it

```ts
// a: one asks program. Today's asks list is its glance: rows carry the rec, and y, n and h answer
//    through the ask box's same write (ticket 102). "Open all" opens its tile. (lean)
// b: two things: the asks list stays as it is, and a separate desk tile answers
```

**Lean a, 75%.** Why: the owner's review asked for one thing, not a second desk, and ticket 102
already leans it: one component and the same `answered` fact. The popup answers the quick ones;
`Enter` or "Open all" gives the full view when a plan needs reading. Cost: the list's rows must carry
picks and a rec (`asks.ts:49-66` has none), and the app needs its first path that opens a tile with
content ([opening a tile](#opening-a-tile-with-content)), which [popovers](./popovers.md) says does
not exist yet. Doubt: whether `y` from a small popup is answered too fast on a plan; a live week of
`took.opened` says. In `next/`, the asks program is the same either way (Tier 2 for its tile).

**Decided 2026-11-02, with Q1 and Q2 of [the look](#the-look).** How today's version gets to a: until
ticket 102 gives the popup a write, `y`, a note and a pick in the popup open the ticket and finish
there (Q1, 75%); `Enter` on a popup row opens the asks tile, built as part of the ask desk (Q2, 85%).

## Did this ask need you

*Decided 2026-11-07 (owner).* Next to the answer, the person can tap one of two marks: this ask
really needed me, or the agent could have worked it out. The mark is saved on `answered` as
`needed`. It is optional, and an answer with no mark is fine.

```ts
// A sketch, next/. Effect Schema writes the _tag. One field is new on `answered`: `needed`.
const Answered = Schema.TaggedStruct("answered", {
	ask: Id,
	answer: Answer,
	saw: Schema.String, // the hash of what the desk drew, as one ask, one meter says
	via: Via, // one ask, one meter's union: window or chat
	took: Schema.optionalKey(Took), // required from a window, as A4 says
	needed: Schema.optionalKey(Schema.Boolean), // true: only a person could answer; false: the agent could have
});

// One example: the person takes the rec, and says the agent could have worked it out.
{_tag: "answered", ask: "a-approve-8", answer: {_tag: "rec"}, saw: "sha256:…",
 via: {_tag: "window"}, took: {key: "y", rec: "shown", ms: 41_000, opened: [], said: 1793649030000},
 needed: false}
```

- **What it means.** Two small buttons beside the answer. Neither is picked for you. No mark means
  the person did not say; it never means yes or no.
- **Where it sits, decided 2026-11-08 by the owner (ticket 102).** The mark shows before the pick,
  as this section says, and quietly at the end of the "Recommended … sure" line, not on a row of its
  own. It is still the optional `needed` on `answered`, with no new fact.
- **Why.** Later, asks get counted per step and per agent, to find the steps that ask too much. A
  step that asks what it could have found gets the missing information in its brief, or a rule in
  code ([A6](#a6-code-answers-what-code-can-a-stop-shows-as-a-stop)). Nothing reads the mark yet.
  It goes in now because only the person knows it, only at the moment they answer, and an answer
  written before the field exists can never get it (record wide).
- **The count.** Per step: the step that wrote `asked`. Per agent: the `by` on that `asked` entry.
  The share that needed a person is a fold, never stored. It is the second measure in
  [autonomy is measured trust](./autonomy-is-measured-trust.md#m5-asks-that-did-not-need-a-person).
- **Not A5's agreement.** A5 counts whether the person took the rec. `needed` says whether the
  question should have reached a person at all. A yes to the rec with `needed: true` is common: the
  rec was right, and it still needed a person's say.
- **What holds it.** Only a person writes `answered`, so only a person writes the mark. A chat
  answer may carry it too, when the person says so in chat.
- **Doubt.** A person in a hurry may skip the mark most of the time, so the count is a sample. The
  share of answers that carry a mark is itself a fold, and says how far to trust it.

## What the ledger records

| Fact | Field | Lost forever if not recorded now |
|---|---|---|
| `asked` | `rec`, with `why`, `cost`, `sure` | What the step would have done, before it saw the answer. A rec written after cannot be trusted. |
| `answered` | `answer` (`rec`, `against`, `chose`) and `took` (`key`, `rec`, `ms`, `opened`, `said`) | Which key, how long the ask was on screen, what was opened, whether the rec was in view. |
| `answered` | `needed`, optional | Whether the person thought the ask needed them at all. |
| `rule_made`, `rule_dropped` | `match`, `seen`, `from`, `why` | What the offer showed when the person said yes to it. |
| `auto` | `ask`, `rule`, `pick` | That code, not a person, took the pick, and under which rule. |

Derived later, from the log: agreement per kind, minutes per kind, the header's estimate, attention
per merged ticket, the weekly cost of a kind.

## A tryout in today's version

Small fixes offered, not filed. Sizes in lines and agent hours.

1. **Answer from the asks list (ticket 102).** Rows carry `picks` and the rec; `y`, `n` and `h` on
   the active row, with a button for each, through the ask box's `answer` act. About 150 to 250
   lines with tests, 2 to 3 agent hours. Until it lands, a press in the popup opens the ticket and
   the answer finishes there (Q1, decided 2026-11-02). The asks tile, opened by `Enter` or "Open
   all", is built as part of the ask desk (Q2, decided 2026-11-02), on the first path that opens a
   tile with content: about 150 to 250 lines more, 2 to 3 agent hours.
2. **Record `took` on `answered`.** An optional field on the tracker's `answered`
   (`ticket.ts:347-353`): key, ms, opened. About 40 lines, 1 agent hour. Every answer before it
   loses these.
3. **The lane writes `rec` on `asked`.** For `approve`, the rec is approve when every open question
   has a lean, with the lowest `sure`. For the rest, the step's own first pick, marked `sure` unknown
   until a step says. About 60 lines, 1 agent hour.
4. **A required note on `no`.** The ask box refuses `no` with an empty note. About 15 lines.

## Where this differs from settled notes

- **[Every wait is a queue](./every-wait-is-a-queue.md)** (proposed) says first in, first out. Call 4
  groups by kind inside it.
- **[One ask, one meter](./one-ask-and-one-meter.md)** (proposed) has `answered {pick, note}`. This
  note makes it `answer` (a union) plus `took`, and adds `rec` on `asked`.
- **[AGENTS.md](../../AGENTS.md#how-a-change-lands):** "no agent answers a question
  the machine put to a person". A rule does not break it: the person makes the rule, as a person's
  fact, and once it holds the machine does not put that question to a person. `auto` is code's fact
  and never looks like a person's. It does move judgments to code, which
  [jidoka](./jidoka-and-andon.md) allows when a person says so.
- **[Triage asks when worth is unclear](../../.decisions/0377-triage-asks-when-worth-is-unclear.md)** is unchanged: A5
  lowers the load only through rules the owner makes, never through a cap.
- **[Popovers](./popovers.md)** (settled 2026-10-30) says the asks list "never opens a new tile". "Open all"
  does, so that line changes if this lands, with the five rules above.
- **[Tile guidelines](./tile-guidelines.md)** (decided 2026-11-01) send focus, when a tile closes,
  to the next open tile in reading order (`apps/fabrika/src/desk/desk.ts:415`, `heirOf`). The way back here sends it to the tile the asks tile
  was opened from, as a popover returns focus where it was. One of the two must give; the
  experiment's pattern P4 holds the case for each.

## What it costs

About 900 to 1,400 lines across the facts, the asks program's two views, the keys, the rules, the
first path that opens a tile with content, and their laws, and 13 to 18 agent hours, most of it after
the one ask (ticket 90) lands. The tryouts in today's version are about 420 to 620 lines and 7 to 8
agent hours.

## What it cannot tell us

- How long a real ask takes. Ticket 117's 71 to 121 seconds include the wait before looking.
- Whether kinds are narrow enough to match on. Nobody has counted agreement per kind.
- How much a blind ask slows a person, or annoys them.
- Whether a step's percent sure is calibrated: six leans at 95 to 99, all taken, is not a sample.
- Any screen reader behavior. A real VoiceOver run is needed for: the selected row read as
  selected with `aria-selected` (Q4); the question read before the rec;
  the status after `y` read without a focus move; the note field reached right after `n`; the offer
  line read once.
- Whether 30 is right for kinds whose wrong pick costs very different amounts.
- Whether the ticket's properties still read as their own group without their box in a narrow tile
  (Q5). The look step shot the card, not that case; the build's narrow shots settle it.
- Whether the tile rules hold in the real desk. The page's demo is a drawing of the window in a
  browser, not the app: its layout tree, its folding and its focus moves are a sketch of today's
  rules, not today's code.
