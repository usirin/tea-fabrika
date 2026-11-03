# We use the tools we build

**Decided 2026-10-27 by the owner.** The team works in tools built here, not in
bought ones. The tracker takes Linear's place first. fabrika itself is the
proof that a small team can now build and run its own tools: models are good
enough to write them, and one Cloudflare account runs the backend for about
$5 a month.

```ts
// A sketch. Every tool is a small program on the same ledger, in one Worker.
const programs = [tracker, board, ticketView, lanes, prWatcher /* , … */];
// One Worker per project: the project's object, one per person, one per lane.
//   Workers Paid: $5 a month, with 10 million requests, 1 million Durable
//   Object requests and 5 GB of SQLite storage in it.
```

## What was decided

- **Build before buy.** When the team needs a tool, the first answer is a
  program on the ledger. The tracker is first, built like Linear
  ([the tracker is like Linear](./the-tracker-is-like-linear.md)).
- **We use what we build, every day.** Daily use is the test: a program that
  feels worse than the tool it replaces is a bug to fix, not a reason to go
  back.
- **The backend stays one Cloudflare account on the $5 plan** for as long as
  the numbers allow. A piece that would push the bill well past it says so in
  its note, with the number.
- **What stays outside, for now.** GitHub stays the code host, reached through
  `CodeHost` ([tickets start in our tracker](./tickets-start-in-our-tracker.md)).
  The model providers stay outside. Each stays behind a service, so it can be
  swapped later ([backend as a library](./backend-as-a-library.md)).

## Why

- **It is the best test of fabrika itself.** Many small programs sharing one
  ledger is what the pipeline needs too. If the tracker, a board and a ticket
  view work well as separate programs, the model holds.
- **The tools fit our own work,** with agents built in from the start, not
  added on.
- **It costs little to run.** Cloudflare's Workers Paid plan is "$5 USD per
  month for an account", with 10 million requests, 1 million Durable Object
  requests and 5 GB of SQLite storage included
  ([Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/)).

**Cost:** we own the upkeep. Every feature Linear gives for free, we build.
Time spent on tools is time not spent on the pipeline. Box time on Cloudflare
Containers is billed past what the plan includes (375 vCPU-minutes and 25
GiB-hours of memory a month), so many agent runs in cloud boxes will cost more
than $5.

**How sure: 75%.** The doubts:

- Whether the upkeep stays small once two people use the tools all day.
  Daily use from v1's slice 14 on shows it.
- Whether keeping every job's trace forever
  ([a JobRecord holds each host job](./a-job-record-holds-its-trace.md),
  decided) stays inside 5 GB. Measure it once real lanes run.

## What it cannot tell us

- Which bought tool goes next after Linear. That waits for a need.
- What the bill is at all-day use. Nothing has been measured yet.
