# Rebuilding fabrika one step at a time

> Draft, still being written.

> question: are we testing new ideas here? or are we trying to rebuild fabrika with code?

I typed that at about half past nine on the first night. A minute earlier,
experiment 26 had come back tied. That's the one from [The agents had a
shell](./04-the-agents-had-a-shell.md) where three ways of answering a failed
hidden test all hit the ceiling. The agent's next offer was a new toy with a
hidden number in it, so the three ways would finally split. It was a good
experiment. It also had nothing to do with fabrika.

The agent's answer was honest:

> Both, and the last few steps drifted toward new ideas.

It sorted the day's work into three piles. Rebuilding fabrika: the lane that
survives a restart, parks with typed answers, the factory handing triage off to
the lane. New ideas: the test-first lane and criteria as data from [the last
post](./05-tests-decide.md). And a side quest: "Hidden tests are a measuring
tool for our toys, not part of fabrika. I shouldn't have offered another toy for
it."

Then I asked if we were almost done, and it said that depends on which finish
line. As proof that the loop can be code driven, nearly done. As a rebuild of
fabrika, "no, about a quarter."

That gap is what this post is about. About forty minutes later I said what I
wanted:

> yeah, before switching to the next thing, let's try to prove we can actually do each step fabrika counter part has

From that question to a ship step that landed a change in `main` took about
three hours and 12 commits. Experiments 27 to 33. Somewhere
in the middle I also gave the agent a rule that changed how it made every
decision after that, and I think that rule is the most useful thing in here.

## Which finish line?

Experiments are fun, and each one ends in a new question. That's the trap. The
hidden-number toy would have answered a real question, the answer would have
raised another one, and I'd have spent the night measuring the measuring tools.

What got me out wasn't "is this interesting". Everything was interesting. It
was "which thing are we doing", asked out loud, with two answers to pick from.
The agent couldn't pick for me. But once I asked, it could say plainly where
each pile stood, and an agent will happily follow you down a side road without
ever asking if you meant to take it.

## The map

Fabrika has six steps: report, triage, plan, build, review, ship. By that night
the repo had triage and build. Review and ship were the next two, and review was
the big one.

So I asked what fabrika's review actually does and how we'd model it. The agent
read the skill and came back with six steps. Sort the diff by kind. Read the
contract, which is the ticket's criteria plus any rulings an owner added later.
Grade each criterion with evidence. Look for extra problems. Check the builder's
list of what it changed beyond the ticket. Post a verdict.

Our tests already did the grading, and an earlier check already caught edits to
the locked test file. Within half an hour the lane also checked scope in code:
every changed file a criterion doesn't name has to be on the builder's list,
with a reason, or the work goes back. Each listed reason went to a small `Router`
service with one question, "does this change serve the ticket's goal?", and Jev
was its first plug-in. That's experiment 27. [Meeting Jev](./02-meeting-jev.md)
has its numbers: 30 of 36 right, 0 wrong, and the 6 unsure ones were the cases a
person would argue about too.

Then the agent said "next: ship", and I asked:

> ok, why are we stopping review and switching to this again? please share me your knowledge along the way so i can actually understand what's going on

It had called review done when only the half that code can check was done. It
said so ("That's misleading, sorry") and drew the map it should have drawn
first, one row per thing fabrika's review checks, and who decides it:

| Review part | Then | Who decides |
|---|---|---|
| Each criterion is met | built, the tests | code |
| No edits to the locked tests | built | code |
| No changes outside the ticket | built | code |
| An honest list of extra changes | built | code and the router |
| Tests green on the real commit | half, the tests run in the builder's folder | code |
| Extra problems a reader spots | not built | an agent |
| Comments and docs gone stale | not built | an agent |
| Owner comments that change a rule | not built | Jev reads, a person rules |

Four rows to go. That table ran the rest of the night. Every time something got
built, the row changed, and I could see what was left without asking.

## What the lane already had

Two of fabrika's pieces were already in the repo before the question, and they
carry the rest of this post.

