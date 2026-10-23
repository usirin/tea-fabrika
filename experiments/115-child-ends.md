# 115. Does a model checker find the hosted lane's hang?

The question: the hosted lane waits forever when a child ends without writing
its outcome row. Does experiment 91's world search find that by itself, from
the real lane reducer and a small model of the host?

**Answer: yes. The search prints a lasso in 5 steps: the lane starts, reads,
starts its first child, the child ends with no row, the host hands the lane the
child's EXIT, and then the lane's Sub reads "no row yet" round and round for
good. Both "eventually" laws break on today's wiring: "every child the lane
starts ends with a `kid_over`" and "every lane ends". The world is small: 792
states, 2,523 steps, about 25 ms (995 states, 31 ms with refusals). A sketch
of a fix, where the Sub also ends on the child's EXIT and maps a missing row
to `stuck:no_outcome`, keeps both laws (832 states, 26 ms). So does today's
Sub when every child is made to write its row first, which is what the lane
assumes. So the law is not noise: it breaks on exactly the gap between what
the lane assumes and what the host gives. Confidence 85%: the lane reducer is
the real code, but the Sub and the host are a model I wrote by reading
`hosted/lane.ts`, not the code itself.**

```ts
// The whole idea, as the world says it (packages/pipeline/src/laws/world/hosted.ts).
// A child: writing its row may never happen; its process ending is fair.
move(`${kid} writes its row: done`, null, ...);          // fair: null
move(`${kid} ends with no row`, `end ${kid}`, ...);      // fair
// The host: the EXIT to the parent is fair. Today the lane traps it and does nothing.
move(`EXIT of ${kid} reaches the lane`, `exit ${kid}`, ...);
// The Sub, today: it ends only when the row is there.
if (row !== null) move(`the Sub reads ${kid}'s row`, "sub", stepLane(w, kidOver(row)));
else move(`the Sub reads ${kid}: no row yet`, "sub", w);  // the same state: a loop
```

## Who did what

- **The real code:** the lane reducer, `packages/pipeline/src/stages/lane/machine.ts`,
  stepped through `stepOf` (via `laneStep` in `laws/lane.ts`), and its own
  `kidSub.deps`, which says when the child Sub is on and for which child.
  Not changed.
- **The search:** experiment 91's `laws/world/search.ts`, not changed. Weak
  fairness, Tarjan, a printed lasso, a dead state.
- **A model, new (`laws/world/hosted.ts`):** the host, the children, a
  one-task ledger and the lane's child Sub. The Sub is a copy, in a few
  lines, of what `hosted/lane.ts` lines 217 to 234 do. It is not that code.
- **The tests (`laws/world/hosted.test.ts`):** in the normal suite. They check
  the fixed wiring and the assumed wiring keep both laws, and that the world
  reaches a merged lane. Today's wiring breaks both laws, so that run is in
  the script only, not in `pnpm test`.
- **The script (`115-child-ends.ts`):** every wiring, both laws, with and
  without refusals, five timed runs each. Results in
  `results/115-child-ends.json`.
- `hosted/lane.ts` is not changed. The real fix is the owner's call.
- No model, no key, no network.

## How it was done

### The world

- One lane, as the hosted program runs it.
  - Its state is the real `Lane`. Each Msg goes through the real reducer.
  - Its Cmds go in a list. Any one may be answered next.
- The host:
  - starts the lane (a fair move);
  - starts a child when the lane's `lane_start` is answered ok;
  - hands the lane a child's EXIT once the child's process ends (fair).
- A child:
  - may write its outcome row, `done` or `stuck`. Not fair: it may never
    happen. This is a crash, a kill, a dollar cap hit, or a defect before
    the write;
  - its process ends (fair), with or without a row.
- The ledger, as small as the lane allows:
  - one task, `t1`;
  - the review child writing `done` settles it;
  - the lane's `lane_open` opens the pull request;
  - the ship child writing `done` merges it.
  - So one good run is: catch-up, build, review, note, open, ship, done.
- The Sub, three ways:

| Wiring | The Sub ends when | A child ends with no row? |
|---|---|---|
| `today` | the row is there | may |
| `fixed` (a sketch) | the row is there, or the child's EXIT came: then `stuck:no_outcome` | may |
| `assumed` | the row is there | never: it writes first, as the lane assumes |

- The Sub's read that finds no row is a move back to the same state, of the
  fair class `sub`. That is what the code does: it reads again every 150 ms.

### The two laws

The search checks one "eventually" law per run: "the lane reaches a state
`ended` says yes to". Two `ended`s, one per law:

```ts
/** Every lane ends. */
export const laneOver: EndOf = (w) => w.lane.phase === "over";
/**
 * Every child the lane starts ends with a kid_over. Every way out of `running` is a
 * kid_over for the running child, so a fair loop that never leaves it is a child
 * the lane started and never heard end.
 */
export const notWaitingOnAChild: EndOf = (w) => w.lane.phase !== "running";

