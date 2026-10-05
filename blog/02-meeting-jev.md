# Meeting Jev: when unsure means the question was bad

0.69, 0.79, 0.64, 0.77.

[The first post](./01-v4.md) ended on those four numbers. One question, asked
four times on day one, to a small classifier called Jev, and every answer under
the floor where our code would act. My first read was noise. A small, cheap
model wobbles a bit, so you ask again and take the best one. That read was
wrong, and working out why taught me most of what I know about using a small
model as a judge.

So here is Jev properly: what it is, how you ask it things, what it was good
and bad at in our runs, and the lesson that changed how I read its answers.
When a small model is unsure, check the question you asked before you check
the model.

## What Jev is

Jev is a small model from [TypeSafe](https://typesafe.ai). They call it System
One. It does not write. You send it some JSON, which they call the state, and a
list of questions about that state. For each question it picks an answer from a
list you wrote, and tells you how sure it is. There is no prose to parse and no
way for it to invent an answer you did not offer. It is billed by the token,
about $0.042 per million, and in our runs a call came back in a fraction of a
second.

The first question we ever asked it was the judge in the lane. A builder agent
has changed some code. Does that change meet one criterion of the ticket? Here
is the question as it sat in `src/judge.ts` on day one:

```ts
verdict: {
  type: "choice",
  instructions:
    "Does this change satisfy the acceptance criterion? `diff` is the change. `passingTests` names the tests that passed after it.",
  criteria: {
    met: "The diff does what the criterion asks, or a passing test shows that it does",
    not_met: "The diff does not do what the criterion asks, or does it wrongly",
    cannot_tell: "Neither the diff nor the passing tests are enough to decide",
  },
},
```

The state next to it is the ticket's title, the one criterion, the diff, and the
names of the tests that passed. The answer comes back as three things: the
option it picked (`met`), a share for every option, and one confidence number.

That confidence number confused me for a while, so here it is with real values.
Jev's docs give the formula: confidence is the top share, rescaled by how many
options there were, `(p_max - 1/n) / (1 - 1/n)`. With three options, a top share
of 0.90 gives `(0.90 - 0.33) / (1 - 0.33)`, which is 0.85. A top share of 0.33
would be a pure coin toss between three, and that comes out as 0. A top share of
1 comes out as 1. So confidence is just "how far from a blind guess", stretched
to fit between 0 and 1.

The everyday picture I use is a clerk in a post office sorting room. You build
the bins and label them. The clerk reads each envelope and drops it in one of
your bins, never on the floor and never in a bin you did not build. And for each
envelope she also tells you how sure she was. She cannot write you a letter. She
can only sort, quickly and very cheaply.

### Three shapes of question

Jev has three kinds of question, and our code ended up using two of them.

A `choice` picks one option from a list you define. The judge above is one. So
is the review's router in `src/route.ts`, which asks whether a change to a file
the ticket never named still serves the ticket's goal:

```ts
criteria: {
  serves: "The change is needed for the goal, or directly supports it",
  unrelated: "The change is about something else: the goal would be met without it",
},
```

A `noul` is a plain yes/no. It gives back one number, the chance of yes, and no
separate confidence, because with two answers that one number already says it
all. Our missing-file check asks one per file: "Does finishing the ticket mean
`file` has to change too?" Code then ranks the files by their yes.

A `score` places the state on a scale you describe, two to ten levels, like a
rubric. We never used it. I mention it so you know it is there.

You can put many questions in one call, and they are answered separately, side
by side. Triage's sort in `src/sort.ts` asks four in one go: what type of issue
this is, how urgent, whether an agent can pick it up as written, and whether it
is worth doing at all.

The cleanest short description I have found came later, from disler's
[ten-levels-of-jev](https://github.com/disler/ten-levels-of-jev): one yes/no
question is "a smart, cheap, fast if statement". The model reads. Your code owns the
threshold and decides what happens next.

## The floor

That threshold has a name in our code: the floor. If Jev's confidence is at or
above the floor, the lane acts on the answer. Below it, the answer is `unsure`,
which is its own outcome with its own path. Our first floor was 0.8.

Back in the sorting room, this is a tray on the clerk's desk marked "not sure".
Anything she is less than 80% sure about goes in the tray instead of a bin. The
interesting part is what you do with the tray, and that is where the four
numbers come back in.

## Unsure was not noise

Look at them again: 0.69, 0.79, 0.64, 0.77. They move around, but all four sit
under 0.8. The wobble was real. What mattered more was that the model kept
landing in the tray.

So instead of asking again, we went looking at what was in the tray. Every time
we looked, the input had something wrong with it. There were three kinds:

- a criterion that contradicted the code, or another criterion
- a criterion about what stayed the same
- a ticket too thin to say what done looks like

The second one stuck with me, because once you see it, the model is plainly
right. The judge only sees the diff, and a diff only holds the lines that
changed. Now hand it a criterion like "the existing tests still pass unchanged".
The lines that prove it are exactly the ones that are not in the diff. The only
honest answer is `cannot_tell`, or a weak lean in some direction. That is what
we got, and we were calling it noise.

The contradiction kind is the one from the first post, the same thing with a
different face. A criterion said characters outside a-z and 0-9 are dropped,
and a slug keeps its dashes. A dash is outside a-z and 0-9. Code that does one
breaks the other, so no answer about it can be a confident one.

TypeSafe's own page on confidence (https://docs.typesafe.ai/confidence) says
it in one line, and I wish I had read it first: "The model is telling you it
does not have enough information or the question is not a good fit."

Here is the picture I keep in my head now. You show a friend half a page and ask
"is this done?". They squint and say "probably?". Asking them again, louder,
does not help. Showing them the right half of the page does.

## Fix the question, do not ask again

Asking again is the natural reflex. It does not work. The four numbers above
are what asking again looks like: a new number from the same band, with the
same problem still sitting in the input. The
earlier phoenix research I come back to below measured the same thing at a
larger size. In [#9486](https://github.com/kamp-us/phoenix/issues/9486), eight
review cases, five of them earlier misses, were asked three more times each.
All 24 answers matched the first run, and the right count stayed at 3 of 8. Repeating a call buys you the same
answer again.

What worked was changing what we asked, and who wrote it. In this pipeline the
criteria are written by triage: an agent we call the enricher reads the raw
ticket and rewrites it with acceptance criteria. So the bad input was the
enricher's. That gave me the question that set up the next fix:

> can the enrichment also make sure that it writes in a way that jev can understand?

We told the enricher how its criteria get judged. Its prompt got a short brief,
`JUDGE_BRIEF` in `src/claude.ts` (commit `6ff5f92`; a later design replaced it).
It said a small classifier will read
each criterion on its own, next to the changed lines, and nothing else. Then the
rules: one claim per criterion; say what the change makes true, never what stays
the same; no two criteria may fight; keep each one short. The examples are from
a different domain on purpose, so they teach the shape and not the answer:

> Good: "Prices are shown with two decimals." / "An empty cart shows a total of 0."
>
> Bad: "The existing price tests still pass unchanged." (about what did not change) / "Rounds prices and never shows a trailing zero or a negative total." (three claims) / "Only digits appear in the total", beside a criterion that adds a currency sign (they contradict).

On the slugify toy, with every part real (Claude Code rewriting the ticket and
writing the code, real tests, real Jev), the lane went from 0 of 3 runs finishing to 5 of 5.
Nothing changed in the judge. Only what it was asked.

The next fix went the other way: change what the judge is shown. At first it saw
only the diff. Adding the names of the tests that had passed took the
`duration-open` toy from 0 of 5 runs finishing to 8 of 10.

That one made me nervous. If the judge now sees "all tests passed", maybe it
just says `met` to anything with green tests, a rubber stamp. So we checked that
directly (`judge-rubber-stamp.mjs`): a criterion that was not done and had no
test. It said `not_met` at 0.99.

So the rule we wrote down that day was short. When the judge is unsure, fix
what it was asked, and do not ask again. An unsure verdict goes back to triage,
because triage owns the wording.

## Is 0.8 the right floor?

Fixing the inputs made the tray smaller. It did not tell me whether the answers
that cleared the floor were right. A floor is only worth something if "0.8 and
up" really means "usually right", and the only way to know that is to count.

This is called calibration, and it was new to me. The everyday picture is a
weather forecaster. Take all the days she said "80% chance of rain" and check
how many of them it actually rained. If it is about 8 in 10, you can plan around
her numbers. If it rained on 3 of them, her 80% means nothing, however sure she
sounds.

For a judge, the forecast is its confidence and the weather is a known answer.
Our two toys gave us those. Each toy (`slugify` with three rules, `duration`
with six) has one correct implementation and several broken on purpose, each
breaking one criterion. Run the real tests and you know, for every criterion,
whether it is met. Then ask the judge and compare.

`experiments/judge-calibration.ts` did that for 87 cases, 261 answers:

| Confidence | Right |
|---|---|
| 0.8 and up | 218 of 221 |
| 0.7 to 0.8 | 11 of 12 |
| under 0.7 | about half |

Split by what the judge was shown, the picture got sharper:

| Shown | Right |
|---|---|
| A passing test for the criterion | 117 of 117 |
| No test, code is correct | 95% |
| No test, code is broken | about half |

The first table says the 0.8 floor holds for this question. The second says
where the danger is. In the broken-and-untested group there is one case the
judge answered `met`, at 0.93 to 0.95, three times in a row. Confident, steady,
and wrong. No floor catches that, and asking again gives you the same wrong
answer three times.

When there was a test, the judge never missed. When there was no test, it was
guessing about broken code, and it did not always know it was guessing. So the
agent proposed a rule, every criterion needs a test, and I had been about to
propose the same one:

> i was literally gonna suggest the same rule to test, so yeah.

Two warnings about these numbers, because I would want them if I were reading
this. The toys are tiny, and the samples are small. And a clean record means
less than it looks. Later Claude wrote 90 tests meant to fool the judge, and
running them showed 56 were really bad. The judge accepted 0 of 168 answers
about those at 0.80, 0.85 or 0.90. That sounds like proof. A research pass we
ran afterwards pointed out that 56 distinct bad tests only rule out a miss rate
above about 5%. To claim 1% you would need
about 300 per question. "Zero so far" is a weaker claim than "zero".

## The research that said the opposite

This is the part that bothered me most.

Two weeks before this project, on 2026-09-20, there was an earlier round of Jev
research on phoenix, the repo where fabrika runs. 26 small experiments, which we
call spikes, closed between
[#9461](https://github.com/kamp-us/phoenix/issues/9461) and
[#9502](https://github.com/kamp-us/phoenix/issues/9502). Real issues, real review
comments, real CI logs. Its headline finding was blunt: confidence does not
protect you.

The numbers behind it:

- [#9493](https://github.com/kamp-us/phoenix/issues/9493) sorted 36 real issues
  by type. A 0.90 cut still let 29 answers through, and 6 of those 29 disagreed
  with the label the issue really got.
- [#9492](https://github.com/kamp-us/phoenix/issues/9492) used the same 0.90 cut
  on two kinds of review question. On one it let 35 of 41 through with no
  errors. On the other it let through only 1 of 16.
- [#9501](https://github.com/kamp-us/phoenix/issues/9501) had one wrong answer
  that cleared the cut. Its confidence was 1.0.

Part of this is the formula from earlier. Confidence is the top share rescaled
by the number of options, so the same top share gives different confidences on
different questions. A top share of 0.6 is a confidence of 0.2 with two options
and about 0.56 with ten. A cut of 0.9 means something different on every
question you put it on. So the first rule is simple. A floor belongs to one
question, measured on that question, and you measure it again when the wording
changes.

But the formula does not explain a 1.0 that is wrong. For that, I had to look at
what each kind of question needed.

## Both were true

On our toys, the answer was on the page. Does this diff meet "spaces become
single dashes"? The diff is in the state. The test that checks it is named in
the state. Everything the judge needs to know is in front of it.

On phoenix's triage, the answer was a house rule. Look at how #9493 went wrong:
migration work that the repo labels `feature` came back `chore`, and issues
labelled `investigation` or `decision` came back `bug`. Nothing in the text of
those issues says how this one repo files a migration. Jev read the text well,
answered what the text says, and was confident about it. It was wrong about our
habits, not about the words. The spike says so itself: "labels can encode human
context absent from the supplied text."

So the line does not run between toys and real data. It runs between kinds of
question. If the answer is in the state, a measured floor protects you. If the
answer needs something that is not in the state, a habit nobody wrote down or a
sum nobody worked out, confidence tells you how clearly the model read the
words, and nothing about whether it is right.

The toys hit the second kind too, as soon as arithmetic came in. We asked
whether the example `parseDuration("1.5h") -> 4500` really shows its rule, and
it scored 0.89. The right answer is 5400. Telling 5400 from 4500 means doing
the sum, and Jev does not do sums. That story belongs to the next post.

The picture I use here is a new hire on their first day. They read fast and
carefully. Ask them what a paragraph says and they get it right. Ask them how
the team labels a migration and they will give you a confident answer built from
the words in front of them, because nobody told them the house rule. That is not
a bad hire. That is a bad question for day one.

This is why the title is only half the lesson. An unsure answer often means the
question was bad. A sure answer can mean the question was bad too, if the
answer was never in the state.

## Where unsure goes

Once unsure is a real outcome and not an error, someone has to decide where it
goes. That decision belongs in code, and the cost of being wrong should drive
it.

Triage taught me this the hard way. Its sort asks Jev four questions in one call
(type, priority, who can pick it up, is it worth doing). The first version held
all four to the 0.8 floor, and real triage parked 5 of 5 tickets. Every park
lands on a person, so a blanket "be sure of everything" sent every single ticket
to a human. Not much of a pipeline.

The fix was to hold each question only to what the next step needs from it. The
comment above `sortRulingOf` in `src/sort.ts` spells it out:

- **type**: what gets routed on is "can a lane build this", so bug against
  feature may be a coin flip. Only the weight on the chosen side must clear the
  floor.
- **priority**: `p2` is the default. An unsure answer is `p2`, never a park.
- **value**: in doubt, keep. Only a confident "not worth doing" counts.
- **audience**: this one is held to the floor both ways, because guessing
  "agent" hands a builder work that rests on a call nobody made.

The type rule is my favourite trick in the file. Jev gives a share for
every option, so code can add them up. If Jev is torn between `bug` and
`feature`, it does not matter, because both mean "a lane can build this". Code
sums the shares on the buildable side and checks that against the floor. The
model reads. Code adds.

And sometimes unsure is exactly the right answer. Later we put Jev in review as
a router: when a change touches a file the ticket never named, does that change
serve the ticket's goal? Over 12 hand-labelled reasons, asked 3 times each, it
was right 30 of 36 times and wrong 0. The other 6 were unsure, and all six were
about two changes: a type comment and a README example, at 0.45 to 0.54. Those
support the ticket without doing its work. People would argue about them. Here
the tray is doing its job, and the lane hands it to a person.

So there are two kinds of unsure, and they go to different places. If the same
unsure keeps coming back on a whole class of inputs you wrote, like every
criterion about what stayed the same, the question is bad, and the fix goes
upstream, to whoever writes the input. If unsure lands on the cases people
would argue about too, the model is being honest, and that is a person's call.

## A small model as a judge, in your own pipeline

If you want to try this, here is what I would tell myself on day one.

- **Ask about what is on the page.** Put everything the answer depends on into
  the state. If the answer needs a house rule, write the rule into the state or
  ask someone else. If it needs a sum, do the sum in code.
- **One claim per question.** A criterion that says two things is two
  questions. A broad question hides several judgments behind one number.
- **Give it only what that question needs.** Extra text is not free context. It
  moves the answer: swapping a goal-shaped ticket title for a bug-shaped one,
  next to the same criterion and test, took the judge from 0.93 to 0.97 down to
  0.58 to 0.84.
- **Count before you trust a floor.** Build cases where you know the answer, by
  running real code, and see how often each confidence level is right. Do it per
  question, and again when the wording changes.
- **Decide in code where unsure goes, by cost.** A wrong park costs a person. A
  wrong send-back costs a retry. Pick the cheaper mistake on purpose.
- **When it is unsure, fix the input.** Read your question before you read its
  answer. Asking again gives you the same number.
- **Do not let it hold what a test can hold.** With a passing test in front of
  it, our judge was right 117 of 117. Without one, about half on broken code. The
  test did the real work.

None of this is my invention. TypeSafe's guide
(https://docs.typesafe.ai/concepts/how-to-build-with-system-one) says most of it,
and the idea it calls the most important is the one I learned slowest: "Ask the most explicit, narrow, specific, atomic questions you
can." I read that guide properly only after fourteen experiments. I should have
read it first.

So this is what I took from meeting Jev. It reads well, it is cheap enough to
ask about a lot, and its doubt is information. When it says it is not sure, it
is usually telling me something about my question.

The question I still have is about the other kind of answer, the confident one
on a question whose answer was never on the page. A floor cannot catch that,
and Jev cannot tell me when it happens. For now the only guard I have is to
check the question before I trust the answer.

Next up is "A judge that cannot add": the long middle of the experiments, and
the one thing Jev cannot do at all.