**A lane that survives a restart.** [The first post](./01-v4.md) told the short
version of experiment 23: a real build killed with SIGINT five seconds after
Claude Code started, the same command run again, and the build picking up in
the same Claude conversation. Claude's own log holds both turns, the killed one
at 03:41:57 and the new one at 03:42:05.

The detail I like is where the conversation id comes from. The host makes it
before the build starts and hands it to the machine in the `start` message, so
the reducer stays pure and the saved state already holds the id when the kill
lands. One case the real run didn't reach: a kill before Claude has saved
anything, where the lane falls back from `--resume` to `--session-id`. Only the
unit tests cover that, and the unit tests are the part I'd copy.
`src/restart.test.ts` kills the lane after every single step, boots it from
what was saved, and checks it ends the same way.

**Parks with typed answers.** When the lane needs a person, it parks, and the
park says why, from a closed list. Each cause takes its own kind of answer, and
nothing else. Here is a slice of `ParkAnswers` in `src/lane.ts`:

```ts
/**
 * What a person may answer to each park, and nothing else. An answer that
 * does not fit the park the lane is in leaves it parked.
 */
export interface ParkAnswers {
  readonly contradiction:
    | { readonly kind: "keep"; readonly note: string }
    | { readonly kind: "fix"; readonly result: string }
    | Drop;
  readonly finding_disputed:
    | { readonly kind: "stands"; readonly note: string }
    | { readonly kind: "withdraw" }
    | Drop;
  readonly out_of_attempts: { readonly kind: "more"; readonly attempts: number } | Drop;
  // ...
}
```

The lane has twelve park causes today, and review, triage and ship each have
their own. That sounds like a lot. In practice it means "why is this stuck?" is
a field you read, and "what can I say to it?" is a type you look up. A person
can't answer `withdraw` to a lane that is out of attempts, because that answer
doesn't exist there.

## Review as a child machine

The next rows were the reading ones: extra problems, and comments gone stale.
Those need an agent. In fabrika, one reviewer agent does all of it in prose. It
finds problems, decides whether each one matters, and says pass or fail.

The plan split that job by who is best at each part. The agent only finds, and
every finding has to quote one line of the diff. Code checks the quote. The
router decides where each finding goes. The machine says pass or fail. The
agent's reason was one line I keep: "an agent that grades its own findings can
talk itself into a pass. Here it can't."

I didn't follow the "code checks the quote" part, so I asked how. It's three
plain lookups. Does the file exist in the change? Is that line exactly the
quoted text, ignoring spaces at the ends? Is that line part of the diff? A made
up quote gets thrown out. A real quote on a line the builder never touched gets
filed as a note, since it isn't this change's problem. The agent's picture was a
teacher checking a student's citations. She opens the book to page 12 and checks
the quote is there. That doesn't make the argument right. It only rules out
quotes that don't exist.

Whether the problem is real is a separate question, and the builder gets a say.
It can answer `dispute` to a finding, the same way it answers `contradiction` to
a wrong example, and the lane parks with both texts side by side.

All that was turning the lane into a big file, so I asked:

> should we have a separate "review" machine/

Yes. tea already had the answer, because it's the Elm answer: nested TEA. The
factory already held triage and the lane as children, so the lane could hold
review the same way. While it reviews, the lane's state has a `review` field
with the child's whole state in it. Review's messages go down to the child. When
the child ends, the lane reads how: passed is done, failed goes back to the
builder with the findings, and a park passes the person's answer down two
levels. In Elm that last part is called the OutMsg pattern. The child says "I'm
finished, here's the result", and the parent decides what happens next.

Being its own machine meant review could be tested with nothing but a diff, and
no builder at all. Then one more rule came from a side agent reading over our shoulders. A finding
was closed as soon as the reviewer said "fixed". That's the agent's word again.
So "fixed" now counts only if the file has changed since the finding was made.
Each finding carries a short fingerprint of its file, and code compares it.

## A reviewer that forgets

Experiment 28 ran it for real, with Claude as the reviewer and the duration toy,
the ticket with rules nobody wrote down. The second build passed every test, and
the reviewer found 4 things, every one quoting its line exactly:

