// P16, next/. Program packages export pure code at '.' and an existing window at './window'.
// The generated Worker entry belongs to libfabrika, never to the program package.
import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from "node:fs";
import {basename, dirname, join, relative, resolve} from "node:path";
import type {CreateRule} from "@oxlint/plugins";
import {parseSync, Visitor} from "oxc-parser";
import {ResolverFactory} from "oxc-resolver";

const map = (x: unknown): x is Record<string, unknown> =>
	typeof x === "object" && x !== null && !Array.isArray(x);

const declaration = (file: string) => /\.d\.[cm]?ts$/.test(file);

// A file a runtime may run as code: a JavaScript or TypeScript extension, or none at all. The rest
// (CSS, JSON, an image) is an asset and holds no Worker code.
const code = (file: string) => /\.[cm]?[jt]sx?$/.test(file) || !basename(file).includes(".");

// A file oxlint lints, so a finding reported on it is seen.
const lintable = (file: string) => /\.[cm]?[jt]sx?$/.test(file) && !declaration(file);

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

// A string a link names as written: a string literal or a template literal with no `${}`.
const literal = (node: unknown): string | undefined =>
	!map(node)
		? undefined
		: node.type === "Literal"
			? typeof node.value === "string"
				? node.value
				: undefined
			: node.type === "TemplateLiteral" &&
				  Array.isArray(node.expressions) &&
				  node.expressions.length === 0 &&
				  Array.isArray(node.quasis) &&
				  map(node.quasis[0]) &&
				  map(node.quasis[0].value) &&
				  typeof node.quasis[0].value.cooked === "string"
				? node.quasis[0].value.cooked
				: undefined;

// `require("x")` with one argument.
const required = (node: {readonly callee: unknown; readonly arguments: readonly unknown[]}) =>
	map(node.callee) && node.callee.type === "Identifier" && node.callee.name === "require";

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

