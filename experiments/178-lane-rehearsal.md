# 178. A lane on a throwaway repo, with real models

**On 9af7b272, with no patch, both tickets ran from ticket to merge in about 5 minutes each, and the person's decision reached every step that writes or judges. But review agreed with the decision this time, so the new "review disagrees" path did not run on real models.**

On f76aa336, the slugify ticket had got stuck at build in round 2, because review rejected code that did what the person had approved. The rule-change ticket merged.

All of this is today's version (`packages/pipeline`, `programs/pipeline`). In this write-up, `results/` means `results/178-lane-rehearsal/`.

```text
9af7b272, no patch
run 5, slugify again      triage -> plan -> yes -> tests -> build -> mutants
                          -> yes -> review -> push -> yes -> merge -> done    4m29s
run 6, a rule change      triage -> plan -> yes -> exam -> yes -> exam merge
                          -> tests -> build -> mutants -> yes -> review
                          -> push -> yes -> merge -> done                     5m08s
927cf7ba
run 1, code as written    triage -> plan -> stuck:unchecked                   1m23s
run 2, PATCHED            triage -> plan -> yes -> tests -> build -> mutants
                          -> review -> push -> yes -> merge -> done           8m23s
f76aa336, no patch
run 3, slugify again      triage -> plan -> yes -> tests -> build -> mutation
                          -> review: no -> tests -> build -> stuck:no_change  5m33s
run 4, a rule change      triage -> plan -> yes -> exam -> yes -> exam merge
                          -> tests -> build -> mutants -> yes -> review
                          -> push -> yes -> merge -> done                     6m56s
```

## After runs 5 and 6: a fresh review and a failed CI run

The runs in this write-up came before these changes. Nothing ran the whole lane on real models again. Each change has its own tests, on stand-in agents.

**A fresh review found one real blocker.** Two questions in a row could share one id, so a person's yes to the first was taken for a second question that was never written on the ticket. A question's number now comes from the lane's trail, which grows with every question. A lane saved while asking keeps the id it holds.

The same review led to these:

- **An unseen review no longer offers `go_on`.** That pick opened a pull request, and the person's merge then ended `stuck:reviews_unknown`. Now it offers `again` and `stop`.
- **A later round with no change reads the head's checks first.** Red offers `again` and `stop`. Green offers `go_on` and `stop`. If the checks can't run, the lane ends stuck with words. It never guesses green. The earlier test passed only because its stand-in's new test did not stay red.
- **What a person lets through is said.** The decision question quotes the finding beside the decision, the merge question counts what was let through, and the pull request lists it. This fixes "No deviations" under "Still not fixed" below.
- **Agent words can't ping or close anything.** `inert` now breaks `@name` mentions too. The plan's Check refuses a rule path with a backtick in it, and a rule path stays inside its code span.
- **`onceEach` has a test that can fail.** Unwiring it now turns 4 tests red. Before, unwiring it left `kept.test.ts` green.

**Building those found one more bug.** When a mutant had an answer but no test, its commit became the head. The builder's files then joined the exam, and later rounds ended `exam_touched`. A test now pins it.

**CI failed because a prompt was too long to start Codex.** CI's log said only `lane ended with build run lane/1/5/build unfinished`, and it never printed `E2BIG`. A builder got the same message on a Mac with a longer text and traced it there to `E2BIG`. The prompt went to Codex as one argument. A build's brief holds its long text twice, about 170 KB, and Linux allows 128 KB per argument. A Mac allows more, so no local run hit it at that size. The link to CI is a strong inference, and it stands or falls with this pull request's next CI run.

```ts
// packages/fabrika/src/agents/codex/adapter.ts, as it is now
// The last argument is `-`, and the prompt arrives on stdin.
stdin: {stream: Stream.make(new TextEncoder().encode(sent))}
```

I ran real Codex 0.165.0 this way on a Mac: a fresh turn, a resume, and a resume with a 200 KB prompt. All three worked. The appended system prompt still goes by argument, and past 128 KB it fails in words.

**What this cannot tell us:** none of these paths has run on real models from ticket to merge. A real person has still not read these questions. Whether stdin works on Linux rests on this pull request's CI run.

## Runs 5 and 6, on 9af7b272

Both ran from a clean archive of the commit, each with a fresh `FABRIKA_HOME` and bare remote. Codex and Claude were real. A local host stood in for GitHub, the ledger was in memory, and there was no app or window. The agent running the rehearsal played the person, read each question and answered by file. The `gh` stand-in was never called.

### Run 5: the decision held, and the marked path did not run

