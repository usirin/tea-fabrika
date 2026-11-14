REPORT: Cloud lane P19 launchd founding is pushed: fabrikalfa/cloud-p19-launchd-founding at 7adb27f4c, review approved after one send-back; relayed from its transcript.

- **Branch:** on origin at `7adb27f4c`, 2 commits:
  - `f290fe7`: the brain entry is typed code, and e2e is typechecked.
  - `7adb27f`: the brain is in its own file, and the bundle law checks each dispatch.
- **Fix:** test code only. The brain that the host check starts used to be JavaScript inside a template string. It is now its own typed file, `next/apps/fabrika/e2e/node/P19Brain.test-support.ts`, and it passes `founding` the way `dev.ts` does.
  - It did not use 1012's `startupFixture`, because that would swap in its own rate limit for the settings the launchd job is built from. The reviewer agreed.
- **Why typecheck missed it:** code inside a string is never type-checked, and `next/apps/fabrika/tsconfig.json` left out `e2e/` and `e2e.ts`. Both gaps are closed: 19 errors, all fixed with no `any`, cast or ignore comment, one of them the real SIGKILL bug.
- **Checks:** `pnpm lint` passed (about 2 min 18 s), `pnpm typecheck` passed (53 s), the leak check is clean.
- **Loosening check:** `loosening.sh` gave 8 hits; the child read each by hand, and none loosens a law.
- **Plants:** removing `founding` turns typecheck red. Deleting a mode block, or putting back the old treeshake rule, turns the L13 law red.
- **Review:** sent back once, because the new L13 check could never fail. After the fix the same reviewer approved it.
- **Could not run:** the host-only scenario needs the owner's Mac. `e2e/instance.test.ts` and `e2e/first-window.test.ts` need `ssh-keygen` and a Chromium the container could not download; both type-check.
- **Findings:** `fixtures/next/p19-launchd/brain.ts` is still outside every typecheck. A cloud session cannot run those two browser tests.
- **Overlap:** it conflicts with the e2e typecheck lane (mail 017) on the tsconfig and the SIGKILL fix. The two lanes did the same work; one should land and the other rebase onto it.

## Description

The P19 launchd host check starts its brain with founding, and next/apps/fabrika's typecheck covers e2e/, in next/

## What this does

All of it is in `next/`, in test code and the app's tsconfig. Today's version and product code are not touched.

- The P19 launchd host law no longer fails at instance start. Since pull request https://github.com/kamp-us/tea-fabrika/pull/1146 made `founding` required, its brain called `localInstance` with the old option shape and hit a TypeError reading `options.founding.person`.
- The brain the host check starts is now typed code in its own file, so a wrong `localInstance` call fails `pnpm typecheck`. Before, the call was JavaScript inside a template string, bundled at run time and seen by no type checker.
- `pnpm typecheck` now covers `next/apps/fabrika/e2e/` and `e2e.ts`. Before, the app's tsconfig left them out, so no e2e file was ever type-checked. The 19 errors that showed up are fixed in test code.
- The host check's "controller death" step now really sends SIGKILL. It passed `{ signal: "SIGKILL" }`, but Effect's `KillOptions` key is `killSignal`, so it had been sending SIGTERM.
- The pinned L13 bundle law now goes red when any one of the guard, controller or brain mains is dropped from its bundle. Before, it matched mode names that `check`'s own argv also holds, so it could not fail that way.

## Why this change

It fixes the break found on pull request https://github.com/kamp-us/tea-fabrika/pull/1012's branch, in its finding row `2026-11-13-p19-launchd-starts-instance-without-founding`. It also closes the two type gaps that let the break through. There is no ticket.

## How it works

