# 57. The repeat findings, read by hand: was it really there before?

Experiment 54 said that 181 of 312 placed later-round findings (58%) quote
text that was already in the pull request a round earlier, and that no
earlier review had raised it. That number came from a rule of thumb, and only
six cases were read. A design idea leans on it: the first review writes the
whole list, and later rounds only check the list. So this experiment drew 60
of the 181 at random and read each one against the code at both commits.

**Answer: the 58% does not hold. About half of the 181 were really missed.
That makes "already there and missed" about 31% of placed later-round
findings (24% to 38%), not 58%.**

```text
60 of the 181, drawn with seed 57, read by hand

missed             32   true at the earlier commit, and no earlier review named it
written_by_fix      9   the problem is in lines the repair wrote
new_from_outside    6   the base branch moved: a conflict, no CI
made_by_fix         3   untouched text that the repair made wrong
raised_before       3   an earlier review had named it, in other words
not_a_problem       7   6 of them are not findings at all
cannot_tell         0

missed:  53% of the 60 (41% to 65%)
         x 58% = 31% of the 312 placed findings (24% to 38%)
```

- **Missed is still the largest group, at about a third.** With experiment
  54's other two groups, later-round findings split into three parts of
  about the same size: missed, new since the earlier review, and raised
  before.
- **Half of the 181 had no quote in any file.** The rule never checked that
  their text was "already in the pull request". Their quotes are the
  reviewer's own words. It placed them as "there before" because nothing
  said otherwise.
- **20 of the 32 missed were in a file or part the earlier review says it
  read.** It read the place and passed it. Reading more files would not have
  caught most of these.
- **In 16 of the 32, an earlier review had failed the same kind of fault in
  another place.** A stale count fixed in one page and left in the next.

Jev read the same 60 for $0.0023. Its first choice was my bin in 33 of 60
(55%). It is not a second reader for this question yet.

## Who did what

| Part | Whose |
|---|---|
| Every review, every verdict comment, every repair | today's fabrika, on [kamp-us/phoenix](https://github.com/kamp-us/phoenix) |
| The 181 findings and the rule that placed them (`54-why-reviews-fail.ts`) | tea-fabrika, experiment 54, with one added step that writes them out |
| The draw, the case views, the tables (`57-repeat-findings-read-by-hand.ts`) | tea-fabrika, new here |
| The bins and the 60 readings (`57-readings.json`) | a reader, for this experiment |
| The second reading | Jev, with the same bins as fixed choices |

No lane ran. Nothing was written to GitHub. Git was used read-only, on a
local clone.

## How it was done

**The 181.** I ran experiment 54's script again from its cache. It gave the
same counts: 79 raised before, 52 written by the repair, 181 there before.
I added one step to that script, `ORIGINS=1`, which writes every later-round
finding with its origin, its quotes, its commit and the earlier failed
reviews on the same pull request.

**The draw.** The 181 are sorted by key and shuffled with a fixed seed, 57,
written in the script. The first 60 are the sample. They come from 35 pull
requests and 52 verdict comments.

**What I had for each case.** The finding's text, its round, and the findings
of every earlier failed review on that pull request. For each quote, where it
sits in a file at the earlier commit and at this one. The lines around it at
both commits. The list of files the repair changed, and its diff. For hard
cases I went to the clone and read more: `git show`, `git grep` and
`git merge-base` at the commits in question.

**The bins.** The plan had five. I added two while reading, because two
kinds of case kept turning up that fit none of the five.

| Bin | What it means | From the plan |
|---|---|---|
| `missed` | True at the earlier commit, in the same lines. No earlier review named that place or that behaviour. | yes |
| `made_by_fix` | The text did not change and was right before. The repair made it wrong by changing something else. | yes |
| `written_by_fix` | The problem is in lines the repair wrote, or in what its own merge dropped. | added |
| `new_from_outside` | New at this commit, and not from the repair's lines. The base branch moved. | added |
| `raised_before` | An earlier review named the same place or the same behaviour. | yes |
| `not_a_problem` | It does not block, or it is not a finding at all. | yes, made wider |
| `cannot_tell` | The text and the facts do not settle it. | yes |

Three rules I held to.

- **A new place with an old kind of fault is `missed`, not `raised_before`.**
  Round 1 fails a stale count in one page. Round 2 finds the same stale count
  in another page. Nobody had named the second page, so it is `missed`. I
  marked each of these, so the count can be read both ways.
- **`not_a_problem` covers text that is no finding.** Experiment 54's
  splitter cuts a verdict into numbered items. Some items say an earlier
  finding is now fixed.
- **The same problem can be in the sample twice.** One verdict can state it
  as two items, and two reviewers can post it at one commit. Each is its own
  case, as in the 181.

## The numbers

"New since the earlier review" is the three bins that say the problem did
not exist when the earlier review read the change.

