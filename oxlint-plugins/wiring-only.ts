// P27a. The app supplies handles and registrations. Library modules keep the rules.
import type {CreateRule} from "@oxlint/plugins";
import {dotted, pathIn, type Node} from "./match.ts";

export const wiringOnly: CreateRule = {
	create(context) {
		const path = pathIn(context);
		const wiring =
			/^next\/apps\/fabrika\/(?:src\/(?:brain|runtime|table)|build|dev|alchemy\.run)\.ts$/.test(
				path,
			);
		const lib = /^next\/packages\/libfabrika\/src\/(chaos|app|coordination|data|transport)\//.exec(
			path,
		);
		const program = /^next\/programs\/[^/]+\/src\//.test(path);
		if (/\.(?:test|test-support)\.tsx?$/.test(path)) return {};
		const schema = new Set(["Schema"]);
		const report = (node: Node, message: string) => context.report({node, message});
		const branch = (node: Node) => {
			if (wiring) report(node, "A check or refusal belongs in libfabrika; app files only wire it.");
		};
		return {
			ImportDeclaration(node) {
				for (const spec of node.specifiers)
					if (
						spec.type === "ImportSpecifier" &&
						spec.imported.type === "Identifier" &&
						spec.imported.name === "Schema"
					)
						schema.add(spec.local.name);
				const source = String(node.source.value);
				if (
					program &&
					(/^@kampus\/.*-old(?:\/|$)/.test(source) ||
						/^(?:node:|cloudflare:|electron$)/.test(source) ||
						/\/apps\//.test(source))
				)
					report(node, "Programs use browser-safe next/ library contracts.");
				if (lib === null) return;
				if (/^@kampus\/.*-old(?:\/|$)/.test(source) || /(?:^|\/)apps\//.test(source))
					report(node, "The next/ library cannot import app code or today's code.");
				const target = /^\.\.\/(chaos|app|coordination|data|transport)\//.exec(source)?.[1];
				const part = lib[1];
				if (target === undefined || target === part) return;
				const allowed: Readonly<Record<string, ReadonlyArray<string>>> = {
					chaos: ["app", "coordination", "data", "transport"],
					app: ["coordination"],
					coordination: ["data"],
					data: [],
					transport: [],
				};
				if (!(allowed[part ?? ""] ?? []).includes(target))
					report(
						node,
						`${part} cannot import ${target}; the chaos composition belongs above both.`,
					);
			},
			IfStatement: branch,
			SwitchStatement: branch,
			ConditionalExpression: branch,
			ThrowStatement: branch,
			CallExpression(node) {
				if (!wiring) return;
				const name = dotted(node.callee) ?? "";
				if ([...schema].some((s) => name.startsWith(`${s}.`)))
					report(node, "Declare schemas in libfabrika, then wire their checked values here.");
				if (/\.(?:filter|reduce|some|every|find|findIndex)$/.test(name))
					report(node, "A fold or guard belongs in libfabrika.");
			},
		};
	},
};
