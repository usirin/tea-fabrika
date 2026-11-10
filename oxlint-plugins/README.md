These lint rules are the `fabrika` plugin for oxlint, written in TypeScript. `index.ts` lists them, `match.ts` holds what they share, and `.oxlintrc.json` at the top of the repo turns each one on, with the reason for every path it leaves out. Why oxlint: [`docs/direction/oxlint-and-oxfmt.md`](../docs/direction/oxlint-and-oxfmt.md).

```sh
pnpm lint                                   # runs lint.ts, then format.ts --check, then the code-graph checks
node oxlint-plugins/lint.ts packages/x      # the same oxlint step on one folder
```

`exact-versions.ts` is not an oxlint rule: `pnpm lint` runs it to refuse any ranged npm version in a tracked `package.json` or `pnpm-workspace.yaml` ([`docs/direction/pin-exact-versions.md`](../docs/direction/pin-exact-versions.md)).

`workspace-reach.ts` is not an oxlint rule either: `pnpm lint` runs it to refuse a workspace package of today's version that no app, tutorial, tool or the root `package.json` reaches through its dependencies, so a part nothing uses cannot stay ([0003](../.decisions/0003-a-clean-repo-kept-clean-by-code.md)). `next/` is left out while Tier 1 builds pieces before their app names them.

Run oxlint and oxfmt through `lint.ts` and `format.ts`, not on their own. These two pin the one config at the top of the repo and turn off nested configs and outside ignore files, so a plain file cannot take a folder out of the checks. `lint.ts` also fails when a `.gitignore` hides a tracked file.

They began as GritQL rules in the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds, copied here unchanged. On 2026-10-31 they became TypeScript rules here, so this folder is where they change now. Each one fired on the same lines as its GritQL rule, on the whole tree and on a set of odd spellings; the note above has the numbers. The counts below are from when the GritQL rules were added and are kept as history. A name like `no-secret-env.grit` in them means the rule that is now `no-secret-env.ts`, and a mention of `biome-ignore` means what is now `oxlint-disable-next-line`.

Three rules only advise: `no-effect-promise`, `no-raw-try-catch` and `prefer-schema-arbitrary`. Their messages start with "Advice, does not block". Oxlint has no level below `warn`, so `lint.ts` runs oxlint once and decides: it prints every fire, and fails on any fire but these three. Experiment 125 found the first two wrong far too often to block: 8 of 8 and 21 of 21 fires kept their code. Under Biome the same two gave their diagnostics at `"info"`, which `pnpm lint` (`biome check --error-on-warnings`) printed and did not fail on.

## Today's Electron test windows

Ticket 389 adds `e2e-windows` and reserves Playwright's `_electron` value import for
`apps/fabrika/src/testing/electron-launch.ts` with `eslint/no-restricted-imports`.
The reservation and alternate-launch checks cover today's whole app. Native window
calls are checked in root e2e drivers, `shots.ts` and `src/testing/`. Only
`electron-hook.cjs` may set native hiding or position. Product `main.ts` is outside
the native-call rule. Type-only imports, locator and DOM focus, headless Chromium,
size-only bounds and content sizes stay allowed. Existing Radix restrictions stay on.

The scan copied all 153 current app source files to their real config paths and read
every finding, on 2026-11-09. The before row restores main's `e2e.ts` in that copy.
Imports and launch calls are counted separately.

| Scan | Real | False | Unknown | Findings |
|---|---:|---:|---:|---|
| Before tests' conversion | 8 | 0 | 0 | Three `_electron` imports, three launches, two position writes |
| After tests' conversion | 5 | 0 | 0 | Lane import and launch; summon import, launch and position write, awaiting build |

`e2e-windows.test.ts` batches generated aliases, optional and literal computed calls,
native handles, renamed BrowserWindow bindings, shadows and allowed page calls through
real oxlint, seed 119120, 12 runs. The rejected source snippets are its lint plants.
Separate mutations that match every receiver, ignore renamed imports or ignore a native
handle each failed that property and were reverted. Zero final findings alone would
not measure false alarms.

This rule has no types. Unknown helper returns, transfers through object fields,
nonliteral computed methods, reflection and imports through another module can escape
it. Raw executable spawning also escapes it: the rule does not inspect `execFile`
arguments. Today's `e2e.ts` single-instance check passes the launcher's exported
`electronHookArgs` before the app path. That second copy needs no report because it
quits on the single-instance lock before ready, without creating a window. The first
copy's report still checks native focus. The runtime hook observes ordinary wrapped
setters and native focus events; prototype or native bypasses remain
outside that claim. Hook behavior and real Electron checks belong to build and lead.

## Effect property data advice

`prefer-schema-arbitrary` is today's tooling for `next/**/*.test.{ts,tsx}`. It asks for Effect data only when a fast-check data constructor has written schema evidence: an `Arbitrary<typeof S.Type>` annotation, a map through `S.make` or `S.cases.x.make`, or a generated binding passed to a named Effect Schema check. Imports, callback scopes and simple aliases are resolved. Nested constructors give one message at the outer constructor. Property runners pass. Names and shared record keys alone prove nothing.

