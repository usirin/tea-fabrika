// Ticket 907, next/. A failure is a typed value (docs/direction/effect-code-guidelines.md, E2).
// `Cause.squash` turns a typed cause into one unknown value, and the next line then asks what it
// is. This rule refuses every use of Effect's `squash`. Read the typed failure with
// `Cause.findErrorOption` or `Exit.findErrorOption`, and a thrown value with `Cause.findDefect`.
//
// What counts, resolved through the file's own scope, so a renamed import is seen and a local of the
// same name is not:
// - `Cause` imported from `effect` under any name, `effect/Cause` imported as a namespace, and the
//   `effect` barrel imported as a namespace (`Effect.Cause.squash`);
// - the member written plainly, optionally (`Cause?.squash`) or as a string-literal computed member
//   (`Cause["squash"]`), called or only referred to (`xs.map(Cause.squash)`);
// - `squash` taken out of the module by a pattern: `const { squash } = Cause`;
// - `squash` imported by name from `effect/Cause`, which fires once, at the import.
// What passes: another object's `squash`, a local or a parameter named `Cause`, a `Cause` imported
// from any other module, a comment, a string, and a type position (`typeof Cause.squash`,
// `import type`).
// Misses: an alias made at run time (`const c = Cause; c.squash(x)`) and a re-export.
//
// The one place that needs the squashed value, an edge that names whatever failed, takes
// `// oxlint-disable-next-line fabrika/no-cause-squash -- edge: <why>` on its line. `.oxlintrc.json`
// leaves tests, shared suites and test support out: a test reads a failed `Exit` to assert on it.
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import type { Node } from "./match.ts";

const MESSAGE =
  "`Cause.squash` turns a typed failure into one unknown value. Read the typed failure with `Cause.findErrorOption` or `Exit.findErrorOption` and match on its tag, and a thrown value with `Cause.findDefect`. An edge that must name whatever failed takes `// oxlint-disable-next-line fabrika/no-cause-squash -- edge: <why>` (oxlint-plugins/no-cause-squash.ts).";

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
    return { from, name: spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value) };
  }

  return null;
};

/** A member's or a key's name, written plainly or as a string literal. */
const written = (key: Node, computed: boolean): string | null => {
  if (!computed && key.type === "Identifier") {
    return key.name;
  }

  return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
};

export const noCauseSquash: CreateRule = {
  create(context) {
    const resolve = (node: ESTree.IdentifierReference): Variable | undefined => {
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

    /** Whether a node is Effect's Cause module. */
    const isCause = (given: Node): boolean => {
      const node = given.type === "ChainExpression" ? given.expression : given;

      if (node.type === "Identifier") {
        const at = imported(resolve(node));
        return (
          at !== null &&
          ((at.from === "effect" && at.name === "Cause") || (at.from === "effect/Cause" && at.name === "*"))
        );
      }

      if (
        node.type === "MemberExpression" &&
        written(node.property, node.computed) === "Cause" &&
        node.object.type === "Identifier"
      ) {
        const at = imported(resolve(node.object));
        return at !== null && at.from === "effect" && at.name === "*";
      }

      return false;
    };

    return {
      MemberExpression(node) {
        if (written(node.property, node.computed) === "squash" && isCause(node.object)) {
          context.report({ node, message: MESSAGE });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || node.init == null || !isCause(node.init)) {
          return;
        }

        for (const property of node.id.properties) {
          if (property.type === "Property" && written(property.key, property.computed) === "squash") {
            context.report({ node: property, message: MESSAGE });
          }
        }
      },
      ImportDeclaration(node) {
        if (node.source.value !== "effect/Cause" || node.importKind === "type") {
          return;
        }

        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier" || spec.importKind === "type") {
            continue;
          }

          const name = spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value);

          if (name === "squash") {
            context.report({ node: spec, message: MESSAGE });
          }
        }
      },
    };
  },
};
