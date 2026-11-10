// The React Compiler's one compile step, and the check on what it skipped (docs/direction/react-compiler.md,
// C1 and C5). Tier 1's exam, item 13 (docs/plan/tier-1-detail.md, "The exam PR").
//
// `compile` is what the build calls on every `.tsx` file (`build.ts`, Tier 1's P12 and P16). `check`
// is what `pnpm lint:compiler` runs over `next/**/*.tsx`, with no bundle, through the app's exam
// command (`next/apps/fabrika/src/exam/compiler.ts`). Both fail on the same findings:
//
// - a function the Compiler skipped, with its reason and line;
// - a purity finding, such as a clock read in render or in a handler a view passes down;
// - a function with `"use no memo"` and no row in `compiler-ledger.json`;
// - a row in `compiler-ledger.json` whose function no longer carries `"use no memo"` (a stale row);
// - a component that draws JSX and did not compile, with no word from the Compiler. That is what a
//   later port that prints its cache another way looks like, so it breaks loudly.
//
// The one way out of a finding is `"use no memo"` in the function plus a row the owner adds, in a
// change of its own. The ledger starts empty and only shrinks. There is no setting to loosen it.
import { Schema } from "effect";
import { parseSync } from "oxc-parser";
import { type OxcError, transformSync } from "oxc-transform-react";

/** A row of `compiler-ledger.json`: a function left out of the Compiler on purpose, and why. */
export const Row = Schema.Struct({ file: Schema.String, fn: Schema.String, why: Schema.String });
export type Row = typeof Row.Type;

/** One thing the check refuses, at a function in a file. */
export interface Finding {
  readonly file: string;
  readonly fn: string;
  readonly line: number;
  readonly why: string;
}

/** The one compile step: oxc's Rust port of the React Compiler, with its findings reported. */
export const compile = (file: string, code: string) =>
  transformSync(file, code, {
    jsx: { runtime: "automatic" },
    reactCompiler: {
      panicThreshold: "none",
      reportDiagnostics: true,
      environment: { validateNoImpureFunctionsInRender: true },
    },
  });

interface Fn {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly memoOff: boolean;
  readonly jsx: boolean;
  readonly top: boolean;
  readonly cache: boolean;
}

// oxc-parser's tree, read loosely: the check only walks it.
type Tree = any;

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const lineAt = (text: string, at: number) => text.slice(0, at).split("\n").length;

/** Whether a function body opens with `"use no memo"`, among its other directives. */
const saysNoMemo = (body: Tree): boolean => {
  if (body?.type !== "BlockStatement") {
    return false;
  }

  for (const s of body.body) {
    if (s.type !== "ExpressionStatement" || typeof s.directive !== "string") {
      return false;
    }

    if (s.directive === "use no memo" || s.directive === "use no forget") {
      return true;
    }
  }

  return false;
};

/** Whether a function body opens with `const $ = _c(n)`: the Compiler's cache, so it compiled. */
const opensWithCache = (body: Tree): boolean => {
  const first = body?.type === "BlockStatement" ? body.body[0] : null;
  const init = first?.type === "VariableDeclaration" ? first.declarations[0]?.init : null;
  return init?.type === "CallExpression" && init.callee?.name === "_c";
};

/**
 * Each function in a file, named by its own name or the variable or key it is bound to, through a
 * wrapping call such as `memo(...)`.
 */
