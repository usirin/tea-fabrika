// An app entry only wires (Tier 1, P19, and docs/direction/where-each-piece-lives.md): it names
// paths, registrations and Layers and calls libfabrika. Any rule a from-scratch client would have
// to write again (a schema, a reducer, a refusal, a launchd plist, a lifecycle branch) belongs in
// libfabrika, so a client built on libfabrika alone gets it.
//
// It refuses, in a file it is turned on for:
//
// - a call on `Schema`, or a class that extends one, which declares or decodes a shape;
// - `Machine.make`, `Cmd.make` and `Context.Service`, a machine, a Cmd or a service of the app's own;
// - an `if`, a `switch` or a `?:`, a branch in what should be one straight composition;
// - a string or template that holds `<plist` or `<key>`, a launchd plist written by hand.
//
// `.oxlintrc.json` turns it on for `next/apps/fabrika/src/entry/**` and leaves tests out. It sees no
// types and no helpers: a branch moved into a local helper file outside `entry/` passes. Report any miss.
import type {CreateRule} from "@oxlint/plugins";
import {dotted, type Node} from "./match.ts";

const WHY = "an app entry only wires; move the rule into libfabrika (where-each-piece-lives.md)";
const MAKERS = new Set(["Machine.make", "Cmd.make", "Context.Service"]);
const PLIST = /<plist|<key>/;

export const wiringOnly: CreateRule = {
	create(context) {
		const refuse = (node: Node, what: string) =>
			context.report({node, message: `${what}: ${WHY}.`});
		return {
			CallExpression(node) {
				const name = dotted(node.callee);
				if (name === null) return;
				if (name.startsWith("Schema.")) refuse(node, `\`${name}\` declares or decodes a shape`);
				else if (MAKERS.has(name))
					refuse(node, `\`${name}\` makes the app's own machine, Cmd or service`);
			},
			ClassDeclaration(node) {
				const base = node.superClass === null ? null : dotted(node.superClass);
				if (base !== null && base.startsWith("Schema."))
					refuse(node, "a Schema class declares a shape");
			},
			IfStatement(node) {
				refuse(node, "an `if` is a decision");
			},
			SwitchStatement(node) {
				refuse(node, "a `switch` is a decision");
			},
			ConditionalExpression(node) {
				refuse(node, "a `?:` is a decision");
			},
			Literal(node) {
				if (typeof node.value === "string" && PLIST.test(node.value))
					refuse(node, "a plist written by hand");
			},
			TemplateLiteral(node) {
				if (node.quasis.some((q) => PLIST.test(q.value.raw)))
					refuse(node, "a plist written by hand");
			},
		};
	},
};
