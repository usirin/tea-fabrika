# @kampus/fabrika

Tools for building your own software factory on [`@demlik/tea`](https://github.com/kamp-us/demlik):
programs, a host that runs them on one ledger, a shell, agents, and the work pipeline. One
workspace package, `"private": true`. Every user in this repo depends on it as `"workspace:*"`.

```ts
import {defineProgram, input, Ledger, serve} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
```

## The rule

- Every boundary is an Effect service: `Ledger`, `Self`, `Storage`, `CodeHost`, ...
- The top level, `@kampus/fabrika`, gives the services and the code that runs anywhere. It names no
  platform. It bundles for a browser with no Node module, no Miniflare, no Agent SDK, no ACP and
  no OpenTelemetry in it.
- Each platform's implementation is a Layer on a subpath. A program picks its Layers where it
  starts.
- ESM only. The exports point at the `.ts` source; Node runs it as is. There is no build step yet.

## Exports

| Import | What it gives |
|---|---|
| `@kampus/fabrika` | Programs (`defineProgram`, `start`, `tell`, `call`, shapes, `Storage` with `memoryStorage`, traces), the host (`Ledger`, `serve`, `Self`, `cast`, `supervisor`, `tail`, `whereis`, dead letters), and the Elm modules `Call` and `Monitor` |
| `@kampus/fabrika/memory` | `layerMemory`: a `Ledger` in plain memory, for tests |
| `@kampus/fabrika/sqlite` | `layerSqlite`: a `Ledger` on a node:sqlite file |
| `@kampus/fabrika/http` | `layerHttp`: a `Ledger` over HTTP to any running ledger |
| `@kampus/fabrika/local` | `layerLocal`: the ledger as a Durable Object in a Miniflare child, and `ledgerOptions` |
| `@kampus/fabrika/storage/node` | `fileStorage(dir)`: a program's `Storage` in a folder |
| `@kampus/fabrika/otel` | Spans out over OTLP/HTTP, and what a trace viewer is shown |
| `@kampus/fabrika/agents/claude` | A Draft over the Claude Agent SDK, and the shell guard its tool calls pass |
| `@kampus/fabrika/agents/acp` | Any harness that speaks the Agent Client Protocol: the `acp` program, its client, the harnesses |
| `@kampus/fabrika/laws` | The ledger's law suite and its planted mistakes, for a new `Ledger` to run |
| `@kampus/fabrika/pipeline/*` | Any file of the pipeline, by its path |

## The parts

Each folder under `src/` has its own README. The first one listed is the bottom layer; a part may
import the ones listed before it, never the ones after.

- [`src/program/`](./src/program/README.md): a program is a thing you start, with typed flags,
  inputs and outputs. It runs tea machines.
- [`src/host/`](./src/host/README.md): runs a program under a registered name on one ledger.
  Leases, takeover, replay, calls, monitors, links, supervision trees and limits: OTP's node, for
  tea programs.
- [`src/shell/`](./src/shell/README.md): tsh, a shell that runs only tea programs.
- [`src/pipeline/`](./src/pipeline/README.md) and `src/agents/acp/`: the stage machines and their
  programs, the six moves, the services, the agents, and fabrika's wiring for tsh. "pipeline" is
  the folder's name for now; **the pipeline's own name is still open**. It is not on the top
  level: it is experimental.
- `src/*.ts` and `src/agents/*.ts`: the entry files the exports point at.

## Checks

`pnpm lint` at the root runs two checks that hold this shape:

- `code-graph --layers` with `layer-rules.json`: no import points up the parts' order.
- `browser-check.ts` (`pnpm lint:browser`): bundles `src/index.ts` with esbuild for the browser
  and fails on any `node:*`, Miniflare, `@anthropic-ai/*`, `@agentclientprotocol/*`,
  `@opentelemetry/*` or `@effect/platform-node` module it reaches, with the import chain.
  `node packages/fabrika/browser-check.ts <entry>` looks at another entry.

## Commands

| What | Command |
|---|---|
| Typecheck | `pnpm --filter @kampus/fabrika typecheck` |
| Test | `pnpm vitest run packages/fabrika` |
| The browser check | `pnpm lint:browser` |
| tsh with fabrika's programs | `bin/tsh` or `pnpm tsh` at the root |
| tsh with the small programs only | `packages/fabrika/bin/tsh-small` |

## Not in it yet

- A build. The exports point at `.ts` source, so only a runtime that runs TypeScript can import
  it. Experiment 108 adds one.
- Peer and optional dependencies. Every dependency of every subpath is a plain dependency today,
  so installing the package installs Miniflare and the Agent SDK too.
- The pipeline on the top level, and its name.

## See also

- [Experiment 103](../../experiments/103-move-without-loss.md): the move into this package, and
  what it checked.
- Experiment 82 in the [experiments index](../../experiments/README.md): the workspace split it replaces.
