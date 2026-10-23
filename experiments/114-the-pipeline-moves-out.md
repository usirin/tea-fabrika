# 114. The pipeline moves out

The question: can the work pipeline leave `@kampus/fabrika` for a package of its own, using only
fabrika's public names, and lose nothing?

- Decided on 2026-10-22: `@kampus/fabrika` stays one package for the library parts (program,
  host, ledger, shell, agents). The pipeline is an app on it.
- The pipeline's tsh wiring and its bin move with it. fabrika ships plain tsh only.
- The new package is `@kampus/pipeline`, in `packages/pipeline/`. **The name is a placeholder.**
  The pipeline's own name is still open. Renaming it later means one folder, one manifest and
  every import that names it (legacy, wip, the packs, the experiments).
- No naming sweep: nothing was renamed that the move did not need.
- Settled after the first count, same day: only the pipeline installs `tsh`. fabrika has no `bin`,
  the way `effect` has none; its small shell is the dev script `packages/fabrika/bin/tsh-small`.

**Answer: yes, with three things that did not move cleanly.**

- Tests: 2170 before, 2170 after, the same full names, all passing. 8 tests changed file (below).
- `tsh -c 'programs'` prints the same 16 programs with no config and the same 19 with a
  `tsh.toml` that names a repo. One line differs: the rubrics folder's path.
- fabrika imports nothing of the pipeline. Its top level still bundles for a browser with 0
  platform modules.
- Both packages build and install from tarballs. The pipeline, installed, runs
  `tsh -c 'programs'` and lists all 16.
- History follows: 259 renames, every one of the 254 old pipeline files and its 3 rubrics.
- Three checks keep it that way: a new boundary check, the layer order and the exports map. Each
  of three planted mistakes was caught, two of them by one check alone.
- Spent: $0. No paid run, no agent started.

What did not move cleanly:

- **Two bins named `tsh`.** Install both packages and the package manager picks which one wins:
  npm links fabrika's, pnpm links the pipeline's. Neither warns. Fixed: fabrika's bin is gone,
  so both now link one `tsh`, the pipeline's.
- **The pipeline's types needed 3 names fabrika did not export.** The `.d.ts` build failed with
  TS2883 until fabrika exported `KeptOptions`, `KeptFailed` and `StorageStale`.
- **Some of fabrika's tests live in the pipeline.** The machine laws for fabrika's host, and 18
  tests of fabrika's Draft and agent spans, stay where the checker and the scripted agent are.

Confidence 85%. The doubt: nothing outside this repo has used `@kampus/fabrika` as a library yet.
The pipeline is the first app, and it was written inside fabrika. A second app, written from the
outside, would show what is still missing from the public names.

## The layout

```text
packages/
  fabrika/                  @kampus/fabrika: the library. Names no pipeline.
    bin/tsh-small           a dev script: tsh with its 8 small programs. No bin.
    src/
      index.ts              the top level: program, host, ledger, Shell. No platform.
      shell.ts              /shell: runTsh, homeOf. Node's terminal and files.
      program/  host/  shell/
      agents/
        acp.ts  acp/        /agents/acp: any harness over ACP
        claude.ts claude/   /agents/claude: Draft, its schema reader, the tool guard
        sandbox.ts          /agents/sandbox: env, sandbox, guard. No Agent SDK.
        trace.ts  trace/    /agents/trace: an agent's turns and tool calls as spans
  pipeline/                 @kampus/pipeline (placeholder): the app.
    bin/tsh                 tsh with the pipeline's programs (root bin/tsh hands over here)
    rubrics/                the review rubrics it ships
    src/
      tsh.ts                its bin: checks the optional peers, then tsh/fabrika-main.ts
      primitives.ts combos.ts settings.ts ...
      stages/ hosted/ asks/ laws/ criteria/ trace/ tsh/
```

- The order of packages, bottom first: fabrika, then the pipeline, then `programs/`, `wip`,
  `legacy` and `packs/`. `layer-rules.json` holds it.
