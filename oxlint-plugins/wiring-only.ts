// P21/P23, next/. App entries register library operations. They do not decide anything.
// Standalone registration keeps this tests-owned change out of index.ts, which P21 has not landed.
import type {CreateRule, Plugin} from "@oxlint/plugins";
import {pathIn, type Node} from "./match.ts";

export const wiringOnly: CreateRule = {
	create(context) {
		const path = pathIn(context);
		if (!path.startsWith("next/") || /\.(?:test|test-support)\.tsx?$/.test(path)) return {};
		const app = path.startsWith("next/apps/fabrika/src/") && !path.includes("/exam/");
		const native = path === "next/packages/libfabrika/src/electron/menu.ts";
		const linkService = [
			"next/packages/libfabrika/src/desktop/browser-link.ts",
			"next/packages/libfabrika/src/desktop/menu-cmds.ts",
			"next/packages/libfabrika/src/electron/main.ts",
		].includes(path);
		const report = (node: Node) =>
			context.report({
				node,
				message: "App entries only wire library operations. Put the decision in libfabrika.",
			});
		return {
			ImportDeclaration(node) {
				for (const spec of node.specifiers) {
					if (spec.type !== "ImportSpecifier") continue;
					const name =
						spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
					if (
						!native &&
						((name === "openBrowserLink" &&
							path !== "next/packages/libfabrika/src/desktop/browser-link.ts") ||
							(name === "BrowserLink" && !linkService))
					)
						context.report({
							node: spec,
							message: "Only the native menu callback may create a browser pass.",
						});
					if (
						app &&
						["Schema", "Machine", "Waiting", "foldMembers", "grantText", "revokeText"].includes(
							name,
						)
					)
						report(spec);
				}
			},
			IfStatement(node) {
				if (app) report(node);
			},
			SwitchStatement(node) {
				if (app) report(node);
			},
			ConditionalExpression(node) {
				if (app) report(node);
			},
			ForStatement(node) {
				if (app) report(node);
			},
			ForOfStatement(node) {
				if (app) report(node);
			},
			WhileStatement(node) {
				if (app) report(node);
			},
			CallExpression(node) {
				if (
					!app ||
					node.callee.type !== "MemberExpression" ||
					node.callee.computed ||
					node.callee.property.type !== "Identifier"
				)
					return;
				if (
					["reduce", "filter", "map", "fold", "match", "sort", "find", "some", "every"].includes(
						node.callee.property.name,
					)
				)
					report(node);
			},
		};
	},
};
const plugin: Plugin = {meta: {name: "fabrika-wiring"}, rules: {"wiring-only": wiringOnly}};
export default plugin;
