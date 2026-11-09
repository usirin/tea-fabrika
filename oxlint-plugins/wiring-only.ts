// P24 extends P21's planned wiring check to the build command and shared stack.
// P21 is not on this branch, so this is a separate plugin until its registration is reconciled.
import type {CreateRule, Plugin} from "@oxlint/plugins";
import type {Node} from "./match.ts";

const name = (node: Node | null | undefined): string => {
	if (node?.type === "Identifier") return node.name;
	if (node?.type === "MemberExpression") return `${name(node.object)}.${name(node.property)}`;
	if (node?.type === "Literal" && typeof node.value === "string") return node.value;
	return "";
};
const entry =
	/\/next\/apps\/fabrika\/(?:build\.ts|alchemy\.run\.ts|src\/(?:build|runtime|table)\.ts|src\/entry\/electron-main\.ts)$/;
export const wiringOnly: CreateRule = {
	create(context) {
		if (!entry.test(context.filename.replaceAll("\\", "/"))) return {};
		const schemas = new Set(["Schema"]),
			effects = new Set<string>(),
			remote = new Set<string>(),
			alchemy = new Set(["Alchemy"]),
			cloudflare = new Set(["Cloudflare"]);
		const report = (node: Node) =>
			context.report({
				node,
				message:
					"App entries wire library calls. Put schemas, checks, folds and refusals in libfabrika.",
			});
		return {
			ImportDeclaration(node) {
				for (const s of node.specifiers) {
					if (node.source.value === "effect" && s.type === "ImportNamespaceSpecifier")
						effects.add(s.local.name);
					if (node.source.value === "effect/Schema") schemas.add(s.local.name);
					if (
						node.source.value === "alchemy" &&
						s.type === "ImportSpecifier" &&
						s.imported.type === "Identifier" &&
						s.imported.name === "remote"
					)
						remote.add(s.local.name);
					if (
						node.source.value === "effect" &&
						s.type === "ImportSpecifier" &&
						s.imported.type === "Identifier" &&
						s.imported.name === "Schema"
					)
						schemas.add(s.local.name);
					if (node.source.value === "alchemy") alchemy.add(s.local.name);
					if (node.source.value === "@alchemy.run/cloudflare") cloudflare.add(s.local.name);
				}
			},
			IfStatement: report,
			SwitchStatement: report,
			ConditionalExpression: report,
			ThrowStatement: report,
			CallExpression(node) {
				const callee = name(node.callee),
					root = callee.split(".")[0] ?? "";
				if (
					schemas.has(root) ||
					(effects.has(root) && callee.includes(".Schema.")) ||
					/\.(?:reduce|filter|every|some|find|match|check|decodeUnknown\w*)$/.test(callee)
				)
					report(node);
				if ((alchemy.has(root) && callee.endsWith(".remote")) || remote.has(callee))
					context.report({
						node,
						message:
							"Every declared resource needs a local provider. Alchemy.remote() cannot be used here.",
					});
				if (
					cloudflare.has(root) &&
					!/\.(?:providers|Worker|Bucket|DurableObject|WorkerLoader)$/.test(callee)
				)
					context.report({
						node,
						message:
							"This resource has no P12 local provider. Add and test its local provider first.",
					});
			},
			NewExpression(node) {
				if (schemas.has(name(node.callee).split(".")[0] ?? "")) report(node);
			},
			FunctionDeclaration(node) {
				if (/^(?:step|update|reducer|fold|check|refuse|validate|decode)/.test(node.id?.name ?? ""))
					report(node);
			},
			VariableDeclarator(node) {
				if (node.id.type === "Identifier" && schemas.has(name(node.init)))
					schemas.add(node.id.name);
				if (
					/^(?:step|update|reducer|fold|check|refuse|validate|decode)/.test(name(node.id)) &&
					/Function/.test(node.init?.type ?? "")
				)
					report(node);
			},
		};
	},
};
const plugin: Plugin = {meta: {name: "fabrika-wiring"}, rules: {"wiring-only": wiringOnly}};
export default plugin;
