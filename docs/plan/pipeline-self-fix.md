# Plan: the lane fixes itself, and a stuck lane restarts

**Proposed 2026-11-01. Waits on the owner's yes.** Today's version: `packages/pipeline`,
`programs/pipeline`, and one change in `packages/fabrika`. It builds
[jidoka and andon](../direction/jidoka-and-andon.md) for what ticket 117's first run hit.
A fix to the lane's own steps goes by hand for its pull request, and is logged in `field/`.
Revised 2026-11-01 against the pipeline guidelines and experiment 186, on
[PR 290](https://github.com/usirin/tea-fabrika/pull/290). A `P` number is one of its principles.

```text
PR 1  code formats what agents write          (e)   small, alone
PR 2  git works in the Codex box              (d)   small, alone
PR 3  failing test names are kept, and red     (a, b)
      goes back to the builder, then an ask
PR 4  code runs the checks after the builder;  (c)   on PR 3
      red or not run is never done
PR 5  a stuck lane restarts from its step      (g)   on PR 4
      -> ticket 117 restarts                   (h)   needs PRs 1, 3, 4, 5; PR 2 helps
PR 6  the plan step lists existing tests       (f)   on PR 4, any time
      that run the code it changes
```

Merge order: 1 and 2 in either order, then 3, 4, 5. Then ticket 117 restarts. PR 6 can land
before or after the restart.

## What happened on ticket 117

Read by a read-only agent on 2026-11-01, and checked against the code here.

- The lane ended `stuck:step_stuck`. The mutation step ran the full suite at the builder's
  head and got red (`stuck:tests_red`).
- The cause is one stale test outside the exam: `apps/fabrika/src/tsh.test.ts:724` expects
  `takes("map")` to be `[]`, and the change made it `["ticket"]`.
- The builder ran in a Codex box where git answered `spawnSync git EPERM`, so its own test run
  and lint died. It wrote that down and still said `done`. Nothing in code checks a build
  before `done`.
- `after()` turns every `stuck` into the end of the lane (`machine.ts:319-320`). The comment
  at `machine.ts:365-370` expects build to ask about a red head, but nothing routes there.
- The mutation step keeps only the exit code (`stryker.ts:383-386`), and `leaveBehind`
  deletes the copies. No test output exists anywhere.
- The test writer's `programs/map/src/window.test.ts` fails `node oxlint-plugins/format.ts --check`.
- The plan step's pointers missed `tsh.test.ts`.
- A stuck lane cannot restart. The saved `over` state keeps only the outcome and the trail
  (`machine.ts:266-271`), and typing the line again finds it with `use_existing`
  (`program.ts:1038-1045`), so it only says how it ended.
- What is left: the working copy `work/trees/117` on branch `lane/117` (head `315df8e6`, the
  builder's, on `5d38d582`, the test writer's) in the app's work folder. The claim is
  released. Nothing was pushed.

## PR 1: code formats what agents write

- **What.** Before code commits an agent's files, it runs the repository's formatter on
  them: the test writer's tests, the mutants job's tests and the builder's files. Before each
  build round, an exam file that fails the format check gets a code commit of its own. A repo
  that names no formatter gets one line on the ticket saying so, once.
- **Why code and not the agent.** A format slip is not a judgment. Sending it back costs a
  turn; the builder may not change an exam file at all, so on ticket 117 lint would stay red
  for every round.
- **Files.**
  - `packages/pipeline/src/settings.ts`: a `[format] run` command, `{files}` for the paths.
  - `packages/pipeline/src/stages/pipeline/tools.ts`: format before `work.commit` in
    `laneTestsWork`.
  - `packages/pipeline/src/stages/build/handlers.ts`: format before the build's commit.
  - `packages/pipeline/src/stages/pipeline/program.ts`: the format commit before a build round.
  - `.fabrika/fabrika.toml`: `[format] run = ["node", "oxlint-plugins/format.ts", "{files}"]`.
  - `packages/pipeline/src/stages/pipeline/tools.test.ts`.
- **Tests, red first.**
  - A test writer's file written with spaces is committed formatted. Today it is committed as
    written.
  - An exam file that fails the check before round 2 gets a code commit, and the builder's
    head is on it. The builder's diff does not count it as `exam_touched`.
- **Size.** 6 files, 150 to 200 lines, 1.5 to 2 agent hours.
- **How sure: 85%.** The doubt: the formatter runs as the person, from the repository's own
  script. That is no new exposure: the install and the mutation step's tests already run that
  way on this repository.

## PR 2: git works in the Codex box

- **What Codex allows.** In `workspace-write`, "`<writable_root>/.git` is protected as
  read-only", and the network is off by default
  ([Codex: approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)).
  The box "applies to spawned commands", git and test runners included
  ([Codex: sandboxing](https://learn.chatgpt.com/docs/sandboxing)). So reading git should
  work; only writing `.git` is refused, and the builder never commits.
- **The likely cause, not proven.** Experiment 77b found this same error on the Claude path:
  a program lookup stops at the first PATH folder the box closes, with EPERM, and git dies on
  an unreadable `~/.gitconfig`. `fencedEnv` fixed both there. `codexEnv`
  (`packages/fabrika/src/agents/acp/harness.ts:609-630`) keeps the PATH whole and sets `HOME`
  to Codex's own home, which the box closes, so neither fix applies. About 80% sure.
- **What.** `codexEnv` takes the same PATH filter and git settings as `fencedEnv`
  (`GIT_CONFIG_GLOBAL=/dev/null`, `XDG_CONFIG_HOME=/var/empty`).
- **Which, inside or outside.** Both, for different jobs. The checks that decide run outside
  the box, by code, after the builder (PR 4): that is the guard, since the builder's report
  decides nothing. Git inside the box is so the builder sees its own red and spends fewer
  rounds. Inside only would leave the builder's word deciding; outside only would leave it
  working blind, a round per mistake.
- **Files.** `packages/fabrika/src/agents/acp/harness.ts`, `harness.test.ts`, and
  `packages/fabrika/src/agents/codex/adapter.ts` if `codexEnvOf` needs the same change.
- **Tests, red first,** in `harness.test.ts`'s "the fence, in Codex's own box", which runs
  `codex sandbox` on a made-up home with no login:
  - `git --version` exits 0 with the host's real PATH.
  - `node -e` that runs `execFileSync("git", ["status"])` in a worktree copy exits 0.
  - **Stop rule:** if both pass today, the cause is elsewhere. The PR stops and reports what
    the builder's run log says, before any change.
- **Size.** 2 to 3 files, 60 to 120 lines, 1 to 2 agent hours.

## PR 3: failing test names are kept, and red goes back to the builder

- **What.**
  - The mutation step's test run keeps the failing tests' names: vitest's JSON reporter, read
    with the test writer's own `Report` schema (`stages/test-writer/results.ts`). Names look
    like `apps/fabrika/src/tsh.test.ts > ... > the frame's takes`.
  - `stuck:tests_red` becomes `send:builder:tests_red`. The lane sends it to build, next
    round, with each name as an open item (`Item` already allows "red checks").
  - Past `MAX_ROUNDS`, the lane asks `rounds_spent` instead of ending. Review's send-backs
    share the same count. The ask shows what is still red and the dollars the rounds spent.
    Its picks: "again" runs build, one more round; "stop" ends `stuck:rounds_spent`, which
    PR 5 saves at build, like every stuck end, so the same line goes on there.
  - The ticket keeps the names: `ended` gains `failed` (at most 50 names), and a comment
    lists them with the first lines of up to five errors. The full JSON report is kept in the
    lane's work folder until the lane ends `done`.
- **Data first.** The error text exists only when the run happens. Today it is lost forever.
- **Files.**
  - `packages/pipeline/src/stages/mutation/services.ts`, `stryker.ts`: `tests` answers
    `{result, failed, tail}`.
  - `packages/pipeline/src/stages/mutation/outcome.ts`, `machine.ts`: the new `send`.
  - `packages/pipeline/src/stages/pipeline/machine.ts`: `after()` routes it, and
    `rounds_spent` becomes an ask.
  - `packages/pipeline/src/tickets/ticket.ts`: `ended.failed`.
  - `.fabrika/fabrika.toml`: `[mutation] tests` gains `--reporter=json --outputFile={out}`.
  - Tests beside each: `stryker.test.ts`, `machine.test.ts`, `machine.laws.test.ts`,
    `program.test.ts`.
- **Tests, red first.**
  - `tests(head)` on a fixture with one failing test answers that test's name. Today: `"red"`.
  - `after("mutation", send:builder:tests_red, 1)` is `{to: "build", round: 2}`, and at round 3
    it is `{ask: "rounds_spent"}`. Today both are the lane's end.
  - The `rounds_spent` ask holds the open names and the rounds' dollars. "again" routes to
    build, and nothing before it runs.
  - On the lane fixture, a head with a failing test: the ticket's `ended` holds the name, and
    build round 2's brief has it in `open`.
  - Law: in any order of messages, build runs at most `MAX_ROUNDS` times, plus one per
    person's `again`.
- **Size.** 11 files, 220 to 330 lines, 2 to 3 agent hours.
- **The bound.** 3 is today's constant and a guess (P8); see
  [bounds](../direction/jidoka-and-andon.md#bounds).

## PR 4: code runs the checks after the builder

- **What.**
  - After every build, code runs `[build] checks` at the head, in a fresh copy, as the
    mutation step runs its tests today. A check with `{out}` gives names; one without gives
    pass or fail and its last 40 lines.
  - The build step ends `done` only on green. Red is `send:builder:checks_red` with the names
    (PR 3's route). A check that could not run is run once more (`once`, a guess, P8), then
    `stuck:checks_not_run`, which a restart picks up at the checks. Never `done`.
  - A `checked {head, commands, result, failed}` fact on the ticket.
  - The lane's carry holds `checked` for its head, and a step after build needs a green one
    for that exact head. A wrong head is not a value the type allows.
  - The mutation step reads that fact and skips its own suite run when the head matches. It
    still runs it when there is none. A skip is written, with the `checked` it relied on, so
    it never looks like a clean run (P9).
- **Why.** "A skipped check never looks like a clean one"
  ([make the mistake impossible](../direction/make-the-mistake-impossible.md)). Ticket 117's
  builder broke it, and nothing in code could see that.
- **Files.**
  - New `packages/pipeline/src/stages/pipeline/checks.ts` and `checks.test.ts`.
  - `packages/pipeline/src/stages/pipeline/program.ts`: the build body; `nothingChanged` uses
    the same run.
  - `packages/pipeline/src/stages/pipeline/machine.ts`: the carry's `checked`, and its law.
  - `packages/pipeline/src/stages/mutation/machine.ts`: skip on a matching `checked`.
  - `packages/pipeline/src/tickets/ticket.ts`: the `checked` fact.
  - `packages/pipeline/src/settings.ts`: `{out}` in `[build] checks`.
  - `.fabrika/fabrika.toml`: the vitest check gains `--reporter=json --outputFile={out}`.
  - `machine.laws.test.ts`, `program.test.ts`.
- **Tests, red first.**
  - A scripted builder says `done` with `ran: [{command: "pnpm test", passed: false}]`, and a
    test fails at its head. Today the lane goes on to mutation. After: build round 2, with the
    name.
  - A check command that cannot start ends `stuck:checks_not_run` after one more try. Never
    `done`.
  - A builder whose form says its checks failed, at a head where code's checks are green,
    still goes on: code decides, not the form.
  - Law: no step after build runs on a head without a green `checked` for that head.
  - A mutation run on a head with a green `checked` writes a skip naming that fact. Today it
    writes nothing.
- **Size.** 10 files, 460 to 620 lines, 4 to 6 agent hours.
- **How sure: 85%.** The doubt: the time. The full checks take a few minutes a round. The
  mutation step skipping its own run pays most of that back.

## PR 5: a stuck lane restarts from the step that broke

- **What the person types:** the same line, `pipeline --ticket 117 | runs`, after the fix has
  landed and the host runs main's code ([who starts it](../how-to/run-a-pipeline-ticket.md#who-starts-it)).
- **What the tile prints** (a sketch):

  ```text
  restart: #117 from mutation, which ended stuck:step_stuck (mutation: stuck:tests_red)
  main moved 4 commits: lane/117 rebased onto 9f3c2e1; the new tests still fail on it, as planned
  build: checks at 7a41d0b: red, 1 failing
  ```

- **What the ticket shows:** one row, `restarted`, with who, when, from which step, and the
  old and new base. Then the runs, as on any lane.
- **What.**
  - `over` keeps the lane's `Held` (carry, count, round, claim) and the step that stopped.
    Both are required on a stuck `over`: one without them is not a value the type allows, so
    no new code path can forget to save them (P6). A `done` or `skip` `over` has neither.
  - The fold from facts stays as the second copy. A law checks that it gives the same carry
    as the saved `Held` on every lane the tests run, so a lost or broken save can always be
    rebuilt, and a fact the lane forgets to write fails a test the day it is forgotten.
  - A `restart` Msg on a stuck `over`: claim again, read main fresh, then run the step that
    stopped. No step that ended `done` runs again, except PR 4's checks on a head that has
    none.
  - Main moved: a lane branch never pushed is rebased onto main (tracker ticket 130). One on
    the code host takes main in by a merge, as [read fresh](../direction/read-fresh-run-alone.md)
    says. After a rebase, code runs the test writer's check on the new base again. A conflict
    in the builder's files goes to build as `conflicts`. A conflict in an exam file asks the
    person, `exam_conflict`, with the files and both sides. "Test writer again": it redoes
    only those files on the new base, its check runs, and build goes on from the builder's
    rebased head as the next round. "Stop": saved at the rebase, so the same line goes on
    there.
  - Not restartable: the closed list `FINAL`, `not_yours` and `merged_elsewhere`. The line
    says why. Every other stuck reason restarts, a new one included (P4).
  - `exam_touched` asks the person, with two picks. "The builder was wrong": code puts the
    touched files back at the test writer's commit, on top of the builder's head, and build
    runs there as the next round. "The test is wrong": the test writer redoes only the touched
    files, with the person's note, its check runs, and build goes on from the builder's head
    as the next round. Either pick adds one round to the bound, like `again`. Every other finished step
    stays (P5).
  - Each pick of each ask this PR and PR 3 build (`rounds_spent`, `exam_touched`,
    `exam_conflict`) names the step it resumes at, in its definition (P10).
  - A step that could not run is run once more on the same intent before the lane stops
    (`once`, a guess, P8).
  - A lane saved before this change has no `Held` in `over`. Its carry is folded from facts
    (below). A field no fact proves is named, and the lane resumes at the step that writes
    that field. Every step before it keeps its `done`, and a later step keeps its `done` when
    the fields it reads come out the same. Nothing is guessed, and nothing starts from
    scratch (P4).
- **Files.**
  - `packages/pipeline/src/stages/pipeline/machine.ts`, `program.ts`, `work.ts` (rebase of a
    local branch).
  - New `packages/pipeline/src/stages/pipeline/restart.ts` and `restart.test.ts`: what may
    restart, and the carry from facts.
  - `packages/pipeline/src/tickets/ticket.ts`: the `restarted` fact.
  - `programs/ticket`: the row.
  - `machine.laws.test.ts`, `program.test.ts`.
  - `programs/pipeline/README.md`, `docs/how-to/run-a-pipeline-ticket.md` ("When a lane is
    stuck").
- **Tests, red first.**
  - A stuck `over` at mutation, sent `restart`: it runs checks, then mutation. Today the
    message does nothing.
  - Laws: a restart never writes a second `approve` ask while the plan's version is the
    same; it never runs a step that ended `done` before the stop; a reason in `FINAL` never
    restarts, and every other one does.
  - Law: every pick of every ask routes to its own resume step, and no step before it runs.
  - Law: a step that could not run starts at most twice per intent.
  - On the local host fixture, main changes an exam file while the lane is stuck. The
    restart asks `exam_conflict` with the files; "test writer again" reruns the test writer
    for those files only, then build.
  - Law: for every step and every stuck reason it can end on, stop there, then restart. The
    restart runs that step with the same carry it had. A new step or a new stuck reason
    joins this law by being in the union, not by someone adding a case.
  - Law: the fold of a lane's facts equals its saved `Held`, at every point a lane can stop.
  - On the local host fixture, main moves by one commit while the lane is stuck. The restart
    rebases, writes `restarted` with both bases, and goes on.
  - An old `over` with no `Held`: the fold gives the carry from the fixture's facts. With the
    `approve` answer removed, the restart names `decided` and asks the plan's yes again; the
    plan, triage and the test writer do not run. With the test writer's commit removed, it
    names `exam` and resumes at the test writer; triage, the plan and its yes do not run.
- **Size.** 11 files, 800 to 1,100 lines, 8 to 11 agent hours. The biggest piece.

## Ticket 117 restarts

It can restart from its own state, once PRs 1, 3, 4 and 5 land, through PR 5's fold. Its
saved `over` has no carry, so each field comes from a fact or from code's own commits. If no
fact proves a field, the lane goes back to the step that writes it, and no further:

| Field | Where it comes from | If nothing proves it, resume at |
|---|---|---|
| `plan`, `version`, `rules` | the ledger's `planned` fact for 117's plan | plan |
| `decided` | the plan's questions, and the note on the ticket's `approve` answer | the plan's yes: the `approve` ask again, one click |
| `base` | the lane's working copy (`work.tree(117).base`) | no step: main is read fresh and the branch rebased anyway |
| `exam` | the files of `5d38d582`, the commit code made for the test writer (`tests for ...`) | the test writer |
| `head` | `lane/117`'s tip, `315df8e6`, the commit code made for the builder | build, round 1, on the exam commit |
| `count`, `trail` | the ticket's `started` and `ended` facts | triage, since these are the facts the fold reads; with none there is nothing to keep |

Then, in order: main has moved, so `lane/117` is rebased onto it (it was never pushed); the
test writer's check runs on the new base; PR 1 formats `window.test.ts` in a code commit; the
lane runs PR 4's checks at the head, gets `tsh.test.ts` red with its name, and sends it to
build round 2. The builder may change `tsh.test.ts`, since it is not exam, and says so in
its deviations.

If the fold cannot prove a field, the restart names it and resumes at that field's step, as
the table says (P4). Every step before it keeps its `done`. A step after it keeps its `done`
when the fields it reads come out the same: a yes asked again on the same plan version keeps
the test writer's and the builder's commits. Nobody edits a saved state by hand, and no step
whose inputs can be proved runs again.

## PR 6: the plan step lists existing tests that run the code it changes

- **What.** After the plan passes its Check, code runs `vitest related` at the base on the
  files the plan points at ("Run only tests that cover a list of source files",
  [Vitest 5.0.5 CLI](https://vitest.dev/guide/cli)). Each test file it finds that the plan
  does not name becomes a pointer that code adds: "an existing test that runs this code;
  check whether the plan changes what it expects." The plan's text on the ticket shows them,
  and the test writer and the builder get them in their briefs.
- **Without trusting the agent.** Code runs it, and code adds the pointers. The planner
  cannot leave one out.
- **The doubt, 60%.** Vitest follows static imports only. `tsh.test.ts` may reach `map`
  through a program list, not an import. The first step of the PR settles it, $0 and about a
  minute: run `vitest related` on `map`'s files at 117's base, read-only, and see whether
  `tsh.test.ts` is listed. If it is not, a second source is needed, such as code searching
  the test files for the plan's names, and the PR says how many false hits that gives.
- **Files.** `packages/pipeline/src/settings.ts` (`[plan] related`), new
  `stages/pipeline/related.ts` and `related.test.ts`, `stages/pipeline/program.ts`,
  `programs/pipeline/briefs/test-writer.md` and `build.md`, `.fabrika/fabrika.toml`.
- **Test, red first.** On the lane fixture, a plan points at `src/a.ts`, and `old.test.ts`
  imports it. The plan's pointers on the ticket include `old.test.ts`. Today they do not.
- **Size.** 7 files, 200 to 300 lines, 2 to 3 agent hours.

## How each pull request goes

Each is a fix to the lane's own steps, so it goes by hand
([the deal](../direction/next-is-a-pipeline-pre-run.md)): this plan is the plan step; then a
test writer agent writes the red tests above, a builder agent makes them pass without
touching them, the mutation step runs on a fixed-seed sample of about 150 (seed 119120, under
`nice -n 15`), and one fresh review reads the whole diff. Each run is logged in `field/` the
same day, with what ran it. The owner's yes and green CI, then an agent merges after a leak
grep.

Total: about 48 file changes (some files change in more than one pull request), 1,890 to
2,670 lines, 18.5 to 27 agent hours. The revision against the guidelines added about 230 to
350 lines, most of it in PR 5.

## What this plan does not do

- The other rows of [the table](../direction/jidoka-and-andon.md#every-place-todays-lane-stops-or-asks):
  retries on reads, ship's sends with no route, the spend asks. One tracker ticket each, after
  ticket 117 lands.
- Counting a person's attention as a view. The facts are there already; the view waits.
- A box for the head's own code. The checks run as the person, as the mutation step does
  today.

## What this plan cannot tell us

- Whether round 2's builder fixes `tsh.test.ts` in one try. Most likely, since it gets the
  name and the plan, but no real lane has had a send-back yet.
- Whether PR 2's cause is right. Its first test says so before anything changes.
- Whether the fold finds every field on 117's real facts. The restart says so in words, and
  names the step it goes back to.
- Whether the guessed bounds (`once`, `drafts`, 3 rounds) are right. The `step` rows will
  show the spread.

## Unresolved questions

Settled 2026-11-01, kept for the record: restart = same line typed again; `exam_touched` asks
with two picks and goes on from step before (P5); fold misses a field = resume at that
field's step, never a fresh lane (P4).

1. One round count (3) shared by review + red checks? Lean yes, 70%. Guess (P8).
2. `once` = one more try per intent, `drafts` = 3? Lean yes, 65%. Guesses (P8); `step` rows settle.
3. Service `wait`: no cap on tries, tile says what it waits on? Lean yes, 60%. Doubt: a host down for hours holds the lane silently.
4. New ask `exam_conflict`, picks "test writer again" / "stop"? Lean yes, 75%.
5. Input hash on every `done` (P7), written in PR 5, used later? Lean yes, 70%: a key not written now is lost. Adds about 80 to 120 lines, not in sizes.
6. Mutation skips own suite on green `checked`, skip written? Lean yes, 70%.
7. Code formats builder's files too, not just test writer's? Lean yes, 80%.
8. Unpushed branch on restart: rebase, not merge? Lean rebase, 85%.
9. Attention: count now, no cap until real lanes? Lean yes, 80%.
