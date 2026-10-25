# The test writer

Decided 2026-10-24. It was called the verify writer in
[promises in the pipeline](./promises-in-the-pipeline.md); where the two
disagree, this note holds.

```ts
// A sketch. After the owner's yes, before build: one test per Property, run on the plan's base.
const written = draft("tests_write", {input: PlanAndCode, ok: TestFiles}); // in its box, not the builder
const onBase = checkRun("tests_on_base", {input: TestFiles, verdict: Results});

// new: the test must fail on today's code. existing: it must pass.
{fact: "tests_written", ticket: "demlik-1", commit: "b2c3d4"} // a local commit on the base, never pushed
{fact: "checked", property: "p1", version: 1, head: "a1b2c3", tool: "test", result: "red"}
{fact: "checked", property: "p2", version: 1, head: "a1b2c3", tool: "test", result: "green"}
```

## What was decided

- **It is its own agent, not the builder.** Nobody grades their own work
  ([nobody grades their own work](./nobody-grades-their-own-work.md)). The
  builder works until these tests pass and cannot change them.
- **Its job.** After the owner approves the plan and before any code is
  written, it writes a test for each Property and runs it on the plan's base
  commit.
  - A **new** Property's test must fail there: the feature does not exist yet.
  - An **existing** Property's test must pass there: that part already works.
  - That shows each test tests something. Test-first work asks the same: a new
    test fails before the fix exists.
- **Its answers.** Most runs end `done`. A surprise becomes a box on the
  ticket's timeline with three choices, and the owner picks
  ([the ticket is the lane's one view](./the-ticket-is-the-lane-view.md)):

  ```ts
  done                    // every test fails or passes as the plan says; build starts
  ask:owner:already_passes // a new Property's test passes today
                          //   [ It already works: drop it ] [ The test is too weak: write it again ] [ Reword it ]
  ask:owner:fails_on_base  // an existing Property's test fails today
                          //   [ It is a bug today: make it new ] [ The test is wrong: write it again ] [ Drop it ]
  ask:owner:cannot_test    // no test can check it
                          //   [ Make it a criterion ] [ Reword it ] [ Drop it ]
  stuck                   // out of tries
  ```

  - A pick that changes the plan counts as the owner's yes for the new
    version, so nobody approves twice.
  - The agent never decides anything about the plan.
- **It runs in a box.** It runs tests, and code that comes out of a box runs
  only in a box ([programs run in a box](./programs-run-in-a-box.md)). The box
  holds a copy of the code at the plan's base, no login, and no network but
  the model.
- **It may only add new files that `includes` names,** in the repo's
  [`fabrika.toml`](./one-fabrika-toml-per-repo.md). Code outside the box
  checks its change before anything is kept.

  ```toml
  [test_writer]
  includes = ["**/*.test.ts", "fixtures/**"]   # the default when this is left out
  ```

  - It never edits an existing file, product code or test.
  - A run copies the list when it is filed, so a change to the file does not
    change a running exam. A diff that changes the list asks the owner.
- **Where it writes.** Code makes a local commit of the new tests on the
  plan's base, and the ledger holds only its hash
  ([nothing is pushed before review](./push-after-review.md)). One `checked`
  fact per Property records red or green
  (`packages/pipeline/src/criteria/book.ts`, where each Property has its own `p<n>` id). Nothing is pushed.
- **Names.** Test writer (was verify writer), `tests_write` (was
  `checks_write`), `tests_on_base` (was `checks_today`), `already_passes`
  (was `already_kept`), `fails_on_base` (was `not_kept`), `cannot_test` (new).
  The mutation step's answer becomes `send:test_writer:mutant_survived`.
  "Check" is now only the move's name.

## Why

- **It works.** [Experiment 122](../../experiments/122-verify-writer-replay.md)
  had an agent that was not the builder write one test per promise on three
  demlik tickets. All three failed on the base and passed after the merge,
  in 3 runs of 3, and on one ticket it caught more than the pull request's
  own tests.
- **It is fast enough.** Typecheck, related tests and the new test together
  took 3 to 6 s a ticket ([experiment 123](../../experiments/123-check-layer-timings.md)).
- **It can close the mutation loop.** Given each mutant that lived, it killed
  28 of 29 and argued the last one changes nothing a test can see, for $0.86
  over three tickets ([experiment 124](../../experiments/124-kill-every-survivor.md)).
- **Others do it.** Meta's ACH has an agent write tests to kill mutants that
  live ([Meta 2025](https://arxiv.org/abs/2501.12862)).

**Cost:** one more agent run per ticket, three kinds of box, and a check on
every change it makes.

**How sure: 80%.** The doubt: in 122 to 124 no surprise came up, so we do not
know how often the boxes appear. Running it on the six 86b tickets would tell
us.

## Still open

- **TLA+.** How it writes a check when a Property's `tool` is `"tla"`, and who
  picks the tool. Waits on experiment 139.
- **Where red and green live:** in the criteria book, or only in the lane.
  The mutation step's walk reads them and settles it.
- **A fixture outside `includes`.** Whether some tests need one the default
  does not cover.

## What it cannot tell us

Nothing is built. Three replayed tickets are all the evidence, and none of
them hit a surprise.
