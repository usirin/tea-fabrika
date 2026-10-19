# 90. Every message order through the real reducers

The question: can we prove the pipeline's rules by trying every order of
messages on the machines we really run, the way a model checker does, with no
second model to keep in step? And can "ready to merge" be a type that only
proof can build?

**Answer: yes, and it found five real gaps. A small runner walks every Msg
sequence up to a bound through the real tea reducers, checks each law after
every step, and prints the shortest sequence that breaks one. On the four
stage machines (ship, review, build, the operate loop) 19 laws were checked.
14 hold in every world tried; 5 break on the real code (one only with a
reader that lies, one only when an answer can come twice). Every law was seen
to fail at least once, on the real code or on a planted mistake; all 17
planted mistakes were caught in 2 to 7 messages. Two of the rules asked for
are not in any machine yet. The machines are small enough that most
searches finish in under a second; the ones that never finish show a real
gap of their own. "Ready to merge" works as a type: a class with a private
constructor that only `ReadyToMerge.of(proof)` can make. Confidence the
method is worth making standard: 85%.**

## Who did what

- **The machines:** ship, review, build and the operate loop in
  `wip/src/stages/`, as they are on main. Not changed here.
- **The runner and the laws (`wip/src/laws/`):** new here.
  - `explore.ts`: the search.
  - `ship.ts`, `review.ts`, `build.ts`, `loop.ts`: one world, the laws and
    the planted mistakes per machine.
  - `laws.test.ts`, `explore.test.ts`: the small runs, in the normal tests.
- **The ready type (`wip/src/stages/ship/ready.ts`):** new here, a sketch.
- **The long runs (`90-reducer-laws.ts`):** the blowup tables.
- No model, no key, no network. Nothing written to GitHub.

## How it was done

### The runner

- A tea machine hears the world only as Msgs, and `update` is a plain
  function.
  - So "every order things can happen in" is "every Msg sequence".
  - The runner calls the real reducer on each one, through `applyCell`: the
    same dispatch `run` and `replay` use.
- It searches breadth first.
  - From each state it tries every Msg the world could send next.
  - It keeps a state only the first time it sees it.
  - It checks each law after every step.
  - It stops at a depth bound, and says if nothing was left to explore.
- Breadth first means the first break it finds is a shortest one.
  - It keeps how each state was first reached, so it can print the path.
- A reducer that throws counts as a broken law of its own.

### The world

- A Cmd the machine sends goes into a bag of Cmds in flight.
  - The world may answer any of them, in any order, with any answer it can
    give (ok or err).
  - Two copies of one Cmd get one set of answers.
- A restart (`resume`) empties the bag: Cmds in flight die with the process.
- Listens and clocks come at any time, stray or stale ones too.
- With echoes on, an answer may also come a second time, later.
  - This is "delivered at least once".
- Each answer set is small on purpose.
  - Ship: 6 fact sets per head by default, or 2592 (every mix of the fields).
  - Review: 3 check states × 2 deviation texts per head, 5 reviewer forms.
  - Build: 4 builder forms, a ticket open, closed or with a PR.
  - Loop: each stage's typed outcomes, 2 heads, caps 1 and 2 (3 and 4 in
    the long runs).

### Three kinds of law

- **One step:** looks at a step and says yes or no. "An ended run sends
  nothing."
- **Along a path:** a tiny reducer of its own that remembers something (the
  last facts read, the head built). Its memory is part of the state key, so
  two paths that remember different things are kept apart.
- **Across paths:** two steps anywhere in the search with the same key must
  give the same value. "The same form on the same ticket ends the same way,
  whatever the builder wrote."

### Planted mistakes

- Each is a wrapper around the real step, one line of wrong logic.
- Kept beside the laws, so the tests run them every time.

## The laws

