# The plan

Start here. Where this project is going, where it is today, and what to read for your
job. Two minutes.

## The one idea

Two versions live side by side. Today's version keeps running for daily use. The new one
grows in `next/`, on [the five layers](../direction/a-local-first-sync-engine.md). When
the new one takes a job over, the pull request that switches deletes the old part.

```text
next/             what we are building, on the decisions in docs/direction
everything else   what we use today, and a map of which jobs exist
```

## Where we want to go

Order set 2026-11-01: finish the pipeline, watch it build a real ticket, then switch to
`next/`.

1. **Land [PR 267](https://github.com/usirin/tea-fabrika/pull/267).** Today's pipeline
   learns to handle what real agents answer. Done 2026-11-01.
2. **Run ticket 117 for real.** The pipeline builds it, and the owner watches in the app.
   It is a small change to `map`. The first try ended stuck; it restarts once
   [the self-fix plan](./pipeline-self-fix.md) lands.
3. **Switch to `next/`.** The owner approved [the Tier 1 plan](./tier-1.md) on 2026-11-01.
   After ticket 117, [PR 223](https://github.com/usirin/tea-fabrika/pull/223) and the rest
   get built through the pipeline, with one tracker ticket per pull request.

Also right after ticket 117, on today's version and beside Tier 1: rename `runs` to
`timeline` (ticket 86), then the performance program (ticket 114). They and Tier 1 do not
wait for each other. Past Tier 1, [seven tiers](./tiers.md) in all, the rest proposed.

Ticket numbers are this project's own tracker, not GitHub issues.

**The deal, decided 2026-10-31:** every pull request, `next/` or today's, goes through
today's pipeline programs. A step that cannot run yet goes by hand for that pull request
and is logged in `field/` ([the note](../direction/next-is-a-pipeline-pre-run.md)).

## Where we are now

Dated 2026-11-01. **No merged pull request has been built by the pipeline yet, so the deal
has not really started. `next/` has not moved since 2026-10-31.** Each line is about
today's version unless it says `next/`. The arrow says who has the next move.

- **Pipeline v0.** Built and merged ([259](https://github.com/usirin/tea-fabrika/pull/259), [260](https://github.com/usirin/tea-fabrika/pull/260), [264](https://github.com/usirin/tea-fabrika/pull/264)). Two rehearsals on a throwaway repo, then ticket 117 (below). → the self-fix plan
- **[PR 267](https://github.com/usirin/tea-fabrika/pull/267), real answers.** Merged 2026-11-01. Its leftovers are ticket 125. → nothing
- **First real run, ticket 117.** Ran, and ended `stuck:step_stuck` at the mutation step: one stale test outside the exam (`tsh.test.ts` still expects `takes("map")` to be `[]`) made the suite red. The builder's own checks had died in its Codex box (`spawnSync git EPERM`) and it still said `done`; nothing in code checks a build before `done`, every `stuck` ends the lane, and no test output was kept. Its working copy `lane/117` is still on the machine; nothing was pushed, and the claim is released. → the owner says yes or no to [the self-fix plan](./pipeline-self-fix.md), then ticket 117 restarts from its own state
- **The lane fixes itself, and a stuck lane restarts.** Decided 2026-11-01 ([jidoka and andon](../direction/jidoka-and-andon.md)): a person is asked only for a judgment, and a stuck or crashed lane restarts from the step that broke. The "after ticket 117" deferral is over. [The plan](./pipeline-self-fix.md) is six by-hand pull requests, about 16.5 to 24 agent hours, with the rebase on restart from tracker ticket 130. → the owner's yes on the plan
- **Tier 1 plan for `next/`.** Approved by the owner 2026-11-01, not started. Later tiers stay proposed. Each pull request gets [its own ticket](./tier-1.md#one-ticket-per-pull-request), and the owner approves that ticket's plan. → builders start after ticket 117
- **[PR 223](https://github.com/usirin/tea-fabrika/pull/223), the first slice of `next/`.** Paused since 2026-10-31. Nothing from `next/` is on main. → an agent rebases it after the exam pull request, as [Tier 1's order of work](./tier-1.md#the-order-of-work) says. How it reaches the lane is [still open](./tier-1.md#still-open-how-next-reaches-the-lane)
- **[PR 258](https://github.com/usirin/tea-fabrika/pull/258), update everything.** Effect 4.1.1, pnpm 12. Needs a rebase and a recheck. → an agent, after ticket 117
- **Test windows.** Merged: [257](https://github.com/usirin/tea-fabrika/pull/257) made them see-through, then [271](https://github.com/usirin/tea-fabrika/pull/271) made them show again, without focus. → nothing
- **App icon and top bar.** Merged ([274](https://github.com/usirin/tea-fabrika/pull/274), [275](https://github.com/usirin/tea-fabrika/pull/275)). → nothing
- **[PR 192](https://github.com/usirin/tea-fabrika/pull/192), `claude` and `codex` as programs.** Overlaps pipeline v0. → the owner says yes or no; on a yes, an agent merges
- **Pipe colors and tiles.** The rules are decided ([pipe colors](../direction/pipe-colors.md), [color principles](../direction/color-principles.md), [tile guidelines](../direction/tile-guidelines.md)), not built. The build is ticket 124. → a pull request through the pipeline, after ticket 117
- **Studies done, not walked yet.** React tryout, themes, [the DeepSeek repo](../../experiments/185-dsh-superagent-study.md), [Windows](../direction/windows-in-next.md), Effect on Cloudflare. → the owner
- **demlik.** Epics landed, no release yet. The three issues that waited have rulings as of 2026-11-01: [756](https://github.com/kamp-us/demlik/issues/756#issuecomment-6564399911), [782](https://github.com/kamp-us/demlik/issues/782#issuecomment-6564266885) and [777](https://github.com/kamp-us/demlik/issues/777#issuecomment-6564371162). → demlik's agents build them, and the release stays the owner's call
- **Copying for the app and Tuval in `next/`.** Lean, 70%: rethink stays the default, plus a named Tier 2 copy list. → the owner decides
- **Two people before agents, Tier 3 before Tier 5 in `next/`.** Lean yes, 70%. → the owner answers
- **Conversation branches.** Saved, not designed. → when the agents tier is next
- **Left for later.** The third step of going through the two trackers with the owner, and whether popovers use the browser's own `<dialog>` or a library.

## What to read for your job

| Your job | Read |
|---|---|
| Fix today's version | [AGENTS.md](../../AGENTS.md), the [package list](../../README.md#what-is-in-this-repository), then that part's own README |
| Build in `next/` | [Tier 1](./tier-1.md) and [ticket 115's plan](./ticket-115.md), [the steps](../direction/next-is-a-pipeline-pre-run.md), the [Start here list](../direction/README.md#start-here). No builder starts before an approved plan and tests that exist |
| Run a real ticket | [Run a ticket through the pipeline](../how-to/run-a-pipeline-ticket.md), [AGENTS.md's rules](../../AGENTS.md#running-the-machine-on-a-real-ticket), then [field/](../../field/README.md) for what past runs hit |
| Write down a decision | A note in [docs/direction](../direction/README.md), the same day, plus its row. Mark it **proposed** until it is settled |
| Log a run | [field/README.md](../../field/README.md) for the schema: one row per agent run, one note per thing that broke, cost too much, needed a person or worked well |

## Who decides what

**Only the owner:**

- Approves a plan, in `next/` or today's, before any builder starts.
- Approves a pull request, and answers a question the machine put to a person. No agent does either. Rows that only record what happened need no yes: see [how a change lands](#how-a-change-lands).
- Answers [how `next/` reaches the lane](./tier-1.md#still-open-how-next-reaches-the-lane), before PR A's plan step (lean 65%).
- Settles a **proposed** note.
- Reads each exam pull request. On today's lane, a builder's diff to the exam files ends the lane stuck: nothing the build did is kept, and the owner hears why.
- Adds an entry to `unreachable-ledger.json`, in a change of its own.
- Says yes after reading `alchemy plan`, before a deploy to the cloud.
- Names each exception to "never copy across".
- Picks a side where Tuval or tmux clash with how Linear would build a screen.

**An agent, alone:**

- Decides which version a job is in when the brief says, or the rule in [AGENTS.md](../../AGENTS.md#two-versions-side-by-side) answers it. If it still cannot tell, it asks.
- Writes a note marked **proposed**, an experiment, or a field log.
- Files Tier 1's tracker tickets, for the owner's GitHub id, after ticket 117 lands: the agent running this project session does it.
- Fixes a dead-code finding it checked by hand. If the finding is wrong, it stops and tells the owner.
- Makes calls inside an approved plan, marked as its own call, with why, cost and how sure. The owner may overturn them.
- Adds a lint exception on a line where the code is right and the rule does not fit, with the reason in plain words. It never switches a rule off to pass.

In a live run on a target repository, never, by anyone's agent: merge by hand, arm auto-merge, or push to its main. Once a lane is finished and stuck, [what is left is a by-hand change](#how-a-change-lands).

## How a change lands

- **A live run on a target repository:** inside the run, nothing but ship merges. Once a lane is finished and stuck, what is left is a by-hand change, under the next rule.
- **A pull request that went by hand:** the owner's yes, with CI green for code. Then an agent runs the merge, after a leak grep.
- **Rows that only record what happened (field logs, index rows):** they merge after the leak grep, with no yes.
- **Direction notes and plans:** they still get the owner's yes.
- **A pull request that changes only Markdown or images:** no CI wait, since nothing in CI reads them. A broken relative link can slip through.
- **To bring a branch up to date:** rebase and force-push with a lease, never a merge commit or `gh pr update-branch`. Linear history, and the diff's `git patch-id --stable` stays the same, so a review of that diff holds. Checks still rerun on the final commit.
- **After every merge:** fast-forward the main checkout (`git pull --ff-only origin main`). Never reset or stash there; your own work stays in worktrees.

## Words

- **lane:** one ticket's whole trip through the steps, held by one machine.
- **step:** one stage of a lane, such as triage or build.
- **exam:** what a change is checked against: tests, laws, lint and CI rules. The builder never changes it.
- **laws:** rules a machine must keep, checked on its real reducer across many orders of messages.
- **box:** the sandbox a program or agent runs in.
- **walk:** going through something with the owner, step by step.
- **Tuval:** the codename of the desktop layer in `next/`, the package `@kampus/tuval`. Users see "fabrika".
- **demlik:** the repository [kamp-us/demlik](https://github.com/kamp-us/demlik), home of `@demlik/tea` and `@demlik/code-graph`.
- **Jev:** a small classifier that answers one narrow question, cheaper and faster than a big model.
- **brain:** in `next/`, the place programs run and the ledger lives, on a laptop or on Cloudflare.
- **hands:** in `next/`, the process on a computer that does machine work for the brain, such as git and agents.
- **ledger:** the append-only record of facts. Everything else folds from it.
- **fold:** to work a state out by reading the facts in order. For a tile, to shrink it to a thin strip.
- **slice:** one thin piece of work that goes through every layer.
- **leak grep:** a text search of a change's added lines for keys, machine paths and names, before it lands in this public repository.
- **ratchet:** a limit that only tightens.
- **tsh:** today's shell, which runs only tea programs. In `next/` the shell is `fabsh`.
- **tile:** one pane in the app's window.
- **claim:** a lane's hold on a ticket, on the ledger, so no second lane runs it.
- **pinned merge:** a merge that names the main it read, so a newer commit on main stops it.
- **`@kampus/pipeline`:** the library in `packages/pipeline`, today's stages and services.
- **`@tea-fabrika/pipeline`:** the program in `programs/pipeline`, the line a person types.

## Keeping this true

When the plan or its state changes, this file changes in the same pull request or the same
day. A stale line here costs every agent that reads it.

## What this file cannot tell us

- What changed after its date. Check the pull requests it links.
- Whether the tiers past Tier 1 hold. They are a proposal.
