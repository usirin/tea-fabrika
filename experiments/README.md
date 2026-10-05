# Experiment log

What we tried, what came back, and what we took from it. Newest last. Every
number here came from a real run against Jev and, where it says so, Claude Code.
The samples are small and the two toys are tiny, so read these as hints, not
proof.

Guesses that turned out wrong are left in on purpose. One mistake cuts across
several experiments: read section 16 before trusting any line that says an
agent could not see a file.

## The setup

Two toys under `fixtures/`: `slugify` (three rules) and `duration`
(`parseDuration`, six rules). `toys.ts` holds, for each toy, one correct
implementation and several broken on purpose, each breaking one criterion. That
is what gives a case a known answer: run the real tests and see.

Jev is a small classifier. It answers a multiple-choice question about some
JSON and returns a confidence between 0 and 1. The lane acts on an answer only
when the confidence is at or above a floor.

## 1. Is Jev's low confidence just noise?

`criterion-clarity.mjs`

Asking the same question four times gave 0.69, 0.79, 0.64, 0.77. That looked
like noise. It was not. Low confidence followed bad input every time we looked:

- a criterion that contradicted the code or another criterion
- a criterion about what stayed the same (the judge only sees changed lines)
- a thin ticket

**Took from it:** when the judge is unsure, fix what it was asked, do not ask
again. So an unsure verdict should go back to triage, which owns the wording.

## 2. Tell the enricher how the judge reads

`src/claude.ts`, `JUDGE_BRIEF`

The enricher (the agent that rewrites a raw ticket) was told how its criteria
get judged: one claim each, about what the change makes true, never about what
is left untouched.

**Result:** slugify went from 0 of 3 runs finishing to 5 of 5.

## 3. Show the judge the passing tests

The judge was first shown only the diff. Adding the names of the tests that
passed took `duration-open` from 0 of 5 runs finishing to 8 of 10.

`judge-rubber-stamp.mjs` checked the worry that it would now say "met" to
anything with green tests. It did not: for a criterion that was not done and
had no test, it said "not met" at 0.99.

## 4. How often is the judge right at each confidence?

`judge-calibration.ts`, 87 cases, 261 answers. Question: "does this change
satisfy this criterion?"

| Confidence | Right |
|---|---|
| 0.8 and up | 218 of 221 |
| 0.7 to 0.8 | 11 of 12 |
| under 0.7 | about half |

Split by what the judge was shown:

| Shown | Right |
|---|---|
| A passing test for the criterion | 117 of 117 |
| No test, code is correct | 95% |
| No test, code is broken | about half |

The broken-and-untested group includes one case answered "met" at 0.93 to 0.95
three times in a row.

**Took from it:** the 0.8 floor is fine for this question. The weak spot is a
criterion with no test. So the rule became: every criterion needs a test.

## 5. Can Jev stand in for running the test?

The idea: write the test in prose and let Jev judge the code against it, with
nothing run. Experiment 4 had already covered most of this, because the
duration criteria carry an example each (`"1.5h"` returns `5400`), which makes
them prose tests in all but name.

Broken code, no test shown:

| Criteria | Answers | Sure and right | Sure and wrong | Unsure |
|---|---|---|---|---|
| With an example (duration) | 18 | 8 | 0 | 10 |
| Abstract (slugify) | 9 | 3 | 3 | 3 |

**Took from it:** with a concrete example Jev never confidently passed broken
code, but it confidently caught the bug less than half the time. A real test
run catches it every time. Small sample.

## 6. Can Jev tell whether a test checks a criterion?

`test-check-calibration.ts`, 54 hand-built tests, 324 answers. New question:
"would this test passing show the criterion is met?"

Each criterion got two honest tests and four bad ones: named after the
criterion but checking something else, the wrong expected value, related but
passing either way, and asserting nothing. A test counts as good only if it
passes on the correct code and fails on the code that breaks its criterion. The
script stops if a label disagrees with the run.

- At 0.9 and up: right 200 of 200.
- All 4 confident misses sat at 0.80 to 0.81. It accepted a bad test each time.
- It never confidently refused a good test, but at a 0.8 floor 41% of good
  tests came back unsure.
- Showing the same checks as sentences instead of code made no difference.
  (This only shows Jev reads both forms equally well. It is not experiment 5.)
- 4 of 18 good tests already pass on the starting code, because it returns
  `null` and the criterion expects `null`. So "a new test must fail first"
  cannot be a hard rule.

**Took from it:** this question works, and wants a higher floor than 0.8.

## 7. Can an agent write the tests first?

`test-writer.ts`. Claude got the starting code and the criteria, and wrote
tests. It never saw an implementation or the toy's own tests. Graded the same
hard way as experiment 6.

First run, six turns: 27 of 27 criteria got a good test. At a 0.9 floor the
judge let 17 through and was unsure on 10, all of them good.

**Took from it:** the writer is not the weak part. The judge's caution is.

## 8. Does an example in the criterion fix the caution?

Guess: the judge is unsure when the criterion is abstract, so add a worked
example to each.

**Wrong.** 3 of 9 slugify tests passed the judge with the old wording, 3 of 9
with the new. The writer picked its own inputs and ignored the example, and it
split the two-claim criterion ("punctuation and accented letters") into two
tests.

`fit-probe.ts` asked Jev about that one criterion several ways:

| What Jev was shown | Confidence |
|---|---|
| Two claims, two tests together | 0.44 to 0.54 |
| Two claims, one test covering both | 0.76 to 0.83 |
| One claim, its test | 0.82 to 0.87 |
| One claim with an example, test asserts that example | 0.90 to 0.92 |

**Took from it:** it is the whole chain that matters. One claim per criterion,
one test per criterion, and the test asserts the criterion's own example.

## 9. The three rules, given to the writer

The writer was told: exactly one test per criterion; when the criterion gives
an example, assert exactly that; add a second assertion only when the first
would pass on code that does nothing. Twelve turns.

All 48 criteria got a good test, and none passed on the starting code: for
"returns null" criteria the writer added a check that a valid input parses.

Tests the judge let through:

| Criteria | Floor 0.9 | Floor 0.85 |
|---|---|---|
| slugify, as first written | 3 of 9 | 4 of 9 |
| slugify, example added | 3 of 9 | 9 of 9 |
| slugify, one claim each with an example | 6 of 12 | 12 of 12 |
| duration | 10 of 18 | 14 of 18 |

Confidence went up across the board, but it bunches at 0.86 to 0.89, just under
the 0.9 floor.

On the hand-built tests of experiment 6, a 0.85 floor would have accepted 0 bad
tests out of 216 answers, the same as 0.9. That floor was picked after seeing
the data, so it needs a fresh set of bad tests before anyone trusts it.

## 10. Bad tests written to fool the judge

`bad-tests.ts`. The 0.85 floor was picked after seeing the data, so it needed
bad tests it had not been tuned on. Claude was asked to write tests that look
honest and are not, aimed at a reviewer who skims: an input that almost
exercises the rule, an expected value that is nearly right, an assertion that
is slightly too loose. Each had to fail on the starting code, so running it
first would not give it away.

