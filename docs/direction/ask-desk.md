# The ask desk: most asks are one key, and the desk learns from the answers

**Proposed 2026-11-02.** Decided by the owner before this note, and not asked again: asks to the
owner are fine, even many; the 10% to 30% call stands
([triage asks when worth is unclear](./triage-asks-when-worth-is-unclear.md), about 105 to 190 asks
a week); the owner makes every decision the system thinks needs them. What is needed is a desk where
most asks are one key in one sitting ("approve", "do your rec", or "no, with a note"), and a desk
that learns from the owner's answers so the system automates better over time. Folded in the same
day, from [experiment 185](../../experiments/185-dsh-superagent-study.md)'s "steal 1": attention is
a counted cost, per merged ticket, and a design that asks a person says what it costs them a week.
It is data the desk records, not a budget that cuts asks.

Built from [experiment 196](../../experiments/196-ask-desk.md), which read about 18 makers and
papers and checked ticket 117's real asks against them, and a private page, "Ask desk guidelines",
with a desk you answer with the keys. Neither is a measurement. It builds on
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
open the desk     4 asks, about 2 min                       header: count, and minutes per kind
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

- **`next/`:** all of it, with the asks list in Tier 5 ([tiers](../plan/tiers.md)) and the desk as a
  program from Tier 2. The facts land with the one ask (ticket 90) in whatever tier first asks a
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
	chose: {pick: Pick},                     // no rec in view (blind, or none): pick freely
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

## The six principles

### A1: one queue, one ask at a time

**Lean, 85%.** Every ask a person owes is in one queue, oldest first, shown one at a time, with how
many and about how long at the top.

- **What it means.** The desk draws the head ask whole and the rest as a count: "4 asks, about 2
  min". After an answer, the next ask is drawn in the same place, and focus stays. `j` and `k` move
  through the queue; `h` sets one aside, as the asks list's `H` does today.
- **Why.** Linear's triage is "a special inbox for your team" with one key per action [l1];
  Superhuman: "Mark Done with E and keep triaging from the next conversation" [s1]. The minutes come
  from the person's own past answers per kind (`took.ms`, below); until there are 20 of a kind, 30
  seconds a kind, experiment 163's guess, marked "about".
- **Linear.** One triage inbox per team, `J` and `K` to move, `H` to snooze [l1][l2]. We match it,
  with one queue across every ticket and repository, since one person answers them all.
- **Elm or OTP.** The queue is a view of a fold over the ledger, as today's asks machine is
  (`asks.ts:1-40`). Each ask is a parked `gen_server:call` waiting for one reply [o1]; the desk is
  where the reply is made.
- **What holds it.** One source: the asks machine feeds the top bar, the badge and the desk alike,
  so they cannot tell two stories (`asks.ts:15-20`). A law: the desk's count equals the asks list's.
- **Accessibility.** After each answer, a polite status says what happened and how many are left
  ("Approved. 3 left."), without moving focus (WCAG 4.1.3 [w2]). Focus stays on the ask region
  (2.4.3).
- **Doubt.** Same-kind grouping reorders a queue that [every wait is a queue](./every-wait-is-a-queue.md)
  says is first in, first out (call 4).
- **Cost.** In `next/`, the desk program's queue view, about 150 to 250 lines with laws, 2 agent
  hours.
- **Today.** **Half.** The asks list is one queue, oldest first (`asks.ts:250-276`), but an answer
  means opening the ticket (`frame.tsx:431`), and the top bar says how many, not how long.

### A2: the question in one line, the rec beside it, the evidence folded

**Lean, 85%.** The ask is one line. Beside it sits the step's rec: the pick, why, what it costs and
how sure, in words. The evidence is folded under it, one press to open.

- **What it means.** "Approve plan version 2?" then "Rec: approve · 95% · 3 open questions, each
  with a lean · the exam step runs next, about 4 agent minutes". `space` unfolds the evidence (the
  plan's questions and leans, the diff, what each pick does) under the question, which stays in
  view. An ask with no rec says so in words ("No rec: the price is unknown"), and `y` is not offered.
