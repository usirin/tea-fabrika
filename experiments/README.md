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

## 36. Jev finds the file a change forgot

`missing-probe.ts`. Can Jev spot a file the change should have touched and did
not? Nine merged phoenix PRs that close one issue. In each trial one file the
PR changed (and that existed before it) is hidden: Jev sees the ticket and the
PR's diff without that file, as if the builder had forgotten it. Then every
other file, as it was before the PR, gets one `noul` question: "does finishing
the ticket mean this file has to change too?" Code ranks the files by the yes.
The control hides nothing, so the diff is whole and any file at 0.5 or more is
a false alarm.

| Run | Trials | Calls | Hidden file 1st | Top 5 | Top 10 | Others at 0.5+ |
|---|---|---|---|---|---|---|
| PR's folders (~35 files) | 28 | 1,076 in 11s | 24 | 27 | 28 | median 0, max 1 |
| Whole package (268 to 1,591 files) | 28 | 36,171 in 367s | 22 | 26 | 27 | median 0, max 1 (5 trials) |
| Control, PR's folders | 9 | 345 | | | | 0 |
| Control, whole package | 9 | 11,786 | | | | 0 (highest 0.48) |

Read as a gate (flag a file at 0.5 or more), the package run catches 22 of 28
forgotten files, each ranked first, with 5 wrong flags in 28 trials and none
on the 9 complete changes.

The whole package cost about $20, not the $0.60 first written here: Jev bills
by the token, and each call carried a whole file and a diff, about 13,000
tokens. The day's bill was $21.31 for 508M tokens, about $0.04 a million. Most
of that bought nothing new: the folder run had already shown the hidden file is
found, and the open question (do 1,500 candidates bring noise?) was answered by
the control, about a quarter of the cost. Since then `jev.ts` stops a run at
MAX_DOLLARS (default $5) and prints what it spent.

The 6 misses share a shape: the forgotten edit is a small knock-on, not the
ticket's subject. `port.ts` in #8770 ranked 15th of 268 (0.14); the two
`signatures` files of #7288 ranked 5th and 3rd at about 0.2; `prep-verb` in
#10088 ranked 2nd and 4th under 0.5; `command.ts` in #10500 ranked 6th. Jev
finds the file the ticket is about; it does not trace that a type moved and a
caller has to follow. Code (the typechecker, a reference search) is the better
owner of that kind.

Caveats: these tickets name their subject plainly, as in the scout probe of
experiment 34; the PRs are one repo's, and the hidden file is a real edit, so
"forgot a new file" is not tested.

**Now built** into review (`jevMissingReader` in `src/route.ts`, the probe's
question word for word). It runs beside the reviewer agent, over the packages
the change touched; a file at `review.missing_floor` (0.5) or more goes back to
the builder as a finding, unrouted, which it fixes by touching the file or
disputes. Over `review.missing_max_files` (2,000) candidates, or when the
reader fails, the check is skipped and the result says so; it never parks.
The real plug-in on #9611 (PR 9618) with `state-dir.ts` hidden: 911 files
asked in 15s, one flagged, the hidden one, at 0.95.

## 37. Jev spots a duplicate at filing

`dup-probe.ts`. When an issue is filed, can Jev tell which open issue it
repeats? Phoenix's triage closes duplicates with a comment ("Closing as a
duplicate of #N"); 167 such pairs were found by searching closed issues for
"duplicate of" in comments. In 143 of them the original was still open when the
duplicate was filed; the other 24 cannot be found by a check over open issues
and are left out. Thirty pairs, spread over the repo's history, each against
every issue open when it was filed (63 to 714). Ten controls: issues closed as
done, never as duplicates, against their own open pools. One `noul` per
candidate: could the new issue be closed and the open one worked without losing
anything? Titles and the first 3,000 characters of each body. 14,554 calls in
99s, well under a dollar (at most about 2,000 tokens a call; the "25 cents"
first written here priced it per call, the mistake section 36 explains).

The original ranked 1st in 26 of 30, top 5 in all 30. The 4 that ranked 2nd
lost to another duplicate of the same original (#3711, #5056, #6328 are each
closed as a duplicate of the same issue) or to a near-twin the record did not
link (#5786 against #5755, same title in other words). So read against
"is it the same request", Jev's first pick was right in 30 of 30.

The first 10 controls raised one flag (0.57), too few to trust a floor on, so
a second run widened them to 105 (`PAIRS=0 CONTROLS=70 BUSY=35`): 70 plain
issues spread over the repo's history and 35 filed in a burst, each the plain
issue filed closest to a duplicate, so it faces the same open pool as that
duplicate's twin. 35,374 calls in 243s, a dollar or two by token count (the
"60 cents" first written here priced it per call).

| Floor | Pairs flagged with a true twin | Wrong flags in pairs | Controls flagged (of 105) |
|---|---|---|---|
| 0.5 | 24 / 30 | 3 (0.54, 0.54, 0.59) | 11 (12 flags) |
| 0.6 | 20 / 30 | 0 | 3 (4 flags) |
| 0.7 | 19 / 30 | 0 | 2 (3 flags) |
| 0.8 | 16 / 30 | 0 | 0 |
| 0.9 | 3 / 30 | 0 | 0 |

"Wrong" in the pairs excludes other members of the same duplicate group and
the #5755 twin, all checked by hand; at 0.6 and above every pair flag was one
of those. The highest control score was 0.78. The three control flags at 0.7
are not plainly wrong either: #6995 against #5979 (0.78) have the same title
word for word, both closed as done, a twin the record never linked; #3062
(0.76, 0.75) is the cut-over task of the epic #3045 and of #3031, which are
themselves near-twins. Busy-week controls flagged no more often than spread
ones (1 of 35 against 1 of 70 at 0.7).

What it misses: in the 6 pairs under 0.5 the original still ranked 1st, but
Jev was not sure (#7612 at 0.07, #6058 at 0.25, #6706 at 0.24, three more just
under 0.5). Why those six score low was not read; the closing comments on
such cases often argue over several paragraphs that a wider issue covers a
narrower one, which is a judgment, not a match.

So a floor of 0.7 can say "this looks like a duplicate of #N, ask a person"
about two times in three, and asks about roughly 2 in 100 plain filings, both
of which here pointed at a real near-twin. A floor of 0.8 asks about none of
the 105 plain filings and still catches about half the duplicates. Since a
flag costs one look from a person, 0.7 is the better trade. Below the floor
the top three still hold the original every time, which is cheap context for
triage.

Caveats: 30 pairs is small. The ground truth is triage's own closing comments,
which miss twins (#5755, #5979). One repo, written mostly by agents, so
duplicates are often filed minutes apart in near-identical words. The "busy"
controls are near a duplicate in time, not picked for being on the same
subject. The titles-only variant (`TITLES=1`) was not run.

## 38. A free filter before the missing-file check

`name-filter.ts`. The missing-file check of experiment 36 asks Jev about every
untouched file in the touched packages: about 1,500 files, 13,000 tokens each,
about $0.80 a review. Can plain code (git and text search, no Jev) cut that
list first and still keep the forgotten file? The script rebuilds the same 28
trials and 9 controls (`missing-trials.ts`, now shared with the probe) and
checks that each has the very candidates Jev scored. No Jev call; it runs in
about 45s.

Each filter keeps a candidate when:

- **paths**: it names a changed file the way an import does: the changed
  file's stem (its name up to the first dot, so `check-verb.unit.test.ts` is
  `check-verb`) right after `/`, `'`, `"` or a backtick and right before `.`
  or a quote.