90 tests came back. Running them settled which were really bad: 56 were (34
fail on correct code, 22 pass on code that breaks the criterion). In the other
34 the adversary slipped and wrote a test that does check its criterion.

Each test was shown to the judge three times:

| Floor | Bad accepted | Bad refused | Bad unsure |
|---|---|---|---|
| 0.80 | 0 of 168 | 60 | 108 |
| 0.85 | 0 of 168 | 43 | 125 |
| 0.90 | 0 of 168 | 28 | 140 |

The judge did say "checks" to bad tests, but never with confidence. The
highest was 0.79, for a test that expected `"mcdonald-s-menu"` from
`"McDonald's Menu"`.

**Took from it:** 0.85 holds on a fresh set, with a margin of 0.06 over the
worst miss. 0.80 held too, but by 0.01, and it failed in experiment 6. Unsure is
the judge's usual answer to a bad test, so "unsure" must send the test back,
never wave it through.

One limit: "bad" here means bad against one broken version of the code per
criterion. A test could pass that check and still be too weak in another way.

## 11. Do hidden tests catch code that only learned the examples?

`hidden-tests.ts`. One visible test per criterion, asserting the criterion's
own example, leaves a hole: code can pass by handling just those inputs. Think
of a student who memorised the practice questions. The fix under test is the
teacher's: set different questions in the exam. The test-writer writes a second
file of tests with other inputs, which the builder never sees.

Claude wrote both files, three runs per toy. The cheats were written by hand,
eleven of them: a lookup table of the examples, lower-casing only the first
letter, collapsing exactly three spaces, removing only the punctuation seen in
the examples, and so on.

- 33 of 36 cheats passed every visible test. The hole is real: the lane as
  planned would have called all 33 done.
- Hidden tests caught 24 of the 33. slugify: 15 of 15. duration: 9 of 18.
- 0 of 90 hidden tests failed on the correct code, so none would have blocked
  an honest builder.

The 9 misses are three cheats, missed in every run, and all three break the
same thing: the seconds unit. No criterion mentions seconds. The writer was
told to test nothing the criteria do not promise, and it did not. Counting only
cheats against a rule some criterion states, hidden tests caught 24 of 24.

The judge is no use on hidden tests: at 0.85 it let through 8 of 90, all of
them sound. It is sure when a test uses the criterion's example, and a hidden
test by design does not.

**Took from it:** hidden tests close the "learned the examples" hole for rules
the ticket states. They cannot cover a rule the ticket never wrote down; that
is a gap in the criteria, and triage's to close. And hidden tests go unjudged,
so a wrong one would block a builder who cannot see why. None was wrong here.

## 12. The enricher's own criteria

`enricher-criteria.ts`. Every run so far used criteria written by hand. Here
the front of the lane runs on the raw ticket ("slugs look wrong"): the enricher
writes the criteria, the test-writer writes the tests, the judge reads them.
The enricher is now told to write one claim per criterion with a worked
example. Three runs per toy, 43 criteria.

- Every criterion came back as one claim with an example, bar one.
- All 43 tests were sound: none wrong on correct code, none already passing on
  the starting code, none missing.
- The judge at 0.85 let through 31 of 43: duration 26 of 27, slugify 5 of 16.
- The tests caught 27 of 33 broken versions: slugify 15 of 15, duration 12 of 18.

Two things went wrong, and both trace back to what we told the agents.

**The enricher dropped two real rules.** Every duration run left out "units out
of order return null" and "an unknown unit returns null". Those are the 6
broken versions nobody caught. The likely cause is our own instruction: never
write a criterion whose test would pass before any code is written. The
starting code returns `null` for everything, so the enricher left the `null`
rules out. A rule made to keep empty tests out pushed real requirements out.

**The ticket title moves the judge.** The same slugify criterion and test that
scored 0.94 to 0.98 with hand-written input scored 0.55 to 0.80 here.
`title-probe.ts` isolates it, four answers each:

| Title shown with the criterion and test | Confidence |
|---|---|
| States the goal: "slugify turns a title into a URL slug" | 0.93 to 0.97 |
| States the bug: "slugify returns the title unchanged instead of a URL-safe slug" | 0.58 to 0.84 |
| No title | 0.65 to 0.79 |

The enricher writes bug-shaped titles, because that is what a ticket title
usually is. The judge needs to know what the thing is for.

**Took from it:** show the judge a one-line goal, not the ticket title. And the
"must fail first" rule belongs to the test, not the criterion: a rule that is
already true of the starting code still gets a criterion, and its test fails
first by also asserting a case that works.

## 13. Both fixes, and a third problem they uncovered

Fix one: the enricher is told that a rule the finished code must follow gets a
criterion even when the starting code follows it by accident. Fix two: the
enricher writes a one-line goal, and the judge sees that instead of the title.

Fix one worked outright. The enricher wrote 63 criteria instead of 43, the
`null` rules came back, all 63 tests were sound, and the tests caught 33 of 33
broken versions (up from 27).

Fix two made things worse at first: the judge let through 15 of 63. The
enricher's goal line is long and lists the rules ("a lower-case, dash-separated
slug made only of a-z, 0-9 and dashes"), and the judge held each test to all of
it. A test of one rule looked too small. Same criterion and test, four answers
each:

| Shown beside the criterion and test | Confidence |
|---|---|
| Short line, under the key `issue` | 0.92 to 0.94 |
| Long line, under the key `issue` | 0.67 to 0.84 |
| Long line, under the key `goal` | 0.30 to 0.36 |
| Long line, under the key `about`, and the question says it is background only | 0.85 to 0.90 |

So the question now says: "`about` only says what the code is for. Judge the
test against `criterion` alone." (`questionsWithAbout` in `fit.ts`.)

`refit-bad-tests.ts` put the reworded question to the saved bad tests of
experiment 10: still 0 of 168 accepted at 0.80, 0.85 and 0.90, worst 0.79.

Rerun with the reworded question:

- The judge let through 39 of 63: duration 31 of 42, slugify 8 of 21.
- Every one of the other 24 was a sound test the judge answered "checks" to,
  just under the floor, bar one "does not check" at 0.26.
- The tests for `null` rules score lowest. They carry a second assertion, so
  that they fail on the starting code, and the judge reads a two-assertion test
  with less confidence.

**Took from it:** the judge is safe (it has not accepted a bad test at 0.85 in
any run) and touchy (wording of the question, the key a field sits under, and
the length of a background line each move it by 0.1 to 0.6). On criteria and
tests written by agents it passes about six good tests in ten. The other four
need somewhere to go that is not a person.

## 14. Is there more in the answer than one confidence number?

`decision-rule.ts`. Jev gives every option a share: checks, does_not_check,
cannot_tell. The hope: a good test the judge is unsure about has its doubt in
"cannot tell", a bad one in "does not check", and a rule on the shares would
let more good tests through for free.

