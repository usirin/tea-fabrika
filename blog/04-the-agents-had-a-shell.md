# The agents had a shell

`git show HEAD:slugify.test.js`

Our agents ran that command to read a file they were never supposed to see. We
had deleted the toy's own tests from the folder on purpose. The test-writer's
prompt said, in plain words, "You cannot run commands." But the file was still
in git, and the agents still had a shell. In 46 of its 63 sessions, the
test-writer looked at git or at the test files.

This post is about two leaks. The first is that shell: a tool flag that did
less than I thought, and six experiments it quietly bent. The second showed up
that evening, after the first was fixed, and it was harder to see. The hidden
tests that were meant to check the builder's work handed it the answers every
time they failed.

Neither leak was the model being clever or sneaky. Both were holes in what we
built around it. That's the part I think you can use.

## The exam

The leak hit one experiment harder than the rest, so start there.

By the middle of day one, the lane worked like this. Triage writes the ticket's
criteria, each with an example. A test-writer agent turns each criterion into
one test that asserts exactly that example. The builder writes code until the
tests pass. ([The previous post](./03-a-judge-that-cannot-add.md) covers how we
got to that shape, and the judge that checked those tests.)

There's a hole in it. If every test asserts one example, code can pass by
handling just those examples. Hidden tests came up as the fix, and at first I
didn't see how they would catch anyone cheating. So I asked the agent to
explain it plainly.

Its answer is the picture I've used ever since. A teacher hands out practice
questions. A student who memorises the practice answers aces the practice and
fails the exam, because the exam asks different questions about the same
topics. So the teacher keeps the exam questions to herself.

It landed so well that I asked the agent to explain every new idea that way
from then on. I've been a software engineer since 2013. Tests I know. Holding
tests back so an agent's code can't just learn the examples was new to me that
afternoon.

In the lane, the practice questions are the visible tests, one per criterion,
using the criterion's own example. The exam is a second file the test-writer
writes, with three more tests per criterion on other inputs. The builder never
sees that file. It's copied in only while the tests run, and removed again
before the builder gets another turn.

Experiment 11 checked whether the exam catches a memoriser. I didn't want to
wait for a builder to cheat by accident, so we wrote the cheats by hand. The cleanest is a lookup table. Here's all of it for `parseDuration`:

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

The first numbers looked good. Here they are as logged at the time:

- 33 of 36 cheats passed every visible test. The hole was real. The lane as
  planned would have called all 33 done.
- The hidden tests caught 24 of those 33.
- 0 of the 90 hidden tests failed on the correct code. That matters as much as
  the catch rate. A wrong hidden test blocks an honest builder who can't even
  see why.

The 9 misses were three cheats, missed in every run, and all three break the
same thing: seconds. One returns `null` for anything with an "s" in it. No
criterion on the ticket mentioned seconds, and the test-writer had been told to
test nothing the criteria don't promise. It did what it was told. Counting only
cheats against a rule some criterion states, the hidden tests caught all of
them.

I liked that result a lot. About forty minutes after it went into the log, a
correction landed that put it, and five other experiments, in doubt.

## The flag that didn't do what I thought

Every agent turn in the repo starts Claude Code headless, with `claude -p`. To
keep the test-writer and triage away from things they shouldn't touch, each
turn was started with `--allowedTools Read Glob Grep`, plus the edit tools for
agents that write files.

That flag doesn't do what its name made me think. `--allowedTools`
pre-approves tools, so the agent can use them without asking. It doesn't take
the other tools away. The agents kept everything else, a shell included.

So when a toy's test file had been deleted from the folder to keep it secret,
the agents did what a curious engineer would. They reached for git and read the
file out of history.

Claude Code logs every session, every tool call included, so we could count
instead of guess:

| Agent | Sessions | Looked at git or the test files |
|---|---|---|
| Test-writer | 63 | 46 |
| Triage (the enricher) | 73 | 50 |
| Builder | 40 | 1 |

The test-writer and triage looked in most of their sessions. The builder almost
never did. And the builder's hidden tests were never in its git history anyway.
They sit in a separate folder and only get copied in while the tests run.

What this broke was every line in the experiment log that said an agent "never
saw the toy's own tests". That wasn't true for most runs of experiments 7, 9,
10, 11, 12 and 13. Six experiments, all measured on agents that may have been
reading the answer key.

The fix came in two parts, in commit `46bd5a4`. The first part is one flag.
Here's the turn's argument list now, with the comment that went in with it:

