# The tiers: the whole plan for `next/`

**Tier 1 approved 2026-11-01. Tiers 2 to 7 proposed. Order of work set 2026-11-01.** Walked when
Tier 2 starts (owner, 2026-11-08): the first proposed tier's plan.

**Changed 2026-11-13 ([0159](../../.decisions/0159-fabsh-summon-join-come-first.md)): the next thing built is `fabsh`, `summon` and `join`, working
for real, with whatever they need, so fabrika is built inside fabrika.** The tiers below still show
the order from before that day: `fabsh` and pipes in Tier 2, agents in Tier 5, rooms in no tier,
and thin slices in Tier 1. The changed Tier 1 follows in its own pull request. Until it lands,
0159 wins wherever this page differs.

All the work on `next/` is one plan of seven tiers. Each tier is one pass across all five layers
and across fabrika's six core ideas, and each ends with something a person can use. No layer and no
core idea gets finished alone, and none waits for the tier that finishes it: every core idea gets a
thin working slice in Tier 1, and later tiers harden it
([0068](../../.decisions/0068-tiers-carry-every-part.md),
[0078](../../.decisions/0078-agent-and-flow-slices-start-early.md),
[0088](../../.decisions/0088-six-slices-in-tier-1.md)).

```text
core idea                          thin slice   built for real in
hands                              Tier 1 P39   Tier 4
programs written outside fabrika   Tier 1 P40   Tiers 5 and 7
programs working together          Tier 1 P41   Tiers 2 and 4
a person starting a program        Tier 1 P42   Tier 2
an agent fabrika starts            Tier 1       Tier 5   (no row yet)
a flow fabrika runs                Tier 1 P43   Tier 6   (P43: the merge queue, for landing changes)

                transport   data   coordination   app   desktop
Tier 1 works    ---------------------------------------------->  a checklist a person fills and agents check with a note through MCP, read from any window or a phone, plus the six slices
Tier 2 programs ---------------------------------------------->  your own tickets: fabsh, tracker | ticket; notes, its first real app
Tier 3 few      ---------------------------------------------->  a few people share one fabrika, from browsers and phones
Tier 4 hands    ---------------------------------------------->  hands take jobs: a Cloudflare container, a Mac, a VM, a first tab (proposed split)
Tier 5 agents   ---------------------------------------------->  an agent does a job, a person watches (proposed split)
Tier 6 daily    ---------------------------------------------->  real tickets, the full pipeline, today's version retires
Tier 7 others   ---------------------------------------------->  someone else can install it
```

