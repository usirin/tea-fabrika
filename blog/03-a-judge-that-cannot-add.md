# A judge that cannot add

An hour and a half is 5,400 seconds. So `parseDuration("1.5h")` should return
5400. We showed Jev that call and asked one thing: was the rule "a part can be
a decimal number" applied to get this result? Jev said yes, at 0.90.

Then we showed it the same call returning 4500. Jev said yes again, at 0.89.

A right answer and a wrong one, one hundredth apart. It took thirteen
experiments to get to that pair, and most of them were about other things. Can
a small model tell whether a test checks what a ticket asks? Can it be fooled?
What moves its answer? [The last post](./02-meeting-jev.md) ended with Jev as a
good reader whose doubt usually points at a bad question. This one is the long
middle, where I learned what kind of reader it is: careful, easy to push
around, and blind to anything you have to work out.

The commits for experiments 6 to 18 landed between 13:56 and 15:34 on October
4. About an hour and a half. It felt like a week.

## The judge gets a smaller job

Post 2 ended with a rule: every criterion needs a test. With a passing test in
front of it, the judge had been right 117 of 117 times. Without one, on broken
code, it was close to a coin flip. So the plan changed. An agent writes one
test per criterion before any code exists, and the tests decide whether the
code is right. Jev only has to look at one test and one criterion and say
whether the test checks it.

Before settling on that, I wanted to know if we could skip running tests at all
and let Jev read a test written as a sentence. Experiment 5 said no. On broken
code, with a worked example in each criterion, Jev was sure and right 8 times
out of 18, and unsure the other 10. With abstract criteria, it confidently
passed broken code 3 times out of 9. A real test run catches every one of
those.

Here is the new question, from `experiments/fit.ts`:

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

To score a judge you need tests whose answer you already know. Experiment 6
built 54 by hand. Each criterion got two honest tests and four bad ones: one
named after the criterion but checking something else, one with the wrong
expected value, one related but passing either way, and one that asserts
nothing. Nobody's opinion decided which was which. A test counted as good only
if it passed on the correct code and failed on the version broken for its
criterion. If a label disagreed with the run, the script stopped.

324 answers came back. At 0.9 and up, Jev was right 200 of 200 times. It made
4 confident mistakes, all at 0.80 to 0.81, and all four accepted a bad test. It
never confidently turned down a good test. But at a 0.8 floor, 41% of the good
tests came back unsure.

That last number drove the next hour. Think of a bouncer who has never let in
anyone underage, and who also turns away four adults in ten because he isn't
sure about their faces. The bar is safe. It's also half empty.

The same run broke a rule I would have written without thinking. 4 of the 18
good tests already passed on the starting code, because the starting
`parseDuration` returns `null` for everything and some criteria expect `null`.
So "a new test must fail first" can't be a hard rule. That one comes back later
and costs us two real requirements.

## The writer was fine

Experiment 7 gave Claude the test-writer's job: the starting code and the
criteria, write the tests. Graded the same strict way, 27 of 27 criteria got a
good test. The judge, at a 0.9 floor, let 17 through. It called the other 10
unsure, and all 10 were good. The weak part wasn't the writer. It was the
judge's caution.

(Post 4 is about a mistake in how these agents were started: they could see
more than we thought. We reran the affected experiments after the fix, and the
writer held up, 48 of 48 good tests before and after. The judge's numbers here
don't move, because they score Jev against tests with known answers, whoever
wrote them.)

## My guess was wrong

I thought the caution came from abstract criteria, like "Punctuation and
accented letters are removed from the slug." The judge had nothing concrete to
hold a test against. Give each criterion a worked example and the doubt should
go away.

It didn't. With the old wording, 3 of 9 slugify tests got past the judge. With
an example added, still 3 of 9.

Reading the tests showed why. The writer ignored the example and picked its own
inputs. And that criterion says two things at once, punctuation and accents, so
the writer split it into two tests. We asked Jev about that one criterion in
several shapes, in `fit-probe.ts`:

