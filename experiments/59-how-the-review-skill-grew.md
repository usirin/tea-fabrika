# 59. How fabrika's review skill got so big

Today's fabrika tells its reviewer what to do in six text files: a skill page,
a command manual, three rubrics and an agent file. Together they are 3,038
lines. This experiment reads the whole git history of that text, and the text
itself at one commit, to find out how it got that way. The point is to learn
what to guard against here, before this repo's own review stage has a history.

**Answer: nobody wrote a big messy skill. It was a small one, and about 1.6
changes a day were added to it, each one sensible. Almost nothing was ever
taken out. A full rewrite cut it by 71%, and 57 days later it was back to 77%
of the old size. I am about 90% sure of that story, because it is counted from
git. The causes and the piles below are one reader's sorting, and I am about
75% sure of those shares.**

```text
lines of review text at the end of each week      o = 200 lines, four old gates
                                                  m = 200 lines, merged /review
2026-06-08    854  oooo
2026-06-15  2,645  ooooooooooooo
2026-06-22  2,817  oooooooooooooo
2026-06-29  3,351  ooooooooooooooooo
2026-07-06  3,523  oooooooooooooooooo
2026-07-13  3,783  ooooooooooooooooooo
2026-07-20  4,349  oooooooooooooooooooooo        the most the old gates ever held: 4,394
2026-07-27  3,944  oooooooooooooooooooo          shell moved out of the pages into scripts
2026-08-03  4,008  oooooooooooooooooooo  + mmmmmm   1,298   the rewrite is born at 1,142
2026-08-10  4,088  oooooooooooooooooooo  + mmmmmmm  1,366
2026-08-17      0                          mmmmmmmm  1,650   the old gates are deleted
2026-08-24                                 mmmmmmmmm  1,837
2026-08-31                                 mmmmmmmmmm  2,034
2026-09-07                                 mmmmmmmmmmm  2,171
2026-09-14                                 mmmmmmmmmmmmm  2,650
2026-09-21                                 mmmmmmmmmmmmmm  2,788
2026-09-28                                 mmmmmmmmmmmmmmm  3,032
2026-10-05                                 mmmmmmmmmmmmmmm  3,038   the text studied
```

- **It only goes up.** 212 commits touched the review text in four months.
  16 of them left it smaller. The merged skill was never smaller at the end of
  a week than the week before.
- **Every real cut moved text into code, or into one shared place, or deleted
  a whole feature.** I found no commit that removed a rule because it was no
  longer needed.
- **Two thirds of the changes came from outside the review stage.** Another
  stage, the lane machine, the shell the agent runs in, or a sweep over the
  whole plugin.
- **About a tenth of the text is judgment.** 62.8% is facts that code already
  holds: what a command takes, prints and refuses. 15.3% is the reason for a
  rule, mostly the story of the run that went wrong.
- **70% of the text serves steps that code can do alone.** The steps only a
  reader can do get 9.4%.
- **The text names its own rot as a finding, and rots anyway.** A rule in
  prose did not hold. That is the main lesson for this repo.
- **This repo has started the same way in three places.** Prompts here grow
  by one sentence per bad run and are never cut. See section 6.

## Who did what

