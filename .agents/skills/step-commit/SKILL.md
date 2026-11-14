---
name: step-commit
description: Commit and sign one pipeline step's work in tea-fabrika in one command. Use whenever the tests, build, mutation or lead step commits, instead of running git commit and pnpm commits sign apart.
---

# Commit and sign a step

One command stages the paths you name, refuses a build commit that holds an exam path, commits as
the bot with the person as co-author, signs the link as your step, and pushes it. Run it from the
repo root.

```sh
sh .agents/skills/step-commit/scripts/stepcommit.sh <step> <ticket> "T<ticket> <step>: <subject>" <path>...
sh .agents/skills/step-commit/scripts/stepcommit.sh --commit-only <step> <ticket> "T<ticket> <step>: <subject>" <path>...
sh .agents/skills/step-commit/scripts/stepcommit.sh build 277 "T277 build: one refusal per request" next/apps/fabrika/src/door.ts
```

Why one command: on 2026-11-08 about 21 of 126 step reports were signing problems. Three causes sat
under them: the plan did not say who owns each file, signing was a second command, and history
rewrites broke signed links. This script covers the last two, and refuses a build's exam path for
the first ([code commits and signs each step](../../../docs/direction/code-commits-and-signs-each-step.md),
field note 2026-11-08-20).

## The rules

- **`<step>` is `tests`, `build`, `mutation` or `lead`.** `mutation` signs as `tests` for now, a
  stopgap until it has a role of its own (field note 2026-11-08-19).
- **Start with nothing staged.** If the index already holds changes, the script refuses (exit 4)
  before it stages anything, and lists them. Do not unstage another step's work: name the staged
  paths in your report, and finish the work that does not need the commit.
- **A build that names an exam path is refused** (exit 3) and nothing is committed. The paths are in
  `exam-paths.json`. Do not work around it: answer `send` to tests with the paths.
- **Each path must be the step's own in the plan's files table**, or the script refuses with
  `not_owner: <path>`. One exception: the exam is the test writer's, so a `tests` commit may hold
  an exam path that no row names. A path the plan gives to another step stays refused, exam path
  or not. `box.sh fetch --sign` holds the same rule. Both read an exam list the step cannot edit:
  the script reads the box base's, fetch reads main's.
- **A `lead` link signs only under a ticket no other branch's open PR holds.** Otherwise it
  refuses (exit 5) and names that PR and branch: the new link would be that ticket's newest, outside
  the PR's chain, and the commits check would read the PR's own lead links as `stale_link`. Sign
  field rows and other lead work under a lead ticket of its own.
- **One commit per call.** Several commits mean several calls, in order.
- **Never rewrite history.** No `reset`, `rebase`, `commit --amend` or force-push. A takeover is a
  new commit on top. A rewrite leaves signed links that no longer match (`stale_link`).
- **Never read, print or copy a key file.** The script reads `~/.fabrika/step-keys/<step>` itself.
- **It pushes for you.** A signed commit is pushed at once, after the leak grep, and the branch gets
  a draft pull request when it has none (0134). If the push cannot run, it exits 6 with the commit
  made and signed: put the command it prints in your report and go on with your step, and the lead
  runs it. `--commit-only` and a box's commit push nothing here; the lane's host part pushes them.
- The co-author comes from `FABRIKA_COAUTHOR` (`Name <email>`), or your global git config. It never
  reads a box's own git config.

## When it fails

stepcommit.sh checks named paths, owners, exam paths and staged formatting.
fetch --sign checks owners and signs missing notes in MAIN.
A step that `drive.ts` runs in a box does not call this script: drive commits its tree and signs it.
`--commit-only` runs the same checks and leaves signing to fetch.
Owner checks read the box's saved plan. Older worktrees without `.box` keep the legacy route.
Existing notes stay unchanged, including invalid or stale links. Put their check result in your report
for the lead.
- The full table of answers is in [sign a step's commit](../../../docs/how-to/sign-a-step-commit.md).

`scripts/exam.py <exam-paths.json> <path>...` prints each path that is an exam path, with its glob,
and exits 1 when it finds one. The plan step's check uses it too.
