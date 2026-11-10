// P16, next/. Program packages export pure code at '.' and an existing window at './window'.
// The generated Worker entry belongs to libfabrika, never to the program package.
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import type {CreateRule} from "@oxlint/plugins";
import {parseSync, Visitor} from "oxc-parser";

const map = (x: unknown): x is Record<string, unknown> =>
	typeof x === "object" && x !== null && !Array.isArray(x);

const declaration = (file: string) => /\.d\.[cm]?ts$/.test(file);

// Keep runtime conditions, including custom ones, but never TypeScript's types branch.
const targets = (x: unknown): string[] =>
	typeof x === "string"
		? declaration(x)
			? []
			: [x]
		: map(x)
			? Object.entries(x).flatMap(([condition, target]) =>
					condition === "types" ? [] : targets(target),
				)
			: [];

const worker = (name: string) =>
	/^(?:cloudflare:|workerd(?:\/|$)|miniflare(?:\/|$)|@alchemy\.run\/cloudflare-runtime(?:\/|$)|@kampus\/libfabrika\/(?:box|workers)(?:\/|$))/.test(
		name,
	);

// A side-effect import or empty value re-export still loads its target. Only erased links stop here.
const valueLink = (
	kind: string | undefined,
	specifiers: readonly {
		readonly type: string;
		readonly importKind?: string;
		readonly exportKind?: string;
	}[],
) =>
	kind !== "type" &&
	(specifiers.length === 0 || specifiers.some((s) => (s.importKind ?? s.exportKind) !== "type"));

// Cloudflare's own base classes for a Worker entrypoint, a Durable Object and a Workflow.
const workerClass = (node: unknown): boolean =>
	map(node) &&
	(node.type === "Identifier"
		? typeof node.name === "string" &&
			/^(?:WorkerEntrypoint|DurableObject|WorkflowEntrypoint)$/.test(node.name)
		: node.type === "MemberExpression" && workerClass(node.property));

// A module Worker's default export names its event handlers.
const handler = /^(?:fetch|scheduled|queue|email|tail)$/;
const windowFile = (file: string) => /\.[jt]sx$/.test(file) && !/\.test\.[jt]sx$/.test(file);

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

// TypeScript's bundler resolution for a relative link: the file as written, a .js-family name
// standing for its TypeScript source, the name with an extension added, then a folder's index.
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