- **Why.** Linear: "Accept, decline, or view more information about why a suggestion was made" [l3].
  Goddard: showing confidence beside advice and making the person accountable lower automation bias
  [a3]. SRE: "Every page should be actionable" [t1].
- **Linear.** Triage Intelligence shows a suggestion with a "why" behind a press [l3]. We add cost
  and how sure, which Linear does not show.
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

### A3: three keys, and only where focus is

**Lean, 80%.** `y` takes the rec. `n` refuses it and opens a note, which is required. `o` opens
every pick. The keys work only while the desk has focus.

- **What it means.** One press for most asks. `n` means "not the rec": with two picks it takes the
  other one, with more it opens the rest; either way a one-line note says why, and it goes to the
  step that runs next. `o` lists every pick by number, rec included, for a person who wants to see
  them all. A click does the same as each key.
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
  person can turn them off or remap them [w2]. Both hold: the keys live on the desk's region, and
  [keybindings](./keybindings-are-configurable.md) remaps them. Every key has a button (2.1.1).
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
  ([triage asks](./triage-asks-when-worth-is-unclear.md)). The type says so: `Automatable`.
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
// a: the asks list answers, with y, n and o, through the ask box's same write (lean; ticket 102)
// b: a desk tile, its own program
```

**Lean a, 75%.** Why: ticket 102 already leans it, one component and the same `answered` fact.
Cost: the list's rows must carry picks (`asks.ts:49-66` has none). Doubt: whether a short popover
gives a plan enough room; the fold (A2) is the test. In `next/`, the desk is a program (Tier 2), so
b is where `next/` lands either way.

## What the ledger records

| Fact | Field | Lost forever if not recorded now |
|---|---|---|
| `asked` | `rec`, with `why`, `cost`, `sure` | What the step would have done, before it saw the answer. A rec written after cannot be trusted. |
| `answered` | `answer` (`rec`, `against`, `chose`) and `took` (`key`, `rec`, `ms`, `opened`, `said`) | Which key, how long the ask was on screen, what was opened, whether the rec was in view. |
| `rule_made`, `rule_dropped` | `match`, `seen`, `from`, `why` | What the offer showed when the person said yes to it. |
| `auto` | `ask`, `rule`, `pick` | That code, not a person, took the pick, and under which rule. |

Derived later, from the log: agreement per kind, minutes per kind, the header's estimate, attention
per merged ticket, the weekly cost of a kind.

## A tryout in today's version

Small fixes offered, not filed. Sizes in lines and agent hours.

1. **Answer from the asks list (ticket 102).** Rows carry `picks`; `y`, `n` and `o` on the active
   row, through the ask box's `answer` act. About 150 to 250 lines with tests, 2 to 3 agent hours.
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
- **[AGENTS.md](../../AGENTS.md#running-the-machine-on-a-real-ticket):** "no agent answers a question
  the machine put to a person". A rule does not break it: the person makes the rule, as a person's
  fact, and once it holds the machine does not put that question to a person. `auto` is code's fact
  and never looks like a person's. It does move judgments to code, which
  [jidoka](./jidoka-and-andon.md) allows when a person says so.
- **[Triage asks when worth is unclear](./triage-asks-when-worth-is-unclear.md)** is unchanged: A5
  lowers the load only through rules the owner makes, never through a cap.

## What it costs

About 700 to 1,100 lines across the facts, the desk view, the keys, the rules and their laws, and 10
to 14 agent hours, most of it after the one ask (ticket 90) lands. The tryouts in today's version are
about 270 to 370 lines and 5 agent hours.

## What it cannot tell us

- How long a real ask takes. Ticket 117's 71 to 121 seconds include the wait before looking.
- Whether kinds are narrow enough to match on. Nobody has counted agreement per kind.
- How much a blind ask slows a person, or annoys them.
- Whether a step's percent sure is calibrated: six leans at 95 to 99, all taken, is not a sample.
- Any screen reader behavior. A real VoiceOver run is needed for: the question read before the rec;
  the status after `y` read without a focus move; the note field reached right after `n`; the offer
  line read once.
- Whether 30 is right for kinds whose wrong pick costs very different amounts.
