# 116. Do established checkers find the hosted lane's hang?

The question: we built our own model checker (`laws/explore.ts`,
`laws/world/search.ts`). Do established tools find the same bug, and what does
each cost? The test case is experiment 115's bug: a child that ends with no
outcome row leaves the hosted lane waiting for good.

**Answer: yes, both find it.**

- **TLA+ with TLC** finds it in 3 steps, then stuttering, in about 1 second with
  the JVM. But the spec is a copy I wrote by hand. Nothing ties it to the code.
- **A property test on the real code** finds it in 6 to 22 generated cases (65
  to 133 ms), and shrinks it to one child with no row. It runs the real hosted
  lane, the real host and the in-memory ledger, under Effect's TestClock. It uses
  Effect 4's own `Arbitrary`; fast-check was not needed.
- A fixed lane passes both. **Only the property test checks the real Sub and the
  real host.** The cost is about the same as our checker's model: 355 lines
  against 348.
- Confidence 75%. The doubt: the property test runs one schedule per input. A
  bug that needs a rare interleaving could slip past it. See the
  recommendation.

```ts
// The whole idea, as the property test says it (packages/pipeline/src/hosted/lane-ends.ts).
// A child is a stand-in under the name the real lane gives it. It ends as the generated list says.
const Ending = Schema.Literals(["row_done", "row_stuck", "no_row"]);
const endings = Arbitrary.array(Arbitrary.schema(Ending), {maxLength: 6});

// The law: the real lane, on the real host, writes its outcome row
// within 5 s of virtual time after its last child ended.
Arbitrary.checkEffect(endings, (endings) =>
	runCase({endings, variant: "today", limitMs: 5_000}).pipe(Effect.map((seen) => seen.ended)),
);
// today: Falsified, shrunk to ["no_row"]. fixed: Passed, 100 runs.
```

## Who did what

- **The real code, not changed:** `hosted/lane.ts` (the lane stage, its
  handlers and its child Sub), `hosted/stage.ts` (`hostedStage`),
  `hosted/kids.ts` (`serveKids`), the lane reducer, and fabrika's host
  (`serve`, `cast`) on `memoryLedger` from `asks/ledger.ts`.
- **New, in the package:** `hosted/lane-ends.ts` (the harness, the fixed lane,
  the property) and `hosted/lane-ends.test.ts` (the passing runs, in
  `pnpm test`).
- **New, in the experiment:** `116-established-checkers/HostedLane.tla` and four
  `.cfg` files; the script `116-established-checkers.ts`; the results in
  `results/116-established-checkers.json`.