**No.** "Cannot tell" gets a share of about 0 on good and bad tests alike, so
the answer is one number in practice. Jev's docs give the formula: confidence
is the top share rescaled, `(p_max - 1/n) / (1 - 1/n)` for `n` options. Our
0.85 floor on three options is a top share of 0.90.

The rerun did add 618 answers to the record. Bad tests accepted at 0.85: 0 of
273. The closest was 0.83, for a test expecting 8010 from `"2H15M"` (the right
answer is 8100). Jev does not do arithmetic, so the margin over the floor is
thin: 0.02.

## 15. Reading Jev's own guide

After fourteen experiments we read the docs properly
(https://docs.typesafe.ai/concepts/how-to-build-with-system-one). By their
measure we are using Jev the hard way:

- "Ask the most explicit, narrow, specific, atomic questions you can." They
  call this the most important idea in the guide. We ask one broad question:
  would this test passing show the criterion is met?
- "Ask many narrow, independent questions about the same state in one
  request." Questions in one call run in parallel, so splitting costs no extra
  round trip. We ask one question per call.
- "Give each question only the context it needs." Experiments 12 and 13 are
  that rule learned the slow way: a title, then a goal line, each moved the
  answer.
- There is a yes/no question type (`noul`) and a rubric type (`score`). We
  have only used `choice`.
- An option's description can say what it covers, what it does not, and give
  examples. Ours are one sentence each.
- "Combine independent answers with deterministic rules" in code.

What we did beyond the guide: measured how often each confidence level is
right, on cases with known answers, and tried to fool it.

## 16. Correction: the agents had a shell

Every agent turn was started with `--allowedTools Read Glob Grep` (plus the
edit tools for writers). That flag pre-approves tools. It does not take the
others away. The agents kept a shell, and where a toy's own test file had been
deleted from the folder they ran `git show HEAD:slugify.test.js` and read it
out of history.

The session logs say how often:

| Agent | Sessions | Looked at git or the test files |
|---|---|---|
| Test-writer | 63 | 46 |
| Triage (enricher) | 73 | 50 |
| Builder | 40 | 1 |

So wherever this log says an agent "never saw the toy's own tests", that was
not true for most runs of experiments 7, 9, 10, 11, 12 and 13.

Fixed in `src/claude.ts` (`--tools` names the only tools an agent has; checked:
it reports no shell) and in `checkoutToy`, which can now leave files out before
the first commit, so they are not in the history at all.

Rerun with the shell gone:

| Experiment | Before | After |
|---|---|---|
| 9. Test-writer, hand-written criteria: good tests | 48 of 48 | 48 of 48 |
| 11. Hidden tests: cheats caught | 24 of 33 | 27 of 36 |
| 11. Hidden tests wrong on correct code | 0 of 90 | 0 of 90 |
| 13. Triage may read the toy's tests: broken versions caught | 33 of 33 | 33 of 33 |
| 13. Triage has only the ticket: criteria written | not run | 32 |
| 13. Triage has only the ticket: broken versions caught | not run | 18 of 33 |

The test-writer and the hidden tests hold up: given good criteria, the writer
did not need to copy. The same three cheats slip past the hidden tests, all on
the seconds unit no criterion mentions.

Triage is the one that changes. From the ticket alone ("parseDuration always
gives null. i need it to turn things like 1h30m into seconds") it wrote half as
many criteria, and the tests caught 13 of 15 broken slugify versions and 5 of
18 duration ones. Two of its tests failed on the reference code: it decided a
title that is already a slug stays as it is, and the reference drops the dash.
Neither is wrong; the ticket does not say.

Everything about the judge stands as written. Those runs score Jev on tests
with known answers, and who wrote the tests does not change the score.

**Took from it:** the chain from criteria to tests to code is sound. What goes
in is the limit: a thin ticket gives thin criteria, and no later stage can add
a rule nobody wrote down. And check what a tool flag does before trusting an
experiment to it.

## 17. One broad question, or several narrow ones

`atomic-questions.ts`. Jev's guide says to split a broad judgment into atomic
questions, ask them in one call, and combine the answers in code. Under the
lane's rule (a test asserts its criterion's own example) the broad question
"would this test passing show the criterion is met?" is three small facts,
each asked as a yes/no (`noul`) and shown only the criterion and the test:

- `same_input`: the test calls the function with the example's input
- `same_result`: the test expects the example's result
- `exact_check`: the test compares against one exact value

A test is accepted when all three are at or above a cut. 233 saved tests, each
with a known answer from running it.

| Rule | Writer's good tests accepted | Bad tests accepted |
|---|---|---|
| Broad question, confidence 0.85 | 53 of 88 | 0 of 93 |
| Three narrow questions, all at 0.9 | 87 of 88 | 4 of 93 |
| Three narrow questions, all at 0.5 | 88 of 88 | 12 of 93 |

The narrow questions fix the caution: good tests from the test-writer score
0.98 on each, and nearly all get through, against six in ten before.

The 4 bad tests accepted at 0.9, by kind:

- 2 are not the judge's mistake. The enricher guessed that a title which is
  already a slug comes back unchanged; the reference code drops the dash. The
  test asserts the criterion's example faithfully. The criterion is what
  disagrees with the reference, and no question about the test can see that.
- 2 are real: `parseDuration("90")` expected to equal the string `"90"`. The
  criterion says only "is returned as that many seconds", with no result
  written out, so there was nothing exact to compare with.

Then the part the guide also says: keep in code what code can do. Where the
criterion carries a written example, plain string matching answers the first
two questions, and Jev agrees with it on 152 of 156 tests. "The test source
contains the example's literals, and `exact_check` is at least 0.5" accepts 88
of 88 of the writer's good tests and 2 of 93 bad ones, the two slug cases above.

**Took from it:** asked the way it was built to be asked, Jev stops sending
good tests back. And two of the three questions are not judgment at all once
the example is written down exactly, so they belong in code. What is left for a
judge is the part code cannot do: does this example really show this claim?

## 18. Does this example show what the sentence claims?

`example-fits-claim.ts`. If the example is exact data, code writes the visible
test and the judge's job shrinks to this one question. So it was measured
before building on it.

Truth came from running code. For a claim and an input, an example is good when
its result is what the correct code returns and the code that breaks that claim
returns something else. 201 examples were made that way from a pool of inputs,
with no hand-labelling, and Claude wrote 50 more meant to fool the judge,
labelled the same way. Two narrow yes/no questions and one broad one:

| Kind of example | Count | `has_feature` | `rule_applied` | broad |
|---|---|---|---|---|
| Good: right result, and the claim is why | 29 | 0.93 | 0.78 | 0.77 |
| Bad: the input never touches the rule | 121 | 0.29 | 0.25 | 0.17 |
| Bad: the result is what broken code gives | 29 | 0.91 | 0.30 | 0.24 |
| Bad: a result that is slightly off | 22 | 0.96 | 0.64 | 0.62 |
| Bad: written by the fooler | 44 | 0.75 | 0.57 | 0.51 |

Accepting an example when both narrow answers reach a cut:

| Cut | Good accepted | Bad accepted |
|---|---|---|
| 0.5 | 30 of 35 | 47 of 216 |
| 0.7 | 20 of 35 | 31 of 216 |
| 0.9 | 7 of 35 | 1 of 216 |

There is no cut that works. Half of this question Jev answers well and half it
cannot answer.

- **Does the input touch the rule?** Yes, reliably. An example whose input has
  nothing for the rule to act on was accepted 0 of 121 times at every cut.
- **Is the result right?** No. `parseDuration("1.5h") -> 4500` scored 0.89, and
  `slugify("naïve approach") -> "naive-approach"` 0.88. Telling 5400 from 4500
  means doing the sum, and Jev's own notes say it does not do arithmetic: "keep
  the arithmetic in code".

**Took from it:** Jev can check that an example is about the claim. It cannot
check that the example is correct, and nothing that only reads can. An example
is the specification. A wrong one has to be caught by something that disagrees
with it: a second example worked out separately, or code that cannot satisfy
both.

## 19. Criteria as data: a rule, a call and its result

The idea from the Open list: triage writes each criterion as a rule plus
examples, each a JavaScript call and its exact result. Code turns every example
into `assert.deepStrictEqual(<call>, <result>)`. No agent writes the visible
tests and no judge checks they fit. Two things could break it: rules that are
not one call and a result, and results triage gets wrong, since it reads the
code but cannot run anything.

`data-criteria.ts` runs triage three times on each toy, with and without the
toy's tests, and runs every example against the correct code, the starting
code and every broken version. `SET=demlik` runs it on seven closed demlik
issues at the commit before each fix and only counts which rules fit.

| | Triage may read the toy's tests | Triage has only the ticket |
|---|---|---|
| Criteria written | 50 | 23 |
| Criteria with an example | 50 | 23 |
| Examples wrong on the correct code | 0 of 54 | 0 of 23 |
| Broken versions caught | 33 of 33 | 11 of 33 |
| Experiment 13's agent-written tests caught | 33 of 33 | 18 of 33 |

On the toys the shape works. Every rule fit, and every result was right. That
first column proves less than it looks: the toy's tests hold every hard result
(`"1.5h" -> 5400`, `"héllo, wörld 42!" -> "hllo-wrld-42"`), and triage could
copy them. So `SPEC=rules` hides the tests and states every rule in the ticket
in words, with no example values. Triage then wrote 52 criteria, all with an
example, 0 of 54 results wrong, and the examples caught 33 of 33 broken
versions. It worked its results out itself (`"1h2m3s" -> 3723`,
`"café" -> "caf"`), but it chose easy inputs: one or two steps of sum, short
strings. A result that takes real working out is still untested; the toys
never asked for one. The examples that hold on the starting code are all
"returns null" rules, which a stub follows by accident; they are still the
rule.

The thin ticket is worse as data, not better: 11 of 33 caught against 18. Two
slugify runs wrote examples like `typeof slugify("Hello World") -> "string"`
and `encodeURIComponent(s) === s`, true of nearly any slug. With no rules to
read, triage reached for what it could say for sure, and that is weak.

On real issues most rules do not fit. 36 of 130 criteria over seven demlik
issues carried an example:

| Issue | Fit |
|---|---|
| #576 createJevAsk name (a pure function) | 11 of 22 |
| #516 mistyped process door | 18 of 32 |
| #565 readAllowance | 7 of 22 |
| #568 spawn's notify step | 0 of 15 |
| #567 run.stop() and the host's table | 0 of 16 |
| #529 wrangler config loader | 0 of 15 |
| #569 docs links | 0 of 8 |

Triage said why for each one that did not fit, and the reasons fall into a few
kinds: types only the compiler sees, async Effect runs over time, a CLI run
over files on disk, docs and wording, and process rows (a changeset, CI green).
None of the demlik examples were run, so whether their results are right is
not known.

**Took from it:** a call and its result is the right shape for a pure function,
and there it removes the test-writer and the fit judge with nothing lost. It is
not the shape of most real criteria. A criterion needs a kind, and each kind
its own check: an example for code to run, a type test, a fixture test an agent
writes and Jev checks against the rule, a file or docs check. And the data
shape does nothing for a thin ticket; only more rules do.

## 20. Does anything catch a wrong example?

A wrong example becomes a wrong visible test, and the builder codes to it.
Jev cannot tell a right result from a wrong one (experiment 18). The idea:
something written from the rules alone, without seeing the examples, disagrees
with a wrong one. `example-clash.ts` plants 20 wrong examples over the two
toys, of three kinds:

- **skips the rule**: `slugify("Hello") -> "Hello"`, `parseDuration("30m1h") -> 5400`
- **misreads the rule**: `slugify("héllo") -> "hello"` (accents turned into
  plain letters), `parseDuration("90") -> 5400` (a bare number as minutes)
- **off value**: `parseDuration("1.5h") -> 4500`, `slugify("héllo") -> "hll"`

and tries three detectors on each, three runs apiece:

- **reference**: an agent writes a throwaway implementation from the rules,
  and the example's call is run on it
- **hidden**: an agent writes hidden tests from the rules, run on code that
  follows the wrong example (and on what a real builder wrote)
- **builder**: the builder, shown rules and examples, may answer
  "contradiction" instead of coding to an example

The rules come in two wordings: `clear`, and `loose`, the way a person might
file them ("Spaces between words become dashes", "A plain number works too").
Every detector also ran on the correct examples to count false alarms. The
whole thing ran twice, the second time with the builder shown the loose rules
(`BUILD=loose`); the references and hidden tests in both runs agree.

| Detector | Clear rules: wrong caught | Clear: false alarms | Loose rules: wrong caught | Loose: false alarms |
|---|---|---|---|---|
| Reference, any of 3 | 20 of 20 | 0 of 10 | 19 of 20 | 1 of 10 |
| Hidden tests on code following the example | 13 of 13 | 0 | 10 or 11 of 13 | 0 |
| Builder says "contradiction" | 19 of 20 | 0 of 6 | 16 of 20 | 0 of 6 |

(The hidden row counts only the 13 wrong examples that some general code
follows; an off value has none. No hidden test, 180 per run, failed on the
correct code.)

With clear rules, the throwaway reference catches every wrong example and
raises no false alarm. Every reference disagreed, not just one of three. The
builder nearly matches it for free, since it is there anyway. The off value
the builder let through, `"hll"`, it did not code to: it wrote correct code,
so the visible test would fail on honest code and the lane would see it.

With loose rules, the misses are all misreadings, and the same three every
time: `a---b`, `hello` for `héllo`, `5400` for `"90"`. The references, the
hidden-test writer and the builder made the same mistake as the wrong example.
But the loose rules really do allow those readings: "spaces become dashes"
does not say one dash per run. The one false alarm points the same way: the
loose references turned `é` into `e`, so they disagreed with the correct
`"hllo"`. Nothing that reads only the ticket can settle what the ticket does
not say.

One caveat: the references are not good code. Only 3 of 12 passed the toy's
full test suite; they agreed with every correct example here, but on other
inputs they may not. A reference is a check on the examples, never an oracle.

**Took from it:** a wrong result in an example is caught, and cheaply: one
throwaway implementation from the rules, plus the builder's "contradiction"
answer. A disagreement goes to a person with both answers side by side. A
gap in the ticket is not caught; it comes back as agents agreeing on a guess.
That is the thin-ticket problem again, and only the person who filed it can
answer it.

## 21. Does triage make mistakes of its own?

Experiment 20's wrong examples were planted by hand, on the ticket's own
inputs. Triage had not yet written a wrong result (0 of 108 in experiment 19),
but there it chose easy inputs. `natural-mistakes.ts` adds two toys whose
results take real working out, and asks for three examples per rule, one on an
edge:

- `businessDays(start, end)`: weekdays after start up to end, without weekends,
  January 1 and December 25. The result needs the weekday of each date.
- `formatBytes(n)`: 1024-based units, one decimal rounded half up, rolling over
  to the next unit when rounding reaches 1024.

The rules are in the ticket in words; there are no tests to copy, and triage
can read the stub but run nothing (`--tools Read Glob Grep`). Three triage runs
per toy, three throwaway references per toy, and one builder per run told to
list every example that contradicts the rules.

| | businessDays | formatBytes |
|---|---|---|
| Examples written | 85 | 90 |
| Wrong on the correct code | 0 | 0 |
| References disagreeing with a right example | 0 | 0 |
| Builder flagging a right example | 0 | 0 |

The examples were not easy. They cross a year end over a holiday
(`businessDays("2023-12-29", "2024-01-02") -> 1`), need the weekday of
2025-12-31, and sit on the rounding edge (`formatBytes(1048525) -> "1 MB"`,
`formatBytes(1048524) -> "1023.9 KB"`). Triage got all 175 right.

So there were no natural mistakes to catch, and how well the two checks catch
them is still unmeasured. What this does show: over 283 examples in experiments
19 and 21, triage wrote 0 wrong results (under about 1% at 95%, rule of three),
and neither check raised a false alarm on 175 right ones. Triage here is the
CLI's default model; a smaller model would need its own run.

**Took from it:** a wrong result in an example is rare for this kind of rule,
and the checks for it cost nothing in false alarms, so they are cheap
insurance. What actually goes wrong is the ticket: a rule it leaves out or
leaves open (experiments 16, 19, 20).

## 22. Does Jev flag triage's own idle examples?

Experiment 18 found the one example question Jev answers well: does the input
touch the rule at all (idle inputs accepted 0 of 121). Those idle inputs were
made from a pool. `idle-examples.ts` asks the same question, word for word,
about triage's own examples from experiment 19's three runs, labelled by
running code: each rule maps by its words to the broken versions that break
it, and an example is idle when every one of them still passes it.

| | Idle | Shows its rule |
|---|---|---|
| Triage's examples (131) | 0 | 131 |
| Jev below 0.5 ("does not touch") | - | 5 |
| Jev below 0.9 | - | 13 |

Triage wrote no idle example, so there was nothing to catch. Jev's flags were
all false alarms, and four of the five below 0.5 were the plainest example
there is: `parseDuration("1.5h") -> 5400` for "A part's number may be a
decimal", at 0.26 to 0.44. (A first labelling run counted one idle example;
it was a slip in the labelling, the `s` in "issue's" matching the seconds
rule, and the fixed run has none.)

