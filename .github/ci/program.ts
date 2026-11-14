// Today's CI for both versions: whether a changed file is the same program on both sides, so a
// comment-only change under next/ runs only the reader tests (the plan for CI paths, slice 2).
// changes.mjs imports this file only after the parser's install, and a failed import runs every
// next/ test, so nothing here may be needed by its first pass.
import { parseSync } from "oxc-parser";

/** How CI runs git: the arguments, then the exit status and what it printed. */
export type Runner = (args: string[]) => { status: number | null; stdout: string };

type Comment = { readonly type: string; readonly value: string };

/**
 * Comment text a tool reads: the checker, the bundlers, the test runner, coverage, lint and
 * format. A plain sentence that matches only costs a full run; a tool comment that slips past
 * could change what a test sees, so the list errs toward refusing.
 */
const tools: readonly RegExp[] = [
  // An `@` word with a dash or underscore: `@ts-expect-error`, `@vitest-environment`, `@__PURE__`.
  /@[\w$]*[-_]/,
  /#__/,
  // esbuild's and rolldown's legal comments, `//!` and `/*!`.
  /^\s*!/,
  /@jsx/i,
  /@(?:license|preserve|internal|format|noformat|prettier|flow)\b/i,
  /<reference|<amd-/,
  /source(?:Mapping)?URL/i,
  /\b(?:v8|c8|istanbul)\s+ignore\b/i,
  /\w-ignore\b/i,
  /webpack/i,
  /\b(?:oxlint|eslint|oxfmt|prettier|biome|tslint|jshint|jslint|stylelint|dprint)\b/i,
];

/** ESLint's block comments that declare names, which oxlint reads too. */
const declares = /^[\s*]*(?:global|globals|exported)\b/;

const tool = (comment: Comment) =>
  tools.some((pattern) => pattern.test(comment.value)) ||
  // `/// <reference ... />` and its kin: TypeScript reads a triple-slash line as a directive.
  (comment.type === "Line" && comment.value.startsWith("/")) ||
  (comment.type === "Block" && declares.test(comment.value));

/** The tree as text with every position dropped. `raw` stays, so `16` and `0x10` differ. */
const shape = (program: unknown) =>
  JSON.stringify(program, (key, value: unknown) =>
    key === "start" || key === "end" || key === "range" || key === "loc"
      ? undefined
      : typeof value === "bigint"
        ? String(value)
        : value,
  );

/** The comments of `from` that `to` lacks, each counted once per copy. */
const unmatched = (from: readonly Comment[], to: readonly Comment[]) => {
  const left = new Map<string, number>();

  for (const comment of to) {
    const key = `${comment.type}:${comment.value}`;
    left.set(key, (left.get(key) ?? 0) + 1);
  }

  return from.filter((comment) => {
    const key = `${comment.type}:${comment.value}`;
    const count = left.get(key) ?? 0;
    left.set(key, count - 1);
    return count <= 0;
  });
};

/**
 * Why `before` and `after` are not the same program, or `undefined` when they are. Any doubt is
 * a reason: a parse error, a parser that throws, a tree that differs, or a tool comment that was
 * added, removed or changed.
 */
const refusal = (name: string, before: string, after: string, parse: typeof parseSync): string | undefined => {
  const options = { lang: name.endsWith(".tsx") ? "tsx" : "ts", sourceType: "module" } as const;
  let old;
  let fresh;

  try {
    old = parse(name, before, options);
    fresh = parse(name, after, options);
  } catch (error) {
    return `the parser threw: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (old.errors.length > 0 || fresh.errors.length > 0) {
    return `a parse error on the ${old.errors.length > 0 ? "old" : "new"} side`;
  }

  if (shape(old.program) !== shape(fresh.program)) {
    return "the code differs, not only its comments";
  }

  const changed = [...unmatched(old.comments, fresh.comments), ...unmatched(fresh.comments, old.comments)];
  const found = changed.find(tool);
  return found === undefined ? undefined : `a tool comment changed: ${JSON.stringify(found.value.trim())}`;
};

/**
 * True only when both sides parse with no error, the two trees match once positions are dropped,
 * and no comment that was added, removed or changed looks like a tool comment. `name` gives the
 * language (`.ts` or `.tsx`). `parse` is the parser, oxc-parser's own unless a test hands one in; a
 * parser that throws is no proof.
 */
export const sameProgram = (name: string, before: string, after: string, parse = parseSync): boolean =>
  refusal(name, before, after, parse) === undefined;

/** Why one path is not proven, or `undefined` when it is. */
const judge = (base: string, head: string, path: string, run: Runner): string | undefined => {
  if (!/\.tsx?$/.test(path)) {
    return "not a .ts or .tsx file";
  }

  const before = run(["show", `${base}:${path}`]);
  const after = run(["show", `${head}:${path}`]);

  if (before.status !== 0 || after.status !== 0) {
    return "added, deleted or unreadable on one side";
  }

  return refusal(path, before.stdout, after.stdout, parseSync);
};

/**
 * The paths of `paths`, in their order, that are the same program at `base` and at `head`. Each
 * side is read with `git show <commit>:<path>` through `run`; a side that cannot be read is
 * missing, so a file added or deleted is left out, as is one that is not `.ts` or `.tsx`. `note`
 * hears each path's verdict, so the run can say why it went light or did not.
 */
export const samePaths = (
  base: string,
  head: string,
  paths: readonly string[],
  run: Runner,
  note: (path: string, verdict: string) => void = () => {},
): string[] =>
  paths.filter((path) => {
    const verdict = judge(base, head, path, run);
    note(path, verdict ?? "same program");
    return verdict === undefined;
  });
