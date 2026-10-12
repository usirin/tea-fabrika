# A review list can only shrink

Proposed 2026-10-11. An idea being worked out, not a decision. It belongs to
the review machine, which is not designed yet.

2026-10-11: the review stage is the next stage to be rethought, and it is
treated as a test of how far a review can be done in code.

2026-10-11, after experiments 57 and 58: both tested this idea on the
recorded reviews. This note now holds what they measured and which parts of
the idea that puts in question. It decides nothing. Where the first draft
was wrong, the old claim stays here, marked as wrong.

```ts
// Round 1: the reviewer reads everything and writes the whole list.
open = [f1, f2, f3]

// Round 2: the reviewer may only answer for that list, and for lines the repair wrote.
open = [f2]          // shorter → another lap is worth it

// A lap that does not shorten the list.
open = [f2]          // the same → stop, and tell a person
```

The loop ends by itself. The first draft also said here that no number is
chosen anywhere. **That was wrong.**
[Experiment 58](../../experiments/58-shrinking-list-replay.md) found the
number. The usual list has one finding, and a list of one cannot get shorter
without passing. So "stop when the list is not shorter" means one repair try.
That is a number, and it is lower than today's cap of 2 or 3.

## The problem it answers

Today's fabrika caps the loop with counters: so many repair rounds per ticket,
then stop. The counters were a guard for a driver that was an agent and could
lose the plot. Here the driver is code. Carrying the counters over would be a
port, not a rethink (see [Rethink, do not port](./rethink-do-not-port.md)).

A cap in dollars or hours is the same guard in another unit. It is still a
number someone has to guess.

What a cap hides is why the loop runs.
[Experiment 54](../../experiments/54-why-reviews-fail.md) read 218 second and
later failed reviews, and placed 312 of their findings by a rule of thumb.

```text
as experiment 54 placed them

25%  were raised in an earlier round
17%  were about lines the repair wrote
58%  were about text that was already there a round earlier, and nobody had raised

read by hand since

58%  wrong. About 31% were already there and missed (24% to 38%).   experiment 57
25%  too high as a count of repeats. Of 20 "raised before" read,    experiment 58
     4 were the same finding, still open.
```

**The 58% was a guess that turned out wrong.** Only six cases had been read
when this note was written.
[Experiment 57](../../experiments/57-repeat-findings-read-by-hand.md) drew 60
of the 181 and read each against the code at both commits. 32 were missed, 18
were new since the earlier review, 3 had been raised before and 7 were not
problems. For half of the 181 no quote is in any file, so the rule placed
them with nothing to go on.

The first draft went on to say that most repeat rounds were the reviewer
finding new old things. That is too strong. Old text nobody had raised is
about a third of placed later-round findings, not most of them.

One part of that sentence holds. Repeat rounds are mostly not the builder
failing to fix what it was sent. Experiment 58 puts that at about one later
finding in eight.

## The idea

Review once, fully. After that, only the list is checked.

- The first review writes every finding as data, each with its own identity.
- A later round answers one narrow question per finding: is this one fixed?
  It may also read the lines the repair wrote, and nothing else.
- The loop goes on while the list gets shorter. A lap that leaves it the same
  stops and goes to a person, with the list.

Like a snag list on a house: the inspector walks through once and writes
everything down. On every later visit the list is checked, and the house is
not walked again.

This is the rule as first written. Experiment 58 replayed exactly this.

## What the replay showed

Experiment 58 walked the rule over 525 recorded review loops, 152 of which
fail again after the first round. Every review in that record was written by
today's fabrika, on kamp-us/phoenix. The rule is this repo's proposal and no
machine runs it. No reviewer ran for either experiment.

| Question | What came back | Experiment |
|---|---|---|
| How much of a later round was already there and missed? | About 31% of placed findings (24% to 38%), from 60 read by hand. 31.7% of 281 by git. | 57, 58 |
| Does the list shrink? | Yes, mostly in one step. Of 682 steps from a failed round: 488 pass, 88 shorter, 75 the same, 31 longer. | 58 |
| What does the rule lock out? | 89 of 459 later-round findings by their quotes (19%). About a quarter with the hand samples, a fifth to a third. | 58 |
| Were the locked-out findings real? | 30 of 30 in the fixed sample (89% to 100%). 44 of 45 with 15 more read. | 58 |
| Could the first review have seen them? | Nearly all. Of 44 real ones: 16 the same fault in another place, 21 plain misses, 3 new since the first review. | 58 |
| What does the rule do to the 152 loops? | Passes early in 21 to 61. Stops for a person in 33 to 60, where today's cap stopped 33. | 58 |
| What happened after such a stop? | The record passed on the very next round in 39 of 60 and 23 of 33. | 58 |
| What does it save? | 24 to 101 rounds, about $53 to $224. That is 3% to 13% of the cost of all later rounds. | 58 |
| How much can code check again alone? | About 15% of findings (8% to 26%), 9 of 60 read. | 58 |