| | Cases | Share of the 60 | 95% interval | Share of the 312 placed |
|---|---|---|---|---|
| Missed | 32 | 53% | 41% to 65% | 31% (24% to 38%) |
| New since the earlier review | 18 | 30% | 20% to 43% | 17% (12% to 25%) |
| Raised before | 3 | 5% | 2% to 14% | 3% (1% to 8%) |
| Not a problem | 7 | 12% | 6% to 22% | 7% (3% to 13%) |
| Cannot tell | 0 | 0% | 0% to 6% | 0% (0% to 3%) |

The interval is Wilson's, at 95%. The last column is the share times
181/312, with the interval scaled the same way. It treats 181 and 312 as
fixed.

Two checks on that interval.

- **Findings come in clumps.** Wilson counts each case as its own draw, and
  the 60 sit on 35 pull requests. Redrawing whole pull requests 10,000 times
  gives 38% to 68% for missed. A little wider, the same middle.
- **The draw was short on one kind.** In 91 of the 181, git finds a quote in
  a file at the earlier commit. The draw holds 23 of those, where 30 would
  be even. Those are the cases most often missed. Weighing the two halves
  by their real size gives 58% of the 181 (47% to 70%), which is 34% of the
  312 (27% to 40%).

So the best number is **about a third: 31% by the plain count, 34% weighed,
and somewhere from 24% to 40%.** Experiment 54 said it was about 60% sure
the true share was over 40%. It is not over 40%.

### Where the rule went wrong

The rule placed a finding as "there before" when its quote was not in the
earlier verdict and not in a line the repair added. It did not ask whether
the quote was anywhere in the pull request.

| What git says | Cases | Missed | New since | Raised before | Not a problem |
|---|---|---|---|---|---|
| A quote is in a file at the earlier commit | 23 | 18 (78%) | 3 | 1 | 1 |
| No quote is in a file at either commit | 37 | 14 (38%) | 15 | 2 | 6 |

Over all 181, with no reading: 91 have a quote in a file at the earlier
commit, and 90 have no quote in any file at either commit. Only 4 have a
quote in a verdict of any earlier round, so looking further back than one
round would not have moved them.

Where a quote was found, the rule was right four times in five. Where none
was found, it was a coin with a bias the wrong way. A rule that asks for the
quote in a file first would be a much better rule.

### The 18 that were new

- **Written by the repair: 9.** The repair rewrote the code and the finding
  is in the rewrite. The rule missed these because the finding described the
  new code in its own words and quoted none of it.
- **New from outside: 6.** The pull request conflicts with its base branch,
  so GitHub runs no checks, and the reviewer fails the round on that. Or
  files that landed on the base branch no longer compile against the change.
  No review could have raised these earlier, and no builder caused them.
- **Made by the repair: 3.** The kind experiment 54 warned about. It is real
  and it is small.

### The 7 that were not problems

Six are not findings. The text reports that an earlier finding is fixed, or
that a check passed. One is a note the reviewer calls out of scope. So about
one in ten of the 181 is the splitter's error, not a review finding.

### Close calls

Four of the 60, and none of them moves the headline by more than one case.

- Three sit between `written_by_fix` and `new_from_outside`. The repair
  merged the base branch, and the merge brought the problem in. Both bins are
  "new since".
- One sits between `missed` and `made_by_fix`. The pull request's own text
  repeats a claim that round 1 failed in the code. The repair fixed the code
  and left the text. I counted it as missed, because the text was wrong at
  round 1 for the same reason.

I used `cannot_tell` for none. Each case could be settled from the two
commits, and I checked the hard ones in the clone before deciding.

## The 32 that were missed

What each was about, and whether an earlier review's own text names that
file or part, or says it read it.

| About | Cases | An earlier review read it | Did not | Unclear | Same kind of fault failed elsewhere before |
|---|---|---|---|---|---|
| Docs | 17 | 12 | 5 | 0 | 12 |
| Code | 12 | 7 | 3 | 2 | 1 |
| Tests | 1 | 0 | 1 | 0 | 1 |
| The pull request's text | 2 | 1 | 0 | 1 | 2 |
| All | 32 | 20 | 9 | 3 | 16 |

"Docs" are skill pages, contracts and READMEs. "Read it" means any earlier
review, not only the first. I could not always tell which review was the
first to read a file.

- **29 of the 32 were already wrong in the first commit that was reviewed.**
  Two came in with an earlier repair. One I could not date.
- **Docs are the larger half, and they are the "same fault, another place"
  kind.** 12 of 17. A change renames a thing or changes a count. The first
  review finds two pages that still say the old thing. The next review finds
  a third.
- **Code is the other kind.** 11 of 12 are a fault nobody had raised in any
  form. In 7 of the 12 an earlier review cites the file and passes it.
