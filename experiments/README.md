# Experiment log

What we tried, what came back, and what we took from it. Newest last. Every
number here came from a real run against Jev and, where it says so, Claude Code.
The samples are small and the two toys are tiny, so read these as hints, not
proof.

Guesses that turned out wrong are left in on purpose. One mistake cuts across
several experiments: read [section 16](./16-agents-had-a-shell.md) before
trusting any line that says an agent could not see a file.

## How this folder is laid out

- `NN-title.md` is the write-up of experiment NN. The numbers run in the order
  the experiments were done, 01 first.
- `NN-name.ts` (or `.mjs`) is a script, numbered by the first experiment that
  used it. So `10-bad-tests.ts` sorts next to `10-bad-tests.md`. A number with
  no script has none of its own: it ran from `src/`, reran an earlier script,
  or read earlier results.
- `lib/` holds the helpers the scripts share. They have no number.
- `results/` holds the answers the scripts saved, and `failures/` the failing
  runs experiment 34 reads.
- [open-questions.md](./open-questions.md) is the list of open questions the
  log kept up to experiment 20.

## The setup

Two toys under `fixtures/`: `slugify` (three rules) and `duration`
(`parseDuration`, six rules). `lib/toys.ts` holds, for each toy, one correct
implementation and several broken on purpose, each breaking one criterion. That
is what gives a case a known answer: run the real tests and see.

Jev is a small classifier. It answers a multiple-choice question about some
JSON and returns a confidence between 0 and 1. The lane acts on an answer only
when the confidence is at or above a floor.

## The experiments

The date is the day the write-up was first committed. Entries 39, 40, 41, 44,
45 and 46 say of themselves that they are not experiments: a change, a run, a
redesign, a data set. They keep their numbers because later write-ups point at
them by number.

