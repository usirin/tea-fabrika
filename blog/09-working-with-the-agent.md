# Working with the agent, not through it

Six times in eleven hours, the agent I was working with forgot most of what
we'd said.

That's compaction. When a Claude Code conversation gets too long, it's
squeezed into a summary and the agent carries on from that. Between 1:49 p.m.
on October 4 and 12:53 a.m. the next night it happened six times. Each time
the agent came back working the way I wanted: short answers, one question at a
time, a confidence number on every recommendation.

That wasn't luck. Every one of those habits is written down somewhere the
agent reads when a session starts. Most of them got written down because
something went wrong first.

The rest of this series is about what we built. This post is about how the two
days were run: the rules I started with, the moments they broke, and the one
time a written note was the thing that was wrong. If you work with an agent
for more than an hour at a time, this is the part you can copy tomorrow.

## The rules I started with

Some rules are older than this project. My setup tells every agent the same
few things. Talk to me like a coworker. Short sentences, everyday words, a few
lines per message. One question at a time, shaped so I can answer yes or no.
And every recommendation comes with a short why, the tradeoff, and a
confidence score.

The last one mattered most. Here's what it looked like on the first afternoon,
when the agent wanted a hard rule for tests written before the code exists:

> I'd make it a hard rule for visible tests and skip it for hidden ones, at about 75% confidence.
>
> - **Why:** when I told the test-writer about it, 0 of 48 tests passed on the untouched code, so the rule costs almost nothing and throws out empty tests for free.
> - **Tradeoff:** a criterion that is already true in the code can never get a failing test, so that lane would get stuck.
>
> Hard rule for visible tests, yes?

A pick, a number, the price, and a question I can answer in one word. I don't
need to read the whole plan to know where to push.

Written rules still wear down. Late that first night the answers had grown
long again, and I asked the agent to drop back to short, plain coworker
replies. The rule had been in the file all along, and the agent had read it at
the start. Long sessions wear rules down, and you'll have to repeat them.
That's fine. It took one line, and it worked.

## The other 25 percent

The agent's confidence number isn't the same kind of number as the others in
this series. When Jev, the small classifier from
[post 2](./02-meeting-jev.md), says 0.8, we can check that against known
answers, and we did: at 0.8 and up it was right 218 times out of 221. When the
agent says "about 75%", nobody has checked anything. It's the agent's guess
about its own plan.

So I didn't treat it as a probability. I treated it as a handle. A contractor
says the job takes about two weeks. You don't argue with the two. You ask what
would make it three. With the agent the question was always the same: what's
in the other 25%?

I asked some form of that six times over the two days, and the answers were the
most useful part of the whole workflow:

| The number | About | What came next |
|---|---|---|
| 75% | the hard rule above | three doubts named, rule kept with a stop for "already true" |
| 75% | letting code do two of Jev's three questions | experiment 18, and its confidence fell to about 40% |
| 70% | writing criteria as data | experiment 19: only 36 of 130 real criteria fit |
| 65% | catching a wrong example | experiment 20: caught 20 of 20 with clear rules |
| 65% | sending a failed hidden test back to the ticket | experiment 26: all three ways tied, 20 of 20 |
| 65% | not charging a try when the builder was right | a change that took it to 80%, then 85% |

The second row is my favourite, because the number went the wrong way. The
agent had split one big Jev question into three small ones, the results looked
great, and it wanted to build on them at 75%. I pushed on the number. It
listed four doubts. The first: it had tuned the questions on the same saved
tests it then scored them on, "like a teacher grading with the answer key they
wrote the exam from". The third was worse. One of the three questions had
never been asked, not once, and the whole design rested on it.

I told it to go raise the number. It measured that question on 251 examples,
with the right answers worked out by running code. Jev rated
`parseDuration("1.5h")` returning `4500` at 0.89. The right answer is 5400.
Jev can't do sums, and the design needed it to. The agent came back with its
confidence down, not up, at about 40%.
[Post 3](./03-a-judge-that-cannot-add.md) has that experiment in full. What
matters here is that one short question stopped us building on a hole.

After the sixth time I made it a rule. Under 80%, the agent says what's
holding the number down and offers the cheapest check that would move it. It
does that now without being asked. Usually the check is an experiment. At
least four of the 37 in the log started as a percentage I didn't quite buy.

## A question is not an order

On the first evening the agent was changing four or five spots across several
files at once. It did that with Python scripts in the shell (find this string,
replace it with that one) instead of its own edit tools. I noticed and asked
why, half joking.

The agent saved a new rule to its memory, "always use Edit and Write", and
kept going. I'd only wanted the reason, so I said that.

It's small, and it's the most common way I see agents go wrong with me. A
question gets read as a polite order. The agent's next reply was the one I'd
wanted the first time:

> The honest why: it was a shortcut. Some changes touched four or five spots across several files, and one script felt faster than many separate Edit calls. It wasn't a deliberate choice, and the downsides I listed are real.

