# The ledger sits behind a service, and code hosting behind another

Decided 2026-10-11. Both names are working names.

*2026-10-19: `Ledger` now belongs to tea-host, which gives it to the programs
it runs; `CodeHost` stays with fabrika. See [tea-host](./tea-host.md).*

*2026-10-24, said again by the owner: the end state is fabrika's own tracker,
a Linear-like one inside fabrika. Agents and people talk through the ledger,
not through GitHub issues. GitHub issues stay a backend for now and nothing is
built on them. Each machine in the rebuild is checked for this: everything it
writes that is not code goes to the ledger as a fact. A comment or label on
GitHub is a mirror, off by default.*

```ts
// Sketch: what triage writes in the rebuild. One fact; closed or not follows from the answer.
{fact: "triaged", ticket: "t-389", answer: {answer: "accept", to: "plan", why: "…"}}
// Today it writes a GitHub comment, a label and a close instead (stages/sort/writes.ts).
```

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
  verdicts. A second implementation can keep all of it in local files.
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

*2026-10-25: checks move to their own `Ci` service. With our own runners, the
place that ran them is not the code host. `CodeHost` keeps pull requests,
can-it-merge and the queue. See
[the services fabrika needs](./services-and-our-own-ci.md).*

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

## Claims are the ledger's leases: one lane a ticket

Built 2026-10-18 as facts (`claimed`, folded by a compare-and-set append).
Since 2026-10-21 (experiment 110) a claim is the tea-host ledger's lease on
the ticket's name, in `packages/pipeline/src/asks/claims.ts` (its own package since
experiment 114).

```ts
// two facts
{ type: "lane", ticket }              // a lane began; its id is L + this fact's rev in the ticket's inbox
{ type: "released", ticket, lane }    // a lane let it go, written under its lease

// the claim: the ledger's own calls on pipeline/ticket/<ticket>
ledger.register(name, lane)           // once; idempotent
ledger.claim(name, lane, rev, ttlMs)  // → a fence, or Held { holder }
ledger.renew(name, fence, ttlMs)      // every third of the ttl, from the holder's process
ledger.renew(name, fence, 0)          // release: the lease ends at once
```

- **First claim wins until released or lost.**
  - Who holds a ticket is the lease, kept nowhere else.
  - A later claim is told who holds it (`Held`). A release from a lane that
    does not hold the ticket changes nothing.
- **The claim is the ledger's compare-and-set.** Two processes that both see
  the ticket free cannot both claim it.
- **A lost lease fences the old holder.** A process that dies, freezes or
  loses the ledger stops renewing; the lease runs out, the next claim takes
  the name with a new fence, and every write under the old fence is refused.
- **A lane started again after a crash, as the same lane, waits its old lease
  out** and claims again. The loop's door (`holding`) does that too.
- **The loop claims first and lets go before it ends.** Build and ship refuse
  a lane that does not hold the ticket. A loop that finds it held ends
  `skip:claimed`; one that cannot read the ledger ends `stuck:claim`.
- **Why:** experiment 91 found two lanes working one ticket, and through that,
  a failed head landing. With the claim, its two-lane worlds keep every law.

## The pipeline's facts on the tea-host ledger

Built 2026-10-21 (experiment 110), in `packages/pipeline/src/asks/ledger.ts`.
It replaced the JSONL file of 2026-10-19 (`ledger-disk.ts`) and the desk's
in-memory ledger: operate, the desk and the review record read one store.

```ts
// a fact's home is a ticket or a plan; each name has two streams
pipeline/ticket/<owner/repo#n>/facts  // fenced: only the lease holder writes
pipeline/ticket/<owner/repo#n>/inbox  // open: anyone sends, deduped by message id
pipeline/plan/<owner/repo#n>/inbox    // plans are never claimed: everything is sent

sendFact(fact, {id})                  // to its home's inbox
appendFact(fact, hold)                // under the lease, when the home is the held ticket
readFacts                             // every fact, oldest first; a fact's place is its ordinal

// tsh: one node:sqlite file per repository
// <TSH_HOME>/ledgers/github/<owner>/<name>.sqlite         a repository tsh.toml names
// <TSH_HOME>/ledgers/folders/<name>-<12 hex>.sqlite       a folder, or a clone named alone
```

- **Every read folds the ledger again.** A fresh process, or a fresh layer
  over the same file, folds the same state as the in-memory ledger fed the
  same calls (tested on experiment 89's plans, three lanes, review rounds,
  answers and a ship, over two runs).
- **A row that is not a fact stops the read**, naming its place and stream.
  So does a fact read back from a name that is not its home.
- **The same code runs on every ledger Layer:** memory in tests and the demo
  desk, node:sqlite in tsh, the Durable Object over HTTP.
- **Still open:** which ledger tsh uses, and where that is configured.

## Open

- The names.
- Where a review verdict lives. It is part of the record, but today it is
  written as a comment on the pull request.
- Whether `Worktrees` stays its own service or joins `CodeHost`.
