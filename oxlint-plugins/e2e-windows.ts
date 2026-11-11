// Today's Electron test drivers. Track lexical bindings, never variable names alone.
import type { CreateRule } from "@oxlint/plugins";
import { pathIn, type Node } from "./match.ts";

type Kind =
  | "electron"
  | "BrowserWindow"
  | "window"
  | "windows"
  | "apps"
  | "handles"
  | "windowPairs"
  | "windowPair"
  | "playwright"
  | "launcher"
  | "app"
  | "handle"
  | "launch"
  | "auditedLaunch"
  | "require"
  | "createRequire"
  | "nodeModule";

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
    type MemberNode = Extract<Node, { type: "MemberExpression" }>;
    type CallNode = Extract<Node, { type: "CallExpression" }>;
    interface Write {
      readonly at: number;
      /** The declarator, assignment expression, loop or function that writes. */
      readonly node: Node;
      readonly pattern: Node;
      readonly value: Node | null | undefined;
      /** Each element of `value` is bound, as in a for-of head. */
      readonly each?: boolean;
      /** The kinds this write hands to its pattern. */
      readonly base: (seen: Set<Binding>) => Kind[];
    }
    const parentOf = (node: Node): Node | undefined => (node as Node & { parent?: Node }).parent;
    const within = (inner: readonly [number, number], outer: readonly [number, number]) =>
      outer[0] <= inner[0] && inner[1] <= outer[1];
    /** The expression a wrapper passes through: `?.` chains, casts, parentheses and a sequence's last value. */
    const inner = (node: Node): Node | undefined => {
      switch (node.type) {
        case "ChainExpression":
        case "TSAsExpression":
        case "TSNonNullExpression":
        case "TSSatisfiesExpression":
        case "TSTypeAssertion":
        case "TSInstantiationExpression":
        case "ParenthesizedExpression":
          return node.expression;
        case "SequenceExpression":
          return node.expressions.at(-1);
        default:
          return undefined;
      }
    };
    const strip = (node: Node): Node => {
      let at = node;

      for (let next = inner(at); next; next = inner(at)) {
        at = next;
      }

      return at;
    };
    const propKey = (prop: { key: Node; computed?: boolean }): string | undefined =>
      prop.computed && prop.key.type === "Identifier" ? undefined : key(prop.key);
    const lists = {
      element: ["at", "find", "findLast", "pop", "shift"],
      array: [
        "filter",
        "slice",
        "toSorted",
        "toReversed",
        "concat",
        "reverse",
        "sort",
        "splice",
        "toSpliced",
        "with",
        "flat",
      ],
      callback: [
        "forEach",
        "map",
        "filter",
        "find",
        "findLast",
        "findIndex",
        "findLastIndex",
        "some",
        "every",
        "flatMap",
      ],
    };
    /** The writes an assignment, destructuring assignment or for-of head makes through these references. */
    const refWrites = (refs: Iterable<{ identifier: Node }>): Write[] => {
      const writes: Write[] = [];

      for (const ref of refs) {
        let child: Node = ref.identifier;
        let top: Node | undefined = parentOf(child);

        // A destructuring write reaches its identifier through array, object, default and rest patterns.
        while (top) {
          if (top.type === "Property" && !within(ref.identifier.range, top.value.range)) {
            top = undefined;
          } else if (top.type === "AssignmentPattern" && !within(ref.identifier.range, top.left.range)) {
            top = undefined;
          } else if (
            top.type === "ArrayPattern" ||
            top.type === "ObjectPattern" ||
            top.type === "Property" ||
            top.type === "AssignmentPattern" ||
            top.type === "RestElement"
          ) {
            child = top;
            top = parentOf(top);
            continue;
          }

          break;
        }

        const target = ref.identifier.range;

        if (
          top?.type === "AssignmentExpression" &&
          within(target, top.left.range) &&
          ["=", "||=", "??=", "&&="].includes(top.operator)
        ) {
          const right = top.right;
          writes.push({
            at: top.range[0],
            node: top,
            pattern: top.left,
            value: right,
            base: (seen) => infer(right, seen),
          });
        } else if (top?.type === "ForOfStatement" && within(target, top.left.range)) {
          const right = top.right;
          writes.push({
            at: top.left.range[0],
            node: top,
            pattern: top.left,
            value: right,
            each: true,
            base: (seen) => elementsOf(infer(right, seen)),
          });
        }
      }

      return writes;
    };
    /** Writes of a binding, in source order: its definitions, then every assignment and for-of head. */
    const writesOf = (variable: Binding): Write[] => {
      const writes: Write[] = [];

      for (const def of variable.defs) {
        if (def.node.type === "VariableDeclarator") {
          const declarator = def.node;
          const head = parentOf(parentOf(declarator) ?? declarator);
          const loop = head?.type === "ForOfStatement" || head?.type === "ForInStatement" ? head : undefined;
          const each = loop?.type === "ForOfStatement";
          const from = each ? loop?.right : declarator.init;

          writes.push({
            at: declarator.range[0],
            node: declarator,
            pattern: declarator.id,
            value: from,
            each,
            base: (seen) =>
              loop?.type === "ForInStatement" ? [] : each ? elementsOf(infer(from, seen)) : infer(from, seen),
          });
        }

        if (def.type === "Parameter") {
          const fn = def.node;

          if (
            fn.type === "ArrowFunctionExpression" ||
            fn.type === "FunctionExpression" ||
            fn.type === "FunctionDeclaration"
          ) {
            const index = fn.params.findIndex((p) => within(def.name.range, p.range));
            const param = fn.params[index];

            if (param) {
              writes.push({
                at: param.range[0],
                node: fn,
                pattern: param.type === "TSParameterProperty" ? param.parameter : param,
                value: undefined,
                base: (seen) => paramKinds(fn, index, seen),
              });
            }
          }
        }
      }

      writes.push(...refWrites(variable.references));

      return writes.sort((a, b) => a.at - b.at);
    };
    /**
     * True when the write always runs before a use in its own straight-line block: a plain `=` (or
     * declarator) reached from a statement list that contains the use, through nothing conditional.
     */
    const replaces = (w: Write, use: Node): boolean => {
      if (w.each || (w.node.type === "AssignmentExpression" && w.node.operator !== "=")) {
        return false;
      }

      let at: Node | undefined = w.node;

      while (at) {
        const parent: Node | undefined = parentOf(at);

        if (!parent) {
          return false;
        }

        if (parent.type === "BlockStatement" || parent.type === "Program" || parent.type === "StaticBlock") {
          // A try block only runs in part when it throws, so it never replaces for a use outside it.
          return within(use.range, parent.range);
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
          parent.type !== "TSSatisfiesExpression" &&
          parent.type !== "TSTypeAssertion" &&
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
     * one that always runs. A use ahead of every write sees any. A use inside a closure is placed where
     * the closure begins, and also sees every write after that, since the closure may run later.
     */
    const reaching = (variable: Binding, use: Node): Write[] => {
      const writes = writesOf(variable);
      const scope = variable.scope.variableScope;
      let anchor = use;

      while (source.getScope(anchor).variableScope !== scope) {
        const parent = parentOf(anchor);

        if (!parent) {
          return writes;
        }

        if (source.getScope(parent).variableScope === scope) {
          break;
        }

        anchor = parent;
      }

      const before = writes.filter((w) => w.at < anchor.range[0]);

      if (!before.length) {
        return writes;
      }

      const seen: Write[] = anchor === use ? [] : writes.filter((w) => w.at >= anchor.range[0]);

      for (let i = before.length - 1; i >= 0; i--) {
        const w = before[i] as Write;
        seen.push(w);

        if (replaces(w, anchor)) {
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
            ? ["x", "y"].includes(propKey(p) ?? "")
            : p.type === "SpreadElement" && hasPosition(p.argument, seen),
        );
      }

      if (node.type === "AssignmentExpression" && node.operator === "=") {
        return hasPosition(node.right, seen);
      }

      const next = inner(node);

      if (next) {
        return hasPosition(next, seen);
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
        (w) => w.pattern.type === "Identifier" && !w.each && hasPosition(w.value, new Set(seen)),
      );
    };
    const unique = (kinds: Kind[]): Kind[] => [...new Set(kinds)];
    /** Lists hold one kind of element: windows, apps, handles, and a window list's `[index, window]` pairs. */
    const listOf: Partial<Record<Kind, Kind>> = { window: "windows", app: "apps", handle: "handles" };
    const elementOf: Partial<Record<Kind, Kind>> = {
      windows: "window",
      apps: "app",
      handles: "handle",
      windowPairs: "windowPair",
    };
    const elementsOf = (kinds: readonly Kind[]): Kind[] => unique(kinds.flatMap((k) => elementOf[k] ?? []));
    const listsOf = (kinds: readonly Kind[]): Kind[] => unique(kinds.filter((k) => k in elementOf));
    const lift = (kinds: readonly Kind[]): Kind[] => unique(kinds.flatMap((k) => listOf[k] ?? []));
    const propertyOf = (base: Kind, name: string | undefined): Kind | undefined => {
      if ((base === "electron" || base === "playwright" || base === "nodeModule") && name === "default") {
        return base;
      }

      if (base === "electron" && name === "BrowserWindow") {
        return "BrowserWindow";
      }

      if (base === "playwright" && name === "_electron") {
        return "launcher";
      }

      if (base === "launcher" && name === "launch") {
        return "launch";
      }

      if (base === "nodeModule" && name === "createRequire") {
        return "createRequire";
      }

      if (base === "windowPair") {
        return name === undefined || name === "1" ? "window" : undefined;
      }

      return elementOf[base];
    };
    /** Every kind a property of any base kind can be. */
    const propertyKind = (bases: readonly Kind[], name: string | undefined): Kind[] =>
      unique(bases.flatMap((base) => propertyOf(base, name) ?? []));
    /** `: ElectronApplication`, written plainly or through a namespace import. */
    const typedApp = (pattern: Node): boolean => {
      const type = pattern.type === "Identifier" ? pattern.typeAnnotation?.typeAnnotation : undefined;

      if (type?.type !== "TSTypeReference") {
        return false;
      }

      const name = type.typeName;

      if (name.type === "TSQualifiedName") {
        return (
          name.right.name === "ElectronApplication" && binding(name.left as Node)?.defs[0]?.type === "ImportBinding"
        );
      }

      const imported = binding(name)?.defs[0];
      return (
        imported?.type === "ImportBinding" &&
        imported.node.type === "ImportSpecifier" &&
        key(imported.node.imported) === "ElectronApplication"
      );
    };
    /**
     * The kinds `name` takes inside a pattern whose whole value has the kinds `bases`. A default adds
     * the default's kinds. Object rest keeps its base; array rest of windows is windows, other items are one.
     */
    const patternKind = (pattern: Node, name: string, bases: readonly Kind[], seen: Set<Binding>): Kind[] => {
      if (pattern.type === "Identifier") {
        return pattern.name === name ? unique([...bases, ...(typedApp(pattern) ? (["app"] as const) : [])]) : [];
      }

      if (pattern.type === "AssignmentPattern") {
        return patternKind(pattern.left, name, unique([...bases, ...infer(pattern.right, new Set(seen))]), seen);
      }

      if (pattern.type === "TSParameterProperty") {
        return patternKind(pattern.parameter, name, bases, seen);
      }

      if (pattern.type === "ObjectPattern") {
        return unique(
          pattern.properties.flatMap((prop) =>
            prop.type === "Property"
              ? patternKind(prop.value, name, propertyKind(bases, propKey(prop)), seen)
              : prop.type === "RestElement"
                ? patternKind(prop.argument, name, bases, seen)
                : [],
          ),
        );
      }

      if (pattern.type === "ArrayPattern") {
        const elements = elementsOf(bases);
        const rest = listsOf(bases);
        const pair = bases.includes("windowPair");
        return unique(
          pattern.elements.flatMap((item, i) =>
            item?.type === "RestElement"
              ? patternKind(item.argument, name, rest, seen)
              : item
                ? patternKind(
                    item,
                    name,
                    unique([...elements, ...(pair && i === 1 ? (["window"] as const) : [])]),
                    seen,
                  )
                : [],
          ),
        );
      }

      return [];
    };
    const named = (name: string): Kind[] =>
      playwright(name)
        ? ["playwright"]
        : name === "electron"
          ? ["electron"]
          : name === "node:module" || name === "module"
            ? ["nodeModule"]
            : [];
    const sameNode = (a: Node, b: Node) => a.range[0] === b.range[0] && a.range[1] === b.range[1];
    interface Uses {
      /** Calls with the function as an argument (the first, or `Array.from`'s second), and the member they call. */
      readonly passed: Array<{ call: CallNode; callee: MemberNode; method: string | undefined; index: number }>;
      /** Calls of the function itself. */
      readonly called: CallNode[];
    }
    /**
     * Where a function goes. It is written in a call, or held by a local name (declaration, `const`,
     * `let`, `var`, reassignment, alias) and carried through casts, `?:`, `??`, `||` and `&&`. A function
     * from another module stays unseen.
     */
    const usesOf = (fn: Node): Uses => {
      const uses: Uses = { passed: [], called: [] };
      const followed = new Set<Binding>();
      const follow = (variable: Binding | undefined) => {
        if (!variable || followed.has(variable)) {
          return;
        }

        followed.add(variable);

        for (const ref of variable.references) {
          land(ref.identifier);
        }
      };
      const land = (start: Node) => {
        let at = start;
        let parent = parentOf(at);

        while (parent) {
          if (
            inner(parent) === undefined &&
            parent.type !== "ConditionalExpression" &&
            parent.type !== "LogicalExpression" &&
            parent.type !== "AssignmentExpression"
          ) {
            break;
          }

          if (parent.type === "SequenceExpression" && !sameNode(parent.expressions.at(-1) as Node, at)) {
            break;
          }

          if (parent.type === "ConditionalExpression" && sameNode(parent.test, at)) {
            break;
          }

          if (parent.type === "AssignmentExpression") {
            if (!["=", "||=", "??=", "&&="].includes(parent.operator) || !sameNode(parent.right, at)) {
              break;
            }

            if (parent.left.type === "Identifier") {
              follow(binding(parent.left));
            }
          }

          at = parent;
          parent = parentOf(at);
        }

        if (parent?.type === "CallExpression") {
          const callee = strip(parent.callee);

          if (sameNode(parent.callee, at)) {
            uses.called.push(parent);
          } else if (callee.type === "MemberExpression") {
            const method = member(callee);
            const index = parent.arguments.findIndex((a) => sameNode(a, at));

            if (index === 0 || (index === 1 && method === "from")) {
              uses.passed.push({ call: parent, callee, method, index });
            }
          }
        } else if (
          parent?.type === "VariableDeclarator" &&
          parent.init &&
          sameNode(parent.init, at) &&
          parent.id.type === "Identifier"
        ) {
          follow(binding(parent.id));
        }
      };

      if (fn.type === "FunctionDeclaration") {
        follow(fn.id ? binding(fn.id) : undefined);
      } else {
        land(fn);
      }

      return uses;
    };
    const isFunction = (node: Node) =>
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";
    /** The `return` arguments of one function, not of the functions inside it. */
    const returnsIn = (node: Node, out: Node[]) => {
      for (const [name, value] of Object.entries(node)) {
        if (name === "parent" || name === "range") {
          continue;
        }

        for (const child of Array.isArray(value) ? value : [value]) {
          if (!child || typeof child !== "object" || typeof child.type !== "string") {
            continue;
          }

          if (child.type === "ReturnStatement") {
            if (child.argument) {
              out.push(child.argument);
            }
          } else if (!isFunction(child)) {
            returnsIn(child, out);
          }
        }
      }
    };
    /** The functions an expression can be: written there, or held by a local name through arms and casts. */
    const functionsOf = (node: Node | null | undefined, seen = new Set<Binding>()): Node[] => {
      if (!node) {
        return [];
      }

      const at = strip(node);

      if (at.type === "ConditionalExpression" || at.type === "LogicalExpression") {
        return arms(at).flatMap((arm) => functionsOf(arm, seen));
      }

      if (isFunction(at)) {
        return [at];
      }

      if (at.type !== "Identifier") {
        return [];
      }

      const variable = binding(at);

      if (!variable || seen.has(variable)) {
        return [];
      }

      seen.add(variable);
      return [
        ...variable.defs.flatMap((def) => (def.node.type === "FunctionDeclaration" ? [def.node as Node] : [])),
        ...reaching(variable, at).flatMap((w) =>
          w.pattern.type === "Identifier" && !w.each ? functionsOf(w.value, seen) : [],
        ),
      ];
    };
    const running = new Set<string>();
    /** What a local function hands back: an expression body, or every `return` in a block body. */
    const returnKinds = (fn: Node, seen: Set<Binding>): Kind[] => {
      if (!isFunction(fn)) {
        return [];
      }

      const id = `${fn.range[0]}:${fn.range[1]}`;

      if (running.has(id)) {
        return [];
      }

      running.add(id);

      try {
        const returned: Node[] = [];

        if (fn.body.type === "BlockStatement") {
          returnsIn(fn.body, returned);
        } else {
          returned.push(fn.body);
        }

        return unique(returned.flatMap((value) => infer(value, new Set(seen))));
      } finally {
        running.delete(id);
      }
    };
    /** The kinds of what a call's first-argument callbacks return. */
    const callbackReturns = (call: CallNode, seen: Set<Binding>): Kind[] =>
      unique(functionsOf(call.arguments[0]).flatMap((fn) => returnKinds(fn, seen)));
    /** What a function parameter holds: a callback's argument, an argument of a local call, a typed handle, or its own default. */
    const paramKinds = (fn: Node, index: number, seen: Set<Binding>): Kind[] => {
      const uses = usesOf(fn);
      const param =
        fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression" || fn.type === "FunctionDeclaration"
          ? fn.params[index]
          : undefined;
      const target = param?.type === "AssignmentPattern" ? param.left : param;
      const kinds: Kind[] = [];

      for (const { call, callee, method, index: at } of uses.passed) {
        // `Array.from(list, map)` hands the map each element of its first argument.
        if (at === 1) {
          if (index === 0) {
            kinds.push(...elementsOf(infer(call.arguments[0], new Set(seen))));
          }

          continue;
        }

        const owners = infer(callee.object, new Set(seen));

        if (index === 0 && (method === "evaluate" || method === "evaluateHandle")) {
          if (owners.includes("handle")) {
            kinds.push("window");
          }

          // Electron evaluate callbacks expose BrowserWindow explicitly. DOM callbacks do not.
          if (
            owners.includes("app") ||
            (target?.type === "ObjectPattern" &&
              target.properties.some((p) => p.type === "Property" && propKey(p) === "BrowserWindow"))
          ) {
            kinds.push("electron");
          }
        }

        // A launch result's `.then` callback receives what the promise holds.
        if (index === 0 && method === "then") {
          kinds.push(...owners);
        }

        if (lists.callback.includes(method ?? "")) {
          kinds.push(...(index === 0 ? elementsOf(owners) : index === 2 ? listsOf(owners) : []));
        }

        // A reduce callback's accumulator starts as the initial value and then takes what the callback returns.
        if (method === "reduce" || method === "reduceRight") {
          if (index === 0) {
            kinds.push(...infer(call.arguments[1], new Set(seen)), ...returnKinds(fn, seen));
          } else if (index === 1) {
            kinds.push(...elementsOf(owners));
          } else if (index === 3) {
            kinds.push(...listsOf(owners));
          }
        }
      }

      // A local function's parameter holds what its calls pass in that position.
      for (const call of uses.called) {
        const spread = call.arguments.findIndex((a) => a.type === "SpreadElement");

        if (spread < 0 || index < spread) {
          kinds.push(...infer(call.arguments[index], new Set(seen)));
        }
      }

      return unique(kinds);
    };
    /** Writes to a name no scope declares: every unresolved reference to it that assigns. */
    const globalWrites = (name: string): Write[] =>
      refWrites(
        (source.scopeManager?.globalScope?.through ?? []).filter((ref: { identifier: Node }) => {
          const id = ref.identifier;
          return id.type === "Identifier" && id.name === name;
        }),
      ).sort((a, b) => a.at - b.at);
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

      const next = inner(node);

      if (next) {
        return infer(next, seen);
      }

      if (node.type === "AssignmentExpression") {
        return unique([...infer(node.right, new Set(seen)), ...(node.operator === "=" ? [] : infer(node.left, seen))]);
      }

      if (node.type === "ArrayExpression") {
        return unique(
          node.elements.flatMap((e) =>
            e?.type === "SpreadElement"
              ? listsOf(infer(e.argument, new Set(seen)))
              : e
                ? lift(infer(e, new Set(seen)))
                : [],
          ),
        );
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
        const callee = strip(node.callee);
        const callable = infer(callee, new Set(seen));
        const arg = node.arguments[0];

        if (callable.includes("createRequire")) {
          found.push("require");
        }

        if (callable.includes("require") && arg?.type === "Literal") {
          found.push(...named(String(arg.value)));
        }

        if (callable.some((k) => k === "launch" || k === "auditedLaunch")) {
          found.push("app");
        }

        if (callee.type === "MemberExpression") {
          const owners = infer(callee.object, new Set(seen));
          const method = member(callee);

          if (owners.includes("BrowserWindow") && method === "getAllWindows") {
            found.push("windows");
          }

          if (
            owners.includes("BrowserWindow") &&
            ["getFocusedWindow", "fromId", "fromWebContents", "fromBrowserView"].includes(method ?? "")
          ) {
            found.push("window");
          }

          if (owners.includes("app") && (method === "browserWindow" || method === "evaluateHandle")) {
            found.push("handle");
          }

          if (lists.element.includes(method ?? "")) {
            found.push(...elementsOf(owners));
          }

          if (lists.array.includes(method ?? "")) {
            found.push(...listsOf(owners));
          }

          if (method === "values") {
            found.push(...listsOf(owners));
          }

          if (method === "entries" && owners.includes("windows")) {
            found.push("windowPairs");
          }

          // Callback return values: a mapped list, a folded value, or what a promise's `then` answers.
          if (method === "map" || method === "flatMap") {
            found.push(
              ...lift(callbackReturns(node, seen)),
              ...(method === "flatMap" ? listsOf(callbackReturns(node, seen)) : []),
            );
          }

          if (method === "then" || method === "reduce" || method === "reduceRight") {
            found.push(...callbackReturns(node, seen));
          }

          if (method === "reduce" || method === "reduceRight") {
            found.push(...infer(node.arguments[1], new Set(seen)));
          }

          const object = strip(callee.object);
          const library = object.type === "Identifier" && !binding(object)?.defs.length ? object.name : undefined;
          const first = library ? infer(arg, new Set(seen)) : [];

          // Library helpers that carry their argument's elements across.
          if (library === "Promise" && method === "all") {
            found.push(...listsOf(first));
          }

          if (library === "Promise" && (method === "race" || method === "any")) {
            found.push(...elementsOf(first));
          }

          if (
            node.arguments.length === 1 &&
            ((library === "Array" && method === "from") || (library === "Object" && method === "values"))
          ) {
            found.push(...listsOf(first));
          }

          if (
            node.arguments.length === 1 &&
            library === "Object" &&
            method === "entries" &&
            first.includes("windows")
          ) {
            found.push("windowPairs");
          }

          if (library === "Array" && method === "from" && node.arguments.length === 2) {
            found.push(...lift(unique(functionsOf(node.arguments[1]).flatMap((fn) => returnKinds(fn, seen)))));
          }

          if (library === "Array" && method === "of") {
            found.push(...lift(node.arguments.flatMap((a) => infer(a, new Set(seen)))));
          }
        }

        // A local function, or an immediately called one, hands back what it returns.
        for (const fn of functionsOf(callee)) {
          found.push(...returnKinds(fn, seen));
        }

        return unique(found);
      }

      if (node.type !== "Identifier") {
        return [];
      }

      const variable = binding(node);

      if (!variable || !variable.defs.length) {
        // The global `require`, when no scope declares it, and a name only ever assigned, never declared.
        const written = unique(
          globalWrites(node.name).flatMap((w) =>
            patternKind(w.pattern, node.name, w.base(new Set(seen)), new Set(seen)),
          ),
        );
        return node.name === "require" ? unique(["require", ...written]) : written;
      }

      if (seen.has(variable)) {
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
        const imported = spec.type === "ImportSpecifier" ? key(spec.imported) : "*";
        const name = imported === "default" ? "*" : imported;

        if (from === "electron" || playwright(from) || from === "node:module" || from === "module") {
          const base = named(from);
          return name === "*" ? base : propertyKind(base, name);
        }

        if (from.endsWith("electron-launch.ts") && name === "launchElectron") {
          return ["auditedLaunch"];
        }
      }

      // TS `import E = require("electron")` and `import L = E.BrowserWindow`.
      if (def?.node.type === "TSImportEqualsDeclaration") {
        const ref = def.node.moduleReference;

        if (def.node.importKind === "type") {
          return [];
        }

        if (ref.type === "TSExternalModuleReference") {
          return ref.expression.type === "Literal" ? named(String(ref.expression.value)) : [];
        }

        if (ref.type === "TSQualifiedName") {
          const path: string[] = [];
          let at: Node = ref;

          while (at.type === "TSQualifiedName") {
            path.unshift(at.right.name);
            at = at.left;
          }

          return path.reduce<Kind[]>((kinds, step) => propertyKind(kinds, step), infer(at, seen));
        }

        return infer(ref, seen);
      }

      return unique(
        reaching(variable, node).flatMap((w) =>
          patternKind(w.pattern, node.name, w.base(new Set(seen)), new Set(seen)),
        ),
      );
    };
    return {
      CallExpression(node) {
        if (!launcher && infer(strip(node.callee)).includes("launch")) {
          context.report({
            node,
            message: "Launch Electron through src/testing/electron-launch.ts inside runE2e.",
          });
        }

        const callee = strip(node.callee);

        if (!inDrivers || hook || callee.type !== "MemberExpression" || !infer(callee.object).includes("window")) {
          return;
        }

        const method = member(callee);
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
