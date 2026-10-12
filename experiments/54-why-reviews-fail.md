# 54. Why reviews fail: 707 failed reviews, read on their pull requests

Experiment 53 found that a failed review is the most common detour in a lane.
The first review passes 57% of the time. The lane logs could not say why. The
reviewer posts its verdict on the pull request, and that repo is public, so
this experiment went and read them.

**Answer: two failed reviews in three needed a reader. About one in ten was
nothing but a red check, and about one in ten was a rule that was already
written down.**

- **Needs a reader: 67% of failed reviews.** The largest part is text. A doc,
  a skill page or a comment says something the code no longer does. Real bugs
  in code come second.
- **A Check could have caught it: 10%, where the red check was the whole
  verdict.** GitHub's own record is stronger than the labels here. At the
  commit a review failed on, a check was red in 25% of cases. In more than
  half of those the reviewer found something else too.
- **A better brief could have prevented it: 11%.** Mostly a standing decision
  record the change went against.
- **Not sure: 12%.** Jev was under its floor and I did not force a label.

Later rounds fail for the same mix of reasons as first rounds. More than half
of the findings in a later round quote text that was already in the pull
request one round earlier.

**Superseded 2026-10-11: "more than half" does not hold.**
[Experiment 57](./57-repeat-findings-read-by-hand.md) read 60 of those
findings by hand. About 31% of placed later-round findings were already
there and missed (24% to 38%).
[Experiment 58](./58-shrinking-list-replay.md) placed them a second way, by
asking git for the quote, and got 31.7% of 281. The sentence above stays as
the guess it was.

Jev labelled 2,568 items for about $0.15. At 0.8 and up it agreed with my
labels 91% of the time, but it reached 0.8 on only 56% of items.

## Who did what

| Part | Whose |
|---|---|
| The 882 lanes, every review, every verdict comment | today's fabrika, on [kamp-us/phoenix](https://github.com/kamp-us/phoenix) |
| Reading a verdict back from its comment (`src/verdict.ts`) | tea-fabrika, new here |
| The codebook and the hand labels on 59 failed reviews (`54-codebook.json`) | a reader, for this experiment |
| The labels on the rest | Jev, with the codebook as fixed choices |
| The lane fold (`src/lane-log.ts`) | tea-fabrika, from experiment 53, unchanged |

No lane ran. Nothing was written to GitHub.

## The data, and the match

The lane logs hold 774 `FAIL` lines that a reviewer could have written. 758
are from the text review, 11 from the rendered review and 5 from a frozen
lane. Each line names its pull request, or its child issue on an epic.

The reviewer posts one comment per namespace: `review-code`, `review-doc`,
`review-skill`, `governance`. The first line binds the verdict to a commit and
gives a one-line reason. I matched a `FAIL` line to the failing verdicts posted
after the task's line before it and no later than two minutes after it.

| | FAIL lines |
|---|---|
| Matched to at least one failing verdict | 714 (92.2%) |
| Not matched: written under 3 minutes after the line before it | 54 |
| Not matched: an epic's own task, with no pull request or issue to look on | 3 |
| Not matched: no failing verdict in the window | 3 |

The 54 are bookkeeping. A driver wrote a second `FAIL` to bring the log back
in step, and no reviewer ran in between. 27 of them sit in one epic lane.

So the set is **707 failed text reviews**, 486 on single lanes and 221 on
epics, holding **1,169 failing verdicts**. 7 failed rendered reviews matched
too, and I say what little they show in section 2.

Three things about the data.

- **A later verdict can overwrite an earlier one.** In August a re-post
  replaced the comment's text. GitHub keeps what an edited comment said
  before, so I read 35 failing verdicts from that history.
- **One account posts everything.** The reviewer, the builder and a person
  all comment from the same account. I can tell a verdict by its first line.
  I cannot tell a builder's note from a person's.
- **39 early lanes name no pull request.** I asked GitHub which pull request
  closed each issue.

Fetching took 256 GraphQL queries and about 740 REST calls, all cached on
disk.

## How I sorted them

I read 59 failed reviews, spread on purpose over the 50 days, the four
namespaces, epics, and rounds 1 to 9. That is 108 failing verdicts. The kinds
below came out of that reading. Two kinds I expected did not show up as
their own row, and the last section says which.

