# 86b. The plan stage, with user stories

Part 1 of [experiment 86](./86-plan-stage.md) ran the plan stage on 6 closed
demlik tickets. It found two losses: the plans lost the realistic end-to-end
fixture, and the Check banned the names a user types. This rerun fixes both
and adds user stories. Same 6 tickets, same method, same model settings.

**Answer: stories help a little, and the whole-job criterion brings the
fixture back. All 6 plans named who the ticket is for (15 stories, 1 to 4 a
plan), and every plan's first criterion carried a realistic fixture. Most
stories named users whose criteria part 1 already had. But they brought back
3 criteria that today's triage had and part 1 missed, and added 1 nobody had.
"Names code" send-backs fell from 21 to 8. Two new costs showed up. A forced
fixture turned a comment-only chore (490) into "work out the number by hand
for 3 features", at 3.5 times the cost. And a false "two claims" catch left
504 stuck after 3 drafts, where part 1 passed. $4.26 for the planners, 46 to
146 seconds a plan. Confidence 65%.**

The plans, as views, are in [`86-plans/`](./86-plans/). They now start with
the stories and show which stories each criterion serves.

## What changed and why

- **User stories come first in the plan.**
  - An ordered list. Each is "As a ‹who›, I want ‹what›, so that ‹why›", with
    a stable id (`s1`, `s2`, …).
  - They should cover every kind of user the ticket touches.
  - Why: part 1's criteria were outcomes, but outcomes for whom was never
    said. A missing user meant a missing criterion, and nothing could see it.
- **Every criterion names the stories it serves.**
  - `serves` is a non-empty list in the type, so a criterion with no story
    cannot be written.
  - The Check refuses a story no criterion serves, and a criterion that
    serves an id no story has.
  - Why: this is the link that makes a missing criterion visible.
- **The first criterion is the user's whole job.**
  - It has its own type (`job`), with a `fixture`: the realistic end-to-end
    case. It is free of the one-claim rule.
  - The Check refuses an empty fixture, and a job that reads like the
    smallest case (no "three or more", no "again", no "a whole repo").
  - Why: part 1 lost the fixture that the PRs for 504 and 565 built. The
    repo's own rule says the first criterion is the user's job with a
    realistic fixture.
- **The names rule is narrowed.**
  - Names a user meets now pass: CLI flags, config keys, glob patterns,
    published package names and export subpaths, and any code token the
    published docs (README, `docs/`) use.
  - The list is read from the code at the plan's commit, not written by hand
    (`wip/src/stages/plan/names.ts`). The planner is shown only the ones its
    ticket uses; the Check knows all of them.
  - Internal file paths and function names are still sent to `pointers`.
  - Why: 21 of part 1's 34 send-backs were "names code", and most were names
    a user types.
- **Open questions are unchanged.** They still ask the owner, with a lean,
  and they still block.

Two fixes came out of the runs:

- The first live run died before its first turn. Effect writes a non-empty
  list's JSON Schema with `prefixItems`, and the CLI's strict schema check
  refuses it. `jsonSchema` now writes it as `minItems` (`wip/src/schema.ts`).
- On 490's run the Check read "2/6" as a file path. A token with no letter
  (a fraction, a date) is no longer a path. 490 ran before this fix; the
  other five ran after it.

Each change has tests that fail on main's code and pass here.

## How it was done

The same as part 1. Each ticket was planned at its PR's base commit, from
the report as filed. The planner never read the fix PR. Planner: `opus`,
effort medium, Read, Grep and Glob only, up to 3 drafts. The same blind
Sonnet judge labelled every criterion outcome, recipe or mixed; the job was
shown to it with its fixture. Script: `86b-plan-stories.ts`. Results:
`results/86b-plans.json` and `results/86b-judge.json`.

Nothing was written to GitHub. No lane ran.

## The numbers

| # | ended (part 1 / 86b) | drafts | stories, and who | criteria (today / 1 / 86b) | outcome (1 / 86b) | job has a fixture | questions (1 / 86b) | cost (1 / 86b) | time (1 / 86b) |
|---|---|---|---|---|---|---|---|---|---|
| 367 | ask / ask | 2 | 2: a CI contributor, a library user with a pinned clock | 5 / 3 / 4 | 3/3 / 3/4 | yes, 3 repeat runs | 1 / 1 | $0.55 / $0.56 | 63 s / 66 s |
| 579 | ask / ask | 2 | 2: a doc reader, a docs maintainer | 6 / 5 / 4 | 4/5 / 2/4 | yes, the page's 3 steps run | 1 / 1 | $0.89 / $0.59 | 78 s / 57 s |
| 393 | ask / ask | 2 | 3: an owner rolling out one feature at a time, a CI maintainer, an output reader | 10 / 8 / 9 | 8/8 / 9/9 | yes, report, record, pass, then fail | 2 / 3 | $0.57 / $0.66 | 71 s / 81 s |
| 504 | ask / **stuck** | 3 | 4: a CLI user, an existing-config user, a mixed-rules writer, a doc reader | 8 / 13 / 10 | 13/13 / 10/10 | yes, ~12 files at depths 1 to 5 | 2 / 2 | $0.95 / $1.01 | 105 s / 146 s |
| 490 | done / done | 3 | 1: a source reader | 4 / 3 / 2 | 1/3 / 1/2 | yes, 3+ features by hand | 0 / 0 | $0.13 / $0.47 | 28 s / 46 s |
| 565 | ask / ask | 3 | 3: a consumer-repo maintainer, an existing-config user, a README reader | 6 / 11 / 11 | 11/11 / 11/11 | yes, 10 handlers and `--ci` | 1 / 1 | $0.80 / $0.99 | 68 s / 108 s |

