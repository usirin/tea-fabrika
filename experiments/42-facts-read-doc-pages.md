# 42. Facts read the doc pages a report names

Run 3 of #558 (`runs/558-3`) missed two things fabrika's own enricher found,
both from doc pages. `docs/how-to/replay-in-a-test.md` also calls
`expectFinalState(downloader, { msgs, ctx: undefined }, …)`, so `ReplayOpts`
and the testing helpers are in scope; ours never saw it. And three doc rules
were marked "unchecked (doc)", though each page has a test that compiles and
runs its code.

Now every mentioned path that is a doc page (`.md`, `.mdx`; or, when not at
HEAD, the same path deeper down) gets two more facts:

- **Its twins: the tests that name the page's path.** In its package a page goes
  by its package-relative path (`docs/how-to/replay-in-a-test.md`), anywhere by
  its path from the root, written after a quote, a space or a `./`. Only test
  files count, the test named like the page first, 3 kept. The other candidate
  was a rule on file names (a test at the page's path, `.md` swapped for
  `.test.ts`). Of tea's 39 doc pages, 25 have a test that names them and only
  12 have a test at the mirrored path: `compose-slices.test.ts` is the twin of
  `compose-two-battery-slices.md`, `engine-how-tos.test.ts` of two engine
  pages, and the typecheck gate `pages-typecheck.test.ts` lists pages by path.
  No page had a mirrored test that does not also name it. Code that names a page
  and is no test (a JSDoc link in `runtime-types.ts`) checks nothing, so it is
  left out. Missed: a page checked only through rows in a non-test module
  (`page-mirrors.ts` for `bound-a-run.md`), one import away from its test.
- **The names its ts and tsx blocks call**: imported by name, or called bare and
  not declared there. Each is looked up like a name the report gives, kept only
  when the repo exports it (the page's `expect` is vitest's), with one
  definition, at most 6 in all, and marked with the page it came from
  (`calledIn`). A name the report gives stays the report's.

The enricher's brief gains one sentence when a page has a twin: such a page is
checked through the twin, so name the twin in the criterion's files and do not
call the rule unchecked doc.

On #558 (`experiments/41-facts-probe.ts`, a scratch clone of demlik at origin/main):
both pages get their twins (`src/docs/how-to/replay-in-a-test.test.ts`;
`src/docs/tutorial/build-your-first-machine.test.ts` and
`add-your-first-effect.test.ts`), and the pack now holds `defineMachine`,
`expectCmdEmitted` and `expectFinalState`, the last two with `ReplayOpts` in
their signatures. The brief went from 3117 to 5087 characters, the gathering
from 5.4 s to 8.1 s. Not yet tried: a fresh enrichment of #558 with it.