- `e2e/node/P19Brain.test-support.ts` is new. It holds the `BrainInput` schema, the `brain` Effect, and its `p19:brain` main. It imports only `localInstance`, the settings fields, `BuiltProgram` and the platform layers, so under Electron the brain does not load rolldown or the launchd code.
- `e2e/node/P19Launchd.test-support.ts`: `check` writes `brain.json` with `Schema.encodeEffect(BrainInput)` and bundles the brain file by a bare import, as it does the guard and controller. The launchd args are `[runtime, "p19:brain", brainFile, "spaces & <angles> 雪"]`, and the quoting argument stays last. The treeshake rule keeps both files' mains.
- The brain gets the host check's own settings snapshot plus `founding`, the shape `dev.ts` passes. It does not use `RecordWireTest.startupFixture`, which pull request 1012 used: that fixture would put its fixed 100,000 per 60,000 rate limit in place of the snapshot the launchd job and the controller are built from.
- `next/apps/fabrika/tsconfig.json` adds `e2e` and `e2e.ts` to `include`.

```ts
// P19Brain.test-support.ts: the call a type checker now sees.
const input = yield* fs
  .readFileString(file)
  .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(BrainInput))));
yield* localInstance(input.built, input.options);
```

The 19 type fixes, in short:

- `chaos-revoke.test.ts`: ids come from `SecureRandom`, the ledger calls are read from the project binding (no cast), the binding is typed, and there is an `ArrayBuffer`-backed copy for `sign`.
- `chaos-revoke.worker.test-support.ts`: the `inputs.log` key is dropped. Pull request 1146 removed it from the type.
- `first-window.test.ts`: the code uses the checklist program's own `msg` schema, and `send` declares both of WebSocket's merged overloads.
- `instance.test.ts`: `env` is written as a record.
- `P19Launchd.test-support.ts`: `return yield* Effect.never`, and `killSignal`.

Read these files first, in this order:

1. `next/apps/fabrika/e2e/node/P19Brain.test-support.ts`
2. `next/apps/fabrika/e2e/node/P19Launchd.test-support.ts`
3. `next/apps/fabrika/e2e/electron-launchd.test.ts`
4. `next/apps/fabrika/tsconfig.json`

## What a reader should know

- From now on, a type error in any `next/apps/fabrika/e2e/` file fails `pnpm typecheck` and CI.
- No product export, setting or stored shape changes.

## Laws and checks

- `pinned: L13 bundles keep native dependencies resolvable outside root node_modules` is tighter now. It bundles each entry the way `check` does, checks each mode's `process.argv[2] === "<mode>"` dispatch, and checks that the brain bundle holds `localInstance` and links no rolldown.
- Plants, each run once and then undone:
  - Deleting each of the three dispatch blocks turns the bundle step red.
  - Putting the old treeshake rule back turns it red.
  - Dropping `founding` from the brain's call turns `pnpm typecheck` red. With `e2e` taken out of the tsconfig, that same plant is not caught.
- These ran at head 7adb27f, in a Linux cloud container:
  - `pnpm format` and `pnpm lint`: green, about 2 min 18 s.
  - `pnpm typecheck`: green, 53 s.
  - `e2e/chaos-revoke.test.ts` through `node next/apps/fabrika/e2e.ts`: passed, at 1 test in 51 s, on the first commit.
  - The L13 bundle step, run alone with a script that was not committed: green.
- What did not run:
  - The host scenario in `e2e/electron-launchd.test.ts` needs a Mac with launchd and `FABRIKA_P19_HOST=1`, so the new brain has not started under Electron yet. That run is also the first time the SIGKILL step sends SIGKILL for real.
  - `e2e/instance.test.ts` and `e2e/first-window.test.ts` could not run here. They need `ssh-keygen` and a Chromium the container could not download. They type-check.
- `loosening.sh origin/main HEAD` had 8 hits, all checked by hand. The one "removed expect", in the L13 law, is the old single `toContain` replaced by the stricter checks above. The other 7 are the type fixes listed above. None of them loosens a law.

## Not in this pull request

- `fixtures/next/p19-launchd/brain.ts` is still outside every typecheck.
- The finding row from pull request 1012's branch is not in this pull request. It lands with that branch.
- Steps: a tests-step agent made the fix, and one review sent it back once. The bundle law matched mode names and needed the dispatch text; the brain moved to its own file; `start` was renamed `options`. The same reviewer then approved. The lead read the diff and ran the leak checks before the push.
