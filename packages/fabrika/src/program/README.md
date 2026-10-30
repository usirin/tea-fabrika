# program: `@kampus/fabrika`

The bottom part of [`@kampus/fabrika`](../../README.md). It was the package `@tea-fabrika/tea-program` until experiment 103.

A program is a thing you start: a name, a description, typed flags, inputs and outputs, and `main`. It runs tea machines but is not one.

```ts
import {call, defineProgram, input, output} from "@kampus/fabrika";
import {Effect, Schema} from "effect";

const double = defineProgram({
	name: "double",
	description: "Doubles each number it is told, and ends when its input closes.",
	inputs: {n: input(Schema.Int, "A number to double.")},
	outputs: {n: output(Schema.Int, "The number, doubled.")},
	main: ({serve, send}) => serve({n: (n) => send("n", n * 2)}),
});

yield* call(double, {}, {told: {n: [1, 2, 3]}});
// {kind: "called", ended: {kind: "ended", unread: {}},
//  heard: [{name: "n", value: 2}, {name: "n", value: 4}, {name: "n", value: 6}]}

yield* call(double, {}, {told: {n: [1.5]}});
// {kind: "bad_shape", name: "n", why: "Expected an integer"}: nothing ran
```

## Where it sits

- The bottom layer of the package and of the workspace (`layer-rules.json`).
- It imports nothing else of this repo. Only `@demlik/tea` and `effect`; `storage-node.ts` adds `@effect/platform-node`.
- It uses `@demlik/tea` as published, with no change to it.
- Imported by the package's other parts, `wip`, `legacy` and every pack under `packs/`.

## What's in it

Everything but Node's storage is on the top level, `@kampus/fabrika`. Each file, one line:

| Import | File | What it gives |
|---|---|---|
| `@kampus/fabrika` | `program.ts` | `defineProgram`, `kind`, `start`, `tell`, `offer`, `pipe`, `call`, `readFlags`, `withDefaults`, `listing`, `fork` and `end` for `serve`, the `MailboxFull` error, and the run types (`Run`, `Running`, `Ended`, `Mailbox`, ...) |
| `@kampus/fabrika` | `shape.ts` | `flag`, `input` (with its `ack` and `control`), `output`, `defaulted`, `CAPACITY`, and `fit`, the check that one output fits another program's input |
| `@kampus/fabrika` | `listed.ts` | `listed(program, layer)`: a program packed with the services it asks for, as one entry a host can start |
| `@kampus/fabrika` | `storage.ts` | `Storage`, where runs keep what must outlive the process: `memoryStorage`, `storageOf`, `folderStorage` |
| `@kampus/fabrika/storage/node` | `storage-node.ts` | `fileStorage(dir)`: storage in a folder, over Node's file system |
| `@kampus/fabrika` | `trace.ts` | Spans and events in Effect's own terms, `runTraced`, and the attribute names (`ATTR`). A trace's id comes from `trace-id.ts`: tea's `runTraceId`, copied so the top level loads no OpenTelemetry |
| `@kampus/fabrika` | `view.ts` | A program's window, from its side: `readInput` (what a window sent, read by the program's inputs), `WindowProps`, `InputMsgOf`, `ViewDataOf`. The view itself is declared in `defineProgram` and read with `viewOf` (`program.ts`) |
| `@kampus/fabrika` | `ear.ts` | `ear()`: a listener for tests that keeps what it hears |
| `@kampus/fabrika` | `mortal.ts` | `mortalDisk()`: a disk for tests that kill a process mid-write |

Not exported, used by the files above:

- `kept.ts`: starts one kept copy of a machine.
- `refs.ts`: reaches a kind's runs by id (`machines.<name>.get(id)`).
- `outbox.ts`: the outbox behind a pipe into an input declared `{ack: "manual"}`.
- `secrets.ts`: `holdsSecret`, which every storage asks before a save.
- `json-patch.ts`: RFC 6902's `diff` and `apply`, for a job's record's steps.

The rules of a run are in the comment at the top of `program.ts`:

