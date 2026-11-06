# Tier 1: the first pass of the new fabrika

**Tier 1 is built now, by hand, one small pull request at a time ([the split](#the-pull-requests-one-at-a-time)).** Decided by the owner on 2026-11-05: `next/` no longer waits on today's pipeline. Today's pipeline is paused, and tickets 117, 213 and 159 stay saved at their asks. The lead session's agents build Tier 1 with the same steps the pipeline enforces, each step logged in `field/`; [how it is built now](#how-it-is-built-now) says how. [PR 396](https://github.com/usirin/tea-fabrika/pull/396) recorded that decision in `docs/direction` and `AGENTS.md`. The owner approved what Tier 1 builds and why on 2026-11-01. Later tiers stay proposed.

**Where it stands, 2026-11-05:** P1 and P2, the exam's frame and its rules, are on main ([PR 402](https://github.com/usirin/tea-fabrika/pull/402) and [PR 401](https://github.com/usirin/tea-fabrika/pull/401); [the exam on main](#the-exam-on-main)). P3 and P4, the two spikes, answered yes ([experiment 215](../../experiments/215-browser-key-survives-reload.md) and [experiment 214](../../experiments/214-mac-app-four-unknowns.md)). No product code is built yet. P5, the backup's design pass, is next in wave 1.

*Changed 2026-11-05: this page was the input for today's plan step, which was to turn it into small tickets. That flow is paused for `next/`, so the planner's brief and the planner's box are gone from this page. Its stories, checks, rules and order hold.*

Every claim is about `next/` at [PR 223](https://github.com/usirin/tea-fabrika/pull/223)'s head (`7c1d073`), unless it says "today's version". The full design, the laws and the reasons are in [`tier-1-detail.md`](./tier-1-detail.md). [The map](#where-the-detail-is) says where.

```ts
// The whole idea, as one sketch. A window proves who it is, its person lets it in, a press lands
// once, a note's save is one fact, and a program that breaks things on purpose only asks; code does the breaking.
const key = yield* ClientKey;                             // WebCrypto in a tab, the app's window key in Electron
send(initialize({key: key.publicKey, signed: yield* key.sign({nonce, url, tab})})); // unknown key: {why: "not_granted"}, then a code
// the person, once per browser: same code in the tab and the menu bar, Approve, a finger. One `granted` fact.
yield* Mailbox.send("counter:1", id, {type: "plus"}, who);  // Effect<Place, LedgerError>, `by` from the key
// the first real program. An agent saves through MCP and a person reads it drawn. A save on an old version
// is refused and writes nothing, for a window and an agent alike:
yield* Mailbox.send("notes:1", id, {type: "save", value: {note: "n-7f3a", base: 3, body}}, who);
// the chaos program stays pure Elm. Its update only returns data:
return [armed, [{type: "fire", fault: Fault.cases.abort.make({target: "gateway", name}), tick}]]; // the runner saves it, then a service fires it
```

## How it is built now

**Each pull request in [the split](#the-pull-requests-one-at-a-time) goes through the same steps the pipeline enforces, run by the lead session's agents, by hand** (owner, 2026-11-05). One agent per step, and no agent does two steps on one pull request.

```text
plan          an agent writes the PR's plan: what changes, its laws by detail number, its files
              the lead agent approves a plan that only builds a decided note; a new design call goes to the owner
tests first   a second agent adds the tests, as new *.test.ts files, and runs them on the base: red
build         a third agent writes the product code and never touches the tests or the exam
mutation      the fast check, as fast-and-daily-mutation sets it: changed lines, 5 minutes at most, advice only
review        one review, by an agent that wrote none of it
merge         the lead agent reads the whole diff, waits for green CI, runs the leak grep, then merges
log           one row per agent run and a note per step that went by hand, in field/, the same day
```

- **The laws stay in the detail file.** Tier 1 has about 65 laws and 17 criteria. Each pull request names the ones it owns as "detail p26", and its own plan writes them out in full.
- **Each pull request lands alone.** Its checks are green when it lands. From the first working demo on, the demo keeps working after every pull request.
- **A pull request that adds a `next/` package adds its `boundary-rules.json` row in the same pull request.** code-graph 0.12.0 refuses a row for a folder with no `package.json`, so no row can land before its package (P1's first flag). The row is an exam file, so the builder never writes it: the lead agent does, and the pull request's plan names it (P1's lean, 70%). `next/apps/fabrika` got its row, `next-app`, in P2. The first package row is `@kampus/libfabrika`'s, in P6.
- **A merge never waits on the owner** ([autonomy is measured trust](../direction/autonomy-is-measured-trust.md), decided 2026-11-03). Each merge gets its `MergeRow` in `field/`, and a break found later gets a `BrokeRow` and a fix forward. Still the owner's: each exam pull request (P1, P2, P8 and the backup's) and the exam halves of P12 and P30, the yes after reading `alchemy plan`, a real finger on Approve, and any new design call.
- **The owner closes Tier 1 by hand,** on [the checks below](#what-done-looks-like), in a run logged in `field/`. No single pull request can prove the whole project.

## The exam on main

**Added 2026-11-05. P1 and P2 landed, so every `next/` pull request is held to these from its first line.** Nothing is red on main: `next/` has no package yet, so each scan of the real tree finds nothing, and each rule was first seen to fire on planted code inside its own test.

```text
P1, PR 402, the frame
  pnpm-workspace.yaml, vitest.config.ts   next/{packages,programs,apps}/* are packages; pnpm test runs their src/**/*.test.ts
  .github/workflows/check.yaml            a `next` job: vitest run next/, Chromium once an e2e file exists, then the runner
  next/apps/fabrika/e2e.ts                the thin runner over next/apps/fabrika/e2e/*.test.ts, one file at a time; passes while there are none
  layer-rules.json                        11 next-* layers, so pnpm lint:layers fails an upward import (p32)
  boundary-rules.json                     4 library types for next/ and libraryRoots: ["next"]; each package's row lands with it
  src/exam/layers.test.ts                 each part imports only what the detail's table allows (p32, p65)
  src/exam/deps.test.ts                   next/ stands alone, and each top level bundles for a browser (p65), with esbuild for now
  src/exam/laws-scan.test.ts              every file that makes a machine has a laws file beside it
  fixtures/next/sshsig/                   real ssh-keygen vectors, namespace fabrika-client (p27, p44)
  .gitattributes                          * text=auto eol=lf

P2, PR 401, the rules (blocking in next/**, tests left out unless it says)
  no-promises                  async, await, new Promise, Promise.x(), .then, Effect.promise, import(), a .catch not on Effect
  no-effect-run-outside-edge   Effect's run functions only in the 18 edge files the rule names
  no-of                        no bare `of` and no xOf name, tests included
  no-hand-tag                  no hand-written _tag; one exception, data/log.ts
  one-store-hook               useSyncExternalStore only in next/packages/tuval/src/window/use-model.ts; a dropped store value fires
  react/refs, react/immutability, react/display-name, react/purity     next/**/*.tsx, oxlint 1.90.0
  no-clock-in-view             next/**/*.tsx: no Date.now(), new Date(), performance.now(), Math.random(), crypto.randomUUID(), handlers included
  pnpm lint:compiler           src/exam/compiler.ts, the compile step build.ts will call; compiler-ledger.json is empty
  catalog                      oxc-parser and oxc-transform-react 0.157.0
```

- **PR 223's tree, read by hand in P2:** `no-promises` 225 fires on 195 lines, 63 of them on 57 lines of the slice's Promise plumbing and 162 in its Playwright script; `no-effect-run-outside-edge` 3, the `useRuntime` handle in `window/main.tsx`; `no-of` 1, `sizeOf`; `react/purity` 1 and `no-clock-in-view` 2, both in `window/main.tsx`; `lint:compiler` 0. No false alarm by each rule's own words.
- **`no-clock-in-view` was added by the owner on 2026-11-05.** oxc-transform-react 0.157.0 stopped refusing a clock read in a handler a view passes down, which 0.156.0 refused. `react/purity` refuses a read in render, and our rule holds the handlers.
- **What P2 could not measure:** false alarms for `no-hand-tag` and `one-store-hook`, since the slice gives them nothing to fire on. The first landings with schemas and a window count them.
- **Two exam files will change, each named where it changes:** `deps.test.ts` moves to Rolldown in P12, and `use-model.ts` leaves the rules in P30.

## What a builder can read

- **Everything.** A builder works in its own worktree off current main, with git and the network. PR 223 is read with `git fetch origin pull/223/head`, and nothing from it is imported or merged.
- **On main, `next/` holds only the exam:** `next/apps/fabrika`, with `src/exam/` and `e2e.ts`, since P1 and P2. Each layer's first pull request makes its package, already on Effect, already in `_tag`, with its tests ([what lands](#still-open-how-next-reaches-the-lane), lean 60%).
- **Today's code is on main,** so the sources of the three named copies can be read: `programs/markdown/src/`, `packages/fabrika/src/mcp/tools.ts`, `apps/fabrika/src/window/window.css`. A copy names the commit it really came from.
- **Read the notes your pull request builds.** Each row of [the split](#the-pull-requests-one-at-a-time) names them, and [Rules that bind](#rules-that-bind) names the rest.

**PR 223 in numbers, as of 2026-11-01:** 3,323 added lines in 43 files, none deleted. It conflicts with main. It uses `kind`, `is` and 53 lines that say `peer`, has no `_tag` and no `xOf` names, and has about 60 lines that use Promises, by plan-115's rough count; P2 counted 57 lines of its plumbing. So it fails the exam's rules as it stands, and no pull request carries its code across unchanged.

## Who it is for

**One person and their agents.** A second person comes in Tier 3. Each person answers for their own agents, so this tier does not defend against them. The door stays real all the same: an unknown key is refused, on the laptop and on the cloud.

**The moments, in the order they happen:**

1. **The first open.** The owner opens the one app, types their name and clicks Start. A window comes up with no prompt. The menu bar is part of the app, and the app starts the brain as a plain service.
2. **A new browser.** A tab shows a code and waits. The menu bar shows a row with the same code. Approve and a finger, and the tab is online with no reload. A second tab of that browser needs nothing.
3. **Every day.** Opening fabrika asks nothing.
4. **An agent writes a doc.** The owner adds it once with `claude mcp add`, and approves its name once. It saves through MCP, and its name stays on what it writes. It can never let anyone in or write as the owner.
5. **The owner reads it drawn,** in another window, or on a phone tab on Cloudflare. `e` shows the plain text box, and they adjust it.
6. **Two writers disagree.** The agent's next save, on the old `base`, is refused and writes nothing. It reads and saves again. If the person is the stale one, "Keep mine as a new note" keeps both texts. No saved text is ever lost.
7. **Something goes wrong.** The Wi-Fi drops or the brain restarts, and a press still lands once. If the app dies, the other windows keep working, and only new approvals wait.
8. **Taking one back.** Remove in the menu bar takes out a let-in window or agent, with the same check as Approve.
9. **A lost Mac.** The text is safe on Cloudflare. A backup sheet brings the same notes back on a new Mac.
10. **Breaking it on purpose.** A run with a seed, on a throwaway ledger, ends with a verdict on the screen, and can be read back months later.

**Stories:**

- **s1:** the owner wants the brain built on Effect with strict layers, so nothing rests on Promises and every layer can be replaced.
- **s2:** the owner wants laws they can read, so a green run means something without reading the diff.
- **s3:** a person at a window wants the same speed and the same recovery as before.
- **s4:** the owner wants nothing to join their fabrika unless they said so, on the laptop and on the cloud alike.
- **s5:** the owner wants a browser tab and an Electron window to be the same client in different clothes.
- **s6:** the owner wants the same stack one command from Cloudflare.
- **s7:** the owner wants to break the running thing on purpose, watch it recover, and read what happened months later.
- **s8:** a person wants to open one app and have everything run, with one click and a finger when a new window asks in, and no prompt when opening fabrika.
- **s9:** the owner wants an agent to write a doc, to read it drawn in any window, a phone included, and to adjust it, and never lose saved text, even if two writers disagree.
- **s10:** a person wants to remove a let-in window or agent from the menu bar, without a terminal.
- **s11:** the owner wants to let a named agent in once, see its name on what it writes, and know it cannot let anyone in or write as them.
- **s12:** the owner wants the library, the desktop and each program to stand as packages, so a program can only use what the library really offers, and nothing in `next/` can lean on today's code.
- **s13 (new, since the backup had no story):** the owner wants to lose a Mac and get the same notes and the same fabrika back on a new one, from a sheet they keep, without a new ledger.

## What done looks like

**Tier 1 is done when each check below passes where it says, and the whole demo works in a browser tab and an Electron window, on the laptop and on Cloudflare** ([the rule](./tiers.md#the-rules)). Each half starts in a named pull request and stays working after it: the browser tab with P14, the first window; the Electron window with P19, the app; Cloudflare with P24 for the counter and P26 for notes. Each runs with `pnpm typecheck`, `pnpm lint` and `pnpm test` green. Every law in [the detail file](./tier-1-detail.md#properties) has to pass too, named below or not. These commands do not exist yet. Tier 1 builds them.

```sh
pnpm exec vitest run next/                 # the laws that run on Node
node next/apps/fabrika/e2e.ts              # the exam's thin runner, over each landing's e2e/*.test.ts
node next/apps/fabrika/dev.ts --port=N --founder=<key.pub>    # a brain for agents and tests
alchemy plan                               # read by the owner, and a yes, before any deploy
node next/apps/fabrika/chaos-drill.ts      # a run on a throwaway ledger, to a verdict
```

1. **The door.** Two tabs of one browser show one code, and one terminal command lets both in, on the local stage. An unknown key gets `not_granted` and writes nothing. (p26 to p29, p43)
2. **The speed and recovery bar.** A press in one window shows in the other, a restart loses nothing, and the numbers are measured on the new stage, base and head in one sitting. The first stage landing has no base, so its own run sets the first numbers. (p10 to p15, p17, p22)
3. **The app.** A temp home: founding screen, a window, "Open in browser" brings a tab online, a tab typed by hand comes in with Approve, Remove takes it out. Kill the app, and the counter keeps working. The owner opens the built app twice and sees no prompt. (p31, p44 to p51, p66, c13)
4. **Cloud.** The same, on Cloudflare, with the same approval flow, in one built file, after the owner reads `alchemy plan` and says yes. (p33, p41, c10)
5. **Notes.** On Cloudflare: an agent runs `notes_save` through MCP, let in once. The doc shows drawn in another window and on a phone tab. The owner presses `e`, adjusts and saves. The agent's next save on the old `base` is refused, and it reads and saves again. Raw HTML is never drawn. (p52 to p59, p61 to p64, c14 to c17)
6. **Backup.** See [The backup](#the-backup-needs-a-design-pass-first). Its checks are written in that pass.
7. **Chaos.** A run with a seed ends in a verdict on each stage, pressing the counter and saving notes while faults fire. A planted bug is caught. A build for the real ledger has no chaos in it. (p34 to p39, p60, c11, c12)
8. **The shape.** Each package stands alone, nothing in `next/` imports today's code, layers point one way, and no Promise outside an edge file, no Effect run outside one, no hand-written `_tag`, no `xOf` name, no clock read in a view and no Compiler finding passes lint. (p24, p32, p65, [the exam's rules](#the-exam-on-main))

**Only a person can pass these:** the real finger, "no prompt appeared", and the first real use on the phone. Tests use a test `PersonCheck`, and the run goes in `field/`.

**A deploy is not a pull request step.** No builder holds a key. So a check on Cloudflare runs after its pull request lands, from main, by hand, with the owner's yes, and it is logged. The pull request ends with the local half green. My call, 80%.

**Laws that Tier 1 cannot run.** T0 deletes the desk program, so plan-115's p6 and p7 test nothing and come back with the desk in Tier 2. p4 and p9 change with it. [The detail file](./tier-1-detail.md#properties) says how.

## What is out

- **Later tiers:** `fabsh`, pipes, the tracker, the desk, split and close, prefix keys (2). A second person, invites, the full Windows list, typed codes (3). Hands, leases, `kill -9` through real hands (4). Agents in a box, spend, the `claude` and `codex` programs (5). Drag, workspaces, palette, reconnect tested hard, typing in place, tabs and search for notes (6). Apple signing, auto-update, Windows and Linux as an app, others' programs (7).
- **In notes:** formatted typing in place, tabs, comments, search, sharing, live co-editing, any CRDT, and deleting a note.
- **Security:** no defense against a person's own agents, and no passphrase key.
- **Accounts:** nothing new to pay for. Dev builds use a self-made card, and the cloud stays on the account already in use.
- **Publishing:** nothing is published. Real package names, one workspace.
- **Today's version:** no change. `next/` never imports it. *Changed 2026-11-05: this named guarding the exam files (ticket 122) and the planner gap as today's work Tier 1 needs. With Tier 1 built by hand, neither blocks it.*

No fact is lost by waiting on any of these. The check is in [Later tiers](./tier-1-detail.md#later-tiers).

## Rules that bind

Read [AGENTS.md](../../AGENTS.md#two-versions-side-by-side) first. It holds for all of this. Where two notes clash, the newer holds, and the clash goes in `questions`.

**How `next/` is written:**

- **Effect all the way.** A Promise appears only in a one-line edge the platform demands ([no Promises](../direction/no-promises.md)). *Made exact 2026-11-05 by the owner:* the word stays **edge**, Effect's own, and an edge is a file on a written list, never any line that wraps its Promise in Effect. The list is the 18 whole paths in P2's `no-effect-run-outside-edge` rule (`oxlint-plugins/no-effect-run-outside-edge.ts`). A file cannot make itself one: a new edge comes with a small exam pull request, as P8's two do. [The glossary](../../.glossary/TERMS.md#shared-names) has the word.
  - **What P2's rules do not hold yet.** `no-promises` sees Promise syntax, not Promise values, so `Effect.tryPromise(() => fetch(url))` passes it in any file. Only the run functions are held to the list. Closing that is an exam change for the owner: see [question 13](#open-questions).
- **An object class stays thin:** what the platform gives it and a one-line handoff. The logic runs on Node in tests ([the note](../direction/object-classes-stay-thin.md)).
- **A window reads state through tea's own React hook.** State lives in a tea machine, never `useState` ([Elm first](../direction/elm-first.md)). *Changed 2026-11-02:* tea 0.22.0 fixed `useMachine` under Strict Mode ([demlik PR 774](https://github.com/kamp-us/demlik/pull/774)), so the reason for our own hook is gone. tea's hook does not take the Effect engine yet ([demlik 852](https://github.com/kamp-us/demlik/issues/852)). Until it does, one `useSyncExternalStore` hook in one file stands in, and it goes when tea's lands. PR 223's `window/main.tsx` still uses `useRuntime`, whose dispatch is a Promise, so this has to change.
  - *Added 2026-11-05:* the one file is `next/packages/tuval/src/window/use-model.ts`, and P2's `one-store-hook` lets no other file reach `useSyncExternalStore`. P14 creates it.
  - Demlik 852 is fixed by [demlik PR 864](https://github.com/kamp-us/demlik/pull/864), merged 2026-11-04, and ships in `@demlik/tea` 0.24.0. That release is the demlik owner's call, and it is not out. 0.23.0 is out, and its breaking change is that the hooks' `send` answers `undefined`. Today's version uses neither hook, so the bump changes nothing there.
  - **P30 bumps tea from 0.22.0 to 0.24.0 and removes the stand-in:** the window reads through tea's own hook, `use-model.ts` is deleted, and the two rules that name it drop it. It starts once 0.24.0 is out and P14 has landed.
- **React Compiler from day one.** Owner rule, decided 2026-11-02; the how is decided 2026-11-03 in [the note](../direction/react-compiler.md), strict: every Compiler finding fails the build, with no setting and no advice level, and the only exit is `"use no memo"` with an owner-approved `compiler-ledger.json` row. No Babel (owner, 2026-11-02): `build.ts` compiles every `.tsx` file with oxc's native port of the Compiler, in Rolldown. The build owns the check, and `lint:compiler` calls the same step: either fails on any function the Compiler skips that `compiler-ledger.json` does not name. A view never reads the clock; the time comes through a Cmd. `react/refs`, `react/immutability`, `react/display-name`, `react/purity` and our `no-clock-in-view` block in `next/**/*.tsx`, and `one-store-hook` in all of `next/**`. The rules, the check and the packages landed in the exam PR (P2, [as built](#the-exam-on-main)); the Compiler goes into the stage's build in P12 (the detail's T6) ([the detail](./tier-1-detail.md#the-exam-pr-not-in-this-plan)).
- **One bundler in `next/`: Rolldown** (owner, 2026-11-05; it was a lean at 85%, from [experiment 195](../../experiments/195-oxc-toolchain.md)). P1's `deps.test.ts` bundles each top level with esbuild, copied from today's `lint:browser`, and `esbuild` sits in `next/apps/fabrika/package.json`. P12, the pull request that brings Rolldown in, also moves that exam to Rolldown and drops `esbuild` from `next/`. The exam half of P12 (the `rolldown` catalog line, `deps.test.ts`, the package line) is not the builder's: see [the split](#the-pull-requests-one-at-a-time). The root keeps `esbuild` for today's `lint:browser`. Everything that builds in `next/` uses Rolldown from P12 on, and nothing in `next/` bundles before P12 but that exam. Where Rolldown's way is not yet proven here is in [the detail's Packages](./tier-1-detail.md#packages). PR 223's two `.tsx` files compile whole: 5 functions, 0 skips ([experiment 194](../../experiments/194-react-compiler.md), and [195](../../experiments/195-oxc-toolchain.md) on oxc's port).
- **`_tag`, written by Effect Schema, for every union we define.** tea's Msgs and Cmds keep `type`. PR 223's `kind` and `is` move ([Tags](./tier-1-detail.md#tags)).
- **No bare `of`, and no `xOf` names.** The copies bring about 55, so they get fixed on the way in.
- **Words:** hands, a window and an agent dial the brain. `client` means any of them at the door, and `host` is a place hands can run ([the note](../direction/brain-hands-window-agent.md)). No `peer`, and no `node` for a thing that connects. PR 223's 53 `peer` lines go when it moves. The shell is `fabsh`.
- **Layers go one way,** and programs have no power of their own. A Cmd is data, and the runtime does it.
- **Every keybinding is configurable from day one.** Owner rule ([the note](../direction/keybindings-are-configurable.md), decided 2026-11-01). The first window reads its keys from the person's own file, `~/.fabrika/keybindings.toml`, and no key is wired into a handler. That covers `e` on a note, and every other key Tier 1 shows. How a browser tab, which has no files, gets that table is in [the note](../direction/keybindings-are-configurable.md#a-browser-tab-has-no-files). See [the questions](#open-questions).
- **Hot reload from day one.** Owner rule, decided 2026-11-01 ([the note](../direction/hot-reload.md)). Under `dev.ts`, saving a program's file swaps that program's code in its running processes at their next step, through each one's mailbox. The model is kept when the new state schema decodes it, and only that process is refused when it does not. No other process stops, and the brain restarts only for a core change. A window swaps that program's view the same way. Every record a process writes names the build that wrote it. Size: about 400 to 600 product lines and 300 to 500 test lines, 50% sure, not in the approved size yet. At the measured rate that is about 1.2 to 1.8 agent hours, a `2` on the scale (0.4 to 0.7 at 1,660 an hour, a `1`).
- **Never copied, with three named exceptions from the owner:** styling, `programs/markdown`, and the MCP tools. Each copy carries a comment naming its source path and commit.

**How it is built:**

- **Every pull request takes the pipeline's steps, by hand:** plan, tests first, build, mutation, one review, each by its own agent, and the lead agent's check before merge ([how it is built now](#how-it-is-built-now)). *Changed 2026-11-05: this said every pull request goes through today's pipeline, with a step that cannot run going by hand. Today's pipeline is paused, so for `next/` every step goes by hand, and each is logged in `field/`.*
- **The test writer only adds new `*.test.ts` files.** A helper goes in such a file too. It does not move a test, change one, delete one, or write a data fixture. The builder never touches the tests or the exam, and the lead agent checks both in the diff before merge. So a saved vector or a fixture comes from an exam PR, or sits inside a test file. A later law goes in a new test file rather than a bigger old one, so each landing adds its own e2e file, and the exam holds a thin runner that finds them (my call, 80%). A test that renders React uses `createElement` in a `.ts` file.
- **A law on a real window or a real service can go red first now.** In the lane, the test writer ran vitest in a box with a temp home and no network, so laws on real Chromium, real Electron, launchd or the cloud (p29, p31, p46 to p48, p50, the live halves of p51, p58, p59, p62, p41) had no red-to-green step. By hand, the test writer runs on the laptop, so Chromium and Electron laws are written and run red on the base like the rest, one Electron test app at a time, with `FABRIKA_HOME` set to a short temp path. Laws on launchd from a dev build, the real finger and the cloud still run by hand and are logged. Lean, 70%; the first Electron law tells.
- **The catalog lives in `pnpm-workspace.yaml`, an exam file.** A new dependency lands in an exam PR before its pull request, or in that pull request's exam half (P12, P30), so the owner reads it. A package's own `package.json` is the builder's, and so is `pnpm-lock.yaml`. Today's catalog already has Electron, `@modelcontextprotocol/server`, `@pierre/highlights` and the mdast packages, and P2 added `oxc-transform-react` and `oxc-parser` at 0.157.0. `@effect/platform-browser` and `rolldown` are ones it lacks; `rolldown` comes with P12's exam half.
- **A rule or law that lives in the exam is written by the exam PR.** A pull request that "owns" it (p24, p32, p65) only turns it green. Everything else is the test writer's: each machine's `*.laws.test.ts`, and the ported tests for the copies. The small exam holds their fixtures and rules.
- **On main, every law is `new`.** There is no `next/` to pass an `existing` test on. So plan-115's `existing` laws go red first like the rest, and p16 means PR 223's tests come over, fitted.
- **Guarding the exam files in today's lane no longer blocks Tier 1.** Tracker ticket 122 adds `next/**/*.test.ts`, `fixtures/next/**`, the exam folder, `boundary-rules.json`, `vitest.config.ts` and `pnpm-workspace.yaml` to the lane's `RULES` (`packages/pipeline/src/stages/exam/machine.ts`). No lane builds `next/` now, so the lead agent's read of each diff is the guard. Ticket 122 stays for when a lane does.
- **Long checks do not block a pull request.** Decided 2026-11-01 in [fast and daily mutation](../direction/fast-and-daily-mutation.md): "A check that cannot finish inside the per-pull-request budget does not gate the pull request. It runs on a schedule, and what it finds becomes a ticket." The checks that stop the wrong thing from merging never move to the daily side: typecheck, lint, the leak checks, the dead-export ledger and the tests of changed files. Tier 1's likely long ones: real launchd, the cloud smoke run, chaos. The daily run itself is not in Tier 1: the note puts `next/`'s mutation queue in Tier 6, and [experiment 197](../../experiments/197-daily-checks-on-cloudflare.md) sizes running it on Cloudflare. Until then a long check runs by hand and is logged. *Changed 2026-11-05: this said "new direction, with no note on main yet", which was wrong since 2026-11-01.*
- **Mutation on a pull request is the fast check, as the note sets it.** Changed lines first, one mutant per line, then the rest; a 5-minute cap, a 10 s test limit, static mutants off, the end-to-end tests left out; a survivor is advice and never stops the pull request. Fixed seed, `nice -n 15`. [The detail's mutation step](./tier-1-detail.md#the-mutation-step) says which files each part covers. *Old guess, wrong for this rule: 10 to 25 machine minutes per PR.*
- **Exact versions, never a range.** Today's catalog: Effect 4.1.1, pnpm 12.16.1, Node 26.13.0, Electron 45.2.1, React 19.3.1, tea 0.22.0, since [PR 258](https://github.com/usirin/tea-fabrika/pull/258) landed on 2026-11-01; oxlint 1.90.0, and oxc-parser and oxc-transform-react 0.157.0 since P2. tea moves to 0.24.0 in P30. The design was read on Effect 4.0.6, so the plan of each pull request re-checks its `Schema` sketches against 4.1.1.
- **Checks:** `pnpm typecheck`, `pnpm lint`, `pnpm test` before any change is offered. None needs a key or the network. A real deploy needs the owner's yes after reading `alchemy plan`.
- **Screens:** real shots in `docs/`, in the five layouts, and how Linear would do it, per screen. "No rough first versions" starts when a person opens `next/` for real work, which is notes in PR D.

**How it looks.** The tile and color rules were decided for today's version, and `next/` reads them as lessons: [tile guidelines](../direction/tile-guidelines.md), [color principles](../direction/color-principles.md), [pipe colors](../direction/pipe-colors.md). What that means in Tier 1:

```tsx
// A sketch, from the tile guidelines. Tier 1 has no pipes, so it uses the plain case.
<section className="tile focused" aria-current="true" aria-label="notes, t2">
	<header className="titlebar">
		<span className="slot" aria-hidden="true" /> {/* a plain tile: a dot */}
		<h2 className="name">notes</h2>
	</header>
	<Body />
</section>
```

- **Holds now:** a color means one thing, color never works alone, slate steps for a plain tile, no line under a washed title, WCAG 2.2 AA with no setting, one named region per tile.
- **Waits:** the six pipe colors and letters wait for pipes in Tier 2. Prefix keys and folding keys wait for the desk.
- **No clash with the copy:** today's app moved to Radix steps in [PR 308](https://github.com/usirin/tea-fabrika/pull/308) (ticket 144), so the [styling exception](./tier-1-detail.md#styling) copies tokens that already follow these rules. The owner called it moot on 2026-11-02 ([question 5](#open-questions)).

**Windows.** [The note](../direction/windows-in-next.md) is proposed. Plan with [the lean](#open-questions) on it.

## Words that look like a clash

These were checked. The first one is listed again as [open question 9](#open-questions), since a note and this plan still say two things.

- **`hello` and `initialize`.** This plan reads the wire method as `initialize`, as PR 223 has it. `Hello` is the schema, and "hello" is the plain word. The sync note's sketch `method: "hello"` is old. Tier 1 adds one thing the note does not name: the brain's first frame, `challenge`, carries the nonce the hello signs. The detail's old `ping: Schema.Number` was wrong: it is a string such as `"30s"`, as in PR 223 and the note. The hello also records the OS ([question 3](#open-questions)), and the detail's `Hello` sketch has no field for it yet; its name and values are P10's plan to set.
- **Keychain and `safeStorage`.** Same thing on a Mac. Keys are made with Node's WebCrypto, and `safeStorage`'s async API seals each private half into `userData`, using a master key in the Keychain. The sync API is removed in Electron 46. The capability word `keychain` means "can seal" (renamed `seal` by [question 3](#open-questions)). If the Keychain asks when opening fabrika, the window key moves to WebCrypto in a hidden page. *P4 told, 2026-11-05 ([experiment 214](../../experiments/214-mac-app-four-unknowns.md)):* seal and two opens on one unsigned binary blocked on nothing, so that way out is not needed for this pass. A rebuilt or re-signed app is a new binary to the Keychain and may ask once, which the owner's "open the built app twice" check in P19 still tests.
- **`port` and `pid`.** The sync note's T2 sketch says `{port: "tile:t3", m}`, as `link.ts` once did. Tier 1 and PR 223 name the process: `pid`, as in `Mailbox.send("counter:1", ...)`. A tile is a window's view of a process. "Ports" in this plan means Elm ports, a program's typed inputs and outputs. Nothing named `port` goes on the wire.
- **"Menu bar" and "menu bar extra".** Decided 2026-11-03 in [the frame](../direction/the-frame.md#9-menu-bar-in-next): `next/`'s icon and its rows are the **menu bar extra**, Apple's word, since on macOS "the menu bar" is the system's bar. This page and the detail still say "menu bar" in older lines. New code, tests and pull request titles say menu bar extra. The same note decided that no frame part is called a panel: the menu bar extra's rows are its **popover**, where the detail says "panel" (`panel-preload.ts` is a file name for P21's plan to rethink). It also renamed `next/`'s `fabrika/desk` to `fabrika/tezgah`, which the detail's Tier 2 lines still call the desk.

## A starting guess at the pieces

**Milestones, not pull requests.** These six pieces and their exam PRs were the first cut. They show the order of the demos, and they are too big for small pull requests. PR A carries PR 223's 3,323 lines plus T1 to T6, and PR D is about 1,500 to 2,000 product lines. [The split below](#the-pull-requests-one-at-a-time) cuts them into pull requests a builder takes one at a time. [The tasks T0 to T22](./tier-1-detail.md#tasks) are finer, and each pull request names the ones it carries.

| Piece | The demo at its end | Tasks |
|---|---|---|
| Exam | Rules red on PR 223's tree, each fire read by hand | see the detail |
| A, door and plumbing | Check 1, 2 and 8 | T0 to T6 |
| B, the app | Check 3 | T7, T8, T15, T9 |
| C, cloud | Check 4 | T10, T11 |
| Small exam, then D, notes | Check 5 | T16, T17, T18, T20, T21, T19 |
| D2's design pass, then D2, backup | Check 6 | T22 |
| E, chaos | Check 7 | T12, T13, T14 |

**Names-only tasks do not land alone.** T1 and T16 add names whose bodies only die, so the next task's tests load. That suited one pull request with local commits. On main, it would be a stub sitting in the code. Drop them as tasks: each landing adds the names it uses, and each of their laws moves to the landing that first adds its code. A test that cannot load because a name is missing counts as red, so this loses nothing, and c1 reads per landing. My call, 80%.

**The dead-export check on a bottom-up landing.** Names in a package's `exports` count as public, so they pass. An internal name has to be used already. Nobody has run this on the new shape, which is why the first package landing tries it.

**The whole size: 5,360 to 7,440 product lines and 4,940 to 7,200 test lines, a guess at 50%, which is about 17 to 24 agent hours at the measured full-lane rate of 600 lines an agent hour** (6 to 9 at this repo's median of 1,660, mostly builders alone). Restated 2026-11-01 by [agent hours](../direction/agent-hours.md), from [experiment 187](../../experiments/187-agent-hours.md); sure of the hours: 55%, and [the detail](./tier-1-detail.md#size) has each part on the doubling scale. The by-hand steps are the same steps, so 600 an hour still leads. [The split](#the-pull-requests-one-at-a-time) adds up to more: see there. *Old guess, wrong: 63 to 92 agent hours, at an unsourced "about 150 lines an hour". Before that, also wrong: 44 to 70.*

## The pull requests, one at a time

**Added 2026-11-05. A builder takes one row.** Each row is one pull request that lands alone, with its checks green. It builds on the lean that [PR 223 is read and each layer lands already fixed](#still-open-how-next-reaches-the-lane) (60%), so T0, the move, goes away: each layer's first pull request makes its package. Rows are numbered P1 to P29 in the order they can start, and P30, added later, waits on a release, since A1, C2 or D5 already name things in the notes. "Piece" is [the milestone](#a-starting-guess-at-the-pieces) a row belongs to. An exam pull request is written by an agent that is not the builder and read by the owner. An exam half inside a build row (P12, P30) is written the same way, by an agent that is not the builder, and the owner reads it. A spike ends in an answer, not a merge. "Detail" means [the detail's tasks](./tier-1-detail.md#tasks), and its laws are named there.

| PR | Piece | What it builds | The note it builds | Needs first | Files | Agent hours |
|---|---|---|---|---|---|---|
| P1 | exam | **Done 2026-11-05, [PR 402](https://github.com/usirin/tea-fabrika/pull/402).** The exam's frame: `pnpm-workspace.yaml` and `vitest.config.ts` globs for `next/`, a `next` CI job with a thin e2e runner, `layer-rules.json` and `boundary-rules.json` rows, the layers, deps and laws-scan tests, the `sshsig` vectors in `fixtures/next/`, `.gitattributes` (detail, exam items 7 to 10 and 12) | [every pull request takes the steps](../direction/next-is-a-pipeline-pre-run.md), [windows in next](../direction/windows-in-next.md) | nothing | about 12 | 0.5 to 1 |
| P2 | exam | **Done 2026-11-05, [PR 401](https://github.com/usirin/tea-fabrika/pull/401).** The exam's rules, each with planted tests and its fire count on PR 223's tree: `no-promises`, `no-effect-run-outside-edge`, `no-of`, `no-hand-tag`, four React rules with `react/purity`, `one-store-hook`, `no-clock-in-view` (added by the owner), `lint:compiler` with an empty `compiler-ledger.json`, and `oxc-transform-react` and `oxc-parser` in the catalog (exam items 1 to 6, 11, 13) | [no Promises](../direction/no-promises.md), [schema classes](../direction/schema-classes-not-of-helpers.md), [React Compiler](../direction/react-compiler.md) | nothing; rebases on P1's catalog lines | about 14 | 1 to 1.5 |
| P3 | A | **Done 2026-11-05, yes ([experiment 215](../../experiments/215-browser-key-survives-reload.md), [PR 398](https://github.com/usirin/tea-fabrika/pull/398)).** Spike: does a non-extractable Ed25519 key survive a reload in IndexedDB in Chromium on 127.0.0.1? It survives a reload and a browser restart, and every export is refused. The key belongs to the exact origin, port included, and `localhost` is another origin, so the person's brain listens on one fixed port (P12, P14) (detail T5) | [a browser is always a client](../direction/a-browser-is-always-a-client.md) | nothing | throwaway | 0.25 |
| P4 | B | **Done 2026-11-05, all four yes ([experiment 214](../../experiments/214-mac-app-four-unknowns.md), [PR 399](https://github.com/usirin/tea-fabrika/pull/399)).** Spike, T8's four, on a dev build: launchd from an unsigned build, `safeStorage` under Playwright in a temp home, whether the Keychain asks on open, Touch ID. No way out is needed for this pass; what each answer changes is in P19 and P21 | [the desktop layer](../direction/the-desktop-layer.md) | nothing | throwaway | 0.5 to 1 |
| P5 | D2 | The backup's design pass, as [the backup](#the-backup-needs-a-design-pass-first) lists: a proposed note the owner reads before any test is written | [every update builds every layer](../direction/every-update-builds-every-layer.md) | nothing | 1 or 2 docs | 0.25 to 0.5 |
| P6 | A | `@kampus/libfabrika` and the data layer: the log's `Entry` with `at`, `by`, `said` and `seen`, and `cause` if [question 11](#open-questions) says yes; the `Ledger` service, `Ledger.sql` on `node:sqlite`, the project (detail T2's data half, p18 to p21) | [the five layers](../direction/a-local-first-sync-engine.md#layer-2-data-decided-2026-10-30), [saved state, P3](../direction/saved-state.md#s1-every-entry-says-what-its-writer-had-seen), [ledger behind a service](../direction/ledger-behind-a-service.md) | P1, P2 | about 10 | 1 to 1.5 |
| P7 | A | `transport/sshsig.ts`: SSHSIG written and checked, Ed25519 only, on P1's vectors (p27's vectors, p44) | the detail's call 2, settled by the owner | P1, P2; rebases on P6's package | about 4 | 0.3 to 0.5 |
| P8 | exam | The small exam: p22's wording, `notes-letters.jsonl`, the ported Markdown, highlight and agents tests, `agent-may` and `bytes` tests, the new edge lines: `mcp/serve.ts` and `programs/notes/highlight.ts` join the edge list (detail, the small exam) | the detail's small exam | P1, P2 | about 9 | 0.5 to 1 |
| P9 | A | Coordination: Mailbox, ProcessManager, who belongs (`MemberFact`, `foldMembers`, p28), `granted`, `denied` and `revoked` facts (detail T2's coordination half) | [the five layers](../direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31) | P6 | about 8 | 1 to 1.3 |
| P10 | A | The door: the signed hello with `has`, `platform` and the OS, `challenge`, `answerFrame`, `waiting`, the client manager; an unknown key gets `not_granted` and writes nothing (detail T4, p23, p26, p42, p43); `verify` and `seal` as the capability words | [the five layers, T4 and T5](../direction/a-local-first-sync-engine.md#layer-1-transport-decided-2026-10-30-t3-changed-2026-10-31), [brain, hands, window, agent](../direction/brain-hands-window-agent.md) | P7, P9; questions 9 and 10 before merge | about 8 | 1 to 1.3 |
| P11 | A | Programs: `Program` with its Cmd type, `refuse`, `inputs` and `outputs`; the runner and stepper; the `counter` package (detail T3, p14, p22, p25, p35) | [the app layer, A1 to A3](../direction/the-cloud-is-one-more-host.md#decided-2026-10-31-the-app-layer), [Elm first](../direction/elm-first.md) | P9 | about 8 | 1 to 1.3 |
| P12 | A | The local stage: `brain.ts`, the gateway, `dev.ts`, the local `alchemy.run.ts`, `grant.ts`, `build.ts` on Rolldown with the React Compiler, a wait as data on the socket; the person's brain on one fixed port, since a tab's key is per origin (experiment 215); the bar measured on the base first. Its exam half, by an agent that is not the builder and read by the owner: `rolldown` pinned in the catalog, `deps.test.ts` bundling on Rolldown, and `esbuild` out of `next/apps/fabrika/package.json`, so `next/` has one bundler (detail T6's stage half, p10 to p13, p15, p17) | [local is the cloud](../direction/local-is-the-cloud.md), [React Compiler](../direction/react-compiler.md), [tea is the engine](../direction/tea-is-the-engine.md) | P10, P11 | about 12 | 1.3 to 1.8 |
| P13 | D | The notes program: its package, save on a `base`, a stale save refused and writing nothing, fold; a wake recorded at 1,000 and 10,000 saves (detail T16, T17, p52 to p56) | the detail's [Notes](./tier-1-detail.md#notes) | P11, P8 | about 6 | 0.8 to 1.2 |
| P14 | A | The first window, in a browser tab: `@kampus/tuval`'s browser key, the waiting view, the one store hook, the counter's view, the styling copy with Manti and `theme.css`, the keys read from the keybindings table, the window machine's `now` Cmd (the time never read in a view, about 40 lines by the React Compiler note). It creates `window/use-model.ts`, the one file `one-store-hook` allows. Lean from experiment 215: call `navigator.storage.persist()` once after the grant, one line, its effect not measured. Demo: checks 1, 2 and 8, the success bar's browser half (detail T5, T6's window half, p24, p29, p32) | [Elm first](../direction/elm-first.md), [UI on Manti](../direction/ui-on-manti.md), [keybindings are configurable](../direction/keybindings-are-configurable.md) | P12, P3 | about 14 | 1 to 1.3 |
| P15 | A | Hot reload under `dev.ts`: a program's new code swaps in at its next step, the model kept when the new schema decodes it, and every record names its build. A view swapped this way goes through the Compiler too, and experiment 195 did not try hot reload with it | [hot reload](../direction/hot-reload.md) | P12 | about 6 | 1.2 to 1.8 |
| P16 | C | One built file: programs and window scripts inside it, the program table; the local bar must not get worse. Rolldown's way to carry a script as text is not yet proven here ([Packages](./tier-1-detail.md#packages)) (detail T10, p33) | [the cloud is one more host](../direction/the-cloud-is-one-more-host.md), [local is the cloud](../direction/local-is-the-cloud.md) | P12 | about 4 | 0.3 to 0.5 |
| P17 | E | The chaos program: its package, `Fault` cases, the nemesis's check, notes and the counter as targets (detail T12, p34, p36, c11) | the detail's [Chaos monkey](./tier-1-detail.md#chaos-monkey) | P11, P13 | about 5 | 0.5 to 0.7 |
| P18 | B | The client cores: `tuval` dom, browser and headless, the Effect socket, tiles that read their part with a selector and no `memo` (detail T7, p30, p50, c8) | [the desktop layer](../direction/the-desktop-layer.md), [React Compiler, C6](../direction/react-compiler.md) | P14 | about 10 | 0.8 to 1.2 |
| P19 | B | The Electron app: founding screen, the person key and window key sealed, the brain as a plain launchd service (detail T8, p44, p46). From P4: no `childBrain`; Quit waits until `launchctl print` no longer finds the label, since `bootout` returns early; tests seal through a stand-in service, since Playwright's mock keychain does not reach the async API and a seal makes a real login Keychain item; the one law that seals for real uses its own `productName` and deletes its item after. The owner still opens the built app twice. The success bar's Electron half | [the desktop layer](../direction/the-desktop-layer.md) | P18, P4 | about 9 | 1 to 1.5 |
| P20 | D | The notes tile: the plain text box, `e` from the keys table, "Keep mine as a new note"; Escape saves then reads, as Done does ([modes](../direction/modes.md), decided 2026-11-01, 65%) (detail T18, p57, c14) | the detail's Notes | P13, P18 | about 4 | 0.4 to 0.7 |
| P21 | B | The menu bar extra: Approve, Deny and Remove, `PersonCheck`, `menuView` as a pure Elm view (detail T15, p45, p49, p51). P4 found `canPromptTouchID()` true on an unsigned build; whether `promptTouchID` shows and answers from it needs a person, at the demo | [the desktop layer](../direction/the-desktop-layer.md), [the frame, item 9](../direction/the-frame.md#9-menu-bar-in-next) | P19 | about 10 | 1 to 1.5 |
| P22 | D | Drawing a note: the copied `programs/markdown` and highlighter, first commit unchanged, and the page's content policy; the highlighter as its own script, split by Rolldown on its `import()`, not yet proven here (detail T20, p61, p62, c16) | the detail's [Drawing a note](./tier-1-detail.md#drawing-a-note) | P20 | about 10 | 2.1 to 2.5 |
| P23 | B | The app's demo: routes, "Open in browser" and its one-time link, shots in five layouts. Check 3 (detail T9, p31, p47, p48) | [the desktop layer](../direction/the-desktop-layer.md) | P21 | about 4 | 0.4 to 0.6 |
| P24 | C | The cloud stage and the menu bar extra's second link. The owner reads `alchemy plan` and says yes. Check 4 (detail T11, p41) | [the ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md), [local is the cloud](../direction/local-is-the-cloud.md) | P16, P21 | about 4 | 0.5 to 0.8 |
| P25 | D | Agents through MCP: the copied tools, `fabrika mcp --as`, the bridge as a client with a key, Approve once per agent name; spike first on Claude Code listing tools while it waits (detail T21, p63, p64, c17) | the detail's [Agents through MCP](./tier-1-detail.md#agents-through-mcp) | P13, P21, P8 | about 12 | 1.1 to 1.6 |
| P26 | D | Notes go real on Cloudflare: the phone spike, the owner's yes on `alchemy plan`, the deploy. Check 5 (detail T19, p58, p59, c15) | [the ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md) | P22, P25, P24 | about 6 | 0.3 to 0.5 |
| P27 | E | Live faults on each stage; no chaos in the build for the real ledger (detail T13, p37, p38, p60) | the detail's Chaos monkey | P17, P24 | about 7 | 0.5 to 0.7 |
| P28 | D2 | The backup: its own small exam, then the sheet, recovery on a new Mac and `added` on `founded.keys`. Check 6 (detail T22) | P5's note, once the owner reads it | P26, P5 | not known until P5 | 0.5 to 1 |
| P29 | E | The drill on the MCP client, the owner's yes on `alchemy plan --stage drill`, a verdict on screen. Check 7 (detail T14, p39) | the detail's Chaos monkey | P27, P25 | about 4 | 0.5 to 0.6 |
| P30 | A | tea's own hook: `@demlik/tea` from 0.22.0 to 0.24.0, the window reads through tea's `useMachine` on the Effect engine, and `window/use-model.ts` is deleted. Its exam half, by an agent that is not the builder and read by the owner: the catalog line, and `one-store-hook` and the edge list without `use-model.ts`. Whether tea's hook takes a selector, as `useModel` does, is its plan's to read in 0.24.0's docs | [Elm first](../direction/elm-first.md), [React Compiler, C4](../direction/react-compiler.md) | P14, and tea 0.24.0 released (the demlik owner's call) | about 6 | 0.3 to 0.5, a guess |

**30 rows: 3 exams, 2 spikes, 1 design pass and 24 builds, two of them with an exam half (P12, P30).** Four are done: P1, P2, P3 and P4. *Changed 2026-11-05: P30, tea's own hook, was added; it was 29 rows and 23 builds.* The rows add up to about 21.8 to 32 agent hours at 600 lines an hour. That is above the plan's 17 to 24 for three reasons: hot reload, configurable keys, `seen` and Manti were never in that total (about 1.75 to 2.7 more, from their own sizes above); the exams, spikes and design pass were never counted (about 3 to 5); and splitting adds a plan and a review to each small piece. Each row's hours are my split of [the detail's size rows](./tier-1-detail.md#size), sure 50%; the row's own plan writes its real estimate, and P6's real `spent` is the first number to check this against.

**What can run at once.** At most 5 agents build at a time, and one Electron test app runs at a time ([AGENTS.md](../../AGENTS.md#go-easy-on-the-machine)). Each wave starts when what it needs has merged, and a free slot takes the next row.

```text
wave 1, first      P1   P2   P3   P4   P5      nothing needed first; P1 to P4 done 2026-11-05, P5 left
wave 2             P6   P7   P8                after P1 and P2
wave 3             P9
wave 4             P10  P11                    P10 also waits on P7
wave 5             P12  P13                    P13 needs only P11 and P8
wave 6             P14  P15  P16  P17          P17 needs P11 and P13
wave 7             P18
wave 8             P19  P20
wave 9             P21  P22
wave 10            P23  P24  P25
wave 11            P26  P27
wave 12            P28  P29
any time           P30                          once P14 has landed and tea 0.24.0 is out
```

- **The long pole is the door, then the app:** P6, P9, P10, P12, P14, P18, P19, P21, then P24 and P25, P26, and P28 or P29. Nothing on it can run beside itself, so more builders do not make it shorter.
- **P13 and P17 start before the cloud lands.** My call, 70%. Order rules 5 and 7 are about where real notes live and about chaos's target list; the notes program and the chaos program touch neither until P26 and P27. If the owner reads rule 5 as "no notes code before check 4", P13 moves to after P24, and the plan loses about three waves of overlap.
- **Each row's plan names its laws in full** from the detail, and the lead agent approves it if it builds only decided notes. P5, P6 with `cause`, and P10 with questions 9 and 10 go to the owner.

## The order of work

Most of the order above is a choice. **These parts are not, and each says why:**

1. **The exam lands before any builder works in `next/`.** A builder cannot be held to rules that do not exist. An exam pull request has no build step, and the owner reads it. *Changed 2026-11-05: rule 1 was "ticket 117, then the planner gap, then this plan", and this rule began with guarding the exam files in today's lane (ticket 122). With today's pipeline paused for `next/`, neither waits: the lead agent's read of each diff guards the exam.*
2. **The door before the app, the app before the cloud.** The menu bar extra signs what the door checks, and the cloud proves the same flow. The terminal command `grant.ts` lets windows in until Approve exists.
3. **The cloud before notes.** Real notes live on Cloudflare. Check 4 still proves the counter there, on data nobody minds losing. The split reads this as "before notes go real" (P26), and builds the notes program earlier (my call, 70%, [the split](#the-pull-requests-one-at-a-time)).
4. **Words and fact shapes are settled before real facts get written,** which is the first real note. A fact written then lives forever: `has`, `saw`, `as`, what `granted` keeps, `cause` if the owner says yes, and any OS or capability word.
   - *Added 2026-11-01:* `seen` lands on every ledger entry before Tier 1's first real entry, and the app layer's A3 `saw` moves into it ([saved state, S1](../direction/saved-state.md#s1-every-entry-says-what-its-writer-had-seen)). About 50 to 80 lines, 0.1 to 0.15 agent hours at the measured 600 an hour, a `0.25` on the scale (under 0.05 at 1,660), not in the total above. It lands in P6.
5. **Notes before chaos.** Chaos needs a real target, its drill dials through the MCP client, and doing it first would write its target list, driver and p39 twice (biggest call 10).
6. **Backup right after notes.** Settled by the owner: once notes are real, a lost Mac would otherwise mean a new ledger.
7. **Each new `next/` law lands before the code it checks.** The test writer's tests must fail first, on the base.

*Changed 2026-11-05: the old rule 3, "how `next/` reaches the lane is answered before the first `next/` lane", no longer blocks anything. No lane builds `next/` now. What lands still follows [the lean](#still-open-how-next-reaches-the-lane).*

**Free to change:** the split inside any piece, the order of rows inside a piece (except that P21 needs P19's keys), and where the shared names land. Today's other work waits for nothing here.

**Each pull request:** its plan, approved; the test writer adds its tests and runs them red on the base; the builder works with local commits and cannot touch the tests; the fast mutation check; one review by another agent; screenshots for a window; the lead agent's read of the diff, green CI and the leak grep; then the merge and its `MergeRow`. Runs and notes go to `field/` the same day.

### One ticket per pull request

- *Changed 2026-11-05:* the planner was going to file one tracker ticket per pull request after the owner's yes ([PR 279](https://github.com/usirin/tea-fabrika/pull/279)). That flow is paused for `next/`. Whether the lead agent files each row as a ticket by hand is [question 12](#open-questions).
- **Exam pull requests go by hand and are logged.** That covers P1, P2, P8 and the backup's own small exam in P28.

## What the notes of 2026-11-03 to 2026-11-05 change

**Two notes change what Tier 1 builds, two change its words, one changes how a pull request lands, and none changes its order or the approved size.** Every note dated in that span in [the index](../direction/README.md) was read for this, plus one that changed in it. *Checked again later on 2026-11-05,* after PRs 391 to 403 landed, with the owner's calls that day: the exam as built, one bundler, the edge list, tea's hook, and the two spikes. Those change P12, P14, P19, P20, P21 and P22 and add P30, and still not the order of the demos.

| Note | State | What it changes in Tier 1 |
|---|---|---|
| [Programs: one job, a location](../direction/program-guidelines.md) | decided 2026-11-03 | Nothing. "Tier 1 adds refuse, inputs and outputs", as the detail has it; "`location` and the focus history go in with Tier 2's desk". |
| [Designs are drawn on Claude Design](../direction/design-on-claude-design.md) | decided 2026-11-03 | Nothing built. A Tier 1 screen that gets a design pass is drawn there, on the shared design package. |
| [Autonomy is measured trust](../direction/autonomy-is-measured-trust.md) | decided 2026-11-03, measures proposed | How a pull request lands: "A merge never waits on the owner", and each merge writes a `MergeRow`. See [how it is built now](#how-it-is-built-now). |
| [We follow Domain-Driven Design](../direction/we-follow-ddd.md) | decided 2026-11-03 | Words: "The glossary is `next/`'s language". A pull request that coins a word adds its row under its context: ledger for layers 2 and 3, clients for layer 1, runtime for layer 4, frame for Tuval. |
| [Use the industry's names](../direction/use-the-industrys-names.md) | changed 2026-11-03 | Nothing beyond the DDD note, which replaced its two-domains rule. |
| [A ticket says where it came from](../direction/a-ticket-says-where-it-came-from.md) | decided 2026-11-03, shape proposed | Nothing. "`next/`'s tracker carries the same key when it is built", in Tier 2. |
| [React Compiler from day one](../direction/react-compiler.md) | decided 2026-11-03 | What Tier 1 builds, already in this plan: the rules and `lint:compiler` in P2, Rolldown with the Compiler in P12, the time through a Cmd. Size: about 230 lines in the exam, by the detail; about 60 lines changed in `build.ts` and about 40 for the `now` Cmd, by the note. |
| [The frame](../direction/the-frame.md) | decided 2026-11-03, parts proposed | Words: `next/`'s menu bar is the **menu bar extra** (item 9): "words only; nothing is built". |
| [Layers](../direction/layers.md) | decided 2026-11-03 | Nothing. "`next/`: all of it, with tezgah, the window manager, in Tier 2." |
| [Areas](../direction/areas.md) | proposed, parts decided 2026-11-03 and 2026-11-04 | Nothing. "Nothing about areas is in `next/` yet"; its tracker is a later tier. |
| [Shared tiles](../direction/shared-tiles.md) | proposed, parts decided 2026-11-04 and 2026-11-05 | Nothing. `next/` "reads it as a lesson", and presence rides the ephemeral lane in a later tier. |
| [Inputs carry their sender](../direction/inputs-carry-their-sender.md) | direction decided 2026-11-04, details proposed | What Tier 1 builds, if the owner says yes: `cause` on `next/`'s ledger `Entry`. The note: "Adding it now is proposed in the plan: an entry written without it never gets it back." [Question 11](#open-questions). `by` from the checked key is already in Tier 1. |
| [Talk where you work](../direction/talk-where-you-work.md) | proposed, parts decided 2026-11-04 and 2026-11-05 | Nothing in Tier 1: no row touches talk or threads, and talking to agents is Tier 5. *Changed 2026-11-05:* this quoted "the spot needs a design in `next/` first", which [PR 403](https://github.com/usirin/tea-fabrika/pull/403) replaced: talking at a spot is the box, then one thread tile that opens only from a spot, and a spot is a program's `location` plus the version it came from, "written for both". The network allow list and each harness's permission words in `fabrika.toml` (PRs 391 and 393) are today's started `claude`. Tier 5's "chat tile" in the detail and in [the tiers](./tiers.md) changes with this note once it settles, as the note says. |
| [Principles](../direction/principles.md) | proposed 2026-11-05 | Nothing until settled. Tier 1 already keeps its first and fourth in part: an agent writes under its own key, and MCP tools are made from a program's inputs. Principle 5, unsure is a setting, came 2026-11-05 ([PR 392](https://github.com/usirin/tea-fabrika/pull/392)); if it settles, its own line "a wall is never a setting an agent can turn off" keeps the exam's rules, the Compiler check included, out of `fabrika.toml`. |
| [Pipeline strategies](../direction/pipeline-strategies.md) | proposed 2026-11-05 | Nothing. "`next/`'s pipeline would take the same words when it is built", in Tier 6. |
| [Design language](../direction/design-language.md) | proposed 2026-11-04 | Nothing until settled. Its pages sort notes for both versions, and the design package stays the one thing today's app and `next/` share. |
| [Agents commit as a bot](../direction/agents-commit-as-a-bot.md) | proposed, direction decided 2026-11-05 | Nothing. No agent commits from `next/` until Tier 5. |
| [The ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md) | changed 2026-11-05 | Nothing. Its new part, talk between agents not tied to tickets, is Tiers 3 and 5. |
| [Every pull request takes the steps](../direction/next-is-a-pipeline-pre-run.md) | order changed 2026-11-05 ([PR 396](https://github.com/usirin/tea-fabrika/pull/396)) | How it is built: `next/` no longer waits on the pipeline, and each step goes by hand. This plan already followed it. Its "how a change lands" still says "the owner's yes"; this plan follows the newer [autonomy](../direction/autonomy-is-measured-trust.md) note there. |
| [A browser tab's key survives](../../experiments/215-browser-key-survives-reload.md), [T8's four unknowns](../../experiments/214-mac-app-four-unknowns.md) | experiments 215 and 214, 2026-11-05 | P3 and P4, done: a fixed port for the person's brain, and P19's and P21's lines from P4. |
| [Kept branches](./kept-branches-2026-11-05.md) | 2026-11-05 ([PR 400](https://github.com/usirin/tea-fabrika/pull/400)) | Nothing: "none touches `next/`". |

## The backup needs a design pass first

**Nothing is designed.** The owner moved it up from Tier 3, and no note holds a design, only one line in [every update builds every layer](../direction/every-update-builds-every-layer.md). What is known: the person key lives on the Mac, the text lives on Cloudflare, `founded.keys` stays a list so keys can join, and a new fact `added` goes on it. `added` is not yet in `MemberFact`, `foldMembers` or p28.

```ts
// A sketch and a starting guess, not settled. Two moments.
// While the old Mac lives: make a recovery key, print its private half on a sheet.
{_tag: "added", key: recovery.publicKey, for: person, signed: sign(personKey, text), saw: {how: "sheet", check: "touch"}}
// On a new Mac: type the sheet in, and sign the new person key with it. The door's one signature shape.
{_tag: "added", key: newMac.personKey, for: person, signed: sign(recovery, text), saw: {how: "recovery", check: "none"}}
```

**The design pass answers,** and the owner reads it before any test writer starts: what is on the sheet, and on paper or in a file. Whether recovery revokes the old Mac's keys. What the new Mac's window key does. What happens with a wrong or a used sheet. How the door reads `added`, in one signature shape. How `founded.keys` folds with it.

**Its done check, as a guess:** a temp home with the sheet and the Cloudflare address comes back to the same notes and the same name, with no new ledger. Without the sheet, it gets a waiting screen and nothing else. The sheet's secret is never on the wire or in the ledger. Plan it as one design task and one PR after it, and put any design choice with a real trade-off in `questions`.

## Known risks

Each has a way out, or a first step that tells. More in [the detail](./tier-1-detail.md#what-this-plan-cannot-tell-us).

- **Launchd from an unsigned build, Touch ID from it, and the Keychain asking on open.** *P4 answered yes to all four on 2026-11-05 ([experiment 214](../../experiments/214-mac-app-four-unknowns.md)), so no way out is needed for this pass.* What is left: a rebuilt or re-signed app may still meet a Keychain prompt once (the owner's "open the built app twice" in P19); `promptTouchID` from an unsigned build was never called; a "Background Items Added" notice would not have shown in the run; and a test that seals touches the real login Keychain unless it seals through a stand-in.
- **A non-extractable key in IndexedDB over a reload.** *P3 answered yes on 2026-11-05 in Chromium 156, over a reload and a restart ([experiment 215](../../experiments/215-browser-key-survives-reload.md)).* What is left: the key is per origin, port included, so a brain on a new port means a new Approve for every tab; Safari, Firefox and a phone were not run; eviction under disk pressure was not tried. A phone's browser may also clear it after seven days without a visit, which means one more Approve.
- **The new package shape.** Nobody has run code-graph or the build on it. P6, the first package landing, runs both first, and stops if either is off.
- **Rolldown's equivalents are not proven here.** Experiment 195 bundled `next/`'s brain, window and programs with Rolldown, and nothing else. Carrying a script or CSS as text in the one built file, a generated entry in place of esbuild's `stdin`, the highlighter's split, `sideEffects: false` across packages, and Electron's main and preload were all not tried with it. Each is named in [the detail's Packages](./tier-1-detail.md#packages), and the pull request that needs it tries it first.
- **The copies carry bugs.** `programs/markdown` was written for a program that showed one text and quit.
- **A wake with a long history.** Each wake folds every save, and the object sleeps quickly on Cloudflare. T17 records it at 1,000 and 10,000 saves.
- **The cloud is first seen late.** Cold load, `abort_all`, a redeploy mid-run: all first seen at p39 and p41.
- **This plan itself.** Only the exam is built so far. No project this size has gone through every step by hand here, with a separate agent per step. P5 to P7 tell.
- **A big landing is a weak review.** If PR 223 lands whole, nobody really reads it.

## Open questions

The owner answers these. **As of 2026-11-05, nothing here stops the first wave.** Questions 1 and 2 no longer block anything, since no lane builds `next/`. Questions 3, 5, 6, 7 and 8 were answered on 2026-11-02. Question 4 is mostly settled by a note. Questions 9 to 14 are new, and each one names the pull request that needs its answer. Plan with the lean. Also open, and not questions here: P5's backup design pass, and P10, which waits on questions 9 and 10.

**The two questions that blocked the first `next/` lane,** with the pipeline no longer driving `next/`:

- **Can the planner split a plan into small tickets (question 1)?** Blocks nothing in Tier 1 now; it stays a gap in today's pipeline for when a lane builds `next/` again.
- **How does `next/` reach the lane (question 2)?** The lane half blocks nothing now; the "what lands" half is a lean the split already follows, and P6 tests it.

1. **Can the plan step turn out small tickets yet?** *Changed 2026-11-05: no longer blocks Tier 1.* In the lane, a yes on a plan sends it on to the exam and the builder, as one giant pull request, and no stage files a new ticket. [The flow](../direction/free-form-plan-to-planner.md) sizes that gap at about 7 files, about 1.4 to 2.4 agent hours at 600 lines an hour, sure 50% (*old guess there, wrong: 6 to 10*). It is today's version's work, for when a lane builds `next/`.
2. **[How `next/` reaches the lane](#still-open-how-next-reaches-the-lane).** *Changed 2026-11-05: the route no longer blocks anything.* What lands still leans 60% on "each layer lands already fixed", and the split is built on it.
3. **Windows' words and OS.** **Answered by the owner, 2026-11-02: yes.** `touch-id` becomes `verify` (WebAuthn's word, since `check` is taken), `keychain` becomes `seal`, and the hello records the OS, before real facts are written. The CI job and the pipe still wait on the owner's word on Windows. The question as it was asked: should `touch-id` become `check`, `keychain` become `seal`, and the hello record the OS, before real facts are written? [The note](../direction/windows-in-next.md) leans yes at 75%. Its other parts: a `next-windows` CI job, `.gitattributes`, one way to stop a brain, about 320 lines, sure 50%: about 0.5 agent hours at 600 an hour, a `1` on the scale (0.2 at 1,660, a `0.25`). *Old guess, wrong: 3 to 5 agent hours.* **Lean:** the OS field lands with the door, and `.gitattributes` with the first exam, since a later hello can never get the field back, and they cost a few lines. Tasks use today's words, `touch-id` and `keychain`, until the owner answers, and nothing is real until notes, so a rename is still cheap then. If renamed, pick another word than `check`, which already means three things in this plan (`saw.check`, chaos's `check`, the menu's `check`). Leave the CI job and the pipe to the owner's word on Windows. Sure: 70%. A walk of the Approve screen settles it.
4. **What runs the daily checks, what do its tickets go to, and how does mutation get fast?** *Mostly settled, noted 2026-11-05.* [Fast and daily mutation](../direction/fast-and-daily-mutation.md), decided 2026-11-01, sets the check on each pull request (changed lines, 5 minutes at most, advice only) and puts `next/`'s mutation queue in Tier 6; [experiment 197](../../experiments/197-daily-checks-on-cloudflare.md) sizes the daily run on Cloudflare. What is left for Tier 1: by hand, the real-browser and Electron laws run red first on the laptop ([Rules that bind](#rules-that-bind)), and launchd, the finger, the cloud and chaos run by hand and are logged. The mutation queue stays out of Tier 1, since the note puts it in Tier 6. The question as it was asked: Tier 1 did not include this, so it is a scope question. It also asks which pile holds the real-window laws: the first exam's `next` CI job runs Chromium and e2e, which looks like blocking. **Lean:** tests that spawn `dev.ts` stay in vitest and block. Real-browser e2e runs in CI without blocking. Laptop-only laws run by hand and are logged. The daily run is the smallest thing on the owner's laptop, as the scheduled-jobs note has it (decided 2026-11-01), and it files tracker tickets. Plan with today's mutation step as it is, and promise no time. Why: a check that blocks nothing and runs nowhere is worse than none. Sure: 60%. The cost is unknown, and a sized proposal settles it.
5. **Tile rules and the styling copy.** **Answered by the owner, 2026-11-02: moot.** Today's app already moved to the Radix fabrika theme, dark and light, in [PR 308](https://github.com/usirin/tea-fabrika/pull/308) (ticket 144). So copying today's styles copies Radix steps: slate for grays, indigo for the turn, as the rules want. The copy is taken from main after PR 308, and c7 reads "tokens match the named commit", as before. The question as it was asked: do the tile rules change the styling copy? The copy brings today's graphite tokens, and the rules want Radix slate steps. **Lean:** copy spacing, type and the meaning of colors, and take a plain tile's colors from the rules, since `next/` would otherwise copy what today's version is about to change (ticket 124). c7 then reads "tokens match the rules". Sure: 70%. Cost: a few more token lines. What settles it: a look at one real tile.
6. **Manti in `next/`.** **Answered by the owner, 2026-11-02: yes.** `next/` uses Manti, as today's app does ([UI on Manti](../direction/ui-on-manti.md), decided 2026-10-30). The styling exception was about copying styles, not about leaving Manti out. What it adds: `@manti-ui/react` and `@manti-ui/styles` as `catalog:` lines in `next/`'s packages, with the patch today's app uses; the one catalog already pins both at 0.13.0 and the patch already applies across the workspace, so no exam PR is needed for it. The style build also takes Manti's stylesheet and today's `theme.css`, which maps Manti's tokens to ours (139 lines, under the styling exception). Size: T6 grows by about 150 lines, about 0.25 agent hours at 600 an hour, inside the total's doubt; T20 keeps `Kbd`, a few lines. More bytes on a phone tab, as the lean said. The question as it was asked: does `next/` use Manti? The detail says `next/` has no Manti, and copies today's styles instead. [AGENTS.md](../../AGENTS.md#changing-the-product) says all in on Manti, and the [UI on Manti](../direction/ui-on-manti.md) note agrees. The tile is ours either way, as [the tile guidelines](../direction/tile-guidelines.md#tokens) say. **Lean:** Manti for the buttons and fields on the founding, waiting, panel and notes screens, since the newer rule holds. Cost: a dependency for those screens, a catalog change, and more bytes on a phone tab. Sure: 60%. The doubt is whether the owner's styling exception meant no Manti. The owner's word settles it.
7. **Saved vectors and letters.** **Answered by the owner, 2026-11-02: yes, on the lean.** The `sshsig` vectors and `notes-letters.jsonl` come in the exam PRs, so the owner reads them. The sshsig vectors move into the first exam PR, and the letters stay in the small exam PR before PR D. The question as it was asked: where do saved vectors and letters come from? `sshsig` vectors and `notes-letters.jsonl` live in `fixtures/next/`, and the test writer can only add `*.test.ts`. **Lean:** from the exam PRs, so the owner reads them. Sure: 85%. Cost: the sshsig vectors move into the first exam PR.

8. **Configurable keys.** **No owner call needed; the note settles it.** [Keybindings are configurable](../direction/keybindings-are-configurable.md) was decided 2026-11-01. The size below is the builder's estimate, not an owner call, and the lean holds: no pull request of its own, and the table lands with the first window that takes a key. The question as it was asked: what does configurable keys add? The owner's new rule was not in the approved size. It adds no pull request of its own, on the lean: the table lands with the first window that takes a key. **Lean:** a small addition to the door's window work. A guess, 50 to 150 product lines and about the same in tests, about 0.2 to 0.5 agent hours at 600 an hour, a `0.5` on the scale (0.1 to 0.2 at 1,660, a `0.25`), not in the total above. *Old guess, wrong: 1 to 2 agent hours.* Sure: 50%. The note's shape settles it. The keys are the person's, in `~/.fabrika/keybindings.toml`, not the repo's `.fabrika/fabrika.toml` ([the note](../direction/keybindings-are-configurable.md)).

9. **The hello's method: `hello` or `initialize`?** *Added 2026-11-05. Needed before P10 merges, since the method is on the wire and T4 keeps changes additive.* What the notes say: the sync note's sketch sends `"method": "hello"`, and its own comment calls that step "like LSP's initialize" ([layer 1](../direction/a-local-first-sync-engine.md#layer-1-transport-decided-2026-10-30-t3-changed-2026-10-31)). PR 223 and [this plan's words](#words-that-look-like-a-clash) say `initialize`, with `Hello` as the schema's name. No note decides it. **Lean, from this plan, not a note:** `initialize`, LSP's word for the same first request, as [use the industry's names](../direction/use-the-industrys-names.md) asks. Cost: one word in the note's sketch. Sure: 75%. The owner's word settles it.
10. **How a person signs in: SSH keys checked against GitHub, or one key pair per client?** *Added 2026-11-05. Needed before P10 merges, since `granted` and `founded.keys` are facts that live forever.* What the notes say:
    - [The ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md), decided 2026-10-25 and built in today's version: "a person signs in with their SSH key, and every key GitHub lists for their login works." Its 2026-11-01 header: "In `next/`, invite and join are Tier 3, and so is GitHub as a keys source."
    - [The five layers, T5](../direction/a-local-first-sync-engine.md#layer-1-transport-decided-2026-10-30-t3-changed-2026-10-31), decided 2026-10-30: "one key pair per client signs the hello. The person's key grants each new client." Its list of replaced guesses: "~~SSH keys as identity~~ Replaced: a key pair per client signs the hello (T5). On a Mac it may still be an SSH key file; in a browser it is WebCrypto."
    - [The detail's call 2](./tier-1-detail.md#the-biggest-calls), settled by the owner: "The person key writes SSHSIG, the same shape `ssh-keygen -Y sign` makes."
    - **Lean, from these together:** both, in two layers. Each client signs its hello with its own key (T5), the person key signs each grant in SSHSIG's shape (call 2), and GitHub as a keys source waits for Tier 3, with `founded.keys` kept a list so nothing is lost. Sure: 70%. The doubt: no note says whether GitHub's list ever checks `next/`'s person key, or only adds a second person's. The owner's word settles it.
11. **Does `next/`'s ledger `Entry` get `cause` now?** *Added 2026-11-05. Needed before P6 merges.* [Inputs carry their sender](../direction/inputs-carry-their-sender.md) decided the direction on 2026-11-04 and says adding `cause` to `next/` "is proposed": "an entry written without it never gets it back." **Lean:** yes, in P6, since [record wide](../../AGENTS.md#before-you-design-anything) is decided and a field cannot be added to entries already written. Cost: no note sizes it; a guess like `seen`'s 50 to 80 lines, about 0.1 to 0.2 agent hours. The input id at the door, `InputId`, comes with it in P10. Sure: 80% on the field, 50% on the size.
12. **Does each pull request get a tracker ticket?** *Added 2026-11-05.* The planner was going to file them; that flow is paused. **Lean:** yes, the lead agent files each row as a ticket when its plan starts, with `from` pointing at this plan ([a ticket says where it came from](../direction/a-ticket-says-where-it-came-from.md)), so its field rows and `MergeRow` have an id. Cost: one command per row, 30 in all. Sure: 65%. The doubt: the owner may want `next/` work out of today's tracker while today's pipeline is paused.
13. **Does the exam hold a Promise to the edge list?** *Added 2026-11-05. Needed before P8 lands, since P8 already adds edge lines.* The owner made the rule exact: a Promise only in a listed edge file, never anywhere it is wrapped ([Rules that bind](#rules-that-bind)). P2's `no-promises` sees syntax, so `Effect.tryPromise(() => fetch(url))` passes in any file, and only the run functions are held to the list. **Lean:** P8, the small exam, has `no-promises` refuse `Effect.tryPromise` outside the same 18-path list `no-effect-run-outside-edge` reads, so one list holds both, with planted lines. Cost: about 20 lines and their plants. Sure: 70%. The doubt: a Promise reached with no Promise syntax at all, such as a platform call returned from a helper, still passes; only types would see it.
14. **Does a clock read at a view file's top level fail?** *Added 2026-11-05. Needed before P14, the first `.tsx` file.* P2's `no-clock-in-view` fires on any read in a `next/**/*.tsx` file, so on PR 223's tree it fired on `main.tsx:19`, a module-level `crypto.randomUUID()` naming the tab, which is in a view file but in no view. P2's body left it as a later call. **Lean, the lead session's:** keep it failing, so a view file reads no clock at all, and the tab's name comes from where the key is kept (`tuval/browser/key.ts`, an edge) or through a Cmd. Cost: none now; a stray read moves to another file. No number was given.

### Still open: how `next/` reaches the lane

*Changed 2026-11-05: no longer blocks anything.* With Tier 1 built by hand, a builder reads PR 223 with git, so the route below is kept only for when a lane builds `next/` again. What lands still leans 60% on "each layer lands already fixed", [the split](#the-pull-requests-one-at-a-time) is built on it, and P6 is its first test. The text below is as it was: two parts, how the steps can read PR 223, and what lands.

**How the steps read it.** In today's version, a lane starts only from `origin/main` (`packages/pipeline/src/stages/pipeline/work.ts:244`, `:274`, `:276`), and `next/` is not on main. A read-only step, and the test writer's box, get a copy with no history, so they cannot read 223's commit at all.

```text
main -> first `next/` lane, like any other
          plan         names PR 223's commit, and cannot read it
          test writer  adds tests at their new paths, as new files, and cannot read 223's either
          builder      adds the product code, if its box can read those git objects
```

**What lands.** PR 223 cannot land as it is. It breaks `no-promises`, and p65 fires until the packages exist. The lane's checks run the whole of `pnpm lint`, so no slice carrying its old code gets through. And 3,323 lines do not fit a small pull request.

- **Lean, 60%: PR 223 is read, and each layer lands already fixed.** Data, then coordination, then transport, then app and desktop, each already on Effect, in packages, with its tests. Why: the rules hold from the first day, and each piece is small. Cost: rewriting done work, about five landings before the first demo, and that is a real strain on the walking-skeleton idea.
  - **Under this lean T0 goes away.** Nothing is moved. Each layer's first landing makes its package, and the desk never arrives. The T numbers and [the moves table](./tier-1-detail.md#packages) read as "where each thing ends up".
  - **Wire laws move.** p10 to p15 and p17 run on the real stage, so they belong to the landing that first brings up `dev.ts`. Put that landing as early as you can.
  - **Unknown: can a test that starts `dev.ts` run in the test writer's box,** with a temp home and no network? If not, those laws join the by-hand pile. Make this a spike, `ends: "answer"`, before that landing. *Moot by hand, 2026-11-05: the test writer runs on the laptop, so P12's wire laws go red first there.*
- **Lean, 65%, on the way in:** the lane as it is, plus PR 223's text placed where a copy can read it, such as a file under `docs/` or a folder of its own. That is one by-hand task before the first `next/` landing. No new lane code, and [the deal](./README.md#where-we-want-to-go) holds. It is unproved.
- **The other route:** the first slice by hand and logged, with the blocking rules held back until it has landed. That is one landing in the old shape, and it leans on exam item 11, "no check blocks until its false alarms are measured", which was not written for this.
- **What settles it:** one rehearsal by an agent, before this comes back to the owner. Plan with the leans either way, and do not list the rehearsal as a task.

## Where the detail is

In [`tier-1-detail.md`](./tier-1-detail.md). Read what your task touches. It is too long to read for the sake of it.

| You need | Section |
|---|---|
| Why each big choice went the way it did | [The biggest calls](./tier-1-detail.md#the-biggest-calls) |
| The door, step by step | [How the lock works](./tier-1-detail.md#how-the-lock-works-the-notes-t5) |
| Approve, Remove, the brain as a service | [The menu bar](./tier-1-detail.md#the-menu-bar) |
| Notes, drawing, agents | [Notes](./tier-1-detail.md#notes), [Drawing a note](./tier-1-detail.md#drawing-a-note), [Agents through MCP](./tier-1-detail.md#agents-through-mcp) |
| Faults and where they run | [Chaos monkey](./tier-1-detail.md#chaos-monkey) |
| Package names, PR 223's file moves | [Packages](./tier-1-detail.md#packages) |
| Services per platform, Electron, Cloudflare | [Platform pieces](./tier-1-detail.md#platform-pieces), [Electron window](./tier-1-detail.md#electron-window), [Cloudflare](./tier-1-detail.md#cloudflare) |
| Facts that must be recorded now | [What fact is lost](./tier-1-detail.md#what-fact-is-lost-forever-if-we-dont-record-it-now) |
| Layers, tags, types and names | [Strict layers](./tier-1-detail.md#strict-layers), [Tags](./tier-1-detail.md#tags), [The public interface](./tier-1-detail.md#the-public-interface) |
| Tasks, laws, criteria | [Tasks](./tier-1-detail.md#tasks), [Properties](./tier-1-detail.md#properties), [Criteria](./tier-1-detail.md#criteria), and [plan-115](./ticket-115.md) for p1 to p24 and c1 to c6 |
| The exam and the mutation step | [The exam PR](./tier-1-detail.md#the-exam-pr-not-in-this-plan), [The mutation step](./tier-1-detail.md#the-mutation-step) |
| What the owner settled | [Settled by the owner](./tier-1-detail.md#settled-by-the-owner) |

**Notes that bind, beyond those linked above:** [the five layers](../direction/a-local-first-sync-engine.md), [a browser is always a client](../direction/a-browser-is-always-a-client.md), [the ledger goes to Cloudflare](../direction/the-ledger-goes-to-cloudflare.md), [the desktop layer](../direction/the-desktop-layer.md), [the cloud is one more host](../direction/the-cloud-is-one-more-host.md), [local is the cloud](../direction/local-is-the-cloud.md), [every update builds every layer](../direction/every-update-builds-every-layer.md).

## What this cannot tell us

- **Little was built or run for this plan.** The exam (P1, P2) and two spikes (P3, P4) are the only runs; the rest rests on reading, plan-115's probes and past experiments.
- **Whether small pull requests fit this work.** A walking skeleton wants each piece whole, and small pull requests want each piece small. [The split](#the-pull-requests-one-at-a-time) is the first test: six landings (P6, P7, P9, P10, P11, P12) before P14 brings the first demo. In two cold reads of this page, readers agreed on the stories, goal, order of the demos and questions, and their task lists differed, so another reader may cut it differently.
- **Whether the split's hours hold.** Each row is my split of the detail's size rows, 50% sure, and it adds up to more than the approved size. P6's real `spent` is the first check.
- **Which of Tier 1's long checks the daily side would take.** The per-PR mutation check is set ([fast and daily mutation](../direction/fast-and-daily-mutation.md)); the daily run is not in Tier 1, so its long checks run by hand.
- **What the backup is.** Its pass has not happened.
- **How long the whole thing takes.** The size is 50% sure.
- **Facts about PR 223 are as of 2026-11-01, except P2's fire counts, and the notes list is as of 2026-11-05, through PR 403.** A later push or note changes them. Check the links.