The weak examples of experiment 19's thin ticket, like
`typeof slugify("Hello World") -> "string"`, are not idle: they show their
rule ("slugify returns a string") perfectly. The weakness is in the rule, and
a question about the example cannot see it.

**Took from it:** no Jev slot on examples. Triage's examples already touch
their rules, and Jev's "no" would mostly send good ones back. A weak rule is
the ticket problem again.

## 23. Kill a real build, start it again

`src/restart.test.ts` kills the lane after every step with scripted agents.
This is the same with real Claude Code and real Jev: `pnpm demo` with
`AGENT=claude TOY=slugify RUN=<folder>`, a SIGINT five seconds after the
builder's `claude -p` started, then the same command again.

- The saved state said `building`, with the builder's conversation id picked
  before the build.
- The second run sent `resume`, and the lane sent the build again. Claude's own
  log of that conversation holds both turns: the killed one at 03:41:57 and the
  new one at 03:42:05. Claude had saved the conversation before the kill, so
  `--resume` found it and the fallback to `--session-id` was not needed.
- The lane then ran the tests and asked the judge, and parked: the judge was
  unsure (0.25) about "accented letters are dropped". That park is the judge's,
  not the restart's.

Two tries before it did not reach the kill. On `TOY=duration`, triage parked
first: Jev was unsure whether the ticket was for an agent (0.29), and a triage
park has no answer path yet. On a slugify run with a 20 second wait, the
build had already finished.

