# Every update builds every layer

**Decided 2026-10-31.** This is about `next/`. Work does not finish one layer and
then start the next. Each pass goes through all five layers, thin but real, and
ends with something a person can use.

```text
first pass, four pull requests, the demo working after each:

A  door and plumbing   two browser tabs, each let in by a person, on the laptop
B  Tuval and Electron  one tab and one Electron window share a counter
C  Cloudflare          the same demo on a real account
D  chaos               a run that breaks things on purpose, with a verdict on screen

layer             what the first pass gives it
transport         signed hello, unknown keys refused
data              the ledger behind a service, on Effect
coordination      mailbox, who belongs, peer grants
app               programs as sealed boxes, one that breaks things on purpose
desktop (Tuval)   one core, with tuval-browser, tuval-electron and tuval-headless
```

- **A pass is not done until it runs everywhere it should.** "Everywhere" means a
  browser tab and an Electron window, on the laptop and on Cloudflare, one command
  apart ([local is the cloud](./local-is-the-cloud.md)).
- **Thin is fine. Fake is not.** The door really refuses. The key really cannot be
  read out. A layer may do little, but what it does is what it will keep doing.
- **A pass can land as several pull requests.** Each one is whole, and its demo
  works. More than 5,000 lines in one review is not a review.
- **Debugging tools come in the first pass, not after.** A program that breaks
  things on purpose is part of the foundation, so failures are seen from day one.
- **One thing is copied from today's version: styling.** The first pass takes
  today's look as it is. This is a named exception to
  [rethink, do not port](./rethink-do-not-port.md), for styling only. Each copied file
  names its source and commit.

This is what the industry calls a walking skeleton (Alistair Cockburn's name): the
smallest version that really works end to end, before any part gets thick.

## Why

- **A layer built alone hides what it got wrong until something sits on it.** The
  plan written this way found several things no note had said: Cloudflare caps a
  setting at 5 KB and the slice passes 664 KB that way; two tabs sharing one key
  would close each other unless a peer's name carries its tab; and
  how a first window gets let in had only thin notes.
- **Rewrites go long when nothing can be seen.** Each pull request here ends with
  something to touch ([clean slate](./clean-slate.md)).
- **It replaces ticket 115's first plan,** which moved only the plumbing and kept
  behavior the same. That plan's laws carry over.

## What it costs

- More at once. The first pass is about 3,000 lines of code, 10 to 16 builder agent
  hours, 45% sure. The first pull request will give real numbers.
- Four landings and four reviews instead of one.
- A change in one layer can touch all of them while the shapes are still moving.

**How sure:** 80% that this is the right way to build. The doubt is whether every
later pass can stay this wide once programs get big. A later pass that only touches
one layer would settle it, and this note would need to say what "every" means then.

## What it cannot tell us

- Whether thin parts stay honest. Thin can slide into fake. Laws and the mutation
  step are the guard, and only their results will show if that is enough.
- How much rework a wide pass causes compared with layer by layer. There is nothing
  to compare it with.
