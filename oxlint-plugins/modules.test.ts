// Ticket 477, PR 0: the lint laws of libfabrika's modules (decision 0043), each seen to fire on a
// planted file before a file moves. All of this is `next/`. Three rules carry them:
//   - `fabrika/modules`, hand-written, since no existing rule says these four: no module re-exports
//     another module's names; `src/` holds only the listed modules and top files; every export in an
//     `internal/` file is `@internal`; the shared top files hold values only.
//   - oxlint's own `eslint/no-restricted-imports`: nobody outside a module imports its `internal/`.
//   - oxlint's own `unicorn/filename-case`: a front file is PascalCase and an `internal/` file is
//     camelCase (decision 0040: an existing rule before a hand-written one).
// The planted files are linted with the repository's own `.oxlintrc.json`, at their real paths, so
// the config's lists and path globs are under test with the rule.
//
// A law about the whole file (a folder nobody listed, a file name) may report on any line, so those
// cases ask only whether the rule fired. A law about one statement names its line. Line 1 of every
// planted file is a comment, so no statement shares a line with a whole-file report.
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const SRC = "next/packages/libfabrika/src";

const MODULES = ["telemetry", "ledger", "transport", "processes", "presence", "access", "runtime", "gateway"] as const;

/** Every module with every other module: 56 pairs, so no pair is left to a pattern nobody tried. */
const PAIRS = MODULES.flatMap((module) =>
  MODULES.filter((other) => other !== module).map((other) => [module, other] as const),
);

const modules = "fabrika(modules)";
const restricted = "eslint(no-restricted-imports)";
const fileCase = "unicorn(filename-case)";

