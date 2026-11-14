// Today's tooling for next/ tests: it blocks in every folder at zero, and advises where the config's
// warn override still names the folder (0523). Match written schema evidence, never record keys or
// capitalized names. Scope variables identify imports, aliases and callback inputs without types.
import type { CreateRule } from "@oxlint/plugins";
import { below, dotted, type Node } from "./match.ts";

const constructors = new Set([
  "record",
  "string",
  "stringMatching",
  "integer",
  "nat",
  "float",
  "double",
  "bigInt",
  "boolean",
  "array",
  "uniqueArray",
  "tuple",
  "oneof",
  "option",
  "constant",
  "constantFrom",
  "dictionary",
  "jsonValue",
  "uint8Array",
]);

const checks = new Set([
  "is",
  "decodeSync",
  "decodeUnknownSync",
  "decodeEffect",
  "decodeUnknownEffect",
  "decodeUnknownOption",
  "decodeOption",
  "encodeSync",
  "encodeEffect",
  "encodeUnknownSync",
  "encodeUnknownEffect",
]);

export const preferSchemaArbitrary: CreateRule = {
  create(context) {
    const source = context.sourceCode;
    const binding = (id: Node) => {
      if (id.type !== "Identifier") {
        return undefined;
      }

      let scope = source.getScope(id);

      while (scope) {
        const variable = scope.set.get(id.name);

        if (variable) {
          return variable;
        }

        if (!scope.upper) {
          break;
        }

        scope = scope.upper;
      }

      return undefined;
    };
    type Binding = NonNullable<ReturnType<typeof binding>>;
    const initial = (id: Node): Node | undefined => {
      const def = binding(id)?.defs[0]?.node;
      return def?.type === "VariableDeclarator" ? (def.init ?? undefined) : undefined;
    };
    const imported = (id: Node, seen = new Set<Binding>()): { from: string; name: string } | undefined => {
      const variable = binding(id);

      if (!variable || seen.has(variable)) {
        return undefined;
      }

      seen.add(variable);
      const def = variable.defs[0];

      if (def?.type === "ImportBinding" && def.parent?.type === "ImportDeclaration") {
        const spec = def.node;
        return {
          from: def.parent.source.value,
          name:
            spec.type === "ImportSpecifier"
              ? spec.imported.type === "Identifier"
                ? spec.imported.name
                : String(spec.imported.value)
              : "*",
        };
      }

      const init = initial(id);
      return init?.type === "Identifier" ? imported(init, seen) : undefined;
    };
    const moduleName = (node: Node): { from: string; name: string } | undefined => {
      if (node.type === "Identifier") {
        return imported(node);
      }

      if (
        (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") ||
        node.type === "TSQualifiedName"
      ) {
        const object = node.type === "TSQualifiedName" ? node.left : node.object;
        const name = node.type === "TSQualifiedName" ? node.right.name : node.property.name;
        const owner = moduleName(object);
        return owner ? { from: owner.from, name: owner.name === "*" ? name : `${owner.name}.${name}` } : undefined;
      }

      return undefined;
    };
    const fcCall = (node: Node) => {
      if (node.type !== "CallExpression") {
        return undefined;
      }

      const name = moduleName(node.callee);
      return name?.from === "fast-check" ? name.name : undefined;
    };
    const effectCheck = (node: Node) => {
      if (node.type !== "CallExpression") {
        return false;
      }

      const name = moduleName(node.callee);
      return (
        name !== undefined &&
        ((name.from === "effect" && name.name.startsWith("Schema.")) || name.from === "effect/Schema") &&
        checks.has(name.name.split(".").at(-1) ?? "")
      );
    };
    const schema = (node: Node, seen = new Set<Binding>()): string | undefined => {
      if (!["Identifier", "MemberExpression", "TSQualifiedName"].includes(node.type)) {
        return undefined;
      }

      const name = dotted(node);

      if (!name) {
        return undefined;
      }

      if (node.type === "MemberExpression" || node.type === "TSQualifiedName") {
        const origin = moduleName(node);
        return origin &&
          origin.from !== "fast-check" &&
          (origin.from !== "effect" || origin.name.startsWith("Schema.")) &&
          (!origin.from.startsWith("effect/") || origin.from === "effect/Schema")
          ? name
          : undefined;
      }

      const variable = binding(node);

      if (!variable || seen.has(variable)) {
        return undefined;
      }

      seen.add(variable);
      const origin = imported(node);

      if (origin) {
        return origin.from === "fast-check" ||
          (origin.from === "effect" && !origin.name.startsWith("Schema.")) ||
          (origin.from.startsWith("effect/") && origin.from !== "effect/Schema")
          ? undefined
          : name;
      }

      const init = initial(node);

      if (init?.type === "Identifier") {
        return schema(init, seen) ? name : undefined;
      }

      const declaration = variable.defs[0]?.node;

      if (declaration?.type === "ClassDeclaration" && declaration.superClass) {
        let base: Node = declaration.superClass;

        while (base.type === "CallExpression") {
          base = base.callee;
        }

        const factory = moduleName(base);

        if (
          (factory?.from === "effect" && factory.name === "Schema.Class") ||
          (factory?.from === "effect/Schema" && factory.name === "Class")
        ) {
          return name;
        }
      }

      if (
        init?.type === "CallExpression" &&
        [...below(init)].some((part) => {
          const importedName = moduleName(part);
          return (
            importedName &&
            ((importedName.from === "effect" && importedName.name.startsWith("Schema.")) ||
              importedName.from === "effect/Schema")
          );
        })
      ) {
        return name;
      }

      return undefined;
    };
    return {
      "Program:exit"(program) {
        const nodes = [...below(program)];

        if (!nodes.some((node) => constructors.has(fcCall(node) ?? ""))) {
          return;
        }

        const flows = new Map<Binding, Node>();
        const roots = (node: Node, seen = new Set<Binding>()): Node[] => {
          const variable = binding(node);

          if (variable && !seen.has(variable)) {
            seen.add(variable);
            const value = flows.get(variable) ?? initial(node);

            if (value) {
              return roots(value, seen);
            }
          }

          if (constructors.has(fcCall(node) ?? "")) {
            return [node];
          }

          // Follow a transformation's receiver, and sample/property arguments. Nested data
          // constructors stop at their outer call, so a record produces one diagnostic.
          const found: Node[] = [];

          for (const part of below(node)) {
            if (part === node || found.some((outer) => part.start >= outer.start && part.end <= outer.end)) {
              continue;
            }

            if (constructors.has(fcCall(part) ?? "")) {
              found.push(part);
            } else if (part.type === "Identifier") {
              const variable = binding(part);

              if (variable && !seen.has(variable)) {
                found.push(...roots(part, new Set(seen)));
              }
            }
          }

          return [...new Set(found)];
        };

        for (const node of nodes) {
          if (node.type !== "CallExpression" || !["property", "asyncProperty"].includes(fcCall(node) ?? "")) {
            continue;
          }

          const callback = node.arguments.at(-1);

          if (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") {
            continue;
          }

          callback.params.forEach((param, i) => {
            const variable = binding(param);
            const input = node.arguments[i];

            if (variable && input && input.type !== "SpreadElement") {
              flows.set(variable, input);
            }
          });
        }

        const matches = new Map<Node, string>();
        const mark = (value: Node, name: string | undefined) => {
          if (name) {
            for (const root of roots(value)) {
              matches.set(root, name);
            }
          }
        };
        // A check names the whole generated binding. Assembling a new object from fields
        // does not prove those field generators match the checked object's Schema.
        const checkedRoots = (value: Node, seen = new Set<Binding>()): Node[] => {
          const variable = binding(value);

          if (!variable || seen.has(variable)) {
            return [];
          }

          seen.add(variable);
          const input = flows.get(variable);

          if (input) {
            return roots(input);
          }

          const init = initial(value);
          return init?.type === "Identifier" ? checkedRoots(init, seen) : [];
        };
        const arbitraryRoots = (value: Node, seen = new Set<Binding>()): Node[] => {
          if (constructors.has(fcCall(value) ?? "")) {
            return [value];
          }

          if (value.type === "Identifier") {
            const variable = binding(value);

            if (!variable || seen.has(variable) || flows.has(variable)) {
              return [];
            }

            seen.add(variable);
            const init = initial(value);
            return init ? arbitraryRoots(init, seen) : [];
          }

          if (
            value.type === "CallExpression" &&
            value.callee.type === "MemberExpression" &&
            !value.callee.computed &&
            value.callee.property.type === "Identifier" &&
            ["map", "filter", "chain"].includes(value.callee.property.name)
          ) {
            return arbitraryRoots(value.callee.object, seen);
          }

          return [];
        };
        const maker = (node: Node) => {
          if (
            node.type !== "MemberExpression" ||
            node.computed ||
            node.property.type !== "Identifier" ||
            node.property.name !== "make"
          ) {
            return undefined;
          }

          const base = node.object;
          const target =
            base.type === "MemberExpression" &&
            base.object.type === "MemberExpression" &&
            dotted(base.object.property) === "cases"
              ? base.object.object
              : base;
          return schema(target);
        };

        for (const node of nodes) {
          if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
            for (const part of below(node.id)) {
              if (
                part.type !== "TSTypeReference" ||
                moduleName(part.typeName)?.from !== "fast-check" ||
                moduleName(part.typeName)?.name !== "Arbitrary"
              ) {
                continue;
              }

              const query = part.typeArguments?.params[0];

              if (
                query?.type === "TSTypeQuery" &&
                query.exprName.type === "TSQualifiedName" &&
                query.exprName.right.name === "Type"
              ) {
                mark(node.init, schema(query.exprName.left));
              }
            }
          }

          if (node.type !== "CallExpression") {
            continue;
          }

          // A schema check applied to a generated value: Schema.is(S)(value).
          if (effectCheck(node.callee) && node.callee.type === "CallExpression") {
            const target = node.callee.arguments[0];
            const name = target && target.type !== "SpreadElement" ? schema(target) : undefined;

            if (name) {
              for (const arg of node.arguments) {
                if (arg.type !== "SpreadElement") {
                  for (const root of checkedRoots(arg)) {
                    matches.set(root, name);
                  }
                }
              }
            }
          }

          const callee = node.callee;

          if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") {
            continue;
          }

          if (callee.property.name === "map") {
            // A generated array's map is ordinary JavaScript, not Arbitrary.map.
            const inputs = arbitraryRoots(callee.object);

            if (!inputs.length) {
              continue;
            }

            const callback = node.arguments[0];

            if (!callback || callback.type === "SpreadElement") {
              continue;
            }

            const direct = maker(callback);

            if (direct) {
              for (const input of inputs) {
                mark(input, direct);
              }

              continue;
            }

            if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") {
              continue;
            }

            const input = callback.params[0];
            const parameter = input && binding(input);
            const body = callback.body;

            if (!parameter || !body) {
              continue;
            }

            const returns =
              body.type === "BlockStatement"
                ? [...below(body)]
                    .filter((part) => {
                      if (part.type !== "ReturnStatement" || !part.argument) {
                        return false;
                      }

                      let owner: Node | null = part.parent;

                      while (
                        owner &&
                        owner !== callback &&
                        !["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(owner.type)
                      ) {
                        owner = owner.parent;
                      }

                      return owner === callback;
                    })
                    .flatMap((part) => (part.type === "ReturnStatement" && part.argument ? [part.argument] : []))
                : [body];

            for (const returned of returns) {
              if (returned.type !== "CallExpression") {
                continue;
              }

              const name = maker(returned.callee);

              if (!name) {
                continue;
              }

              const carriesInput = returned.arguments.some((arg) =>
                [...below(arg)].some((part) => part.type === "Identifier" && binding(part) === parameter),
              );

              if (carriesInput) {
                for (const input of inputs) {
                  mark(input, name);
                }
              }
            }
          }
        }

        for (const [node, name] of matches) {
          if (
            [...matches.keys()].some((outer) => outer !== node && outer.start <= node.start && outer.end >= node.end)
          ) {
            continue;
          }

          let statement = node;

          while (statement.parent && !["VariableDeclaration", "ExpressionStatement"].includes(statement.type)) {
            statement = statement.parent;
          }

          if (statement.parent?.type === "ExportNamedDeclaration") {
            statement = statement.parent;
          }

          const reasons = source
            .getCommentsBefore(statement)
            .filter((c) => statement.loc.start.line - c.loc.end.line <= 1);

          if (reasons.some((c) => /fast-check:\s*(?:edge cases|unsupported Effect)\s*--\s*\S.+/.test(c.value))) {
            continue;
          }

          context.report({
            node,
            message: `${name} has a matching Schema. Use @effect/vitest it.prop or it.effect.prop with ${name}, or its exported Effect Arbitrary. Keep fast-check for edge cases or unsupported Effect data with a nearby reason.`,
          });
        }
      },
    };
  },
};
