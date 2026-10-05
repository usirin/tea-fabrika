# Tests decide, not models

> so the suggestion you give me is basically we follow TDD to its core?

I asked that on the first afternoon, a few minutes after the calibration
numbers from [the last post](./02-meeting-jev.md) came back. With a passing
test in front of it, our judge had been right 117 of 117 times. With no test
and broken code, it was right about half the time. So the agent proposed a
rule, every criterion needs a test, and then something bigger. Write the tests
first, from the ticket, before anyone writes code. Let the tests say when the
work is done.

It took me a minute to see what that meant for the whole project. Then:

> hmm, interesting way of building a software. but also feels very fitting to the core idea of what we are trying to do: how to build software with agents in a deterministic control plane.

This post is about how "a model judges the diff" turned into "running code
decides", mostly over experiments 19 to 24. By the end, a real lane took the slugify
ticket from triage to done, and after triage nothing judged anything, not a
person and not a model. It's also about the limit we hit, which no amount of
testing gets past. A test can only check a rule somebody wrote down.

## A smart reader is not a test

Before going all in, I wanted to try a cheaper idea. If a test is what makes
the judge right, maybe the test doesn't need to run. Write it as a sentence,
`"1.5h"` returns `5400`, and let Jev read the code against it. No test runner,
just a fast and cheap reader.

The data was mostly there already, because the duration criteria each carried
an example like that one. Here is how Jev did on broken code with no real test
shown (experiment 5):

| Criteria | Answers | Sure and right | Sure and wrong | Unsure |
|---|---|---|---|---|
| With an example (duration) | 18 | 8 | 0 | 10 |
| Abstract (slugify) | 9 | 3 | 3 | 3 |

The example helped. With one in front of it, Jev never confidently passed
broken code. But it only confidently caught the bug 8 times out of 18. Without
an example it was confidently wrong as often as it was confidently right. A
test runner catches every one of those bugs, every time, for the price of
calling a function.

It's a small sample, but it has the same shape as everything else we'd seen.
The picture I use is a recipe. You can
hand a recipe to a very good cook and ask "will this cake rise?", and they'll
often be right. Or you can bake it. A smart reader gives you an opinion about
what the code does. A test gives you what it did.

## The first version: an agent writes the tests

So the plan became test-first. A little later, after asking the agent to sum
up where we were, I said it back to make sure I had it:

> so essentially we write the tests to pass the fix first, this way we know that acceptance criteria is codified -> then we implement -> tests pass means code's right -> then jev just reviews that the tests are actually covering the AC properly?

That was the first version. A test-writer agent reads the ticket and the
starting code, never an implementation, and writes one test per criterion.
Code checks that every criterion has a test. Jev answers one narrow question
per test: does this test really check this criterion? Then the builder works
against those tests.

The writer looked like the easy part. In its first run (experiment 7) it wrote
a good test for 27 of 27 criteria, graded the hard way: a good test passes on
the correct code and fails on the code that breaks its criterion. The judge
was the trouble. It was careful to a fault, and sent good tests back as unsure.
[A judge that cannot add](./03-a-judge-that-cannot-add.md) is the story of
fighting that caution. And that 27 of 27 has an asterisk on it, because the
writer could see a lot more than we thought it could. That's [The agents had a
shell](./04-the-agents-had-a-shell.md).

What matters for this post is where that fight ended. Two findings pointed the
same way.

In experiment 17 we split the judge's one broad question into three narrow
ones. Does the test call the function with the example's input? Does it expect
the example's result? Does it compare against one exact value? Once the
criterion has its example written out exactly, the first two aren't judgment
at all. Plain string matching answers them, and it agreed with Jev on 152 of
156 tests.

Then experiment 18 found the one thing a reader can't check: is the example
itself right? `parseDuration("1.5h") -> 4500` scored 0.89. The right answer is
5400. Telling them apart means doing the sum, and Jev doesn't do sums. Nothing
that only reads can tell you a result is wrong.

Put those two together and the test-writer starts to look odd. If the criterion
already holds an exact call and an exact result, an agent writing a test from
it is copying, and a judge checking that test is checking a copy. The example
is already the test. The only question left is whether the example is right.

