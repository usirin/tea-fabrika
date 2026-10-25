# @kampus/fabrika

The tools for building your own software factory on [`@demlik/tea`](https://github.com/kamp-us/demlik),
in one package. Use it to write programs, run them on a host with one shared ledger, drive them
from a shell, and put agents inside them.

- **It is not on npm.** The package is `"private": true` and has no license yet. To use it,
  clone this repository. Every package here depends on it as `"workspace:*"`.
- **It is ESM only**, for Node 26 and up.
- **It is built on [Effect](https://effect.website)**, a TypeScript library for typed programs
  with typed errors and dependencies, and on tea, the Elm architecture on top of Effect.

## What it gives you

- **Programs.** A program is a thing you start: a name, typed flags, typed inputs and outputs,
  and `main`. It runs tea state machines.
- **A host.** A host is a process that runs programs, each under a registered name, on one
  **ledger** (a shared, durable record).
  - A host holds a **lease** on a name: a hold that runs out unless renewed.
  - When a host dies, another takes the name over and replays from the ledger.
  - Calls, monitors, links and supervision trees work as in Erlang/OTP.
- **A shell, tsh.** A shell that runs only tea programs, with typed pipes. An app hands it its
  own programs.
- **Agents.** A Draft (one bounded agent job) over the Claude Agent SDK, the sandbox and guard an
  agent runs in, its spans, and a client for any harness (a tool that runs an agent, like Claude
  Code) that speaks the Agent Client Protocol, ACP for short.

The work pipeline (the stages plan, build, review and ship, and the lane that takes one plan to
one merged pull request) is not in this package. Since experiment 114 it is its own package,
[`@kampus/pipeline`](../pipeline/README.md), an app built on this one's public names alone.

## The import rule

The top level runs anywhere, a browser too. Anything tied to a platform comes from a subpath.

- Every boundary is an **Effect service**: a typed slot that code asks for and a caller fills.
  `Ledger`, `Self`, `Storage` and tsh's `Programs` are services.
- An implementation of a service is a **Layer**. Each platform's Layer sits on its own subpath.
- A program picks its Layers where it starts. The rest of its code never names a platform.

```ts
import {defineProgram, input, Ledger, serve} from "@kampus/fabrika"; // runs anywhere
import {layerHttp} from "@kampus/fabrika/http"; // a Ledger over HTTP
```

- An `import` loads every file it points to. A top level that pulled in Miniflare or the Agent
  SDK would break in a browser and make every user install them. Hono and Effect split their
  packages the same way. See [Where each piece lives](../../docs/direction/where-each-piece-lives.md).
- `pnpm lint` holds the rule. It bundles the top level for a browser and fails on any Node,
  Miniflare, Agent SDK, ACP or OpenTelemetry module it reaches.

## A first program

A program that doubles each number it is told. `call` runs it once, tells it its inputs, and
collects what it says.

```ts
import {call, defineProgram, input, output} from "@kampus/fabrika";
import {Effect, Schema, Stream} from "effect";

const double = defineProgram({
	name: "double",
	description: "Doubles each number it is told, and ends when its input closes.",
	inputs: {n: input(Schema.Int, "A number to double.")},
	outputs: {n: output(Schema.Int, "The number, doubled.")},
	main: ({inputs, send}) => inputs.n.pipe(Stream.runForEach((n) => send("n", n * 2))),
});

const answer = await Effect.runPromise(call(double, {}, {told: {n: [1, 2, 3]}}));
// {kind: "called", ended: {kind: "ended", unread: {}},
//  heard: [{name: "n", value: 2}, {name: "n", value: 4}, {name: "n", value: 6}]}

const refused = await Effect.runPromise(call(double, {}, {told: {n: [1.5]}}));
// {kind: "bad_shape", name: "n", why: "Expected an integer"}: nothing ran
```

Save it as a `.ts` file anywhere inside this repository and run it with `node <file>.ts`. Node 26
runs TypeScript as it is.

## Where to go next

- **Run programs on hosts, and kill one:** the tutorial
  [Two hosts, one ledger](../../docs/tutorials/two-hosts/README.md), then
  [Agents on two hosts](../../docs/tutorials/agents/README.md).
- **Hand tsh your own programs:** [the shell's README](./src/shell/README.md).
- **Use tsh and the pipeline on a repository:** the [repository README](../../README.md).
- **Look up one part:** the part's own README, listed under [The parts](#the-parts).
- **Know why a part is shaped as it is:** [`docs/direction/`](../../docs/direction/README.md),
  for example [tea-program](../../docs/direction/tea-program.md) and
  [tea-host](../../docs/direction/tea-host.md).

## Reference

### Exports

| Import | What it gives |
|---|---|
| `@kampus/fabrika` | Programs (`defineProgram`, `start`, `tell`, `call`, shapes, `Storage` with `memoryStorage`, traces), the host (`Ledger`, `serve`, `Self`, `cast`, `supervisor`, `tail`, `whereis`, dead letters), the Elm modules `Call` and `Monitor`, and `Shell`: tsh's program list (`programList`, `Programs`, `SMALL`) and its parts |
| `@kampus/fabrika/memory` | `layerMemory`: a `Ledger` in plain memory, for tests |
| `@kampus/fabrika/sqlite` | `layerSqlite`: a `Ledger` on a node:sqlite file |
| `@kampus/fabrika/http` | `layerHttp`: a `Ledger` over HTTP to any running ledger, through its door with a token; `doorOf`: the door's login, invite and remove steps |
| `@kampus/fabrika/local` | `layerLocal`: the ledger as a Durable Object in a Miniflare child, `layerAttach` to join one another process started, `layerInside` past the door for tests, and `ledgerOptions` |
| `@kampus/fabrika/storage/node` | `fileStorage(dir)`: a program's `Storage` in a folder |
| `@kampus/fabrika/otel` | Spans out over OTLP/HTTP, and what a trace viewer is shown |
| `@kampus/fabrika/shell` | `runTsh`, the launcher an app's bin runs with its `Programs`, and `homeOf` |
| `@kampus/fabrika/agents/claude` | A Draft over the Claude Agent SDK, the schema its answer is read by, and the shell guard its tool calls pass |
| `@kampus/fabrika/agents/sandbox` | What an agent's process may see and do: its environment, its sandbox's folders and tools, the guard. No Agent SDK loads |
| `@kampus/fabrika/agents/trace` | An agent's turns and tool calls as spans, its words kept out of export |
| `@kampus/fabrika/agents/acp` | Any harness that speaks the Agent Client Protocol: the `acp` program, its client, the harnesses |
| `@kampus/fabrika/laws` | The ledger's law suite and its planted mistakes, for a new `Ledger` to run |

### The parts

Each folder under `src/` has its own README. The first one listed is the bottom layer. A part may
import the ones listed before it, never the ones after (`layer-rules.json` at the repository
root; `pnpm lint` checks it).

- [`src/program/`](./src/program/README.md): programs, their flags, inputs, outputs and storage.
- [`src/host/`](./src/host/README.md): the host and the ledger. Leases, takeover, replay, calls,
  monitors, links, supervision trees and limits.
- [`src/shell/`](./src/shell/README.md): tsh.
- `src/agents/`: the agents. `acp/` (any ACP harness, and the `acp` program), `claude/` (the
  Draft over the Agent SDK, its schema reader, the environment, sandbox and guard) and `trace/`
  (an agent's spans).
- `src/*.ts` and `src/agents/*.ts`: the entry files the exports point at.

### Dependencies

- `effect` and `@demlik/tea` are peers: one copy, the app's.
- Optional peers, needed only by the subpath that uses them:
  - `miniflare` for `/local`;
  - the Agent SDK for `/agents/claude`;
  - ACP for `/agents/acp`;
  - `@effect/opentelemetry` and the four `@opentelemetry/*` packages for `/otel`.
- The `tsh` bin needs the OpenTelemetry peers, and names any that is missing.
- The top level and `/memory` load with no optional peer installed. `/local` without Miniflare
  fails with one line saying to install it.

### The build, and the source in this repository

- `pnpm build` (rslib, bundleless) writes `dist/`: one `.js` and one `.d.ts` per source file.
  That is what an install gets.
- Inside this repository nothing needs `dist/`. `exports` and `bin` name the `.ts` source, and
  tsc, vitest and a plain `node file.ts` read it as it is.
- `publishConfig` names `dist/`:

  ```json
  "exports": {".": "./src/index.ts"},
  "publishConfig": {"exports": {".": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}}}
  ```

- `pnpm pack` and `pnpm publish` swap `publishConfig.exports` and `publishConfig.bin` in. npm
  does not, so `prepack` and `prepublishOnly` run `pnpm-only.ts`, which refuses any tool but pnpm.

### Checks

`pnpm lint` at the repository root runs three checks that hold this shape:

- `code-graph --layers` with `layer-rules.json`: no import points up the parts' order.
- `code-graph --boundaries` with `boundary-rules.json` (`pnpm lint:boundaries`): this package
  imports no `@kampus/pipeline`, and no package reaches into another by a relative path.
- `browser-check.ts` (`pnpm lint:browser`): bundles `src/index.ts` with esbuild for the browser
  and fails on any `node:*`, Miniflare, `@anthropic-ai/*`, `@agentclientprotocol/*`,
  `@opentelemetry/*` or `@effect/platform-node` module it reaches, with the import chain.
  `node packages/fabrika/browser-check.ts <entry>` looks at another entry.

### Commands

| What | Command |
|---|---|
| Build (`dist/`) | `pnpm build` at the root |
| Typecheck | `pnpm --filter @kampus/fabrika typecheck` |
| Test | `pnpm vitest run packages/fabrika` |
| The browser check | `pnpm lint:browser` |
| tsh with the small programs only (a dev script; the package installs no command) | `packages/fabrika/bin/tsh-small` |
| tsh with the pipeline's programs | `bin/tsh` or `pnpm tsh` at the root |

### Not in it yet

- Publishing. It stays `"private": true` and has no license yet. Experiment 108 packed it, with
  `private` lifted in a copy, and installed it outside the repository. Experiment 114 did the
  same with `@kampus/pipeline` on top of it.

### See also

- [Experiment 103](../../experiments/103-move-without-loss.md): the move into this package, and
  what it checked.
- [Experiment 108](../../experiments/108-install-from-a-tarball.md): the build, and the package
  installed from a tarball with npm and pnpm.
- [Experiment 114](../../experiments/114-the-pipeline-moves-out.md): the pipeline moved out into
  its own package, and what it checked.
- Experiment 82 in the [experiments index](../../experiments/README.md): the workspace split it
  replaces.
