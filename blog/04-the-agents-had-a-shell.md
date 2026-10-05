# The agents had a shell

> Draft, still being written.

`git show HEAD:slugify.test.js`

That's a command our agents ran to read a file they were never meant to see.
We had deleted the toy's own tests from the folder on purpose, and the
test-writer's prompt said, in so many words, "You cannot run commands." The
file was still in git, and the agents still had a shell. In 46 of its 63
sessions, the test-writer looked at git or at the test files.

This post is about two leaks. The first one is that shell: a tool flag that did
less than I thought, and the six experiments it quietly bent. The second one
showed up that evening, after the first was fixed, and it was sneakier. The
hidden tests that were supposed to check the builder's work were handing it the
answers every time they failed.

Neither leak was the model being clever or sneaky. Both were holes in what we
built around it. That's the part I think you can use.

## The exam

To see why the leak mattered, you need the experiment it hit hardest.

By the middle of day one the lane worked like this. Triage writes the ticket's
criteria, each with an example. A test-writer agent turns each criterion into
one test that asserts exactly that example. The builder writes code until the
tests pass. (How we got to that shape, and the judge that checked those tests,
is [the previous post](./03-a-judge-that-cannot-add.md).)

There's a hole in that. If every test asserts one example, code can pass by
handling just those examples. The agent proposed hidden tests to close it, and
I didn't follow. I asked what "supports hidden tests" meant, and then:

> how does this do a cheating check?

The answer it gave me is the picture I've used ever since. A teacher hands out
practice questions. A student who memorises the practice answers will ace the
practice and fail the exam, because the exam asks different questions about
the same topics. So the teacher keeps the exam questions to herself.

In the lane, the practice questions are the visible tests, one per criterion,
using the criterion's own example. The exam is a second file the test-writer
writes, with three more tests per criterion on other inputs. The builder never
sees that file. It gets copied in only when the tests run, and removed again
before the builder gets another turn.

Experiment 11 checked whether the exam catches a memoriser. I didn't want to
wait for a builder to cheat by accident, so the cheats were written by hand.
The cleanest one is a lookup table. Here is
the whole of it for `parseDuration`:

```js
export function parseDuration(text) {
  const known = { "1h30m": 5400, "90": 90, "1.5h": 5400, "1H30M": 5400 };
  return known[text] ?? null;
}
```

It knows the examples by heart and nothing else. The others were subtler:
lower-casing only the first letter of a slug, turning exactly three spaces into
a dash, removing only the punctuation that showed up in the examples. Each one
is right on the practice questions and wrong in general.

The first numbers were good, and I'll give them as they were logged at the
time:

- 33 of 36 cheats passed every visible test. The hole was real. The lane as
  planned would have called all 33 done.
- The hidden tests caught 24 of those 33.
- 0 of the 90 hidden tests failed on the correct code. That one matters as much
  as the catch rate, because a hidden test that's wrong blocks an honest
  builder who can't even see why.

The 9 misses were three cheats, missed in every run, and all three break the
same thing: seconds. One returns `null` for anything with an "s" in it. No
criterion on the ticket mentioned seconds, and the test-writer had been told
to test nothing the criteria don't promise. It did what it was told. Counting
only cheats against a rule some criterion actually states, the hidden tests
caught all of them.

I liked that result a lot. Then, about forty minutes after it went into the
log, a correction went in above it.

## The flag that didn't do what I thought

Every agent turn in the repo starts Claude Code headless, with `claude -p`. To
keep the test-writer and triage away from things they shouldn't touch, each
turn was started with `--allowedTools Read Glob Grep`, plus the edit tools for
agents that write files.

That flag doesn't do what the name made me think. `--allowedTools`
pre-approves tools, so the agent can use them without asking permission. It
doesn't take the other tools away. The agents kept everything else, a shell
included.

So when a toy's own test file had been deleted from the folder to keep it
secret, the agent did what a good engineer would do on a new repo. It looked
around, saw a git repo, and read the file out of history.

Claude Code keeps a log of every session, every tool call included, so we
could count instead of guess:

| Agent | Sessions | Looked at git or the test files |
|---|---|---|
| Test-writer | 63 | 46 |
| Triage (the enricher) | 73 | 50 |
| Builder | 40 | 1 |

The test-writer and triage looked in most of their sessions. The builder almost
never did. For what it's worth, the builder's hidden tests were never in its
git history to begin with. They sit in a separate folder and only get copied in
while the tests run.

What this broke was every line in the experiment log that said an agent "never
saw the toy's own tests". That was not true for most runs of experiments 7, 9,
10, 11, 12 and 13. Six experiments, all measured on agents that may have been
reading the answer key.

The fix came in two parts, in commit `46bd5a4`. The first is one flag. Here is
the turn's argument list now, with the comment that went in with it:

```ts
// `--tools` is what takes the other tools away. `--allowedTools` alone only
// pre-approves: with it the agent kept a shell, and used `git show` to dig
// files out of history that had been removed from its folder.
"--tools", ...ask.tools,
"--allowedTools", ...ask.tools,
```

`--tools` names the only tools the agent has. We checked that an agent started
this way reports no shell.

The second part is there in case the first one ever slips. Deleting a file
from the folder doesn't delete it from the repo, and any tool that can reach
`.git` can get it back. `checkoutToy`, which sets up each toy in a
fresh folder, got a `without` option that leaves files out before the first
commit, so they're not in the history at all:

```ts
// Left out before the first commit, so the files are not in the history either.
for (const file of options.without ?? []) await rm(join(dir, file), { force: true });
```

If the file was never committed, there's nothing to dig up.
