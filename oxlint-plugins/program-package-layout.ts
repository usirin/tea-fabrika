// P16, next/. Program packages export pure code at '.' and an existing window at './window'.
// The generated Worker entry belongs to libfabrika, never to the program package.
import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import type {CreateRule} from "@oxlint/plugins";
import {parseSync, Visitor} from "oxc-parser";
import {ResolverFactory} from "oxc-resolver";

const map = (x: unknown): x is Record<string, unknown> =>
	typeof x === "object" && x !== null && !Array.isArray(x);

const declaration = (file: string) => /\.d\.[cm]?ts$/.test(file);

// Module resolution is oxc-resolver's (0040). Relative links get TypeScript's bundler lookup: the
// extension added, a `.js` name standing for its `.ts` source, a folder's index. An export target
// is a file path as written. A pattern's subpath goes through the package's own `exports`, by
// its name, so null targets and more specific keys apply as Node applies them.
const options = {
	conditionNames: ["workerd", "import", "default"],
	extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
	extensionAlias: {
		".js": [".ts", ".tsx", ".js"],
		".jsx": [".tsx", ".jsx"],
		".mjs": [".mts", ".mjs"],
		".cjs": [".cts", ".cjs"],
	},
	symlinks: false,
};

const resolver = new ResolverFactory(options);

// `cloneWithOptions` replaces every option, so each clone names them all.
const targetResolver = resolver.cloneWithOptions({
	...options,
	extensionAlias: {},
	fullySpecified: true,
});

const resolvers = new Map<string, ResolverFactory>();

const resolverFor = (conditions: readonly string[]) => {
	const key = conditions.join("\0");
	let found = resolvers.get(key);

	if (found === undefined) {
		found = resolver.cloneWithOptions({...options, conditionNames: [...conditions]});
		resolvers.set(key, found);
	}

	return found;
};

// The resolver answers for one set of conditions with the first match in key order, so a
// target after `default`, or after another condition the set holds, never comes back. The rule
// judges every target a runtime condition names, so it lists the condition paths itself: an
// object's keys (never TypeScript's `types`), each element of a fallback array, nothing for null.
const conditionPaths = (x: unknown, path: readonly string[] = []): string[][] =>
	typeof x === "string"
		? [[...path]]
		: Array.isArray(x)
			? x.flatMap((target) => conditionPaths(target, path))
			: map(x)
				? Object.entries(x).flatMap(([condition, target]) =>
						condition === "types" ? [] : conditionPaths(target, [...path, condition]),
					)
				: [];

// Every target string an export value names under a runtime condition.
const targetStrings = (x: unknown): string[] =>
	typeof x === "string"
		? [x]
		: Array.isArray(x)
			? x.flatMap(targetStrings)
			: map(x)
				? Object.entries(x).flatMap(([condition, target]) =>
						condition === "types" ? [] : targetStrings(target),
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

// Unwrap what TypeScript adds around a value: `satisfies`, `as`, `<T>x`, `x!` and parentheses.
const value = (node: unknown): unknown =>
	map(node) &&
	/^(?:TSSatisfiesExpression|TSAsExpression|TSTypeAssertion|TSNonNullExpression|ParenthesizedExpression)$/.test(
		String(node.type),
	)
		? value(node.expression)
		: node;

// An object literal naming a handler, directly or through a spread of another such object
// (`export default {...app}`). `named` follows a name to its value in the same file.
const handlerObject = (
	node: unknown,
	named: (node: unknown) => unknown,
	seen = new Set<unknown>(),
): boolean => {
	const object = named(node);

	if (!map(object) || object.type !== "ObjectExpression" || seen.has(object)) {
		return false;
	}

	seen.add(object);

	return (
		Array.isArray(object.properties) &&
		object.properties.some(
			(p: unknown) =>
				map(p) &&
				((p.type === "SpreadElement" && handlerObject(p.argument, named, seen)) ||
					(p.type === "Property" &&
						map(p.key) &&
						((p.key.type === "Identifier" && handler.test(String(p.key.name))) ||
							(p.key.type === "Literal" && handler.test(String(p.key.value)))))),
		)
	);
};

// Follow an entry's value links, including re-exports and literal dynamic imports. Each file
// says whether it loads Worker code: a Worker runtime import, a Worker class or a Worker handler.
// `definesWorker` keeps the last two apart, for '.', whose runtime imports are reported per line.
const graph = (entries: readonly string[]) => {
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
				const target = resolver.sync(dirname(file), name).path;

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
							handlerObject(s.local, named),
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
				if (handlerObject(node.declaration, named)) {
					defines();
				}
			},
		}).visit(tree);
	};

	for (const entry of entries) {
		visit(entry);
	}

	return {files, loadsWorker, definesWorker};
};

