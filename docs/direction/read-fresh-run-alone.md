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