const jsSources: Readonly<Record<string, readonly string[]>> = {
	".js": [".ts", ".tsx"],
	".jsx": [".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
};

const resolveLink = (from: string, name: string): string | undefined => {
	const base = resolve(dirname(from), name);
	const written = /\.[cm]?jsx?$/.exec(base)?.[0];
	const stem = written === undefined ? base : base.slice(0, -written.length);

	return [
		base,
		...(written === undefined ? [] : (jsSources[written] ?? []).map((ext) => stem + ext)),
		...sourceExtensions.map((ext) => base + ext),
		...sourceExtensions.map((ext) => join(base, `index${ext}`)),
	].find(isFile);
};

// Unwrap what TypeScript adds around a value: `satisfies`, `as`, `<T>x`, `x!` and parentheses.
const value = (node: unknown): unknown =>
	map(node) &&
	/^(?:TSSatisfiesExpression|TSAsExpression|TSTypeAssertion|TSNonNullExpression|ParenthesizedExpression)$/.test(
		String(node.type),
	)
		? value(node.expression)
		: node;

const handlerObject = (node: unknown) => {
	const object = value(node);

	return (
		map(object) &&
		object.type === "ObjectExpression" &&
		Array.isArray(object.properties) &&
		object.properties.some(
			(p: unknown) =>
				map(p) &&
				p.type === "Property" &&
				map(p.key) &&
				((p.key.type === "Identifier" && handler.test(String(p.key.name))) ||
					(p.key.type === "Literal" && handler.test(String(p.key.value)))),
		)
	);
};

// Follow an entry's value links, including re-exports and literal dynamic imports. Each file
// says whether it loads Worker code: a Worker runtime import, a Worker class or a Worker handler.
// `definesWorker` keeps the last two apart, for '.', whose runtime imports are reported per line.
const graph = (root: string, entries: readonly string[]) => {
	const files = new Set<string>();
	let loadsWorker = false;
	let definesWorker = false;
	const defines = () => {
		loadsWorker = true;
		definesWorker = true;
	};
	const visit = (file: string) => {
		if (declaration(file) || files.has(file) || !isFile(file)) {
			return;
		}

		files.add(file);
		const tree = parseSync(file, readFileSync(file, "utf8")).program;
		const link = (name: string) => {
			if (worker(name)) {
				loadsWorker = true;
			} else if (name.startsWith(".")) {
				const target = resolveLink(file, name);

				if (target !== undefined) {
					visit(target);
				}
			}
		};
		// A default export by name, as in `const app = {fetch() {}}; export default app;`.
		const values = new Map<string, unknown>();

		for (const statement of tree.body) {
			const declared =
				statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

			if (declared?.type === "VariableDeclaration") {
				for (const d of declared.declarations) {
					if (d.id.type === "Identifier") {
						values.set(d.id.name, d.init);
					}
				}
			}
		}

		const named = (node: unknown) => {
			const seen = new Set<string>();
			let at = value(node);

			while (map(at) && at.type === "Identifier" && typeof at.name === "string") {
				if (seen.has(at.name)) {
					return undefined;
				}

				seen.add(at.name);
				at = value(values.get(at.name));
			}

			return at;
		};
		new Visitor({
			ImportDeclaration(node) {
				if (valueLink(node.importKind, node.specifiers) && typeof node.source.value === "string") {
					link(node.source.value);
				}
			},
			ExportNamedDeclaration(node) {
				if (valueLink(node.exportKind, node.specifiers) && typeof node.source?.value === "string") {
					link(node.source.value);
				}

				// `export {app as default};` names the default export too.
				if (
					node.source === null &&
					node.specifiers.some(
						(s) =>
							s.exportKind !== "type" &&
							s.exported.type === "Identifier" &&
							s.exported.name === "default" &&
							handlerObject(named(s.local)),
					)
				) {
					defines();
				}
			},
			ExportAllDeclaration(node) {
				if (node.exportKind !== "type" && typeof node.source.value === "string") {
					link(node.source.value);
				}
			},
			ImportExpression(node) {
				if (node.source.type === "Literal" && typeof node.source.value === "string") {
					link(node.source.value);
				}
			},
			ClassDeclaration(node) {
				if (workerClass(node.superClass)) {
					defines();
				}
			},
			ClassExpression(node) {
				if (workerClass(node.superClass)) {
					defines();
				}
			},
			ExportDefaultDeclaration(node) {
				if (handlerObject(named(node.declaration))) {
					defines();
				}
			},
		}).visit(tree);
	};

	for (const entry of entries) {
		visit(resolve(root, entry));
	}

	return {files, loadsWorker, definesWorker};
};

const sources = (root: string) =>
	readdirSync(root, {recursive: true, encoding: "utf8"}).filter(
		(path) => !/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path),
	);

