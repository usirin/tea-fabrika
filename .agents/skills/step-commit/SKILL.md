---
name: step-commit
description: Commit and sign one pipeline step's work in tea-fabrika in one command. Use whenever the tests, build, mutation or lead step commits, instead of running git commit and pnpm commits sign apart.
---

# Commit and sign a step

One command stages the paths you name, refuses a build commit that holds an exam path, commits as
the bot with the person as co-author, and signs the link as your step. Run it from the repo root.

```sh
sh .agents/skills/step-commit/scripts/stepcommit.sh <step> <ticket> "T<ticket> <step>: <subject>" <path>...
sh .agents/skills/step-commit/scripts/stepcommit.sh build 277 "T277 build: one refusal per request" next/apps/fabrika/src/door.ts
```

Why one command: on 2026-11-08 about 21 of 126 step reports were signing problems, and every one
came from driving the commit and the signature as two steps
([code commits and signs each step](../../../docs/direction/code-commits-and-signs-each-step.md),
field note 2026-11-08-20).

## The rules

- **`<step>` is `tests`, `build`, `mutation` or `lead`.** `mutation` signs as `tests` for now, a
  stopgap until it has a role of its own (field note 2026-11-08-19).
- **Name every path.** Never `git add -A` or `.`. Another step's edits may sit in the same tree.
- **A build that names an exam path is refused** (exit 3) and nothing is committed. The paths are in
  `exam-paths.json`. Do not work around it: answer `send` to tests with the paths.
- **One commit per call.** Several commits mean several calls, in order.
- **Never rewrite history.** No `reset`, `rebase`, `commit --amend` or force-push. A takeover is a
  new commit on top. A rewrite leaves signed links that no longer match (`stale_link`).
- **Never read, print or copy a key file.** The script reads `~/.fabrika/step-keys/<step>` itself.
- **Never push.** The lead pushes.
- The co-author comes from `FABRIKA_COAUTHOR` (`Name <email>`), or your global git config. It never
  reads a box's own git config.

## When it fails

- `stuck unsigned_commit` from `pnpm commits check`: a commit has no note. Sign it with its own
  step's key, never another's.
- `stale_link`: sign again on the current head. The signer picks the next version.
- The full table of answers is in [sign a step's commit](../../../docs/how-to/sign-a-step-commit.md).

`scripts/exam.py <exam-paths.json> <path>...` prints each path that is an exam path, with its glob,
and exits 1 when it finds one. The plan step's check uses it too.
