# 107. A repo that is not demlik

The question: does the pipeline assume demlik's setup (step S9)?

- demlik has pnpm, CI on GitHub, a merge queue, CODEOWNERS, `.fabrika.jsonc`,
  labels and a CLAUDE.md. A run took each of them for granted somewhere.
- The target here is a fresh sandbox repo (written `<sandbox>` below):
  private, free plan, a tiny TypeScript project tested with `npm test`
  (Node's own runner). It has none of the above: no CI, no merge queue, no
  rulesets, no branch protection, no CODEOWNERS, no `.fabrika.jsonc`, no
  labels, no CLAUDE.md or AGENTS.md.
- For fabrika, only two files were written: `fabrika.toml` in the repo and
  `tsh.toml` on this machine.

**Answer: it did, in 27 places we found, and now it does not. Each one is a
named default or a named refusal, printed at start. The fresh npm repo went
plan to merged pull request with real agents, three times. Two faults (main
moved before the merge) were stopped and caught up by merge. The merge-queue
run could not happen: GitHub refuses a merge queue on this repo.**

- Pass run: one ticket, planned, approved on the desk, built, reviewed and
  merged in 49 seconds of operate. The pull request is marked merged and its
  `Closes #1` closed the issue.
- Gate run: operate on a ticket whose plan was not approved yet ended
  `skip:not_ready`, with no agent run and no pull request.
- Fault run 1: a commit landed on main between the door's read and the
  merge write. The merge answered `behind`. The builder took main in by a
  merge, and round 2 merged onto the new main. No rebase, no force-push.
- Fault run 2: a commit landed on main just before ship read the pull
  request. The merge door answered `behind`, and the same catch-up merged.
- Merge-queue run: not run. Both ways to turn a queue on answer HTTP 403,
  "Upgrade to GitHub Pro or make this repository public to enable this
  feature." The org is on the free plan.
- The real runs found 1 bug the tests could not (GitHub's REST rules read is
  refused on a free private repo). The harness's table found 1 more (a
  rubrics folder taken as the repo's pick when the file named none). Both
  are fixed.
- Spend: about $0.27 at most, against a $5 cap.

Confidence 80%. The doubts are under "Holes".

## What a repo can now say in fabrika.toml

All of it is Effect Schema (`packages/fabrika/src/pipeline/settings.ts`).

```toml
packs = ["@tea-fabrika/owner-desk"]

[agents.build]            # also [agents.plan] and [agents.review]
model = "haiku"
effort = "low"
usd = 0.8                 # the most one run may cost

[build]
go = "plan"               # or "label", with label = "..."
install = ["npm", "ci"]   # [] runs nothing
checks = [["npm", "test"]]

[review]
rubrics = "docs/rubrics"  # in the repo, at main
governed = [".github/"]   # read only where there is no .fabrika.jsonc
ui = []

[checks]
github = "none"           # every | required | none
[[checks.run]]            # fabrika runs it itself, at each head
name = "test"
run = ["npm", "test"]

[ship]
approval = "none"         # codeowners | none

[ledger]
at = "local"              # local | sqlite
```

- **Every key may be left out.** What a left-out key means is picked once,
  at the edge, from three places (`setup.ts`):
  - the repo's `fabrika.toml`;
  - this machine's `tsh.toml`: a fallback model, effort and budget for any
    agent step, and a rubrics folder;
  - what the repo holds at the same commit: its lockfile, CODEOWNERS,
    `.fabrika.jsonc`, CLAUDE.md, AGENTS.md, a workflow folder.
- **The run prints every pick**, one line each, under the line that says
  where `fabrika.toml` was read, and says where each came from. The pass
  run's start:

  ```text
  fabrika.toml: <sandbox>@main (7c14ebd)
    agents.build: haiku (from fabrika.toml), effort low (from fabrika.toml), at most $0.8 a run (from fabrika.toml)
    build.go: plan (default): a ticket is built only once the owner approved its plan on the ledger; labels are not read
    build.install: npm ci (default: package-lock.json at main)
    build.checks: npm test (default: the [[checks.run]] commands)
    rules: CLAUDE.md none at main: agents are told the repository has none
    review.rubrics: <fabrika>/rubrics (default: the rubrics fabrika ships)
    review kinds: no .fabrika.jsonc at main, so governed [] and ui [] (default): text reviews only
    checks.github: none (from fabrika.toml): GitHub's checks do not count
    checks.run: test = npm test (from fabrika.toml): run by fabrika at each head, in a copy of it, with no login in reach
    ship.approval: none (from fabrika.toml): no approval is asked for, unless a .github/CODEOWNERS at a change's base names an owner, which still binds
    ledger.at: local (default)
  ```

- **A pick that will stop a run later says so at the start**, and names the
  key that changes it. With no CI and no `[[checks.run]]`: "checks wait for
  ever: add a [[checks.run]]". With no CODEOWNERS and approval left out:
  "ship stops at approval_unknown. Say [ship] approval = "none" when no
  approval is needed".
- **A pick that says nothing is refused** when the file is read, and the
  message names the key: a label with `go = "plan"` (nobody would read it);
  `github = "none"` with no `[[checks.run]]` (a change would pass on no
  check); a rubrics folder that leaves the repo; an agent step that is not
  one; a budget of 0.

## Every assumption, and what it prints now

The 27 rows of the table are fixtures in `107-a-repo-that-is-not-demlik.ts`
(`ONLY=table`): 27 of 27 give their line or refusal, 0 crash. The last four
rows were found live.

| What a run took for granted | What it does now |
|---|---|
| pnpm installs a fresh copy | `build.install: npm ci (default: package-lock.json at main)`; yarn and bun the same way |
| a repo has a lockfile | `build.install: none (default: no lockfile at main)` |
| one lockfile only | the first, and `also <file>, not read` |
| the builder knows the check commands | `build.checks: none named (default): the builder is told to find the repository's checks itself` |
| the repo's own checks | `build.checks: npm test (from fabrika.toml)`; else the `[[checks.run]]` commands |
| the `ready-for:agent` label lets a ticket be built | `build.go: plan (default)`: only an approved plan on the ledger; labels are not read |
| a repo that keeps the label | `build.go: label (from fabrika.toml): a ticket is built when it carries <label>` |
| a label and a plan both read | refused: `build.label` |
| one model, effort and budget for every agent | `agents.<step>: <model> (from ...), effort <e> (from ...), at most $<n> a run (from ...)`, fabrika.toml over tsh.toml over the default |
| an agent step nobody wrote | `agents.plan: opus (default), effort medium (default), at most $2 a run (default)` |
| an agent step that is not one | refused: `agents` |
| a budget of nothing | refused: `agents.build.usd` |
| CI on GitHub reports the checks | `checks.github: every (default): no .github/workflows at main and no [[checks.run]], so ... checks wait for ever: add a [[checks.run]]` |
| fabrika runs the checks itself where there is no CI | `checks.run: test = npm test (from fabrika.toml): run by fabrika at each head` |
| no check at all counts as passing | refused: `checks` (`github = "none"` with no `[[checks.run]]`) |
| a CODEOWNERS file says whose approval | `ship.approval: codeowners (default), but no .github/CODEOWNERS at main: ship stops at approval_unknown` |
| CODEOWNERS at the root counts | `(CODEOWNERS is not read)` in the same line |
| a repo that needs no approval | `ship.approval: none (from fabrika.toml)`; a `.github/CODEOWNERS` at a change's base still binds |
| `.fabrika.jsonc` says which reviews a change owes | `review kinds: no .fabrika.jsonc at main, so governed [] and ui [] (default): text reviews only` |
| the governed paths, with no `.fabrika.jsonc` | `governed [.github/] and ui [] (from fabrika.toml)` |
| rubrics are a folder on this machine | `review.rubrics: <fabrika>/rubrics (default: the rubrics fabrika ships)` |
| a repo's rubric folder holds every kind | `review.rubrics: doc.md is not in the repository's folder: a change of that kind stops at rubric_unknown` |
| a rubric folder outside the repo | refused: `review.rubrics` |
| CLAUDE.md holds the rules for agents | `rules: CLAUDE.md none at main: agents are told the repository has none` (AGENTS.md the same) |
| the ledger is the Durable Object on this machine | `ledger.at: local (default)` |
| a repo that keeps its ledger in a file | `ledger.at: sqlite (from fabrika.toml)`, and tsh opens the node:sqlite file |
| a ledger nobody has | refused: `ledger.at` |
| *live:* the planner reads the clone's HEAD | plan reads the code at `origin/main` as fetched when it is told the ticket (`stages/plan/at-main.ts`); the session names the commit |
| *live:* GitHub's merge is safe with no queue | the merge is pinned to the tested main where GitHub holds no rule; elsewhere GitHub's merge, as before |
| *live:* GitHub answers the REST rules read | it answers 403 on a free private repo; the rules are read as GraphQL `ref.rules`, which answers there |
| *live:* a merge queue can be turned on | it cannot here: 403, recorded below |

## How unknown is kept from reading as a pass

Where a type can carry it, it does. A test then pins the rest.

- **Lookup tables with a row for every reading.** The ship gate's approval
  and checks readings are `{[A in ShipFacts["approval"]]: ...}` tables
  (`stages/ship/gate.ts`): a reading added later does not compile until it
  has a row, and `unknown` maps to a stop. The local checks join the same
  way (`SHIP_OF` in `local-checks.ts`: `unknown` is `stuck`).
- **The plan gate's state is `none | not_approved | approved | unknown`**
  (`stages/build/ticket.ts`). A ledger that cannot be read is `unknown`, and
  `unknown` is `stuck:read_failed`, never a go.
- **A pick carries where it came from** (`Picked<A>` = value and `from`), so
  a line cannot print a value without its source.
- **A local check run needs at least one check**
  (`readonly [RunCheck, ...RunCheck[]]`): "checks counted from nothing" does
  not typecheck.
- **The rubrics pick comes from fabrika.toml only.** The edge hands in the
  folder it writes the repo's texts into, always; whether it is read is
  `[review] rubrics`, not whether a folder was handed in. The harness caught
  the first version taking any folder handed in as the pick.

## The runs

Real haiku agents (effort low; plan $0.5, build $0.8, review $0.5 a run),
every run labelled `real`. The tsh lines, from a folder holding a `tsh.toml`
that names the sandbox repo, `own` (the account that opens pull requests),
and `ship = "write"`:

```text
plan ticket=<ticket url> | desk
answer --ask 'plan:<sandbox>#<n>@1' --reply /approve
operate ticket=<ticket url>
```

- `plan | desk` is new: the desk takes plans piped in and keeps each as an
  ask for the owner (`tsh/desk.ts`). `plan` is new in fabrika's tsh too,
  listed beside the live review.

**Pass run** (ticket 1, pull request 2):

- plan read the code at main `7c14ebd` and wrote 1 task, 4 criteria. The
  desk showed `plan:...#1@1`; `/approve` took it.
- operate: build ran `npm ci`, then the builder, told `npm test`. It opened
  the pull request with `Closes #1`. Review: open 0. Ship: fabrika ran
  `npm ci` and `npm test` itself at the head (green), approval not needed,
  merge.
- The merge commit `54bfad2` has parents `7c14ebd` (the tested main) and
  `35a494c` (the head). GitHub marked the pull request merged and closed the
  issue. 49 seconds, start to end.

**Gate run** (ticket 3, before its approval): `skip:not_ready`, 0 agent
runs, 0 pull requests. No Claude token was even in reach.

**Fault run 1: main moved between the door's read and the merge write**
(ticket 3, pull request 4):

- A `gh` first on PATH landed commit `e5932f5` on main the first time ship
  made a merge commit, just before it.
- The merge commit was made on `54bfad2`, the tested main. GitHub refused
  to move main to it (`force: false`, not a fast-forward). Ship read the
  branch: the tip was neither the new commit nor the tested main, and the
  head was not in it, so `behind`.
- operate sent the builder back (`send:builder:behind`). Build merged
  `origin/main` into the branch (`9471130`, parents `cbf7faa` and
  `e5932f5`), round 2's builder ran, review read the new head, ship ran the
  tests again at it, and the merge `92b9dbd` landed on `e5932f5`.
- 0 rebases, 0 force-pushes. 106 seconds.

**Fault run 2: main moved before the merge door's read** (ticket 5, pull
request 6):

