// The typed half of no-promises. Oxlint's JS plugins have no type checker. This lint
// command uses the installed TypeScript 7.0.2 API, without emitting code or type diagnostics.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import * as ts from "typescript/unstable/ast";
import {
  API,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
  type Project,
  type Symbol,
  type Type,
} from "typescript/unstable/sync";

interface PromiseFinding {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

export const checkPromiseTypes = (
  project: Project,
  root: string,
  pathService: Path.Path,
): readonly PromiseFinding[] => {
  const { checker, program } = project;
  const found = new Map<string, PromiseFinding>();
  const memo = new Map<number, boolean>();
  const carries = (type: Type | undefined, seen = new Set<number>()): boolean => {
    if (type === undefined || type.isErrorType()) {
      return false;
    }

    if (seen.has(type.id)) {
      return false;
    }

    const saved = memo.get(type.id);

    if (saved !== undefined) {
      return saved;
    }

    seen.add(type.id);
    const then = checker.getPropertyOfType(type, "then");
    const thenType = then === undefined ? undefined : checker.getTypeOfSymbol(then);
    const yes =
      type.isUnionType() || type.isIntersectionType()
        ? (type.getTypes() ?? []).some((t) => carries(t, seen))
        : (thenType !== undefined && checker.getSignaturesOfType(thenType, SignatureKind.Call).length > 0) ||
          checker
            .getSignaturesOfType(type, SignatureKind.Call)
            .some((signature) => carries(checker.getReturnTypeOfSignature(signature), seen));
    memo.set(type.id, yes);
    return yes;
  };
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (
      ts.isParenthesizedExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertion(expression)
    ) {
      expression = expression.expression;
    }

    return expression;
  };
  const keyNames = (type: Type | undefined): readonly string[] | undefined => {
    if (type?.isStringLiteralType()) {
      return [type.value];
    }

    if (!type?.isUnionType()) {
      return undefined;
    }

    const names = type.getTypes().map(keyNames);
    return names.every((name) => name !== undefined) ? names.flat() : undefined;
  };
  const bridgeProperty = (
    object: ts.Expression,
    names: readonly string[] | undefined,
    seen: ReadonlySet<number>,
  ): boolean => {
    const type = checker.getTypeAtLocation(object);
    // A key that may select anything else cannot prove this is an Effect bridge.
    // Promise-typed values are still checked; untyped/never calls get no guess.
    return (
      type !== undefined &&
      names !== undefined &&
      names.length > 0 &&
      names.every((name) => bridgeSymbol(checker.getPropertyOfType(type, name), seen))
    );
  };
  const bridgeSymbol = (symbol: Symbol | undefined, seen: ReadonlySet<number>): boolean => {
    if (symbol === undefined) {
      return false;
    }

    const target = (symbol.flags & SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

    if (seen.has(target.id)) {
      return false;
    }

    const visited = new Set([...seen, target.id]);

    if (
      ["tryPromise", "promise"].includes(target.name) &&
      target.declarations.some((declaration) =>
        // TypeScript folds path case on case-insensitive file systems.
        /(?:^|\/)node_modules\/effect\/(?:dist\/Effect\.d\.ts|src\/Effect\.ts)$/i.test(
          declaration.path.replaceAll("\\", "/"),
        ),
      )
    ) {
      return true;
    }

    const declaration = target.valueDeclaration?.resolve();

    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined
    ) {
      return isPromiseBridge(declaration.initializer, visited);
    }

    if (
      declaration !== undefined &&
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent) &&
      ts.isVariableDeclaration(declaration.parent.parent)
    ) {
      const binding = declaration.parent.parent;
      const name = declaration.propertyName ?? declaration.name;

      if (
        binding.initializer !== undefined &&
        ts.isVariableDeclarationList(binding.parent) &&
        (binding.parent.flags & ts.NodeFlags.Const) !== 0 &&
        name !== undefined
      ) {
        return bridgeProperty(
          binding.initializer,
          ts.isIdentifier(name) || ts.isStringLiteral(name)
            ? [name.text]
            : ts.isComputedPropertyName(name)
              ? keyNames(checker.getTypeAtLocation(name.expression))
              : undefined,
          visited,
        );
      }
    }

