# The twenty dollar lesson

36,171 calls to Jev cost about $20. Later that night, 35,374 calls to the same
model cost about 60 cents.

Same model, same price, almost the same number of calls. What changed was
what each call carried. This post is about the $20: how an agent working for
me spent most of it re-learning something it already knew, why its estimate
said sixty cents, and the four rules we took from that night. It's a small
sum. The rules are worth a lot more.

[The last post](./07-cheap-enough-to-read-everything.md) is about what
happened when we stopped rationing Jev and let it read whole files. This one
is the bill.

## A little before 1 a.m.

The run that cost the money was the missing-file probe at its biggest. Post 7
has what it found. Here you only need the shape. Each trial hides one file a
real pull request changed. Then Jev is asked, for every other file in the
package, whether finishing the ticket means that file has to change too.
Every question carried the ticket, the diff and one whole file. Over 28
trials that's 36,171 calls, sent 16 at a time.

The first try died a little before 1 a.m. Its control run died too. Both
stopped on the same line:

```
Error: Jev answered 402
```

402 means "payment required". The account was out of credit. The helper every
experiment used to call Jev couldn't tell that apart from a hiccup. It treated
every failure the same: wait a second and ask again, then two seconds, then
four, then eight, then give up. A 402 doesn't get better if you wait eight
seconds. So each of those 16 calls got turned away five times before it quit.

A couple of minutes later the TypeSafe site showed me a Cloudflare block
page, and I sent the agent a screenshot. Its first guess pointed at itself.
Tens of thousands of calls from one machine, 16 at a time, still retrying
after the 402s, can look like an attack. It also said plainly that it wasn't
sure, and the block might have nothing to do with us. Nothing was running by
then, since both runs were dead. It offered to fix the helper. Within a
minute the site loaded again for me.

We never found out what the block was. Maybe the burst of calls, maybe
something else. Nothing we have says which. The 402s we did figure out. The
agent sent a 97-call test, got a 402 again, and asked me to check the
balance. I added credit, the same 97 calls finished in 2 seconds, and the
probe ran again.

By then the helper had changed, in commit `bb6217a`. It retries only a rate
limit (429) or a server error (5xx), waits as long as the server asks, and
stops on anything else. A run also stops at 5,000 calls unless you raise the
cap. The comment that went in with it says why:

```ts
// A run stops at MAX_CALLS (default 5,000): a probe that grew by mistake should
// not spend a day's credit, or look like an attack on TypeSafe.
```

Whatever that block was, the helper won't look like that again.

## Priced by the envelope

Before the rerun, the agent guessed the whole thing would cost about a
dollar. When the result went into the experiment log, its cost line said
about $0.60.

Some forty minutes after the rerun started, the real numbers came in. The
day's bill was $21.31 for 508 million tokens. The agent owned it in its first
sentence. It had estimated the cost per call, but Jev charges by the token,
and these probes sent huge inputs.

That's the whole mistake, and it's an easy one to make. Think of the post
office. If stamps were priced per envelope, you could guess the cost of
36,000 envelopes from what one cost last week. But the post office charges by
weight, and every envelope in this run had a book in it.

Here's the sum that should have come before the run, with the numbers from
the log. Jev costs about $0.042 per million tokens. Each call carried a whole
source file (up to 30,000 characters) and the diff (up to 20,000), about
13,000 tokens in all.

- 36,171 calls × 13,000 tokens ≈ 470 million tokens
- 470 million tokens × $0.042 per million ≈ $20

Two lines. Pricing per call works while every call is about the same size,
and the first day's calls were small: a criterion and a short diff, close to
free. This run sent whole files, and nobody redid the sum.

The duplicate check from experiment 37 shows the other side. It compares
issues, titles plus the first 3,000 characters of each body. Its second run
made 35,374 calls. Each carried two short issues, under 2,000 tokens a call,
and the log puts the whole run at about 60 cents. Almost the same number of
envelopes, much lighter ones.

## What did we get for it?

I topped the account up with $25 and asked the agent to go easier on Jev.
Not to stop experimenting, just to stop pushing it where it wasn't
efficient. I also told it I wasn't upset about the money. My rough guess was
that the same reading on a big model like Sonnet would have cost something
like $1,500, so twenty dollars was a bargain. That number is my estimate
from that night, not a measurement. The point stands without it. $21.31 for
half a billion tokens of reading is cheap. I wasn't asking about the price. I
was asking what we got for it, and I said so as a real question, not a
complaint.

The agent's answer was honest: most of the $20 wasn't needed. Then it took
the run apart, and I think how it did that is the useful bit.

Before the package run, we already had the folder run. Same trials, but each
one only asked about the 35 or so files in the folders the pull request
touched. By the same sum it cost well under a dollar, and it had already
shown that Jev finds the hidden file. The package run had one new question to
answer: with up to 1,500 candidates instead of 35, does Jev start flagging
files it shouldn't?

