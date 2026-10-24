# Sort answers yes or no

Decided 2026-10-18.

*Renamed 2026-10-24: in the new pipeline this step is called **triage**, the
industry's word for it. It takes a ticket from the ledger and triages it to its
next step. "Sort" had no written reason; it came from "triage only sorts" on
2026-10-18. Which answers triage gives is being looked at again. Fold was
dropped on 2026-10-24 (below).*

## What was decided

- **Sort answers yes or no.** There is no "later", no snooze and no priority.
  - **yes**: worth doing; the ticket goes on.
  - **no**: closed, with a one-line reason.
- **Every "no" carries its reason.** For example "not now: nobody needs this
  yet" or "won't do: out of scope". A reader can tell which ones are worth
  bringing back.
- **"Later" is a reopened "no".** A reopen goes back through sort, which reads
  everything fresh. There is no separate path.
- **Sort's duplicate check reads closed tickets too.** A new report about the
  same thing finds the old "no" and its reason, so a reopen needs no clock.
- **Triage does not fold, for now** (decided 2026-10-24, from experiment 133).
  A fold was a yes that named an open plan the ticket joins (`partOf`). It
  goes. Every yes that needs a plan starts a plan of its own.

  ```ts
  // demlik #389: filed 21 seconds after #388, by the same filer, built in #388's PR.
  // Before: {answer: "yes", next: "plan", partOf: 388, why: "…"}
  // Now:    {answer: "yes", next: "plan", why: "…"}   // a plan of its own, and a PR of its own
  ```

  - **Why:** triage folded right 2 of 26 times. 9 of the 13 real folds were
    batch siblings whose target was not a plan yet when they came in. The
    others turned on "can one PR carry both?", which needs the code. Making it
    work needs a join rule, a rule for two planners running at once, and
    planning a plan again. [The smallest ledger](./smallest-ledger-proof-to-grow.md)
    says links wait for a run that needs them.
  - **Cost:** a batch like demlik #388 to #392 becomes five plans for the
    owner to approve and five PRs, each later one catching up with main.
    Folds were at least 13 of about 400 closed demlik tickets.
  - **The bar's `carried` rule goes with it.** Its reason said "folded into
    another ticket". The same work is a duplicate.
  - **What would bring it back:** batches that cost the owner real time, or
    sibling PRs that keep fighting. Experiment 136 asks whether the planner,
    which reads the code, could fold.

## Why

- **A "later" needs something that wakes it.** A date or a condition needs a
  scheduled run, and what a scheduled run means here is not designed yet.
  Yes / no needs nothing that expires.
- **A bare "later" rots.** Backlog, postponed and deferred piles in large open
  projects come back only when someone remembers, or a stale bot closes them.
  None of the AI triage tools studied decides "not now" by itself.
- **Priority was already doing this quietly.** On the replayed repos, a low
  priority mostly meant "not now": low-priority features reached a PR far less
  often than the next level up. A "no" with a reason says that out loud.
- **It fits [the smallest ledger](./smallest-ledger-proof-to-grow.md).** No new
  field: an open ticket that sort said yes to is worth planning. A "yes" is not
  approval to build; who sets that flag is open (see below).

## What it means for the work

- Sort's output is one of: duplicate of N, yes, no with a reason.
- **A "yes" also says what the ticket needs next** (decided 2026-10-18):
  - `plan`: something gets built;
  - `ruling`: the owner decides; it never reaches a builder;
  - `research`: it ends in a finding, not a PR.
- **No ticket-kind label** (bug, feature, chore, decision, investigation, epic)
  enters the ledger. Experiment 88 replayed sort on 40 closed tickets: the
  route matched what really happened in 85% of answers on tickets that were
  worth doing, no miss needed a kind label, and the labels triage had set were
  wrong as often.
- Two rules came out of it:
  - an open question the plan can carry with a lean goes to `plan`, not
    `ruling`;
  - sort is given the repo's bar for what is worth doing, so it can say no
    (it said no once in 160 answers).
- Bug urgency has no home in the core; it waits for an on-call pack.

## The ruling route

Decided 2026-10-18. It ends with the owner's answer saved on the ticket, then
takes one or more of three branches:

- **A lasting rule** (how the code or product must work from now on): it is
  also written as a decision record, so later agents read the why.
- **A one-off call:** the answer on the ticket is enough. No decision record.
- **Something must be built:** the ruling starts a plan.

Only lasting rules become decision records, so the ones that matter are not
buried under small calls.
- Closed tickets stay readable by the duplicate check, reasons included.

## The bar for a no

Decided 2026-10-18, from experiment 92. Sort says no when the ticket:

- is already fixed on main;
- is about something that was removed;
- ~~is already carried by another ticket;~~ dropped 2026-10-24 with fold (see
  above); the same work is a duplicate;
- was replaced by a later design;
- asks again what a decision record or ruling already said no to;
- is a bug in the pipeline tool itself, so it belongs in that tool's repo;
- is not a work item.

Still a yes:

- it only looks done;
- a host's first ask of tea;
- "not now" (that is not a no);
- one user's gap that is still basic.

Open:

- **The three triage clauses** (ceremony, churn, hardening with no incident)
  doubled the no's caught in experiment 92, on a small set. Experiment 92b
  tests the bar on another repo before they are added.
- **Rules that need the code to see** (already fixed, target removed) may send
  the ticket to research rather than to no.
- **Jev stays out of sort's no.** It agreed with the big model on yes, and on
  none of its no's.

## Who approves building

- **The owner, on the plan** (decided 2026-10-18). The plan is the first point
  where what would be built is clear; sort only sees the report.
- Decided 2026-10-21 (owner): labels never gate a build; the approved plan on the ledger is the only go.
- **For now.** The owner's look at plans is the answer key. Checks take over
  only once they match that look over several batches.
- **The owner does not approve the PR** (decided 2026-10-18). A PR whose plan
  was approved ships when every criterion is met and CI is green. Trust in it
  comes from verification and from shapes that make a wrong state impossible,
  never from a person reading the diff.

## What would change it

Good tickets that stay closed because nobody reports them again, while a
person keeps reopening them by hand. That would be the run that proves a
"later" with a wake-up is needed, and a scheduled run with it.
