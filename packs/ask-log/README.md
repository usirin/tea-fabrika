# @tea-fabrika/ask-log

The smallest add-on pack. It hears every ask the core makes of the owner and every answer the core takes, and appends one line for each to a file.

```ts
import pack from "@tea-fabrika/ask-log";
import {asksProgram} from "@kampus/pipeline/asks/program";
import {loadPacks, startWithPacks} from "@kampus/pipeline/asks/packs";

pack.listens; // {ask: "ask", settled: "settled"}: core output -> this pack's input
pack.answers; // {}: it answers nothing, so the core cannot tell whether it runs

// A host, from `packs = ["@tea-fabrika/ask-log"]` in the repository's fabrika.toml:
const settings = yield* readSettings(`${folder}/${SETTINGS_FILE}`); // @kampus/pipeline/settings
const packs = yield* loadPacks(settings.packs, folder);
yield* startWithPacks({program: asksProgram, flags: {}}, packs, settings.pack, storage, {id: "asks"}, {
  places: () => ({folder, home: `${tshHome}/packs/ask-log`}), // fabrika.toml's folder, and this pack's own
});
// the file gets:  asked <ask id> at <n>
//                 settled <ask id>: <what the core does next>
```

## Where it sits

- In `packs/`, the top layer of `layer-rules.json`. Nothing below it may import it.
- It imports `@kampus/fabrika` and the pipeline, `@kampus/pipeline/*` (the ask shapes and the `Pack` type).
- The pipeline is its own package, in `packages/pipeline/`. `@kampus/pipeline` is a working name, from experiment 114.
- No workspace package imports it. The host finds it by name from `fabrika.toml`.
- The root `package.json` lists it, so `loadPacks` can find it from the repo root.
- `owner-desk` lists it as a dev dependency, for its end-to-end test.

## What's in it

All in `src/index.ts`:

- `default`: the `Pack`. It listens on the core's `ask` and `settled`, answers nothing, and does not hold the core.
- `logProgram`: the program `ask-log`. Inputs `ask` and `settled`, no outputs.
- `lineOf(heard)`: the one line for an ask or an answer. Pure.
- `LogFile`: the service that names the file.

## Settings

Read from its own table in the repository's `fabrika.toml`:

```toml
packs = ["@tea-fabrika/ask-log"]

[pack."@tea-fabrika/ask-log"]
file = "desk/asks.log"    # read from the fabrika.toml folder; asks.log in the host's folder for this pack when left out
```

A `file` that is not a string refuses the pack, and the core does not start. The file's folder is made when missing.

Fabrika's tsh starts this pack when the `packs` line of `fabrika.toml` names it: `desk`, `desk-demo` and `answer` (see `packages/pipeline/README.md`). The host's folder for it is `<TSH_HOME>/packs/ask-log`, or `<TSH_HOME>/desk-demo/ask-log` for the demo. `owner-desk`'s end-to-end test (`packs/owner-desk/src/desk.test.ts`) also wires it by hand.

## Commands

| What | Command |
|---|---|
| Typecheck this package | `pnpm --filter @tea-fabrika/ask-log typecheck` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

It has no tests of its own. `owner-desk`'s end-to-end test runs it.

## See also

- [`docs/direction/packs-are-programs.md`](../../docs/direction/packs-are-programs.md): what a pack is and why.
- [Experiment 89](../../experiments/89-owner-desk.md): the first packs, and what the core needed.
- `packages/pipeline/src/asks/packs.ts`: the `Pack` shape and the wiring.
