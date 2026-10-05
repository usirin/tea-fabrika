# A judge that cannot add

> Draft, still being written.

`parseDuration("1.5h")` returns 5400. An hour and a half is 90 minutes, and 90
minutes is 5,400 seconds. We showed Jev that example and asked whether the rule
"a part can be a decimal number" had been applied to get it. Jev said
yes, at 0.90.

Then we showed it the same call with 4500 as the result. Jev said yes, at 0.89.

That pair is where this post ends up. It took thirteen experiments to get
there, and most of them were about something else: can a small model tell
whether a test really checks what a ticket asks, can it be fooled, and what
moves its answer. If you read [the last post](./02-meeting-jev.md), you know
Jev is a good reader and that its doubt usually points at a bad question. This
one is the long middle, where I found out what kind of reader it is. Careful,
easy to push around, and blind to anything you have to work out.

The commits for experiments 6 to 18 landed between 13:56 and 15:34 on October
4. About an hour and a half. It felt a lot longer than that.

## A new job for the judge

Post 2 left us with a rule: every criterion needs a test. With a passing test in
front of it, the judge had been right 117 of 117 times. Without one, on broken
code, it was about a coin flip. So the plan changed. An agent would write a
test for each criterion before any code existed. The tests would decide whether
the code was right. Jev would get a smaller job: look at one test and one
criterion and say whether the test really checks it.

I asked about the other way round first. Could Jev stand in for the test, with
the test written as a sentence and nothing run? Experiment 5 said no. On broken
code, with a worked example in each criterion, Jev was sure and right 8 times
out of 18 and unsure the other 10. With abstract criteria, it confidently
passed broken code 3 times out of 9. A real test run catches all of those.

So, the new question. Here it is as it sits in `experiments/fit.ts`:

```ts
fit: {
  type: "choice",
  instructions:
    "Would this test passing show that the acceptance criterion is met? `test` is one test, as code or as a plain description of what it asserts. Go by what the test asserts, not by its name.",
  criteria: {
    checks: "The test can only pass if the code does what the criterion asks",
    does_not_check:
      "The test could pass while the criterion is unmet, or it expects a result the criterion does not ask for",
    cannot_tell: "The test and the criterion are not enough to decide",
  },
},
```

To measure it, you need tests where you already know the answer. Experiment 6
built 54 by hand. Each criterion got two honest tests and four bad ones of
different kinds: a test named after the criterion that checks something else,
one with the wrong expected value, one that is related but passes either way,
and one that asserts nothing. "Good" was not my opinion. A test counted as good
only if it passed on the correct code and failed on the version broken for its
criterion. If a label I wrote disagreed with the run, the script stopped.

324 answers came back.

- At 0.9 and up, Jev was right 200 of 200 times.
- It made 4 confident mistakes, all at 0.80 to 0.81, and all four were the same
  kind: it accepted a bad test.
- It never confidently refused a good test. But at a 0.8 floor, 41% of the good
  tests came back unsure.

That last line is the one that shaped the next hour. A judge that says "unsure"
to four good tests in ten is safe and slow. Picture a bouncer who has never let
in anyone underage, and also turns away four adults out of ten because he isn't
sure about their faces. The bar is safe. It is also half empty.

There was one more small finding in that run that I liked, because it broke a
rule I would have written without thinking. 4 of the 18 good tests already
passed on the starting code. The starting `parseDuration` returns `null` for
everything, and some criteria expect `null`. So "a new test must fail first"
cannot be a hard rule. Keep that in mind. It comes back later and costs us two
real requirements.

## The writer was fine

Experiment 7 put a real agent in the test-writer's seat. Claude got the
starting code and the criteria, and wrote one test per criterion. Graded the
same hard way, 27 of 27 criteria got a good test. The judge, at a 0.9 floor,
let 17 through. The other 10 it called unsure, and all 10 were good.

So the weak part was not the writer. It was the judge's caution.

