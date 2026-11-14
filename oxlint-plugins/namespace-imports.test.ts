// Law 6 of docs/plan/effect-rules-big.md, for B3: the folders where Effect's `preferNamespaceImport`
// is on, in `tsconfig.base.json`, only grow until the list is all of `next/packages`. A folder
// dropped in a merge is silent, since the type check just stops reading it, so the list the slices
// left is saved here. `tsconfig.base.json` has comments, so it is read as a JS expression.
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

/** The `include` of every override that turns `preferNamespaceImport` to error for `effect`. */
const namespaceFolders = (text: string): ReadonlyArray<unknown> => {
  const parsed = parseSync("tsconfig.base.ts", `(${text})`);
  expect(parsed.errors).toEqual([]);
  const statement = parsed.program.body[0];

  if (statement?.type !== "ExpressionStatement") {
    throw new Error("tsconfig.base.json did not parse as one expression");
  }

  const plugins = list(record(record(value(statement.expression)).compilerOptions).plugins);
  const effect = plugins.map(record).find((plugin) => plugin.name === "@effect/language-service");

  return list(effect?.overrides)
    .map(record)
    .filter((override) => {
      const options = record(override.options);
      return (
        list(options.namespaceImportPackages).includes("effect") &&
        record(options.diagnosticSeverity).preferNamespaceImport === "error"
      );
    })
    .flatMap((override) => list(override.include));
};

it("pinned: law 6, every folder once listed for preferNamespaceImport is still listed, or the list is all of next/packages", () => {
  // pinned: the folders listed on the day each slice landed, since a folder dropped in a merge is silent.
  const folders = namespaceFolders(readFileSync(CONFIG, "utf8"));
  const whole = WHOLE.every((glob) => folders.includes(glob));

  expect(whole ? [] : LISTED.filter((folder) => !folders.includes(folder))).toEqual([]);
});
