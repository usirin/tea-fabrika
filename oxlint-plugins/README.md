These lint rules are the `fabrika` plugin for oxlint, written in TypeScript. `index.ts` lists them, `match.ts` holds what they share, and `.oxlintrc.json` at the top of the repo turns each one on, with the reason for every path it leaves out. Why oxlint: [`docs/direction/oxlint-and-oxfmt.md`](../docs/direction/oxlint-and-oxfmt.md).

```sh
pnpm lint                                   # runs lint.ts, then format.ts --check, then the code-graph checks
node oxlint-plugins/lint.ts packages/x      # the same oxlint step on one folder
```

`exact-versions.ts` is not an oxlint rule: `pnpm lint` runs it to refuse any ranged npm version in a tracked `package.json` or `pnpm-workspace.yaml` ([`docs/direction/pin-exact-versions.md`](../docs/direction/pin-exact-versions.md)).

Run oxlint and oxfmt through `lint.ts` and `format.ts`, not on their own. These two pin the one config at the top of the repo and turn off nested configs and outside ignore files, so a plain file cannot take a folder out of the checks. `lint.ts` also fails when a `.gitignore` hides a tracked file.

They began as GritQL rules in the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds, copied here unchanged. On 2026-10-31 they became TypeScript rules here, so this folder is where they change now. Each one fired on the same lines as its GritQL rule, on the whole tree and on a set of odd spellings; the note above has the numbers. The counts below are from when the GritQL rules were added and are kept as history. A name like `no-secret-env.grit` in them means the rule that is now `no-secret-env.ts`, and a mention of `biome-ignore` means what is now `oxlint-disable-next-line`.

Two rules only advise: `no-effect-promise` and `no-raw-try-catch`. Their messages start with "Advice, does not block". Oxlint has no level below `warn`, so `lint.ts` runs oxlint once and decides: it prints every fire, and fails on any fire but these two. Experiment 125 found both wrong far too often to block: 8 of 8 and 21 of 21 fires kept their code. Under Biome the same two gave their diagnostics at `"info"`, which `pnpm lint` (`biome check --error-on-warnings`) printed and did not fail on.

Phoenix's `no-node-sqlite-test-backing.grit` is not here. It bans a fake of Cloudflare D1; this repo has no D1, and `node:sqlite` is the ledger's real driver. Experiment 125 found it wrong 8 of 8 times.

`use-import-extensions` was not a plugin before. It stands in for Biome's built-in `useImportExtensions`, because oxlint's `import/extensions` misses `import()`, `import x = require()` and a name like `./b.laws`. It also refuses `./thing.js` when only `thing.ts` is there, which tsc accepts and Node does not. It has no autofix, so a miss is fixed by hand. It fired 0 times on the tree when it was added.

`no-bare-disable` was not a plugin before either. Biome failed on an ignore comment with no reason, and oxlint does not: its bare `// oxlint-disable-next-line` silences every rule, the secret rules too. This rule refuses an ignore comment that names no rule, gives no `-- <why>`, or says `eslint-disable`. It reports at offset 0 of the file, so the comment it refuses cannot silence it. It fired 0 times on the tree when it was added.

Four rules were this repo's own before the move too.

`no-secret-env.grit` and `no-redacted-value.grit` keep a secret in Effect's `Redacted` from the read to the one line that sends it (`docs/direction/secrets-are-redacted.md`). The first refuses a `process.env` read whose name looks like a secret; read it with `Config.Redacted("NAME")`. The second refuses `Redacted.value` anywhere but seven edge files, which `.oxlintrc.json` lists with their reasons. Both leave `experiments/` out, and the second leaves tests out (they hold made-up secrets and read them back). Both block. `packages/fabrika/src/redacted-lint.test.ts` plants each form and checks which ones fire.

Their count when they were added, on 2026-10-26:

- The first draft of `no-secret-env` fired 41 times on the whole tree. 12 were false alarms, and the rule was narrowed so they are left alone: a bare `KEY` or `REAL_KEY` that names a results or cache key (3), a name ending in `_HASH` (2), `delete process.env.X` (2), and a check that the value is set, as `!x` or `x === undefined` (5, two of them in the agents tutorial).
- What is left fires 29 times, and none is a false alarm. Outside `experiments/`, 5 were real plain-string reads: the Jev key in four of the old factory's scripts (`legacy/`) and the door's secret in `daemon.ts`. All 5 now read with `Config.Redacted`. In `experiments/`, left out, it would fire 24 times: 15 keys or tokens read into plain strings, 6 checks that a login is set written as `(x ?? "") !== ""` or `if (x)`, and 3 lists of values to scrub from output.
- `no-redacted-value` fired 8 times: 4 at the edges now listed (`http.ts`, `local.ts`, `worker-options.ts` twice), 3 in tests, 1 in `experiments/151`. The door, the Durable Object and `legacy/src/local.ts` were added to the list by this change, where tokens now leave their `Redacted`.
- After the change: 0 fires outside `experiments/`, and no `biome-ignore` was needed.
- The shared ledger (PR 130) landed beside this change and added 2 value fires. In `packages/ledger-server/src/stack.ts`, an empty-token check was not needed, because Effect's env provider already reads an empty value as none (`redacted.test.ts` checks this), so it was dropped. In `signer.ts`, an SSH key file's text goes to its parser, so that file joined the list. After that: 0 again.
- The sandbox (PR 156) and this rule (PR 132) landed on the same night and met only on main, with 4 value fires in `packages/fabrika/src/sandbox/sandbox.ts`. That file hands the box its logins, so it is not on the list: a new unwrap there must still be seen. Each of the 4 lines has its own `oxlint-disable-next-line fabrika/no-redacted-value` with its reason. Two send a lent login into the box (its env, its auth.json). Two read text that stays in the host, so a launch carrying a GitHub key can be refused.

`no-project-settings.grit` keeps a Claude run from loading a repository's own settings. Its hooks ran outside the sandbox in experiment 155, and the owner kept them out even where only trusted people work (`docs/direction/agents-read-rules-the-normal-way.md`). It refuses `settingSources` with a source in it, any `projectConfigRoot`, and the same CLI flags, anywhere but `packages/fabrika/src/agents/claude/rules.ts`, whose `ownRules` is the one place that says where a run's settings come from. `.oxlintrc.json` turns it off for that file and for tests. It blocks: of its 17 fires on the tree when it was added, 12 were on purpose and now say why in an `oxlint-disable-next-line fabrika/no-project-settings -- <why>`, 4 were tests (so tests are left out), and 1 was a real slip, in experiment 127. `rules.test.ts` plants each form it refuses and checks it fires.

The other is `no-bare-tell.grit`. A `tell` or `offer` to a program's input is an Effect, and written as a bare statement, or answered from a callback whose caller wants nothing back (`xs.forEach((x) => run.tell("n", x))`), it is made and dropped, so nothing is told.

`pnpm typecheck` catches every other dropped Effect statement through Effect's own `floatingEffect` check (`@effect/tsgo`, set up in `tsconfig.base.json`). That check does not look inside callbacks, so the callback shape stays this rule's job.

`plants.test.ts` plants one line per rule that no other test plants, and the built-in rules that must not be lost (unused imports and variables, non-null, ts-ignore), and sees each fire. It also runs `lint.ts`: advice alone exits 0 and still prints; a blocking fire exits 1.
