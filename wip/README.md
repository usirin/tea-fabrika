# @tea-fabrika/wip

Everything still being shaped: the stage machines and their programs, the agents, the services they talk to, and fabrika's wiring for tsh.

```sh
bin/tsh -c 'programs'                         # the small ones, acp, ship, review-scripted, build, operate
bin/tsh -c 'ship --describe'                  # its flags, inputs, outputs and machines
bin/tsh -c 'ship --mode read pr=<pull request url>'   # reads only: says what ship would send
bin/tsh -c 'review-scripted --rubrics <folder> pr=<pull request url> | ship --mode read'
```

`review`, with a live reviewer, is listed too when `tsh.toml` names a `clone`.

## Where it sits

- Above `packages/tsh` and `programs/`, below `legacy` and `packs` (`layer-rules.json`).
- It may import any package of this repo except `legacy` and the packs.
- It imports `@tea-fabrika/tea-program` and `@tea-fabrika/tsh`.
- Imported by `legacy` and by every pack under `packs/`.
- New work starts here. A part moves to its own package under `packages/` or `programs/` once it is ready.

## What's in it

The `exports` map is `"./*": "./src/*.ts"`, so any file is importable as `@tea-fabrika/wip/<path>`.

| Folder or file | What it holds |
|---|---|
| `src/stages/outcome.ts` | The five verbs every stage answers in (`done`, `send`, `ask`, `skip`, `stuck`), `outcomesOf` and `nameOf` |
| `src/stages/ship/` | The ship machine and the `ship` program |
| `src/stages/review/` | The review machine and the `review` program |
| `src/stages/build/` | The build machine and the `build` program |
| `src/stages/plan/` | The plan machine and the `plan` program |
| `src/stages/operate/` | The operate loop and the `operate` program |
| `src/stages/queue.ts`, `status.ts`, `traced.ts`, `rules.ts` | Shared by the stages: the kept work queue, status lines, trace drawings, the repo's agent rules |
| `src/asks/` | The `asks` core program: what waits on the owner, kept in a ledger. `packs.ts` wires add-on packs to it |
| `src/criteria/` | A plan's criteria, each under an id it keeps, and where verdicts are kept |
| `src/laws/` | The law checker (`explore.ts`) and the laws of each machine |
| `src/agents/acp/` | The `acp` program: an Agent Client Protocol client |
| `src/tsh/` | Fabrika's tsh: `tsh.toml` reading (`config.ts`), the program list, the launcher `bin/tsh` runs |
| `src/trace/` | Agent turns in traces, and fabrika's trace view rules |
| `src/primitives.ts`, `src/combos.ts` | The six moves (Gather, Act, Listen, Draft, Check, Judge) and the combos built from them |
| `src/draft.ts`, `src/schema.ts`, `src/refine.ts` | A Draft over the Agent SDK, `defineCmd` from Effect schemas, the draft-and-vet child |
| `src/services.ts` | The services the stages talk to |
| `src/code-host-github.ts`, `code-host-github-writes.ts`, `code-host-local.ts`, `codeowners.ts` | `CodeHost` and `CodeHostWrites` over GitHub, and `CodeHost` over a local git copy |
| `src/env.ts`, `src/shell-guard.ts`, `src/child.ts` | What a started process is handed, what a shell may not do, one command run to its end |
| `src/ids.ts`, `src/entity.ts`, `src/verdict.ts`, `src/check-runs.ts`, `src/worktrees.ts` | Ids, ledger entities, reading today's review verdicts, local check runs, working copies |

The root [`README.md`](../README.md) table says more about the older files here.

## Commands

| What | Command |
|---|---|
| Run fabrika's tsh | `bin/tsh`, `pnpm tsh`, or `wip/bin/tsh` (reads `./tsh.toml`) |
| Typecheck this package | `pnpm --filter @tea-fabrika/wip typecheck` |
| Test this package | `pnpm vitest run wip` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

Tests run on scripted services and recorded answers under `fixtures/`. None needs a key or the network.

## See also

- [`AGENTS.md`](../AGENTS.md): the six moves, Effect schemas, and the naming rules for new code here.
- [`docs/direction/outcome-names.md`](../docs/direction/outcome-names.md): the five verbs.
- [`docs/direction/every-machine-has-laws.md`](../docs/direction/every-machine-has-laws.md): what `src/laws/` enforces.
- [`docs/direction/packs-are-programs.md`](../docs/direction/packs-are-programs.md): the core side of packs.
- [`docs/ship-machine.md`](../docs/ship-machine.md) and [`docs/review-machine.md`](../docs/review-machine.md): the ship and review stages.
- [Experiment 82](../experiments/82-monorepo.md): what moved here and why.
