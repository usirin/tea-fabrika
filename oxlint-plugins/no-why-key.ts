// next/'s reason key replaces why. Reads and dynamic keys keep their own meaning.
import type {CreateRule} from "@oxlint/plugins";
import type {Node} from "./match.ts";

export const noWhyKey: CreateRule = {
	create(context) {
		const check = (key: Node, computed: boolean) => {
			const name =
				!computed && key.type === "Identifier"
					? key.name
					: key.type === "Literal" && typeof key.value === "string"
						? key.value
						: computed && key.type === "TemplateLiteral" && key.expressions.length === 0
							? key.quasis[0]?.value.cooked
							: null;
			if (name === "why")
				context.report({
					node: key,
					message: "Use reason for this key in next/; why was renamed in the glossary.",
				});
		};
		return {
			Property(node) {
				if (node.parent.type === "ObjectExpression") check(node.key, node.computed);
			},
			PropertyDefinition: (node) => check(node.key, node.computed),
			AccessorProperty: (node) => check(node.key, node.computed),
			MethodDefinition: (node) => check(node.key, node.computed),
			TSAbstractPropertyDefinition: (node) => check(node.key, node.computed),
			TSAbstractAccessorProperty: (node) => check(node.key, node.computed),
			TSAbstractMethodDefinition: (node) => check(node.key, node.computed),
			TSParameterProperty(node) {
				check(
					node.parameter.type === "AssignmentPattern" ? node.parameter.left : node.parameter,
					false,
				);
			},
			TSPropertySignature: (node) => check(node.key, node.computed),
			TSMethodSignature: (node) => check(node.key, node.computed),
		};
	},
};