| # | Title | Script(s) | Date | Result |
|---|---|---|---|---|
| 01 | [Is Jev's low confidence just noise?](./01-low-confidence-noise.md) | `01-criterion-clarity.mjs` | 2026-10-04 | No. Low confidence followed bad input every time we looked: a contradicting criterion, one about what stayed the same, a thin ticket. |
| 02 | [Tell the enricher how the judge reads](./02-enricher-told-how-the-judge-reads.md) | none | 2026-10-04 | slugify went from 0 of 3 runs finishing to 5 of 5. |
| 03 | [Show the judge the passing tests](./03-judge-sees-passing-tests.md) | `03-judge-rubber-stamp.mjs` | 2026-10-04 | `duration-open` went from 0 of 5 runs finishing to 8 of 10. An undone, untested criterion still came back "not met" at 0.99. |
| 04 | [How often is the judge right at each confidence?](./04-judge-calibration.md) | `04-judge-calibration.ts` | 2026-10-04 | At 0.8 and up, right 218 of 221. With a passing test for the criterion, 117 of 117. |
| 05 | [Can Jev stand in for running the test?](./05-jev-instead-of-running-the-test.md) | none | 2026-10-04 | With a concrete example Jev never confidently passed broken code, but it confidently caught the bug less than half the time (8 of 18). |
| 06 | [Can Jev tell whether a test checks a criterion?](./06-test-check-calibration.md) | `06-test-check-calibration.ts` | 2026-10-04 | At 0.9 and up, right 200 of 200. All 4 confident misses sat at 0.80 to 0.81. |
| 07 | [Can an agent write the tests first?](./07-test-writer.md) | `07-test-writer.ts` | 2026-10-04 | 27 of 27 criteria got a good test. At a 0.9 floor the judge let 17 through and was unsure on 10, all of them good. |
| 08 | [Does an example in the criterion fix the caution?](./08-example-in-the-criterion.md) | `08-fit-probe.ts` | 2026-10-04 | No. 3 of 9 slugify tests passed the judge before and after. Confidence reached 0.90 to 0.92 only with one claim, an example, and a test that asserts that example. |
| 09 | [The three rules, given to the writer](./09-three-rules-for-the-writer.md) | `07-test-writer.ts` | 2026-10-04 | All 48 criteria got a good test, and none passed on the starting code. Judge confidence bunched at 0.86 to 0.89, just under the 0.9 floor. |
| 10 | [Bad tests written to fool the judge](./10-bad-tests.md) | `10-bad-tests.ts` | 2026-10-04 | 0 of 168 bad tests accepted at floors 0.80, 0.85 and 0.90. The highest "checks" on a bad test was 0.79. |
| 11 | [Do hidden tests catch code that only learned the examples?](./11-hidden-tests.md) | `11-hidden-tests.ts` | 2026-10-04 | 33 of 36 cheats passed every visible test. Hidden tests caught 24 of the 33, and 0 of 90 hidden tests failed on the correct code. |
| 12 | [The enricher's own criteria](./12-enricher-criteria.md) | `12-enricher-criteria.ts`, `12-title-probe.ts` | 2026-10-04 | All 43 tests were sound and caught 27 of 33 broken versions. The enricher dropped two real rules, and a bug-shaped ticket title lowered the judge's confidence. |
| 13 | [Both fixes, and a third problem they uncovered](./13-two-fixes-and-a-third-problem.md) | `13-refit-bad-tests.ts` | 2026-10-04 | The `null` rules came back and the tests caught 33 of 33 broken versions. With the reworded question the judge let through 39 of 63 sound tests and still accepted 0 of 168 bad ones. |
| 14 | [Is there more in the answer than one confidence number?](./14-decision-rule.md) | `14-decision-rule.ts` | 2026-10-04 | No. "Cannot tell" gets a share of about 0, so the answer is one number. Bad tests accepted at 0.85: 0 of 273, the closest at 0.83. |
| 15 | [Reading Jev's own guide](./15-reading-jevs-guide.md) | none | 2026-10-04 | By the guide's measure we were using Jev the hard way: one broad question per call, where it says to ask many narrow ones. |
| 16 | [Correction: the agents had a shell](./16-agents-had-a-shell.md) | none | 2026-10-04 | `--allowedTools` only pre-approves, so agents read deleted tests out of git. Rerun with the shell gone: the test-writer and the hidden tests held up, and triage from the ticket alone wrote half as many criteria. |
| 17 | [One broad question, or several narrow ones](./17-atomic-questions.md) | `17-atomic-questions.ts` | 2026-10-04 | Three narrow questions at 0.9 accepted 87 of 88 good tests and 4 of 93 bad ones. The broad question at 0.85 accepted 53 of 88 and 0 of 93. |
| 18 | [Does this example show what the sentence claims?](./18-example-fits-claim.md) | `18-example-fits-claim.ts` | 2026-10-04 | Jev can tell an example touches its rule (idle inputs accepted 0 of 121). It cannot tell the result is right: `parseDuration("1.5h") -> 4500` scored 0.89. |
| 19 | [Criteria as data: a rule, a call and its result](./19-data-criteria.md) | `19-data-criteria.ts` | 2026-10-04 | On the toys every rule fit and 0 of 54 results were wrong. On seven real demlik issues 36 of 130 criteria carried an example. |
| 20 | [Does anything catch a wrong example?](./20-example-clash.md) | `20-example-clash.ts` | 2026-10-04 | With clear rules a throwaway reference caught 20 of 20 wrong examples with no false alarm. With loose rules it caught 19 of 20 with one false alarm. |
| 21 | [Does triage make mistakes of its own?](./21-natural-mistakes.md) | `21-natural-mistakes.ts` | 2026-10-04 | Triage got all 175 examples right on two harder toys, so there were no natural mistakes to catch. |
| 22 | [Does Jev flag triage's own idle examples?](./22-idle-examples.md) | `22-idle-examples.ts` | 2026-10-04 | Triage wrote no idle example in 131. Jev's flags were all false alarms. |
| 23 | [Kill a real build, start it again](./23-kill-and-restart.md) | none | 2026-10-04 | The second run resumed the same Claude conversation and sent the build again. The restart works with real agents. |
| 24 | [The test-first lane, end to end](./24-test-first-lane.md) | none | 2026-10-04 | slugify: 6 rules, the builder answered `done` on its first try, and the 6 tests plus the toy's own 3 passed. duration parked at triage on both runs. |
| 25 | [Duration through a person's answer](./25-duration-through-an-answer.md) | none | 2026-10-04 | A person's sort carried the duration ticket on. The builder then passed the hidden tests by reading expected values off the failure report. |
| 26 | [What may the builder hear from a hidden test?](./26-hidden-feedback.md) | `26-hidden-feedback.ts` | 2026-10-04 | All three ways (full output, names only, a new ticket example) passed 5 of 5 and scored 20 of 20 held-out, so the toy cannot tell them apart. |
| 27 | [Jev as the review's router](./27-review-router.md) | `27-route-probe.ts` | 2026-10-04 | 30 of 36 answers right, 6 unsure, 0 wrong. |
| 28 | [Review as its own machine, with a real reviewer](./28-review-machine.md) | none | 2026-10-04 | On real output: no made-up quotes, and a dispute caught a finding that would have broken a test. A fresh reviewer raised decided findings again in new words. |
| 29 | [Review remembers what a person decided](./29-review-memory.md) | `29-match-probe.ts` | 2026-10-04 | The matcher was right 28 of 36 times, missed 8 repeats (safe: routed as new) and made 0 wrong matches. No decided point came back in two real rounds. |
| 30 | [Freeze the list of findings at the last round](./30-freeze-findings.md) | none | 2026-10-04 | Two real duration runs. One was done in 2 attempts. The other ended at the frozen round 3 with both late findings filed, one of them a real bug that did not block. |
| 31 | [The owner's comments](./31-owner-comments.md) | `31-comment-probe.ts` | 2026-10-04 | 27 of 48 answers right and 21 unsure. 0 said "changes nothing" about a comment that changes something. |
| 32 | [A fresh copy of the change](./32-fresh-copy.md) | none | 2026-10-04 | A fix that leans on a git-ignored file passes in the builder's folder and fails on a fresh copy. Shown on a real checkout in `local.test.ts`. |
| 33 | [Ship](./33-ship.md) | none | 2026-10-05 | The demo ran slugify from the ticket to `main`, stopping once for the approval. A moved base merges, passes on a fresh copy, and lands without a second approval. |
| 34 | [Jev on real code: scout, docs, failures, shell](./34-jev-on-real-code.md) | `34-scout-probe.ts`, `34-docs-probe.ts`, `34-failure-probe.ts`, `34-guard-probe.ts` | 2026-10-05 | Scout: 29 of 29 changed files in the top 10. Docs: no claim the doc does not make passed. Failures: 42 of 42 right. Shell guard: nothing that should be blocked ran. |
| 35 | [The lane reads a failed run before sending it back](./35-failure-reader.md) | none | 2026-10-05 | On the 14 saved failures every builder mistake went back (6 of 6), 5 of 8 setup and test-file failures parked, and 3 came back unsure. |
| 36 | [Jev finds the file a change forgot](./36-missing-file.md) | `36-missing-probe.ts` | 2026-10-05 | Over a whole package the hidden file ranked first in 22 of 28 trials, with no flag on the 9 complete changes. That run cost about $20. |
| 37 | [Jev spots a duplicate at filing](./37-duplicate-at-filing.md) | `37-dup-probe.ts` | 2026-10-05 | The original ranked 1st in 26 of 30 pairs and in the top 5 in all 30. A 0.7 floor flagged 19 of 30 pairs and 2 of 105 controls. |
| 38 | [A free filter before the missing-file check](./38-name-filter.md) | `38-name-filter.ts` | 2026-10-09 | paths + uses kept all 28 forgotten files and all 22 Jev wins at about a twelfth of the list: $0.065 a review at the median, against $0.82. |
| 39 | [Jev stops deciding who picks an issue up](./39-open-decision-replaces-audience.md) | none | 2026-10-10 | A change. The audience question is gone. The enricher answers a typed `open_decision` and code routes on it. |
| 40 | [The first real ticket, run 2: what went wrong after triage](./40-first-real-ticket-run-2.md) | none | 2026-10-10 | A run. The builder weakened a stable API (dropped `NoInfer`) to make a generated test compile. The run was dropped. |
| 41 | [Enrichment in small steps: facts, a draft, vetting](./41-enrichment-in-small-steps.md) | `41-vet-probe.ts`, `41-facts-probe.ts` | 2026-10-10 | A redesign. Vetting would have sent run 2's draft back at once: 6 of its 7 examples do not typecheck on today's code and the 7th holds already. |
| 42 | [Facts read the doc pages a report names](./42-facts-read-doc-pages.md) | `41-facts-probe.ts` | 2026-10-10 | On #558 both doc pages get their twin tests. The brief went from 3117 to 5087 characters and the gathering from 5.4 s to 8.1 s. |
| 43 | [Claude through the Agent SDK: can a tea machine judge a running agent?](./43-agent-sdk-stream.md) | `43-sdk-stream-spike.ts` | 2026-10-10 | The stream is enough to judge and stop a run (2 ms after the call it judged), not to prevent a step. Prevention belongs in the PreToolUse hook. |
| 44 | [The build loop on the draft-and-check child, and a published-API check](./44-build-loop-and-api-check.md) | `44-api-probe.ts` | 2026-10-10 | A redesign. On run 2's diff the published-API check flagged 3 changes, allowed and listed 1, and missed the `ctx: undefined` widening. |
| 45 | [Two more checks: type snippets and existing tests](./45-type-snippets-and-existing-tests.md) | `45-type-guard-probe.ts`, `41-vet-probe.ts` | 2026-10-10 | A redesign. A type guard caught the widening experiment 44 missed. Run 5 of #558 had 8 of 9 criteria checked, against 0 of 7 in run 4. |
| 46 | [A replay set: an answer key from closed tickets](./46-replay-set.md) | none | 2026-10-10 | A data set: 23 closed kamp-us/demlik issues, each fixed by one merged PR, kept in `replay/`. |
| 47 | [Scoring triage on the replay set: the first 5](./47-scoring-triage.md) | none | 2026-10-10 | On 5 replay issues: type right 1 of 5, priority 1 of 5, vetting passed 4 of 5. Claude cost $3.58 in all. |
| 48 | [The operator, built from six moves and no agent](./48-operator-from-six-moves.md) | none | 2026-10-10 | Against a fake, the operator machine drove a scripted lane from `queued` to merged and spent no tokens of its own. Nothing here touched a real lane. |
| 49 | [The operator machine drives one real lane](./49-operator-first-live-run.md) | `49-shell-dry-run.ts` | 2026-10-10 | kamp-us/demlik#559 went from claim to merged in 18.8 minutes. 22 Cmds, no tokens of the machine's own, $1.74 for its three shells. |
| 50 | [The second live run: a failed review, a repair, and three shells that left early](./50-operator-second-live-run.md) | none | 2026-10-10 | kamp-us/demlik#625 failed review, was repaired, and merged in 40.2 minutes for $7.68. Three builders in a row were recorded dead when each had done its work. |
| 51 | [Does Jev pick what Opus picked?](./51-jev-vs-opus.md) | `51-jev-vs-opus.ts` | 2026-10-10 | On 66 real next-step choices, Jev at 0.8 and up gave Opus's answer on the same small text 38 of 38 times, and 20 of 28 under it. It matched what the operator agent did 35 of 57 times, where Opus on the small text matched 41. $0.000023 an answer against $0.0052. |
| 52 | [A lane parked on purpose, and the machine asks a person](./52-park-on-purpose.md) | `52-park-read.ts` | 2026-10-10 | kamp-us/demlik#623 parked for an owner's approval. The machine asked on the issue, heard nothing for 10 minutes, and ended parked with nothing held. A second run's recipe saw the approval and shipped it: 45 minutes, $3.51. The person's reply was never read; offline, Jev took it as `resume` at 1.00. |
| 53 | [882 real lanes, read back from their logs](./53-lane-logs.md) | `53-lane-logs.ts` | 2026-10-11 | Replayed under the operator machine, 831 of 840 single-issue lanes on kamp-us/phoenix reached the end their log shows, and none hit a state with no route. Where a park names its cause the machine would ask a person 96 times in 128, and today's driver had cleared 49 of those itself. 78% of 961 shipper runs end "merged" or "queued". The first review passes 57% of the time. |
| 54 | [Why reviews fail: 707 failed reviews, read on their pull requests](./54-why-reviews-fail.md) | `54-why-reviews-fail.ts` | 2026-10-11 | 714 of 774 `FAIL` lines matched a failing verdict on kamp-us/phoenix. Two failed reviews in three needed a reader, mostly for a doc or skill page that no longer matched the code. About one in ten was only a red check, and a check was red on GitHub's record at one failed commit in four. About one in ten went against a rule already written down. Jev at 0.8 and up agreed with the hand labels 91% of the time and reached 0.8 on 56% of items, for $0.15. |
| 55 | [The ship machine's seven outcomes, set beside 961 recorded shipper runs](./55-ship-outcomes-on-recorded-runs.md) | `55-ship-outcomes-on-recorded-runs.ts` | 2026-10-11 | 540 of 961 shipper runs on kamp-us/phoenix end in a way that is one outcome kind. Of the 421 that do not, 325 are "queued", where the machine waits instead of ending. 63 parked with no cause on the line, 30 parked on a branch behind main, which no outcome fits, and 3 were merged by hand. The logs test the list of outcomes. They cannot test the gate's order. |
| 56 | [The first live runs of the ship machine](./56-first-live-run-of-the-ship-machine.md) | none | 2026-10-11 | kamp-us/demlik#561, a docs-only ticket, merged in 19.3 minutes for $1.73 with the ship machine in the ship stage and no shipper agent: one read, the gate's go, one enqueue, a Listen on the queue, $0. Fabrika took the `LANDED` line the driver wrote. A second lane, kamp-us/demlik#622, a code change of 11 files, merged the same way in 28.3 minutes for $3.95. Run twice, on one docs-only and one code pull request, both on the straight path. The second was picked in the hope of a failed review, and its review passed the first time. Each run's own row gave the ship stage 0 minutes, and each log printed nothing while the stage ran, 5.7 and 7.7 minutes. |
| 57 | [The repeat findings, read by hand: was it really there before?](./57-repeat-findings-read-by-hand.md) | `57-repeat-findings-read-by-hand.ts` | 2026-10-11 | Experiment 54's 58% does not hold. Of 60 of its 181 "there before, not raised" findings, drawn at random and read against the code at both commits, 32 were really missed, 18 were new since the earlier review, 3 had been raised before and 7 were not problems. That makes "already there and missed" about 31% of placed later-round findings (24% to 38%). Half of the 181 have no quote in any file. 20 of the 32 missed were in a place an earlier review says it read, and 16 were the same kind of fault as an earlier finding, in a new place. Jev's first choice matched the reading in 33 of 60, for $0.0023. |
| 58 | [A review list that can only shrink, replayed over 525 recorded loops](./58-shrinking-list-replay.md) | `58-shrinking-list-replay.ts` | 2026-10-11 | The rule "the first review writes the list, later rounds only answer for it, stop when it is not shorter", walked over 525 review loops on kamp-us/phoenix. The lists do shrink: of 682 steps from a failed round, 488 pass and 88 get shorter. The rule would lock out 89 of 459 later-round findings by their quotes, about a quarter with the hand samples, and all 30 read from the ones the record acted on were real defects. It passes 21 to 61 of 152 loops early, about $53 to $224 saved, and stops 33 to 60 for a person against the cap's 33; in two stops of three the record passed on the next round, because a list of one gets one repair try. Code alone can check about 15% of findings again. A check on the quoted line gives no signal and Jev, for $0.02, did worse than always saying "fixed", because verdicts quote proof and not the faulty line. So: works with an extra way in and a looser stop, about 70% sure. |

## Running them

Each script needs `TYPESAFE_API_KEY`. `07-test-writer.ts` also needs the `claude`
CLI. Results land in `results/`; a rerun overwrites them, so earlier numbers
are in the git history.

```
node experiments/04-judge-calibration.ts
node experiments/06-test-check-calibration.ts
node experiments/08-fit-probe.ts
node experiments/07-test-writer.ts
node experiments/10-bad-tests.ts
node experiments/11-hidden-tests.ts
node experiments/12-enricher-criteria.ts
node experiments/12-title-probe.ts
node experiments/13-refit-bad-tests.ts
node experiments/14-decision-rule.ts
node experiments/17-atomic-questions.ts
node experiments/18-example-fits-claim.ts
node experiments/19-data-criteria.ts         # SPEC=ticket|rules, SET=demlik
node experiments/20-example-clash.ts         # BUILD=loose
node experiments/21-natural-mistakes.ts
node experiments/22-idle-examples.ts
node experiments/31-comment-probe.ts
node experiments/34-scout-probe.ts           # SCOPE=package, PRS=10239,10169
node experiments/34-docs-probe.ts
node experiments/34-failure-probe.ts
node experiments/34-guard-probe.ts
node experiments/36-missing-probe.ts         # SCOPE=package, CONTROL=1
node experiments/37-dup-probe.ts             # PAIRS=30, CONTROLS=10, BUSY=0, TITLES=1, DRY=1
node experiments/38-name-filter.ts           # no Jev, no key: git and gh only
node experiments/44-api-probe.ts             # REPO=, STATE=, NEW=listed: no Jev, no key: git, pnpm, tsc
node experiments/41-facts-probe.ts           # REPO=, TICKET=: no Jev, no key: git and code-graph only
node experiments/41-vet-probe.ts             # REPO=, STATE= or ISSUE=: no Jev, no key: git, pnpm, tsc, vitest
node experiments/45-type-guard-probe.ts      # REPO=, ISSUE=, DIFF=: no Jev, no key: git, pnpm, tsc, vitest
node experiments/43-sdk-stream-spike.ts      # MODE=observe|feedback|hook|stop|startup: no Jev; Claude via the Agent SDK
node experiments/51-jev-vs-opus.ts           # SIDE=jev|opus|both|none, ONLY=<case ids>, REPEATS=3: Jev, and Opus through the claude CLI; SIDE=none reprints the tables with no key
node src/replay-run.ts                       # N=<replay issue>: triage only, on a scratch clone; SCORE=1 rescores kept runs offline
node experiments/49-shell-dry-run.ts         # MODE=agent|preload|hook|runner, REPO=, PLUGIN=, TREES=: no Jev; one haiku turn in a working copy it makes and removes
node src/operate.ts                          # LANE=, REPO=, PLUGIN=, TREES=, RUN=, WHO=<login>,<login>, ASK_WAIT_MIN=, SHIP=agent|machine: drives a REAL lane to merged. Read experiment 49 first, and 56 before SHIP=machine
node experiments/52-park-read.ts             # ISSUE=<issue url>, WHO=: how the machine's Judge would read the replies to its question; one Jev call a reply, no writes
node experiments/53-lane-logs.ts             # LANES=<a repo's .fabrika folder>, ONLY=<section>: no Jev, no key, no network: reads lane logs, replays them under the operator machine
node experiments/54-why-reviews-fail.ts      # LANES=, CACHE=<a folder>, STEP=fetch|compare|sample|jev: with no STEP it prints the tables from the cache and the saved labels, no key, no network; fetch and compare read GitHub through gh, read-only; jev needs the key
node experiments/55-ship-outcomes-on-recorded-runs.ts  # LANES=<a repo's .fabrika folder>: no Jev, no key, no network: maps each recorded shipper ending onto a ship outcome
node experiments/57-repeat-findings-read-by-hand.ts  # CACHE=<experiment 54's cache, after a run with ORIGINS=1>, CLONE=<a local clone>, STEP=cases|jev: with no STEP it prints the tables from the readings and the saved answers, no key, no network; cases reads git, read-only; jev needs the key
node experiments/58-shrinking-list-replay.ts  # LANES=, CACHE=<experiment 54's cache>, STEP=fetch|trees|read|fixed, CLONE=<a local clone>, DETAIL=<pull request number>: with no STEP it prints the tables from the cache, the readings and the saved answers, no key, no network; fetch reads GitHub through gh and trees reads git, both read-only; fixed needs the key
```