// Follow an entry's value links, including re-exports, literal dynamic imports and `require`. Each
// file says whether it loads Worker code: a Worker runtime import, a Worker class or a Worker
// handler. `definesWorker` keeps the last two apart, for '.', whose runtime imports are reported
// per line. A link by any other name is followed when it resolves inside the package (its own
// name, a `#` import, an absolute path). What the rule cannot read is `unjudged`, never fine.
const graph = (entries: readonly string[], root: string) => {
	const files = new Set<string>();
	// The files that link a Worker runtime name themselves.
	const runtime = new Set<string>();
	const unjudged: string[] = [];
	const home = realpathSync(root);
	const inside = (path: string) => {
		const at = relative(home, realpathSync(path));

		return !at.startsWith("..") && !/(?:^|\/)node_modules(?:\/|$)/.test(at);
	};
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

		if (!code(file)) {
			return;
		}

		const at = relative(root, file);
		let text: string;

		try {
			text = readFileSync(file, "utf8");
		} catch {
			unjudged.push(`'${at}' cannot be read`);
			return;
		}

		const parsed = parseSync(file, text);

		if (parsed.errors.length > 0) {
			unjudged.push(`'${at}' does not parse`);
		}

		const tree = parsed.program;
		const link = (name: string | undefined) => {
			if (name === undefined) {
				unjudged.push(`'${at}' loads a module by a computed name`);
			} else if (worker(name)) {
				loadsWorker = true;
				runtime.add(file);
			} else {
				const target = resolver.sync(dirname(file), name).path;

				if (target !== undefined && (name.startsWith(".") || inside(target))) {
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
		// A base class by a local name, as in `const Base = DurableObject; class X extends Base {}`.
		const workerBase = (node: unknown) => {
			const seen = new Set<string>();
			let at = value(node);

			while (map(at)) {
				if (workerClass(at)) {
					return true;
				}

				if (at.type !== "Identifier" || typeof at.name !== "string" || seen.has(at.name)) {
					return false;
				}

				seen.add(at.name);
				at = value(values.get(at.name));
			}

			return false;
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
				link(literal(node.source));
			},
			CallExpression(node) {
				if (required(node)) {
					link(literal(node.arguments[0]));
				}
			},
			TSImportEqualsDeclaration(node) {
				if (
					node.importKind !== "type" &&
					node.moduleReference.type === "TSExternalModuleReference"
				) {
					link(literal(node.moduleReference.expression));
				}
			},
			ClassDeclaration(node) {
				if (workerBase(node.superClass)) {
					defines();
				}
			},
			ClassExpression(node) {
				if (workerBase(node.superClass)) {
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

	return {files, runtime, unjudged, loadsWorker, definesWorker};
};

const isFolder = (path: string) => existsSync(path) && statSync(path).isDirectory();

// Every path under a folder, through symlinked folders as Node and the resolver go through them,
// with a guard against a link loop. `skip` names the folders left out.
const listing = (folder: string, skip: readonly string[]) => {
	const found: string[] = [];
	const walk = (at: string, path: string, above: ReadonlySet<string>) => {
		const real = realpathSync(at);

		if (above.has(real)) {
			return;
		}

		const chain = new Set([...above, real]);

		for (const entry of readdirSync(at)) {
			if (skip.includes(entry)) {
				continue;
			}

			const next = path === "" ? entry : `${path}/${entry}`;
			found.push(next);

			if (isFolder(join(at, entry))) {
				walk(join(at, entry), next, chain);
			}
		}
	};

	if (isFolder(folder)) {
		walk(folder, "", new Set());
	}

	return found;
};

// The package's own sources: dependencies and build output aside.
const sources = (root: string) => listing(root, ["node_modules", "dist"]);

// The resolver resolves one subpath; it cannot list the subpaths a pattern key offers. So list
// what each target's `*` matches among the files under the target's folder (one or more
// characters, folders included, as Node matches; every `*` in a target is the same text). Build
// output counts here, since a target may name it; a dependency folder counts only when the target
// names it. A target without `*` maps every subpath to one file, so any one subpath stands for all.
const matchesOf = (root: string, exportValue: unknown): string[] => {
	const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

	return [
		...new Set(
			targetStrings(exportValue).flatMap((target) => {
				if (!target.includes("*")) {
					return ["_"];
				}

				const [before = "", ...rest] = target.split("*");
				const folder = before.slice(0, before.lastIndexOf("/") + 1);
				const skip = /(?:^|\/)node_modules\//.test(folder) ? [] : ["node_modules"];
				const files = listing(resolve(root, folder), skip).map((path) => `${folder}${path}`);
				const pattern = new RegExp(`^${escape(before)}(.+)${rest.map(escape).join("\\1")}$`);

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

		// A test file is judged like any other: it reports only when it is the '.' entry or pure code.
		if (!matched?.[1]) {
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

		// The resolver finds the package by its own name, as Node's self-reference does (11.24.2
		// matches any string name). With no name the package's exports cannot be asked, and every
		// subpath a pattern matches counts as offered.
		const name = map(manifest) && typeof manifest.name === "string" ? manifest.name : "";
		const raw = map(manifest) ? manifest.exports : undefined;
		const keys = map(raw) ? Object.keys(raw) : [];
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
				const own = targets.map((path) => target(path.replaceAll("*", match)));
				const real = new Set(
					own.flatMap((path) => (path === undefined ? [] : [realpathSync(path)])),
				);
				// The subpath is this key's only if the package's exports answer with one of its own
				// targets: a null target or a more specific key takes it away. With no name to ask by,
				// it stays the key's.
				const offered =
					name === "" ||
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
		const dot = graph(entries, root);
		const pure = dot.files;
		// The files oxlint lints here: in the package, by their own path (no symlink on the way),
		// outside dependencies and the config's ignored folders. The per-line checks below see only
		// these, so pure code anywhere else that loads a Worker runtime is reported for the package.
		const lined = (path: string) => {
			const at = relative(root, path);

			return (
				!at.startsWith("..") &&
				lintable(path) &&
				realpathSync(path) === join(realpathSync(root), at) &&
				!/(?:^|\/)(?:node_modules|fixtures)\//.test(at)
			);
		};

		// The package's findings are reported once, on its first '.' entry oxlint lints, or on every
		// file when no entry is one.
		const first = entries.find((path) => isFile(path) && lined(path));
		const report = first === undefined || first === file;
		const errors: string[] = [];
		const unjudged = (key: string, reasons: readonly string[]) => {
			for (const reason of reasons) {
				errors.push(`The rule cannot judge '${key}': ${reason}.`);
			}
		};

		// Node refuses an exports object that mixes subpaths with conditions or other keys.
		if (
			keys.some((key) => key.startsWith(".")) &&
			keys.some((key) => key !== "." && !key.startsWith("./"))
		) {
			errors.push("Every export key is '.' or a subpath starting with './'.");
		}

		unjudged(".", dot.unjudged);

		for (const path of dot.runtime) {
			if (!lined(path)) {
				errors.push(
					`Pure program code cannot load Worker runtime APIs, as '${relative(root, path)}' does.`,
				);
			}
		}

		if (entries.length === 0 || dotTargets.includes(undefined)) {
			errors.push("Export a real pure program at '.'.");
		}

		// A Worker class or handler behind any runtime condition of '.', such as "workerd".
		if (dot.definesWorker) {
			errors.push("A program package has no Worker entry. libfabrika builds its box; '.' is one.");
		}

		// './window' is judged for Worker code like every other subpath.
		const subpaths = Object.keys(exports).filter((key) => key.startsWith("./"));
		const windowTargets = "./window" in exports ? resolveKey("./window") : [];
		const real = (paths: readonly (string | undefined)[]) =>
			paths.flatMap((path) => (path === undefined || declaration(path) ? [] : [path]));
		// A window behind another key is reported there, so it does not count as unexported too.
		const exported = new Set<string>();

		// libfabrika's own entry names stay refused even on pure code: the box is never the program's.
		for (const key of subpaths) {
			const targets = key === "./window" ? windowTargets : resolveKey(key);
			const loaded = graph([...new Set(real(targets))], root);

			for (const path of loaded.files) {
				exported.add(path);
			}

			unjudged(key, loaded.unjudged);

			if (/\/(?:worker|workers|workerd|box|brain)(?:\/|$)/.test(key) || loaded.loadsWorker) {
				errors.push(
					`A program package has no Worker entry. libfabrika builds its box; '${key}' is one.`,
				);
			}

			if (key !== "./window" && [...loaded.files].some(windowFile)) {
				errors.push(`The window is exported at './window', never at '${key}'.`);
			}

			// A pattern subpath may map to no file in one fallback target; a plain key may not.
			if (key !== "./window" && !key.includes("*") && targets.includes(undefined)) {
				errors.push(`The '${key}' export must name a real file.`);
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
				if (report) {
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
				const name = literal(node.source);

				if (pure.has(file) && name !== undefined && worker(name)) {
					context.report({node, message: "Pure program code cannot load Worker runtime APIs."});
				}
			},
			CallExpression(node) {
				const name = required(node) ? literal(node.arguments[0]) : undefined;

				if (pure.has(file) && name !== undefined && worker(name)) {
					context.report({node, message: "Pure program code cannot load Worker runtime APIs."});
				}
			},
			TSImportEqualsDeclaration(node) {
				const name =
					node.importKind !== "type" && node.moduleReference.type === "TSExternalModuleReference"
						? literal(node.moduleReference.expression)
						: undefined;

				if (pure.has(file) && name !== undefined && worker(name)) {
					context.report({node, message: "Pure program code cannot import Worker runtime APIs."});
				}
			},
		};
	},
};