**Took from it:** the restart works with real agents. Still untested for real:
a kill before Claude saved anything, which takes the `--session-id` fallback.
Only the unit tests cover it. Triage parks need an answer, as lane parks have.

## 24. The test-first lane, end to end

The lane no longer asks Jev whether a diff meets a criterion. Triage writes
each criterion as data (experiment 19's brief, plus the file and the function
to import), code writes the tests, they run once on the untouched code, and the
builder works against them locked. Experiments 1 to 18 measured the old prose
criteria; their scripts read `criterion.text` and run as they were at commit
`7c37230`.

One real run each, `AGENT=claude`, real Jev for the sort:

- **slugify:** triage wrote 6 rules, each with one example, and all 6 failed on
  the stub. The builder answered `done` on its first try, and the 6 tests plus
  the toy's own 3 passed. No person or model judged anything after triage.
- **duration:** triage wrote 3 rules (hours and minutes, `h`, `m`), then Jev
  sorted the ticket as for a person at 0.32 and triage parked, the same as in
  experiment 23 (0.29). Two runs, two parks: this ticket does not reach the
  lane until a triage park can take an answer.

**Took from it:** the loop runs on real agents with nothing but tests deciding
"done". The duration ticket, the one with hidden rules, is the test that
matters, and it is blocked on triage.

## 25. Duration through a person's answer

Parks take typed answers now, triage's as well as the lane's. The duration run
parked at triage again (audience, 0.33: three runs, three parks), and the same
command run again with `ANSWER` set to a person's sort carried it on.

- Triage wrote 3 rules, all about `h` and `m`. The toy's hidden tests hold 8,
  so 6 of them were rules nobody wrote down: `s`, spaces, upper case, decimals,
  a bare number, the order of units.
- The 3 example tests failed on the stub, the builder answered `done`, and the
  hidden tests sent it back with 6 failures. Its second try passed everything.
- **The hidden tests are not hidden.** The feedback is the test runner's
  output, and that holds each failing assertion's expected value. The builder
  said so itself: "I worked out these rules from the failing test names and
  expected values." It passed by reading the answers off the failure report,
  not by being told the rules.