One honest note before going on. Post 4 is about a mistake in how these agents
were started: they could see more than we thought. The log reran the affected
experiments after the fix, and the writer held up, 48 of 48 good tests before
and after. None of the judge's numbers in this post move, because they score
Jev against tests with known answers, and who wrote a test does not change
whether it is good.

## A guess that was wrong

My guess for the caution was simple. The criteria were abstract ("characters
outside a-z and 0-9 are dropped"), so the judge had nothing concrete to hold a
test against. Add a worked example to each criterion and the doubt should go
away.

It didn't. With the old wording, 3 of 9 slugify tests got past the judge. With
an example added, 3 of 9. Exactly the same.

Reading the tests told us why. The writer ignored the example and picked its
own inputs. And one criterion said two things at once, about punctuation
and about accented letters, so the writer split it into two tests. So we
asked Jev about that one criterion several ways, in `fit-probe.ts`:

| What Jev was shown | Confidence |
|---|---|
| Two claims, two tests together | 0.44 to 0.54 |
| Two claims, one test covering both | 0.76 to 0.83 |
| One claim, its test | 0.82 to 0.87 |
| One claim with an example, test asserts that example | 0.90 to 0.92 |

Read it from the top down. Every row fixes one more link, and the answer climbs
from 0.44 to 0.92. The example only helped when the test actually used it. The
claim only helped when it was one claim. It was the whole chain that mattered:
one claim per criterion, one test per criterion, and the test asserts the
criterion's own example.

So experiment 9 handed the writer three rules. Exactly one test per criterion.
When the criterion gives an example, assert exactly that. Add a second
assertion only when the first one would pass on code that does nothing. All 48
criteria got a good test, and none passed on the starting code. For the
"returns null" ones, the writer added a check that a valid input parses, so the
test fails first.

The judge liked these better:

| Criteria | Floor 0.9 | Floor 0.85 |
|---|---|---|
| slugify, as first written | 3 of 9 | 4 of 9 |
| slugify, example added | 3 of 9 | 9 of 9 |
| slugify, one claim each with an example | 6 of 12 | 12 of 12 |
| duration | 10 of 18 | 14 of 18 |

Confidence went up across the board, and then bunched at 0.86 to 0.89, just
under 0.9. A 0.85 floor looked right. On the 54 hand-built tests from
experiment 6, it would have accepted 0 bad tests out of 216 answers, same as
0.9.

And this is the trap I want to point at, because I would have walked into it
alone. We picked 0.85 after looking at the numbers. That is drawing the target
around the arrow after it lands. A floor chosen on one set of answers has to be
checked on answers it has never seen, or you have only measured how well you
can fit a line to what you already have.

## Trying to fool it

So we needed bad tests the floor had never seen, and the best way we had to
get them was to ask another model to make them.

Experiment 10 asked Claude to write tests that look honest and are not, aimed
at a reviewer who skims. An input that almost exercises the rule. An expected
value that is nearly right. An assertion that is slightly too loose. Each one
had to fail on the starting code, so that running it first would not give it
away.

90 tests came back. Then we ran them, because the adversary's intent is not a
label. 56 were really bad: 34 failed on the correct code, and 22 passed on code
that breaks the criterion. The other 34 were good by accident. The adversary
tried to write a sneaky test and wrote an honest one instead. I find that
funny, and it is also a real lesson. If we had trusted "Claude says this one is
bad", over a third of our bad set would have been good tests.

Each bad test was shown to the judge three times:

| Floor | Bad accepted | Bad refused | Bad unsure |
|---|---|---|---|
| 0.80 | 0 of 168 | 60 | 108 |
| 0.85 | 0 of 168 | 43 | 125 |
| 0.90 | 0 of 168 | 28 | 140 |

The judge did say "checks" to some bad tests. It never said it with
confidence. The highest was 0.79, for this one:

```js
test("c1: capitals in the middle of a word are lowered too", () => {
  assert.equal(slugify("McDonald's Menu"), "mcdonald-s-menu");
});
```

It is a good fake. The name is about lower case, the input has capitals in the
middle of a word, and the expected value is lower case. But the slugify rules
drop any character outside a-z and 0-9, so the apostrophe disappears and the
correct answer is `"mcdonalds-menu"`. The fake swapped the apostrophe for a
dash. A person skimming would pass it. Jev leaned toward passing it too, at
0.79, and stayed under the floor.

That gave 0.85 a margin of 0.06 over the worst miss. 0.80 held as well, but by
0.01, and 0.80 had already let four bad tests through in experiment 6. The last
post covered how much a clean record like this proves (56 bad tests only rule
out a miss rate above about 5%), so I will not repeat it.

Look at the "unsure" column instead. 108 to 140 of 168. Unsure is the judge's
usual answer to a bad test. That decides where unsure goes in the lane: it
sends the test back. It never waves it through. If you treat unsure as "probably
fine", your safest signal becomes your biggest hole.

## What moves it

Every run so far had used criteria I wrote by hand. Experiment 12 ran the front
of the lane for real. It started from a raw ticket ("slugs look wrong"). The
enricher, the agent in triage that rewrites a ticket, wrote the criteria, now
told to write one claim each with a worked example. The test-writer wrote the
tests, and the judge read them. Three runs per toy, 43 criteria.

The agents did their part. All 43 tests were sound. But the judge at 0.85 let
only 31 of the 43 through, and on slugify only 5 of 16. The same slugify
criterion and test that scored 0.94 to 0.98 with my input scored 0.55 to 0.80
here. Nothing about the criterion or the test was different. Something else in
the state was.

It was the title. A hand-written ticket's title says what the code is for. The
enricher writes titles the way people do, about the bug. `title-probe.ts` held
the criterion and the test still and swapped only the title, four answers each:

| Title shown with the criterion and test | Confidence |
|---|---|
| States the goal: "slugify turns a title into a URL slug" | 0.93 to 0.97 |
| States the bug: "slugify returns the title unchanged instead of a URL-safe slug" | 0.58 to 0.84 |
| No title | 0.65 to 0.79 |

A bug-shaped title did no better than no title at all. That one surprised me. The
judge reads everything you hand it, and a sentence about what is broken pulls
its attention toward what is broken, away from the one rule it was asked about.

(The same run had a second problem, and it was ours. Every duration run left out
two real rules: "units out of order return null" and "an unknown unit returns
null". We had told the enricher never to write a criterion whose test would
pass before any code is written. The starting code returns `null` for
everything, so the enricher dropped every `null` rule. A rule meant to keep
empty tests out pushed real requirements out. That is the "must fail first"
rule from experiment 6 coming back to bite.)

The fix for the title looked obvious. Have the enricher write a one-line goal,
and show the judge that instead. Experiment 13 tried it, and the judge got
worse: 15 of 63 let through. The enricher's goal line was long, and it listed
the rules ("a lower-case, dash-separated slug made only of a-z, 0-9 and
dashes"). The judge held each test to all of that, and a test of one rule
looked too small.

So we held everything still again and moved one thing at a time:

| Shown beside the criterion and test | Confidence |
|---|---|
| Short line, under the key `issue` | 0.92 to 0.94 |
| Long line, under the key `issue` | 0.67 to 0.84 |
| Long line, under the key `goal` | 0.30 to 0.36 |
| Long line, under the key `about`, and the question says it is background only | 0.85 to 0.90 |

Look at rows two and three. Same words. The only change is the name of the JSON
key they sit under. `issue` gives 0.67 to 0.84. `goal` gives 0.30 to 0.36. A
key called `goal` reads like the bar the test has to clear, so the judge held
the test to it. Under `about`, with one sentence in the question saying it is
only background, the same line is harmless again.

The picture I have for this is a note left on a new hire's desk. Write "goal:"
at the top and they will measure their work against every word on it. Write
"for context:" and the same note is just helpful. They are not being silly.
They read your labels as instructions, because that is what labels usually are.

The question now ends: "`about` only says what the code is for. Judge the test
against `criterion` alone." We put the saved bad tests from experiment 10
through the reworded question to make sure it had not opened a hole. Still 0 of
168 accepted at all three floors, worst 0.79.

A side agent caught one more thing here, and I'm glad it did. While fixing the
experiment, the main agent had also switched the real demo's judge to show the
new line under `goal`, the label that had just measured at about a third. The
note said so plainly, and the change was reverted in `a33363d`, "go back to
showing the title, as measured". Measure the label before you ship the label.

With the reworded question, the judge let through 39 of 63. Every one of the
other 24 was a sound test it answered "checks" to, just under the floor, except
one "does not check" at 0.26. The lowest scores went to the `null` rule tests,
the ones carrying a second assertion so they fail first. The judge reads a
two-assertion test with less confidence.

So by the end of experiment 13 the judge had a clear shape. It was safe: it had
not accepted a bad test at 0.85 in any run. And it was touchy: the wording of
the question, the name of a key, and the length of a background line each moved
it by 0.1 to 0.6. On criteria and tests written by agents, it passed about six
good tests in ten. The other four needed somewhere to go that was not a person.

## One number, really

Experiment 14 was a last try at getting more out of the answer we already had.
Jev gives every option a share. Maybe a shy "checks" on a good test kept its
doubt in `cannot_tell`, and a bad one kept it in `does_not_check`, and code
could tell them apart for free. No. `cannot_tell` got about 0 on good and bad
tests alike, so the answer is one number in practice. With three options, our
0.85 floor is just a top share of 0.90.

The rerun did add 618 answers to the record. Bad tests accepted at 0.85: 0 of
273. The closest call was 0.83, for a test that expected `parseDuration("2H15M")`
to give 8010. Two hours is 7,200 seconds, fifteen minutes is 900, and the right
answer is 8100. Two digits swapped. The margin over the floor was 0.02, and I
did not yet know why it was that thin.

## Reading the manual, fourteen experiments in

Early that afternoon, before any of this, the agent had suggested that when the
judge is unsure we just ask it a second time. My answer was:

> ask twice sounds weird and arbitrary. what else an expert of this field would do?

That was the right instinct, and post 2 is what came out of it: calibration,
counting how often each confidence level is right. But I asked what an expert
would do, and we answered by measuring. Nobody went and read what the people
who built the model say to do. We did that after experiment 14, at
https://docs.typesafe.ai/concepts/how-to-build-with-system-one.

By their measure we were using Jev the hard way. The guide says to "ask many
narrow, independent questions about the same state in one request", because
questions in one call are answered side by side, so splitting costs no extra
round trip. We asked one broad question per call. It says to "give each question
only the context it needs". Experiments 12 and 13 were that rule, learned the
slow way, one title and one key name at a time. It says to "combine independent
answers with deterministic rules", in code. It has a yes/no type (`noul`) we had
never used, and it lets an option's description say what it covers, what it
does not, and give examples. Ours were one sentence each.

And the line the guide calls its most important idea, the one I quoted at the
end of post 2: ask the most explicit, narrow, specific, atomic questions you
can. Our question was "would this test passing show the criterion is met?",
which is about as broad as a question about a test can get.

My reaction at the time:

> yes, yeah. we gotta make sure we're using the model for the purpose and the way it was built to be used imo

The fair thing to say is that we did two things the guide doesn't. We measured
how often each confidence level was right, on cases with known answers, and we
tried hard to fool it. That work wasn't wasted. It is why I trust the numbers
in the next two sections. But one page of docs said, up front, most of what
fourteen experiments taught us.

## Three small questions

Experiment 17 did what the guide says. Under the lane's rule, a good test
asserts its criterion's own example. So "does this test check the criterion?"
is three small facts. Does the test call the function with the example's
input (`same_input`)? Does it expect the example's result (`same_result`)?
Does it compare against one exact value (`exact_check`)? Each one became a
yes/no question, shown only the criterion and the test. Here is the last one,
from `experiments/atomic-questions.ts`:

```ts
exact_check: {
  type: "noul",
  instructions: "Does `test` compare what the function returns against one exact value?",
  criteria: {
    true: "An equality assertion against a literal value, such as assert.equal(f(x), \"y\")",
    false:
      "Only a loose check: that the result is truthy or falsy, has a type, matches a pattern, or no assertion on the result at all",
  },
},
```

All three go in one call. A test is accepted only when all three are at or
above a cut, so code takes the lowest of the three and compares it with the
floor. We ran it on 233 saved tests, each with a known answer from running it:

| Rule | Writer's good tests accepted | Bad tests accepted |
|---|---|---|
| Broad question, confidence 0.85 | 53 of 88 | 0 of 93 |
| Three narrow questions, all at 0.9 | 87 of 88 | 4 of 93 |
| Three narrow questions, all at 0.5 | 88 of 88 | 12 of 93 |

The caution was gone. The writer's good tests scored about 0.98 on each narrow
question, and 87 of 88 got through, against 53 of 88 for the broad one. Same
model, same tests. Only the questions changed.

It was not free, and I want to be straight about the price. The broad question
had accepted 0 of 93 bad tests. The narrow ones accepted 4. Two of those were
not the judge's fault. The enricher had guessed that a title which is
already a slug comes back unchanged, and the reference code drops the dash. The
tests asserted the criterion's example faithfully. It was the criterion that
disagreed with the code, and no question about a test can see that. The other
two were real misses: a test that expected `parseDuration("90")` to equal the
string `"90"`. That criterion only said "is returned as that many seconds",
with no exact result written down, so there was nothing exact to compare with.

Then the guide's other point: keep in code what code can do. If the criterion
carries a written example, you don't need a model to tell you whether the test
uses that input and that result. You can look. Plain string matching (does the
test's source contain the example's literals?) agreed with Jev on 152 of 156
tests. "Contains the example's literals, and `exact_check` is at least 0.5"
accepted 88 of 88 good tests and 2 of 93 bad ones, the two slug cases above.

So two of the three questions weren't judgment at all. They were string
matching wearing a model's clothes. What was left for a judge was the one part
code could not do: does this example really show this claim?

## The thing it cannot do

Experiment 18 measured that last question before we built on it, because the
whole lane would rest on it. If the example in a criterion is exact data, code
can write the test from it, and nobody has to judge the test. But if the example
is wrong, the test is wrong, the builder codes to it, and everything goes green.

Truth came from running code again. For a claim and an input, an example is
good when its result is what the correct code returns, and the code that breaks
that claim returns something else. That gave 201 examples from a pool of
inputs, with no hand-labelling. Claude wrote 50 more meant to fool the judge,
labelled the same way. Jev got two narrow yes/no questions. `has_feature`: does
the input contain the thing the claim is about? `rule_applied`: has the claim's
rule been applied to the input to give this result? We asked one broad question
too, for comparison. Average answers:

| Kind of example | Count | `has_feature` | `rule_applied` | broad |
|---|---|---|---|---|
| Good: right result, and the claim is why | 29 | 0.93 | 0.78 | 0.77 |
| Bad: the input never touches the rule | 121 | 0.29 | 0.25 | 0.17 |
| Bad: the result is what broken code gives | 29 | 0.91 | 0.30 | 0.24 |
| Bad: a result that is slightly off | 22 | 0.96 | 0.64 | 0.62 |
| Bad: written by the fooler | 44 | 0.75 | 0.57 | 0.51 |

And accepting an example when both narrow answers reach a cut:

| Cut | Good accepted | Bad accepted |
|---|---|---|
| 0.5 | 30 of 35 | 47 of 216 |
| 0.7 | 20 of 35 | 31 of 216 |
| 0.9 | 7 of 35 | 1 of 216 |

There is no cut that works. At 0.5 you let in 47 bad examples. At 0.9 you turn
away 28 of 35 good ones.

The two columns tell you why. Half of this question Jev answers well, and half
it cannot answer at all.

Does the input touch the rule? Jev is good at that. An example whose input has
nothing for the rule to act on was accepted 0 of 121 times, at every cut. That
is a reading question. The answer is on the page.

Is the result right? Look at the "slightly off" row: `has_feature` 0.96,
`rule_applied` 0.64. Back to the opening of this post. For the claim "a part can
be a decimal number", `parseDuration("1.5h") -> 5400` got 0.90 on
`rule_applied`, and `parseDuration("1.5h") -> 4500` got 0.89. The right answer
and the wrong one, one hundredth apart. Telling them apart means doing 1.5 times
3,600, and Jev does not do that. Its own notes say so: "keep the arithmetic in
code".

It is not only sums. One of the fooler's examples was
`slugify("naïve approach") -> "naive-approach"`, for the claim "accented letters
are removed". The slugify rules drop any character outside a-z and 0-9, so the
real answer is `"nave-approach"`, which looks odd and is right. Jev scored the
friendly-looking wrong one 0.88 on `rule_applied`. Knowing which is right means
running the rule on the input, letter by letter. That is working something out,
not reading.

The 0.83 on `"2H15M" -> 8010` from experiment 14 reads differently now. A test
with the wrong total came within 0.02 of the floor, and nothing Jev reads would
have stopped it.

The picture I keep is a proofreader checking an invoice. She will tell you,
quickly and reliably, that every line is a real item from the order, that the
dates are in the right place, that nothing on it is about some other customer.
She will not add up the column. Hand her an invoice with the total off by 900
and she will pass it, because the total looks like a total. That is not a bad
proofreader. Adding up is just a different job.

So we wrote the takeaway down in the log in one line, and it is the one I would
put on a sticky note: Jev can check that an example is about the claim. It
cannot check that the example is correct, and nothing that only reads can. An
example is the specification. A wrong one has to be caught by something that
disagrees with it: a second example worked out separately, or code that cannot
satisfy both.

Two minutes after that experiment was committed, I asked:

> how can we redesign this around jev's strong parts instead of the weak ones?

The answer to that is post 5, where running code takes over the deciding. But
the shape was already clear that afternoon. Code works out the facts. Jev reads
them.

## What I'd steal from this

If you use a model as a judge anywhere in an agent workflow, here is what I
would take from these thirteen experiments.

**Split the judgment into the facts it is made of.** "Is this test good?" was
three facts. Ask each as its own yes/no, in one call, and let code combine
them. Ours went from 53 of 88 good tests accepted to 87 of 88, with no new
model and no new data.

**Before you ask the model, ask whether code can answer.** Two of our three
narrow questions were string matching. Code agreed with Jev on 152 of 156 and
costs nothing. Give the model only the part code cannot do.

**Treat every key and label in the state as part of the prompt.** One line of
text scored 0.67 to 0.84 under `issue`, 0.30 to 0.36 under `goal`, and 0.85 to
0.90 under `about`. Change one thing at a time and measure it, the way you
would with any other input to a function.

**Get a second model to try to fool your judge, and let running code say what
is really bad.** Of 90 tests written to be bad, 34 were good. The adversary's
intent is not a label.

**Never test a floor on the data you picked it from.** We chose 0.85 by looking.
It only counted once it held on 168 answers it had never seen.

**Send unsure back, never through.** Our judge's usual answer to a bad test was
unsure, not wrong. At 0.85, 125 of its 168 answers about bad tests were unsure.
Count unsure as a pass and most of them get through.

**Keep anything that needs working out away from a reader.** Sums, running a
rule on an input, correctness. A small model will score the right answer and
the wrong one almost the same, and look calm doing it.

**Read the manual first.** I know. I'm saying it anyway.

## What I took from it

I came into that afternoon thinking of Jev as a small, cheap judge. I left
thinking of it as a reader. A fast, careful, cheap reader that can tell you
whether an example is about a claim, whether a test uses the input it should,
whether a change is about the ticket at all. Ask it those things one at a time,
with only what each needs, and it is very good. Ask it whether something is
right, when right means working it out, and it will give you a number that
looks like an answer.

The question I still have is how to tell those two kinds of question apart
before I measure. 5400 and 4500 were easy to spot once we had the table. The
next one might not come with a table.

Next: [The agents had a shell](./04-the-agents-had-a-shell.md), the mistake
that ran under six of these experiments, and the exam that handed back the
answer key.
