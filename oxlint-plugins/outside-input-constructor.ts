// P17's decode paths. Follow local aliases, including aliases of curried Schema decoders.
import type {CreateRule, Scope, Variable} from "@oxlint/plugins";
import {ancestors, dotted, pathIn, type Node} from "./match.ts";

const scoped =
	/^next\/packages\/libfabrika\/src\/(?:data\/(?:id|log)|coordination\/authorization|door\/(?:door|store|nonce)|app\/(?:nemesis|chaos-state|runner|entry))\.ts$/;
const outside = /^(?:raw|wire|saved|row|params|input|body|bytes|stored|persisted)(?:[A-Z_].*)?$/;
const sync = /(?:^|\.)(?:decodeSync|decodeUnknownSync)$/;
// Existing response and reducer constructors are outside this change. These are the saved/input
// schemas P17 changes. Its new modules and every named decode function are checked in full.
const inputs = new Set([
	"Row",
	"Binding",
	"InputFact",
	"AppendMeta",
	"EnvelopeState",
	"ChangePending",
	"Receipt",
	"Enrollment",
	"Enrolled",
	"Incoming",
]);
const declarations = new Set(["Program", "Machine", "Cmd"]);

export const outsideInputConstructor: CreateRule = {
	create(context) {
		if (!scoped.test(pathIn(context))) return {};
		const aliases = new Map<Variable, Node>();
		const names = new Map<Variable, string>();
		const binding = (node: Node): Variable | undefined => {
			if (node.type !== "Identifier") return undefined;
			let scope: Scope | null = context.sourceCode.getScope(node);
			while (scope !== null) {
				const variable = scope.set.get(node.name);
				if (variable !== undefined) return variable;
				scope = scope.upper;
			}
			return undefined;
		};
		const resolve = (node: Node, seen = new Set<Variable>()): Node => {
			const variable = binding(node);
			if (variable === undefined || seen.has(variable)) return node;
			const value = aliases.get(variable);
			if (value === undefined) return node;
			seen.add(variable);
			return resolve(value, seen);
		};
		const name = (node: Node, seen = new Set<Variable>()): string | null => {
			if (node.type === "Identifier") {
				const variable = binding(node);
				if (variable === undefined || seen.has(variable)) return node.name;
				const imported = names.get(variable);
				if (imported !== undefined) return imported;
				const value = aliases.get(variable);
				if (value === undefined) return node.name;
				seen.add(variable);
				return name(value, seen) ?? node.name;
			}
			if (node.type === "MemberExpression" && !node.computed && !node.optional) {
				const owner = name(node.object, seen);
				const member = dotted(node.property);
				return owner === null || member === null ? null : `${owner}.${member}`;
			}
			return dotted(node);
		};
		const constant = (node: Node, seen = new Set<Variable>()): boolean => {
			const value = resolve(node, seen);
			switch (value.type) {
				case "Literal":
					return true;
				case "TemplateLiteral":
					return value.expressions.every((x) => constant(x, new Set(seen)));
				case "UnaryExpression":
					return constant(value.argument, seen);
				case "TSAsExpression":
				case "TSSatisfiesExpression":
					return constant(value.expression, seen);
				case "ArrayExpression":
					return value.elements.every((x) => x !== null && constant(x, new Set(seen)));
				case "ObjectExpression":
					return value.properties.every(
						(x) => x.type === "Property" && !x.computed && constant(x.value, new Set(seen)),
					);
				default:
					return false;
			}
		};
		const untrusted = (node: Node, seen = new Set<Variable>()): boolean => {
			if (node.type === "Identifier") {
				const variable = binding(node);
				if (variable !== undefined && seen.has(variable)) return false;
				const value = variable === undefined ? undefined : aliases.get(variable);
				if (value === undefined) return outside.test(node.name);
				if (variable !== undefined) seen.add(variable);
				return untrusted(value, seen);
			}
			if (
				node.type === "CallExpression" &&
				/(?:decode.*(?:Effect|Result)|makeEffect)$/.test(
					name(node.callee.type === "CallExpression" ? node.callee.callee : node.callee) ?? "",
				)
			)
				return false;
			if (node.type === "MemberExpression") return untrusted(node.object, seen);
			if (node.type === "Property") return untrusted(node.value, seen);
			if (node.type === "ObjectExpression")
				return node.properties.some((x) => untrusted(x, new Set(seen)));
			if (node.type === "ArrayExpression")
				return node.elements.some((x) => x !== null && untrusted(x, new Set(seen)));
			if (
				node.type === "SpreadElement" ||
				node.type === "AwaitExpression" ||
				node.type === "YieldExpression"
			)
				return node.argument !== null && untrusted(node.argument, seen);
			if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression")
				return untrusted(node.expression, seen);
			if (node.type === "CallExpression")
				return (
					/(?:\.get|\.read|JSON\.parse)$/.test(dotted(node.callee) ?? "") ||
					node.arguments.some((x) => untrusted(x, new Set(seen)))
				);
			return false;
		};
		const inDecoder = (node: Node): boolean =>
			[...ancestors(node)].some((parent) => {
				if (parent.type === "FunctionDeclaration")
					return /^(?:decode|parse|load|read)/i.test(parent.id?.name ?? "");
				if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
					return /^(?:decode|parse|load|read)/i.test(parent.id.name);
				return false;
			});
		return {
			ImportSpecifier(node) {
				const variable = binding(node.local);
				if (variable !== undefined)
					names.set(
						variable,
						node.imported.type === "Identifier" ? node.imported.name : String(node.imported.value),
					);
			},
			VariableDeclarator(node) {
				if (node.init === null) return;
				for (const variable of context.sourceCode.getDeclaredVariables(node))
					aliases.set(variable, node.init);
				if (node.id.type !== "ObjectPattern") return;
				const owner = name(node.init);
				if (owner === null) return;
				for (const property of node.id.properties) {
					if (property.type !== "Property" || property.computed) continue;
					const variable = binding(property.value);
					const member =
						property.key.type === "Literal" ? String(property.key.value) : dotted(property.key);
					if (variable !== undefined && member !== null) names.set(variable, `${owner}.${member}`);
				}
			},
			AssignmentExpression(node) {
				const variable = binding(node.left);
				if (variable !== undefined) {
					names.delete(variable);
					aliases.set(variable, node.right);
				}
			},
			CallExpression(node) {
				const callee = resolve(node.callee);
				const call = name(node.callee) ?? "";
				const idMake = call === "Id.make";
				const args = node.arguments;
				const first = args[0];
				const curried = callee.type === "CallExpression" && sync.test(name(callee.callee) ?? "");
				const type = call.split(".")[0] ?? "";
				const added =
					/\/(?:data\/id|coordination\/authorization|app\/(?:nemesis|chaos-state))\.ts$/.test(
						pathIn(context),
					);
				const constructor =
					call.endsWith(".make") &&
					!declarations.has(type) &&
					(added || inputs.has(type) || inDecoder(node));
				const throwing = constructor || sync.test(call) || curried;
				if (!idMake && !throwing) return;
				// A curried decoder declaration takes a schema; the following call takes the bytes.
				if (sync.test(call) && args.length === 1 && first !== undefined && !untrusted(first))
					return;
				if (
					idMake
						? args.length === 1 && first !== undefined && constant(first)
						: !args.some((x) => untrusted(x) || (inDecoder(node) && !constant(x)))
				)
					return;
				context.report({
					node,
					message:
						"Outside input needs a typed decoder: decodeUnknownEffect, decodeUnknownResult or makeEffect. Id.make takes a code-written prefix constant.",
				});
			},
		};
	},
};
