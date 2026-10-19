# 91. Laws over several machines at once

The question: experiment 90 checks one machine at a time. Can the same
in-house checker run several machines together (two or three lanes, each an
operate loop with its build, review and ship, over one shared GitHub and
ledger) and check "eventually" laws too? Where does it stop being practical?
And do we need TLA+?

**Answer: yes, our checker is enough for the code we have; TLA+ is not needed
now. Two lanes of the real reducers make 2,876 states and finish in 0.15 s;
three lanes make 249,770 states in 17 s. Every option added (red CI, errors,
a restart, flaky CI) multiplies that by 2 to 12. Symmetry halves two lanes and
cuts three lanes 6 times; partial-order reduction cuts 40 to 60%; together
they cut three lanes 14 times (to 18,180 states, 4 s). Both reductions find
the same broken laws as the full search on every world tried. The
"every lane ends" check (weak fairness, Tarjan, a printed lasso) finds no fair
loop and no dead state in the real code, and finds both planted ones. Four of
the five laws asked for hold or break exactly where the design says they
would: with no claim two lanes work one ticket; with no merge queue the second
lane lands on a main it was never tested with. The fifth is a real gap: the
loop stops to ask the owner at the first stall, and the owner's desk has no
ask until the second. All six planted mistakes are caught, in 4 to 26 steps.
Practical size: two lanes with up to two options in the normal suite (under
1 s); two lanes with three, or three lanes with up to two, in a separate
script (under 5 minutes); past that (flaky CI on top of three options, or
three lanes with three) it passes 4 million states and stops. TLA+ would add
size, any number of lanes and richer temporal laws; it pays only for a
protocol designed before its code. Confidence 80%.**

## Who did what

- **The machines:** the operate loop, build, review and ship in
  `wip/src/stages/`, and the asks core's fold in `wip/src/asks/rules.ts`, as
  they are on main. Not changed here.
- **The world search (`wip/src/laws/world/search.ts`):** new. It knows nothing
  of lanes: a world says what can happen; the search walks it.
- **The lanes world (`wip/src/laws/world/lanes.ts`):** new. Real reducers,
  a small model of GitHub and the ledger.
- **The laws and planted mistakes (`wip/src/laws/world/laws.ts`):** new.
- **The small runs (`wip/src/laws/world/world.test.ts`):** in the normal tests,
  17 tests, about 3.5 s in all, none over 0.6 s.
- **The long runs (`91-world-laws.ts`):** the blowup tables and size limits,
  about 95 minutes with the defaults, most of it in four runs cut at 4
  million states. Results in `results/91-world-laws.json`.
- No model, no key, no network. Nothing written to GitHub.
- **Ported to criterion ids:** after main's change to stable criterion ids
  and `ReadyToMerge`, the world keeps a criteria record per ticket and ship
  merges only with a proof built from it; rerun with a short budget, and only
  the numbers that changed are updated below (see "Since criterion ids").

## How it was done

### The world

- A lane is what the operate program runs for one ticket.
  - The loop machine, and the stage machine its current Act started.
  - Each is stepped with its real `update`.
  - When a stage ends, its outcome answers the loop's Act in the same step,
    as the program's handlers do.
