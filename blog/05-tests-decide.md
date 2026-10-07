# Tests decide, not models

117 of 117. That's how often our judge was right when a passing test sat in
front of it. With no test and broken code, it was right about half the time.

Those were the calibration numbers from [the last post](./02-meeting-jev.md),
and they came back on the first afternoon. The agent read them and proposed a
rule: every criterion needs a test. Then it went further. Write the tests
first, from the ticket, before anyone writes code, and let the tests say when
the work is done.

I checked that I had it right. This was test-driven development taken all the
way, with the tests deciding "done" instead of a model. Once I saw it that way,
it fit the whole project better than anything we'd tried. The point of this
repo is building software with agents inside a deterministic control plane.
A test runner is about as deterministic as a judge gets.

This post covers how "a model judges the diff" became "running code decides",
mostly over experiments 19 to 24. By the end, a real lane took the slugify
ticket from triage to done, and after triage nothing judged anything. Not a
person, not a model. It also covers the limit we hit, which no test gets past.
A test can only check a rule somebody wrote down.

## Reading is not running

First I wanted to try something cheaper. If a test is what makes the judge
right, maybe the test doesn't need to run. Write it as a sentence, `"1.5h"`
returns `5400`, and let Jev read the code against it. No test runner, just a
fast, cheap reader.

We mostly had the data already, because each duration criterion carried an
example like that one. Experiment 5 showed Jev broken code with no real test:

| Criteria | Answers | Sure and right | Sure and wrong | Unsure |
|---|---|---|---|---|
| With an example (duration) | 18 | 8 | 0 | 10 |
| Abstract (slugify) | 9 | 3 | 3 | 3 |

The example helped. With one in front of it, Jev never confidently passed
broken code. It also only confidently caught the bug 8 times in 18. Without an
example it was sure and wrong as often as it was sure and right. A test runner
catches every one of those bugs, every time, for the price of a function call.

Small sample. Same shape as everything else we'd seen, though.

Think of a cake recipe. You can hand it to a very good cook and ask if the cake
will rise, and they'll often be right. Or you can bake it. A reader gives you
an opinion about what the code does. A test tells you what it did.

## Version one: an agent writes the tests

So we went test-first. A while later I asked the agent to sum up where we
stood, and I played the plan back to make sure I understood it. The tests come
first, so the acceptance criteria are written as code. The builder works
against them. Green means the code is right. Jev's only job is to check that
each test really covers its criterion.

That was version one. A test-writer agent reads the ticket and the starting
code, never an implementation, and writes one test per criterion. Code checks
that every criterion has a test. Jev answers one narrow question per test: does
this test really check this criterion? Then the builder works against those
tests.

The writer looked like the easy part. In its first run (experiment 7) it wrote
a good test for 27 of 27 criteria, graded the hard way: a good test passes on
the correct code and fails on code that breaks its criterion. The judge was the
problem. It was careful to a fault and kept sending good tests back as unsure.
[A judge that cannot add](./03-a-judge-that-cannot-add.md) is the story of
fighting that. And the 27 of 27 has an asterisk, because the writer could see
far more than we thought. That's [The agents had a
shell](./04-the-agents-had-a-shell.md).

For this post, what matters is where that fight ended. Two findings pointed the
same way.

Experiment 17 split the judge's one broad question into three narrow ones. Does
the test call the function with the example's input? Does it expect the
example's result? Does it compare against one exact value? Once the example is
written out exactly, the first two aren't judgment at all. Plain string
matching answers them, and it agreed with Jev on 152 of 156 tests.

Experiment 18 found the one thing a reader can't check: is the example itself
right? `parseDuration("1.5h") -> 4500` scored 0.89. The right answer is 5400.
Telling them apart takes arithmetic, and Jev doesn't do arithmetic. Nothing that
only reads can tell you a result is wrong.

Put those together and the test-writer looks odd. If the criterion already
holds an exact call and an exact result, an agent writing a test from it is
copying, and a judge checking that test is checking a copy. The example already
is the test. The only open question is whether the example is right.

## Criteria as data

Experiment 19 took that literally. Triage writes each criterion as data: a rule
in words, plus one or more examples, each a JavaScript call and its exact
result. Code turns every example into an assertion. No agent writes the visible
tests, and no judge checks them.

Here's the type in `src/issue.ts` today, trimmed:

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

`z.tuple([Example], Example)` means "at least one". You can't write down an
example criterion with no examples. Remember the second kind, `unchecked`. It
matters more than it looks.

The test writer, the heart of `src/tests.ts`, is one line of string formatting
per example:

```ts
`test(${JSON.stringify(name)}, () => {\n  assert.deepStrictEqual(${e.call}, ${e.result});\n});\n`
```