| Machine | Law | Real code |
|---|---|---|
| ship | merge or enqueue only when the last read shows it ready, at that head | holds; **breaks** with a lying reader |
| ship | a review pass for another head never counts | holds |
| ship | only the head sent to the queue lands | holds |
| ship | an ended run sends nothing | holds |
| review | done only when every criterion passed at the head, checks green | holds |
| review | a form for another head or an old run never counts | holds |
| review | the builder's text never changes a criterion or the outcome | holds |
| review | a criterion's words are the ticket's | holds |
| review | a pass with a named limit leaves the criterion open | **breaks** |
| review | an ended review sends nothing | holds |
| build | a builder's form never changes a criterion | holds |
| build | the pull request closes its own ticket and no other | **breaks** |
| build | an ended build sends nothing | holds |
| loop | ship only on a passed review of the head this round built | **breaks** |
| loop | the builder never sets what the next round is told is open | holds |
| loop | a review that leaves no fewer open never starts another build | holds |
| loop | no round passes the cap | holds |
| loop | an answer counts only for the stage asked now | **breaks** (echoes) |
| loop | an ended loop sends nothing | holds |

### What breaks, shortest first

- **Ship trusts one word.** 2 messages.
  - `start`, then a read at A that says `reviews: passed` beside
    `review-code: failed`. The gate enqueues.
  - Today's reader builds both fields from one list (`reviewsOf`), so it
    cannot say this. The gate still trusts the summary, not the rows.
  - This is what the ready type below fixes.
- **Review takes a pass with a named limit as met.** 3 messages.
  - `start`, a pack at A with green checks, the form "pass, except the
    painted-shut one". The review ends done.
  - The direction says "a limit about what the code does is never a pass"
    ([done is per criterion](../docs/direction/done-is-per-criterion.md)).
  - `criteriaOf` marks a pass with a limit "met" and keeps the limit as a
    note.
  - Caveat: if the field is meant for a limit of the check, not of the code,
    the form needs two fields. Either way the machine cannot tell them apart.
- **The builder's summary can close another ticket.** 5 messages.
  - The builder writes "Opens the windows. Also fixes #2." The body is
    `Closes #1`, then the summary as written.
  - GitHub would close #2 on merge. No law in code stops it.
  - This is also a prompt-injection path: the builder reads the ticket and
    the code, and either can steer the summary.
- **The loop ships a pass for a head it did not build.** 4 messages.
  - `start`, build done at A, review done at B, verdicts posted: the loop
    starts ship.
  - The loop never compares the review's head with the build's.
  - Safe today only because ship reads fresh facts and checks reviews at the
    head it reads. With one head in the world, every loop law holds.
- **The loop takes a late answer from an earlier round.** 5 messages, with
  echoes.
  - Round 1's build answer comes again during round 2's build, and the loop
    takes it as round 2's.
  - Ship and review check `m.cmd.intent` against what they asked; the loop
    does not.
  - Only matters if an Act's answer can be delivered twice. If tea
    guarantees once per intent, this is not reachable; the check is cheap
    either way.

### Two searches that never end

- **Ship and review wait on checks with no count.**
  - "Checks settled" leads to a fresh read; if the read says pending again,
    the machine waits again, with a new clock.
  - Each wait has its own clock, but nothing counts the waits. A check that
    keeps restarting keeps the run alive forever.
  - It shows as one or two new states per layer, at every depth.
  - Not a safety break: nothing merges. A liveness gap.

### What no machine models

- **"Keep going" with a round limit, asking the owner again when it runs
  out.**
  - No machine has an owner's answer as a Msg.
  - The loop has a round cap set at start, and asks the owner on a stall or
    at the cap. Both laws hold. That is the nearest thing.
  - The direction says "no cap on rounds" and "a second stall in a row goes
    to the owner". The loop asks on the first stall and has a cap: the code
    is older than that rule.
- **A stuck task never ships unless the owner removed it.**
  - There is no plan-with-tasks machine yet.
  - The nearest: in the loop, a stuck review never reaches ship (planted
    "stuck is passed" breaks in 4 messages).
- Both laws are cheap to write once those machines exist: each is one
  path-memory law.

### Every planted mistake was caught

- Ship, 5:
  - forgets a missing review: 2 messages;
  - skips the fresh read after checks settle: 3;
  - keeps an old head's pass: 4;
  - lands any head the queue names: 4;
  - acts after the end: 3.
- Review, 5:
  - takes "unseen" as met: 3;
  - takes a form from another head: 3;
  - lets a deviation excuse a fail: 3, by two laws;
  - rewords a criterion from the deviation text: 3, by two laws;
  - acts after the end: 3.
