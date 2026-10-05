# Working with the agent, not through it

Six times in eleven hours, the agent I was working with forgot most of what
we'd said.

That's what compaction does. When a conversation with Claude Code gets too
long, it gets squeezed into a summary and the agent starts over from that.
Between 1:49 p.m. on October 4 and 12:53 a.m. the next night it happened six
times. Every time, the agent came back still working the way I'd asked: short
answers, one question at a time, a confidence number on every recommendation.

None of that was luck. Each of those habits is written down somewhere the
agent reads at the start of every session, and most of them got written down
because something went wrong first.

The other posts in this series are about what we built. This one is about how
the two days were run: the rules I gave the agent, the moments it broke them,
and the time a written note was the thing that was wrong. If you work with an agent for
more than an hour at a time, I think this is the part you can copy tomorrow.

## The rules I started with

A few of the rules were older than this project. My setup tells every agent
the same things. Talk to me like a coworker. Short sentences and everyday
words. A few lines per message at most. One question at a time, shaped so I
can answer yes or no. And every recommendation comes with a short why, the
tradeoff, and a confidence score.

That last one turned out to matter most. Here's what it looks like in
practice, from the first afternoon. The agent wanted a hard rule for the
tests an agent writes before the code exists:

> I'd make it a hard rule for visible tests and skip it for hidden ones, at about 75% confidence.
>
> - **Why:** when I told the test-writer about it, 0 of 48 tests passed on the untouched code, so the rule costs almost nothing and throws out empty tests for free.
> - **Tradeoff:** a criterion that is already true in the code can never get a failing test, so that lane would get stuck.
>
> Hard rule for visible tests, yes?

A recommendation, a number behind it, the price, and a question I can answer
with one word. I don't have to read the whole plan to know where to push.

Written rules still drift. Late on the first night, after a run of long
answers, I sent this:

> explain "builder was right" to me please. also you started to put so much text with each message again. let's go back to plain explanatory coworker friend mode please.

The rule was in the file the whole time. The agent had read it at the start of
the session. Long sessions wear rules down, and you'll have to say them again.
That's fine. It's one line, and it worked.

## "75% sus?"

A confidence number from an agent is not the same kind of number as the ones
in the rest of this series. When Jev, the small classifier from
[post 2](./02-meeting-jev.md), says 0.8, we can check that against known
answers, and we did: at 0.8 and up it was right 218 times out of 221. When the
agent says "about 75%", nobody has checked anything. It's the agent's own
guess about its own plan.

So I didn't use the number as a probability. I used it as a handle. Think of a
contractor who says the job will take "about two weeks". You don't argue with
the two. You ask what would make it three. With the agent, the question was
always the same: what's in the other 25%?

I asked that six times over the two days, and the answers were the most useful
part of the whole workflow:

| I asked | About | What came next |
|---|---|---|
| "why 75%?" | the hard rule above | three doubts named, rule kept with a stop for "already true" |
| "75% sus?" | letting code do two of Jev's three questions | experiment 18, and its confidence fell to about 40% |
| "70%?" | writing criteria as data | experiment 19: only 36 of 130 real criteria fit |
| "why 65%? how do we increase that?" | catching a wrong example | experiment 20: caught 20 of 20 with clear rules |
| "65%?" | sending a failed hidden test back to the ticket | experiment 26: all three ways tied, 20 of 20 |
| "65%?" | not charging a try when the builder was right | a change that took it to 80%, then 85% |

The second row is my favourite, because the number went the wrong way. The
agent had split one big question to Jev into three small ones, and the results
looked great. It recommended building on it at 75%. I asked "75% sus?", and it
listed four doubts. The first was that it had tuned the questions on the same
saved tests it then scored them on, "like a teacher grading with the answer key
they wrote the exam from". The third was worse. The last of the three
questions had never been asked even once, and the whole design rested on it.
So I wrote:

> yup, let's get your confidence to upper numbers.