| What Jev was shown | Confidence |
|---|---|
| Two claims, two tests together | 0.44 to 0.54 |
| Two claims, one test covering both | 0.76 to 0.83 |
| One claim, its test | 0.82 to 0.87 |
| One claim with an example, test asserts that example | 0.90 to 0.92 |

Each row fixes one more link, and confidence climbs from 0.44 to 0.92. The
example helped only when the test used it. The claim helped only when it was a
single claim. What mattered was the whole chain: one claim per criterion, one
test per criterion, and the test asserts the criterion's own example.

So experiment 9 gave the writer three rules. Exactly one test per criterion.
When the criterion has an example, assert exactly that. Add a second assertion
only when the first would pass on code that does nothing. All 48 criteria got a
good test, and none of them passed on the starting code. The judge liked these
better:

| Criteria | Floor 0.9 | Floor 0.85 |
|---|---|---|
| slugify, as first written | 3 of 9 | 4 of 9 |
| slugify, example added | 3 of 9 | 9 of 9 |
| slugify, one claim each with an example | 6 of 12 | 12 of 12 |
| duration | 10 of 18 | 14 of 18 |

Confidence went up everywhere, then bunched at 0.86 to 0.89, just under 0.9. A
0.85 floor looked right. On the 54 hand-built tests it would have accepted 0
bad tests out of 216 answers, same as 0.9.

That's a trap, though. We picked 0.85 after seeing the numbers. It's drawing the
target around the arrow after it lands. A floor picked on one set of answers
has to hold on answers it has never seen.

## Trying to fool it

So we needed fresh bad tests, and we asked another model to write them.

Experiment 10 told Claude to write tests that look honest and aren't, aimed at
a reviewer who skims. An input that almost hits the rule. An expected value
that's nearly right. An assertion that's a little too loose. Each had to fail
on the starting code, so running it first wouldn't give it away.

90 tests came back, and we ran every one, because what the fooler meant to do
isn't a label. 56 were really bad: 34 failed on the correct code, and 22 passed
on code that breaks the criterion. The other 34 were good by accident. The
fooler set out to write a sneaky test and wrote an honest one. That's funny,
and it's also a real lesson. If we had trusted Claude's word on which tests were
bad, over a third of the bad set would have been good tests.

Each bad test went to the judge three times:

| Floor | Bad accepted | Bad refused | Bad unsure |
|---|---|---|---|
| 0.80 | 0 of 168 | 60 | 108 |
| 0.85 | 0 of 168 | 43 | 125 |
| 0.90 | 0 of 168 | 28 | 140 |

The judge did lean toward "checks" on some bad tests, but never with
confidence. The highest was 0.79, for this one:

```js
test("c1: capitals in the middle of a word are lowered too", () => {
  assert.equal(slugify("McDonald's Menu"), "mcdonald-s-menu");
});
```

It's a good fake. The name is about lower case, the input has a capital in the
middle of a word, and the expected value is lower case. But slugify drops any
character outside a-z and 0-9, so the apostrophe just disappears and the
correct answer is `"mcdonalds-menu"`. The fake turned the apostrophe into a
dash. A person skimming would pass it. Jev leaned that way too, and stayed under
the floor.

That left 0.85 a margin of 0.06 over the worst miss. 0.80 held as well, by
0.01, and it had already let four bad tests through in experiment 6. (Post 2
covered how little a clean record like this proves on its own: 56 bad tests
only rule out a miss rate above about 5%.)

The column I'd look at is the last one. 108 to 140 of 168. Unsure is the
judge's usual answer to a bad test. That settles what unsure does in the lane:
it sends the test back, never through. Count unsure as "probably fine" and
your safest signal turns into your biggest hole.

## What moves it

Until now every criterion had been written by hand. Experiment 12 ran the front
of the lane for real, starting from a raw ticket whose title only said the slugs looked wrong. The
enricher, the triage agent that rewrites a ticket, wrote the criteria, one
claim each with a worked example. The test-writer wrote the tests. The judge
read them. Three runs per toy, 43 criteria.

