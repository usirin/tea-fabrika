# @tea-fabrika/tea-program

A program is a thing you start: a name, a description, typed flags, inputs and outputs, and `main`. It runs tea machines but is not one.

```ts
import {call, defineProgram} from "@tea-fabrika/tea-program";
import {input, output} from "@tea-fabrika/tea-program/shape";
import {Effect, Schema, Stream} from "effect";

const double = defineProgram({
	name: "double",
	description: "Doubles each number it is told, and ends when its input closes.",
	inputs: {n: input(Schema.Int, "A number to double.")},
	outputs: {n: output(Schema.Int, "The number, doubled.")},
	main: ({inputs, send}) => inputs.n.pipe(Stream.runForEach((n) => send("n", n * 2))),
});

yield* call(double, {}, {told: {n: [1, 2, 3]}});
// {kind: "called", ended: {kind: "ended", unread: {}},
//  heard: [{name: "n", value: 2}, {name: "n", value: 4}, {name: "n", value: 6}]}

yield* call(double, {}, {told: {n: [1.5]}});
// {kind: "bad_shape", name: "n", why: "Expected an integer"}: nothing ran
```

## Where it sits

- The bottom layer of the workspace (`layer-rules.json`).
- It imports nothing else of this repo. Only `@demlik/tea`, `effect` and `@effect/platform-node`.
- It uses `@demlik/tea` as published, with no change to it.
- Imported by `packages/tsh`, `wip`, `legacy` and every pack under `packs/`.

## What's in it

The `exports` map is the whole public part. Each subpath, one line:

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/tea-program` | `src/program.ts` | `defineProgram`, `kind`, `start`, `tell`, `offer`, `pipe`, `call`, `readFlags`, `withDefaults`, `listing`, `CAPACITY`, the `Full` error, and the run types (`Run`, `Running`, `Ended`, ...) |
| `./shape` | `src/shape.ts` | `flag`, `input` (with its `capacity`), `output`, `defaulted`, and `fit`, the check that one output fits another program's input |
| `./listed` | `src/listed.ts` | `listed(program, layer)`: a program packed with the services it asks for, as one entry a host can start |
| `./storage` | `src/storage.ts` | `Storage`, where runs keep what must outlive the process: `memoryStorage`, `storageOf`, `folderStorage` |
| `./storage/node` | `src/storage-node.ts` | `fileStorage(dir)`: storage in a folder, over Node's file system |
| `./trace` | `src/trace.ts` | Spans and events in Effect's own terms, `runTraced`, and the attribute names (`ATTR`) |
| `./ear` | `src/ear.ts` | `ear()`: a listener for tests that keeps what it hears |
| `./mortal` | `src/mortal.ts` | `mortalDisk()`: a disk for tests that kill a process mid-write |

Not exported, used by the files above:

- `src/kept.ts`: starts one kept copy of a machine.
- `src/refs.ts`: reaches a kind's runs by id (`machines.<name>.get(id)`).
- `src/outbox.ts`: the outbox behind a pipe into an input declared `{ack: "manual"}`.

The rules of a run are in the comment at the top of `src/program.ts`:

- Flags are checked before `main` runs. One that does not fit answers `bad_shape`.
- Inputs can be told at any time. Only the starter closes them.
- Outputs are events. A listener hears what is sent while it listens, and nothing is kept.
- Services come from Effect's context. The caller provides them.
- `start` takes listeners typed from the outputs and puts them in place before `main` begins. It answers `bad_shape`, or at once a run handle with the starter's own `close` and `stop` beside it.
- The run handle has a stable id, `ended`, `listen` from now on, and each machine's state, changes and copies by name.
- Each input's line holds at most its `capacity` values `main` has not read: `input(schema, description, {capacity: 16})`, or `CAPACITY` (1000) when left out. A capacity that is not a whole number, 1 or more, is refused where the input is declared.
- `tell` is an Effect that never waits. It answers `queued`, `closed`, `stopped`, `bad_shape` or `no_cell`. On a full line it fails with `Full` (`{input, capacity}`), so a caller that does not handle it fails too; one that expects a full line says so with `Effect.catchTag("Full", ...)`. `offer` waits for room instead of failing.
- A bare `tell(...)` or `offer(...)` statement makes the Effect and drops it, so nothing is told. `pnpm lint` refuses one (`biome-plugins/no-bare-tell.grit`).

```ts
const word = yield* tell(run, "n", 7);   // "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"; fails Full
const again = yield* tell(run, "n", 8).pipe(
	Effect.catchTag("Full", () => offer(run, "n", 8)),   // wait for room instead
);
```
- `pipe` is `from | to`: it starts `from` wired into `to`'s input, and that input closes when the last writer ends.

## Commands

| What | Command |
|---|---|
| Typecheck this package | `pnpm --filter @tea-fabrika/tea-program typecheck` |
| Test this package | `pnpm vitest run packages/tea-program` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

Tests sit beside the code as `*.test.ts`. None needs a key or the network.

## See also

- [`docs/direction/tea-program.md`](../../docs/direction/tea-program.md): why a program sits between tea and a host.
- [Experiment 62](../../experiments/62-tea-program-on-unchanged-tea.md): the first shape, dropped.
- [Experiment 63](../../experiments/63-ship-as-a-program.md) and [64](../../experiments/64-outputs-are-events.md): ship as a program, and outputs as events.
- [Experiment 75d](../../experiments/75d-pipe-ack.md): the manual ack on pipes.
- [Experiment 81](../../experiments/81-listed-in-tea-program.md): `listed` moved here.
- [Experiment 82](../../experiments/82-monorepo.md): the workspace split.