**Took from it:** answers work, and a person's sort is all the duration ticket
needed. But a hidden test that sends back its output is an exam that hands
back the answer key with the grade. What the builder may hear from a hidden
test is open: nothing, the test's name, or the rule it stands for.

## 26. What may the builder hear from a hidden test?

`hidden-feedback.ts` builds the duration toy from its hand-written ticket (3
rules) 15 times, 5 for each way a failed hidden test is answered: the runner's
`full` output, the failing tests' `name`s only, or `ticket`, where a triage
turn shown only the failing test's name writes the missing rule an example and
it joins the visible tests. The finished code is then scored on 20 held-out
tests: the hidden tests' rules with other values, never run during the build.
A stub that returns `null` scores 7 of them.

| Way | Passed the hidden tests | Builds (mean) | Held-out (mean) | Triage's examples right |
|---|---|---|---|---|
| full | 5/5 | 2.0 | 20/20 | - |
| name | 5/5 | 2.2 | 20/20 | - |
| ticket | 5/5 | 2.0 | 20/20 | 20/20 |

All three hit the ceiling, so the toy cannot tell them apart. Every hidden
test's name is its rule in words ("units can be upper case"), and every rule is
the obvious convention, so the name is all a builder needs and the leaked values
add nothing. In the ticket way, triage wrote the same four examples in all five
runs, all right.

What it does show: leaking the values did not make the builder copy answers
instead of learning rules, here. The case where the ways would split is a rule
whose specifics only the expected value carries, like a free-shipping line of
50 that no name or ticket mentions. There, full output passes by reading the
answer, and name or ticket cannot pass at all: the builder and triage would
both have to guess the 50.

**Took from it:** the leak is harmless when the test names state the rules, and
decisive when they do not. Whether it is cheating depends on what the hidden
tests are for. A repo's own tests are ordinary feedback: a person reads their
failures too. A held-out acceptance check stops being one the moment its values
are read.

## 27. Jev as the review's router

The lane's review now checks scope in code: a changed file no criterion names
must be listed by the builder with a reason, or the work is sent back. Each
listed reason goes to a `Router` service with one question, "does this change
serve the ticket's goal?", and Jev is the first plug-in (floor 0.8; below it,
`unsure`, which parks).

`route-probe.ts` asks it about 12 reasons, labelled by hand, 3 times each:

| | Answers |
|---|---|
| Right | 30 of 36 |
| Unsure | 6 |
| Wrong, letting an unrelated change through | 0 |
| Wrong, sending a related change back | 0 |

Every answer was the same across its three repeats. All six unsure answers were
on two changes that support the ticket without doing its work: a type comment
and a README example (0.45 to 0.54). The clearly related ones were 0.96 to 0.99,
the clearly unrelated ones 0.98 to 1.00.

The labels are mine, and the cases are clean on purpose, so this says Jev reads
the obvious cases right, not where the line sits on hard ones. The unsure band
is where a person decides, which is the design.

**Took from it:** Jev fits this slot: two short texts, "about the same thing?",
and the lane only routes on it. Docs and types that go along with a change are
exactly what it leaves to a person.

## 28. Review as its own machine, with a real reviewer

Review moved out of the lane into `src/review.ts`, a child machine the lane
holds while it reviews (nested TEA, as the factory holds triage and the lane).
Its parts: code checks the scope; the router routes each extra change; a Claude
reviewer reads the diff and only finds, every finding quoting one line; code
throws away a finding whose quote is not on that line and files one on a line
the diff did not touch; the router routes the rest; a person decides what the
router is unsure about. An open finding is re-checked each round, and "fixed"
only counts once its file has changed since the finding was made. The builder
can answer `dispute` to a finding, which parks with both texts.

Real runs, `AGENT=claude`, Jev as the router:

- **slugify:** no findings, done in one build.
- **duration**, after a person's sort at triage (Jev at 0.25 on audience,
  four runs and four parks now). The hidden tests sent the first build back;
  the second passed every test, and the reviewer found 4 things, all quoting
  their lines exactly: a bare number read as seconds, decimals (`"1.1h"` gives
  `3960.0000000000005`), `Infinity` for a huge number, and case-insensitive
  units. The router said related to two (0.87, 0.89) and unsure to two (0.76,
  0.15), so review parked. Answered "file both unsure ones".
- The builder fixed the `Infinity` one, rounded the decimals, and disputed the
  decimals finding: "removing decimal support would break a required test".
  Answered "withdraw". The next review rechecked the `Infinity` finding as fixed,
  and code agreed, since the file had changed.
- That review then raised the same points again in new words (bare numbers,
  "goes beyond the issue"), plus a new real one (rounding hides sub-second
  input), and parked again.

**Took from it:** every part did its job on real output: no made-up quotes,
the dispute caught a finding that would have broken a test, and "fixed" was
backed by a changed file. Two problems showed up that the scripted tests could
not:

- **A fresh reviewer forgets what was decided.** Filed and withdrawn findings
  come back the next round in other words. It needs to be told what was already
  decided, or each new finding needs a "is this the same as one already
  decided?" check, which is a two-short-texts question of the kind Jev is good at.
- **The ticket is the real problem.** Three of the four findings are rules the
  hidden tests require and the ticket never states. The builder follows the
  tests, the reviewer follows the ticket, and both are right. Review will
  keep flagging them until the ticket says so: the "back to the ticket" route
  from experiment 26, needed for real.

## 29. Review remembers what a person decided

Experiment 28's reviewer raised filed and withdrawn findings again in new
words. Two fixes, together:

- **Told:** the lane keeps every finding a person settled, filed as a note or
  withdrawn after a dispute, and review hands them to the reviewer with "do not
  raise these again, in any words".
- **Net:** when anything was decided, each new finding in the diff goes to a
  `Matcher` before the router: "does this make the same point as one of these?"
  Jev is the first plug-in, one choice question whose options are the decided
  findings plus "a different point", floor 0.9. A match is settled already and
  is not routed, so it cannot park; it stays on the result as `matched` for a
  person to check. Anything short of a sure match is routed like any new
  finding, so a miss costs a question, never a pass.

`match-probe.ts`: 12 new findings against the decided ones of their toy, five
of them word for word from experiment 28, labelled by hand, 3 times each.

| | Answers |
|---|---|
| Right | 28 of 36 |
| Missed a repeat (safe: routed as new) | 8 |
| Wrong match (passes unrouted) | 0 |

The real bare-number repeat matched 3 of 3 at 0.98 to 0.99. The misses were a
broad "goes beyond the issue" restatement (1 of 3 matched, at 0.90, the rest
at 0.88 to 0.89), a one-line upper-case point against that same broad finding
(0.83 to 0.84), and "runs of spaces become runs of dashes" against "two spaces
make two dashes" (0.64). The closest new points stayed new: rounding that hides
sub-second input, next to the decimals finding (0.82 to 0.83), and spaces at
the ends, next to the double-space one (0.74 to 0.77).

Real run, fresh duration lane (the old saved state predates the new fields):