    return false;
  };
  const isPromiseBridge = (expression: ts.Expression, seen: ReadonlySet<number> = new Set()): boolean => {
    const callee = unwrap(expression);

    if (ts.isElementAccessExpression(callee)) {
      return bridgeProperty(callee.expression, keyNames(checker.getTypeAtLocation(callee.argumentExpression)), seen);
    }

    return bridgeSymbol(
      checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee),
      seen,
    );
  };

  for (const path of program.getSourceFileNames()) {
    const file = pathService.relative(root, path).replaceAll("\\", "/");

    if (!file.startsWith("next/") || file.includes("node_modules/") || /\.(?:test|test-support|d)\.tsx?$/.test(file)) {
      continue;
    }

    const source = program.getSourceFile(path);

    if (source === undefined) {
      throw new Error(`Cannot read ${file}`);
    }

    const candidates = new Map<ts.Node, string>();
    const promiseInputs = new Set<ts.Node>();
    const visit = (node: ts.Node, inPromise = false): void => {
      if (inPromise) {
        promiseInputs.add(node);
      }

      const bridge = ts.isCallExpression(node) && isPromiseBridge(node.expression);

      if (ts.isCallExpression(node)) {
        candidates.set(node, "call returns a Promise or a Promise thunk");

        for (const argument of node.arguments) {
          candidates.set(argument, "call passes a Promise or a Promise thunk");
        }
      }

      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node) ||
          ts.isConstructorDeclaration(node)) &&
        node.body !== undefined
      ) {
        for (const parameter of node.parameters) {
          candidates.set(parameter.name, "function takes a Promise or a Promise thunk");
        }
      }

      if (ts.isReturnStatement(node) && node.expression !== undefined) {
        candidates.set(node.expression, "function returns a Promise or a Promise thunk");
      }

      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        candidates.set(node.body, "function returns a Promise or a Promise thunk");
      }

      node.forEachChild((child) => visit(child, inPromise || (bridge && node.arguments.some((arg) => arg === child))));
    };
    visit(source);
    const nodes = [...candidates.keys()];
    const types = checker.getTypeAtLocation(nodes);
    const lines = source.text.split("\n");
    const marked = (line: number): boolean => {
      // A marker covers only the next physical line, even inside a wrapped statement.
      const edge = /^\s*\/\/ oxlint-disable-next-line (.+?) -- edge: \S/.exec(lines[line - 1] ?? "");
      const rules = new Set(edge?.[1]?.split(/[,\s]+/));
      // Oxlint separately checks that each comment is used.
      return rules.has("fabrika/no-promises") || rules.has("fabrika/no-effect-run-outside-edge");
    };

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (node === undefined) {
        throw new Error("Missing Promise candidate");
      }

      const type = types[i];
      // Workers RPC can resolve to never. Only Effect's own Promise inputs provide
      // evidence that an untyped call needs an edge; ordinary throw helpers do not.
      const unresolved =
        ts.isCallExpression(node) &&
        promiseInputs.has(node) &&
        (type === undefined ||
          type.isErrorType() ||
          (type.flags &
            (TypeFlags.Any |
              TypeFlags.Unknown |
              TypeFlags.Never |
              TypeFlags.TypeParameter |
              TypeFlags.Conditional |
              TypeFlags.IndexedAccess |
              TypeFlags.Substitution)) !==
            0);

      if (!carries(type) && !unresolved) {
        continue;
      }

      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;

      if (marked(line)) {
        continue;
      }

      found.set(`${file}:${line + 1}`, {
        file,
        line: line + 1,
        reason: unresolved
          ? "Promise input has a type the check cannot resolve"
          : (candidates.get(node) ?? "Promise value outside a marked edge"),
      });
    }
  }

  return [...found.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
};

const main = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const api = new API({ cwd: root });

  try {
    const configs = (yield* fs.glob("next/**/tsconfig.json", {
      root,
      exclude: ["**/node_modules/**"],
    }))
      .filter((file) => !file.includes("node_modules/"))
      .map((file) => path.join(root, file));
    const snapshot = api.updateSnapshot({ openProjects: configs });

    try {
      const findings = new Map<string, PromiseFinding>();

      for (const project of snapshot.getProjects()) {
        for (const f of checkPromiseTypes(project, root, path)) {
          findings.set(`${f.file}:${f.line}`, f);
        }
      }

      for (const f of findings.values()) {
        console.error(`${f.file}:${f.line} fabrika(no-promises): ${f.reason}`);
      }

      console.info(`lint:promise-types: ${findings.size} findings`);
      process.exitCode = findings.size === 0 ? 0 : 1;
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
});

if (import.meta.main) {
  NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)));
}
