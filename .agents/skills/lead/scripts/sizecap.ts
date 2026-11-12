// sizecap.ts: a pull request's size, recorded and printed. No number caps a pull request (0099,
// which removed 0087's cap). Today's lead tooling, run on our own laptop; it is not product.
//
//   sizecap plan <plan.md>         at plan time: the plan's expected product lines and its slices
//   sizecap diff <base> <head>     at landing time: the changed product lines from the merge base of
//                                  <base> and <head> to <head>, with one warning past ADVICE_LINES
//
// Both print and never refuse: size picks who looks, never whether it lands (0099). Exit 0 when it
// ran, 2 when it could not. `plan` checks no slice against a number; it only says when a slice
// records no estimate, since 0099 keeps each slice's estimate on record.
//
// 0099 says the warning's number comes from our own merged pull requests (the lean: larger than 95
// of every 100 of them, without generated files and lockfiles). Nothing computes that yet, so
// ADVICE_LINES is 0087's starting number, which no source favors; it is advice, never a limit.
//
// A product line is an added or deleted line, as `git diff --numstat` counts them with rename
// detection, in a file under `next/`, `apps/`, `programs/` or `packages/` (AGENTS.md: product code
// is `next/` and today's app) that is none of these, which are counted apart from product lines:
//   test       a `.test.` or `.test-support.` file, anything under `fixtures/` or an `e2e/` folder,
//              an `e2e.ts` runner, and under `next/` a shared suite named `XTest.ts`, which a test
//              file runs as `SinkTest.suite(nodeSql)` (0029, 0062) (0087 leans to tests not counting)
//   docs       Markdown, and anything under `docs/`
//   lock       `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `*.lock`
//   generated  a file `.gitattributes` marks `linguist-generated` at the head, as GitHub's diff
//              hides it (0087 names it as the known way)
//   binary     a file git cannot count lines in, such as a shot; counted in files
// Every other changed line, lead tooling, CI and root settings included, is `other`. Whether those
// pull requests are covered was open in 0087, so they are printed and not counted as product.
//
// A plan states its size in two places (the newest plan shape, the settings plan of ticket P38):
//   - a files table with a "Product lines expected" column: each cell that starts with a whole
//     number counts it; a word (tests, docs, generated, configuration) counts nothing
//   - a `## Size` section whose numbered items are the slices, each saying "<n> lines" or
//     "<n> product lines"
//
// Existing tools looked at first (decision 0040):
//   - `git diff --numstat` (https://git-scm.com/docs/git-diff): used. It counts the lines; this file
//     only sorts the paths.
//   - `git check-attr --source` (https://git-scm.com/docs/git-check-attr): used, to read
//     `linguist-generated` at the head, the attribute GitHub's linguist reads.
//   - cloc (https://github.com/AlDanial/cloc), scc (https://github.com/boyter/scc) and tokei
//     (https://github.com/XAMPPRocky/tokei) count lines by language. None is installed here, none
//     reads `.gitattributes`, and their split is by language, not by product, test and docs, so
//     they would still need this path sort. git alone counts what a reviewer sees.
//   - A Markdown parser for the plan (mdast-util-from-markdown with mdast-util-gfm-table): no root
//     dependency, three packages to add. The plan's tables are read as the plan skill's owner check reads them, so
//     both checks see the same cells: fenced blocks skipped, rows split on unescaped pipes.
//
// A shared suite is told by its name, as `exam-paths.json`'s row `next/**/*Test.ts` tells it. That
// file is not read here: it lists the exam, which also holds product and settings files (a compiler
// check, `package.json`, the token files), so its rows cannot say what a test is.
//
// Edge cases, each with a law in sizecap.test.ts:
//   - `CiTest.ts`, `fooTest.ts` and `XTest.tsx` under `next/` are suites: any character, then `Test`
//     with a capital T, then `.ts` or `.tsx`. The exam row names `.ts` only; `.tsx` follows its
//     `.test.tsx` row.
//   - `Latest.ts` and `Contest.ts` are product: the t is lower-case.
//   - `Test.ts` alone is product: a suite is read through its subject, as `SinkTest`, and this name
//     has none. The exam row's glob does match it; no such file exists.
//   - `src/Test/thing.ts` is product: only the file's own name is read, never a folder's.
//   - `XTest.css` and `XTest.json` are product: a suite is TypeScript.
//   - `packages/x/XTest.ts` is product, and `.agents/x/XTest.ts` stays other: the exam row and the
//     two decisions cover `next/` only.
//   - `x.test-support.ts` is a test wherever it stands, as before.
//   - A renamed file counts only its changed lines, and is sorted by its new path.
//   - A binary file has no lines; it is counted in files, never as zero lines of product.
//   - A path with a space or a non-ASCII name is read whole (`-z`).
//   - A table inside a fenced block is an example, not the plan's table.
//   - An escaped pipe stays inside its cell.
//   - A cell like "**550**" or "1,200" is a number; "tests" or "generated" is none.
//   - A numbered item outside `## Size` is no slice; a Size item with no "<n> lines" is a slice
//     with no estimate, which is advice of its own.
//   - A plan with no "Product lines expected" column and no slices says so: it records no size.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Exit, FileSystem, Predicate, Schema, Stream } from "effect";
import { Argument, Command } from "effect/cli";
import { ChildProcess } from "effect/process";

