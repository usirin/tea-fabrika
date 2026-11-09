// Today's app, T343/T22. Views read global tokens. This rule checks literal CSS hex and
// color functions, including canvas assignments. The config limits it to window/view files.
// Named words are checked only in color-valued properties to avoid flagging labels like "red".
import type {CreateRule} from "@oxlint/plugins";

const raw =
	/^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.+\))$/i;
const named =
	/^(?:black|white|red|green|blue|cyan|magenta|yellow|gray|grey|orange|purple|pink|rebeccapurple)$/i;
const colorProperty =
	/^(?:color|backgroundColor|borderColor|outlineColor|fill|stroke|fillStyle|strokeStyle|shadowColor)$/;
const message = "Read a global color token instead of a raw color in a view (themes, T22).";

export const noRawColor: CreateRule = {
	create(context) {
		return {
			Literal(node) {
				if (typeof node.value !== "string") return;
				const parent = node.parent;
				const property =
					parent.type === "Property" && parent.key.type === "Identifier"
						? parent.key.name
						: parent.type === "AssignmentExpression" &&
							  parent.left.type === "MemberExpression" &&
							  parent.left.property.type === "Identifier"
							? parent.left.property.name
							: parent.type === "JSXAttribute" && parent.name.type === "JSXIdentifier"
								? parent.name.name
								: "";
				if (raw.test(node.value) || (colorProperty.test(property) && named.test(node.value)))
					context.report({node, message});
			},
			TemplateLiteral(node) {
				const text = node.quasis.map((part) => part.value.cooked ?? "").join("");
				if (node.expressions.length === 0 && raw.test(text)) context.report({node, message});
			},
		};
	},
};
