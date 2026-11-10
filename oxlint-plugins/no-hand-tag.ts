// No hand-written `_tag` in `next/`: Effect Schema writes it (docs/direction/schema-classes-not-of-helpers.md,
// and Tier 1's "Tags"). Tier 1's exam, item 5 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It fires on an object key, a class field or a type member named `_tag`, so `{_tag: "x"}`,
// `type X = {readonly _tag: "x"}` and `Schema.Struct({_tag: Schema.Literal("x")})` fire. A read
// passes: `x._tag === "a"`, `const {_tag} = x`, `switch (x._tag)`. Making a value with a maker
// (`Fault.cases.abort.make(...)`) or a schema tool (`Schema.TaggedUnion`, `TaggedStruct`,
// `TaggedError`) passes, since they write the key themselves.
//
// It misses a write through a member, `x._tag = "a"`, which the plan does not name. Report it if one
// turns up.
//
// One edge, by its whole path from the top of the repo: the log, which stores any fact and knows no
// cases, so its `Line` holds `_tag` as an open string. A second edge goes back to the owner.
// `.oxlintrc.json` turns it on in `next/**` and leaves tests out: a test feeds raw frames.
import type {CreateRule} from "@oxlint/plugins";
import {type Node, pathIn} from "./match.ts";

const EDGE = "next/packages/libfabrika/src/data/log.ts";

const isTag = (key: Node): boolean =>
	(key.type === "Identifier" && key.name === "_tag") ||
	(key.type === "Literal" && key.value === "_tag");

export const noHandTag: CreateRule = {
	create(context) {
		if (pathIn(context) === EDGE) {
			return {};
		}

		const check = (node: Node, key: Node, computed: boolean) => {
			if (computed || !isTag(key)) {
				return;
			}

			context.report({
				node,
				message:
					"A hand-written `_tag`: Effect Schema writes it. Use `Schema.TaggedUnion`, `Schema.TaggedStruct` or `Schema.TaggedError`, and make a value with its maker (`X.cases.a.make(...)`).",
			});
		};
		return {
			Property(node) {
				const {parent} = node as Node & {readonly parent: Node};

				if (parent.type === "ObjectExpression") {
					check(node, node.key, node.computed);
				}
			},
			PropertyDefinition(node) {
				check(node, node.key, node.computed);
			},
			TSPropertySignature(node) {
				check(node, node.key, node.computed);
			},
		};
	},
};
