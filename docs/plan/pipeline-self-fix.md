# Plan: the lane fixes itself, and a stuck lane restarts

**Approved by the owner 2026-11-01, with all its leans, including the seven in [unresolved questions](#unresolved-questions).** Today's version: `packages/pipeline`,
`programs/pipeline`, and one change in `packages/fabrika`. It builds
[jidoka and andon](../direction/jidoka-and-andon.md) for what ticket 117's first run hit.
A fix to the lane's own steps goes by hand for its pull request, and is logged in `field/`.
Revised 2026-11-01 against [the pipeline guidelines](../direction/pipeline-guidelines.md),
from experiment 186, merged in [PR 290](https://github.com/usirin/tea-fabrika/pull/290). A `P`
number is one of its principles. Revised again the same day with the owner's decisions on its
three Linear clashes and on "record wide": PRs 3 and 5 grow, and PRs 7, 8 and 9 are new.
Grown 2026-11-02 with PRs 10 and 11, from ticket 117's live run and
[experiment 193](../../experiments/193-lane-holes.md): their scope is the owner's decision, their
text waits on the owner's yes.

```text
PR 1  code formats what agents write          (e)   small, alone
PR 2  git works in the Codex box              (d)   small, alone
PR 7  the lane records wide                          alone
PR 3  failing test names are kept, and red     (a, b)
      goes back to the builder, then an ask
PR 4  code runs the checks after the builder;  (c)   on PR 3
      red or not run is never done
PR 5  a stuck lane restarts from its step;     (g)   on PR 4
      a person's stop is a saved pause
      -> ticket 117 restarts                   (h)   needs PRs 1, 3, 4, 5, 7; PR 2 helps
PR 6  the plan step lists existing tests       (f)   on PR 4, any time
      that run the code it changes
PR 8  a person speaks unasked, by a comment          on PRs 5 and 7
PR 9  attention is counted, with two nudges          on PR 5
PR 10 the exam PR is formatted, reviewed and         on PR 5
      fixed by the lane; a yes binds to the diff
PR 11 every outcome has a route; a fixable stop      on PR 10
      never stops; a stop says why on the ticket
      -> ticket 117 restarts again                   needs PRs 10 and 11
```

Merge order: 1, 2 and 7 in any order, then 3, 4, 5. Then ticket 117 restarts. PRs 6, 8 and 9
can land before or after the restart. Then 10, then 11, and ticket 117 restarts again from
`exam_merge`, where it is saved. PR 7 goes first because what it records exists only while
a run happens, so every run before it, the by-hand runs of PRs 3 to 5 included, loses it.

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
- **Size.** 6 files, 150 to 200 lines, a `0.5` (0.25 to 0.33 agent hours at 600 an hour; a
  `0.25` at 1,660). *Old guess, wrong: 1.5 to 2 agent hours.*
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
- **Size.** 2 to 3 files, 60 to 120 lines, a `0.25` (0.1 to 0.2 agent hours at 600 an hour; a
  `0.25` at 1,660). *Old guess, wrong: 1 to 2 agent hours.*

## PR 3: failing test names are kept, and red goes back to the builder

- **What.**
  - The mutation step's test run keeps the failing tests' names: vitest's JSON reporter, read
    with the test writer's own `Report` schema (`stages/test-writer/results.ts`). Names look
    like `apps/fabrika/src/tsh.test.ts > ... > the frame's takes`.
  - `stuck:tests_red` becomes `send:builder:tests_red`. The lane sends it to build, next
    round, with each name as an open item (`Item` already allows "red checks").
  - Past `MAX_ROUNDS`, the lane asks `rounds_spent` instead of ending. Review's send-backs
    share the same count. The ask shows what is still red and the dollars the rounds spent.
    Its picks: "again" runs one more round: build after a red head, and after a review's
    send-back the test writer, then build. Decided 2026-11-02 by the owner: again after a review
    runs the test writer, then build, since a review often asks for tests. "stop" is a saved
    pause, not an end: it
    ends the run `stuck:rounds_spent`, which PR 5 saves at build, so the same line goes on
    there.
  - Red goes back by default (P2). `[build] send_back = false` in a repository's
    `.fabrika/fabrika.toml` turns it off: then the first red asks `rounds_spent` at once, with
    the same picks. A repository that names nothing gets `true`.
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
  - `packages/pipeline/src/settings.ts`: `[build] send_back`, default `true`.
  - `.fabrika/fabrika.toml`: `[mutation] tests` gains `--reporter=json --outputFile={out}`.
  - Tests beside each: `stryker.test.ts`, `machine.test.ts`, `machine.laws.test.ts`,
    `program.test.ts`.
- **Tests, red first.**
  - `tests(head)` on a fixture with one failing test answers that test's name. Today: `"red"`.
  - `after("mutation", send:builder:tests_red, 1)` is `{to: "build", round: 2}`, and at round 3
    it is `{ask: "rounds_spent"}`. Today both are the lane's end.
  - The `rounds_spent` ask holds the open names and the rounds' dollars. "again" routes to
    build after a red head, and to the test writer after a review's send-back; nothing before
    that runs.
  - On the lane fixture, a head with a failing test: the ticket's `ended` holds the name, and
    build round 2's brief has it in `open`.
  - Law: in any order of messages, build runs at most `MAX_ROUNDS` times, plus one per
    person's `again`.
  - With `send_back = false`, the first red is `{ask: "rounds_spent"}`. With the key left
    out, it is build round 2.
- **Size.** 12 files, 250 to 380 lines, a `1` (0.4 to 0.6 agent hours at 600 an hour; a `0.25`
  at 1,660). *Old guess, wrong: 2.5 to 3.5 agent hours.*
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
- **Size.** 10 files, 460 to 620 lines, a `1` (0.8 to 1 agent hour at 600 an hour; a `0.5` at
  1,660). *Old guess, wrong: 4 to 6 agent hours.*
- **How sure: 85%.** The doubt: the time. The full checks take a few minutes a round. The
  mutation step skipping its own run pays most of that back.

## PR 5: a stuck lane restarts from the step that broke

- **What the person types:** the same line, `pipeline --ticket 117 | trace`, after the fix has
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
  - Not restartable: the closed list `FINAL`: `not_yours` and `merged_elsewhere`, the merge
    step's end when someone else merged the pull request at another head. The line says why. Every other stuck reason restarts, a new one included (P4). The restart reads
    the ticket fresh, so a ticket a person closed ends `skip:closed` there.
  - A person's `stop` or `no` is a saved pause, not an end (decided 2026-11-01). Today any
    pick but the first ends `skip:owner_no` (`machine.ts:613-617`). After: it saves the lane
    at its pick's resume step, like a stuck end, and the same line goes on there. The pause
    ends `ask:owner:paused`, except a stop on `rounds_spent`, which ends `stuck:rounds_spent`
    today. A `no` on
    the plan's yes resumes at plan, with the person's note in its brief; a `no` on a merge
    or an exam merge asks that question again. Only `done`, `FINAL` and a closed ticket end a
    lane.
  - Each `done` fact keeps its input key (P7, decided 2026-11-01): a hash of what the step
    read (ticket text, plan version, base, exam commit, head, brief hash, harness, model,
    effort, settings). It goes on the `ended` fact beside the outcome. Nothing reads it to
    skip a step yet; a key not written now can never be worked out later for an agent step.
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
  - New `packages/pipeline/src/stages/pipeline/key.ts` and `key.test.ts`: the input key.
  - `packages/pipeline/src/tickets/ticket.ts`: the `restarted` fact, and `key` on `ended`.
  - `programs/tracker/src/rows.ts`: the row, which the ticket program draws.
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
  - An old `over` with no `Held`: the fold gives the carry from the fixture's facts. For a lane
    saved before this PR, the ledger keeps the plan's revision but not its draft. So the fold
    names `plan`, and the restart runs the plan again; triage stays done. With the `approve`
    answer removed, it names `decided` and asks the plan's yes again. With the test writer's
    commit removed, it names `exam` and resumes at the test writer. "The plan does not run"
    holds only for a lane saved after this PR, whose `ended` facts keep their carry.
  - A `stop` on `rounds_spent`, then the same line: build runs, round + 1. A stop on
    `rounds_spent` ends `stuck:rounds_spent` today, not `skip:owner_no`.
  - A `no` on the plan's yes, then the same line: the plan runs with the note; triage does
    not run.
  - Law: no pick of any ask ends a lane. The only ends are `done`, a reason in `FINAL`, and
    `skip:closed`.
  - A ticket closed while the lane is paused: the same line ends `skip:closed` and runs no
    step.
  - Property test: changing any one input field changes the key, and the same inputs give the
    same key. Every `done` the lane fixture writes has a key.
- **Size.** 13 files, 960 to 1,360 lines, a `2` (1.6 to 2.3 agent hours at 600 an hour; a `1` at
  1,660). *Old guess, wrong: 10 to 13.5 agent hours.* The biggest piece: the
  pause adds about 60 to 100 lines, the key about 100 to 160.

## Ticket 117 restarts

**Proposed, waiting on the owner's yes.**

Ticket 117 was planned before PR 7, so its ends kept no carry, and PR 5's fold has to rebuild
the lane from the ledger and the branch. The ledger keeps the plan's revision (the `planned`
fact) and the plan's text in its comment. It does not keep the plan's properties, its
interface or its gaps, so the fold cannot prove `plan`, and names it (a sketch of the line):

```text
pipeline --ticket 117 | trace
restart: #117 from plan, which ended stuck:step_stuck (mutation: stuck:tests_red)
```

What happens then, in order:

- Triage stays done. It does not run again.
- `lane/117`'s head, `315df8e6`, is kept under a ref the restart names, such as
  `refs/kept/lane/117/fresh/<count>/<n>`, and on the `restarted` fact as `kept`. Nothing
  built is lost.
- The branch starts again from main as read fresh.
- The plan runs again, and the person is asked for the yes again.
- The test writer writes its tests on that fresh branch, and its check runs there.
- The build runs from round 1, on the test writer's commit, and the steps after it follow.

What this costs: one more plan, one more yes, one more test writer run and one more build
before the lane is where it stopped. A lane planned after PR 7 keeps its plan in its ends'
carry, so its fold names the step that broke, and none of this runs again.

### Ticket 117 restarts again, after PRs 10 and 11

**Proposed, with PRs 10 and 11.** Ticket 117 restarted on 2026-11-02. It ran the plan, the yes,
the exam and its question, and stopped at `exam_merge` twice: first `send:builder:checks_red`,
then, after a person's format commit, `send:reviewer:no_review`. It is saved there, at
`{_tag: "run", step: "exam_merge"}`, with its `Held`. Nothing in that save changes. The owner's
rule: the holes it found are fixed in the pipeline, never by hand, and both PRs land first.

```text
pipeline --ticket 117 | trace
restart: #117 from exam_merge, which ended stuck:sent_back (exam_merge: send:reviewer:no_review)
exam_merge   send:reviewer:no_review -> exam_review
exam_review  exam/117 at 27bec63; main merged in; checks green; review passed
carry        the merge said at 39041df -> kept, formatted
exam_merge   merged
test_writer  ...
```

What happens then, in order (a sketch; the review's result is made up):

- The same line claims the ticket, reads main fresh and runs `exam_merge`. Ship answers
  `no_review` again, which now routes to `exam_review` (PR 10). A `behind` lands there too.
- `exam_review` reads the exam branch's head on GitHub, `27bec63`, the person's commit, and moves
  the side tree there. It merges main in, formats (nothing changes), runs the checks, and runs the
  review against code-made criteria. The verdicts post on PR 313.
- The person said `merge` at `39041df`, before PR 10, so that answer keeps no `head`, `base` or
  `diff`. The lane takes `head` from the pull row, the head it pushed and asked about, and the
  trail's `merge` answer proves the yes was said. It takes `base` and `diff` from git: the exam
  branch still holds `39041df` and its parent on main. `carry` says `kept`, `formatted`, and
  writes a `carried` fact. No new ask.
- `exam_merge` merges PR 313. Then the test writer, build and the checks, mutation, review and
  push, and the lane's `merge` ask for the main pull request: the first new question.
- If the review fails, the exam writer redoes the files (PR 10), and the person is asked again only
  if the rule text changed.

How sure: 75%. The doubt: the old yes's `base` is read from git after the fact, the one value the
note says to write when a yes is given. For 117 the exam branch still holds it. If it did not,
`carry` would say `stale`, and the person would get the `exam_merge` question once more, which is
safe.

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
- **Size.** 7 files, 200 to 300 lines, a `0.5` (0.33 to 0.5 agent hours at 600 an hour; a `0.25`
  at 1,660). *Old guess, wrong: 2 to 3 agent hours.*

## PR 7: the lane records wide

Record wide, read later (AGENTS.md, decided 2026-11-01). Each fact here exists only while a run
happens. Nothing reads them yet.

- **What.**
  - **Each run's harness session id.** `started` gains `session`, the harness's own id for the
    conversation. Where code names it ahead (the Agent SDK path, `BuildBrief.session`), it goes
    on `started`. On the ACP path the agent names it when `session/new` answers (field note
    2026-10-18-27), so code writes `started` after that answer and before the first prompt. A
    run that crashes still has it, so a later restart can load that session.
  - **Each run's content.** Prompts, replies, and each tool's input and result go in the run's
    job record, in the `content` table beside its spans, the shape
    [an agent run keeps its content](../direction/an-agent-run-keeps-its-content.md) gives. For
    a lane's runs the mask (`mask: () => KEPT_OUT` in `agents/trace/agent.ts`) keeps the content.
    Content stays deletable, one span at a time. Text that matches a key's shape (the leak
    grep's patterns) is cut before it is written. Drawing it in `trace` waits.
  - **`during` on a comment.** A `commented` fact gains `during`: the run that was live when it
    was written, the ticket's last `started` with no `ended`. Code fills it in when the comment
    is written; a person never types it. Missing means no run was live.
- **Files.**
  - `packages/pipeline/src/tickets/ticket.ts`, `tickets.ts`: `session` on `started`, `during`
    on `commented`.
  - `packages/pipeline/src/stages/pipeline/program.ts`: write `started` with the session.
  - `packages/fabrika/src/agents/acp/harness.ts`: hand the session id back before the first
    prompt.
  - `packages/fabrika/src/agents/trace/agent.ts`: keep content for a lane's runs, with the cut.
  - `packages/fabrika/src/host/job-record.ts`: the `content` table and its delete.
  - Tests beside each: `ticket.test.ts`, `tickets.test.ts`, `program.test.ts`,
    `job-record.test.ts`.
- **Tests, red first.**
  - A scripted ACP run: its `started` fact holds the session id the fake agent named.
  - A person's comment written while a run is live has `during` set to that run; one written
    with none live has no `during`.
  - A lane run's job record holds the reply text of each turn. Today it holds `[kept out]`.
  - A tool result holding a key-shaped string is cut before it is written.
  - Deleting one span's content leaves the span and a row that says who deleted it and why.
- **Size.** 10 files, 350 to 500 lines, a `1` (0.6 to 0.8 agent hours at 600 an hour; a `0.5` at
  1,660). *Old guess, wrong: 3.5 to 5 agent hours.*
- **How sure: 75%.** The doubt: "an agent run keeps its content" is still **proposed**. This
  PR builds only its recording half, as record wide asks, and leaves its view open.

**Checkpoint commits stay their own change**, tracker ticket 145, after ticket 117 restarts.
They change how the builder's working copy is committed, which PRs 1 and 4 also change, so
they land after those. What waiting loses: the builder's work between commits on the runs
before 145 lands. Ticket 117's own working copy is whole, so its restart does not need them.
70% sure.

## PR 8: a person speaks unasked, by a comment

Decided 2026-11-01 (the guidelines' clash 2). The ticket comment is the one way in.

- **What.**
  - An agent step's next turn carries the comments written since its last turn: the Check
    loop's `continues` prompt, and the builder's next round's brief. A turn in flight is
    never cut off.
  - A step that has no next turn leaves the comment to the next step: its brief carries every
    comment since the last step started, read from the ledger, as "A person said, unasked".
  - A comment answers no ask. An ask still waits for a pick.
  - The ticket shows each comment under the run its `during` names.
- **Files.** `packages/pipeline/src/combos.ts` (the `continues` prompt),
  `packages/pipeline/src/stages/pipeline/program.ts` (the briefs),
  `programs/pipeline/briefs/build.md` and `test-writer.md` (one line each),
  `programs/ticket` (the row), `combos.test.ts`, `program.test.ts`.
- **Tests, red first.**
  - A comment written while a scripted step's first draft runs: its second draft's prompt holds
    the comment. Today it does not.
  - A comment written between two steps: the next step's brief holds it, once.
  - A comment written while the lane asks: the ask stays open.
- **Size.** 7 files, 200 to 300 lines, a `0.5` (0.33 to 0.5 agent hours at 600 an hour; a `0.25`
  at 1,660). *Old guess, wrong: 2 to 3 agent hours.* **How sure: 75%.** The doubt: a
  builder turn of ten minutes or more holds a comment that long.

## PR 9: attention is counted, with two nudges

P11, decided 2026-11-01: count now, no cap, at most two nudges.

- **What.**
  - A view, not new facts: asks per lane and minutes from ask to answer, read from `asked` and
    `answered`, on the ticket beside the dollars. A restart's `restarted` row adds what it kept
    and what it ran again, so the money a resume saved is a view too.
  - An unanswered ask gets at most two nudges: a code comment on the ticket that names the ask
    and how long it has waited, each a `nudged` fact. After the second, the window shows the
    ask as waiting, with its age, and pings no more. The gaps are an open question below.
  - No cap on asks. A cap that blocks needs its false alarms measured first.
- **Files.** `packages/pipeline/src/stages/pipeline/machine.ts` (a Listen on time while
  `asking`), `program.ts`, `packages/pipeline/src/tickets/ticket.ts` (`nudged`),
  `programs/ticket` (the count and "waiting"), `machine.laws.test.ts`, `program.test.ts`.
- **Tests, red first.**
  - An ask left unanswered past both gaps: two `nudged` facts, then none, and the ask shows as
    waiting.
  - An answer after the first nudge: no second nudge.
  - Law: an ask is never nudged more than twice.
  - The ticket's count on the lane fixture: asks and minutes match its `asked` and `answered`.
- **Size.** 6 files, 250 to 350 lines, a `0.5` (0.4 to 0.6 agent hours at 600 an hour; a `0.25`
  at 1,660). *Old guess, wrong: 2.5 to 3.5 agent hours.* **How sure: 60%,** the
  guidelines' number for two nudges.

## PR 10: the exam pull request is formatted, reviewed and fixed by the lane, and a yes binds to the diff

**Scope decided by the owner 2026-11-02; approved by the owner 2026-11-02, with every lean.** Today's version:
`packages/pipeline`. From ticket 117's live run on 2026-11-02 and its exam pull request,
[PR 313](https://github.com/usirin/tea-fabrika/pull/313), and from
[experiment 193](../../experiments/193-lane-holes.md). It builds
[a yes binds to the diff](../direction/a-yes-binds-to-the-diff.md) (proposed, decided to build)
and the exam pull request's rows of [the jidoka table](../direction/jidoka-and-andon.md#push-and-ship).
PR 11 builds on it.

```text
exam -> exam_review -> (yes) -> exam_merge -> test_writer
         ^ new: code formats, runs the checks, then one fresh review of the exam PR
                                  ship refuses: back to exam_review or exam, never stuck:sent_back
```

- **On ticket 117.** The exam step's one new file was not formatted, so CI's `check` job went red
  on oxfmt alone. PR 1 formats what the test writer, the mutants job and the builder write, not
  what the exam step writes. The owner said `merge`, ship ended `send:builder:checks_red`, and
  `after()` turned that into `stuck:sent_back` (`machine.ts:571`). A person pushed a format commit
  and the line was typed again. Ship then ended `send:reviewer:no_review` (`ship/gate.ts:84`,
  `:88`).
  - Why `no_review`, read from the code: nothing reviews an exam pull request. The lane fakes it.
    `reviewsFrom` answers `governance: passed` for any exam pull (`pulls.ts:212`), and
    `laneRecord` gives it one made-up criterion, "A person read these rule changes and said yes",
    passed at the side tree's head once the person says `merge` (`pulls.ts:429-447`). Both are
    tied to the head the lane pushed. The person's commit moved the head from `39041df` to
    `27bec63`, so `laneFactsOver` marked the review `missing` (`github.ts`, `notJudged`).
  - Part 1 alone would have saved this run. Parts 2 and 3 are what the owner's rules ask for:
    every pull request gets one fresh review by its own agent, and a fix with no meaning to judge
    never needs the owner. Part 4 is the owner's 2026-11-02 rule for every yes the lane keeps.
- **What.**
  - **Part 1: the exam step formats before it commits.**
    - `laneExamWork.land` writes the exam writer's files into the side tree, runs `[format] run`
      on those paths, then commits, as `laneTestsWork.commit` does (PR 1). A formatter that fails
      keeps what the writer wrote, and the ticket says so in one comment. A repository that names
      no formatter gets PR 1's one line, once (`NO_FORMATTER` in `format.ts`).
    - The side tree starts from main on the first landing of each plan version. Today it is made
      once and reused (`work.ts:405-415`, `tools.ts:306`), so a second exam landing after a plan
      restart commits on top of the old rule changes, on an old main (193's new hole, 70% sure).

    ```ts
    // tools.ts, laneExamWork.land. Today: work.commit(side.tree, files, message).
    yield* work.write(side.tree, files);
    const formatted = yield* work.format(side.tree, files.map((f) => f.path));
    if (formatted._tag === "failed") yield* said(number, `format-exam-pr-failed/${side.branch}`, formatted.says);
    const head = yield* work.commit(side.tree, [], `rule changes for ticket ${number}`);
    ```

  - **Part 2: the exam pull request gets the lane's own review, before the person is asked.**
    - A new step, `exam_review`, between `exam` and the `exam_merge` ask. The exam's
      `ask:owner:check_change` routes to `exam_review`. `exam_review` done routes to the ask. The
      person sees the same question, now with the review's count: "The review met 3 of 3, and the
      checks passed at `<head>`. Do you want to merge these rule changes: `.oxlintrc.json`?"
    - What `exam_review` does, in order. All code, then one agent:
      1. Reads the exam pull request's head on the code host, and moves the side tree there, a
         fast-forward only. A person may push to the exam branch, as on ticket 117. A head that is
         not a fast-forward stops the lane, with both heads. If main moved, code merges it into the
         exam branch, as [read fresh](../direction/read-fresh-run-alone.md) does for a pushed
         branch, so the head and `carry`'s replay stand on the same main. A conflict goes to the
         exam writer, as `send:builder:conflicts` does.
      2. Formats the rule files at that head, as Part 1, with a code commit only if that changed
         anything, and pushes it.
      3. Runs `[build] checks` at the head with PR 4's `CheckRunner`. The side tree is a worktree
         of the lane's clone, so the head is in the same store. Red: `send:builder:checks_red`
         with the names, and no reviewer starts.
      4. Starts the review stage, as the `review` body does for the main pull request
         (`program.ts:1115-1140`), on a new target, `<plan>/exam`. `keepRows` files its rows into
         `CriteriaRecord` under the exam's own ticket id (`examTicket`, `pulls.ts:174`). The push
         step's way posts the verdicts on the exam pull request at that head (`PullWire.post`,
         marker comments in `verdict.ts`'s format), and the pull row keeps them.
    - The exam's criteria: one per change the plan lists, made by code from `carry.plan.exam`,
      never by an agent. Each says what the person reads today. The plan's draft has no link from
      its `exam` list to a task, so code cannot tell which of the plan's tasks is the exam's
      (ticket 117's planner wrote "Task 1 Prepare the shell contract exam", with c7 and c8, by its
      own choice). See the open questions.

      ```ts
      // exam-pull.ts. Pure. e1, e2, ... in the plan's order, version 1.
      export const examCriteria = (changes: readonly ExamChange[]) =>
      	changes.map((c, i) => ({
      		id: `e${i + 1}`,
      		version: 1,
      		text: `When a reviewer reads \`${c.path}\` on this pull request, it does this: ${c.change}, because ${c.why}`,
      	}));
      ```

    - What goes away: the two fakes in `pulls.ts`, `governance: passed` for any exam pull and the
      made-up criterion. `laneRecord` reads the exam's criteria and rows from the pull row, which
      the exam step writes at land time and `exam_review` fills. The person's `merge` stays ship's
      `approval`, through `mergeAnswered`.
    - The carry gains one optional key, so a saved lane still reads. `exam_merge` runs only when
      the review and the person's yes both carry to `head` (Part 4), checked in `running`, the one
      place a step starts, as PR 4 does for the steps after build. Anything else goes back to
      `exam_review`; it never ships an unreviewed head.

      ```ts
      /** The exam's pull request as the lane last read it. Left out: a lane saved before this key. */
      const ExamPull = Schema.Struct({
      	head: Schema.String,
      	/** The review that passed, and what it read: what `carry` needs (Part 4). */
      	reviewed: Schema.optionalKey(Schema.Struct({...Given.fields, met: Schema.Finite, of: Schema.Finite})),
      	/** A person's `merge`, and what they saw. */
      	yes: Schema.optionalKey(Given),
      });
      // carried: examPull: Schema.optionalKey(ExamPull)
      ```

    - A failed review goes to the exam step, never the builder. `send:builder:review_failed` or
      `checks_red` from `exam_review` routes to `exam` as its next round. The exam machine gets a
      redo: it starts in a copy of the exam head, its prompt holds the findings or the failing
      names, and its Check is the same, so it may still write only the files the plan lists. It
      lands on the same branch and the same pull request. The builder does not run until
      `exam_merge` ends done, so it never sees an exam file to change.

      ```ts
      // exam/machine.ts. Left out: the first writing, from main.
      export const ExamAsk = Schema.Struct({
      	...today,
      	redo: Schema.optionalKey(Schema.Struct({head: Schema.String, why: Schema.Array(Schema.String)})),
      });
      ```

    - The bound: the exam's rounds are counted from the trail, as `boundOf` counts grants, one per
      `exam` row. They never touch the lane's `round`, which the test writer reads as "add tests
      on the head" past 1. 3 rounds, the same guess as the build's (P8). Past it the person is
      asked `rounds_spent`, with what is still red or open, and the lane does not end.
  - **Part 3: a ship refusal at `exam_merge` goes to the step that can fix it.**
    - Every ship send at `exam_merge` has a row, typed over ship's own names, so a send with no
      route does not compile (jidoka row 9). These are the first rows of PR 11's `ROUTES`, in
      PR 11's `Move` shape, so PR 11 widens the type and moves no row. The routes follow
      experiment 193's classes: each send there is fixable, so none goes to a person.

      ```ts
      // routes.ts. Sketch. ShipSend: every `send` ship can end with. Each `back` counts an exam round.
      const EXAM_MERGE_SENDS = {
      	"send:reviewer:no_review": run("exam_review"), // code first, then a fresh review
      	"send:builder:checks_red": run("exam_review"), // format and checks by code; still red: exam
      	"send:builder:behind": fresh("exam_review"), // main merged into the exam branch, then the same
      	"send:builder:review_failed": back("exam", "findings"), // reachable now: a real review can fail
      	"send:builder:conflicts": back("exam", "files"), // the exam writer redoes those files on main
      	"send:builder:bot_comment": back("exam", "comment"),
      	"send:builder:ejected": once, // ship again, as a new run; twice: stop, with ship's why
      } as const satisfies Record<ShipSend, Move>;
      ```

    - Every route back counts as an exam round, so a loop such as review, merge, `no_review`,
      review stops at the bound.
    - No second question when the meaning did not change. After `exam_review` passes at a new
      head, the lane goes straight to `exam_merge`, with no new ask, when a person's `merge`
      carries to that head by Part 4's rule. A format commit, or a merge of main that replays
      cleanly, keeps the yes. Anything the exam writer rewrote asks `exam_merge` again: the
      person said yes to other words.
    - What stays an ask: ship's `ask:owner:approval` and `ask:commenter:comment` (jidoka rows 60
      and 61). They are a person's.
  - **Part 4: a yes binds to the diff, not the commit.**
    - One pure function, `carry(given, now)`, answers `kept`, `glance` or `stale` for any yes the
      lane keeps: a review's verdict row, a person's `merge`, and the exam's row. It replaces the
      sha checks at the 13 places the note lists. `kept`: the same head; or the reviewed diff
      replays cleanly onto the base branch now (`git merge-tree`) to exactly the new tree; or the
      base's formatter, run on the replayed tree's changed paths, gives exactly the new tree.
      `glance`: only `git diff -U0 base head | git patch-id --verbatim` matches. `stale`:
      everything else. The checks still run at the final head, and the merge and queue writes stay
      bound to the exact sha.

      ```ts
      // carry.ts. Pure: one Gather in work.ts reads `Now` from git, and nothing here runs git.
      export const carry = (given: Given, now: Now): Carry =>
      	now.head === given.head ? kept("same_head")
      	: now.replayed === now.tree ? kept("replayed")
      	: now.formatted === now.tree ? kept("formatted")
      	: now.diff === given.diff ? {_tag: "glance", range: now.range}
      	: {_tag: "stale"};
      ```

    - Where it runs: in the lane's facts read, before ship's gate sees the rows. `laneFactsOver`
      (`github.ts:44`) and `laneRecord` (`pulls.ts:410`) run `carry` for each row and the
      person's `merge`, and write a `carried` fact (`from`, `to`, `why`) for each `kept`. The gate
      stays pure over rows at the head; `other_head` now means "no row carried here". After main
      is merged into a pushed branch (`machine.ts:1256-1259`), the lane runs `carry` and goes back
      to review only on `stale`.
    - A glance, for a review row: the review step in a short mode, one narrow question over the
      range-diff, a Judge. Its yes writes `carried` with `why: "glanced"`; a no or a doubt is a
      full review. For a person's `merge`: the person is asked again, with the range-diff shown.
      No agent answers for a person.
    - The hole the other way: today a person's `merge` binds to no head (`pulls.ts:179-208`), and
      the local host's `open` moves a pull's head and keeps its verdicts (`pulls.ts:137-146`).
      Both now go through `carry`. A `merge` said at `A` covers `B` only when `carry` says `kept`.
  - **Data first.** Each of these exists only when it happens, so it is written then:
    - `asked` gains `head` for `exam_merge` and `merge`: what the person saw.
    - `reviewed` (`tickets/ticket.ts:308-315`) gains `pr`, `onto`, `base` and `diff`. The lane's
      verdict rows gain `onto`, `base` and `diff`. `base` cannot be rebuilt later.
    - A person's `merge` answer gains `head`, `onto`, `base` and `diff`.
    - The exam head's `checked` fact gains `pr`, so PR 5's fold never takes it for the lane's own
      checks.
    - New fact: `carried`.
- **Why code and not the agent.** A format slip and a moved head have no meaning to judge. Code
  formats, reads the host's head, runs the checks, and says whether the reviewed diff still
  stands: same head, a clean replay, a formatter's output and a patch-id are tree and string
  equality. The review is an agent's job, and a different agent from the exam writer, so nobody
  grades their own exam. Only the `glance` case, where the pull request's own lines are the same
  and the lines around them moved, holds a question of meaning, and only that goes to the review
  step or the person. A change of meaning and a person's comment go to a person.
- **Files.**
  - `packages/pipeline/src/stages/pipeline/tools.ts`: format in `laneExamWork.land`; the pull row
    gets its criteria at land time.
  - New `packages/pipeline/src/stages/pipeline/exam-pull.ts` and `exam-pull.test.ts`: the
    `exam_review` body and `examCriteria`. `program.ts` is past 1,600 lines.
  - New `packages/pipeline/src/stages/pipeline/carry.ts`, `carry.test.ts` and
    `carry.laws.test.ts`: `Carry`, `Given`, `Now`, `carry`.
  - New `packages/pipeline/src/stages/pipeline/routes.ts`: `Move` and the `exam_merge` rows.
  - `packages/pipeline/src/stages/pipeline/program.ts`: the `exam_review` body's place, and the
    exam body's redo.
  - `packages/pipeline/src/stages/pipeline/machine.ts`: `exam_review` in `STEPS`, `NEXT` and
    `after()`; `examPull` in the carry; the guard in `running`; the `merged` restart runs `carry`;
    the words.
  - `packages/pipeline/src/stages/pipeline/pulls.ts`: the `<plan>/exam` target over the side tree;
    `reviewsFrom`, `mergeAnswered`, `laneRecord` and `open` without the fakes, through `carry`.
  - `packages/pipeline/src/stages/pipeline/github.ts`: `change` takes `<plan>/exam` to the local
    host; `laneFactsOver` carries instead of `notJudged`.
  - `packages/pipeline/src/stages/pipeline/work.ts`: move a side tree to the host's head,
    fast-forward only; a fresh side tree per plan version; the Gather that reads `Now`
    (`merge-tree`, diff and patch-id, range-diff, the base's formatter in a temporary worktree).
  - `packages/pipeline/src/stages/pipeline/restart.ts`: the fold reads `examPull`, and skips a
    `checked` fact with a `pr`.
  - `packages/pipeline/src/stages/exam/machine.ts`: `redo` on `ExamAsk`, and the prompt.
  - `packages/pipeline/src/stages/ship/ready.ts`, `gate.ts`: rows carried to the head count;
    `other_head`'s words.
  - `packages/pipeline/src/criteria/book.ts`, `stages/lane/view.ts`: `standingAt` and the
    window's "met" read carried rows.
  - `packages/pipeline/src/code-host-github.ts`: `verdictsAt` and `approvedBy` read `carried`
    rows for the lane's own pulls; GitHub's own approval rule is GitHub's and stays.
  - `packages/pipeline/src/stages/operate/stop.ts`: `afterReview` runs `carry` from the reviewed
    head to the built one.
  - `packages/pipeline/src/stages/review/`: the short glance mode and its brief.
  - `packages/pipeline/src/tickets/ticket.ts`: `asked.head`; `reviewed.pr`, `.onto`, `.base`,
    `.diff`; the merge answer's four keys; `checked.pr`; the `carried` fact.
  - `packages/pipeline/src/laws/ship-pbt.ts`: the `other_head` proof becomes "moved, not
    carried", plus "moved, carried".
  - `programs/pipeline/briefs/exam.md`: the redo's findings.
  - `programs/pipeline/README.md`, `docs/how-to/run-a-pipeline-ticket.md`: the step order.
  - Tests beside each: `tools.format.test.ts`, `machine.test.ts`, `machine.laws.test.ts`,
    `program.test.ts`, `github.test.ts`, `restart.test.ts`, `exam/machine.laws.test.ts`.
- **Tests, red first.**
  - On the lane fixture with `[format] run`, the exam writer hands back a file written with
    spaces. The exam pull request's commit holds it formatted. Today it holds it as written. With
    no `[format]`, the ticket gets the one line once, and the file lands as written.
  - A plan restarted to a new version lands its exam on a side tree from main. Today it commits on
    the old one.
  - A plan with one rule change: the `exam_merge` ask comes after a `reviewed` fact whose `pr` is
    the exam's. Today the ask comes straight after the exam step.
  - Ship's record for the exam ticket answers `e1` with the plan's words, and the review's row at
    the exam head. Today it answers the made-up `c1`. An exam pull with no verdicts posted reads
    `reviews: null` to ship. Today it reads `governance: passed`.
  - A scripted review fails `e1`: the exam step runs again from the exam head, with the finding in
    its prompt, and lands on the same pull request. The build never starts.
  - A scripted ship at `exam_merge` ends `send:reviewer:no_review`: the lane runs `exam_review`,
    then `exam_merge`, and writes no second `exam_merge` ask. Today it ends `stuck:sent_back`.
    `send:builder:conflicts` runs the exam writer on main with the files. `ejected` runs ship once
    more, then stops with ship's why.
  - **Ticket 117's shape**, on the local host fixture: a lane saved stopped at `exam_merge`, whose
    exam pull was reviewed and said yes at `A`, with one more commit `B` that only formats. The
    same line goes through `exam_review` and `exam_merge` with no new ask, after checks green at
    `B`, then the test writer runs. Today it ends `send:reviewer:no_review`.
  - The exam writer's redo changes a rule's text: the lane asks `exam_merge` again.
  - **Replayed.** Main moves in another file and the branch is rebased: the rows carry, `why:
    "replayed"`. Today `other_head`.
  - **Glance.** 165's #35 shape, only the README row above the pull request's row changed: the
    review step's short mode runs, and no full review. A person's `merge` in the same shape asks
    again, with the range-diff.
  - **Stale.** A real one-word change, a YAML key moved out by its indent (plain `--stable` would
    keep it), and 165's 6b smallest case, a restack that undoes the parent's new line: each is
    `stale`.
  - **The known catch.** Main renames a function the pull request calls: `carry` says `kept`, the
    checks at the final head are red, and ship ends `send:builder:checks_red`. It never merges.
  - **The base's formatter.** A pull request that also changes the formatter's config so that it
    excuses an edit: `stale`, since the formatter comes from the base.
  - **The holes the other way.** A new head on a local pull with old verdicts reads `missing`
    until `carry` says `kept`. A `merge` answer at `A` does not cover a stale `B`.
  - **Laws, on tea's pbt** ([property tests](../direction/property-tests-not-our-own-search.md)),
    each seen to fail on its planted break first:
    - every ship send at `exam_merge` routes somewhere other than `stuck:sent_back`, and a new
      send joins by being in ship's union, not by someone adding a case. Planted: delete the
      `bot_comment` row behind a cast.
    - in any order of messages, `exam_merge` never starts on a head where the exam review and a
      person's yes do not both carry, and never without green checks there. Planted: the guard
      reads `examPull.head` for the yes's head.
    - the exam step runs at most the bound, plus one per person's `again`. Planted: `back`
      forgets to count a route from `exam_merge`.
    - the builder never starts before `exam_merge` ends done or the exam step skips.
    - the fold of a lane's facts equals its saved `Held` at every point the new step can stop.
  - **Law, fast-check, on real git.** 165's generator, seed 165, a fixed 150 runs under
    `nice -n 15`: `carry` never says `kept` on a case built to be "changed", and never says
    `stale` on a clean rebase far from the pull request's lines. Two planted breaks, each must
    make the law fail before the real `carry` makes it pass: `carry` keeps on the `-U0` id instead
    of asking for a glance (the law finds a moved line, as 165's 6a did, 31 of 54); and the diff
    id uses `--stable` in place of `--verbatim` (the law finds a whitespace change in a YAML
    indent or a string).
- **Size.** About 34 files, 1,650 to 2,250 lines: Part 1 about 80, Part 2 about 500 to 700,
  Part 3 about 150 to 250 (its `yesHolds` is gone, `carry` does that), Part 4 about 850 to 1,100
  (`carry` and its Gather about 300, the 13 places about 350, the facts and the glance mode about
  200, its tests and laws about 250 to 350). A `4` (2.75 to 3.75 agent hours at 600 an hour; a
  `2` at 1,660). Without the glance mode (a `glance` is `stale` until it lands), about 200 lines
  fewer.
- **How sure: 70%.** The doubts, and what settles each:
  - Where the exam's criteria come from. Code-made from the plan's list is sure to exist; the
    planner's own task, as on ticket 117, may judge the same thing twice. The owner's pick settles
    it.
  - Whether the review and the checks run on the side tree as they do on the lane tree. It is a
    worktree of the same clone, so likely yes. The first Part 2 test settles it, before the rest.
  - A rule change that makes main's own code red, such as a new lint rule, cannot go green in an
    exam pull request: its writer may change only the listed files. It reaches the bound and
    asks. No live run has shown how often that happens.
  - `carry`: the replay, 85%, 165's own number; `formatted`, 75%, since 165 never measured a
    formatter; the glance, 65%, from 4 real cases of one pattern. Its cost is not timed: time
    `carry` on this repo's 13 real force pushes, median and slowest, before the lane uses it.

## PR 11: every outcome has a route, and a fixable stop never stops

**Scope decided by the owner 2026-11-02; approved by the owner 2026-11-02, with every lean.** Today's version:
`packages/pipeline`, and one change in `packages/fabrika`'s writer use. On PR 10. It builds jidoka
row 9's cure, every machine-fixable and preventable row of
[the jidoka table](../direction/jidoka-and-andon.md#every-place-todays-lane-stops-or-asks) that
PRs 1 to 10 left, row 13's dead ends, and the new holes and record holes
[experiment 193](../../experiments/193-lane-holes.md) found.

```text
today:  after(step, outcome) is a switch; 99 of 153 pairs stop: 83 say only step_stuck, 14 sent_back
PR 11:  ROUTES[step][name]   one row per outcome; a missing or an extra row does not compile
        a fixable row goes to a step, a service's wait, or once; never to a stop
        a stop writes its step's own why on the ticket
```

- **What.**
  - **One route table.** `after()` becomes a lookup in `ROUTES`, typed over every name each
    step's stage can say, plus the names the lane's own bodies make (`MADE` in experiment 193,
    now exported beside the table). A step with no row for a name, or a row for a name the step
    cannot say, fails `pnpm typecheck`. Exam, push and the mutants job export their names, as the
    other stages do, so nothing reads names off a schema.

    ```ts
    // routes.ts. Sketch. What the lane does when `step` ends with an outcome. `kind` stays on
    // today's outcomes; the new unions use `_tag`.
    export const With = Schema.Literals(["names", "findings", "comment", "files", "mutant", "nothing_changed", "disputed"]);
    export const Move = Schema.Union([
    	Schema.TaggedStruct("next", {}), // NEXT[step], as today
    	Schema.TaggedStruct("run", {step: LaneStep}), // that step, same round
    	Schema.TaggedStruct("back", {step: LaneStep, with: With, bound: Schema.Literals(["rounds", "once"])}),
    	Schema.TaggedStruct("fresh", {then: LaneStep}), // take main in, as a restart does, then run `then`
    	Schema.TaggedStruct("once", {}), // the same step again, as a new run; twice: stop with its why
    	Schema.TaggedStruct("wait", {in: Service}), // the service waits it out; only a refusal gets here
    	Schema.TaggedStruct("host", {}), // read the ticket and the pull request fresh: end or pause by what they say
    	Schema.TaggedStruct("ask", {for: AskFor}),
    	Schema.TaggedStruct("stop", {}), // an andon stop, saved at this step, its why on the ticket
    	Schema.TaggedStruct("end", {outcome: EndOutcome}),
    	Schema.TaggedStruct("cannot", {law: Schema.String}), // the named law shows it never arrives
    ]);
    export type Move = typeof Move.Type;

    /** Every outcome name each step can hand the lane. */
    type NamesAt = {
    	readonly triage: Name<SortOutcome>;
    	readonly plan: Name<PlanOutcome> | MadeAt<"plan">;
    	readonly exam_merge: Name<ShipOutcome>;
    	readonly build: Name<BuildOutcome> | MadeAt<"build">;
    	readonly merge: Name<ShipOutcome> | MadeAt<"merge">;
    	// ...one per step in STEPS, exam_review included
    };
    type Routes = {readonly [S in LaneStep]: {readonly [N in NamesAt[S]]: Move}};

    export const ROUTES = {
    	merge: {
    		...SHIP_STUCK, // the rows ship has at both its steps: wait, once, cannot
    		"send:builder:checks_red": back("build", "names"),
    		"send:builder:review_failed": back("build", "findings"),
    		"send:builder:bot_comment": back("build", "comment"),
    		"send:builder:conflicts": fresh("build"), // a clean take of main goes on to merge
    		"send:builder:behind": fresh("merge"), // no agent turn, no round
    		"send:builder:ejected": once,
    		"send:reviewer:no_review": run("review"),
    		"ask:owner:approval": ask("step"),
    		"ask:commenter:comment": ask("step"),
    		"skip:closed": host,
    		"skip:draft": host,
    		"skip:not_ours": cannot("the lane opened it on the person's login"),
    		"stuck:merged_elsewhere": end({kind: "stuck", why: "merged_elsewhere"}),
    		done: next,
    		"done:part": cannot("ship's done never has part"),
    	},
    	// ...every other step
    } as const satisfies Routes;
    ```

  - **One row traced: `merge`, `send:reviewer:no_review`.** 193's worst hole: today the lane stops
    `stuck:sent_back`, and a restart runs ship into the same answer.
    1. Ship at the lane's pull request ends `send:reviewer:no_review`: a criterion was reworded,
       or the head moved and PR 10's `carry` said `stale`.
    2. `ROUTES.merge["send:reviewer:no_review"]` is `run("review")`. The lane runs review at the
       pull request's head, same round.
    3. Review passes; push posts the verdicts at that head. Push's `next` is the `merge` ask,
       unless the person's `merge` carries to this head (PR 10), and then it goes straight on.
    4. Ship merges. If review sends work back instead, that is a round, and past the bound the
       person gets `rounds_spent`, as today.
  - **The routes, by kind.** Experiment 193 classed 120 rows: 87 holes (77 fixable, 10 dead ends)
    and 33 a person needs. Its other 21 cannot happen. Each row gets one kind. PR 10 builds 6 of
    them, the `exam_merge` sends; PR 11 the rest. Rows 28 and 45 follow the jidoka table, which
    calls them fixable, where 193 called them needed.

    | Kind | Rows | What happens | Examples |
    |---|---|---|---|
    | To a step | 20 | `back`, `run` or `fresh`, with what the step needs to fix it | ship's sends, `still_red`, `no_change`, `already_passes`, `fails_on_base`, `no_result`, mutants `not_killed`, the two guard stops |
    | `wait`, in a service | 27 | the service backs off and tries again; the tile says what it waits on | every `read_failed`, `*_unknown`, a claim or a question that could not be written, a keyed push, open or post |
    | `once`, in the lane | 31 | the same step again, as a new run; twice: stop, with its why | `draft_failed`, `cut_off`, `run_failed`, `copy_failed`, `commit_failed`, ship's `checks_stuck`, `head_moving`, `merge_unknown`, `ejected` |
    | Ends or pauses by meaning | 10 | read the ticket and the pull request fresh, or the claim | jidoka row 13's eight dead ends; a claim this lane holds is taken back |
    | A guard | 1 | checked when the lane starts, before any agent | review `rubric_unknown` |
    | Stays an ask | 16 | a person decides; 4 are the spend asks, new | `approval`, `comment`, `ruling`, `cannot_test`, `exam_touched`, `over_budget` |
    | Stays a stop | 12 | an andon stop, saved, its why on the ticket | 6 pause picks, 4 `unchecked` (drafts spent), `checks_not_run`, a step that could not run twice |
    | Stays a final end | 3 | `FINAL`, as PR 5 | `not_yours` twice, `merged_elsewhere` |

    Of the 21 that cannot happen, 8 are ends with nothing to do (`next` or `end`), 12 get `cannot`
    with a law, and one, `exam_merge` `send:builder:review_failed`, is reachable from PR 10 on and
    routes to `exam`. The new step `exam_review` gets 21 rows of review's names, the same kinds as
    `review`'s.
  - **What each kind means in code.**
    - **To a step.** `back` counts a round as today (`back` in `machine.ts`), or, with
      `bound: "once"`, goes back one time and then asks the step's own question, as jidoka rows 28,
      29, 35 and 41 say. `with` names what the next run's brief carries: the failing names, the
      findings, the comment, the conflicting files, the mutant left alive, "you changed nothing",
      or the builder's `disputed` for a fresh review (row 45). `fresh` is PR 5's read of main,
      reused: unpushed branches rebase, pushed ones merge, the checks run at the new head, and a
      clean result runs `then` with no agent turn and no round (row 62). A conflict in the
      builder's files goes to build; in an exam file, `exam_conflict`, as PR 5.
    - **The guard after the mutants job.** Today a step after the mutants job stops when its new
      tests leave the checks red or not run (`machine.ts:926-944`). After: the guard runs the
      checks, as a restart already does (`program.ts:1371`); red is `back("build", "names")`.
    - **`wait`.** One schedule, in one place: from 1 second, doubling, up to 100 seconds apart, no
      cap on tries ([bounds](../direction/jidoka-and-andon.md#bounds)). Each service that owns a
      read or a keyed write wraps its transport in it: Tickets, the ledger's claim, the work
      service, the code host, the review pack. Only a write with its intent key is retried. A
      transient error never reaches the lane. A refusal (not found, forbidden) does, and stops
      with its real why. Nothing in the lane or a step retries what a service retries (P8).
    - **`once`.** The lane counts tries per step and intent from the trail, as `lane_step_err`
      counts today. A retry is a new run (below), so the first try's end and cost stay.
    - **Ends or pauses by meaning (jidoka row 13).** A step's `skip:closed`, `skip:merged` or
      `skip:draft` reads the ticket and the pull request fresh. A closed ticket ends
      `skip:closed`. Merged at the lane's head ends `done`; at another head, `merged_elsewhere`.
      A closed or draft pull request on an open ticket is a person's pause: `ask:owner:paused`,
      saved at that step, as PR 5's `stop` is, and the same line goes on there. Only `done`,
      `FINAL` and a closed ticket end a lane, as PR 5 decided. The claim held by this lane's own
      saved id is taken back; another lane's ends `skip:claimed`, naming it, as operate does
      (row 3).
    - **The guards (preventable rows 14, 24, 38, 48, 55, 65).** Row 24: the plan's Check runs
      `revisionOfDraft` itself, so a passed Check cannot fail to be kept. Row 48: build's guard
      refuses a diff that adds a disable comment, and sends it back with the line; mutation's
      `check_change` stays as the backstop for a change to an ignore file. Row 55: the rubrics
      folder from `fabrika.toml` is checked when the lane starts. Rows 14, 38 and 65: a law each
      that the lane never reaches `not_ready`, `no_criteria` or `criteria_unknown`, so those rows
      are `cannot`.
    - **The spend asks (rows 18, 23, 40, 57).** `over_budget` asks `spend`, with the cost so far.
      "more": the step runs again with a new limit, in its saved session where the harness keeps
      one (PR 7 records the id), else from the working copy as it stands. "stop": a saved pause at
      that step. See the open questions.
  - **The record holes ride along.** Each exists only when the run happens, so each is written
    then:
    - **A stop says why on the ticket.** Today a stop writes nothing there
      (`program.ts:1291-1298`), a send turned into a stop says nothing (`talk.ts:23-27`), and a
      crash's cause goes only to the tile (`program.ts:1518`). After: a `stopped` fact with the
      step, the step's own outcome (`stuck:tests_red`, not `step_stuck`), the lane's stop, where
      it goes on, and the cause's first lines for a crash. The ticket program draws one row.
    - **A retry writes under its own run id.** Today the retry is the same Act, so it writes
      under `r-<step>-<count>` again, and the ledger keeps a key's first write
      (`fabrika/src/host/rules.ts:587-588`). The ticket keeps the failed try's `stuck:run_failed`
      with an empty carry, and drops the real end and its cost. After: `r-<step>-<count>-<try>`,
      try 1 keeping today's id so old tickets read the same. The fold reads the last try's end.
    - **Each fact names its real writer.** Today the lane's code and the person's answers both
      write as `user:<id>`. After: the lane writes as the existing `Agent` writer,
      `agent:lane for:<id>`. The door and `mayWrite` already refuse an `answered` from an agent,
      so the lane can never write a person's answer either.
    - **The input key includes the pull request heads.** `Inputs` (`program.ts:1404-1416`) gains
      `examHead` and `prHead`, so 117's two `exam_merge` runs no longer share one key.
    - **The review post reads past 100 comments.** `operate/writes.ts:62` reads one page before it
      looks for its marker. After: every page, so a pull request with more than 100 comments is
      never posted twice.
  - **The law from experiment 193.** What its script needs moves into
    `routes.laws.test.ts`: each step's names, the lane's own `MADE` names, and the drive through
    the real reducer at round 1, at the last round, and with `send_back = false`. The 87 hole keys
    and the 33 needed keys are copied in as two plain lists: the test's own exam, which the route
    table cannot write for itself (P12). Nothing imports from `experiments/`.
- **Why code and not the agent.** Where the lane goes after an outcome is a table, not a
  judgment. A route that does not exist is a compile error, not a stop a person has to read. A
  wait, a retry and a fresh read of the host need nothing judged. The agent steps the routes send
  work to still do the fixing, with what failed in their brief. Only the 16 asks reach a person.
- **Files.**
  - `packages/pipeline/src/stages/pipeline/routes.ts` (from PR 10), `routes.test.ts`, and new
    `routes.laws.test.ts`.
  - `packages/pipeline/src/stages/pipeline/machine.ts`: `after()` as a lookup; `once` per intent;
    `host`; the guard's route; the `spend` ask and its picks; the claim taken back.
  - `packages/pipeline/src/stages/pipeline/program.ts`: `with` into the briefs; the host read; the
    guard's checks; the run id per try; the `stopped` fact; the writer.
  - `packages/pipeline/src/stages/pipeline/work.ts`, `github.ts`: the host read for row 13.
  - `packages/pipeline/src/stages/pipeline/talk.ts`: a stop's words on the ticket.
  - `packages/pipeline/src/stages/pipeline/restart.ts`: the fold reads the last try's end.
  - `packages/pipeline/src/stages/pipeline/key.ts`, `key.test.ts`: the two heads.
  - New `packages/pipeline/src/wait.ts` and `wait.test.ts`: the one schedule.
  - The services that take it: `packages/pipeline/src/tickets/tickets.ts`, the ledger's
    `claim`, `code-host-github.ts`, the review pack in `stages/review/`, and the reads in
    `stages/pipeline/work.ts`.
  - `packages/pipeline/src/tickets/ticket.ts`: the `stopped` fact.
  - `packages/pipeline/src/stages/operate/writes.ts`, `writes.test.ts`: every page.
  - `packages/pipeline/src/stages/plan/` (the Check, row 24), `stages/build/` (the guard, row 48).
  - `packages/pipeline/src/stages/exam/machine.ts`, `stages/push/machine.ts`,
    `stages/test-writer/mutants.ts`: export their names.
  - `programs/pipeline/briefs/build.md`, `test-writer.md`: what `with` carries.
  - `programs/tracker/src/rows.ts`: the `stopped` row.
  - `programs/pipeline/README.md`, `docs/how-to/run-a-pipeline-ticket.md`: what stops now, and why.
  - Tests beside each: `machine.test.ts`, `machine.laws.test.ts`, `program.test.ts`,
    `restart.test.ts`, `github.test.ts`.
- **Tests, red first.**
  - **Compile.** Two `// @ts-expect-error` cases: a copy of `ROUTES.merge` with one row deleted,
    and one with a name ship cannot say. Today both fail `tsc`, since there is no typed table to
    reject them; after, both pass.
  - **193's law.** For every step, every name and the three rounds, drive `lane_step_ok` on the
    real reducer. A hole key that is not a `wait` row lands on neither a stop nor an ask on its
    first arrival, and a `once` row stops only on its second. A `wait` row names a service in
    `WAITS`, whose own law in `wait.test.ts` shows a transient error never reaches the lane. A
    needed key still reaches a person or its stop. Today it fails on every hole key. Planted
    breaks, each seen to fail the law first: route `merge` `send:reviewer:no_review` to `stop`;
    route `mutation stuck:run_failed` to `stop` with no `once`; route `triage ask:owner:ruling`
    to `next`.
  - On the lane fixture, a ship that ends `send:reviewer:no_review` at `merge`: review runs,
    then merge, and a restart never loops. Today `stuck:sent_back`, and a restart ships into the
    same answer.
  - `send:builder:behind` at `merge`: main is merged in, the checks run green, and merge runs
    again with no build round. Red: build, next round, with the names.
  - The mutants job's new tests turn the checks red: build runs, next round. Today review stops
    `stuck:checks_red`.
  - A ticket closed mid-build ends `skip:closed`. A pull request merged at the lane's head ends
    `done`. A draft pull request on an open ticket pauses at `merge`. Today each is
    `stuck:step_stuck`.
  - A Tickets read that fails three times, then answers: the step ends as if nothing failed, and
    the tile said it waited. A 404 stops with `read_failed` and its real why.
  - A step that fails once with `run_failed` and then ends `done`: the ticket has two runs, the
    first `stuck:run_failed`, the second `done` with its carry and its cost. Today it keeps only
    the first.
  - Any stop: the ticket gets one `stopped` fact with the step's own outcome. Today none.
  - Every fact the lane writes says `agent:lane`; the person's `answered` says `user`.
  - Two `exam_merge` runs at different exam heads get different keys.
  - A pull request with 150 comments and the marker on the second page: no second post.
  - `over_budget` at build asks `spend`; "more" runs build again with the new limit.
  - **Laws, on tea's pbt,** each seen to fail on its planted break first:
    - no outcome of any step ends `stuck:sent_back` or `stuck:step_stuck` with no step's own why
      on the `stopped` fact. Planted: drop the why from `stopped`.
    - a step runs at most twice per intent from `once`, plus its rounds. Planted: count tries per
      step, not per intent.
    - no route from a fixable row goes to an ask: only the 16 ask rows reach a person (P1).
      Planted: `exam_merge`'s `bot_comment` back to `ask("step")`.
    - every pick of the `spend` ask resumes at its own step (P10).
    - no lane ends but by `done`, a `FINAL` reason or a closed ticket. Planted: `skip:draft`
      as an `end`.
- **Size.** About 32 files, 1,950 to 2,600 lines: the table and its types 350 to 450; the
  machine's lookup, `once`, `host`, the claim and the spend ask 250 to 350; the program's briefs,
  host read and guard 200 to 300; `wait` and five services 150 to 200; the six guards 100 to 150;
  the record holes 200 to 250; tests and laws 700 to 900, the 193 law about 300 of it. A `4` (3.25
  to 4.3 agent hours at 600 an hour; a `2` at 1,660). Without the spend asks, about 150 fewer.
- **How sure: 65%.** The doubts, and what settles each:
  - 193's classes are one reader's. A row may route work that cannot fix it. Every route is
    bounded by rounds or `once`, so the worst case is a wasted run and then the same stop, now
    with its why. The `step` rows in `field/runs.jsonl` show it after a few lanes.
  - A `wait` with no cap hides a long outage behind a waiting tile. The tile says what it waits
    on, and a person can stop the lane. 70% sure that is enough.
  - The spend ask's "more" on a Codex session that cannot be loaded again: it starts from the
    working copy, as row 39 does for a build. Not tried.
  - The size. One review of about 2,300 lines is large. See the open questions.

## How each pull request goes

Each is a fix to the lane's own steps, so it goes by hand
([the deal](../direction/next-is-a-pipeline-pre-run.md)): this plan is the plan step; then a
test writer agent writes the red tests above, a builder agent makes them pass without
touching them, the mutation step runs on a fixed-seed sample of about 150 (seed 119120, under
`nice -n 15`), and one fresh review reads the whole diff. Each run is logged in `field/` the
same day, with what ran it. The owner's yes and green CI, then an agent merges after a leak
grep.

The agent hours are restated 2026-11-01 at the measured rate, as
[agent hours](../direction/agent-hours.md) decided, from
[experiment 187](../../experiments/187-agent-hours.md). The rate that leads is 600 lines an agent
hour, demlik's full lanes, since a lane here runs every step. This repo's median of about 1,660
is beside it; it was mostly builders working alone. Each PR's step is the one on the doubling
scale (0.25 to 8) that holds the middle of its range at that rate. The old hours stay, struck,
as an old guess that turned out wrong: they implied about 100 lines an hour, with no source.

Total: about 140 file changes (some files change in more than one pull request), 6,480 to
8,980 lines, **about 11 to 15 agent hours** at 600 an hour (4 to 5.5 at 1,660). Before ticket
117 restarts again (PRs 10 and 11, added 2026-11-02): 3,600 to 4,850 lines, **about 6 to 8 agent
hours** (2.2 to 2.9 at 1,660). Before its first restart (PRs 1, 2, 3, 4, 5 and 7): 2,230 to 3,180
lines, about 4 to 5.5 agent hours (1.3 to 2 at 1,660). The steps add up to 15.25, more than the
range, since each rounds up to a step. PRs 10 and 11 were sized from experiment 193's rows, not
from an old guess.
*Old guess, wrong: 29 to 41.5 agent hours in all, 22.5 to 32 before the restart.* The first
revision against the guidelines added about 230 to 350 lines, most of it in PR 5. The owner's
decisions added about 990 to 1,460: PRs 7, 8 and 9, the pause and the key in PR 5, and the
setting in PR 3. Sure of the hours: 60%. The doubt: 600 comes from demlik lanes with no test
writer or mutation step. Each PR's own `spent` settles it.

| PR | Files | Lines | Old guess, wrong | At 600 an hour | Step | At 1,660 an hour | Step |
|---|---|---|---|---|---|---|---|
| 1 | 6 | 150 to 200 | ~~1.5 to 2~~ | 0.25 to 0.33 | 0.5 | 0.1 | 0.25 |
| 2 | 2 to 3 | 60 to 120 | ~~1 to 2~~ | 0.1 to 0.2 | 0.25 | under 0.1 | 0.25 |
| 3 | 12 | 250 to 380 | ~~2.5 to 3.5~~ | 0.4 to 0.6 | 1 | 0.15 to 0.25 | 0.25 |
| 4 | 10 | 460 to 620 | ~~4 to 6~~ | 0.8 to 1 | 1 | 0.3 to 0.4 | 0.5 |
| 5 | 13 | 960 to 1,360 | ~~10 to 13.5~~ | 1.6 to 2.3 | 2 | 0.6 to 0.8 | 1 |
| 6 | 7 | 200 to 300 | ~~2 to 3~~ | 0.33 to 0.5 | 0.5 | 0.1 to 0.2 | 0.25 |
| 7 | 10 | 350 to 500 | ~~3.5 to 5~~ | 0.6 to 0.8 | 1 | 0.2 to 0.3 | 0.5 |
| 8 | 7 | 200 to 300 | ~~2 to 3~~ | 0.33 to 0.5 | 0.5 | 0.1 to 0.2 | 0.25 |
| 9 | 6 | 250 to 350 | ~~2.5 to 3.5~~ | 0.4 to 0.6 | 0.5 | 0.15 to 0.2 | 0.25 |
| 10 | about 34 | 1,650 to 2,250 | none | 2.75 to 3.75 | 4 | 1 to 1.35 | 2 |
| 11 | about 32 | 1,950 to 2,600 | none | 3.25 to 4.3 | 4 | 1.2 to 1.6 | 2 |
| **All** | **about 140** | **6,480 to 8,980** | ~~**29 to 41.5**~~, PRs 1 to 9 | **10.8 to 15** | 15.25 summed | **3.9 to 5.4** | 7.5 summed |

## What this plan does not do

- *Old plan, reversed by the owner 2026-11-02: the other rows of the table were to get one
  tracker ticket each, after ticket 117.* Now PRs 10 and 11 build every machine-fixable and
  preventable row of [the table](../direction/jidoka-and-andon.md#every-place-todays-lane-stops-or-asks),
  before ticket 117 restarts again. Nothing waits for a ticket.
- Checkpoint commits: tracker ticket 145, after ticket 117 restarts ([PR 7](#pr-7-the-lane-records-wide)).
- Reading the input key to skip a step whose inputs did not change. PR 5 writes it; a later
  ticket reads it, once restarts show how often keys match.
- Drawing a run's content in `trace`. PR 7 records it; the view waits.
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
- Whether two nudges are too many or too few. PR 9's count will say.
- Whether c7 and c8 on ticket 117's plan pass in the main pull request's review, now that the
  exam is on main and outside that diff (PR 10).
- What a reviewer costs on a rules-only diff. The first `exam_review` run's `spent` says.
- How often each of 193's 87 holes bites. One real ticket hit 2 of them. The `stopped` facts PR 11
  writes will count the rest.

## Unresolved questions

Settled 2026-11-01, kept for the record: restart = same line typed again; `exam_touched` asks
with two picks and goes on from step before (P5); fold misses a field = resume at that
field's step, never a fresh lane (P4). Then, with the guidelines: one shared round count of 3,
`once`, `drafts` = 3, and service `wait` with no cap (P8, leans approved); `exam_conflict` and
its picks (P1's list of 16); input key on `done`, written in PR 5; rebase an unpushed branch,
merge a pushed one; count attention now, no cap, at most two nudges (P11); `stop` = saved
pause; unasked comment with `during`; red goes back by default, setting to turn off.

1. Mutation skips own suite on green `checked`, skip written? Lean yes, 70%.
2. Code formats builder's files too, not just test writer's? Lean yes, 80%.
3. Nudge gaps: Linear's 1 and 2 working days? Lean yes, 55%. Doubt: long for an ask that holds a lane.
4. Nudge = code comment on ticket? Lean yes, 65%.
5. PR 7 builds content recording from "an agent run keeps its content" (proposed), view later? Lean yes, 75%.
6. Checkpoint commits (145) after 117 restarts, not in this plan? Lean yes, 70%.
7. Setting name `[build] send_back`? Lean yes, 75%.

Settled 2026-11-02 by the owner's scope for PRs 10 and 11, kept for the record: the main `merge`
step's routes go in PR 11, not later; a format-only commit keeps the yes (the diff rule, `kept`,
`formatted`); PR 10's Part 1 rides in PR 10, since nothing runs before both land; no table row
waits for a ticket.

Questions 8 to 15 below: **the owner took every lean, 2026-11-02.** Kept as asked, for the
record. PR 11 is two pull requests, 11a (routes and the law) and 11b (waits and records).

8. Exam criteria made by code, one per change the plan lists? Lean yes, 70%. Why: code cannot
   miss one. Cost: none extra. Doubt: the planner's own exam task gets judged twice.
9. Exam past its 3 rounds asks `rounds_spent`, and `again` runs the exam step? Lean yes, 70%.
   Why: the same ask as build, no new kind. Cost: about 30 lines.
10. The spend asks (rows 18, 23, 40, 57) in PR 11 too, though they are judgment rows? Lean yes,
    65%. Why: else 4 rows wait on a ticket. Cost: about 150 lines. Doubt: "more" on a Codex
    session.
11. Rows 28 and 45 as the jidoka table says (one more writer try, a fresh review), not as 193's
    "needed"? Lean yes, 70%. Why: the table is decided. Cost: one agent run before the ask.
12. A closed or draft pull request on an open ticket is a saved pause, not an end, though row 13
    says "ends `skip`"? Lean yes, 70%. Why: keeps PR 5's three ends. Cost: none.
13. The lane writes as `agent:lane for:<id>`, with no new writer kind? Lean yes, 75%. Why: the
    door already refuses an agent's answer. Doubt: a view that reads `user` as the owner.
14. Codex runs' $0 cost (193's known 4) rides in PR 11? Lean yes, 65%. Why: record wide. Cost:
    about 50 lines in `packages/fabrika`. Doubt: a list price per Codex model.
15. PR 11 as two by-hand pull requests (routes and the law; waits and records), both before 117?
    Lean yes, 60%. Why: one review of about 2,300 lines is large. Cost: one more by-hand pass,
    about 0.5 agent hours.
