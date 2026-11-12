// Decision 0046, next/ and .agents/: one exported tea machine or factory per file, with local
// model, msg and update, and no imports from the closed I/O list below. Private top-level helpers
// used inside a parent's Machine.make arguments do not count. An exported program wrapping a
// private machine does count. A factory's two calls count twice, even if one is a helper.
// A msg of Effect's Schema.Never passes: it says the machine has no messages (plan amendment A1).
// Misses: aliases of Machine.make, destructuring, re-exports and machines made by imported helpers.
// Review keeps control-state judgment, relative/workspace I/O, globals, dynamic imports, hand edits
// of another file's Model, and whether a factory returns its machine or receives a service.
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import { ancestors, below, type Node } from "./match.ts";

const TEA = new Set(["@demlik/tea", "@demlik/tea/effect"]);

const IO_NAMES = new Set([
  "Effect",
  "Layer",
  "Context",
  "ManagedRuntime",
  "Fiber",
  "Scope",
  "Clock",
  "Random",
  "Schedule",
  "FileSystem",
  "Path",
  "Config",
  "ConfigProvider",
  "Console",
  "Stream",
  "Queue",
  "PubSub",
  "Ref",
  "Deferred",
  "Semaphore",
  "Sink",
]);

const TEA_RUNNERS = new Set([
  "run",
  "runIn",
  "spawn",
  "stop",
  "tell",
  "EffectRun",
  "EffectInterpret",
  "EffectSubscribe",
]);

const IO_MODULES = [
  /^node:/,
  /^@effect\//,
  /^effect\/(process|http|cli|unstable)(\/|$)/,
  /^cloudflare:/,
  /^(miniflare|workerd|wrangler)(\/|$)/,
  /^@cloudflare\//,
];

const member = (node: ESTree.MemberExpression): string | null =>
  !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : node.computed && node.property.type === "Literal" && typeof node.property.value === "string"
      ? node.property.value
      : null;

const importedName = (spec: ESTree.ImportDeclaration["specifiers"][number]): string =>
  spec.type === "ImportSpecifier"
    ? spec.imported.type === "Identifier"
      ? spec.imported.name
      : String(spec.imported.value)
    : "*";

export const oneMachinePerFile: CreateRule = {
  create(context) {
    const resolve = (node: Node): Variable | undefined => {
      if (node.type !== "Identifier") {
        return undefined;
      }

      let scope: Scope | null = context.sourceCode.getScope(node);

      while (scope !== null) {
        const found = scope.set.get(node.name);

        if (found !== undefined) {
          return found;
        }

        scope = scope.upper;
      }

      return undefined;
    };
    const imported = (node: Node) => {
      const def = resolve(node)?.defs[0];
      return def?.type === "ImportBinding" &&
        def.parent?.type === "ImportDeclaration" &&
        def.parent.importKind !== "type" &&
        !(def.node.type === "ImportSpecifier" && def.node.importKind === "type")
        ? { from: def.parent.source.value, name: importedName(def.node) }
        : null;
    };
    const maker = (node: Node): boolean => {
      if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || member(node.callee) !== "make") {
        return false;
      }

      const object = node.callee.object;

      if (object.type === "Identifier") {
        const at = imported(object);
        return at !== null && TEA.has(at.from) && at.name === "Machine";
      }

      if (object.type === "MemberExpression" && member(object) === "Machine") {
        const at = imported(object.object);
        return at !== null && TEA.has(at.from) && at.name === "*";
      }

      return false;
    };
    const rootImported = (node: Node): boolean =>
      node.type === "MemberExpression" ? rootImported(node.object) : imported(node) !== null;
    const neverMsg = (node: Node): boolean => {
      if (node.type !== "MemberExpression" || member(node) !== "Never") {
        return false;
      }

      const at = imported(node.object);
      return at?.from === "effect" && at.name === "Schema";
    };

    return {
      "Program:exit"(program) {
        const calls = [...below(program)].filter(
          (n): n is ESTree.CallExpression => n.type === "CallExpression" && maker(n),
        );
        const reached = new Set<Node>();
        const roots = new Set<Node>();

        // Each root is one exported statement or a top-level binding reached from one.
        for (const statement of program.body) {
          if (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") {
            if (
              !(
                statement.type === "ExportNamedDeclaration" &&
                (statement.source !== null || statement.exportKind === "type")
              )
            ) {
              roots.add(statement);
            }
          }
        }

        for (const root of roots) {
          for (const node of below(root)) {
            if (maker(node)) {
              reached.add(node);
            }

            if (node.type !== "Identifier" || [...ancestors(node)].some((a) => a !== root && maker(a))) {
              continue;
            }

            if (node.parent.type === "ExportSpecifier" && node.parent.exportKind === "type") {
              continue;
            }

            const variable = resolve(node);

            if (!variable?.references.some((ref) => ref.identifier === node)) {
              continue;
            }

            const binding = variable.defs[0]?.node;

            if (
              binding === undefined ||
              (binding.type !== "VariableDeclarator" && binding.type !== "FunctionDeclaration")
            ) {
              continue;
            }

            const parents = [...ancestors(binding)];
            const top = binding.type === "FunctionDeclaration" ? parents[0] : parents[1];

            if (top?.type === "Program") {
              roots.add(binding);
            }
          }
        }

        const exported = calls.filter((call) => reached.has(call));

        for (const call of exported.slice(1)) {
          context.report({
            node: call,
            message:
              "A file exports at most one tea machine or one factory (0046). Move the second machine to its own file, or a helper to a private top-level binding.",
          });
        }

        for (const call of exported) {
          const config = call.arguments[0];

          if (config?.type !== "ObjectExpression") {
            continue;
          }

          for (const prop of config.properties) {
            if (prop.type !== "Property") {
              continue;
            }

            const name =
              prop.key.type === "Identifier" && !prop.computed
                ? prop.key.name
                : prop.key.type === "Literal"
                  ? prop.key.value
                  : null;

            if (
              (name === "model" || name === "msg" || name === "update") &&
              rootImported(prop.value) &&
              !(name === "msg" && neverMsg(prop.value))
            ) {
              context.report({
                node: prop,
                message: `The machine's ${name} must be defined in this file, not imported (0046).`,
              });
            }
          }
        }

        if (calls.length === 0) {
          return;
        }

        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration" || statement.importKind === "type") {
            continue;
          }

          const from = statement.source.value;
          const values = statement.specifiers.filter((s) => s.type !== "ImportSpecifier" || s.importKind !== "type");
          const io =
            (IO_MODULES.some((pattern) => pattern.test(from)) &&
              (statement.specifiers.length === 0 || values.length > 0)) ||
            values.some(
              (s) =>
                (from === "effect" && (importedName(s) === "*" || IO_NAMES.has(importedName(s)))) ||
                (from === "@demlik/tea/effect" && TEA_RUNNERS.has(importedName(s))),
            );

          if (io) {
            context.report({
              node: statement,
              message: "A tea machine file has no input or output imports (0046). Put the driver in another file.",
            });
          }
        }
      },
    };
  },
};
