// P14/P15's app entries register and call library operations. Checks and choices live there.
import type {CreateRule} from "@oxlint/plugins";
import {dotted} from "./match.ts";

const message =
	"App wiring only registers programs, chooses Layers and calls library operations. Move this check to libfabrika.";
export const wiringOnly: CreateRule = {
	create(context) {
		return {
			IfStatement(node) {
				if (context.sourceCode.getText(node.test) !== "import.meta.main")
					context.report({node, message});
			},
			ConditionalExpression(node) {
				context.report({node, message});
			},
			SwitchStatement(node) {
				context.report({node, message});
			},
			ThrowStatement(node) {
				context.report({node, message});
			},
			TryStatement(node) {
				context.report({node, message});
			},
			CallExpression(node) {
				const name = dotted(node.callee) ?? "";
				if (/^(?:Schema\.(?:decode|encode|is)|JSON\.parse)/.test(name))
					context.report({node, message});
			},
		};
	},
};
