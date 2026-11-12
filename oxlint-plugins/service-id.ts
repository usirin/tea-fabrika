// Ticket 737, next/. Decision 0023 has next/ follow Effect's own style, and Effect's guide asks a
// service's string ID to carry "the package name and the subdirectory path to the service file". So
// an ID is the package, the source file's path without its extension, then `.Name` when the service
// is named otherwise than its file: `@kampus/libfabrika/ledger/Ledger`,
// `@kampus/libfabrika/ledger/Ledger.Doorbell`, `@kampus/libfabrika/Id.Generator`.
//
// Options, from the config: `package`, the package name, and `src`, its source folder from where
// oxlint runs. Outside `src` the rule says nothing. With no options it says nothing.
//
// What counts, resolved through the file's own scope, so a renamed import is seen and a local of the
// same name is not:
// - `Context.Service<S, A>()("id")` and `Context.Service<A>("id")`, and `Context.Reference<A>("id", o)`;
// - `Context` imported from `effect` under any name, `effect/Context` imported as a namespace, the
//   `effect` barrel imported as a namespace (`Effect.Context.Service`), and `Service` or `Reference`
//   imported by name from `effect/Context`;
// - the member written plainly, optionally (`Context?.Service`) or as a string-literal computed member
//   (`Context["Service"]`).
// What the ID must be:
// - a class (`class Doorbell extends Context.Service...`) gives its name: the ID is exactly the path,
//   or the path then `.Doorbell` when the file is not `Doorbell.ts`;
// - anything else (a `const`, a Reference made inside a function) is named by nothing the rule can
//   trust, so the path alone or the path then `.Name` for some one name passes;
// - the ID is a string literal or a template with no expressions. Any other ID cannot be proved, and
//   the rule says so instead.
// Edge cases that pass: a type-only use (`typeof Context.Service`), a call of an unrelated `Service`,
// a shadowed `Context`, and code outside `src`. A package with the same prefix
// (`@kampus/libfabrika-old/...`) fails, since the path must follow the package name and a slash.
// Misses: a Service reached through a local alias (`const S = Context.Service`) or a helper.
//
// Both diagnostics only advise until their false alarms are counted (README.md).
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import { pathIn, type Node } from "./match.ts";

type Made = "Service" | "Reference";

const ADVICE = "Advice, does not block:";

const settings = (options: ReadonlyArray<unknown>): { readonly package: string; readonly src: string } | null => {
  const [given] = options;

  if (typeof given !== "object" || given === null || !("package" in given) || !("src" in given)) {
    return null;
  }

  return typeof given.package === "string" && typeof given.src === "string"
    ? { package: given.package, src: given.src.replace(/\/+$/, "") }
    : null;
};

/** The import an identifier is bound to: its source and the name it imports (`*` for a namespace). */
const imported = (variable: Variable | undefined): { readonly from: string; readonly name: string } | null => {
  const def = variable?.defs[0];

  if (def === undefined || def.type !== "ImportBinding" || def.parent?.type !== "ImportDeclaration") {
    return null;
  }

  const from = def.parent.source.value;
  const spec = def.node;

  if (spec.type === "ImportNamespaceSpecifier") {
    return { from, name: "*" };
  }

  if (spec.type === "ImportSpecifier") {
    return {
      from,
      name: spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value),
    };
  }

  return null;
};

/** A member's name, written plainly or as a string literal. */
const memberName = (node: ESTree.MemberExpression): string | null => {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  return node.computed && node.property.type === "Literal" && typeof node.property.value === "string"
    ? node.property.value
    : null;
};

/** A template with no expressions, or a string literal: its text. */
const literal = (node: Node | undefined): string | null => {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }

  return null;
};

export const serviceId: CreateRule = {
  meta: {
    type: "suggestion",
    schema: [
      {
        type: "object",
        properties: { package: { type: "string" }, src: { type: "string" } },
        required: ["package", "src"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const given = settings(context.options);
    const file = pathIn(context);

    if (given === null || !file.startsWith(`${given.src}/`)) {
      return {};
    }

    const path = file.slice(given.src.length + 1).replace(/\.[^./]+$/, "");
    const base = `${given.package}/${path}`;
    const stem = path.split("/").at(-1) ?? "";

    const resolve = (node: Node): Variable | undefined => {
      if (node.type !== "Identifier") {
        return undefined;
      }

      let scope: Scope | null = context.sourceCode.getScope(node);

      while (scope !== null) {
        const variable = scope.set.get(node.name);

        if (variable !== undefined) {
          return variable;
        }

        scope = scope.upper;
      }

      return undefined;
    };

    /** Whether a node is Effect's Context module. */
    const isContext = (node: Node): boolean => {
      if (node.type === "Identifier") {
        const at = imported(resolve(node));
        return (
          at !== null &&
          ((at.from === "effect" && at.name === "Context") || (at.from === "effect/Context" && at.name === "*"))
        );
      }

      if (node.type === "MemberExpression" && memberName(node) === "Context" && node.object.type === "Identifier") {
        const at = imported(resolve(node.object));
        return at !== null && at.from === "effect" && at.name === "*";
      }

      return false;
    };

    /** What a callee makes: a Service, a Reference, or neither. */
    const made = (callee: Node): Made | null => {
      const node = callee.type === "ChainExpression" ? callee.expression : callee;

      if (node.type === "MemberExpression") {
        const name = memberName(node);
        return (name === "Service" || name === "Reference") && isContext(node.object) ? name : null;
      }

      if (node.type === "Identifier") {
        const at = imported(resolve(node));
        return at !== null && at.from === "effect/Context" && (at.name === "Service" || at.name === "Reference")
          ? at.name
          : null;
      }

      return null;
    };

    const check = (call: ESTree.CallExpression, id: Node | undefined) => {
      // A class names its service; the rule trusts no other name.
      const parent = (call as Node & { readonly parent?: Node }).parent;
      const named =
        parent?.type === "ClassDeclaration" || parent?.type === "ClassExpression" ? parent.id?.name : undefined;
      const text = literal(id);
      const at = id ?? call;

      if (text === null) {
        context.report({
          node: at,
          message: `${ADVICE} this service ID is not a string the rule can read, so it cannot show the ID is ${base} or ${base}.Name (decision 0023, oxlint-plugins/service-id.ts).`,
        });
        return;
      }

      const expected = named === undefined ? null : named === stem ? base : `${base}.${named}`;
      const fits =
        expected === null
          ? text === base || (text.startsWith(`${base}.`) && /^[A-Za-z_$][\w$]*$/.test(text.slice(base.length + 1)))
          : text === expected;

      if (!fits) {
        context.report({
          node: at,
          message: `${ADVICE} the service ID ${JSON.stringify(text)} should be ${JSON.stringify(expected ?? `${base}.Name`)}: the package, the source file's path, then .Name when the service is named otherwise than its file (decision 0023, oxlint-plugins/service-id.ts).`,
        });
      }
    };

    return {
      CallExpression(node) {
        const kind = made(node.callee);

        if (kind === null) {
          return;
        }

        // The curried class form takes no arguments, and its result takes the ID.
        const parent = (node as Node & { readonly parent?: Node }).parent;

        if (kind === "Service" && node.arguments.length === 0) {
          if (parent?.type === "CallExpression" && parent.callee === node) {
            check(parent, parent.arguments[0]);
          }

          return;
        }

        check(node, node.arguments[0]);
      },
    };
  },
};