Each pair of numbers is the two ways to count a finding no quote can place:
as allowed, or as locked out. A hand sample says the truth sits nearer the
first number.

Experiment 58's own answer: the lists do shrink, and the rule as written
would still do harm. It works with an extra way in for late findings and a
looser stop. It is about 70% sure.

The harm is concrete. An early pass leaves 30 to 104 findings behind, locked
out or not placed. Of the locked-out ones read, 44 of 45 were real defects. On
[one pull request](https://github.com/kamp-us/phoenix/pull/9605) the rule
saves one round, about $2.22, and merges a back-button bug.

## What has to be typed, and what does not

Not every finding can be sorted into a kind. In experiment 54 a small model
was sure of the kind for about half of the findings, and about two thirds of
failed reviews needed a reader. So the kind is optional. The shape of a
finding is what gets a schema. This is the first sketch:

```ts
// The first sketch. Experiment 58 says what it lacks: see "Open".
const Finding = Schema.Struct({
  id: Schema.String,                                   // the same finding keeps its id across rounds
  where: Schema.optional(Schema.Struct({ file: Schema.String, lines: Schema.String })),
  says: Schema.String,                                 // prose, written by the reviewer, read by the builder
  kind: Schema.optional(FindingKind),                  // "red_check", "stale_text", … only when known
  state: Schema.Literals(["open", "fixed", "withdrawn", "moved_to_a_ticket"]),
});
```

What a finding is about stays prose. That it exists, where it points, and
whether it is still open is data. The loop only needs the second part.

The first draft said a finding with a known kind can go further: a red check
or a stale reference can be re-checked by code, with no reviewer run at all.
Experiment 58 tried both.

- **A red check: yes.** GitHub's record agrees with the reviewer on 88% of
  them, 65 of 74.
- **A stale reference: not on today's verdicts.** A check on the quoted line
  gave no signal. On 142 stale-text findings it agrees with the reviewer on
  74.6%, and always saying "fixed" would agree on 94%. The quote is more
  often the proof than the faulty line.

## Open

Experiment 58 ends with design input for the review machine. Each part below
is a question nobody has settled, with the evidence beside it.

### The stop

The rule stops on the first lap that does not shorten the list. For a list
of one, that is one repair try.

```ts
// A sketch. `flat` counts the laps so far that left the list no shorter,
// the way experiment 58's replay counted them.
type Loop = { open: Finding[]; flat: number };

const next = (loop: Loop, after: Finding[], stopAt: 1 | 2): Loop | "pass" | "ask_a_person" => {
  if (after.length === 0) return "pass";
  const flat = after.length < loop.open.length ? loop.flat : loop.flat + 1;
  return flat >= stopAt ? "ask_a_person" : { open: after, flat };
};

next({ open: [f2], flat: 0 }, [f2], 1);   // "ask_a_person": this note's rule
next({ open: [f2], flat: 0 }, [f2], 2);   // { open: [f2], flat: 1 }: one more lap
```

`stopAt` is the hidden number. Written out, it is a choice between 1 and 2.

- **Stop at 1, the rule as written.** It stops 33 to 60 of the 152 loops. In
  two stops of three the record passed on the very next round. Of 304 steps
  that start from one finding, 242 pass, 42 fail with one again and 20 fail
  with more.
- **Stop at 2, the alternative experiment 58 measured.** It stops 2 to 12
  loops, and they are the stuck ones. Of the 12, the record failed again in
  6, ended there in 3 and passed next in 3.
- **What 2 costs.** One more round, about $2.22, in the loops that are truly
  stuck. And it is a number someone chose, which is what this note set out to
  avoid.

Experiment 58 would stop at 2 and is 70% sure. Its doubt: the replay counts
list length by quotes, because no finding in the record has an id.

Open: which stop. And whether a chosen 2 is acceptable in an idea whose point
was to choose no number.

### The ways in

The first draft asked for "an honest way in" for a real problem found late.
Experiment 58 names four, and says the rule needs them.

| A later finding may join the list when | Evidence |
|---|---|
| The repair made old text false | 2 of 44 real locked-out findings in experiment 58. 3 of 60 in experiment 57. |
| The base branch moved | 1 of 44 in experiment 58. 6 of 60 in experiment 57. |
| It is the same fault as a listed finding, in another place | 16 of 44 in experiment 58. 16 of the 32 missed in experiment 57. |
| A person says yes | For the plain misses: 21 of 44 in experiment 58. |

- **The first three.** Experiment 58 would let them in and is 80% sure. They
  are 19 of the 44 real ones. The cost: a later round reads a little past
  the repair's lines.
- **A search for the same fault, before the builder starts.** 16 of the 44
  were the same fault in another place, and
  [one pull request](https://github.com/kamp-us/phoenix/pull/9542) needed
  three rounds for them. Experiment 58 is 50% sure a search per first-round
  finding catches half. The doubt is that one fault is worded three ways.
  Untested, and it can be tested for no money.
- **A person's yes for a plain miss.** Experiment 58 is 60% sure. Its doubt:
  if the answer is yes 44 times in 45, asking is paperwork, and letting the
  finding in for one more round is cheaper.

Open: whether the list may grow at all once these are in, and what keeps it
from growing every round. The stop above is the only guard so far.

### What a finding carries

Every check on a finding that failed in experiment 58 failed for one reason.
Today's verdicts quote the proof far more often than the faulty line. So the
first sketch's `where` is not enough. The finding needs the fault apart from
its proof, what counts as fixed, and where the finding came from.

```ts
// A sketch from experiment 58, not a design. The names are open. No machine uses it.
const Place = Schema.Struct({ file: Schema.String, line: Schema.String });

// How code can ask "is it fixed?" with no reader. Absent: a reader answers.
const Recheck = Schema.Union([
  Schema.Struct({ by: Schema.Literal("check_run"), name: Schema.String }),
  Schema.Struct({ by: Schema.Literal("merges_with_base") }),
  Schema.Struct({ by: Schema.Literal("issue_state"), issue: Schema.Number, want: Schema.Literals(["open", "closed"]) }),
  Schema.Struct({ by: Schema.Literal("path_exists"), path: Schema.String }),
  Schema.Struct({ by: Schema.Literal("pattern_gone"), pattern: Schema.String, under: Schema.String }),
]);

const Finding = Schema.Struct({
  id: Schema.String,
  round: Schema.Number,                 // the round that first wrote it
  says: Schema.String,                  // prose, for the builder
  wants: Schema.String,                 // what counts as fixed
  fault: Schema.optional(Place),        // the text at fault
  proof: Schema.Array(Place),           // lines quoted to show it, never checked for change
  sweep: Schema.optional(Schema.Struct({ pattern: Schema.String, under: Schema.String })),
  recheck: Schema.optional(Recheck),
  // Why a finding written after round 1 may join the list.
  from: Schema.Literals(["first_review", "repair_lines", "made_false_by_repair", "same_fault_elsewhere", "red_check", "base_moved", "a_person"]),
  state: Schema.Literals(["open", "fixed", "withdrawn", "moved_to_a_ticket"]),
});

const FirstReview = Schema.Struct({ at: Schema.String, whole: Schema.Boolean, findings: Schema.Array(Finding) });
```

What changed from the first sketch:

- **`where` became `fault` and `proof`.** Code may ask whether the faulty
  line is gone. It never asks that of a proof line.
- **`wants` is new.** The later question "is this one fixed?" is built from
  it.
- **`from` is new.** It names the way in, one value for each row of the table
  above and three more.
- **`kind` is not in it, and `recheck` is.** `recheck` says how code can
  check again, when code can.
- **`sweep` is new.** It is the search for the same fault in other places.
- **`whole` on the review is new.** It is false when the first review could
  not grade. In 37 of the 525 loops the first failed review was nothing but a
  red check, and the rule would treat that as the whole list.

Open: all of it. Nobody has asked a reviewer to write `fault` apart from
`proof`, so nobody knows how often it can.

### Still unmeasured, or measured and not settled

- **Is "fixed?" a narrow enough question for a small model?** Not on today's
  record. Jev was sure on 300 of 451 findings and sided with the next
  reviewer on 81.7% of those. Always saying "fixed" sides with the reviewer
  on 93%. Experiment 58 is about 40% sure it works once a finding carries
  `wants` and `fault`.
- **Does the first review get slower or worse when it must be complete?**
  Unmeasured. Experiment 58 calls this the largest unknown.
- **What does a narrow later round cost?** The saving on every later round is
  the idea's main promise. Nothing in the record prices it.
- **Laps nobody caused.** A conflict with main or a pull request thrown out
  of the merge queue sends work back with no finding at all. In experiment 57
  a moved base branch was behind 6 of 60 findings, and code can read that
  before any reviewer starts.
- **Loops with no list to shrink.** A FAIL after a PASS, in 9 loops and at
  least 5 more. Criteria added mid-loop. A finding with no line, such as a
  missing test.

## What would change this

The first draft named one test: a replay showing that later-round findings
are mostly real problems the first round could not have seen. Then the list
should be allowed to grow, and this idea is wrong.

**That test was run.** Real: yes, 44 of 45 read. Could not have seen: no,
about 3 of 44. So the idea passes its own test.

The test was too kind to the rule. A real defect that the first review missed
is still a real defect, and the rule as written merges it. Passing the test
does not make the rule safe.

What was not tested, because a replay cannot show it:

- **What a reviewer told to review once, fully, would catch.** The reviewers
  in the record knew another round would come. Experiment 58 calls this the
  largest unknown, and "review once, fully" is half of the idea.
- **What would have happened after a locked-out finding.** The later rounds
  in the record come from a loop where that finding was repaired.
- **Another repo.** Phoenix's skill pages are the product, and 31 of the 44
  real locked-out findings are text.

So this note's one test is used up, and the next one is not written. It has
to be about the first bullet, and it takes a live review, not a replay.