The agents did their part: all 43 tests were sound. The judge at 0.85 let only
31 through, and only 5 of 16 on slugify. The same slugify criterion and test
that scored 0.94 to 0.98 with hand-written input scored 0.55 to 0.80 here.
Something else in what the judge saw had changed.

It was the title. A hand-written title says what the code is for. The enricher
writes titles the way people do, about the bug. `title-probe.ts` held the
criterion and test still and swapped only the title, four answers each:

| Title shown with the criterion and test | Confidence |
|---|---|
| States the goal: "slugify turns a title into a URL slug" | 0.93 to 0.97 |
| States the bug: "slugify returns the title unchanged instead of a URL-safe slug" | 0.58 to 0.84 |
| No title | 0.65 to 0.79 |

A bug-shaped title did no better than no title. The judge reads everything you
give it, and a sentence about what's broken has nothing to do with the one rule
it was asked to check.

The same run had a second problem, and that one was ours. Every duration run
left out "units out of order return null" and "an unknown unit returns null".
We had told the enricher never to write a criterion whose test would pass
before any code exists, and the starting code returns `null` for everything. A
rule meant to keep empty tests out pushed real requirements out. Experiment 6's
finding, back to bite.

The fix for the title looked easy: have the enricher write a one-line goal and
show the judge that instead. Experiment 13 tried it, and the judge got worse,
15 of 63 let through. The enricher's goal line was long and listed the rules
("a lower-case, dash-separated slug made only of a-z, 0-9 and dashes"). The
judge held each test to all of it, and a test of one rule looked too small.

So we froze everything and moved one thing at a time:

| Shown beside the criterion and test | Confidence |
|---|---|
| Short line, under the key `issue` | 0.92 to 0.94 |
| Long line, under the key `issue` | 0.67 to 0.84 |
| Long line, under the key `goal` | 0.30 to 0.36 |
| Long line, under the key `about`, and the question says it is background only | 0.85 to 0.90 |

Rows two and three show the same words. The only difference is the name of the
JSON key above them. `issue` gives 0.67 to 0.84. `goal` gives 0.30 to 0.36. A
key called `goal` reads like the bar the test has to clear, so the judge held
the test to it.

Picture a note on a new hire's desk. Write "goal:" at the top and they'll
measure their work against every word of it. Write "for context:" and the same
note is just helpful. People read labels as instructions, because that's
usually what labels are. So does Jev.

The question now ends: "`about` only says what the code is for. Judge the test
against `criterion` alone." We ran the saved bad tests from experiment 10
through the new wording to make sure it hadn't opened a hole. Still 0 of 168
accepted, worst 0.79.

A side agent caught one more thing. While fixing the experiment, the main agent
had also switched the real demo's judge to show the new line under `goal`, the
label that had just scored about a third. The side agent flagged it, and commit
`a33363d`, "go back to showing the title, as measured", undid it. Measure the
label before you ship the label.

With the new wording, the judge let through 39 of 63. The other 24 were all
sound tests, and it answered "checks" to all but one of them, just under the
floor. The lowest scores went to the `null` rule tests, which carry a second
assertion so they fail first. The judge trusts a two-assertion test less.

By the end of experiment 13 the judge had a clear shape. Safe: at 0.85 it had
not accepted a bad test in any run. Touchy: the wording of the question, the
name of a key and the length of a background line each moved it by 0.1 to 0.6.
On criteria and tests written by agents, it passed about six good tests in ten.

## It's really one number

Experiment 14 tried to get more out of the answer we already had. Jev gives
every option a share. Maybe a shy "checks" on a good test kept its doubt in
`cannot_tell`, a bad one kept it in `does_not_check`, and code could tell them
apart for free. No. `cannot_tell` got about 0 on good and bad tests alike, so
in practice the answer is one number. With three options, our 0.85 floor is
just a top share of 0.90.