- Flags are checked before `main` runs. One that does not fit answers `bad_shape`.
- Inputs can be told at any time. Only the starter closes them.
- Outputs are events. A listener hears what is sent while it listens, and nothing is kept.
- Services come from Effect's context. The caller provides them.
- `start` takes listeners typed from the outputs and puts them in place before `main` begins. It answers `bad_shape`, or at once a run handle with the starter's own `close` and `stop` beside it.
- The run handle has a stable id, `ended`, `listen` from now on, and each machine's state, changes and copies by name.
- A run has one mailbox. Every value told to any input, and every close, goes in, and `main` handles them in the order told with `serve(handlers, {until?})`: one handler per input, typed from its schema. Serving stops once each input in `until` has closed (every input when left out), or when a handler answers `end`; what is left is counted unread.
- A control input, `input(schema, description, {control: true})`, takes a `fork(handler)`: each value is handled at once, beside the order, on a small bound of its own (16), so a full mailbox never refuses a Ctrl-C.
- The mailbox holds at most the program's `capacity` values `serve` has not taken: `defineProgram({capacity: 16, ...})`, or `CAPACITY` (1000) when left out. A capacity that is not a whole number, 1 or more, is refused when the program is defined. `run.mailbox()` shows its length and, per input, how many wait in it and how many offers wait for room.
- `tell` is an Effect that never waits. It answers `queued`, `closed`, `stopped`, `bad_shape` or `no_cell`. On a full mailbox it fails with `MailboxFull` (`{input, capacity}`), so a caller that does not handle it fails too; one that expects a full mailbox says so with `Effect.catchTag("MailboxFull", ...)`. `offer` waits for room instead of failing.
- A bare `tell(...)` or `offer(...)` statement makes the Effect and drops it, so nothing is told. `pnpm lint` refuses one (`biome-plugins/no-bare-tell.grit`).

```ts
const word = yield* tell(run, "n", 7);   // "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"; fails MailboxFull
const again = yield* tell(run, "n", 8).pipe(
	Effect.catchTag("MailboxFull", () => offer(run, "n", 8)),   // wait for room instead
);
```
- Each machine kind names its state's Effect Schema as `state`. Every save is encoded through it, and a save that does not fit is a bug: the run dies, and the old value stays.
- A state that holds a secret (an Effect `Redacted`) is never saved, by any storage: the run dies and says why. Effect Schema writes a `Redacted` either as its plain text or as `"<redacted>"`, which never reads back, so refusing is the one answer that cannot leak (`secrets.ts`). Keep where to find a secret, not the secret.
- A storage may also keep steps (`Handle.step`): one per Msg each machine folds, with the state after it and the Cmds it started. A job's record does (`../host/traces.ts`); memory and folder storage keep none.
- A kept state the schema does not take was saved by older code. That machine run's start fails `StateRefused`, before any of its code reads it. Nothing is booted and nothing is written over. `list` shows it as `refused`, beside the runs that are kept.

```ts
const Total = Schema.Struct({total: Schema.Int});
machines: {count: kind({machine: count, state: Total, parent: "main", ...})}

yield* machines.count.get("total").start();   // kept {sum: 2}: fails StateRefused, "count run total was saved by older code, ..."
yield* machines.count.list;                   // [{kind: "refused", id: "total", why: "..."}, {kind: "kept", id: "b", state: {total: 3}}]
```
- `pipe` is `from | to`: it starts `from` wired into `to`'s input, and that input closes when the last writer ends.
- A program may have a window: a pure `view` of one of its machines, with an Effect Schema for what it picks. No React here; the window is a React component on `<package>/window`, and it sends the program its own inputs. A `view` that names no machine of the program is refused.

```ts
const counter = defineProgram({
	// ...name, description, inputs: {press: input(Press, "...")}, machines: {count: kind({...})}
	view: {machine: "count", data: Schema.Struct({n: Schema.Int}), of: (s) => ({n: s.n})},
	main: ...,
});
viewOf(counter)?.of({n: 2});                                // {n: 2}
readInput(counter, {type: "press", value: "plus"});         // {kind: "read", msg: {type: "press", value: "plus"}}
const Window = ({view, send}: WindowProps<typeof counter>) => ...;   // view: {n: number}
```

## Commands

| What | Command |
|---|---|
| Typecheck the package | `pnpm --filter @kampus/fabrika typecheck` |
| Test this part | `pnpm vitest run packages/fabrika/src/program` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

Tests sit beside the code as `*.test.ts`. None needs a key or the network.

## See also

- [`docs/direction/tea-program.md`](../../../../docs/direction/tea-program.md): why a program sits between tea and a host.
- [Experiment 62](../../../../experiments/62-tea-program-on-unchanged-tea.md): the first shape, dropped.
- [Experiment 63](../../../../experiments/63-ship-as-a-program.md) and [64](../../../../experiments/64-outputs-are-events.md): ship as a program, and outputs as events.
- [Experiment 75d](../../../../experiments/75d-pipe-ack.md): the manual ack on pipes.
- [Experiment 81](../../../../experiments/81-listed-in-tea-program.md): `listed` moved here.
- Experiment 82 in the [experiments index](../../../../experiments/README.md): the workspace split.
- [Experiment 103](../../../../experiments/103-move-without-loss.md): moved into `@kampus/fabrika`.