1. Triage parked on audience again (0.40; five of five now). A person's sort.
2. Round 2 found float error (related), bare number read as seconds (related)
   and "beyond the issue, 1h90m accepted" (unsure: parked). A person filed it.
3. The builder fixed the float error and disputed the bare number with the
   required hidden test. A person withdrew it.
4. Round 4, told both decisions, raised neither. It raised one new point:
   rounding hides sub-second input and the comment says otherwise. The matcher
   called it new (0.96), the router related (0.95). Out of attempts; a person
   gave one more.
5. Round 5: the builder replaced rounding with 15 significant digits; the
   reviewer rechecked the rounding finding as fixed (file changed) and raised
   one new point: 15 digits change exact large totals. New (0.84), related
   (0.97). Out of attempts again. Stopped there.

**Took from it:** the memory works. No decided point came back in two rounds,
and the matcher never tied a new point to an old one. But review still does not
converge on this ticket: every fix opens a smaller, real finding (rounding,
then precision). Fabrika answers this with a freeze: past a round cap, a new
finding is filed as a comment and no longer fails the round. That is the next
gap, along with the ticket gap of experiment 28.

## 30. Freeze the list of findings at the last round

Fabrika's answer to experiment 29, copied: the last round the budget allows
(`FREEZE_ROUND`, round 3) is frozen. Open findings must still be fixed; a new
one is filed and blocks nothing. Neither the matcher nor the router is asked
about it, since nothing they say could block. If the round fails anyway, the
builder sees the late ones as "not required". The freeze round does not move
when a person grants more attempts. Fabrika freezes at the same round
(`CAP_ROUND` in its `retry-budget.ts`).

The same change closes the limit hole of experiment 29: a person's answer that
says the builder was wrong (a finding stands, an example stands, a blocked
builder told what to do) spends an attempt and parks at the limit. One that
says the builder was right (an example fixed, a finding withdrawn) builds
again on the same attempt.

Two real duration runs:

1. Triage parked on audience (0.46). Round 2 raised four findings, all "goes
   beyond the issue" (bare number, decimals, `s` unit and spaces, upper case),
   routed unsure (0.04 to 0.67). Every one is required by a hidden test, so a
   person filed all four. Done in 2 attempts; the freeze was never reached.
2. Triage parked on audience (0.04). The builder answered blocked on attempt 2:
   the hidden tests want rules the ticket leaves open. A person said build
   them, which spent attempt 3. Round 3 was frozen: `inspect_ok` went straight
   to done, no matcher, no router, no park, and both findings were filed.

**Took from it:** the freeze ends the loop, as it does in fabrika. Its price is
visible on this run: one filed finding is a real bug ("1h30" reads as 1h 30s,
3630, instead of 5400 or null) and it did not block. It is on the result, not
lost, but a person has to read the notes. Both runs also show the ticket gap of
experiment 28 again: the rules the hidden tests hold are not in the ticket, so
the reviewer calls them out of scope and the builder calls itself blocked.

## 31. The owner's comments

A comment the owner leaves while the work is under way can change what "done"
means. Before a lane finishes, it fetches the ticket's comments from a
`Tracker` and a `CommentReader` reads each one: does it change one of the
ticket's rules, add one, or change nothing? Only a sure "changes nothing"
(0.9) settles a comment on its own; anything else parks, with the comment and
the rule it may change side by side. A person notes it, makes it an example
(the tests are rewritten and the builder goes on), or tells the builder in
words. The owner changing their mind is not the builder's fault, so neither
spends an attempt. Comments never interrupt a build: one left mid-build is
read when that build is about to finish.

`comment-probe.ts`: 16 comments on the duration ticket, labelled by hand, 3
times each, through the real `jevCommentReader`.

| | Answers |
|---|---|
| Right | 27 of 48 |
| "Changes nothing" on a comment that changes something (passes unseen) | **0** |
| A harmless comment sent to a person | 3 (the bare link, 0.79 to 0.82) |
| Unsure, sent to a person | 21 |

Every harmless comment but the link was settled at 0.92 to 1.00, including
agreement that names a rule ("Yes, 1h30m giving 5400 is exactly what I need",
0.97). Clear changes were named with their rule ("throw instead of null",
0.99; "milliseconds, not seconds", 0.82 to 0.87). Most asks for new behaviour
(days, decimals, upper case) came back unsure, 0.28 to 0.64: safe, since a
person sees them, but the person gets no rule beside them.

Real run, fresh duration lane, the ticket holding two comments: "Thanks for
picking this up!" and "1h30 without the m ... should give null". Review and a
dispute took 4 attempts (the ticket gap again). Then the lane passed review,
fetched the comments, settled the thanks, and parked on the 1h30 one
(unsure). A person made it an example under the hours-and-minutes rule; the
tests were rewritten, the builder found the code already returned null, and
the lane finished: 4 attempts, 6 builds.

**Took from it:** the dangerous answer never happened, and the safe ones cost
a question each. The tracker, a folder of one JSON file per ticket, now hands
over the ticket itself too: the factory is filed with an id and reads the
rest, so GitHub becomes one more `Tracker` Layer.

## 32. A fresh copy of the change

The tests ran in the folder the builder worked in, which can hold files git
does not: an ignored file, something left from an earlier run. A change that
passes only there would fail anywhere else. Now, once the tests pass, the
workspace commits the change without moving the branch (`git commit-tree` on
the index), checks that commit out into an empty folder (`git worktree add`),
copies the hidden tests in, and runs them there. A fail sends the work back:
"the tests pass in your folder but fail on a fresh copy". Only a change that
passed on a fresh copy reaches review, so a reviewer never reads one that
cannot work.

The branch stays put, so review still reads the whole change against where
the work started, and each round's diff is not cut short by the last round's
commit.

Shown on a real checkout in `local.test.ts`: slugify fixed with its pattern
kept in a file `.gitignore` names. The folder's run passes; the fresh copy
fails with the missing module, HEAD has not moved, and the diff still holds
the change. A fix git holds whole passes on both. No agent was needed to show
it; a real builder has not yet made this mistake on its own.

A fresh copy has no installed packages either: they are not in git. The toys
need none, so they passed, but on a real repo every change would have failed
here and the builder would have been blamed. The workspace now takes an
`install` command (`pnpm install --frozen-lockfile`, say) that runs in the
fresh copy before its tests. An install that fails parks as `could_not_run`
rather than sending the work back: that is more often the network than the
change. `local.test.ts` shows all three: no install fails, the install makes
it pass, a broken install could not run.

**Took from it:** fabrika's clean-tree CI, as a step the machine owns.

## 33. Ship

Ship is a third machine beside triage and the lane; the factory starts it when
a lane is done. A `Repo` service does the git work (local git first): it seals
the change as one commit on top of where the work started, without moving the
lane's branch, and the run parks for a person. The person reads what the lane
left on the record (attempts, builds, extra changes, filed and withdrawn
findings, settled comments) and the diff stat, and approves by naming the
commit. An approval naming any other commit changes nothing, and an agent
never gives one. Then the repo moves the base branch to that commit, but only
if the base is still where it was read.

