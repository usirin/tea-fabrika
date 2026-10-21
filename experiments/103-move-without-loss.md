# 103. The move without loss

The question: can `tea-program`, `tea-host`, `tsh` and most of `wip` become one
package, `@kampus/fabrika`, without losing a test, a law or a planted mistake?

- One workspace package, `"private": true`. Every user depends on it as
  `"workspace:*"`.
- Every boundary is an Effect service. The top level gives the services and the
  code that runs anywhere. Each platform is a Layer on a subpath.
- ESM only, exports pointing at `.ts` source. No build: that is experiment 108.
- `@demlik/tea` is not edited.

**Answer: yes.**

- Tests: 2029 before, 2029 after, the same names. 0 dropped, 0 newly skipped, 0
  failing.
- Every law suite runs and holds. Every planted mistake is still caught: the same
  counts before and after.
- The top level bundles for a browser with 0 `node:*`, 0 Miniflare, 0
  `@anthropic-ai/*`, 0 `@agentclientprotocol/*` and 0 `@opentelemetry/*`
  modules. `pnpm lint` checks it now.
- `code-graph --layers`: 0 violations.
- Each new check failed on its planted mistake and passed once it was removed.
- The two-hosts tutorial: 30 brewed, 30 poured, with host-a killed by `kill -9`
  at order 10. The agents tutorial: 8 of 8 lines with real haiku, a host killed
  mid-answer.

Confidence 90%. The doubt: the flat top level hides 10 names that two old
modules both had (below). No user imports one of them today.

## The shape

```ts
import {defineProgram, input, Ledger, serve, supervisor} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";       // a Ledger over HTTP
import {layerLocal} from "@kampus/fabrika/local";     // the ledger in Miniflare
import {fileStorage} from "@kampus/fabrika/storage/node";
import {acpProgram} from "@kampus/fabrika/agents/acp";
import {createShip} from "@kampus/fabrika/pipeline/stages/ship/machine";
```

| Import | From |
|---|---|
| `@kampus/fabrika` | `src/index.ts`: `program/` and `host/`, minus their platforms |
| `/memory`, `/sqlite`, `/http`, `/local` | The `Ledger` Layers |
| `/storage/node` | `fileStorage`, a program's `Storage` on Node |
| `/otel` | Spans out over OTLP/HTTP, and the trace view |
| `/agents/claude` | A Draft over the Agent SDK, and the shell guard |
| `/agents/acp` | The `acp` program, its client and harnesses |
| `/laws` | The ledger's law suite, for a new `Ledger` |
| `/pipeline/*` | Any pipeline file, by its path |

- The parts, bottom first: `program/` (was tea-program), `host/` (tea-host),
  `shell/` (tsh), then `pipeline/` (wip) with `agents/acp/` (wip's agents).
- "pipeline" is the folder's name only. The pipeline's own name is still open.
- The pipeline is not on the top level: it is experimental.
- `bin/tsh` runs fabrika's tsh, `bin/tsh-small` the small programs only.

## What moved, and what stayed

- Moved with `git mv`: `packages/tea-program/src`, `packages/tea-host/src`,
  `packages/tsh/src`, `wip/src/agents`, and everything else in `wip/src`.
- Stayed in `wip`: `operator-live.ts` and its test. They are the old operator's
  live Layers, and only `legacy` uses them.
  - Two things in it were the pipeline's, so they moved: `sh` (one command
    through `execFile`) to `pipeline/sh.ts`, and `isMachines` (which comments a
    machine wrote) to `pipeline/comments.ts`.
  - `wip/src/operator-live.ts` imports them back from `@kampus/fabrika`.
- Inside the package, parts import each other by relative path. Outside, by the
  package's name.
- Rewritten by a script, its diff read before the commit:
  - 92 imports of `@kampus/fabrika`, 17 of `/http`, 6 of `/local`, 4 of `/laws`,
    and the rest on `/pipeline/*`.
  - Experiments 98 to 102 and both tutorials, so they keep running.
  - 33 files of experiments 49 to 97 and `experiments/lib/` that imported moved
    files by a relative path. One of them (76) reaches a file no export names;
    it keeps a relative path to its new place.
