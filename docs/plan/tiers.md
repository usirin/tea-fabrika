# The tiers: the whole plan for `next/`

**Tier 1 approved 2026-11-01. Tiers 2 to 7 proposed. Order of work set 2026-11-01.** Walked when Tier 2 starts (owner, 2026-11-08): the first proposed tier's plan. All
the work on `next/` is one plan of seven tiers. Each tier is one pass across all five
layers, and each ends with something a person can use. No layer gets finished alone. Only
Tier 1 is committed. It started 2026-11-05 with its exam. *Changed 2026-11-05 by the owner:* `next/` no
longer waits on today's pipeline, which is paused. Tier 1 is built now by the lead
session's agents, by hand, with the pipeline's steps for each pull request, in
[37 small pull requests](./tier-1.md#the-pull-requests-one-at-a-time)
([where we are](./README.md#where-we-are-now)). As of 2026-11-11, 20 of its 43 rows are on main, plus P17a, half of P17, with P8 the last of them (*it said, as of 2026-11-09: 18 rows, P12 the last*); where the rest stand is in [the plan's state](./README.md#where-we-are-now). *It said: P1 to P4 and P5 done.* *It said: today's pipeline finishes first
and builds ticket 117, then Tier 1's plan goes through the planner and the pipeline builds
its tickets.* A tier is a project. The approval of 2026-11-01 covers what Tier 1 builds,
not its breakdown.

```text
                transport   data   coordination   app   desktop
Tier 1 works    ---------------------------------------------->  notes drawn as Markdown, written by agents through MCP
Tier 2 programs ---------------------------------------------->  your own tickets: fabsh, tracker | ticket
Tier 3 few      ---------------------------------------------->  a few people share one fabrika, from browsers and phones
Tier 4 hands    ---------------------------------------------->  hands take jobs: a Cloudflare container, a Mac, a VM, a first tab (proposed split)
Tier 5 agents   ---------------------------------------------->  an agent does a job, a person watches (proposed split)
Tier 6 daily    ---------------------------------------------->  real tickets, today's version retires
Tier 7 others   ---------------------------------------------->  someone else can install it
```

## What each tier gives each layer

Tier 1 comes from [its plan](./tier-1.md). Tiers 2 to 7 are a first sorting, and they
will change. So is splitting the old Tier 4 into hands and agents, which makes seven.

*Changed 2026-11-10 by [0068](../../.decisions/0068-tiers-carry-every-part.md):* each tier carries and
updates a working slice of every core idea. Four start late today and get a thin slice in an earlier
tier: hands (Tier 4), programs written outside fabrika's own source (Tiers 5 and 7), programs
working together (Tiers 2 and 4) and a person starting a program (Tier 2). Those tiers harden it.
*Changed 2026-11-10 by [0088](../../.decisions/0088-six-slices-in-tier-1.md):* each of the four lands
in Tier 1. *It said: which tier each slice lands in is not decided yet, so no row below has moved.*

*Changed 2026-11-10 by [0078](../../.decisions/0078-agent-and-flow-slices-start-early.md):* two more
core ideas join that list and get a thin slice in Tier 1: an agent fabrika starts (Tier 5) and a
flow fabrika runs (Tier 6). Tiers 5 and 6 still build them for real, the full pipeline stays in
Tier 6, and Tier 1's plan says how thin each is. No row below has moved.

*Changed 2026-11-10 by [0075](../../.decisions/0075-cold-author-checks-outside-programs.md):* each
tier checks its slice of programs written outside fabrika's source with a cold agent as the author.
Every place it gets stuck is a gap, and each run is an experiment (ticket 665).

*Changed 2026-11-10 by [0083](../../.decisions/0083-every-program-in-a-pack.md):* every program is in
a pack, so Tier 5's repo programs are a pack in the repo's `.fabrika/packs/<name>/`, not
`.fabrika/programs`. The tier each lands in does not move, so no row below has moved.

*Changed 2026-11-10 by [0088](../../.decisions/0088-six-slices-in-tier-1.md):* all six core ideas get
their thin slice in Tier 1, each as small as it can be and still work, with no stub. The four from
0068 are Tier 1 rows P39 to P42, to be planned; the outside programs slice builds 0083 and 0084 in
small, a repo's own pack listed by a `./` path. The tiers named above still build each for real, so
no row below has moved. Each slice's size, the order and whether Tier 1 splits are not decided.

| Tier | Transport | Data | Coordination | App | Desktop (Tuval) |
|---|---|---|---|---|---|
| **1. It works** | Signed hello, unknown keys refused, code and Approve, one-time link | Ledger behind a service; `granted` with `saw` and `as`; `denied`; revoke; each note's saved versions, with a check against stale saves; a backup sheet, recovery on a new Mac and `added`; email recovery on the cloud, with a 24-hour wait any device can cancel (decided 2026-11-06); full monitoring: each process's spans in a thin JobRecord, kept forever, raw health rows for about 2 weeks and hourly summaries forever, and nothing a chaos fault does left unexplained (owner, 2026-11-07) | Mailbox, who belongs, window and agent grants, every device a master with its grant tree; a slice of C2 to C5: dead letters, one crashed program restarted with a brake and backoff, exit, info and monitors, each start a new process with its own id, who is online, and the brain restarted (decided by the owner, 2026-11-06) | Sealed programs, notes drawn as Markdown that agents write through MCP, each agent approved once, a counter as the test, chaos monkey | One core; Electron, browser and headless; menu bar with Approve and Remove |
| **2. First programs** | Nothing new: letters and picks use the same connection, and this tier tests that | Tickets as facts; a program's own storage (`keep`) holds its filter | Typed pipes between programs; Topic, so a program can read outside its inbox | Tracker as a picker, ticket, `fabsh`; today's tracker tickets for `next/` work move onto the new ledger with nothing lost (who filed, when, comments, links), decided 2026-11-05; `ps` in `fabsh` shows STATUS, RESTARTS, DEAD and AGE, the shape of Kubernetes' `kubectl get pods`, and the trace view window waits on the ledger, never a 1-second poll (owner, 2026-11-07); health lines, the first use of [A2b](../direction/the-cloud-is-one-more-host.md)'s lines: a line on a health number (an object's size at 50% and 80% of 10 GB, a reader's lag that keeps growing, an error rate) fires one mail to the desk, once, when crossed, and a process `down` for an hour, or size at 95%, is an ask; spend reuses the same lines in Tier 5 (owner, 2026-11-07) | A tile starts `fabsh`, a line opens in place, a tile can start from a saved line; the desk arrives as a program, with split, close and prefix keys; the keybindings program; the `themes` program, and reading theme files |
| **3. A few people** ([why](#tier-3-is-a-few-people-owner-2026-11-07)) | Invite and join, typed codes on Cloudflare; an invite is a one-time link, also shown as a QR code for a phone to scan, that expires in a day, sent by an admin or the owner ([invites](#tier-3s-invites-owner-2026-11-07)); each new person comes in by invite and approval, the same flow as a new tab, and never because GitHub lists a key ([a key per client](../direction/a-key-per-client-and-no-github-trust.md), owner, 2026-11-05; this said GitHub as a keys source); a phone lets a friend in, since a tab with a user-verified passkey is a full device ([Tier 1's question 19](./tier-1.md#open-questions)) | `knocked`, `joined` (`added` and the backup moved up to Tier 1's PR D2, settled by the owner); more than two people, moved from Tier 7; one owner, admins and members, and who invited whom ([roles](#tier-3s-roles-owner-2026-11-07)) | Any number of members, removing a member, each person's windows | The tracker shared, who filed what, who may start chaos; notes shared, with comments | Join screen, Windows list, password helper for a docked Mac, releases through GitHub Actions |
| **4. Hands (proposed split)** | Hands as a client; how a client says it takes jobs | The queue, claims, leases; every container job records its run seconds and who started it, from the first job (owner, 2026-11-08, [experiment 229](../../experiments/229-browser-only-friends.md) row 31) | Cloudflare Container hands first: the host is a Durable Object and each job gets its own container ([local is the cloud](../direction/local-is-the-cloud.md), owner, 2026-10-25), and [experiment 148](../../experiments/148-remote-programs.md) ran real Claude Code in one; then Mac and VM hands; work queues; mail delivery, leases; the rest of C2 to C5: supervision trees, sibling strategies, links and trap exit, since Tier 1 has no process that starts another (owner, 2026-11-06; this said all of C2 to C5) | Secrets; `kill -9` from chaos through real hands, and `kill_brain` as a chaos button | Terminal tile; a first tab that runs a job |
| **5. Agents (proposed split)** | Agent keys and grants in real use | Spend, limits | Hands run agents | `claude` and `codex` programs, repo programs (`.fabrika/programs`, lean about 60%); two laws and a restart rule ([below](#tier-5-laws-decided-2026-11-07)) | Chat tile (not a copy of regular chat; several branches of a conversation at once stays possible), asks list; the agent box. *Noted 2026-11-05:* [talk where you work](../direction/talk-where-you-work.md) decided talk at a spot moves to one thread tile that opens only from a spot, and says this line changes with it once the note settles |
| **6. Daily use** | Reconnect and offline, tested hard; D4's poke, the sync-engine note's T7 as a Sub | Moving data, keeping history cheap, paging | Pipeline stages, schedules, and [the whole plan flow](#a-requirement-the-whole-plan-flow); the mutation queue, shaped like a merge queue: a pull request's leftover lines and a daily sweep in, survivors out as at most 3 tickets a day, Stryker on hands ([fast and daily mutation](../direction/fast-and-daily-mutation.md)) | Pipeline and tracker views take jobs over one at a time; notes gain tabs, search and delete | Drag, zoom, workspaces, command palette, speed budgets; formatted typing in place for notes; native dialog and popover against Zag |
| **7. Others use it** | A real domain moved to install time (owner, 2026-11-08) (a phone tab already works from Tier 1; phone as approver and the invite's QR code moved to Tier 3, owner, 2026-11-07) | Finer roles past owner, admin and member, such as read-only members, if any; signing each letter (more than two people and the three roles moved to Tier 3, owner, 2026-11-07) | Other people's programs, kept apart, `limits: {cpuMs}` | How others write programs, packs; for notes: live co-editing, any CRDT, pages that run code in a box | Apple signing, auto-update, Windows and Linux |

### Tier 3 is a few people (owner, 2026-11-07)

Tier 3 was "two people". It is now a small group, a few friends or a small company, sharing one
fabrika on one person's Cloudflare. Every one of them uses it only from a browser or a phone; setup
and deploy may still use a Mac. Why: the main browser case is a few friends on browsers and phones
([experiment 229](../../experiments/229-browser-only-friends.md)). So "more than two people" and
"phone as approver" left Tier 7. Roles finer than the three below stay in Tier 7. *A real domain
moved to install time on 2026-11-08 ([below](#tier-3s-address-mail-recovery-and-join-screen-owner-2026-11-08)).*

### Tier 3's roles (owner, 2026-11-07)

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

### Tier 3's invites (owner, 2026-11-07)

Decided by the owner in the product walk.

- **An invite is a one-time link,** also shown as a QR code, so a phone can scan it.
- **It expires in a day.**
- **An admin or the owner sends it,** by the roles above.
- **The ledger records the join:** "<person> joined", with who invited them.

### Tier 3's address, mail, recovery and join screen (owner, 2026-11-08)

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

### Tier 5 laws, decided 2026-11-07

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

*Added 2026-11-01: the keybindings program and the `themes` program joined Tier 2, decided by the owner; Tier 1 only reads their files. If Tier 2 grows too big, it splits, by the rule below.*

### A requirement: the inbox on a phone, early

Decided 2026-11-06 in the product walk (step 4): using fabrika from a phone is one of the owner's
first needs, so "phone as approver" does not wait for Tier 7. A small slice moves earlier: a browser
tab on the phone shows the inbox, answers asks and reaches a summoned agent (`@scout`), since the
brain keeps the alias and session ([talk where you work](../direction/talk-where-you-work.md)). Which
tier takes it is settled in the plan walk. It meets one open lean: a tab cannot approve (no, 70%),
and answering an ask is an approval, so that lean is the first thing the slice must settle.
*Settled 2026-11-07 (owner): yes, a tab with a user-verified passkey may approve
([Tier 1's question 19](./tier-1.md#open-questions)).*

### A requirement: the whole plan flow

Tier 6 in `next/`, since that is where its pipeline stages land. Decided 2026-11-01, 70%, since the order
of Tiers 3 to 6 is only proposed. It is built properly there:

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
bigger. Tier 1 passes: nobody needs a counter, but notes that agents write and a person
reads drawn do a real job. The counter stays as the test.

- **A tier fills every layer.**
  - If a layer gets nothing new, the tier says so and says why. It never just skips one.
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
  harder to review, so a tier can land as several pull requests.
- **How sure:** 85% on the shape. 60% on the order of Tiers 3 to 6. The doubt is whether
  agents should come before the second person. The owner's answer settles it.
- **The industry's names:** the thin first version is a walking skeleton (Alistair
  Cockburn). Lines across a map, each one a release, are Jeff Patton's release slices on
  a story map. His convention is now, next, later, which is why only Tier 1 is
  committed. These came from secondary sources, not the originals.

The rule behind all of it is [every update builds every layer](../direction/every-update-builds-every-layer.md).

## What this cannot tell us

- How big Tiers 2 to 7 are. Only Tier 1 has a size, and it's a guess.
- Whether a pass can stay this wide once programs get big. If it can't, the tier splits.
- Whether seven is the right number. Tier 1's real numbers and its lessons will say.
