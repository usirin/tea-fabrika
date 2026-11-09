// P16, next/. Program packages export pure code at '.' and an existing window at './window'.
// The generated Worker entry belongs to libfabrika, never to the program package.
import {existsSync, readFileSync} from "node:fs";
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

// Follow the actual pure entry, including re-exports. A window may share pure helpers.
const pureFiles = (root: string, entries: readonly string[]) => {
	const seen = new Set<string>();
	const visit = (file: string) => {
		if (declaration(file) || seen.has(file) || !existsSync(file)) return;
		seen.add(file);
		const tree = parseSync(file, readFileSync(file, "utf8")).program;
		const follow = (name: string) => {
			if (name.startsWith(".")) visit(resolve(dirname(file), name));
		};
		new Visitor({
			ImportDeclaration(node) {
				if (valueLink(node.importKind, node.specifiers) && typeof node.source.value === "string")
					follow(node.source.value);
			},
			ExportNamedDeclaration(node) {
				if (valueLink(node.exportKind, node.specifiers) && typeof node.source?.value === "string")
					follow(node.source.value);
			},
			ExportAllDeclaration(node) {
				if (node.exportKind !== "type" && typeof node.source.value === "string")
					follow(node.source.value);
			},
			ImportExpression(node) {
				if (node.source.type === "Literal" && typeof node.source.value === "string")
					follow(node.source.value);
			},
		}).visit(tree);
	};
	for (const entry of entries) visit(resolve(root, entry));
	return seen;
};

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
		const pure = pureFiles(root, entries);
		const main = entries.some((entry) => resolve(root, entry) === file);
		const errors: string[] = [];
		if (entries.length === 0 || entries.some((entry) => !existsSync(resolve(root, entry))))
			errors.push("Export a real pure program at '.'.");
		if (
			map(exports) &&
			Object.keys(exports).some((key) => /\/(?:worker|workers|workerd|box|brain)(?:\/|$)/.test(key))
		)
			errors.push("A program package has no Worker entry. libfabrika builds its box.");
		const windows = [
			"src/window.ts",
			"src/window.tsx",
			"src/window/index.ts",
			"src/window/index.tsx",
			"window.ts",
			"window.tsx",
		];
		const windowEntries = map(exports) ? targets(exports["./window"]) : [];
		if (windows.some((path) => existsSync(join(root, path))) && windowEntries.length === 0)
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
