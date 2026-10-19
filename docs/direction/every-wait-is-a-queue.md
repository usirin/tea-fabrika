# Every wait is a queue

Proposed 2026-10-18.

## The idea

- **Every state where work waits for someone is a queue.** Today's board
  labels already are: "needs triage", "needs decision", "ready for agent".
- **Each queue has one kind of reader:**
  - waiting for sort → sort;
  - a yes whose next step is plan → the planner;
  - a plan waiting for approval → the owner;
  - a ruling asked for → the owner;
  - a task of an approved plan → a builder;
  - a task built → the reviewer;
  - every task passed → ship, then the merge queue;
  - a stuck task → the owner. This is the dead-letter queue.
- **A queue is a view on the ledger,** not a second store: the tickets whose
  latest fact says they wait for this reader. Nothing is kept by hand, so a
  queue cannot drift from the record the way a label can.
- **A stage works its view through the kept work queue** (`wip/src/stages/queue.ts`):
  in order, one at a time per worker, picked up again after a restart.
- **Each queue is set by three things:** who reads it, how many at once, and in
  what order. Order is first in, first out; there is no priority
  ([sort answers yes or no](./sort-answers-yes-or-no.md)).
- **The owner's desk is one view:** every queue whose reader is a person
  ([packs are programs](./packs-are-programs.md)).

## Why

- Today's labels are queues kept by hand, and a label set by hand can
  disagree with what actually happened.
- A separate queue system would be a second record of the same facts.

## Open

- **How many at once, per stage.** Nothing caps builders yet, and nothing
  slows sort when builders fall behind.
- **How long a ticket has waited.** Not kept. Added when a run shows a queue
  going stale, by the [proof rule](./smallest-ledger-proof-to-grow.md).

## What would change it

A volume where reading the ledger for each queue is too slow, or two readers
that need the same queue in different orders.