- a bare number read as seconds
- decimals, where `"1.1h"` gives `3960.0000000000005`
- `Infinity` for a huge number
- units in upper case

The router called two of them related (0.87, 0.89) and was unsure about two
(0.76, 0.15), so review parked, and the answer was "file both unsure ones". The
builder fixed the `Infinity` one, rounded the decimals, and disputed the
decimals finding: "removing decimal support would break a required test". It was
right. Decimals are one of the hidden tests' rules. The answer was "withdraw".

So far every part did its job. No made up quotes, a dispute that stopped a
finding from breaking a test, and a "fixed" backed by a changed file.

Then the next round raised the same points again, in new words. Bare numbers
came back. "Goes beyond the issue" came back. It parked again.

A fresh reviewer starts from nothing each round. That's on purpose, so it reads
the change and not its own last opinion. But it also means it forgets what a
person already decided. Experiment 29 fixed that in two layers.

The first layer is telling it. The lane keeps every finding a person settled,
filed or withdrawn, and review hands them to the reviewer with "do not raise
these again, in any words".

The second layer is a net, in case telling isn't enough. Each new finding goes
to a `Matcher` before the router, with one question: does this make the same
point as one of these decided ones? Jev is the first plug-in again, with a floor
of 0.9. A sure match is settled already, so it isn't routed and can't park, but
it stays on the result as `matched` for a person to look at. Anything short of a
sure match is routed like any new finding.

The shape of that rule is the part to steal. A wrong match would let a real
finding through unseen. A missed match costs one more question to a person. So
the matcher only acts when it's sure, and everything else falls to the safe
side. The probe, 12 new findings against the decided ones, 3 times each:

| | Answers |
|---|---|
| Right | 28 of 36 |
| Missed a repeat, routed as new | 8 |
| Wrong match, passing unrouted | 0 |

The real bare-number repeat matched 3 of 3, at 0.98 to 0.99. The misses were
broad "goes beyond the issue" restatements and one "runs of spaces" against "two
spaces", at 0.64. All safe.

On a fresh duration run, the reviewer was told about both decisions and raised
neither, two rounds in a row. Memory worked.

Review still didn't finish. Round 4 found a new, real point: rounding hides
sub-second input, and a code comment says otherwise. The builder replaced the
rounding with 15 significant digits. Round 5 found another new, real point: 15
digits change exact large totals. The lane ran out of attempts twice, and the
agent stopped it there.

Every fix opened a smaller, real finding. Nobody was wrong. The reviewer just
kept looking, and there's always one more thing.

## The freeze, and its price

> freeze?

That was my whole message when the agent said fabrika had an answer for this.
Its picture was a teacher again. She grades your essay and asks for 3 fixes. You
make them. She finds 2 new things, then 1 more, and it never ends. A fair teacher
says, after a certain round, my list is locked. I'll check the fixes I asked for.
Anything new goes in a note for next time.

In fabrika, after a set number of review rounds, the list of findings is frozen.
Open findings still have to be fixed. New ones get filed and don't fail the
round.

The agent first told me the freeze came after round 2. Then, before writing
it, it checked fabrika's source, "so we copy it right and don't guess", and
corrected itself. Fabrika freezes on the last round the budget allows
(`CAP_ROUND` in its `retry-budget.ts`). Ours does the same, round 3 with the
default three attempts. In a frozen round nobody asks the matcher or the router
about new findings, because nothing they say could block anything. If the round
fails anyway, the builder sees the late ones marked "not required".

Experiment 30 ran it twice on duration. On the first run the freeze never came
up. Every finding was a rule the hidden tests require, a person filed all four,
and the lane was done in 2 attempts. On the second run, the builder answered
`blocked` on attempt 2, because the hidden tests want rules the ticket leaves
open. A person said build them. Round 3 was frozen: the review went straight to
done, no matcher, no router, no park, and both of that round's findings were
filed.

So the loop ends. Here's what that costs, on that exact run. One of the two
filed findings is a real bug. `"1h30"` reads as 1 hour and 30 seconds, 3630,
instead of 5400 or null. It didn't block. It's on the result, in the notes, and
a person has to read the notes to see it.

