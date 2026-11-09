// P12, next/. Read the real stack and the installed provider registrations.
// This exam fails closed on syntax it cannot follow. It does not keep a second resource list.
import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseSync, type ModuleExportName} from "oxc-parser";

type Tree = any;
type Program = ReturnType<typeof parseSync>["program"];
type Finding = {file: string; line: number; why: string};
const CF = resolve(
	dirname(fileURLToPath(import.meta.resolve("@alchemy.run/cloudflare"))),
	"../src",
);
const text = (path: string) => readFileSync(path, "utf8");
const source = (file: string, spec: string) => resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
const nodes = (node: Tree, visit: (node: Tree) => void): void => {
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) nodes(n, visit);
		return;
	}
	visit(node);
	for (const [key, child] of Object.entries(node))
		if (!["comments", "tokens"].includes(key)) nodes(child, visit);
};
const parsedFiles = new Map<string, Program>();
const tree = (file: string, body?: string): Program => {
	const saved = body === undefined ? parsedFiles.get(file) : undefined;
	if (saved !== undefined) return saved;
	const parsed = parseSync(file, body ?? text(file));
	if (parsed.errors.length) throw new Error(`unsupported-case: cannot parse ${file}`);
	if (body === undefined) parsedFiles.set(file, parsed.program);
	return parsed.program;
};
const member = (node: Tree): string | null => {
	if (node?.type === "Identifier") return node.name;
	if (node?.type === "MemberExpression" && !node.computed) {
		const base = member(node.object);
		return base === null ? null : `${base}.${node.property.name}`;
	}
	return null;
};
const root = (node: Tree): string | null => {
	if (node?.type === "Identifier") return node.name;
	return node?.type === "MemberExpression" ? root(node.object) : null;
};
const name = (node: ModuleExportName) => (node.type === "Identifier" ? node.name : node.value);
// Follow the package's actual namespace and star exports, including aliases.
const exported = (
	file: string,
	path: ReadonlyArray<string>,
	seen = new Set<string>(),
): string | null => {
	const key = `${file}:${path.join(".")}`;
	if (seen.has(key) || !existsSync(file)) return null;
	seen.add(key);
	const ast = tree(file);
	for (const node of ast.body) {
		if (node.type === "ExportAllDeclaration") {
			if (node.exported && name(node.exported) === path[0]) {
				const found = exported(source(file, node.source.value), path.slice(1), seen);
				if (found) return found;
			} else if (!node.exported) {
				const found = exported(source(file, node.source.value), path, seen);
				if (found) return found;
			}
		}
		if (node.type !== "ExportNamedDeclaration") continue;
		if (
			path.length === 1 &&
			node.declaration?.type === "VariableDeclaration" &&
			node.declaration.declarations.some((d) => d.id.type === "Identifier" && d.id.name === path[0])
		)
			return file;
		for (const spec of node.specifiers ?? []) {
			if (name(spec.exported) !== path[0] || !node.source) continue;
			const found = exported(
				source(file, node.source.value),
				[name(spec.local), ...path.slice(1)],
				seen,
			);
			if (found) return found;
		}
	}
	return null;
};
const imports = (file: string) => {
	const result = new Map<string, {file: string; name: string}>();
	for (const n of tree(file).body)
		if (n.type === "ImportDeclaration" && n.source.value.startsWith(".")) {
			for (const s of n.specifiers)
				if (s.type === "ImportSpecifier")
					result.set(s.local.name, {file: source(file, n.source.value), name: name(s.imported)});
		}
	return result;
};
const sameSymbol = (file: string, symbol: string, targetFile: string, target: string): boolean => {
	if (file === targetFile && symbol === target) return true;
	const imported = imports(file).get(symbol);
	return imported !== undefined && imported.file === targetFile && imported.name === target;
};
// Read the sidecar's real registration calls, rather than believing a LocalProvider filename.
const registered = (targetFile: string, target: string): boolean => {
	const local = join(CF, "Local.ts");
	const providers = imports(local);
	const installed = new Set<string>();
	nodes(tree(local), (node) => {
		if (node.type === "CallExpression" && node.callee.type === "Identifier")
			installed.add(node.callee.name);
	});
	for (const [name, provider] of providers) {
		if (!installed.has(name)) continue;
		let found = false;
		nodes(tree(provider.file), (node) => {
			if (
				node.type === "CallExpression" &&
				member(node.callee) === "LocalProvider.make" &&
				sameSymbol(provider.file, node.arguments[0]?.name, targetFile, target)
			)
				found = true;
		});
		if (found) return true;
	}
	// R2 and some other resources register local/live providers together on their own module.
	let dual = false;
	nodes(tree(targetFile), (node) => {
		if (
			node.type !== "CallExpression" ||
			member(node.callee) !== "ProviderLayer.dual" ||
			node.arguments[0]?.name !== target
		)
			return;
		const props = node.arguments[1]?.properties ?? [];
		dual = props.some(
			(p: Tree) =>
				p.key?.name === "local" && /ProviderLocal/.test(text(targetFile).slice(p.start, p.end)),
		);
	});
	return dual;
};
const resource = (file: string, symbol: string): boolean => {
	let found = false;
	nodes(tree(file), (node) => {
		if (
			node.type === "VariableDeclarator" &&
			node.id?.name === symbol &&
			node.init?.type === "CallExpression" &&
			member(node.init.callee) === "Resource"
		)
			found = true;
	});
	// Worker is implemented by overloads, and its provider registration is still independent evidence.
	return found || registered(file, symbol);
};
export const scan = (file: string, body: string): Array<Finding> => {
	const ast = tree(file, body),
		found: Array<Finding> = [];
	const cloud = new Set<string>(),
		alchemy = new Set<string>(),
		named = new Map<string, string>();
	const remote = new Set<string>();
	const helpers = new Set<string>();
	const cloudImport = (node: Tree) => {
		const first = root(node);
		return first !== null && (cloud.has(first) || named.has(first));
	};
	const report = (node: Tree, why: string) =>
		found.push({file, line: body.slice(0, node.start).split("\n").length, why});
	for (const node of ast.body)
		if (node.type === "ImportDeclaration") {
			if (node.source.value.startsWith(".") && node.importKind !== "type")
				for (const spec of node.specifiers)
					if (spec.type !== "ImportSpecifier" || spec.importKind !== "type")
						helpers.add(spec.local.name);
			if (node.source.value.startsWith("@alchemy.run/cloudflare/"))
				report(node, "unsupported-case: Cloudflare subpath import");
			for (const s of node.specifiers) {
				if (node.source.value === "@alchemy.run/cloudflare") {
					if (s.type === "ImportNamespaceSpecifier") cloud.add(s.local.name);
					else if (s.type === "ImportSpecifier") named.set(s.local.name, name(s.imported));
				}
				if (
					node.source.value === "alchemy" &&
					["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(s.type)
				)
					alchemy.add(s.local.name);
				if (
					node.source.value === "alchemy" &&
					s.type === "ImportSpecifier" &&
					name(s.imported) === "remote"
				)
					remote.add(s.local.name);
			}
		}
	let total = 0;
	nodes(ast, (node) => {
		if (node.type === "VariableDeclarator") {
			const alias = member(node.init);
			if (cloudImport(node.init) || (alias && remote.has(alias)))
				report(node, "unsupported-case: aliased resource or remote function");
		}
		if (node.type !== "CallExpression") return;
		const callee = member(node.callee);
		if (callee && (remote.has(callee) || [...alchemy].some((a) => callee === `${a}.remote`)))
			report(node, "remote override");
		const call = callee?.split(".") ?? [];
		const first = call[0];
		const imported = first === undefined ? undefined : named.get(first);
		if (first && helpers.has(first)) report(node, "unsupported-case: unfollowed stack helper");
		const parts =
			first && cloud.has(first)
				? call.slice(1)
				: imported !== undefined
					? [imported, ...call.slice(1)]
					: null;
		if (!parts) {
			// Computed Cloudflare calls and aliased constructors must be understood before blocking.
			if (node.callee?.type === "MemberExpression" && cloudImport(node.callee))
				report(node, "unsupported-case: computed resource");
			return;
		}
		if (["providers", "localState"].includes(parts.join("."))) return;
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
			if (!registered(owner, symbol))
				report(node, `no local provider: Cloudflare.${parts.join(".")}`);
		} else {
			// A binding constructor must actually be exported as such by the installed package.
			const declaration = text(owner);
			if (!/DurableObject|WorkerLoader/.test(symbol) || !declaration.includes(symbol))
				report(node, `unsupported-case: Cloudflare.${parts.join(".")}`);
		}
	});
	if (total === 0 && found.length === 0)
		found.push({file, line: 1, why: "unsupported-case: no stack resources found"});
	return found;
};

/** The command and its tests share the same scan, output and exit status. */
export const lint = (file: string) => {
	const findings = scan(file, text(file));
	for (const f of findings) console.error(`${f.file}:${f.line} ${f.why}`);
	console.info(`lint:twin: ${findings.length} findings`);
	return findings.length === 0 ? 0 : 1;
};

if (import.meta.main)
	process.exitCode = lint(process.argv[2] ?? resolve(import.meta.dirname, "../../alchemy.run.ts"));
