// Today's frame owns every CSS layer choice, including equivalent static JS spellings.
import type {CreateRule, ESTree} from "@oxlint/plugins";
import {cssName} from "./css-support.ts";
import {isWritten} from "./match.ts";

const rawTemplate = (node: ESTree.Node): ESTree.TemplateLiteral | null =>
	node.type === "TaggedTemplateExpression" &&
	node.tag.type === "MemberExpression" &&
	node.tag.object.type === "Identifier" &&
	node.tag.object.name === "String" &&
	(node.tag.property.type === "Identifier" ? node.tag.property.name : text(node.tag.property)) ===
		"raw"
		? node.quasi
		: null;

const text = (node: ESTree.Node): string | null => {
	if (node.type === "Literal" && typeof node.value === "string") return node.value;
	if (node.type === "BinaryExpression" && node.operator === "+") {
		const left = text(node.left);
		const right = text(node.right);
		return left === null || right === null ? null : left + right;
	}
	const raw = rawTemplate(node);
	const template = raw ?? node;
	if (template.type !== "TemplateLiteral") return null;
	const spelling = (quasi: ESTree.TemplateElement) =>
		raw !== null ? quasi.value.raw : (quasi.value.cooked ?? "");
	let value = template.quasis[0] === undefined ? "" : spelling(template.quasis[0]);
	for (const [index, expression] of template.expressions.entries()) {
		const part = text(expression);
		if (part === null) return null;
		const quasi = template.quasis[index + 1];
		value += part + (quasi === undefined ? "" : spelling(quasi));
	}
	return value;
};
// Keep the rule's original identifier checks as well as the new static expression forms.
const name = (key: ESTree.Node) => (key.type === "Identifier" ? key.name : text(key));
const reserved = (name: string | null) =>
	name !== null &&
	(name === "zIndex" ||
		name.toLowerCase() === "z-index" ||
		name.startsWith("--layer-") ||
		/^--manti-(dialog|popover|tooltip)-z-index$/.test(name));
const css = (node: ESTree.Node): boolean => {
	const value = text(node);
	if (value === null && node.type === "BinaryExpression" && node.operator === "+")
		return css(node.left) || css(node.right);
	// Unknown values cannot hide a known declaration name. A separator prevents inventing
	// a name by joining text across an expression whose value we do not know.
	const raw = rawTemplate(node);
	const template = raw ?? (node.type === "TemplateLiteral" ? node : null);
	const known =
		value ??
		template?.quasis
			.map((part) => (raw !== null ? part.value.raw : (part.value.cooked ?? part.value.raw)))
			.join("\0") ??
		"";
	const declarations = cssName(known.replace(/\/\*[\s\S]*?\*\//g, ""));
	return /(?:z-index|--layer-[\w-]+|--manti-(?:dialog|popover|tooltip)-z-index)\s*:/i.test(
		declarations,
	);
};
const message =
	"Layer choices belong to the frame's CSS block, never inline styles or DOM writes (layers L1).";

export const noLayerStyle: CreateRule = {
	create(context) {
		return {
			Property(node) {
				if (node.parent.type === "ObjectExpression" && reserved(name(node.key)))
					context.report({node, message});
			},
			MemberExpression(node) {
				if (isWritten(node) && reserved(name(node.property))) context.report({node, message});
			},
			AssignmentExpression(node) {
				if (
					node.left.type === "MemberExpression" &&
					name(node.left.property) === "cssText" &&
					css(node.right)
				)
					context.report({node, message});
			},
			CallExpression(node) {
				const method = node.callee.type === "MemberExpression" ? name(node.callee.property) : null;
				const arg = node.arguments[0];
				if (method === "setProperty" && arg !== undefined && reserved(name(arg)))
					context.report({node, message});
				if (
					method === "setAttribute" &&
					arg !== undefined &&
					name(arg)?.toLowerCase() === "style" &&
					node.arguments[1] !== undefined &&
					css(node.arguments[1])
				)
					context.report({node, message});
			},
		};
	},
};
