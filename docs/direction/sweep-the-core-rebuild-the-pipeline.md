# Sweep the core; rebuild the pipeline small

Decided 2026-10-22. Written down the same day, after a cleanup was proposed
that this rules out.

```text
the core      program, host, shell, agents, ledger     swept in place, then copied to kamp-us/fabrika
the pipeline  packages/pipeline                         not swept: rebuilt small on the swept core
the old one   stays as a map of which jobs exist        deleted once the new one does its jobs
```

## What was decided

- **The core is swept in place.** About 17.7k lines: program, host, shell,
  agents and the ledger. The sweep removes what nothing uses, fixes what
  breaks the rules (the clock, in [Build on Effect](./build-on-effect.md)),
  and renames to the industry's words. Then the core moves to
  `kamp-us/fabrika` as a plain copy
  ([Where each piece lives](./where-each-piece-lives.md)).
- **The pipeline is not swept. It is rebuilt small, on the swept core.**
  The old pipeline shows which jobs exist and what went wrong. It does not set
  the shape ([Rethink, do not port](./rethink-do-not-port.md)).
- **No cleanup on the old pipeline.** For example, the old pipeline has two
  programs for each stage: `stages/<stage>/program.ts`, which tsh runs in one
  process, and `hosted/<stage>.ts`, which runs on tea-host (experiment 104).
  Merging them would be work on code that is being replaced. The new pipeline
  has one program per stage from the start, and no `hosted/` folder.
- **The repo stays clean by checks, not by a written rule:** dead code found
  and gated; the public names diffed against main, so a new export is seen;
  and a limit on file size. Built 2026-10-24, in `pnpm lint`: dead code and
  file size. Public names are not built yet.
- **The checks come from `@demlik/code-graph`, not knip** (2026-10-22). It is
  already this repo's layer and boundary lint. Where it lacks a check, the
  check is added there. The repo pins 0.11.0 (2026-10-24):

  ```sh
  pnpm lint:dead   # code-graph . --unreachable --ci, against unreachable-ledger.json
  pnpm lint:size   # code-graph . --ci, against smell-ledger.json, which gates only big-file
  ```

  - dead code: gated since 0.11.0 (https://github.com/kamp-us/demlik/issues/729).
    The ledger started with 12 entries. Only one is truly unused: `Canvas` in
    the finished video. The other 11 are called in their own file. code-graph
    misses calls to an arrow function, and calls from a function it
    withholds (https://github.com/kamp-us/demlik/issues/733);
  - file size: gated at today's count since 0.11.0
    (https://github.com/kamp-us/demlik/issues/730). A file over 400 lines
    fails unless the ledger names it, and a named file may shrink but never
    grow. The ledger started with 130 files: 55 in `packages/`, 45 in
    `experiments/`, 29 in `legacy/`, 1 in `packs/`. code-graph counts one line
    more than `wc -l` (https://github.com/kamp-us/demlik/issues/738);
  - public names: not wired yet. `--api` lists the names and `--api-base`
    diffs them against a commit, but only reports. The one gate,
    `--api-policy`, passes a new name only when the same pull request adds a
    changeset (`.changeset/*.md`). This repo has no changesets and no
    release, so the builder would write its own pass. Wiring it also needs
    two more things: CI must fetch `main` before `pnpm lint`, and a list of
    subpaths that copies `package.json`'s `exports`. Left for the owner.

## Why

- Cleaning code that is being replaced costs the same as cleaning code that
  stays, and the work is lost when the old code goes.
- A pipeline rebuilt on a clean core shows whether the core is enough on its
  own: a missing tool shows up as a gap, not as a shortcut into old code.

## What it costs

- Two pipelines side by side for a while, the old one as the map and the new
  one growing.
- Some jobs are built twice. The old code makes the second time faster, not
  free.

## What would change it

A rebuild that keeps needing old parts as they are. Then those parts get swept
and kept.