const functions = (file: string, text: string): readonly Fn[] => {
  const found: Fn[] = [];
  const walk = (node: Tree, bound: string | null, depth: number, inJsx: { on: boolean }) => {
    if (node === null || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const n of node) {
        walk(n, bound, depth, inJsx);
      }

      return;
    }

    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      inJsx.on = true;
    }

    if (FUNCTIONS.has(node.type)) {
      const own = { on: false };

      for (const [key, child] of Object.entries(node)) {
        if (key !== "type") {
          walk(child, null, depth + 1, own);
        }
      }

      found.push({
        name: node.id?.name ?? bound ?? "(anonymous)",
        start: node.start,
        end: node.end,
        line: lineAt(text, node.start),
        memoOff: saysNoMemo(node.body),
        jsx: own.on,
        top: depth === 0,
        cache: opensWithCache(node.body),
      });
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === "type" || key === "start" || key === "end") {
        continue;
      }

      let name: string | null = null;

      if (node.type === "VariableDeclarator" && key === "init") {
        name = node.id?.name ?? null;
      }

      if (node.type === "Property" && key === "value") {
        name = node.key?.name ?? null;
      }

      if (node.type === "CallExpression" && key === "arguments") {
        name = bound;
      }

      walk(child, name, depth, inJsx);
    }
  };
  walk(parseSync(file, text, {}).program, null, 0, { on: false });
  return found;
};

/** oxc-transform-react 0.157.0 reports UTF-8 byte offsets; JavaScript strings count UTF-16 units. */
const utf16 = (text: string, byte: number) => Buffer.from(text).subarray(0, byte).toString("utf8").length;

/** The outermost function holding an offset: the Compiler compiles top-level components and hooks. */
const outermost = (fns: readonly Fn[], at: number) =>
  fns.filter((f) => f.start <= at && at < f.end).sort((a, b) => a.start - b.start)[0] ?? null;

/** What the check refuses in one file, given the ledger's rows for it. */
const checkFile = (file: string, text: string, rows: readonly Row[]): readonly Finding[] => {
  const findings: Finding[] = [];
  const out = compile(file, text);
  const source = functions(file, text);
  const compiled = new Set(
    functions(file.replace(/\.tsx$/, ".js"), out.code)
      .filter((f) => f.cache)
      .map((f) => f.name),
  );
  const named = (fn: string) => rows.some((r) => r.fn === fn);
  const said = new Set<string>();
  const diagnose = (e: OxcError) => {
    const label = e.labels[0];
    const at = label === undefined ? 0 : utf16(text, label.start);
    const fn = outermost(source, at);
    const name = fn?.name ?? "(module)";
    said.add(name);

    if (fn !== null && fn.memoOff && named(name)) {
      return;
    }

    findings.push({ file, fn: name, line: lineAt(text, at), why: e.message });
  };

  for (const e of out.errors) {
    diagnose(e);
  }

  for (const fn of source) {
    if (fn.memoOff && !named(fn.name)) {
      findings.push({
        file,
        fn: fn.name,
        line: fn.line,
        why: '"use no memo" with no row in compiler-ledger.json. A row is the owner\'s call, in a change of its own.',
      });
    }

    if (fn.top && fn.jsx && /^[A-Z]/.test(fn.name) && !fn.memoOff && !compiled.has(fn.name)) {
      if (!said.has(fn.name)) {
        findings.push({
          file,
          fn: fn.name,
          line: fn.line,
          why: "draws JSX and did not compile, and the Compiler said nothing. Has its output changed shape?",
        });
      }
    }
  }

  for (const row of rows) {
    if (!source.some((fn) => fn.name === row.fn && fn.memoOff)) {
      findings.push({
        file,
        fn: row.fn,
        line: 0,
        why: 'a stale row in compiler-ledger.json: this function carries no "use no memo" now. Drop the row.',
      });
    }
  }

  return findings;
};

/**
 * What the check refuses across files, each given as its path from the top of the repo and its
 * text. A ledger row whose file is not among them is stale too.
 */
export const check = (files: ReadonlyMap<string, string>, ledger: readonly Row[]): readonly Finding[] => [
  ...[...files].flatMap(([file, text]) =>
    checkFile(
      file,
      text,
      ledger.filter((r) => r.file === file),
    ),
  ),
  ...ledger
    .filter((r) => !files.has(r.file))
    .map((r) => ({
      file: r.file,
      fn: r.fn,
      line: 0,
      why: "a stale row in compiler-ledger.json: its file is gone. Drop the row.",
    })),
];
