---
date: "2026-11-10"
summary: "`next/`, at `7aa4f45a`. One agent as the author, reading only libfabrika's exported files, `docs/tutorials/` and the counter. Half: it wrote \"tally\" (add, rename, bump, remove; one agent input; a read port) with 6 pure laws and a restart law in about six minutes, `pnpm typecheck` exit 0. It could not load it: the program list is the app's `src/table.ts`, and the build's `programs` option only tests reach (0068, 0069, P38). No window (P14) and no agent door (P25) exist yet. Gaps with no home: both tutorials teach today's `@kampus/fabrika-old`; an agent's person-only input is refused `bad_msg`, the same reason as five other causes; no runner test kit, so a restart law copies 11 services of wiring; the counter has no README; a new program needs its own row in the root `boundary-rules.json` to pass lint. 13 gaps in all. One run, a small program with no Cmds, an agent's minutes. Tokens not visible; no other model, $0 beyond the agent."
---

# 253. Can an author outside the fabrika team build a program for `next/` with only what such an author has?

Run 2026-11-10 on main at `7aa4f45a`. **Every claim here is about `next/`** unless it names today's
version. One agent played the author, then wrote this up. No paid model call beyond that agent, no
key, no other agent, no stage, no browser and no Electron.

**The answer: half.** The program itself, yes: an agent wrote "tally" (a named list of counters),
its pure laws and a restart law in about six minutes, and all of it typechecks and passes. Loading
it into fabrika, no: the only way in is a fixed list in the app's own source
(`next/apps/fabrika/src/table.ts`), or the app build's `programs` option that only tests reach. The
author also could not give it a window (none exists in `next/` yet), could not say how an agent
would call its one agent input (the MCP door is not built), and copied a 200-line test wiring it
did not understand to prove its state survives a restart. About 80% sure that a person, not an
agent, would hit the same walls in the same order; the minutes would be longer.

```ts
// The whole program, as the author wrote it (next/programs/tally/src/program.ts, on the branch).
export const tally = Program.make({
  name: "tally",
  machine: tallyMachine, // add, rename, bump, remove
  state: { v: 1, upgrades: [] }, // the runner saves the model; nothing else to do
  view: (model) => ({ counters: model.counters.map((c) => ({ name: c.name, count: c.count })) }),
  refuse, // "taken" or "missing"
  inputs: {
    add: { description: "Add a counter at zero, by a new name", personOnly: true },
    rename: { description: "Give a counter a new name", personOnly: true },
    remove: { description: "Remove a counter", personOnly: true },
    bump: "Add `by` (negative to take away) to the counter called `name`", // the agent's one input
    count: Input.cases.read.make({ schema: CountQuery, description: "…", answer: (view, q) => … }),
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
```

## How it ran

The author could read only: libfabrika's `package.json` exports and the files they point at (not
`internal/` or tests), `docs/tutorials/`, and `next/programs/counter`. It kept a log with the
clock. Its first few entries carried clock times it wrote ahead of the clock; the real clock says
setup at 20:51 and the last author step at 20:57. So the minutes below are small, and they are an
agent's minutes: an agent reads 600 lines of types in seconds. What a gap costs a person is the
reading, not the clock.

The program is on the branch `fabrikalfa/exp-agent-pack-author`, not on main
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)): `program.ts` (81
lines), `program.laws.test.ts` (162 lines, 6 laws), `runner.laws.test.ts` (261 lines, 1 law). The
lockfile gains its row there too, and so does `boundary-rules.json` (gap 13).

## How far the author got

| Step | Result |
|---|---|
| Write the program | Done. Package typecheck clean on the first try |
| Logic laws, the counter's way | 6 of 6 pass: a plain map of every Msg (`propertyInvariant`), every JSON cut (`syncTest`), the stepper's refusals, the read port, an unknown Msg. A planted `bump` off by one fails 2 of them |
| State survives a restart | 1 law passes: 12 inputs, close three SQLite files, reopen, same counters. It also shows an agent's `add` is refused |
| `pnpm typecheck` | Exit 0, `next/programs/tally` included |
| `pnpm lint` | Exit 1 first: copied unused imports, an assertion inside an `if` (`no-expect-in-if`, a fair catch) and gap 13. Exit 0 after fixing them and adding one row to `boundary-rules.json` |
| A view that lists the counters | Only as JSON data. No window can be written |
| An agent calls `bump` | Not reachable: no door for an agent in `next/` yet |
| Load it next to the counter | Stopped. The first step edits the app's own source |