That's the whole job an agent and a judge used to share. The example
`slugify("A b")` with result `"a-b"` becomes
`assert.deepStrictEqual(slugify("A b"), "a-b")`. Done. Triage's brief says so
in plain words: code runs every example "against the finished code, with no
person or model in between. So the call must run exactly as written, and the
result must be exactly right."

Two things could break this. Some rules might not be a call and a result. And
triage might get results wrong, since it reads the code but can't run anything.
Experiment 19 ran triage three times per toy, then ran every example against the
correct code, the starting code and every broken version.

| | Triage may read the toy's tests | Triage has only the ticket |
|---|---|---|
| Examples wrong on the correct code | 0 of 54 | 0 of 23 |
| Broken versions caught | 33 of 33 | 11 of 33 |

The first column proves less than it seems. The toys' own tests hold every hard
result, like `"1.5h" -> 5400`, and triage could copy them. So we ran it again
with the tests hidden and every rule spelled out in the ticket, with no example
values. Triage wrote 52 criteria, all with an example, got 0 of 54 results
wrong, and its examples caught 33 of 33 broken versions. It worked the results
out itself: `"1h2m3s" -> 3723`, `"café" -> "caf"`. It did pick easy inputs,
though. One or two steps of sum, short strings.

The second column is the one that stuck with me. With a thin ticket, criteria
as data did worse, not better. Two slugify runs wrote examples like
`typeof slugify("Hello World") -> "string"`. True. Also true of almost any
slug. With no rules to read, triage wrote down what it could be sure of, and
that was weak. The data shape did nothing for a thin ticket. Only more rules
would have.

## Most real criteria don't fit