The person approved the plan and took its lean on `q1`: "Fold ordinary accents; remaining letters such as ß, æ and ł separate words." That is the `Straße` to `stra-e` choice.

The decision reached each step. The briefs in the logs hold it, in `results/run5-9af7b272-slugify/prompts-decided.txt`:

| Step | What its brief said about the decision |
|---|---|
| Test writer | `q1` in full, then "These bind your tests. A test never goes against a decision." |
| Builder | `q1` in full, under "Owner's calls, not yours" |
| Test writer on mutants | `q1` in full, then "A test never goes against a decision." |
| Review | `q1` in full, under "What a person decided" |

**Review did not disagree.** Its row for `c1` says "Folding follows q1. No blocking issue found." It met 2 of 2 with no findings. So this run did not exercise `source: "decision"`, the question "The review says a decision you made on the plan is wrong. Does your decision stand?", or the `no_change` question. Nothing here shows those work on real models. Only the stand-in test covers them, and the answer was not rewritten to force it.

One clean run does not show the fix stopped the problem. Before the fix, review passed a near-identical lean once and failed one once.

On a fresh clone of merged main: 6 tests pass, `tsc` is clean, and dropping `toLowerCase` fails 3 tests. The code does what was decided: `Straße` gives `stra-e`, `Łódź` gives `odz`. The lean's edges also show: `Işık` gives `is-k`, and `oﬃce` gives `o-ce`. Run 3's review called that last one a fault, and this review did not raise it. The lean's "remaining letters separate words" can be read to cover it, so I don't count this as a miss. A person who wanted `Işık` to give `isik` would not learn of it from the question, which names ß, æ and ł.

### Run 6: the rule-change words now work

The plan view has its own section, and says two pull requests:

```text
## Rule changes

These land first, in a pull request of their own, on your yes. With the one for the tasks, this plan makes two pull requests.

- `src/slug.laws.test.ts`: In T1's separate PR, change 40 to 80 in the law comment and length assertion. Preserve the trailing-hyphen assertion. Why: The current law rejects the longer slugs explicitly requested by the ticket.
```

That matched what happened: `exam/1`, then `lane/1`. The rule pull request's body now holds the same change and why. Review met 4 of 4 with no findings. On a fresh clone of merged main: 13 tests pass, `tsc` is clean, and cutting at 79 fails 5 tests.

The plan needed 2 tries again, as in run 4, for the same reason: two tasks and no `goal`. It lists the rule change as task T1, which makes the plan two tasks, and that adds about 82,000 input tokens. The Check's line is now right, so this costs tokens and no longer misleads. Doubt: telling the planner a rule change is not a task may save the try, or may cost something else. A run with that line would settle it. Sure it's worth trying: 70%.

### Every question, word for word

The test: could someone who has not seen the code decide from these words, with the comments just before them?

| Run | Question | Picks | Test |
|---|---|---|---|
| 5, 6 | Do you approve plan version 1? | `approve`, `no` | Pass. The plan is just above, with leans and rule changes |
| 6 | Do you want to merge these rule changes: src/slug.laws.test.ts? | `merge`, `no` | Pass. Failed on f76aa336. The comment now gives the change and why |
| 5, 6 | A mutant lived, and the test writer says no test can see the change. | `again`, `go_on`, `stop` | Narrow pass, as before |
| 5 | The review met 2 of 2, and the repository's checks passed at its head. Do you want to merge "Add slugify: turn a title into a URL slug"? | `merge`, `no` | Pass. Failed on f76aa336 |
| 6 | The review met 4 of 4, and the repository's checks passed at its head. Do you want to merge "Let slugs run to 80 characters"? | `merge`, `no` | Pass. Failed on f76aa336 |

The comment before each question reads like this, here for the rule change:

```text
These rule changes are in a pull request of their own:
- `src/slug.laws.test.ts`: In T1's separate PR, change 40 to 80 in the law comment and length assertion. Preserve the trailing-hyphen assertion. Why: The current law rejects the longer slugs explicitly requested by the ticket.
What each answer does:
- `merge`: The change lands on main.
- `no`: The lane ends here, and this change does not land.
```

The mutant question's weak spot is unchanged: `src/slug.ts:4:12:329f80` means nothing to a reader, and "mutant" has no gloss. The reason under it does say the slugs come out identical.

### Still not fixed

None of these block.

- The final pull request's body does not mention the mutant the person let through. It says "No deviations."
- The plan view keeps its capitals mid-sentence: "As A blog author", "When The completed pull request".
- The commit title is still `tests for https://github.com/toy/slug-lab/issues/1`, and the tile still says `opus, 7463 tokens, price unknown` on a run the SDK billed.