- **Without the "another place" cases, 16 are left.** That is 27% of the 60
  (17% to 39%) and 15% of the 312 (10% to 23%). These are findings that no
  list from round 1 would have held, however widely it was worded.

By round and by reviewer the sample is thin. Round 2 has 17 missed of 34,
round 3 has 6 of 13, round 4 and later has 8 of 11. The skill reviewer has
12 missed of 15, the code reviewer 16 of 35.

## Four cases in full

**Missed.**
[#9305](https://github.com/kamp-us/phoenix/pull/9305#issuecomment-5701554701),
round 2, the code reviewer.

> `--class`'s help text states the opposite of what the flag does

The help string says "an omitted class is kept rather than cleared". The
code beside it replaces the whole set. The repair between the two rounds
changed three files: two decision records and a skill page. The file with
the help string is not one of them, and the line of code the finding quotes
is the same line at both commits. Round 1's code review ended with the
reason "no code finding". It was there, and round 1 passed it.

**Written by the repair.**
[#10205](https://github.com/kamp-us/phoenix/pull/10205#issuecomment-5899310852),
round 2, the code reviewer.

> `--help` documents the mode, and it now does so accurately [...] But this
> help text fails the repo's own leaf-help ratchet

Round 1 said the help text was wrong in two places. The repair rewrote it,
and the new text broke a check on the size and shape of help text that the
old one had passed. Git finds neither of the finding's two quotes in any
file, because both are the reviewer's own sentence. With nothing to place,
the rule called it "there before".

**Made by the repair.**
[#6653](https://github.com/kamp-us/phoenix/pull/6653#issuecomment-5361210292),
round 2, the governance reviewer.

> `operate`'s capability fence no longer bounds what the skill writes

A skill page lists every write the operator may make. Round 1's code review
asked for a way to migrate lanes that were already running. The repair added
a command that rewrites a lane's file on disk. The list did not change, and
now it leaves out a write the skill makes. The list was right at the
earlier commit. No first review could have put this on a list.

**Not a finding.**
[#6690](https://github.com/kamp-us/phoenix/pull/6690#issuecomment-5364011500),
round 2, the code reviewer.

> **Finding 3 — the file-wide licence in the `no-gh` sanction: CLEARED.**

The verdict walks through round 1's four findings and says which are fixed.
The splitter cut each as an item, and the rule placed this one as a finding
that was "there before".

Two more, in a line each. **Raised before:**
[#10018](https://github.com/kamp-us/phoenix/pull/10018#issuecomment-5859681137)
says "the repair renamed the file but not the record", and round 1 had
failed on that record's id. None of its quotes are in round 1's verdict,
because the words are new. **New from outside:**
[#6653](https://github.com/kamp-us/phoenix/pull/6653#issuecomment-5361476030)
fails round 3 because the pull request conflicts with `main`, "so GitHub
builds no merge ref" and no check ran.

## Jev on the same 60

I asked Jev one question per case, with the seven bins above as the fixed
choices, in the same words as `57-readings.json`.

It got the least text I thought could carry the answer. The finding, cut at
700 characters. The reason line of its verdict. The reason line and first
four findings of up to six earlier failed verdicts, each cut at 160
characters. Seven counts from git: how many quotes are in a file at the
earlier commit, how many in a file the repair changed, how far the nearest
changed line is, and how many files the finding names and the repair
changed. No file text and no diff.

The estimate before the first call was 60 calls and $0.0023. I ran five,
looked, and ran the other 55 with nothing changed. **60 calls, about 54,000
tokens sent, $0.0023.** The limit was $2.

| Bin by hand | Cases | Jev's first choice is the same | Share Jev gave that bin |
|---|---|---|---|
| `missed` | 32 | 18 (56%) | 0.45 |
| `written_by_fix` | 9 | 3 (33%) | 0.24 |
| `new_from_outside` | 6 | 5 (83%) | 0.77 |
| `made_by_fix` | 3 | 0 (0%) | 0.20 |
| `raised_before` | 3 | 3 (100%) | 0.91 |
| `not_a_problem` | 7 | 4 (57%) | 0.44 |
| All | 60 | 33 (55%) | 0.46 |

- **It says "raised before" far too often.** 18 times, where I have 3. It
  read 9 of my `missed` cases that way. In 6 of those 9 an earlier review
  had failed the same kind of fault in another place. Jev sees the earlier
  finding and this one talk about the same thing, and cannot see that the
  place is new. The rule I held is the one it does not follow.
- **It cannot tell a repair's new lines from old ones.** 4 of 9
  `written_by_fix` cases went to `raised_before` and 2 to `missed`. It had
  no diff, so this is the text I gave it more than its reading.
- **It is good where the finding says the cause.** A conflict with the base
  branch is written in the finding, and Jev got 5 of 6.
- **Its count of missed is lower than mine.** 23 of 60, 38% (27% to 51%),
  against 32. Its errors do not cancel.
- **When it is sure it is mostly right, and it is rarely sure.** It gave its
  first choice 0.8 or more on 17 of 60. On those, 14 match (82%). All three
  that do not are `missed` read as `raised_before`.

So Jev, on this text, would not have given the same answer as the reading.
Two things could change that, and neither was tried here: give it the diff
of the repair, and split the question in two so that "same place?" is asked
by itself.

## What this says for the review list idea

[A review list can only shrink](../docs/direction/a-review-list-can-only-shrink.md)
has the first review write the whole list, and later rounds check only that
list and the lines the repair wrote.

- **The saving is smaller than it looked, and still the largest single
  one.** About a third of placed later-round findings were there at the
  earlier review, not 58%.
- **A wide first list would catch about half of that third.** 16 of the 32
  missed are the same kind of fault in a new place. A list item worded as
  "every place that states the old count" covers them. An item worded as
  "this page, this line" does not.
- **The other half is harder.** 16 of 32 are faults nobody raised in any
  form. 11 are in code, and 12 are in a file or part an earlier review says
  it read. A rule that later rounds may not raise them does not make them
  go away. It ships them.
- **"Only the lines the repair wrote" is a little too narrow.** 3 of 60 are
  untouched text that the repair made wrong. A later round has to be allowed
  to read what the repair's change touches, not only the lines it added.
- **Six of 60 are a Check, not a review.** A conflict with the base branch
  and a head with no CI run are facts that code can read before any reviewer
  starts.

## What agrees and disagrees with experiment 54

- **Agrees:** the rule's 79, 52 and 181 come out the same from the cache.
- **Agrees:** experiment 54 said a sentence can be untouched and still
  become false because of the repair, and that a conflict with the base is
  nobody's miss. Both are in the sample: 3 and 6 of 60.
- **Disagrees:** "more than half of the findings in a later round quote text
  that was already in the pull request one round earlier". For half of the
  181 no quote is in any file. About a third of placed findings were already
  there and missed.
- **Disagrees:** its guess that the true share is over 40%.
- **New:** about one in ten of the 181 is not a finding. That is the
  splitter of `src/verdict.ts` cutting a "this is now fixed" line as an
  item, and it will be in experiment 54's other counts of findings too.

## What this cannot tell us

- **Whether the other 131 are placed right.** I read only the "there
  before" group. Some of the 79 "raised before" and the 52 "written by the
  repair" may be wrong too, in either direction. The "third, third, third"
  picture rests on those two counts as experiment 54 left them.
- **Anything about the 95 findings that quote nothing.** They were never
  placed and are in neither number.
- **Whether a finding was right.** I checked that the text a finding points
  at was there and read as it says. I did not check that the reviewer's
  judgment of it was correct.
- **Whether the first review could have found it at a fair cost.** "Could
  have raised it" means the fault was in front of it. It does not mean a
  reviewer with a fixed budget would have got to it.
- **How another reader would bin them.** One reader, one pass. The line
  between `missed` and `raised_before` is a rule I chose, and the 16 marked
  cases show how far the count moves if it is drawn the other way.
- **Whether "an earlier review read it" is true.** I took the verdict's own
  word. A verdict that says it read a file whole may not have.
- **What the pull request's text said at an earlier round.** GitHub shows
  today's text. Two cases rest on a reviewer's word for what it said before.
- **Another repo.** Phoenix's skill pages and contracts are the product, and
  17 of the 32 missed are in them.
- **Whether Jev can do this with more text.** It was given the least.

## Run it

```
node experiments/57-repeat-findings-read-by-hand.ts
```

With no `STEP` it prints every table from the readings and the saved
answers. No key, no network, no cache.

- `STEP=cases` draws the sample and writes each case's text into
  `CACHE/exp-57`, to read. It needs `CACHE`, which is experiment 54's cache
  folder after a run of `54-why-reviews-fail.ts` with `ORIGINS=1`, and
  `CLONE`, a local clone of the repo that holds the reviewed commits. It
  reads git and writes nothing to it.
- `STEP=jev` asks Jev about the cases that have no answer yet. `DRY=1`
  prints the cost and stops, and `TRY=<n>` asks only the first n. It needs
  `TYPESAFE_API_KEY`, `CACHE` and `CLONE`, and stops before $2.

`CACHE` holds raw answers from GitHub and is never committed. Two files are.

- `57-readings.json`: the bins as Jev got them, and the reading of each
  case with one or two sentences of reason.
- `results/repeat-findings-read-by-hand.json`: one row per case with its
  link, its two commits, what git says about its quotes, its bin and reason,
  and the share Jev gave each bin. Then the counts above.

Neither holds a line of any comment.
