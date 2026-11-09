// P25, next/. App command entries supply declarations, arguments and Layers to the library.
// Measured by wiring-only.test.ts: clean imported calls pass; parser, schema and refusal plants fail.
// Scope stays on the two P25 command entries until P21 supplies its broader measured rule.
import type {CreateRule} from "@oxlint/plugins";
import {dotted} from "./match.ts";

export const wiringOnly: CreateRule = {
	create(context) {
		const imported = new Set<string>();
		const forbidden = new Set<string>();
		return {
			ImportDeclaration(node) {
				for (const spec of node.specifiers) {
					imported.add(spec.local.name);
					if (
						spec.type === "ImportSpecifier" &&
						spec.imported.type === "Identifier" &&
						/^(?:Schema|.*(?:parse|decode|refus|readMcpOptions).*)$/i.test(spec.imported.name)
					)
						forbidden.add(spec.local.name);
				}
			},
			Property(node) {
				const key =
					node.key.type === "Identifier"
						? node.key.name
						: node.key.type === "Literal"
							? node.key.value
							: null;
				if (
					["why", "isError", "inputSchema", "schema", "personOnly", "digest", "seen"].includes(
						String(key),
					)
				)
					context.report({
						node,
						message: "Put checked command data and refusal fields in libfabrika.",
					});
			},
			FunctionDeclaration(node) {
				context.report({
					node,
					message:
						"Put command behavior in libfabrika. The app supplies programs, arguments and Layers.",
				});
			},
			ArrowFunctionExpression(node) {
				context.report({node, message: "Put command callbacks in libfabrika."});
			},
			FunctionExpression(node) {
				context.report({node, message: "Put command callbacks in libfabrika."});
			},
			IfStatement(node) {
				context.report({node, message: "Put command choices and refusals in libfabrika."});
			},
			ConditionalExpression(node) {
				context.report({node, message: "Put command choices and refusals in libfabrika."});
			},
			CallExpression(node) {
				const name = dotted(node.callee);
				if (name === null) return;
				if (name === "process.argv.slice") return;
				const root = name.split(".")[0] ?? "";
				if (
					imported.has(root) &&
					!forbidden.has(root) &&
					!/^Schema(?:\.|$)/.test(name) &&
					!/(?:parse|decode|refus|readMcpOptions)/i.test(name)
				)
					return;
				context.report({
					node,
					message:
						"Call the library command here. Parsing, validation and refusal wording belong in libfabrika.",
				});
			},
		};
	},
};