### Earlier guesses, checked

- **"With an open question, the person can take the lean or end the lane" (f76aa336).** No longer the whole story. Since 9af7b272, what a person writes beside an answer is carried to later steps. This run wrote nothing beside its answers, so it did not test that. "What each answer does" also does not say a note is possible.
- **"Review can't run Vitest in its copy" (f76aa336).** Not tested again: neither review tried. Both relied on the green checks and short `node` checks.
- **"Fix: a `decided` slot, sure 85%."** Consistent with run 5, not proven by it.
- No guess in this section's scope turned out wrong. Any that later do stay here, marked wrong.

### What passed

- **Schemas.** All 12 `--output-schema` files were accepted. `enum` now appears, up to 30 uses per run, along with `anyOf` and `minItems`. `pattern`, `minimum` and `maximum` remain untested.
- **Events.** The same kinds across 12 turns: no top-level `error`, no `turn.failed`. The only stderr was the stdin line.
- **`misfits`** 0 on every step. **`unseen`** 0 of 6 review rows.
- **Mutants really run.** 12 of 12 with 11 killed, and 15 of 15 with 14 killed, 0 compile errors. The survivor both times is the no-effect `\p{M}+` mutant.

### What runs 5 and 6 cost and left

| Run | Who | Input | Of it cached | Output | Dollars |
|---|---|---|---|---|---|
| 5 | Codex | 343,755 | 254,592 | 6,991 | unknown, flat plan |
| 5 | Claude | 7,334 | 0 | 129 | $0.0615 as billed |
| 6 | Codex | 468,264 | 345,728 | 10,432 | unknown, flat plan |
| 6 | Claude | 7,281 | 4,995 | 152 | $0.0226 as billed |

Wall time was 4m29s and 5m08s, with 46 and 43 seconds of hand answers. 353 and 467 child processes. `gpt-6-astra` still has no price. **A guess and not a price:** at `gpt-6.1-sol`'s list price the two runs' Codex total would be about $0.66.

Left after each clean end: `FABRIKA_HOME` 452K and 512K (clone, sessions, settings, state, `pulls.json`), with no working copies. 0 Codex homes. No branch beyond main on either remote. No lane process. 2 new transcript folders in Claude's project folder, one per home, which the lane does not remove and this run did not edit.

### What runs 5 and 6 cannot tell us

- **The review-disagrees path on real models.** It did not run. Neither did the `no_change` question. Only a stand-in test covers them.
- **How often review now disagrees.** One clean run, on a toy ticket. More runs would give a rate.
- **Whether later steps obey a person's note.** None was written.
- **`no`, `stop` and `again`.** Nobody picked them. A stop after a merged rule change is still unseen.
- **A real person.** The test above is my reading, with the code in my head.
- **Real GitHub, the real store, the app, a large ticket.** None ran.

## Runs 3 and 4, on f76aa336

Both ran from a clean archive of the commit, each with its own temp home and bare remote. Codex and Claude were real. A local host stood in for GitHub, and the `gh` stand-in was never called. This time the agent running the rehearsal played the person at every ask, and read each question before answering.

### Run 3: review undid what the person approved

The ticket and the first round went better than before. Then:

1. The plan's open question q1 asked how far folding should go. Its lean: fold accents that decompose, and treat what is left as separators, so `Straße` gives `stra-e`. The person approved it.
2. Test writer and builder did that. Their tests pin `ł`, `ø`, `ß` as separators, and mutation killed 10 of 10.
3. Review failed it with one finding: "Letters with plain ASCII forms survive folding", citing `Łódź` giving `odz`. It said the tests "explicitly require losing common letters such as ł and ø".
4. Round 2's test writer turned that finding into a test that wants `Straße` to give `strasse`. Its `gaps` said this conflicts with p5 and p6, and that went nowhere.
5. The builder could not pass both, changed nothing, and said why. The lane ended `stuck:no_change`.

Part of the finding was fair. The builder used NFD, so `oﬃce` gave `o-ce`, and the plan's lean did not settle that. But `Łódź` and `Straße` are exactly what the lean decided.

**Why it happened.** Nothing after the plan is told what the person decided.

- `programs/pipeline/briefs/review.md`, `test-writer.md` and `build.md` hold no slot for the plan's questions or leans.
- `stages/pipeline/program.ts:536` gives review the ticket's words, so the ticket's loose "when they can" beats the approved lean.
- `stages/pipeline/program.ts:246` makes a finding into a Property with no test against what was approved.
- Review's own `gaps` shows the same hole: "The brief does not enumerate the four expected title/slug pairs."

