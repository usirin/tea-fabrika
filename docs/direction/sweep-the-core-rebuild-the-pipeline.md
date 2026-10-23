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
- **The repo stays clean by checks, not by a written rule:** knip, which finds
  files and exports nothing uses; a snapshot of the public names, so a new
  export is seen; and a limit on file size. Not built yet.

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
