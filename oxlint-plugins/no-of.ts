// No bare `of` and no `xOf` name in `next/` (docs/direction/schema-classes-not-of-helpers.md). Tier
// 1's exam, item 4 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It fires on a name this file declares: a variable, a function, a type or interface, a class, a
// parameter, an object key, a class member or a type member, named `of` or ending in `Of` after a
// letter or digit (`colorsOf`, `IconOf`, `URLOf`). It does not fire on a use, so `xs.indexOf(x)`,
// `for (const x of xs)` and an import pass. A shorthand destructure (`const {indexOf} = xs`) takes a
// name someone else chose, so it passes too; a renamed one (`const {a: colorsOf} = xs`) fires.
//
// `.oxlintrc.json` turns it on in all of `next/**`, tests included: a test names its helpers too.
import type {CreateRule} from "@oxlint/plugins";
import type {Node} from "./match.ts";

const OF = /^of$|[A-Za-z0-9]Of$/;

/** The name a key or an id spells, if it is written plainly: `of`, `"of"`. */
const spelled = (node: Node | null | undefined): string | null => {
	if (node == null) {
		return null;
	}

	if (node.type === "Identifier") {
		return node.name;
	}

	if (node.type === "Literal" && typeof node.value === "string") {
		return node.value;
	}

	return null;
};

export const noOf: CreateRule = {
	create(context) {
		const check = (node: Node | null | undefined) => {
			const name = spelled(node);

			if (node == null || name === null || !OF.test(name)) {
				return;
			}

			context.report({
				node,
				message: `\`${name}\`: no bare \`of\` and no \`xOf\` names in next/. Put the helper on its type as a static (\`make\`, \`fromX\`, \`toX\`), or give it a plain name (docs/direction/schema-classes-not-of-helpers.md).`,
			});
		};
		/** Each name a binding pattern declares, leaving out a shorthand key's borrowed name. */
		const bound = (node: Node | null | undefined): void => {
			if (node == null) {
				return;
			}

			switch (node.type) {
				case "Identifier":
					check(node);
					return;
				case "ObjectPattern":
					for (const p of node.properties) {
						if (p.type === "RestElement") {
							bound(p.argument);
						} else if (!p.shorthand) {
							bound(p.value);
						}
					}

					return;
				case "ArrayPattern":
					for (const e of node.elements) {
						bound(e);
					}

					return;
				case "RestElement":
					bound(node.argument);
					return;
				case "AssignmentPattern":
					bound(node.left);
					return;
				case "TSParameterProperty":
					bound(node.parameter);
					return;
				default:
					return;
			}
		};
		const params = (node: {readonly params: readonly Node[]}) => {
			for (const p of node.params) {
				bound(p);
			}
		};
		return {
			VariableDeclarator(node) {
				bound(node.id);
			},
			FunctionDeclaration(node) {
				check(node.id);
				params(node);
			},
			FunctionExpression(node) {
				check(node.id);
				params(node);
			},
			ArrowFunctionExpression(node) {
				params(node);
			},
			TSDeclareFunction(node) {
				check(node.id);
				params(node);
			},
			ClassDeclaration(node) {
				check(node.id);
			},
			ClassExpression(node) {
				check(node.id);
			},
			TSTypeAliasDeclaration(node) {
				check(node.id);
			},
			TSInterfaceDeclaration(node) {
				check(node.id);
			},
			TSEnumDeclaration(node) {
				check(node.id);
			},
			Property(node) {
				const {parent} = node as Node & {readonly parent: Node};

				if (parent.type === "ObjectExpression" && !node.computed && !node.shorthand) {
					check(node.key);
				}
			},
			MethodDefinition(node) {
				if (!node.computed) {
					check(node.key);
				}
			},
			PropertyDefinition(node) {
				if (!node.computed) {
					check(node.key);
				}
			},
			TSPropertySignature(node) {
				if (!node.computed) {
					check(node.key);
				}
			},
			TSMethodSignature(node) {
				if (!node.computed) {
					check(node.key);
				}

				params(node);
			},
		};
	},
};