- The `gh` landed commit `dcf37d7` the first time ship read the pull
  request's facts.
- The door read main fresh, found it moved past the main the head was
  tested on, and answered `behind`. The same catch-up followed; the merge
  `ba8fc8e` landed on `dcf37d7`. 103 seconds.

**Merge-queue run: not run.**

- `POST repos/<sandbox>/rulesets` with a
  `merge_queue` rule: `HTTP 403 Upgrade to GitHub Pro or make this
  repository public to enable this feature.`
- `PUT .../branches/main/protection`: the same 403.
- The org's plan reads `free`. A merge queue on a private repo needs the
  org on GitHub Enterprise Cloud; a public sandbox would have one. Neither
  was done: the brief said private, and not to change other repos.

## Spend

- The SDK reported $0.018 for the 5 builder runs and $0.0099 for the 5
  reviewer runs.
- The planner and builder sessions, priced from their tokens at haiku list
  prices: $0.13 for 3 plans, $0.13 for 5 builds. That is the upper bound.
- About $0.27 at most, against a $5 cap.

## What changed

- `settings.ts`: the new tables, and the refusals for picks that say
  nothing.
- `setup.ts` (new): the picks and their lines. `settings-source.ts` reads
  what the repo holds at the same commit as `fabrika.toml`.