/**
 * Past this many product lines, `diff` asks whether the pull request should have been sliced. Advice
 * only (0099): 0087's starting number, kept until a count from our own merged pull requests replaces it.
 */
export const ADVICE_LINES = 600;

/** Where a changed line belongs: only `product` counts as product lines. */
export const Kind = Schema.Literals(["product", "test", "docs", "lock", "generated", "other"]);
export type Kind = typeof Kind.Type;

const PRODUCT = ["next/", "apps/", "programs/", "packages/"];
const LOCKS = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);

/** A file name that ends in `Test.ts` or `Test.tsx`, with a capital T and at least one character before it. */
const SUITE = /.Test\.tsx?$/;

/** Whether `path` is one of `next/`'s shared suites, read as `SinkTest.suite(nodeSql)` (0029, 0062). */
export const isSharedSuite = (path: string): boolean =>
  path.startsWith("next/") && SUITE.test(path.split("/").at(-1) ?? "");

/** The kind of one changed file, from its path and whether the head marks it generated. */
export const classify = (path: string, generated: boolean): Kind => {
  const parts = path.split("/");
  const name = parts.at(-1) ?? path;

  if (generated) {
    return "generated";
  }

  if (LOCKS.has(name) || name.endsWith(".lock")) {
    return "lock";
  }

  if (
    /\.test(-support)?\./.test(name) ||
    name === "e2e.ts" ||
    isSharedSuite(path) ||
    parts.slice(0, -1).includes("e2e") ||
    parts.slice(0, -1).includes("fixtures")
  ) {
    return "test";
  }

  if (/\.mdx?$/i.test(name) || parts.slice(0, -1).includes("docs")) {
    return "docs";
  }

  return PRODUCT.some((root) => path.startsWith(root)) ? "product" : "other";
};

/** One file of `git diff --numstat -z`: its changed lines, or none when git sees it as binary. */
export const Row = Schema.TaggedUnion({
  text: { path: Schema.String, lines: Schema.Int },
  binary: { path: Schema.String },
});
export type Row = typeof Row.Type;

/** `git diff --numstat -z -M`: `added\tdeleted\tpath\0`, or `added\tdeleted\t\0from\0to\0` after a rename. */
export const parseNumstat = (out: string): ReadonlyArray<Row> => {
  const fields = out.split("\0");
  const rows: Array<Row> = [];

  for (let at = 0; at < fields.length && fields[at] !== "";) {
    const [added = "", deleted = "", path = ""] = (fields[at] ?? "").split("\t");
    const renamed = path === "";
    const to = renamed ? (fields[at + 2] ?? "") : path;
    at += renamed ? 3 : 1;
    rows.push(
      added === "-" || deleted === "-"
        ? Row.cases.binary.make({ path: to })
        : Row.cases.text.make({ path: to, lines: Number(added) + Number(deleted) }),
    );
  }

  return rows;
};

/** Changed lines by kind, and how many binary files changed. */
export type Tally = Readonly<Record<Kind, number>> & { readonly binary: number };

export const countLines = (rows: ReadonlyArray<Row>, generated: ReadonlySet<string>): Tally => {
  const tally = { product: 0, test: 0, docs: 0, lock: 0, generated: 0, other: 0, binary: 0 };

  for (const row of rows) {
    if (row._tag === "binary") {
      tally.binary += 1;
    } else {
      tally[classify(row.path, generated.has(row.path))] += row.lines;
    }
  }

  return tally;
};

