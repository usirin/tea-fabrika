---
id: 0080
title: In next/, one running copy of fabrika is an instance, the local instance or the cloud instance, never a stage
status: accepted
date: 2026-11-10
tags: [names, instance, stage, brain, host, alchemy, local, cloud, next]
---

# 0080: In next/, one running copy of fabrika is an instance, the local instance or the cloud instance, never a stage

**What this decides:** in `next/`, one running copy of fabrika, one brain and its ledger that
clients dial, is called an instance; the word stage is not used for it.

```text
the local instance     one brain and its ledger, on this laptop
two hosts              a Mac and a VM, each running hands, both dialing that one instance
a window               a client of the same instance
```

All of this is about `next/`. Today's version keeps its words until that code goes.

## Context

The owner decided this on 2026-11-10, tracker ticket 681, by
[use the industry's names](../docs/direction/use-the-industrys-names.md).

- **"Stage" came from the deploy tool.** Alchemy calls one deployed copy of a stack a stage, and
  `next/` took the word from it: "the local stage", "the cloud stage", `<home>/stage.json`.
- **"Stage" already means something here.** In today's version it means a pipeline step (the
  glossary's last section has that row). The glossary has no `next/` row for the other meaning.
  The word read as odd to the owner.
- **[0051](0051-gateway-connection-and-node-by-job.md) already took "stage" out of one place:** the
  Node driver that runs the brain on the laptop is `startDev` in `node/dev/`. This record names the
  thing that driver starts. It adds to 0051 and changes nothing in it.

**What the industry says.** A self-hosted product's own docs call your running copy an instance.
Each page was read on 2026-11-10:

- Mastodon: its setup page is titled "Setting up your new instance"
  ([docs.joinmastodon.org/admin/setup](https://docs.joinmastodon.org/admin/setup/)).
- Sentry: its self-hosted guide speaks of traffic "to your Sentry instance"
  ([develop.sentry.dev/self-hosted](https://develop.sentry.dev/self-hosted/)).
- Nextcloud: its admin manual is for those who "Administer and manage their instance"
  ([docs.nextcloud.com/server/latest/admin_manual](https://docs.nextcloud.com/server/latest/admin_manual/)).

**Looked at and not picked:**

- server: kept as the plain word for a process that listens. The brain on Cloudflare is not one.
- environment: reads as environment variables.
- workspace: taken in the glossary, a numbered tile layout.
- deployment: the act of putting it out, not the running copy.

## Decision

**In `next/`, one running copy of fabrika (one brain and its ledger, which clients dial) is an
instance: "a fabrika instance", "the local instance" on a laptop, "the cloud instance" on
Cloudflare; nothing in `next/` calls it a stage.**

- **Not a host.** A host is a place hands can run. Many hosts dial one instance.
- **The deploy tool keeps its word at its own edge.** Where Alchemy's API takes a stage name, as in
  `deploy({ stack, stage: "local" })` or a stack's `{ name: "fabrika", stage: "local" }`, the code
  says stage on that line only. Alchemy's state folder, named by stage, is the tool's too.
- **Other instances keep their own words.** A class instance or one Durable Object is ordinary
  programming talk. A running program is a process, never "a program instance". Said alone,
  instance means a fabrika instance.
- **Today's version is not changed.** There, stage means a step until that code goes.
- **The rename itself is code and is not in this pull request.** It is cheap now: nothing real is
  stored under the old word yet.

What the rename covers, read from main on 2026-11-10. In `next/`, 232 lines say `stage` as a word,
in 34 files, and 287 matches count the joined names too (`localStage`, `StageError`). 213 of the
232 lines are in tests. Paths are under `next/apps/fabrika/` unless they start with `next/`.

| Group | Today | Becomes |
|---|---|---|
| Files | `src/stage.ts`, `src/local-stage.ts`; tests `src/stage-records.test.ts`, `src/stage-wire.test.ts`, `src/stage-one-file.test.ts`, `src/stage-watch.laws.test.ts`, `src/local-stage.test.ts`, `e2e/stage.test.ts` | names without stage, picked in the rename's plan |
| Package subpaths | `./node/stage`, `./node/local-stage`, `./node/stage-recording` in `next/packages/libfabrika/package.json`, which already point into `node/dev/` | follow 0051's `node/dev/` files, picked in the rename's plan |
| Functions | `localStage` (`src/local-stage.ts`, used by `dev.ts`) | `localInstance` or a `dev` name, picked in the rename's plan |
| Types and errors | `StageError` (`dev.ts`) and its `_tag` | `InstanceError`, unless the plan finds a better one |
| Span names | `stage.startDev` (`src/stage.ts`), `stage.settings` (`src/runtime.ts`), `brain.stage` (`next/packages/libfabrika/src/node/dev/dev.ts`), `brain.localStage` | the same with instance |
| Worker binding | `STAGE`, the settings JSON (`alchemy.run.ts`, `src/runtime.ts`, `next/packages/libfabrika/src/cloudflare/record.ts`) | a name without stage, picked in the rename's plan |
| Stored on a person's disk | `<home>/stage.json`, written by `dev.ts` | `<home>/instance.json` |
| Stored in the ledger or the cloud | span names in measurements; the `STAGE` binding on a deployed Worker | follow the rows above |
| Tests | the 213 test lines, most in `src/worker-supervision.test.ts` (54), `src/stage-records.test.ts` (45), `src/stage-wire.test.ts`, `src/stage-one-file.test.ts` and `src/brain-life.test.ts` (18 each); also the `P34_STAGE_DRIVER` variable and the `test_stage_ready` reason | renamed with the code; `src/exam/commits.test.ts` is an exam file, so that part goes through the test writer |
| Settings keys in notes | `[stage]`, `stage.port`, `stage.programs`, `FABRIKA_STAGE_PORT` in the proposed settings note | `[instance]`, `instance.port` and so on, before that note is decided |
| Plan notes | "local stage", "cloud stage", `stage.json` in [Tier 1](../docs/plan/tier-1.md), [its detail](../docs/plan/tier-1-detail.md) (P12, P24, PR D) and [the plan](../docs/plan/README.md) | changed with the rename |
| Direction notes | [local is the cloud](../docs/direction/local-is-the-cloud.md), [the cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) (it also says "program instance"), [hot reload](../docs/direction/hot-reload.md), [no Promises](../docs/direction/no-promises.md), [Windows in next](../docs/direction/windows-in-next.md), [account recovery](../docs/direction/recovery-key.md), [a local-first sync engine](../docs/direction/a-local-first-sync-engine.md), [React Compiler](../docs/direction/react-compiler.md) | changed with the rename |
| Glossary rows | no `next/` row says stage for this; `brainOutbox, checkMemory` still cites the `node/local-stage` path | `instance`, added in this pull request |

**What is stored under the old word, and what the rename must do:**

- `<home>/stage.json`: no real one exists. `next/` is not in daily use, and the owner's laptop has
  none. Tests write theirs in their own temp homes. The rename moves to the new name and reads no
  old one. If a real file exists by then, the rename moves it once, on start.
- Span names: they reach the ledger only from a real instance, and none runs for real work yet.
  Rename them; nothing to read back.
- The `STAGE` binding: the cloud instance is not deployed yet (P24 has tests on a branch only). A
  binding is set again on each deploy, so a later rename needs only a deploy.
- Alchemy's own state folder, under `<home>/.alchemy/`, is named by Alchemy's stage. It is the
  tool's word and stays.

Earlier decisions that say "local stage" ([0020](0020-programs-get-hard-walls.md),
[0041](0041-object-classes-are-effect-objects.md), [0042](0042-platform-pieces-go-through-alchemy.md),
[0044](0044-a-brain-that-dies-starting-fails.md)) are records and keep their words. Read "the local
stage" there as the local instance. None of them ruled the word, so none is superseded.

**Binding constraints:**

- No new code, note or plan in `next/` says stage for a running copy of fabrika. Only a line that
  hands a stage name to Alchemy says it, as an edge.
- The rename lands before anything real is stored under the old word. If it has not, it comes with
  a migration and its own plan.
- The rename changes no law: same behavior, new names.

## Consequences

- One sweep is owed, mostly in tests. Until it lands, two words are alive at once: the code and the
  plan say stage, and this record and the glossary say instance.
- The [settings note](../docs/direction/settings.md), proposed in an open pull request when this was written, changes its examples from `[stage]` to
  `[instance]` before it is decided.
- Instance is a common word, so it is harder to search for than stage was. Search with "fabrika
  instance", "local instance" or a path.
- Not decided here: the exact name for each identifier. The table says where it is obvious; the
  rename's plan picks the rest.

## Records

- [`.glossary/TERMS.md`](../.glossary/TERMS.md): `instance`, added in Clients.
