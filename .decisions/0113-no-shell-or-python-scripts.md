---
id: 0113
title: No shell or Python script enters the repo, and the ones here today are ported to TypeScript and Effect now, behind services with a test layer
status: accepted
date: 2026-11-11
tags: [tooling, scripts, shell, python, effect, lint, ledger, tests, ci, lead]
---

# 0113: No shell or Python script enters the repo, and the ones here today are ported to TypeScript and Effect now, behind services with a test layer

**What this decides:** repo tooling is written in TypeScript and Effect, like `next/`; no new `.sh`
or `.py` file is added, and every one here today is ported now instead of when it is next touched.

## Context

[0033](0033-agents-code-follows-next-rules.md) held lead tooling to `next/`'s lint rules and said a
shell or Python script moves to TypeScript and Effect when it is next touched. On 2026-11-11 the
owner decided that is too slow, for two reasons:

- **Speed.** The scripts' tests start real processes (git, a shell, Docker) and are the slowest test
  files in CI; one takes up to 488 seconds. That is in the way of the five-minute budget for a pull
  request's checks ([0106](0106-a-pull-requests-checks-finish-in-five-minutes.md)).
- **One shape to copy.** Agents read the repo's tooling and copy it. One language and one shape,
  services and layers as in `next/`, is easier for them to copy right than three languages.

What is here, on `origin/main` on 2026-11-11 (`git ls-files '*.sh' '*.py' | xargs wc -l`): 19 files,
16 `.sh` and 3 `.py`, 3,241 lines. Fifteen `.sh` and all three `.py` sit under `.agents/skills/`; the
other two are `.github/ci/apt.sh` and `scripts/typecheck.sh`. The largest are `box.sh` (690 lines),
`catchup.sh` (508) and `loosening.sh` (404). Tracker ticket 766 tracks the ports.

**What lint checks today** (read in `package.json`'s `lint` script and `oxlint-plugins/lint.ts`):
nothing refuses a new shell or Python file. oxlint reads only `.ts`, `.mjs` and the like, so
`agents-ledger.json` names only findings in TypeScript and JavaScript files under `.agents/`, and
`lint.ts` refuses a ledger entry outside `.agents/`. No step in `pnpm lint` lists tracked `.sh` or
`.py` files. The check below is work for ticket 766.

**How this fits older records.**

- [0033](0033-agents-code-follows-next-rules.md): amended in part. Its "moves when next touched"
  line is replaced by this one; the rest holds.
- [0040](0040-existing-tools-before-hand-written.md) holds: each port first asks whether an existing,
  widely used tool does the job, before it is rewritten by hand.
- [0061](0061-resources-are-acquired-in-a-scope.md) holds: a port acquires each process, folder and
  container in a scope. Its "as each file is next touched" for `.agents/` now comes with the port.
- [0062](0062-test-files-keep-the-floors.md) holds: a port's laws are a suite, run once per layer.
- [0048](0048-leak-check-reads-each-commit.md) said `leakgrep.sh` stays a shell script "for now".
  Its port ends that; its rules for what the leak check reads do not change.
- `0107-fabrika-provides-the-merge-queue.md` (ticket 765, still on its branch) deletes `catchup.sh`.

## Decision

**No new shell or Python script enters the repo, and the 19 here today are ported to TypeScript and
Effect now, one pull request at a time, starting with `box.sh`.**

- **New tooling is TypeScript and Effect,** under `next/`'s rules, as 0033 already holds for
  `.agents/`.
- **Each port puts what the script touches behind Effect services:** git, the shell, Docker and the
  code host. Each service has a real layer and a test layer.
- **Each port moves its laws into a suite** (0062): the suite runs on the test layer for the
  generated cases, and on the real layer for a small set.
- **Order:** `box.sh` first, then the rest under ticket 766. One script per pull request, never one
  big rewrite.
- **`catchup.sh` is not ported.** The merge queue (0107, ticket 765) deletes it.
- **A script that must run before Node exists,** such as `.github/ci/apt.sh`, which sets up the CI
  machine's packages, may stay shell only as a marked edge with its reason. That is decided in its
  own port, not here.
- **It is held by code:** `pnpm lint` fails on a tracked `.sh` or `.py` file the ledger does not
  already name, and that list only shrinks, as `agents-ledger.json` does.

**Binding constraints:**

- No new tracked `.sh` or `.py` file, except an edge decided in its port.
- No entry is added to the script list; a port removes its file's entry.
- A port is not done until its laws run on the test layer without starting a real process.

## Consequences

- **Work for ticket 766, not built here:** the lint check that lists tracked `.sh` and `.py` files
  and fails on one not named. It needs a list that can hold paths outside `.agents/`
  (`.github/ci/apt.sh`, `scripts/typecheck.sh`), which `lint.ts` refuses in `agents-ledger.json`
  today, so the ticket picks a sibling list or widens that one.
- Each port costs one pull request and a new suite. The scripts' slow process tests shrink to a
  small real-layer set, which should cut CI time toward the 0106 budget.
- Skills that call a script by name (`sh .../box.sh`) change their commands as each port lands.
- Not decided here: the order after `box.sh`, and the exact service names. Each port's plan names
  them.