const file = (...lines: ReadonlyArray<string>): string => ["// planted", ...lines, ""].join("\n");
const pascal = (name: string): string => `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
const own = "export const own = 1;";

describe("fabrika/modules: no module file re-exports another module's names", async () => {
  const pair = (module: string, other: string) => `${SRC}/${module}/From${pascal(other)}.ts`;
  const files = {
    ...Object.fromEntries(
      PAIRS.map(([module, other]) => [
        pair(module, other),
        file(
          `export {a} from "../${other}/Front.ts";`, // 2
          `export type {B} from "../${other}/Front.ts";`, // 3
          `export * from "../${other}/Front.ts";`, // 4
          `export * as other from "../${other}/Front.ts";`, // 5
          `import {e} from "../${other}/Front.ts";`, // 6: an import is the layers' business
          "export {e};", // 7: the same name, sent on in two steps
          'export {f} from "./Own.ts";', // 8: the module's own name
          `export const g = 1;`, // 9
        ),
      ]),
    ),
    // The plan's plant, with its real names.
    [`${SRC}/processes/Mailbox.ts`]: file('export {Rev} from "../ledger/Log.ts";'),
    // A module's `internal/` file is a module file too.
    [`${SRC}/gateway/internal/admit.ts`]: file(
      "/** @internal */",
      'export {Rev} from "../../ledger/Log.ts";', // 3
      "/** @internal */",
      'export {wait} from "./waiting.ts";', // 5
    ),
    // Not module files: the package's entry and the two platform folders put the modules together.
    [`${SRC}/index.ts`]: file('export {Ledger} from "./ledger/Ledger.ts";'),
    [`${SRC}/cloudflare/index.ts`]: file('export {cloudflareSql} from "../ledger/CloudflareSql.ts";'),
    [`${SRC}/node/index.ts`]: file('export * from "../runtime/Runner.ts";'),
    // Another package's folders are not libfabrika's modules.
    "next/packages/tuval/src/door/Door.ts": file('export {a} from "../ledger/Log.ts";'),
  };
  const linted = await plant(files);

  // Plant (the plan's): `processes/Mailbox.ts` holds `export {Rev} from "../ledger/Log.ts"`.
  it("fires on every form of re-export, for each of the 56 pairs of modules", () => {
    for (const [module, other] of PAIRS) {
      expect(linted(modules, pair(module, other)), `${module} from ${other}`).toEqual([2, 3, 4, 5, 7]);
    }

    expect(linted(modules, `${SRC}/processes/Mailbox.ts`)).toEqual([2]);
    expect(linted(modules, `${SRC}/gateway/internal/admit.ts`)).toEqual([3]);
  });

  it("takes the entry file, the platform folders and another package", () => {
    for (const path of [
      `${SRC}/index.ts`,
      `${SRC}/cloudflare/index.ts`,
      `${SRC}/node/index.ts`,
      "next/packages/tuval/src/door/Door.ts",
    ]) {
      expect(linted(modules, path), path).toEqual([]);
    }
  });
});

describe("fabrika/modules: src/ holds only the listed modules and top files", async () => {
  const refused = [
    `${SRC}/utils/x.ts`, // the plan's plant: a folder by kind
    `${SRC}/sync/Merge.ts`,
    `${SRC}/Ledger/Ledger.ts`, // a module's name in another case is another folder
    `${SRC}/LedgerError.ts`, // the plan's plant: no shared error (0043, rule 12)
    `${SRC}/Helpers.ts`,
    `${SRC}/Helpers.test.ts`,
  ];
  const taken = [
    ...MODULES.map((module) => `${SRC}/${module}/Front.ts`),
    ...MODULES.map((module) => `${SRC}/${module}/Front.test.ts`),
    `${SRC}/node/brain.ts`,
    `${SRC}/cloudflare/brain.ts`,
    `${SRC}/index.ts`,
    `${SRC}/Id.ts`,
    `${SRC}/Id.test.ts`,
    `${SRC}/Id.types.test.ts`,
    `${SRC}/Id.test-support.ts`,
    `${SRC}/Testing.ts`,
    `${SRC}/Testing.test.ts`,
    `${SRC}/ProcessId.ts`,
    `${SRC}/Sql.ts`,
    `${SRC}/Rev.ts`,
    // Outside libfabrika's `src/` the list says nothing.
    "next/packages/libfabrika/utils/x.ts",
    "next/packages/tuval/src/utils/x.ts",
    "next/apps/fabrika/src/utils/x.ts",
  ];
  const linted = await plant(Object.fromEntries([...refused, ...taken].map((path) => [path, file(own)])));

  // Plants (the plan's): add `src/utils/x.ts`; `src/LedgerError.ts` exists.
  it("fires on a file in a folder or at a top name nobody listed", () => {
    for (const path of refused) {
      expect(linted(modules, path), path).not.toEqual([]);
    }
  });

  it("takes the eight modules, the platform folders, the listed top files and their tests", () => {
    for (const path of taken) {
      expect(linted(modules, path), path).toEqual([]);
    }
  });
});

describe("fabrika/modules: every export in an internal/ file is @internal", async () => {
  const body = file(
    "/** @internal */", // 2
    "export const a = 1;", // 3
    "", // 4
    "export const b = 2;", // 5: no comment
    "", // 6
    "/**", // 7
    " * Folds the rows.", // 8
    " *", // 9
    " * @internal", // 10
    " */", // 11
    "export function c() { return 1; }", // 12
    "", // 13
    "export function d() { return 1; }", // 14: no comment
    "", // 15
    "/** Says what it is and not who may use it. */", // 16
    "export type E = number;", // 17: a comment with no tag
    "", // 18
    "/** @internal */", // 19
    "export interface F { readonly n: number }", // 20
    "", // 21
    "const g = 1;", // 22: not exported
    "", // 23
    "/** @internal */", // 24
    "export class H {}", // 25
    "", // 26
    "export class I {}", // 27: no comment
    "", // 28
    "/** @internal */", // 29
    "export const j = g;", // 30
    "", // 31
    "// @internal", // 32: a line comment is not the tag a doc tool reads
    "export const k = 3;", // 33
  );
  const files = {
    ...Object.fromEntries(MODULES.map((module) => [`${SRC}/${module}/internal/part.ts`, body])),
    // The plan's real name, and a folder below `internal/`.
    [`${SRC}/ledger/internal/ledgerStore.ts`]: body,
    [`${SRC}/runtime/internal/holder/state.ts`]: body,
    // A front file's exports are the module's public names, and a test exports nothing.
    [`${SRC}/ledger/Ledger.ts`]: body,
    [`${SRC}/ledger/internal/ledgerStore.test.ts`]: file("const a = 1;", "void a;"),
    // Another package's `internal/` is not a module's.
    "next/packages/tuval/src/desktop/internal/part.ts": body,
  };
  const linted = await plant(files);

  // Plant: an `internal/` file with one export that has no `@internal` doc comment.
  it("fires on each export with no @internal doc comment, in every module's internal/", () => {
    for (const path of [
      ...MODULES.map((module) => `${SRC}/${module}/internal/part.ts`),
      `${SRC}/ledger/internal/ledgerStore.ts`,
      `${SRC}/runtime/internal/holder/state.ts`,
    ]) {
      expect(linted(modules, path), path).toEqual([5, 14, 17, 27, 33]);
    }
  });

  it("takes a front file, a test and another package", () => {
    for (const path of [
      `${SRC}/ledger/Ledger.ts`,
      `${SRC}/ledger/internal/ledgerStore.test.ts`,
      "next/packages/tuval/src/desktop/internal/part.ts",
    ]) {
      expect(linted(modules, path), path).toEqual([]);
    }
  });
});

describe("fabrika/modules: the shared top files hold values only", async () => {
  const body = file(
    'import {Context, Schema} from "effect";', // 2
    'export const Rev = Schema.Int.pipe(Schema.brand("Rev"));', // 3
    "export type Rev = typeof Rev.Type;", // 4
    'export class RevError extends Schema.TaggedError<RevError>()("RevError", {}) {}', // 5: an error
    'export class Revs extends Context.Service<Revs, {readonly next: number}>()("libfabrika/Revs") {}', // 6: a service
    'export class Point extends Schema.Class<Point>("Point")({n: Schema.Number}) {}', // 7: a value
    "export const parse = (text: string): number => Number(text);", // 8
    "export class Fault extends Error {}", // 9: an error
    "export interface Sql { readonly run: (text: string) => void }", // 10: a shape
  );
  // The same two, reached by other spellings of the import (main's `id.ts` writes `Schema as S`).
  const spelled = file(
    'import {Schema as S} from "effect";', // 2
    'import * as Context from "effect/Context";', // 3
    'export class SqlError extends S.TaggedError<SqlError>()("SqlError", {}) {}', // 4
    'export class Sqls extends Context.Service<Sqls, {readonly n: number}>()("libfabrika/Sqls") {}', // 5
    "export const SqlValue = S.Union([S.String, S.Number, S.Null]);", // 6
  );
  const files = {
    [`${SRC}/Rev.ts`]: body,
    [`${SRC}/Sql.ts`]: spelled,
    [`${SRC}/ProcessId.ts`]: body,
    // A module's front file is where its services and errors live.
    [`${SRC}/ledger/Ledger.ts`]: body,
    // `Id.ts` is not on the list: main's `id.ts` exports `IdError` and the `Generator` service,
    // and PR 2 only changes the case of its name.
    [`${SRC}/Id.ts`]: body,
    [`${SRC}/Testing.ts`]: body,
    "next/packages/tuval/src/Rev.ts": body,
  };
  const linted = await plant(files);

  // Plant (the plan's): `src/Rev.ts` exports a `Schema.TaggedError`.
  it("fires on a service and on an error in Rev.ts, Sql.ts and ProcessId.ts", () => {
    expect(linted(modules, `${SRC}/Rev.ts`)).toEqual([5, 6, 9]);
    expect(linted(modules, `${SRC}/ProcessId.ts`)).toEqual([5, 6, 9]);
    expect(linted(modules, `${SRC}/Sql.ts`)).toEqual([4, 5]);
  });

  it("takes the same lines in a module, in Id.ts, in Testing.ts and in another package", () => {
    for (const path of [
      `${SRC}/ledger/Ledger.ts`,
      `${SRC}/Id.ts`,
      `${SRC}/Testing.ts`,
      "next/packages/tuval/src/Rev.ts",
    ]) {
      expect(linted(modules, path), path).toEqual([]);
    }
  });
});

describe("eslint/no-restricted-imports: nobody outside a module imports its internal/", async () => {
  const front = (module: string, other: string) => `${SRC}/${module}/Into${pascal(other)}.ts`;
  const inner = (module: string, other: string) => `${SRC}/${module}/internal/into${pascal(other)}.ts`;
  const files = {
    ...Object.fromEntries(
      PAIRS.flatMap(([module, other]) => [
        [
          front(module, other),
          file(
            `import {a} from "../${other}/internal/part.ts";`, // 2
            `import type {B} from "../${other}/internal/part.ts";`, // 3
            `export {c} from "../${other}/internal/part.ts";`, // 4
            `export * from "../${other}/internal/part.ts";`, // 5
            `import {e} from "./../${other}/internal/part.ts";`, // 6: the same file, spelled longer
            `import {f} from "../${other}/internal/deep/part.ts";`, // 7
            'import {g} from "./internal/part.ts";', // 8: the module's own
            `import {h} from "../${other}/Front.ts";`, // 9: a front file
            "export const all = [a, e, f, g, h];",
          ),
        ],
        [
          inner(module, other),
          file(
            `import {a} from "../../${other}/internal/part.ts";`, // 2
            `import {b} from "./../../${other}/internal/part.ts";`, // 3
            `export {c} from "../../${other}/internal/part.ts";`, // 4
            'import {d} from "./part.ts";', // 5: the module's own
            'import {e} from "../Front.ts";', // 6
            `import {f} from "../../${other}/Front.ts";`, // 7
            "/** @internal */",
            "export const all = [a, b, d, e, f];",
          ),
        ],
      ]),
    ),
    // The plan's two plants, with their real names.
    [`${SRC}/gateway/Gateway.ts`]: file(
      'import {ledgerStore} from "../ledger/internal/ledgerStore.ts";', // 2
      'import {waiting} from "./internal/waiting.ts";', // 3
      // The override repeats the base rule's Radix entry, so it still fires here.
      'import {gray} from "@radix-ui/colors";', // 4
      "export const all = [ledgerStore, waiting, gray];",
    ),
    [`${SRC}/cloudflare/runtime.ts`]: file(
      'import {supervisor} from "../runtime/internal/supervisor.ts";', // 2
      'import {Runner} from "../runtime/Runner.ts";', // 3
      "export const all = [supervisor, Runner];",
    ),
    [`${SRC}/node/brain.ts`]: file(
      'import {recovery} from "../runtime/internal/recovery.ts";', // 2
      "export const all = [recovery];",
    ),
    // The top files are outside every module.
    [`${SRC}/index.ts`]: file(
      'export {ledgerStore} from "./ledger/internal/ledgerStore.ts";', // 2
      'export {Ledger} from "./ledger/Ledger.ts";', // 3
    ),
    [`${SRC}/Testing.ts`]: file(
      'import {supervisor} from "./runtime/internal/supervisor.ts";', // 2
      'import {Runner} from "./runtime/Runner.ts";', // 3
      "export const all = [supervisor, Runner];",
    ),
    // A module's own test reads its own `internal/`.
    [`${SRC}/ledger/Ledger.test.ts`]: file(
      'import {ledgerStore} from "./internal/ledgerStore.ts";',
      "void ledgerStore;",
    ),
  };
  const linted = await plant(files);

  // Plants (the plan's): `gateway/Gateway.ts` imports `../ledger/internal/ledgerStore.ts`, and
  // `cloudflare/runtime.ts` imports `../runtime/internal/supervisor.ts`.
  it("fires on an import and on an export-from, in either spelling, for each of the 56 pairs", () => {
    for (const [module, other] of PAIRS) {
      expect(linted(restricted, front(module, other)), `${module} into ${other}`).toEqual([2, 3, 4, 5, 6, 7]);
      expect(linted(restricted, inner(module, other)), `${module} into ${other}`).toEqual([2, 3, 4]);
    }
  });

  it("fires in the platform folders and the top files, and keeps the Radix entry", () => {
    expect(linted(restricted, `${SRC}/gateway/Gateway.ts`)).toEqual([2, 4]);
    expect(linted(restricted, `${SRC}/cloudflare/runtime.ts`)).toEqual([2]);
    expect(linted(restricted, `${SRC}/node/brain.ts`)).toEqual([2]);
    expect(linted(restricted, `${SRC}/index.ts`)).toEqual([2]);
    expect(linted(restricted, `${SRC}/Testing.ts`)).toEqual([2]);
  });

  it("takes a module's own internal/ from its test", () => {
    expect(linted(restricted, `${SRC}/ledger/Ledger.test.ts`)).toEqual([]);
  });
});

describe("unicorn/filename-case: a front file is PascalCase and an internal/ file is camelCase", async () => {
  // The modules with no file on main. `transport/` joins in PR 2 and `door/` in PR 5, when their
  // lowercase files have moved, so the rule fires on nothing on main.
  const FRESH = ["telemetry", "ledger", "processes", "presence", "access", "runtime"] as const;
  const refused = [
    `${SRC}/ledger/log.ts`, // the plan's plant
    `${SRC}/ledger/internal/LedgerStore.ts`, // the plan's plant
    ...FRESH.flatMap((module) => [
      `${SRC}/${module}/kebab-case.ts`,
      `${SRC}/${module}/camelCase.ts`,
      `${SRC}/${module}/kebab-case.test.ts`,
      `${SRC}/${module}/internal/PascalCase.ts`,
      `${SRC}/${module}/internal/kebab-case.ts`,
      `${SRC}/${module}/internal/PascalCase.test.ts`,
    ]),
  ];
  const taken = [
    ...FRESH.flatMap((module) => [
      `${SRC}/${module}/PascalCase.ts`,
      `${SRC}/${module}/PascalCase.test.ts`,
      `${SRC}/${module}/internal/camelCase.ts`,
      `${SRC}/${module}/internal/camelCase.test.ts`,
    ]),
    // The move's own names (the plan's files tables), with every suffix a file carries there.
    `${SRC}/ledger/Log.ts`,
    `${SRC}/ledger/NodeSqlite.ts`,
    `${SRC}/ledger/internal/ledgerStore.ts`,
    `${SRC}/runtime/Program.types.test.ts`,
    `${SRC}/runtime/BrainLife.laws.test.ts`,
    `${SRC}/runtime/internal/supervisor.laws.test.ts`,
    `${SRC}/processes/Process.test-support.ts`,
    `${SRC}/telemetry/P12Readers.laws.test.ts`,
    `${SRC}/telemetry/internal/measurements.test.ts`,
    `${SRC}/Id.test-support.ts`,
  ];
  const linted = await plant(Object.fromEntries([...refused, ...taken].map((path) => [path, file(own)])));

  // Plants (the plan's): add `src/ledger/log.ts` and `src/ledger/internal/LedgerStore.ts`.
  it("fires on a front file not in PascalCase and an internal/ file not in camelCase", () => {
    for (const path of refused) {
      expect(linted(fileCase, path), path).not.toEqual([]);
    }
  });

  it("takes the right case, with .test, .types.test, .laws.test and .test-support suffixes", () => {
    for (const path of taken) {
      expect(linted(fileCase, path), path).toEqual([]);
    }
  });
});