const sources = (root: string) =>
	readdirSync(root, {recursive: true, encoding: "utf8"}).filter(
		(path) => !/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path),
	);

// The resolver resolves one subpath; it cannot list the subpaths a pattern key offers. So list
// what each target's `*` matches among the package files (one or more characters, folders
// included, as Node matches). A target without `*` maps every subpath to one file, so any one
// subpath stands for all.
const matchesOf = (root: string, exportValue: unknown): string[] => {
	const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const files = sources(root).map((path) => `./${path}`);

	return [
		...new Set(
			targetStrings(exportValue).flatMap((target) => {
				if (!target.includes("*")) {
					return ["_"];
				}

				const [before = "", after = ""] = target.split("*");
				const pattern = new RegExp(`^${escape(before)}(.+)${escape(after)}$`);

				return files.flatMap((path) => {
					const match = pattern.exec(path)?.[1];

					return match === undefined ? [] : [match];
				});
			}),
		),
	];
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

		// The resolver finds the package by its own name, as Node's self-reference does.
		const name = map(manifest) && typeof manifest.name === "string" ? manifest.name : "";
		const raw = map(manifest) ? manifest.exports : undefined;
		// A string, an array, null, or an object of conditions is the '.' export alone.
		const exports: Record<string, unknown> =
			map(raw) && Object.keys(raw).some((key) => key.startsWith("."))
				? raw
				: raw === undefined
					? {}
					: {".": raw};
		// Every target one export key names under a runtime condition, each resolved; a target that
		// names nothing real comes back as `undefined`. A pattern key gives its targets once per
		// subpath the package's own exports still offer there.
		const resolveKey = (key: string): (string | undefined)[] => {
			const exportValue = exports[key];
			const targets = targetStrings(exportValue);
			const target = (path: string) => targetResolver.sync(root, path).path;

			if (!key.includes("*")) {
				return targets.map(target);
			}

			const [before = "", after = ""] = key.split("*");
			const conditions = [options.conditionNames, ...conditionPaths(exportValue)];

			return matchesOf(root, exportValue).flatMap((match) => {
				const own = targets.map((path) => target(path.replace("*", match)));
				const real = new Set(
					own.flatMap((path) => (path === undefined ? [] : [realpathSync(path)])),
				);
				// The subpath is this key's only if the package's exports answer with one of its own
				// targets: a null target or a more specific key takes it away.
				const offered =
					name !== "" &&
					conditions.some((set) => {
						const found = resolverFor(set).sync(
							root,
							`${name}${before.slice(1)}${match}${after}`,
						).path;

						return found !== undefined && real.has(realpathSync(found));
					});

				return offered ? own : [];
			});
		};
		const dotTargets = resolveKey(".");
		const entries = [
			...new Set(dotTargets.flatMap((path) => (path === undefined ? [] : [path]))),
		].filter((path) => !declaration(path));
		const dot = graph(entries);
		const pure = dot.files;
		// The package's findings are reported once, on its first real '.' entry.
		const main = entries.find(isFile) === file;
		const errors: string[] = [];

		if (entries.length === 0 || dotTargets.includes(undefined)) {
			errors.push("Export a real pure program at '.'.");
		}

		// A Worker class or handler behind any runtime condition of '.', such as "workerd".
		if (dot.definesWorker) {
			errors.push("A program package has no Worker entry. libfabrika builds its box; '.' is one.");
		}

		const subpaths = Object.keys(exports).filter(
			(key) => key.startsWith("./") && key !== "./window",
		);
		const windowTargets = "./window" in exports ? resolveKey("./window") : [];
		const real = (paths: readonly (string | undefined)[]) =>
			paths.flatMap((path) => (path === undefined || declaration(path) ? [] : [path]));
		// A window behind another key is reported there, so it does not count as unexported too.
		const exported = graph(real(windowTargets)).files;

		// libfabrika's own entry names stay refused even on pure code: the box is never the program's.
		for (const key of subpaths) {
			const loaded = graph([...new Set(real(resolveKey(key)))]);

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

		if (windowTargets.includes(undefined)) {
			errors.push("The './window' export must name a real file.");
		}

		return {
			Program(node) {
				if (main || entries.length === 0 || !entries.some(isFile)) {
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