| Kind | In one line | Two examples |
|---|---|---|
| stale text | The change did not update a doc, skill page, help line or comment, and it is now false | [#9542](https://github.com/kamp-us/phoenix/pull/9542#issuecomment-5752920563), [#10073](https://github.com/kamp-us/phoenix/pull/10073#issuecomment-5861325723) |
| wrong text | A sentence the change itself wrote is not true of the code | [#6388](https://github.com/kamp-us/phoenix/pull/6388#issuecomment-5343119982), [#10227](https://github.com/kamp-us/phoenix/pull/10227#issuecomment-5901076665) |
| code bug | The code does the wrong thing in some case | [#6388](https://github.com/kamp-us/phoenix/pull/6388#issuecomment-5343114228), [#9824](https://github.com/kamp-us/phoenix/pull/9824#issuecomment-5850725609) |
| red check | CI, a named test, a repo guard or a size limit is red at this commit | [#10586](https://github.com/kamp-us/phoenix/pull/10586#issuecomment-5993951170), [#6326](https://github.com/kamp-us/phoenix/pull/6326#issuecomment-5338173413) |
| decision conflict | The change does what a standing decision record forbids | [#5904](https://github.com/kamp-us/phoenix/pull/5904#issuecomment-5320619023), [#6684](https://github.com/kamp-us/phoenix/issues/6684#issuecomment-5361268871) |
| record keeping | A decision record's own paperwork is wrong: a duplicate id, a status line not updated | [#9635](https://github.com/kamp-us/phoenix/pull/9635#issuecomment-5756105858), [#6122](https://github.com/kamp-us/phoenix/pull/6122#issuecomment-5333756666) |
| criterion unmet | The ticket asked for it, or a person ruled it on the ticket, and the change did not do it | [#7193](https://github.com/kamp-us/phoenix/pull/7193#issuecomment-5448863214), [#10574](https://github.com/kamp-us/phoenix/pull/10574#issuecomment-5990548311) |
| convention | A written repo convention is broken | [#7164](https://github.com/kamp-us/phoenix/issues/7164#issuecomment-5449703726), [#7164](https://github.com/kamp-us/phoenix/issues/7164#issuecomment-5449701685) |
| test gap | A test is missing, or checks the wrong thing | [#9373](https://github.com/kamp-us/phoenix/pull/9373#issuecomment-5706669589), [#9157](https://github.com/kamp-us/phoenix/pull/9157#issuecomment-5627530993) |
| pull request text | The pull request's own text or the builder's report is wrong or incomplete | [#9364](https://github.com/kamp-us/phoenix/pull/9364#issuecomment-5706236322), [#7511](https://github.com/kamp-us/phoenix/issues/7511#issuecomment-5520254729) |
| prose craft | Only the writing. Nothing is false | [#7298](https://github.com/kamp-us/phoenix/issues/7298#issuecomment-5465084222), [#9373](https://github.com/kamp-us/phoenix/pull/9373#issuecomment-5706685660) |
| carried | No finding of its own. The namespace says its files are clean and fails because another one failed | [#8846](https://github.com/kamp-us/phoenix/pull/8846#issuecomment-5612036264), [#9824](https://github.com/kamp-us/phoenix/pull/9824#issuecomment-5850730024) |

A thirteenth choice, "not a finding", is for a point that turns out to be a
note or a "fixed".

I labelled at two levels. A **reason** is a failing verdict as a whole, by
its one-line reason. A **finding** is one point inside it. `findingsIn` cuts a
verdict into findings by the shapes reviewers use: a "Findings" heading with a
list, a `[FAIL]` row, a paragraph that opens with a bold FAIL.

Verdicts are free prose, so the cut is rough. On my sample it cut 124 points
as blocking, and 13 of them were not findings. 21 of 108 failing verdicts had
no list to cut, and stand as one finding by their reason. Read every count of
findings as within about 15%.

Each item also got a second label, what it rests on: a check, a written rule,
the ticket, or reading.

## 1. Why reviews fail

**Text is the largest family, and most of the rest is real bugs and red
checks.**

The first column is all 707 reviews. My hand labels cover 59 of them and Jev
at 0.8 and up covers the rest, so each kind there is a floor. The second
column is my sample alone. It is exact, but it is small and I spread it on
purpose, so it holds more governance verdicts than the whole does. The truth
for a kind lies between the two. A review with two kinds counts in both rows.

| Kind | Of 707 failed reviews, at least | Of the 59 I read |
|---|---|---|
| stale text | 116 (16.4%) | 14 (23.7%) |
| wrong text | 71 (10.0%) | 16 (27.1%) |
| text, Jev unsure which of the two | 103 (14.6%) | |
| code bug | 119 (16.8%) | 12 (20.3%) |
| red check | 99 (14.0%) | 13 (22.0%) |
| decision conflict | 50 (7.1%) | 8 (13.6%) |
| record keeping | 24 (3.4%) | 8 (13.6%) |
| criterion unmet | 21 (3.0%) | 5 (8.5%) |
| test gap | 11 (1.6%) | 2 (3.4%) |
| convention | 8 (1.1%) | 1 (1.7%) |
| pull request text | 5 (0.7%) | 2 (3.4%) |
| prose craft | 5 (0.7%) | 2 (3.4%) |
| carried | 34 (4.8%) | 6 (10.2%) |
| at least one reason Jev was unsure of | 315 (44.6%) | 0 |

By family, text is in 40% to 54% of failed reviews. Code, meaning a bug or a
test gap, is in 19% to 24%. Checks are in 14% to 22%. Written rules are in
14% to 29%, and the ticket in 5% to 12%.

At the level of findings the order holds. Of 1,362 findings, 31% are text,
18% code, 8% a red check, 8% a written rule, 3% the ticket, and 31% unsure.

Three things I did not expect.

- **Reviewers add criteria to the ticket.** When a reviewer finds something
  the ticket never asked for, it appends a criterion and fails the round. A
  wide word pattern finds that in 235 failed reviews, 33%. It counts too
  much, because it also fires on "not appended". A narrow one, "appended as
  criterion 6", finds 128, 18%, and misses other wordings. So between a
  fifth and a third of failed reviews fail on something that was not in the
  ticket.
- **A namespace can fail with clean files.** Today's fabrika refuses a PASS
  in a round that added a criterion. So `review-doc` posts a FAIL that says
  its own files are clean. [#9824](https://github.com/kamp-us/phoenix/pull/9824#issuecomment-5850730024)
  is one. 41 failing verdicts by label, 3.5%, and 7 of the 108 I read.
- **Scope almost never fails a review.** The verdict grades the builder's
  list of extra changes on one fixed line. It says FAIL in 39 failed reviews,
  5.5%, and in 1 of the 59 I read.

## 2. By file class

**Skill pages fail on text. Code fails on bugs and red checks. Governance
fails on decision records.**

Experiment 53 saw that a lane touching a skill fails 46% of its reviews. This
is what those verdicts say.

| Family of the reason | review-code (510) | review-doc (223) | review-skill (319) | governance (109) |
|---|---|---|---|---|
| text | 12.4% | 31.8% | 58.6% | 2.8% |
| code | 25.3% | 0.0% | 1.6% | 1.8% |
| red check | 18.6% | 4.0% | 3.1% | 0.0% |
| written rule | 1.2% | 13.0% | 2.2% | 67.0% |
| ticket | 4.9% | 4.0% | 0.6% | 0.0% |
| carried | 2.9% | 12.1% | 3.4% | 0.0% |
| unsure | 34.7% | 35.0% | 30.4% | 28.4% |

A failing `review-skill` verdict is a sentence that is no longer true, six
times in ten at the least. [#10586](https://github.com/kamp-us/phoenix/pull/10586#issuecomment-5993956240)
is typical. The change taught a verb a new case, and two sentences of the
skill page still said that case had no way out.

`review-doc` carries the most clean-file FAILs, 12%.

**Rendered review: too few to sort.** 11 `FAIL` lines, 7 matched. Six of the
seven one-line reasons say only "changes-requested". One names a block that
overflows at a 390-pixel width. In lanes whose log names the `ui` class, the
text review fails on text in 25% of cases and on code in 25%.

## 3. What a Check could have caught

**A red check was on record at one failed commit in four. It was the whole
verdict in about one in ten.**

This section does not rest on Jev. For each failed review bound to a pull
request's commit, I asked GitHub for that commit's check runs. It still holds
them for all 534. I left out the two floor checks that are red while any
review runs, and the roll-up that only repeats a job under it.

| At the commit the review failed on | Failed reviews |
|---|---|
| A check is red | 132 of 534 (24.7%) |
| The required roll-up is red | 101 of 516 (19.6%) |
| A unit-test job is red | 79 (14.8%) |
| The first red finished before the review could start | 35 (6.6%) |
| The first red finished while the reviewer ran | 92 (17.2%) |

By the labels, 50 of those 132 reviews had nothing but the red check. 58 also
had a reason that took reading, 3 a written rule, and 20 are unsure.

Where the red arrived during the review, the `FAIL` was written 5.0 minutes
after it at the median. The whole review took 10.9 minutes. So in 92 reviews
an agent sat waiting for a job to end and then reported what the job said.

Each Check, and how sure I am it would have caught these real cases.

- **Checks green at the head before any reviewer starts.** Code waits for the
  check runs. Red goes back to the builder with the failing job's log. It
  would have fired on the 132. Sure it fires: 95%. Sure it saves the reviewer
  run: only for the 50 where red was all there was. For the 58 it moves the
  reviewer's other findings one round later, at the price of one more build.
  Examples: [#10586](https://github.com/kamp-us/phoenix/pull/10586#issuecomment-5993951170)
  (a help line over its length limit turned two unit tests red),
  [#9166](https://github.com/kamp-us/phoenix/pull/9166#issuecomment-5627990576)
  (the same, a 97-character line against a 72-character limit),
  [#6326](https://github.com/kamp-us/phoenix/pull/6326#issuecomment-5338173413)
  (43 dead links, and the link check red).
- **The repo's own guards, run in the build before it says done.** In 42
  failing verdicts the reviewer ran a guard by hand and it reported. Sure:
  90%, because the reviewer's command is the Check. Examples:
  [#8815](https://github.com/kamp-us/phoenix/issues/8815#issuecomment-5611726556)
  and [#8846](https://github.com/kamp-us/phoenix/pull/8846#issuecomment-5612032508)
  (the portability guard), [#7162](https://github.com/kamp-us/phoenix/issues/7162#issuecomment-5446433447)
  (a new package with no README, which a workflow requires).
- **A decision record's id is free.** A command already computes the next
  free id over the main branch and open pull requests. 13 failing verdicts in
  9 reviews by label. A word pattern finds 61 reviews, which I read as a
  ceiling. Sure: 90% for a duplicate id, 50% for a status line that should
  have changed. Examples: [#9635](https://github.com/kamp-us/phoenix/pull/9635#issuecomment-5756105858),
  [#8975](https://github.com/kamp-us/phoenix/pull/8975#issuecomment-5616817046),
  [#10018](https://github.com/kamp-us/phoenix/pull/10018#issuecomment-5859681137).
- **The pull request text has its required sections.** 18 failing verdicts
  were cleared with no file changed, by fixing the text or adding evidence.
  A Check can see that a `## Report` section is missing. It cannot see that
  the section is true. Sure: 60%. Examples:
  [#10512](https://github.com/kamp-us/phoenix/pull/10512#issuecomment-5983723513),
  [#10508](https://github.com/kamp-us/phoenix/pull/10508#issuecomment-5985906829),
  [#8911](https://github.com/kamp-us/phoenix/pull/8911#issuecomment-5614037982).
- **A criterion with a runnable example.** Rare here. "Criterion unmet" is 3%
  to 8% of failed reviews and most of those are choices, not examples.
  [#9522](https://github.com/kamp-us/phoenix/pull/9522#issuecomment-5753130993)
  is the one clear case: every touched docblock must carry a tag, and a
  search would have found the one that did not.

By the labels alone, 72 failed reviews, 10.2%, had only reasons a Check
could catch, and 117, 16.5%, had at least one. In my sample it is 9 of 59,
15.3%.

## 4. What a better brief could have prevented

**About one failed review in ten, and I am less sure of this one.**

75 failed reviews, 10.6%, had no reason that took reading and at least one
that rests on a rule already written down. 135, 19.1%, had at least one such
reason. In my sample it is 13 of 59, which is high because I picked
governance verdicts on purpose.

What the rule was, over the 161 failing verdicts in this group.

- **A standing decision record, 55 at least.** The change did what a record
  forbids. [#5904](https://github.com/kamp-us/phoenix/pull/5904#issuecomment-5320619023)
  added shell snippets with a command substitution, which a record bans in
  any position. [#6684](https://github.com/kamp-us/phoenix/issues/6684#issuecomment-5361268871)
  named two agent files after their skills, which another record bans by
  name. The governance reviewer finds the records with a ranked search over
  the corpus. The builder was never handed that list.
- **The ticket, 22 at least.** Often a ruling a person posted as a comment
  after the criteria were written. [#10574](https://github.com/kamp-us/phoenix/pull/10574#issuecomment-5990548311)
  shipped a new rule as every repo's default, and two comments on the ticket
  said the default stays.
- **A record's paperwork that no command reports, 19.** An older record
  amended in its body with its status line left alone.

"Preventable" is a guess. Telling a builder a rule is not the same as the
builder following it. I am about 50% sure a brief that carries the ranked
list of records would have prevented half of the first group. An experiment
would settle it: replay ten of these tickets with the list in the brief.

## 5. What needed a reader

**471 failed reviews, 66.6%.** In my sample, 37 of 59.

These are the three kinds no rule names in advance.

- **Text that is now false.** The reviewer compares a sentence with the code.
  [#9542](https://github.com/kamp-us/phoenix/pull/9542#issuecomment-5752920563):
  the change removed a type argument, and a README example one screen above
  the edited paragraph still passed six.
- **A bug found by tracing or trying.** [#6388](https://github.com/kamp-us/phoenix/pull/6388#issuecomment-5343114228):
  the reviewer ran git in a scratch repo and showed that a rename succeeds
  where the code assumed it fails. The code then printed "nothing was
  changed" after changing the branch's name.
- **New text that claims too much.** [#10227](https://github.com/kamp-us/phoenix/pull/10227#issuecomment-5901076665):
  a new paragraph said every line of an answer names the commit, and only
  the first line does.

Stale text is the one I would try to move. A search can list every doc that
mentions a name the diff removed or changed, and a Judge can ask of each
sentence whether it still holds. `src/review.ts` already asks that of code
files one import away from a changed file. Here the file left behind is a
doc. I am 40% sure that would catch half the stale-text findings, and I did
not test it.

## 6. Round 2 and later

**A later round fails for the same reasons as a first round. More than half
of its findings were already there to be found.**

**Superseded 2026-10-11:** the second sentence does not hold. It is about a
third. The correction is at the end of this section.

218 failed reviews are round 2 or later. The split by what they needed is
the same as round 1 until round 4, where it is nearly all bugs.

| Round | Failed reviews | Check | Brief | Reader | Unsure |
|---|---|---|---|---|---|
| 1 | 489 | 9.8% | 10.6% | 66.5% | 12.9% |
| 2 | 141 | 12.1% | 11.3% | 63.8% | 12.8% |
| 3 | 47 | 10.6% | 12.8% | 66.0% | 10.6% |
| 4 and later | 30 | 6.7% | 3.3% | 83.3% | 6.7% |

To see where a later finding came from, I used what it quotes. For 210
later-round failed reviews I fetched the diff between the commit of the round
before and this one. A finding that quotes code or a sentence then falls one
of three ways. 412 findings, 312 of them placed.

- **Raised before: 79 (25%).** The quote is in the earlier round's verdicts.
  The same finding again, or a fix that was partial.
  [#10018](https://github.com/kamp-us/phoenix/pull/10018#issuecomment-5859681137):
  the repair renamed the record's file and left the old id inside it.
- **Written by the repair: 52 (17%).** The quote is in lines the repair
  added. [#9921](https://github.com/kamp-us/phoenix/pull/9921#issuecomment-5853801993):
  the repair's new record cited a closed issue as its open tracker.
- **There before, and not raised: 181 (58%).** The repair did not write it
  and the earlier verdict did not mention it. Some verdicts say so outright.
  [#5904](https://github.com/kamp-us/phoenix/pull/5904#issuecomment-5320622892)
  calls its round-3 finding a defect "that was present the whole time".

101 of the 210 later-round reviews hold at least one finding of the third
kind.

**Corrected 2026-10-11.** That 58% does not hold.
[Experiment 57](./57-repeat-findings-read-by-hand.md) drew 60 of the 181 and
read each against the code at both commits. 32 were there before and missed.
That is about 31% of the 312 placed findings (24% to 38%), not 58%. Of the
other 28, 18 were new since the earlier review: lines the repair wrote, a
sentence that was untouched and became false only because of the repair, or
a conflict with the base branch, which is nobody's miss. 3 had been raised
before and 7 were not findings. For half of the 181 no quote is in any file,
so the rule placed them with nothing to go on. 95 findings quote nothing and
are not placed.

The 25% is too high too, as a count of repeats.
[Experiment 58](./58-shrinking-list-replay.md) read 20 findings that share a
quote with an earlier verdict. 4 were the same finding, still open.

## 7. How long a verdict is, and what a pass carries

A failing verdict is 4,760 characters at the median and 8,130 at the 90th
percentile. The longest is 20,280. A failed review has one failing namespace
in 52.5% of cases, two in 32.5%, and three or more in 15.0%. All its failing
verdicts together are 7,165 characters at the median.

The splitter finds 2.06 findings a failed review on average. The median is 1,
the 90th percentile 4, and the most 23. Half of failing verdicts hold exactly
one finding.

**Passes carry notes too.** 2,760 passing verdicts matched a `PASS` line.
They are 3,925 characters at the median, not much shorter than a failing one.
47.5% carry a point marked as not blocking, a nit or a follow-up. 10.8% say
they filed or routed something. 16.9% of failing verdicts carry such a note
beside their findings.

## 8. FAILs later judged wrong

**Few that the pull requests show: 6 failing verdicts of 1,169 were taken
back or overruled. 9 more were a red check that a re-run turned green.**

The one clean test I found is a failing verdict followed by a PASS in the
same namespace at the same commit. No file changed in between, so something
else did. There are 34, and I read each.

| What happened | Verdicts | One example |
|---|---|---|
| The pull request's text, the builder's record or the evidence was fixed | 18 | [#8356](https://github.com/kamp-us/phoenix/pull/8356#issuecomment-5562525502) |
| A check was re-run and went green. Nothing in the change was wrong | 9 | [#10027](https://github.com/kamp-us/phoenix/pull/10027#issuecomment-5860233801) |
| A person ruled, and the FAIL fell | 4 | [#7193](https://github.com/kamp-us/phoenix/pull/7193#issuecomment-5448863214) |
| The reviewer withdrew it, or moved it to another namespace | 2 | [#7512](https://github.com/kamp-us/phoenix/issues/7512#issuecomment-5520838688) |
| A repair commit inside the same range | 1 | [#7530](https://github.com/kamp-us/phoenix/issues/7530#issuecomment-5534645175) |

On [#7193](https://github.com/kamp-us/phoenix/pull/7193#issuecomment-5448863214)
the reviewer failed the change for doing the opposite of the ticket's text.
A person had ruled the other way in a comment, and the builder had followed
the ruling. The reviewer graded against the stale criteria.

The 9 re-runs matter for the first Check. A gate that sends every red back to
the builder would have sent these 9 back for nothing. It needs one rule more:
re-run a red job once when it is in files the change does not touch.

This is a floor. A FAIL that was wrong and still got "repaired" with a commit
leaves no trace I can find. I tried a word pattern for comments that argue
with a finding. It found 7, and an earlier, wider pattern found 62 of which
1 in the 16 I read was a real dispute. I do not trust either number.

## 9. Jev against my labels

**Sure and right, or unsure. At 0.8 and up Jev agreed with me nine times in
ten, on a little over half the items.**

232 items of the sample have both labels.

| Question | Jev's top choice agrees | Jev at 0.8 and up | Of those, agrees | Under 0.8, top choice agrees |
|---|---|---|---|---|
| Kind, 13 choices | 70.7% | 55.6% | 91.5% | 44.7% |
| Family, 6 | 78.0% | 65.1% | 92.1% | 51.9% |
| Check, brief or reader, summed from the kinds | 81.9% | 75.4% | 90.9% | 54.4% |
| The same, asked straight | 80.6% | 69.4% | 90.1% | 59.2% |
| The same, whichever of the two is sure | | 84.1% | 87.7% | |
| What it rests on, 4 | 80.4% | 72.7% | 88.8% | |

Under the floor Jev's top choice is right less than half the time, so the
floor does its job. Everything under it is reported as unsure.

Where Jev was unsure of the kind, my label was most often "wrong text" (25
items) or "stale text" (15). It could not tell a sentence the change left
behind from one the change wrote. I could, because I had read the whole
verdict and Jev had 700 characters of it. Summing its shares over a family
moved some of those above the floor.

Where Jev was sure and wrong on the headline question, it leaned toward
"reader": 14 of 24 misses. So the 67% is, if anything, a little high, and the
Check and brief shares a little low.

One thing I changed after the first full run. The headline question had 25%
unsure when summed from the kinds, so I asked it straight as a second
question. Taking whichever answer is sure cut unsure to 16% of items and cost
three points of agreement. The table shows both.

Spend: about 5,400 Jev calls, about 3.6 million tokens by a count of four
characters a token, **about $0.15**. The estimate before the full run was
$0.10 for the first pass, and that pass cost $0.10. No other model ran.

## What this says for the review stage as a machine

**Move the waiting and the red checks to code. Keep the agent for reading,
and hand it less to read.**

Set against the lessons already in `src/review.ts`.

- **The review machine gets a change whose tests passed. Today's reviewer does
  not.** A unit-test job was red at 79 of 534 failed commits. That is the
  largest single thing code can take.
- **Experiment 50 saw a reviewer started on a pull request the machine knew
  was red.** On phoenix that exact case is 35 failed reviews, 6.6%. The
  bigger case is the 92 where the red arrived while the reviewer waited.
  Experiment 53 read the reviewer's 8 minutes as a wait. This agrees. The
  wait belongs in a Listen.
- **Scope check before any agent.** It costs nothing and it stays. But on
  phoenix it would catch little. Builders list their extra changes, and that
  line fails in about 5% of failed reviews.
- **Findings must quote a real line.** These reviewers mostly do: 317 of 412
  later-round findings quote something. What is missing is the shape. A
  quarter of failing verdicts list no findings at all, and I needed a rough
  splitter and a classifier to count them. A reviewer that returns
  `{file, line, quote, problem}` makes this whole experiment a query.
- **Remember decided findings.** A quarter of placed later-round findings
  were raised before. That is the case this rule is for.

  **Superseded 2026-10-11: a quarter is too high as a count of repeats.**
  "Raised before" here means a shared quote.
  [Experiment 58](./58-shrinking-list-replay.md) read 20 such findings. Only
  4 were the same finding, still open (20%, 8% to 42%). 6 were a new finding
  about what the repair wrote, 4 a new finding about older text, 3 were not
  findings and 3 could not be told. Reviewers quote the same rule or the
  same line for different points.
- **Freeze at the last round.** 30 failed reviews are round 4 or later, and
  five in six of them needed a reader. Long lanes are real bugs, not
  paperwork.

Two things the machine does not have yet.

- **A reviewer that adds work the ticket did not ask for.** Today's reviewer
  appends a criterion and fails the round, in a fifth to a third of failed
  reviews. The machine's reviewer only finds. Something must decide whether a
  finding outside the criteria blocks. The router in `src/review.ts` asks
  whether a finding is about the ticket's goal. This data says that question
  comes up in every third failed review, so it has to be good.
- **A first-round reviewer that reads the whole change.** If 58% of
  later-round findings were there a round earlier, the cheapest saving in
  review is a better first read. I do not know why they were missed. A
  reviewer that stops at its first blocking finding would produce this
  pattern, and so would a verdict that is already 5,000 characters long.

  **Superseded 2026-10-11: it is not 58%.**
  [Experiment 57](./57-repeat-findings-read-by-hand.md) read 60 of them by
  hand. About 31% of placed later-round findings were already there and
  missed (24% to 38%). It also says something on why. 20 of the 32 missed
  were in a file or part an earlier review says it read, so reading more
  files would not have caught most of them.
  [Experiment 58](./58-shrinking-list-replay.md) replayed the rule this
  bullet leads to, "review once, then only check the list". The findings
  that rule would lock out were real defects, 30 of 30 in its fixed sample.
  So "the cheapest saving" is not shown. The bullet above stays as the guess
  it was.

**The steps, as moves.** Listen for the check runs. Check that none is red,
with one re-run for a job outside the change's files. Check the repo's
guards, the record id, and the pull request's sections. Gather the docs that
mention what the diff removed, and Judge each. Then Draft: one agent reads
the diff for bugs and false sentences and returns quoted findings. Judge
whether each finding is the ticket's business. A person gets what the Judge
is unsure of.

## What agrees and disagrees with earlier experiments

- **Experiment 53's guess holds in part.** It said code might move the 43% of
  first reviews that fail. Code alone moves about a tenth of them.
- **Experiment 50 asked whether a red pull request should go to the reviewer
  or straight back.** Straight back, with the log. But in 58 of 132 cases
  the reviewer had more to say, so "straight back" trades a reviewer run now
  for a build round later. That question is settled for the 50, not for the
  58.
- **Experiment 51 found Jev right 38 times in 38 at 0.8 and up on small
  next-step choices.** On 13 choices and 700 characters of prose it is right
  118 times in 129, and reaches the floor on fewer items. Narrow questions
  suit it. This one was wide.
- **Experiments 36 and 38 built the missing-file check on import
  neighbours.** On phoenix the file left behind is more often a doc than a
  neighbour in code.

## What this cannot tell us

- **Whether a finding was right.** I sorted findings. I did not check them
  against the code.
- **The kind of a third of failing verdicts.** Jev was under its floor on 33%
  of reasons. The family is unknown for the same third, and the headline
  question for 16%.
- **What a failed review cost.** Experiment 53 put it at about 17 minutes of
  lane time. Nothing here has dollars.
- **What CI said at the moment the reviewer looked.** GitHub keeps the last
  attempt of each check. A red that a re-run turned green reads green now.
  The 25% is a floor for that reason, and a ceiling for another: a red check
  at a commit is not always why the review failed.
- **Why findings were missed in an earlier round.**
- **How often a builder disputes a finding.** One account posts everything,
  and my word pattern does not hold.
- **Rendered review.** Seven failed verdicts, six with no reason on the first
  line.
- **Two kinds I looked for and did not find as their own row.** "The ticket
  itself was wrong" shows up as a person's ruling that overturns a FAIL, 4
  times. "A stale claim about the codebase" folded into stale and wrong text.
- **Another repo.** Phoenix has 400 decision records, a governance reviewer,
  and skill pages that are the product. Demlik has none of these. The text
  and governance shares will not carry over. The red-check share might.
- **The sample.** 59 reviews, read once, by one reader, from cut text for
  most of the labels. I read five verdicts whole.

## What to build first

1. **Checks green before a reviewer starts, inside the build stage.** A red
   check was on record at 25% of failed commits, and it was the whole verdict
   in about 10% of failed reviews. Every one of those is a reviewer run of
   about 8 minutes that reported a job's result. Cost: a Listen and a Check
   that already ran live in experiments 49 and 50. Add one re-run for a red
   job outside the change's files, for the 9 that were not the change's
   fault. Sure it helps: 90%. Sure of the size: 70%, because the 58 mixed
   cases can go either way.
2. **The builder runs the repo's unit tests and guards before it says done.**
   A unit-test job was red at 15% of failed commits and a guard reported in 42
   failing verdicts. This is the same Check one stage earlier, where it costs
   no CI wait. Sure: 85%.
3. **A reviewer that returns quoted findings, not prose.** It is the lesson
   `src/review.ts` already holds. What this adds is the price of not having
   it: a 4,760-character verdict at the median, and no way to count findings
   without a classifier. Sure: 80%.
4. **A docs-left-behind check.** Stale text is in 16% to 24% of failed
   reviews and is the largest kind. Gather the docs that mention a name the
   diff removed or changed, and Judge each sentence. Sure it is worth an
   experiment: 80%. Sure it works: 40%. Test it on the 131 failing verdicts
   labelled stale text, whose links are in the results file.
5. **Hand the builder the decision records that bind its change.** 7% to 14%
   of failed reviews are a conflict with a record. Today only the reviewer
   runs the search. Sure it helps: 50%. Replay ten tickets to find out.
6. **A record-id Check.** Small and certain. 9 reviews by label, up to 61 by
   pattern. An hour of work.
7. **Not yet: anything for the pull request's text.** 18 verdicts were cleared
   by editing text alone. A Check can see a missing section and cannot see a
   false one. It is cheap, and it is last because it is small.

## Run it

```
LANES=<a repo's .fabrika folder> CACHE=<a folder> node experiments/54-why-reviews-fail.ts
```

With no `STEP` it prints every table from the cache and the saved labels. No
key, no network.

- `STEP=fetch` reads every thread once into `CACHE`. `STEP=compare` reads the
  diff between rounds and the check runs at each failed commit. Both use `gh`,
  read-only.
- `STEP=sample` writes the hand-labelled sample's text into `CACHE`, to read.
- `STEP=jev` labels what has no label yet. `DRY=1` prints the cost and stops,
  and `TRY=<n>` labels only the first n of the sample. It needs
  `TYPESAFE_API_KEY`.

`CACHE` holds raw answers from GitHub and is never committed. Three files
are.

- `54-codebook.json`: the codebook, the three questions as Jev got them, and
  every hand label.
- `results/why-reviews-fail-labels.json`: the share Jev gave each choice for
  each item.
- `results/why-reviews-fail.json`: the counts above, and one row per failed
  review with its pull request number and labels.

None of them holds a line of any comment. The marker, the comment's history
and the splitter are tested in `src/verdict.test.ts`, on texts written by
hand.