```ts
// `--tools` is what takes the other tools away. `--allowedTools` alone only
// pre-approves: with it the agent kept a shell, and used `git show` to dig
// files out of history that had been removed from its folder.
"--tools", ...ask.tools,
"--allowedTools", ...ask.tools,
```

`--tools` names the only tools the agent has. We checked that an agent started
this way reports no shell.

The second part is a backup in case the first ever slips. Deleting a file from
the folder doesn't delete it from the repo, and any tool that can reach `.git`
can get it back. `checkoutToy`, which sets up each toy in a fresh folder, got a
`without` option that leaves files out before the first commit, so they're not
in the history at all:

```ts
// Left out before the first commit, so the files are not in the history either.
for (const file of options.without ?? []) await rm(join(dir, file), { force: true });
```

If the file was never committed, there's nothing to dig up.

## Running it all again

A correction is only half done until you rerun what it touched. So we ran the
affected experiments again, with the shell gone and the files out of history:

| Experiment | Before | After |
|---|---|---|
| 9. Test-writer, hand-written criteria: good tests | 48 of 48 | 48 of 48 |
| 11. Hidden tests: cheats caught | 24 of 33 | 27 of 36 |
| 11. Hidden tests wrong on correct code | 0 of 90 | 0 of 90 |
| 13. Triage may read the toy's tests: broken versions caught | 33 of 33 | 33 of 33 |
| 13. Triage has only the ticket: criteria written | not run | 32 |
| 13. Triage has only the ticket: broken versions caught | not run | 18 of 33 |

Most of it held, and I was relieved. The test-writer still wrote a good test
for 48 of 48 criteria. Given good criteria, it never needed to copy. The hidden
tests still caught every cheat that breaks a stated rule, and still never
failed on correct code. With the shell gone, all 36 cheats got past the visible
tests, and the 9 misses were the same three seconds cheats as before.

The judge results from the previous post all stand too. Those experiments
scored Jev on tests with known answers. Who wrote the tests, and what they read
while writing them, doesn't change whether Jev said "checks" to a bad one.

Triage is where it changed, and the last two rows are new on purpose. Before
the fix, triage got the raw ticket and, in most sessions, quietly read the
toy's real tests out of git as well. That looked like triage being good at its
job. So the rerun split it in two: one setup where triage may read the tests,
and one where it gets only the ticket. The duration ticket is two short lines.
It says `parseDuration` always returns `null`, and that it should turn things
like `1h30m` into seconds. That's all.

From that alone, triage wrote 32 criteria where it had written 63, and the
tests built from them caught 18 of 33 broken versions. On slugify that was 13
of 15. On duration, 5 of 18. Two of its tests even failed on our reference
code, because it decided a title that's already a slug stays as it is, and the
reference drops the dash. Neither is wrong. The ticket doesn't say.

That row is the most useful number in the table, and it only exists because of
the mistake. Every later stage works from what triage writes. A thin ticket
gives thin criteria, and no test-writer or builder downstream can add a rule
nobody wrote down. That idea became the whole argument of the next post.

## Keep the wrong line in the log

After a mistake like this you get a choice. You can go back and quietly fix
every number. Or you can leave the old lines where they are and add a
correction that says which ones it breaks.

We did the second. Section 16 of the experiment log is titled "Correction: the
agents had a shell". It sits between experiments 15 and 17, in the order it
happened, and it names the six experiments it affects. The top of the log
points at it too:

> One mistake cuts across several experiments: read section 16 before trusting any line that says an agent could not see a file.

I think that's right for two reasons. A reader can see what we believed, when,
and why it changed, which is more honest than a log that was always right. And
the before and after numbers sit side by side, which is the only way to see
that the test-writer held and triage didn't. If we'd just swapped the numbers,
we'd have erased the most interesting finding.

## The second leak

The shell was fixed by mid-afternoon. The second leak showed up that evening,
and nobody was digging through git this time. The pipeline handed out the
answers itself.

By then the lane ran end to end on real agents. In experiment 25 the duration
toy went through all of it, with a person answering triage when it parked.
Triage wrote 3 rules, all about `h` and `m`. The toy's hidden tests hold 8, so
6 of them were rules nobody wrote down: `s`, spaces, upper case, decimals, a
bare number, the order of units. That's the point of the duration toy. It's a
ticket with unstated rules, like a lot of real tickets.

The builder made the 3 visible tests pass and answered `done`. The hidden tests
sent it back with 6 failures. On its second try it passed everything.

That sounds like the system working. Then the builder explained how it did it:

> I worked out these rules from the failing test names and expected values.

When a hidden test failed, the lane sent the builder the test runner's output
as feedback. And a test runner's output for a failing assertion says what it
expected. The builder never saw the hidden test file. It didn't need to. Each
failure handed it the right answer.