- `stages/build/`: the plan gate (`go.ts`, `ticket.ts`), the repo's install
  and the builder's check commands, and taking main in by merge.
- `stages/operate/`: `[agents.build]` and `[agents.review]` each reach their
  own step.
- `code-host-github.ts`: what the repo declared (approval, review kinds)
  stands in only where the file GitHub would read is not there.
- `local-checks.ts` (new): `[[checks.run]]`, run by fabrika at each head in
  a temporary copy, joined with GitHub's checks as `checks.github` says.
- `code-host-github-writes.ts`: the pinned merge.
- `stages/plan/at-main.ts` (new): plan reads main as fetched now.
- `tsh/`: the start lines, the ledger picked by `[ledger] at`, `plan` listed,
  and `plan | desk`.
- `rubrics/` (new): the rubrics the package ships.

## Holes

- **The merge-queue path did not run here.** Experiment 85 said it was
  still unproven live, and no later write-up says it ran. Lean: run it on
  demlik next, where the queue is real.
- **A protected branch with no queue is still unpinned.** GitHub's merge
  call pins the head, not the base, and the pinned path is skipped where
  GitHub holds any rule (an admin token could otherwise go round them). A
  push between the door's read and the merge is not caught there.
- **The criteria judged are the ticket's, not the approved plan's.** The
  plan wrote 4 criteria for ticket 1; review judged the ticket body's 2
  marked boxes. The approved plan gates the build and nothing else yet.