## Criteria as data

Experiment 19 took that literally. Triage writes each criterion as data: a rule
in words, and one or more examples, each a JavaScript call and its exact
result. Code turns every example into an assertion. No agent writes the
visible tests, and no judge checks them.

Here is the type as it is in `src/issue.ts` today, trimmed:

```ts
/** One worked example: a JavaScript call and the exact value it returns, as a literal. */
export const Example = z.object({ call: z.string(), result: z.string() });

export const Criterion = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("example"),
    id: z.string(),
    rule: z.string(),
    file: z.string(),
    name: z.string(),
    examples: z.tuple([Example], Example),
  }),
  z.object({
    kind: z.literal("unchecked"),
    id: z.string(),
    rule: z.string(),
    why: z.string(),
  }),
]);
```

`z.tuple([Example], Example)` means "at least one". An example criterion with
no examples can't be written down. Keep an eye on the second kind,
`unchecked`. It matters more than it looks.

And here is the test writer, the heart of `src/tests.ts`. For each example, one
line of string formatting:

```ts
`test(${JSON.stringify(name)}, () => {\n  assert.deepStrictEqual(${e.call}, ${e.result});\n});\n`
```

That's the whole step an agent and a judge used to share. The example
`slugify("A b")` with the result `"a-b"` becomes
`assert.deepStrictEqual(slugify("A b"), "a-b")`, and that's it. Triage is told
this in plain words. Its brief says code runs every example "against the
finished code, with no person or model in between. So the call must run
exactly as written, and the result must be exactly right."

Two things could break the idea. Some rules might not be a call and a result.
And triage might get results wrong, because it reads the code but can't run
anything. Experiment 19 ran triage three times on each toy, then ran every
example against the correct code, the starting code and every broken version.

| | Triage may read the toy's tests | Triage has only the ticket |
|---|---|---|
| Examples wrong on the correct code | 0 of 54 | 0 of 23 |
| Broken versions caught | 33 of 33 | 11 of 33 |

The first column looks perfect and proves less than it looks. The toys' own
tests hold every hard result, like `"1.5h" -> 5400`, and triage could copy
them. So we ran it again with the tests hidden and every rule written into the
ticket in words, with no example values. Triage wrote 52 criteria, every one
with an example, got 0 of 54 results wrong, and its examples caught 33 of 33
broken versions. It worked the results out itself: `"1h2m3s" -> 3723`,
`"café" -> "caf"`. It did pick easy inputs, though. One or two steps of sum,
short strings.

The second column is the one I keep thinking about. Given a thin ticket,
criteria as data did worse, not better. Two slugify runs wrote examples like
`typeof slugify("Hello World") -> "string"`. That's true. It's also true of
nearly any slug. With no rules to read, triage wrote down what it could be sure
of, and what it could be sure of was weak. The data shape did nothing for a
thin ticket. Only more rules would have.

## Most real criteria don't fit

