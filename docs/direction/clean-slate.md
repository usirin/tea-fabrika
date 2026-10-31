# Clean slate: the new code beside the old, the old deleted as it is replaced

**Proposed 2026-10-30.** It starts now that all five layers (transport,
data, coordination, app, desktop) have been talked through and decided, one by
one ([a local-first sync engine](./a-local-first-sync-engine.md) for the lower
three, [the cloud is one more host](./the-cloud-is-one-more-host.md) for the
app, [the desktop layer](./the-desktop-layer.md)). *Changed 2026-10-31: five
layers, not four. The walk renamed link to transport and nodes to
coordination, and added the desktop on top.* It changes
[sweep the core](./sweep-the-core-rebuild-the-pipeline.md) (2026-10-22): the
core is no longer swept in place. It is rebuilt too, on the new picture.

*Changed 2026-10-31, build beside: the new code grows in `next/`, and today's
version keeps running until each job has moved. Nothing moves first. This
replaces the first rule (below, marked wrong) and the first order.*

```text
main, while the new version grows
  next/           the new code, on brain and hands, importing nothing from the old
  everything else today's version, in daily use, only fixed
  docs/direction  the decisions
  AGENTS.md       says which is which

main, once next/ has taken every job over
  the new code, in the folder it ends up in
  gone: packages/pipeline  legacy  wip  the old host and apps/fabrika's Node host
```

**The rule:** the new version grows beside today's. When it takes a job over,
the pull request that switches to it deletes the old part, with its tests or
laws ported first. Nothing is moved until the new home for it works.

*Wrong, kept as the record: the first rule was "a new piece lands in the same
pull request that deletes the old one, and main never holds two versions". It
had no answer for the tracker, which people and agents use every day, and it
hid every result until a whole layer had been replaced.*

**How sure:** 85%. **What it costs:** a search finds two versions, which is the
problem this note set out to end. [AGENTS.md](../../AGENTS.md) tells agents how
to work with that, and a written rule only helps an agent that reads it, so
watch for agents reading the wrong version once they work in `next/`. If it
happens, the settle is a check that fails, not a longer rule. The other risk is
that the old version lives forever, so it gets only the fixes daily use needs.

## Why

- A rewrite goes long when nothing can be seen until the end. Beside the old
  code, one thin slice through all five layers can run in a browser tab while
  today's version keeps working. This is the strangler fig, Martin Fowler's name
  for replacing a running system piece by piece.
- Today's tracker and its tickets stay safe. They live on the deployed ledger
  and run on the old host. Nothing touches either until the new tracker is ready.
- Today a search for one file finds the real one, an experiment's copy and an
  older version, side by side. People lose time on it, and agents read the
  wrong one and act on it. A wrong claim about where state lives reached a
  direction note this way (2026-10-30, caught before any code). This is still
  true, and it ends when the old version is gone.
- *Wrong, kept as the record:* "Nobody uses this repo's pipeline. There is
  nothing to migrate, freeze or keep working while the new code is built." True
  of the pipeline, not of the tracker.
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
| `experiments/` | 132 scripts (about 121k lines), 174 write-ups, 24 MB of results | stays as files for now; moved later, if still worth moving |
| `field/` | 4,691 run rows, 263 notes | stays as files for now; moved later, if still worth moving |

Line counts are `.ts` and `.tsx` only, counted 2026-10-30.

One piece is carried over, not rethought, as the 2026-10-31 walk decided
(C4): **the supervisor** (`packages/fabrika/src/host/supervisor.ts`,
experiments 99 to 102). It moves into the new coordination code with its OTP
strategies, restart intensity and backoff, and the six places where today's
code differs from OTP are fixed on the way.

## The order

```ts
// A sketch of the order. Each step is one or more pull requests in next/.
const order = [
	"finish the decisions",        // done 2026-10-31: all five layers
	"a first slice",               // two counters through all five layers, in a browser tab
	"the tracker",                 // real tickets on the new ledger, read only first
	"the new core",                // the project object, gateways, program objects, the hands, each with its laws
	"programs, one at a time",     // the old copy goes in the pull request that switches to the new one
	"the pipeline, rebuilt small", // then packages/pipeline, legacy and wip go
	"experiments and field",       // they stay as files for now; moved later, if still worth moving
] as const;
```

- **A slice you can touch comes first** (70%). It is also the core's first
  experiment, which the cost guess below has been waiting for. The doubt: the
  view and patch path from the brain to a window has not run end to end on this
  design yet. The slice settles it.
- **The tracker comes next** (80%). It is the one program in daily use, so it
  shows the new version doing real work. It starts read only. Switching to it
  needs a checked copy of the tickets: count and hash both ways, dry run first.
  A straight copy is not safe: today's `pos` and `rev` mean the opposite of the
  data layer's (D3). The doubt: whether the old tracker can keep working against
  the ledger while the copy is tried. A dry run settles it.
- **Experiments and field stay as files for now** (85%). Agents read them today
  with tools they already have, and moving them shows nothing new. Experiment 170
  built the importer if it is ever worth doing. *The first order put them first
  because they were cheapest. Wrong for what we want now: something to see.*
- **Cost, rough:** the new core, 40 to 80 files and 30 to 60 agent hours. The
  pipeline was sized on its own. How sure: 50%, since the core is not designed
  down to its files yet.

## What changes in how we work

- **Experiments and field notes keep going where they go today,** as files, until
  a later step says otherwise.
- **Today's version gets only fixes** that daily use or CI needs. No new features.
- [AGENTS.md](../../AGENTS.md) tells agents which version is which.
- `blog/`, `video/` and `singles/` are finished pieces and are not touched.

## What it cannot tell us

- Whether a lesson lives only in old code and in no test. The guard: port a
  part's tests or laws before deleting it, and read its write-ups.
- Whether a written rule is enough to keep agents out of the wrong version. Only
  agents working in `next/` will show that.
- How long the new core really takes. The estimate above is a guess until the
  core's first experiment runs.