I don't love that. But the other choice is a lane that never ends, and the bug
isn't lost. It's written down in the place the person who approves the change
reads.

## Best practice over parity

The freeze came with a second fix. A person's answer to a park could send the
builder past its limit without anyone noticing, which is how the run in experiment 29
got to a fifth attempt. Now every answer that sends work back goes through the same
check, and parks once the tries are spent.

While doing that, the agent added a rule nobody had asked for. A side agent
flagged it:

> The main agent also added a rule nobody discussed. If a person says the builder was **right** (an example gets fixed, a finding gets withdrawn), the builder rebuilds on the **same try**.

The idea is fair. If the ticket had a wrong example, or the reviewer filed a
wrong finding, the builder shouldn't pay a try for it. With only three tries,
one bad example in the ticket could park a lane early on the next honest
mistake.

The agent recommended keeping it, at 65%. I asked:

> 65%?

It named three doubts. The try count would stop matching the real number of
builds, so "done in 2 tries" might have been 3 builds. No real run had needed
the rule yet. And "Fabrika doesn't do it", because fabrika's budget counts every
send-back. It offered a middle way for the first doubt: count builds apart from
tries, so the person sees "3 builds, 2 tries" and nothing is hidden. That went
in, in commit `153b8e7`, and its confidence went to 80%.

The third doubt is the one that stopped me. I wrote:

> what does "fabrika doesn't do this" mean? if you're trying to match today's fabrika 1:1, dont do that. this experiment can very much become what fabrika is tbh, so instead of backwards compatibility, for this experiment, always prioritize best practices. just let me know and explain the reasoning behind decisions as you go.

The agent's reply put it better than I did. It had been treating "different
from today's fabrika" as a risk, and that was the wrong lens. "From now on,
fabrika tells us which steps a pipeline needs. How each step works gets decided
on its merits, and I'll explain why each time."

With that doubt gone it was at 85% on the "builder was right" rule. Then it went
back to a choice it had copied from fabrika, the freeze on the last round, and
checked whether that one held up on its own. It does. A freeze any earlier lets more real bugs through
without blocking, and the last round is the latest point where the loop still
ends. Same choice as fabrika, kept for a reason this time, not for parity.

That's the rule I'd hand anyone rebuilding something that already works. Copy
which steps exist. The old system has learned the hard way that each one is
needed. Don't copy how each step works without asking why, because some of those
answers were the best a prompt could do, and code can do better. Then write the
reason down next to the choice, so the next person can redo the math.

## The owner changes their mind

Next row: owner comments. The person who filed the ticket leaves a comment
while the work is under way, something like "actually, `1h30` should return
null". A comment like that changes what "done" means, so the lane can't ignore
it.

While it was being built, I asked for something that wasn't on fabrika's list
at all:

> for this setup, iw anna approach any state as a pluggable interface (gh comments, etc) so that i can swap out gh comments with another interface when needed. does that make sense? it's not just comments, anything that fabrika reads externally should be behind a state (or a better name i dunno) effect service

That became the `Tracker` service: the ticket and its comments, behind one
interface. Its first plug-in is a folder with one JSON file per ticket, and you
leave a comment by editing the file. The machine is handed only a ticket id and
asks the tracker for the rest. GitHub becomes one more plug-in later, and the
machines won't know the difference. When the agent pointed out there was no
GitHub plug-in yet, I said "not having a github service is actually good".

The comment check runs once, right before the lane calls itself done. It never
interrupts a build. A comment left mid-build is read when that build is about to
finish. A `CommentReader` reads each comment against the ticket's rules: does it
change a rule, add one, or change nothing? Jev is the first plug-in. Only a sure
"changes nothing", at 0.9 or up, settles a comment on its own. Anything else
parks, with the comment and the rule it may change side by side.

It's the same shape as the matcher. The dangerous answer is "changes nothing"
on a comment that changes something, because then the lane ships the old
behaviour and nobody looks. So that's the one answer held to a high floor.
Experiment 31 asked about 16 comments, labelled by hand, 3 times each:

