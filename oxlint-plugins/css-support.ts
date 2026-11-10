// Today's CSS rules share parsing and reporting, so the runner can count known debt too.
import { relative } from "node:path";
import valueParser from "postcss-value-parser";
import stylelint from "stylelint";
import names from "../packages/fabrika-design/src/token-names.json" with { type: "json" };

type Root = Parameters<ReturnType<stylelint.Rule>>[0];
type Declaration = Extract<Root["nodes"][number], { type: "decl" }>;
const TOKENS = "packages/fabrika-design/src/tokens.css";
export const WINDOW = "apps/fabrika/src/window/window.css";
export const tokens = new Map(names.tokens.map(({ name, owner }) => [name, owner]));
export const steps = new Set(names.steps);
export const parts: Readonly<Record<string, readonly string[]>> = names.parts;
export const file = (decl: Declaration) => relative(process.cwd(), decl.source?.input.file ?? "");

const place = (decl: Declaration) =>
  `${file(decl)} ${decl.parent?.type === "rule" ? decl.parent.selector.replace(/\s+/g, " ").trim() : ""} { ${decl.prop} }`;

export const generated = (decl: Declaration) => {
  if (file(decl) !== TOKENS) {
    return false;
  }

  let before = decl.prev();

  while (before !== undefined) {
    if (before.type === "comment") {
      if (/^@end generated (colors|manti)\b/.test(before.text)) {
        return false;
      }

      if (/^@generated (colors|manti)\b/.test(before.text)) {
        return true;
      }
    }

    before = before.prev();
  }

  return false;
};

export const references = (decl: Declaration) => {
  const found: string[] = [];
  valueParser(decl.value).walk((node) => {
    if (node.type !== "function") {
      return;
    }

    if (node.value.toLowerCase() === "url") {
      return false;
    }

    if (node.value.toLowerCase() !== "var") {
      return;
    }

    const name = node.nodes.find((child) => child.type !== "space" && child.type !== "comment");

    if (name?.type === "word" && name.value.startsWith("--")) {
      found.push(name.value);
    }
  });
  return found;
};

export const media = (decl: Declaration, feature: string, value: string) => {
  const condition = new RegExp(`\\(\\s*${feature}\\s*:\\s*${value}\\s*\\)`, "i");
  let parent: Root["parent"] | Declaration["parent"] = decl.parent;

  while (parent !== undefined) {
    if (
      parent.type === "atrule" &&
      parent.name.toLowerCase() === "media" &&
      parent.params.split(",").every((query) => condition.test(query) && !/\b(not|or)\b/i.test(query))
    ) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
};

type Fire = (decl: Declaration, detail: string, debt?: string) => void;
type Check = (root: Root, fire: Fire) => void;
type Options = { known: readonly string[] };

// Hits are kept on the PostCSS result, including debt hidden by known. Each lint call owns its map.
type Counts = { fires: number; known: Set<string> };
export type CssResult = stylelint.PostcssResult & { fabrika?: Map<string, Counts> };

export const plugin = (name: string, check: Check) => {
  const ruleName = `fabrika/${name}`;
  const messages = stylelint.utils.ruleMessages(ruleName, { rejected: (detail: string) => detail });
  const rule: stylelint.Rule<boolean, Options> = Object.assign(
    (primary: boolean, options: Options) => (root: Root, result: CssResult) => {
      if (
        !stylelint.utils.validateOptions(
          result,
          ruleName,
          { actual: primary, possible: [true] },
          { actual: options, possible: { known: [(value) => typeof value === "string"] } },
        )
      ) {
        return;
      }

      const counts: Counts = { fires: 0, known: new Set() };
      result.fabrika ??= new Map();
      result.fabrika.set(ruleName, counts);
      check(root, (decl, detail, debt = place(decl)) => {
        counts.fires++;

        if (options.known.includes(debt)) {
          counts.known.add(debt);
          return;
        }

        stylelint.utils.report({ ruleName, result, node: decl, message: messages.rejected(detail) });
      });
    },
    { ruleName, messages },
  );
  return stylelint.createPlugin(ruleName, rule);
};