Run 2 passed review on nearly the same plan and lean. So this one depends on what the reviewer happens to weigh. It is 1 of 2 runs, not a rate.

**Fix.** Add a `decided` slot to review and round 2's test writer, filled from `questionLines` (already imported in `program.ts`). Add one line to `review.md`: a lean the person approved is not a fault; disagreeing goes in `gaps`. Why: the person's yes then binds later steps. Cost: a slot, a brief line and a test. Sure: 85%. Also make `stuck:no_change` with a non-empty `left` a question to the person, since "two tests contradict" is that person's call. Sure: 70%. The doubt: it may hide real builder failures. A run where a builder gives up for a weak reason would settle it.

What the person read at the end was clear about the cause, with one code word:

```text
What it could not do:
- Blocked by contradictory protected tests: src/slug.test.ts requires Straße → stra-e [...]
  The exam owner must reconcile these expectations before implementation can satisfy every check.
build is stuck. the builder changed nothing, and no pull request is open from the branch
```

### Run 4: the exam path works

The lane takes the exam route when the plan's `exam` list is not empty (`stages/exam/machine.ts:232`, `checkChange`). No repo file is needed. So the toy got a `src/slug.laws.test.ts` holding slugs to 40 (it matches `**/*.laws.test.ts`), and the ticket asked for 80. The planner listed the law without being told it was special.

The exam agent changed just the two law lines, on `exam/1`, as its own pull request. The person's merge landed it on main first. Tests were red for the right reason, the build changed `MAX` to 80, and Stryker killed 14 of 15. The survivor was the same no-effect `\p{M}+` mutant as run 2. Review met 5 of 5 with no findings. On a fresh clone of merged main: 14 tests pass, `tsc` clean, and my two hand mutants (cut at 79, keep the end hyphen) each failed 4 tests.

Three things misled along the way:

- **The Check and the brief disagree on pull requests.** `plan/check.ts:280` says "All the tasks land in one pull request". `plan.md:72` says the exam goes "in a pull request of its own". After the Check's line on its try 2, the planner wrote "the latest instruction requires one pull request, superseding" the brief. So the plan the person approved says "in one pull request", and two landed. Fix: the Check's line says "all the tasks", except rule changes. Sure: 85%.
- **The plan's view never shows `exam`.** `plan/render.ts` does not mention it. Here the person learned of the rule change only because the planner also made it a task and a pointer. Fix: a "Rule changes" section with path, change and why. Sure: 90%.
- **Review can't run Vitest in its copy.** It stopped with `Failed to create Vitest API token`, since Vitest 5 writes a file under the session's Codex home. Review said so in `skipped`, ran `node` checks and relied on the green checks. Not blocking. Sure it should be fixed: 60%. The doubt: it may not matter while code runs the tests.

### What the person read

These are as a person sees them, with the "What each answer does" comment that comes just before each. The test: could someone who has not seen the code decide from these words alone?

| Run | Question and picks | Test |
|---|---|---|
| 3 | "Do you approve plan version 1?" `approve`, `no` | Pass. The plan above it gives q1's lean, cost and how sure, in words |
| 4 | "Do you approve plan version 1?" `approve`, `no` | Pass, but it says one pull request and shows no `exam` section |
| 4 | "Merge the rule changes: src/slug.laws.test.ts" `merge`, `no` | **Fail** |
| 4 | "A mutant lived, and the test writer says no test can see the change." `again`, `go_on`, `stop` | Narrow pass. The comment says the slugs come out identical. "Mutant" has no gloss, and `src/slug.ts:9:12:329f80` means nothing to a reader |
| 4 | "Do you want to merge local:toy/slug-lab/pull/2?" `merge`, `no` | **Fail** |

The picks' lines read well on all of them:

```text
What each answer does:
- `approve`: The plan stands as written, and a yes takes the lean on each open question. The lane goes on with it.
- `no`: The lane ends here, and this change does not land.
```

**The two fails.**

- *Merge the rule changes* (`machine.ts:357`). It names a file. It does not say what changes or why, although the plan's `exam` holds both. The pull request says only "The rule changes the plan for ticket 1 lists" (`tools.ts:285-286`). Fix: write each `path: change (why)` as a comment before the question, and in that pull request's body. Sure: 90%.
- *Do you want to merge ...* (`machine.ts:358`). It gives an id. Nothing on the ticket's comments says what the change is or how review went. The review's "5 of 5" is only a `reviewed` fact. The pull request's body helps, but it does not mention the mutant the person let through. Fix: put the title and the review's count in the question. Sure: 80%.