- Inside fabrika the parts are, bottom first: program, host, shell, agents, then the entry files.
- The pipeline imports fabrika by name, as `@kampus/fabrika` or one of its 12 subpaths. Never by a
  path.
- Everything above the pipeline imports it by name too, as `@kampus/pipeline/<path under src>`.
  legacy (21 files), wip (2), the packs and 47 experiment scripts were repointed.
- The tutorials use no pipeline. Nothing there changed.

## How an app hands tsh its programs

The whole API is one service and one function.

```ts
import {listed, Shell} from "@kampus/fabrika"; // no platform: Shell.Programs, Shell.programList, Shell.SMALL
import {runTsh} from "@kampus/fabrika/shell"; // the launcher: terminal, files, OTel
import {Effect, Layer} from "effect";
import {hello} from "./hello.ts"; // your own program, made with defineProgram

const programs = Shell.programList([...Shell.SMALL, listed(hello, Layer.empty)]);

process.exitCode = await Effect.runPromise(
	runTsh().pipe(Effect.provideService(Shell.Programs, programs)),
);
```

```ts
// packages/fabrika/src/shell/main.ts
export interface Options {
	readonly viewing?: Viewing; // how its traces are shown
	readonly short?: Short; // how a value is shortened in a trace's title
}
export const runTsh: (options?: Options) => Effect<number, never, Programs>;
```

- `Programs` was already a service inside tsh (`"tsh/Programs"`). It is now public, and
  `runTsh` reads it from the context like any Effect reads a service.
- Before, `runTsh({list, viewing, short})` took the list as an argument, returned a `Promise`, and
  was reached by a path inside the package. Nobody outside could call it.
- `Shell` is a namespace on the top level, like `Call` and `Monitor`. Its names (`check`,
  `parse`, `EMPTY`, `describe`) say too little on the flat list beside the host's.
- It names no platform, so it is on the top level. The browser bundle grew from 251 to 267
  modules (1180 KB to 1254 KB). Still 0 `node:*`, 0 OpenTelemetry, 0 Agent SDK.
- `runTsh` reads `process`, the terminal and the home folder, so it is on `/shell`.
- The pipeline's bin reads its settings and opens its ledger first, then ends in the same call,
  with its own list and its own `viewing` and `short`
  (`packages/pipeline/src/tsh/fabrika-main.ts`). The ACP fixture is the smallest app:
  `fixtures/acp-tsh/tsh.ts`.

**Rec: keep it this shape.**

- Why: it is the Elm and Effect answer. A program's needs are services; whoever runs it provides
  them. No new idea, nothing tsh-only to learn.
- Cost: `Shell` added 16 modules to the top level's bundle.
- Confidence 90%. The doubt: only two apps use it, both in this repo.

## The agents: library or pipeline

The rule from the evidence: what fabrika's own agents part already imported is library. Before
the move, `agents/acp/` and `agents/claude.ts` imported 5 files from `src/pipeline/` (draft,
env, shell-guard, `stages/build/check.ts`, `trace/agent.ts`), and through them 2 more (schema,
`trace/sdk-events.ts`). Left there, each would be the library importing the app. What nothing in
fabrika used stayed with the pipeline.

| Piece | Went to | Why |
|---|---|---|
| `draft.ts` (createDraft) | fabrika `agents/claude/` | `agents/claude.ts` re-exported it already |
| `schema.ts`, the `reader` and `jsonSchema` half | fabrika `agents/claude/schema.ts` | the Draft reads its answer with them |
| `env.ts`, `shell-guard.ts` | fabrika `agents/claude/` | the ACP harness hands an agent its env; the guard was re-exported |
| `stages/build/check.ts`, the sandbox half | fabrika `agents/claude/sandbox.ts` | `acp --agent claude` runs inside the same sandbox as the builder |
| `trace/agent.ts`, `trace/sdk-events.ts` | fabrika `agents/trace/` | the ACP program draws its spans with `agentTrace`, which reads `sdkEvents` |
| `schema.ts`, the zod half (`zodCmd`) | pipeline | only the pipeline's moves still take zod |
| `stages/build/check.ts`, the builder's own rules | pipeline | which tool calls a builder may make is the builder stage's rule |
| `trace/viewing.ts` (`FABRIKA_VIEWING`) | pipeline | how the pipeline's stages are drawn |
| `draft-scripted.ts` | pipeline | a scripted Agent SDK stream for the pipeline's tests |