The toys are pure functions. A string goes in, a value comes out. Real tickets
aren't like that. So the same experiment ran triage on seven closed issues from
[demlik](https://github.com/kamp-us/demlik), my brother's repo and home of the
`@demlik/tea` library this project builds on. Each ran at the commit before its
fix, and we counted how many criteria fit a call and a result.

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

Triage gave a reason for each criterion that didn't fit, and the reasons fall
into a few kinds. Types only the compiler sees. Async Effect runs that play out
over time. A CLI run over files on disk. Docs and wording. Process rows, like a
changeset or green CI. We never ran the demlik examples, so we don't know if
their results were right.

36 of 130 could have killed the idea. It turned into the part of the design I
like most instead. A call and its result isn't the shape of a criterion. It's
the shape of one kind of criterion. Each kind needs its own check: an example
for code to run, a type test for what only the compiler sees, a fixture test an
agent writes for a CLI over files, a file or docs check. Call-and-result is just
the first kind we built.

That's why `unchecked` is in the type. A rule with no example becomes
`unchecked`, with triage's reason in `why`, and the lane won't start on it. The
first thing `start` does in `src/lane.ts` is look:

```ts
const unchecked = m.issue.criteria.flatMap((c) => (c.kind === "unchecked" ? [c.id] : []));
return unchecked.length > 0
  ? park(first, { kind: "unchecked", criteria: unchecked })
  : startPreparing(first);
```

A criterion nobody can check becomes a named park, not a line that quietly
passes. The README is plain about the cost today: "A ticket with one parks as
`unchecked`; most real tickets have one." The other kinds of check aren't built.
I'd still take a lane that stops on most real tickets and says why over one
that calls them done on a reader's opinion. But it's a real limit, and I won't
dress it up.

## Who checks the examples?

Moving tests into data moves the risk with them. A wrong example becomes a
wrong test, and the builder codes to it, honestly and green. Jev can't catch
that, because catching it means working out the right answer. So what can?

Have someone else work it out, separately. Give an agent only the rules, never
the examples, and ask for a throwaway implementation. Then run each example's
call on it. If triage wrote `parseDuration("1.5h") -> 4500` and the throwaway
returns 5400, someone is wrong, and a person should look.

It's two cashiers counting the same till. You don't trust either one. You trust
the moment their counts agree, and you look hard when they don't.

Experiment 20 planted 20 wrong examples across the two toys, in three kinds:

- **Skips the rule.** `slugify("Hello") -> "Hello"`
- **Misreads the rule.** `parseDuration("90") -> 5400`, a bare number read as
  minutes
- **Off value.** `parseDuration("1.5h") -> 4500`

Three ways to catch them, three runs each. The throwaway reference. Hidden
tests, written by an agent from the rules, run on code that follows the wrong
example. And the builder itself, shown rules and examples, which may answer
`contradiction` instead of coding to an example. Every way also ran on the
correct examples, to count false alarms. With clearly written rules:

| Check | Wrong examples caught | False alarms |
|---|---|---|
| Throwaway reference, any of 3 | 20 of 20 | 0 of 10 |
| Builder says "contradiction" | 19 of 20 | 0 of 6 |
| Hidden tests | 13 of 13 | 0 |

The hidden-test row only counts the 13 wrong examples some general code can
follow. Nothing general returns 4500 for `"1.5h"`.

Every reference disagreed with every wrong example, not just one in three. The
builder came close for free, since it's there anyway. The one example it let
through, `slugify("héllo") -> "hll"`, it didn't code to either. It wrote correct
code, so the visible test fails on honest code, and the lane sees that.

I wasn't sure what that `contradiction` answer was actually for, so I asked.
It's the builder raising its hand. The lane checks that the example it names
really exists on that criterion, then parks with the rule and the example side
by side for a person. A side agent reading over our shoulders found a gap in
the first plan: the person could only keep the example or drop the ticket. There
was no way to say "the builder is right, here's the correct result". So the
park got a third answer, `fix`. It rewrites the example, regenerates the tests,
and the builder's next turn starts with "You were right".

One caveat I want to keep, because it's the one I'd forget. The references
aren't good code. Only 3 of 12 passed the toy's full test suite. They agreed
with every correct example here, but on other inputs they might not. The log
says it well: "A reference is a check on the examples, never an oracle." It
doesn't need to be right. It needs to be written separately, so its mistakes
aren't triage's mistakes.

When we planned the lane, the agent wanted the reference only for pure
functions. I pushed on that, because it sounded like we were limiting ourselves
for no reason. The limit turned out to be on the check, not the lane. A pure
function's answer depends only on its inputs, so a throwaway copy is one small
file. Code that writes files or keeps state needs the whole repo set up around
the throwaway, and then the copy is as big as the real build and more likely
wrong than the example it checks. The agent also pointed out it reaches past
toys: a tea reducer is a pure function too.

The builder's `contradiction` answer is in the lane today. The throwaway
reference isn't; it's on the README's "not built" list. How much real code it
can reach is still open.

## Does triage get examples wrong on its own?

Those mistakes were planted by hand. Triage hadn't written a wrong result yet,
but it had picked easy inputs. So experiment 21 gave it two toys where the
results take real work:

- `businessDays(start, end)`: weekdays after start up to end, skipping weekends,
  January 1 and December 25. You need the weekday of each date.
- `formatBytes(n)`: 1024-based units, one decimal rounded half up, rolling over
  to the next unit when rounding reaches 1024.

Rules in the ticket in words, no tests to copy, three examples per rule with one
on an edge. Triage could read the stub and run nothing. It wrote 175 examples,
and they weren't easy. `businessDays("2023-12-29", "2024-01-02") -> 1` crosses a
year end over a holiday. `formatBytes(1048525) -> "1 MB"` and
`formatBytes(1048524) -> "1023.9 KB"` sit right on the rounding edge.

All 175 were right. Across experiments 19 and 21, that's 0 wrong out of 283.
Neither check raised a false alarm on the 175 right ones either.

A zero needs careful reading, and there's a small trick for it called the rule
of three. If something happened 0 times in n tries, you can be about 95% sure
its real rate is under 3 in n. 3 divided by 283 is about 1%. So the honest claim
is "under about 1%", not "never". A new lunch place that got your order right
283 times in a row hasn't proven it never gets it wrong. It's proven it's rare.

Two more limits. Triage ran on the Claude CLI's default model here, and a
smaller model would need its own run. And with no natural mistakes to catch, we
still haven't measured how well the checks catch them. What the numbers do say
is that the checks are cheap insurance. Zero false alarms, and every planted
mistake caught.

## No Jev slot on examples

We tried once more to give the small model a job here. Experiment 18 had found
the one example question Jev answers well: does the input touch the rule at
all? An example whose input gives the rule nothing to act on proves nothing, and
Jev accepted made-up idle examples like that 0 of 121 times.

Experiment 22 asked the same question, word for word, about 131 of triage's
real examples from experiment 19. Triage had written no idle ones, so there was
nothing to catch. Jev flagged 5 anyway, below 0.5, and 4 of the 5 were the
plainest example there is: `parseDuration("1.5h") -> 5400` for "A part's number
may be a decimal", at 0.26 to 0.44.

The funny part: in experiment 18, the same question about the same call scored
0.96. The rule there read "A part can be a decimal number". Triage wrote "A
part's number may be a decimal". Same idea, a few words moved, and the score
fell from 0.96 to under 0.5.

So no Jev slot on examples. Its "no" would mostly send good ones back. It's the
lesson from [the last post](./02-meeting-jev.md) seen from the other side: put
the reader where reading is the whole job, and nowhere else.

## The lane, end to end

Experiment 24 put it all together with real agents. The lane stopped asking Jev
whether a diff meets a criterion. At that point it went like this:

1. Triage writes each criterion as data.
2. Code writes `criteria.test.js` from the examples and runs it once on the
   untouched code. Every example must run, and at least one must fail.
3. The builder works against those tests. It may read the file and never
   change it.
4. The tests run again. Green means done.

(The lane has grown since. A fresh copy and a review now come after the green
run. That's the next post.)

The "at least one" in step 2 is on purpose. Back in experiment 6, 4 of 18 good
tests already passed on the starting code, because the stub returns `null` and
the criterion expects `null`. So "every test must fail first" can't be a hard
rule. "Something must fail first" can. If nothing does, the lane parks as
`nothing_to_build`. If an example doesn't run at all, it parks as
`tests_broken`.

One real run on slugify, with Claude Code as triage and builder, and real Jev
for triage's sort. Triage wrote 6 rules with one example each, and all 6 failed
on the stub. The builder answered `done` on its first try. The 6 tests and the
toy's own 3 passed. The log puts it simply: "No person or model judged anything
after triage."

The duration run didn't get that far. Triage wrote 3 rules, then Jev sorted the
ticket as one for a person, at 0.32, and triage parked. Two runs, two parks.
Triage parks couldn't take an answer yet, so the ticket stopped there.

The slugify run is small. One run, one toy, nine tests. But it was the first
time the whole thing went from ticket to done with only a test runner and an
exit code deciding at the end. The judge that started the project, the one from
[the first post](./01-v4.md) that read a diff and said "met", was gone.

## The ticket is the ceiling

Now the limit. It showed up in every experiment in this post, wearing a
different coat each time.

In experiment 19, the thin ticket's examples caught 11 of 33 broken versions,
because triage only had weak rules to work from. In experiment 20 we also wrote
the rules loosely, the way a person might file them: "Spaces between words
become dashes", "A plain number works too". With those, the reference caught 19
of 20 and the builder 16 of 20. Every miss was a misreading, and the same three
came back every time: `a---b`, `hello` for `héllo`, and `5400` for `"90"`. Where
they missed, the reference, the hidden-test writer and the builder had all made
the same mistake as the wrong example.

They weren't careless. "Spaces become dashes" really doesn't say one dash per
run of spaces. The loose rules allow those readings. Even the one false alarm
points the same way: the loose references turned `é` into `e`, so they
disagreed with the correct `"hllo"`.

The log has a line I'd put on a wall: "Nothing that reads only the ticket can
settle what the ticket does not say."

When the duration ticket finally reached the lane through a person's answer,
triage had written 3 rules where the toy's hidden tests held 8. Six were rules
nobody wrote down: seconds, spaces, upper case, decimals, a bare number, the
order of units. [The agents had a shell](./04-the-agents-had-a-shell.md) tells
what the builder did about that.

Two things written separately and run against each other is how you catch a
mistake. It isn't how you catch a gap. If the ticket never wrote the rule down,
every agent reading it guesses, and the guesses tend to agree, because they're
all reading the same words. Agreement on a guess looks exactly like agreement on
a fact. The tests can be as deterministic as you like. They're still only as
complete as the ticket.

## What I'd take from this

**Settle "is it right" by running code.** Even with an example in front of it,
Jev never passed broken code and still caught the bug less than half the time.
A test catches it every time.

**Write acceptance criteria as data.** A rule, a call, its exact result. Then a
test is one line of string formatting, and there's nothing left for an agent to
copy wrong or a judge to misread.

**Check the examples with something written separately.** A throwaway
implementation from the rules alone caught 20 of 20 wrong examples, with no
false alarms. It doesn't need to be good code. It needs to make different
mistakes.

**Let the builder object, in a typed answer.** `contradiction`, parked with the
rule and the example side by side, caught 19 of 20 for free. And give the
person a `fix` answer, not only keep or drop.

**Give every criterion a kind, and park on the ones you can't check.**
`unchecked` with a reason is honest. "Looks done" from a reader, on a criterion
no test covers, isn't.

**Spend your effort on the ticket.** Wrong results were rare, 0 of 283. Missing
rules weren't. That's where the work is.

The question I still have sits at the bottom of the experiment log. From a thin
ticket, triage finds about half the rules. Should it ask the person who filed
it, guess and mark the guess, or park? I don't know yet. I only know that no
check further down the line can answer it for them.

Next: [Rebuilding fabrika one step at a time](./06-rebuilding-fabrika-step-by-step.md),
where I stopped to ask whether we were testing new ideas or rebuilding fabrika,
and we went back to the real goal.
