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
   It is a small change to `map`. The first try ended stuck. The pull requests of
   [the self-fix plan](./pipeline-self-fix.md) it waited on landed, and it restarted. It is saved
   at the exam's merge step until self-fix PRs 10 and 11 land.
3. **Switch to `next/`.** The owner approved what [Tier 1](./tier-1.md) builds on 2026-11-01.
   After ticket 117, that text goes through the planner as
   [a free-form plan](../direction/free-form-plan-to-planner.md), and the owner approves
   that plan before builders start. An agent then files each task as a ticket by hand, once, as
   a named exception. [PR 223](https://github.com/usirin/tea-fabrika/pull/223) and the rest get
   built through the pipeline, with one tracker ticket per pull request.

Also right after ticket 117, on today's version and beside Tier 1: remove `runs`, so `trace` becomes the ticket's view (ticket 141, which now holds 86, in build), then the performance program (ticket 114). They and Tier 1 do not
wait for each other. Past Tier 1, [seven tiers](./tiers.md) in all, the rest proposed.

Ticket numbers are this project's own tracker, not GitHub issues.

**The deal, decided 2026-10-31:** every pull request, `next/` or today's, goes through
today's pipeline programs. A step that cannot run yet goes by hand for that pull request
and is logged in `field/` ([the note](../direction/next-is-a-pipeline-pre-run.md)).

## Where we are now

Dated 2026-11-02. **No merged pull request has been built by the pipeline yet, so the deal
has not really started. `next/` has not moved since 2026-10-31.** Each line is about
today's version unless it says `next/`. The arrow says who has the next move.

**Product foundations are built now, not after ticket 117 (owner, 2026-11-03).** Decided notes
for today's app (tile guidelines and pipe colors, the design package and typography, themes,
keybindings, the inbox, the move to Manti) go to plan and build in parallel with the pipeline
work, so what is wrong shows early. Every "after ticket 117" below that holds one of them back no
longer holds. A plan that only builds a decided note is approved by the lead agent; one that
raises a new design call goes to the owner.

