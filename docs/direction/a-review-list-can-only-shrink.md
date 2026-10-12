# A review list can only shrink

Proposed 2026-10-11. An idea being worked out, not a decision. It belongs to
the review machine, which is not designed yet.

2026-10-11: the review stage is the next stage to be rethought, and it is
treated as a test of how far a review can be done in code.

```ts
// Round 1: the reviewer reads everything and writes the whole list.
open = [f1, f2, f3]

// Round 2: the reviewer may only answer for that list, and for lines the repair wrote.
open = [f2]          // shorter → another lap is worth it

// A lap that does not shorten the list.
open = [f2]          // the same → stop, and tell a person
```

No number is chosen anywhere. The loop ends by itself.

## The problem it answers

Today's fabrika caps the loop with counters: so many repair rounds per ticket,
then stop. The counters were a guard for a driver that was an agent and could
lose the plot. Here the driver is code. Carrying the counters over would be a
port, not a rethink (see [Rethink, do not port](./rethink-do-not-port.md)).

A cap in dollars or hours is the same guard in another unit. It is still a
number someone has to guess.

What a cap hides is why the loop runs.
[Experiment 54](../../experiments/54-why-reviews-fail.md) read 218 second and
later failed reviews. Of the 312 findings it could place:

```text
25%  were raised in an earlier round
17%  were about lines the repair wrote
58%  were about text that was already there a round earlier, and nobody had raised
```

So most repeat rounds were not the builder failing to fix something. The
reviewer kept finding new old things. (The 58% did not hold.
[Experiment 57](../../experiments/57-repeat-findings-read-by-hand.md) read 60
of the 181 by hand. About 31% of the 312 were already there and missed, 24%
to 38%. So "most" is too strong: it is about a third. The rest of the 58%
were mostly new since the earlier review, and a few were not findings.)

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

## What has to be typed, and what does not

Not every finding can be sorted into a kind. In experiment 54 a small model
was sure of the kind for about half of the findings, and about two thirds of
failed reviews needed a reader. So the kind is optional. The shape of a
finding is what gets a schema:

```ts
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

A finding with a known kind can go further: a red check or a stale reference
can be re-checked by code, with no reviewer run at all.

## Open

- **A real problem found late.** Sometimes round 2 sees something true and
  important that round 1 missed. It needs an honest way in that does not
  reopen the whole review: a new ticket, or a person's yes.
- **Is "fixed?" a narrow enough question for a small model?** If so, later
  rounds cost almost nothing. Unmeasured.
- **Does the first review get slower or worse when it must be complete?**
  Unmeasured.
- **Laps nobody caused.** A conflict with main or a pull request thrown out of
  the merge queue sends work back to the builder with no finding at all. The
  list does not cover those. Whether they need any guard is open.

## What would change this

A replay over the recorded reviews showing that later-round findings are
mostly real problems the first round could not have seen. Then the list
should be allowed to grow, and this idea is wrong.
