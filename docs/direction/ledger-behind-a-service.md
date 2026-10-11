# The ledger sits behind a service

Decided 2026-10-11. The shape is still open (see the end).

## What was decided

Today GitHub is fabrika's ledger, reached through the `gh` command-line tool:
tickets, labels, comments, claims, rulings, verdicts, pull requests, checks.

That goes behind an Effect service (working name: `Ledger`). GitHub is the
first implementation of it, not the thing itself. A second implementation can
keep everything in local JSONL files, so the parts of fabrika that need a
ledger work for someone who has no GitHub.

## Why

- A project tool should not need one hosting company to run.
- A local ledger makes the pipeline testable end to end with no network.
- It follows from [The backend is a library](./backend-as-a-library.md): code
  talks to typed services, never straight to a command-line tool.

## What it means for the work

- New code that reads or writes tickets, labels, comments, pull requests or
  checks goes through a typed service. No new direct `gh` calls.
- Pieces already exist here and should be folded in, not duplicated: the
  `Fabrika` service (the ticket's log), `Thread` (questions and replies on a
  ticket), `Worktrees`, and the older `tracker.ts` (fetching a ticket and its
  comments).

## Open: one service or two

GitHub does two different jobs today:

- **The record.** Tickets, labels, comments, claims, rulings, verdicts. A local
  file can hold all of it.
- **Code hosting.** Pull requests, checks, the merge queue. A file cannot be a
  merge queue; a local version would have to do this with git branches and test
  runs on the same machine.

Proposed: two services, so a local record can exist without first faking a
merge queue. Not settled. The cost is two things to wire instead of one.
