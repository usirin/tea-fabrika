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
- **The repo stays clean by checks, not by a written rule:** dead code found,
  and the public names diffed against main, so a new export is seen. Built
  2026-10-29: dead code, as advice only (below). Public names are not built
  yet.
- **No limit on file size** (dropped 2026-10-24). Its number, 400 lines, was
  code-graph's default, picked by nobody here. Research finds no line count
  where defects jump: bigger files carry somewhat more risk on average, with
  no threshold
  ([Waterloo, 2016](https://www.swag.uwaterloo.ca/www/publications/thresholds-for-size-and-complexity-metrics-a-case-study-from-the-perspective-of-defect-density.html)),
  and in that study the largest files had the fewest defects per line. Dead
  code has a yes-or-no answer; file size has none. How sure: 75%. What
  would change it: our own records showing big files cost more review
  rounds or more bugs.
- **The checks come from `@demlik/code-graph`, not knip** (2026-10-22). It is
  already this repo's layer and boundary lint. Where it lacks a check, the
  check is added there. The repo pins 0.11.0 (2026-10-29):

  ```sh
  pnpm lint:dead   # code-graph . --unreachable --ci, against unreachable-ledger.json
  ```

  ```json
  {
    "id": "packages/fabrika/src/shell/execute.ts:inWords",
    "kind": "dead",
    "reason": "Wrong (2026-10-29): it is called in its own file, so only its `export` is unused. ...",
    "scope": "."
  }
  ```

  - dead code: code-graph gates it since 0.11.0
    (https://github.com/kamp-us/demlik/issues/729), but here it only
    advises. It is not in `pnpm lint`, and its CI step cannot turn the check
    red. Measured on 2026-10-29, the ledger's start:

    | What code-graph said | Found | Right | Wrong |
    |---|---|---|---|
    | `dead`: nothing reaches it | 24 | 1 (`Canvas`, in the finished video) | 23: called in their own file |
    | `only-called-from-tests` | 12 | 3 (`gridOf`, `memoryHistory`, `modelAnswersOf`) | 9: also called in their own file, by code outside the tests |
    | All | 36 | 4 | 32 (89%) |

    Every wrong one is the same miss: code-graph does not see a call to an
    exported function from inside its own file
    (https://github.com/kamp-us/demlik/issues/751,
    https://github.com/kamp-us/demlik/issues/733). Read more kindly, as
    "this `export` has no reader in another file", 23 of the 32 still point
    at an `export` nobody needs, and the wrong ones fall to 9 of 36 (25%).
    Either way it is far from the near 0% a blocking check needs. When those
    two issues are fixed, measure again; at near 0% it moves into `pnpm lint`.
    Each ledger entry says which kind it is. How sure that it should advise:
    90%; the count was done by hand, one search per name;
  - the `somethingOf` sweep
    ([Schema.Opaque, no `somethingOf`](./schema-classes-not-of-helpers.md))
    is where it helps. A sweep pull request that leaves an old exported
    helper with no caller gets a right finding. One that renames a helper in
    the ledger to another exported name gets the old entry pruned and the new
    name found again, wrong in the same way (both tried on 2026-10-29, with
    `tshOf` and a planted export). The run prunes the ledger as `Of` names
    go, and that pruned ledger is committed with the sweep pull request.
    code-graph lists exported names, so a helper moved onto a class as a
    static likely leaves its sight, used or not; not tried, as no
    `Schema.Opaque` class exists yet;
  - file size: code-graph can gate it since 0.11.0
    (https://github.com/kamp-us/demlik/issues/730). It was built here, then
    dropped before it merged (above). On 2026-10-24 it would have started with
    a ledger of 130 files over 400 lines;
  - public names: not wired yet. `--api` lists the names and `--api-base`
    diffs them against a commit, but only reports. The one gate,
    `--api-policy`, passes a new name only when the same pull request adds a
    changeset (`.changeset/*.md`). This repo has no changesets and no
    release, so the builder would write its own pass
    (https://github.com/kamp-us/demlik/issues/752). Wiring it also needs two
    more things: CI must fetch `main` before `pnpm lint`, and a list of
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
