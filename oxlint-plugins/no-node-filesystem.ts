// next/ product code uses Effect's replaceable FileSystem and Path services.
import type {CreateRule} from "@oxlint/plugins";
import {pathIn, type Node} from "./match.ts";

const native = /^(?:node:)?(?:fs(?:\/promises)?|path(?:\/(?:posix|win32))?)$/;

export const noNodeFilesystem: CreateRule = {
	create(context) {
		const file = pathIn(context);

		if (
			!file.startsWith("next/") ||
			/\/(?:exam|e2e)\//.test(file) ||
			/\.(?:test|test-support|d)\.tsx?$/.test(file)
		) {
			return {};
		}

		const check = (node: Node, source: Node | null | undefined) => {
			const value =
				source?.type === "Literal"
					? source.value
					: source?.type === "TemplateLiteral" && source.expressions.length === 0
						? source.quasis[0]?.value.cooked
						: null;
			const edge =
				source != null &&
				context.sourceCode
					.getAllComments()
					.some(
						(comment) =>
							comment.type === "Line" &&
							comment.loc.start.line === source.loc.start.line &&
							/^\s*edge:\s*\S/.test(comment.value),
					);

			if (typeof value === "string" && native.test(value) && !edge) {
				context.report({
					node,
					message:
						"Use Effect FileSystem and Path in next/ product code (docs/direction/build-on-effect.md).",
				});
			}
		};
		return {
			ImportDeclaration: (node) => check(node, node.source),
			ExportNamedDeclaration: (node) => check(node, node.source),
			ExportAllDeclaration: (node) => check(node, node.source),
			ImportExpression: (node) => check(node, node.source),
			CallExpression(node) {
				if (node.callee.type === "Identifier" && node.callee.name === "require") {
					check(node, node.arguments[0]);
				}
			},
			TSImportEqualsDeclaration(node) {
				if (node.moduleReference.type === "TSExternalModuleReference") {
					check(node, node.moduleReference.expression);
				}
			},
		};
	},
};