One more gap, on a pass: with an open question, the person can take the lean or end the lane. A person who wanted `ß` to give `ss` has only `no`, which says the change does not land. Doubt: there may be a note path in the app that this headless run could not see. Sure it's a gap: 65%.

The plan view also keeps its capitals mid-sentence ("As A blog author, I want A URL slug", "When The completed pull request"). That is small, but every person reads it.

### The fixes from run 1, checked against what happened

| Fix | What really happened |
|---|---|
| The `from` mistake, corrected in words | Not tested. The brief's new line stopped the mistake: all 3 tries wrote `"from": null`, where before 2 of 2 first tries wrote a bad one. The Check's new line never fired on a real answer |
| Test writer has the ticket's words and a job for each property | Works. No `curl`, no `cannot_test` in either run. All tests stood on their own |
| Odd `import.meta.glob` to dodge a missing import | Gone. Run 3's test file has a plain `import {slugify} from "./slug.ts"` |
| Questions read as sentences | 3 of 5 pass. The code words are gone, but see the two fails |
| A person's `go_on` on an untested property is recorded | Not tested. No `cannot_test` arose. The mutant `go_on` is in the ask's comment but not in the pull request |
| Nothing left behind on a clean end | Works, see below |

### What is left behind

| | Run 2 (927cf7ba) | Run 3 (stuck) | Run 4 (clean end) |
|---|---|---|---|
| `FABRIKA_HOME` | 404M | 68M: the working copy, kept for a person to read | 512K: the clone, sessions, settings, state |
| Codex homes | 6, 27M | 0 | 0 |
| Remote branches beyond main | `lane/1` | none | none: `exam/1` and `lane/1` both gone |
| Claude's transcripts folder | 1 | 1 | 1 |
| Lane processes | 0 | 0 | 0 |

The lane does not remove the transcripts folder, one per home, named after the temp `work/empty` folder. The rehearsal removed its temp folders. The two transcript folders stay, as a rule of this run was not to edit there.

### What passed that we were unsure of

- **Schemas.** All 13 `--output-schema` files were accepted. They still hold only `anyOf` and `minItems`. `pattern`, `minimum` and `maximum` remain untested.
- **Events.** The same kinds as before, across 13 turns: no top-level `error`, no `turn.failed`. The only stderr was the stdin line.
- **`misfits`** 0 on every step. **`unseen`** 0 of 7 review rows.
- **Mutants really run.** 10 of 10 and 15 of 15, 0 compile errors.
- **A second review round runs**, and so does a review finding reaching the test writer. Run 3 shows that the path works and that what it carries can be wrong.

Still noise: `tests for https://github.com/toy/slug-lab/issues/1` as a commit title (`tools.ts:174`), and `opus, 7469 tokens, price unknown` on a run the SDK billed. Still unread: Codex's `cache_write_input_tokens` and `reasoning_output_tokens`.

### What runs 3 and 4 cost

| Run | Who | Input | Of it cached | Output | Dollars |
|---|---|---|---|---|---|
| 3 | Codex | 415,923 | 303,104 | 9,584 | unknown, flat plan |
| 3 | Claude | 7,333 | 0 | 136 | $0.0614 as billed |
| 4 | Codex | 550,621 | 419,584 | 11,760 | unknown, flat plan |
| 4 | Claude | 7,280 | 4,995 | 172 | $0.0230 as billed |

Claude's input counts its cache writes and reads. `gpt-6-astra` still has no price. **A guess and not a price:** at `gpt-6.1-sol`'s list price the two runs' Codex total would be about $0.77. No cap was near. Wall time was 5m33s and 6m56s, with about 18 and 67 seconds of hand answers. 306 and 467 child processes.

### What runs 3 and 4 cannot tell us

- **How often review overrides a lean.** It happened once in two near-identical plans. More runs would give a rate.
- **Whether the `from` Check's words work.** The mistake did not come back to test them.
- **`no` and `again`.** Nobody took them, so a stop after a merged rule change is unseen. The law stays changed on main while the code does not follow. Here that would be harmless. It may not be elsewhere.
- **A person.** The test above is my reading of the words, with the code in my head. A real person who has not seen the code could judge differently.
- **A repo's own rule list.** The route ran on the default list. A failing law, or a rule change that breaks main, did not come up.
- **Everything run 1's section below lists:** real GitHub, the real store, the app, a large ticket, one run each.

---

# Runs 1 and 2, found on 927cf7ba