- **Stand-ins:** the children (each writes a row or not, then exits), the code
  host (no branch, no pull request), the plan (experiment 86b's first, approved).
- **Today's failing run is in the script only,** so `pnpm test` stays green.
- No law, plant, checker setting, test or lint rule was changed.
- No model, no key. The only network use was the one download of
  `tla2tools.jar`, into a scratch folder outside the repo.

## How it was done

### 1. TLA+ and TLC

- **The jar:** `tla2tools.jar` from the tlaplus GitHub release v1.6.0 (TLC 2.14,
  2019). v1.7.0 and later want Java 11. v1.6.0 runs on this machine's Java 8.
- **The spec** (`HostedLane.tla`, 119 lines) has six variables:

```tla
VARIABLES
  lane,   \* "ready": about to start child `cur`; "running": waiting on it; "over"
  cur,    \* the child the lane is on
  proc,   \* each child's process: "none" (not started), "up", "down"
  row,    \* each child's outcome row is in the ledger
  exit,   \* the host has put the child's EXIT in the lane's inbox
  seen    \* the lane has taken the child's end (its kid_over)
```

- **The moves:** the lane starts child `cur`. A child may write its row. A
  child's process ends. The host delivers the EXIT. The lane's Sub sees the row.
  Only when `Fixed` is true, the lane also sees the EXIT with no row, and stops
  as stuck.
- **Fairness:** the lane's moves, a child's end and the host's EXIT are weakly
  fair. Writing the row is not fair, so it may never happen.

```tla
Spec ==
  /\ Init
  /\ [][Step]_vars
  /\ WF_vars(Start) /\ WF_vars(SeeRow) /\ WF_vars(SeeExit)
  /\ \A k \in Kids : WF_vars(End(k)) /\ WF_vars(Deliver(k))

EveryStartedChildSeen == \A k \in Kids : (proc[k] # "none") ~> seen[k]
LaneEnds == <>(lane = "over")
NeverAllDone == ~(lane = "over" /\ \A k \in Kids : seen[k] /\ row[k])  \* must break: not noise
```

- **Four configs, three children each:** `today.cfg` (the first law),
  `today-ends.cfg` (the second law), `fixed.cfg` (both laws, `Fixed = TRUE`),
  `reach.cfg` (the "not noise" invariant). The liveness runs use `-deadlock`, so
  a finished lane is not called a deadlock.

### 2. The property test on the real code

- **The world** (`runCase` in `lane-ends.ts`):
  - the ledger is `memoryLedger`, seeded with one plan, planned and approved;
  - the lane is `hostedStage(hostedLane)`, served by the real `serve` under
    `laneOf(plan)`, its job sent with the real `cast`;
  - each child the lane names in `<lane>/kids` is served by the real
    `serveKids`. Its program is a stand-in that writes a row or not, then calls
    `self.exit`: `normal` after a row, `crash` with none;
  - the code host says "no branch, no pull request", so the lane's read runs no
    git.
- **The clock:** Effect's TestClock. Every 150 ms poll of the lane and every
  wait of the host is virtual time. The test moves the clock 50 ms at a time.
  The host and the ledger read the wall clock for leases, so the lease is one
  hour long and never runs out. A case takes about 10 ms of real time.
- **The fixed lane, built in the test:** the same stage. Only its child Sub is
  swapped, by wrapping `self.run`. The new Sub ends on the row, or on the child
  being down. Then it reads the row once more. No row is `stuck:no_outcome`:

```ts
export const fixedLane: typeof hostedLane = {
	...hostedLane,
	boot: (self) => {
		const run: typeof self.run = (machine, journal, opts) =>
			self.run(machine, journal, {
				...opts,
				subscribe: {...opts.subscribe, lane_kid: fixedKid(self.reads)},
			} as typeof opts);
		return hostedLane.boot({...self, run});
	},
};
```

- **Three runs, 5 seeds of 100 cases each:** `today` on all three endings,
  `fixed` on all three, and `assumed`: today's lane where every child writes a
  row first, which is what the lane assumes.
- **Effect's Arbitrary was enough.** `Arbitrary.schema` builds the generator from
  the schema. `Arbitrary.checkEffect` runs an effectful property, shrinks and
  gives a replay token. fast-check was not needed.

## What came back

| | Our checker (115) | TLA+ and TLC | Property test |
|---|---|---|---|
| Found the bug? | yes | yes | yes |
| Shortest bad run it printed | 5 steps, then a loop of one move | 3 steps, then stuttering (first law); 13 steps (second law, not the shortest) | 1 generated ending, `["no_row"]`; no step list |
| Time to find it | about 25 ms | about 0.8 to 1.0 s wall, mostly the JVM; TLC says "00s" | 65 to 133 ms (median 95), 6 to 22 cases |
| Lines written | 348 (world 295, test 53) | 138 (spec 119, configs 19) | 355 (harness 310, test 45) |
| Checks the real code? | the reducer yes; the Sub and the host are a copy | no, all a copy | the lane, its Sub, the host and the ledger yes; the children and the code host are stand-ins |

The scripts come on top: 126 lines for 115, 175 for 116 (both tools). Steps
count moves, not states. 115's 5 include two moves the spec leaves out: the
host starting the lane, and the lane's first read.

### TLA+ and TLC

```
State 1: <Initial predicate>   lane = "ready", cur = 1
State 2: <Start>               proc = <<"up", "none", "none">>, lane = "running"
State 3: <End>                 proc = <<"down", ...>>, row = <<FALSE, ...>>
State 4: <Deliver>             exit = <<TRUE, ...>>
State 5: Stuttering
```

| Check | Result | Distinct states | Trace |
|---|---|---|---|
| today, every started child is seen to end | violated | 118 | 3 steps, then stuttering |
| today, every lane ends | violated | 118 | 13 steps, then stuttering |
| today, TLC's own deadlock check, no property | deadlock | 10 | 3 steps |
| fixed, both laws | passed | 131 | none |
| not noise: can a lane end with every child's row? | yes (invariant broken) | 49 | 9 steps |

- TLC's plain deadlock check also finds it. That is only because the Sub's
  150 ms read is a stutter in the spec: no real move is left.
- For the second law TLC printed a longer loop, through two good children
  first. TLC does not promise the shortest liveness trace. Here our checker
  gave the same 5-step lasso for both laws.

### The property test

- **today:** falsified on all 5 seeds, after 9, 6, 13, 22 and 7 cases. Each
  time the first failing input was already `["no_row"]`, so nothing was left to
  shrink. Replayed, it shows the real lane waiting on
  `lane:367:t1:r1:catchup`, 5,250 ms of virtual time after it started.
- **fixed:** passed 100 of 100 on each seed, about 400 ms of real time each.
  `["row_done", "no_row"]` ends `stuck:build_failed`, with
  `lane:367:t1:r1:build: no_outcome` in its report.
- **assumed:** today's lane, every child writing a row first, passed 100 of 100
  on each seed. So the law is not noise: today's lane breaks it only on the gap
  115 named.
- The normal suite runs `fixed` and `assumed` (60 cases each), the one
  `no_outcome` case and a check of `rowsRead`. Together they take about one
  second.

### 115's open doubt, partly settled

- 115 asked: could a row written just before the exit not yet be readable when
  the EXIT comes? Then the fix would turn a good end into `no_outcome`.
- Here the stand-in writes its row, then exits. The fixed lane's run checks
  this too (`rowsRead`): no child that wrote a row was ended `no_outcome`, in
  500 cases.
- That holds for the memory ledger, where every write is one step in one log.
  The SQLite and Durable Object ledgers were not tried.

## What each one misses

- **Our checker (115):**
  - The Sub and the host are a copy. A change to `hosted/lane.ts` does not
    change the world.
  - Restarts and two lanes are left out (115's own list).
- **TLA+ and TLC:**
  - All of it is a copy, the reducer too. Catch-up, build, review, rounds,
    notes and the pull request are folded into "start, see".
  - It shows a fix of the right shape keeps the laws. It shows nothing about a
    given patch.
  - Liveness traces are not always the shortest.
  - It needs Java and a jar that is not in the repo.
- **The property test:**
  - It samples. Each input runs one schedule: the one the TestClock and the
    fiber scheduler give. It does not try other orders of the row, the exit, the
    EXIT and the Sub's reads. A model checker tries every order.
  - Its law is a time limit, not "forever". A lane that needed more than 5 s of
    virtual time to end would be reported as hung.
  - The children are stand-ins. A real child stage that writes its row and dies
    at a different point is not run.
  - Takeover, a second host and lease loss are not run: one host, a one-hour
    lease.
  - It prints the input, not the run. To see the steps you replay the case.

## What the owner would have to read to trust it

- **Our checker (115):** `laws/world/hosted.ts` (295 lines), checked by eye
  against `hosted/lane.ts` and the host's promises. Also `search.ts`, which is
  this repo's own code with its own tests.
- **TLA+ and TLC:** `HostedLane.tla` (119 lines) and the configs, checked by eye
  against `hosted/lane.ts` and the host. He would need to read TLA+ and know
  what weak fairness means. TLC itself is widely used, so it needs less trust
  than our own search.
- **The property test:** `hosted/lane-ends.ts` (310 lines, TypeScript he knows).
  He checks that the stand-in children, the fake code host and the 5 s limit are
  fair. Effect's `Arbitrary` and `TestClock` are trusted as Effect is. The lane,
  the Sub and the host are the code itself, so there is nothing to compare by
  eye.

## Trace validation

Trace validation checks that a log from a real run is one of the behaviours the
spec allows. Published work I know of:

- Cirstea, Kuppe, Loillier and Merz, "Validating Traces of Distributed Programs
  Against TLA+ Specifications" (2024). The program logs its events. A small
  trace spec reads the log, and TLC checks each logged step against an action of
  the main spec. They tried it on several real distributed programs.
- Howard, Kuppe and others, "Smart Casual Verification of CCF's Distributed
  Consensus and Consistency Protocols" (NSDI 2025). Trace validation runs in
  CCF's CI and found real bugs.
- Davis, Hirschhorn and Schvimer, "eXtreme Modelling in Practice" (VLDB 2020),
  at MongoDB. Trace checking worked, but logging a consistent global order from
  many processes cost more than they expected.

How it would fit our ledger:

- MongoDB's hard part is free here. The ledger is already one log in one order,
  with a `pos` on every row.
- Each row maps to one action of `HostedLane.tla`:
  - a row in `<lane>/kids` is `Start`;
  - a row in `<kid>/outcome` is `WriteRow`;
  - the child's `exited` event is `End`;
  - the EXIT in the lane's inbox is `Deliver`;
  - the lane's journal turning a `kid_over` into a new state is `SeeRow` or
    `SeeExit`.
- A trace spec reads the rows of one run and asks TLC: is there a behaviour of
  the spec that makes exactly these steps?
- This checks that the spec and the code agree on what steps exist. It cannot
  show "forever": a log ends. A hang shows as a log whose last rows are an EXIT
  and a lane still `running`. A check on the final state would flag that.

What it would cost:

- An export of one run's rows in the order of `pos`, as JSON lines. About 50
  lines of TypeScript.
- A trace spec beside `HostedLane.tla`. The papers' are 50 to 150 lines.
- The spec must grow to name every step the code logs. Today it folds catch-up,
  build and review into one "start, see". That is the real cost: the spec
  becomes as detailed as the lane.
- Java in CI, and a jar.
- In return the spec stops being a copy nobody checks. Each run is evidence
  that it matches the code.

## Recommendation

- **Use a property test on the real code as the guard for how stages are wired
  to the host.** It runs the Sub, the host and the ledger as they are. A change
  to `hosted/lane.ts` changes what it checks. It costs about what a hand model
  costs, and runs in under a second.
- **Keep our checker for laws over many interleavings of the reducers.** That
  is where trying every order matters, and the property test does not.
- **Do not adopt TLA+ now.** It found the bug, but as a copy of the code, in a
  language the owner would have to learn. It becomes worth it only with trace
  validation, which costs a detailed spec.
- **Why:** the bug was in the gap between the code and the model. Only the
  property test runs that gap.
- **Cost:** the harness pattern is about 300 lines once. A second stage on it
  should cost much less.
- **How sure: 75%.** The doubt: one bug, and a simple one. It needs no rare
  interleaving. Planting two or three bugs that do (a takeover while
  `running`, a lost EXIT, a row written after the exit) and seeing which tool
  finds each would settle it.

## What it cannot tell us

- One bug, and an easy one. A hang that needs a rare order of events might be
  found by both model checkers and missed by the property test.
- The TLA+ spec and our checker's world are both written by me, from the same
  reading of `hosted/lane.ts`. If I misread the code, both agree with each
  other and are both wrong. Only the property test is free of that.
- The memory ledger only. The SQLite and Durable Object ledgers, with real time
  and real leases, were not run.
- The lines-written numbers count what I wrote for this one bug. They say
  little about what a second bug would cost on each tool.
- TLC v1.6.0 is from 2019. A newer TLC, on Java 11 or later, may print
  shorter liveness traces and run faster. It was not tried, because this
  machine has only Java 8 and system packages were not to be installed.
- The times are from one laptop.
