// The typed half of no-promises. Oxlint's JS plugins have no type checker. This lint
// command uses the installed TypeScript 7.0.2 API, without emitting code or type diagnostics.
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Effect, FileSystem, Path} from "effect";
import * as ts from "typescript/unstable/ast";
import {API, SignatureKind, type Project, type Type} from "typescript/unstable/sync";

interface PromiseFinding {
	readonly file: string;
	readonly line: number;
	readonly why: string;
}

export const checkPromiseTypes = (
	project: Project,
	root: string,
	pathService: Path.Path,
): readonly PromiseFinding[] => {
	const {checker, program} = project;
	const found = new Map<string, PromiseFinding>();
	const memo = new Map<number, boolean>();
	const carries = (type: Type | undefined, seen = new Set<number>()): boolean => {
		if (type === undefined || seen.has(type.id)) return false;
		const saved = memo.get(type.id);
		if (saved !== undefined) return saved;
		seen.add(type.id);
		const then = checker.getPropertyOfType(type, "then");
		const thenType = then === undefined ? undefined : checker.getTypeOfSymbol(then);
		const yes =
			type.isUnionType() || type.isIntersectionType()
				? (type.getTypes() ?? []).some((t) => carries(t, seen))
				: (thenType !== undefined &&
						checker.getSignaturesOfType(thenType, SignatureKind.Call).length > 0) ||
					checker
						.getSignaturesOfType(type, SignatureKind.Call)
						.some((signature) => carries(checker.getReturnTypeOfSignature(signature), seen));
		memo.set(type.id, yes);
		return yes;
	};
	for (const path of program.getSourceFileNames()) {
		const file = pathService.relative(root, path).replaceAll("\\", "/");
		if (
			!file.startsWith("next/") ||
			file.includes("node_modules/") ||
			/\.(?:test|test-support|d)\.tsx?$/.test(file)
		)
			continue;
		const source = program.getSourceFile(path);
		if (source === undefined) throw new Error(`Cannot read ${file}`);
		const candidates = new Map<ts.Node, string>();
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				candidates.set(node, "call returns a Promise or a Promise thunk");
				for (const argument of node.arguments)
					candidates.set(argument, "call passes a Promise or a Promise thunk");
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
			)
				for (const parameter of node.parameters)
					candidates.set(parameter.name, "function takes a Promise or a Promise thunk");
			if (ts.isReturnStatement(node) && node.expression !== undefined)
				candidates.set(node.expression, "function returns a Promise or a Promise thunk");
			if (ts.isArrowFunction(node) && !ts.isBlock(node.body))
				candidates.set(node.body, "function returns a Promise or a Promise thunk");
			node.forEachChild(visit);
		};
		visit(source);
		const nodes = [...candidates.keys()];
		const types = checker.getTypeAtLocation(nodes);
		const lines = source.text.split("\n");
		const marked = (node: ts.Node): boolean => {
			// A marker covers the whole statement, even after formatting wraps it. It also
			// covers a marked expression body at a platform edge. Never reach a later sibling.
			for (let scope = node; scope !== source; scope = scope.parent) {
				const {line, character} = source.getLineAndCharacterOfPosition(scope.getStart(source));
				// Only the first statement or expression on the marked line gets the comment.
				if ((lines[line] ?? "").slice(0, character).trim() !== "") continue;
				const edge = /^\s*\/\/ oxlint-disable-next-line (.+?) -- edge: \S/.exec(
					lines[line - 1] ?? "",
				);
				const rules = new Set(edge?.[1]?.split(/[,\s]+/));
				// Oxlint separately checks that each comment is used.
				if (rules.has("fabrika/no-promises") || rules.has("fabrika/no-effect-run-outside-edge"))
					return true;
			}
			return false;
		};
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (node === undefined) throw new Error("Missing Promise candidate");
			if (!carries(types[i])) continue;
			const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
			if (marked(node)) continue;
			found.set(`${file}:${line + 1}`, {
				file,
				line: line + 1,
				why: candidates.get(node) ?? "Promise value outside a marked edge",
			});
		}
	}
	return [...found.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
};

const main = Effect.gen(function* () {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const root = path.resolve(import.meta.dirname, "../../../../..");
	const api = new API({cwd: root});
	try {
		const configs = (yield* fs.glob("next/**/tsconfig.json", {
			root,
			exclude: ["**/node_modules/**"],
		}))
			.filter((file) => !file.includes("node_modules/"))
			.map((file) => path.join(root, file));
		const snapshot = api.updateSnapshot({openProjects: configs});
		try {
			const findings = new Map<string, PromiseFinding>();
			for (const project of snapshot.getProjects())
				for (const f of checkPromiseTypes(project, root, path))
					findings.set(`${f.file}:${f.line}`, f);
			for (const f of findings.values())
				console.error(`${f.file}:${f.line} fabrika(no-promises): ${f.why}`);
			console.info(`lint:promise-types: ${findings.size} findings`);
			process.exitCode = findings.size === 0 ? 0 : 1;
		} finally {
			snapshot.dispose();
		}
	} finally {
		api.close();
	}
});
if (import.meta.main) NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)));