- Two files were split. Git sees them as renames into fabrika (`schema.ts` at 51%,
  `check.ts` at 63%) and the halves left in the pipeline as new files.
- `/agents/sandbox` and `/agents/trace` are new subpaths. `/agents/sandbox` loads no Agent SDK,
  so the builder's per-call hook still loads none. It was kept apart for that before (about 50 ms
  a start instead of 300, by its comment). Not timed here.

## The bar, measured

| Item | Before | After |
|---|---|---|
| `pnpm typecheck` | pass | pass, 10 projects |
| `pnpm lint` | pass | pass: biome, layers (0 UP), boundaries (0 crossings), browser |
| `pnpm test` | 2170 tests, 133 files | 2170 tests, 135 files, same names |
| `programs`, no config | 14 setting lines, 16 programs | the same; 1 setting line differs |
| `programs`, `tsh.toml` names this repo | 14 setting lines, 19 programs | the same; 1 setting line differs |
| fabrika's own `tsh -c 'programs'` | 8 (`tsh-small`) | 8 (`tsh-small`, a dev script, not a bin) |
| fabrika files importing the pipeline | (the pipeline was inside) | 0 |
| `pnpm build` | fabrika | both: fabrika 78 `.js` + 78 `.d.ts`, pipeline 167 + 167 |
| tarball install, npm | fabrika only | both; one `.bin/tsh`, the pipeline's, lists 16 |
| tarball install, pnpm | fabrika only | both, with one override; one `.bin/tsh`, the pipeline's, lists 16 |
| `tsc` over every exported module, `skipLibCheck` off | not run | 180 modules, 0 errors |
| renames git follows | | 259 |

- **The 8 tests that changed file.** They test fabrika's shell, not the pipeline, so they were
  cut out of the pipeline's test files into new ones in fabrika: 2 from `tsh/check.test.ts` to
  `shell/decode.test.ts`, and 6 from `tsh/complete.test.ts` to `shell/launch.test.ts`. Their
  names are the same.
- **The one differing line**, in both runs, is `review.rubrics`: `packages/fabrika/rubrics`
  became `packages/pipeline/rubrics`. The rubrics moved with the pipeline. Both runs used a
  fresh `TSH_HOME` in a scratch folder.
- **Layers.** `code-graph --layers` scans 706 files: 0 UP, 9 unresolved. The 9 are the same 9 as
  before, all in `experiments/87-scenarios`.
- **Experiments.** They are outside the typecheck, so every `@kampus/...` specifier in them was
  resolved by hand: 145 of 145 resolve. Relative ones unresolved: the same 9.
- **History.** 254 of 254 files under the old `packages/fabrika/src/pipeline/` and 3 of 3
  rubrics are renames. So is the full tsh: fabrika's old `bin/tsh` is now the pipeline's.
  `packages/fabrika/bin/tsh-small` keeps its name; only its comment changed.

## The checks that keep it

The decision is "the pipeline uses only fabrika's public names, and fabrika never imports the
pipeline". A rule in a README does not hold that. Three checks do. Two of them each cover a hole
the other two leave open.

```jsonc
// boundary-rules.json, run by `pnpm lint` as lint:boundaries
{
	"libraryTypes": {
		"library": { "imports": [], "pure": false },
		"app": { "imports": ["library"], "pure": false }
	},
	"libraries": { "packages/fabrika": "library", "packages/pipeline": "app" },
	"acrossDeployables": ["relative-import-crosses-workspace"]
}
```

