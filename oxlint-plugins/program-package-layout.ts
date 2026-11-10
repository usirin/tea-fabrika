// P16, next/. Program packages export pure code at '.' and an existing window at './window'.
// The generated Worker entry belongs to libfabrika, never to the program package.
import {existsSync, readdirSync, readFileSync} from "node:fs";
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

// Follow an entry's value links, including re-exports and literal dynamic imports. Each file
// says whether it loads Worker code: a Worker runtime import, a Worker class or a Worker handler.
const graph = (root: string, entries: readonly string[]) => {
	const files = new Set<string>();
	let loadsWorker = false;
	const visit = (file: string) => {
		if (declaration(file) || files.has(file) || !existsSync(file)) return;
		files.add(file);
		const tree = parseSync(file, readFileSync(file, "utf8")).program;
		const link = (name: string) => {
			if (worker(name)) loadsWorker = true;
			else if (name.startsWith(".")) visit(resolve(dirname(file), name));
		};
		new Visitor({
			ImportDeclaration(node) {
				if (valueLink(node.importKind, node.specifiers) && typeof node.source.value === "string")
					link(node.source.value);
			},
			ExportNamedDeclaration(node) {
				if (valueLink(node.exportKind, node.specifiers) && typeof node.source?.value === "string")
					link(node.source.value);
			},
			ExportAllDeclaration(node) {
				if (node.exportKind !== "type" && typeof node.source.value === "string")
					link(node.source.value);
			},
			ImportExpression(node) {
				if (node.source.type === "Literal" && typeof node.source.value === "string")
					link(node.source.value);
			},
			ClassDeclaration(node) {
				if (workerClass(node.superClass)) loadsWorker = true;
			},
			ClassExpression(node) {
				if (workerClass(node.superClass)) loadsWorker = true;
			},
			ExportDefaultDeclaration(node) {
				if (
					node.declaration.type === "ObjectExpression" &&
					node.declaration.properties.some(
						(p) => p.type === "Property" && p.key.type === "Identifier" && handler.test(p.key.name),
					)
				)
					loadsWorker = true;
			},
		}).visit(tree);
	};
	for (const entry of entries) visit(resolve(root, entry));
	return {files, loadsWorker};
};

// Every window-shaped source file in the package, tests and dependencies aside.
const windowFiles = (root: string) =>
	readdirSync(root, {recursive: true, encoding: "utf8"})
		.filter((path) => !/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path) && windowFile(path))
		.map((path) => resolve(root, path));

export const programPackageLayout: CreateRule = {
	create(context) {
		const file = context.filename;
		const matched = /^(.*\/next\/programs\/[^/]+)\//.exec(file);
		if (!matched?.[1] || /\.test\.tsx?$/.test(file)) return {};
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
		const pure = graph(root, entries).files;
		const main = entries.some((entry) => resolve(root, entry) === file);
		const errors: string[] = [];
		if (entries.length === 0 || entries.some((entry) => !existsSync(resolve(root, entry))))
			errors.push("Export a real pure program at '.'.");
		const subpaths = map(exports)
			? Object.entries(exports).filter(([key]) => key.startsWith("./") && key !== "./window")
			: [];
		const windowEntries = map(exports) ? targets(exports["./window"]) : [];
		// A window behind another key is reported there, so it does not count as unexported too.
		const exported = graph(root, windowEntries).files;
		// libfabrika's own entry names stay refused even on pure code: the box is never the program's.
		for (const [key, target] of subpaths) {
			const loaded = graph(root, targets(target));
			for (const path of loaded.files) exported.add(path);
			if (/\/(?:worker|workers|workerd|box|brain)(?:\/|$)/.test(key) || loaded.loadsWorker)
				errors.push(
					`A program package has no Worker entry. libfabrika builds its box; '${key}' is one.`,
				);
			if ([...loaded.files].some(windowFile))
				errors.push(`The window is exported at './window', never at '${key}'.`);
		}
		if (windowFiles(root).some((path) => !exported.has(path)))
			errors.push(
				"Export the real window at './window'. A program without a window needs no stub.",
			);
		if (windowEntries.some((path) => !existsSync(resolve(root, path))))
			errors.push("The './window' export must name a real file.");
		return {
			Program(node) {
				if (
					main ||
					entries.length === 0 ||
					entries.every((entry) => !existsSync(resolve(root, entry)))
				)
					for (const message of errors) context.report({node, message});
			},
			ImportDeclaration(node) {
				if (
					pure.has(file) &&
					valueLink(node.importKind, node.specifiers) &&
					typeof node.source.value === "string" &&
					worker(node.source.value)
				)
					context.report({node, message: "Pure program code cannot import Worker runtime APIs."});
			},
			ExportNamedDeclaration(node) {
				if (
					pure.has(file) &&
					valueLink(node.exportKind, node.specifiers) &&
					typeof node.source?.value === "string" &&
					worker(node.source.value)
				)
					context.report({node, message: "Pure program code cannot export Worker runtime APIs."});
			},
			ExportAllDeclaration(node) {
				if (
					pure.has(file) &&
					node.exportKind !== "type" &&
					typeof node.source.value === "string" &&
					worker(node.source.value)
				)
					context.report({node, message: "Pure program code cannot export Worker runtime APIs."});
			},
			ImportExpression(node) {
				if (
					pure.has(file) &&
					node.source.type === "Literal" &&
					typeof node.source.value === "string" &&
					worker(node.source.value)
				)
					context.report({node, message: "Pure program code cannot load Worker runtime APIs."});
			},
		};
	},
};