Everything below is as it was written then. Later commits changed some of it, as the section above says.

```text
run 1, code as written    triage -> plan -> stuck:unchecked                   1m23s
run 2, PATCHED            triage -> plan -> yes -> tests -> build -> mutants
                          -> review -> push -> yes -> merge -> done           8m23s
```

Everything from run 2 on is the patched code. Nothing in run 2 tells us how the unpatched lane would have gone after the plan step.

## What was real and what was not

| Part | What ran |
|---|---|
| The machine: stages, Checks, boxes, Stryker, the local code host | This repo's real code, driven by `laneLayer` and `runLane` with no app and no window |
| Triage | Real Claude (`claude-opus-5-5`, medium effort), on the flat plan |
| Plan, test writer, builder, mutants, review | Real Codex (`gpt-6-astra`, high effort), on the flat plan, one `codex exec --json` turn each |
| The person | Faked. A script said `approve` and `merge` without reading. The agent running this rehearsal answered the two asks nobody planned for |
| GitHub | Faked. A local host and a bare git repo in a temp folder. A stand-in `gh` was first on the PATH and was never called |
| The ledger | In memory, not the real store |
| The ticket | Faked: a small `slugify` ticket on a toy project, seeded by hand |

No part of today's fabrika ran behind this. No API key was set. A passive tee on `child_process.spawn` recorded each agent's stream without changing it. The driver is in `results/lane-driver.ts`.

## Run 1: stuck at the plan, for a reason nobody can read

The ticket got `stuck:unchecked` and no words at all.

The real answer was decoded again with the real code. The draft decodes. Then `revisionOfDraft` turns it into `null`:

```text
Expected a string matching the RegExp ^[\w.-]+\/[\w.-]+#[1-9][0-9]*$
at ["stories"][0]["from"]
```

The agent had written `"from": "The ticket"`. Removing that one field makes the plan pass.

Four things line up to cause it:

- `plan/plan.ts:76`: the draft's `from` is any string or null, so that is what Codex's schema allows.
- `plan/plan.ts:84`: the kept plan's `from` must be a ticket id.
- `plan/check.ts:205`: `storyProblems` does not test `from`, so the agent is never told. It used one of its three tries.
- `pipeline/program.ts:291`: the null ends the run with no problems, so `program.ts:766` has nothing to write on the ticket.

The brief `plan.md` never mentions a story's `from`. Run 2's first try also wrote a bad `from`, so this happened on 2 of 2 first tries. It looks like the normal case, not bad luck.

**Fix.** The Check sends it back. This is the patch used in run 2, and it was enough:

```ts
// packages/pipeline/src/stages/plan/check.ts, in storyProblems
if (typeof story.from === "string" && !/^[\w.-]+\/[\w.-]+#[1-9][0-9]*$/.test(story.from))
	problems.push(`${at}: its \`from\` must be a ticket id like owner/repo#12, or null.`);
