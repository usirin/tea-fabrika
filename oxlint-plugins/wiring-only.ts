// P18 c8. Supported syntax: ES modules, calls, assignments and control statements.
// This checks app entries and Tuval platform re-exports. Library adapters own behavior.
import type {CreateRule, Plugin} from "@oxlint/plugins";
import {dotted, pathIn, type Node} from "./match.ts";

const wiringOnly: CreateRule = {
	create(context) {
		const path = pathIn(context);
		const app = /^next\/apps\/fabrika\/src\/(?:entry\/|runtime\.ts$)/.test(path);
		const drawing = /^next\/packages\/tuval\/src\/window\//.test(path);
		const core =
			/^next\/packages\/libfabrika\/src\/client\//.test(path) &&
			!/\/(?:browser|dom|headless|memory)\.ts$/.test(path);
		const platform =
			/^next\/packages\/tuval\/src\/(?:browser|headless)\//.test(path) ||
			path === "next/packages/tuval/src/desktop/services.ts";
		const imports = new Map<string, string>();
		const report = (node: Node) =>
			context.report({
				node,
				message:
					"Client decisions belong in libfabrika. This file only wires library operations (P18 c8).",
			});
		return {
			ImportDeclaration(node) {
				if (
					(core || drawing) &&
					/^(?:node:|cloudflare:|electron(?:\/|$)|@effect\/platform-node|effect\/socket)/.test(
						node.source.value,
					) &&
					!(core && node.source.value === "effect/socket/Socket")
				)
					report(node);
				for (const spec of node.specifiers) imports.set(spec.local.name, node.source.value);
			},
			VariableDeclaration(node) {
				if (platform) report(node);
			},
			FunctionDeclaration(node) {
				if (platform) report(node);
			},
			ClassDeclaration(node) {
				if (platform) report(node);
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
			AssignmentExpression(node) {
				if ((app || drawing) && node.left.type === "MemberExpression") report(node);
			},
			CallExpression(node) {
				if (!app && !drawing) return;
				const name = dotted(node.callee) ?? "";
				const first = name.split(".")[0] ?? "";
				const source = imports.get(first) ?? "";
				if (
					/^(?:JSON\.(?:parse|stringify)|.*\.(?:decodeUnknown\w*|addEventListener|send|on))$/.test(
						name,
					) ||
					source.startsWith("effect/socket")
				)
					report(node);
			},
			NewExpression(node) {
				if (
					(app || drawing || core) &&
					/(?:WebSocket|ResizeObserver)$/.test(dotted(node.callee) ?? "")
				)
					report(node);
			},
			MemberExpression(node) {
				if (
					app &&
					node.object.type === "Identifier" &&
					/^(params|request)$/.test(node.object.name) &&
					node.property.type === "Identifier" &&
					["client", "session", "to", "by", "writer", "inbox"].includes(node.property.name)
				)
					report(node);
			},
		};
	},
};

// A separate plugin keeps registration inside P18's tests-owned file list.
const plugin: Plugin = {meta: {name: "p18"}, rules: {"wiring-only": wiringOnly}};
export default plugin;
