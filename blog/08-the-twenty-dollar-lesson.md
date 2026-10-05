> Draft, still being written.

# The twenty dollar lesson

36,171 calls to Jev cost about $20. A few hours later, 35,374 calls to the same
model cost about 60 cents.

Same model, same price, almost the same number of calls. What changed was what
each call carried. This post is about the $20: how an agent working for me
spent most of it re-learning something it already knew, why its estimate said
sixty cents, and the four rules we took out of that night. It's a small sum.
The rules are worth a lot more than that.

[The last post](./07-cheap-enough-to-read-everything.md) is about what happened
when we stopped rationing Jev and let it read whole files. This one is the bill.

## Just before 1 a.m.

The run that cost the money was the missing-file probe at its biggest. Post 7
has what it found. All you need here is the shape. Each trial hides one file a
real PR changed, and then Jev is asked, for every other file in the package,
whether finishing the ticket means that file has to change too. Every one of
those questions carried the ticket, the PR's diff and one whole file. Over 28
trials that came to 36,171 calls, 16 at a time.

Just before 1 a.m. it died. Its control run died too. Both stopped on the same
line:

```
Error: Jev answered 402
```

402 means "payment required". The account was out of credit. The helper every
experiment used to call Jev didn't know the difference between that and a
hiccup. It treated every failure the same way: wait a second and ask again,
then two seconds, then four, then eight, then give up. A 402 doesn't get better
if you wait eight seconds. So each of those 16 calls got turned away five times
before it gave up.

A couple of minutes later I sent the agent a screenshot. The TypeSafe site was
showing me a Cloudflare block page. The agent's first guess pointed at itself:

> I sent about 36,000 calls from your IP, 16 at a time, and kept retrying after the 402 errors. That pattern can look like an attack. I'm not sure that's the cause; it could be unrelated.

It stopped everything and offered to fix the helper. A minute later I was back
in:

> ok, we're back. i was probably getting rate limited or something

We never found out what the block was. Maybe it was the burst of calls, maybe
something else. Nothing we have says which. The 402s we did figure out. The
agent sent a 97-call test, got a 402 again, and asked me to check the balance.
I added credit, the same 97 calls finished in 2 seconds, and the probe ran
again.

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

Before the rerun, the agent told me what it would cost: "roughly $1 in total".
When the result went into the experiment log, its cost line said "about $0.60".

About forty minutes after the rerun started, the real numbers came in. The
day's bill was $21.31 for 508 million tokens. The agent's reply opened like
this:

> That one's on me. I estimated cost per call, but Jev charges by token, and my probes sent huge inputs.

That's the whole mistake, and it's an easy one to make. Think of the post
office. If stamps were priced per envelope, you could guess the cost of 36,000
envelopes from what one cost last week. But the post office charges by weight,
and every envelope in this run had a book in it.

Here is the sum that should have come before the run, with the numbers from the
log. Jev costs about $0.042 per million tokens. Each call carried a whole
source file (up to 30,000 characters) and the PR's diff (up to 20,000), about
13,000 tokens in all.

- 36,171 calls × 13,000 tokens ≈ 470 million tokens
- 470 million tokens × $0.042 per million ≈ $20

Two lines. The per-call guess came from earlier runs, where a call carried a
short ticket and a few lines of code, and those really were close to free.
Pricing per call is a fine shortcut right up until the size of a call changes.
This was the run where it changed, and nobody redid the sum.

The duplicate check from experiment 37 shows the other side. It compares
issues, titles plus the first 3,000 characters of each body. Its second run
made 35,374 calls for about 60 cents. Almost the same number of envelopes,
much lighter ones.