- Build, 2:
  - lets the builder's "left" list drop a criterion: 4;
  - acts after the end: 3.
- Loop, 5:
  - takes a stuck review as passed: 4;
  - forgets what the review left open: 4;
  - stall rule off by one: 7 (needs cap 3);
  - ignores the cap: 4;
  - ships again after the end: 3.
- The laws that broke on real code were each also seen to fire there, so
  every law has been seen to fail at least once.

## Ready to merge as a type

- `ReadyToMerge` is a class with a private constructor and a `#` field.
  - TypeScript treats such a class by name, not by shape.
  - No literal, no `true`, no other object is one. There is no cast in it.
- The one way in is `ReadyToMerge.of(proof)`. The proof holds:
  - the ticket's criteria (never empty);
  - the verdict rows found, each pinned to the commit it judged;
  - the checks, read at one commit.
- It answers `{ready}` or `{refused: [...]}` with every reason:
  - no verdict for a criterion;
  - a verdict not met (open or unseen);
  - a verdict only at another head;
  - a verdict for other words than the ticket's;
  - checks not green, or green at another head.
- The latest verdict at the head wins: a later fail undoes an earlier pass.
- `enqueueOf(ready)` is what the queue step would take.
- Compile tests (`@ts-expect-error`): a literal, `true`, `new ReadyToMerge`,
  a bare `{pr, head}` to the queue, an open row as a met row, and a ticket
  with no criteria are all refused by the compiler.
- An exhaustive check: every mix of rows for two criteria and four checks
  reads (144 proofs) agrees with the rule in words.

### What wiring it would take

- **The reader:** ship facts need one verdict row per criterion, with the
  head it judged, not a summary word. Today review posts verdicts per kind
  (code, docs), not per criterion.
- **The criteria:** from the ledger, at the version the review judged.
- **The gate:** its "go" answer carries a `ReadyToMerge`, and the machine
  keeps it in state.
- **The Cmds:** enqueue and merge take `ReadyToMerge`, through a Schema
  class or brand, so a Cmd decoded from a log cannot skip the check.
- **Replay:** a state with a `ReadyToMerge` in it must decode back into one.
  Schema can do that with a transform through `of`.
- Size: one stage, about a day. The type holds in code today; the gate does
  not use it yet.

## How big it gets

- States kept, against the depth bound (the longest Msg sequence tried).
- "widest" is the most Msgs tried from one state: the alphabet as the
  machine meets it.

- "ends": nothing was left to explore before the bound.

| Machine | World | Depth | States | Steps | Widest | Time |
|---|---|---|---|---|---|---|
| build | 4 forms | 8 | 86 | 710 | 12 | 0.0 s, ends |
| build | 4 forms, echoes | 10 | 514 | 4,738 | 14 | 0.1 s, ends |
| loop | 1 head, caps 1 and 2 | 12 | 307 | 1,225 | 9 | 0.0 s, ends |
| loop | 2 heads, caps 1 and 2 | 12 | 1,507 | 6,127 | 14 | 0.1 s, ends |
| loop | 3 heads, caps 1 and 2 | 12 | 3,651 | 15,029 | 19 | 0.3 s, ends |
| loop | 2 heads, cap 3 | 16 | 6,292 | 19,576 | 13 | 0.5 s, ends |
| loop | 2 heads, cap 4 | 20 | 18,820 | 59,056 | 13 | 1.6 s, ends |
| loop | 2 heads, echoes | 8 | 39,066 | 102,998 | 23 | 6.2 s |
| loop | 2 heads, echoes | 10 | 198,623 | 857,826 | 28 | 59 s |
| review | 2 heads | 14 | 523 | 11,923 | 36 | 0.3 s |
| review | 3 heads | 10 | 759 | 24,811 | 52 | 0.7 s |
| review | 2 heads, echoes | 10 | 19,900 | 297,940 | 51 | 15 s |
| ship | 2 heads, 6 fact sets | 40 | 4,771 | 92,521 | 27 | 0.7 s |
| ship | 3 heads, 6 fact sets | 20 | 6,504 | 164,917 | 39 | 1.3 s |
| ship | 2 heads, 2592 fact sets | 8 | 22,739 | 1,382,619 | 5,199 | 11 s |
| ship | 2 heads, 6 sets, echoes | 10 | 169,692 | 1,257,552 | 42 | 33 s |