// A pattern export ("./*": "./src/*.ts") exports every package file its target matches, as
// Node resolves it: one `*`, which may span folders.
const expand = (root: string, key: string, target: string): string[] => {
	if (!key.includes("*") || !target.includes("*")) {
		return [target];
	}

	const [before = "", after = ""] = target.split("*");
	const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^${escape(before)}.+${escape(after)}$`);

	return sources(root)
		.map((path) => `./${path}`)
		.filter((path) => pattern.test(path) && isFile(resolve(root, path)));
};

// Every window-shaped source file in the package, tests and dependencies aside.
const windowFiles = (root: string) =>
	sources(root)
		.filter(windowFile)
		.map((path) => resolve(root, path));

export const programPackageLayout: CreateRule = {
	create(context) {
		const file = context.filename;
		const matched = /^(.*\/next\/programs\/[^/]+)\//.exec(file);

		if (!matched?.[1] || /\.test\.tsx?$/.test(file)) {
			return {};
		}

		const root = matched[1];
		let manifest: unknown;

		try {
			manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		} catch {
			return {
				Program(node) {
					context.report({node, message: "Cannot read the program package.json."});
				},
			};
		}

		const exports = map(manifest) ? manifest.exports : undefined;
		const entries =
			typeof exports === "string" ? targets(exports) : map(exports) ? targets(exports["."]) : [];
		const dot = graph(root, entries);
		const pure = dot.files;
		// The package's findings are reported once, on its first real '.' entry.
		const main = entries.map((entry) => resolve(root, entry)).find(isFile) === file;
		const errors: string[] = [];

		if (entries.length === 0 || entries.some((entry) => !existsSync(resolve(root, entry)))) {
			errors.push("Export a real pure program at '.'.");
		}

		// A Worker class or handler behind any runtime condition of '.', such as "workerd".
		if (dot.definesWorker) {
			errors.push("A program package has no Worker entry. libfabrika builds its box; '.' is one.");
		}

		const subpaths = map(exports)
			? Object.entries(exports).filter(([key]) => key.startsWith("./") && key !== "./window")
			: [];
		const windowEntries = map(exports) ? targets(exports["./window"]) : [];
		// A window behind another key is reported there, so it does not count as unexported too.
		const exported = graph(root, windowEntries).files;

		// libfabrika's own entry names stay refused even on pure code: the box is never the program's.
		for (const [key, target] of subpaths) {
			const loaded = graph(
				root,
				targets(target).flatMap((path) => expand(root, key, path)),
			);

			for (const path of loaded.files) {
				exported.add(path);
			}

			if (/\/(?:worker|workers|workerd|box|brain)(?:\/|$)/.test(key) || loaded.loadsWorker) {
				errors.push(
					`A program package has no Worker entry. libfabrika builds its box; '${key}' is one.`,
				);
			}

			if ([...loaded.files].some(windowFile)) {
				errors.push(`The window is exported at './window', never at '${key}'.`);
			}
		}

		if (windowFiles(root).some((path) => !exported.has(path))) {
			errors.push(
				"Export the real window at './window'. A program without a window needs no stub.",
			);
		}

		if (windowEntries.some((path) => !existsSync(resolve(root, path)))) {
			errors.push("The './window' export must name a real file.");
		}

		return {
			Program(node) {
				if (
					main ||
					entries.length === 0 ||
					entries.every((entry) => !existsSync(resolve(root, entry)))
				) {
					for (const message of errors) {
						context.report({node, message});
					}
				}
			},
			ImportDeclaration(node) {
				if (
					pure.has(file) &&
					valueLink(node.importKind, node.specifiers) &&
					typeof node.source.value === "string" &&
					worker(node.source.value)
				) {
					context.report({node, message: "Pure program code cannot import Worker runtime APIs."});
				}
			},
			ExportNamedDeclaration(node) {
				if (
					pure.has(file) &&
					valueLink(node.exportKind, node.specifiers) &&
					typeof node.source?.value === "string" &&
					worker(node.source.value)
				) {
					context.report({node, message: "Pure program code cannot export Worker runtime APIs."});
				}
			},
			ExportAllDeclaration(node) {
				if (
					pure.has(file) &&
					node.exportKind !== "type" &&
					typeof node.source.value === "string" &&
					worker(node.source.value)
				) {
					context.report({node, message: "Pure program code cannot export Worker runtime APIs."});
				}
			},
			ImportExpression(node) {
				if (
					pure.has(file) &&
					node.source.type === "Literal" &&
					typeof node.source.value === "string" &&
					worker(node.source.value)
				) {
					context.report({node, message: "Pure program code cannot load Worker runtime APIs."});
				}
			},
		};
	},
};
