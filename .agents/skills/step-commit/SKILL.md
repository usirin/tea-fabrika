---
name: step-commit
description: Commit and sign one pipeline step's work in tea-fabrika in one command. Use whenever the tests, build, mutation or lead step commits, instead of running git commit and pnpm commits sign apart.
---

# Commit and sign a step

One command stages the paths you name, refuses a build commit that holds an exam path, commits as
the bot with the person as co-author, and signs the link as your step. Run it from the repo root.

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
  before it stages anything, and lists them. Do not unstage another step's work: tell the lead.
- **A build that names an exam path is refused** (exit 3) and nothing is committed. The paths are in
  `exam-paths.json`. Do not work around it: answer `send` to tests with the paths.
- **A `lead` link signs only under a ticket no other branch's open PR holds.** Otherwise it
  refuses (exit 5) and names that PR and branch: the new link would be that ticket's newest, outside
  the PR's chain, and the commits check would read the PR's own lead links as `stale_link`. Sign
  field rows and other lead work under a lead ticket of its own.
- **One commit per call.** Several commits mean several calls, in order.
- **Never rewrite history.** No `reset`, `rebase`, `commit --amend` or force-push. A takeover is a
  new commit on top. A rewrite leaves signed links that no longer match (`stale_link`).
- **Never read, print or copy a key file.** The script reads `~/.fabrika/step-keys/<step>` itself.
- **Never push.** The lead pushes.
- The co-author comes from `FABRIKA_COAUTHOR` (`Name <email>`), or your global git config. It never
  reads a box's own git config.

## When it fails

stepcommit.sh checks named paths, owners, exam paths and staged formatting.
fetch --sign checks owners and signs missing notes in MAIN.
In boxes, prefer `--commit-only`; it runs the same checks and leaves signing to fetch.
Owner checks read the box's saved plan. Older worktrees without `.box` keep the legacy route.
Existing notes stay unchanged, including invalid or stale links. Send their check result to the lead.
- The full table of answers is in [sign a step's commit](../../../docs/how-to/sign-a-step-commit.md).

`scripts/exam.py <exam-paths.json> <path>...` prints each path that is an exam path, with its glob,
and exits 1 when it finds one. The plan step's check uses it too.