- **Check problems sent back, by kind:** two claims in one line 12, names
  code 8, job fixture too small 1. Part 1: names code 21 of 34.
- **No story went unserved, and no criterion served a missing id**, in any
  draft. The planner got the links right the first time.
- **Judge, outcome share:** ours 90% (36 of 40: 3 mixed, 1 recipe), part 1
  93%. Today's same 39 criteria came out 59% this time, 49% in part 1. That
  10-point swing on unchanged text is the judge's noise; read both of ours as
  "about the same".
- **Cost:** $4.26 for the six planners, $0.10 for the judge. Part 1: $4.39.

## What stories exposed

Most stories named a user whose criteria part 1 already had. On 504 and 565
part 1 already said "an old rules file works as before"; on 579 it already
had the test that keeps the page in step. The story makes that user visible,
but it did not find those criteria. What it did find:

- **393, the output reader and the CI maintainer.** Two criteria part 1
  missed and today's triage had: the human report tags the new rule `B4`, and
  the release note says existing ceilings may need re-recording. It also
  added the `--json` form and a third question: what the new kind is called.
  That is a real call, since the name is published.
- **565, the person setting it up.** The bad-declaration cases (an empty
  driven list, a driven file in the wrong place) came back. Today's triage
  had them; part 1 had only the empty `decidedBy` one.
- **367, the library user with the default clock.** A new criterion nobody
  had: with the normal epoch clock, span times are as before. 367's other
  story, the contributor whose unrelated PR went red, turned part 1's "the
  suite passes" into "passes several times in a row", which is the flake.
- **579 still asks for more than the PR did.** Part 1 asked for 3 of 5
  things the PR did not do. Now the job folds them into one: copy, typecheck
  and run the three steps. The PR only typechecked the page, so the "run" half
  and the "imported as values" criterion are still beyond it.
- **The job is close to what shipped on 504 and 565.**
  - 504: role-named files at depths 1 to 5, upward imports at file and line,
    a census against a hand count. Today's first criterion had the same, plus
    a "fail, allow, then pass" step the job lacks.
  - 565: ten handlers, a write site still B8, `--ci` passing. The PR's own
    end-to-end test also pruned an entry once the write was gone; the job
    has no prune step.
  - 393: report, record the ceiling, pass, add one edge, fail. The PR tested
    that exact sequence.

## What went wrong

- **The fixture is a sledgehammer on a chore.** 490 is a reworded comment.
  The forced realistic fixture made its job "a reviewer works out cohesion
  by hand for three or more features and gets the reported number". That is
  a test of the reader, not of the change, and the plan cost $0.47 against
  $0.13. A ticket with no user-visible run needs a way to say so.
- **A false "two claims" left 504 stuck.** "the paragraph says that a tie is
  refused, and how" was read as two results. Three drafts went to it and the
  plan ended `stuck:unchecked`, where part 1 ended with questions. The ", and"
  check is now the most common send-back (12) and it cost an outcome.
- **Example paths in a fixture still count as code.** On 504 a glob's example
  match (`p/q/r/s/b-x.ts`) was sent back as an internal path. The planner
  dropped the examples, which made the criterion vaguer.
- **Package names pass by shape alone.** 367's story says `@kamp-us/tea`; the
  package was `@demlik/tea` at that commit. Anything shaped like a scoped
  package passes, and story text is not checked for names at all.
- **The names list is big.** 3,500 to 7,700 names a ticket, about 2,000 that
  look like code, mostly from tea's docs. It did keep out the internal names
  that mattered (the matcher and schema functions on 504).
- **Questions still block 5 of 6 tickets,** as asked. 504's two questions
  were the same calls as part 1 with different leans, so the lean is not
  stable across runs.

## What this cannot tell us

- **Whether a builder does better from these plans.** No build ran. Stories
  and a job read better; that is not the same as a better PR.
- **Whether the stories are the right users.** One reader judged them
  against the PRs and replay notes. No owner said "yes, those are my users".
- **Noise.** One run a ticket. 504's leans changed between runs, and the
  judge moved 10 points on unchanged text, so a one-ticket difference here
  means little.
- **Six tickets, one repo, all code-graph or tea.** A ticket with a UI, or a
  repo with no published docs, would give the names list nothing to read.
- **Whether the job should be optional.** 490 says a chore needs a way out;
  this run does not say what that way out should look like.