- **uses**: the other way round: a changed file, as the PR left it, names the
  candidate's stem that way.
- **stems**: it holds a changed file's stem as a whole word anywhere.
- **names@N%**: it holds, as a whole identifier, a name from the diff's added
  or removed lines (`[A-Za-z_$][\w$]*`, 4 letters or more, not a keyword or a
  stock word like `value` or `expect`), counting only names found in N% of
  the candidates or fewer. A name in most files matches everything.
- **folder**: it sits in the same folder as a changed file.
- **twin**: same folder and stem as a changed file (`x.ts` and `x.unit.test.ts`).
- **cochange**: it changed in the same commit as a changed file, over the last
  50 commits touching one, skipping commits of more than 20 files.
- **+**: the union of filters.

Jev scores each file on its own, so its saved scores still hold on any shorter
list. "Caught" is the forgotten file kept and at 0.5 or more; "wrong flags"
are other kept files at 0.5 or more. Cost is kept files × 13,000 tokens ×
$0.042 a million, per review.

| Filter | Forgotten file kept | Jev's 22 wins kept | Caught | Wrong flags | Files kept, median / max | $ a review, median / max | Controls, median kept |
|---|---|---|---|---|---|---|---|
| none (today) | 28 / 28 | 22 | 22 | 5 | 1,500 / 1,591 | 0.82 / 0.87 | 1,509 |
| paths | 21 / 28 | 17 | 17 | 3 | 24 / 163 | 0.013 / 0.089 | 26 |
| uses | 22 / 28 | 18 | 18 | 1 | 113 / 369 | 0.061 / 0.20 | 116 |
| **paths + uses** | 28 / 28 | 22 | 22 | 3 | 119 / 462 | 0.065 / 0.25 | 122 |
| stems | 27 / 28 | 21 | 21 | 3 | 132 / 448 | 0.072 / 0.25 | 136 |
| names@1% | 24 / 28 | 20 | 20 | 1 | 61 / 170 | 0.033 / 0.093 | 71 |
| names@2% | 28 / 28 | 22 | 22 | 3 | 155 / 419 | 0.085 / 0.23 | 182 |
| names@5% | 28 / 28 | 22 | 22 | 4 | 344 / 947 | 0.19 / 0.52 | 349 |
| names@20% | 28 / 28 | 22 | 22 | 5 | 1,328 / 1,538 | 0.73 / 0.84 | 1,349 |
| paths + names@2% | 28 / 28 | 22 | 22 | 4 | 184 / 419 | 0.10 / 0.23 | 215 |
| paths + names@5% | 28 / 28 | 22 | 22 | 5 | 361 / 947 | 0.20 / 0.52 | 389 |
| folder | 28 / 28 | 22 | 22 | 2 | 30 / 97 | 0.016 / 0.053 | 29 |
| paths + folder | 28 / 28 | 22 | 22 | 3 | 44 / 247 | 0.024 / 0.14 | 54 |
| paths + uses + folder | 28 / 28 | 22 | 22 | 3 | 133 / 475 | 0.073 / 0.26 | 136 |
| twin | 24 / 28 | 20 | 20 | 0 | 1 / 2 | 0.001 / 0.001 | 0 |
| cochange | 5 / 28 | 4 | 4 | 0 | 0 / 102 | 0 / 0.056 | 1 |
| cochange, no size cap | 28 / 28 | 22 | 22 | 5 | 1,328 / 1,464 | 0.73 / 0.80 | 1,327 |

No forgotten file was dropped by every filter. Each one-way filter loses a
direction. **paths** keeps files that import a changed file, so it drops a
source file that imports nothing the change touched, typically one whose own
test changed (`leaks.ts`, `flags.ts`, `index-table.ts`, `spec.ts`,
`signatures.ts`, `sync-verb.ts`), and in #8770 `port.ts`, which `shape.ts`
imports, not the other way. **uses** keeps what a changed file imports, so it
drops a forgotten test: tests import the code, the code never imports its
tests. Together they keep all 28. **names@1%** drops `port.ts` too: the names
it shares with the diff are in more than 1% of the package, which is what a
widely used type looks like. **twin** misses files with no namesake in the
change (`command.ts`, `port.ts`, `bin.ts`, `boot.unit.test.ts`). **cochange**
fails on phoenix's history: the commits touching a file are mostly big
squashes (the only three before #10239 touching `leaks.ts` or its test
changed 89, 134 and 4,591 files), so with a size cap almost nothing is left, and without one
almost everything is.

**paths + uses** (an import neighbour one step either way, by name) keeps
every forgotten file and every Jev win, at about a twelfth of the list: $0.065
a review at the median, $0.25 at worst, against $0.82. It also drops 2 of the
5 wrong flags. On the controls the list is the same size (median 122), so the
cut does not depend on something being hidden.