```

Why: the agent can correct itself, and run 2 shows it does, on `resume`, with the schema still accepted. Cost: two lines, plus a test. It also repeats the id's pattern, so better still is to share one name with `TicketId`. Sure: 95%. Also give line 291 words, so any later gap between the Check and `revisionOfDraft` still says why. Sure: 90%.

## Run 2 (PATCHED): step by step

Times are UTC. `misfits` was 0 on every step of both runs.

| Time | Step | Outcome | Input (cached) | Output | Min |
|---|---|---|---|---|---|
| 15:17:26 | triage, Claude | `send:plan:yes` | 7,331 (7,329) | 130 | 0.06 |
| 15:17:30 | plan, 2 tries | `ask:owner:questions` | 142,080 (105,216) | 6,628 | 1.97 |
| 15:19:28 | person: approve plan v1 | script | | | |
| 15:19:29 | exam | `skip:no_rules_change` | 0 | 0 | 0 |
| 15:19:29 | test writer | `ask:owner:cannot_test` | 149,315 (123,136) | 4,794 | 3.75 |
| 15:23:14 | person: `go_on` | agent, by hand, 50s | | | |
| 15:24:04 | build | `done` | 88,086 (68,736) | 1,085 | 0.48 |
| 15:24:33 | mutation, Stryker | `send:test_writer:mutant_survived` | 0 | 0 | 0.07 |
| 15:24:37 | mutants | `ask:owner:disable` | 45,145 (14,464) | 266 | 0.26 |
| 15:24:53 | person: `go_on` | agent, by hand, 14s | | | |
| 15:25:08 | review | `done`, 2 of 2 met, 0 findings | 71,953 (52,096) | 1,174 | 0.64 |
| 15:25:46 | push | `done` | 0 | 0 | 0 |
| 15:25:46 | person: merge | script | | | |
| 15:25:47 | merge | `done`, on the bare remote | 0 | 0 | 0.01 |

The script was not enough to finish. Two of the five person-shaped stops were not in its list, so a lane on a small ticket asked a real question twice.

## What passed that we were unsure of

- **Codex's schemas.** All 7 `--output-schema` files were accepted, on fresh turns and on `resume`. Limit: the keywords in them were only `anyOf` (up to 9 in one file) and `minItems` (5 in the plan's). `pattern`, `minimum` and `maximum` did not appear, so their acceptance is still untested.
- **Codex's events.** Seen in all 7 turns: `thread.started`, `turn.started`, `turn.completed`, and `item.started` and `item.completed` for `command_execution` and `file_change`, plus `item.completed` for `agent_message`. **No top-level `error`, no `turn.failed`.** The only stderr was "Reading additional input from stdin...".
- **`unseen`.** 0 of 2 review rows. Both were `pass`. Review's `skipped` said it relied on the green checks and had no git.
- **The test writer's read-only copy.** It worked. The agent wrote 5 tests whole, code ran them, and all 5 were red on base for real, then green after the build.
- **Mutants really run.** Stryker found 12, ran 12, killed 11, 0 compile errors, about 2.5 seconds, then `tsc` on the survivor. The survivor at `src/slug.ts:18:12` turns `\p{M}+` into `\p{M}` with an empty replacement. That changes nothing, and the agent argued so correctly.
- **The box.** It refused one thing: `curl https://api.github.com/repos/toy/slug-lab/issues/1`, from the test writer (`Could not resolve host`). `git` fails in read-only copies by design, and plan and review both noticed and went on.
- **The code.** It is real work. `src/slug.ts` is 21 lines with a clear comment on what folding covers, and `src/slug.test.ts` is 107 lines of fast-check with fixed seeds. On a fresh clone of merged main: 6 tests pass, `tsc` is clean. Four mutants made by hand (drop `toLowerCase`, use NFC, drop the `+`, trim only the front) were each killed. Both files are in `results/run2-patched/`.

## What misled, or got in the way

None of these stopped the lane. Each one makes the person's job harder or worse.

1. **The test writer works blind.** `program.ts:358-370` gives it no ticket text and no task job, and its `ticket` slot (`program.ts:359`) is a GitHub URL it cannot fetch. The plan's p1 said "the three publication titles are converted", with the titles only in `tasks[0].job.result`. The agent tried `curl`, asked mid-turn "What are the three exact publication titles for p1?", and nobody could answer, so it said `cannot`. Fix: pass the ticket's title and body and each task's job into the slots. Why: 3.75 minutes and one ask came from this alone. Cost: small. Sure: 90%.
2. **The person's question has no reason in it.** They see `test_writer asks: ask:owner:cannot_test` (`machine.ts:314`) with the picks `again`, `go_on`, `stop`. The `found` rows go nowhere, since `program.ts:766` writes only on stuck. The hand answers in this run needed the raw logs. A person in the app would have only those code words. Fix: write the found rows as a comment on `ask` too. Sure: 90%.
3. **`go_on` leaves a hole with no record.** After the pick, p1 has no test of its own. Nothing says so beyond the pick. The builder then said "all six tests", and review listed "Tests p2-p5" and did not say p1 had none. Doubt: it may not need a new fact if the found rows are on the ticket (item 2). A case where this hides a real gap would settle it. Sure: 65%.
4. **The brief and the code disagree on a red test.** `test-writer.md:58` says a missing import is not a valid red. `test-writer/results.ts:34` counts it as one. So the agent wrote `import.meta.glob` with `/// <reference types="vite/client" />` to dodge the import, and that odd line now lives in the test file. Fix: one line in the brief. Sure: 85%.
5. **The plan's open question folds into approve.** Its q1 asked how far folding should go, and its lean named the cost (`Straße` gives `stra-e`). The person's yes takes the lean without showing it. That is by design (`machine.ts`), but here is what it costs: `Işık` gives `is-k` and `Kapı Çay` gives `kap-cay`. The question named ß, æ and ø, not ı, and a Turkish blog would care. The ticket's "when they can" is loose, so this is not a clear bug, and review passed it. A real person might have caught it. This run cannot say.
6. **Noise.** The commit title is `tests for https://github.com/toy/slug-lab/issues/1` (`tools.ts:174`), on a local host. The tile says `price unknown` for a Claude run the SDK did bill. The exam tile says `exam: skip  gpt-6-astra, 0 tokens, price unknown` for a step that spent nothing.
7. **Usage fields not read.** Codex's `turn.completed` also has `cache_write_input_tokens` and `reasoning_output_tokens`. The adapter drops both. Reasoning was 793, 793, 2,062, 20, 36 and 223 in run 2, and 527 in run 1.

