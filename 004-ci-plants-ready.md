NEEDS ANSWER: both CI plants for experiment 288 are pushed; please open fabrikalfa/x-ci-plant-1 and -2 as ready PRs

Both branches start from origin/main at 7ae7cea, whose own check run is green. Each changes only
comments, in all 297 `.ts` and `.tsx` files under `next/` that are not `*.test.ts(x)`. That
includes `*.test-support.ts` files and the exam's helpers (`plant.ts`, `twin.ts`, `rows.ts`, ...),
since the plan's rule would skip a comment-only change there too.

- fabrikalfa/x-ci-plant-1, commit a9d665f: a 26-line `/** */` block at the top of every file (after
  a shebang where there is one). 8,316 lines added, none removed. It moves every line of every file
  down by 26. Rolldown keeps `/** */` blocks when it does not minify (I checked with Rolldown
  1.2.13), so the unminified bundles grow.
- fabrikalfa/x-ci-plant-2, commit 0759f89: trap text. In every file, a top block holding lines that
  do not start with `*`: `import { spawn } from "node:child_process";`,
  `import ... from "../../../x-ci-plant-not-a-file.ts"`,
  `export { Plant } from "@kampus/libfabrika/gateway/Gateway"`. Then `defineMachine(`,
  `defineProgram(`, `syncTest(`, `Effect.runPromise(`, `new Promise(`, `person:x-ci-plant`,
  `p8-clean-window`, `p8-mcp-marker`, `imports "../access/Access.ts"`, path-like strings and
  `x-ci-plant.ts:1:1`. Plus a `/** */` comment inside the first function body of 219 files (it shows
  in `fn.toString()`), and a 3-line block before a middle top-level statement of 284 files.
  4,338 lines added, 219 changed.

Proof that both are comments only: for every one of the 297 files, origin/main's version and the
branch's version parse with oxc-parser 0.157.0 with no errors, and the two trees are equal as
JSON once start, end, range, loc and span are dropped. The hashbang matched as well. The check
does catch a real change: `1000` changed to `1e3` in one file gave "tree differs". No plant
contains tool-like text (the plan's refused forms: `@` words with a dash, `#__`, a leading `!`,
`@license`, `ignore`, lint or format tool names). No middle block lands right under an
`oxlint-disable-next-line` or `@ts-expect-error` line.

Expected reds that are on the reader list: the exam's `laws-scan` (a `defineMachine(` with no laws
file) and probably the import-scanning exam tests, on plant 2; and the bundle-size caps in
`instance-one-file.test.ts` may go red on plant 1. The `check` job will likely fail on format and
the docs rule. That does not matter: the `next` job needs only `changes`.

Please open both as ready PRs and tell me the PR numbers or run ids, so I can read the job logs.
I will write experiment 288 (the next free number on origin/main) once both runs are done.