- **Pipeline v0.** Built and merged ([259](https://github.com/usirin/tea-fabrika/pull/259), [260](https://github.com/usirin/tea-fabrika/pull/260), [264](https://github.com/usirin/tea-fabrika/pull/264)). Two rehearsals on a throwaway repo, then ticket 117 (below). → the self-fix plan
- **[PR 267](https://github.com/usirin/tea-fabrika/pull/267), real answers.** Merged 2026-11-01. Its leftovers are ticket 125. → nothing
- **First real run, ticket 117.** Ran, and ended `stuck:step_stuck` at the mutation step: one stale test outside the exam (`tsh.test.ts` still expects `takes("map")` to be `[]`) made the suite red. The builder's own checks had died in its Codex box (`spawnSync git EPERM`) and it still said `done`; nothing in code checks a build before `done`, every `stuck` ends the lane, and no test output was kept. Its working copy `lane/117` is still on the machine; nothing was pushed, and the claim is released. → PRs 1, 3, 4, 5 and 7 of [the self-fix plan](./pipeline-self-fix.md) landed, and ticket 117 restarted; it is saved at `exam_merge` until PR 10 lands, and pauses at any hole PR 11 fixes until that lands too (owner, 2026-11-03). It was planned before PR 7, so its plan's properties, interface and gaps are not in the ledger. It reruns plan, the owner's yes, the test writer and build on a fresh branch from main, and the old build is kept under a ref (owner's yes 2026-11-02, on the walk of [311](https://github.com/usirin/tea-fabrika/pull/311))
- **The lane fixes itself, and a stuck lane restarts.** Decided 2026-11-01 ([jidoka and andon](../direction/jidoka-and-andon.md)): a person is asked only for a judgment, and a stuck or crashed lane restarts from the step that broke. The "after ticket 117" deferral is over. [The plan](./pipeline-self-fix.md) was nine by-hand pull requests, about 5 to 7 agent hours at the measured full-lane rate of 600 lines an agent hour (2 to 2.5 at this repo's 1,660), 4 to 5.5 of them before ticket 117 restarts ([agent hours](../direction/agent-hours.md), restated 2026-11-01; *old guess, wrong: 29 to 41.5, 22.5 to 32 before the restart*), with the rebase on restart from tracker ticket 130. It follows [the pipeline guidelines](../direction/pipeline-guidelines.md) ([PR 290](https://github.com/usirin/tea-fabrika/pull/290)): a restart that cannot prove a field goes back only to the step that writes it, every stop and every pick says where the lane goes on, a person's `stop` is a saved pause, a person may steer by a plain comment, red goes back by default, and the lane records wide from its first pull request. → approved 2026-11-01. Merged 2026-11-02: PR 1 ([301](https://github.com/usirin/tea-fabrika/pull/301)), PR 2 ([298](https://github.com/usirin/tea-fabrika/pull/298)) and PR 7 ([302](https://github.com/usirin/tea-fabrika/pull/302)). PR 3 merged 2026-11-02 ([304](https://github.com/usirin/tea-fabrika/pull/304)). PR 4 ([310](https://github.com/usirin/tea-fabrika/pull/310)) and PR 5 ([311](https://github.com/usirin/tea-fabrika/pull/311)) merged 2026-11-02. Ticket 117 restarted 2026-11-02 and is saved at `exam_merge`, where its exam pull request showed new holes. PRs 10 (the exam pull request, and a yes binds to the diff) and 11 (a route for every outcome, from [experiment 193](../../experiments/193-lane-holes.md)) build every row of the jidoka table still open, about 6 to 8 more agent hours. It restarts again once PR 10 lands, without waiting for PR 11 (owner, 2026-11-03). Next: the owner's yes on their text, then PR 10.
- **Tier 1 plan for `next/`.** What it builds was approved by the owner 2026-11-01, not started. About 17 to 24 agent hours at the measured rate of 600 lines an agent hour (6 to 9 at 1,660), restated 2026-11-01; *old guess, wrong: 63 to 92*. Later tiers stay proposed. After ticket 117 its text goes through the planner as [a free-form plan](../direction/free-form-plan-to-planner.md). The old approval does not cover the new breakdown. After the owner's yes, an agent files each task as [its own ticket](./tier-1.md#one-ticket-per-pull-request) by hand, logged in `field/`, and the owner approves each ticket's plan. → the owner approves the planner's plan, then builders start
- **[PR 223](https://github.com/usirin/tea-fabrika/pull/223), the first slice of `next/`.** Paused since 2026-10-31. Nothing from `next/` is on main. → it waits for the planner's output on Tier 1, which takes [Tier 1's order of work](./tier-1.md#the-order-of-work) as input. How it reaches the lane is [still open](./tier-1.md#still-open-how-next-reaches-the-lane)
- **[PR 258](https://github.com/usirin/tea-fabrika/pull/258), update everything.** Effect 4.1.1, pnpm 12. Merged 2026-11-01.
- **Test windows.** Merged: [257](https://github.com/usirin/tea-fabrika/pull/257) made them see-through, then [271](https://github.com/usirin/tea-fabrika/pull/271) made them show again, without focus. → nothing
- **App icon and top bar.** Merged ([274](https://github.com/usirin/tea-fabrika/pull/274), [275](https://github.com/usirin/tea-fabrika/pull/275)). → nothing
- **Window fixes, tracker tickets 141, 142 and 143.** 141 removes the `runs` program, so `trace` becomes the ticket's view; it now also holds tickets 84, 86 and 126. 142 brings Manti's ScrollArea scrollbars to the ticket and trace tiles. 143 fixes info mode (C-b i): visible words on the bottom line, `role=status`, and Escape leaves it. 143 merged 2026-11-02 ([PR 307](https://github.com/usirin/tea-fabrika/pull/307)). 141 is in build: `trace --ticket N` shows every lane of a ticket, and `tracker | trace` replaces `tracker | runs`. 142 is filed, not built. → pull requests through the pipeline, after ticket 117
- **[PR 192](https://github.com/usirin/tea-fabrika/pull/192), `claude` and `codex` as programs.** Closed 2026-11-01. Its write-up and lessons landed in [PR 303](https://github.com/usirin/tea-fabrika/pull/303); the code stays on its branch, to be rethought when a chat window needs it (Tier 5). → nothing
- **Pipe colors and tiles.** The rules are decided ([pipe colors](../direction/pipe-colors.md), [color principles](../direction/color-principles.md), [tile guidelines](../direction/tile-guidelines.md)), not built. The build is ticket 124. → a pull request through the pipeline, after ticket 117
- **Studies walked 2026-11-02.** The React tryout ([experiment 194](https://github.com/usirin/tea-fabrika/pull/320) carries it), [the DeepSeek repo](../../experiments/185-dsh-superagent-study.md) (its calls are in its "Since this was written"), [Windows](../direction/windows-in-next.md) (words decided). Themes was already decided ([themes](../direction/themes.md)). → the owner, only for who uses Windows daily
- **Shared tiles and talking to agents, walked 2026-11-04.** [Experiment 209](../../experiments/209-talking-to-agents-in-place.md) and five proposed notes: [shared tiles](../direction/shared-tiles.md), [inputs carry their sender](../direction/inputs-carry-their-sender.md), [talk where you work](../direction/talk-where-you-work.md), [principles](../direction/principles.md) and [pipeline strategies](../direction/pipeline-strategies.md), plus a [design language](../direction/design-language.md) draft. Decided in the walk: one kind of tile with agents summoned into it, and the direction that inputs carry their sender and writes their cause. [PR 381](https://github.com/usirin/tea-fabrika/pull/381) (an agent's own tile, and the `line` tool) is planned to land as it is (the lead agent's call), so ticket 117 can start through `line`; the shared tile replaces its own-tile kind after, and [PR 383](https://github.com/usirin/tea-fabrika/pull/383)'s hidden controls go. → the owner settles the proposed parts; then a build plan for today's version, envelope recording first
- **Two pieces of `next/` work this study asks for (proposed, the lead's recommendation).** (1) `next/src/data/log.ts`'s `Entry` has `at`, `by` and `said` but no `cause`: add it now, since an entry written without it never gets it back. (2) "A spot", a way for any program to name a thing on its screen, needs a design before talking at a spot can work. → the owner, then each goes into Tier 1's plan or its own ticket
- **Effect on Cloudflare, [experiment 174](../../experiments/174-effect-on-cloudflare.md).** Walked 2026-11-02, two rulings. [tea is the engine](../direction/tea-is-the-engine.md): no Effect `Workflow`, cluster not now. Tier 1 takes its one change: a wait is data on the socket, and a waiting tab stops knocking every 5 s ([Tier 1, Cloudflare](./tier-1-detail.md#cloudflare)). → nothing
- **demlik.** Epics landed, no release yet. The three issues that waited have rulings as of 2026-11-01: [756](https://github.com/kamp-us/demlik/issues/756#issuecomment-6564399911), [782](https://github.com/kamp-us/demlik/issues/782#issuecomment-6564266885) and [777](https://github.com/kamp-us/demlik/issues/777#issuecomment-6564371162). → demlik's agents build them, and the release stays the owner's call
- **Copying for the app and Tuval in `next/`.** Settled: rethink stays the default, with copies only where the owner names them. Tier 1 names three (styling, `programs/markdown`, the MCP tools; [Tier 1](./tier-1.md)). Tier 2's named copies come with its plan. → nothing now
- **Two people before agents in `next/`.** Settled by [the tier order](./tiers.md): two people is Tier 3, agents Tier 5. → nothing
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
- Reads each exam pull request. On today's lane, since [the self-fix plan](./pipeline-self-fix.md)'s PR 5 landed, a builder's diff to the exam files asks the owner, with two picks: the builder was wrong (the touched files go back, and build runs again on the builder's head) or the test is wrong (the test writer redoes those files with the owner's note). Either way every finished step is kept.
- Adds an entry to `unreachable-ledger.json`, in a change of its own.
- Says yes after reading `alchemy plan`, before a deploy to the cloud.
- Names each exception to "never copy across".
- Picks a side where Tuval or tmux clash with how Linear would build a screen.

**An agent, alone:**

- Decides which version a job is in when the brief says, or the rule in [AGENTS.md](../../AGENTS.md#two-versions-side-by-side) answers it. If it still cannot tell, it asks.
- Writes a note marked **proposed**, an experiment, or a field log.
- Files Tier 1's ticket, for the owner's GitHub id, after ticket 117 lands, and each task of its plan as a ticket once the owner approves that plan, with the existing tracker command, logged in `field/`: the agent running this project session does it. A named exception, once; no second project gets split by hand without the owner's yes.
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