In the teacher's picture, this is an exam that hands back the answer key with
the grade. The student fails, reads the key, and passes the retake. Maybe they
learned the topic. Maybe they memorised the key. From the outside you can't
tell.

I didn't want to just patch it. I wanted to see what else we could tell the
builder, and measure each choice.

## What may the builder hear?

Experiment 26 asked exactly that. A hidden test fails. What do you tell the
builder? We tried three ways:

- `full`: the runner's whole output, expected values and all. What the lane was
  already doing.
- `name`: only the names of the failing tests.
- `ticket`: a triage turn sees only the failing test's name, writes the missing
  rule down with an example, and that example joins the visible tests. The
  ticket gets better, and the builder works from the ticket.

To score them we needed a fresh exam nobody had seen. So the duration toy got
20 held-out tests: the same rules as the hidden tests, with other values, never
run during the build. A stub that returns `null` scores 7 of 20, so 7 is the
floor and 20 is the ceiling. Then 15 builds, 5 for each way:

| Way | Passed the hidden tests | Builds (mean) | Held-out (mean) | Triage's examples right |
|---|---|---|---|---|
| full | 5/5 | 2.0 | 20/20 | - |
| name | 5/5 | 2.2 | 20/20 | - |
| ticket | 5/5 | 2.0 | 20/20 | 20/20 |

All three hit the ceiling, so on this toy you can't tell them apart.

The reason is in the test names. Every hidden test's name is its rule in plain
words, "units can be upper case", and every rule is the obvious one. Once the
builder knows the rule, it can write the code. The leaked values added nothing.
And on the held-out exam, the `full` builds scored 20 of 20 too, so here the
builder learned the rules, not the key.

The three ways would split on a rule whose details live only in the expected
value. Say a free-shipping line of 50 that no test name and no ticket mentions.
With `full`, the builder passes by reading 50 off the failure. With `name` or
`ticket` it can't pass at all, because the builder and triage would both have
to guess the 50.

So whether the leak counts as cheating depends on what the hidden tests are
for. A repo's own tests are ordinary feedback. A person reads their failures
too, and nobody calls that cheating. A held-out acceptance check is different.
It stops being one the moment its values are read.

## What I'd take from this

If you run agents with tools, here's what I'd keep from this, whether or not
you ever build a lane like ours.

**Check what your agent did in its session log, not in your config.** The
config said three tools. The logs said a shell and `git show`. Claude Code
records every tool call, and if your harness keeps a log too, search it for
tools you didn't mean to give. Do it before you trust any result that depends
on what the agent couldn't see.

**Know which of your flags allow and which restrict.** In Claude Code,
`--allowedTools` only pre-approves, so the agent skips the permission prompt.
`--tools` is the list the agent gets. If your harness has both kinds of
setting, find the one that takes things away.

**A prompt is not a fence.** "You cannot run commands" was in the prompt the
whole time. The agent wasn't lying or disobeying. It had a shell, and a shell is
the obvious tool for a git repo. Only tell an agent what code already makes
true.

**Hide things in every copy.** A deleted file lives on in git history. A secret
also lives in caches, CI logs, the folder next door, and the failure message of
the test you're hiding. If an agent mustn't read something, it shouldn't exist
anywhere the agent can reach.

**Decide what each failure says, on purpose.** Feedback is an input to the
next turn, same as the prompt. Write down what it's allowed to carry. For your
own tests, the full output is fine. For a held-out check, a name or a rule is
the most you can give before it stops checking anything.

**Keep the wrong result, and say which lines it breaks.** Add the correction
where it happened, name what it affects, rerun those, and put before and after
side by side. The "after" is often where the real finding is.

## What's still open

I'm not done with this one. The cheats in experiment 11 were written by hand,
on purpose, by us, knowing where the exam would look. A builder that cheats on
its own, by accident, might do it in ways I didn't think of. And the log still
lists one question as open: who checks a hidden test? The judge from the
previous post can't help, because it's confident only when a test uses the
criterion's own example, and a hidden test by design doesn't. The builder can't
object to a test it never sees. Running the test against nothing proves
nothing. In our runs none of the 90 was wrong. I don't know yet what catches
the first one that is.

What I'm sure of is the first lesson. I trusted a flag's name over what the
agent actually did, and six experiments rested on it. The session log had the
truth the whole time. I just hadn't read it.

Next: [Tests decide, not models](./05-tests-decide.md), what happens when you
stop asking a model whether the work is done, and let two separately written
things argue it out in code.