That's a question about false alarms, and the control answers it. The
control hides nothing. The change is complete, every file in the package gets
asked, and any file Jev flags is a wrong flag. Its nine trials cost about a
quarter of the total. Most of the rest went to 28 trials that told us again
that Jev finds the file, which we knew.

Put that way, most of the money paid for a repeat. The run grew to the whole
package because that was the next size up, and the agent expected it to cost
about a dollar. At a dollar, nobody stops to ask which half of a run is
needed.

I told the agent it was fine. We were learning.

I meant it. The money was small, and the agent did what I'd want from a
coworker who got a bill wrong. It said so in one sentence, worked out where
the money went, and fixed the record. The experiment log still shows the
first number, next to the correction:

> The whole package cost about $20, not the $0.60 first written here: Jev bills by the token, and each call carried a whole file and a diff, about 13,000 tokens.

## Four rules

Here's what changed after that night. Three of these are habits, and one is
code.

**Estimate before you run.** Tokens per call, times calls, times the price.
It's the two-line sum above, and it takes less time than writing the probe's
help text. Go one step further and write down, before the run, what question
it answers and what it should cost. If the estimate is off by thirty times,
you find out from the estimate and not from the bill.

**Sample before you scale.** Run five trials first, and scale up only if the
sample leaves the question open. Our folder run was that sample, and it had
already answered "does Jev find the file". The only open question was about
false alarms over a bigger pool, and the cheapest run that answers it is the
control on its own.

**Send the least text.** The question was "does this file have to change?".
Maybe Jev needs the whole file for that. Maybe the first few thousand
characters would give the same answers for a seventh of the price. That's the
agent's guess, and it isn't tested. A cheaper input that gives different
answers isn't cheaper, so this one needs its own small sample first.

**Put the budget in the helper.** This one is code, in `experiments/jev.ts`.
`bb6217a` stopped the retries on a 402 and added the call cap. `6acce3e`
added a dollar cap and a receipt:

```ts
// Jev bills by the token, not the call: about $0.042 per million (2026-10-05,
// $21.31 for 508M tokens), and a call that carries a whole file is thousands of
// tokens. A run stops at MAX_DOLLARS (default $5), counting about four
// characters a token, and says what it spent when it ends.
const DOLLARS_PER_TOKEN = 0.042 / 1_000_000;
const MAX_DOLLARS = Number(process.env.MAX_DOLLARS ?? 5);
```

Every call adds what it sends to a running count before it goes out, and the
run stops once the count passes the budget. When the process ends, it prints
one line with the calls, the tokens and the dollars. Four characters a token
is a rough count, not the bill, but it's the right size, and size was the
thing we got wrong. With these caps, a run like the package run stops at its
first 5,000 calls and says why, long before $20.

Why code, and not a rule the agent remembers? A remembered rule is still a
prompt. [Post 4](./04-the-agents-had-a-shell.md) was about a prompt that said
"You cannot run commands" while the agent had a shell. A rule in a prompt is
something the agent is asked to follow. A check in the helper is something
every run goes through, whoever wrote the probe and whatever they believed the
bill would be.

## What I'd steal

If you run agents that call a paid API in a loop, here's what I'd take.

**Price the input, not the call.** Most model APIs bill by the token. A call's
cost is its size, and the size jumps the moment you start sending whole
files. Redo the sum whenever what goes into a call changes.

**Retry only what can change.** A rate limit or a server error might clear if
you wait. A 402, a 400 or a bad key will answer the same way every time.
Retrying those just sends the same refusal more traffic.

**Say what a run is for before it runs.** One sentence: "this answers X, which
the last run didn't". If you can't write it, the run is a repeat. If you can,
the cheapest run that answers X is often much smaller than the one you were
about to start.

**Put the budget where the calls are.** A cap on calls and a cap on dollars,
in the one function every experiment goes through, with a receipt at the end.
The agent writing the next probe doesn't have to remember anything.

**Fix the record where it was wrong.** Write the correct number next to the
wrong one, and say why it was wrong. The why is the part someone else can
use.

**Ask "why" as a question.** I asked what the run was for because I wanted to
know, not to blame anyone, and I got an honest answer: the run taken apart
and most of it called waste. An agent that expects to be blamed will defend
the run. I wanted to know what it was for.

## One new fact

So the $20 bought one new fact about Jev, the one the control answered, and
four rules about how we spend on it. I'll take that trade. The question I
still have is the third rule. If the first few thousand characters of a file
are enough, the missing-file check gets about seven times cheaper, by the
agent's sum, and nothing else changes. If they're not, we'll learn which
files need the whole thing. Either way, it starts with five trials.

Next: [Working with the agent, not through it](./09-working-with-the-agent.md),
how two days with an agent were actually run, and what I'd copy.
