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
      /** The declarator or assignment expression. */
      readonly node: Node;
      readonly pattern: Node;
      readonly value: Node | null | undefined;
    }
    /** Declarator and assignment writes of a binding, in source order. */
    const writesOf = (variable: Binding): Write[] => {
      const writes: Write[] = [];
      const def = variable.defs[0];

      if (def?.node.type === "VariableDeclarator") {
        writes.push({ at: def.node.range[0], node: def.node, pattern: def.node.id, value: def.node.init });
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
          writes.push({ at: top.range[0], node: top, pattern: top.left, value: top.right });
        }
      }

      return writes.sort((a, b) => a.at - b.at);
    };
    /**
     * True when the write always runs before a use in its own straight-line block: a plain `=` (or
     * declarator) reached from a statement list that contains the use, through nothing conditional.
     */
    const replaces = (w: Write, use: Node): boolean => {
      if (w.node.type === "AssignmentExpression" && w.node.operator !== "=") {
        return false;
      }

      let at: Node | undefined = w.node;

      while (at) {
        const parent: Node | undefined = (at as Node & { parent?: Node }).parent;

        if (!parent) {
          return false;
        }

        if (parent.type === "BlockStatement" || parent.type === "Program" || parent.type === "StaticBlock") {
          // A try block only runs in part when it throws, so it never replaces for a use outside it.
          return parent.range[0] <= use.range[0] && use.range[1] <= parent.range[1];
        }

        if (
          parent.type !== "ExpressionStatement" &&
          parent.type !== "VariableDeclaration" &&
          parent.type !== "VariableDeclarator" &&
          parent.type !== "AssignmentExpression" &&
          parent.type !== "SequenceExpression" &&
          parent.type !== "AwaitExpression" &&
          parent.type !== "TSAsExpression" &&
          parent.type !== "TSNonNullExpression" &&
          parent.type !== "ParenthesizedExpression"
        ) {
          return false;
        }

        at = parent;
      }

      return false;
    };
    /**
     * The writes a use may see: the last one before it, plus every earlier write back to the nearest
     * one that always runs. A use ahead of every write sees any of them.
     */
    const reaching = (variable: Binding, use: Node): Write[] => {
      const writes = writesOf(variable);
      const before = writes.filter((w) => w.at < use.range[0]);

      if (!before.length) {
        return writes;
      }

      const seen: Write[] = [];

      for (let i = before.length - 1; i >= 0; i--) {
        const w = before[i] as Write;
        seen.push(w);

        if (replaces(w, use)) {
          break;
        }
      }

      return seen;
    };
    /** The values an expression can take: both arms of `?:`, `??`, `||` and `&&`. */
    const arms = (node: Node | null | undefined): Node[] => {
      if (!node) {
        return [];
      }

      if (node.type === "ConditionalExpression") {
        return [...arms(node.consequent), ...arms(node.alternate)];
      }

      if (node.type === "LogicalExpression") {
        return [...arms(node.left), ...arms(node.right)];
      }

      return [node];
    };
    const hasPosition = (node: Node | null | undefined, seen = new Set<Binding>()): boolean => {
      if (!node) {
        return false;
      }

      if (node.type === "ConditionalExpression" || node.type === "LogicalExpression") {
        return arms(node).some((arm) => hasPosition(arm, new Set(seen)));
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
    const unique = (kinds: Kind[]): Kind[] => [...new Set(kinds)];
    const propertyOf = (base: Kind, name: string | undefined): Kind | undefined => {
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
    /** Every kind a property of any base kind can be. */
    const propertyKind = (bases: readonly Kind[], name: string | undefined): Kind[] =>
      unique(bases.flatMap((base) => propertyOf(base, name) ?? []));
    const patternKind = (pattern: Node, name: string, bases: readonly Kind[]): Kind[] => {
      if (pattern.type === "Identifier") {
        return pattern.name === name ? [...bases] : [];
      }

      if (pattern.type === "AssignmentPattern") {
        return patternKind(pattern.left, name, bases);
      }

      if (pattern.type === "ObjectPattern") {
        return unique(
          pattern.properties.flatMap((prop) =>
            prop.type === "Property" ? patternKind(prop.value, name, propertyKind(bases, key(prop.key))) : [],
          ),
        );
      }

      if (pattern.type === "ArrayPattern" && bases.includes("windows")) {
        return unique(pattern.elements.flatMap((item) => (item ? patternKind(item, name, ["window"]) : [])));
      }

      return [];
    };
    const named = (name: string): Kind[] =>
      playwright(name) ? ["playwright"] : name === "electron" ? ["electron"] : [];
    /** The set of every recognized kind that can reach an expression. */
    const infer = (node: Node | null | undefined, seen = new Set<Binding>()): Kind[] => {
      if (!node) {
        return [];
      }

      if (node.type === "ConditionalExpression" || node.type === "LogicalExpression") {
        return unique(arms(node).flatMap((arm) => infer(arm, new Set(seen))));
      }

      if (node.type === "AwaitExpression") {
        return infer(node.argument, seen);
      }

      if (node.type === "ChainExpression" || node.type === "TSAsExpression" || node.type === "TSNonNullExpression") {
        return infer(node.expression, seen);
      }

      if (node.type === "ImportExpression" && node.source.type === "Literal") {
        return named(String(node.source.value));
      }

      if (node.type === "NewExpression") {
        return infer(node.callee, seen).includes("BrowserWindow") ? ["window"] : [];
      }

      if (node.type === "MemberExpression") {
        return propertyKind(infer(node.object, seen), member(node));
      }

      if (node.type === "CallExpression") {
        const found: Kind[] = [];

        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          !binding(node.callee)?.defs.length &&
          node.arguments[0]?.type === "Literal"
        ) {
          return named(String(node.arguments[0].value));
        }

        if (infer(node.callee, new Set(seen)).some((k) => k === "launch" || k === "auditedLaunch")) {
          found.push("app");
        }

        if (node.callee.type === "MemberExpression") {
          const owners = infer(node.callee.object, seen);
          const method = member(node.callee);

          if (owners.includes("BrowserWindow") && method === "getAllWindows") {
            found.push("windows");
          }

          if (
            owners.includes("BrowserWindow") &&
            ["getFocusedWindow", "fromId", "fromWebContents", "fromBrowserView"].includes(method ?? "")
          ) {
            found.push("window");
          }

          if (owners.includes("app") && method === "browserWindow") {
            found.push("handle");
          }
        }

        return unique(found);
      }

      if (node.type !== "Identifier") {
        return [];
      }

      const variable = binding(node);

      if (!variable || seen.has(variable)) {
        return [];
      }

      seen.add(variable);
      const def = variable.defs[0];

      if (def?.type === "ImportBinding" && def.parent?.type === "ImportDeclaration") {
        if (def.parent.importKind === "type") {
          return [];
        }

        const from = def.parent.source.value;
        const spec = def.node;
        const name = spec.type === "ImportSpecifier" ? key(spec.imported) : "*";

        if (from === "electron") {
          return name === "*" ? ["electron"] : propertyKind(["electron"], name);
        }

        if (playwright(from)) {
          return name === "*" ? ["playwright"] : propertyKind(["playwright"], name);
        }

        if (from.endsWith("electron-launch.ts") && name === "launchElectron") {
          return ["auditedLaunch"];
        }
      }

      if (def?.node.type === "VariableDeclarator") {
        return unique(
          reaching(variable, node).flatMap((w) => patternKind(w.pattern, node.name, infer(w.value, new Set(seen)))),
        );
      }

      if (def?.type === "Parameter") {
        const fn = def.node;

        if (
          fn.type !== "ArrowFunctionExpression" &&
          fn.type !== "FunctionExpression" &&
          fn.type !== "FunctionDeclaration"
        ) {
          return [];
        }

        const param = fn.params[0];

        if (!param) {
          return [];
        }

        const parent = fn.parent;

        if (
          parent?.type === "CallExpression" &&
          parent.callee.type === "MemberExpression" &&
          member(parent.callee) === "evaluate"
        ) {
          const owners = infer(parent.callee.object, seen);
          // Electron evaluate callbacks expose BrowserWindow explicitly. DOM callbacks do not.
          const native =
            owners.includes("app") ||
            (param.type === "ObjectPattern" &&
              param.properties.some((p) => p.type === "Property" && key(p.key) === "BrowserWindow"));
          const passed: Kind[] = [];

          if (owners.includes("handle")) {
            passed.push("window");
          }

          if (native) {
            passed.push("electron");
          }

          return patternKind(param, node.name, passed);
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
            return patternKind(param, node.name, ["app"]);
          }
        }
      }

      return [];
    };
    return {
      CallExpression(node) {
        if (!launcher && infer(node.callee).includes("launch")) {
          context.report({
            node,
            message: "Launch Electron through src/testing/electron-launch.ts inside runE2e.",
          });
        }

        if (
          !inDrivers ||
          hook ||
          node.callee.type !== "MemberExpression" ||
          !infer(node.callee.object).includes("window")
        ) {
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
