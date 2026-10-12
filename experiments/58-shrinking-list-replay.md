# 58. A review list that can only shrink, replayed over 525 recorded loops

The review stage is the next one to be rebuilt as a state machine.
[A review list can only shrink](../docs/direction/a-review-list-can-only-shrink.md)
proposes its loop: the first review writes the whole list, a later round may
only answer for that list and for lines the repair wrote, and the loop ends
when a lap leaves the list no shorter. This experiment replays that rule over
the review loops today's fabrika recorded on
[kamp-us/phoenix](https://github.com/kamp-us/phoenix). No reviewer ran.

**Answer: the lists do shrink, and the rule as written would still do harm.
It works with an extra way in for late findings and a looser stop. I am about
70% sure.**

```text
the rule
  round 1     the reviewer reads everything and writes the whole list
  round 2+    it may answer for that list, and for lines the repair wrote
  go on       while the list gets shorter
  stop        a lap that leaves it the same goes to a person

the record    525 loops with two or more review rounds
              152 of them fail again after the first round

  does the list shrink?    682 steps from a failed round to the next round:
                           488 pass, 88 shorter, 75 the same, 31 longer
  what is locked out?      89 of 459 later-round findings by their quotes (19%)
                           about a quarter once the hand samples are counted in
  were those real?         30 of 30 read, of the ones the record acted on
  what the rule does       passes early in 21 to 61 of the 152 loops
                           saves 24 to 101 rounds, about $53 to $224
                           stops for a person in 33 to 60 (today's cap: 33)
  after such a stop        the record passed on the very next round in two of three
  can code check again?    about 15% of findings by code alone
```

- **A. The rule changes 99 to 117 of the 525 loops.** It ends 21 to 61 early
  with a PASS and sends 33 to 60 to a person. The two numbers in each pair
  are the two ways to count a finding no quote can place.
- **B. What it locks out is real.** All 30 I read from the fixed sample were
  defects a user or a maintainer would care about (89% to 100%). In the
  record, 41 of the 89 were changed before the merge and no pull request
  died.
- **The first review could have seen nearly all of them.** Of 44 real ones,
  16 were the same fault as a listed finding in another place, and 21 were
  plain misses. Only 3 were new since the first review.
- **The stop is tighter than today's cap.** The usual list has one finding. A
  list of one cannot get shorter without passing, so "not shorter" means one
  repair try. In two stops of three the record passed on the next round.
- **C. Code alone can check about 15% of findings again** (8% to 26%, a hand
  sample). Red checks are 8% of findings and GitHub's record agrees with the
  reviewer on 88% of them. A check on the quoted line gives no signal, and a
  small classifier did worse than always saying "fixed".
- **D. The first review has to say which line is at fault.** Today's verdicts
  quote proof far more often than the faulty line. Every check in C that
  failed, failed on that.

Jev answered 456 calls for about $0.02. Everything else is counting, git and
reading.

## Who did what

| Part | Whose |
|---|---|
| Every lane, review, verdict comment and repair | today's fabrika, on [kamp-us/phoenix](https://github.com/kamp-us/phoenix) |
| The rule | tea-fabrika, a proposal in `docs/direction/`, not built |
| Reading rounds and labels from the cache (`lib/review-rounds.ts`) | tea-fabrika, experiment 54's code moved to a file two scripts can share |
| The replay, the placing by quotes, the three checks (`58-shrinking-list-replay.ts`) | tea-fabrika, new here |
| 179 hand readings, 164 of them in five fixed samples (`58-readings.json`) | a reader, for this experiment |
| "Does this change fix it?" on 451 findings | Jev |
| The dollars for a round | tea-fabrika's own operator, run on another repo (`field/runs.jsonl`) |

No lane ran. Nothing was written to GitHub. Git was read-only, on a local
clone.

## How it was done

**The loops.** Experiment 54 matched every `FAIL` line in the lane logs to
the verdicts posted for it. I grouped those rounds by task. 1,110 tasks have
a review round and 525 have two or more: 376 single lanes and 149 epic
children. 152 fail again after the first round, in 218 failed rounds. 55
`FAIL` lines no reviewer wrote are left out. 488 of the 525 ended in a merged
pull request.

**The findings.** Experiment 54's splitter cuts a failing verdict into
findings. The 218 later failed rounds hold 459. I dropped 13 items that only
say an earlier finding is fixed.

**Placing a finding.** The rule needs to know where a later finding stands.
The record has no ids, so I used what the finding quotes, in this order.

1. Labelled a red check: allowed. It is code's business, not a reading.
2. An earlier round's verdict holds the same quote: raised before, allowed.
3. The quote is in lines added since the round before, or in a file it was
   not in one round ago: written by the repair, allowed.
4. The quote is in the files one round ago and no earlier verdict holds it:
   older text nobody raised, **locked out**.
5. The quote is in no file, or the finding quotes nothing: not placed.

Step 4 asks git, not the diff. Experiment 57 found that asking for the quote
in a file first is what makes this placing hold. The lookup ran 26,264 times
over 1,150 commits in the clone. One commit was not there.

**Two readings.** 178 findings cannot be placed. Every count below is given
twice: once with them counted as allowed, once as locked out. A hand sample
says most of them belong on the allowed side, so the truth sits nearer the
first number.

**Dollars.** The lane logs on phoenix hold no cost. This repo's operator ran
a few lanes on another repo and wrote each agent's cost down. The mean there
is $0.85 for a reviewer run (6 runs) and $1.36 for a builder run (9 runs). A
round is one repair and one review, so $2.22. It is a stand-in, from few
runs, on another repo.

**Intervals** are Wilson's, at 95%. Every sample is drawn with the fixed seed
58.

## A. What the rule would have done

### A1. Where a later round's findings stand

| Where the finding stands | Under the rule | Findings | Share |
|---|---|---|---|
| Raised before | allowed | 96 | 20.9% |
| A red check | allowed | 38 | 8.3% |
| Written by the repair | allowed | 58 | 12.6% |
| Older text nobody raised | locked out | 89 | 19.4% |
| Quotes no file line | not placed | 81 | 17.6% |
| Nothing quoted | not placed | 97 | 21.1% |

Of the 281 placed, 68.3% are allowed and 31.7% are locked out. Experiment 57
read experiment 54's group by hand and got 31% (24% to 38%). Two methods, the
same third.

I read two more samples to see what the quotes miss.

- **30 of the 178 not placed.** 12 are about what the repair wrote or did,
  6 were raised in an earlier round, 2 are older text nobody raised (7%, 2%
  to 21%), 4 are not findings, and 6 I could not tell.
- **20 of the 96 "raised before".** Only 4 are the same finding, still open
  (20%, 8% to 42%). 6 are a new finding about what the repair wrote. 4 are a
  new finding about older text (20%). 3 are not findings and 3 I could not
  tell. A shared quote is weak proof of a repeat: reviewers quote the same
  rule or the same line for different points.

Put together, the locked-out share of all later findings is **about a
quarter**: 85 by quotes, plus about 19 hiding in "raised before", plus about
12 in the unplaced, of 459. That sum is an estimate from two small samples.
A fifth to a third is the honest range.

A builder that did not fix the finding it was sent is rarer than it looks.
By the two samples it is about one later finding in eight.

### A2. The rule on each loop

The 152 loops with a failed round after the first, walked round by round.

| The loop | Not placed counts as allowed | Not placed counts as locked out |
|---|---|---|
| Runs as recorded | 53 (34.9%) | 35 (23.0%) |
| Passes early: nothing allowed is left | 21 (13.8%) | 61 (40.1%) |
| Stops: the list is not shorter | 60 (39.5%) | 33 (21.7%) |
| Goes on with a shorter list than the record | 18 (11.8%) | 23 (15.1%) |

- **Rounds with nothing allowed left: 23 to 88 of the 218.** In 61 rounds
  (28%) at least one finding is locked out. In 80 (37%) every finding is
  allowed and the rule changes nothing.
- **Rounds saved by an early pass: 24 to 101.** At $2.22 a round that is
  about $53 to $224, against about $1,750 for all 789 later rounds. So 3% to
  13%. The early pass comes at round 2 in 18 of 21 and 52 of 61.
- **What an early pass leaves behind: 30 to 104 findings**, locked out or not
  placed, on the round the rule passes. Section B says what those were.
- **Stops come early.** Round 2 in 44 of 60 and 24 of 33. Round 3 in 15 and
  7. The most common list at a stop is one finding, then one finding: 29 of
  60 and 20 of 33.
- **After a stop, the record mostly passed.** On the very next round in 39
  of 60 and 23 of 33. It failed again in 16 and 7, and ended there in 5 and
  3.

A saving this replay cannot see: a later round that only checks a list should
cost less than a full review. All 789 later rounds would get cheaper, not
only the ones the rule ends. Nothing in the record prices that.

### A3. The stop, beside today's cap

Today's fabrika gives a ticket 2 failed reviews (235 loops) or 3 (290). The
budget ran out in 33 loops: at round 2 in 3, round 3 in 25, round 4 in 4 and
round 6 in 1. A person granted another round in 19 of the 33.

| Stop when | Loops stopped, of 152 | The record passed on the next round |
|---|---|---|
| The first lap that does not shorten the list (the rule) | 33 to 60 | 23 of 33, 39 of 60 |
| A quote from an earlier verdict comes back | 52 to 56 | 36 of 52 |
| The second lap that does not shorten the list | 2 to 12 | 0 of 2, 3 of 12 |
| Today's cap | 33 | a person granted another round in 19 |

The rule and the cap stop different loops. The cap also fired in 22 of the
rule's 60 stops and 11 of its 33.

**"No number is chosen" is not quite true.** A list of one cannot get shorter
without passing. Of 304 steps that start from one finding, 242 pass, 42 fail
with one again and 20 fail with more. So for the usual list, "not shorter"
means one repair try. That is a number, and it is lower than today's 2 or 3.

The second flat lap stops few loops, and they are the stuck ones: of its 12,
the record failed again in 6, ended there in 3 and passed next in 3.

### A4. Does the list shrink?

Yes for most loops, in one step. Not for the loops that stay.

| From a failed round, the next round's list is | Steps | Share |
|---|---|---|
| Empty: PASS | 488 | 71.6% |
| Shorter, still failing | 88 | 12.9% |
| The same length | 75 | 11.0% |
| Longer | 31 | 4.5% |

A failed round holds 2.30 findings on average at round 1, then 1.96, 2.07,
2.64 and 3.06 at round 5 and later. The medians are 2, 1, 1, 2, 2. The loops
still failing at round 4 do not have short lists.

Of the 194 steps that end in another FAIL, counting only what the rule lets
into the list: 92 are shorter (47%), 36 are not shorter (19%), 23 have
nothing allowed (12%), and 43 depend on the unplaced (22%).

## B. What the rule would have cost

The 89 locked-out findings sit in 61 failed rounds of 53 loops. That is one
loop in ten of the 525. 54 are in round 2, 27 in round 3 and 8 later.

| In the record | Findings | Share |
|---|---|---|
| The quoted text changed before the merge | 41 | 46.1% |
| The quoted text was still there at the merge | 41 | 46.1% |
| No end to read | 7 | 7.9% |
| The pull request was closed | 0 | 0.0% |

"Still there" is not "ignored". Section C shows that a quote is more often
proof than the faulty line, so the line can stand while the fault is fixed.
The next reviewer is the better witness. One round later the next round
passed for 60 of the 89, failed on something else for 20, raised the finding
again for 5, and 4 had no next round.

**Were they real?** I drew 30 of the 41 that were acted on and read each with
its verdict and the change that answered it.

- **Real defect: 30 of 30** (89% to 100%).
- Wording or style: 0. Could not tell: 0.

This sample leans toward real on purpose. It was drawn from the findings
someone changed code or text for. I also read 15 outside it, 9 changed and 6
left standing: 14 real, 1 wording. So 44 of 45 in all.

By family the 44 real ones are text in 31, code in 4 and unsure in 9. Mostly
a doc, a skill page or a comment that says what the code no longer does. The
4 in code are regressions.

**Could the first review have seen them?** For each of the 44.

- **Same fault as a listed finding, in another place: 16 (36%).** A stale
  count fixed on one page and left on the next.
- **There for the first review to see, and not a twin: 21 (48%).**
- **Old text the repair made false: 2.** The base branch moved: 1.
- **Really on lines the repair wrote: 2.** The placing was wrong and the rule
  allows them.
- Could not tell: 2.

The note says what would change the idea: a replay showing later findings are
mostly real problems the first round could not have seen. **Real: yes. Could
not have seen: no, about 3 of 44.** So the idea survives its own test. But
the test is too kind to the rule. A real defect the first review missed is
still a real defect, and the rule as written merges it.

**A first review that was no review.** In 37 of the 525 loops the first
failed review was nothing but a red check. The reviewer had not read the
change yet. 12 of those failed again later, on 17 findings that are not a
red check. The rule would treat that first round as the whole list.

## C. How far code goes

The whole set holds 1,574 findings in 703 failed reviews. I read 60 of them
and asked of each: can the next round check this one again with no reader?

| Reading | Findings | Share | 95% interval |
|---|---|---|---|
| Code alone can say open or fixed | 9 | 15.0% | 8% to 26% |
| Code can say "still open" while the line stands, then it takes a reader | 25 | 41.7% | 30% to 54% |
| A reader either way | 22 | 36.7% | 26% to 49% |
| Not a finding: a note or a cleared point | 4 | 6.7% | 3% to 16% |

The checks the 9 need, one line each.

- **A check run is red.** Ask GitHub for the check runs at the head.
- **The checks have ended and the ticket has a criteria block.** Two reads.
- **The branch merges with its base.** GitHub's merge state.
- **An issue is open or closed.** One read.
- **A named path exists.** `git ls-tree`.
- **A banned pattern is in a command.** A search over the changed files.
- **The faulty line is gone.** `git grep` at the new head. This is the "still
  open" half of the 25.

I tried three for real.

**Check 1, the quoted line. No signal.** 917 findings quote a line that is in
a file at their commit and have a next round. Where the line was still there
one round later, the reviewer raised the finding again in 22 of 431 (5.1%).
Where it had changed, in 34 of 486 (7.0%). The check and the reviewer agree
on 51.7%. On the 142 stale-text findings alone they agree on 74.6%, and
always saying "fixed" would agree on 94%.

I read 24 where the line stayed and nobody raised it again. In 13 the quote
is proof and not the faulty line: a rule, the code a doc is held against, a
check's name. In 5 it is a short string that also sits in other files. In 5
it is the faulty line and the fix was made beside it. In none was the finding
left open. So the check fails on what reviewers quote, not on the idea.

**Check 2, the red check. It works.** 129 findings are labelled a red check,
in 104 failed rounds. GitHub's record at that commit is red in 79, green in
18 and holds no runs in 7. The 18 are a guard the reviewer ran by hand, a
conflict with the base, or a re-run. 76 of the red rounds have a next round.
Where the record was green one round later, the reviewer raised no red check
in 60 of 62. Where it was still red, the reviewer said so in 5 of 12. That is
65 of 74, 88%.

**Check 3, a small classifier. Not on today's record.** For 451 findings
whose quoted line changed, Jev got the finding, the quoted line and the part
of the diff that held it, and was asked whether the change fixes it. It was
sure, at 0.8 and up, on 300 (66.5%). Where sure it sided with the next
reviewer on 245 (81.7%). Always saying "fixed" sides with the reviewer on
93%. Of the 32 findings the reviewer raised again, it said "not fixed" on 6
and "fixed" on 17.

The estimate before the full run was $0.02. I tried five while the quote
lookup was part done, looked at each answer, and dropped those when the set
grew. Then four on the full set, a look, and the other 447. **456 calls,
about 486,000 tokens, about $0.02.** The limit was $2.

**Measured and estimated.** Measured on the whole record: red checks are 8.2%
of findings and code agrees with the reviewer on 88% of them; the line check
and the classifier do not work on today's verdicts. Estimated from 60
readings: the 15% and the 42%. The 15% holds the red checks.

## D. Design input for the review machine

**What the first review must hand back.** Every failed check in C failed for
one reason: a verdict's quotes do not say which line is at fault. So the
finding needs four things today's prose does not carry.

- **`fault`**: the text at fault, word for word, apart from the proof.
- **`wants`**: one sentence on what counts as fixed. The later question is
  built from it.
- **`sweep`**: a pattern for every place the same fault could be. Code runs
  it before the builder starts.
- **`whole`**, on the review: false when it could not grade. No criteria on
  the ticket, checks still running, or nothing but a red check.

A sketch, not a design. It builds against Effect's `Schema`, and no machine
uses it.

```ts
// A sketch. The names are open.
const Place = Schema.Struct({ file: Schema.String, line: Schema.String });

// How code can ask "is it fixed?" with no reader. Absent: a reader answers.
const Recheck = Schema.Union([
  Schema.Struct({ by: Schema.Literal("check_run"), name: Schema.String }),
  Schema.Struct({ by: Schema.Literal("merges_with_base") }),
  Schema.Struct({ by: Schema.Literal("issue_state"), issue: Schema.Number, want: Schema.Literals(["open", "closed"]) }),
  Schema.Struct({ by: Schema.Literal("path_exists"), path: Schema.String }),
  Schema.Struct({ by: Schema.Literal("pattern_gone"), pattern: Schema.String, under: Schema.String }),
]);

const Finding = Schema.Struct({
  id: Schema.String,
  round: Schema.Number,                 // the round that first wrote it
  says: Schema.String,                  // prose, for the builder
  wants: Schema.String,                 // what counts as fixed
  fault: Schema.optional(Place),        // the text at fault
  proof: Schema.Array(Place),           // lines quoted to show it, never checked for change
  sweep: Schema.optional(Schema.Struct({ pattern: Schema.String, under: Schema.String })),
  recheck: Schema.optional(Recheck),
  // Why a finding written after round 1 may join the list.
  from: Schema.Literals(["first_review", "repair_lines", "made_false_by_repair", "same_fault_elsewhere", "red_check", "base_moved", "a_person"]),
  state: Schema.Literals(["open", "fixed", "withdrawn", "moved_to_a_ticket"]),
});

const FirstReview = Schema.Struct({ at: Schema.String, whole: Schema.Boolean, findings: Schema.Array(Finding) });
```

**Which later questions are narrow enough for a small classifier.**

- **"Is this finding on lines the repair wrote?"** Code, once `fault` is
  there. No classifier.
- **"Is the faulty line gone?"** Code.
- **"Does this change do what `wants` says?"** Not on today's record: 82%
  where sure, under the 93% of always saying yes. It may work once the
  finding says what it wants and which line is at fault. I am about 40% sure,
  and the doubt is that the answer often sits in a second file.
- **"Is this the same fault as finding f2, in a new place?"** Experiment 57
  found Jev says "raised before" far too often here. Split in two, "same
  kind?" and "same place?", it might hold. Untested.
- **"Is this a finding at all?"** About one cut item in eight is a note or a
  cleared point. With findings as data the question goes away.

**What I would change in the rule, and how sure.**

1. **Keep "review once, then check the list", and name the ways in.** Why: 44
   of 45 locked-out findings I read were real, and the record fixed them in
   the same pull request for about one round each. Cost: the list can grow,
   so the loop needs the stop below. Sure: 75%.
2. **Let old text in when the repair made it false, when the base moved, and
   when it is the same fault as a listed finding.** Why: 19 of the 44 real
   ones. Experiment 57 found the same three from the other side. Cost: the
   later round reads a little past the repair's lines. Sure: 80%.
3. **Run a sweep for each first-round finding before the builder starts.**
   Why: 16 of 44 were twins, and one pull request below needed three rounds
   for them. Cost: one search a finding, and false hits for the builder to
   skip. Sure it catches half the twins: 50%. The doubt is that one fault is
   worded three ways. Writing a pattern from each of the 16 first findings
   and looking for its twin would settle it for no money.
4. **A plain miss on old text goes to a person or a new ticket, and is never
   dropped without a word.** Why: 21 of the 44. Locked-out findings turn up
   in about one loop in ten, and half of them are this kind. Cost: a
   person's yes. Sure: 60%. The doubt: if the answer is yes 44 times
   in 45, asking is paperwork, and letting the finding in for one more round
   is cheaper.
5. **Stop on the second lap that does not shorten the list, not the first.**
   Why: the first flat lap stops 33 to 60 loops and the record passed on the
   next round in two of three. The second stops 2 to 12, and 9 of those 12
   never passed on the next round. Cost: one more round, about $2.22, in the
   loops that are truly stuck. And it is a number, two. Sure: 70%. The doubt
   is that the replay counts list length by quotes, with no ids.
6. **Build the red-check and merges-with-base rechecks first. Do not build
   the line check or the classifier until findings carry `fault`.** Sure:
   85%.

**Cases the rule does not cover.**

- **A FAIL after a PASS.** 9 loops go pass, fail, pass, and at least 5 more
  fail again after a later pass. There is no open list to shrink.
- **A first review that could not grade.** 37 loops start on nothing but a
  red check.
- **Criteria added mid-loop**, by the reviewer or by a person's note on the
  ticket.
- **Lines that arrive from elsewhere.** Another child of the same epic lands
  on the branch, or the base branch moves.
- **Old text the repair made false.** Untouched lines, new fault.
- **A finding with no line.** An unmet criterion, a missing test.
- **A red check.** It is allowed here by a choice of mine. The note does not
  say.

## Four pull requests, round by round

**The rule passes early and merges a bug.**
[#9605](https://github.com/kamp-us/phoenix/pull/9605), three rounds: fail,
fail, pass.

- Round 1, [one failing verdict](https://github.com/kamp-us/phoenix/pull/9605#issuecomment-5754780427):
  a required end-to-end case is skipped in CI, with a second point the
  splitter did not cut apart. List: 1.
- Round 2, [one finding](https://github.com/kamp-us/phoenix/pull/9605#issuecomment-5755049316):
  "a POP back to a never-scrolled entry keeps the departing page's offset".
  The code it quotes was there in round 1. Locked out. Nothing allowed is
  left, so the rule passes here.
- Round 3 in the record: the bug is fixed, PASS.

The rule saves one round, about $2.22, and merges a back-button bug.

**Twins, three rounds of them.**
[#9542](https://github.com/kamp-us/phoenix/pull/9542), four rounds: fail,
fail, fail, pass. The change removed a type argument and a field.

- Round 1: [two config entries](https://github.com/kamp-us/phoenix/pull/9542#issuecomment-5752804958)
  still name a deleted test, a check is red, and
  [three READMEs](https://github.com/kamp-us/phoenix/pull/9542#issuecomment-5752808724)
  teach the removed field. List: 3.
- Round 2: [a docblock and a test comment](https://github.com/kamp-us/phoenix/pull/9542#issuecomment-5752919118)
  and [a README example](https://github.com/kamp-us/phoenix/pull/9542#issuecomment-5752920563)
  still show the removed argument list. All three locked out. The rule passes
  here.
- Round 3: [three more docblocks](https://github.com/kamp-us/phoenix/pull/9542#issuecomment-5753029497)
  teach the removed field. Locked out.
- Round 4: PASS.

Six stale examples, all real. Four are the same fault as an earlier finding
in another place. The other two are a second thing the change removed, which
round 1 did not list. A sweep for the removed names at round 1 is the fix
this one asks for.

**The rule stops a loop that was one round from done.**
[#9757](https://github.com/kamp-us/phoenix/pull/9757), three rounds: fail,
fail, pass.

- Round 1, [one finding](https://github.com/kamp-us/phoenix/pull/9757#issuecomment-5803961632):
  a relative-path link walks past a guard. List: 1.
- Round 2, [one finding](https://github.com/kamp-us/phoenix/pull/9757#issuecomment-5804126676):
  a name collision in a function the verdict calls "untouched by this diff".
  It shares a quote with round 1, so the placing calls it raised before.
  List: 1. Not shorter. The rule stops for a person.
- Round 3 in the record: PASS.

Two lessons. A list of one stops after one try. And the placing is wrong
here: this is a new finding on old code, which the rule would lock out.
Either way the rule ends the loop at round 2 and the record needed one more.

**Old text the repair made false.**
[#9861](https://github.com/kamp-us/phoenix/pull/9861), five rounds: four
fails, then a pass. A skill page and its contract.

- Round 1: [five stale or clashing sentences](https://github.com/kamp-us/phoenix/pull/9861#issuecomment-5851373658).
  List: 5.
- Round 2: the repair changed what the skill may do. A
  [decision-record finding](https://github.com/kamp-us/phoenix/pull/9861#issuecomment-5851451756)
  is allowed. [Two findings on older text](https://github.com/kamp-us/phoenix/pull/9861#issuecomment-5851481354)
  are locked out: sentences the repair made false, and a step that stops on
  a mistake the planner could fix.
- Round 3: [a refusal message](https://github.com/kamp-us/phoenix/pull/9861#issuecomment-5851634738)
  "still says adoption never writes labels". The repair added that write.
  Locked out.
- Round 4: [the reworded message](https://github.com/kamp-us/phoenix/pull/9861#issuecomment-5851701477)
  is still wrong. On the repair's lines, allowed.
- Round 5: PASS.

With the unplaced counted as allowed the list runs 5, 2, 1, 1 and the rule
stops at round 4. Counted as locked out it runs 5, 1, 0 and the rule passes
at round 3 with the false message in.

## Guesses that were wrong

- **"A check on the quoted line will settle stale text."** Wrong. It agrees
  with the reviewer less often than always saying "fixed".
- **"A small classifier can answer 'is it fixed?' from the finding and the
  diff."** Wrong on today's verdicts: 82% against 93%.
- **"Stopping only when a finding comes back will be gentler than stopping
  on a flat list."** Wrong. It stops 52 to 56 loops. And by hand, only one
  "raised before" in five is the same finding.

## What agrees and disagrees with experiments 54 and 57

- **Agrees with 57:** "already there and missed" is about a third of placed
  later findings. 31.7% here by git, 31% there by hand.
- **Agrees with 57:** half of the missed are the same fault in another
  place. 16 of 44 real ones here, 16 of 32 there.
- **Adds to 57:** it left "raised before" unread. Here 4 of 20 are the same
  finding. So experiment 54's "a quarter were raised before" is too high as
  a count of repeats.
- **Disagrees with the note:** "No number is chosen anywhere". The stop is
  one try for a list of one.
- **Agrees with 54:** a red check is the one kind code can take whole.

## What this cannot tell us

- **What a reviewer told to review once, fully, would catch.** These
  reviewers knew another round would come. The largest unknown.
- **What would have happened after a locked-out finding.** The later rounds
  in the record come from a loop where that finding was repaired.
- **What a narrow later round costs.** The saving on every later round is
  the idea's main promise and is not in this data.
- **Identity.** No finding has an id. "Raised before" and "raised again" are
  a shared quote, and one in five of those is the same finding.
- **The exact split.** 178 of 459 later findings cannot be placed. Every
  count comes as a range for that reason.
- **Whether the findings were right.** "Real" is my reading of the verdict
  and the change. One reader, one pass.
- **Real dollars on phoenix.** $2.22 is from 15 runs on another repo.
- **The share that code can check, to better than a wide interval.** 9 of
  60.
- **The splitter's noise.** About one cut item in eight is not a finding.
- **Another repo.** Phoenix's skill pages are the product, and 31 of the 44
  real locked-out findings are text.

## Run it

```
LANES=<a repo's .fabrika folder> CACHE=<experiment 54's cache folder> node experiments/58-shrinking-list-replay.ts
```

With no `STEP` it prints every table from the cache, the saved readings and
the saved answers. No key, no network.

- `STEP=fetch` asks GitHub how each pull request ended, and for the diffs
  between rounds that experiment 54 did not compare. `gh`, read-only.
- `STEP=trees` looks for every quoted line in the files at three commits.
  It needs `CLONE`, a local clone that holds the reviewed commits, and reads
  git objects only.
- `STEP=read` writes the five hand samples' texts into `CACHE`, to read.
- `STEP=fixed` asks Jev "does this change fix it?". `DRY=1` prints the cost
  and stops, `TRY=<n>` asks n. It needs `TYPESAFE_API_KEY` and stops before
  $2.
- `DETAIL=<pull request number>` prints that pull request round by round.

`CACHE` holds raw answers from GitHub and is never committed. Three files
are.

- `58-readings.json`: every hand reading, with a few words of reason. It
  holds a few more than the tables use. Two samples were drawn again when
  the quote lookup finished, and the older readings stay in the file.
- `results/shrinking-list-replay.json`: the counts above, one row per loop
  and one per later-round finding.
- `results/shrinking-list-fixed.json`: the share Jev gave each choice.

None holds a line of any comment. `lib/review-rounds.ts` is experiment 54's
loading code in a file of its own. Experiment 54's script still has its own
copy, because another branch was editing it. Folding the two is a follow-up.