Planted one at a time, then removed:

- **A. fabrika imports the pipeline by name** (`@kampus/pipeline/stages/outcome`): caught by
  layers (1 UP) and by boundaries (B12, library imports up). The typecheck passes: the root's
  `node_modules` has the pipeline, so the name resolves. Without lint this plant lands.
- **B. the pipeline reaches into fabrika by a relative path**
  (`../../fabrika/src/program/kept.ts`): caught by boundaries alone (B19, relative import
  crosses a workspace package). Layers pass, since the edge points down; the typecheck passes.
- **C. the pipeline imports a fabrika file that is not exported**
  (`@kampus/fabrika/src/program/kept.ts`): caught by the typecheck alone (TS2307). The exports
  map is the list of public names.
- Clean again: all pass. The boundary check wrote no file.

## What did not move cleanly

- **Two bins named `tsh`.** Both packages declare `"bin": {"tsh": ...}`. In a fresh npm project
  `.bin/tsh` is fabrika's (8 programs); in a fresh pnpm project it is the pipeline's (all 16).
  Neither warns. In this repo there is no clash: `bin/tsh` at the root hands over to the
  pipeline's. Fixed the same day: fabrika no longer declares a `bin` (see Recommendations).
- **pnpm needs an override until fabrika is published.** The pipeline's tarball depends on
  `@kampus/fabrika@0.0.0`. pnpm looks it up on the registry and gets a 404, even with fabrika's
  tarball in the same `add`. A `pnpm.overrides` entry pointing at the tarball file fixes it. npm
  takes the sibling tarball as it is.
- **Three names fabrika had to export.** The pipeline's declaration build infers types that name
  `KeptOptions`, `KeptFailed` (program/kept.ts) and storage's `Stale`. They were not public, so
  `tsc` refused to write them (TS2883). fabrika now exports the two types, and `Stale` as
  `StorageStale`, since the host already has a `Stale`. Its tag stays `"Stale"`. Experiment 103
  picked public names by "used by an import outside its part". That missed names used only
  through an inferred type.
- **fabrika's laws and some of its tests live in the pipeline.**
  - The machine laws for fabrika's host loop, call module, supervisor and monitor
    (`packages/pipeline/src/laws/tea-host.ts`) sit beside the checker that walks them
    (`laws/explore.ts`), which is the pipeline's. They reach the machines by fabrika's public
    names. The ledger's own law suite stays in fabrika, on `@kampus/fabrika/laws`.
  - `laws/standard.test.ts` reads fabrika's `src/agents/` folder from disk, found through
    `@kampus/fabrika/package.json`.
  - 18 tests of fabrika's code stay in the pipeline: `draft.test.ts` (9),
    `trace/agent.test.ts` (3) and `trace/sdk-events.test.ts` (6). They use the pipeline's
    `draft-scripted.ts`, its `FABRIKA_VIEWING` or its reviewer.
- **`openDb` became public** on `@kampus/fabrika/sqlite`, for one pipeline test that opens the
  ledger's file by hand.
- **The service keys still say the old place.** 11 Effect service keys read
  `"@kampus/fabrika/pipeline/..."` (`Lanes`, `BuildWork`, `Issues`, `Faults`, `Idempotency`,
  `Outside`, `LocalChecks`, `SortHost`, `SortPlans`, `Sorter`, `SortWrites`). A key is a name, so
  it waits for the naming sweep.
- **One script is shared by path.** The pipeline's `prepack` runs `node ../fabrika/pnpm-only.ts`.
  It works in the repo, and a tarball never runs `prepack`.
- **The `smol-toml` dependency moved** to the pipeline. fabrika no longer reads TOML.
- Older rows in `experiments/README.md` and older write-ups keep the paths they had. They say
  where things were when they ran.

## Recommendations

- **Settled 2026-10-22: only the pipeline installs `tsh`; fabrika's bin was dropped.** Each
  tarball install, npm and pnpm, now links one `tsh`, and it lists the same 16 programs.
