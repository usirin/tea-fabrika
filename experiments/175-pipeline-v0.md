# 175. Can one line in an app tile take a ticket through every step?

**Yes, on scripted agents.** In the real built app, one typed line took a tracker ticket through
triage, plan, a person's yes, exam, test writer, build, mutation, review, push, a person's second
yes, and a merge on a local code host. Every window filled from the ticket's facts. No live agent
has run it, and the GitHub side has never met real GitHub. This is all **today's version**.

The tile, as it read in that run, typed again after the test stopped the lane inside the builder's
run. The steps before the stop are not repeated:

```text
tsh$ pipeline --ticket 1
ticket 1
line build: done  gpt-6-astra, 1100 tokens, price unknown
line mutation: send:test_writer:mutant_survived
line mutants: done  gpt-6-astra, 1100 tokens, price unknown
line review: done  gpt-6-astra, 1100 tokens, price unknown
line push: done
line asks: merge local:example/lane/pull/1. Answer it in: ticket --ticket 1
line merge: done
line #1 ended: done. done
```

The token counts are the fake agent's. The fixture's `fabrika.toml` also runs triage on the fake
Codex, so none of this run touched Claude. The live default for triage is opus.

## The machine

A new plain tea parent, in `packages/pipeline/src/stages/pipeline/machine.ts`. We did not extend
`operate`: its order has no triage, exam, test writer, mutation or push, and it drives lanes by a
different claim. Its whole order is one pure function the laws read:

```ts
// sketch, from machine.ts
type Move = {to: Step} | {ask: Question} | {end: Outcome};
const after = (step: Step, outcome: Outcome, round: number): Move => {...};
```

Each step's end writes `ended` on the ticket, and `started` carries the brief's name and hash, the
harness and the model, written as it starts:

```ts
{type: "started", stage: "plan", run: "r-plan-2", brief: "plan.md", hash: "3f1c...",
 harness: "codex", model: "gpt-6-astra", trace: "86c0..."}
```

The stage name on `started` and `ended` is what `runs`, `map` and `ticket` read. None of their folds
changed. One change to the map's data: its spots said `push` was not built and three steps were
machines, which this work made false.

## How it was run

```sh
pnpm --filter @kampus/fabrika-app-old e2e:lane          # the app, on a temp home, unseen
vitest run src/stages/pipeline/program.test.ts          # the same lane, 8 cases, in one process
```

The agents are a fake `codex` on the real Codex adapter (`fixtures/pipeline-lane/`). Git, vitest,
Stryker and the sandbox are real. The code host is a bare remote and a file of pull requests. All
three API keys unset. It cost nothing.

## Each step's proof, and what is thin

| Step | What ran | What is thin |
|---|---|---|
| Triage | The real `sort` machine, in the app | The fake answers yes. It reads no earlier tickets. Never sent a no in the app. |
| Plan | The real plan machine, in the app | The plan is the fake's. |
| Person's yes | A click in the ticket window; an answer on the ledger | None. |
| Exam | Skip in the app, written. A `[rules]` ticket goes through it to a merged exam pull request in `program.test.ts`, not in the app | Its `governance` review row is one the local host declares. The person's yes is the only real check on it. |
| Test writer | The real machine, in the real box, in the app | The fake writes one known test. |
| Build | The real machine, in the app. It does not push | A `[touch-exam]` ticket ends `stuck:exam_touched`, in the process test only. Codex has no hook before a tool, so the guard runs after the change. |
| Mutation | Real Stryker under the app's host. A mutant lived and went back to the test writer | One small file. |
| Review | The real machine, on the local head, through a `book` target over the ticket's tree | A real diff, a fake reader. On Codex it has a shell in a throwaway copy. |
| Push | The real machine, in the app, to a bare remote | Never a real pull request. |
| Merge | Real `ship`, guards on, fast-forward onto main, on a person's click | `gh` never ran. |

"Skip" above means only the exam machine's own decision on this ticket.

## What each window showed

- **Tile:** one line per step. Lines wrap hard at a narrow tile. Each has the program's `line ` prefix.
- **Ticket:** the two asks, with their buttons. Afterward: `done: PR #1 merged`, `checks passed`.
- **Runs:** nine clips, with exam and mutants as extra tracks.
- **Map:** all nine steps lit, and `#1: done: PR #1 merged`.
- **Trace:** after opening its folded strip, 37 spans and the job's name. It says `0 steps`: the
  lane's tea steps are not in that record as steps, only spans. It also says `stopped`, since the
  clip picked belonged to the job the test had stopped.

The shots are in `programs/pipeline/docs/`, and its README says what squeezes in each layout.

## The two questions the audit left open

**Does the sandbox start under the app's host?** Yes, seen in this run: the test writer's box, the
build and Stryker all ran under the bundled host. It took three changes: Stryker, the Agent SDK and
srt stay outside the bundle, the mutation ignorer gets a bundle of its own, and the box needs a
`CLAUDE_CODE_TMPDIR` it can write, as in experiment 127.

**Does closing the runs window lose the run?** No. Ctrl-B x, y closes it, the tile says it is
closing, and the test writer ran after that. A second Ctrl-B x, y stops the lane in the builder's
run. Typing the line again goes on: plan and test writer ran once in all, and the builder ran twice,
the one the kill cut short and the one that ended. A person loses that one run's work and its turn
counts.

## The laws

All on the real reducers from their real `init`, through `@demlik/tea/pbt`. Each was seen to fail on
the planted break.

