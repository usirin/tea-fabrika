
Plancheck-Version: 3

# Plan for ticket 900: a lint rule holds E6, every public export in a `next/` library has its doc block

Everything here is about `next/` and the repo's lint tooling. Today's version is not changed.
A draft. Nothing is built.

```ts
// The whole idea, a sketch. One rule, `fabrika/jsdocs`, on every public file of a next/ library.

// settings/RecordedStart.ts as it first reached review (pull request 1054, commit 0f123010e8db):
import { type Config, Context } from "effect"; //            fires: the file has no module block

export class RecordedStart extends Context.Service</* ... */>()("...") {} // fires: no doc block
// pnpm lint: 2 blocking findings, neither named in next-ledger.json. The pull request cannot merge.

// The same file after its fix (commit 245fdbac122c): a module block with @stability, and a block
// on the class with one description paragraph, @stability and @category.
// pnpm lint: 0 findings.
```

## The answer first

- **The check.** One oxlint rule of ours, `fabrika/jsdocs`. It finds each public export through
  oxlint's syntax tree and judges its doc block with Effect's own block grammar, copied from
  Effect's checker at the version we pin.
- **Where it runs.** In `pnpm lint`, as a blocking rule, from the day it lands.
- **Old misses.** 833 findings on main today. Each is named in `next-ledger.json`, which only
  shrinks. A new export, or a changed line, is not in the ledger, so it must comply.
- **The owner's one yes.** Adding those entries. Nothing adds a ledger entry but the owner
  ([0033](../../.decisions/0033-agents-code-follows-next-rules.md), and the lint notes on
  `next-ledger.json`). The ledger file exists already, so no new ledger is made.
- **Then the fills.** Eight small pull requests add the missing blocks, by module. Each one makes
  the ledger shorter.