## The gaps, by cost

Cost here is what blocks the job first, then what a person would pay to read their way past it.

| # | What the author wanted | What was missing or misleading | Minutes stuck | Kind |
|---|---|---|---|---|
| 1 | Run tally in a local stage next to the counter | The program list is `next/apps/fabrika/src/table.ts`, one row. The app build's `programs` option (`next/apps/fabrika/src/build.ts`) reaches more, but `dev.ts` has no flag or file for it. Found only by a filename search into the app | 3, then stopped | needs the app's source; needs a test-only option |
| 2 | Show the list to a person | Programs have no window yet. The build looks for a `./window` export in the program's `package.json` (libfabrika's `node/build/build.ts`, `findWindow`), but no public file says what that module must export, and the counter says only "no window until P14" | 1, gave up | no public name |
| 3 | Prove the state survives a restart | No runner test kit. The counter's `runner.laws.test.ts` wires eleven services by hand (`Ledger.sql`, `Doorbell`, `Mailbox`, `ProcessManager` with `Start`, `Owner`, `Recipient`, `LedgerTransaction`, `ProcessStore`, a hand-built `CheckedWriter`, `WatcherManager`, `Alarm`, `Recording`, `ProgramLoader`). Copying worked; understanding did not: the input id format `input_<26 hex>`, `sentAt: "writer clock"`, the `boot:` start id | 2 | no public name |
| 4 | Learn `next/`'s program API from a tutorial | Both tutorials (`two-hosts`, `agents`) teach today's `@kampus/fabrika-old` (`defineProgram`, `self.run`, `serve`). Nothing says they are today's version, not `next/` | 2 | a doc that misleads |
| 5 | Know why an agent's input was refused | An agent's `personOnly` input comes back `refused`, `reason: "bad_msg"`, the same reason as an unknown Msg, a schema miss, a missing port or a Msg with a parent (`runtime/Runner.ts:1494`). Flipping the writer to a person made it accepted, which is the only way to tell | 2 | a name that misleads |
| 6 | Let an agent call `bump` | `Envelope.by` can be an agent, so the runner knows agents, but no public file names the door an agent dials. The MCP door is Tier 1's P25, tests on a branch, not merged | 1 | no doc |
| 7 | Know the state is saved for you | True and good, but stated nowhere in one line. Inferred from the counter's restart law and `runtime/State.ts` | 2 | no doc |
| 8 | Build against the shape that will last | `Program.make` on main is the shape [program-shape](../docs/direction/program-shape.md) decided to replace on 2026-11-08 (inputs as values, the Msg built from them). Nothing in `Program.ts` or the counter says so. Cost the author nothing today; it costs a rewrite later. Found only in phase 2 | 0 | a doc that is wrong (by silence) |
| 9 | Run the tests the brief named | `vitest run … next/programs/tally` (a folder) is refused: "Local broad test run refused … `<narrow path>`". A narrow path must be a `*.test.ts` file; the message does not say a folder is not one | 1 | a doc that misleads |
| 10 | Pick a stage export | `./node/local-stage` is a brain outbox and a memory check, nothing about programs; `./node/stage` takes a `deploy` callback that the app writes | under 1 | a name that misleads |
| 11 | Read the counter as an example | No README. Comments use plan codes an outsider cannot decode: P11, P14, p22, S2, "the library's exam" | under 1 | no doc |
| 12 | Fill `wake`, `refuse`, `outputs`, `writes` | Types are clear; meaning is thin. `wake` returns `number \| null` with no unit or clock named; `refuse`'s `reason` is a free string with no list | 1 | no doc |
| 13 | Pass `pnpm lint` with a new program | Each `next/` program needs its own row in the root `boundary-rules.json` (`"next/programs/tally": "next-program"`). The failure reads `next/programs/tally -> programs/tally`, names a path that does not exist, and suggests `--accept-crossings`, which is the wrong fix | 1 | a doc that misleads |

