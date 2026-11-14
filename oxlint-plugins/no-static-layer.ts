// Ticket 911, B1.0, next/. A service file holds only its contract (0095, E5 in
// docs/direction/effect-code-guidelines.md): each layer is a sibling file that exports `layer`, and
// the class that extends `Context.Service` holds no code that runs. So this rule refuses every static
// member of such a class, not only one that returns a Layer (owner, 2026-11-13): a syntax rule cannot
// read a member's type, and a guess from names would miss.
//
// What fires, on a class declaration or a class expression whose `extends` is a call of
// `Context.Service` (`Context.Service<S, A>()("id")`): a static field, with or without `readonly` or
// a value, a static method, getter, setter or accessor, and a `static {}` block. `Context` is resolved
// through the file's own scope as `service-id.ts` resolves it, so a renamed import is seen and a local
// of the same name is not: `Context` imported from `effect` under any name, `effect/Context` imported
// as a namespace, the `effect` barrel imported as a namespace (`Effect.Context.Service`), and
// `Service` imported by name from `effect/Context`.
//
// What passes: an instance member, a `declare` field (it emits nothing), and a class that extends
// anything else (`Schema.TaggedError`, `Schema.Opaque`) or nothing. Misses: a static member added
// from outside (`Ledger.layer = ...`, which the type check refuses), and a Service reached through a
// local alias (`const S = Context.Service`) or a helper.
//
// Which folders it holds is the config's `files` list, and tests are left out there (README.md).
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import type { Node } from "./match.ts";

type Member = ESTree.ClassBody["body"][number];

/** The import an identifier is bound to: its source and the name it imports (`*` for a namespace). */
const imported = (variable: Variable | undefined): { readonly from: string; readonly name: string } | null => {
  const def = variable?.defs[0];

  if (def === undefined || def.type !== "ImportBinding" || def.parent?.type !== "ImportDeclaration") {
    return null;
  }

  const spec = def.node;

  if (spec.type === "ImportNamespaceSpecifier") {
    return { from: def.parent.source.value, name: "*" };
  }

  if (spec.type === "ImportSpecifier") {
    const name = spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value);
    return { from: def.parent.source.value, name };
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

/** Whether a member is static and runs or holds something: a `declare` field emits nothing. */
const isStatic = (member: Member): boolean =>
  member.type === "StaticBlock" ||
  ("static" in member && member.static && !("declare" in member && member.declare === true));

export const noStaticLayer: CreateRule = {
  create(context) {
    const resolve = (node: Node & { readonly name: string }): Variable | undefined => {
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
        return at?.from === "effect" && at.name === "*";
      }

      return false;
    };

    /** Whether a class's `extends` is a call of `Context.Service`, through any number of calls. */
    const isService = (node: Node | null): boolean => {
      let at = node;

      while (at?.type === "CallExpression") {
        at = at.callee.type === "ChainExpression" ? at.callee.expression : at.callee;

        if (at.type === "MemberExpression") {
          return memberName(at) === "Service" && isContext(at.object);
        }

        if (at.type === "Identifier") {
          const by = imported(resolve(at));
          return by?.from === "effect/Context" && by.name === "Service";
        }
      }

      return false;
    };

    const check = (node: ESTree.Class) => {
      if (!isService(node.superClass)) {
        return;
      }

      for (const member of node.body.body) {
        if (isStatic(member)) {
          context.report({
            node: member,
            message:
              "A service class holds only its contract (0095): move this static member to a sibling file that exports it, as ledger/LedgerSql.ts exports `layer`, and have callers import it from there (oxlint-plugins/no-static-layer.ts).",
          });
        }
      }
    };

    return { ClassDeclaration: check, ClassExpression: check };
  },
};