- **The plan-code rule waits.** It is the last slice, after the fills. The reasons are in
  [its section](#the-plan-code-rule-waits).

## How others do it

Existing tools first ([0040](../../.decisions/0040-existing-tools-before-hand-written.md)). Our
shape is in [the doc comments pattern](../../.patterns/doc-comments.md): a module block, one
description paragraph, three optional sections in order, `**Example** (Title)` sections, tags in
a fixed order with `@stability` and `@category`, no `@since` yet
([0118](../../.decisions/0118-no-since-tag-before-a-release.md)), and `@internal` in `internal/`
files.

| Tool | What it can hold | What it cannot | Proof |
|---|---|---|---|
| [Effect's own checker](https://github.com/Effect-TS/effect/tree/effect%404.1.2/packages/tools/jsdocs), `pnpm jsdocs --check` in Effect's repo | All of the shape. It is where the shape comes from | Run here. It is private and not on npm. It needs TypeScript's JS API, below version 7; ours is 7.0.2. It asks for `@since`. It is a command, not a lint rule: Effect's [oxlint rules](https://github.com/Effect-TS/effect/tree/effect%404.1.2/packages/tools/oxc/src/oxlint/rules) at the tag are five, none for docs | Read at the tag: its manifest says `"private": true` and peer `typescript >=5.0.0 <7.0.0`; one source file, `src/Jsdocs.ts`, 3,598 lines |
| [oxlint's `jsdoc` rules](https://oxc.rs/docs/guide/usage/linter/rules/jsdoc/check-tag-names), 1.90.0, installed | Refuse `@since`, `@example`, `@param` and a misspelled tag, with `check-tag-names` | Require a block, a description, a tag or a tag order | Tried: `Rule 'require-jsdoc' not found in plugin 'jsdoc'`. `sort-tags`, `require-description`, `match-description`, `require-file-overview` and `no-restricted-syntax` are absent too. `check-tag-names` refused 4 of 4 planted tags and passed an export with no block |
| [`eslint-plugin-jsdoc`](https://github.com/gajus/eslint-plugin-jsdoc/blob/main/docs/rules/require-jsdoc.md) 65.4.6 | A block on an export (`require-jsdoc`, `publicOnly`), a description, a [tag order](https://github.com/gajus/eslint-plugin-jsdoc/blob/main/docs/rules/sort-tags.md). It loads in oxlint 1.90.0 as a [JS plugin](https://oxc.rs/docs/guide/usage/linter/js-plugins) under another name | The sections and their order, the example shape, a tag-only block on a re-export. It also reads Effect's correct files as wrong | Tried on Effect 4.1.2's own source, 431 files outside `internal/` with `StandardSchema.ts` left out: `require-jsdoc` fired 59 times, `require-description` 217, `sort-tags` 2,494. Effect's checker passes that tree, so all are false alarms. Two examples: it wants the block on `const void_`, where Effect writes it on the export name; it wants a description in a `/** @internal */` block. It brings ESLint as a peer, about 47 MB installed |
| [TypeDoc's `validation.notDocumented`](https://typedoc.org/documents/Options.Validation.html) 0.28.20, and [API Extractor](https://api-extractor.com/pages/messages/ae-missing-release-tag/) 7.60.1 | That a block exists | Any of the shape. Both need TypeScript's JS API: TypeDoc's peer list ends at 6.0, and API Extractor ships its own 6.0.3 and reads built declaration files from one entry point. libfabrika has 40 subpaths, each a source file, and no build that writes declaration files. API Extractor's tags are `@public`, `@beta`, `@alpha`, never `@stability` | Not run. Read from `npm view` and the two pages. The page for API Extractor's missing-docs message could not be fetched |

**What we use.** Effect's own block grammar, inside a small rule of ours.

- Lines 962 to 1608 of Effect's `Jsdocs.ts` judge one block: description, sections, examples,
  spacing, tags and their order. They call no TypeScript API. They are plain string code, about 650
  lines, MIT licensed.
- The rest of that file finds exports and resolves links with TypeScript's API. That part cannot
  run here. Our rule does the finding with oxlint's tree instead, about 220 lines.
- This is what E6 of [the Effect code guidelines](../direction/effect-code-guidelines.md) decided:
  "a copy of Effect's docs lint rule, without `@since`".
- **Why.** The shape is Effect's, so Effect's own grammar is the one judge that cannot drift from
  it by our hand. On a pin bump we diff the same lines again.
- **Cost.** About 650 copied lines to own. The hourly mutation run will find gaps in them and file
  tickets. The copy keeps Effect's license notice in its head.
- **How sure.** 85%. The doubt: the copy must pass our own lint and format. `pnpm format` adds
  braces and blank lines by itself. Any rule that still fires is fixed by hand in the copy, and
  law 8 below proves the copy still judges as Effect does.

## What was measured

The measuring tool was a scratch prototype, not kept: `oxc-parser` 0.157.0, the lines of Effect's
file named above, and a walk of each file's top-level statements. It ran on `origin/main` at
`14f96d9a3`. The tests step counts again with the real rule on its first day, and that count is
the one that lands.

**Missing blocks today.** `next/` has one library, `@kampus/libfabrika`. Its public files are
those under `src/`, with `internal/` folders, tests, test support and shared suites left out: 136
files, 797 exports.

| Module | Public files | Exports | No block | Block, wrong shape | Pass | No module block (files) |
|---|---|---|---|---|---|---|
| top files (`Id.ts`, `index.ts` and five more) | 7 | 97 | 73 | 13 | 11 | 7 |
| `access` | 7 | 45 | 24 | 21 | 0 | 7 |
| `ci` | 1 | 9 | 0 | 0 | 9 | 0 |
| `cloudflare` | 16 | 82 | 65 | 11 | 6 | 15 |
| `codehost` | 1 | 12 | 0 | 0 | 12 | 0 |
| `coordination` | 1 | 72 | 72 | 0 | 0 | 1 |
| `gateway` | 5 | 8 | 4 | 0 | 4 | 3 |
| `jobs` | 3 | 22 | 11 | 11 | 0 | 3 |
| `ledger` | 9 | 28 | 12 | 16 | 0 | 9 |
| `node` | 15 | 34 | 18 | 16 | 0 | 15 |
| `packs` | 4 | 17 | 15 | 2 | 0 | 4 |
| `presence` | 1 | 1 | 1 | 0 | 0 | 1 |
| `processes` | 11 | 68 | 31 | 37 | 0 | 9 |
| `repositories` | 1 | 13 | 11 | 2 | 0 | 1 |
| `runtime` | 31 | 165 | 62 | 66 | 37 | 22 |
| `schedules` | 1 | 5 | 4 | 1 | 0 | 1 |
| `settings` | 11 | 54 | 29 | 23 | 2 | 10 |
| `telemetry` | 5 | 40 | 20 | 20 | 0 | 5 |
| `transport` | 6 | 25 | 20 | 3 | 2 | 6 |
| **all** | **136** | **797** | **472** | **242** | **83** | **119** |

- 472 exports have no block. 0120 guessed about 240.
- 242 have a block in the wrong shape: 223 lack both `@stability` and `@category`, and 19 have no
  blank line before the tags.
- 119 files have no module block.
- So the ledger starts with 472 + 242 + 119 = **833 entries**, one per export and one per file.
- 139 of the 472 are names in an `export { a, b }` list. 124 of those sit in the three barrel
  files. 65 are the type half of a schema and its type, such as
  `export type Sent = typeof Sent.Type;`.
- No file holds a `@since` tag.

**False alarms.** A rule blocks at about 0% (AGENTS.md, "Checks"), and all its hits are counted,
not a sample ([0120](../../.decisions/0120-effect-code-guidelines.md)).

- **On a tree known to be right.** Effect 4.1.2's own source, 432 files outside `internal/`, 9,536
  exports, with `@since` asked for as Effect asks. The prototype fired 12 times, all in
  `StandardSchema.ts`. That is the one file Effect's own config leaves out, and its exports do lack
  the tags. **0 false alarms in 9,536 exports.**
  [0023](../../.decisions/0023-next-follows-effects-code-style.md) records the same answer from
  Effect's checker on its own modules: one file, `StandardSchema.ts`.
- **On our tree.** All 833 hits are counted above. A hand read of 30, seed 119120: 30 real. 17 had
  no block (4 of them names in a barrel list), 9 had a one-line block with no tags, 2 had no blank
  line before the tags, 2 were files with no module block.
- **A first draft of the scope was wrong.** With shared suites (files named `*Test.ts`) counted as
  public, 7 of a first sample of 30 were test tooling: 23%. So suites are left out, as test
  support is. That draft counted 898 exports and 957 hits.
- **The file that started this.** `RecordedStart.ts` at commit `0f123010e8db`: 2 fires, the class
  and the module block. At its fixed head `245fdbac122c`: 0 fires.

## The shape

The lint plugin folder is repo tooling, so this is plain TypeScript on `@oxlint/plugins`, as the other
rules are. A sketch, to be checked against oxlint 1.90.0's plugin types before it is built.

```ts
// oxlint-plugins/jsdocs.ts
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { buildTags, parseJSDocBlock, parseLooseJSDocBlock } from "./effect-jsdocs.ts";

/** The one option. `absent` until libfabrika ships a version (0118), then `required`. */
type Options = { readonly since: "absent" | "required" };

/** What a block stands above. It picks the tags Effect's grammar allows and asks for. */
type Scope = "module" | "declaration" | "namespace" | "member";

/** What is wrong with one block, in Effect's own messages. An empty list passes. */
declare const judge: (raw: string, scope: Scope, options: Options) => ReadonlyArray<string>;

export const jsdocs: CreateRule = (context) => ({
  Program(program) {
    // 1. The module block: the first `/** */` before the first statement.
    // 2. Each top-level export: the last `/** */` among the comments right above it.
    // 3. One report per export, at the export's first line, listing every problem.
    context.report({ node: statement, message: "RecordedStart has no doc block (E6, 0023). ..." });
  },
});
```

```ts
// oxlint-plugins/effect-jsdocs.ts: copied, not written.
// From Effect-TS/effect, packages/tools/jsdocs/src/Jsdocs.ts, lines 962 to 1608, at effect@4.1.2.
// MIT, with Effect's notice kept here. One change: `@since` is asked for only when told to.
export declare const parseJSDocBlock: (raw: string, range: [number, number]) => JSDocBlock;
export declare const buildTags: (scope: Scope, tags: ReadonlyArray<JSDocTag>, stability: boolean) => Tags;
```

```jsonc
// .oxlintrc.json, two new blocks
{
  // E6 (0023, 0120): every public export of a next/ library has an Effect-shaped doc block.
  "files": ["next/packages/*/src/**"],
  "rules": { "fabrika/jsdocs": ["error", { "since": "absent" }] }
},
{
  // Not public: internal/ (the modules rule asks @internal there), tests, test support,
  // shared suites, fixtures and declaration files.
  "files": ["<the six kinds, as globs>"],
  "rules": { "fabrika/jsdocs": "off" }
}
```

The ledger needs no new code. The lint runner already waives a finding that `next-ledger.json`
names by file, rule and line of code, and prunes an entry whose finding is gone.

```json
{ "file": "next/packages/libfabrika/src/settings/Sources.ts", "rule": "fabrika(jsdocs)", "code": "export const Origin = Schema.TaggedUnion({" }
```

## Edge cases, listed before the code

Each one gets a test (0040). The rule follows Effect's checker case by case, except where a line
says "ours".

**Which files**

1. A `.ts` or `.tsx` file under a library's `src/` is public.
2. A folder named `internal` anywhere on the path takes the file out.
3. A test, a test-support file, a shared suite (`*Test.ts`), a fixture and a declaration file are
   out. The pattern already leaves test support out; suites are the same kind of file.
4. Apps and programs are out: 0023 asks no doc comments there.
5. A public file that the package's exports map does not name is still read. Effect reads by path
   too. A file that is not meant to be public belongs in `internal/`, or marks its exports
   `@internal`. 16 files and 62 exports are in this group today.

**Which statements**

6. `export const`, `let`, `function`, `class`, `interface` and `type` each need a block.
7. `export const a = 1, b = 2` is one statement and takes one block.
8. Overloads: only the first signature of a name needs the block.
9. `export default` and `export * from` are not read.
10. `export * as Name from` needs a block. Tags alone are enough there: `@stability`.
11. `export { a, b }`, with or without `from`: each name needs its own block, inside the braces,
    right above the name. Tags alone are enough there.
12. `declare namespace`: the namespace needs a block, and so does each export inside it.
13. A statement with no `export` is not read.
14. An enum is not read: the type check already refuses one (`erasableSyntaxOnly`).

**Which comment is the block**

15. The last `/** */` comment between the statement before and this one. A `//` comment and a
    `/* */` comment are not doc blocks.
16. A `// oxlint-disable-next-line` or `// @ts-expect-error` line between the block and the export
    is skipped.
17. Two blocks above one export: only the last one counts, so a description in the first is lost
    and reported as missing.
18. A block that holds `@internal` takes its export out. Cost: an export marked `@internal` to
    dodge the rule passes lint. A review reads for that. No public file has one today.

**The module block**

19. A file with at least one checked export needs a module block. Ours: Effect's checker checks a
    module block only when there is one, and 4 of its 432 files have none. The pattern and 0023
    name the module block as part of the shape, so we ask for it.
20. It is the first `/** */` in the file, before the first statement, with only blank lines and
    `//` lines above it.
21. When the first statement is an import, the block above it is the module block.
22. When the first statement is an export with one block above it, that block is the export's
    own, and the module block is missing. With two blocks, the first is the module's.
23. A module block needs `@stability` and takes no `@category`. Its prose is not judged.
24. A file with no checked export needs no module block.

**Inside a block** (all from Effect's grammar)

25. One description paragraph. None, or two, fires.
26. Only `**When to use**`, `**Details**` and `**Gotchas**`, once each, in that order.
    `**When to use**` starts with `Use to`, `Use when`, `Use as` or `Use with`. A Markdown `#`
    heading fires.
27. An example is `**Example** (Title)` with one `ts` fence and a title used once. `@example`
    fires.
28. Exactly one blank line between the description, each section, each example and the tags.
29. Tags on an export, in this order: `@deprecated`, `@see`, `@stability`, `@category`. An export
    needs `@stability` (`stable`, `unstable` or `experimental`) and a `@category` with a value.
    Any other tag fires: `@param`, `@returns`, and today `@since`.
30. A block on a member of an interface or class is optional. When there is one, it takes no
    `@category`, and it may hold `@default`, before `@see`.

**What a finding is**

31. One finding per export, at the export's first line, with every problem in its message. One
    per file for the module block, at line 1, or at the block when it is there and wrong. So one
    ledger entry stands for one export or one file.

**What the rule cannot see**

- Whether a description is true. That is the review's job, and the fills need it most.
- Whether a `@see {@link name}` points at a real name. Effect resolves it with the type checker.
- Whether an example compiles.
- A name exported under a new binding, as `const b = a; export { b }`: the block is asked for at
  `b`, wherever `a` was documented.

## One value traced through

`settings/RecordedStart.ts`, as it first reached review.

1. `pnpm lint` runs oxlint once over the repo. The file's path is under
   `next/packages/libfabrika/src/` and matches none of the left-out kinds, so `fabrika/jsdocs` is
   on for it.
2. `Program`: the file starts with an import and has no `/** */` above it. Finding 1, at line 1:
   the file has no module block.
3. Statement 5 is `export class RecordedStart`. No `/** */` stands between statement 4 and it.
   Finding 2, at line 6: `RecordedStart` has no doc block.
4. The runner turns each finding into a key: the file, `fabrika(jsdocs)`, and the line of code with
   its spaces collapsed.
5. `next-ledger.json` holds neither key, since the file is new. Both block. `pnpm lint` exits 1.
6. After the fix, the first `/** */` stands above the import and holds `@stability unstable`: the
   module block passes. The class has a block with one paragraph, a `**Details**` section,
   `@stability unstable` and `@category services`: `judge` returns an empty list. 0 findings.

An old miss, `settings/Sources.ts` line 10, `export const Origin`:

1. The rule reports it. Its key is in `next-ledger.json`, so it is waived and lint passes.
2. A fill adds its block. The finding is gone. A whole-repo `pnpm lint` writes the ledger back
   without the entry, and CI fails until that shorter file is committed.
3. If someone edits that line before the fill, the key no longer matches and the finding blocks.
   The change adds the block then
   ([0033](../../.decisions/0033-agents-code-follows-next-rules.md): a change that touches a
   ledgered line fixes it).

## Laws

E6 is a check on the shape of code, so it is a lint rule, not a test. The rule's own laws are
tests of the rule, on generated code through oxlint's `RuleTester`, as the other rules' tests are.

| Law | Lint, type or test | Generator | Plant |
|---|---|---|---|
| 1. A public export of a `next/` library with no doc block, or a block out of shape, fails `pnpm lint` | lint | lint | delete the block above one export of a passing file |
| 2. A public file with an export and no module block fails `pnpm lint` | lint | lint | delete one module block |
| 3. For any generated public file, the rule reports exactly the exports whose block is missing or wrong, once each, at the export's first line | test | fc.array: export pieces of every form in cases 6 to 13, each with a block that is right, missing, or wrong in one named way; 100 runs, seed 119120 | the rule skips `interface` exports |
| 4. Tags pass only in the order of case 29, with `@stability` one of three values; any tag from outside the list fires | test | fc.shuffledSubarray: the allowed tags, plus one tag from outside in some runs; 100 runs | drop the order check |
| 5. A file with a checked export fires for its module block unless one stands as cases 20 to 22 say | test | fc.record: imports or none, a module block or none, a block on the first export or none; 100 runs | read a first export's only block as the module block |
| 6. A block with `@internal` takes its export out, and tags alone pass on a re-export and on no other export | test | fc.constantFrom: each export form with each of the two block kinds; 100 runs | accept tags alone on every export |
| 7. With `since` set to `absent`, a block with `@since` fires; set to `required`, a block without it fires; nothing else changes | test | fc.record: the option's value and a right block with or without the tag; 100 runs | ignore the option |
| 8. On Effect 4.1.2's own source, with `since` set to `required`, the rule fires on the exports of `StandardSchema.ts`, on the four files with no module block, and nowhere else | test | vector: Effect's checker passes this tree at the pin, so Effect's source is the grammar's own answer sheet | make the copied grammar refuse a `**Gotchas**` section |
| 9. The real config turns the rule on for a library's public files only, and off for each kind in cases 2 to 4 | test | scenario: one real lint run over one planted file per kind, since only the real config holds the list | remove `internal/` from the off block |

As [0093](../../.decisions/0093-laws-walk-plants-run-once.md) has it for `next/`'s laws, each
plant is run once and recorded, not kept as a test. Law 8 reads the installed `effect` package, so it needs no network.
The four files in law 8 are `encoding/Ini.ts`, `encoding/Yaml.ts`, `http/HttpStatus.ts` and
`index.ts`.

## Is it a setting?

A setting here means a value in `fabrika.toml`
([0069](../../.decisions/0069-choices-are-settings.md)). None of these is one: they are the
repo's own exam, not a choice a person makes when running fabrika.

- **`since`, `absent` or `required`.** A rule option in the lint config. 0118 names the day it
  flips: the first release of libfabrika. One value changes, and one sweep adds the tag.
- **Which folders are libraries.** The config block's file list, as every rule's is.
- **Which kinds of file are left out.** The off block, each kind with its reason.
- **A module block is required.** Not an option. The pattern decides it, and an option nobody
  flips is dead config.

## Files and ownership

The lint plugin folder and the lint config are exam paths, so the tests step writes them. The fills
change comments in product files, so the build step writes them. The lead alone commits
`next-ledger.json`.

| Path | Owner | Slice | Product lines expected | What changes |
|---|---|---|---|---|
| `oxlint-plugins/effect-jsdocs.ts` | tests | 1 | 650 | new: the copied grammar, with its source, tag and license notice |
| `oxlint-plugins/jsdocs.ts` | tests | 1 | 220 | new: the rule |
| `oxlint-plugins/jsdocs.test.ts` | tests | 1 | tests | new: laws 3 to 9 |
| `oxlint-plugins/index.ts` | tests | 1 | 2 | lists the rule |
| `oxlint-plugins/ledger.ts` | tests | 1 | 2 | its head comment names the rule that joined |
| `oxlint-plugins/README.md` | tests | 1 | docs | the rule, the tools looked at, the first-day count by module |
| `.oxlintrc.json` | tests | 1 | 20 | the two blocks in The shape |
| `next-ledger.json` | lead | 1 to 9 | 4200 | slice 1: the 833 entries, written by one whole-repo lint run, after the owner's yes. Slices 2 to 9: only as `pnpm lint` pruned it |
| `.patterns/doc-comments.md` | build | 1 | docs | "What can hold it" becomes what holds it |
| `docs/direction/effect-code-guidelines.md` | build | 1 | docs | E6: the measured counts beside the guess, which stays, marked wrong |
| `next/packages/libfabrika/src/runtime/Runner.ts` `next/packages/libfabrika/src/gateway/Gateway.ts` `next/packages/libfabrika/src/cloudflare/runtime.ts` | build | 2 | 215 | doc blocks only |
| `next/packages/libfabrika/src/presence/` `next/packages/libfabrika/src/schedules/` `next/packages/libfabrika/src/gateway/` `next/packages/libfabrika/src/repositories/` `next/packages/libfabrika/src/packs/` `next/packages/libfabrika/src/jobs/` | build | 3 | 390 | doc blocks only |
| `next/packages/libfabrika/src/ledger/` `next/packages/libfabrika/src/transport/` | build | 4 | 350 | doc blocks only |
| `next/packages/libfabrika/src/access/` `next/packages/libfabrika/src/telemetry/` | build | 5 | 520 | doc blocks only |
| `next/packages/libfabrika/src/settings/` `next/packages/libfabrika/src/node/` | build | 6 | 580 | doc blocks only |
| `next/packages/libfabrika/src/processes/` | build | 7 | 410 | doc blocks only |
| `next/packages/libfabrika/src/Id.ts` `next/packages/libfabrika/src/ProcessId.ts` `next/packages/libfabrika/src/Rev.ts` `next/packages/libfabrika/src/SpanTag.ts` `next/packages/libfabrika/src/Sql.ts` `next/packages/libfabrika/src/Testing.ts` `next/packages/libfabrika/src/cloudflare/` | build | 8 | 550 | doc blocks only |
| `next/packages/libfabrika/src/runtime/` | build | 9 | 740 | doc blocks only |

No screenshots: no window changes.

## The plan-code rule waits

E6 also names a rule on comments: no plan codes (`P\d+`, `law p\d+`, `flag \d+`). It does not
ride along in slice 1. It is the last slice of this ticket, after the fills, with a short plan of
its own.

Measured on the same commit, with the same parser, comments only:

- 123 comment lines in 65 product files of `next/` hold a plan code; 112 are in libfabrika.
  E6 guessed about 28. The pattern counted 89 lines in 52 files on an earlier commit.
- All 123 were read by their matched word: every one is a plan row, a tier, a law number or a
  flag. 0 false alarms in product files.
- 309 more lines are in 159 test files. One of those is a false alarm: `P1363`, the name of a
  signature format. So the pattern has a known wrong class: any name made of `P` and digits.
- On Effect's own source the pattern fires 0 times.

Why it waits:

- **The fills remove most of it.** 67 of the 123 lines sit in the first six lines of a file, in
  the `//` header that the module block replaces. Counted after the fills, its ledger is small.
- **It is a different law** with its own scope call. Tests name plan rows on purpose, in titles
  and comments. The pattern covers a library's product files only; the rule's plan says so and
  counts again.
- **No shipped rule fits, so it is a second rule of ours.** oxlint's
  [`no-warning-comments`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-warning-comments)
  takes fixed words, not a pattern. Our own `no-stage-word` already reads comments, and is the
  code to start from.
- **Bundled, it would hold the doc rule back** until its own false alarms and scope are settled.

How sure: 80%. What it costs: until it lands, a new comment can still cite a plan row.

## What this records

Nothing at run time: a lint rule keeps no data. Three facts are written down the day they exist.

- **Which lines were copied, and from which tag.** In the head of `oxlint-plugins/effect-jsdocs.ts`.
  Without it, a later Effect bump cannot diff the grammar, and nobody could tell our edits from
  Effect's.
- **The first-day count,** by module and by kind, in the lint notes, as each rule that joined with
  findings has.
- **The plants' results,** in the tests step's field row (0093).

`@since` is not recorded. 0118 accepted that loss: the first release stamps one version on
everything that exists then.

## Where this differs from settled notes

- **0120's fix order** has the docs sweep fifth, and turns its check on when the sweep lands. This
  plan turns the check on first, with the old findings in the ledger, so new code is held now. The
  fills still come in 0120's order: after the Alchemy port, and never beside the splits. Question 1
  covers this.
- **0120's cost for E6** was about 240 exports and 2,000 lines. Measured: 472 exports with no
  block, 242 with a block in the wrong shape, 119 module blocks, about 4,500 lines. The note keeps
  its guess, marked wrong, beside the count.
- **The pattern's lean** was a small rule for tags and Effect's checker by hand for the sections.
  The sections need no types either, so the one rule holds both.
- **0023 counted 92 places** with Effect's checker on 2026-11-09. That run was not repeated here.
  The tree has grown since, and the two counts do not use the same unit.

## Size

Sized in lines and pull requests. 70% sure of the line counts: a fill's size depends on how much
each description needs, and only the counts of exports are measured.

1. **The rule, its laws, the config, the ledger entries and the notes.** About 890 lines of
   tooling, 650 of them copied, plus tests and about 4,200 lines of generated ledger. It touches
   no product file. It waits on the owner's yes to question 1.
2. **Fill: the three long files,** `Runner.ts`, `Gateway.ts` and `cloudflare/runtime.ts`. 38
   entries, about 215 lines. First, because their splits move exports to new files and a ledger
   entry names its file (ticket 768): a moved export with its block passes anywhere.
3. **Fill: the small modules,** presence, schedules, gateway, repositories, packs, jobs. 72
   entries, about 390 lines.
4. **Fill: ledger and transport.** 66 entries, about 350 lines.
5. **Fill: access and telemetry.** 97 entries, about 520 lines.
6. **Fill: settings and node.** 111 entries, about 580 lines.
7. **Fill: processes.** 77 entries, about 410 lines.
8. **Fill: the top files and the rest of cloudflare.** 102 entries, about 550 lines.
9. **Fill: the rest of runtime.** 140 entries, about 740 lines.
10. **The plan-code rule,** with its own short plan. About 150 lines.

- **The barrels are not filled.** `index.ts`, `coordination/index.ts` and `cloudflare/index.ts`
  hold 130 entries. 0023 says a library's barrel becomes `export * as Name from`, each with a
  tag-only block. That change removes these entries; writing 124 blocks first would be thrown
  away. They stay in the ledger until then.
- **Each fill keeps its steps.** No new law is needed: the rule is the law, and the ledger's diff
  shows what the fill fixed. The build writes blocks only. The lead checks that each changed file
  parses to the same tree with comments left out, as the blank-line sweep was checked. The review
  reads each description against the code, which no rule can do.
- **Order.** Slice 1 can land now. Slices 2 to 9 follow 0120's order. A split that starts before
  slice 2 lands must add the blocks for the exports it moves.

The budget below is for slice 1: tests, build and review, plus one send-back each to tests and to
review. Priced from the list-price medians in `field/runs.jsonl` since 2026-11-09 (tests $1.14,
build $1.24, review $1.15) and from ticket 477, the last rule of this size, whose tests step cost
$3.84.

Estimate: 5 steps, $10

## What this cannot tell us

- **How the copy behaves once formatted for this repo.** The prototype ran Effect's lines as they
  are. Law 8 is what proves the formatted copy still agrees.
- **The count on the day it lands.** 833 is for `14f96d9a3`. Open pull requests add exports.
- **Whether any of the 833 is a false alarm outside the 30 read.** The tree known to be right gave
  0 in 9,536, but our files have forms Effect's do not.
- **Whether the rule is fast inside oxlint.** The prototype judged Effect's 432 files in 1.2
  seconds as a script. The rule itself was not run in oxlint.
- **How TypeDoc and API Extractor behave here.** Neither was run.
- **What the fills cost in review.** A wrong description passes lint. E6's own example is a stale
  doc at `Runner.ts:1737`.
- **When the barrel change lands.** No ticket for it was found in the tracker on 2026-11-13.
- **Whether one block serves a schema and its type in an editor.** Question 2 leans on TypeScript
  showing a value's doc for its same-name type. That was not tried.

## Open questions

1. May `next-ledger.json` take the rule's first-day findings, 833 today, so the rule blocks every new export now, ahead of step 5 of 0120's fix order? Lean: yes, 90%. It is the same deal as the four rules that joined on 2026-11-11, and it is the only way new code is held from day one. A no means the rule turns on module by module as each fill lands, and a new export in an unfilled module is not held until then.
2. May a type that directly follows its same-name schema share the schema's block, as `export const Sent = ...` then `export type Sent = typeof Sent.Type;`? Lean: yes, 70%. Effect's checker asks for a block on both, and Effect writes both. Ours would differ, with the reason at the rule: the pair is one declaration to a reader, as the blank-line rule already treats it (0021), and a second block repeats the first. It removes 65 entries today and one block from every schema written later. Slice 1 is built Effect's way; a yes adds one edge case and lint prunes the 65.

## Findings

```json
{"_tag":"finding","id":"2026-11-13-lint-ledgers-can-grow-unseen","date":"2026-11-13","by":"plan","model":"claude-fable-5-2","rule":"missing_test","location":{"path":"oxlint-plugins/ledger.ts","line":4},"says":"Nothing checks that a pull request adds no entry to next-ledger.json or agents-ledger.json. The comment at this line says only the owner adds one, but neither file is on the exam list, so a build commit may change them.","proof":"step-commit's exam.py, given the exam list and the four ledger file names, printed the dead-export ledger and the compiler ledger and did not print next-ledger.json or agents-ledger.json. A search of the lead scripts for the two names found no check. CI's check job only runs git diff --exit-code on the two files after lint, which catches a missing prune, not an added entry.","cost":"A builder can waive its own lint finding by adding a ledger entry, and only a careful read of the diff would see it.","head":"14f96d9a3e38e09f468b2ecd4357554a8c213904","ticket":"kamp-us/tea-fabrika#900","pr":null}
```
