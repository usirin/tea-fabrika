// Today's frame owns every CSS layer choice. This closes the literal TS/TSX write routes.
import type {CreateRule, ESTree} from "@oxlint/plugins";
import {isWritten} from "./match.ts";

const text = (node: ESTree.Node): string | null =>
	node.type === "Identifier"
		? node.name
		: node.type === "Literal" && typeof node.value === "string"
			? node.value
			: null;
const reserved = (name: string | null) =>
	name !== null &&
	(name === "zIndex" ||
		name === "z-index" ||
		name.startsWith("--layer-") ||
		/^--manti-(dialog|popover|tooltip)-z-index$/.test(name));
const css = (node: ESTree.Node) =>
	node.type === "Literal" &&
	typeof node.value === "string" &&
	/(?:z-index|--layer-[\w-]+|--manti-(?:dialog|popover|tooltip)-z-index)\s*:/i.test(node.value);
const message =
	"Layer choices belong to the frame's CSS block, never inline styles or DOM writes (layers L1).";

export const noLayerStyle: CreateRule = {
	create(context) {
		return {
			Property(node) {
				if (node.parent.type === "ObjectExpression" && reserved(text(node.key)))
					context.report({node, message});
			},
			MemberExpression(node) {
				if (isWritten(node) && reserved(text(node.property))) context.report({node, message});
			},
			AssignmentExpression(node) {
				if (
					node.left.type === "MemberExpression" &&
					text(node.left.property) === "cssText" &&
					css(node.right)
				)
					context.report({node, message});
			},
			CallExpression(node) {
				const method = node.callee.type === "MemberExpression" ? text(node.callee.property) : null;
				const arg = node.arguments[0];
				if (method === "setProperty" && arg !== undefined && reserved(text(arg)))
					context.report({node, message});
				if (
					method === "setAttribute" &&
					arg !== undefined &&
					text(arg) === "style" &&
					node.arguments[1] !== undefined &&
					css(node.arguments[1])
				)
					context.report({node, message});
			},
		};
	},
};