It measured that question on 251 examples, with the right answers worked out
by running code. Jev rated `parseDuration("1.5h")` returning `4500` at 0.89.
The right answer is 5400. Jev can't do sums, and the design needed it to. The
agent came back with "My confidence went down, not up", and put itself at
about 40%. [Post 3](./03-a-judge-that-cannot-add.md) has that experiment in
full. What matters here is that a two-word question stopped us building on a
hole.

After the sixth one I turned it into a rule:

> yes, always look for opportunities to increase your confidnce level when it's below 80%

Now the agent does it without being asked. Under 80%, it says what holds the
number down and offers the cheapest check that would move it. Most of the time
that check is an experiment. At least four of the 37 in the log started as a
percentage with a question mark after it.

## A question is not an order

On the first evening the agent was changing code in four or five places across
several files at once. It did that with Python scripts run through the shell,
find this string, replace it with that one, instead of its own edit tools. I
noticed and asked why, half joking, with a smiley at the end.

The agent saved a new rule to its memory, "always use Edit and Write", and
carried on. I wrote back:

> i asked why, you took it as "do it"

It's a small thing, and it's the most common way I see agents go wrong with
me. A question gets read as a polite order. The agent's next reply was the one
I'd wanted the first time:

> The honest why: it was a shortcut. Some changes touched four or five spots across several files, and one script felt faster than many separate Edit calls. It wasn't a deliberate choice, and the downsides I listed are real.

Then it asked whether to keep the rule or delete it. I kept it, because the
reasons hold up once you say them out loud. An edit made with the edit tool
shows up as a diff I can read. If the text it's looking for isn't there, the
edit fails loudly. A Python replace that doesn't match does nothing, and
nothing tells you. Saving a few calls isn't worth that.

But I kept it after hearing the why, and that's the order I want. If I ask
"why", I want the reason. If I want a change, I'll say "do it", and I say that
a lot, so the agent never has to guess. [Post 8](./08-the-twenty-dollar-lesson.md)
has the other side of this. When I asked why a run had cost $20, the agent took
it as a question and gave me an honest answer instead of a defence.

## The main thread keeps the decisions

Just before 1 a.m. I sent one line:

> for the context heavy work use subagents.

The agent had been building Jev probes right in our conversation: dozens of
file reads, scripts, outputs, edits. All of that sat in the same context as
our decisions, and all of it got squeezed out at the next compaction, which
came about a minute later.

A subagent is a second agent the main one starts for a single job. It gets a
short brief, does the reading and the building in its own context, and hands
back a report. The main agent only sees the report. The picture I use is a
lead who sends someone to the archive. The lead doesn't need to read every
box, just what was found.

The numbers show the change. In the eleven hours before that line, the agent
started 9 subagents: two deep research jobs on how people use Jev, two maps of
fabrika's skills, two backlog scans and a few others. In the one hour after
it, it started 6. The typed config, the move of every knob into it, the
missing-file check in review, the duplicate probe and two more all went out as
briefs. Most came back as a short report and a commit hash. The main thread kept
three jobs: deciding, asking me the one question, and telling me what
happened.

The rule that makes this work is that a subagent does the work and the main
thread makes the call. A subagent can recommend a floor of 0.7 for the
duplicate check. Whether that becomes the floor goes through the main thread
and, when it matters, through me.

## A second reader over the shoulder

The other kind of helper didn't do any work at all. It read along.

Seven times over the two days, a note from a side agent landed in the
conversation. It wasn't working on anything. It was reading what the main
agent did and said, looking for the gap between the two. The notes had the
same shape: one line that starts with "Heads up", a short title, a few bullets
with the facts, and usually one bold line saying what to do. Here's the one
from just after midnight:

> Heads up · The new fresh-copy test run never installs packages, so on a real repo every change would fail it and the builder would be blamed.

The toy tickets needed no packages, so the new step would have passed every
test we had and looked proven. On a real repo it would fail every time, and
the builder would burn its tries on something it couldn't fix.
[Post 6](./06-rebuilding-fabrika-step-by-step.md) has the rest of that one.

The other six were the same kind of catch. A run reported as testing my idea
had tested something narrower. A label we'd measured as harmful had gone into
the real demo anyway. A "0 wrong" result came from examples the agent could
copy. A rule nobody had discussed had slipped in with a bug fix. Two more
pointed at a park with no answer for a case that was sure to come up. The earlier posts
tell most of these. None of them was a hard bug. Most were the main agent
believing its own summary.

