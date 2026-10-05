# A judge that cannot add

`parseDuration("1.5h")` returns 5400. An hour and a half is 90 minutes, and 90
minutes is 5,400 seconds. We showed Jev that example and asked whether the rule
"a part can be a decimal number" had been applied to get it. Jev put the chance
of yes at 0.90.

Then we showed it the same call with 4500 as the result. 0.89.

That pair is where this post ends up, thirteen experiments later. Most of them
were about something else: can a small model tell whether a test checks what a
ticket asks, can it be fooled, and what moves its answer. If you read [the last
post](./02-meeting-jev.md), you know Jev is a good reader and that its doubt
usually points at a bad question. This is the long middle, where I found out
what kind of reader it is. Careful, easy to push around, and blind to anything
you have to work out.

The commits for experiments 6 to 18 landed between 13:56 and 15:34 on October
4, about an hour and a half. It felt a lot longer.

## A new job for the judge

Post 2 left us with a rule: every criterion needs a test. With a passing test in
front of it, the judge had been right 117 of 117 times. Without one, on broken
code, it was about a coin flip. So the plan changed. An agent would write a
test for each criterion before any code existed, and the tests would decide
whether the code was right. Jev would get a smaller job: look at one test and
one criterion and say whether the test checks it.

I asked about the other way round first. Could Jev stand in for the test, with
the test written as a sentence and nothing run? Experiment 5 said no. On broken
code, with a worked example in each criterion, Jev was sure and right 8 times
out of 18 and unsure the other 10. With abstract criteria, it confidently
passed broken code 3 times out of 9. A real test run catches all of those.

So, the new question, as it sits in `experiments/fit.ts`:

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
built 54 by hand. Each criterion got two honest tests and four bad ones: one
named after the criterion that checks something else, one with the wrong
expected value, one related but passing either way, and one that asserts
nothing. "Good" was not my opinion. A test counted as good only if it passed on
the correct code and failed on the version broken for its criterion. If a label
disagreed with the run, the script stopped.

324 answers came back. At 0.9 and up, Jev was right 200 of 200 times. It made
4 confident mistakes, all at 0.80 to 0.81, and all four accepted a bad test.
It never confidently refused a good test. But at a 0.8 floor, 41% of the good
tests came back unsure.

That last number shaped the next hour. Picture a bouncer who has never let in
anyone underage, and also turns away four adults in ten because he isn't sure
about their faces. The bar is safe. It is also half empty.

One more finding from that run broke a rule I would have written without
thinking. 4 of the 18 good tests already passed on the starting code, because
the starting `parseDuration` returns `null` for everything and some criteria
expect `null`. So "a new test must fail first" cannot be a hard rule. It comes
back later and costs us two real requirements.

## The writer was fine

Experiment 7 put Claude in the test-writer's seat, with the starting code and
the criteria. Graded the same hard way, 27 of 27 criteria got a good test. The
judge, at a 0.9 floor, let 17 through. The other 10 it called unsure, and all
10 were good. The weak part was not the writer. It was the judge's caution.

(Post 4 is about a mistake in how these agents were started: they could see
more than we thought. The log reran the affected experiments after the fix,
and the writer held up, 48 of 48 good tests before and after. The judge's
numbers in this post don't move, because they score Jev against tests with
known answers, whoever wrote them.)

## A guess that was wrong

