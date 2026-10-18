# Sort answers yes or no

Decided 2026-10-18.

## What was decided

- **Sort answers yes or no.** There is no "later", no snooze and no priority.
  - **yes**: worth doing; the ticket goes on.
  - **no**: closed, with a one-line reason.
- **Every "no" carries its reason.** For example "not now: nobody needs this
  yet" or "won't do: out of scope". A reader can tell which ones are worth
  bringing back.
- **"Later" is a reopened "no".** A reopen goes back through sort, which reads
  everything fresh. There is no separate path.
- **Sort's duplicate check reads closed tickets too.** A new report about the
  same thing finds the old "no" and its reason, so a reopen needs no clock.

## Why

- **A "later" needs something that wakes it.** A date or a condition needs a
  scheduled run, and what a scheduled run means here is not designed yet.
  Yes / no needs nothing that expires.
- **A bare "later" rots.** Backlog, postponed and deferred piles in large open
  projects come back only when someone remembers, or a stale bot closes them.
  None of the AI triage tools studied decides "not now" by itself.
- **Priority was already doing this quietly.** On the replayed repos, a low
  priority mostly meant "not now": low-priority features reached a PR far less
  often than the next level up. A "no" with a reason says that out loud.
- **It fits [the smallest ledger](./smallest-ledger-proof-to-grow.md).** No new
  field: an open ticket that sort said yes to is worth planning. A "yes" is not
  approval to build; who sets that flag is open (see below).

## What it means for the work

- Sort's output is one of: duplicate of N, yes, no with a reason. What a "yes"
  needs next (a plan, an owner's ruling, research) is a separate open question.
- Closed tickets stay readable by the duplicate check, reasons included.

## Still open

- **Who approves building.** Lean: the owner, on the plan, while the owner's
  look at plans is the answer key; checks take over only once they match that
  look over several batches.

## What would change it

Good tickets that stay closed because nobody reports them again, while a
person keeps reopening them by hand. That would be the run that proves a
"later" with a wake-up is needed, and a scheduled run with it.
