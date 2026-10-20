# The ledger sits behind a service, and code hosting behind another

Decided 2026-10-11. Both names are working names.

*2026-10-19: `Ledger` now belongs to tea-host, which gives it to the programs
it runs; `CodeHost` stays with fabrika. See [tea-host](./tea-host.md).*

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

## Claims are ledger facts: one lane a ticket

Built 2026-10-18, in `wip/src/asks/claims.ts` and `wip/src/asks/ledger.ts`.

```ts
// three facts
{ type: "lane", ticket }              // a lane began; its id comes from this fact's place
{ type: "claimed", ticket, lane }     // a lane took the ticket
{ type: "released", ticket, lane }    // a lane let it go

// a compare-and-set append: lands only if nothing came in since `after`
ledger.appendAfter(after, fact)       // → the entry, or null: read again
```

- **First claim wins until released.**
  - Who holds a ticket is a fold over these facts, kept nowhere else.
  - A later claim changes nothing. A release from a lane that does not hold
    the ticket changes nothing.
- **The claim is one compare-and-set.** Two lanes that both read the ticket
  free cannot both write a claim: the second sees a new fact, reads again, and
  is told who holds it.
- **The loop claims first and lets go before it ends.** Build and ship refuse
  a lane that does not hold the ticket. A loop that finds it held ends
  `skip:claimed`; one that cannot read the ledger ends `stuck:claim`.
- **Why:** experiment 91 found two lanes working one ticket, and through that,
  a failed head landing. With the claim, its two-lane worlds keep every law.
- **Still open:** there is no lease or expiry. A failed release is retried
  only by the tidy-up.

## The ledger kept on disk

Built 2026-10-19, in `wip/src/asks/ledger-disk.ts`: the same `Ledger`
service, over one JSONL file. fabrika's tsh hands it to operate
(`wip/src/tsh/fabrika-main.ts`); tests keep `memoryLedger`.

```ts
// one fact per line; a fact's place is its line number, from 1
{"type":"lane","ticket":"o/r#7"}
{"type":"claimed","ticket":"o/r#7","lane":"L1"}

diskLedger(file)                      // Layer<Ledger, never, FileSystem | Path>
// <TSH_HOME>/ledgers/github/<owner>/<name>.jsonl         a repository tsh.toml names
// <TSH_HOME>/ledgers/folders/<name>-<12 hex>.jsonl       a folder, or a clone named alone
```

- **Every read folds the file again.** A fresh process, or a fresh layer
  over the same file, folds the same state as the in-memory ledger fed the
  same calls (tested on experiment 89's plans, three lanes, review rounds,
  answers and a ship, over two runs).
- **`appendAfter` is one compare-and-set across processes.** A write takes
  `<file>.lock`, made with O_EXCL; under it, it counts the whole lines,
  compares, and appends. Four processes racing for one ticket forty times
  write one claim each time.
- **A torn last line is not a fact.** Bytes after the last newline are
  skipped on read, and cut off by the next writer, under the lock.
- **A line that is not a fact stops the read**, naming the file and line.
- **Still open:** the desk's ledger is still in memory, apart from
  operate's. A writer killed while it holds the lock leaves the lock file,
  and every later write fails after 10 seconds, naming it, until a person
  removes it. A file or lock error is a defect: the service has no error
  channel.

## Open

- The names.
- Where a review verdict lives. It is part of the record, but today it is
  written as a comment on the pull request.
- Whether `Worktrees` stays its own service or joins `CodeHost`.
