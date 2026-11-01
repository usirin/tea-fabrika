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
   learns to handle what real agents answer.
2. **Run ticket 117 for real.** The pipeline builds it, and the owner watches in the app.
   It is a small change to `map`.
3. **Switch to `next/`.** The owner approves [the Tier 1 plan](./tier-1.md). Then
   [PR 223](https://github.com/usirin/tea-fabrika/pull/223) and the rest get built through
   the pipeline.

After ticket 117, on today's version: rename `runs` to `timeline` (ticket 86), then the
performance program (ticket 114). Past that, [seven tiers](./tiers.md), proposed.

Ticket numbers are this project's own tracker, not GitHub issues.

**The deal, decided 2026-10-31:** every pull request, `next/` or today's, goes through
today's pipeline programs. A step that cannot run yet goes by hand for that pull request
and is logged in `field/` ([the note](../direction/next-is-a-pipeline-pre-run.md)).

## Where we are now

Dated 2026-11-01. **No merged pull request has been built by the pipeline yet, so the deal
has not really started. `next/` has not moved since 2026-10-31.** Each line is about
today's version unless it says `next/`. The arrow says who has the next move.

- **Pipeline v0.** Built and merged ([259](https://github.com/usirin/tea-fabrika/pull/259), [260](https://github.com/usirin/tea-fabrika/pull/260), [264](https://github.com/usirin/tea-fabrika/pull/264)). Two rehearsals on a throwaway repo. No real ticket yet. → nothing, until ticket 117
- **[PR 267](https://github.com/usirin/tea-fabrika/pull/267), real answers.** Not merged. A review found a blocker, and CI is red. → an agent fixes it, then a mutation run and a new review, then the owner's yes
- **First real run, ticket 117.** Waits on 267. → then the owner answers two questions: may `pipeline.json` go in the app's real home, and may this first run go without a box (lean yes, 75%)
- **Tier 1 plan for `next/`.** Written, not approved. → after ticket 117, the owner approves
- **[PR 223](https://github.com/usirin/tea-fabrika/pull/223), the first slice of `next/`.** Paused since 2026-10-31. Nothing from `next/` is on main. → an agent rebases it after the plan is approved
- **[PR 228](https://github.com/usirin/tea-fabrika/pull/228), every update builds every layer (`next/`).** Docs. → the owner's merge
- **This plan folder and the notes it brought up to date.** Docs. → the owner's merge
- **[PR 258](https://github.com/usirin/tea-fabrika/pull/258), update everything.** Effect 4.1.1, pnpm 12. Needs a rebase and a recheck. → an agent, after ticket 117
- **[PR 257](https://github.com/usirin/tea-fabrika/pull/257), test windows you can't see.** Green. → the owner's merge
- **[PR 192](https://github.com/usirin/tea-fabrika/pull/192), `claude` and `codex` as programs.** Overlaps pipeline v0. → the owner: merge, yes or no
- **Pipe colors.** Picked, not built. → a pull request through the pipeline
- **Studies done, not walked yet.** React tryout, themes, the DeepSeek repo, [Windows](../direction/windows-in-next.md), Effect on Cloudflare. → the owner
- **demlik.** Epics landed, no release yet. Issues 756, 782 and 777. → the owner
- **Copying for the app and Tuval in `next/`.** Lean, 70%: rethink stays the default, plus a named Tier 2 copy list. → the owner decides
- **Two people before agents, Tier 3 before Tier 5 in `next/`.** Lean yes, 70%. → the owner answers
- **Conversation branches.** Saved, not designed. → when the agents tier is next
- **Left for later.** The third step of the two trackers walk, and native `<dialog>` against Zag.

## What to read for your job

| Your job | Read |
|---|---|
| Fix today's version | [AGENTS.md](../../AGENTS.md), the [package list](../../README.md#packages), then that part's own README |
| Build in `next/` | [Tier 1](./tier-1.md) and [ticket 115's plan](./ticket-115.md), [the steps](../direction/next-is-a-pipeline-pre-run.md), the [Start here list](../direction/README.md#start-here). No builder starts before an approved plan and tests that exist |
| Run a real ticket | [AGENTS.md's rules](../../AGENTS.md#running-the-machine-on-a-real-ticket), then [field/](../../field/README.md) for what past runs hit |
| Write down a decision | A note in [docs/direction](../direction/README.md), the same day, plus its row. Mark it **proposed** until it is settled |
| Log a run | [field/README.md](../../field/README.md) for the schema: one row per agent run, one note per thing that broke, cost too much, needed a person or worked well |

## Who decides what

**Only the owner:**

- Approves a plan, in `next/` or today's, before any builder starts.
- Approves a pull request, and answers a question the machine put to a person. No agent does either.
- Settles a **proposed** note.
- Reads each exam pull request. Any diff to the exam files stops the build and asks the owner.
- Adds an entry to `unreachable-ledger.json`, in a change of its own.
- Says yes after reading `alchemy plan`, before a deploy to the cloud.
- Names each exception to "never copy across".
- Picks a side where Tuval or tmux clash with how Linear would build a screen.

**An agent, alone:**

- Decides which version a job is in when the brief says, or the rule in [AGENTS.md](../../AGENTS.md#two-versions-side-by-side) answers it. If it still cannot tell, it asks.
- Writes a note marked **proposed**, an experiment, or a field log.
- Fixes a dead-code finding it checked by hand. If the finding is wrong, it stops and tells the owner.
- Makes calls inside an approved plan, marked as its own call, with why, cost and how sure. The owner may overturn them.
- Adds a lint exception on a line where the code is right and the rule does not fit, with the reason in plain words. It never switches a rule off to pass.

Never, by anyone's agent: merge by hand, arm auto-merge, or push to a target repository's main. A change lands only through the ship stage.

## Keeping this true

When the plan or its state changes, this file changes in the same pull request or the same
day. A stale line here costs every agent that reads it.

## What this file cannot tell us

- What changed after its date. Check the pull requests it links.
- Whether the tiers past Tier 1 hold. They are a proposal.