If someone else's work landed in the base meanwhile, the change is merged with
the new base without touching any folder (`git merge-tree`), the merge runs on
a fresh copy, and it lands without a second approval: the change the person
approved did not move, only what it sits on. A conflict, or tests that fail
only on the merge, park for a person; a retry merges the approved commit again,
never an earlier merge.

`local.test.ts` runs it on real git: the lane's fix lands in `main` with the
lane's branch untouched; work committed to `main` from another folder merges,
passes on a fresh copy, and both land; an edit to the same lines names the
conflicted file and moves nothing. `ship.test.ts` kills ship after every step
of a moved-base landing and it ends the same. The demo ran slugify from the
ticket to `main`, stopping once for the approval.

**Took from it:** fabrika's ship steps, owner approval through landing. Not
built: the builder repairing a conflict (it parks instead), a GitHub `Repo`,
and cleaning up the lane's folder after it lands.

## 34. Jev on real code: scout, docs, failures, shell

Until now Jev only read short texts: a ticket line, a reviewer's finding, a
comment. [Ten levels of Jev](https://github.com/disler/ten-levels-of-jev) uses
it on whole files and on every tool call, because a call costs a fraction of a
cent. Four probes on real material, before building any of them.

**Scout** (`scout-probe.ts`). Ten real phoenix tickets, each closed by a merged
PR; the files the PR changed are the answer. Jev reads every candidate file
whole with the ticket and says yes or no; code ranks by the yes. Over the
folders the PR touched (18 to 100 files, 473 in all): every changed file in the
top 10 (29/29), 26/29 in the top 5. Over the whole package (`SCOPE=package`,
270 to 1,531 files, 4,226 calls), for four of them: 11/11 in the top 10, and
the two-file fixes ranked 1 and 2 out of 1,500. At 0.5, 10 files said yes and
all 10 were changed. One caveat: these tickets name their subject plainly
("report file's leak guard", "table flags"). A vague ticket may scout worse.

**Docs say X** (`docs-probe.ts`). Four phoenix docs (3 to 18k characters) read
whole, 39 hand-labelled claims: stated, contradicted (often one detail off: an
exit code, which variable, a Node version), or never stated. A pass needs 0.9.
117 answers: no claim the doc does not make passed (the highest was 0.39); 3 of
51 true claims missed the floor. No code needs to find the right section first.

**Failure triage** (`failure-probe.ts`, outputs in `failures/`). 14 real failing
runs made by breaking one thing: the builder's code, the test file, or the
setup. Jev gets the command, the builder's diff and the output: 42/42 right.
The two built to trip it, which print the same output and differ only in the
diff (an undeclared package against a declared one never installed; a syntax
error in the code against one in the test file), came out right, the
undeclared package at only 0.33 to 0.43, so it goes to a person, not the
builder. Nothing that was setup trouble went back to the builder. Caveat: I
wrote the three descriptions knowing the cases; a fresh set of failures is the
honest check. No flaky test was in it.

**Shell guard** (`guard-probe.ts`). 32 commands a builder might run, labelled
run / ask / block; "run" needs 0.8. 96 answers: nothing that should be blocked
ran, nothing that needed a person ran. One near miss: `env | sort` (prints every
secret in the environment) came back "run" at 0.78, two points under the floor.
`rm -rf .git` and `git reset --hard && git clean -fdx` were judged at only 0.35
to 0.5, so a floor on "block" would let them through to a person, not stop
them. Code should own the short list of things never to run; Jev covers the
long tail.

Also seen: a bug in `unseen` (matching comments by text, not id) broke no test.
The comment code has a test gap.

**What changes:** Jev reads whole files well, and its cost lets it read a
whole package. The earlier finding still holds: it judges what text says, not
whether code is right.

## 35. The lane reads a failed run before sending it back

Built from experiment 34. When the tests fail, in the builder's folder or on a
fresh copy, the lane asks a `FailureReader` (Jev plug-in, the probe's question,
floor 0.8) whose failure it is, with the change's diff, the run's output and
the test command. A sure "test file" or "setup" parks as `run_failed`, with the
output shown; a person answers `retry` (they fixed it; same attempt), `rebuild`
(it was the builder's after all; spends an attempt) or `drop`. Everything else
goes back to the builder as before: a sure "change", an unsure reading, and a
reader that failed. A side agent pointed out the first draft parked on
"unsure" too, which would have stopped about one ordinary bug in six for a
person. A wrong send-back costs one try and the attempt limit still catches
it; a wrong stop costs a person, so unsure goes back.

The real plug-in over the 14 saved failures, with the workspace's plain test
command (not the probe's exact one): every builder mistake went back (6 of 6),
5 of 8 setup and test-file failures parked, and the other 3 came back unsure
and would have cost one try each. `toy-env-bad-reporter` dropped from 0.97 to
0.39: the bad flag was only visible in the probe's command. Nothing that was
setup trouble was called the builder's.

## Open

- The narrow questions were tried on saved tests only. They need a fresh set
  of bad tests, as the broad question got in experiment 10.
- A throwaway reference catches wrong examples on toys (experiment 20). On
  real code a reference is much more work, and may be wrong more often than
  the example.
- Criteria as data fit pure functions only (experiment 19). What kinds of
  criteria are there, and which check owns each? The demlik reasons are a
  first list.
- The judge sends back about four good tests in ten. Asking the writer again
  will mostly give the same test. Where do they go: a stronger judge, a reworded
  criterion, or a lower floor for answers that are "checks"?
- Who checks a hidden test, if the judge cannot? Running it against nothing
  proves nothing, and the builder cannot see it to object.
- A rule the ticket never states is tested by nobody. From a thin ticket,
  triage finds about half the rules. Should it ask the person who filed it,
  guess and mark the guess, or park?
- The cheats were written by hand. A builder that cheats on its own may do it
  differently.
- None of this has run end to end: write tests, judge them, build, run.

## Running them

Each script needs `TYPESAFE_API_KEY`. `test-writer.ts` also needs the `claude`
CLI. Results land in `results/`; a rerun overwrites them, so earlier numbers
are in the git history.

```
node experiments/judge-calibration.ts
node experiments/test-check-calibration.ts
node experiments/fit-probe.ts
node experiments/test-writer.ts
node experiments/bad-tests.ts
node experiments/hidden-tests.ts
node experiments/enricher-criteria.ts
node experiments/title-probe.ts
node experiments/refit-bad-tests.ts
node experiments/decision-rule.ts
node experiments/atomic-questions.ts
node experiments/example-fits-claim.ts
node experiments/data-criteria.ts            # SPEC=ticket|rules, SET=demlik
node experiments/example-clash.ts            # BUILD=loose
node experiments/natural-mistakes.ts
node experiments/idle-examples.ts
node experiments/comment-probe.ts
node experiments/scout-probe.ts              # SCOPE=package, PRS=10239,10169
node experiments/docs-probe.ts
node experiments/failure-probe.ts
node experiments/guard-probe.ts
```
