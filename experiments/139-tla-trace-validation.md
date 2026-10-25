# 139. Tie the TLA+ spec of the hosted lane to the real code

The question: today's rule says "TLA+, only for a design with no code yet"
([Property tests, not our own search engine](../docs/direction/property-tests-not-our-own-search.md)).
Two published ways tie a spec to code that exists: trace validation, which
checks real runs against the spec, and tests made from the spec's paths. Do
they earn their place on the hosted lane, the one machine we have a spec of
(experiment 116's `HostedLane.tla`)?

**Answer: both work here, and cheaply, but on this lane they catch nothing
the repo's own tests miss. The real find is that 116's spec was wrong in
three places, and only a check against real runs could show it. Confidence
75%.**

- **Trace validation (Q1):** 300 generated runs of the real hosted lane, read
  from the ledger's log, checked by TLC.
  - The fixed lane passes the fixed spec: 300 of 300.
  - Today's lane, which still has 115's hang, fails it in 123 of 300 runs,
    exactly the 123 that hang. Every one fails at the end: "the lane still
    waits on a child that ended with no row".
  - Against 116's spec as it was written, every fixed run fails: 0 of 300.
- **Three places where the spec and the code disagreed. The spec was wrong
  each time.** The code did what the lane machine and the host say it does.
  1. 116's rows had no kind: every row let the lane go on. The lane stops
     after a `stuck` row.
  2. 116's N was "how many children the plan needs". The lane goes on as
     long as its children say `done`.
  3. 116 promised every child's EXIT. After the lane itself has exited, the
     host writes none.
- **Tests from the spec's paths (Q2):** TLC's state graph of the fixed spec
  (3 children, 207 states, 17,353 paths) gives 322 different scripts for the
  children. Each drives the real lane.
  - The fixed lane makes the path's moves on all 322. Today's lane stalls on
    67, each where the path takes an EXIT with no row.
- **On 150 Stryker mutants of the lane (Q2):** `tsc` refused 104; of the 46
  left, the repo's tests caught 22, the trace check 8, the path tests 7,
  116's property test 8.
  - The two spec arms caught nothing the repo's tests missed. They caught
    one that 116's property test missed (462: the lane goes on after a
    stuck child), and only because of the spec's fix 1.
  - Most of the tests' catches came from the lane's laws, written on our
    own search engine: 15 of 22, and 5 that nothing else caught.
  - The spec arms cost 4 and 9 times the tests' time a mutant.
- **Cost (Q3):** 25 changed lines of spec, a 56-line trace spec, about 190
  lines that read the ledger as the spec's steps, and 205 lines of TLC glue
  that any machine can share. 300 runs and their TLC check take 6 to 9 s a
  lane.

```ts
// The whole idea. One real run of the hosted lane, on generated child endings, read from the
// ledger's log in `pos` order as the spec's steps (packages/pipeline/src/hosted/lane-trace.ts).
const run = yield* traceCase({endings: ["row_done", "no_row"], variant: "fixed", settle: true});
const steps = stepsOf(run.log, 8);
// Start(1) WriteRow(1) End(1) Deliver(1) SeeRow(1) Start(2) End(2) Deliver(2) SeeExit(2) Exit(2)

// TLC: does HostedLaneV2 have a behaviour that takes exactly these steps, lands on each logged
// state, and ends at rest, with nothing it owes still possible? (139-tla-trace-validation/tlc.ts)
const c = yield* checkTraces(jar, {against: "v2", n: 8, fixed: true}, [steps]);
// fixed lane:  accepted
// today's lane on the same endings: Start(2) End(2) Deliver(2), and then nothing.
//   Rejected at rest: SeeExit is still possible, so the spec owes it, and the run never took it.
```

## Who did what

