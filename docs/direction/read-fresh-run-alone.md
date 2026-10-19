# Read fresh, run alone

Decided 2026-10-11, while sketching the ship machine.

## What was decided

Two rules that come as a pair.

- **A stage reads the facts fresh at the moment it acts.** It does not trust
  what the parent machine remembers from an earlier step. Before the ship
  machine puts a pull request in the merge queue, it reads the approval, the
  reviews, the checks and the open comments again, at the exact commit it is
  about to land.
- **So every stage machine can run alone.** Its input is small (for ship: one
  pull request). Everything else it reads for itself. It can be started by a
  parent machine, or by hand on one pull request, and it behaves the same.

## Why

- Facts go stale. Between a review passing and the ticket reaching ship,
  someone can push a commit, checks can go red, or the main branch can move.
  The fresh read is the only one about the thing actually being merged.
- In code a read costs a call and a second. The habit of "do not ask twice"
  comes from the agent world, where every read is a slow, paid turn. It does
  not carry over.
- A stage that needs nothing from its parent's memory is easy to test, easy to
  swap in, and useful by itself before the whole pipeline exists.

## What it means for the work

- If a fresh read and a remembered fact disagree, the fresh read wins.
- A stage's input type stays small: an id, not a bundle of facts gathered
  earlier.
- Each stage machine gets a way to be run alone, and tests that run it alone.
- Reading twice is fine. Writing twice is not: a stage still ends by writing
  exactly one fact to the ledger.

## Built in ship: a read at each write

Built 2026-10-18, in `wip/src/stages/ship/door.ts`.

```ts
const door = atTheDoor(cmd.ready, yield* readFacts(cmd.ready.pr));
if ("stale" in door) return "stale";        // the machine reads again
return yield* writes.enqueue(door.write);   // the proof made just now
```

- **Each write reads the facts again,** right before it goes out: the
  enqueue and the merge.
  - The fresh facts go through the same gate. The proof written is the one
    made from that read, never the one the Cmd carried.
  - If the fresh read no longer goes, the write answers `stale`, nothing is
    written, and the machine reads again.
- **The merge door also reads main.**
  - With no merge queue, a head must have been tested on main as it is now.
  - If main moved on since the head left it, the door ends `behind`, and ship
    sends it back (`send:builder:behind`).
  - An enqueue needs no such check: the queue tests the head on top of main.
- **Why:** experiment 91 found a fail posted between ship's read and its
  write still landing, and a head merged onto a main it was never tested on.
- **Still open** (experiment 91, "After the fixes"):
  - GitHub's merge call pins the head only, so a push to main between the
    door's read and the merge is not caught.
  - Ship checks once; a head already in the queue is not pulled back. A fail
    posted after that would still land. The ticket claim
    ([ledger](./ledger-behind-a-service.md)) is what stops it: one lane a
    ticket, one review a head.
  - The builder is told `behind`, but nothing in build takes main in yet.