- **Without echoes, nothing blows up.**
  - Build and the loop end on their own, in well under two seconds.
  - Ship and review do not end, but grow by a state or two per depth, from
    the wait count. Depth 40 on ship is 0.7 s.
  - One more head adds about half again. One more round of cap roughly
    triples the loop, and still ends.
- **Wide answer sets cost steps, not states.**
  - Ship with every mix of facts (5,199 Msgs from one state) settles at
    about 22,700 states, but each one tries 5,000 answers: 1.4 million steps,
    11 s at depth 8.
  - Most of those facts lead to the same next state. Fewer, well-picked
    answers lose nothing here.
- **Echoes are where it stops being practical.**
  - Each answer that may come again doubles what is in flight.
  - The loop goes 6 s at depth 8 to 59 s at depth 10; ship 3.6 s to 33 s.
    Roughly ×5 to ×10 per two steps.
  - Every echo break above needs 5 messages, so depth 6 to 8 is enough in
    practice.
- **The practical line:** about 200,000 states, or a minute, on one core.
  The normal tests stay under 3 s for all four machines; the long runs are in
  the script (3.5 minutes).

## What it means

- Laws on the real reducers find real gaps fast.
  - Each break above came with a sequence of 2 to 5 messages that reads
    like a story.
  - None needed a second model kept in step with the code.
- The world is the hard part, not the search.
  - What the runner proves is "for these answers". A law holds for every
    order, not for every value.
  - The ship gate break needed a reader that disagrees with itself. A small
    world that is too honest hides it.
- Per-path memory laws carry most of the weight. Stateless laws only catch
  "acts after the end".
- **Recommendation: make it a standard check on every machine.**
  - Why: every machine already is a pure reducer. A world and three to six
    laws per machine cost about a hundred lines, and run in under a second
    in the normal tests.
  - Trade-off: the world must be kept honest by hand. A law can pass
    because the world never sends the Msg that breaks it.
  - Lift: one more check of the world itself, that every Msg type of the
    machine is sent at least once in the search.
  - Confidence: 85%.

## Limits

- Only the reducers. Not the interpret handlers, GitHub, or the agents.
- Only the values the world gives. A real head SHA, a real ticket body, a
  third criterion: each is one more value, and the blowup table says what
  that costs.
- Depth bounds: most searches end on their own (build, the loop). Ship and
  review never do, because of the wait count.
- The "across paths" law keeps a map for the whole search. It is correct only
  for one search at a time.

## Follow-up: fixes and standard check

The five breaks are fixed on the machines. Each one's breaking sequence is
kept as a named regression test in `wip/src/laws/laws.test.ts`, and each
fix came after a commit with that test failing.

- **A pass with a named limit.**
  - The reviewer's form may still name a limit, but code refuses it ("a
    limit is never a pass") and sends the form back.
  - The graded row type (`Graded` in the sheet, `Judged` in the verdict) has
    no `limit` field, so nothing after the form can count one.
  - Made impossible.
- **Builder text closing other tickets.**
  - The commit and the pull request's text are typed parts now
    (`stages/build/body.ts`). One writer puts `Closes #n` for the plan's
    ticket, and passes every builder string through `inert`.
  - `inert` breaks `#n`, `GH-n` and issue urls with a zero-width space, so
    GitHub reads no reference in them.
  - Made impossible: no builder string can form a closing reference.
- **The loop shipping a pass for another head.**
  - The loop's "ship" step carries the head. It ships only when the review
    passed the head its own round built; otherwise it ends stuck, and says
    which head passed and which was built.
  - Checked in the loop itself, not left to ship's fresh read.
- **A round-1 answer taken as round 2's.**
  - Every loop answer is taken only when its Cmd's intent
    (`loop/<ticket>/<round>/<stage>`) is the one the state asked; any other
    is ignored.
- **The ship gate trusting a summary word.**
  - `ShipFacts.reviews` is the rows alone now: at least one, or `null` when
    the reader could not tell which reviews are owed. The gate works out the
    word from the rows every time (`reviewsOf`).
  - Made impossible: there is no second field to disagree with the rows.
  - Not done: wiring `ReadyToMerge`. It needs the reader to bring rows per
    criterion, the criteria from the ledger, the gate, its Cmds and replay
    decode. About a day's work, on its own.