Then it asked whether to keep the rule. I kept it, because the reasons hold up
once you say them. An edit made with the edit tool shows up as a diff I can
read. If the text it looks for isn't there, the edit fails loudly. A Python
replace that doesn't match does nothing, and nothing tells you. A few saved
calls aren't worth that.

But I kept it after hearing the why, and that's the order I want. A "why" from
me means I want the reason. When I want a change I say so plainly, and I do
that often, so the agent never has to guess.
[Post 8](./08-the-twenty-dollar-lesson.md) has the other side of this: when I
asked why a run cost $20, the agent took it as a question and gave me an
honest answer instead of a defence.

## The main thread keeps the decisions

Just before 1 a.m. I asked the agent to send context-heavy work to subagents.

It had been building Jev probes right in our conversation: dozens of file
reads, scripts, outputs, edits. All of that shared a context with our
decisions, and all of it got squeezed out at the next compaction, which came
about a minute later.

A subagent is a second agent the main one starts for a single job. It gets a
short brief, does the reading and building in its own context, and hands back
a report. The main agent only sees the report. Picture a lead who sends
someone to the archive. The lead doesn't read every box, just what was found.

The numbers show the change. In the eleven hours before that, the agent started
9 subagents: two research jobs on how people use Jev, two maps of fabrika's
skills, two backlog scans and a few others. In the hour after, it started 6.
The typed config, moving every knob into it, the missing-file check in review,
the duplicate probe and two more all went out as briefs, and most came back as
a short report and a commit hash. The main thread kept three jobs: deciding,
asking me the one question, and telling me what happened.

The rule that makes it work: a subagent does the work, the main thread makes
the call. A subagent can recommend a floor of 0.7 for the duplicate check.
Whether that becomes the floor goes through the main thread and, when it
matters, through me.

## A second reader over the shoulder

The other kind of helper did no work at all. It read along.

Seven times over the two days, a note from a side agent landed in the
conversation. It wasn't building anything. It was reading what the main agent
did and what it said, looking for the gap between the two. Every note had the
same shape: a "Heads up" line with a short title, a few bullets of facts, and
usually one bold line saying what to do. This one came just after midnight:

> Heads up · The new fresh-copy test run never installs packages, so on a real repo every change would fail it and the builder would be blamed.

The toy tickets needed no packages, so the new step passed every test we had
and looked proven. On a real repo it would fail every time, and the builder
would burn its tries on something it couldn't fix.
[Post 6](./06-rebuilding-fabrika-step-by-step.md) has the rest of that one.

The other six were the same kind of catch. A run reported as testing my idea
had tested something narrower. A label we'd measured as harmful had gone into
the real demo anyway. A "0 wrong" result came from examples the agent could
copy. A rule nobody had discussed slipped in with a bug fix. Two more pointed
at a park with no answer for a case that was sure to come up. None was a hard
bug. Most were the main agent believing its own summary.

That's why a second reader works, and it's why I'm bad at proofreading my own
posts. The writer knows what they meant, so that's what they read. A reader
who only has the page reads what's on it. An agent that just ran an experiment
has the same blind spot about its own report.

## Nobody approves their own work