The rerun did add 618 answers to the record, and at 0.85 it accepted 0 of 273
bad tests. The closest call was 0.83, for a test that expected
`parseDuration("2H15M")` to give 8010. Two hours is 7,200 seconds and fifteen
minutes is 900, so the right answer is 8100. Two digits swapped, and a margin of
0.02. I didn't know yet why it was that thin.

## Reading the manual, fourteen experiments in

Earlier that afternoon, when the judge was unsure, the agent had suggested
asking it a second time. That sounded arbitrary to me, so I pushed back and
asked what someone who really knows this field would do instead. Post 2's
calibration came out of that push.

But we answered that question by measuring. Nobody went and read what the
people who built the model say to do. We did that after experiment 14, at
https://docs.typesafe.ai/concepts/how-to-build-with-system-one.

By that guide, we were using Jev the hard way. It says to "ask many narrow,
independent questions about the same state in one request". Questions in one
call are answered side by side, so splitting costs no extra round trip. We had
been asking one broad question per call. It says to "give each question only
the context it needs", and experiments 12 and 13 were that rule learned the
slow way, a title and a key name at a time. It says to "combine independent
answers with deterministic rules", in code. It has a yes/no question type,
`noul`, that we had never used. And the idea it calls the most important,
which I quoted at the end of post 2, is to ask the most explicit, narrow,
specific, atomic questions you can. "Would this test passing show the criterion
is met?" is about as broad as a question about a test gets.

My take at the time was simple. If we're going to use a model, use it for what
it was built for, the way it was built to be used.

To be fair to us, we did two things the guide doesn't. We measured how often
each confidence level was right on cases with known answers, and we tried hard
to fool it. That work is why I trust the numbers in the next two sections. But
one page of docs said, up front, most of what fourteen experiments taught us.

## Three small questions

Experiment 17 did what the guide says. Under the lane's rules, a good test
asserts its criterion's own example. So "does this test check the criterion?"
is really three small facts. Does the test call the function with the example's
input (`same_input`)? Does it expect the example's result (`same_result`)? Does
it compare against one exact value (`exact_check`)? Each became a yes/no
question, shown only the criterion and the test. Here's the last one, from
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
so code takes the lowest of the three and compares it to the floor. We ran it
on 233 saved tests, each with a known answer from running it:

| Rule | Writer's good tests accepted | Bad tests accepted |
|---|---|---|
| Broad question, confidence 0.85 | 53 of 88 | 0 of 93 |
| Three narrow questions, all at 0.9 | 87 of 88 | 4 of 93 |
| Three narrow questions, all at 0.5 | 88 of 88 | 12 of 93 |

The caution was gone. The writer's good tests scored about 0.98 on each narrow
question, and 87 of 88 got through, against 53 of 88 with the broad one. Same
model, same tests, different questions.

It wasn't free. The broad question had accepted 0 of 93 bad tests, and the
narrow ones let 4 in. Two of those weren't the judge's fault. The enricher had
guessed that a title which is already a slug comes back unchanged, but the
reference code drops the dash. The tests asserted the criterion's example
faithfully. The criterion was what disagreed with the code, and no question
about a test can see that. The other two were real misses: a test expecting
`parseDuration("90")` to equal the string `"90"`. That criterion only said "is
returned as that many seconds", with no exact result written down, so there was
nothing exact to compare against.

Then the guide's other point: keep in code what code can do. If the criterion
has a written example, you don't need a model to say whether the test uses that
input and that result. You can just look. Plain string matching (does the
test's source contain the example's values?) agreed with Jev on 152 of 156
tests. "Contains the values, and `exact_check` is at least 0.5" accepted 88 of
88 good tests and 2 of 93 bad ones, the two slug cases above.

So two of the three questions weren't judgment at all. They were string
matching dressed up as a model. What was left for a judge was the one part code
couldn't do: does this example really show this claim?

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

No cut works. At 0.5 you let in 47 bad examples. At 0.9 you turn away 28 of 35
good ones. Jev answers half of this question well and can't answer the other
half at all.