That's why a second reader works, and it's the same reason I don't proofread
my own posts well. The writer knows what they meant, so they read that. A
reader who only sees what's on the page reads what's there. An agent that just
ran an experiment has the same blind spot about its own report.

## Nobody approves their own work

On the first afternoon I asked the agent to file a problem we'd found in tea.
It filed
[kamp-us/demlik#576](https://github.com/kamp-us/demlik/issues/576), and a
triager agent got it ready to build. The issue
needed one more thing before anyone could build it: a pitch approval, a short
comment that says I've agreed to spend the time. The agent stopped there:

> It's blocked on you. The pitch needs your approval, and an agent must not post that.

I told it to post the comment for me, and it did. Its reply opened with
"Posted on your say-so". That's the line I care about. The words went up under
my account through the agent's hands, but the decision was mine, and the
record says so.

The same rule runs all through the machine we built, and that's not a
coincidence. The builder doesn't write the tests it's graded on. The hidden
tests come from an agent that never sees the builder's code. Review is a
different agent from the build. Ship waits for a person to approve one named
commit, and the experiment log says it plainly: "An approval naming any other
commit changes nothing, and an agent never gives one." The way I want to work with
an agent and the way I want the pipeline to work turned out to be the same
idea. Nobody grades their own exam.

## Best practice over parity

One rule came from a doubt that shouldn't have been a doubt. The agent was at
65% on a change, and one of its reasons was that today's fabrika doesn't do it
that way. I told it to stop matching fabrika one for one and to pick best
practice, and to explain the reasoning for each choice as it went.
[Post 6](./06-rebuilding-fabrika-step-by-step.md) has the whole exchange.

For working with agents, the useful part is the second half of that message.
"Explain the reasoning as you go" means every choice comes to me with a
reason I can check. When a reason is "the old system did it", I can see that
right away, and it's usually not a reason.

## "asap doesnt mean rushed!"

At 1:51 a.m. I was about to go to sleep, and I asked for the first two posts
of this series:

> i wanna read the first 2 blog posts from my bed before i sleep in 10 mins please. so push as you write.

A subagent was already studying how I write, so the posts would sound like me.
The main agent read "10 mins" and started a message to it: push the voice guide
and the plan "within the next 3 minutes with what you have, even if rough".
Two writers would start right away, before the guide was done.

I rejected that message before it went out, and typed:

> asap doesnt mean rushed!

So I didn't set that rule ahead of time. The agent broke it first, and the
rule got written down after. What I'd meant by "push as you write" was: let me
watch it happen. Not: skip the part that makes it good.

The agent's next message got it right. "I won't cut corners to hit a time. The
voice guide gets finished properly before any post is written." Then it gave
me an honest time, 20 to 30 minutes, "so maybe not tonight". It was faster
than that in the end. The first post went up section by section from 2:01, and
both were done by 2:07, 16 minutes after I asked. Six minutes late, and with
the voice study kept in.

This post went up the same way, a section at a time with a draft note at the
top. A time limit should change how often you show your work, not which
steps you skip.

## The notes said private

The voice study had one more surprise in it.

At 2:09 p.m. on the first day, I'd written:

> btw, we gotta document our experiment somewhere, it shouldnt just live in your memory. let's add a markdown file somewhere, and i am actually gonna make this repo public, no reason for it to be private.

The experiment log went into the repo two minutes later, and it's where most
of the numbers in this series come from. The second half of that message didn't
make it into the agent's notes. Its project note kept calling the repo
private, and the brief the voice subagent got that night said "his private
repo" too.

The subagent checked anyway. It listed my repos with `gh` and saw that
`tea-fabrika` was public. A few minutes later it tried to write the voice guide
into `blog/`, and Claude Code's permission check refused the write, pointing
at where the guide's content came from. The guide was built partly from my
private notes, and the repo was public. The subagent didn't try another way
in. It saved both files in a private folder
outside the repo and reported back:

> Not committed. Writing blog/VOICE.md into tea-fabrika was blocked: the repo is PUBLIC (`gh` says so; the brief and memory say private), and the guide draws on his private vault and chat. I did not retry that or look for another way in.

I read it and answered with one line: "yup, publish the posts, keep voice
guide local". That's why this repo has the posts and not the guide behind
them.

Two things went right there, and both are worth copying. The subagent checked
the world instead of trusting the note. And when it was refused, it stopped
and asked instead of looking for a gap. The thing that went wrong is the
lesson, though. A note written to help the agent remember was the reason it
was about to do the wrong thing. Memory lasts across sessions. So does a wrong
fact in it.

## Written down so it lasts

So where do these rules live? Claude Code keeps a folder of short memory notes
for each project, plus an index file with one line per note. The index is
loaded at the start of every session, and the agent opens a note when its line
matches what it's doing. Most notes have the same three parts: the rule, why,
and how to apply it.

Over these two days, eleven of those notes were written or changed: explain
new ideas with one small example and an everyday picture, raise low
confidence, best practice over parity, use the edit tools, send heavy work to
subagents, test every claim as far as it needs, asap is not rushed, size a Jev
run before starting it, the project's state, and two more. Most came from a
moment like the ones above, and carry my words from that moment as their why.

Compaction is where the notes earn their place. Before most of the six, I sent
"prep for compaction", and the agent did the same things each time: update
the project note with where we were and what was open, and make sure the repo
was pushed. It's a shift
change at a hospital. The nurse going home writes the handover, so the next
one doesn't start from the patient's chart alone. Then the summary only has to
carry the conversation. The decisions are in the notes and the results are in
the repo.

The experiment log is the other half of that. It's 1,330 lines now, and its
second paragraph is the rule I'd copy first:

> Guesses that turned out wrong are left in on purpose.

A memory note gets rewritten when the rule changes. The log only grows. When we
got something wrong, like the agents that could read the hidden tests in
[post 4](./04-the-agents-had-a-shell.md), the correction went in as its own
section. The old lines stayed, and a line at the top of the log says to read
the correction first. Someone reading it
cold can see what we believed and when we stopped believing it.

One limit, and [post 8](./08-the-twenty-dollar-lesson.md) is about it: a
memory note is still a prompt. It's something the agent is asked to follow.
What stopped the write to the public repo wasn't a note. It was a permission
check, and a subagent that asked `gh` instead of its notes. The $5 budget on Jev isn't a
note either. It's in the helper every probe goes through. Notes are where a
rule starts. The ones that really matter end up in code.

## What I'd steal

**Ask for a confidence number, then ask about the rest.** The number is the
agent's guess, not a measurement. Use it as a handle: "what's in the other
25%?" gets you the doubts in a list.

**Under 80%, ask what would raise it.** Usually it's a small experiment. Run
it. Sometimes the number goes down, and that's the experiment paying for
itself.

**Keep questions as questions.** Tell the agent that "why" means you want the
reason, and say "do it" when you mean it.

**The main thread decides, helpers read.** Send the reading, the probes and
the multi-file builds to subagents. Keep the main conversation for choices and
for the one question you need answered.

**Put a second reader on the main agent.** A short note in a fixed shape, one
line, the facts, one thing to do. It catches the gap between what the agent
did and what it says it did.

**Nobody approves their own work.** Not the builder, not the agent posting for
you. When the agent acts on your say-so, it should say so.

**A deadline changes how often you push.** It doesn't change what you skip.

**Write each rule down with its why, and check facts against the world.** The
why lets the agent apply the rule to a case you didn't think of. Checking the
world catches the note that went stale.

## What I'm still curious about

Most of these rules are prompts. They worked for two days because I was there
to say "75% sus?" when I needed to, and to reject one message at 1:51 a.m. I'm
not sure yet which of them should become code, the way the dollar budget did.
"Edit only with the edit tools" could probably be a permission rule. "Ask what
would raise it" maybe can't. I'd like to find the line between the two.

Next: [Knobs in a file, systems with SDKs](./10-knobs-in-a-file.md), where the
numbers I kept asking about end up in one file you can edit.