search(hostedWorld({sub: "today"}, notWaitingOnAChild), {laws: [], depth: 400, eventually: true});
```

- The second `ended` is a response law ("after a start, a `kid_over`")
  written as "every lane ends" on a different end. It works because the
  only way out of `running` in the reducer is `kid_over`.

### Not noise

- A law that passes because the model never gets anywhere proves nothing.
  So each wiring is also searched for two states, each with a safety law
  that breaks when it gets there, to print the shortest path:
  - a lane that ends `done` with its pull request merged;
  - a lane that ends stuck on a child with no row.

## What came back

| Wiring | Refusals | States | Steps | Depth | Time | Every child ends | Every lane ends |
|---|---|---|---|---|---|---|---|
| today | no | 792 | 2,523 | 28 | 25 ms | broken (lasso) | broken (lasso) |
| today | yes | 995 | 3,199 | 28 | 31 ms | broken (lasso) | broken (lasso) |
| fixed | no | 832 | 2,591 | 28 | 26 ms | holds | holds |
| fixed | yes | 1,035 | 3,267 | 28 | 32 ms | holds | holds |
| assumed | no | 712 | 2,227 | 28 | 22 ms | holds | holds |
| assumed | yes | 915 | 2,903 | 28 | 29 ms | holds | holds |

Time is the median of five runs on one laptop (Apple M2 Max, Node 26).
"Refusals": each lane Cmd may also be answered with an error. Every search
was complete: no depth or state bound cut it. No dead state anywhere.

The lasso, the same for both laws and with or without refusals:

```
the host starts the lane
read
lane:7:t1:r1:catchup started
lane:7:t1:r1:catchup ends with no row
EXIT of lane:7:t1:r1:catchup reaches the lane
then round and round: the Sub reads lane:7:t1:r1:catchup: no row yet
```

- 5 steps to the loop, and a loop of one move.
- It is the first child, the catch-up, only because it is the first child the
  search meets. Build, review and ship go through the same Sub.
- Why the loop is fair, and so a real hang: in that state the only moves left
  are the Sub's reads. Every fair class still possible (`sub`) is taken.
  Nothing owed is left.
- One step before the EXIT, the same loop is not fair: the EXIT is owed and
  never taken. So the search does not blame the lane for a host that is slow
  to say the child is gone. It blames the lane for a host that did say it.

Reach checks, shortest path:

| Wiring | Ends done, pull request merged | Ends stuck on a missing row |
|---|---|---|
| today | 19 steps | never |
| fixed | 19 steps | 6 steps |
| assumed | 19 steps | never |

- Every wiring can carry the plan to a merge, so the laws that hold are not
  holding on an empty world.
- With the fixed Sub the lane ends `stuck:catchup_failed`, with
  `lane:7:t1:r1:catchup: no_outcome` in its report. That is the existing
  "any other stuck child stops the lane" rule of `afterKid`. Nothing new in
  the reducer was needed.

## What it means

- The checker finds the hang from the real reducer and a model of the host
  that says only what the host promises. Nobody had to tell it where to look.
- The mismatch is clear from the three wirings:
  - the lane assumes "every child writes a row" (`assumed` holds);
  - the host gives only "you get an EXIT" (`today` breaks);
  - a Sub that listens to what the host gives keeps both laws (`fixed`).
- The fix does not need a new reducer word. A `kid_over` with
  `stuck:no_outcome` is already what today's Sub sends for a row it cannot
  decode.
- Recommendation: give the hosted lane's child Sub a second way to end, on the
  child's EXIT, and read the row once more at that moment before it says
  `no_outcome`. Why: it is the smallest change that matches what the host
  promises, and the model says it keeps both laws. Cost: a few lines in
  `hosted/lane.ts`, and the Sub needs to see the EXIT (the lane traps it
  already). Confidence 75%. The doubt: in the model a child writes its row
  before its process ends, and the fixed Sub reads the row when the EXIT
  comes. In the real host, can a row written just before the exit be not yet
  readable when the EXIT arrives? If so, the fix would turn a good end into
  `no_outcome`. A test on tea-host with a child that writes and exits at
  once would settle it. That is the owner's decision, not this experiment's.

## What it cannot tell us

- The Sub and the host are a model, written from reading `hosted/lane.ts` and
  the host's promise. If the real code differs from the model, this search
  cannot see it. Nothing ties the model to the file: a change to
  `hosted/lane.ts` will not change this world.
- The fixed Sub is a sketch in the model, not code. It shows a fix of that
  shape keeps the laws here. It does not show a given patch is right.
- Left out: a restart of the lane, two lanes, the owner's asks, a plan child,
  a review that sends work back, a stray late end. A restart is the one most
  likely to matter. A lane taken over while `running` sends no Cmd again: it
  turns its Sub back on and waits for the same row. A lane taken over while
  `starting` sends `lane_start` again, which skips a child that has a row and
  starts one that has none. Whether either case adds a new way to hang, or
  hides the EXIT the fixed Sub needs, is not checked here.
- The host's EXIT is modelled as always coming. If the host can lose an EXIT
  (the parent's own host dies at that moment), even the fixed Sub would
  wait, and this world would not show it.
- A child that never ends (a hung agent with no cap) is outside this world: a
  child's process ending is a fair move here.
- One task and two rows. The hang does not depend on either, but bigger
  worlds were not tried.