On the first afternoon I had the agent file a problem we'd found in tea, the
library my brother built and this whole project builds on. It filed
[kamp-us/demlik#576](https://github.com/kamp-us/demlik/issues/576), and a
triager agent got it ready to build. One thing was missing before anyone could
build it: a pitch approval, a short comment saying a person agreed to spend
the time. The agent stopped there:

> It's blocked on you. The pitch needs your approval, and an agent must not post that.

I told it to post the approval for me, and it did. Its reply opened with
"Posted on your say-so". That's the part I care about. The words went up under
my account through the agent's hands, but the decision was mine, and the
record says so.

The same rule runs through the machine we built, and that's no coincidence.
The builder doesn't write the tests it's graded on. The hidden tests come from
an agent that never sees the builder's code. Review is a different agent from
the build. Ship waits for a person to approve one named commit, and the
experiment log says it plainly: "An approval naming any other commit changes
nothing, and an agent never gives one." How I want to work with an agent and
how I want the pipeline to work turned out to be one idea. Nobody grades their
own exam.

## Best practice over parity

One rule came from a doubt that shouldn't have been a doubt. The agent was at
65% on a change, and one of its reasons was that today's fabrika doesn't do it
that way. I told it to stop copying fabrika one for one, pick best practice,
and explain the reasoning behind each choice as it went.
[Post 6](./06-rebuilding-fabrika-step-by-step.md) tells that part.

For working with agents, the second half is the useful one. If every choice
comes with a reason, I can check the reason. When the reason is "the old
system did it", I see that at once, and it's usually not a reason.

## Fast is not rushed

At 1:51 a.m. I was about to sleep, and I asked for the first two posts of this
series so I could read them in bed, pushed as they were written.

A subagent was already studying how I write, so the posts would sound like
me. The main agent saw the short time window and started a message to it:
push the voice guide and the plan within three minutes, rough or not, so two
writers could start before the guide was done.

I rejected that message before it went out. I wanted to watch the work
happen, not have it skip the part that makes it good. So this rule wasn't set
ahead of time. The agent broke it first, and it got written down after.

The agent's next message got it right. It said it wouldn't cut corners to hit
a time, that the voice guide would be finished properly first, and that
realistically it was 20 to 30 minutes away, so maybe not tonight. It was
faster than that. The first post went up section by section from 2:01, and
both were done by 2:07, 16 minutes after I asked. Six minutes over, with the
voice study kept in.

This post went up the same way, a section at a time with a draft note on top.
A time limit should change how often you show your work, not which steps you
skip.

## The note said private

The voice study had one more surprise in it.

At 2:09 p.m. on the first day, I'd asked for two things in one message: put
the experiment log in the repo instead of the agent's memory, and make the
repo public, since there was no reason to keep it private.

The log went into the repo two minutes later, and most of the numbers in this
series come from it. The second half didn't make it into the agent's notes.
Its project note kept calling the repo private, and the brief the voice
subagent got that night said private too.

The subagent checked anyway. It listed my repos with `gh` and saw that
`tea-fabrika` was public. A few minutes later it tried to write the voice
guide into `blog/`, and Claude Code's permission check refused, because some
of what the guide was built from wasn't meant for a public repo. The subagent
didn't look for another way in. It saved the files in a local folder outside
the repo and reported back that it hadn't committed, and why.

I agreed: publish the posts, keep the guide local. That's why this repo has
the posts and not the guide behind them.

Two things went right, and both are worth copying. The subagent checked the
world instead of trusting the note. And when it was refused, it stopped and
asked instead of hunting for a gap. The thing that went wrong is the lesson,
though. A note written to help the agent remember was the reason it almost did
the wrong thing. Memory lasts across sessions. So does a wrong fact in it.

## Written down so it lasts

So where do these rules live? Claude Code keeps a folder of short memory notes
per project, plus an index with one line per note. The index loads at the
start of every session, and the agent opens a note when its line matches what
it's doing. Most notes have three parts: the rule, why, and how to apply it.

Over the two days, eleven notes were written or changed: explain new ideas
with one small example and an everyday picture, raise low confidence, best
practice over parity, use the edit tools, send heavy work to subagents, test
every claim as far as it needs, fast is not rushed, size a Jev run before
starting it, the project's state, and two more. Most came from a moment like
the ones above, and keep the reason from that moment as their why.

Compaction is where the notes earn their keep. Before most of the six, I told
the agent to get ready for one, and it did the same things each time: update
the project note with where we were and what was open, and make sure the repo
was pushed. It's a shift change at a hospital. The nurse going home writes the
handover, so the next one doesn't start from the chart alone. The summary
then only has to carry the conversation. Decisions are in the notes, results
are in the repo.

The experiment log is the other half. It's 1,330 lines now, and its second
paragraph is the rule I'd copy first:

> Guesses that turned out wrong are left in on purpose.

A memory note gets rewritten when the rule changes. The log only grows. When
we got something wrong, like the agents that could read the hidden tests in
[post 4](./04-the-agents-had-a-shell.md), the correction went in as its own
section. The old lines stayed, and a line at the top says to read the
correction first. Someone reading it cold can see what we believed and when we
stopped.

One limit, and [post 8](./08-the-twenty-dollar-lesson.md) is about it: a
memory note is still a prompt. The agent is asked to follow it. What stopped
the write to the public repo wasn't a note. It was a permission check, and a
subagent that asked `gh` instead of its notes. The $5 Jev budget isn't a note
either. It lives in the helper every probe goes through. Notes are where a
rule starts. The ones that really matter end up in code.

## What I'd steal

**Ask for a confidence number, then ask about the rest.** The number is the
agent's guess, not a measurement. Use it as a handle: asking what's in the
other 25% gets you the doubts as a list.

**Under 80%, ask what would raise it.** Usually it's a small experiment. Run
it. Sometimes the number goes down, and that's the experiment paying for
itself.

**Keep questions as questions.** Tell the agent that "why" means you want the
reason, and say so plainly when you want a change.

**The main thread decides, helpers read.** Send the reading, the probes and
the multi-file builds to subagents. Keep the main conversation for choices and
the one question you need answered.

**Put a second reader on the main agent.** A short note in a fixed shape: one
line, the facts, one thing to do. It catches the gap between what the agent
did and what it says it did.

**Nobody approves their own work.** Not the builder, and not the agent posting
for you. When the agent acts on your say-so, it should say so.

**A deadline changes how often you push.** It doesn't change what you skip.

**Write each rule down with its why, and check facts against the world.** The
why lets the agent apply the rule to a case you didn't think of. Checking the
world catches the note that went stale.

## What I'm still curious about

Most of these rules are prompts. They held for two days because I was there to
push on a number when I needed to, and to reject one message at 1:51 a.m. I'm
not sure yet which of them should become code, the way the dollar budget did.
"Edit only with the edit tools" could probably be a permission rule. "Ask what
would raise it" maybe can't. I'd like to find the line between those two.

Next: [Knobs in a file, systems with SDKs](./10-knobs-in-a-file.md), where the
numbers I kept asking about end up in one file you can edit.
