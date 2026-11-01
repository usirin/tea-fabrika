# The tiers: the whole plan for `next/`

**Tier 1 approved 2026-11-01. Tiers 2 to 7 proposed. Order of work set 2026-11-01.** All
the work on `next/` is one plan of seven tiers. Each tier is one pass across all five
layers, and each ends with something a person can use. No layer gets finished alone. Only
Tier 1 is committed. It has not started: today's pipeline finishes first and builds
ticket 117, and then it builds Tier 1
([where we are](./README.md#where-we-are-now)).

```text
                transport   data   coordination   app   desktop
Tier 1 works    ---------------------------------------------->  notes drawn as Markdown, written by agents through MCP
Tier 2 programs ---------------------------------------------->  your own tickets: fabsh, tracker | ticket
Tier 3 two      ---------------------------------------------->  a second person joins
Tier 4 hands    ---------------------------------------------->  hands take jobs: a Mac, a VM, a first tab (proposed split)
Tier 5 agents   ---------------------------------------------->  an agent does a job, a person watches (proposed split)
Tier 6 daily    ---------------------------------------------->  real tickets, today's version retires
Tier 7 others   ---------------------------------------------->  someone else can install it
```

## What each tier gives each layer

Tier 1 comes from [its plan](./tier-1.md). Tiers 2 to 7 are a first sorting, and they
will change. So is splitting the old Tier 4 into hands and agents, which makes seven.

| Tier | Transport | Data | Coordination | App | Desktop (Tuval) |
|---|---|---|---|---|---|
| **1. It works** | Signed hello, unknown keys refused, code and Approve, one-time link | Ledger behind a service; `granted` with `saw` and `as`; `denied`; revoke; each note's saved versions, with a check against stale saves; a backup sheet, recovery on a new Mac and `added` | Mailbox, who belongs, window and agent grants | Sealed programs, notes drawn as Markdown that agents write through MCP, each agent approved once, a counter as the test, chaos monkey | One core; Electron, browser and headless; menu bar with Approve and Remove |
| **2. First programs** | Nothing new: letters and picks use the same connection, and this tier tests that | Tickets as facts; a program's own storage (`keep`) holds its filter | Typed pipes between programs; Topic, so a program can read outside its inbox | Tracker as a picker, ticket, `fabsh` | A tile starts `fabsh`, a line opens in place, a tile can start from a saved line; the desk arrives as a program, with split, close and prefix keys |
| **3. Two people** | Invite and join, typed codes on Cloudflare, GitHub as a keys source | `knocked`, `joined` (`added` and the backup moved up to Tier 1's PR D2, settled by the owner) | Two members, removing a member, each person's windows | The tracker shared, who filed what, who may start chaos; notes shared, with comments | Join screen, Windows list, password helper for a docked Mac, releases through GitHub Actions |
| **4. Hands (proposed split)** | Hands as a client; how a client says it takes jobs | The queue, claims, leases | Mac and VM hands, work queues; mail delivery, leases, restarts and OTP calls (C2 to C5) | Secrets; `kill -9` from chaos through real hands, and `kill_brain` as a chaos button | Terminal tile; a first tab that runs a job |
| **5. Agents (proposed split)** | Agent keys and grants in real use | Spend, limits | Hands run agents | `claude` and `codex` programs, repo programs (`.fabrika/programs`, lean about 60%) | Chat tile (not a copy of regular chat; several branches of a conversation at once stays possible), asks list; the agent box |
| **6. Daily use** | Reconnect and offline, tested hard; D4's poke, the sync-engine note's T7 as a Sub | Moving data, keeping history cheap, paging | Pipeline stages, schedules | Pipeline and tracker views take jobs over one at a time; notes gain tabs, search and delete | Drag, zoom, workspaces, command palette, speed budgets; formatted typing in place for notes; native dialog and popover against Zag |
| **7. Others use it** | Phone as approver, QR, a real domain (a phone tab already works from Tier 1) | More than two people, roles, signing each letter | Other people's programs, kept apart, `limits: {cpuMs}` | How others write programs, packs; for notes: live co-editing, any CRDT, pages that run code in a box | Apple signing, auto-update, Windows and Linux |

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