The advice names the schema. A reason beside the declaration keeps an edge-case or unsupported generator:

```ts
// fast-check: edge cases -- deliberately generate invalid fields to test refusal
const invalid: fc.Arbitrary<typeof Input.Type> = fc.record({text: fc.string()});
```

Use `unsupported Effect` in that comment for a generator Effect cannot make. This rule does not execute modules or read types from another file. Its generated syntax laws and four planted breaks are in `prefer-schema-arbitrary.test.ts`. One law runs `lint.ts` and proves advice exits 0 while another warning exits 1.

Ticket 325, 2026-11-08, at [PR 532](https://github.com/usirin/tea-fabrika/pull/532)'s `1af180f6` next-test tree: the first scan found one false hit, `data/sink.test.ts:738`, where `Redacted.make` is not a schema. The match now excludes Effect modules other than Schema. The narrowed scan found 0 hits: 0 useful, 0 false and 0 unknown. Zero hits gives no false-alarm rate. The next-test files are unchanged in this tests commit, so its final-head count is the same. A separate parser scan found 189 named data constructors in 19 next-test files, including multiline calls. One useful miss is `data/log.test.ts:34`, checked through `parents(50).every(is)` at line 316. That helper flow needs review; it is outside the rule's direct binding matches. Effect 4.1.1 generated 10 valid `ParentText` values at seed 119120. Other constructor families exercise operation orders, invalid input or extra fields without direct schema evidence. These counts cannot show that every untyped generator should stay, or that Effect supports every domain schema.

Phoenix's `no-node-sqlite-test-backing.grit` is not here. It bans a fake of Cloudflare D1; this repo has no D1, and `node:sqlite` is the ledger's real driver. Experiment 125 found it wrong 8 of 8 times.

`use-import-extensions` was not a plugin before. It stands in for Biome's built-in `useImportExtensions`, because oxlint's `import/extensions` misses `import()`, `import x = require()` and a name like `./b.laws`. It also refuses `./thing.js` when only `thing.ts` is there, which tsc accepts and Node does not. It has no autofix, so a miss is fixed by hand. It fired 0 times on the tree when it was added.

`no-bare-disable` was not a plugin before either. Biome failed on an ignore comment with no reason, and oxlint does not: its bare `// oxlint-disable-next-line` silences every rule, the secret rules too. This rule refuses an ignore comment that names no rule, gives no `-- <why>`, or says `eslint-disable`. It reports at offset 0 of the file, so the comment it refuses cannot silence it. It fired 0 times on the tree when it was added.

`padding-line-between-statements` stands in for ESLint's rule of that name and `lines-between-class-members`, which oxlint 1.90.0 lacks ([0021](../.decisions/0021-a-blank-line-between-top-level-statements.md)). It asks for a blank line between top-level statements and between class members, unless both are one line, both are imports or re-exports, or the pair is one declaration (overloads, or a value then its same-name type). Its whitespace fix runs in `pnpm format`. Count on 2026-11-09, ticket 437: the first draft, with only the import and overload exceptions, fired 6,156 times in 847 files. 2,544 of those were two one-line statements and 424 a schema then its `typeof` type, both read as one group, so both became exceptions. The rule as merged fired 3,072 times in 583 files (2,920 once the `.claude/skills` link is counted once). A hand read of 40 fires at random found 0 false alarms; the earlier 30-fire read is what found the schema-type pairs. The sweep added only blank lines. `padding-line-between-statements.test.ts` generates files of imports, one-line and multi-line consts, schema-type pairs and overloads, and checks where it fires and that its fix adds only those lines.

On the same day (ticket 439) the rule took a second job: a blank line before and after every `if`, loop, `switch` and `try` in any block, unless it is first or last there, an `if` with its `else` chain and a labeled loop each counting as one statement. With `eslint/curly` set to `"all"` beside it, the tree had 14,959 padding fires and 8,378 curly fires (`.claude/skills` counted once) in 928 files. A hand read of 40 padding fires and 8 curly fires at random found 0 false alarms: each was a control statement with a neighbor and no blank line, or a body with no braces, which is what the owner asked to refuse. Many are runs of guard clauses, which now stand apart. The sweep took 8 `pnpm format` runs, since oxlint applies one fix per overlapping range a pass; every swept file parses to the same tree with a one-statement block read as its statement.

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

`builtin-plants.ts` holds a plant for each of oxlint's own rules that went on with 0 hits on 2026-11-09 (ticket 438): 124 rules from the eslint, oxc, unicorn, typescript, vitest, react, `import` and `promise` sets. With 0 hits a rule had shown nothing, so the plant is the only proof it works. Four quirks of oxlint 1.90.0 that the plants found: `no-implied-eval` reads `globalThis.setTimeout("...")` but not a bare `setTimeout("...")`; `no-non-null-asserted-nullish-coalescing` leaves a `declare const` alone; `promise/no-multiple-resolved` goes quiet when a second Promise follows in the file; and `require-awaited-expect-poll` and `import/no-commonjs` report one line twice. `react/preserve-manual-memoization` and `react/no-object-type-as-default-prop` stayed off: no plant made the first fire, and the second had 1 hit (`apps/fabrika/src/keys/window.tsx:98`). Two more stayed off after main moved on: `unicorn/prefer-type-error` had 12 hits once every `if` body got braces (it reads only a braced `throw`), and `eslint/no-unused-expressions` had 0 hits on the tree but refuses the bare `helper;` that `one-store-hook.test.ts` plants on purpose.

The same change turned on, as errors, Effect's 35 diagnostics that fired 0 times on the tree (28 suggestions and 7 that were off), plus `globalErrorInEffectCatch` and `globalErrorInEffectFailure` for `next/` files that are not tests, through the plugin's `overrides` in `tsconfig.base.json`. `effect-tsgo diagnostics --file` does not apply an override's `exclude`; `tsc` does, and `pnpm typecheck` is what blocks.

## The new version's exam rules

P16 adds `fabrika/program-package-layout` for `next/programs/` only. A package exports
its pure program at `.` and its real window at `./window`. A package awaiting a window needs
no stub. Worker entries and Worker runtime imports in the pure import graph fail, through
re-exports, helpers, cycles, literal dynamic imports, `require`, and `#` aliases in the package's
own `imports`. Type-only imports and re-exports pass, with either a declaration or a specifier
marked `type`, and so do `types` export conditions and declaration files. This follows
`docs/plan/tier-1-detail.md`, Packages, and the approved P16 plan. On 2026-11-10 it checked 3
files in the real program tree: 0 findings, 0 false alarms. The counter's pure entry links three
installed packages, which all resolve, so no link there went unresolved. Its 17 laws run the real
oxlint plugin over generated layouts at seed 119120; with the rule switched off, 15 fail (the 2
left are the accept law and the real-tree count). The rule blocks. What it cannot read it refuses
as "cannot judge", never passes: a dynamic import or `require` by a computed name, a file that
cannot be read or parsed, and a link that resolves to nothing. Two kinds of unresolved link stay
fine: a `node:` builtin, which no file stands for, and a bare package name the manifest lists in
`dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`, which is code
outside the package that may not be installed yet. A `#` alias that resolves to nothing is fine
only when every target its `imports` entry names is one of these two. A `#` alias is a Worker
runtime import when its `imports` entry names one under any condition, whatever the resolver
answers. It parses other files with `oxc-parser`, a dev dependency of this folder.

A Worker runtime import is one of the platform's names, the list
[0042](../.decisions/0042-platform-pieces-go-through-alchemy.md) gives (`cloudflare:*`, `miniflare`,
`workerd`, `wrangler`, `@cloudflare/*`), or Alchemy's local runtime
(`@alchemy.run/cloudflare-runtime`) or libfabrika's `box` and `workers` entries. The rule's
`platform` list cites 0042 and changes with it. A type-only import of any of them passes, so
`@cloudflare/workers-types` stays fine as types. A link is followed when it is relative or when it
resolves to a file that is not a dependency's, under `node_modules`: its own name, a `#` import or
an absolute path, in the package or out of it.

**Module resolution is a tool's, not ours** ([0040](../.decisions/0040-existing-tools-before-hand-written.md)).
The tools looked at:

- [`oxc-resolver`](https://github.com/oxc-project/oxc-resolver), 11.24.2, pinned in the catalog: the
  version the lockfile already held under Rolldown and oxlint. It implements
  [Node's ESM resolution](https://nodejs.org/api/esm.html#resolution-algorithm) with
  [enhanced-resolve](https://github.com/webpack/enhanced-resolve)'s options. **Used.**
- [`enhanced-resolve`](https://github.com/webpack/enhanced-resolve), webpack's resolver, which
  `oxc-resolver` ports: the same answers, and a new package that the lockfile does not hold.
- [`resolve.exports`](https://github.com/lukeed/resolve.exports): Node's `exports` lookup only, with
  no relative links, and also one answer for one set of conditions. Not in the lockfile either.
- [`typescript`](https://www.typescriptlang.org/docs/handbook/modules/reference.html)'s
  `resolveModuleName`: it always matches the `types` condition, so it finds declarations, not the
  file a runtime loads.

The rule resolves each relative link with `oxc-resolver`: TypeScript's bundler lookup, with the
extension added, a `.js` name standing for its `.ts` source and a folder's index. It resolves each
export target as a file path, as written, and it sends each pattern subpath back through the
package's own `exports`, by the package's name. So null targets and more specific keys apply as
Node applies them. Its conditions are `workerd`, `import` and `default`, plus each condition path
the package names. A package with no `name`, or a `name` that is not a string, cannot ask its own
`exports`, so the rule fails closed: every subpath a pattern matches counts as offered, and a
Worker behind it is refused. Any string name works, since 11.24.2 self-references by whatever the
manifest names.

What the resolver cannot do, with proof from 11.24.2 on a scratch package (2026-11-10):

- **It answers for one set of conditions, with the first match in key order.** For
  `"./ord": {"default": "./src/program.ts", "import": "./src/server.ts"}`, conditions `["import"]`
  give `src/program.ts`; `src/server.ts` never comes back. For
  `".": {"workerd": ["./src/server.ts"], "default": "./src/program.ts"}`, conditions `[]` give
  `src/program.ts`, and `["workerd", "import", "default"]` give `src/server.ts`. The rule judges
  every target a runtime condition names, so it lists the condition paths itself.
- **It resolves one subpath, and cannot list the subpaths a pattern offers.** `"./*": "./src/*.ts"`
  answers `@p16/x/server` with `src/server.ts`, but nothing asks it which subpaths exist. The rule
  lists the package files each target's `*` matches.
- **It names a `#` alias's module only in an error, and answers for one condition.** For
  `"imports": {"#cf": "cloudflare:workers"}`, `#cf` answers
  `{"error": "Cannot find module 'cloudflare:workers'"}`, with no field for the name. For
  `"#mix": {"default": "./src/program.ts", "workerd": "cloudflare:workers"}`, it answers
  `src/program.ts` (2026-11-10). So the rule reads the `imports` entry itself, every target under
  every condition and each pattern key, and judges each target by name.

The hand-written part, and the generated case that tests each edge in
`program-package-layout.test.ts`:

| Edge | Test |
|---|---|
| A string, an array or a conditions object as the whole `exports` value is `.` | "'.' written as the whole exports value", forms `string`, `array`, `conditions`, `array conditions` |
| Every runtime condition, custom ones included, nested, `types` never | "mixed export conditions", and entry `condition` |
| A target after `default` in the same object is still judged | "mixed export conditions" (`default` drawn before the planted condition) |
| Each element of a fallback array, on a key, in a condition, under `.` | entries `array key`, `array condition`, `array dot` |
| A window behind an array target is named at its key | entries `array key`, `array condition`, `array dot`, the moved window |
| A pattern's `*` matches one or more characters, folders included | entries `pattern`, `key pattern` (paths of two folders) |
| A pattern target without `*` maps every subpath to one file | entry `fixed pattern` |
| A pattern subpath a null target or a more specific key takes is not the pattern's | entry `null pattern` |
| Declaration files are never runtime code | "mixed export conditions", `.d.ts`, `.d.mts`, `.d.cts` |
| A package with no `name`, or a name that is not a string, keeps every subpath a pattern matches | manifests `no name`, `number name`, and the pinned nameless `"./*"` example |
| `./window` is judged for Worker code like every other subpath | entries `window`, `window tsx`, and the three pinned review 5 examples |
| Every `*` in a target is the same text | the plants' two-`*` target |
| A pattern target in build output, or under a symlinked folder, is listed | the plants' `dist/*.js` target and symlinked `src/lib` |
| A link by a non-relative name (its own name, a `#` import, an absolute path) is followed when it resolves to a file outside `node_modules` | the plants' `#server` import; link `absolute` and its pinned review 7 example |
| 0042's platform names are Worker runtime names, `@cloudflare/*` and `wrangler` included, even as declared dependencies | shapes 23 and 24 (`@cloudflare/containers`, `wrangler`), the drawn names of the runtime-import and dynamic-import plants, and the pinned review 7 `Container` example |
| A `#` alias whose `imports` entry names a Worker runtime anywhere (a string, an array, a condition after a file target, a pattern key) is a Worker runtime import | links `imports alias`, `imports array`, `imports condition`, `imports pattern`, and the pinned review 6 `#cf` example |
| A link that resolves to nothing is refused, save a `node:` builtin, a declared dependency, or a `#` alias whose every target is one | the plants' missing file, `#` with no entry, with a missing target or an undeclared target, undeclared package, own unexported subpath, `virtual:` scheme; the accept law's fine links |
| A literal link is a string or a template literal with no `${}`; `require` and `import x = require()` are links; any other name is refused, never skipped | the plants' template literal, `require`, `import =` and computed import |
| A file that cannot be read or parsed is refused, never read as empty | the plants' unparsable subpath and pure helper |
| Pure code that oxlint does not lint line by line (outside the package, by a symlink, under `fixtures/`) is reported for the package | links `symlink`, `outside`, `absolute` under `condition` and `array dot`, and their two pinned examples; `fixtures/` has no test, as the harness lints with `--no-ignore` |
| Package findings go on every file when the `.` entry is one oxlint skips (a test file is judged like any other) | the plants' `program.test.ts` and extensionless entries |
| A plain subpath must name a real file; an export key is `.` or starts with `./` | the plants' `src/server.ts`, missing target and `import` key |

fast-check 4.10.2 counts `examples` inside `numRuns`, so `withExamples` adds the generated runs on
top. Before 2026-11-10 the layout law ran its 7 examples and 1 generated input.

`one-id-module` keeps `next/`'s Id code in `libfabrika/src/id.ts`. It refuses the retired
`libfabrika/src/data/id.ts`, even empty or forwarding, so a second module cannot stay behind.
T518 A8's count on 2026-11-08 was one fire, the second module from P17a, with no false alarm.
Its property test generates file contents and checks nearby paths stay allowed.

### libfabrika's rooms

Ticket 477, decision [0043](../.decisions/0043-rooms-on-floors.md). One rule of ours and two of oxlint's own hold a room's shape in `next/packages/libfabrika/src`. `.oxlintrc.json` gives all three their paths and lists, and `rooms.test.ts` plants each law at its real path with that config.

| Rule | Refuses | Lists, in `.oxlintrc.json` | Tests |
|---|---|---|---|
| `rooms` | a room file that re-exports another room's names (`export ... from`, `export *`, or an imported name sent on); a file in a folder or at a top name `src/` does not list; an export in a room's `internal/` with no `/** @internal */` above it; a service or an error in a shared top file | `src`, `rooms`, `folders`, `files`, `values` | on |

The other two laws are oxlint's own rules, since an existing rule comes before a hand-written one ([0040](../.decisions/0040-existing-tools-before-hand-written.md)). `eslint/no-restricted-imports` refuses an import or `export ... from` of another room's `internal/`, by one pattern group in an override for `src/**`; the override repeats the base rule's Radix entry, since an override replaces a rule's options. `unicorn/filename-case` holds a front file to PascalCase and an `internal/` file to camelCase, in two overrides.

Count on 2026-11-10, on main at `33a282f8` with this change: `rooms` 0, the `internal/` pattern 0, `filename-case` 0. Zero was expected and measures no false-alarm rate: no room has an `internal/` yet, and only `transport/` and `door/` exist. So the lists hold main's old names too (`data`, `coordination`, `app`, `id`, `testing`), and the two case overrides name only the six rooms with no file on main. Each old name leaves, and `transport` and `door` join the case overrides, in the pull request that moves its files. The top of `rooms.ts` lists what the rule does not see: a package specifier, a name given a new binding before it is exported, and an error or service made by a helper under another name.

Eight rules apply to `next/` only, as Tier 1's exam (`docs/plan/tier-1-detail.md`, "The exam PR", items 1, 2, 4, 5 and 13, P35, and ticket 337). `.oxlintrc.json` turns them on in `next/**` and nowhere else, so today's code is untouched. Their planted tests use `next/apps/fabrika/src/exam/plant.ts` and lint each planted file at the `next/` path it names, in a temp folder with this repo's config, so the edge paths and globs meet it as they meet a real file.

| Rule | Refuses | Edges | Tests |
|---|---|---|---|
| `no-promises` | `async`, `await`, `for await`, `new Promise`, `Promise.x(...)`, `.then`, `import()`, `.catch` on anything not imported from Effect, and Effect 4.1.1's calls that take or make a Promise: `Effect.promise`, `Effect.tryPromise`, Schema's four `...Promise` calls, Stream's `fromAsyncIterable` and `toAsyncIterable` and its two variants, typed calls included | a line under an edge comment | left out |
| `no-effect-run-outside-edge` | any of Effect's twelve run functions, on `Effect` or a runtime, and `runtimePromise` and `makeRuntimePromise`; `NodeRuntime.runMain` passes | a line under an edge comment | left out |
| `edge-comment` | an ignore comment naming either rule above that is not `// oxlint-disable-next-line <rule> -- edge: <why>`: another form, another rule named beside them, or no `edge: ` reason | none | on |
| `no-of` | a declared name `of` or ending in `Of`; a use passes | none | on |
| `no-why-key` | a statically named `why` key in an object, class or type declaration; use `reason` | none | on |
| `no-hand-tag` | an object key, class field or type member named `_tag`; a read passes | the log, `next/packages/libfabrika/src/data/log.ts` | left out |
| `one-store-hook` | `useSyncExternalStore` imported or read as a plain member anywhere in `next/`; a store hook's value dropped | none | left out |
| `no-clock-in-view` | `Date.now()`, `new Date()`, `Date()`, `performance.now()`, `Math.random()`, `crypto.randomUUID()` in a `.tsx` file, handlers included | none | left out |

React's own `react/refs`, `react/immutability`, `react/display-name` and `react/purity` block in `next/**/*.tsx`, tests left out (`docs/direction/react-compiler.md`). `react/purity` refuses a clock or random read in render and lets a handler pass, as React means it; `no-clock-in-view` refuses the same reads anywhere in a `next/` `.tsx` file, handlers included, since the time comes through a Cmd (C1; owner, 2026-11-05). oxc-transform-react 0.157.0 stopped refusing a clock read in a handler a view passes down, which 0.156.0 did, so this rule holds that case now. `pnpm lint:compiler` runs the Compiler's compile step, `next/apps/fabrika/src/exam/compiler.ts`, over every `.tsx` file in `next/`, against `compiler-ledger.json`, which starts empty.

**`.agents/` is held to the same rules** (owner, 2026-11-09; [0033](../.decisions/0033-agents-code-follows-next-rules.md)). A second override names `.agents/**/*.ts` and `.agents/**/*.mjs` and repeats the `next/**` rule block, and `edge-comment.test.ts` checks the two blocks are equal. `.agents/` tests keep the edge rules on, since only `next/`'s tests may turn one off; their own override leaves out `effect-functions`, `no-hand-tag` and `one-store-hook`. `no-node-imports`, `no-node-filesystem` and `no-ledger-sql` check their path with `heldToNext` in `match.ts`. On the day it joined, 154 findings fired in 9 files: `no-promises` 51 (42 of them in two tests that drive real processes, `box.test.ts` 15 and `run.test.ts` 27), `no-hand-tag` 48, `no-node-imports` 23, `no-of` 21, `no-node-filesystem` 9, `no-effect-run-outside-edge` 2. Each is named in `agents-ledger.json` by file, rule and its line of code with spaces collapsed (`ledger.ts`), never a line number. `lint.ts` waives a finding only an entry names, refuses an entry outside `.agents/`, and on a whole-repo run writes back only the entries a finding still matched; CI fails until that pruned file is committed. Nothing adds an entry; that is the owner's call. `ledger.test.ts` holds the laws and plants a `.agents/` script.

**Edges are comments, not files** (owner, 2026-11-05; Tier 1, P35). The one line a platform demands, such as a Durable Object method that must answer a Promise, passes either rule only under `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, or the same for `fabrika/no-effect-run-outside-edge`, or one comment naming both. Until P35 the run rule held a list of 18 whole paths, which let a whole file wrap Promises; the list is gone. `edge-comment` keeps every such comment to one shape, reported at the top of the file as `no-bare-disable` is, so a comment cannot silence it. An edge comment over a line where nothing fires fails through `reportUnusedDisableDirectives`. CI's `edges` step (`next/apps/fabrika/src/exam/edges.ts`) lists each edge comment a pull request adds, with its reason, in the step summary and as a note on the diff, for the owner to read; it never blocks. Its industry match is clippy's `undocumented_unsafe_blocks`, with `edge:` for `SAFETY:`, and eslint-comments' `require-description` and `no-restricted-disable`.

The oxlint rules see syntax. A `.catch` is told apart by the name it is called on,
and `Effect.promise` and the run functions by their written names. P12 adds the typed
check below for Promises passed through helpers. `no-hand-tag` misses `x._tag = "a"`,
which the plan does not name. Report any miss.

### Ticket 337: reason keys in next/

`no-why-key` checks object fields, shorthand, methods, getters and setters; class fields,
methods and accessors, including static and abstract declarations; constructor parameter
properties with access or readonly modifiers, including defaults; and type or interface
property and method signatures. Effect Schema field maps use the same object syntax. Quoted
and escaped names, computed string literals and expression-free templates count by their
decoded value. The match is exactly `why`, including readonly members.

Reads, destructuring reads, local variables, plain constructor parameters without property
modifiers, comments, string values and dynamic keys pass.
`whyNot`, `Why` and `reason` pass. Member assignments, SQL and JSON inside strings need the
separate sweep audit. Today's paths keep their spelling. There is no autofix, since changing
one declaration alone can break readers and saved formats. The glossary is not parsed as policy.

The tests checkpoint on 2026-11-09 used base and unchanged product head
`9b48d622b5d4cfe54ca6d0a8a53f0ac03d3f2c03`, with the tests changes in this commit.
The standard wrapper, `node oxlint-plugins/lint.ts next`, scanned the 197 TypeScript files
under `next/`. It reported 294 `no-why-key` diagnostics across 44 build-owned files.
Every diagnostic was read against its declaration: 294 useful findings, 0 false findings,
0 unclassified findings. No tests-owned file has a remaining declaration. Raw output is private
under `runs/reason337/next-lint.log`. Product still uses `why`, so this is deliberately red.

`no-why-key.test.ts` uses generated Unicode names, generated filenames and declaration forms
through the real config, with seed 119120 and 12 runs per property. Every syntax run includes
the exact retired key. Fixed format checks pin escaped spellings and the diagnostic.
The final post-build scan on 2026-11-09 used base
`9b48d622b5d4cfe54ca6d0a8a53f0ac03d3f2c03` and code head
`d6f62819a3585252a3bb08a63837029c088934ad`, including review 1's class declaration fixes.
The same wrapper scanned all 197 TypeScript files under `next/`: 0 `no-why-key`
diagnostics, 0 useful findings, 0 false findings and 0 unresolved findings. It passed with
0 blocking findings and 42 advice messages. Raw output is private at the same path above.
A zero-hit scan has no false-alarm percentage denominator. The generated positive and
negative plants check both sides separately; they cover parameter modifiers, default values,
instance/static/abstract accessors, decoded key spellings and permitted plain parameters.

### P12 checks in lint

`no-node-filesystem` refuses `fs`, `fs/promises` and `path`, with or without `node:`,
in `next/` product files. It covers imports, re-exports, dynamic imports, `require`
and TypeScript import assignments. Tests, test support files, declarations, the
exam and browser test drivers are left out. Its generated plants use the real
config at these paths. The P12 review-6 sweep found one filesystem import in
`node/stage-recording.ts`, plus six path imports: that file, `node/build.ts`,
and the app's `build.ts`, `dev.ts`, `src/local-stage.ts` and `src/stage.ts`.
These are seven findings in six files, all read by hand, with no false alarm.
All can use Effect's existing FileSystem or Path service. This rule deliberately
stays red until the builder removes those imports.

`pnpm lint:twin` runs `next/apps/fabrika/src/exam/twin.ts` on the real Alchemy stack.
It reads the installed providers, prints the finding count and exits nonzero for any
finding. Its generated plants stay in `twin.test.ts`, with seed 119120.

`pnpm lint:promise-types` adds types to `no-promises`. TypeScript 7.0.2's installed
sync API resolves every `next/` project. Calls, returns and function parameters may
not carry a Promise or a function returning one outside a marked edge line. Type
declarations, tests, test support files and today's code are left alone. The scanner does not emit code
or run type diagnostics. `no-promises.test.ts` plants imported aliases, inferred
returns, generic thunks, object methods and line-local edge comments. An edge comment
covers only the next physical line. History: the initial P12 head scan at `4577f6b0`
found 103 lines. It recorded false alarms inside wrapped statements whose first line
had an edge marker. A statement-wide exception left 60 real findings in P12's files
and 27 in unchanged files from main. P12's new files then reached zero. See
`field/notes.jsonl`, note `2026-11-08-275`. The statement-wide exception was dropped
because it walked back [no-promises.md](../docs/direction/no-promises.md). The build
restructured the code to keep each Promise on its marked line. `pnpm lint:promise-types`
reports 0 findings on the P12 tree at `97245dc7` with the narrowed rule below, with 0
false alarms. The check runs in `pnpm lint`. Unknown types still need the regular typecheck.

An untyped or `never` call needs an edge marker only inside an input to Effect's own
`tryPromise` or `promise`. The checker follows the declaration's symbol, including imported
aliases, parentheses, non-null assertions, `satisfies`, `as`, const aliases and their chains,
destructuring and renamed bindings. Computed keys work when the checker resolves every
possible key to one of those two declarations. A key that may select another function, or
whose type cannot be resolved, supplies no evidence of a Promise bridge. The RPC property
generates all 17 supported spellings for both bridges. Pinned laws keep two known gaps:
a key that may select `sync`, and a bare RPC call whose Workers type is `never`.

Replaying `97245dc7`'s broad rule on this tree still gives 75 findings: 9 real and 66 false
alarms, or 88%. Those 66 synchronous calls are outside Effect bridges. The narrowed rule
reports none of them. These nine real cases also sit outside bridges, so they remain for
the build step rather than making every unknown return a finding:

| File | Lines | Real or false | Why |
|---|---|---|---|
| `next/packages/libfabrika/src/app/program.ts` | 411 | real | A Standard Schema validator can create a Promise behind its `unknown` return type. |
| `next/packages/libfabrika/src/node/stage.ts` | 349, 352, 353, 354, 359, 360, 362, 367 | real | `Reflect.get` erases the proxy's returned Promise thunks to `any`. |

`no-ledger-sql` refuses SQL strings naming the ledger's `entries` or `rings` outside
its three service files in `next/`. Tests, test support files and today's code are left alone. Its
generated plants cover reads, joins, writes, quoted names, SQL comments, templates
and allowed tables. The bootstrap read in `workers/runtime.ts` now uses `Ledger.read`;
P12's product files have zero findings. The first scan
also found a test helper reading rows for assertions. Leaving test support files
out removes that false alarm. This check
recognizes SQL text; it cannot resolve a table name assembled at runtime.

Their count on PR 223's tree at `7c1d073` (33 files), each fire read by hand, on 2026-11-05:

- `no-promises`: 225 fires on 195 lines, none false. 63 fires on 57 lines are the slice's own Promise plumbing (`app/process.ts` 26, `brain.ts` 13, `build.ts` 9, `data/project.ts` 4, `transport/gateway.ts` 4, `app/entry.ts` 2, `coordination/process-manager.ts` 2, `window/main.tsx`, `brain-host.ts` and `dev.ts` 1 each). The other 162 are in `e2e.ts`, the slice's Playwright script: true by the rule's words, and test code by role. The plan's thin runner moves those laws into `e2e/*.test.ts`, which the rule leaves out.
- `no-effect-run-outside-edge`: 3, none false, all in `window/main.tsx` (two `Effect.runPromise` in the `useRuntime` handle, one `Effect.runFork`). They move to the hook's edge file with T5. Placed at the plan's package paths, no slice file lands on an edge, so the count is the same.
- `no-of`: 1, none false: `sizeOf` in `desktop/fold.ts:63`.
- `react/purity`: 1, `window/main.tsx:146`, a clock read in a helper made in render that only a click handler calls. False by React's own reading (experiment 194 found the same), true by C1.
- `no-clock-in-view`: 2, none false by its words: `window/main.tsx:146` (the same read) and `main.tsx:19`, a module-level `crypto.randomUUID()` naming the tab. That one is not in a view function, only in a view file; whether a read at a view file's top level should pass is a later call.
- `no-hand-tag`, `one-store-hook`, `react/refs`, `react/immutability`, `react/display-name`: 0. The slice holds no `_tag` and no store hook, so for those two a zero measures nothing.
- `lint:compiler`: 0 findings on the slice's two `.tsx` files.

## Function tracing, T285 PR 1

`effect-functions` applies to product code in `next/`. A named function returning
an Effect with a whole-function `Effect.withSpan` chain uses named `Effect.fn`.
The rule also sees returned recovery and flush chains, direct `Effect.withSpan`,
curried wrappers, and aliased Effect imports. It leaves inner spans and
`Stream.withSpan` alone. Stream spans measure consumption.

Round 1 measured base `600c6449`, 2026-11-08, with
`node oxlint-plugins/lint.ts next`. Each finding was read against
[`the tracing decision`](../docs/direction/effect-fn-for-traced-functions.md).
Paths below start at `next/packages/libfabrika/src/`.

| Finding | Verdict |
|---|---|
| `data/ledger-store.ts:261`, `ring`, `ledger.ring` | Real. Fixed in round 1. Recovery stays outside the failed span. |
| `data/ledger-store.ts:312`, `append`, `ledger.append` | Real. Fixed in round 1. Validation refusals stay inside the span. |
| `data/ledger-store.ts:340`, `read`, `ledger.read` | Real. Fixed in round 1. One span per answered page. |
| `data/ledger-store.ts:370`, `wait`, `ledger.wait` | Real. Fixed in round 1. Ready and parked answers stay inside the span. |
| `app/runner.ts:436`, `cmdSpan`, `runner.cmd` | Real. Fixed in round 1. Handler recovery stays outside the failed span. |
| `app/runner.ts:470`, `commit`, `runner.write` | Real. Fixed in round 1. The signer's link and scope stay the same. |
| `app/runner.ts:592`, `call`, public runner spans | Real. Fixed in round 1. The span ends before flushing. |
| `data/ledger.ts:94`, `call`, `ledger.call` | Real. Still open in round 2. Use named `Effect.fn` and set argument attributes inside it. Forwarding methods need no second span. |
| `data/sink.test.ts:94`, `traced`, arbitrary span input | False alarm in the first scan. This helper manufactures test input, rather than tracing a product operation. Tests are now outside this rule. |

The first scan included tests: 9 findings, 8 real and 1 false alarm. The final
config leaves tests out, as the other Effect exam rules do. A second scan of all
`next/` had **8 findings, 8 real, 0 false alarms**.

Round 2 scanned all of `next/` again on base `c20a363c`, 2026-11-08, with the
same command after the door fixes landed. It has **1 finding, 1 real, 0 false
alarms**, at `next/packages/libfabrika/src/data/ledger.ts:94:5`. The five partial
door spans are accepted. Their scope stays covered by generated keep-laws in
`next/apps/fabrika/src/door-spans.test.ts`. Remote forwarding, argument tags,
pages and failed exits are covered by generated keep-laws in
`next/packages/libfabrika/src/data/ledger-call-spans.test.ts`.
The rule stays an **error**. The remaining finding is PR 1's red. It needs no
advice exception in the lint runner. The seven advice diagnostics in this scan
are from the existing advice rules.

The planted exam is `next/apps/fabrika/src/exam/effect-functions.test.ts`.
Nine rejected fixture sites are real violations. Seven allowed forms cover
inner spans, consumed streams, named functions, untraced helpers, forwarding
and one-use callbacks. Other fixtures check aliases, today's code and test span
makers. A rule that rejects every `withSpan` fails these plants.

This rule checks syntax, without types. It follows only the returned chain in an
expression body or a block containing one return. It does not inspect Effect
values such as `members` or `info`, infer indirect wrappers, or enforce every
helper's use of `fnUntraced`. Behavior properties in
`next/packages/libfabrika/src/app/effect-functions.test.ts` keep the names,
attributes, parents, failed exits, signer links and flush order. The sample is
one tree; zero false alarms here does not prove every future shape.

`effectFnOpportunity` remains off. Its earlier 11 false alarms among 17 findings
are not evidence for enabling it.