**folder** looks better still (median 30), but these PRs were picked to stay
inside one or two folders (the scout probe's list), so every forgotten file
here shares a folder with a changed file by construction. It is not evidence
that a forgotten file usually sits next to the change. The misses of
experiment 36 were knock-ons across a type or a caller, the kind a folder
filter would lose on other PRs.

Caveats: 28 trials from 9 PRs in one repo, mostly pairs of code and test.
"Paths" and "uses" match names, not a resolved import graph: a stem like
`index` or `types` matches any file of that name. How much of the 462-file
maximum (#10500) that explains was not checked. The cost assumes every kept
file costs 13,000 tokens like the average one; the size of the kept files was
not measured. A forgotten file that nothing imports and that imports nothing
changed (a doc, a config listing) would be lost by paths + uses; there was
none in these trials.

Open: resolve imports with the typechecker instead of by name, to cut the
stem noise? Try PRs that cross folders, so the folder filter gets a fair test.

Since then: paths + uses is the missing-file check's default
(`missing_scope = "imports"`; `"package"` is the old behaviour). The rule lives
in `src/imports.ts`, and this script imports it from there, so the measured
rule and the shipped one are the same code; a rerun on it gave the same table.

## 39. Jev stops deciding who picks an issue up

Not an experiment, a change the runs forced. The first real ticket,
kamp-us/demlik#558 (run 1), parked at triage on the audience question: "human",
0.52, under a floor of 0.8. The duration toy had parked there on every real
run since experiment 23, at 0.04 to 0.46 (sections 23 to 30). Jev reads only the
rewritten ticket, so it cannot tell whether the work rests on a call nobody
has made. The enricher has read the code and can.

So the audience question is gone. The enricher answers a typed
`open_decision`: one question for the owner, or null. Code routes on it: set
means triage parks as `needs_decision` with no Jev call, and the owner's ruling
goes back to the enricher in the same conversation for a new rewrite; null
means Jev sorts type, priority and value as before. A `triaged` issue now
always means an agent can build it. An older saved run sorted for a person
reads back parked on `needs_decision`, since Jev never said what the call was.

Open: how often the enricher names a call where a person would not, and the
other way round. Measure it on the next real tickets.

## 40. The first real ticket, run 2: what went wrong after triage

Not an experiment, a run. kamp-us/demlik#558 ("replay still requires ctx for
a machine that has none") again, filed from the original report on purpose,
so our enricher did the rewrite. Fabrika's own rewrite of the same issue was
kept beside the run to compare. Real Claude Code agents, real Jev.

**Triage.** The enricher read the code and parked on one open call: should
the testing helpers (`expectFinalState` and the others that share
`ReplayOpts`) drop `ctx` too, or only `replay`? Fabrika's triage had put them
in scope without asking. The owner said yes, and the rewrite came back with
14 criteria: 7 with examples, 7 unchecked (4 about types, 3 about doc pages).
Jev sorted it bug at 0.41 (the buildable side held, so it passed), p2 at
0.51, worth doing at 1.

**Prepare.** The lane parked on the 7 unchecked criteria, and a person said
skip. Of the 7 examples, 5 held on the untouched code and 2 failed. The bug is
in the types: at runtime `replay` already ran with `ctx` left out. Only the
two examples about the `{}` default could fail at runtime. A test of calls and
results can barely see a type-level bug.

**Build.** Three attempts. The enricher had written its examples with plain
object literals standing in for machines, such as
`expectCmdEmitted({ init: …, update: … }, …)`. That generated test did not
typecheck, so on attempt 2 the builder removed `NoInfer` from
`expectCmdEmitted`'s `cmd` parameter. Checked by hand: after that change,
`expectCmdEmitted(m, opts, { type: "typo" })` compiles, where before it was a
type error. A stable API was weakened to fit our generated test. Attempt 3
fixed a docs mirror test and passed every check, then the scope check sent it
back: it had changed the tutorial and the how-to page, which only unchecked
criteria named, and `kindOf` dropped an unchecked criterion's file, so no
criterion named them. That was the third attempt; a person gave one more.

**Review.** Attempt 4 listed the pages as deviations. The router called 4 of
the 5 extra files related and was unsure about the changeset, at 0.48, so the
round parked. Separately, the builder made `ctx` optional for a machine typed
`ctx: undefined` too. Fabrika's rewrite named exactly that widening as a
rabbit-hole to stay out of; our enricher wrote no limits at all, and its own
criterion listed `undefined` among the types that should allow it. The run
was dropped.

What changed after it:

- **Examples use the library as its users do.** The enricher is told to build
  a value a call takes with the library's own constructor, inline (a real
  machine made with its constructor, not a plain object), and to write only
  examples that typecheck against the code as the issue leaves it with no
  change the issue does not ask for. A criterion now lists the other names its
  calls `uses`, each with its file, and the test writer imports them beside the
  criterion's own name, so `replay(defineMachine({…}), {…}).state` can be one
  test. The builder is told to answer `contradiction` when an example can only
  pass, or only typecheck, by changing something the issue does not ask for.
- **Unchecked criteria keep their files.** The enricher lists the files an
  unchecked rule is about (or none), and the scope check counts them as named.
  A change to a doc page only an unchecked criterion names is no deviation.
  Saved runs read back with `uses: []` and `files: []`.
- **Triage on its own.** `UNTIL=triage` stops a real run once triage is done,
  before the lane touches the repo, and prints our whole rewrite. It is kept
  as `ours-enriched.md`, laid out like `fabrika-enriched.md`, to compare.
- **Set aside: a pitch.** Fabrika's rewrite also writes a pitch: the problem,
  an appetite, rabbit-holes, no-gos and a success line. Adding those to the
  enricher's one turn was proposed, then set aside: enrichment will be
  redesigned as several smaller steps, code and narrow model calls, instead of
  a bigger single turn.

Open: no criterion can name a changeset, whose file name is made up when it is
written, so the router judges it every time. And the limits the undefined
widening crossed still have no home until the enrichment redesign.

## 41. Enrichment in small steps: facts, a draft, vetting

Not an experiment, a redesign, step 1 of it. The same end result as before (a
rewrite with criteria as data, and the call nobody has made), but not one big
agent turn. Each part goes to what does it best:

| Part | Owner | Why |
|---|---|---|
| What the report mentions: backticked names, file paths, `#N` refs | Code (`mentionsOf`) | Exact. A pure function in the reducer |
| Facts: where each name is declared, its signature, its callers, which export subpaths publish it, whether each path is at HEAD | Code (`Facts` service: git, code-graph, a few lines by hand) | Exact, and cheap: 5.5 s on kamp-us/demlik#558. The enricher no longer digs for them |
| The rewrite: body, criteria, the open call | Agent, ending in typed data | Open-ended writing. It starts from the facts and may still read the code |
| Vetting the draft | Code (`Workspace.vet`, then `vetProblems`) | Running is exact: an example either loads, typechecks and fails, or it does not |
| Problems back to the writer | Code routes, agent fixes | In the same conversation, up to `vet_tries` drafts (3 by default), then a person |
| Sorting | Jev, unchanged | |

Triage now goes: fetching → gathering facts → enriching (a draft-and-vet
child) → the owner's call if one is open → sorting → triaged. Facts that cannot
be gathered only mean the enricher reads the code itself, as before. A draft
still failing vetting after its tries parks as `enrichment_unvetted` with
vetting's last word; a person grants more tries (same conversation), accepts
the draft as it is, or drops the issue.

**Draft and vet is a child machine of its own** (`src/refine.ts`), held by
triage with `applyCell` the way the lane holds review. It is made per use,
like tea's `createJevAsk({ name })`: `createRefine({ name: "enrich", brief,
draft, verdict, problemsOf })` makes the Cmds `enrich_write` and
`enrich_check`, so two uses in one parent never share a Msg. The checker's Cmd
hands back what it saw (`Vetted`: missing files, each example's verdict), and
whether that is a pass is `problemsOf`, pure, in the reducer, so a replay
reaches the same verdict. It stops for its parent when it is done, out of
tries, or when the writer or the checker failed; the parent decides who is asked.

The lane's builder → check loop stays its own. Its answers are richer (a
builder may answer contradiction, blocked or dispute; a failed run is read for
whose fault it is; a try can be given back), and it holds review as a child.
Folding it into the draft-and-vet child would grow the child to fit the lane.

**Vetting**, per example, on HEAD in a throwaway worktree with the workspace's
own test flavour: `broken` (does not load, does not typecheck, or throws
anything but its assertion), `holds_already` (passes on today's code) or
`fails` (its assertion fails, as it should before the change). A draft passes
with no broken example, none that holds already, and at least one that fails,
or no examples at all. Every file a criterion names must be at HEAD, and ids
must be unique. Unchecked rules now say what they are about: `type`, `doc` or
`other`. The cost, per draft: about 0.15 s on a toy (node:test), 6.7 s on
kamp-us/demlik (install from the store, `tsc` on the one file, vitest on it).

Run on run 2's own draft of #558 (`experiments/vet-probe.ts`, offline, on a
scratch clone), vetting would have sent it back at once: 6 of its 7 examples do
not typecheck on today's code, and the 7th holds already, so none fails. One of
the 6 is `expectCmdEmitted` with a plain object, "not assignable to type
'never'": the very example the builder later made compile by weakening
`NoInfer` (section 40). The other 5 are the bug itself (`ctx` left out), which
is a rule about types, and the feedback says so.

**What code-graph could and could not do.** Its call graph (`--graph --edges
--json`, run per package so its tsconfig is used) gave every function's
callers, with the line of each call; its resolver
(`loadInProcessGraph().resolveExportOrigin`) told which export subpath publishes
a name, following re-exports the way the compiler does, types included. What
it lacked, done here by hand: the graph holds functions only, so a type or an
interface (`CtxArg`) has no node, no callers and no line; no node carries its
declaration text, so the signature is read from the file; a bare name cannot
be looked up (`--blast` takes a unique name or an id), so declarations are
found with `git grep`; and the resolver only follows an `import` statement in
an existing file, so asking "does this entry export X" needs a probe file that
imports the entry. Its graph reads the folder as it is, not HEAD.

Open: no pitch yet (the problem, no-gos, rabbit-holes), the next step. Facts
do not read doc pages, so a call written in a doc (`replay(m, { ctx:
undefined })` in two of #558's pages) is not found (done in section 42). And
an example could dodge the typecheck with a cast; vetting does not look for one.

## 42. Facts read the doc pages a report names

Run 3 of #558 (`runs/558-3`) missed two things fabrika's own enricher found,
both from doc pages. `docs/how-to/replay-in-a-test.md` also calls
`expectFinalState(downloader, { msgs, ctx: undefined }, …)`, so `ReplayOpts`
and the testing helpers are in scope; ours never saw it. And three doc rules
were marked "unchecked (doc)", though each page has a test that compiles and
runs its code.

Now every mentioned path that is a doc page (`.md`, `.mdx`; or, when not at
HEAD, the same path deeper down) gets two more facts:

- **Its twins: the tests that name the page's path.** In its package a page goes
  by its package-relative path (`docs/how-to/replay-in-a-test.md`), anywhere by
  its path from the root, written after a quote, a space or a `./`. Only test
  files count, the test named like the page first, 3 kept. The other candidate
  was a rule on file names (a test at the page's path, `.md` swapped for
  `.test.ts`). Of tea's 39 doc pages, 25 have a test that names them and only
  12 have a test at the mirrored path: `compose-slices.test.ts` is the twin of
  `compose-two-battery-slices.md`, `engine-how-tos.test.ts` of two engine
  pages, and the typecheck gate `pages-typecheck.test.ts` lists pages by path.
  No page had a mirrored test that does not also name it. Code that names a page
  and is no test (a JSDoc link in `runtime-types.ts`) checks nothing, so it is
  left out. Missed: a page checked only through rows in a non-test module
  (`page-mirrors.ts` for `bound-a-run.md`), one import away from its test.
- **The names its ts and tsx blocks call**: imported by name, or called bare and
  not declared there. Each is looked up like a name the report gives, kept only
  when the repo exports it (the page's `expect` is vitest's), with one
  definition, at most 6 in all, and marked with the page it came from
  (`calledIn`). A name the report gives stays the report's.

The enricher's brief gains one sentence when a page has a twin: such a page is
checked through the twin, so name the twin in the criterion's files and do not
call the rule unchecked doc.

On #558 (`experiments/facts-probe.ts`, a scratch clone of demlik at origin/main):
both pages get their twins (`src/docs/how-to/replay-in-a-test.test.ts`;
`src/docs/tutorial/build-your-first-machine.test.ts` and
`add-your-first-effect.test.ts`), and the pack now holds `defineMachine`,
`expectCmdEmitted` and `expectFinalState`, the last two with `ReplayOpts` in
their signatures. The brief went from 3117 to 5087 characters, the gathering
from 5.4 s to 8.1 s. Not yet tried: a fresh enrichment of #558 with it.

## 43. Claude through the Agent SDK: can a tea machine judge a running agent?

The Draft step (enricher, builder, reviewer) runs `claude -p`: prompt in,
typed answer out, nothing in between. The question: keep Claude's own loop,
but run it through the Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.296,
which ships Claude Code 2.1.296, the same version as the CLI here) and compose
it from outside at three points: its message stream as a tea Sub, a per-call
Check before each tool runs, and its session id. Does the stream give enough to
judge a run, or only to log it?

**Answer: enough to judge and stop a run, not enough to prevent a step.** The
stream holds every tool call, with its full input, a few ms before the call
runs; every result, with an error flag and the tool's own structured output;
and a final result with cost, tokens, time and turns. A machine fed by it
stopped a real run 2 ms after the call it judged. But the step that tripped the
rule still landed on disk. Prevention belongs in the PreToolUse hook, which
runs before each call and whose refusal the agent reads and works around.

Four SDK runs on the duration toy with `criteria.test.js` written in (sonnet,
`acceptEdits`, tools Read, Edit, Write, Glob, Grep and Bash, with Read, Glob
and Grep pre-approved, project settings only), plus one `claude -p` call for
startup. `experiments/sdk-stream-spike.ts`; the logs are in
`results/sdk-stream-*.json`.

| Run | What | Cost | Turns | Time |
|---|---|---|---|---|
| observe | builder turn, through the watch machine, canUseTool as the Check | $0.0451 | 8 | 9.9 s |
| feedback | resume of observe's conversation with "your draft has problems" | $0.0500 | 3 | 9.8 s |
| stop | fresh toy; the machine may let it write `duration.js` only | $0.0067 | 5 | 3.6 s |
| hook | second resume; the PreToolUse hook as the Check | $0.0134 | 3 | 5.2 s |
| startup | `claude -p`, haiku, "reply OK" | $0.0006 | 1 | 0.8 s |

$0.116 in all. A resumed run's `total_cost_usd` carries the conversation's
earlier total, so a resume's own cost is the difference between two results.

**1. The API, from the types.** `query({ prompt, options })` returns an async
generator of `SDKMessage`, plus control methods: `interrupt()`, `close()`,
`setPermissionMode`, `setModel`, `streamInput` and more. The options that matter
here:

- Session: `sessionId` *picks* the id (a UUID) for a new conversation; `resume`
  continues one; the two only combine with `forkSession`, to name the fork.
  So the restart lane can name the builder's conversation before its first
  build, as it does with `--session-id` today.
- Tools: `tools` is the set the agent has (like `--tools`), `allowedTools`
  only pre-approves (like `--allowedTools`), `disallowedTools` removes.
- `canUseTool(toolName, input, { signal, decisionReason, blockedPath, ... })`
  answers `{ behavior: "allow", updatedInput }` or `{ behavior: "deny", message,
  interrupt? }`. It is a permission prompt, so it is asked only about calls
  nothing else has decided.
- `hooks: { PreToolUse: [{ matcher?, hooks: [callback] }] }`; a callback gets
  `{ tool_name, tool_input, tool_use_id, ... }` and may answer
  `permissionDecision: "allow" | "deny" | "ask"` with a reason, rewrite the
  input, add context, or stop the whole run (`continue: false`).
- `permissionMode`: left out, the session takes the mode `claude -p` would,
  which is `auto` (a classifier) where that is the default. Always set it.
- Also: `outputFormat` (a JSON Schema, the answer comes back as
  `structured_output`, as with `--json-schema`), `maxTurns`, `maxBudgetUsd`,
  `settingSources`, `strictMcpConfig`, `abortController`, `sandbox`.

**2. The stream.** In order, for observe: `system/init` 0.9 s after the query
opened (session id, model, mode, the tool list), then one `assistant` message
per tool call and one `user` message per result, a few `rate_limit_event` and
`thinking_tokens` messages, and `result`. What each carries:

- A tool call: name, id and the full input (the whole `Write` content, the
  whole Bash command), before the call runs. The PreToolUse hook fired 1 to 6 ms
  after each call reached the stream; a `Write`'s result came 10 to 14 ms after it.
- A result: `is_error`, the text the model reads, and `tool_use_result`, the
  tool's own output object. For `Edit` and `Write` that holds the diff
  (`structuredPatch`) and the file before (`originalFile`); for `Bash`,
  `stdout`, `stderr` and `interrupted`.
- `result`: `total_cost_usd`, `usage` and `modelUsage`, `duration_ms`,
  `duration_api_ms`, `num_turns`, `permission_denials` (each refused call with
  its input), `terminal_reason`, `structured_output`, `session_id`.

What is missing for judging: a Bash exit code (there is `is_error`, and the
text, but no number in the structured output); which files a shell command
changed (feedback's agent appended to `NOTES.md` with `echo >>`, and no file
event says so); and, after an interrupt, the truth about the last call (below).

**3. The Sub.** `src/watch.ts` is a tea machine whose one Sub, `agent`, is on
while the state is `running`; its deps are the run's id, prompt and session.
The Effect engine's runner (in the spike) opens the query inside
`Stream.callback` and turns each SDK message into Msgs (`msgsOf`):
`tool_called`, `tool_returned`, `finished`, or `ended` when the stream fails.
The reducer keeps a picture (calls so far, files asked to be written, Bash
commands, calls still waiting for a result, the current run of failures of one
command) and judges each Msg with two rules: a write or an edit to a file off
the allowed list, and the same Bash command failing 3 times in a row (reads in
between do not break the run; a pass or another command does). A verdict moves
the state to `stopped`; the Sub's deps go null; the engine closes the runner,
whose finalizer calls `interrupt()`. That is Elm's answer: a subscription ends
when the model stops asking for it, so the stop needs no Cmd and no handle kept
outside the machine. A Cmd could not hold the run at all: the engine waits on a
Cmd before it folds anything else (the cmd-or-sub page), so nothing could be
judged until the run was over. `src/watch.test.ts` covers both rules and
`msgsOf`.

The stop run was told to write `PLAN.md` before any code. The timeline:

| ms | What |
|---|---|
| 4102 | `Write PLAN.md` reaches the stream; the machine stops |
| 4104 | the Sub's finalizer runs |
| 4109 | `interrupt()` answers (`still_queued: []`) |
| 4112 | the call's result: "The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)" |
| 4114 | `result`: `error_during_execution`, `terminal_reason: aborted_streaming`, $0.0067 |
| 4764 | the generator throws "Claude Code returned an error result"; the process is gone |

Left behind: `PLAN.md` on disk, whole, and `duration.js` untouched. The result
text says the write did not happen; it did. So a stop is fast and clean (the
conversation ends, nothing more runs), but the step that tripped it may already
be done, and the transcript is no witness of that: read the folder, not the
log. And the SDK throws after an error result, so a runner has to turn that
into a Msg of its own.

**4. The Check: canUseTool or a PreToolUse hook.** Observe gave the rule
(`git commit|push|checkout`, or a write to anything but `duration.js`) to
canUseTool and a log-only hook. canUseTool was asked about the two Bash calls
only: never about `Write NOTES.md` (`acceptEdits` approves edits inside the
folder), nor about Read, Glob and Grep (pre-approved; the SDK even warns:
"canUseTool will not be invoked for: Read, Glob, Grep"). So `NOTES.md` was
written. The `git commit` was denied; the agent said "Git is handled for me, so
I'll just run the tests", ran them, and finished `done`, its summary saying it
did not commit. The hook fired on every call, `StructuredOutput` included.

Hook run, the same rule in the hook: both calls refused, before either ran. The
agent read "PreToolUse:Write hook error: NOTES.md is outside this issue: change
only duration.js.", tried the commit, read the git refusal, and ended its turn
saying both steps were blocked. canUseTool was never asked: the hook's deny
comes first. Both refusals are in `permission_denials`. The hook is the cleaner
Check: it sees every call whatever the mode and the allow list, and it is a
pure function of the call. canUseTool is for answering a permission prompt,
which is not the question here. One wording catch: the agent reads a hook's
refusal as a "hook error".

Neither stops a shell from writing files. A check on `Write` and `Edit` is no
file boundary while the agent has Bash; the end state (the lane's diff check of
files no criterion names) still has to be read, or the shell taken away, or the
`sandbox` option's write limits used (not tried).

**5. Session.** Observe ran under an id picked before it started, and
`system/init` reported that id. Feedback resumed it with the note and kept the
same id. It held the whole context: no Read at all, straight to a `Write` of
`duration.js` that fixed all three, then one Bash call that appended to
`NOTES.md`, ran the tests and printed the three cases (5400, 5400, 90). It did
not try git again: it remembered the refusal. Hook resumed it a second time,
same id. So refine's same-conversation feedback works, and so does naming the
conversation up front. The SDK has the same split as the CLI (`sessionId` for a
new one, `resume` for an old one), so the "guess wrong, try the other way" in
`src/claude.ts` stays. Not tried: resuming an id that does not exist.

**6. Against `claude -p`.** The SDK runs the same Claude Code, from a binary it
ships (a 230 MB platform package beside a 5 MB SDK), so its version is pinned in
the lockfile instead of whatever `claude` is on the path. Startup is the same:
`system/init` came 0.5 to 0.9 s after opening (0.9 s cold, about 0.55 s after),
and 0.54 s for `claude -p`. From open to result, the SDK added 0.84 s to
observe's 9.9 s; `claude -p` took 1.98 s for a 0.79 s turn, 0.67 s of that
after its result, waiting for the process to exit (the SDK hands over the
result at once). Gained: the live stream, tool checks as plain functions in
our process instead of shell hooks, a stop that ends the conversation instead
of killing a process, typed tool outputs with diffs, `maxBudgetUsd`. Lost: the
box. `claude -p` is a process and a JSON line, easy to fake; the SDK is a
dependency whose defaults bite (the `auto` mode, a canUseTool that is quietly
skipped), and whose generator throws on an error result.

**What the Draft primitive would look like.** A Sub, not a Cmd. The parent
states what it wants as data and the engine holds the run open while the state
asks for it:

```ts
{ type: "draft", deps: { attempt, session: { id, continues }, prompt, tools, schema, check } }
```

`check` is data too (the files it may write, the commands it may not run), and
the runner enforces it in a PreToolUse hook, so a refused call never runs; each
refusal also comes back as a Msg. The stream comes in as `draft_called`,
`draft_returned`, `draft_finished` (the typed answer, cost, turns) and
`draft_failed`. Judging across calls (repeats, budget, drift) is the parent's
reducer, and stopping is the state leaving `drafting`. After a stop or a
finish, what changed is read from the folder, as the lane does now. Two things
to settle before building it: a restarted machine reopens the Sub with the same
deps, so the runner must resume a conversation that already exists rather than
start it again; and a hook that asks the machine (instead of a pure `check`)
would make the Check a round trip through the fold, which nothing here tried.

## 44. The build loop on the draft-and-check child, and a published-API check

Not an experiment, a redesign, with one offline measurement. Every step is
one of five moves: **gather** (code looks something up), **draft** (an agent
with free hands), **check** (code judges the output: pass, or problems),
**judge** (Jev, one narrow question), **ask** (park with typed answers).
Gather, draft, check and judge are Effect services behind Cmds; the loops
that combine them are pure child machines a hand-written parent holds with
`applyCell`. There is no general pipeline language. The rule: limit what
comes out, not how the work is done.

**Part 1: the lane's build loop is now a `createRefine` child** (`building`,
Cmds `build_write` and `build_check`). Section 41 kept it apart because the
builder's answers are richer, a failed run is read for whose fault it is, a
try can be given back, and the lane holds review. Here is how each one fits:

| Lane need | Where it went |
|---|---|
| Draft = the builder's whole answer (done, contradiction, blocked, dispute) | The child's draft type is that union |
| A non-change answer ends the run with no check | New in refine: `stopOf(draft, null, brief)`, a pure hook. The run stops as `stopped` with the reason; the lane parks, or sends back a contradiction that names no real example |
| Tests in the folder, the fresh copy, reading a failure | One Check service (`build_check`): folder tests, the published API, the fresh copy. On a failure it calls the failure reader, a Judge inside a Check. Code reads the run; the verdict is data |
| A sure setup or test-file failure parks; an unsure one does what `onUnsure` says | `stopOf(draft, verdict, brief)` again, after the check: the same hook |
| Review needs the diff and snapshot of the change that passed | Refine's `done` keeps the `verdict` that passed it. This replaces `checked: boolean` (`null` = accepted unchecked) |
| One attempt count across review rounds and a person's answers | New in refine: `start` takes `tries`, the count the run's first draft takes. The lane starts a new run in the same conversation for each send-back: on `attempt + 1`, or on `attempt` when a try is given back |
| The policy sees the issue and knobs | `problemsOf` and `stopOf` get the brief as a third argument |
| Review | Stays a separate child of the lane |

What did not fit as the owner first guessed: **giving a try back is not
refine's `more`.** Every give-back in the lane (a withdrawn finding, a fixed
example, an owner's comment) happens after the run has ended. So it is a new
run that starts on the same try number. `more` adds to the limit of a run
that ran out. The lane does not use it either: "out of attempts" keeps its old
shape, and "more" starts a new run.

So refine got one real addition (`stopOf` and the `stopped` phase) and three
one-line ones (`tries` on start, the brief in the policy, the verdict on
`done`). Each is useful to the enricher too: `stopOf` could send a draft that
names an open decision straight to the owner, skipping the vetting run (6.7 s
on demlik); `tries` could keep one vetting budget across the owner's rulings.
Neither is wired yet.

| | Before | After |
|---|---|---|
| `lane.ts` lines (code without comments or blanks) | 821 (591) | 852 (597), of which about 25 code lines are part 2 |
| Lane phases | 11 | 8 (`checking`, `checking_fresh`, `diagnosing` gone) |
| Lane Cmds and their update cells | 5 Cmds (`prepare`, `build`, `check`, `fresh_check`, `diagnose`), 10 build cells | `prepare` + the child's 2, 4 one-line cells |
| `refine.ts` | 196 (137) | 233 (157) |
| `handlers.ts` | 177 | 197 (the checks run in one handler) |
| `factory.ts` | 448 | 504 (the migration) |

The lane is not shorter. It is simpler in shape: three phases and three Cmds
gone, and the whole "what goes back to the builder" rule is two pure
functions, `buildStop` and `buildProblems`, which drive.ts reuses to print a
check. Lane, restart and factory tests pass with renames: Cmd names, `named:
[]` on start, `newExports` in knobs. Two changes are more than renames:

- **A restart during the checks runs all of them again** (folder, API, fresh
  copy), not only the step in flight. They are one Cmd now.
- **A first build killed in flight is asked again as a first build**
  (`continues: false`). The lane used to guess `true`. Both are guesses; the
  builder tries the other way when the guess is wrong, and the conversation
  is the same either way.

Saved runs still read back (`laneWithBuildLoop`). A build in flight becomes
the child writing, with the same feedback. A check in flight, at any of the
old three steps, becomes the child checking again. A `could_not_run` or
`run_failed` park holds the child, so a retry checks again. The real saved
runs `558-1`, `558-2` and `558-3` parse, and resume issues nothing new, as
before.

**Part 2: the published-API check.** In run 2 of #558, the builder dropped
`NoInfer` from `expectCmdEmitted`'s `cmd` to make a bad generated test
compile, and published a new `ReplayCtxArg` type. The check, done by code
(`src/declarations.ts`, `localPublishedApi`):

1. Emit the package's declarations with its own compiler: `tsc --declaration
   --emitDeclarationOnly --removeComments`. This runs once at HEAD in a fresh
   copy (cached per HEAD), and once in the builder's folder.
2. For each export-map entry, read what it publishes by name, with the
   declaration text. The reader follows `export *`, re-exports, aliases and
   imports. It folds in the unexported declarations of the same file that a
   published name refers to, so a change to a private helper type shows up on
   the name that uses it. TypeScript 7 has no compiler API, so a small
   statement reader does this. It works because emitted files are regular.
3. Compare: added, removed and changed names, each with before and after.

The policy is pure, in the reducer (`ruleOnApi`). A changed or removed name is
allowed if the issue names it. "Named" means: names in the criteria's rule
text, the names its examples call and use, and the names the ticket itself
gave. The ticket's names are the facts with `calledIn === null`. Names that
only a doc page's code calls are left out, so a page that uses a helper does
not unlock it. An allowed change is listed for the person who approves. Any
other change or removal goes back to the builder: "you changed X's published
signature; the ticket doesn't name it; put it back, or answer contradiction".
Added names go back too, unless `[lane] new_exports = "listed"`. Names
declared in a file a criterion names are not allowed by that alone, since a
rule about `runtime-types.ts` would then unlock all of it. A comparison that
cannot run (no package, emit failed) is recorded as skipped, never guessed.

**On #558, offline** (`experiments/api-probe.ts`): run 2's `builder.diff`
applied to a scratch clone of demlik at d2730b1, against run 3's issue (the
latest enrichment):

| Run-2 change | Result |
|---|---|
| `expectCmdEmitted` drops `NoInfer` on `cmd` (`./testing`) | **Flagged**: changed, not named |
| `ReplayCtxArg` added (`.`) | **Flagged**: added, not named |
| `ReplayOpts` turned from an interface into a type with an optional `ctx` (`./testing`) | **Flagged**: changed, not named |
| `replay` takes `ReplayCtxArg<Ctx> & …` (`.`) | Allowed and listed: `replay` is named |
| `ctx` made optional for a machine typed `ctx: undefined` | **Missed**, see below |

The `undefined` widening is in the branch `[undefined] extends [Ctx] ? { ctx?:
Ctx }` of `ReplayCtxArg`. It was caught here only by luck: the builder
exported the helper type. Had it kept the type private, the text would have
been folded into `replay`'s, which is named, so it would have been allowed and
listed. A name-level check cannot tell the asked change to a signature from
an extra one in the same signature. A negative type test would catch it, a
criterion like "`replay(m, { msgs })` is still a type error for a machine
typed `ctx: undefined`" (a `@ts-expect-error` line). That needs a check for
`type` criteria, which are unchecked today.

Against run 2's own issue, the owner's ruling put the testing helpers in
scope, so the criteria name `expectCmdEmitted`. There the `NoInfer` removal is
allowed and listed, not flagged, for the same reason. Only `ReplayCtxArg` and
`ReplayOpts` go back. The check stops changes to names nobody asked about. It
does not judge changes to names someone did ask about. Those reach the person
who approves, as a list.

Time on demlik's tea package (199 declaration files, 26 export-map entries):
11.2 s for the first check, with HEAD emitted in a fresh copy (worktree,
`pnpm install`, emit). After that, 3.1 s per check with HEAD cached. The
emit alone takes 3.2 s.

Open: per-parameter diffs, so an extra change inside a named signature is
seen. The builder's brief does not mention the rule yet; it learns it from
the first send-back. Saved facts from before section 42 have no `calledIn`,
and `ticketNames` reads a missing one as the report's (done in section 45).

## 45. Two more checks: type snippets and existing tests

Not an experiment, a redesign, with offline probes and one real run. Run 4 of
#558 wrote 7 criteria, all unchecked: a ticket about types has no call whose
value shows it. So vetting passed it with nothing to run, and the lane parked
`unchecked` before writing a test. And section 44's published-API check let
through a widening hidden inside a named signature. Two new criterion kinds
make both checkable:

```ts
{ kind: "type", id, rule, files, uses: Import[],
  snippets: [{ expect: "compiles" | "rejects", today: "holds" | "fails", code }, ...] }
{ kind: "existing_test", id, rule, test, files }
```

**A `type` criterion** is one or more TypeScript snippets. `compiles`: the code
must typecheck. `rejects`: the line under each `// @ts-expect-error` must be a
type error and the rest must compile, the idiom of demlik's `*.test-d.ts`.
`today` says how the snippet stands before the change: `fails` for one that
shows the change, `holds` for a guard, a limit the change must keep. After the
change every snippet must hold. Guards are how a limit ("do not widen
`ctx: undefined`") becomes a check: a call that is rejected today must still be
rejected after.

**An `existing_test` criterion** names a test file in the repo that must pass
after the change, such as a doc page's twin (section 42). It is not locked: a
twin mirrors its page, so a change to the page changes the twin too.

**Vetting** runs each on HEAD in the fresh copy it already makes for examples:

| Check | Fine | Sent back |
|---|---|---|
| Snippet marked `fails` | fails today, the right way round: a `compiles` one has a type error; a `rejects` one has a marked line that compiles (TS2578, unused directive) | holds already: it shows nothing |
| Snippet marked `holds` | holds today | fails today: either it shows the change (mark it `fails`) or it is wrong |
| Any snippet | | broken: a type error no change fixes (a syntax error, a name never imported or never used, a missing module or export), an error outside a marked line, a marked line rejected for such a reason, or bad imports; a `compiles` snippet with a mark, a `rejects` one without |
| Existing test | at HEAD, and runs: passing or failing today, both recorded | not at HEAD, or the workspace cannot run it (a vitest flavour runs tests in its own package only) |

And something must fail today: an example, a snippet marked `fails`, or an
existing test. A draft of guards and passing tests only shows nothing.

How a `rejects` snippet is read: the snippets are written to their file twice,
as they are and as a "bare" copy whose marks are plain comments, line for
line, and both go into one `tsc` run. In the copy as written, a marked line
that compiles shows as TS2578; in the bare copy, the error the mark hid shows,
so vetting can tell a call rejected because `ctx` is missing from one rejected
because `db` was never imported. Codes are read off the message: the list of
"no change fixes this" codes is short and on purpose.

**The generated file.** Prepare writes the snippets to
`src/fabrika-<n>.test-d.ts` beside the examples' `src/fabrika-<n>.test.ts`,
commits both, and locks both: the builder may not change them. Each snippet is
a block of its own under a line naming it (`// "id: snippet 1" compiles`), so
what one declares never meets another; what they use is imported once on top,
relative to the file. The examples' file is now written only when there are
examples: vitest fails a test file with no test in it. Each snippet is a check
named `<id>: snippet <n>`, each existing test `<id>: <test>`, beside the
examples' tests, so the lane's `prepared` needed no change: a check that did
not run parks `tests_broken`; nothing failing parks `nothing_to_build`; a guard
that holds is passing, like an example that holds already.

**After a build** the check runs the repo's command, then the issue's own
checks by themselves: `tsc` on the snippets' file alone with the package's
test tsconfig (the same path vetting uses), and each existing test alone. Same
on the fresh copy. On demlik, `pnpm typecheck` happens to cover the file
already (tea's `tsconfig.json` excludes `*.test.ts`, not `*.test-d.ts`), but a
repo whose typecheck skips it would let a broken snippet through, so the
flavour checks it itself. The Workspace's `check` and `freshCheck` now take the
issue, which the build loop's Cmd already holds. Ship's retest after a merge
still runs only the repo's command.

**Briefs.** The enricher learns the two kinds in four lines, under "Prefer a
checkable one: a rule is unchecked only when no snippet or test can show it",
and is asked to write the ticket's limits, from its no-gos and rabbit holes
too, as type guards when they are about types. Its schema gains `check`,
`snippets` and `test`. A doc page with a twin now becomes an `existing_test`.
The builder is shown each snippet as the check has it, guards marked "it holds
today: keep it so", told the snippets file is typechecked with the tests and
locked, and told one sentence about section 44's rule: a change to a published
name the issue does not name, or a new export, is sent back.

**Old saved runs.** Criteria need no migration: the union only grew. Facts
packs saved before section 42 get `calledIn: null` on every name and
`pages: []` in `parseFactory`, wherever triage keeps them (its facts, and an
enrichment run's brief), so `ticketNames` no longer tolerates a missing
`calledIn`. Runs `558-1` to `558-4` parse, their issues and facts pass the
schemas, and their ticket names are unchanged.

### Offline, on #558, before any agent

A hand-written type criterion for #558 (`experiments/vet-probe.ts`, now with
`ISSUE=`), on demlik at d2730b1. One snippet that shows the change, two guards,
and the how-to's twin:

1. `compiles`, `fails`: a `NoCtx` machine, `replay(pure, { msgs: [{ type: "bump" }] })`
2. `rejects`, `holds`: a machine whose `init` reads `ctx.db`, `replay(db, { msgs: [] })`
3. `rejects`, `holds`: a machine typed `ctx: undefined`, `replay(undef, { msgs: [] })`

Vetting took 7.0 s and passed it: 1 fails with TS2345, 2 and 3 are rejected
with "`ctx` is missing", the twin passes. Then the lane's side
(`experiments/type-guard-probe.ts`: prepare in a throwaway copy, a diff
applied, the check), with two snippets more to explain snippet 1:

| Snippet | HEAD | `CtxArg<Ctx>` on `replay` | run 2's builder diff |
|---|---|---|---|
| 1 `replay(pure, { msgs: [{ type: "bump" }] })` | fails | **fails** | **fails** |
| 2 guard: `db` machine needs `ctx` | holds | holds | holds |
| 3 guard: `ctx: undefined` machine needs `ctx` | holds | holds | **fails** (TS2578) |
| 4 `replay(pure, { msgs: [{ type: "bump" }], ctx: {} })` | fails | fails | fails |
| 5 `replay(pure, { msgs })`, `msgs` typed `{ type: "bump" }[]` | fails | holds | holds |
| the twin test | passes | passes | passes |

Two findings:

- **The guard catches what section 44 could not.** Run 2's `ReplayCtxArg`
  widened `ctx: undefined` machines; kept private, the API check would have
  allowed it inside `replay`'s named signature. Snippet 3 sends it back.
- **A snippet can fail today for a reason the change does not fix, and
  vetting cannot tell.** Snippet 1 fails because a literal `{ type: "bump" }`
  in `msgs` widens to `{ type: string }` and `M` is inferred from it, with or
  without `ctx` (snippet 4, which holds `ctx`, fails on HEAD too). Vetting
  marked it "fails, as it should". The builder could never make it hold. Same
  gap as an example that fails for the wrong reason, but a type error says
  less than an assertion. A sibling guard catches it: snippet 4 is snippet 1
  with `ctx` given, marked `holds`; it fails on HEAD, so vetting sends it back
  with the widened `M` in its message. Nothing asks the enricher for such a
  sibling yet.

The check costs 2 s per run on demlik (one `tsc` of one file, one vitest of one
test).

### Run 5 of #558, triage only

`runs/558-5`, demlik at 26d22c9 (origin/main; `packages/tea` as at d2730b1),
`vet_tries = 2` so at most two enricher turns, one Jev sort. 2 min 38 s in all.

| | Run 4 | Run 5 |
|---|---|---|
| Criteria | 7 | 9 |
| Checked | 0 | 8: 5 type (one snippet each), 3 existing tests |
| Unchecked | 7 | 1 (`other`: `replay` hands `init` `{}` when `ctx` is left out) |
| Guards (`holds` today) | none | 3 |
| Lane | parks `unchecked`, 7 rules | parks `unchecked`, 1 rule |

What vetting said, per draft:

| Snippet | Meant | Draft 1 | Draft 2 |
|---|---|---|---|
| a `{}`-satisfied machine replays with only `msgs` | fails today | fails (TS2345) | fails: `{ msgs }` lacks `ctx` |
| `expectFinalState` takes options with no `ctx` | fails today | fails (TS2345) | fails: `ReplayOpts` needs `ctx` |
| guard: a `db` machine still needs `ctx` in `replay` | holds | **broken**: an error outside the marked line | holds: rejected, `ctx` missing |
| guard: the testing helpers still need it | holds | holds | holds |
| guard: `ctx: undefined` still accepted for a pure machine | holds | **fails today** | holds: compiles |
| the how-to's twin, the tutorial's twin, `tutorials-typecheck.test.ts` | pass or fail | pass | pass |

Draft 1's two problems were the literal-`msgs` trap from the probe above:
`[{ type: "bump" }]` widened `M`, so the call failed for a reason the change
does not fix. Here it hit guards, so vetting saw it and said so; the enricher
typed `msgs` as `Msg[]` everywhere in draft 2, the two failing snippets too.
Draft 2 passed and Jev sorted it a feature, p2, worth doing.

No guard for the `ctx: undefined` widening appeared. The enricher wrote the
opposite limit: explicit `ctx: undefined` must stay accepted. A machine typed
`ctx: undefined` that may now omit `ctx` is not asked about, so run 2's
`ReplayCtxArg` would still pass this draft's snippets. The brief asks for
limits the ticket sets, and this one sets none; the report has no pitch with
no-gos yet.

The one unchecked rule is runtime behaviour behind a call that does not
typecheck today: an example of it cannot run before the change. A `compiles`
snippet with a runtime assertion would not help either: types only.

Cost: two enricher turns in one conversation (Opus 5.5 through `claude -p`, 10
assistant messages: 14.8k output tokens, 213k cache reads, 40.8k cache
writes), one Jev sort call, and two vettings, which cost only time. The
enricher's dollar figure is in `claude -p`'s result, and the run does not keep it.

Open: a sibling guard for every snippet that shows the change (the same call
with the change's part put back must hold today), asked of the enricher or
written by code; a way for the builder to contradict a snippet, as it can an
example (`contradiction` names a call today); a `ctx: undefined` guard needs
the ticket, or a person, to say it is a limit; runtime rules behind a type
change; ship's retest after a merge does not run the type snippets and
existing tests on their own.

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
node experiments/missing-probe.ts            # SCOPE=package, CONTROL=1
node experiments/dup-probe.ts                # PAIRS=30, CONTROLS=10, BUSY=0, TITLES=1, DRY=1
node experiments/name-filter.ts              # no Jev, no key: git and gh only
node experiments/api-probe.ts                # REPO=, STATE=, NEW=listed: no Jev, no key: git, pnpm, tsc
node experiments/facts-probe.ts              # REPO=, TICKET=: no Jev, no key: git and code-graph only
node experiments/vet-probe.ts                # REPO=, STATE= or ISSUE=: no Jev, no key: git, pnpm, tsc, vitest
node experiments/type-guard-probe.ts         # REPO=, ISSUE=, DIFF=: no Jev, no key: git, pnpm, tsc, vitest
node experiments/sdk-stream-spike.ts         # MODE=observe|feedback|hook|stop|startup: no Jev; Claude via the Agent SDK
```