Only Tier 1 is committed. It started 2026-11-05 with its exam. `next/` does not wait on today's
pipeline, which is paused: the lead session's agents build Tier 1 by hand, with the pipeline's steps
for each pull request, one [Tier 1 row](./tier-1.md#the-pull-requests-one-at-a-time) at a time.
Tier 1 has 44 rows. How many are on main, and where the rest stand, is in
[the plan's state](./README.md#where-we-are-now). A tier is a project. The approval of 2026-11-01
covers what Tier 1 builds, not its breakdown.

## What each tier gives each layer

Tier 1 comes from [its plan](./tier-1.md). Tiers 2 to 7 are a first sorting, and they will change.
So is splitting the old Tier 4 into hands and agents, which makes seven.

Each tier carries and updates a working slice of every core idea. A tier plan names, for each core
idea, what its slice gains in that tier, or says why it gains nothing. A slice works, with no stub
and no dead path, and it records now every fact a later tier needs
([0068](../../.decisions/0068-tiers-carry-every-part.md)). Each tier also checks its slice of
programs written outside fabrika's source with a cold agent as the author: every place the agent
gets stuck is a gap, and each run is an experiment
([0075](../../.decisions/0075-cold-author-checks-outside-programs.md), ticket 665).

### Tier 1: it works

- **Transport:** signed hello, unknown keys refused, code and Approve, one-time link.
- **Data:** ledger behind a service; `granted` with `saw` and `as`; `denied`; revoke; each note's
  saved versions, with a check against stale saves; a backup sheet, recovery on a new Mac and
  `added`; email recovery on the cloud, which lets the device in at once and tells every live
  device (decided 2026-11-06, the wait dropped 2026-11-11,
  [0138](../../.decisions/0138-email-recovery-lets-in-at-once.md)); full monitoring: each process's spans in a thin JobRecord, kept forever, raw health
  rows for about 2 weeks and hourly summaries forever, and nothing a chaos fault does left
  unexplained (owner, 2026-11-07).
- **Coordination:** mailbox, who belongs, window and agent grants, every device a master with its
  grant tree; a slice of C2 to C5: dead letters, one crashed program restarted with a brake and
  backoff, exit, info and monitors, each start a new process with its own id, who is online, and the
  brain restarted (decided by the owner, 2026-11-06).
- **App:** sealed programs, a checklist a person fills and agents check with a note through MCP,
  read from any window or a phone, each agent approved once, chaos monkey (2026-11-11,
  [0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md); it said notes drawn as Markdown
  that agents write, and a counter as the test). The foundation for loading settings, P38,
  moved here from Tier 5 ([0069](../../.decisions/0069-choices-are-settings.md)). Tier 1 only reads
  the keybindings and theme files; the programs for them are Tier 2's.
- **Desktop (Tuval):** one core; Electron, browser and headless; menu bar with Approve and Remove.

### Tier 1's six thin slices

All six core ideas get their thin slice in Tier 1, each as small as it can be and still work, with
no stub ([0088](../../.decisions/0088-six-slices-in-tier-1.md),
[0078](../../.decisions/0078-agent-and-flow-slices-start-early.md)). Each slice has its own plan
before any builder starts. The size of each, their order and whether Tier 1 splits are not decided.

| Core idea | Row | What the slice must do | Hardened in |
|---|---|---|---|
| Hands | P39 | A program can ask for a command and see it run. A machine that runs jobs dials in with a key granted as `hands` and asks for work with `jobs.take`; the first job is `git --version` on one host a person selects ([0102](../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md)). | Tier 4: competing claims, leases and moving a job to another host |
| Programs written outside fabrika's own source | P40 | A person can run a program the app's source does not list, as a repo's own pack listed in `fabrika.toml` by a `from` that starts with `./` ([0083](../../.decisions/0083-every-program-in-a-pack.md), [0084](../../.decisions/0084-own-pack-listed-by-path.md)). That path, not a second way to load a program. The cold author check runs on it. | Tier 5: a repo's own pack; Tier 7: packs from elsewhere and the lock file |
| Programs working together | P41 | One program can reach another. A program may send mail to another program's named mailbox and get a reply, beside pipes, and the host carries it ([0103](../../.decisions/0103-a-program-may-mail-another-by-name.md)). | Tier 2: typed pipes; Tier 4: a program that starts another |
| A person starting a program | P42 | A person can start a program while the app runs. | Tier 2: `fabsh` |
| An agent fabrika starts | no row yet | fabrika can start one agent run for one bounded job and record how it ended. Where the agent runs: the laptop, as today, until hands and the Tier 5 laws say otherwise. | Tier 5 |
| A flow fabrika runs | P43, for landing changes | fabrika can run a saved list of typed steps handed to it as data ([0074](../../.decisions/0074-agent-hands-over-a-flow.md)), and stop at an ask. P43 is the pipeline's thin slice for landing changes: the merge queue's first stage, one queue program and one landing program per change, one landing at a time ([0111](../../.decisions/0111-merge-queue-stage-1-is-a-tier-1-row.md), [0107](../../.decisions/0107-fabrika-provides-the-merge-queue.md), [0110](../../.decisions/0110-merge-queue-is-fabrika-programs.md)). | Tier 6: the full pipeline and the merge queue's later stages |

0078's two slices came with no row; theirs come with their plans. P43 is the first row under a flow
fabrika runs. Rows that may already half-cover a slice are listed in
[0088](../../.decisions/0088-six-slices-in-tier-1.md), as facts each plan checks.

### Tier 2: first programs

- **Transport:** nothing new: letters and picks use the same connection, and this tier tests that.
- **Data:** tickets as facts; a program's own storage (`keep`) holds its filter.
- **Coordination:** typed pipes between programs; Topic, so a program can read outside its inbox.
  Pipes harden Tier 1's slice of programs working together, which meets by mail.
- **App:** tracker as a picker, ticket, `fabsh`, which hardens Tier 1's slice of a person starting a
  program. Today's tracker tickets for `next/` work move onto the new ledger with nothing lost (who
  filed, when, comments, links), decided 2026-11-05. `ps` in `fabsh` shows STATUS, RESTARTS, DEAD
  and AGE, the shape of Kubernetes' `kubectl get pods`, and the trace view window waits on the
  ledger, never a 1-second poll (owner, 2026-11-07). Health lines, the first use of
  [A2b](../direction/the-cloud-is-one-more-host.md)'s lines: a line on a health number (an object's
  size at 50% and 80% of 10 GB, a reader's lag that keeps growing, an error rate) fires one mail to
  the desk, once, when crossed, and a process `down` for an hour, or size at 95%, is an ask; spend
  reuses the same lines in Tier 5 (owner, 2026-11-07).
- **Desktop (Tuval):** a tile starts `fabsh`, a line opens in place, a tile can start from a saved
  line; the desk arrives as a program, with split, close and prefix keys; the keybindings program;
  the `themes` program, and reading theme files. The keybindings and `themes` programs joined Tier 2
  on 2026-11-01, decided by the owner. If Tier 2 grows too big, it splits, by [the rules](#the-rules).

### Tier 3: a few people

[Why](#tier-3-is-a-few-people-owner-2026-11-07).

- **Transport:** invite and join, typed codes on Cloudflare; an invite is a one-time link, also shown
  as a QR code for a phone to scan, that expires in a day, sent by an admin or the owner
  ([invites](#tier-3s-invites-owner-2026-11-07)); each new person comes in by invite and approval,
  the same flow as a new tab, and never because GitHub lists a key
  ([a key per client](../direction/a-key-per-client-and-no-github-trust.md), owner, 2026-11-05);
  a phone lets a friend in, since a tab with a user-verified passkey is a full device
  ([Tier 1's question 19](./tier-1.md#open-questions)).
- **Data:** `knocked`, `joined` (`added` and the backup are in Tier 1, PR D2, settled by the owner);
  more than two people, moved from Tier 7; one owner, admins and members, and who invited whom
  ([roles](#tier-3s-roles-owner-2026-11-07)).
- **Coordination:** any number of members, removing a member, each person's windows.
- **App:** the tracker shared, who filed what, who may start chaos; notes shared, with comments.
- **Desktop (Tuval):** join screen, Windows list, password helper for a docked Mac, releases through
  GitHub Actions.

#### Tier 3 is a few people (owner, 2026-11-07)

Tier 3 was "two people". It is now a small group, a few friends or a small company, sharing one
fabrika on one person's Cloudflare. Every one of them uses it only from a browser or a phone; setup
and deploy may still use a Mac. Why: the main browser case is a few friends on browsers and phones
([experiment 229](../../experiments/229-browser-only-friends.md)). So "more than two people" and
"phone as approver" left Tier 7. Roles finer than the three below stay in Tier 7. The real domain
is chosen at install time ([below](#tier-3s-address-mail-recovery-and-join-screen-owner-2026-11-08)).

#### Tier 3's roles (owner, 2026-11-07)

Decided by the owner in the product walk, step 7. A project has exactly one owner, plus admins and
members.

```ts
// A sketch. One owner by shape: there is no per-person `role` field, so two owners cannot happen.
type Project = {
  owner: Person;
  admins: Person[];
  members: Person[];
};
```

- **Owner only:** transfer ownership, delete the project, add or remove admins.
- **Admins:** invite, remove members, change settings such as money limits.
- **Members:** everything else.
- **Recorded from day one, enforced later.** What each role may do is checked in a later slice. The
  ledger records now who invited whom, and who is owner or admin, since that history cannot be
  rebuilt.

#### Tier 3's invites (owner, 2026-11-07)

Decided by the owner in the product walk.

- **An invite is a one-time link,** also shown as a QR code, so a phone can scan it.
- **It expires in a day.**
- **An admin or the owner sends it,** by the roles above.
- **The ledger records the join:** "<person> joined", with who invited them.

#### Tier 3's address, mail, recovery and join screen (owner, 2026-11-08)

Decided by the owner from [experiment 229](../../experiments/229-browser-only-friends.md).

- **The address is asked once, up front** (row 13). The install asks for the final web address. A
  `workers.dev` address is allowed, with a note that moving later means everyone makes new
  passkeys, since a passkey is bound to its domain. So "a real domain" moves from Tier 7 to install
  time.
- **Domain setup is smooth** (lean). The install lists the domains already on the Cloudflare
  account to pick from. alchemy then makes the Worker's custom domain (DNS and certificate come on
  their own) and the mail route. `workers.dev` stays a one-key choice. A domain held elsewhere gets
  the two nameservers to paste, and a check in the background says when it is live.
- **Recovery mail reaches any friend** (row 18). Email Sending with the group's own domain, or
  Access's one-time PIN with only `workers.dev`. No check per friend. The install sets up the
  address, the DNS and the mail route through alchemy, with no steps by hand
  ([recovery key](../direction/recovery-key.md)).
- **An admin can re-invite a person who lost every device** (row 19), as the same person, at once,
  with no wait. The ledger records who re-invited whom. fabrika is for building, not enterprise
  security: an admin's invite is already trust ([principles](../direction/principles.md)).
- **The join screen says who can see what** (row 23). One line, along the lines of "this is hosted
  on a cloud account, and its admins can see everything". The words are not final. No extra step.

### Tier 4: hands (proposed split)

This tier builds hands for real. It hardens Tier 1's hands slice, P39, which runs on one host a
person selects, with no competing claims or leases
([0102](../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md)).

- **Transport:** hands as a client; how a client says it takes jobs.
- **Data:** the queue, claims, leases; every container job records its run seconds and who started
  it, from the first job (owner, 2026-11-08, [experiment 229](../../experiments/229-browser-only-friends.md)
  row 31).
- **Coordination:** Cloudflare Container hands first: the host is a Durable Object and each job gets
  its own container ([local is the cloud](../direction/local-is-the-cloud.md), owner, 2026-10-25),
  and [experiment 148](../../experiments/148-remote-programs.md) ran real Claude Code in one; then
  Mac and VM hands; work queues; mail delivery, leases; the rest of C2 to C5: supervision trees,
  sibling strategies, links and trap exit, since Tier 1 has no process that starts another (owner,
  2026-11-06). A program that starts another hardens Tier 1's slice of programs working together.
- **App:** secrets; `kill -9` from chaos through real hands, and `kill_brain` as a chaos button.
- **Desktop (Tuval):** terminal tile; a first tab that runs a job.

### Tier 5: agents (proposed split)

This tier builds an agent fabrika starts for real, and a repo's own pack. It hardens two Tier 1
slices: an agent fabrika starts, and programs written outside fabrika's source (P40).

- **Transport:** agent keys and grants in real use.
- **Data:** spend, limits.
- **Coordination:** hands run agents.
- **App:** `claude` and `codex` programs; repo programs, as a repo's own pack in the repo's
  `.fabrika/packs/<name>/` listed in `fabrika.toml` by its `./` path, lean about 60%
  ([0083](../../.decisions/0083-every-program-in-a-pack.md),
  [0084](../../.decisions/0084-own-pack-listed-by-path.md)); two laws and a restart rule
  ([below](#tier-5-laws-decided-2026-11-07)).
- **Desktop (Tuval):** chat tile (not a copy of regular chat; several branches of a conversation at
  once stays possible), asks list; the agent box. *Noted 2026-11-05:*
  [talk where you work](../direction/talk-where-you-work.md) decided talk at a spot moves to one
  thread tile that opens only from a spot, and says this line changes with it once the note
  settles.

#### Tier 5 laws, decided 2026-11-07

Decided by the owner, for when agents run as programs:

- **A person's stop is final.** No restart, resume or resend brings that run back. Only a new start
  does. This is about the run. A lane a person stops is still a saved pause
  ([pipeline guidelines](../direction/pipeline-guidelines.md), clash 1): it goes on later with a new
  run of the stopped step, never the stopped run. The owner confirmed this reading the same day.
- **A step's schema check never adds a "fix your answer" turn.** An answer that does not fit ends the
  step `stuck`, and the transcript stays the truth.
- **When hands restart, they resume the maker's session,** as
  [an agent is a program](../direction/agents-are-programs.md) says: the kept session opens again.
  A detached runner that writes an agent's events to a file comes only if `field/` shows cut-off
  turns costing real work.

### Tier 6: daily use

This tier builds the full pipeline for real. It hardens Tier 1's slice of a flow fabrika runs,
including the merge queue's first stage, P43: Tier 6 adds batches, a cheap lane for docs and field
rows, and a record of how long each change waited, with the signing stage after
([0110](../../.decisions/0110-merge-queue-is-fabrika-programs.md),
[0111](../../.decisions/0111-merge-queue-stage-1-is-a-tier-1-row.md)).

- **Transport:** reconnect and offline, tested hard; D4's poke, the sync-engine note's T7 as a Sub.
- **Data:** moving data, keeping history cheap, paging.
- **Coordination:** pipeline stages, schedules, and [the whole plan flow](#a-requirement-the-whole-plan-flow);
  the mutation queue, shaped like a merge queue: a pull request's leftover lines and a daily sweep
  in, survivors out as at most 3 tickets a day, Stryker on hands
  ([fast and daily mutation](../direction/fast-and-daily-mutation.md)). Today's lead tooling runs
  mutation hourly against main instead, and leaves this program open
  ([0066](../../.decisions/0066-mutation-runs-on-a-schedule.md)).
- **App:** pipeline and tracker views take jobs over one at a time; notes gain tabs, search and
  delete.
- **Desktop (Tuval):** drag, zoom, workspaces, command palette, speed budgets; formatted typing in
  place for notes; native dialog and popover against Zag.

### Tier 7: others use it

This tier builds packs from elsewhere and the lock file, hardening Tier 1's slice of programs
written outside fabrika's source.

- **Transport:** a phone tab already works from Tier 1; phone as approver and the invite's QR code
  moved to Tier 3 (owner, 2026-11-07); a real domain moved to install time (owner, 2026-11-08).
- **Data:** finer roles past owner, admin and member, such as read-only members, if any; signing
  each letter. More than two people and the three roles moved to Tier 3 (owner, 2026-11-07).
- **Coordination:** other people's programs, kept apart, `limits: {cpuMs}`.
- **App:** how others write programs, packs from elsewhere with the lock file; for notes: live
  co-editing, any CRDT, pages that run code in a box.
- **Desktop (Tuval):** Apple signing, auto-update, Windows and Linux.

### A requirement: the inbox on a phone, early

Decided 2026-11-06 in the product walk (step 4): using fabrika from a phone is one of the owner's
first needs, so "phone as approver" does not wait for Tier 7. A small slice moves earlier: a browser
tab on the phone shows the inbox, answers asks and reaches a summoned agent (`@scout`), since the
brain keeps the alias and session ([talk where you work](../direction/talk-where-you-work.md)). Which
tier takes it is settled in the plan walk. It met one open lean, that a tab cannot approve (no,
70%), since answering an ask is an approval. Settled 2026-11-07 (owner): yes, a tab with a
user-verified passkey may approve ([Tier 1's question 19](./tier-1.md#open-questions)).

### A requirement: the whole plan flow

Tier 6 in `next/`, since that is where its pipeline stages land. Decided 2026-11-01, 70%, since the
order of Tiers 3 to 6 is only proposed. It is built properly there:

```text
free-form plan in an artifact -> reported as a ticket -> the planner writes the plan from it
  -> the owner approves -> the planner's output becomes several small tickets
a rerun after a partial filing files nothing twice
```

Tier 1's split goes by hand, once, as [a named exception](../direction/free-form-plan-to-planner.md);
since 2026-11-05 it is in [Tier 1's plan](./tier-1.md#the-pull-requests-one-at-a-time).
Tiers 2 to 5 come first and each is a project, so each needs the owner's yes to split by hand,
or this moves up. That is the cost of placing it here.

## The rules

**The test for every tier: a whole vehicle, never a part of one.** Bicycle, motorbike,
car, truck. Each one takes a person somewhere. Two wheels and an axle don't, however
well they're built. So every tier has to do a real job for someone, and the job gets
bigger. Tier 1 passes: nobody needs a counter, but a checklist a person fills and agents
check with a note does a real job ([0137](../../.decisions/0137-tier-1s-program-is-the-checklist.md);
it said notes that agents write and a person reads drawn). The counter was the test until 2026-11-11; the checklist takes that job
over, slice by slice, and the counter is removed
([0125](../../.decisions/0125-the-example-program-is-a-checklist.md)).

- **A tier fills every layer and every core idea.**
  - If a layer or a core idea gets nothing new, the tier says so and says why. It never just skips
    one ([0068](../../.decisions/0068-tiers-carry-every-part.md)).
- **A tier is done when its demo works everywhere.**
  - A browser tab and an Electron window, on the laptop and on Cloudflare.
- **Chaos grows with each tier.**
  - Each tier adds breakage for what it added, and the demo has to survive it.
- **Each tier can rework earlier work.**
  - Coming back to a layer is the plan, not a failure. The laws keep it safe.
- **Sort again at the end of each tier.**
  - Only the next tier gets a real plan. What a tier teaches moves what comes after it.
- **Tiers can be restructured freely.**
  - If a tier grows too big, it gets split. Size never pushes work out of a tier.
- **Every concern gets a tier and is never dropped.**
  - Anyone can raise one at any time. Known risks are sorted into tiers, and the list
    is kept private.
- **What's lost if not recorded stays in now.**
  - A later tier can add a feature. It can't add a fact to entries already written.

## Why, cost and how sure

- **Why:** every part stays connected and working, and no concern gets lost because it
  isn't in this tier.
- **Cost:** layers get reopened, so some Tier 1 code gets rewritten. A wide pass is also
  harder to review, so a tier can land as several pull requests. The slices grew Tier 1 by five
  rows so far, P39 to P43, and the agent slice's row is still to come.
- **How sure:** 85% on the shape. 60% on the order of Tiers 3 to 6. The doubt is whether
  agents should come before the second person. The owner's answer settles it.
- **The industry's names:** the thin first version is a walking skeleton (Alistair
  Cockburn). Lines across a map, each one a release, are Jeff Patton's release slices on
  a story map. His convention is now, next, later, which is why only Tier 1 is
  committed. These came from secondary sources, not the originals.

The rule behind all of it is [every update builds every layer](../direction/every-update-builds-every-layer.md).

## What this cannot tell us

- How big Tiers 2 to 7 are. Only Tier 1 has a size, and it's a guess. None of its six slices is
  sized yet.
- Whether a pass can stay this wide once programs get big. If it can't, the tier splits.
- Whether seven is the right number. Tier 1's real numbers and its lessons will say.

## What changed, and when

Git history keeps the old wording.

- 2026-11-01: Tier 1 approved; the keybindings and `themes` programs join Tier 2; the whole plan
  flow placed in Tier 6, 70%.
- 2026-11-05: `next/` no longer waits on today's paused pipeline, and Tier 1 is built by hand, row
  by row. GitHub is no keys source in Tier 3
  ([a key per client](../direction/a-key-per-client-and-no-github-trust.md)).
- 2026-11-06: Tier 1 builds a slice of C2 to C5, and the rest stays in Tier 4. The phone inbox
  moves earlier than Tier 7.
- 2026-11-07: Tier 3 becomes a few people, with roles, invites and phone approval moved up from
  Tier 7; the Tier 5 laws; full monitoring in Tier 1.
- 2026-11-08: a real domain moves from Tier 7 to install time; container jobs record run seconds
  from the first job.
- 2026-11-10, [0068](../../.decisions/0068-tiers-carry-every-part.md): each tier carries a working
  slice of every core idea, and four start early.
- 2026-11-10, [0069](../../.decisions/0069-choices-are-settings.md): loading settings moves from
  Tier 5 to Tier 1, as P38.
- 2026-11-10, [0075](../../.decisions/0075-cold-author-checks-outside-programs.md): each tier checks
  the outside programs slice with a cold agent as the author.
- 2026-11-10, [0078](../../.decisions/0078-agent-and-flow-slices-start-early.md): an agent fabrika
  starts and a flow fabrika runs join the core ideas, with slices from Tier 1.
- 2026-11-10, [0083](../../.decisions/0083-every-program-in-a-pack.md): Tier 5's repo programs are
  a repo's own pack, not `.fabrika/programs`; no tier moves.
- 2026-11-10, [0088](../../.decisions/0088-six-slices-in-tier-1.md): all six slices land in Tier 1,
  and P39 to P42 are added.
- 2026-11-11, [0102](../../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md) and
  [0103](../../.decisions/0103-a-program-may-mail-another-by-name.md): the shapes of the hands slice
  and of programs working together.
- 2026-11-11, [0111](../../.decisions/0111-merge-queue-stage-1-is-a-tier-1-row.md): the merge
  queue's first stage joins Tier 1 as P43, and Tier 6 hardens it.
- 2026-11-13, [0159](../../.decisions/0159-fabsh-summon-join-come-first.md): the next thing built is `fabsh`, `summon` and
  `join`, working for real, with whatever they need. Tier 1 changes to put them first, in its own
  pull request; no tier table above is changed yet.
