# Pipeline guidelines: a factory that resumes, and asks a person only to judge

**Decided 2026-11-01.** The owner set P1, P2, P4, P5 and P6, the core of P7 (every step is
idempotent and resumable) and "record wide" first, then approved every lean below and the three
Linear clashes after a walk of each part. The confidence numbers stay as written, so a later run can
test the least sure: the bounds in P8 (65%) and two nudges in P11 (60%). P9 was decided on
2026-10-05 and P12 on 2026-10-22, in their own notes.

Built from [experiment 186](../../experiments/186-pipeline-guidelines.md), which read how
factories, supervisors, durable workflows, CI systems and build caches handle a stop, and
checked the self-fix plan of [PR 289](https://github.com/usirin/tea-fabrika/pull/289) against
the result. It is reading, not a measurement. It sits under the note "Jidoka and andon", on its
own branch in PR 289, which applies these rules to today's lane, row by row. Both PR 289 files
named here, that note and the plan "pipeline-self-fix", are on that branch, not on main.

```ts
// A sketch. A step still answers in the five verbs. What is new is what each one must carry.
type End =
	| {readonly _tag: "done"; readonly key: Key}                          // kept; never run again for this key
	| {readonly _tag: "send"; readonly to: LaneStep; readonly why: Why; readonly evidence: Evidence}
	| {readonly _tag: "ask"; readonly for: Judgment; readonly shows: Shows; readonly picks: Picks}
	| {readonly _tag: "skip"; readonly why: Why}                          // written, with its why
	| {readonly _tag: "stuck"; readonly why: Why; readonly resume: Resume}; // andon: the line stopped itself

type Key = {readonly step: LaneStep; readonly inputs: Hash};       // a hash of what the step read
type Resume = {readonly step: LaneStep; readonly carry: Held};     // saved before the stop is written
type Picks = NonEmpty<{readonly pick: string; readonly resume: Resume}>; // each pick says where it goes on

const route = (end: End, rounds: number): Move => {
	switch (end._tag) {
		case "done": return {to: NEXT[end.key.step]};
		case "send": return rounds < MAX_ROUNDS ? {to: end.to, with: end.evidence} : {ask: roundsSpent(end)};
		case "ask": return {wait: end};               // the answer resumes at its pick's step
		case "skip": return SKIP[end.why];
		case "stuck": return {stop: end.resume};       // the same line again runs end.resume.step, and nothing before it
	}
};
// Before any step runs: a `done` fact with the same Key exists, so the step does not run.
```

One stop traced, on ticket 117's real first run, as these rules would have run it:

```text
build r1 ends       code runs the checks at 315df8e6: red, 1 failing        P2, P9
                    apps/fabrika/src/tsh.test.ts > ... the frame's takes
send:builder        build r2 gets that name and its first error lines        P2, P8
  (the host dies here, say)
same line again     reads the saved Resume: build r2, carry as it was        P4, P6
                    triage, plan, the yes, test writer, build r1: done keys, not run again   P7
build r2 ends       checks green -> mutation -> review -> push
ask:owner:merge     the first time a person is needed after the plan's yes   P1
```

## Which version

- **Today's version (`packages/pipeline`, `programs/pipeline`):** all of it. The self-fix plan on
  PR 289 is its first build. Today's code is the running example, read on main at `02a238ea`.
- **`next/`:** the same principles, rethought, not ported
  ([rethink, do not port](./rethink-do-not-port.md)). The lane in `next/` is not designed yet.
  Whoever designs it starts from this note, so the owner does not have to correct it again.

## The known way

| Who | What they do | What we take |
|---|---|---|
| [Toyota, TPS](https://global.toyota/en/company/vision-and-philosophy/production-system/) | Machines "detect the abnormality and stop automatically". "People need only respond when there is an abnormality." | The lane stops itself. A person is called only by a stop. |
| [Lean Enterprise Institute: jidoka](https://www.lean.org/lexicon-terms/jidoka/), [andon](https://www.lean.org/lexicon-terms/andon/), [poka-yoke](https://www.lean.org/lexicon-terms/poka-yoke/) | Jidoka "separate[s] men and machines". An andon shows where and what. A shutdown device is "the most powerful", a warning device less so. | Each stop says where and why. A guard beats a warning. |
| Shigeo Shingo, *Zero Quality Control* (1986) | Inspect at the source, right after the act that can go wrong. | A check runs in code right after the step it checks. |
| [Erlang/OTP supervisors](https://www.erlang.org/doc/system/sup_princ.html) | `one_for_one`: "only that process is restarted". Intensity and period "default to `1` and `5`". Past it, the supervisor ends and its parent decides. | Restart only what broke, a bounded number of times, then hand up. |
| [Temporal](https://docs.temporal.io/workflow-execution/event) | A reset copies "the Event History ... up to and including the reset point", and "continues from the reset point". [Activities](https://docs.temporal.io/activity-definition) should be idempotent, keyed by "Workflow Run ID and the Activity ID". | Keep the finished steps' facts. Key each write. |
| [GitHub Actions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) | `gh run rerun RUN_ID --failed`, on "the same `GITHUB_SHA`". | One line reruns only what failed, on the same inputs. |
| [Bazel](https://bazel.build/remote/caching), [Nx](https://nx.dev/docs/concepts/how-caching-works) | An action's hash covers its inputs, command line and environment. A hit restores the output and does not run. | A finished step whose inputs did not change does not run again. |
| [Google SRE, monitoring](https://sre.google/sre-book/monitoring-distributed-systems/) and [toil](https://sre.google/sre-book/eliminating-toil/) | "Every page should be actionable." "If a page merely merits a robotic response, it shouldn't be a page." | Ask a person only what needs a person. Count every ask. |
| [AWS Builders' Library](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) | Retries at five layers of three each load a database "243x". "Retry at a single point in the stack." | Retry at one level only. |
| [Buildkite](https://buildkite.com/docs/pipelines/configure/retry), [Argo](https://argo-workflows.readthedocs.io/en/latest/retries/) | Buildkite's automatic retry defaults to two, at most 10, by exit status. Argo retries by a policy (`OnFailure` by default). | A bound is a number in code, chosen by what failed. |

## The Elm answer first

- A parent steps its children by hand and reads their outcomes
  ([outcome names](./outcome-names.md)). These guidelines change only what an outcome carries and
  how the parent routes it. No sixth verb and no new move.
- OTP's answer to a child that broke is a supervisor with an intensity. The lane is that supervisor
  for its steps, and a person is the one above it. A restart is a Msg to the lane.
- The saved state is the model. A resume is `init` from the saved model, never from the blank one.

## How Linear would do it

Linear has built this product. Since June 2026 its own agent takes a delegated issue, writes the
code in a cloud box, and returns a draft pull request; Loops start that work on a trigger, and
Reviews is where a person reads the diff. Each principle below has a line on what Linear does. The
full reading, with every page and date, is in
[experiment 186](../../experiments/186-pipeline-guidelines.md#how-linear-would-do-it).

```ts
// Linear's agent session states, beside our five verbs. Linear sets the state from the last activity.
type LinearSession = "pending" | "active" | "awaitingInput" | "error" | "complete" | "stale";
const OURS = {
	pending: "a step running", active: "a step running",
	awaitingInput: "ask", error: "stuck", complete: "done",
	stale: "a view: 30 minutes with no activity, cleared by the next one",
} satisfies Record<LinearSession, string>;
// No Linear state for send or skip: a send-back there is a person or a loop.
```

- **Where we agree.** A person stays responsible (P1). A person's answer goes on in the same
  session (P5). The record is activities frozen at the time, not editable comments (P6). A failed
  check blocks the move forward (P3, P9). What ships is decided by rules the agent cannot change
  (P12).
- **Where we differ, and keep ours.** Linear never sends red back or runs a failed agent run again
  on its own; a person or a loop they set up does (P2, P8). It routes free text with an LLM (P10).
  It does not count attention (P11). Each difference follows from P1: what is not a judgment does
  not wait for a person.
- **A lean changed.** P11 gains one: an unanswered ask gets at most two nudges, then shows as
  waiting, as Linear does for a missed project update. 60%.
- **Clashes with Linear, decided by the owner on 2026-11-01.**
  1. **A person's `stop` is a saved pause, not an end.** Linear's `stop` is a pause too. The same
     line goes on from the step that was stopped (P4). A lane a person wants gone closes with its
     ticket. 85%.
  2. **A person may speak unasked, by a plain comment.** Linear lets a person "steer the approach"
     of a running session. Here a comment on the ticket is the way in: the running step reads it
     at its next turn, or the next step does when none runs. It never cuts a turn off. The comment's
     fact records `during`, the run that was live when it was written, filled in by code (what the
     person saw, recorded now). A "reply to this step" view is later a filter on `during`. 80%.
  3. **Red goes back on its own, by default.** Linear makes it a loop each team turns on. Here it is
     on, with a repository setting to turn it off. 70%.

## The twelve principles

Each says what it means, where the known way is, what it would have done on ticket 117's real
first run, how sure, and **what holds it**: the type or test that makes breaking it fail. A
principle with no holder is a wish ([make the mistake impossible](./make-the-mistake-impossible.md)).

### P1: a person is asked only for a judgment

**Decided 2026-11-01.**

- **What it means.** The lane asks a person only for a call only a person can make: approve a plan,
  change the exam, merge, spend more, decide what a ticket means. Everything else is a factory: it
  is prevented (P3), fixed by a send-back (P2), retried within a bound (P8), or the line stops
  itself with the reason (andon).
- **The known way.** Toyota: "People need only respond when there is an abnormality." Google SRE:
  "Every page response should require intelligence", and "Pages with rote, algorithmic responses
  should be a red flag."
- **How Linear would do it. Agree.** "An agent cannot be held accountable": a delegated issue keeps
  a person as assignee, and a coding session runs on its own, "you'll be notified when your input
  is needed". GitHub's review rules still decide what ships. Linear also lets a person steer a
  running session without being asked; here that door is a plain ticket comment (clash 2).
- **On ticket 117.** The plan's yes was a real judgment, and it was asked. Then the lane ended stuck
  on one stale test, and finding the cause took a read-only agent run by hand. Under P1 the next
  ask after the plan's yes would have been the merge.
- **What holds it.** `Judgment` is a closed union of literals ("Jidoka and andon" lists 16, with `exam_touched` and `exam_conflict`). A new ask is a new literal, which is a
  reviewed change. A law over `route`: a `send`, a `skip` or a `stuck` never routes to an ask,
  except `rounds_spent` once the bound is spent.

### P2: red after a build goes back to the builder

**Decided 2026-11-01.**

- **What it means.** Red tests or red checks after a build are a send-back, not a stop and not an
  ask: `send:builder:checks_red`, with the failing names and their first error lines. The builder
  fixes it in the next round.
- **The known way.** Shingo's source inspection: catch it right after the act, at the station that
  made it. Toyota's line stops at the station, and that station fixes it.
- **How Linear would do it. Agree on the route, differ on the default.** A coding session can be
  told to "fix lint issues" or "address review comments", in the same thread, and a loop can start
  on "checks passed or failed". But each is a person's delegation or a loop a person sets up. Our
  lane does it on its own, within the round bound, because P1 says red is not a judgment. It is
  on by default, with a repository setting to turn it off (clash 3).
- **On ticket 117.** `tsh.test.ts:724` still expected `takes("map")` to be `[]`. It is not an exam
  file, so the builder may change it. Round 2 with that name would most likely have fixed it.
- **What holds it.** A law: after a build whose `checked` is red with rounds left, the lane's next
  step is build, round + 1, with the names in `open`. PR 289's PR 3 writes this test.

### P3: prevent first, then fix, then stop

**Lean, 85%.**

- **What it means.** Every place the lane stops is one of three classes, in this order of
  preference. Preventable: a guard makes the state impossible. Fixable: a bounded route fixes it.
  Judgment: only a person can. An andon stop is what is left when the line could neither fix it
  nor ask a narrower question.
- **The known way.** Shingo's poka-yoke. The Lean Enterprise Institute ranks a shutdown device,
  "a machine will not start if a work piece is set incorrectly", above a warning.
- **How Linear would do it. Agree.** Its "ready for merge" move does not fire if any check fails,
  a guard and not a warning. Triage Intelligence only suggests, unless the owner turns a property
  to auto-apply, one property at a time.
- **On ticket 117.** The test writer's `window.test.ts` failed the format check. A send-back would
  cost a round and cannot work, since the builder may not touch an exam file. Code formatting it
  before the commit makes the state impossible.
- **What holds it.** Each preventable stop has a law that its state is never reached from `init`.
  Today's lane already has the pattern: `origin` is refused before any agent starts.

### P4: resume, never redo

**Decided 2026-11-01.**

- **What it means.** A stuck or crashed lane is a crash recovery case. It goes on from the step that
  broke, with the carry it had, and keeps every step that ended `done`. It never starts the lane
  from scratch. A stop is not the end of the lane's memory. A person's `stop` is a saved pause
  (clash 1); only a case that is not this lane's to run, or a ticket a person closes, ends a lane
  for good.
- **The known way.** OTP `one_for_one`: "only that process is restarted". Temporal's reset keeps
  the history "up to and including the reset point". GitHub's `rerun --failed` runs only the
  failed jobs, on the same commit.
- **How Linear would do it. Agree, with one clash.** A session that errored or ran out of credit
  goes on in the same session when a person replies: "Blocked work does not resume
  automatically", and the reply keeps what was done. A stale session is "recoverable by sending
  another agent activity". But Linear's `stop` is a pause: the agent steps back and comes back on
  "a clear signal". Decided the same way here: a person's `stop` is a saved pause (clash 1).
- **On ticket 117.** The resume starts at mutation. Triage, the plan and its yes, the test writer's
  `5d38d582` and the builder's `315df8e6` all stay. Main has moved, so the unpushed branch is
  rebased, code's checks run at the new head, and build round 2 gets the red name.
- **What holds it.** PR 289's law: for every step and every stuck reason, stop there, then
  restart, and the restart runs that step with the same carry. Plus one rule this note adds: the
  cases that cannot restart are a closed list of two (`not_yours`, `merged_elsewhere`), so a new
  stuck reason is restartable by default, never left out by default.

### P5: after a person's judgment, the lane goes on from the step before

**Decided 2026-11-01.**

- **What it means.** A person's answer never restarts a lane. Each pick goes on from the earliest
  step the answer makes stale, and keeps everything before it. Redoing finished work wastes money
  and time.
- **The known way.** Temporal and LangGraph both hold a person's answer inside a running workflow:
  the run waits, the answer arrives, and it goes on from there (read in
  [one ask](./one-ask-and-one-meter.md)). GitHub's environment reviewers approve a job that waits;
  the jobs before it do not run again.
- **How Linear would do it. Agree.** An answer to an `elicitation` comes back as a `prompt` in the
  same session, and the agent goes on with its history. When a person asks to redo a session on a
  stronger model, Linear keeps "the original pull request for reference".
- **On ticket 117.** Made up, since it did not happen: say round 2 had changed `window.test.ts`, an
  exam file. The ask `exam_touched` has two picks. "The builder was wrong": code puts that file back
  as `5d38d582` left it, on the builder's head, and build round 3 runs there. "The test is wrong":
  the test writer runs for that file only, with the person's note, then build goes on from its
  head. Triage, the plan and its yes stay either way.
- **What holds it.** `Picks` requires a `resume` on each pick, so an ask without one does not
  compile. A law: no answer to any ask routes to a step before its pick's `resume.step`.

### P6: every stop saves what a resume needs

**Decided 2026-11-01.**

- **What it means.** Before a stop is written, the lane saves its resume point: the step, the carry
  (plan, version, base, exam commit, head, round, claim) and the evidence (the failing names, the
  first error lines, what could not run). The evidence exists only at the moment of the run, so it
  is saved then or lost for good.
- **The known way.** Temporal's Event History. An andon shows the station and the kind of problem,
  so the person who comes knows where to look.
- **How Linear would do it. Agree.** An agent rebuilds its context from Agent Activities, "frozen-in-time
  snapshots", not from comments, which can be edited. An `error` activity says why, and a loop
  keeps a run history. Linear also shows liveness: a session with no activity for 30 minutes shows
  `stale`. We take that as a view: the window shows the time since a step's last fact, with no
  threshold and no ping.
- **On ticket 117.** The saved `over` kept only the outcome and the trail (`machine.ts:266-271`).
  The mutation step kept only an exit code (`stryker.ts:383-386`), and the copies were deleted. No
  test output exists anywhere.
- **What holds it.** `stuck` has a required `resume`, and a stuck `over` has a required `Held`:
  a stop without them is not a value. A law: the fold of the lane's facts equals its saved `Held`
  at every point a lane can stop, so a lost save can be rebuilt (PR 289's PR 5 has it).

### P7: a step is idempotent, keyed by its inputs

**Decided 2026-11-01: every step is idempotent and resumable. Lean, 75%: the key is a hash of its
inputs.**

- **What it means.** A step's `done` fact carries a key: a hash of what the step read (ticket text,
  plan version, base, exam commit, head, brief hash, model, settings). A key that matches a `done`
  fact means the step does not run. A key that changed runs the cheapest check that can tell
  whether the old answer still holds, a code check before an agent; only a failing check runs the
  step again. Reads stay fresh ([read fresh, run alone](./read-fresh-run-alone.md)); a fresh read
  only changes a key.
- **What a key is.** A short fingerprint of everything a step read. The same inputs always give
  the same key; a change to any input gives another. It is one string, so any machine can compare
  it, the way git names a commit by its content.

  ```ts
  // A sketch: ticket 117's build step.
  const inputs = {
  	plan: "v1#a41c…", // the approved plan's text, hashed
  	exam: "5d38d582", // the test writer's commit
  	base: "92740b74", // main when the step started
  	brief: "build#7e02…", // the builder's brief, hashed
  	model: "gpt-6-astra",
  	effort: "high",
  };
  const key = sha256(JSON.stringify(inputs)); // "b3f1e9…" for these inputs, every time

  // When build ends, its fact keeps the key:
  // {_tag: "done", step: "build", key: "b3f1e9…", head: "315df8e6"}

  // On a restart the lane works the key out again:
  //   same key, and a done fact has it  -> build is skipped; the lane takes head 315df8e6
  //   main moved, so base and the key changed -> a code check first: do the tests pass on the
  //     rebased head? yes: a new done fact, no agent paid. no: the builder runs again.
  ```

  The risk is an input left out of the key: then a stale answer looks fresh. So every input has a
  test that changing it changes the key.
- **The known way.** Bazel and Nx: an action's hash covers its inputs, command line and
  environment, and a hit restores the output instead of running. *Build systems à la carte*
  (Mokhov, Mitchell and Peyton Jones, ICFP 2018) names the second half "early cutoff": a rebuilt
  input that turns out the same stops the rebuild there. Temporal and AWS key every write; AWS
  refuses a reused key with different parameters.
- **How Linear would do it. Agree on the first half, go further on the second.** A loop's webhook
  takes a `Webhook-Id`: "reuse that ID when retrying the same event ... to avoid duplicate runs".
  That is a key by event, like today's intent key. Linear never skips an agent's work because its
  inputs did not change; a person starts it again. Keying by inputs is ours, from Bazel and Nx,
  so the 75% stays and Linear is not a source for it.
- **On ticket 117.** Main moved, so base changed, and build's key no longer matches. The rule does
  not rerun the builder. It rebases, reruns the test writer's check on the new base, then runs
  code's checks at the new head. Only the red name goes to build, as round 2, not as a redo of
  round 1.
- **Today.** A step's intent is `lane/<n>/<count>/<step>` (`intentOf`, `machine.ts:513`): keyed by
  its place in the lane, not by what it read. That already stops a step from running twice after
  a kill (experiment 175). It cannot tell that a finished step still holds after main moved.
- **The doubt.** An agent step is not a pure function: the same inputs can give a different draft.
  The key says "this was done, do not pay again", never "this would come out the same". And Bazel
  warns that what the hash leaves out can "wrongly share cache hits": a key without the brief's
  hash or the model would keep a stale draft. What would settle it: a property test that changing
  any input field changes the key, and a count of keys reused across real restarts.
- **What holds it.** That property test, and a law: a step with a `done` fact for its key is never
  started.

### P8: retries are bounded, at one level, with a source for each bound

**Lean, 65%.**

- **What it means.** Three kinds of retry, each with its own bound, each a constant in code:

| What failed | Bound | Where | Source |
|---|---|---|---|
| A read or write of our ledger or the code host | until it answers, with backoff | the service that owns it, never the lane | `idempotency.ts` already waits out a ledger with no limit on tries; AWS: retry at one point |
| A step that could not run (a crash, a box that would not start) | once more, same key | the lane | OTP's default intensity of 1 (per 5 seconds); Buildkite's default of 2 |
| A send-back (red checks, review findings) | 3 rounds, shared | the lane | **a guess**: today's `MAX_ROUNDS`; one demlik lane needed 3 builds (field note 2026-10-31-02) |

- **The known way.** AWS: retries at every layer multiply; three each at five layers is 243 times
  the load. Temporal retries an Activity with no limit by default, backing off to 100 seconds, but
  an Activity there is cheap and ours is a paid agent turn. Buildkite caps automatic retries at 10.
- **How Linear would do it. Differ on one row.** Linear retries delivery at the edge, keyed by
  event id, which is our first row. It does not run a failed agent run again on its own: a person
  gets "a loop run failed notification" and picks **Run now**. We keep one automatic try for a
  step that could not run, because a box that would not start is not a judgment (P1). The 65%
  stays; Linear's way is the safe fallback if that one try turns out to waste money.
- **On ticket 117.** The builder's checks died in its box, and nothing tried again outside it.
  Under P8, code's checks run outside the box, once more if they cannot start, then an andon stop
  that says why.
- **The doubt.** No source names a round count for an agent's repair loop, and 3 is ours. The
  `step` rows in `field/runs.jsonl` will show the real spread after a few lanes.
- **What holds it.** A law: build runs at most `MAX_ROUNDS` times per lane, plus one per person's
  `again`. A law: a step that could not run starts at most twice per key. No step machine retries
  what the lane retries.

### P9: a skipped check never looks clean

**Decided 2026-10-05,** in [make the mistake impossible](./make-the-mistake-impossible.md).
Restated for the lane.

- **What it means.** A check has three results: green, red, not run. Not run is never `done`, and a
  check skipped on purpose writes that it skipped and why. A builder's own report decides nothing
  ([nobody grades their own work](./nobody-grades-their-own-work.md)).
- **The known way.** Shingo: a check after the act, by a device, not by the worker's word.
- **On ticket 117.** The builder's test run died with `spawnSync git EPERM`. It wrote that down and
  still said `done`, and nothing in code ran the checks after it.
- **What holds it.** `Checked` is a union of `green`, `red` and `not_run`, and a step after build
  takes only a `green` for that exact head, so a wrong or missing check does not compile.
- **How Linear would do it. Agree.** "Ready for merge" needs "either review or checks"; with
  neither, it does not fire. An issue with two pull requests moves only when the last one does. Today's
  law "a skip is written" covers the rest.

### P10: an ask names its picks, and where each pick resumes

**Lean, 85%. The resume part follows from P5, which is decided.**

- **What it means.** An ask shows the person what they decide on, in words (the one hash covers
  it), and lists its picks. Each pick says what it does and where the lane goes on: "again: build
  runs round 4", "stop: saved; the same line goes on at build". A `stop` pick saves its resume
  point too.
- **The known way.** [One ask](./one-ask-and-one-meter.md): `shows`, `picks`, and a hash of what
  the person saw. SRE: "Can I take action in response to this alert?" Buildkite shows a `reason` on
  a Retry button it turns off, so even a no says why.
- **How Linear would do it. Agree on picks, differ on free text.** An `elicitation` with the
  `select` signal lists options, each with a `label` and a `value`. A person may also reply in free
  text, and Linear says the agent "should always use an LLM to interpret the response". We keep
  code routing on a pick: free text rides along as the `note` on a pick, and a reply with no pick
  leaves the ask open. A lane's next step is never an agent's guess.
- **On ticket 117.** The plan's yes had picks, approve and no. The rehearsals found the other side:
  a person saw `test_writer asks: ask:owner:cannot_test` with `again`, `go_on`, `stop` and no
  reason ([experiment 178](../../experiments/178-lane-rehearsal.md)).
- **What holds it.** An ask kind is defined with its picks, and each pick with its `resume`. The
  window draws only `shows` and `picks`. A law: each pick routes to its own `resume.step`.

### P11: cost and attention are both counted

**Lean: count now, 80%. No cap on asks until there is data, 70%. At most two nudges on an
unanswered ask, 60%, added 2026-11-01 from Linear.**

- **What it means.** Every step's dollars go to [the one meter](./one-ask-and-one-meter.md), and
  every ask is an `asked` and `answered` fact, so asks per lane and minutes from ask to answer are a
  view. A restart writes what it kept and what it ran again, so the money a resume saved is a view
  too.
- **The known way.** SRE caps toil at half of a person's time, and says: "I can only react with a
  sense of urgency a few times a day before I become fatigued." The DeepSeek study
  ([experiment 185](../../experiments/185-dsh-superagent-study.md)): "Every part of the project is
  judged by the attention it costs."
- **How Linear would do it. Agree on money, go further on attention, and one new lean.** Linear
  counts dollars per session, per person and per loop, and caps them with spend limits that reset
  daily, weekly or monthly. It does not count a person's attention; it shapes it: a Priority tab,
  email digests "only sent if you haven't already read" the Inbox, no bot activity if you choose.
  For time, an SLA warns once 24 hours before it breaches and once when it does, and a missed
  project update gets a reminder, then nudges 1 and 2 working days later, then shows "Update
  Missing" instead of more pings. **New lean, 60%, from Linear:** an unanswered ask gets at most
  two nudges, then shows as waiting in the window. The doubt: the gaps (Linear's 1 and 2 working
  days) are Linear's, not ours, and one owner may want no nudges at all.
- **On ticket 117.** Triage cost $0.07 on opus, and the plan took two Codex turns with no list price.
  The rest of the run's rows are not in `field/` yet. The person's time spent finding the stop's
  cause is in no count at all.
- **What holds it.** A view over facts that already exist, so nothing to forget. A cap that blocks
  needs its false alarms measured first (Google, CACM 2018), so none yet.
- **Record wide.** Decided 2026-11-01, for the whole repo in AGENTS.md: the lane records every
  measure it can, read or not, as long as recording does not slow the lane and never holds a
  secret. A count we later wish we had, like the time a person spent finding 117's stop, can never
  be filled in for runs that are already over.

### P12: nobody writes their own exam, and these guidelines are exam too

**Decided 2026-10-22** in [nobody writes their own exam](./nobody-writes-their-own-exam.md). **The
second half is a lean, 75%.**

- **What it means.** No fix route lets the builder change its exam. A builder that touches it gets
  P5's ask, never a quiet pass. The laws that hold P1 to P11 are exam files too: a builder working
  on the lane cannot loosen the law that holds it.
- **The known way.** Reward hacking, or specification gaming: the cheapest way to pass a check is
  to change it.
- **How Linear would do it. Agree, by a different guard.** Linear has no exam list. It leans on
  GitHub: "Existing GitHub permissions and review requirements still determine what ships". A
  loop can change only what started it unless a person allows more, and a person picks who may
  edit a loop. The same idea: what checks the agent is out of its reach.
- **On ticket 117.** The builder may change `tsh.test.ts`, since the test writer did not write it. It
  may not change `window.test.ts`. Code formatting `window.test.ts` (P3) is not the builder's change.
- **What holds it.** The one exam list names `machine.laws.test.ts` and the lane's other law
  files, and the build guard reads that list. Not checked here whether today's list names them
  yet; if it does not, that is a one-line exam change, the owner's own.
- **The doubt.** A fix to the lane's own laws then always needs the owner. That is slower, on
  purpose; whether it is too slow shows after a few lane fixes.

## How a stop routes

| The case | Class | What happens | Where it resumes |
|---|---|---|---|
| Red checks after build, rounds left | fixable | `send:builder` with the names | build, round + 1 |
| Red checks, rounds spent | judgment | ask `rounds_spent`: again or stop | again: build; stop: saved at build |
| A step that could not run | fixable | once more, on the same key | that step |
| It could not run twice | andon | `stuck`, with its resume and the error | that step, on the same line |
| A read of the ledger or the code host failed | fixable | the service waits it out | nothing moves in the lane |
| The builder touched an exam file | judgment | ask `exam_touched`, two picks | build on its head, or the test writer for that file |
| Main moved while stuck | fixable | rebase if unpushed, merge if pushed, then code's checks | the first step whose check fails |
| A Property of the plan no test can check | judgment | ask `cannot_test` | the test writer, or build on the person's `go_on` |
| Not your ticket | judgment | `stuck`, not restartable | nowhere: a person's call |

## Where this differs from settled notes and open plans

- **"Jidoka and andon", on PR 289's branch.** Its `Stop` type has no variant that carries a resume
  point, and its `over` sketch has `held?: Held`, optional. P6 wants both required. Its
  `RESTARTABLE` set lists what may restart; P4 lists what may not.
- **The self-fix plan, on PR 289's branch.** If the fold cannot prove a field of ticket 117's carry,
  it falls back to "a fresh lane on ticket 117, every step again". P4 and P7 say: run again only
  from the earliest step whose output cannot be proved.
- **[The plan's "who decides"](../plan/README.md#who-decides-what).** "A builder's diff to the exam
  files ends the lane stuck: nothing the build did is kept." That is today's code, and P5 replaces
  it.
- **[Read fresh, run alone](./read-fresh-run-alone.md).** Kept. A fresh read is still the truth; P7
  only adds that a changed read changes a key, and a key change runs a check before a redo.
- **[Outcome names](./outcome-names.md).** Kept: five verbs. `stuck` gains a required `resume`.
  That note's open point, that `stuck` is used wider than "could not be read", is answered by P3:
  `stuck` is the andon stop, whatever the line could not fix.

The full check of PR 289, 35 places in 17 groups, is in
[experiment 186](../../experiments/186-pipeline-guidelines.md#where-the-self-fix-plan-breaks-a-principle).

## What it costs

- A `key` on every `done` fact, and a `resume` on every `stuck`. The lane's facts grow by two
  fields; data first, since a key not written at the time cannot be worked out later for an agent
  step.
- A `resume` on every pick of every ask kind.
- The laws listed under each principle. Most are in PR 289's plan already; the new ones are P4's
  closed list, P7's property test, P8's two counts and P10's routing law. About 150 to 250 lines
  of tests on top of that plan, an estimate from reading it.

## How sure

- **The five decided principles are the owner's call,** and each matches the known way.
- **85% on P3, P9's shape and P10.** Each is the plain way in two or more sources.
- **75% on keying by inputs (P7).** The doubt is what the key leaves out; see P7.
- **65% on the bounds (P8).** The send-back count of 3 is a guess, and says so.
- **80% on counting attention now, 70% on no cap yet, 60% on two nudges (P11).**
- **Linear agrees with nine of the twelve as they are.** It differs on P2, P8 and P10 in its
  defaults, for reasons this note keeps, and three decided points clash with it; see
  [How Linear would do it](#how-linear-would-do-it).

## What would change it

- A stop that fits none of P3's three classes. Write it down before adding a fourth.
- Restarts that often find a key change and redo an agent step anyway. Then the cheap checks are
  too weak, and the `restarted` facts will show which.
- Lanes that loop to the round limit often. Then the bound or the brief is wrong.

## What it cannot tell us

- No lane has resumed from a saved stop with real agents. Every claim about resume is from the
  sources and from experiment 175's kill-and-retype on fake agents.
- How often a send-back fixes a red. No lane has had one with real agents.
- Whether a key by inputs saves real money. That needs restarts with `restarted` facts to count.
- Whether a person feels the asks that stay as too many. Only the attention count over real lanes
  will say.
- How Linear's agent runs behave inside, past its docs. Every Linear claim here is from its public
  pages, read 2026-11-01; no Linear session was run.
