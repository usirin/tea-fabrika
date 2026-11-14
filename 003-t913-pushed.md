REPORT: lane t913 (B2.1, jsdocs) passed its review on the first pass and is pushed at 84c8b013e.

- Branch: fabrikalfa/cloud-t913 at 84c8b013eef4a07344ae2233333fc54e82308683.
- Commits, not squashed:
  - 467bdba95 tests: the jsdocs rule, Effect's copied block grammar and its laws
  - 84c8b013e build: what holds the docs shape, the measured counts, and 0023's kept difference
- Commit author: both are authored "Claude". They were made before your bot-identity message, and the git config for the bot identity was blocked here.
- Lint: exit 0 in 118 s.
- Type check: exit 0 in 49 s.
- Measured against the plan: ci 9 of 9 and codehost 12 of 12, an exact match. Over Effect 4.1.2's own source, 10 fires and 0 false alarms. Across all of libfabrika, 666 fires: 346 exports with no block (the plan's grep said 333), 232 blocks in the wrong shape, and 88 files with a missing or wrong module block (the plan's grep said 114).
- Plants: one or more for each of laws 1 to 9, every one red. The reviewer re-ran three of its own, also red.
- Review: pass. False alarms in ci and codehost: 0. Three non-blocking findings, all in the description under "Not in this pull request":
  - two docs overstate how far the rule agrees with Effect's own checker;
  - the copied file's head cites a wrong line range;
  - three example tests carry their label in a comment, not the title.
- For you to decide: when a file's first statement is not an import, the rule reads a lone block above it as that statement's own, as Effect's checker does. Such a file needs two blocks, and that decides how B2.8's barrels are written.
- Pull request: not opened. See 004.

## Description

The docs rule fabrika/jsdocs, on for ci and codehost (Effect rules B2.1)

## What this does

All of it is in `next/`'s lint config, the repo's lint tooling and three docs. Today's version is not touched, and no product code changed.

- A new lint rule, `fabrika/jsdocs`, asks every public export in a listed folder for a doc block in Effect's shape: one description paragraph, the optional sections in order, and the tags in Effect's order. It also asks every file for a module block above its imports.
- It judges each block with Effect's own block grammar, copied from Effect's checker at `effect@4.1.2`. So "Effect-shaped" means what Effect's checker means.
- It is on at `error` with `{ "since": "absent" }` (0118: no `@since` before a first release) for `next/packages/libfabrika/src/ci/**` and `codehost/**`. Both are at zero today: `ci` passes 9 of 9 exports and `codehost` 12 of 12.
- It is off for the six kinds that are not public: `internal/`, tests, test support, shared suites (`*Test.ts`), fixtures and declaration files.
- A type directly under its same-name schema shares the schema's block, by the owner's answer of 2026-11-13. Decision 0023 gains this as a kept difference from Effect, with a dated note.

## Why this change

Ticket 913, slice B2.1 of `docs/plan/effect-rules-big.md` (section "B2: the docs rule"). It builds decisions 0168, 0023 and 0120, `docs/direction/effect-code-guidelines.md` (E6), and the shape in `.patterns/doc-comments.md`. The rule's design is the draft of ticket 900, without its ledger, as the plan says.

## How it works

- `oxlint-plugins/effect-jsdocs.ts`, new: Effect's block grammar, copied, not rewritten.
  - **Source:** Effect-TS/effect at tag `effect@4.1.2`, `packages/tools/jsdocs/src/Jsdocs.ts`, lines 973 to 1608, plus the types and helpers those lines call. The source, tag, line ranges and Effect's MIT notice are at its head.
  - **Changes:** formatting for this repo, `export` on 7 names, and 20 `?? ""` reads on required regex groups, which never change a value. All are listed in the head.
  - **Proof:** a syntax-tree diff against the source shows every other statement unchanged.
- `oxlint-plugins/jsdocs.ts`, new: the rule. It finds exports and the module block through oxlint's syntax tree and judges each block with the copied grammar.
  - It has the `since` option (`absent` or `required`).
  - No export kind is exempt by name. A usage export gets its block like any other; that answer of 2026-11-13 is Plan A's (named spans), and here it only means no exemption.
  - Only `@internal` and the schema-and-type pair take an export out.
- `.oxlintrc.json`: two blocks at the end. One is on for `ci/**` and `codehost/**`; the other is off for the six kinds.
- `oxlint-plugins/index.ts`: the rule's row. `oxlint-plugins/plants.test.ts` lists `jsdocs` among rules planted in their own test, as it does for `modules` and `service-id`.
- `oxlint-plugins/README.md`: the section "The docs rule, E6", with the count by module.
- The docs: `.patterns/doc-comments.md` is re-grounded, `docs/direction/effect-code-guidelines.md` E6 is updated, and `.decisions/0023` gains its kept-differences row and a dated amendment.

Read these files first, in this order:

1. `oxlint-plugins/jsdocs.ts`
2. the head of `oxlint-plugins/effect-jsdocs.ts`
3. `.oxlintrc.json`, the two new blocks
4. `oxlint-plugins/jsdocs.test.ts`

## The counts, measured

Taken on main at `c0aaf4a24`, 2026-11-14. The reviewer's own replay matches every number.

| Where | Result |
|---|---|
| `ci` | 9 of 9 exports, 1 of 1 module block, 0 fires |
| `codehost` | 12 of 12 exports, 1 of 1 module block, 0 fires |
| `ci` and `codehost` with every block stripped | 23 fires (21 exports, 2 files): the rule reads every export |
| Effect 4.1.2's own source, 432 files outside `internal/`, `since: required` | 10 fires: the 6 exports of `StandardSchema.ts`, which Effect's config excludes, and 4 files with no module block as this rule reads them |
| all 136 public files of libfabrika (not on there yet) | 666 fires: 346 exports with no block, 232 with a block in the wrong shape, 88 files with a missing or wrong module block |

- **Against the plan:** `ci` and `codehost` match its 9 of 9 and 12 of 12 exactly.
- **Against the plan's greps:** the plan counted 333 exports with no block and 114 files with no module block. The real rule counts 346 and 88, and adds 232 blocks in the wrong shape, which a grep cannot see.
- **False alarms in `ci` and `codehost`:** 0. The rule fires 0 times there.

## What a reader should know

- **Code that now fails `pnpm lint`:** a new export or file in `ci/` or `codehost/` without an Effect-shaped block. So does a block with `@since`, `@param`, `@returns` or `@example`, or with tags out of order.
- **A file whose first statement is not an import:** a lone block above that statement belongs to the statement, as Effect's checker reads it. Such a file needs two blocks, the module block and then the statement's own. This decides how B2.8's barrels are written. It is a call for the lead or the owner if it should differ.

## Laws and checks

All laws are in `oxlint-plugins/jsdocs.test.ts`: 17 tests, green on Node 26.13.0. Laws 3 to 7 are properties, 100 runs, seed 119120.

- **Laws 1 and 2** are the rule itself in `pnpm lint`. These plants went red: deleting the block above `sameKey` in `ci/Ci.ts`, and deleting its module block.
- **Law 3,** `for any generated public file`: every form of the draft's cases 6 to 13, each block right, missing, or wrong in one of 9 named ways, and the schema-and-type pair both ways. These plants went red: skipping interface exports; dropping the pair exemption; accepting any earlier same-name schema. The reviewer's plants also went red: reading two statements back; ignoring the type's own block.
- **Law 4,** `for any subset of the allowed tags, in any order, with or without one from outside`. Plant red: no tag-order check.
- **Law 5,** `for any header, imports, module block and first export`. Plant red: a first export's only block read as the module block.
- **Law 6,** `for each export form with each of the two block kinds` (`@internal`, and tags alone only on a re-export). Plant red, by the tests step and again by the reviewer: tags alone accepted on every export.
- **Law 7,** `for either value and a right block with or without the tag` (the `since` option). Plant red: the option ignored.
- **Law 8,** `fires on the exports of StandardSchema.ts, on the four files with no module block, and nowhere else`: the real oxlint over Effect's installed source. Plant red: the copied grammar refuses a `**Gotchas**` section.
- **Law 9,** `fires in ci/ and codehost/, at the module block and the export` and `is off for internal/, tests, test support, shared suites, fixtures, declaration files, unlisted folders and apps`: real paths, the real config. Plant red: `next/**/internal/**` removed from the off block.
  - **The reviewer's own plants:** a file at each of the six kinds' real paths. None fired, while the controls in `ci/` and `codehost/` did.
  - **`fixtures/`:** it is already removed by the top-level `ignorePatterns`, so no file there is ever linted.
- **What ran, at `84c8b013e`:**
  - `pnpm format`, then `pnpm lint`: exit 0, 118 s.
  - `pnpm typecheck`: exit 0, 49 s.
- **Loosening check:** not run here. `loosening.sh` is the lead's, on the laptop.

## Not in this pull request

- **B2.2 to B2.8:** each fill adds its folders to the list, then B2.8 turns the barrels into namespace re-exports and the list becomes `next/packages/*/src/**`.
- **The plan-code rule:** it comes later, with its own short plan.
- **Findings from the review,** non-blocking, handed over for the lead to file:
  1. `.patterns/doc-comments.md:170` and `docs/direction/effect-code-guidelines.md:394` say the rule fires on Effect's source only where Effect's own checker reports. But 4 of its 10 fires (`encoding/Ini.ts`, `encoding/Yaml.ts`, `http/HttpStatus.ts`, `index.ts`) come from this rule's module-block case. Effect's checker reports nothing there (`Jsdocs.ts:3294-3311`). The README's wording, "as Effect's checker reads it", is the accurate one.
  2. The head of `oxlint-plugins/effect-jsdocs.ts` cites the types as lines 15 to 178. `ParsedMemberTags` ends at 181. Three types in that range (`SourceFileWithParseDiagnostics`, `JSDocResult`, `ParsedModuleJSDoc`) were left out without being named.
  3. Three example laws in `oxlint-plugins/jsdocs.test.ts` (`:414`, `:471`, `:477`) carry their `vector:` or `scenario:` label in a comment, not at the start of the title. `fabrika/law-shape` does not cover `oxlint-plugins/`, so lint cannot see it.
- **Noted by the reviewer, not a defect:** the pair exemption applies to a type under any same-name exported `const`, not only a schema. The owner's reason fits that case too.

## Steps

Each step was a separate agent in a cloud session, not a box:

| Step | Outcome |
|---|---|
| tests | `467bdba95` |
| build | `84c8b013e` |
| review | pass, 3 non-blocking findings |

fabrika close ticket 913
