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
| `@tea-fabrika/tea-program` | `src/program.ts` | `defineProgram`, `kind`, `start`, `tell`, `offer`, `pipe`, `call`, `readFlags`, `withDefaults`, `listing`, and the run types (`Run`, `Running`, `Ended`, ...) |
| `./shape` | `src/shape.ts` | `flag`, `input`, `output`, `defaulted`, and `fit`, the check that one output fits another program's input |
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
