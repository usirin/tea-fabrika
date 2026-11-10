// Every machine has laws (docs/direction/every-machine-has-laws.md), in `next/`: a file that makes a
// machine with `defineMachine(` has a laws file beside it that uses tea's `@demlik/tea/pbt`. The
// laws file is `<name>.laws.test.ts`, or `<name>.<more>.laws.test.ts`, since a later law goes in a
// new file rather than a bigger old one. Machines made inline count too, so the scan reads text,
// not a named `const`. Item 7 of the detail's exam; written by the exam (Tier 1, P1). It reads all
// of `next/`, not `next/src`, which goes away.
//
// Every machine also passes the sync test (docs/direction/saved-state.md, S2; detail p88; Tier 1,
// P35): one of its laws files calls `syncTest(`, or says `// sync test left out: <why>` with a reason,
// since a machine leaves it "only by name, with a reason". The scan reads text, so where `syncTest`
// is imported from is not checked; P11 gives it its home. The two checks answer as two lists, so a
// missing laws file and a missing sync test read apart.
//
// This file stands alone, with its own small reader, since a shared helper file would export names
// only tests call, which `pnpm lint:dead` refuses.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const NEXT = resolve(import.meta.dirname, "../../../..");
const PBT = "@demlik/tea/pbt";

/** Every `.ts` and `.tsx` file below `dir`, leaving out `node_modules`, `dist` and dot folders. */
const codeFiles = (dir: string): ReadonlyArray<string> =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);

        if (!entry.isDirectory()) {
          return /\.tsx?$/.test(entry.name) ? [path] : [];
        }

        const skip = ["node_modules", "dist"].includes(entry.name) || entry.name.startsWith(".");
        return skip ? [] : codeFiles(path);
      });

/** The names a file imports from, read from lines that start with `import` and name a `from`. */
const importsInFile = (file: string): ReadonlyArray<string> =>
  [...readFileSync(file, "utf8").matchAll(/^[ \t]*import\b[^;]*?\bfrom\s*["']([^"']+)["']/gm)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );

/** Each machine under `next`, with the laws files beside it: `<name>.laws.test.ts` and the like. */
const machines = (next: string): ReadonlyArray<{ readonly path: string; readonly laws: ReadonlyArray<string> }> => {
  const files = codeFiles(next);
  return files
    .filter((file) => !/\.test\.tsx?$/.test(file) && readFileSync(file, "utf8").includes("defineMachine("))
    .map((machine) => {
      const stem = basename(machine).replace(/\.tsx?$/, "");
      const laws = files.filter(
        (file) =>
          dirname(file) === dirname(machine) &&
          basename(file).startsWith(`${stem}.`) &&
          basename(file).endsWith(".laws.test.ts"),
      );
      return { path: relative(next, machine).split(sep).join("/"), laws };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
};

const hasPbt = (laws: ReadonlyArray<string>) => laws.some((file) => importsInFile(file).includes(PBT));

/** Each file under `next` that makes a machine and has no laws file beside it using tea's pbt. */
const lawless = (next: string): ReadonlyArray<string> =>
  machines(next)
    .filter((m) => !hasPbt(m.laws))
    .map((m) => m.path);

const SYNC_TEST = "syncTest(";
const LEFT_OUT = /\/\/[ \t]*sync test left out:[ \t]*\S/;

/**
 * Each machine under `next` whose laws are there but none of whose laws files runs the sync test or
 * names its reason for leaving it out. A machine with no laws is `lawless`'s, not this list's.
 */
const unsynced = (next: string): ReadonlyArray<string> =>
  machines(next)
    .filter((m) => hasPbt(m.laws))
    .filter((m) =>
      m.laws.every((file) => {
        const text = readFileSync(file, "utf8");
        return !text.includes(SYNC_TEST) && !LEFT_OUT.test(text);
      }),
    )
    .map((m) => m.path);

describe("the real next/", () => {
  it("has laws beside every machine", () => {
    expect(lawless(NEXT)).toEqual([]);
  });

  it("runs the sync test on every machine, or names why not", () => {
    expect(unsynced(NEXT)).toEqual([]);
  });
});

describe("planted machines", () => {
  const root = mkdtempSync(join(tmpdir(), "next-exam-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const planted: Readonly<Record<string, string>> = {
    "a/machine.ts": "export const m = defineMachine({init, update});",
    "a/machine.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";\nsyncTest(m, opts);',
    "b/link.ts": "export const link = defineMachine({init, update});",
    "c/view.ts": "export const view = defineMachine({init, update});",
    "c/view.laws.test.ts": 'import {it} from "vitest";',
    "d/runner.ts": "export const runner = defineMachine({init, update});",
    "d/runner.replay.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";\nsyncTest(runner, opts);',
    "e/inline.tsx": "export const parts = {a: defineMachine({init, update})};",
    "e/inline-other.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";',
    "f/helper.test.ts": "const m = defineMachine({init, update});",
    "g/plain.ts": "export const plain = 1;",
    "h/sync.ts": "export const sync = defineMachine({init, update});",
    "h/sync.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";\nsyncTest(sync, opts);',
    "i/none.ts": "export const none = defineMachine({init, update});",
    "i/none.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";',
    "j/out.ts": "export const out = defineMachine({init, update});",
    "j/out.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";\n// sync test left out: its model holds a cache',
    "k/bare.ts": "export const bare = defineMachine({init, update});",
    "k/bare.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";\n// sync test left out:',
    "l/split.ts": "export const split = defineMachine({init, update});",
    "l/split.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";',
    "l/split.sync.laws.test.ts": "syncTest(split, opts);",
  };

  for (const [path, text] of Object.entries(planted)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${text}\n`);
  }

  it("fires on a machine with no laws, laws without pbt, and an inline machine whose laws are another file's", () => {
    expect(lawless(root)).toEqual(["b/link.ts", "c/view.ts", "e/inline.tsx"]);
  });

  it("fires on laws with no sync test and no reason, or an empty reason, wherever the call stands", () => {
    expect(unsynced(root)).toEqual(["i/none.ts", "k/bare.ts"]);
  });
});