- The rec as first written, kept for the record:
  **Rename one of the two `tsh` bins before either package is published.** For example, the
  pipeline's could be named after the pipeline once it has a name.
  - Why: the package manager, not the person, decides which shell they get, silently.
  - Cost: one line in one `package.json`, and the docs that say `tsh`.
  - Confidence 85%. The doubt: an app may want to be "tsh" on purpose. Then fabrika's bin is the
    one to rename, or to drop.
- **Move `draft-scripted.ts` to a testing subpath of fabrika** (`@kampus/fabrika/agents/testing`,
  a sketch), and the 18 tests with it.
  - Why: fabrika's Draft and spans would be tested in fabrika, and any app could script an Agent
    SDK stream.
  - Cost: one new public subpath to keep stable; `trace/sdk-events.test.ts` uses the pipeline's
    reviewer and would need a smaller agent.
  - Confidence 70%. The doubt: no second app has asked for a scripted stream. A second app would
    settle it.
- **Leave the law suites where the checker is.** Move them only if fabrika gets its own checker.
  - Why: a suite is a list of claims for one checker. Splitting it by package splits nothing real.
  - Cost: fabrika's host laws do not run from fabrika's own tests.
  - Confidence 75%. The doubt: a person reading fabrika will not find its laws there. The host
    README says where they are.
- **Fix the 11 service keys in the naming sweep, not here.**
  - Why: the brief kept renames out of this move. A key that names the old place misleads, but
    breaks nothing: keys only have to be unique.
  - Cost: none now.
  - Confidence 90%.

## How to run it

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm -s lint:boundaries                     # the library-and-app rule on its own
bin/tsh -c 'programs'                       # the pipeline's tsh: 16 programs
packages/fabrika/bin/tsh-small -c 'programs'  # fabrika's dev script: 8
pnpm build                                  # both packages' dist/
pnpm --filter @kampus/fabrika pack --pack-destination <folder>
pnpm --filter @kampus/pipeline pack --pack-destination <folder>
# in a new folder outside the repo, Node 26, npm. The peers at the repo's catalog versions:
# unpinned, npm takes @opentelemetry/resources 3.0.0 and refuses the install.
# Add first to package.json: "overrides": {"@effect/platform-node-shared": "4.0.0"}
npm install <folder>/kampus-fabrika-0.0.0.tgz <folder>/kampus-pipeline-0.0.0.tgz \
  effect@4.0.0 @demlik/tea@0.21.0 @anthropic-ai/claude-agent-sdk@0.3.296 \
  @agentclientprotocol/sdk@1.6.1 @effect/opentelemetry@4.0.0 @opentelemetry/api@1.9.1 \
  @opentelemetry/exporter-trace-otlp-http@0.222.0 @opentelemetry/resources@2.11.0 \
  @opentelemetry/sdk-trace-base@2.11.0
ls node_modules/.bin | grep tsh             # one: tsh, the pipeline's
node_modules/.bin/tsh -c 'programs'         # 16
# with pnpm, the same versions, and first in package.json:
#   "pnpm": {"overrides": {"@kampus/fabrika": "file:<folder>/kampus-fabrika-0.0.0.tgz",
#                          "@effect/platform-node-shared": "4.0.0"}}
```

## What this cannot tell us

- Whether fabrika's public names are enough for an app written from the outside. The pipeline
  grew inside fabrika, so it was shaped by what fabrika had. The three missing type names show
  there may be more.
- Whether the split costs anything at run time. Nothing was timed; no live run, no agent run.
- Whether the registry behaves like the tarballs. Nothing was published.
- One machine, macOS, Node 26.12.0, npm and pnpm. No Linux, no Windows, no yarn, no Bun.
- The browser bundle was built, not run.
- Whether `@kampus/pipeline` is the right cut. It is one package now; the stages might later
  want to be apart from the tsh wiring. Nothing here tested that.
