# Nobody grades their own work

Decided 2026-10-04, the first night of the rebuild.

```ts
// The reviewer finds. Code checks. Code decides.
const findings = yield* reviewer.draft(pr);          // file, line, quote, says
const real = findings.filter(quoteIsInTheFile);      // a quote that is not there is dropped
const verdict = verdictOf(rows, real);               // pass or fail: worked out by code
```

## What was decided

- **The one who builds is not the one who judges.** Review is a different
  agent run from the build.
- **A judging agent is split into parts:**
  - the agent only finds;
  - code checks that each quote is really in the file;
  - a narrow question sorts each finding;
  - the machine says pass or fail. The reviewer never grades its own findings.
- **No agent approves.** An agent that posts something on a person's say-so
  says so in the post.

## Why

- A worker that grades itself has every reason to pass.
- A finding that quotes a line that is not there is caught for free by code.
- Pass or fail as code is the same every time and can be tested.

## What would change it

A review that a single agent does better end to end than the split, on real
pull requests, at the same cost.