- **The searches that never ended.**
  - Ship and review now count their waits on the checks, and end
    `checks_stuck` after `MAX_WAITS` (5). Each wait still has its own clock.
  - Both searches now end: ship at 1,483 states by depth 20, review at 723.
    With an end, every law is checked on the whole space, at any length.

### The standard check

- `wip/src/laws/specs.ts` holds one laws spec per machine: its world, its
  laws, and how deep to walk.
- `wip/src/laws/standard.test.ts` runs in the normal tests.
  - It finds every machine by its `defineMachine(` call under `wip/src`,
    and fails when a file's machines and its specs differ in number. A new
    machine fails the suite until it has laws.
  - Each spec must break no law, send every Msg type the machine takes
    (`msgKeysOf`) at least once, and finish in under a second.
- **Coverage:** the four machines above already sent every Msg type they
  take. No law held only because a Msg was never sent.
- **Time:** the nine specs take about one second in all. Review is the
  slowest, at 0.4 s.

### First laws for the other five machines

`wip/src/laws/first.test.ts` shows each new law failing on a planted
mistake, and pins each break by its shortest sequence.

- **The kept work queue:** 4 laws, all hold.
  - A value is on it once; the value being worked stays first; values are
    worked in the order told; work that ended is tidied before it is
    forgotten.
- **The acp session:** 4 laws; one broke, fixed.
  - A second `opened` moved the session to another harness and id, though
    its own comment says it cannot. Only the host's check stopped it. Now
    the machine ignores a second `opened`.
- **The acp transcript:** 3 laws; one broke, fixed.
  - A finished tool call went back to running on a late update, and the
    status line counted it as running. A finished call now stays finished.
- **Refine (the draft-and-vet child):** 4 laws; one broke, fixed.
  - The same gap as the loop: a write's answer that came twice was taken as
    the next try's draft, and a late check as the verdict on a newer draft.
    Each answer must now carry the Cmd the run is waiting on.
- **Plan:** 6 laws, all hold.

### What this does not cover

- The worlds of the session, the transcript and refine send Msgs their hosts
  do not send today: a second open, an update out of order, an answer twice.
  Those three fixes guard the machine, not a failure seen in a live run.
- A spec checks "for these values" still. Coverage of Msg types says each
  type was sent, not that every value that matters was.

## Follow-up: ready to merge, wired

- **Criterion ids.** The book (`wip/src/criteria/book.ts`) gives each
  criterion an id `c1`, `c2`, ... in the order it was added, and a version
  that goes up on each reword. A retired id is never given again.
  - `CriterionId` is a branded Schema string, used as a field in plain
    structs. Only the book gives one.
- **`ReadyToMerge` is plain data now, not a class.** tea's state hash cannot
  hash a class, and a Cmd input must read the same on both sides of a log.
  - It is a branded type. The one way in is still `ReadyToMerge.of(proof)`.
  - Replay, the handlers and the machine check it again at run time, so a
    proof decoded from a log cannot skip the rule.
- **The reader.** Ship facts carry the ticket's criteria and one verdict row
  per criterion (id, version, head, pass or fail, proof), read from a
  `CriteriaRecord`. The review keeps its rows there.
- **The gate.** Enqueue and merge take only a `ReadyToMerge`. No criteria:
  stuck `criteria_unknown`. A failed row: back to the builder. No row, a row
  at another head, or on an old wording: back to the reviewer. A kept proof
  that no longer holds: stuck `proof_refused`.
- **New law:** a merge carries a passing row per criterion, on its current
  version, at its head. It holds.
- **The ship world** now has 11 fact sets per head, not 6. No law breaks in
  any of the 69 rows. Each state costs more: depth 20 is 1,515 states (the
  whole space, it ends by depth 30) in 0.9 s.
- **Not wired yet.**
  - Criteria a review adds itself get no id.
  - Live runs keep rows in memory only. The ledger record exists and is
    tested, but no launcher uses it yet.
  - The legacy shell reviewer keeps no rows, so ship there sends PRs back for
    review instead of merging.
