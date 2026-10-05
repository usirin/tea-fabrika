# Working with the agent, not through it

> Draft, still being written. Sections land as they read well.

Six times in eleven hours, the agent I was working with forgot most of what
we'd said.

That's what compaction does. When a conversation with Claude Code gets too
long, it gets squeezed into a summary and the agent starts over from that.
Between 1:49 p.m. on October 4 and 12:53 a.m. the next night it happened six
times. Every time, the agent came back knowing how I wanted to work. It still
gave me short answers, one question at a time, with a confidence number on
every recommendation. It still sent the heavy reading to helpers and still
wouldn't approve its own work.

None of that was luck. Each of those habits is written down somewhere the
agent reads at the start of every session, and most of them got written down
because something went wrong first.

The other posts in this series are about what we built. This one is about how
the two days were run: the rules I gave the agent, the moments it broke them,
and the two times the written rules were wrong. If you work with an agent for
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
