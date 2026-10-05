# Tests decide, not models

> Draft, still being written.

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
decides", over experiments 19 to 24. By the end, a real lane took the slugify
ticket from triage to done, and after triage nothing judged anything, not a
person and not a model. It's also about the limit we hit, which no amount of
testing gets past. A test can only check a rule somebody wrote down.

## A smart reader is not a test

I had a cheaper idea first. If a test is what makes the judge right, maybe the
test doesn't need to run. Write it as a sentence, `"1.5h"` returns `5400`, and
let Jev read the code against it. No test runner, no sandbox, just a fast and
cheap reader.

The data for that was mostly there already, because the duration criteria each
carried an example like that one. Here is how Jev did on broken code with no
real test shown (experiment 5):

| Criteria | Answers | Sure and right | Sure and wrong | Unsure |
|---|---|---|---|---|
| With an example (duration) | 18 | 8 | 0 | 10 |
| Abstract (slugify) | 9 | 3 | 3 | 3 |

The example helped. With one in front of it, Jev never confidently passed
broken code. But it only confidently caught the bug 8 times out of 18. Without
an example it was confidently wrong as often as it was confidently right. A
test runner catches every one of those bugs, every time, for the price of
calling a function.

It's a small sample, and I won't make more of it than it is. But it has the
same shape as everything else we'd seen. The picture I use is a recipe. You can
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

The writer turned out to be the easy part. In its first run (experiment 7) it
wrote a good test for 27 of 27 criteria, graded the hard way: a good test
passes on the correct code and fails on the code that breaks its criterion.
The judge was the trouble. It was careful to a fault, and sent good tests back
as unsure. [A judge that cannot add](./03-a-judge-that-cannot-add.md) is the
story of fighting that caution, and [The agents had a
shell](./04-the-agents-had-a-shell.md) is about how some of those agents could
see a lot more than we thought.

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
already is the test. The only question left is whether the example is right.

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
