// P12, next/. Read the real stack and the installed provider registrations.
// This exam fails closed on syntax it cannot follow. It does not keep a second resource list.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path } from "effect";
import { parseSync, type ModuleExportName } from "oxc-parser";

type Tree = any;
type Program = ReturnType<typeof parseSync>["program"];
type Finding = { file: string; line: number; reason: string };

const makeScanner = (path: Path.Path, CF: string, sources: ReadonlyMap<string, string>) => {
  const { dirname, join, resolve } = path;
  const text = (file: string) => {
    const body = sources.get(file);

    if (body === undefined) {
      throw new Error(`unsupported-case: missing installed source ${file}`);
    }

    return body;
  };
  const source = (file: string, spec: string) => resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
  const nodes = (node: Tree, visit: (node: Tree) => void): void => {
    if (node === null || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const n of node) {
        nodes(n, visit);
      }

      return;
    }

    visit(node);

    for (const [key, child] of Object.entries(node)) {
      if (!["comments", "tokens"].includes(key)) {
        nodes(child, visit);
      }
    }
  };
  const parsedFiles = new Map<string, Program>();
  const tree = (file: string, body?: string): Program => {
    const saved = body === undefined ? parsedFiles.get(file) : undefined;

    if (saved !== undefined) {
      return saved;
    }

    const parsed = parseSync(file, body ?? text(file));

    if (parsed.errors.length) {
      throw new Error(`unsupported-case: cannot parse ${file}`);
    }

    if (body === undefined) {
      parsedFiles.set(file, parsed.program);
    }

    return parsed.program;
  };
  // These wrappers preserve the called value. Follow them at every member depth.
  const unwrap = (node: Tree): Tree => {
    while (
      [
        "ParenthesizedExpression",
        "TSAsExpression",
        "TSTypeAssertion",
        "TSNonNullExpression",
        "TSSatisfiesExpression",
      ].includes(node?.type)
    ) {
      node = node.expression;
    }

    return node;
  };
  const member = (raw: Tree): string | null => {
    const node = unwrap(raw);

    if (node?.type === "Identifier") {
      return node.name;
    }

    if (node?.type === "MemberExpression" && !node.computed) {
      const base = member(node.object);
      return base === null ? null : `${base}.${node.property.name}`;
    }

    return null;
  };
  const root = (raw: Tree): string | null => {
    const node = unwrap(raw);

    if (node?.type === "Identifier") {
      return node.name;
    }

    return node?.type === "MemberExpression" ? root(node.object) : null;
  };
  const name = (node: ModuleExportName) => (node.type === "Identifier" ? node.name : node.value);
  // Follow the package's actual namespace and star exports, including aliases.
  const exported = (file: string, path: ReadonlyArray<string>, seen = new Set<string>()): string | null => {
    const key = `${file}:${path.join(".")}`;

    if (seen.has(key) || !sources.has(file)) {
      return null;
    }

    seen.add(key);
    const ast = tree(file);

    for (const node of ast.body) {
      if (node.type === "ExportAllDeclaration") {
        if (node.exported && name(node.exported) === path[0]) {
          const found = exported(source(file, node.source.value), path.slice(1), seen);

          if (found) {
            return found;
          }
        } else if (!node.exported) {
          const found = exported(source(file, node.source.value), path, seen);

          if (found) {
            return found;
          }
        }
      }

      if (node.type !== "ExportNamedDeclaration") {
        continue;
      }

      if (
        path.length === 1 &&
        node.declaration?.type === "VariableDeclaration" &&
        node.declaration.declarations.some((d) => d.id.type === "Identifier" && d.id.name === path[0])
      ) {
        return file;
      }

      for (const spec of node.specifiers ?? []) {
        if (name(spec.exported) !== path[0] || !node.source) {
          continue;
        }

        const found = exported(source(file, node.source.value), [name(spec.local), ...path.slice(1)], seen);

        if (found) {
          return found;
        }
      }
    }

    return null;
  };
  const imports = (file: string) => {
    const result = new Map<string, { file: string; name: string }>();

    for (const n of tree(file).body) {
      if (n.type === "ImportDeclaration" && n.source.value.startsWith(".")) {
        for (const s of n.specifiers) {
          if (s.type === "ImportSpecifier") {
            result.set(s.local.name, { file: source(file, n.source.value), name: name(s.imported) });
          }
        }
      }
    }

    return result;
  };
  const sameSymbol = (file: string, symbol: string, targetFile: string, target: string): boolean => {
    if (file === targetFile && symbol === target) {
      return true;
    }

    const imported = imports(file).get(symbol);
    return imported !== undefined && imported.file === targetFile && imported.name === target;
  };
  // Installed trees are one snapshot for this command, just like parsedFiles above.
  const cached = (read: (file: string, symbol: string) => boolean) => {
    const answers = new Map<string, boolean>();
    return (file: string, symbol: string) => {
      const key = `${file}:${symbol}`;
      const known = answers.get(key);

      if (known !== undefined) {
        return known;
      }

      const answer = read(file, symbol);
      answers.set(key, answer);
      return answer;
    };
  };
  // Read the sidecar's real registration calls, rather than believing a LocalProvider filename.
  const registered = cached((targetFile: string, target: string): boolean => {
    const local = join(CF, "Local.ts");
    const providers = imports(local);
    const installed = new Set<string>();
    nodes(tree(local), (node) => {
      if (node.type === "CallExpression" && node.callee.type === "Identifier") {
        installed.add(node.callee.name);
      }
    });

    for (const [name, provider] of providers) {
      if (!installed.has(name)) {
        continue;
      }

      let found = false;
      nodes(tree(provider.file), (node) => {
        if (
          node.type === "CallExpression" &&
          member(node.callee) === "LocalProvider.make" &&
          sameSymbol(provider.file, node.arguments[0]?.name, targetFile, target)
        ) {
          found = true;
        }
      });

      if (found) {
        return true;
      }
    }

    // R2 and some other resources register local/live providers together on their own module.
    let dual = false;
    nodes(tree(targetFile), (node) => {
      if (
        node.type !== "CallExpression" ||
        member(node.callee) !== "ProviderLayer.dual" ||
        node.arguments[0]?.name !== target
      ) {
        return;
      }

      const props = node.arguments[1]?.properties ?? [];
      dual = props.some(
        (p: Tree) => p.key?.name === "local" && /ProviderLocal/.test(text(targetFile).slice(p.start, p.end)),
      );
    });
    return dual;
  });
  const resource = cached((file: string, symbol: string): boolean => {
    let found = false;
    nodes(tree(file), (node) => {
      if (
        node.type === "VariableDeclarator" &&
        node.id?.name === symbol &&
        node.init?.type === "CallExpression" &&
        member(node.init.callee) === "Resource"
      ) {
        found = true;
      }
    });
    // Worker is implemented by overloads, and its provider registration is still independent evidence.
    return found || registered(file, symbol);
  });
  const scan = (file: string, body: string, contract?: string): Array<Finding> => {
    const ast = tree(file, body),
      found: Array<Finding> = [];
    const cloud = new Set<string>(),
      alchemy = new Set<string>(),
      named = new Map<string, string>();
    const remote = new Set<string>();
    const helpers = new Set<string>();
    // A reference may be used only as the root of a checked direct call. Rejecting its
    // escape also covers aliases, destructuring, spread, callbacks and indirect invocation.
    const checkedRoots = new Set<Tree>();
    const checkRoot = (raw: Tree) => {
      let node = unwrap(raw);

      while (node?.type === "MemberExpression") {
        node = unwrap(node.object);
      }

      if (node?.type === "Identifier") {
        checkedRoots.add(node);
      }
    };
    const cloudImport = (node: Tree) => {
      const first = root(node);
      return first !== null && (cloud.has(first) || named.has(first));
    };
    const report = (node: Tree, reason: string) =>
      found.push({ file, line: body.slice(0, node.start).split("\n").length, reason });

    for (const node of ast.body) {
      if (node.type === "ImportDeclaration") {
        if (node.importKind === "type") {
          continue;
        }

        if (!["@alchemy.run/cloudflare", "alchemy", "effect"].includes(node.source.value)) {
          if (
            node.specifiers.length === 0 ||
            node.specifiers.some((s) => s.type !== "ImportSpecifier" || s.importKind !== "type")
          ) {
            report(node, "unsupported-case: unfollowed stack import");
          }
        }

        if (node.source.value.startsWith(".")) {
          for (const spec of node.specifiers) {
            if (spec.type !== "ImportSpecifier" || spec.importKind !== "type") {
              helpers.add(spec.local.name);
            }
          }
        }

        if (node.source.value.startsWith("@alchemy.run/cloudflare/")) {
          report(node, "unsupported-case: Cloudflare subpath import");
        }

        for (const s of node.specifiers) {
          if (node.source.value === "@alchemy.run/cloudflare") {
            if (s.type === "ImportNamespaceSpecifier") {
              cloud.add(s.local.name);
            } else if (s.type === "ImportSpecifier") {
              named.set(s.local.name, name(s.imported));
            }
          }

          if (
            node.source.value === "alchemy" &&
            ["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(s.type)
          ) {
            alchemy.add(s.local.name);
          }

          if (node.source.value === "alchemy" && s.type === "ImportSpecifier" && name(s.imported) === "remote") {
            remote.add(s.local.name);
          } else if (node.source.value === "alchemy" && s.type === "ImportSpecifier" && s.importKind !== "type") {
            report(node, "unsupported-case: named Alchemy import");
          }
        }
      } else if (
        (node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") &&
        node.source &&
        node.exportKind !== "type"
      ) {
        report(node, "unsupported-case: unfollowed stack re-export");
      }
    }

    let total = 0;
    const isRemote = (callee: string | null) =>
      callee !== null && (remote.has(callee) || [...alchemy].some((a) => callee === `${a}.remote`));
    nodes(ast, (node) => {
      if (node.type === "VariableDeclarator") {
        const alias = member(node.init);

        if (cloudImport(node.init) || isRemote(alias)) {
          report(node, "unsupported-case: aliased resource or remote function");
        }
      }

      if (node.type !== "CallExpression") {
        return;
      }

      const callee = member(node.callee);

      if (isRemote(callee)) {
        checkRoot(node.callee);
        report(node, "remote override");
      }

      if ([...alchemy].some((a) => callee === `${a}.Stack` || callee === `${a}.localState`)) {
        checkRoot(node.callee);
      }

      const call = callee?.split(".") ?? [];
      const first = call[0];
      const imported = first === undefined ? undefined : named.get(first);

      if (first && helpers.has(first)) {
        report(node, "unsupported-case: unfollowed stack helper");
      }

      const parts =
        first && cloud.has(first) ? call.slice(1) : imported !== undefined ? [imported, ...call.slice(1)] : null;

      if (!parts) {
        // Computed Cloudflare calls and aliased constructors must be understood before blocking.
        if (cloudImport(node.callee)) {
          checkRoot(node.callee);
          report(node, "unsupported-case: computed resource");
        }

        return;
      }

      checkRoot(node.callee);

      if (["Worker", "Workers.Worker"].includes(parts.join("."))) {
        const props = unwrap(node.arguments[1]);
        const key = (p: Tree) => (p?.computed ? null : (p?.key?.name ?? p?.key?.value));
        const env = props?.properties?.find((p: Tree) => key(p) === "env");

        {
          const bindings = env === undefined ? { type: "ObjectExpression", properties: [] } : unwrap(env.value);

          if (bindings?.type !== "ObjectExpression") {
            report(env ?? node, "unsupported-case: class-name bindings are not a literal object");
          } else {
            const objects = new Map<string, string>();

            for (const binding of bindings.properties) {
              if (binding.type !== "Property" || key(binding) === null) {
                report(binding, "unsupported-case: indirect class-name binding");
                continue;
              }

              const value = unwrap(binding.value);
              const called = member(value?.callee)?.split(".") ?? [];
              const first = called[0];
              const imported = first === undefined ? undefined : named.get(first);
              const target = first && cloud.has(first) ? called.slice(1).join(".") : imported;

              if (
                value?.type === "CallExpression" &&
                ["DurableObject", "Workers.DurableObject"].includes(target ?? "")
              ) {
                const name = value.arguments[0];

                if (name?.type !== "Literal" || typeof name.value !== "string") {
                  report(binding, "unsupported-case: dynamic class-name binding");
                } else {
                  objects.set(String(key(binding)), name.value);
                }
              }
            }

            let hostedNames: Array<string> = [];

            try {
              if (contract === undefined) {
                throw new Error("missing host contract");
              }

              const contracts: Array<Tree> = [];
              nodes(tree("objects.ts", contract), (declaration) => {
                if (declaration.type === "ClassDeclaration" && declaration.id?.name === "Brain") {
                  contracts.push(declaration.superClass?.callee?.typeArguments?.params?.[2]);
                }
              });

              if (contracts.length !== 1 || !contracts[0]) {
                throw new Error("missing Brain contract");
              }

              const shape = contracts[0];
              const types = shape.type === "TSUnionType" ? shape.types : [shape];
              hostedNames = types.map((type: Tree) => {
                if (type.type !== "TSTypeReference" || type.typeName?.type !== "Identifier" || type.typeArguments) {
                  throw new Error("unsupported host contract");
                }

                return type.typeName.name;
              });
            } catch {
              report(env ?? node, "unsupported-case: cannot read host contract");
            }

            for (const hosted of hostedNames) {
              if (objects.get(hosted) !== hosted) {
                report(env ?? node, `unsupported-case: missing class-name binding ${hosted}`);
              }
            }
          }
        }
      }

      if (["providers", "localState"].includes(parts.join("."))) {
        return;
      }

      const owner = exported(join(CF, "index.ts"), parts);

      if (owner === null) {
        report(node, `unsupported-case: unknown Cloudflare.${parts.join(".")}`);
        return;
      }

      const symbol = parts.at(-1);

      if (symbol === undefined) {
        report(node, "unsupported-case: empty Cloudflare resource name");
        return;
      }

      if (resource(owner, symbol)) {
        total++;

        if (!registered(owner, symbol)) {
          report(node, `no local provider: Cloudflare.${parts.join(".")}`);
        }
      } else {
        // A binding constructor must actually be exported as such by the installed package.
        const declaration = text(owner);

        if (!/DurableObject|WorkerLoader/.test(symbol) || !declaration.includes(symbol)) {
          report(node, `unsupported-case: Cloudflare.${parts.join(".")}`);
        }
      }
    });
    const references = (node: Tree): void => {
      if (node === null || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const child of node) {
          references(child);
        }

        return;
      }

      if (node.type === "ImportDeclaration" || node.type === "TSTypeQuery" || node.type === "TSTypeReference") {
        return;
      }

      if (node.type === "ImportExpression" || (node.type === "CallExpression" && member(node.callee) === "require")) {
        report(node, "unsupported-case: dynamic stack import");
      }

      if (
        node.type === "Identifier" &&
        (cloud.has(node.name) || named.has(node.name) || alchemy.has(node.name) || remote.has(node.name)) &&
        !checkedRoots.has(node)
      ) {
        report(node, "unsupported-case: escaped resource or remote reference");
      }

      // Optional calls and members are deliberately unsupported, even when their dotted
      // spelling looks like an ordinary direct constructor or decorator call.
      if (
        (node.type === "CallExpression" || node.type === "MemberExpression") &&
        node.optional &&
        (cloudImport(node) ||
          cloudImport(node.callee) ||
          alchemy.has(root(node) ?? "") ||
          alchemy.has(root(node.callee) ?? ""))
      ) {
        report(node, "unsupported-case: optional resource or remote call");
      }

      for (const [key, child] of Object.entries(node)) {
        // The name after a dot, and a literal object's key, are names rather than references.
        if (node.type === "MemberExpression" && !node.computed && key === "property") {
          continue;
        }

        if (node.type === "Property" && !node.computed && key === "key") {
          continue;
        }

        if (!["comments", "tokens"].includes(key)) {
          references(child);
        }
      }
    };
    references(ast);

    if (total === 0 && found.length === 0) {
      found.push({ file, line: 1, reason: "unsupported-case: no stack resources found" });
    }

    return found;
  };
  return scan;
};