| Machine | Law | Planted break |
|---|---|---|
| Lane | Steps run in order; no merge without the person's answer; a restart only repeats; a skip is written; a stuck child ends named; and more | Each has its plant in `machine.laws.test.ts`, 21 tests in all |
| Build | A refused change ends `stuck:exam_touched` | A refusal read as a failed push |
| Push | Opens only after the push | Opens on a failed push |
| Push | Names every failure | A failed post read as done |
| Push | Done only after posting, on that head | Done with no post |
| Push | Stays over | A finished step that starts again |
| Exam | No rule change is written as skipped | A rule change that is skipped |
| Exam | Lands only what the plan listed | The check taken out |
| Exam | Asks the person, never says done | A landed exam that says done |
| Exam | Stays over | A finished step that starts again |
| Answers | Commits only on the mutants' head | A commit on another head |
| Answers | Names every failure | A failed commit taken as no news |
| Answers | A restart only repeats | A restart that drops what was in flight |

## Decisions and departures

- **Model.** The four Codex steps default to `gpt-6-astra`, effort `high`. This departs from
  [agents run on Codex](../docs/direction/agents-run-on-codex.md), which says sol. It is a setting
  per step in `fabrika.toml`, and no step names a model in its logic.
- **Price.** `experiments/lib/list-prices` has no rate for `gpt-6-astra`, and we did not borrow one.
  Tokens are recorded and `listUsd` is `null`. The tile says `price unknown`. The ticket and runs
  windows still say `$0.00`, which is not true of a live run.
- **Triage stays on opus.** [Experiment 159](./159-triage-on-codex.md) leans to a move at 65% and asks
  for a rerun first. It stays a setting.
- **The exam's files.** The exact files in the test writer's own commits, plus the rule patterns. A
  name pattern alone would catch a helper the plan gave the builder and miss a test in an odd place.
- **The ticket's pull request.** Only the watcher may write a `pr` fact, and no watcher runs in today's
  version at all. So the lane asks a small one to look after its push and its merge: it reads the code
  host and writes as itself. A merge made by hand after the lane ended is not seen. 80% sure this is
  right for v0; a standing watcher is the real answer.
- **A GitHub branch.** With `host: github`, the host reads GitHub through `gh`, but keeps the ticket
  from its own row and the approval from the person's answer. So no issue text is read. It first
  had tests for its pure parts only. A later change gave it a whole lane over a stand-in `gh`.

## What the compiled briefs needed

They are the step briefs as given, in plain files. `test-writer-mutants.md` declares `{ticket}` and
never uses it: the agent answers mutants without the ticket's text. A test holds that fact so it is
seen when the brief changes. No brief names a Claude-only tool. The review's `file_note` tool does
not exist on Codex, so those notes are dropped.

Leans taken from the brief's open list: no catch-up merge, so a head behind main ends
`stuck:sent_back` (60% sure; a real busy repo would settle it). A `no_load` result as `resultsOf`
reads it (65%; one real run with a bad test would settle it). A builder's regression test in round
two goes back to the test writer (70%). The review keeps a shell on Codex (75%; reading what it does
with one would settle it).

The rules in `rules.md` marked CODE with no check yet, not done here: the leak gate, the em dash lint,
the lints on experiment write-ups, the setting against WebKit, the rule on killing processes, and
`nice` and worker limits for an agent's own test runs. The agent's commit attribution stays a program
rule. None touches a step's order; each is a check of its own.

## What it found that was wrong

Kept because they cost time and will come back:

- A value that fails a Cmd's `ok` schema turns into its error Msg with no word. A double `review-`
  prefix looked like a failed read of the pull request, and took a debug print to see.
- srt overrides a child's `TMPDIR`. The test writer failed with `no_result`, since its temp folder
  was closed by the box.
- Every pull request first landed as `done:part`, since the local host called each one part of its
  ticket. Only the exam's should be.
- The ticket said `PR none yet` after a merge. That is why the small watcher exists.
- A law on the answers machine almost never reached its commit: three right answers in a row are rare
  in a random list. Its planted break passed, which is how it showed. Lists may now start on that walk.
- In the one full run of the tests, `apps/fabrika/src/host/one-host.test.ts` failed 3 of its tests
  while the end-to-end run shared the machine. It passed alone, right after. It looks like load, and
  this is not proven. Running the two side by side a few times would settle it.

## What is rough

- A stuck lane is final. Typing the line again says how it ended, and there is no restart.
- The lane's claim is not renewed after a kill.
- A kill mid-step loses that step's earlier turn counts.
- Triage reads no earlier tickets, and labels are dropped.
- The app's map still draws `operate` as the holder of the steps. The lane is not `operate`. That
  map's change is #117's.
- The map's "not built yet" legend now has nothing to point at.
- `.done` markers are visible in the disposable copies an agent reads.

## What this cannot tell us

- **What a real model does with these briefs.** None has run on one. Every agent answer here is
  written ahead, so this says nothing about quality, tries or tokens.
- **Whether real Codex fits.** The fake takes the adapter's arguments and speaks its format. It cannot
  show that `gpt-6-astra` is on the plan, that a login works in the adapter's own home, or that a long
  run streams the way the fake does.
- **Whether real GitHub fits.** The whole lane now runs on `host: "github"` over a stand-in `gh`
  (`fixtures/pipeline-lane/gh.mjs`), with real git on a bare remote. It has never met real GitHub. Only
  the stand-in's answer to the facts query is compared with a recorded one in `fixtures/code-host/`. Its
  other answers, its refusals, its branch rule and the timing of its checks are written from what the
  code expects, so they prove nothing about GitHub itself. A merge queue is not played at all. Over the
  stand-in, a branch rule that wants a real review refuses the merge and the lane ends
  `stuck: merge_failed`. Ship does not say which rule refused it.
- **What it costs.** There is no price for `gpt-6-astra`, and the token counts are made up.
- **What a big ticket does.** One small file, one task, one mutant, one round.