- The shared parts:
  - `main`: a version number. Each merge adds one.
  - Per ticket: who claims it, its branch and pull request (head, the main
    it was cut from, its checks, the verdicts posted, its place in the
    queue), its criteria record (`c1` and `c2`, and every verdict row a
    review kept, as the review program's `keepRows` does), and its part of
    the owner's desk.
  - Ship's read joins the pull request and the record, as `readFacts` does,
    so the gate builds its `ReadyToMerge` from the real rows.
- Every Cmd is answered from that model, at the moment the answer comes.
  - A ship read says what the pull request is now.
  - So two lanes see each other's writes.
- One step is one thing that can happen next:
  - a Cmd's answer comes back (any Cmd in flight, in any order);
  - an agent hands back a form (the builder one plain form; the reviewer a
    pass or a fail);
  - a Listen hears the checks settle, or a clock runs out;
  - CI reports, CI runs again (flaky), the queue lands or throws out a head;
  - the owner answers, someone else merges, a lane's process dies and starts
    again.
- Each move says which parts it touches, and its fairness class.
- Three host steps are not in any machine today, so they are sketches here:
  - a claim on a ticket before a lane starts (`none`, `cas`, or the planted
    `read_then_write`);
  - a reviewed fact told to the owner's desk after each review round;
  - GitHub's merge queue.
- Left out on purpose: review notes, comments, approvals, mergeability, and
  CI on anything but the branch head. Experiment 90's single-machine laws
  cover those.

### Measure first, then reduce

- The search is breadth first with a seen-set, like experiment 90's.
  - A state is every lane's machines, the shared parts and the Cmds in flight.
  - A state's key is a stable string, hashed per part (two 32-bit hashes).
    Parts that did not change keep their hash.
- **Partial-order reduction.** The rule:
  - A move touches only its lane's own parts when no other lane ever touches
    them: the lane itself, and its ticket when no other lane has it. `main`
    is never anyone's own.
  - From a state, if every move of one lane is like that, and none changes
    what a law across lanes reads of the lane (whether it works a ticket
    another lane shares), only that lane's moves are tried.
  - Any order that starts with another lane's moves reaches the same states
    with this lane's moves first, so no law can tell the difference.
  - Loops: a reduced step that leads to a state already kept at this depth
    or before expands the state in full (the loop rule, C3, for a breadth-first
    walk).
  - Tested against the full search: same broken laws on every world tried.
- **Symmetry.** Two states that are the same up to renaming the lanes (and
  their tickets) are one state.
  - The key is the least key over every renaming.
  - Every ticket has the number 1 so renaming names is enough. The machines
    never compare ticket numbers across lanes.

### "Every lane ends"

- The search keeps the whole graph: every state and every edge.
- **Weak fairness, per kind of move:**
  - Must happen if it stays possible: an answer to each Cmd in flight, each
    agent run, CI's report, a Listen, each clock (one class per wait number),
    the queue, a lane's start.
  - May never happen: the owner's answer, CI running again, someone else's
    merge. A loop through these alone is not a bug.
  - Happens only finitely often: a restart. Loops through one do not count.
- **A fair loop** (a lasso):
  - Cut the states where the lane has not ended into strongly connected parts
    (Tarjan, without recursion).
  - A part with a loop is fair when every class possible in all its states is
    taken by a move inside it.
  - It prints the path to the part, then a walk round it that takes each owed
    class.
- **A dead state:** nothing that must happen is possible, and the lane has
  not ended.

## Measure first: the raw blowup

No reduction. Two lanes on tickets of their own, a merge queue, cap 2, the
reviewer passes or fails one criterion.

| Lanes | States | Steps | Depth | Time | By depth 10 / 20 / 30 / 40 |
|---|---|---|---|---|---|
| 1 | 48 | 53 | 24 | 7 ms | 19 / 43 / 48 / 48 |
| 2 | 2,876 | 5,892 | 47 | 177 ms | 110 / 725 / 1,907 / 2,737 |
| 3 | 249,770 | 701,802 | 70 | 16.6 s | 427 / 6,113 / 35,818 / 109,639 |

- Each lane is about 50 states. Two lanes are about 50 × 50; three about
  50 × 50 × 100. The product, as expected: one lane's states times the
  other's, plus where `main` stands.
- Every search ends: the machines have caps and counts, so no depth bound is
  needed.

What each option adds to two lanes (no reduction):

```
base                      2,876 states     136 ms   alphabet 72
no queue                  2,280            120 ms
one ticket, no claim     89,933          5,364 ms   alphabet 147
one ticket, claim cas       189              5 ms
no clocks                 1,912             98 ms
red CI                    9,541            449 ms
eject                     7,333            341 ms
idle builder              2,985            139 ms
outsider 1               13,901            651 ms
errors                    5,700            247 ms
1 restart                13,553            923 ms
third form (fail both)    7,333            372 ms
flaky CI                 33,401          1,883 ms   depth 83
```

- Alphabet: how many different moves (by label) were taken.
- Two lanes on one ticket cost 31 times more: the lanes write the same pull
  request and the same criteria record, so their orders matter. (15 times
  before the record: each lane's rows going in first or second doubles it.)
- Cap 3 adds nothing with these forms: a second fail is a stall and ends the
  lane at round 2.

## The reductions

| World | Full | POR | Symmetry | Both | Same laws found |
|---|---|---|---|---|---|
| 2 lanes | 2,876 / 138 ms | 1,700 / 63 ms | 1,460 / 125 ms | 908 / 63 ms | yes |
| 2 lanes, no queue | 2,280 / 115 ms | 1,180 / 45 ms | 1,160 / 104 ms | 646 / 48 ms | yes |
| 2 lanes, one ticket | 89,933 / 5.6 s | 88,642 / 5.2 s | 44,969 / 5.0 s | 44,323 / 4.7 s | yes |
| 2 lanes, red + errors | 18,652 / 856 ms | 16,117 / 662 ms | 9,387 / 765 ms | 8,500 / 702 ms | yes |
| 2 lanes, flaky CI | 33,401 / 1.9 s | 31,011 / 1.7 s | 16,782 / 1.7 s | 15,617 / 1.5 s | yes |
| 3 lanes | 249,770 / 16.8 s | 105,761 / 5.3 s | 42,924 / 14.0 s | 18,180 / 4.1 s | yes |
| 3 lanes, no queue | 159,340 / 12.1 s | 59,525 / 3.1 s | 27,524 / 9.8 s | 9,326 / 2.3 s | yes |

- **Symmetry** halves two lanes and cuts three lanes about 6 times (3! = 6
  renamings). It costs time: each key is built once per renaming, so three
  lanes save states 6 times but time only 1.2 times.
- **Partial-order reduction** cuts 40 to 60% of states on own tickets, and
  saves time too. It does little in three cases, each for a reason:
  - one ticket: every move touches the shared pull request, so no move is a
    lane's own;
  - errors: lanes end early, and once one lane has ended there is nothing to
    reorder;
  - flaky CI: checks going green, then pending again, make loops, and the
    loop rule expands those states in full.
- **Both:** three lanes from 249,770 states to 18,180 (14 times), 16.8 s to
  4.1 s.
- Paths found with partial-order reduction can be a step or three longer
  than the shortest (27 against 26). Breadth first without it gives the
  shortest.
- "Same laws found" is checked in the normal tests too, on four worlds,
  real and planted.

## The laws

| Law | Real code | Planted mistake caught |
|---|---|---|
| a ticket is never worked by two lanes at once | **breaks** with no claim (2 steps); holds with a compare-and-set claim | a claim read, then written: 4 steps |
| nothing lands on a main it was not tested with | holds with the queue; **breaks** with no queue (26 steps); holds if the repository refuses a branch behind main | ship merges past the queue: 26 steps |
| only a head a review passed lands | holds on own tickets; **breaks** on one ticket with no claim (22 steps) | ship takes a missing review as passed: 22 steps |
| every lane ends (merged, stuck or asking) | holds: no fair loop, no dead state, in every world tried | ship waits with no count: a lasso; the loop ignores a failed post: a dead state |
| an ask leaves the owner's list only by an answer | holds (the desk alone, 6 rounds, every order of counts) | a desk that drops an ask on progress: 4 rounds |
| a lane that stops to ask the owner leaves an ask on the owner's list | **breaks** (19 steps) | not needed: the real code breaks it |

### What breaks, and why

- **Two lanes, one ticket, no claim.** 2 steps.
  - `L1 starts on T1 / L2 starts on T1`.
  - Nothing in any machine takes a ticket. The kept work queue is per
    process. Expected: it is why the claim was asked for.
  - What follows is worse (22 steps):
    - L2 pushes `T1.c2` on top of L1's branch.
    - Both review `T1.c2`. L1's reviewer fails it, L2's passes it.
    - L2 posts its pass, reads the ship facts (passed), enqueues.
    - L1 posts its fail, after L2's read.
    - The queue lands `T1.c2` with a fail as the last verdict at that head.
  - `ReadyToMerge` does not stop it (see "Since criterion ids").
  - With a compare-and-set claim, only 189 states and every law holds.
- **No merge queue: the second lane lands on a main it never saw.** 26 steps.
  - Both lanes copy at `m0`.
  - L1 passes and merges `T1.c1` onto main 0. Main is now 1.
  - L2 passes and merges `T2.c1` onto main 1. It was built and tested on 0.
  - Nothing in the machines catches up: `build_copy` cuts from main once, and
    ship's straight merge does not check the branch is behind. `ReadyToMerge`
    proves the criteria at the head; it says nothing about main.
  - The queue fixes it (it tests on main as it is). So does a repository
    rule that refuses a branch behind main: ship then ends `merge_failed`,
    stuck, and every law holds.
- **The loop asks the owner; the owner's list is empty.** 19 steps.
  - Round 1: the reviewer fails one criterion. Round 2: the same.
  - The loop stops: `ask:owner:no_progress`.
  - The asks core has seen two reviewed facts with 1 open each: one stall.
    It raises a stuck ask only at the second stall.
  - So a lane ends "asking", and nothing waits on the owner.
  - The same at the cap (`ask:owner:rounds`: fail both, then fail one) and
    when ship stops for a person (`ask:owner:ship`: two lanes on one ticket,
    16 steps). The asks core has no fact for either.
  - Experiment 90 noted the loop's rule is older than the direction's
    ("a second stall in a row goes to the owner"). This is the same gap,
    seen where it hurts: across the two machines, the ask is lost.

### Since criterion ids

Main moved to stable criterion ids: ship's enqueue and merge take only a
`ReadyToMerge`, built from one passing row per criterion, on its current
version, at the head. Does that close either cross-lane break? No.

- **A fail as the last verdict still lands.** Same 22 steps, same path.
  - L1's review ends first: its rows go to the record (`c1` fail, `c2` pass).
  - L2's review ends next: its rows go in after (`c1` pass, `c2` pass).
  - L2's read finds, per criterion, the latest row at the head. For `c1`
    that is L2's pass, so the proof is made and the head is queued.
  - L1 posts its fail after that. The queue lands the head.
  - The proof picks the latest row at a head, so two reviews of one head
    that disagree are settled by which finished last. A later pass undoes
    an earlier fail as surely as the other way round.
  - And the proof is checked once, at the read. A fail that comes in while
    the head waits in the queue does not take it out. The write's own check
    (`revive`) only asks if the proof proves itself, not if the record still
    agrees.
  - The claim still fixes it: one lane a ticket, one review a head.
- **The second lane still lands on an untested main.** Same 26 steps. The
  proof names the head and the criteria, never the main it was tested on.
- **The planted "missing review taken as passed" is still caught,** in 22
  steps, not 19. Ship now also needs rows at the head, so the shortest path
  waits until L2's review of `T1.c2` has ended and kept its rows, but before
  L2 posts. The head lands with rows in the record and no verdict posted on
  the pull request. The law reads the posted verdict, so it still breaks.
- Every other law and plant: same result, same steps. Only worlds with two
  lanes on one ticket changed size (above).

### The planted lasso

The pre-fix ship (before the waits were counted) waits for the checks with
no end. The planted copy keeps `waited` at 1, so the state comes round again:

```
prefix: L1 starts on T1 / L1 reads the ticket / L1 copies at m0 /
        L1 builder hands back its form / L1 pushes T1.c1 /
        L1 opens the pull request / T1 CI green at T1.c1 /
        L1 reads the pack at T1.c1: checks green /
        L1 reviewer hands back "pass" at T1.c1 / L1 posts pass at T1.c1 /
        T1 CI runs again at T1.c1 /
        L1 reads the ship facts at T1.c1: passed, checks pending
cycle:  T1 CI green at T1.c1 / L1 hears the checks settled at T1.c1 /
        T1 CI runs again at T1.c1 /
        L1 reads the ship facts at T1.c1: passed, checks pending
```

- The loop is fair: the clock for wait 1 is not possible while ship reads,
  so weak fairness does not force it.
- CI running again is a "may never happen" move. The loop is still a bug:
  the machine must end even when CI misbehaves forever. The real ship does,
  after 5 waits.
- The pre-fix code counted up with no cap, so its states never repeat. A
  search of finite states cannot close that loop. It shows as a search that
  never ends, as in experiment 90. The planted copy is how the lasso is shown.

### The planted dead state

```
L1 starts on T1 / L1 reads the ticket / L1 copies at m0 /
L1 builder hands back its form / L1 pushes T1.c1 / L1 opens the pull request /
T1 CI green at T1.c1 / L1 reads the pack at T1.c1: checks green /
L1 reviewer hands back "pass" at T1.c1 / L1 posting fails
```

- The loop takes the failed post as nothing and stays posting, with no Cmd
  in flight. Nothing can happen.

## After the fixes

Three holes closed in the real code, and the stall rule made one. The world
now runs the real claim and the real ship doors; the sketches left are the
desk told per round and the queue. Rerun with `ONLY=laws`; only the laws
rows in `results/91-world-laws.json` changed. The other tables above were
measured before the fixes (each lane now has two more steps: the claim and
letting the ticket go).

- **A failed head never lands.** Ship's enqueue and merge doors take the
  last verdict at the head, not the latest pass. A fail posted before the
  head is queued stops it.
- **Two lanes never work one ticket.** A claim per ticket on the ledger:
  `claimed` and `released` facts, written by a compare-and-set
  (`appendAfter`, which lands only if nothing came in since the read). The
  loop claims first and lets go before it ends; build and ship refuse a lane
  that does not hold the ticket.
- **Nothing lands on an untested main.** With no queue, the merge door
  compares the main the head was tested on with main now, and ends `behind`
  instead of merging.
- **The stall rule.** The loop reads `asksOnStall` from `asks/rules.ts`; its
  own copy is gone. One stall earns one more round; the second in a row asks
  the owner, at the round the desk raises its stuck ask.

| World (real code) | States | Steps | Laws |
|---|---|---|---|
| 2 lanes, own tickets, queue | 4,804 | 10,356 | all hold, every lane ends |
| 2 lanes, own tickets, no queue | 3,832 | 8,184 | all hold, every lane ends (was: untested main, 26 steps) |
| 2 lanes, one ticket | 346 | 518 | all hold, every lane ends (was: two lanes, 2 steps) |
| 2 lanes, one ticket, pass or fail, cap 1 | 442 | 634 | all hold, every lane ends |
| 2 lanes, one ticket, pass or fail, cap 2 | 1,200 | 1,640 | all hold (was: failed head lands, 22 steps) |
| 1 lane, desk, cap 4 | 96 | 112 | the ask reaches the owner (was: broken, 19 steps) |
| 1 lane, desk, cap 2 | 60 | 69 | **breaks**: the cap ask has no ask on the desk (20 steps) |

All under 20,000 states, the standard's budget.

- **Planted, each caught:**
  - no claim: two lanes on one ticket, 4 steps;
  - a claim read, then written: 6 steps;
  - a merge door blind to main, or none, with no queue: untested main, 28
    steps;
  - ship merges past the queue: now stopped by the door; with no door,
    untested main, 28 steps;
  - no claim and no door: a failed head lands, 24 steps (the fail is
    posted, then the head queued);
  - ship takes a missing review as passed: stopped by the door; with no
    claim and no door, a head with no verdict lands, 24 steps;
  - the loop's old stall copy (asks at the first stall): the ask is not on
    the desk, 20 steps;
  - the waits with no count and the ignored failed post: unchanged.
- **What the door alone does not stop.** With no claim, a fail posted
  after the head is queued still lands (24 steps): ship checks once, and a
  queued head is not pulled back. The claim is what keeps it: one lane a
  ticket, one review a head.
- **Left open:**
  - ~~The cap (`ask:owner:rounds`)~~ gone 2026-10-19: the cap is removed
    from the code. The `ship` and `no_change` asks have no fact
    on the desk, so a lane can stop asking with nothing on the owner's list.
  - GitHub's merge call pins the head only, so a push to main between the
    door's read and the merge is not caught.
  - The builder is told `behind` but nothing in build merges main in; the
    world lets it take main in, as a choice.
  - The ledger is in memory, per shell: no claim across processes yet, no
    lease or expiry. A failed release is retried only by the tidy-up.

## Size limits

Each ladder adds one thing per row (red CI, then errors, then a restart, then
cap 3, then flaky CI, then a third form) until a run passes 5 minutes or 4
million states. "Safety" runs with both reductions; "eventually" needs the
whole graph, so it runs with none. Cap 3 adds nothing with these forms, so its
column is left out.

```
lanes  kind        base      + red      + errors    + restart   + flaky
1      safety      1 ms      2 ms       4 ms        9 ms        164 ms (3,377)
1      eventually  2 ms      3 ms       3 ms        9 ms        171 ms
2      safety      64 ms     250 ms     681 ms      4.2 s       cut: 4M+ in 12 min
2      eventually  145 ms    500 ms     937 ms      6.1 s       cut: 4M+ in 6.4 min
3      safety      4.3 s     32 s       158 s       cut: 4M+ in 35 min
3      eventually  18 s      104 s      276 s       cut: 4M+ in 8.3 min
       (3 lanes eventually: 249,770 / 1.4M / 3.5M states)
```

- **In the normal suite (under 1 s):** one lane with every option; two lanes
  with up to two options (red CI and errors), safety and "every lane ends"
  both. That is what `world.test.ts` runs.
- **In a separate script (under 5 minutes):** two lanes with three options;
  three lanes with up to two options.
- **Not practical:** two lanes with flaky CI on top of three other options;
  three lanes with three options. Both pass 4 million states.
- **What sets the limit:** the product of the lanes' states, not depth.
  Every search ends by depth 47 to 83. Flaky CI and restarts cost most: each
  multiplies one lane by 3 to 10, and the product squares or cubes that.
- **Alphabet:** two lanes take 70 to 100 different moves comfortably; at
  150 and more (three lanes with errors, or flaky CI) the search does not end
  in time.
- **Speed:** 10,000 to 20,000 states a second without symmetry. With three
  lanes, the symmetry key (six renamings per state) drops that to about
  2,000 to 4,000. So at three lanes with errors, the whole graph with no
  reduction reached 3.5 million states in 4.6 minutes, and the reduced
  search 0.5 million in 2.6.
- **Memory:** under 2 GB for 4 million states with the graph kept, 5.5 GB
  for the slow three-lane symmetric run.

## TLA+: what it would add

- **What our checker gives that TLA+ does not:**
  - It runs the real reducers. No second model to keep in step; a code
    change is checked the next time the tests run.
  - The planted mistakes are one-line wrappers on the real step.
- **What TLA+ (TLC, Apalache, TLAPS) gives that this cannot:**
  - **Size.** TLC keeps states on disk and uses every core; 10^8 states is
    routine. Ours is one thread, in memory, about 15,000 to 50,000 states a
    second; a few million states is the end.
  - **Any number of lanes.** We check 2 and 3. A proof for any N needs
    TLAPS, or Apalache's symbolic search for a bound plus an argument.
  - **Rich temporal laws.** "Leads to", "always eventually", strong
    fairness, and refinement (this machine does what that spec says). Ours
    has one liveness law, "every lane ends", under weak fairness.
  - **A design before the code.** A protocol (the claim, a lease, the queue
    and catch-up) can be checked before any reducer exists.
- **Where TLA+ would pay:** a protocol across processes with no reducer
  yet, where any number of workers matters: the claim with leases and
  expiry, or several hosts sharing one ledger. Not the machines we have.

## What this cannot tell

- The world is a model. GitHub, CI and the ledger answer as written here;
  a real one may answer in ways not listed (a merge that half happens, a
  queue that reorders).
- The agents hand back fixed forms. Laws that need what an agent wrote are
  experiment 90's.
- The desk told per round and the queue are sketches (the claim was one,
  until "After the fixes"). The laws that hold with them hold for the
  sketch, not for code that does not exist.
- Two and three lanes only. Nothing here says four lanes keep the laws,
  though no law reads more than two lanes at once.
- Every ticket has the number 1. A machine that compared numbers across
  lanes would be checked wrongly under symmetry.
- The partial-order rule is argued and tested on these worlds; a law that
  reads a lane's own parts from another lane would make it unsound. The
  comment at `ample` says so.