// Gather installed source once through the supplied platform. The AST walk stays pure.
export const scanner = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const installed = yield* path.fromFileUrl(new URL(import.meta.resolve("@alchemy.run/cloudflare")));
  const CF = path.resolve(path.dirname(installed), "../src");
  const sources = new Map<string, string>();

  for (const file of yield* fs.glob("**/*.ts", { root: CF })) {
    const full = path.join(CF, file);
    sources.set(full, yield* fs.readFileString(full));
  }

  return makeScanner(path, CF, sources);
});

/** The command and its tests share the same scan, output and exit status. */
const lint = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const scan = yield* scanner;
  const path = yield* Path.Path;
  const contract = yield* fs
    .readFileString(path.resolve(import.meta.dirname, "../../../../packages/libfabrika/src/workers/objects.ts"))
    .pipe(Effect.catch(() => Effect.succeed(undefined)));
  const findings = scan(file, yield* fs.readFileString(file), contract);

  for (const f of findings) {
    yield* Console.error(`${f.file}:${f.line} ${f.reason}`);
  }

  yield* Console.info(`lint:twin: ${findings.length} findings`);
  return findings.length === 0 ? 0 : 1;
});

if (import.meta.main) {
  NodeRuntime.runMain(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      process.exitCode = yield* lint(process.argv[2] ?? path.resolve(import.meta.dirname, "../../alchemy.run.ts"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}