- **All of it is this repo's code.** The real hosted lane
  (`packages/pipeline/src/hosted/lane.ts`) and lane machine
  (`stages/lane/machine.ts`), on fabrika's real host and its in-memory
  ledger, under Effect's TestClock. The children are 116's stand-ins. No
  agent, no model, no real ticket, nothing of today's fabrika. $0.
- **Product code is not changed.** `lane.ts` still has 115's hang. The fixed
  lane is 116's: the same lane with only its child Sub swapped, built in the
  test harness. So 115's bug did not need planting again: today's lane is
  the buggy code.
- **New:**
  - `packages/pipeline/src/hosted/lane-trace.ts`: the ledger's log read as
    the spec's steps (`stepsOf`), and a driver that moves the children only
    when a script says (`driveCase`);
  - `packages/pipeline/src/hosted/lane-trace.test.ts`: 4 tests, no Java;
  - `experiments/139-tla-trace-validation/`: `HostedLaneV2.tla` (116's spec,
    fixed in three places), `TraceV2.tla` and `TraceV1.tla` (the trace
    specs, against v2 and against 116 as written), three `.cfg` files and
    `tlc.ts` (TLC's side);
  - `experiments/139-tla-trace-validation.ts`: every step below;
  - `results/139-tla-trace-validation.json` and
    `results/139-tla-trace-validation-scripts.json` (Q2's scripts, which the
    mutant runs read).
- **Changed, test code only:** `packages/pipeline/src/hosted/lane-ends.ts`,
  116's harness. A child may pause before its row and before it exits; a
  case can wait until every child is down, and one second more for the
  lane's own exit; a driver can hand each child its plan.
- **Tools:** TLC from `tla2tools.jar` v1.6.0 on Java 8, as in 116. StrykerJS
  9.6.1, installed outside the workspace, as in 119.

## Q1. Trace validation

After Cirstea, Kuppe, Loillier and Merz,
["Validating Traces of Distributed Programs Against TLA+ Specifications"](https://arxiv.org/abs/2404.16075)
(2024).

- **The trace is the ledger's log. The code logs nothing for it.**
  - MongoDB's hard part is free here, as 116 guessed: the ledger is one log
    in one order, with a `pos` on every row
    ([Davis et al., VLDB 2020](https://arxiv.org/abs/2006.00915) spent most
    of their effort getting such an order out of many processes).
  - Each row the spec cares about is one action. Every other row (claims,
    jobs, the lane's other saved states) changes none of the spec's
    variables, so it is a stutter and is left out.

  | ledger row | action |
  |---|---|
  | `<child>` registered, its parent the lane | `Start` |
  | `<child>/outcome` | `WriteRow(k)`, with its kind |
  | `<child>` exited | `End(k)` |
  | EXIT from `<child>` in `<lane>/inbox` | `Deliver(k)` |
  | `<lane>/state` stops waiting on `<child>` | `SeeRow`, or `SeeExit` when the report says `<child>: no_outcome` |
  | `<lane>` exited | `Exit` |

- **The trace spec** starts one behaviour per run. Each step must be the
  action the log names, and must land on the state the log gives. One last
  step says the run is at rest: nothing the spec owes is still possible.

  ```tla
  TraceNext ==
    \/ /\ l <= Len(Runs[r])
       /\ Is(Runs[r][l])            \* the action the log names
       /\ Lands(Runs[r][l].to)      \* lands on the logged state
       /\ l' = l + 1 /\ UNCHANGED r
       /\ PrintT(<<"took", r, l>>)
    \/ /\ l = Len(Runs[r]) + 1
       /\ ~ENABLED Owed             \* at rest: no owed move is still possible
       /\ l' = l + 1 /\ UNCHANGED <<vars, r>>
       /\ PrintT(<<"rest", r>>)
  ```

- **The rest step is what catches a hang.** A log always ends. Without the
  rest step, the first steps of a hang are a fine behaviour of any spec.
  116 guessed this ("a check on the final state would flag that"). Right.
- **The runs:** 300 cases per lane from Effect's `Arbitrary`, seed 139. Each
  case is up to 7 children. A child says `done` half the time, `stuck` a
  quarter, no row a quarter. It pauses 0, 50, 150, 300 or 600 ms of virtual
  time before its row and again before it exits.

### What came back

| runs | spec | accepted | why the others failed |
|---|---|---|---|
| fixed lane | v2, fixed wait | 300 of 300 | |
| today's lane | v2, today's wait | 300 of 300 | |
| today's lane | v2, fixed wait (the law) | 177 of 300 | 123 at rest: the lane still waits on a child that ended with no row |
| fixed lane | v2, today's wait | 177 of 300 | 123 at `SeeExit`: today's spec has no such step |
| fixed lane | 116 as written | 0 of 300 | 146 a stuck row stops the lane; 120 the lane exits; 34 the lane goes past N = 3 |
| today's lane | 116 as written | 107 of 300 | 146, 34 and 13, the same three |

- **The 123 rejected runs are the 123 that hang.** Today's lane ended in 177
  runs; TLC accepted exactly those.
- **Each run takes about 16 ms; TLC checks all 300 in 1.0 to 1.4 s,** with
  the JVM's start. 300 runs per lane: 4.8 s fixed, 7.9 s today (a hang runs
  out its limit).
- **The runs are less varied than they look:** 300 cases gave 65 different
  traces. A first try, with endings drawn evenly, gave 29. Under TestClock
  the lane's 150 ms polls line up, so many pauses give the same order.
  Random cases explore few interleavings.
- **The orders the spec has to allow are real:** in 83 fixed runs a child
  exits after the lane has exited; in 100 runs a child starts before the
  last one has exited.

### Each mismatch, and which side was wrong

Each was found the same way: TLC rejected runs, the first step it could not
take named an action, and reading the code said why.

1. **A row has a kind. The spec was wrong.**
   - 116: every row lets the lane go on (`Next(cur, TRUE)`).
   - The lane machine stops after a `stuck` child (`afterChild` in
     `stages/lane/machine.ts`). 146 fixed runs.
   - Fix: `row[k]` is `"none"`, `"done"` or `"stuck"`, and `SeeRow` goes on
     only on `"done"`.
2. **N is a bound, not the plan's length. The spec was wrong.**
   - 116: the lane is over after child N, however that child ended.
   - The lane starts children round after round while they say `done`. 34
     fixed runs went past 3.
   - Fix: N is a bound for TLC, and child N never says `done`. The harness
     matches: a child past a case's list writes `stuck`. A case of 7 `done`
     children starts an 8th, so the trace runs use N = 8.
3. **The lane's own exit, "gone". The spec was wrong.**
   - 116: `Deliver(k)` is owed for every child that is down.
   - The host deletes a process's links when it exits, and writes no EXIT
     to a name that is down (`packages/fabrika/src/host/rules.ts`: "Links: a
     dead process has none left", as in OTP).
   - Found by one run: a child wrote `stuck` and exited 300 ms later; the
     lane read the row within one 150 ms poll, ended and exited first. No
     EXIT came, and the spec still owed one, so the run was not at rest.
   - Fix: an `Exit` step takes the lane to `"gone"`, and `Deliver` needs the
     lane not gone.

- **The code was wrong once: 115's known hang.** No new bug in the code.
- **The glue was wrong three times while building this,** and those looked
  like mismatches too:
  - TLC's `-dump` of states leaves out the last state of a behaviour, so
    every trace looked rejected. The trace spec prints instead.
  - The state graph stopped at TLC's first deadlock: 34 states, not 207.
    `-deadlock` fixed it.
  - Cases first ended at the lane's outcome row, before its own exit, so
    `Exit` was still owed. A case now runs one more second.
- **116's laws still hold on the fixed spec.** "Every started child is
  seen" and "every lane ends" pass (207 states); the hang breaks the first in
  today's spec (181 states); "a lane reaches its last child" breaks, so the
  last child is reachable.

## Q2. Tests from the spec's paths

After MongoDB's Realm Sync work in the same
[VLDB 2020 paper](https://arxiv.org/abs/2006.00915): a program walked the
state graph and wrote 4,913 tests, which reached all 86 branches of the code
(hand-written tests: 21%).

- **The paths:** TLC dumps the spec's whole state graph with action names
  (`-dump dot,actionlabels`). It has no cycles, so every path from the start
  to a state with no way on is one test.
- **A script keeps only the children's moves,** and how many of the lane's
  own steps come before each. The lane's moves are what the run must make.

  ```ts
  // One script: child 1 writes done and exits; child 2 exits with no row.
  const script: Script = {
  	pushes: [
  		{act: "WriteRow", k: 1, kind: "done", after: 1},
  		{act: "End", k: 1, after: 1},
  		{act: "End", k: 2, after: 3},
  	],
  	laneSteps: 5,
  };
  const r = yield* driveCase({variant: "fixed", script, n: 3});
  // fixed lane:  Start(1) SeeRow(1) Start(2) SeeExit(2) Exit(2), stalled null
  // today's lane: stalled {before: 3, wanted: 5, had: 3}
  ```

- **The driver** holds each child at a gate. It lets a child write or exit
  only when the lane has made `after` steps of its own. It cannot hold the
  lane or the host, so the lane may move first.
- **A run passes** when it does not stall, makes the lane's moves of the
  path, and its log passes Q1's trace check against the same spec.

| spec (N = 3) | states | paths | scripts | fixed lane | today's lane |
|---|---|---|---|---|---|
| fixed wait | 207 | 17,353 | 322 | 322 pass | 255 pass, 67 stall |
| today's wait | 181 | 16,075 | 292 | 255 pass, 37 other moves | 292 pass |

- **The 67 are the scripts where a child exits with no row while the lane
  waits on it.** Today's lane makes 5 steps where the path makes 7.
- **The 37:** today's spec ends those paths with the lane waiting for good;
  the fixed lane goes on to `SeeExit` and `Exit`.
- **Only 125 of the 322 runs on the fixed lane took the path's exact
  order** (`Deliver` aside). The rest made the same moves, but the lane's
  own next step came before a child's exit that the path put first. In 35
  of the first 80 scripts, 31 times it was the lane's `Exit` and 4 times
  its next `Start`. The driver holds the children, not the lane, and a
  child's exit takes the host a moment. TLC accepted each of those runs, so
  they are behaviours of the spec, but not the path's own.
- **Time:** TLC's graph about 0.9 s; 322 driven runs about 18 s, about 55 ms
  each.

### On mutants

- **The sample:** StrykerJS 9.6.1 made 757 mutants of `hosted/lane.ts` (252)
  and `stages/lane/machine.ts` (505). A fixed sample of 150, seed 139: 53 and
  97. Each was put in alone and typechecked first, as 121's hand check
  asked. `tsc` refused 104. 46 ran.
- **Four arms, each a child process with a 3-minute limit.** A timeout
  counts as caught, as Stryker counts it.
  - **tests:** every test file `vitest related` picks for the two files, as
    CI would run them: 12 files, 139 tests, about 3 s. 116's property test
    and 139's own 4 examples are among them.
  - **property:** 116's property test alone (`lane-ends.test.ts`, Effect's
    `Arbitrary`, 2 × 60 runs). There is no tea pbt test of this lane; this
    is its property test.
  - **trace:** Q1's 300 cases on both lanes, each against its own spec.
  - **paths:** Q2's scripts on both lanes, each against its own spec.

| arm | caught, of 46 | by timeout | median time a mutant |
|---|---|---|---|
| tests | 22 | 3 | 5.5 s |
| property | 8 | 1 | 2.7 s |
| trace | 8 | 4 | 21.5 s |
| paths | 7 | 0 | 48.6 s |
| any arm | 22 | | |

- **The spec's arms caught nothing the tests missed: 0 of 46.** Together
  they caught 8, and the tests caught all 8.
- **The tests caught 14 that both spec arms missed.** Each changes
  something the spec folds away, or that the stand-in children never do:
  - a child's name, and the job it is handed (278, 281, 305): the spec
    numbers children 1 to N, and a stand-in ignores its job;
  - build against review (327, 413): one step in the spec;
  - the stall rule's count, and what a last review's or a skipped review's
    end does (431, 432, 530, 553);
  - a review that says `unseen` (461, 464, 465, 472, 476): no stand-in ends
    that way, so no arm built on them can see it. The lane's laws catch
    them: their world has a review that says `unseen`.
- **Against 116's property test alone, the spec's arms caught one it
  missed: 462.** It makes the lane go on after any stuck review child. Trace
  rejected it at once ("`SeeRow(3)` lands on `lane=ready cur=4`": the lane
  moved on after child 3 ended with no row), and so did paths. The property
  test's laws are "every started child is seen" and "every lane ends"; the
  lane still does both. The spec catches it only through fix 1 above (a
  stuck row stops the lane), so 116's spec as written would not have. The
  repo's other tests catch it outright: `plan-lane.test.ts`,
  `standard.test.ts` and `lane.test.ts` fail on it. Under Stryker the whole
  tests arm ran out of time only because `world/hosted.test.ts` hangs on it.
- **The property test caught one both spec arms missed: 413** (a build step
  read as not a build). One more law catches what the spec catches here.
- **24 lived through all four.** The git and pull-request wiring, the
  owner's asks, the hash that spreads commit dates, resume after a restart,
  the ship flow, and strings. The harness world never reaches them: its
  children write rows and exit, and nothing else.
- **Which test files caught the tests arm's 22** (from `split`: each mutant
  put in by hand after Stryker, and every related test file run):
  - the lane's laws (`laws/lane.ts`), run by `plan-lane.test.ts` and
    `standard.test.ts`: 15;
  - the lane's example tests (`stages/lane/lane.test.ts`): 12;
  - 116's property test (`hosted/lane-ends.test.ts`): 8, as in the property
    arm;
  - 139's own `lane-trace.test.ts`: 6, each one caught by an older file too.
- **5 were caught by the lane's laws and by nothing else** (432, 464, 465,
  472, 553): the stall rule's count and the `unseen` rule. Those laws are
  written on the shapes of our own search engine (`laws/explore.ts`), which
  [Property tests, not our own search engine](../docs/direction/property-tests-not-our-own-search.md)
  says leaves in stages. If the engine goes before the lane's laws move to a
  property test, these 5 catches go with it. Neither spec arm would make
  them up.
- **Timeouts are slow, and they leak.** A trace arm on a mutant that makes
  the lane loop runs 300 cases to their limit: 4 of its 8 catches took the
  full 3 minutes, where paths caught 3 of the same in about 30 s. When an
  arm ran out of time, `runChild`'s time limit stopped waiting but did not
  stop the vitest workers: four were still at full CPU minutes later, and
  were stopped by hand.
- **One mistake of mine in the hand steps, found and fixed.** Put in as
  bare text, a `LogicalOperator` mutant inside a longer `&&` chain reads
  with another grouping than Stryker's (464). `withMutant` now brackets it.
  Stryker's own runs were not touched by this; 464 was typechecked again in
  brackets (accepted, as before) and `split` ran after the fix.

## Q3. What it costs

| part | lines | per new machine? |
|---|---|---|
| the spec, `HostedLaneV2.tla` | 133 (116's 119; 25 logic lines changed) | yes |
| the trace spec, `TraceV2.tla` | 56, most of it the table of actions | yes, by copy |
| the configs | 14 | yes |
| the log read as steps, `stepsOf` and its readers | 188 | yes |
| the driver, `driveCase` | 115 | yes: one gate per outside actor |
| the harness that runs the lane on the real host (116's `lane-ends.ts`) | 355 in 116; here 114 added, 41 taken out | yes, unless a shared one exists |
| TLC's side, `tlc.ts` | 205 | no, shared |
| paths to scripts, judging, the steps (in the script) | Q1 231, Q2 190 | mostly shared, once moved out |
| the mutant steps (in the script) | about 480 | no |

- **Run time:** Q1 6 to 9 s per lane for 300 runs and their check. Q2 about
  20 s per lane for 322 scripts. A mutant, median, six at a time under
  `nice`: tests 5.5 s, the property test 2.7 s, trace 21.5 s, paths 48.6 s.
  Stryker's whole run of the 46 took 20 minutes 37 seconds; the spec's two
  arms were 3,770 of the 4,884 arm-seconds.
- **Java in the loop.** Today `pnpm test` needs no Java and no jar. Both
  levers need TLC, so either the check moves out of `pnpm test` or CI gets a
  JVM.
- **Per new machine, the real cost is the spec and the reading of the log.**
  The spec must use the same words as the code's rows; that is where all
  three of 116's mistakes were. TLC's side and the trace spec's shape carry
  over.
- **Against the published numbers:** CCF's trace spec is 369 lines and took
  about 2 engineer-months
  ([Howard et al., NSDI 2025](https://arxiv.org/html/2406.17455v2)). MongoDB
  stopped trace checking after 10 weeks with two engineers; test generation
  took one engineer 4 weeks (VLDB 2020). This lane is far smaller than
  either, and the ledger gives the global order for free.

## Q4. The levers, side by side

Every outside claim is from the source linked in its row. "Here" names the
experiment in this repo that ran it.

| lever | here | what it catches that the others miss | rough cost |
|---|---|---|---|
| Types and example tests | every change; 121's hand check; here tsc refused 104 of 150 mutants | a state that cannot be built never compiles ([Minsky 2011](https://blog.janestreet.com/effective-ml-revisited/), [King 2019](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)) | part of writing the code |
| Property tests, one machine | 120, 121 | a law checked on many random inputs ([Claessen and Hughes 2000](https://www.cs.tufts.edu/comp/150FP/archive/john-hughes/quick.pdf)), a failing one shrunk to a small one ([Hughes 2016](https://research.chalmers.se/en/publication/232550)) | lines per law; seconds |
| Property tests on the running host | 116, 139 | a bug between machines, in the real wiring (115's hang) | 116: about 300 lines once, 10 ms a case |
| Every-order search of the real code | 90, 91, 115, 118 | a bug that needs one rare order, to a bound. CMC found 34 errors in 3 programs ([OSDI 2002](https://www.usenix.org/legacy/event/osdi02/tech/full_papers/musuvathi/musuvathi_html/node1.html)) | an engine to own, about 1,000 lines here; CMC: "considerable manual effort" |
| Mutation testing | 119, 120, 121, 126, 139 | tests that pass on wrong code: it grades the other levers ([Google, ICSE-SEIP 2018](https://research.google/pubs/state-of-mutation-testing-at-google/)) | a 150 sample: minutes; Google shows a median of 7 per change after filtering ([TSE 2021](https://arxiv.org/abs/2102.11378)) |
| TLA+ on a design | 116, 139 | design bugs in rare orders and "it ends" laws, before code. AWS found 3 DynamoDB bugs, in traces up to 35 steps, that had passed review and tests ([CACM 2015](https://ilyasergey.net/CS6213/_static/01-intro/aws.pdf)) | AWS: specs of 102 to 939 lines, first results in 2 to 3 weeks; 116: 119 lines |
| Trace validation | 139 | a spec that drifted from the code; a real run the spec forbids. Mismatches in every case study ([Cirstea et al. 2024](https://arxiv.org/abs/2404.16075)); 6 bugs in CCF ([NSDI 2025](https://arxiv.org/html/2406.17455v2)) | CCF: about 2 engineer-months; MongoDB stopped after 10 weeks ([VLDB 2020](https://arxiv.org/abs/2006.00915)); here about 250 lines |
| Tests from the spec's paths | 139 | every path to a bound, on the real code. MongoDB: 100% of 86 branches, hand-written 21% ([VLDB 2020](https://arxiv.org/abs/2006.00915)); 87,143 tests from 490,360 states ([VLDB 2025](https://www.vldb.org/pvldb/vol18/p5045-schultz.pdf)) | MongoDB: one engineer, 4 weeks; here about 300 lines |
| Deterministic simulation | partly: 116's harness runs the real host on virtual time, one order per case | rare orders across a whole system, replayed from a seed ([FoundationDB, SIGMOD 2021](https://www.foundationdb.org/files/fdb-paper.pdf); [TigerBeetle](https://docs.tigerbeetle.com/concepts/safety/); [Antithesis](https://antithesis.com/docs/introduction/how_antithesis_works/)) | all code deterministic; FoundationDB cannot test code outside its Flow |
| Reference models with property tests | no | the code against a small runnable model ([ShardStore, SOSP 2021](https://jamesbornholt.com/papers/shardstore-sosp21.pdf)) | ShardStore: models about 1% of the code, models and harness 12% |
| Proofs | no | all inputs, no bound. Cedar: proofs found 4 bugs, differential and property tests 21 ([2024](https://arxiv.org/abs/2407.01688)) | seL4: about 20 person-years for 8,700 lines of C ([SOSP 2009](https://trustworthy.systems/publications/papers/Klein_EHACDEEKNSTW_09.pdf)); TLAPS has no temporal reasoning ([docs](https://proofs.tlapl.us/doc/web/content/Home.html)) |
| Checking real histories | no | anomalies in large real logs. Elle checks 22 million transactions in about 2 minutes ([Elle](https://github.com/jepsen-io/elle)); P is used at AWS ([P](https://github.com/p-org/P)) | Elle: about 60 GB for that run; P's cost: not found |

## Recommendation

Where each lever goes, one place of the loop at a time. Each is a lean for
the notes that wait on this experiment (listed below).

```ts
// A sketch: the tool a plan's property names, and what follows from it.
type Tool = "test" | "tla";
const toolFor = (p: {code: "exists" | "none"; about: "order" | "end" | "value"}): Tool =>
	p.code === "none" && p.about !== "value" ? "tla" : "test";
// a property about code that exists:            "test", a property test (on the running host
//                                               when it is about machines working together)
// a new design, about orders or "it ends":      "tla", a spec and its laws, run by TLC
// once that design's code lands:                "test" for the property; the spec is kept only
//                                               with the drift job below, else it is a record
```

- **The plan: `"tla"` only for a design with no code yet,** about orders
  between actors or "it ends". Everything else is `"test"`. The planner picks;
  a property that names code that exists and says `"tla"` is a plan to send
  back.
  - Why: TLC found 115's hang on 116's spec, from the design alone. Here, on
    code that exists, the spec's two levers caught nothing the repo's tests
    missed.
  - Cost: none new. How sure: 75%.
- **The test writer: no TLA+ for code that exists.** When a property's tool
  is `"test"` and it is about machines working together, the test is a
  property test on the running host, as in 116.
  - Why: 116's property test (2.7 s) caught 8 of the 46; the two spec arms
    together, at 21 and 49 s, caught 8, and only one that it missed
    (462). The property test's missing law ("a stuck child stops the lane")
    is one more law, not a spec.
  - Cost: none new. How sure: 75%.
- **A spec that is kept: trace validation, in the TLA+ drift job, to
  advise.** It files a ticket when real runs no longer fit; it blocks
  nothing.
  - Why: it was the only check here that showed the spec was wrong, three
    times. Once spec and code agreed it raised no false alarm: 0 rejected of
    600 runs that were right (each lane against its own spec). That passes
    the bar for advice (up to 10%,
    [Sadowski et al., CACM 2018](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/),
    as experiment 125 read it), not yet the one for blocking (about 0, on
    far more runs than 600).
  - Cost: a log reader and a trace spec per kept spec (about 250 lines
    here), and Java where the job runs.
  - How sure: 70%. The runs were the harness's, with stand-in children. A
    real ledger's runs end in more ways; a week of the job on real lanes
    would settle the false alarms.
- **The mutation step: Stryker stays the grader, with the repo's own tests.**
  No spec arm. The spec arms took 4 and 9 times as long a mutant as the
  tests and caught nothing more. Tests made from the spec's paths are not
  adopted. How sure: 80%.
- **Review: nothing.** No lever here reads a diff.
- **What would change this:** a second machine, with more state, where the
  spec's arms catch what its tests miss; or the drift job finding real drift
  that no test catches.
- **The notes that wait on this,** none changed here:
  [The plan stage](../docs/direction/the-plan-stage.md) (who picks `tool`),
  [The test writer](../docs/direction/the-test-writer.md) (how it writes a
  `"tla"` check),
  [Scheduled jobs run on the host's alarms](../docs/direction/scheduled-jobs-on-the-host.md)
  (the drift job's false alarms) and
  [Five steps for every check](../docs/direction/five-steps-for-every-check.md).
  The proposal is in
  [Property tests, not our own search engine](../docs/direction/property-tests-not-our-own-search.md).

## Guesses that turned out wrong

- **116: "the spec must grow to name every step the code logs ... the spec
  becomes as detailed as the lane."** Wrong. The lane's catch-up, build and
  review stay folded into one step; their rows are stutters. 25 lines of
  logic changed, and only where the spec was wrong.
- **116: the export would be "about 50 lines".** Wrong: reading the log as
  steps is 188 lines, most of it the six readers and the rule for `SeeRow`
  and `SeeExit`.
- **Mine: that 300 random cases would cover the spec's orders.** Wrong: 65
  different traces. Q2's paths reach orders the random cases never make.
- **Mine: that the harness's lane starts at most 7 children.** Wrong: 7
  `done` children start an 8th. At N = 7 that run is rejected at its 31st
  event, where child 7 says `done`; at N = 8 it is accepted. No case of the
  300 had 7 `done` children, so the first runs at N = 7 were not hurt: the
  table above, rerun at N = 8, gave the same counts. The mutant runs used
  N = 7, on the same 300 cases.

## What this cannot tell us

- **One small machine.** The lane has six variables in the spec. A machine
  with more state, or several lanes at once, may need a far larger spec and
  far more glue, as CCF's and MongoDB's did.
- **The children are stand-ins.** A real agent child ends in more ways.
- **One order per case in Q1.** TestClock lines up the polls, so Q1 saw 65
  orders. Q2's driver cannot hold the lane either: 197 of 322 runs took
  another order than their path.
- **N = 3 for the paths.** A bug that needs four children is not on any
  path.
- **The mapping is code too.** `stepsOf` decides what `SeeExit` is from the
  lane's report. A wrong mapping and a wrong lane can agree with each other;
  the trace check would pass both.
- **The 150 mutants are Stryker's,** small edits nobody wrote. A wrong
  design is not one of them, and that is what TLA+ before code is for.
- **46 mutants is few.** No catch of the spec's alone in 46 still allows a
  rate up to about 6.5% (3 in 46, the
  [rule of three](https://en.wikipedia.org/wiki/Rule_of_three_(statistics)),
  at 95%).
- **No cost in people.** I measured lines and run time, not the hours it
  takes someone new to TLA+ to write and fix a spec.
