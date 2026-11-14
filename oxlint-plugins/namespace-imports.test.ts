// Law 6 of docs/plan/effect-rules-big.md, for B3: the folders where Effect's `preferNamespaceImport`
// is on, in `tsconfig.base.json`, only grow until the list is all of `next/packages`. A folder
// dropped in a merge is silent, since the type check just stops reading it, so the list the slices
// left is saved here. A folder counts as listed only where every override, read in order, leaves the
// rule at error for `effect`: an `exclude`, or a later override that turns it down, drops it too.
// `tsconfig.base.json` has comments, so it is read as a JS expression.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Expression, parseSync } from "oxc-parser";
import { expect, it } from "vitest";

const CONFIG = join(import.meta.dirname, "..", "tsconfig.base.json");

// The folders listed on the day each import slice landed. A slice that adds a folder adds it here.
const LISTED = ["next/packages/libfabrika/src/ci/**/*.ts", "next/packages/libfabrika/src/codehost/**/*.ts"];

// The gate closed (B3.7): the list becomes these two globs, and the saved list goes with it.
const WHOLE = ["next/packages/**/*.ts", "next/packages/**/*.tsx"];

/** A JSON value from the parsed config, comments dropped. */
const value = (node: Expression): unknown => {
  switch (node.type) {
    case "ParenthesizedExpression":
      return value(node.expression);
    case "Literal":
      return node.value;
    case "ArrayExpression":
      return node.elements.map((element) =>
        element === null || element.type === "SpreadElement" ? null : value(element),
      );
    case "ObjectExpression":
      return Object.fromEntries(
        node.properties.flatMap((property) =>
          property.type === "Property" && property.key.type === "Literal"
            ? [[String(property.key.value), value(property.value)]]
            : [],
        ),
      );
    default:
      throw new Error(`tsconfig.base.json holds a ${node.type}, which is not JSON`);
  }
};

const record = (x: unknown): Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};

const list = (x: unknown): ReadonlyArray<unknown> => (Array.isArray(x) ? x : []);

/** Where a glob stops being fixed: the text before its first `*`. */
const stem = (glob: string): string => glob.split("*")[0] ?? glob;

/** `outer` reads every file `glob` reads: the same glob, or a `**` glob over a parent folder with the same ending. */
const covers = (outer: string, glob: string): boolean => {
  const [folder, ending] = outer.split("/**/");
  return outer === glob || (ending !== undefined && glob.startsWith(`${folder}/`) && glob.endsWith(`/${ending}`));
};

/** The two globs can read one file: one's fixed start lies inside the other's. */
const touches = (a: string, b: string): boolean => stem(a).startsWith(stem(b)) || stem(b).startsWith(stem(a));

const strings = (x: unknown): ReadonlyArray<string> => list(x).filter((item) => typeof item === "string");

/**
 * Each glob whose files do not end with `preferNamespaceImport` at error for `effect`, after every
 * override in order, as Effect's checker applies them (a scoped value replaces the one before).
 * An override that turns the rule on counts only where it reads the whole glob and excludes none of
 * it. One that turns it down or drops `effect` counts wherever it may read a file of the glob.
 */
const uncovered = (text: string, globs: ReadonlyArray<string>): ReadonlyArray<string> => {
  const parsed = parseSync("tsconfig.base.ts", `(${text})`);
  expect(parsed.errors).toEqual([]);
  const statement = parsed.program.body[0];

  if (statement?.type !== "ExpressionStatement") {
    throw new Error("tsconfig.base.json did not parse as one expression");
  }

  const plugins = list(record(record(value(statement.expression)).compilerOptions).plugins);
  const effect = record(plugins.map(record).find((plugin) => plugin.name === "@effect/language-service"));
  const overrides = list(effect.overrides).map(record);

  return globs.filter((glob) => {
    let packages: unknown = effect.namespaceImportPackages;
    let severity: unknown = record(effect.diagnosticSeverity).preferNamespaceImport;

    for (const override of overrides) {
      const options = record(override.options);
      const include = strings(override.include);
      const sets = {
        packages: "namespaceImportPackages" in options,
        severity: "preferNamespaceImport" in record(options.diagnosticSeverity),
      };
      const raises =
        (!sets.packages || list(options.namespaceImportPackages).includes("effect")) &&
        (!sets.severity || record(options.diagnosticSeverity).preferNamespaceImport === "error");
      const reads = raises
        ? include.some((outer) => covers(outer, glob)) &&
          !strings(override.exclude).some((excluded) => touches(excluded, glob))
        : include.some((outer) => touches(outer, glob));

      if (reads && sets.packages) {
        packages = options.namespaceImportPackages;
      }

      if (reads && sets.severity) {
        severity = record(options.diagnosticSeverity).preferNamespaceImport;
      }
    }

    return !(list(packages).includes("effect") && severity === "error");
  });
};

it("pinned: law 6, every folder once listed for preferNamespaceImport still ends at error for effect, and so does the whole tree once listed", () => {
  // pinned: the folders listed on the day each slice landed, since a folder dropped in a merge is silent.
  const text = readFileSync(CONFIG, "utf8");
  const whole = WHOLE.filter((glob) => text.includes(`"${glob}"`));

  expect(uncovered(text, [...LISTED, ...whole])).toEqual([]);
});