| | Answers |
|---|---|
| Right | 27 of 48 |
| "Changes nothing" on a comment that changes something | 0 |
| A harmless comment sent to a person | 3 |
| Unsure, sent to a person | 21 |

The 3 harmless ones were the same bare link, all three times, at 0.79 to 0.82. Every other harmless
comment was settled at 0.92 to 1.00, including agreement that names a rule
("Yes, 1h30m giving 5400 is exactly what I need", 0.97). Most asks for new
behaviour came back unsure. That's safe, since a person sees them, but 27 of 48
is a lot of questions for a person. The floor buys safety with their time.

The real run had two comments waiting on the duration ticket: "Thanks for
picking this up!" and "1h30 without the m ... should give null". The lane passed
review, read both, settled the thanks, and parked on the `1h30` one. A person
made it an example, the tests were rewritten, and the builder found the code
already returned null. Done, in 4 attempts and 6 builds.

A side agent caught a gap in that run. The ticket had no rule about bad input,
so the `1h30` example went under the hours-and-minutes rule, and an example
that returns null under a rule about returning seconds contradicts itself. In
the probe, 5 of the 16 comments asked for new behaviour, so this would come up
a lot. The park got a `rule` answer: the person writes a new rule with its
examples, and the ticket gains it.

None of the comment answers spend an attempt. The owner changing their mind is
not the builder's fault.

## A fresh copy

> yes, what's this?

