---
state: "proposed 2026-11-05; walked at Tier 6"
summary: "Both versions. A strategy is the lane's answer to \"this gate isn't perfect, now what?\": fix forward, stop the line, ship dark or roll back. Fix forward ships good enough with each gap a ticket, and never skips a gate, merges red or changes a test. The line: can a later change undo the harm? Open: does a strategy belong to the ticket, the area or the step."
---

# Pipeline strategies: what a lane does when a gate is not perfect

**Proposed 2026-11-05.** Walked when Tier 6 starts (owner, 2026-11-08): pipeline stages and their gate strategies. The owner's idea, named on 2026-11-05: a strategy is the lane's answer to
"this gate isn't perfect, now what?" The owner drew the line between fixing forward and stopping
(proposed, below). Nothing else here is settled. Both versions: the pipeline's words are the same in
each.

```ts
// A sketch. Both versions. A strategy, and the one question that picks between the first two.
const Strategy = Schema.TaggedUnion({
	fix_forward: {filed: Schema.Array(TicketNumber)}, // ship good enough; each gap is a ticket
	stop_the_line: {why: Schema.String}, // the lane stops itself and says why
	ship_dark: {behind: Schema.String}, // ship it switched off, by a named setting
	roll_back: {to: Schema.String}, // undo a merged change: a revert, to this sha
});

// Can a later change undo the harm?
const Harm = Schema.TaggedUnion({
	undoable: {what: Schema.String}, // a dead button, a slow screen, a wrong word
	lasting: {what: Schema.String}, // lost data, a leaked secret
});

const allowed = (harm: typeof Harm.Type): ReadonlyArray<typeof Strategy.Type["_tag"]> =>
	harm._tag === "undoable"
		? ["fix_forward", "stop_the_line", "ship_dark", "roll_back"]
		: ["stop_the_line", "roll_back"]; // never forward past harm a change cannot undo
```

Ticket #7, "fabrika post prints the ticket number twice", traced two ways:

```text
review finds: `post --json` still prints the number twice     harm undoable: a wrong word
  -> fix_forward {filed: [new ticket]}    the fix ships; the gap is its own ticket, from: the review
review finds: the fix drops the ticket's last comment row      harm lasting: lost data
  -> stop_the_line {why: "drops a ledger row"}   the lane stops and saves where it goes on
```

## Which version

- **Both.** Today's lane (`packages/pipeline`, `programs/pipeline`) has no strategy today: a red
  check goes back to the builder, and a stuck lane stops ([jidoka and
  andon](./jidoka-and-andon.md)). `next/`'s pipeline would take the same words when it is built.

## The four

- **Fix forward.** The industry says roll forward. Ship good enough, with each gap filed as a ticket
  that says where it came from ([a ticket says where it came
  from](./a-ticket-says-where-it-came-from.md)). A break gets a new change, not a revert. It never
  skips a gate, never merges red, and never changes a test to pass ([nobody writes their own
  exam](./nobody-writes-their-own-exam.md)). [Autonomy is measured
  trust](./autonomy-is-measured-trust.md) already says a break is fixed forward and names the step
  that missed it.
- **Stop the line.** The lane stops itself, says why, and saves where it goes on. This is jidoka,
  already decided ([jidoka and andon](./jidoka-and-andon.md)).
- **Ship dark.** The change merges switched off, behind a named setting, and a person turns it on.
  The industry's names are a dark launch and a feature toggle
  ([Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)).
- **Roll back.** A merged change is undone by a revert. It is the one strategy that changes main
  backward, so it is for harm a later change cannot undo, or cannot undo fast enough.

## The line, and why

**Can a later change undo the harm?** Yes, such as a dead button or a slow screen: it may fix
forward. No, such as lost data or a leaked secret: it never does.

- **Why:** fixing forward is safe exactly when the next change can repair everything the last one
  did. A deleted row or a published key stays gone after any later change. This is AGENTS.md's
  "what fact is lost forever" question, asked of a merge.
- **Cost:** one question per gate's finding, and a `Harm` on each finding the lane acts on.
- **How sure:** 75% on the line. The doubt is the cases between: a schema change that later code can
  read around but old rows never regain. Those read as lasting until the owner says otherwise.

## Open

- **Who owns a strategy: the ticket, the area, or the step?** A ticket would let the owner pick
  per change. An [area](./areas.md) would let "the ledger" always stop the line. A step would let
  review fix forward while mutation stops. No lean.
- **Who names the harm.** A reviewer's finding today carries a rating
  ([every finding is rated](./every-finding-is-rated.md)), not a harm. Whether a Judge can answer
  "undoable or lasting?" well enough is not measured.
- **Whether ship dark fits a tool with two people.** A setting nobody turns on is dead code.

## Made up here

`Strategy`'s fields, `Harm` and its cases, `allowed`, the review findings in the trace, and the
names of the settings.

## What it cannot tell us

- Nothing ran. No lane has picked a strategy yet.
- How often each strategy would have been picked on past tickets. A read of `field/` could say.
- Whether the four are all. A canary (ship to one place first) may be a fifth.
