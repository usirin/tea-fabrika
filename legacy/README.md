# @tea-fabrika/legacy

The first-generation factory and the old live operator. It is kept compiling and tested. Nothing new goes here, and it only shrinks.

```sh
pnpm demo                         # a toy ticket, triage through lane, scripted agents
TOY=duration AGENT=claude pnpm demo   # the harder toy with real Claude Code (pnpm demo:hard)
RUN=<folder> UNTIL=triage pnpm demo   # stop after triage; drop UNTIL to carry on
ISSUE=owner/repo#n REPO=<folder> BASE=<branch> RUN=<folder> PACKAGE=<path> TYPESAFE_API_KEY=... pnpm real
LANE=<n> REPO=<checkout> PLUGIN=<folder> TREES=<folder> RUN=<folder> node legacy/src/operate.ts
```

Each host lists every setting it reads in the comment at the top of its file.

## Where it sits

- Second from the top in `layer-rules.json`. Only `packs/` sits above it.
- It may import `@tea-fabrika/wip`, `@tea-fabrika/tea-program` and anything below them.
- Nothing in the workspace imports it.

## What's in it

The `exports` map is `"./*": "./src/*.ts"`. Two parts, by file:

The first-generation factory, triage through lane through ship:

- `factory.ts`: the parent machine that holds triage, the lane and ship.
- `triage.ts`, `facts.ts`, `code-facts.ts`, `vetting.ts`, `enrichment.ts`, `sort.ts`: triage, the facts it gathers, the vetting of each draft, the sort.
- `lane.ts`, `tests.ts`, `review.ts`, `route.ts`, `imports.ts`, `comments.ts`: the lane, its tests from the examples, its review and the Jev readers.
- `ship.ts`: the older ship, through the `Repo` service. The ship machine in `wip/src/stages/ship/` does not use it.
- `issue.ts`: the shape of a rewritten ticket, with its criteria as calls and exact results.
- `tracker.ts`, `local.ts`, `github.ts`: where tickets are read from, and the local git and workspace.
- `settings.ts`: the numbers read from a `fabrika.toml`.
- `factory-services.ts`, `handlers.ts`: the factory's services, and the handlers that forward each Cmd to one.
- `claude.ts`, `scripted.ts`: Claude Code as the enricher, builder and reviewer, and scripted stand-ins for tests.
- `surface.ts`, `declarations.ts`: what a package publishes.
- `drive.ts`, `host.ts`, `demo.ts`, `real.ts`: the hosts.
- `replay.ts`, `replay-run.ts`, `score.ts`: triage replayed on closed issues under `replay/`.

The old operator, which drives one lane of today's fabrika:

- `operator.ts`, `turn.ts`: the operator machine, built from the moves and combos in `wip`.
- `operator-host.ts`, `operate.ts`: what it runs on, and the host that drives one real lane.
- `fabrika.ts`, `fabrika-cli.ts`, `fabrika-scripted.ts`: fabrika as a typed service, live and scripted.
- `shell-skill.ts`: what a shell is sent before its brief.
- `lane-log.ts`, `lane-replay.ts`, `lane-scripted.ts`: a lane read back from disk, replayed, or written by hand.
- `stages/ship/recorded.ts`: today's shipper endings mapped onto the ship machine's outcomes.
- `watch.ts`: a spike that watches an Agent SDK stream.

The root [`README.md`](../README.md) table says what each of these does in more detail.

## Commands

| What | Command |
|---|---|
| Toy run, scripted | `pnpm demo` |
| Toy run, real Claude Code and Jev | `pnpm demo:claude` (needs `claude` and `TYPESAFE_API_KEY`) |
| One real GitHub ticket in a local checkout | `pnpm real` |
| Typecheck this package | `pnpm --filter @tea-fabrika/legacy typecheck` |
| Test this package | `pnpm vitest run legacy` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

## See also

- [Experiment 82](../experiments/82-monorepo.md): what was moved here and why.
- [Experiments 48 to 52](../experiments/48-operator-from-six-moves.md) and [56](../experiments/56-first-live-run-of-the-ship-machine.md): the operator machine and its live runs.
- [`docs/direction/rethink-do-not-port.md`](../docs/direction/rethink-do-not-port.md): why new stages are not ported from here.
- [`replay/README.md`](../replay/README.md): the replay set.
