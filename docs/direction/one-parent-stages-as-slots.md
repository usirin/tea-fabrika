# One parent, stages as slots

**Proposed** 2026-10-11. Not settled.

*2026-10-11, later: the first swap is built. The operator machine can fill its
ship stage with the ship machine (`createOperator(slots, { ship: "machine" })`,
`SHIP=machine` in `src/operate.ts`). It is off by default, tested against
scripted services only, and not yet run on a real ticket. See "Under the
operator" in [`../ship-machine.md`](../ship-machine.md).*

## The situation

There are two generations of machine in `src/`:

- **The factory** (`factory.ts`): the whole pipeline as one machine, holding
  triage, the lane and ship as children, with this repo's own agents and its
  own ticket state. Built first.
- **The operator** (`operator.ts`, `turn.ts`): drives one ticket through build,
  review and ship by starting today's fabrika agents and reading fabrika's
  ledger. Built on the six moves and the combos. It has merged real tickets.

They sit side by side. Neither knows the other exists. The expected end state
is one pipeline, with the stage machines running inside a parent.

## What is proposed

- **A new parent**, written with the six moves and the typed backend services.
  Not the old factory with the operator pushed into it, and not a start from
  nothing.
- **Each stage is a slot.** A slot is filled either by "start today's fabrika
  agent" (what the operator does now) or by a real stage machine. From the
  outside both look the same: they end by writing exactly one fact to the
  ledger.
- **Slots are swapped one at a time**, so the pipeline keeps working while one
  stage after another becomes code.

## What a read of the code found

- The operator already works this way. Its routing table maps a ticket state to
  a kind of route, and one stage (waiting in the merge queue) is already run by
  code alone. A code-run stage is one more kind of route.
- None of the four older stage machines can be moved in as it is. Each keeps
  its own ticket state and knows nothing about fabrika's ledger. Their worth is
  their rules and their tests, read as a list of lessons.
- The old factory's parent is mostly hand-offs and state migration. The typed
  hand-off is worth keeping; the rest is not needed.

## Suggested order

Ship, then review, then build, then triage. Risk and tangle go up in that
order. The cost is that the money is in build, and ship saves the least.

## Open questions

- Does today's fabrika accept a "queued" fact written by the driver instead of
  by a shipper agent?
- Red checks: straight back to the builder, or to the reviewer first?
- Where is triage's result written: the ticket body, labels, or the ledger?
- Can build be rebuilt before triage gives it criteria as data?
- Unresolved bot comments on a pull request: a person, or back to the builder?
- Does a stage keep its state in the parent, or is it rebuilt from the ledger
  on every pass?