That was me, when the agent said the next row was "clean-tree CI". It's running
the tests on a fresh copy of the change, not in the folder the builder worked
in. That folder can hold things git doesn't: an ignored file, something left
over from an earlier run. A change that passes only there would fail anywhere
else. The agent's picture: you cook a dish in your own kitchen and it works,
then a friend follows your recipe in an empty kitchen and it fails, because you
used something you never wrote down. (Fabrika doesn't trust local test runs at
all, for a reason [the first post](./01-v4.md) quotes: one "returned another
checkout's cached green three times in one session".)

Experiment 32 made it a step the machine owns. Once the tests pass, the
workspace commits the change without moving the branch (`git commit-tree` on
the index), checks that commit out into an empty folder (`git worktree add`),
copies the hidden tests in, and runs them there. A fail goes back to the builder
as "the tests pass in your folder but fail on a fresh copy". Only a change that
passed on a fresh copy reaches review, so a reviewer never spends a round on one
that can't work.

`local.test.ts` shows it on real git. It makes slugify depend on a file that
`.gitignore` names. The builder's folder passes, the fresh copy fails, and the
branch hasn't moved. No real builder has made that mistake on its own yet, so
this is proven on a planted case only.

Then a side agent found the hole that would have bitten first. A fresh copy has
no installed packages either, because they aren't in git. The toys need none,
so they passed, "and the step will look proven". On a real repo every change
would have failed there, and the builder would have been blamed and burned its
tries on something it couldn't fix. The workspace now takes an install command,
like `pnpm install --frozen-lockfile`, that runs in the fresh copy before the
tests. And an install that fails parks as `could_not_run` instead of going back
to the builder, because a failed install is more often the network than the
change.

That note is worth more than the step it fixed. A check that passes on toys can
pass for the wrong reason. The toys had no packages, so they couldn't show the
problem.

## Ship

Ship is the third machine, next to triage and the lane, and the factory starts
it when a lane is done. A `Repo` service does the git work, local git first. It
seals the change as one commit on top of where the work started and parks for a
person.

The person reads what the lane left on the record: attempts, builds, extra
changes, filed and withdrawn findings, settled comments, and the diff stat.
Then they approve by naming the commit. The answer type makes that the only way
in:

```ts
/** `approve` names the commit it approves; an answer naming any other leaves ship parked. */
readonly approve: { readonly kind: "approve"; readonly head: string } | Drop;
```

The comment at the top of `src/ship.ts` says the rest: "nothing lands without
it, and an agent never gives it". An approval is bound to one commit, so it
can't be spent on anything else.

What about a base that moved? Say someone else's work landed in `main` while
the person was reading. Ship merges the approved change with the new base
without touching any folder (`git merge-tree`), runs the merge on a fresh copy,
and lands it. A conflict, or tests that fail only on the merge, park for a
person. A retry merges the approved commit again, never an earlier merge.

A side agent flagged that the merge lands without a second approval. The agent
recommended keeping it, at 80%. The change the person approved didn't move,
only what it sits on, and that's how merge queues work: the tests run on the
merged result, and anything that breaks still stops for a person. I said
"sure".

`local.test.ts` runs all of that on real git: a plain landing, a base that
moved and merges clean, and a conflict that names the file and moves nothing.
`ship.test.ts` kills ship after every step of a moved-base landing, and it ends
the same. Then the demo took slugify from the ticket to `main`, stopping once,
for the approval.

Not built: the builder repairing a conflict (ship parks instead), a GitHub
`Repo`, and cleaning up the lane's folder after it lands.

## The scorecard

Ship went in at 00:25 with 117 tests passing. When I asked what was next, the
agent drew the map one more time, against all six of fabrika's steps:

| Fabrika step | State |
|---|---|
| Report | by hand only, a ticket file you write yourself |
| Triage | proven |
| Plan an epic into child issues | not built |
| Build | proven |
| Review | proven |
| Ship | proven, on local git |

Four of six, on two toys. I want to be plain about "proven" here. It means
each step ran with real Claude and real Jev on the toy tickets, or on real git,
and did what it should. It doesn't mean any of it has run on a real issue.

And the agent had already checked whether one could. It scanned the backlogs
read-only. demlik had 12 open issues and none of them fit the "call returns this
result" shape; the best partial fit was
[#504](https://github.com/kamp-us/demlik/issues/504), with 3 of its 8 rules as
calls with exact results. phoenix had 300 open, and 1 fit fully. That's the
[last post's](./05-tests-decide.md) "most real criteria don't fit" again, now as
the thing standing between the rebuild and real work. The next step it
recommended was a dry run on that one phoenix issue, posting nothing to GitHub.

So it's a quarter of the way no longer. It's most of the way on toys, and not
yet started on the real thing. I'm fine with that. It's the order I'd pick
again: prove the shape where the answers are known, then pay for the mess.

## What I'd steal

If you're rebuilding an agent pipeline, or building one, here's what I'd take
from those three hours.

**Ask which finish line you're on, and keep a map.** Out loud, every so often,
with two answers to pick from. Make the agent say how far along each one is.
Then keep one row per thing the old system does, and who decides it now. It
caught "review is done" the moment it was wrong.

**Copy which steps exist, decide how each works on its merits.** The old system
learned the hard way that each step is needed. How it does each step is open.
Write the reason next to every choice, including the ones you kept.

**Split a judging agent into parts.** The agent finds. Code checks every quote
is real. A narrow router sorts where each finding goes. The machine says pass or
fail. A person decides what the router is unsure about. Each part can be tested
alone, and none can pass something it didn't see.

**Point every small-model check at the safe side.** The matcher and the comment
reader both act alone only on a sure answer, and only in the direction where
being wrong costs a question, not a pass. 0 wrong matches in 36, 0 dangerous
comment readings in 48.

**Stop the loop on purpose, and make the price visible.** A reviewer will always
find one more thing. Freeze late, file what comes after, and put it where the
approver reads.

**Don't charge the builder for someone else's mistake, and don't hide that you
didn't.** Give the try back when the builder was right, and count builds apart
from tries.

**Bind an approval to one commit.** Not to a branch, a PR or a lane. A name
that can't be reused.

**Put every outside read behind a service.** Tickets, comments, git. The first
plug-in can be a folder of files, and the machine never knows.

**Be suspicious of a step that passed on toys.** The fresh copy looked proven
because the toys had no packages. Ask what the toy can't show.

## Still open

The question I have now is the one the scorecard ends on. Every step works on
a ticket I wrote, in a folder I made. The first real issue will have packages,
a slow install, a big codebase, and rules that aren't a call and a result. I
don't know yet which step breaks first. I do know where to look when it does,
because it will stop in a state with a name.

Next: [Cheap enough to read everything](./07-cheap-enough-to-read-everything.md),
where I told the agent it was being too careful with Jev.

