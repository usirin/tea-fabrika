// A relative import names its file whole: `./thing.ts`, not `./thing`.
//
// Why: Node runs this repo's .ts files as they are, and Node does not guess a file's extension.
// `import {a} from "./thing"` type-checks in many setups and then fails at run time.
//
// Oxlint's own `import/extensions` is not used: it misses `import("./thing")` and
// `import x = require("./thing")`, and it takes `./thing.laws` for a named file when the file is
// `thing.laws.ts`. Biome's `useImportExtensions` caught all three.
//
// What it refuses: a relative `import`, `export ... from`, `import(...)`, `require(...)` or
// `import x = require(...)`, when what it names is not a file and either has no extension at all,
// is a folder, becomes a file once an extension is added, or is the wrong extension of a file that
// is there. That last one is `./thing.js` when only `thing.ts` exists: tsc accepts it, and Node then
// fails with ERR_MODULE_NOT_FOUND.
//
// What it lets pass: a name with an extension when nothing by that name is on disk under any
// extension. Lint cannot tell a typo from a file made by a build. `tsc` catches it where it runs, and
// it does not run on `experiments/`.
//
// What it cannot see: a name built at run time (`import(name)`, or a template string), and an
// `import("./thing")` written as a type, which Node never runs. It has no automatic fix.
import {statSync} from "node:fs";
import {dirname, extname, resolve} from "node:path";
import type {CreateRule} from "@oxlint/plugins";
import type {Node} from "./match.ts";

const RELATIVE = /^\.\.?(?:\/|$)/;
const HAS_EXTENSION = /\/?[^/]*[^/.]\.[^/.]+$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

const isFile = (path: string): boolean =>
	statSync(path, {throwIfNoEntry: false})?.isFile() === true;
const isFolder = (path: string): boolean =>
	statSync(path, {throwIfNoEntry: false})?.isDirectory() === true;

const namesItsFile = (from: string, written: string): boolean => {
	const target = resolve(dirname(from), written);
	if (isFile(target)) return true;
	if (isFolder(target) || !HAS_EXTENSION.test(written)) return false;
	const stem = target.slice(0, -extname(target).length);
	return !EXTENSIONS.some((extension) => isFile(target + extension) || isFile(stem + extension));
};

export const useImportExtensions: CreateRule = {
	create(context) {
		const check = (source: Node | null | undefined) => {
			if (source == null || source.type !== "Literal" || typeof source.value !== "string") return;
			if (!RELATIVE.test(source.value) || namesItsFile(context.filename, source.value)) return;
			context.report({
				node: source,
				message:
					"A relative import names its file whole, extension included: Node runs the .ts files as they are and does not guess (`./thing.ts`, not `./thing`).",
			});
		};
		return {
			ImportDeclaration: (node) => check(node.source),
			ExportNamedDeclaration: (node) => check(node.source),
			ExportAllDeclaration: (node) => check(node.source),
			ImportExpression: (node) => check(node.source),
			TSExternalModuleReference: (node) => check(node.expression),
			CallExpression(node) {
				if (node.callee.type === "Identifier" && node.callee.name === "require") {
					check(node.arguments[0]);
				}
			},
		};
	},
};