The toys are pure functions. A string goes in, a value comes out. Real tickets
aren't like that, so the same experiment ran triage on seven closed issues from
[demlik](https://github.com/kamp-us/demlik), each at the commit before its fix,
and counted how many criteria fit a call and a result.

36 of 130.

| Issue | Fit |
|---|---|
| [#576](https://github.com/kamp-us/demlik/issues/576), `createJevAsk` can't name its Cmd | 11 of 22 |
| [#516](https://github.com/kamp-us/demlik/issues/516), a mistyped process door | 18 of 32 |
| [#565](https://github.com/kamp-us/demlik/issues/565), `readAllowance` | 7 of 22 |
| [#568](https://github.com/kamp-us/demlik/issues/568), spawn's notify step | 0 of 15 |
| [#567](https://github.com/kamp-us/demlik/issues/567), `run.stop()` and the host's table | 0 of 16 |
| [#529](https://github.com/kamp-us/demlik/issues/529), the wrangler config loader | 0 of 15 |
| [#569](https://github.com/kamp-us/demlik/issues/569), docs links | 0 of 8 |

Triage said why for each criterion that didn't fit, and the reasons fall into a
few kinds. Types that only the compiler sees. Async Effect runs that play out
over time. A CLI run over files on disk. Docs and wording. And process rows,
like a changeset or a green CI run. None of the demlik examples were run, so we
don't know whether their results were right.

36 of 130 could have killed the idea. Instead it led to the part of the design
I like most. A call and its result isn't the shape of a
criterion. It's the shape of one kind of criterion. Each kind needs its own
check: an example for code to run, a type test for what only the compiler
sees, a fixture test an agent writes for a CLI over files, a file or docs
check. The call-and-result kind is just the first one we built.

That's why `unchecked` sits in the type. A rule with no example becomes
`unchecked`, with triage's reason in `why`. And the lane won't start on it. The
first thing `start` does in `src/lane.ts` is look for one:

```ts
const unchecked = m.issue.criteria.flatMap((c) => (c.kind === "unchecked" ? [c.id] : []));
return unchecked.length > 0
  ? park(first, { kind: "unchecked", criteria: unchecked })
  : startPreparing(first);
```

A criterion nobody can check is a park with a name, not a line that quietly
passes. The README is plain about what that costs today: "A ticket with one
parks as `unchecked`; most real tickets have one." The other kinds of check
aren't built. I'd still rather have a lane that stops on most real tickets and
says why than one that calls them done on a reader's opinion. But it's a real
limit, and I don't want to dress it up.

## Who checks the examples?

Moving the tests into data moves the risk with them. A wrong example becomes a
wrong test, and the builder codes to it, honestly and green. Jev can't catch
it, because catching it means working out the right answer. So what can?

The idea was to have someone else work it out too, separately. Give an agent
only the rules, never the examples, and ask it for a throwaway implementation.
Then run each example's call on it. If triage wrote
`parseDuration("1.5h") -> 4500` and the throwaway returns 5400, someone is
wrong, and a person should look.

The everyday picture is two cashiers counting the same till. You don't trust
either one to be right. You trust the moment their counts agree, and you look
hard when they don't.

Experiment 20 planted 20 wrong examples across the two toys, of three kinds:

- **Skips the rule.** `slugify("Hello") -> "Hello"`
- **Misreads the rule.** `parseDuration("90") -> 5400`, a bare number read as
  minutes
- **Off value.** `parseDuration("1.5h") -> 4500`

There were three ways to catch them, three runs each. The throwaway reference.
Hidden tests, written by an agent from the rules, run on code that follows the
wrong example. And the builder itself, shown the rules and the examples, which
may answer `contradiction` instead of coding to an example. Every way also ran
on the correct examples, to count false alarms. With the rules written clearly:

| Check | Wrong examples caught | False alarms |
|---|---|---|
| Throwaway reference, any of 3 | 20 of 20 | 0 of 10 |
| Builder says "contradiction" | 19 of 20 | 0 of 6 |
| Hidden tests | 13 of 13 | 0 |

The hidden-test row counts only the 13 wrong examples that some general code
can follow. Nothing general returns 4500 for `"1.5h"`.

Every reference disagreed with every wrong example, not just one of three. The
builder nearly matched that for free, since it's there anyway. The one example
it let through, `slugify("héllo") -> "hll"`, it didn't code to either. It wrote
correct code, so the visible test would fail on honest code, and the lane would
see that.

I wasn't sure what the builder's answer was for, so I asked:

> what's the "contradiction" part exactly?

It's the builder raising its hand. The lane checks that the example it names
really exists on that criterion, then parks with the rule and the example side
by side for a person. A side agent reading over our shoulders pointed out a gap
in the first plan: the person could only say "keep the example" or "drop the
ticket", and there was no way to say "you're right, here's the right result".
So the park got a third answer, `fix`. It rewrites the example, writes the
tests again, and the builder's next turn starts with "You were right".

There's one caveat I want to keep, because it's the one I'd forget. The
references aren't good code. Only 3 of 12 passed the toy's full test suite.
They agreed with every correct example here, but on other inputs they might
not. The log puts it well: "A reference is a check on the examples, never an
oracle." It doesn't have to be right. It has to be written separately, so its
mistakes aren't triage's mistakes.

When we planned the lane, the agent wanted the reference "only for pure
functions". I asked:

> what does "only for pure functions" mean, and why are we limiting ourselves to that?

The limit was on the check, not on the lane. A pure function's answer depends
only on what you pass in, so a throwaway copy is one small file. Code that
writes files or keeps state needs the whole repo set up around its throwaway,
and then the copy is as big as the real build and more likely to be wrong than
the example it's checking. The agent also pointed out it covers more than toys:
a tea reducer is a pure function too.

The builder's `contradiction` answer is in the lane today. The throwaway
reference isn't yet; it's on the README's "not built" list. How much of real
code it can reach is still open.

## Does triage get examples wrong on its own?

Those mistakes were planted by hand. Triage hadn't written a single wrong
result yet, but it had picked easy inputs. So experiment 21 gave it two toys
where the results take real working out:

- `businessDays(start, end)`: weekdays after start up to end, without weekends,
  January 1 and December 25. You need the weekday of each date.
- `formatBytes(n)`: 1024-based units, one decimal rounded half up, rolling over
  to the next unit when rounding reaches 1024.

The rules were in the ticket in words, there were no tests to copy, and triage
was asked for three examples per rule, one on an edge. It could read the stub
and run nothing. It wrote 175 examples, and they weren't easy.
`businessDays("2023-12-29", "2024-01-02") -> 1` crosses a year end over a
holiday. `formatBytes(1048525) -> "1 MB"` and
`formatBytes(1048524) -> "1023.9 KB"` sit right on the rounding edge.

All 175 were right. Across experiments 19 and 21, that's 0 wrong out of 283.
Neither check raised a false alarm on the 175 right ones either.

A zero needs reading carefully, and there's a small trick for it called the
rule of three. If something happened 0 times in n tries, you can be about 95%
sure its real rate is under 3 in n. 3 divided by 283 is about 1%. So the honest
claim is "under about 1%", not "never". Think of a new lunch place that got
your order right 283 times in a row. You can't say they never get it wrong.
You can say it's rare.

Two more limits. Triage here ran on the Claude CLI's default model, and a
smaller model would need its own run. And with no natural mistakes to catch, we
still haven't measured how well the checks catch them. What the numbers do say
is that the checks are cheap insurance. They cost nothing in false alarms, and
they caught every planted mistake.

## No Jev slot on examples

We tried once more to give the small model a job here. Experiment 18 had found
the one example question Jev answers well: does the input touch the rule at
all? An example whose input has nothing for the rule to act on proves nothing,
and made-up idle examples like that were accepted 0 of 121 times.

Experiment 22 asked the same question, word for word, about triage's real
examples, 131 of them from experiment 19. Triage had written no idle ones, so
there was nothing to catch. Jev flagged 5 anyway, below 0.5, and 4 of those 5
were the plainest example there is: `parseDuration("1.5h") -> 5400` for "A
part's number may be a decimal", at 0.26 to 0.44.

Here's the dry part. In experiment 18, the same question about the same call,
`parseDuration("1.5h") -> 5400`, had scored 0.96. The rule there read "A part
can be a decimal number". Triage wrote "A part's number may be a decimal". Same
idea, a few words moved, and the answer fell from 0.96 to under 0.5.

So there's no Jev slot on examples. Its "no" would mostly send good ones back.
It's the lesson from [the last post](./02-meeting-jev.md) seen from the other
side: put the reader where reading is the whole job, and nowhere else.

## The lane, end to end

Experiment 24 put it all together with real agents. The lane stopped asking
Jev whether a diff meets a criterion. At that point it went like this:

1. Triage writes each criterion as data.
2. Code writes `criteria.test.js` from the examples and runs it once on the
   untouched code. Every example must run, and at least one must fail.
3. The builder works against those tests. It may read the file and never
   change it.
4. The tests run again. Green means done.

(The lane has grown since. A fresh copy and a review come after the green
run now, and that's the next post.)

The "at least one" in step 2 is on purpose. Back in experiment 6, 4 of 18 good
tests already passed on the starting code, because the stub returns `null` and
the criterion expects `null`. So "every test must fail first" can't be a hard
rule. "Something must fail first" can, and if nothing does, the lane parks as
`nothing_to_build`. If an example doesn't run at all, it parks as
`tests_broken`.

One real run on slugify, with Claude Code as triage and as the builder, and
real Jev for triage's sort. Triage wrote 6 rules with one example each, and all
6 failed on the stub. The builder answered `done` on its first try. The 6 tests
and the toy's own 3 passed. In the log's words: "No person or model judged
anything after triage."

The duration run didn't get that far. Triage wrote 3 rules, then Jev sorted the
ticket as one for a person, at 0.32, and triage parked. Two runs, two parks. At
that point a triage park couldn't take an answer yet, so the ticket stopped
there.

The slugify run is small. One run, one toy, nine tests. But it was the first
time the whole thing went from a ticket to done with only a test runner and an
exit code deciding at the end. The judge that started the project, the one
from [the first post](./01-v4.md) that read a diff and said "met", wasn't in it
anymore.

## The ticket is the ceiling

Now the limit. It came up in every experiment in this post, in a different
coat each time.

In experiment 19, the thin ticket's examples caught 11 of 33 broken versions,
because triage only had weak rules to work from. In experiment 20 the rules
also came in a loose wording, the way a person might file them: "Spaces between
words become dashes", "A plain number works too". With those, the reference
caught 19 of 20 and the builder 16 of 20. Every miss was a misreading, and the
same three came back every time: `a---b`, `hello` for `héllo`, and `5400` for
`"90"`. Where they missed, the reference, the hidden-test writer and the
builder had made the same mistake as the wrong example.

They weren't being careless. "Spaces become dashes" really doesn't say one dash
per run of spaces. The loose rules allow those readings. Even the one false
alarm pointed the same way: the loose references turned `é` into `e`, so they
disagreed with the correct `"hllo"`.

The log has a line for it I'd put on a wall: "Nothing that reads only the
ticket can settle what the ticket does not say."

And when the duration ticket finally reached the lane, through a person's
answer, triage had written 3 rules where the toy's hidden tests held 8. Six of
them were rules nobody wrote down: seconds, spaces, upper case, decimals, a bare
number, the order of units. [The agents had a
shell](./04-the-agents-had-a-shell.md) tells what the builder did about that.

Two things written separately and run against each other is how you catch a
mistake. It isn't how you catch a gap. If the ticket never wrote the rule down,
every agent that reads it guesses, and the guesses tend to agree, because
they're all reading the same words. Agreement on a guess looks exactly like
agreement on a fact. The tests can be as deterministic as you like, and they're
still only as complete as the ticket. The ticket is the ceiling.

## What I'd take from this

If you run agents on real work, here's what I'd steal.

**Settle "is it right" by running code.** A reader gives you an opinion about
what the code does. A test gives you what it did. Even with an example in front
of it, Jev never passed broken code, and still caught the bug less than half
the time.

**Write acceptance criteria as data.** A rule, a call, its exact result. Then a
test is one line of string formatting, and there's nothing left for an agent to
copy wrong or a judge to misread.

**Check the examples with something written separately.** A throwaway
implementation from the rules alone caught 20 of 20 wrong examples, with no
false alarms. It doesn't have to be good code. It has to make different
mistakes.

**Let the builder object, in a typed answer.** `contradiction`, parked with the
rule and the example side by side, caught 19 of 20 for free. And give the
person a `fix` answer, not only keep or drop.

**Give every criterion a kind, and park on the ones you can't check.**
`unchecked` with a reason is honest. "Looks done" from a reader, on a criterion
no test covers, is not.

**Spend your effort on the ticket.** Wrong results were rare, 0 of 283. Missing
rules weren't. That's where the work is.

The question I still have is the one at the bottom of the experiment log. From
a thin ticket, triage finds about half the rules. Should it ask the person who
filed it, guess and mark the guess, or park? I don't know yet. I only know that
no check further down the line can answer it for them.

Next: [Rebuilding fabrika one step at a time](./06-rebuilding-fabrika-step-by-step.md),
where I asked whether we were testing new ideas or rebuilding fabrika, and we
went back to the real goal.