My guess for the caution was simple. The criteria were abstract ("Punctuation
and accented letters are removed from the slug."), so the judge had nothing
concrete to hold a test against. Add a worked example to each criterion and the doubt should go
away.

It didn't. With the old wording, 3 of 9 slugify tests got past the judge. With
an example added, 3 of 9.

Reading the tests told us why. The writer ignored the example and picked its
own inputs. And that criterion says two things at once, punctuation and
accented letters, so the writer split it into two tests. So we asked Jev
about that one criterion several ways, in `fit-probe.ts`:

| What Jev was shown | Confidence |
|---|---|
| Two claims, two tests together | 0.44 to 0.54 |
| Two claims, one test covering both | 0.76 to 0.83 |
| One claim, its test | 0.82 to 0.87 |
| One claim with an example, test asserts that example | 0.90 to 0.92 |

Each row fixes one more link, and the answer climbs from 0.44 to 0.92. The
example only helped when the test used it. The claim only helped when it was
one claim. It was the whole chain that mattered: one claim per criterion, one
test per criterion, and the test asserts the criterion's own example.

So experiment 9 handed the writer three rules. Exactly one test per criterion.
When the criterion gives an example, assert exactly that. Add a second
assertion only when the first would pass on code that does nothing. All 48
criteria got a good test, and none passed on the starting code. The judge liked
these better:

| Criteria | Floor 0.9 | Floor 0.85 |
|---|---|---|
| slugify, as first written | 3 of 9 | 4 of 9 |
| slugify, example added | 3 of 9 | 9 of 9 |
| slugify, one claim each with an example | 6 of 12 | 12 of 12 |
| duration | 10 of 18 | 14 of 18 |

Confidence went up across the board, then bunched at 0.86 to 0.89, just under
0.9. A 0.85 floor looked right, and on the 54 hand-built tests it would have
accepted 0 bad tests out of 216 answers, same as 0.9.

Here is the trap. We picked 0.85 after looking at the numbers. That is drawing
the target around the arrow after it lands. A floor chosen on one set of
answers has to be checked on answers it has never seen.

## Trying to fool it

So we needed bad tests the floor had never seen, and we asked another model to
make them.

Experiment 10 asked Claude to write tests that look honest and are not, aimed
at a reviewer who skims. An input that almost exercises the rule. An expected
value that is nearly right. An assertion that is slightly too loose. Each one
had to fail on the starting code, so running it first would not give it away.

90 tests came back. Then we ran them, because the adversary's intent is not a
label. 56 were really bad: 34 failed on the correct code, and 22 passed on code
that breaks the criterion. The other 34 were good by accident. The adversary
tried to write a sneaky test and wrote an honest one. I find that funny, and
it is a real lesson. If we had trusted "Claude says this one is bad", over a
third of our bad set would have been good tests.

Each bad test was shown to the judge three times:

| Floor | Bad accepted | Bad refused | Bad unsure |
|---|---|---|---|
| 0.80 | 0 of 168 | 60 | 108 |
| 0.85 | 0 of 168 | 43 | 125 |
| 0.90 | 0 of 168 | 28 | 140 |

The judge did say "checks" to some bad tests, never with confidence. The
highest was 0.79, for this one:

```js
test("c1: capitals in the middle of a word are lowered too", () => {
  assert.equal(slugify("McDonald's Menu"), "mcdonald-s-menu");
});
```

It is a good fake. The name is about lower case, the input has capitals in the
middle of a word, and the expected value is lower case. But slugify drops any
character outside a-z and 0-9, so the apostrophe disappears and the correct
answer is `"mcdonalds-menu"`. The fake turned the apostrophe into a dash. A
person skimming would pass it. Jev leaned toward passing it too, and stayed
under the floor.

That gave 0.85 a margin of 0.06 over the worst miss. 0.80 held as well, but by
0.01, and it had already let four bad tests through in experiment 6. (Post 2
covered how little a clean record like this proves on its own: 56 bad tests
only rule out a miss rate above about 5%.)

Look at the unsure column instead. 108 to 140 of 168. Unsure is the judge's
usual answer to a bad test. That decides where unsure goes in the lane: it
sends the test back, and never waves it through. Treat unsure as "probably
fine" and your safest signal becomes your biggest hole.

## What moves it

Every run so far had used criteria written by hand. Experiment 12 ran the front
of the lane for real, from a raw ticket ("slugs look wrong"). The enricher, the
agent in triage that rewrites a ticket, wrote the criteria, one claim each with
a worked example. The test-writer wrote the tests, and the judge read them.
Three runs per toy, 43 criteria.

The agents did their part: all 43 tests were sound. But the judge at 0.85 let
only 31 through, and on slugify only 5 of 16. The same slugify criterion and
test that scored 0.94 to 0.98 with hand-written input scored 0.55 to 0.80 here.
Something else in the state had changed.

It was the title. A hand-written title said what the code is for. The enricher
writes titles the way people do, about the bug. `title-probe.ts` held the
criterion and the test still and swapped only the title, four answers each:

| Title shown with the criterion and test | Confidence |
|---|---|
| States the goal: "slugify turns a title into a URL slug" | 0.93 to 0.97 |
| States the bug: "slugify returns the title unchanged instead of a URL-safe slug" | 0.58 to 0.84 |
| No title | 0.65 to 0.79 |

A bug-shaped title did no better than no title at all. The judge reads
everything you hand it, and a sentence about what is broken is not about the
one rule it was asked to check.

The same run had a second problem, and it was ours. Every duration run left out
"units out of order return null" and "an unknown unit returns null". We had
told the enricher never to write a criterion whose test would pass before any
code is written, and the starting code returns `null` for everything. A rule
meant to keep empty tests out pushed real requirements out. That is experiment
6's finding coming back to bite.

The fix for the title looked obvious: have the enricher write a one-line goal,
and show the judge that instead. Experiment 13 tried it, and the judge got
worse, 15 of 63 let through. The enricher's goal line was long and listed the
rules ("a lower-case, dash-separated slug made only of a-z, 0-9 and dashes").
The judge held each test to all of it, and a test of one rule looked too small.

So we held everything still and moved one thing at a time:

| Shown beside the criterion and test | Confidence |
|---|---|
| Short line, under the key `issue` | 0.92 to 0.94 |
| Long line, under the key `issue` | 0.67 to 0.84 |
| Long line, under the key `goal` | 0.30 to 0.36 |
| Long line, under the key `about`, and the question says it is background only | 0.85 to 0.90 |

Look at rows two and three. Same words. The only change is the name of the JSON
key they sit under. `issue` gives 0.67 to 0.84. `goal` gives 0.30 to 0.36. A
key called `goal` reads like the bar the test has to clear, so the judge held
the test to it.

The picture I have is a note left on a new hire's desk. Write "goal:" at the
top and they will measure their work against every word on it. Write "for
context:" and the same note is just helpful. They read your labels as
instructions, because that is what labels usually are.

The question now ends: "`about` only says what the code is for. Judge the test
against `criterion` alone." We put the saved bad tests from experiment 10
through the reworded question to make sure it had not opened a hole. Still 0 of
168 accepted, worst 0.79.

A side agent caught one more thing. While fixing the experiment, the main agent
had also switched the real demo's judge to show the new line under `goal`, the
label that had just measured at about a third. The side agent's note said so,
and the change was reverted in `a33363d`, "go back to showing the title, as
measured". Measure the label before you ship the label.

With the reworded question, the judge let through 39 of 63. The other 24 were
all sound tests, and it answered "checks" to all but one of them, just under
the floor. The
lowest scores went to the `null` rule tests, which carry a second assertion so
they fail first. The judge reads a two-assertion test with less confidence.

So by the end of experiment 13 the judge had a clear shape. It was safe: it had
not accepted a bad test at 0.85 in any run. And it was touchy: the wording of
the question, the name of a key and the length of a background line each moved
it by 0.1 to 0.6. On criteria and tests written by agents, it passed about six
good tests in ten.

## One number, really

Experiment 14 was a last try at squeezing more out of the answer we already
had. Jev gives every option a share. Maybe a shy "checks" on a good test kept
its doubt in `cannot_tell`, and a bad one kept it in `does_not_check`, and code
could tell them apart for free. No. `cannot_tell` got about 0 on good and bad
tests alike, so the answer is one number in practice. With three options, our
0.85 floor is just a top share of 0.90.

The rerun did add 618 answers to the record, and at 0.85 it accepted 0 of 273
bad tests. The closest call was 0.83, for a test that expected
`parseDuration("2H15M")` to give 8010. Two hours is 7,200 seconds, fifteen minutes is 900, so the right
answer is 8100. Two digits swapped, and a margin of 0.02 over the floor. I
didn't yet know why it was that thin.

## Reading the manual, fourteen experiments in

Early that afternoon, the agent had suggested that when the judge is unsure we
ask it a second time. My answer was:

> ask twice sounds weird and arbitrary. what else an expert of this field would do?

That was the right instinct, and the calibration in post 2 came out of it. But
I asked what an expert would do, and we answered by measuring. Nobody went and
read what the people who built the model say to do. We did that after
experiment 14, at https://docs.typesafe.ai/concepts/how-to-build-with-system-one.

By their measure we were using Jev the hard way. The guide says to "ask many
narrow, independent questions about the same state in one request". Questions
in one call are answered side by side, so splitting costs no extra round trip.
We asked one broad question per call. It says to "give each question only the
context it needs", and experiments 12 and 13 were that rule learned the slow
way, one title and one key name at a time. It says to "combine independent
answers with deterministic rules", in code. It has a yes/no type (`noul`) we
had never used. And the idea it calls the most important, which I quoted at the
end of post 2, is to ask the most explicit, narrow, specific, atomic questions
you can. "Would this test passing show the criterion is met?" is about as
broad as a question about a test gets.

My reaction at the time:

> yes, yeah. we gotta make sure we're using the model for the purpose and the way it was built to be used imo

To be fair to us, we did two things the guide doesn't. We measured how often
each confidence level was right, on cases with known answers, and we tried hard
to fool it. That work is why I trust the numbers in the next two sections. But
one page of docs said, up front, most of what fourteen experiments taught us.

## Three small questions

Experiment 17 did what the guide says. Under the lane's rule, a good test
asserts its criterion's own example. So "does this test check the criterion?"
is three small facts. Does the test call the function with the example's input
(`same_input`)? Does it expect the example's result (`same_result`)? Does it
compare against one exact value (`exact_check`)? Each became a yes/no question,
shown only the criterion and the test. Here is the last one, from
`experiments/atomic-questions.ts`:

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

All three go in one call. A test is accepted only when all three reach a cut,
so code takes the lowest of the three and compares it with the floor. We ran it
on 233 saved tests, each with a known answer from running it:

| Rule | Writer's good tests accepted | Bad tests accepted |
|---|---|---|
| Broad question, confidence 0.85 | 53 of 88 | 0 of 93 |
| Three narrow questions, all at 0.9 | 87 of 88 | 4 of 93 |
| Three narrow questions, all at 0.5 | 88 of 88 | 12 of 93 |

The caution was gone. The writer's good tests scored about 0.98 on each narrow
question, and 87 of 88 got through, against 53 of 88 for the broad one. Same
model, same tests. Only the questions changed.

It was not free. The broad question had accepted 0 of 93 bad tests, and the
narrow ones accepted 4. Two of those were not the judge's fault. The enricher
had guessed that a title which is already a slug comes back unchanged, but the
reference code drops the dash. The tests asserted the criterion's example
faithfully. It was the criterion that disagreed with the code, and no question
about a test can see that. The other two were real misses, a test expecting
`parseDuration("90")` to equal the string `"90"`. That criterion only said "is
returned as that many seconds", with no exact result written down, so there
was nothing exact to compare with.

Then the guide's other point: keep in code what code can do. If the criterion
carries a written example, you don't need a model to tell you whether the test
uses that input and that result. You can look. Plain string matching (does the
test's source contain the example's literals?) agreed with Jev on 152 of 156
tests. "Contains the literals, and `exact_check` is at least 0.5" accepted 88
of 88 good tests and 2 of 93 bad ones, the two slug cases above.

So two of the three questions weren't judgment at all. They were string
matching wearing a model's clothes. What was left for a judge was the one part
code could not do: does this example really show this claim?

## The thing it cannot do

Experiment 18 measured that last question before we built on it, because the
whole lane would rest on it. If a criterion's example is exact data, code can
write the test from it. But if the example is wrong, the test is wrong, the
builder codes to it, and everything goes green.

Truth came from running code again. For a claim and an input, an example is
good when its result is what the correct code returns, and the code that breaks
that claim returns something else. That gave 201 examples from a pool of
inputs, with no hand-labelling, and Claude wrote 50 more meant to fool the
judge. Jev got two narrow yes/no questions. `has_feature`: does the input
contain the thing the claim is about? `rule_applied`: has the claim's rule been
applied to the input to give this result? Plus one broad question, for
comparison. Average answers:

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
away 28 of 35 good ones. Half of this question Jev answers well, and half it
cannot answer at all.

Does the input touch the rule? Jev is good at that. An example whose input has
nothing for the rule to act on was accepted 0 of 121 times, at every cut. That
is a reading question. The answer is on the page.

Is the result right? Look at the "slightly off" row: `has_feature` 0.96,
`rule_applied` 0.64. And back to the opening. For "a part can be a decimal
number", `parseDuration("1.5h") -> 5400` got 0.90 on `rule_applied`, and
`-> 4500` got 0.89. The right answer and the wrong one, one hundredth apart.
Telling them apart means doing 1.5 times 3,600, and Jev does not do that. Its
own notes say so: "keep the arithmetic in code". The 0.83 on `"2H15M" -> 8010`
reads differently now too.

It is not only sums. One of the fooler's examples was
`slugify("naïve approach") -> "naive-approach"`, for the claim "accented letters
are removed". Slugify drops any character outside a-z and 0-9, so the real
answer is `"nave-approach"`, which looks odd and is right. Jev gave the
friendly-looking wrong one 0.88 on `rule_applied`. Knowing which is right means
running the rule on the input, letter by letter. That is working something out,
not reading.

The picture I keep is a proofreader checking an invoice. She will tell you,
quickly and reliably, that every line is a real item from the order and nothing
on it belongs to another customer. She will not add up the column. Hand her an
invoice with the total off by 900 and she will pass it, because the total looks
like a total. That is not a bad proofreader. Adding up is a different job.

We wrote the takeaway in the log, and it is the one I would put on a sticky
note. Jev can check that an example is about the claim. It cannot check that
the example is correct, and nothing that only reads can. An example is the
specification. A wrong one has to be caught by something that disagrees with
it: a second example worked out separately, or code that cannot satisfy both.

Two minutes after that experiment was committed, I asked:

> how can we redesign this around jev's strong parts instead of the weak ones?

The answer is post 5, where running code takes over the deciding. But the shape
was already clear that afternoon. Code works out the facts. Jev reads them.

## What I'd steal from this

If you use a model as a judge anywhere in an agent workflow, here is what I'd
take from these thirteen experiments.

**Split the judgment into the facts it is made of.** "Is this test good?" was
three facts. Ask each as its own yes/no, in one call, and let code combine
them. Ours went from 53 of 88 good tests accepted to 87 of 88, with the same
model and the same data.

**Before you ask the model, ask whether code can answer.** Two of our three
narrow questions were string matching. Code agreed with Jev on 152 of 156 and
costs nothing. Give the model only the part code cannot do.

**Treat every key and label in the state as part of the prompt.** One line of
text scored 0.67 to 0.84 under `issue`, 0.30 to 0.36 under `goal`, and 0.85 to
0.90 under `about`. Change one thing at a time and measure, like any other
input to a function.

**Have a second model try to fool your judge, and let running code say what is
really bad.** Of 90 tests written to be bad, 34 were good.

**Never test a floor on the data you picked it from.** We chose 0.85 by looking.
It only counted once it held on 168 answers it had never seen.

**Send unsure back, never through.** At 0.85, 125 of the judge's 168 answers
about bad tests were unsure. Count unsure as a pass and most of them get
through.

**Keep anything that needs working out away from a reader.** Sums, running a
rule on an input, correctness. A small model will score the right answer and
the wrong one almost the same, and look calm doing it.

**Read the manual first.** I know. I'm saying it anyway.

## What I took from it

I came into that afternoon thinking of Jev as a small, cheap judge. I left
thinking of it as a reader: fast, careful and cheap, good at telling you
whether an example is about a claim or whether a test uses the input it should.
Ask it those things one at a time, with only what each needs, and it is very
good. Ask it whether something is right, when right means working it out, and
it will give you a number that looks like an answer.

The question I still have is how to tell those two kinds of question apart
before I measure. 5400 and 4500 were easy to spot once we had the table. The
next one might not come with a table.

Next: [The agents had a shell](./04-the-agents-had-a-shell.md), the mistake
that ran under six of these experiments, and the exam that handed back the
answer key.
