# Clean slate: the new code in `packages/`, the old deleted

**Proposed 2026-10-30.** It starts only after all five layers (transport,
data, coordination, app, desktop) have been talked through and decided, one by
one ([a local-first sync engine](./a-local-first-sync-engine.md) for the lower
three, [the cloud is one more host](./the-cloud-is-one-more-host.md) for the
app, [the desktop layer](./the-desktop-layer.md)). *Changed 2026-10-31: five
layers, not four. The walk renamed link to transport and nodes to
coordination, and added the desktop on top.* It changes
[sweep the core](./sweep-the-core-rebuild-the-pipeline.md) (2026-10-22): the
core is no longer swept in place. It is rebuilt too, on the new picture.

```text
main, after the slate is clean
  packages/       the new code, written once, on brain and hands
  apps/fabrika    the window
  docs/direction  the decisions
  the ledger      experiments, their runs, field notes: facts, read by the programs

gone
  packages/pipeline  legacy  wip  experiments/  field/  the old host
```

**The rule:** a new piece lands in the same pull request that deletes the old
one. Main never holds two versions of one thing, so a search for a file finds
one file.

## Why

- Today a search for one file finds the real one, an experiment's copy and an
  older version, side by side. People lose time on it, and agents read the
  wrong one and act on it. A wrong claim about where state lives reached a
  direction note this way (2026-10-30, caught before any code).
- Nobody uses this repo's pipeline. There is nothing to migrate, freeze or
  keep working while the new code is built.
- The old code is a map of which jobs exist, and its tests are the lessons
  ([rethink, do not port](./rethink-do-not-port.md)). Git history keeps every
  line, so deleting loses nothing.

## What happens to each part

| Part | Today | Becomes |
|---|---|---|
| `packages/fabrika` (program, host, shell, agents, ledger) | 194 files, about 49k lines | rebuilt on brain and hands; the old one deleted piece by piece |
| `packages/pipeline` | 323 files, about 76k lines | rebuilt small, as decided 2026-10-22; deleted |
| `legacy`, `wip` | 75 files, about 28k lines | deleted, nothing rebuilt from them |
| `packages/ledger-server`, `packages/promises` | 14 files, about 1.1k lines | folded into the project object; deleted |
| `programs/*`, `packs/*` | 83 files, about 15k lines | each one rethought onto the new host, old copy deleted in the same pull request |
| `apps/fabrika` | 102 files, about 27k lines | its window becomes the desktop layer's Electron backend, which dials the brain itself (T3); its Node host is replaced by the hands |
| `experiments/` | 132 scripts (about 121k lines), 174 write-ups, 24 MB of results | onto the ledger through the experiments program; the folder deleted |
| `field/` | 4,691 run rows, 263 notes | onto the ledger as run records; the folder deleted |

Line counts are `.ts` and `.tsx` only, counted 2026-10-30.

One piece is carried over, not rethought, as the 2026-10-31 walk decided
(C4): **the supervisor** (`packages/fabrika/src/host/supervisor.ts`,
experiments 99 to 102). It moves into the new coordination code with its OTP
strategies, restart intensity and backoff, and the six places where today's
code differs from OTP are fixed on the way.

## The order

```ts
// A sketch of the order. Each step is one or more pull requests, each one
// adding the new and deleting the old together.
const order = [
	"finish the decisions",       // all five layers: transport, data, coordination, app, desktop
	"tools to read them",          // an agent finds, reads and searches experiments on the ledger
	"experiments onto the ledger", // built in experiment 170: run the importer for real, delete the folder
	"field onto the ledger",       // runs.jsonl rows become run records, notes become facts
	"the new core",                // the project object, gateways, program objects, the hands, each with its laws
	"programs, one at a time",     // counter first; the old copy goes in the same pull request
	"the pipeline, rebuilt small", // then packages/pipeline, legacy and wip go
] as const;
```

- **Tools to read them come before the move** (decided). The folder is
  deleted only once an agent can do on the ledger what it does on the folder
  today: list experiments, read one write-up and its runs, and search across
  all of them by word. The first three exist as programs (`experiments`,
  `experiment`, `compare`); search does not yet. An agent reaches them
  through tsh or as tools, never by reading the ledger's file.
- **Experiments go first** (85%). Experiment 170 already built the move: its
  importer reads 167 write-ups and 180 results files into a ledger in about
  0.7 seconds, and the `experiments`, `experiment` and `compare` programs show
  them. It is the cheapest step, and it takes 132 scripts out of every search.
- **Cost, rough:** experiments and field, 10 to 20 files and 4 to 8 agent
  hours. The new core, 40 to 80 files and 30 to 60 agent hours. The pipeline
  was sized on its own. How sure: 50%, since the core is not designed down to
  its files yet.

## What changes in how we work

- **A new experiment's write-up and runs go on the ledger,** through the
  `Experiments` service, not in a file.
- **Open: where a new experiment's code lives.** Lean (65%): on the
  experiment's own branch, never on main, with the run record naming the
  commit it ran from. The doubt is a script that later experiments reuse;
  then it is a helper, and it belongs in a package.
- [AGENTS.md](../../AGENTS.md) changes when each step lands: the
  `experiments/` and `field/` rows point at the programs instead.
- `blog/`, `video/` and `singles/` are finished pieces and are not touched.

## What it cannot tell us

- Whether a lesson lives only in old code and in no test. The guard: port a
  part's tests or laws before deleting it, and read its write-ups.
- Whether the ledger is a good place to read 174 write-ups day to day. The
  `experiment --n` program draws one page; reading many at once, and
  searching them, is untried.
- How long the new core really takes. The estimate above is a guess until the
  core's first experiment runs.
