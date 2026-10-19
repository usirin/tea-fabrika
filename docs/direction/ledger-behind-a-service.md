# The ledger sits behind a service, and code hosting behind another

Decided 2026-10-11. Both names are working names.

```ts
// Two services, because GitHub does two different jobs.
Ledger.ticket(id)        // the record: tickets, labels, comments, rulings, verdicts
CodeHost.prFacts(pr)     // the code side: pull requests, checks, "can it merge", the merge queue

// A project with no GitHub swaps one of them and keeps the other.
const local = Layer.merge(LedgerInJsonlFiles, CodeHostOnLocalGit);
const hosted = Layer.merge(LedgerOnGitHub, CodeHostOnGitHub);
```

## What was decided

Today GitHub is reached through the `gh` command-line tool for everything:
tickets, labels, comments, claims, rulings, verdicts, pull requests, checks.

That goes behind Effect services. GitHub is the first implementation, not the
thing itself.

Not every GitHub call belongs behind the ledger. GitHub does two jobs, and
each gets its own service:

- **`Ledger`: the record.** Tickets, labels, comments, claims, rulings,
  verdicts. A second implementation can keep all of it in local JSONL files.
- **`CodeHost`: where the code lives.** Pull requests, checks, whether a
  branch can merge, the merge queue. A file cannot be a merge queue; a local
  version would do this with git branches and test runs on the same machine.
- **The `Ledger` is designed with no GitHub in it** (decided 2026-10-12).
  Tickets, criteria, questions and answers, and review results follow our own
  contract; GitHub is one backend added after. `CodeHost` may stay shaped like
  GitHub, since that is where the code lives.

## How to tell which side a call is on

Ask: if the ledger were local files, would this still have to come from
wherever the code is hosted?

```ts
Ledger.comment(ticket, text)      // local files could hold it            → Ledger
Ledger.ruling(ticket)             // local files could hold it            → Ledger
CodeHost.checks(pr, head)         // only the place that ran them knows   → CodeHost
CodeHost.mergeable(pr)            // only the place holding the branches  → CodeHost
CodeHost.enqueue(pr, head)        // the queue lives with the code        → CodeHost
```

## Why

- A project tool should not need one hosting company to run.
- A local ledger makes the pipeline testable end to end with no network, and
  it can exist without first faking a merge queue.
- The ship machine showed the split: nearly everything it reads (checks,
  mergeable, the queue) is about code, not about the record.
- It follows from [The backend is a library](./backend-as-a-library.md): code
  talks to typed services, never straight to a command-line tool.

The cost: two things to wire instead of one.

## What it means for the work

- New code that reads or writes tickets, labels or comments goes through
  `Ledger`. New code that reads pull requests, checks or the queue goes
  through `CodeHost`. No new direct `gh` calls.
- Pieces already exist here and should be folded in, not duplicated: the
  `Fabrika` service (the ticket's log), `Thread` (questions and replies on a
  ticket), `Worktrees`, and the older `tracker.ts` (fetching a ticket and its
  comments).

## Open

- The names.
- Where a review verdict lives. It is part of the record, but today it is
  written as a comment on the pull request.
- Whether `Worktrees` stays its own service or joins `CodeHost`.
