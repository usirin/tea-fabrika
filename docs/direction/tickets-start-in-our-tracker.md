# Tickets start in our tracker

Decided 2026-10-24, for the pipeline's first version.

```ts
// A sketch. A ticket is facts on the ledger. No stage reads a GitHub issue.
{fact: "filed", ticket: "demlik-1", by: "owner", title: "…", body: "…"}
{fact: "edited", ticket: "demlik-1", by: "owner", body: "…"}
{fact: "approved", ticket: "demlik-1", plan: "p-1", text: "sha256:9c1f…"}

// The yes names the text it saw. An edit after it is not covered.
const covers = (yes: Approved, now: Ticket) => yes.text === sha256(now.title, now.body);
```

## What was decided

- **The tracker is part of the first version.** It is the ledger, with
  tickets as facts, plus a small form in the app to file one.
  - It is not a whole Linear. No boards, no cycles, no priorities: those wait
    for a run that needs them, as
    [the smallest ledger](./smallest-ledger-proof-to-grow.md) says.
- **The first demlik ticket is filed there,** not as a GitHub issue. Triage,
  plan and every later stage read it from the ledger.
- **Only people on the ledger can file or edit a ticket.** A stranger has no
  way in. On a public GitHub repo, anyone can open an issue or comment on one.
- **A yes covers the text it saw.** The owner's yes on the plan records a hash
  of the ticket's text. An edit after the yes needs a new yes before build
  starts.
- **GitHub stays the code host.** Pull requests, checks and the merge queue
  stay on demlik, through `CodeHost`, as
  [the ledger note](./ledger-behind-a-service.md) says.

## Why

- **Who can write the ticket is the guard that holds.**
  - An agent can be steered by text it reads. Twelve published defenses all
    fell to adaptive attacks
    ([Willison](https://simonw.substack.com/p/new-prompt-injection-papers-agents)).
  - So the pipeline limits who writes what an agent reads. Meta's Rule of Two
    says one agent session should have at most two of: input nobody trusts,
    private data, and the power to change things outside
    ([Meta](https://ai.meta.com/blog/practical-ai-agent-security/)).
  - Triage reads the ticket first, with nothing in its box. With the tracker,
    the ticket is no longer text from a stranger.
- **Binding a yes to what it saw is common practice.**
  - GitHub can mark an approval stale when a pull request's diff changes
    ([GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
  - Gerrit drops a vote on a new patch set unless the label's
    `copyCondition` keeps it
    ([Gerrit](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).
  - This repo already does it for review: a review records which ticket
    version it judged ([done is per criterion](./done-is-per-criterion.md)).
- **It was the end state anyway.** The ledger note names fabrika's own tracker
  as where this goes. This moves it into the first version.

**Cost:** a form in the app, three new facts and a hash. Tickets are no longer
public, so a demlik maintainer cannot see why a pull request exists unless it
says so on GitHub (see below).

**How sure: 80%.** The doubt is the extra work before the first ticket can
run. What would settle it: building the form and seeing how small it is.

## Still open

- **demlik asks each pull request to close a GitHub issue.** Its `CLAUDE.md`
  says to write `Closes #N`. Two ways:
  - Post the approved ticket to GitHub once, at approval, as a copy. No stage
    ever reads it.
  - Ask demlik to accept a link to our ticket instead.
  - Lean: the copy, 70%. demlik's maintainers then see why each pull request
    exists on GitHub. The doubt: comments on the copy reach nobody.
- **Ticket ids.** `demlik-1`, in Linear's style of a team key and a number, is
  a guess.
- **The form.** In the Electron app. A `tsh` command may come first.

## What would change it

- A stage that needs something only a GitHub issue gives.
- A form that turns out much bigger than a few fields.

## What it cannot tell us

Nothing has run. No ticket has been filed this way, and no stage reads a
ticket from the ledger yet.
