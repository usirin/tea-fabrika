# A judge that cannot add

> Draft, still being written.

`parseDuration("1.5h")` returns 5400. An hour and a half is 90 minutes, and 90
minutes is 5,400 seconds. We showed Jev that example and asked whether the rule
"a part can be a decimal number" had really been applied to get it. Jev said
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

Before moving on, I asked about the other way round. Could Jev stand in for the
test? Write the test as a sentence, show Jev the code, run nothing. Experiment
4's data already held most of the answer, because the duration criteria carry
an example each, which makes them prose tests in all but name. Experiment 5
pulled those numbers out, and they said no. On broken code, with criteria that
carried a worked example, Jev gave 18 answers: 8 sure and right, 0 sure and
wrong, 10 unsure. On the abstract slugify criteria it was 3, 3 and 3, so three
times it confidently passed broken code. A real test run catches every one of
those. Small sample, clear direction.

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
fine", you have quietly turned your safest signal into your biggest hole.
