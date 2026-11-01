# Every update builds every layer

**Decided 2026-10-31. The first pass was updated 2026-11-01.** This is about `next/`.
Work does not finish one layer and then start the next. Each pass goes through all
five layers, thin but real, and ends with something a person can use.

```text
first pass (Tier 1), five pull requests, the demo working after each:

A  door and plumbing   two browser tabs, each let in by a person, on the laptop
B  app                 one tab and one Electron window share a counter; a menu bar approves
C  Cloudflare          the same demo on a real account
D  notes               real notes, drawn as Markdown, that agents write through MCP
E  chaos               a run that breaks things on purpose, with a verdict on screen

layer             what the first pass gives it
transport         signed hello, unknown keys refused, a code and Approve, a one-time link
data              the ledger behind a service; each grant keeps what the person saw;
                  each note's saved versions, with a check against a stale save
coordination      mailbox, who belongs, window and agent grants
app               programs as sealed boxes: notes, the counter as the test, one that
                  breaks things on purpose
desktop (Tuval)   one core, with browser, Electron and headless on subpaths of
                  @kampus/tuval, and a menu bar with Approve and Remove
```

- **A pass is not done until it runs everywhere it should.** "Everywhere" means a
  browser tab and an Electron window, on the laptop and on Cloudflare, one command
  apart ([local is the cloud](./local-is-the-cloud.md)).
- **Thin is fine. Fake is not.** The door really refuses. The key really cannot be
  read out. A layer may do little, but what it does is what it will keep doing.
- **"Every layer" has one way out.** If a layer gets nothing new in a tier, the tier
  says so and says why ([the tiers](../plan/tiers.md)).
- **A pass can land as several pull requests.** Each one is whole, and its demo
  works. More than 9,700 lines in one review is not a review, so Tier 1 is five.
- **Debugging tools come in the first pass, not after.** A program that breaks
  things on purpose is part of the foundation, so failures are seen from day one.
  It runs on a throwaway ledger by default, never on real notes.
- **Three things are copied from today's version, by name.** Styling, the Markdown
  drawing and the MCP tools. These are named exceptions to
  [rethink, do not port](./rethink-do-not-port.md). Each copied file names its source
  and commit. Nothing else is copied.

This is what the industry calls a walking skeleton (Alistair Cockburn's name): the
smallest version that really works end to end, before any part gets thick.

## Where this stands

The first-pass plan is written and not approved. Nothing from it is built, and
nothing from `next/` is on main. Today's pipeline comes first
([the plan](../plan/README.md)).

## Why

- **A layer built alone hides what it got wrong until something sits on it.** The
  plan written this way found several things no note had said: Cloudflare caps a
  setting at 5 KB and the slice passes 664 KB that way; two tabs sharing one key
  would close each other unless a client's name carries its tab; and
  how a first window gets let in had only thin notes.
- **Rewrites go long when nothing can be seen.** Each pull request here ends with
  something to touch ([clean slate](./clean-slate.md)).
- **It replaces ticket 115's first plan,** which moved only the plumbing and kept
  behavior the same. That plan's laws carry over.

## What it costs

- More at once. The first pass is 5,210 to 7,140 lines of product code, 4,780 to
  6,880 lines of tests, and 42 to 66 builder agent hours, 50% sure. Its first pull
  request will give real numbers.
- Five landings and five reviews instead of one.
- A change in one layer can touch all of them while the shapes are still moving.

**How sure:** 80% that this is the right way to build. The doubt is whether every
later pass can stay this wide once programs get big. A later pass that really touches
one layer would settle it. The tier rule above says what happens then, and it has not
been tried.

## What it cannot tell us

- Whether thin parts stay honest. Thin can slide into fake. Laws and the mutation
  step are the guard, and only their results will show if that is enough.
- How much rework a wide pass causes compared with layer by layer. There is nothing
  to compare it with.
