// next/ uses Effect's platform. A native import needs a reason on its source line.
import {builtinModules} from "node:module";
import type {CreateRule} from "@oxlint/plugins";
import {pathIn, type Node} from "./match.ts";

const builtins = new Set(builtinModules);
const replacement = (module: string): string => {
	switch (module.split("/")[0]) {
		case "fs":
			return "effect/FileSystem (FileSystem)";
		case "path":
			return "effect/Path (Path)";
		case "child_process":
			return "effect/process (ChildProcess and ChildProcessSpawner)";
		case "util":
			return "effect/cli (Command, Flag and Argument for parseArgs)";
		case "os":
			return 'effect/Config (Config.String("HOME") for homedir), FileSystem.makeTempDirectoryScoped for temporary directories';
		case "crypto":
			return "effect/crypto (SecureRandom for secure bytes and UUIDs, Digest for hashes); effect/Random is only for nonsecure values";
		case "url":
			return "effect/Path (Path.fromFileUrl and Path.toFileUrl), or the standard URL";
		case "stream":
			return "effect/Stream and effect/Sink";
		case "events":
			return "effect/Queue, effect/PubSub or effect/Stream";
		case "buffer":
			return "Uint8Array and effect/encoding";
		case "http":
		case "https":
			return "effect/http (HttpClient and HttpServer)";
		case "readline":
			return "effect/Terminal (line editing may need a native edge)";
		case "sqlite":
			return "Effect SQL where it fits; a synchronous SQLite adapter needs a named edge";
		default:
			return "Effect 4.1.2's platform modules where they cover this operation";
	}
};

export const noNodeImports: CreateRule = {
	create(context) {
		const file = pathIn(context);
		if (
			!file.startsWith("next/") ||
			/\/e2e\//.test(file) ||
			/\.(?:test|test-support)\.tsx?$/.test(file)
		)
			return {};
		const comments = context.sourceCode.getAllComments();
		const check = (source: Node | null | undefined) => {
			const value =
				source?.type === "Literal"
					? source.value
					: source?.type === "TemplateLiteral" && source.expressions.length === 0
						? source.quasis[0]?.value.cooked
						: null;
			if (typeof value !== "string" || source == null) return;
			const module = value.replace(/^node:/, "");
			if (!value.startsWith("node:") && !builtins.has(module)) return;
			// Only a real line comment on the module string's line counts. A nearby comment,
			// a string containing // edge:, or an empty reason must not bless another import.
			if (
				comments.some(
					(comment) =>
						comment.type === "Line" &&
						comment.loc.start.line === source.loc.start.line &&
						/^\s*edge:\s*\S/.test(comment.value),
				)
			)
				return;
			context.report({
				node: source,
				message: `Use ${replacement(module)}. Native imports in next/ need // edge: <reason> on this line (docs/direction/build-on-effect.md).`,
			});
		};
		return {
			ImportDeclaration: (node) => check(node.source),
			ExportNamedDeclaration: (node) => check(node.source),
			ExportAllDeclaration: (node) => check(node.source),
			ImportExpression: (node) => check(node.source),
			// Types stay covered: they can bind an adapter to Node just as value imports do.
			TSImportType: (node) => check(node.source),
			CallExpression(node) {
				const callee = node.callee;
				if (
					(callee.type === "Identifier" && callee.name === "require") ||
					(callee.type === "MemberExpression" &&
						!callee.computed &&
						callee.property.type === "Identifier" &&
						callee.property.name === "require" &&
						callee.object.type === "Identifier" &&
						["module", "globalThis"].includes(callee.object.name))
				)
					check(node.arguments[0]);
			},
			TSImportEqualsDeclaration(node) {
				if (node.moduleReference.type === "TSExternalModuleReference")
					check(node.moduleReference.expression);
			},
		};
	},
};