/** The one line `diff` prints; past `advice` product lines it asks about slicing, and nothing more. */
export const diffLine = (tally: Tally, advice: number): string => {
  const warning =
    tally.product > advice ? `, more than ${advice}: should it have been sliced? (advice only, 0099)` : "";
  const apart = `${tally.test} test, ${tally.docs} docs, ${tally.lock} lock, ${tally.generated} generated, ${tally.other} other lines, ${tally.binary} binary files`;

  return `size: ${tally.product} product lines${warning}; not counted: ${apart}`;
};

// The plan side.

/** One slice of a plan's Size section: its place in the stack, its name, and its estimate when it gives one. */
export interface Slice {
  readonly order: number;
  readonly name: string;
  readonly lines: number | null;
}

/** What a plan says about its size: the files table's total, or null with no such column, and its slices. */
export interface PlanSize {
  readonly table: number | null;
  readonly slices: ReadonlyArray<Slice>;
}

/** The plan's lines with every fenced block blanked, as the plan skill's owner check reads them. */
const unfenced = (text: string): ReadonlyArray<string> => {
  let fence: string | null = null;

  return text.split("\n").map((line) => {
    const mark = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (fence !== null) {
      if (mark?.[1] !== undefined && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2]?.trim()) {
        fence = null;
      }

      return "";
    }

    if (mark?.[1] !== undefined) {
      fence = mark[1];
      return "";
    }

    return line;
  });
};

/** One table row's cells, split on pipes no backslash escapes. */
const splitRow = (row: string): ReadonlyArray<string> => {
  const cells: Array<string> = [];
  let start = 0;
  let slashes = 0;

  for (let j = 0; j < row.length; j += 1) {
    if (row[j] === "|" && slashes % 2 === 0) {
      cells.push(row.slice(start, j).trim());
      start = j + 1;
    }

    slashes = row[j] === "\\" ? slashes + 1 : 0;
  }

  cells.push(row.slice(start).trim());
  return cells.slice(row.startsWith("|") ? 1 : 0, start === row.length ? -1 : undefined);
};

const plain = (text: string): string => text.replaceAll(/[*_`]/g, "").trim();

const NUMBER = /^~?\s*(\d{1,3}(?:,\d{3})+|\d+)(?!\d)/;

/** The whole number a cell starts with, or null when it starts with a word. */
export const numberIn = (cell: string): number | null => {
  const found = NUMBER.exec(plain(cell));
  return found?.[1] === undefined ? null : Number(found[1].replaceAll(",", ""));
};

const LINES = /(\d{1,3}(?:,\d{3})+|\d+)\s+(?:product\s+)?lines?\b/i;

export const readPlan = (text: string): PlanSize => {
  const lines = unfenced(text);
  let table: number | null = null;
  let column: number | null = null;
  let inTable = false;
  let section = "";
  const slices: Array<{ order: number; text: string }> = [];

  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);

    if (heading?.[1] !== undefined) {
      section = heading[1].trim().toLowerCase();
    }

    const trimmed = line.trim();

    if (!trimmed.startsWith("|")) {
      inTable = false;
      column = null;
    } else if (!inTable) {
      inTable = true;
      const at = splitRow(trimmed).findIndex((cell) => plain(cell).toLowerCase().startsWith("product lines"));
      column = at < 0 ? null : at;
      table = column === null ? table : (table ?? 0);
    } else if (column !== null) {
      const cells = splitRow(trimmed);

      if (!cells.every((cell) => /^:?-+:?$/.test(cell))) {
        table = (table ?? 0) + (numberIn(cells[column] ?? "") ?? 0);
      }
    }

    if (section === "size") {
      const item = /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(line);
      const last = slices.at(-1);

      if (item?.[1] !== undefined) {
        slices.push({ order: Number(item[1]), text: item[2] ?? "" });
      } else if (last !== undefined && trimmed !== "") {
        last.text += ` ${trimmed}`;
      }
    }
  }

  return {
    table,
    slices: slices.map(({ order, text }) => {
      const estimate = LINES.exec(text)?.[1];
      const name = plain(text).split(/[:.]/)[0]?.trim() ?? "";
      return { order, name, lines: estimate === undefined ? null : Number(estimate.replaceAll(",", "")) };
    }),
  };
};

/** What the plan check advises, each a line the lead reads. None compares a size with a number (0099). */
export const Advice = Schema.TaggedUnion({
  unsized: { order: Schema.Int, name: Schema.String },
  unknown: {},
});
export type Advice = typeof Advice.Type;

export const advise = (size: PlanSize): ReadonlyArray<Advice> =>
  size.table === null && size.slices.length === 0
    ? [Advice.cases.unknown.make({})]
    : size.slices.flatMap((slice): ReadonlyArray<Advice> =>
        slice.lines === null ? [Advice.cases.unsized.make({ order: slice.order, name: slice.name })] : [],
      );

const ADVICE = "(advice only, 0099)";

export const adviceLine = (advice: Advice): string => {
  switch (advice._tag) {
    case "unsized":
      return `size: slice ${advice.order} (${advice.name}) gives no "<n> lines" estimate ${ADVICE}`;
    case "unknown":
      return `size: no files table has a "Product lines expected" column and ## Size lists no slices, so the plan records no size ${ADVICE}`;
  }
};

