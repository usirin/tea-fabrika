// Today's Electron test drivers. Track lexical bindings, never variable names alone.
import type { CreateRule } from "@oxlint/plugins";
import { pathIn, type Node } from "./match.ts";

type Kind =
  | "electron"
  | "BrowserWindow"
  | "window"
  | "windows"
  | "playwright"
  | "launcher"
  | "app"
  | "handle"
  | "launch"
  | "auditedLaunch";

const key = (node: Node): string | undefined =>
  node.type === "Identifier"
    ? node.name
    : node.type === "Literal" && typeof node.value === "string"
      ? node.value
      : undefined;

const member = (node: Node): string | undefined =>
  node.type === "MemberExpression"
    ? !node.computed && node.property.type === "Identifier"
      ? node.property.name
      : node.property.type === "Literal"
        ? String(node.property.value)
        : undefined
    : undefined;

const playwright = (name: string) => ["playwright", "playwright-core", "@playwright/test"].includes(name);

export const e2eWindows: CreateRule = {
  create(context) {
    const file = pathIn(context);
    const inDrivers = /^apps\/fabrika\/(?:[^/]*e2e\.ts|shots\.ts|src\/testing\/.*\.[cm]?[jt]sx?)$/.test(file);
    const hook = file === "apps/fabrika/src/testing/electron-hook.cjs";
    const launcher = file === "apps/fabrika/src/testing/electron-launch.ts";
    const source = context.sourceCode;
    const binding = (node: Node) => {
      if (node.type !== "Identifier") {
        return undefined;
      }

      let scope = source.getScope(node);

      while (scope) {
        const found = scope.set.get(node.name);

        if (found) {
          return found;
        }

        if (!scope.upper) {
          break;
        }

        scope = scope.upper;
      }

      return undefined;
    };
    type Binding = NonNullable<ReturnType<typeof binding>>;
    interface Write {
      readonly at: number;
      readonly pattern: Node;
      readonly value: Node | null | undefined;
    }
    /** Declarator and assignment writes of a binding, in source order. */
    const writesOf = (variable: Binding): Write[] => {
      const writes: Write[] = [];
      const def = variable.defs[0];

      if (def?.node.type === "VariableDeclarator") {
        writes.push({ at: def.node.range[0], pattern: def.node.id, value: def.node.init });
      }

      for (const ref of variable.references) {
        const parent = (ref.identifier as Node & { parent?: Node }).parent;
        let top: Node | undefined = parent;

        // A destructuring assignment reaches its identifier through array, object and default patterns.
        while (
          top &&
          (top.type === "ArrayPattern" ||
            top.type === "ObjectPattern" ||
            top.type === "Property" ||
            top.type === "AssignmentPattern" ||
            top.type === "RestElement")
        ) {
          top = (top as Node & { parent?: Node }).parent;
        }

        const target = ref.identifier.range;

        if (
          top?.type === "AssignmentExpression" &&
          top.left.range[0] <= target[0] &&
          target[1] <= top.left.range[1] &&
          ["=", "||=", "??=", "&&="].includes(top.operator)
        ) {
          writes.push({ at: top.range[0], pattern: top.left, value: top.right });
        }
      }

      return writes.sort((a, b) => a.at - b.at);
    };
    /** The write a use sees: the last one before it. A use ahead of every write sees any of them. */
    const reaching = (variable: Binding, use: Node): Write[] => {
      const writes = writesOf(variable);
      const before = writes.filter((w) => w.at < use.range[0]);
      return before.length ? [before[before.length - 1] as Write] : writes;
    };
    const hasPosition = (node: Node | null | undefined, seen = new Set<Binding>()): boolean => {
      if (!node) {
        return false;
      }

      if (node.type === "ObjectExpression") {
        return node.properties.some((p) =>
          p.type === "Property"
            ? ["x", "y"].includes(key(p.key) ?? "")
            : p.type === "SpreadElement" && hasPosition(p.argument, seen),
        );
      }

      if (node.type === "TSAsExpression" || node.type === "TSNonNullExpression") {
        return hasPosition(node.expression, seen);
      }

      if (node.type !== "Identifier") {
        return false;
      }

      const variable = binding(node);

      if (!variable || seen.has(variable)) {
        return false;
      }

      seen.add(variable);
      return reaching(variable, node).some(
        (w) => w.pattern.type === "Identifier" && hasPosition(w.value, new Set(seen)),
      );
    };
    const propertyKind = (base: Kind | undefined, name: string | undefined): Kind | undefined => {
      if (base === "electron" && name === "BrowserWindow") {
        return "BrowserWindow";
      }

      if (base === "playwright" && name === "_electron") {
        return "launcher";
      }

      if (base === "launcher" && name === "launch") {
        return "launch";
      }

      if (base === "windows") {
        return "window";
      }

      return undefined;
    };
    const patternKind = (pattern: Node, name: string, base: Kind | undefined): Kind | undefined => {
      if (pattern.type === "Identifier") {
        return pattern.name === name ? base : undefined;
      }

      if (pattern.type === "AssignmentPattern") {
        return patternKind(pattern.left, name, base);
      }

      if (pattern.type === "ObjectPattern") {
        for (const prop of pattern.properties) {
          if (prop.type !== "Property") {
            continue;
          }

          const found = patternKind(prop.value, name, propertyKind(base, key(prop.key)));

          if (found) {
            return found;
          }
        }
      }

      if (pattern.type === "ArrayPattern" && base === "windows") {
        for (const item of pattern.elements) {
          const found = item && patternKind(item, name, "window");

          if (found) {
            return found;
          }
        }
      }

      return undefined;
    };
    const infer = (node: Node | null | undefined, seen = new Set<Binding>()): Kind | undefined => {
      if (!node) {
        return undefined;
      }

      if (node.type === "AwaitExpression") {
        return infer(node.argument, seen);
      }

      if (node.type === "ChainExpression" || node.type === "TSAsExpression" || node.type === "TSNonNullExpression") {
        return infer(node.expression, seen);
      }

      if (node.type === "ImportExpression" && node.source.type === "Literal") {
        return playwright(String(node.source.value))
          ? "playwright"
          : node.source.value === "electron"
            ? "electron"
            : undefined;
      }

      if (node.type === "NewExpression" && infer(node.callee, seen) === "BrowserWindow") {
        return "window";
      }

      if (node.type === "MemberExpression") {
        return propertyKind(infer(node.object, seen), member(node));
      }

      if (node.type === "CallExpression") {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          !binding(node.callee)?.defs.length &&
          node.arguments[0]?.type === "Literal"
        ) {
          const name = String(node.arguments[0].value);
          return playwright(name) ? "playwright" : name === "electron" ? "electron" : undefined;
        }

        if (["launch", "auditedLaunch"].includes(infer(node.callee, new Set(seen)) ?? "")) {
          return "app";
        }

        if (node.callee.type === "MemberExpression") {
          const owner = infer(node.callee.object, seen);
          const method = member(node.callee);

          if (owner === "BrowserWindow" && method === "getAllWindows") {
            return "windows";
          }

          if (
            owner === "BrowserWindow" &&
            ["getFocusedWindow", "fromId", "fromWebContents", "fromBrowserView"].includes(method ?? "")
          ) {
            return "window";
          }

          if (owner === "app" && method === "browserWindow") {
            return "handle";
          }
        }

        return undefined;
      }

      if (node.type !== "Identifier") {
        return undefined;
      }

      const variable = binding(node);

      if (!variable || seen.has(variable)) {
        return undefined;
      }

      seen.add(variable);
      const def = variable.defs[0];

      if (def?.type === "ImportBinding" && def.parent?.type === "ImportDeclaration") {
        if (def.parent.importKind === "type") {
          return undefined;
        }

        const from = def.parent.source.value;
        const spec = def.node;
        const name = spec.type === "ImportSpecifier" ? key(spec.imported) : "*";

        if (from === "electron") {
          return name === "*" ? "electron" : propertyKind("electron", name);
        }

        if (playwright(from)) {
          return name === "*" ? "playwright" : propertyKind("playwright", name);
        }

        if (from.endsWith("electron-launch.ts") && name === "launchElectron") {
          return "auditedLaunch";
        }
      }

      if (def?.node.type === "VariableDeclarator") {
        for (const w of reaching(variable, node)) {
          const found = patternKind(w.pattern, node.name, infer(w.value, new Set(seen)));

          if (found) {
            return found;
          }
        }

        return undefined;
      }

      if (def?.type === "Parameter") {
        const fn = def.node;

        if (
          fn.type !== "ArrowFunctionExpression" &&
          fn.type !== "FunctionExpression" &&
          fn.type !== "FunctionDeclaration"
        ) {
          return undefined;
        }

        const param = fn.params[0];

        if (!param) {
          return undefined;
        }

        const parent = fn.parent;

        if (
          parent?.type === "CallExpression" &&
          parent.callee.type === "MemberExpression" &&
          member(parent.callee) === "evaluate"
        ) {
          const owner = infer(parent.callee.object, seen);
          // Electron evaluate callbacks expose BrowserWindow explicitly. DOM callbacks do not.
          const native =
            owner === "app" ||
            (param.type === "ObjectPattern" &&
              param.properties.some((p) => p.type === "Property" && key(p.key) === "BrowserWindow"));
          return patternKind(param, node.name, owner === "handle" ? "window" : native ? "electron" : undefined);
        }

        if (
          param.type === "Identifier" &&
          param.typeAnnotation?.type === "TSTypeAnnotation" &&
          param.typeAnnotation.typeAnnotation.type === "TSTypeReference"
        ) {
          const type = param.typeAnnotation.typeAnnotation.typeName;
          const imported = binding(type)?.defs[0];

          if (
            imported?.type === "ImportBinding" &&
            imported.node.type === "ImportSpecifier" &&
            key(imported.node.imported) === "ElectronApplication"
          ) {
            return patternKind(param, node.name, "app");
          }
        }
      }

      return undefined;
    };
    return {
      CallExpression(node) {
        if (!launcher && infer(node.callee) === "launch") {
          context.report({
            node,
            message: "Launch Electron through src/testing/electron-launch.ts inside runE2e.",
          });
        }

        if (!inDrivers || hook || node.callee.type !== "MemberExpression" || infer(node.callee.object) !== "window") {
          return;
        }

        const method = member(node.callee);
        const bounds = node.arguments[0];
        const position = method === "setBounds" && hasPosition(bounds);

        if (
          ["show", "focus", "setOpacity", "setIgnoreMouseEvents", "capturePage", "setPosition", "center"].includes(
            method ?? "",
          ) ||
          position
        ) {
          context.report({
            node,
            message:
              "The Electron hook owns native hiding and position. Use page.screenshot and size-only bounds; DOM focus is allowed.",
          });
        }
      },
    };
  },
};
