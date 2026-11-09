// Today's app, T343/T22. Views read global tokens. This rule checks literal CSS hex and
// color functions, including canvas assignments. The config limits it to window/view files.
// Named words are checked only in color-valued properties to avoid flagging labels like "red".
// In a property that draws words, a `var(--token)` must name a text token, followed through
// `extends`, as the CSS rule text-token does (color-principles.md: a line or fill never draws
// words). Keys may be written bare, quoted or computed from a string; values may be plain strings
// or templates without expressions (T343 review 2, class 5).
import {readdirSync, readFileSync} from "node:fs";
import type {CreateRule} from "@oxlint/plugins";
import {parse} from "smol-toml";

const raw =
	/^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.+\))$/i;
// CSS Color 4's named colors (https://www.w3.org/TR/css-color-4/#named-colors), all 148.
const named = new Set(
	`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
	brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
	darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
	darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
	darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
	fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred
	indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
	lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
	lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
	maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
	mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
	navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
	paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple
	red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
	slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
	wheat white whitesmoke yellow yellowgreen`.split(/\s+/),
);
const colorProperty =
	/^(?:color|background|backgroundColor|background-color|border|borderColor|border-color|outline|outlineColor|outline-color|caretColor|caret-color|textDecorationColor|text-decoration-color|fill|stroke|fillStyle|strokeStyle|shadowColor|stopColor|stop-color|WebkitTextFillColor|-webkit-text-fill-color|WebkitTextStrokeColor|-webkit-text-stroke-color)$/;
const textProperty =
	/^(?:color|caretColor|caret-color|WebkitTextFillColor|-webkit-text-fill-color|WebkitTextStrokeColor|-webkit-text-stroke-color)$/;
const message = "Read a global color token instead of a raw color in a view (themes, T22).";

const folder = new URL("../packages/fabrika-design/tokens/color/", import.meta.url);
const roles = new Map<string, {readonly type: unknown; readonly extends: string | undefined}>(
	readdirSync(folder)
		.filter((file) => file.endsWith(".toml"))
		.map((file) => {
			const token = parse(readFileSync(new URL(file, folder), "utf8"));
			const colors = token["colors"] as Record<string, unknown>;
			return [
				file.slice(0, -5),
				{
					type: token["type"],
					extends: typeof colors["extends"] === "string" ? colors["extends"] : undefined,
				},
			] as const;
		}),
);
const role = (name: string): unknown => {
	const seen = new Set<string>();
	let at: string | undefined = name;
	while (at !== undefined && !seen.has(at)) {
		seen.add(at);
		const value = roles.get(at);
		if (value?.extends === undefined) return value?.type;
		at = value.extends;
	}
	return undefined;
};
const tokensIn = (value: string) =>
	[...value.matchAll(/var\(\s*--([a-z0-9-]+)/g)].map(([, token = ""]) => token);

// AST nodes are read by field, so one reader covers Property, assignment and JSX parents.
const field = (node: unknown, key: string): unknown =>
	typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined;
const keyName = (key: unknown): string => {
	const type = field(key, "type");
	if (type === "Identifier") return String(field(key, "name"));
	const value = field(key, "value");
	if (type === "Literal" && typeof value === "string") return value;
	if (type === "TemplateLiteral") {
		const quasis = field(key, "quasis");
		const expressions = field(key, "expressions");
		return Array.isArray(quasis) && Array.isArray(expressions) && expressions.length === 0
			? quasis.map((q) => String(field(field(q, "value"), "cooked") ?? "")).join("")
			: "";
	}
	return "";
};
const propertyOf = (node: unknown): string => {
	const parent = field(node, "parent");
	const type = field(parent, "type");
	if (type === "Property" && field(parent, "value") === node) return keyName(field(parent, "key"));
	if (type === "AssignmentExpression" && field(parent, "right") === node) {
		const left = field(parent, "left");
		// Bare (`ctx.fillStyle`) and computed from a string (`ctx["fillStyle"]`) alike.
		return field(left, "type") === "MemberExpression" ? keyName(field(left, "property")) : "";
	}
	if (type === "JSXAttribute") {
		const name = field(parent, "name");
		return field(name, "type") === "JSXIdentifier" ? String(field(name, "name")) : "";
	}
	if (type === "JSXExpressionContainer") return propertyOf(parent);
	return "";
};

export const noRawColor: CreateRule = {
	create(context) {
		const judge = (
			node: NonNullable<Parameters<typeof context.report>[0]["node"]>,
			text: string,
		) => {
			const property = propertyOf(node);
			const value = text.trim();
			if (raw.test(value) || (colorProperty.test(property) && named.has(value.toLowerCase())))
				return context.report({node, message});
			if (!textProperty.test(property)) return;
			for (const token of tokensIn(value)) {
				const type = role(token);
				if (type !== undefined && type !== "text")
					context.report({
						node,
						message: `--${token} is ${String(type)}; words need a text token (themes, T22).`,
					});
			}
		};
		return {
			Literal(node) {
				if (typeof node.value === "string") judge(node, node.value);
			},
			TemplateLiteral(node) {
				if (node.expressions.length > 0) return;
				judge(node, node.quasis.map((part) => part.value.cooked ?? "").join(""));
			},
		};
	},
};
