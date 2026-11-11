// No bare `of` and no `xOf` name in `next/` (docs/direction/schema-classes-not-of-helpers.md). Tier
// 1's exam, item 4 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It fires on a name this file declares: a variable, a function, a type or interface, a class, an
// enum or enum member, a namespace, a parameter (catch included), a type parameter, an object key,
// a class member (accessor and abstract included) or a type member, named `of` or ending in `Of`
// after a letter or digit (`colorsOf`, `IconOf`, `URLOf`). A local import binding is a declared
// name too (`import * as colorsOf`, `import { a as colorsOf }`), and so is a name a re-export
// chooses (`export { a as colorsOf }`, `export * as colorsOf from`).
//
// A module's own top-level `of` passes, as Effect has `Chunk.of`, read as `Lease.of(...)` under a
// namespace import (0029): `export const of`, `export function of`, `export declare function of`, a
// top-level pattern under `export`, and a top-level local exported by `export { of }`. The
// allowance covers that one binding only: its keys, parameters and nested names are still checked.
// A bare `of` read by name stays banned, so `import { of }` fires, renamed or type-only.
//
// It does not fire on a use, so `xs.indexOf(x)`, `for (const x of xs)` and `Lease.of(1)` pass. A
// borrowed name passes: a shorthand destructure (`const {indexOf} = xs`), `import { nameOf }` and
// `export { nameOf }`; a renamed one (`const {a: colorsOf} = xs`) fires.
//
// `.oxlintrc.json` turns it on in all of `next/**`, tests included: a test names its helpers too.
import type { CreateRule } from "@oxlint/plugins";
import type { Node } from "./match.ts";

const OF = /^of$|[A-Za-z0-9]Of$/;

/** The name a key or an id spells, if it is written plainly: `of`, `"of"`. */
const spelled = (node: Node | null | undefined): string | null => {
  if (node == null) {
    return null;
  }

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  return null;
};

/**
 * True when `program` has `export { of }` with no source: a top-level local exported as `of`. A
 * type-only export (`export type { of }`, `export { type of }`) is never read as `M.of`, so it does not count.
 */
const exportsOf = (program: Node): boolean =>
  program.type === "Program" &&
  program.body.some(
    (s) =>
      s.type === "ExportNamedDeclaration" &&
      s.source == null &&
      s.exportKind !== "type" &&
      s.specifiers.some((e) => e.exportKind !== "type" && spelled(e.local) === "of" && spelled(e.exported) === "of"),
  );

export const noOf: CreateRule = {
  create(context) {
    let exported = false;
    /** True when this declaration is the module's own top-level `of`, read by others as `M.of`. */
    const exportedTopLevel = (decl: Node): boolean => {
      const { parent } = decl as Node & { readonly parent: Node };

      if (parent.type === "ExportNamedDeclaration") {
        return (parent as Node & { readonly parent: Node }).parent.type === "Program";
      }

      return parent.type === "Program" && exported;
    };
    /** Reports a declared `of` or `xOf` name; `allowOf` lets exactly `of` pass. */
    const check = (node: Node | null | undefined, allowOf = false) => {
      const name = spelled(node);

      if (node == null || name === null || !OF.test(name) || (allowOf && name === "of")) {
        return;
      }

      context.report({
        node,
        message: `\`${name}\`: no bare \`of\` and no \`xOf\` names in next/. Put the helper on its type as a static (\`make\`, \`fromX\`, \`toX\`), give it a plain name, or export a top-level \`of\` that readers call as \`Lease.of(...)\` (0029).`,
      });
    };
    /** Each name a binding pattern declares, leaving out a shorthand key's borrowed name. */
    const bound = (node: Node | null | undefined, allowOf = false): void => {
      if (node == null) {
        return;
      }

      switch (node.type) {
        case "Identifier":
          check(node, allowOf);
          return;
        case "ObjectPattern":
          for (const p of node.properties) {
            if (p.type === "RestElement") {
              bound(p.argument, allowOf);
            } else if (!p.shorthand) {
              bound(p.value, allowOf);
            }
          }

          return;
        case "ArrayPattern":
          for (const e of node.elements) {
            bound(e, allowOf);
          }

          return;
        case "RestElement":
          bound(node.argument, allowOf);
          return;
        case "AssignmentPattern":
          bound(node.left, allowOf);
          return;
        case "TSParameterProperty":
          bound(node.parameter);
          return;
        default:
          return;
      }
    };
    const params = (node: { readonly params: readonly Node[] }) => {
      for (const p of node.params) {
        bound(p);
      }
    };
    /** A namespace's name, each part of `A.B.C`; a `declare module "x"` string is a path, not a name. */
    const namespace = (node: Node) => {
      if (node.type === "TSQualifiedName") {
        namespace(node.left);
        check(node.right);
      } else if (node.type === "Identifier") {
        check(node);
      }
    };
    const member = (node: { readonly computed: boolean; readonly key: Node }) => {
      if (!node.computed) {
        check(node.key);
      }
    };
    return {
      Program(node) {
        exported = exportsOf(node);
      },
      VariableDeclarator(node) {
        bound(node.id, exportedTopLevel((node as Node & { readonly parent: Node }).parent));
      },
      FunctionDeclaration(node) {
        check(node.id, exportedTopLevel(node));
        params(node);
      },
      FunctionExpression(node) {
        check(node.id);
        params(node);
      },
      ArrowFunctionExpression(node) {
        params(node);
      },
      TSDeclareFunction(node) {
        check(node.id, exportedTopLevel(node));
        params(node);
      },
      CatchClause(node) {
        bound(node.param);
      },
      ClassDeclaration(node) {
        check(node.id);
      },
      ClassExpression(node) {
        check(node.id);
      },
      TSTypeAliasDeclaration(node) {
        check(node.id);
      },
      TSInterfaceDeclaration(node) {
        check(node.id);
      },
      TSEnumDeclaration(node) {
        check(node.id);
      },
      TSEnumMember(node) {
        member({ computed: node.computed, key: node.id });
      },
      TSTypeParameter(node) {
        check(node.name);
      },
      TSModuleDeclaration(node) {
        namespace(node.id);
      },
      ImportSpecifier(node) {
        if (spelled(node.imported) === "of") {
          context.report({
            node,
            message: "`of` imported by name: import the module as a namespace and call `Lease.of(...)` (0029).",
          });
        } else if (spelled(node.imported) !== spelled(node.local)) {
          check(node.local);
        }
      },
      ImportDefaultSpecifier(node) {
        check(node.local);
      },
      ImportNamespaceSpecifier(node) {
        check(node.local);
      },
      TSImportEqualsDeclaration(node) {
        check(node.id);
      },
      ExportSpecifier(node) {
        if (spelled(node.exported) !== spelled(node.local)) {
          check(node.exported, true);
        }
      },
      ExportAllDeclaration(node) {
        check(node.exported, true);
      },
      Property(node) {
        const { parent } = node as Node & { readonly parent: Node };

        if (parent.type === "ObjectExpression" && !node.computed && !node.shorthand) {
          check(node.key);
        }
      },
      MethodDefinition(node) {
        member(node);
      },
      TSAbstractMethodDefinition(node) {
        member(node);
      },
      PropertyDefinition(node) {
        member(node);
      },
      TSAbstractPropertyDefinition(node) {
        member(node);
      },
      AccessorProperty(node) {
        member(node);
      },
      TSAbstractAccessorProperty(node) {
        member(node);
      },
      TSPropertySignature(node) {
        member(node);
      },
      TSMethodSignature(node) {
        member(node);
        params(node);
      },
    };
  },
};
