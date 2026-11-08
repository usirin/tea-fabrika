// P17's decode paths. Follow local aliases, including aliases of curried Schema decoders.
import type {CreateRule} from "@oxlint/plugins";
import {ancestors, dotted, pathIn, type Node} from "./match.ts";

const scoped =
	/^next\/packages\/libfabrika\/src\/(?:data\/(?:id|log)|coordination\/authorization|door\/(?:door|store|nonce)|app\/(?:nemesis|chaos-state|runner|entry))\.ts$/;
const outside = /^(?:raw|wire|saved|row|params|input|body|bytes|stored|persisted)(?:[A-Z_].*)?$/;
const sync = /(?:^|\.)(?:decodeSync|decodeUnknownSync)$/;

export const outsideInputConstructor: CreateRule = {
	create(context) {
		if (!scoped.test(pathIn(context))) return {};
		const aliases = new Map<string, Node>();
		const names = new Map<string, string>();
		const resolve = (node: Node, seen = new Set<string>()): Node => {
			if (node.type !== "Identifier" || seen.has(node.name)) return node;
			const value = aliases.get(node.name);
			if (value === undefined) return node;
			seen.add(node.name);
			return resolve(value, seen);
		};
		const constant = (node: Node, seen = new Set<string>()): boolean => {
			const value = resolve(node, seen);
			switch (value.type) {
				case "Literal":
					return true;
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
		const untrusted = (node: Node, seen = new Set<string>()): boolean => {
			if (node.type === "Identifier") {
				if (seen.has(node.name)) return false;
				const value = aliases.get(node.name);
				if (value === undefined) return outside.test(node.name);
				seen.add(node.name);
				return untrusted(value, seen);
			}
			if (
				node.type === "CallExpression" &&
				/(?:decode.*(?:Effect|Result)|makeEffect)$/.test(dotted(node.callee) ?? "")
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
				names.set(
					node.local.name,
					node.imported.type === "Identifier" ? node.imported.name : String(node.imported.value),
				);
			},
			VariableDeclarator(node) {
				if (node.id.type === "Identifier" && node.init !== null)
					aliases.set(node.id.name, node.init);
			},
			AssignmentExpression(node) {
				if (node.left.type === "Identifier") aliases.set(node.left.name, node.right);
			},
			CallExpression(node) {
				const callee = resolve(node.callee);
				const call = dotted(callee) ?? "";
				const idMake =
					callee.type === "MemberExpression" &&
					dotted(callee.property) === "make" &&
					callee.object.type === "Identifier" &&
					(names.get(callee.object.name) ?? callee.object.name) === "Id";
				const args = node.arguments;
				const first = args[0];
				const curried = callee.type === "CallExpression" && sync.test(dotted(callee.callee) ?? "");
				const throwing = call.endsWith(".make") || sync.test(call) || curried;
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