- **Local checks run outside the agent sandbox**, with no login but with
  the network, on code an agent wrote. They also hold the read while they
  run: a long test suite slows every read of that head. They copy some of
  `code-host-local`'s work.
- **fabrika.toml governs itself.** A merged change can set `approval =
  "none"` or raise a budget. Nothing marks `fabrika.toml` as governed unless
  the repo says so.
- **Root `CODEOWNERS` and `docs/CODEOWNERS` are said "not read"**, but
  GitHub reads them. On a protected branch that requires owner reviews,
  `approval = "none"` would then end at GitHub's refusal (`merge_failed`),
  not before.
- **Taking main in that conflicts** ends `copy_failed`, not a send to the
  builder with the conflict. Not run live.
- **Left behind after a merge:** the build branch on GitHub (demlik deletes
  head branches itself; this repo does not) and the working copy on disk.
  Both were removed by hand. tsh also leaves `.wrangler/` in the folder it
  starts in.
- **Named but not printed:** `PLAN_TRIES = 3` (the drafts one plan may
  take) is a code constant; a flag on the line overrides it.
- **The builder is told "Dependencies are already installed"** even when
  install is `none`.
- **Cost:** the reviewer keeps no session file, so its cost is only the
  SDK's number. The SDK's number and the token price differ by about 7x for
  the builder; the table uses the higher.

## Next

- Run the queue path with the new settings on demlik.
- Feed the approved plan's criteria to review, so the plan is what the
  change is judged by.
- Ship's tidy-up: delete the merged head branch and the ticket's working
  copy.

## Run it

```sh
node experiments/107-a-repo-that-is-not-demlik.ts               # the table and the lines, $0
ONLY=table node experiments/107-a-repo-that-is-not-demlik.ts    # the table only
```

The real runs are the tsh lines above, against a repo set up the same way.
Their results are in `results/107-a-repo-that-is-not-demlik.json` under
`real`; the script keeps them when it writes the table again.