What the author did not get stuck on, and it is worth saying: the types of `Program.make` caught
the shape (an input key must be a Msg's `type`), `syncTest` and `propertyInvariant` made the laws
short, and the package was picked up by the workspace with no edit outside it.

## Which gaps already have a home

| Gap | Home |
|---|---|
| 1, load a program the app does not list | [0068](../.decisions/0068-tiers-carry-every-part.md) (a thin slice of "programs written outside fabrika's own source" before Tier 5) and [0069](../.decisions/0069-choices-are-settings.md) (the program list as a `fabrika.toml` setting; Tier 1's P38, ticket 664). 0069 also bans the test-only option this run found |
| 2, a window | Tier 1's P14, the first window ([tier-1](../docs/plan/tier-1.md)) |
| 6, an agent's door | Tier 1's P25, agents through MCP |
| 8, the program's shape | [program-shape](../docs/direction/program-shape.md), decided, not built |
| 3, a runner test kit | Partly: [0070](../.decisions/0070-flow-runner-stays-a-machine.md) names the seven services as why nothing outside the app can run a program. Nothing plans a kit for authors |
| 4, 5, 7, 9, 10, 11, 12, 13 | No home. No decision asks for a `next/` tutorial, a distinct refusal reason for "person only", an author's README, renaming `./node/local-stage`, or a program package that joins the boundary rules on its own |

0068 and 0069 cover the gap that blocks the job. The rest of the cost is in the gaps with no home:
the docs an author reads first are today's, and the one reason an agent gets back says nothing.

## What a "build your own pack" pack would hold

The job an author and their agent do together is: write, load, poke, see what happened. Each row
says what exists in `next/` today, by path.

| Piece | What it does for the pair | In `next/` today |
|---|---|---|
| Load my program | A program list a person can set, not the app's source | No. `next/apps/fabrika/src/table.ts` is fixed; the build's `programs` option is test-only (0068, 0069, P38) |
| A process's model and the Msgs it took | Step back and forth through a process: each letter, the model after it, the view | Pieces only: the saved model in `runtime/ProcessStore.ts` (`load`), the letters in `processes/Mailbox.ts` (`receive`), and the pure fold in `runtime/Program.ts` (`stepper().fold`). No program or window shows them. A trace view is Tier 2. Today's version has a trace program; `next/` does not |
| The ledger's entries for it | Every entry on the process's streams, with both clocks and who wrote it | `ledger/Ledger.ts` has `read(stream, after)`. No program, command or window reads it for a person |
| Its spans | What each turn cost and where it failed | `telemetry/Trace.ts`, `telemetry/Records.ts` and the P37 sink record them. No reader for a person in Tier 1 |
| Send it an input | Type one input as a person or as an agent and see `accepted` or `refused` with a reason that says why | Only in tests, through `ProgramRunner.msg` (`runtime/Runner.ts`). The gateway (`gateway/Gateway.ts`) and the app's door take a window's press; MCP is P25; `fabsh` is Tier 2 |
| A runner test kit | One call that runs one program over Node SQLite with restarts, for laws like the counter's | No. Each program copies `next/programs/counter/src/runner.laws.test.ts` |
| A starter and its README | A program package to copy, with the steps from empty folder to running, and which tutorials are `next/`'s | No. The counter has no README; both tutorials are today's version |

## What it cannot tell us

- One run, one model, one small program. A program with Cmds, writes or outputs would hit gaps
  this one did not touch: tally has none.
- The author was an agent. Its minutes are not a person's; it reads types fast and guesses
  well from one example. A person would likely stop sooner at gap 3 and later at gap 12.
- The author was told the walls ahead of time (which files are allowed), so it did not waste time
  in the app's source. A real author might find `table.ts` faster by searching, and edit it.
- Nothing ran in a stage, so this cannot say whether tally would load, draw or survive a real
  workerd restart. The restart law ran on Node SQLite only.
- The read port (`count`) passed its own law, but no client in `next/` calls read ports yet, so
  whether it works end to end is unknown.

## Dollars

This ran on a subscription. The agent cannot see its own token counts, so there are no measured
tokens and no list-price figure here. No other model was called: $0 beyond the one agent.