Does the input touch the rule? Jev is good at that. An example whose input has
nothing for the rule to act on was accepted 0 of 121 times, at every cut. It's
a reading question. The answer is on the page.

Is the result right? Look at the "slightly off" row: `has_feature` 0.96,
`rule_applied` 0.64. Then back to the top of this post. For "a part can be a
decimal number", `parseDuration("1.5h") -> 5400` got 0.90 on `rule_applied`,
and `-> 4500` got 0.89. Telling them apart means doing 1.5 times 3,600, and Jev
doesn't do that. Its own notes say so: "keep the arithmetic in code". The 0.83
on `"2H15M" -> 8010` makes sense now too.

It isn't only sums. One of the fooler's examples was
`slugify("naïve approach") -> "naive-approach"`, for the claim "accented letters
are removed". Slugify drops any character outside a-z and 0-9, so the real
answer is `"nave-approach"`. It looks odd and it's right. Jev gave the
friendly-looking wrong one 0.88 on `rule_applied`. Knowing which is right means
running the rule on the input, letter by letter. That's working something out,
not reading.

The picture I keep is a proofreader checking an invoice. She'll tell you,
quickly and reliably, that every line is a real item from the order and nothing
on it belongs to another customer. She won't add up the column. Hand her an
invoice with the total off by 900 and she'll pass it, because the total looks
like a total. That's not a bad proofreader. Adding up is a different job.

We wrote the takeaway into the log, and it's the one I'd put on a sticky note.
Jev can check that an example is about the claim. It can't check that the
example is correct, and nothing that only reads can. The example is the spec.
A wrong one has to be caught by something that disagrees with it: a second
example worked out separately, or code that can't satisfy both.

Right after that experiment, the question in my head was how to flip the
design around, so the lane leans on what Jev is good at instead of what it
can't do. The full answer is post 5, where running code takes over the
deciding. But the shape was clear that afternoon. Code works out the facts. Jev
reads them.

## What I'd take from this

If you use a model as a judge anywhere in an agent workflow, here's what these
thirteen experiments taught me.

**Break the judgment into the facts it's made of.** "Is this test good?" was
three facts. Ask each as its own yes/no, in one call, and let code combine
them. We went from 53 of 88 good tests accepted to 87 of 88, with the same model
and the same data.

**Before you ask the model, ask whether code can answer.** Two of our three
narrow questions were string matching. Code agreed with Jev on 152 of 156 and
costs nothing. Give the model only the part code can't do.

**Every key and label you send is part of the prompt.** One line of text scored
0.67 to 0.84 under `issue`, 0.30 to 0.36 under `goal`, and 0.85 to 0.90 under
`about`. Change one thing at a time and measure, like any other input to a
function.

**Have a second model try to fool your judge, and let running code say what's
really bad.** Of 90 tests written to be bad, 34 were good.

**Never test a floor on the data you picked it from.** We chose 0.85 by looking.
It only counted once it held on 168 answers it had never seen.

**Send unsure back, never through.** At 0.85, 125 of the judge's 168 answers on
bad tests were unsure. Count unsure as a pass and most of them get in.

**Keep anything that needs working out away from a reader.** Sums, running a
rule on an input, correctness. A small model will score the right answer and the
wrong one almost the same, and look calm doing it.

**Read the manual first.** I know. I'm saying it anyway.

## Where I ended up

I started that afternoon thinking of Jev as a small, cheap judge. I finished it
thinking of Jev as a reader: fast, careful and cheap, good at telling you whether
an example is about a claim or whether a test uses the input it should. Ask it
those things one at a time, with only what each one needs, and it's very good.
Ask it whether something is right, when right means working it out, and it
gives you a number that looks like an answer.

What I still don't know is how to tell those two kinds of question apart before
I measure. 5400 and 4500 were easy to spot once we had the table. The next one
might not come with a table.

Next: [The agents had a shell](./04-the-agents-had-a-shell.md), the mistake
that ran under six of these experiments, and the exam that handed back the
answer key.
