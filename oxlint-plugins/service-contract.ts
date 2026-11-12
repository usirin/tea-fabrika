// 0095, P19 next/. Scope is the three new desktop contracts. Existing services migrate separately.
// Edge cases: renamed Context/Schema imports, namespace imports, computed static members,
// methods and fields, runtime exports, type-only imports, schema declarations, sibling layers.
// Oxlint's restricted-imports cannot distinguish a service class from its implementation.
import type { CreateRule } from "@oxlint/plugins";
import { dotted, pathIn, type Node } from "./match.ts";

const CONTRACT = /\/desktop\/(BrainService|BrainControl|BrainProbe)\.ts$/;

const MESSAGE =
  "A service file holds only its written contract, schemas and errors; put running code in a sibling Layer (0095).";

export const serviceContract: CreateRule = {
  create(context) {
    const file = pathIn(context);
    const contract = CONTRACT.test(file);

    if (!file.startsWith("next/packages/libfabrika/src/desktop/")) {
      return {};
    }

    const schemas = new Set<string>();
    const report = (node: Node) => context.report({ node, message: MESSAGE });
    const schemaValue = (node: Node): boolean => {
      if (node.type === "Literal" || node.type === "Identifier") {
        return true;
      }

      if (node.type === "CallExpression") {
        const name = dotted(node.callee);
        return name !== null && schemas.has(name.split(".")[0] ?? "");
      }

      return node.type === "MemberExpression" && schemas.has(dotted(node)?.split(".")[0] ?? "");
    };
    return {
      ImportDeclaration(node) {
        if (
          /^(?:node:|electron(?:\/|$)|cloudflare:|@cloudflare\/|@effect\/platform|@kampus\/tuval|alchemy(?:\/|$)|@alchemy\.run\/)/.test(
            node.source.value,
          )
        ) {
          report(node);
        }
      },
      TSQualifiedName(node) {
        if (node.left.type === "Identifier" && ["NodeJS", "Electron"].includes(node.left.name)) {
          report(node);
        }
      },
      Program(program) {
        if (!contract) {
          return;
        }

        for (const statement of program.body) {
          if (statement.type === "ImportDeclaration") {
            for (const spec of statement.specifiers) {
              if (
                statement.source.value === "effect" &&
                spec.type === "ImportSpecifier" &&
                spec.imported.type === "Identifier" &&
                spec.imported.name === "Schema"
              ) {
                schemas.add(spec.local.name);
              }

              if (statement.source.value === "effect/Schema" && spec.type === "ImportNamespaceSpecifier") {
                schemas.add(spec.local.name);
              }
            }
          }
        }

        const declaration = (node: Node): void => {
          if (node.type === "ExportNamedDeclaration") {
            if (node.declaration !== null) {
              declaration(node.declaration);
            }

            if (node.source !== null && node.exportKind !== "type") {
              report(node);
            }
          } else if (node.type === "ImportDeclaration") {
            if (/^(?:effect\/(?:sql|process))|(?:Managed|Launchd|Sql|internal)(?:\/|\.|$)/.test(node.source.value)) {
              report(node);
            }
          } else if (node.type === "VariableDeclaration") {
            for (const value of node.declarations) {
              if (value.init !== null && !schemaValue(value.init)) {
                report(value);
              }
            }
          } else if (node.type === "ClassDeclaration") {
            for (const member of node.body.body) {
              report(member);
            }
          } else if (!["TSTypeAliasDeclaration", "TSInterfaceDeclaration", "EmptyStatement"].includes(node.type)) {
            report(node);
          }
        };

        for (const statement of program.body) {
          declaration(statement);
        }
      },
    };
  },
};