Everything studied is **today's fabrika**: its text in the public repo
[kamp-us/phoenix](https://github.com/kamp-us/phoenix), read out of git. The
text is pinned to commit `0ac2c6bfc342b8d18918b78150a8b95c43233496`. The
issues named below are public issues of that repo.

**This repo's** part is the script, the hand labels in `59-readings.json`,
and the tables about this repo's own files in section 6. No agent ran. No
model was called and no key was used. Git was read only.

## How it was done

The script takes a full-history clone and follows each file through every
place it has lived. There are two generations.

- **The four old gates.** `review-code`, `review-doc`, `review-skill` and
  `review-trivial`, one `SKILL.md` each, from 2026-06-12 until they were
  deleted on 2026-08-19.
- **The merged skill.** `/review`: `SKILL.md`, `contract.md`, three rubric
  files, and later an agent file. Born 2026-08-09.

Three things were sorted by hand, by one reader, in one pass:

- **A cause for each of the 92 commits to the merged skill**, from its title,
  the type label of its issue and the opening of that issue. The 120 commits
  to the old gates were not opened one by one. They are counted by the word
  their title starts with, which is a weaker record.
- **A pile for every one of the 3,038 lines**, by paragraph, and inside a long
  paragraph by sentence, rounded to whole lines.
- **The rules found in more than one place**, noted while sorting the piles.

Dates are UTC days. The birth commit is 2026-08-09 01:22 UTC, which was still
the evening of 08-08 where it was written.

If the clone is shallow, the script says so in its first lines, because the
answer is then cut short. It prints what it can and saves nothing.

## 1. How big, and how it grew

**Sure: about 95%. These are counts from git.**

| File | Born | Commits | Lines at birth | Lines at the end | Commits that left it smaller |
|---|---|---|---|---|---|
| old `review-code/SKILL.md` | 2026-06-12 | 97 | 285 | 1,625 | 8 |
| old `review-doc/SKILL.md` | 2026-06-14 | 70 | 439 | 1,160 | 4 |
| old `review-skill/SKILL.md` | 2026-06-16 | 50 | 591 | 924 | 5 |
| old `review-trivial/SKILL.md` | 2026-06-29 | 15 | 317 | 378 | 2 |
| `SKILL.md` | 2026-08-09 | 62 | 145 | 822 | 3 |
| `contract.md` | 2026-08-09 | 58 | 887 | 2,012 | 3 |
| `rubrics/code.md` | 2026-08-09 | 5 | 42 | 57 | 0 |
| `rubrics/doc.md` | 2026-08-09 | 6 | 32 | 46 | 0 |
| `rubrics/skill.md` | 2026-08-09 | 10 | 36 | 90 | 0 |
| `agents/reviewer.md` | 2026-08-15 | 2 | 12 | 11 | 1 |

The size after every single commit (date, lines, added, removed) is in
`results/review-skill-growth.json`, 375 rows. The table above is its summary.

Taken as two wholes:

- **Old gates:** 120 commits in 66 days. 6,582 lines added, 2,495 removed.
  285 lines on the first day, 4,394 at the most, 4,087 on the last.
- **Merged skill:** 92 commits in 57 days. 3,951 lines added, 913 removed.
  1,142 lines on the first day, 3,038 at the commit studied. That is about
  230 lines a week. The page the agent reads first, `SKILL.md`, grew from 145
  lines to 822.
- **The rewrite:** the old gates held 3,944 lines the day the merged skill was
  born at 1,142. That is 71.0% less. 57 days later it is 77.0% of that old
  size.

### The biggest jumps

In the old gates, the three biggest are new gates being born: `review-skill`
(+637), `review-doc` (+439) and `review-trivial` (+317). After those:

- +149, a required "Deviations" section in every pull request, checked by
  every gate.
- +117, one fan-out rule wired into three gates at once.
- +115, a check that a new feature also touches the glossary.
- +108 twice, verdicts tied to the commit they were written for.

In the merged skill, after its birth:

- **+162, 2026-09-17.** A reviewer of an epic child graded a working copy that
  was not the commit under review, and caught it by luck
  ([#8893](https://github.com/kamp-us/phoenix/issues/8893)). A new command
  and its rules.
- **+111, 2026-10-04.** Review could not read the author reports its criteria
  asked for ([#8924](https://github.com/kamp-us/phoenix/issues/8924)).
- **+105, 2026-08-29.** A reviewer's temp file was overwritten by another
  lane while it was being read
  ([#7246](https://github.com/kamp-us/phoenix/issues/7246)).
- **+90, 2026-09-20.** A ruling posted as a comment never reached the
  reviewer ([#9517](https://github.com/kamp-us/phoenix/issues/9517)).
- **+89, 2026-09-21.** Filtering noisy diffs.
- **+79, 2026-08-21.** Review and ship disagreed on which kinds of review a
  change needs ([#6664](https://github.com/kamp-us/phoenix/issues/6664)).
- **+74, 2026-08-29.** A reviewer's waiting loop outlived its run
  ([#7260](https://github.com/kamp-us/phoenix/issues/7260)).

Six of these seven are a real run that went wrong. No single jump is large.
The biggest is 5% of today's size. **The size is the sum of many small
additions, not of a few big ones.**

### The commits that shrank it

16 of 212. Old gates: 11 of 120 (9.2%). Merged skill: 5 of 92 (5.4%). Six of
them are cuts of one line. What made the real ones possible:

- **Shell moved out of the page into scripts** (−186, −143, −16;
  [#4451](https://github.com/kamp-us/phoenix/issues/4451),
  [#4453](https://github.com/kamp-us/phoenix/issues/4453)). The page kept the
  call and lost the code.
- **One shared text hosted outside the gates** (−175). The same reference had
  been pasted into several gates.
- **Glue pulled into one command** (−19, −11, −20).
- **A whole feature deleted** (−34): the eval tooling and its section.
- **A ruled rewrite, "instructions only"** (−12;
  [#5502](https://github.com/kamp-us/phoenix/issues/5502)). The same day
  another commit put seven rules back that had gone out with it
  ([#5530](https://github.com/kamp-us/phoenix/issues/5530)).

So text left in exactly three ways: into code, into one shared home, or
together with a deleted feature. The one clean-up that tried to cut by reading
lost rules it did not mean to lose. **I am about 85% sure no commit removed a
rule as "no longer needed".** I read the titles and diffs of all 16.

### Agents wrote most of it

A commit counts when its message carries an agent's co-author line. Old gates:
107 of 120 (89.2%). Merged skill: 41 of 92 (44.6%). This is a floor. A squash
merge can drop the line, and I guess that is why the second number is lower.
No person or account is named anywhere in the script or its saved files.

### The marks were wiped

The first plan was to count the patch marks a fix leaves in the text: an issue
number, a decision record number, the word "never". That works only up to
2026-09-01.

| Moment | Lines | Issue numbers | Decision record numbers | "never" | "epic child" | Another stage, by name |
|---|---|---|---|---|---|---|
| old gates, last day | 4,087 | 252 | 217 | 280 | 0 | 2 |
| merged skill, first day | 1,142 | 47 | 29 | 67 | 0 | 2 |
| before the sweep | 2,034 | 122 | 45 | 146 | 3 | 42 |
| after the sweep | 2,061 | 6 | 12 | 148 | 3 | 41 |
| at the commit studied | 3,038 | 5 | 11 | 225 | 16 | 70 |

One sweep took the issue numbers out so the plugin could be installed in
another repo ([#8281](https://github.com/kamp-us/phoenix/issues/8281)). It
removed the pointer and kept the sentence. So the text today looks clean and
is not. What still shows: "never" 225 times, one every 13 lines, and another
stage named 70 times where the first day had 2.

## 2. Why each piece was added

**Sure: about 75% for each label, one reader. The order of the bins is safer
than the exact shares.**

Merged skill, all 92 commits, each sorted from its issue:

| Cause | Commits | Of them from outside the stage | Share of lines added after birth | Today's lines last touched by it |
|---|---|---|---|---|
| A real run went wrong (a lesson) | 34 | 16 | 48.5% | 37.8% |
| A fault found by reading, no failed run named | 21 | 17 | 20.6% | 12.7% |
| A new pipeline feature | 16 | 13 | 10.8% | 33.9% |
| Wording or format | 7 | 7 | 12.7% | 10.0% |
| The text had stopped matching the code | 7 | 1 | 6.0% | 4.7% |
| A move, a rename or a removal | 6 | 6 | 1.0% | 0.8% |
| Other | 1 | 1 | 0.4% | 0.2% |

- **Half of the growth is lessons.** Add the faults found by reading and it is
  69%. New features are 11%. The feature row's 33.9% of today's lines is
  mostly the birth commit, which still holds 826 lines (27.2%).
- **From outside the stage: 61 of the 91 commits after birth (67.0%)**, and
  51.3% of the lines they added. "Outside" means the change came from another
  stage, the lane machine, the shell the agent runs in, or a sweep over the
  whole plugin.
- **The last column is weak.** It is `git blame`, and the sweep above
  re-touched 233 lines it did not write.

Old gates, 120 commits, from the title alone: `fix` 60 (50.0%), `feat` 28,
`refactor` 12, `docs` 8, `chore` 7, other 5. The 12 refactors are the only
kind that removed more than they added (+749, −1,213). As a check, the same
count on the merged skill gives `fix` 48 of 92 (52.2%), close to the hand
count of 55 lessons and faults.

## 3. What the text is made of

**Sure: about 75%. The two big piles are safe to within about five points. The
line between "manual" and "inside" is the soft one.**

The brief asked for three piles: flow, facts code can see, and judgment. A
real share fit none of them, so there is a fourth, **why**. And the facts pile
is shown in two halves, because they call for different guards.

- **flow**: what to do next, in what order, when to stop.
- **manual**: a fact code holds, as a caller meets it. What a command takes,
  prints and refuses, its exit codes, its error messages, its examples.
- **inside**: a fact code holds, from the inside. How a command works out its
  answer, which source file does it, how another part will react.
- **judgment**: how to grade, and what counts as what.
- **why**: the reason for a rule. The story of the run that went wrong, what
  the old version did, the option that was turned down.
- **other**: titles, frontmatter, pointers.

| File | Lines | flow | manual | inside | judgment | why | other |
|---|---|---|---|---|---|---|---|
| `SKILL.md` | 822 | 305 (37.1%) | 177 (21.5%) | 101 (12.3%) | 132 (16.1%) | 93 (11.3%) | 14 |
| `contract.md` | 2,012 | 0 | 1,213 (60.3%) | 417 (20.7%) | 0 | 363 (18.0%) | 19 |
| `rubrics/code.md` | 57 | 5 | 0 | 0 | 47 (82.5%) | 4 | 1 |
| `rubrics/doc.md` | 46 | 10 | 0 | 0 | 35 (76.1%) | 0 | 1 |
| `rubrics/skill.md` | 90 | 7 | 0 | 0 | 76 (84.4%) | 6 | 1 |
| `agents/reviewer.md` | 11 | 0 | 0 | 0 | 0 | 0 | 11 |
| all six | 3,038 | 327 (10.8%) | 1,390 (45.8%) | 518 (17.1%) | 290 (9.5%) | 466 (15.3%) | 47 (1.5%) |

**So: flow 10.8%, facts code holds 62.8%, judgment 9.5%, why 15.3%.**

The rubrics are small (193 lines in all) and are four fifths judgment. They
are the healthy part. `contract.md` holds no flow and no judgment at all: it
is a manual for a command line, written by hand beside the code.

Each line also got at most one tag for what it is about:

- **epic**: the epic child, the second shape of a review. 289 lines (9.5%).
- **outside**: another stage, the lane machine, or a rule of the whole plugin.
  272 lines (9.0%), and 21.0% of `SKILL.md`.
- **harness**: the shell the agent runs in. Its timeouts, its command checker,
  its shared temp folder. 222 lines (7.3%).
- **case**: another special case, such as trivial mode or filtering. 110
  lines (3.6%).
- **size**: there because the texts are too big to read whole. 45 lines
  (1.5%).

**56.8% of `SKILL.md` carries one of these tags.** Less than half of the page
the reviewer reads first is about the plain case of its own job. A line has
one tag at most, so the tags undercount.

Where it was hard: one paragraph often holds a step, the command for it, the
exit code it refuses on and the run that made the rule. I split those by
sentence. `contract.md` was sorted mostly by its own bold labels (Invocation,
Inputs, Output, Exit status, Errors, Examples went to manual; Grounding went
to why).

## 4. The same rule in several places

**Sure: about 85% that each one listed is real. The list is not a full
search, so the true number is higher.**

15 rules are stated in 64 places. 442 lines (14.5%) state a rule that is also
stated somewhere else.

| Rule | Places | Files | Lines in all |
|---|---|---|---|
| A round that adds a criterion must end FAIL (exit 18) | 8 | 2 | 27 |
| A second post adds below the first, never replaces it (exit 17) | 8 | 2 | 34 |
| A marked criterion is graded on the evidence it names (exit 19) | 7 | 3 | 32 |
| Fire governance before waiting on the checks | 6 | 2 | 55 |
| Do not run again what the checks already enforce | 6 | 4 | 35 |
| The portability check on fabrika's own text | 5 | 5 | 41 |
| Never judge or post the rendered kind of review | 5 | 2 | 50 |
| Read a skill file whole, a contract one heading at a time | 3 | 2 | 28 |

The other seven are in the script's output. Three of the top four are rules
the command line already refuses with an exit code. The rule is in code, and
then in prose up to eight times.

Places that disagree. Each is the text against a count the script makes:

- The birth commit calls it "the 8-verb contract". `contract.md` has 12
  command sections today.
- `contract.md` says "All nine verbs allocate from one internal table"
  ([line 136][c-nine]). Its own list of commands has 11 rows, and the exit
  table under that sentence has 8 command columns.
- The same sentence says a code means one thing across the group, from that
  shared table. Codes 20 and 21 are used in the page and are not in the
  table.
- The last section of `contract.md` says the eval rule is stated once, in
  `SKILL.md`'s "Eval enumeration" section ([lines 2009-2012][c-eval]).
  `SKILL.md` has no such section. The eval tooling was deleted on 2026-08-13.
- `contract.md` still says the four old gates "remain live" and that nothing
  routes to this skill ([lines 107-113][c-name]). They were deleted on
  2026-08-19, and this skill is the only reviewer.
- Its header says "Date: 2026-08-08". 58 commits have changed the page since.
- `SKILL.md` says "one lane's four verdicts" beside a list of three names
  ([lines 637-638][s-four]).
- `SKILL.md` says "No class re-executes what CI enforces" as a flat rule
  ([line 370][s-noclass]). On an epic child the same page tells the reviewer
  to move its working copy and run the typecheck and the tests
  ([lines 219-228][s-seat]). `contract.md` knows, and spends 13 lines saying
  why this is "narrower than the posture it looks like it reverses"
  ([lines 64-76][c-seat]).

## 5. The rot patterns

Nine. The shares overlap: piles and tags are two cuts of the same lines, so
they do not add up to 100.

### 1. Every bad run leaves its story in the text

> One lane reported `UNKNOWN` on a malformed criteria heading seconds before
> its own first FAIL, landed three FAILs at head, and could record none of
> them: exit `12`, `no update cell for msg.type "FAIL" in state "blocked"`,
> leaving a ledger that read a wait on a human over a PR that needed a repair
> round.

[`SKILL.md` lines 676-679][s-story]. The rule is one line: report once per
run. The story is four.

- **Share:** the why pile, 466 lines (15.3%), and 18.0% of `contract.md`.
  Lessons are 48.5% of the lines added after birth.
- **What started it:** a fix to a stage an agent runs is a sentence. The story
  is kept beside it so the next editor will not delete the rule. It was there
  on the first day: the birth text names the old version 24 times.

### 2. The command's manual is written by hand, beside the code

> `review post --polarity PASS --round <n>` refuses that pair on `18` and
> names the row, so the choice is yours to make deliberately

[`SKILL.md` lines 485-488][s-manual]. Code already refuses the bad move. The
text tells the agent as well, with the number.

- **Share:** the manual pile, 1,390 lines (45.8%). It is the biggest thing in
  the text. With "inside" it is 62.8%.
- **What started it:** `contract.md` was born as the written spec of eight
  commands, 887 lines on the first day. Every new refusal in code then added
  an exit row, an error text and an example to it. Nothing made from the code
  keeps it true, which is why the counts in section 4 are off.

### 3. One rule, many homes

> The reason is stated once at the end of this section and once in §6, both
> below — this line exists only so a reader running fences in order meets the
> order before the fence rather than after it.

[`SKILL.md` lines 364-368][s-homes]. The text says out loud that this is the
third place.

- **Share:** 442 lines (14.5%), a floor.
- **What started it:** the page was already so long that a rule 50 lines from
  the step it governs was as good as missing
  ([#7431](https://github.com/kamp-us/phoenix/issues/7431)). The fix was to
  say it again nearer. Length made repeats, and repeats made length.

### 4. Other stages leak in

> With nothing standing, the routed namespace is owed **here** — exit `23`
> naming it, with the flag as the remedy. With a stale `ui` standing over a
> text-only head, the arm is taken instead and the refusal is exit `67`, whose
> remedy is that same relay.

[`SKILL.md` lines 769-772][s-leak]. This is how the lane machine and the
rendered review split a proof between them. The text reviewer has to carry it.

- **Share:** 272 lines tagged outside (9.0%), and 21.0% of `SKILL.md`. 61 of
  the 91 commits after birth came from outside.
- **What started it:** review is where other stages meet. Ship reads its
  verdicts, the operator reads its ending, the lane machine proves it. Each
  time two of them disagreed, the reviewer was told
  ([#6664](https://github.com/kamp-us/phoenix/issues/6664) is the clearest).

### 5. Special cases are stacked on the main path

> **On an epic child, seat your worktree at the range tip before you run
> anything that reads the working tree.** A child's build branch is local and
> unpushed by design — one epic run is one branch and one PR at the tail

[`SKILL.md` lines 219-221][s-seat]. An epic child has no pull request, so
almost every step has a second form for it, written as a paragraph that begins
"On an epic child".

- **Share:** epic 289 lines (9.5%) plus other cases 110 (3.6%). "epic child"
  appears 16 times today and 0 times on the first day.
- **What started it:** a new way to run (one pull request for a whole epic,
  2026-08-19) was added as exceptions to the old page. The biggest jump in the
  merged skill's life (+162) is one of them.

### 6. The agent's shell leaks into the stage's text

> **On Claude Code, that deadline is the Bash tool's `timeout`, in
> milliseconds, and it has a ceiling you cannot ask past.** That ceiling is
> `600000` ms, raised only when the environment sets `BASH_MAX_TIMEOUT_MS`
> above it

[`SKILL.md` lines 455-458][s-harness]. Other examples: why `$pr_number` may be
blank ([lines 23-28][s-blank]), and why a command may not use a shell variable
([lines 321-327][s-var]).

- **Share:** 222 lines tagged harness (7.3%), and 13.0% of `SKILL.md`.
- **What started it:** the agent runs the commands itself, in a shell with its
  own limits. Each limit was met in a real run and written into the page of
  the stage that met it ([#7260](https://github.com/kamp-us/phoenix/issues/7260),
  [#9104](https://github.com/kamp-us/phoenix/issues/9104)).

### 7. Nothing is taken out, so leftovers stay

> The four v1 gates (`review-code`, `review-doc`, `review-skill`,
> `review-trivial`) remain live project-level skills until the cutover, which
> is separate, later work; until then nothing on `main` routes to this skill

[`contract.md` lines 110-112][c-name]. False since 2026-08-19.

- **Share:** small in lines. It shows in the counts: 5 of 92 commits left the
  merged skill smaller, and the leftovers in section 4 are still there.
- **What started it:** adding is safe and removing is not. Every rule has a
  past failure behind it, so nobody can tell from the text which one is safe
  to drop. The one size limit the plugin had was deleted because it could not
  be enforced ([#4701](https://github.com/kamp-us/phoenix/issues/4701)).

### 8. Size makes more text

> A `SKILL.md` in this tree runs past 40 KB, so this is the common case, not
> the rare one

[`SKILL.md` lines 350-351][s-size]. A rule about how to read a text that is
too big to read.

- **Share:** 45 lines tagged size (1.5%). Small, and it feeds itself.
- **What started it:** the texts got big enough to cost a run. Contracts
  reached 70 to 118 KB
  ([#6092](https://github.com/kamp-us/phoenix/issues/6092)). One lane used all
  three of its repair rounds on a different stale sentence each time, in the
  same two skill files
  ([#9314](https://github.com/kamp-us/phoenix/issues/9314)). The fix for that
  was 47 more lines. Experiment 54 saw the other side of it: many failed
  reviews were about a doc or skill page that no longer matched the code.

### 9. A rule against rot, written in prose, does not hold

> a `SKILL.md` that inlines what its `contract.md` owns is over-long however
> few lines it is

[`rubrics/skill.md` lines 45-46][r-size]. The same rubric lists as findings
"one meaning kept in two homes" and "a rule steered by prohibition where the
positive target would land harder" ([lines 87-88][r-homes]). The review skill
is graded by this rubric when it changes. It has 15 rules in 64 homes and says
"never" 225 times.

- **Share:** none to count. It is the reason the other eight were not stopped.
- **What started it:** the guard was given to a reader. One more example: two
  lanes writing the same temp file. The old gates' text was fixed for it six
  times between 2026-06-14 and 2026-07-26. The merged skill then said the
  problem was removed "by construction" ([`contract.md` lines 49-51][c-tmp]).
  It came back on 2026-08-29
  ([#7246](https://github.com/kamp-us/phoenix/issues/7246)).

## 6. The guards

**Every guard below is a proposal. None is decided and none is built.** For
each pattern: what this repo already has that blocks it, what it does not
have, and one thing worth trying.

### 1. Stories in the text

- **Blocks it already:** `AGENTS.md` sends what happened on a real ticket to
  `field/` and a measurement to `experiments/`. So the story has a home that
  is not a prompt.
- **Does not:** nothing stops a sentence being added to a prompt. The
  builder's prompt in `src/claude.ts` already holds some, such as "Never
  weaken working code to fit a test."
- **Proposal:** a lesson climbs a ladder before it may become a sentence. Can
  code check it (a Check)? Can the shape of the answer forbid it (a schema
  field)? Can the reviewer be handed the fact (a Gather)? Only then a
  sentence, and the story goes to `field/notes.jsonl`, never into the prompt.
  **Why:** half of fabrika's growth was lessons written as prose. **Cost:** a
  fix takes longer than typing a sentence. **Sure:** 70%. The doubt is whether
  people keep to a ladder that nothing enforces, which is pattern 9 again.
  Guard 7 is what gives it teeth.

### 2. The manual beside the code

- **Blocks it already:** the reviewer here has three read tools and no shell
  (`src/stages/review/reviewer.ts`, `src/shell-guard.ts`). It runs no command
  and posts nothing. So there are no commands, exit codes or error texts to
  teach. The verdict is worked out in `src/stages/review/verdict.ts`, the stop
  on a red check in `gate.ts`, and the outcome names are built from data in
  `src/stages/outcome.ts`. This blocks the biggest pile whole.
- **Does not:** `docs/review-machine.md` restates the form and the outcome
  names in its "What is built" section. It is a second home, kept by hand.
- **Proposal:** no table of what code prints is written by hand. A test reads
  the doc and fails when an outcome name in it is not in `REVIEW_NAMES`, or
  one is missing. **Why:** every wrong count in section 4 is a hand copy that
  fell behind. **Cost:** one small test per doc that names code. **Sure:**
  80%.

### 3. One rule, many homes

- **Blocks it already:** one prompt function and one form. Nothing checks it.
- **Does not:** the rule "could not look is not a fail" is already in five
  files on the stage's first day: the comment in `sheet.ts`, the prompt in
  `reviewer.ts`, the comments in `outcome.ts` and `verdict.ts`, and three
  lines of `docs/review-machine.md`. About 1,500 of the prompt's 4,000
  characters describe the form field by field, which `sheet.ts` already says
  in its comments.
- **Proposal:** build the "form" part of the prompt from the schema. Put each
  field's sentence on the schema as an annotation, and let `promptOf` print
  them. Then a field and its sentence cannot drift apart, and adding a field
  cannot forget the prompt. **Why:** 14.5% of fabrika's text is repeats, and
  the repeats are where it disagrees with itself. **Cost:** a day of work, and
  the prompt reads a little more stiffly. **Sure:** 65%. The doubt is whether
  generated wording reviews as well as hand wording. One paid comparison on a
  few recorded pull requests would settle it.

### 4. Other stages leak in

- **Blocks it already:** the reviewer is given one typed `Brief` and hands
  back one form. It is told "You post nothing". The prompt has no word about
  the ledger, the operator, ship or governance.
- **Does not:** the prompt pastes fabrika's rubric files in whole, and tells
  the reviewer to "leave out its steps about posting, verdict marks and
  labels". That is other-stage text coming in, with a sentence to cancel it.
  And the stage runs alone today. The pressure starts when it joins the
  operator and round 2 exists.
- **Proposal:** the reviewer's prompt holds no text about any other stage.
  What another stage needs becomes a field in the `Brief` or a name in the
  outcome, and the parent machine does the routing. And this repo writes its
  own rubrics, judgment only, and stops pasting fabrika's. **Why:** 67% of the
  changes to fabrika's review text came from outside the stage. **Cost:** own
  rubrics have to be written and kept. **Sure:** 75% on the rule, 60% on own
  rubrics now and not later.

### 5. Special cases on the main path

- **Blocks it already:** `AGENTS.md`, "Rethink, do not port". A special case
  here is a word in the outcome (`skip:draft`), which is a code path, not a
  paragraph.
- **Does not:** the outcome already has 17 names (stuck 9, send 3, skip 3,
  done 2). `docs/review-machine.md` says three have been reached for real.
  Each is cheap, and each is a case written before a run asked for it.
- **Proposal:** a second shape of review, such as an epic child, is its own
  pack builder that produces the same `Brief`. It is never an "if" in the
  prompt. A test can hold this: `promptOf` is a pure function of the `Brief`
  and the prompt for an epic child differs only in data. **Why:** 13% of
  fabrika's text is "on an epic child" and other cases, doubled step by step.
  **Cost:** the second shape needs real design before it is allowed in.
  **Sure:** 70%.

### 6. The agent's shell in the stage's text

- **Blocks it already:** tools, budget and limits are set in
  `reviewerOptions`, and each tool call is checked in `src/shell-guard.ts`.
  The reviewer waits for nothing and stages no file, so most of fabrika's
  harness text has nothing to attach to.
- **Does not:** `src/claude.ts` grew from 98 lines to 795 in 21 commits, none
  smaller. It holds prompts, options and harness handling in one file.
- **Proposal:** a prompt may state what the agent can do in one line built
  from its options (the list of tools). Any other fact about the harness lives
  in the driver. **Why:** 7.3% of fabrika's text, and 13% of its skill page,
  teaches one harness's limits. **Cost:** almost none today. **Sure:** 65%. It
  is cheap here because the reviewer has no shell. The builder does, and I do
  not know that this holds for it.

### 7. Nothing is taken out

- **Blocks it already:** nothing.
- **Does not:** see the table below. No prompt here has a limit.
- **Proposal:** a size budget for each prompt's fixed text, held by a test.
  Start it at today's size plus 10%. Raising it is a one-line change that
  shows in the diff, and its commit says what was cut, or why nothing could
  be. **Why:** fabrika's only real cuts came from moving text into code. A
  budget makes that the cheap way out. Its own size limit was prose and was
  deleted. **Cost:** friction on every prompt change, and a risk that people
  squeeze words in place of moving a rule into code. **Sure:** 75% that it is
  worth trying. I am not sure of the number.

### 8. Size makes more text

- **Blocks it already:** the reviewer gets its inputs in the prompt. There is
  no text about how to read a big text.
- **Does not:** `docs/review-machine.md` is 1,115 lines and holds two things:
  what today's fabrika does, and what this repo built. The index rows in
  `experiments/README.md` have grown from about 250 characters to about 1,000.
- **Proposal:** split `docs/review-machine.md` in two now, while it is one
  day old: the step list of today's fabrika, and the page for this repo's
  stage. **Why:** fabrika's big pages cost real repair rounds. **Cost:** an
  hour, and some links. **Sure:** 60%. A long design page read by people is
  not the same harm as a long prompt read by an agent on every run.

### 9. Prose rules against rot

- **Blocks it already:** this repo already holds its code rules in code. Lint
  fails on a warning and is a required check.
- **Does not:** the writing rules in `AGENTS.md` are prose. So are all eight
  guards above until a test holds them.
- **Proposal:** keep the own-repo tables of this script as a standing check.
  Run it when a prompt changes. It prints each prompt's size over time, the
  commits that shrank it, and the outcome names. Add to it the count of
  outcome names that `field/runs.jsonl` has seen for real. **Why:** fabrika
  had the right rule in its rubric and no number anyone looked at. **Cost:**
  the script is here already. **Sure:** 70%.

### Is it already starting here?

**Yes, in three ways. Two patterns are blocked by the design. The rest are
too early to tell.** This repo's review stage was first committed on
2026-10-12, so it has no real history. The older files do.

| This repo, at `bf30c9f` | First commit | Commits | Then | Now | Got smaller |
|---|---|---|---|---|---|
| the builder's prompt, `src/claude.ts` (characters) | 2026-10-04 | 8 changes | 618 | 1,711 | 0 times |
| the enricher's brief on data, `src/claude.ts` (characters) | 2026-10-05 | 4 changes | 944 | 2,908 | 0 times |
| the enricher's prompt, `src/claude.ts` (characters) | 2026-10-04 | 5 changes | 831 | 1,060 | 1 time |
| the new reviewer's prompt, `reviewer.ts` (characters) | 2026-10-12 | 1 change | 3,744 | 3,746 | 0 times |
| `src/claude.ts` (lines) | 2026-10-04 | 21 | 98 | 795 | 0 times |
| `AGENTS.md` (lines) | 2026-10-11 | 9 | 110 | 159 | 0 times |
| `docs/review-machine.md` (lines) | 2026-10-12 | 2 | 758 | 1,115 | 0 times |
| `src/stages/review/outcome.ts` (lines) | 2026-10-12 | 2 | 49 | 59 | 0 times |

- **Started: prompts grow by a sentence per bad run and are not cut**
  (patterns 1 and 7). The builder's prompt nearly tripled in eight days. The
  enricher's brief tripled in one day, 2026-10-10, over three commits that
  each answer one run. That is fabrika's curve at a smaller scale.
- **Started: rules learned from runs, kept as prose** (pattern 1).
  `AGENTS.md` says so itself: "The rules, each learned from a run". Six rules
  on a page for agents is fine. It is the same door.
- **Started: second homes** (patterns 2 and 3). One rule in five files on the
  review stage's first day, and a design page that restates the code.
- **Blocked by the design: the manual and the harness** (patterns 2 and 6).
  The reviewer has no shell and posts nothing. That removes the text that is
  62.8% of fabrika's, for this stage, as long as it stays true. This is the
  best news in the experiment.
- **Blocked so far: the form.** `src/stages/review/sheet.ts` has no field for
  an id, a severity or a verdict, so no sentence is needed to stop the agent
  inventing them. The prompt still says it once.
- **A way in for fabrika's rot:** the rubric files are a setting, and the
  real runs pointed it at fabrika's rubrics. Whatever those grow, this prompt
  grows.
- **Too early: other stages and special cases** (patterns 4 and 5). The stage
  runs alone. 17 outcome names with 3 reached for real is the thing to watch.

## 7. Which steps the text serves

**Sure: about 70%. A paragraph often serves two steps, and it went to the one
it names first.**

[The review stage's step list](../docs/review-machine.md) has 22 steps. It
says who does each one in the rebuilt stage: code does 12, a reader does 6,
and 4 are not settled.

| Who does the step | Steps | Lines | Share | Of them judgment |
|---|---|---|---|---|
| code | 12 | 2,133 | 70.2% | 44 (2.1%) |
| a reader | 6 | 287 | 9.4% | 229 (79.8%) |
| not settled | 4 | 125 | 4.1% | 14 (11.2%) |
| none of the 22 | | 493 | 16.2% | 3 |

The steps that take the most text are all code's:

- 20, post one verdict per kind: 346 lines.
- 9, wait for the checks: 295.
- 2, the ticket's criteria and rulings: 283.
- 4, the diff at the head commit: 282.
- 1, which kinds of review the change needs: 248.
- 16, add a criterion or file it: 168.

The steps where the reviewing happens:

- 14, look for what the criteria do not name: 144 lines, 137 of them
  judgment.
- 13, grade each criterion: 94, 78 of them judgment.
- 12, read more of the code than the diff shows: 35.
- 11, read the failing log: 8.
- 17, hold the builder's deviations against the diff: 6.
- 19, write the verdict: 0. Its few rules sit in step 13's lines.

The 493 lines that serve none of the 22 are the shared rules of the command
group, the design notes, moving an epic child's working copy, a guard on
fabrika's own text, and how a lane is left.

So the text is about reading, waiting and posting. The grading itself gets
less than a tenth. **Giving those steps to code, as this repo's stage does,
removes the need for about 70% of the text. It does not remove the pressure
that wrote it.** The same lessons will arrive, and they need somewhere to
land that is not the prompt.

## Guesses that were wrong

- **"The history starts in mid September."** Wrong. The first clone read was
  shallow and showed three weeks. The real history is four months, and the
  merged skill is the second generation. The whole finding about the rewrite
  comes from the older part.
- **"Count the issue numbers in the text to see the patches."** Wrong as a
  main measure. A sweep removed them on 2026-09-01. They are kept as a second
  record, at five moments.
- **"Three piles will do."** Wrong. 15.3% is the reason for a rule, and it
  fits none of the three.

## What this cannot tell us

- **That a shorter text reviews better.** Nothing here measures the quality
  of a review. It measures size, causes and repeats.
- **The causes, to better than one reader.** 92 commits, one pass, no second
  reader. A commit with two causes got one.
- **The causes of the old gates.** They are counted by title only.
- **The piles, to better than about five points.** One reader, and a line
  holds one pile and one tag.
- **Every repeat.** The list was made while sorting. It is a floor.
- **Who wrote what.** The co-author count is a floor, and blame is bent by
  the sweep.
- **Whether a rule was ever safe to remove.** I looked for removals and found
  none. That is not proof each rule is still needed.
- **Anything firm about this repo's review stage.** It is one day old. Its
  numbers are a first reading, to compare against later.
- **That the guards work.** Each is a proposal. None has been tried.
- **Another plugin.** This is one skill of one pipeline, in a repo where
  skill pages are the product.

## Run it

```
node experiments/59-review-skill-growth.ts <a full-history clone of kamp-us/phoenix>
```

A bare clone is fine. It reads git only (`log`, `show`, `blame`,
`rev-parse`), takes a few seconds, and writes
`results/review-skill-growth.json` again. Handed a shallow clone, it says in
its first lines that the answer is cut short, and it does not save. With no
clone it prints every table from the saved file: no git, no network. No key is
used either way.

- `59-readings.json`: the hand labels. A cause for each of the 92 commits, a
  pile and a step for every line range, and the repeated rules with their
  places.
- `results/review-skill-growth.json`: every number above, with the size after
  each commit.

Neither holds a line of the studied text, and neither names a person.

[s-story]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L676-L679
[s-manual]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L485-L488
[s-homes]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L364-L368
[s-leak]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L769-L772
[s-seat]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L219-L228
[s-harness]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L455-L464
[s-blank]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L23-L28
[s-var]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L321-L327
[s-size]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L350-L362
[s-four]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L637-L638
[s-noclass]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md#L370-L372
[c-nine]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/contract.md#L136
[c-eval]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/contract.md#L2009-L2012
[c-name]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/contract.md#L107-L113
[c-seat]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/contract.md#L64-L76
[c-tmp]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/contract.md#L49-L51
[r-size]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/rubrics/skill.md#L45-L46
[r-homes]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/rubrics/skill.md#L87-L88
