// Ticket 908, next/. Decision 0095 and docs/direction/effect-code-guidelines.md (E3) ask a service's
// type to be written out, so a reader sees the contract without running the implementation in their
// head. This rule refuses a service type that is taken from the implementation instead.
//
// What is read: the last type argument of Effect's `Context.Service`, which is the service's type in
// both forms, `Context.Service<Self, Type>()("id")` and `Context.Service<Type>("id")`. `Context` is
// resolved through the file's own scope, as `service-id.ts` does it: `Context` imported from
// `effect` under any name, `effect/Context` or the `effect` barrel imported as a namespace, and
// `Service` imported by name from `effect/Context`, with the member written plainly, optionally or
// as a string literal. A `Context.Reference`, a shadowed `Context` and another module's `Service`
// are not read.
//
// What fires, anywhere inside that type, however deep:
// - `ReturnType<...>`, unless the file declares its own type of that name;
// - `Effect.Success<...>`, with `Effect` resolved like `Context` (`effect`, `effect/Effect`, the
//   barrel, or `Success` imported by name);
// - a `typeof` query. One kind passes: `typeof X.Type`, the type of a schema's value, when it sits
//   inside a member of a written object type. As the whole type, or joined to one with `&`, it fires.
// A type alias or an interface declared in the same file is read through, wherever the type names
// it, so the break cannot hide one line up. A name imported from another file passes: the rule
// reads one file.
//
// One report per service, on its type argument. Misses: a service reached through a local alias
// (`const S = Context.Service`), a type in another file, and `(typeof X)["Type"]`, which fires
// though it means the same as `typeof X.Type`.
//
// `.oxlintrc.json` turns it on for `next/` and off for tests: a test's stand-in is not a contract.
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import type { Node } from "./match.ts";

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

/** The body of a type the file declares itself: an alias's type, or an interface's members. */
const declared = (variable: Variable | undefined): Node | null => {
  const node: Node | undefined = variable?.defs[0]?.node;

  if (node?.type === "TSTypeAliasDeclaration") {
    return node.typeAnnotation;
  }

  return node?.type === "TSInterfaceDeclaration" ? node.body : null;
};

/** The nodes directly under one. */
function* parts(node: Node): Generator<Node> {
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || value === null || typeof value !== "object") {
      continue;
    }

    for (const part of Array.isArray(value) ? value : [value]) {
      if (part !== null && typeof part === "object" && typeof part.type === "string") {
        yield part;
      }
    }
  }
}

export const writtenServiceType: CreateRule = {
  meta: { type: "problem" },
  create(context) {
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

    /** Whether a node is the `effect` barrel, imported as a namespace. */
    const isBarrel = (node: Node): boolean => {
      const at = imported(resolve(node));
      return at !== null && at.from === "effect" && at.name === "*";
    };

    /** Whether a node is the Effect module of this name: `Context` or `Effect`. */
    const isModule = (node: Node, name: string): boolean => {
      if (node.type === "Identifier") {
        const at = imported(resolve(node));
        return (
          at !== null &&
          ((at.from === "effect" && at.name === name) || (at.from === `effect/${name}` && at.name === "*"))
        );
      }

      // The barrel as a namespace: `E.Context` in a value, `E.Effect` in a type.
      if (node.type === "MemberExpression") {
        return memberName(node) === name && isBarrel(node.object);
      }

      return node.type === "TSQualifiedName" && node.right.name === name && isBarrel(node.left);
    };

    /** Whether a callee is Effect's `Context.Service`. */
    const isService = (callee: Node): boolean => {
      const node = callee.type === "ChainExpression" ? callee.expression : callee;

      if (node.type === "MemberExpression") {
        return memberName(node) === "Service" && isModule(node.object, "Context");
      }

      const at = imported(resolve(node));
      return at !== null && at.from === "effect/Context" && at.name === "Service";
    };

    /** Whether a type's name is Effect's `Effect.Success`. */
    const isSuccess = (name: Node): boolean => {
      if (name.type === "TSQualifiedName") {
        return name.right.name === "Success" && isModule(name.left, "Effect");
      }

      const at = imported(resolve(name));
      return at !== null && at.from === "effect/Effect" && at.name === "Success";
    };

    /** The first inferring form a type holds, or `null` for a written one. */
    const inferred = (type: Node, inMember: boolean, seen: Set<Node>): string | null => {
      if (type.type === "TSTypeQuery") {
        const name = type.exprName;
        const schemaValue = name.type === "TSQualifiedName" && name.right.name === "Type";

        if (!(schemaValue && inMember)) {
          return "a typeof query";
        }
      }

      if (type.type === "TSTypeReference") {
        const local = resolve(type.typeName);

        if (type.typeName.type === "Identifier" && type.typeName.name === "ReturnType" && local === undefined) {
          return "ReturnType";
        }

        if (isSuccess(type.typeName)) {
          return "Effect.Success";
        }

        const body = declared(local);

        // `seen` holds the declarations being read now, so a type that names itself ends.
        if (body !== null && !seen.has(body)) {
          seen.add(body);
          const found = inferred(body, inMember, seen);
          seen.delete(body);

          if (found !== null) {
            return found;
          }
        }
      }

      const within = inMember || type.type === "TSTypeLiteral" || type.type === "TSInterfaceBody";

      for (const part of parts(type)) {
        const found = inferred(part, within, seen);

        if (found !== null) {
          return found;
        }
      }

      return null;
    };

    return {
      CallExpression(node) {
        const type = node.typeArguments?.params.at(-1);

        if (type === undefined || !isService(node.callee)) {
          return;
        }

        const found = inferred(type, false, new Set());

        if (found !== null) {
          context.report({
            node: type,
            message: `This service's type holds ${found}, so it is inferred from the implementation. Write it out: each member and its Effect type by name, so a reader sees the contract without the code that makes it (decision 0095, oxlint-plugins/written-service-type.ts).`,
          });
        }
      },
    };
  },
};