/** The line `plan` prints first, before any advice. */
export const planLine = (size: PlanSize): string => {
  const largest = Math.max(0, ...size.slices.map((slice) => slice.lines ?? 0));
  const table = size.table === null ? "no product lines column" : `${size.table} product lines in the files table`;
  const slices = size.slices.length === 0 ? "no slices" : `${size.slices.length} slices, the largest ${largest}`;

  return `size: ${table}, ${slices}`;
};

/** The run could not finish: git or the plan file failed it. */
export class Failed extends Schema.TaggedError<Failed>()("Failed", {
  reason: Schema.Literals(["git", "file"]),
  message: Schema.String,
}) {}

// The edge: git through effect/process, the plan through FileSystem, the arguments through effect/cli.

const text = (bytes: Stream.Stream<Uint8Array, unknown>) => bytes.pipe(Stream.decodeText(), Stream.mkString);

/** One git command's output and exit code. Nothing it prints is run. */
const git = Effect.fn("sizecap.git")(function* (args: ReadonlyArray<string>) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const proc = yield* ChildProcess.make("git", [...args], { stdin: "ignore" });
      const [out, , code] = yield* Effect.all([text(proc.stdout), text(proc.stderr), proc.exitCode], {
        concurrency: 3,
      });

      return { out, code: Number(code) };
    }),
  ).pipe(Effect.mapError(() => new Failed({ reason: "git", message: `git ${args.join(" ")} could not run` })));
});

const gitOk = Effect.fn("sizecap.gitOk")(function* (args: ReadonlyArray<string>) {
  const ran = yield* git(args);

  if (ran.code !== 0) {
    return yield* new Failed({ reason: "git", message: `git ${args.join(" ")} failed` });
  }

  return ran.out;
});

/** The paths `.gitattributes` marks `linguist-generated` at `rev`. */
const generatedAt = Effect.fn("sizecap.generatedAt")(function* (rev: string, paths: ReadonlyArray<string>) {
  if (paths.length === 0) {
    return new Set<string>();
  }

  const out = yield* gitOk(["check-attr", `--source=${rev}`, "-z", "linguist-generated", "--", ...paths]);
  const fields = out.split("\0");
  const marked = new Set<string>();

  for (let at = 0; at + 2 < fields.length; at += 3) {
    const value = fields[at + 2];

    if (value === "set" || value === "true") {
      marked.add(fields[at] ?? "");
    }
  }

  return marked;
});

const diff = Command.make(
  "diff",
  { base: Argument.String("base"), head: Argument.String("head") },
  Effect.fn("sizecap.diff")(function* ({ base, head }) {
    const from = (yield* gitOk(["merge-base", base, head])).trim();
    const rows = parseNumstat(yield* gitOk(["diff", "--numstat", "-z", "-M", from, head]));
    const generated = yield* generatedAt(
      head,
      rows.map((row) => row.path),
    );

    yield* Console.log(diffLine(countLines(rows, generated), ADVICE_LINES));
  }),
);

const plan = Command.make(
  "plan",
  { file: Argument.String("plan") },
  Effect.fn("sizecap.plan")(function* ({ file }) {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError(() => new Failed({ reason: "file", message: `cannot read ${file}` })));
    const size = readPlan(text);

    yield* Console.log(planLine(size));
    yield* Effect.forEach(advise(size), (advice) => Console.log(adviceLine(advice)), {
      concurrency: 1,
      discard: true,
    });
  }),
);

const sizecap = Command.make("sizecap").pipe(Command.withSubcommands([plan, diff]));

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.run({ version: "0.0.0" })(sizecap).pipe(
      Effect.as(0),
      Effect.catchTag("Failed", (failed) => Console.error(`sizecap: ${failed.message}`).pipe(Effect.as(2))),
      Effect.catchTag("ShowHelp", (help) => Effect.succeed(help.errors.length === 0 ? 0 : 2)),
      Effect.catch(() => Effect.succeed(2)),
      Effect.provide(NodeServices.layer),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : 2),
    },
  );
}