## What it cost

| Who | Input | Of it cached | Output | Dollars |
|---|---|---|---|---|
| Codex, both runs | 573,181 | 423,680 | 16,210 | unknown, flat plan |
| Claude, both runs | 14,662 | 7,329 | 254 | $0.0652, as the SDK billed |

The adapter's price list holds only `gpt-6.1-sol`, so `gpt-6-astra` has no price, and its `billed: 0` is not a price. **This is a guess and not a price:** at sol's list price the Codex total would be about $0.50. No cap was near. Claude's `listUsd` is null.

Wall time: 1m23s and 8m23s, the second with about 64 seconds of hand answers. Run 2 spawned 331 child processes.

## What the lane leaves behind

After a clean end, no lane process was left. These stayed:

- The remote branch `lane/1`, merged and not deleted.
- 404M in `FABRIKA_HOME`: copies 202M, judges 134M, trees 67M with a worktree still on `lane/1`.
- 6 Codex homes under `~/.cache/tea-fabrika/codex`, 27M, one per session. The lane never removes them.
- Triage's transcripts in Claude's own project folder, since the run keeps its session. It is named after the temp `work/empty` folder.

A lane is meant to leave nothing behind, so the Codex homes and the local copies are a finding for a long-running daily use. This rehearsal removed its own temp folder and Codex homes by hand afterward. The transcripts folder stays, as a rule of this run was not to edit there.

## Setup slips, not the lane's

- Volta's default outside a pinned folder is Node 22, and `npm` failed with `Cannot read properties of null (reading 'edgesOut')`. Pinning Node 26.12.0 in the toy's `package.json` fixed it, before any lane ran. A real target repo with no pin could hit this.
- A log file named as Claude's stream was a boxed vitest run, misnamed by the tee. It is left out of the results.

## What it cannot tell us

- **One small ticket, one patched run.** A ticket with a machine, a rules change or a real codebase may go very differently. Treat "good code" as one sample.
- **GitHub.** No real pull request, no real merge rules, no real CI, no `gh` call. The local host is not proof of the GitHub host.
- **A person.** The script never read the plan, and the hand answers came from an agent that had the raw logs. We do not know what a person would do with those asks.
- **Paths not taken.** No `again` pick, no second review round, no exam, no real no, no review finding, no `unseen`. 0 `unseen` of 2 rows says almost nothing about the rate.
- **Schemas with `pattern`, `minimum` or `maximum`.** Not seen, so not proven accepted.
- **Dollars for Codex.** No list price for `gpt-6-astra`.
- **The real store, the app and its window.** Neither ran. Memory and speed of a long lane in the real ledger are untouched here.

## Results

- `results/run1-unpatched/`, `results/run2-patched/`: each Codex agent's raw stream and schema, lines, timeline, asks and spawns, scrubbed of paths and names. Long arguments are cut. Triage's Claude stream is not published in any run: it opens with the machine's own setup, and scrubbing left too much of it. Its answer is in `lines.jsonl` and its usage in the tables above.
- `results/run2-patched/slug.ts`, `slug.test.ts`, `remote-main.log`: what was merged.
- `results/check.patch`, `results/lane-driver.ts`: the patch and the driver.

For runs 3 and 4:

- `results/run3-f76aa336-slugify/`: the same logs, the ticket, and the stuck working copy's `slug-round1.ts`, `slug.test.ts` and `slug.folding.test.ts`, the two tests that contradict.
- `results/run4-f76aa336-rule-change/`: the same logs, the ticket, the merged `slug.ts`, `slug.boundary.test.ts` and `slug.laws.test.ts`, `remote-main.log` and `pulls.json`.
- `results/lane-driver-2.ts`, `lane-seed.sh`, `lane-seed-rule-change.sh`, `lane-run.sh`, `lane-watch.sh`: the driver and setup for these runs.

For runs 5 and 6, with the same driver and setup:

- `results/run5-9af7b272-slugify/`, `results/run6-9af7b272-rule-change/`: the same logs, the ticket, the merged `slug.ts` and `slug.test.ts`, `remote-main.log`, `pulls.json`, and `prompts-decided.txt`, the part of each agent's brief that holds the decision.