- Service tags renamed to `@kampus/fabrika/Self`, `/Ledger` and `/LocalLedger`.
- `pipeline/laws/standard.test.ts` looks for machines in `pipeline/` and
  `agents/`, the two folders `wip/src` held. Spec keys are now relative to
  `src/`.

## The top level, made platform-free

Two imports kept the top level off a browser.

- `program/program.ts` imported `randomUUID` from `node:crypto`. It now calls
  the global `crypto.randomUUID()`, which Node and browsers both have.
- `program/trace.ts` took `runTraceId` from `@demlik/tea/otel`, and that subpath
  loads `@opentelemetry/api`.
  - `runTraceId` is the first 32 hex characters of the key's SHA-256. It is now
    `program/trace-id.ts`: a plain SHA-256, no `node:crypto`, no Web Crypto
    (its digest is async, and a trace's id is needed at once).
  - It gave tea's id on 20,008 keys, 0 different. `pipeline/tsh/trace.test.ts`
    already holds a program's spans and tea's agent spans to one id.
  - For tea, later: a subpath with `runTraceId` and no OpenTelemetry would let
    this copy go.

## Names in two places

The old packages kept each module on its own subpath. One flat list made 13
names clash.

- `call.ts` and `monitor.ts` are Elm modules, each with its own `update`. They
  stay modules, as Elm writes them: `Call.update`, `Monitor.update`.
  - Two experiment files changed to match: `98-tea-host-package/asker.ts` and
    `99-monitors-supervisor/programs.ts`.
- 10 more names are picked in `src/index.ts`:
  - The ledger's records win over plain types of the same name: `DeadLetter`,
    `Stale`, `Fenced`, `EndReason`, `LimitKind`, `Over`.
  - A program's run wins over the supervisor's and storage's records: `Run`,
    `Ended`, `Started`, `Listed`.
- The names not picked are used by no import outside their own part today. They
  are still in the code, but not on the top level.

## The checks

```sh
pnpm lint   # biome, then code-graph --layers, then the browser check
```

- `packages/fabrika/browser-check.ts` bundles `src/index.ts` with esbuild,
  `platform: "browser"`, no Node shims. It fails on any module the bundle
  reaches from the list, and prints the import chain to it.
  - The top level: 251 modules, 1180 KB, every count 0.
  - It flags each platform subpath when given it as the entry, as it should:

| Entry | `node:*` | Miniflare | Agent SDK | ACP | OpenTelemetry | platform-node |
|---|---|---|---|---|---|---|
| `/local` | 4 | 0 | 0 | 0 | 0 | 1 |
| `/otel` | 0 | 0 | 0 | 0 | 6 | 0 |
| `/agents/claude` | 1 | 0 | 1 | 0 | 0 | 0 |
| `/agents/acp` | 4 | 0 | 1 | 1 | 2 | 1 |
| `/sqlite` | 2 | 0 | 0 | 0 | 0 | 0 |
| `/http` | 0 | 0 | 0 | 0 | 0 | 1 |
| `/memory` | 0 | 0 | 0 | 0 | 0 | 0 |

- `layer-rules.json`, top to bottom: `packs`, `legacy`, `wip`, `programs`, the
  entry files, `pipeline` with `agents/acp`, `shell`, `host`, `program`.

### The plants

- **`node:crypto` on the top level.** `import {randomUUID} from "node:crypto"`
  added to `program/program.ts`.
  - The browser check: exit 1, `node:*: 1`, `node:crypto <- program/program.ts`.
  - The layer check did not see it (exit 0): a Node import is no layer's
    business. That is why the browser check exists.
  - Removed: exit 0, every count 0.
- **A subpath reaching up into the pipeline.** `host/memory.ts` re-exported a
  type from `../pipeline/services.ts`.
  - The layer check: exit 1, `1 upward import site`,
    `fabrika-host -> fabrika-pipeline-agents`.
  - Removed: exit 0, 0 violations.

## Tests, laws and planted mistakes

- `vitest --reporter=json` before and after, old paths mapped to new.

| | Before | After |
|---|---|---|
| Test files | 122 | 122 |
| Tests passed | 2029 | 2029 |
| Dropped, newly skipped, failing | | 0, 0, 0 |

- The law suites, tests in each: `standard` 13 (11 of them one machine's
  laws), `laws` 21, `first` 10, `explore` 9, `world` 24, the host machines 4,
  the ledger laws 4. The same before and after.
- Planted mistakes, before and after:
  - the ledger's rules: 34 plants, each caught;
  - the host, supervisor, monitor and call machines: 61 plants pinned and caught;
  - the pipeline machines: 42 plant checks;
  - the world laws: 11 plant tests.
- Experiments 98 to 102, run again on the package, their machine and plant parts
  (`ONLY=machine,plants`, `ONLY=laws` for 101):
  - 98: 33 laws hold, 69 plants caught. 99, 100 and 102: 56 hold, 95 caught each.
    101: 15 hold, 12 caught. 0 broken, 0 missed.
  - 101's and 102's results files came back the same but for timings: the same
    states, laws and catches. 98 to 100 also list the plants added after them.
  - The results files were put back as they were.

## The tutorials

- **Two hosts.** Port 8790 free and no `.teahouse/` first. One ledger, two
  hosts, each started in its own process group.
  - `order.ts 30`; host-a killed with `pkill -9` after 10 orders.
  - host-b claimed both names (fences 49 and 50), the kettle replayed 2.
  - `look.ts`: `brewed 30`, `poured 30`.
  - Handed back: host-a started again, 10 more orders, Ctrl+C on host-b's
    process group. host-a took both names: 40 and 40.
  - Only the ledger started again: both names `free`, still 40 and 40.
- **Agents.** The same ledger, two agent hosts, real haiku.
  - `order.ts`: 8 guests. host-a killed with `pkill -9` while asking for the
    third guest.
  - host-b found 6 orders waiting and asked for that guest again.
  - `read.ts`: 8 lines in the book, 8 written, $0.0009.
- Every process and process group was stopped after. None was left.

## What went wrong on the way

- The flat top level failed to typecheck: 13 names in two modules. Fixed as
  above.
- `node` on the test machine is a version manager's shim, and the real Node is
  its child. A signal to the shim's id did not reach the host, which kept its
  lease, so host-a waited as a standby. Sent to the whole process group, Ctrl+C
  worked. `pkill -f` matches both, which is why the README's `kill -9` step works.
- The rewrite script turned two imports already rewritten by hand back into old
  paths, and stopped on a file with no public name. Both fixed in the script.
- `pipeline/` and `agents/acp/` import each other both ways (the harness reads
  `env.ts` and the build stage's checks; the `acp` program draws its turns with
  `trace/agent.ts`). They share one layer for now.

## Not in yet

For experiment 108 and later:

- A build. The exports point at `.ts` source.
- Peer and optional dependencies. Every subpath's dependency is a plain one, so
  installing the package installs Miniflare and the Agent SDK too.
- The pipeline's name, and the pipeline on the top level.
- Laws for the shell's 2 machines (`jobs.ts`, and `tally`'s in `small.ts`).
  `standard.test.ts` leaves `shell/` out, as `packages/tsh` was left out before.
- The pipeline and the agents split into two layers.
- The 10 names not picked on the top level, if a user needs one: a rename, or a
  module the way `Call` and `Monitor` are.
- Notes in `docs/direction/` still point at old paths (16 lines in 11 notes).
  They are dated records. `one-fabrika-toml-per-repo.md` and the how-to were
  updated; the rest were not.

## How to run it

```sh
pnpm typecheck && pnpm lint && pnpm test
node packages/fabrika/browser-check.ts                              # the top level
node packages/fabrika/browser-check.ts packages/fabrika/src/local.ts  # one subpath
ONLY=machine,plants node experiments/98-tea-host-package.ts
```

## What this cannot tell us

- The bundle was checked, not run. A browser was never started on it.
- Only TypeScript-running Node imports the package. No other runtime was tried.
- The tutorials ran once each, on one machine.
