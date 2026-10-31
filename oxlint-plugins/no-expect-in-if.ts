// Ban a test whose ONLY assertions are branch-gated: an `expect(...)` nested inside an
// `if` in a test body that has no unconditional assertion at all. IN TEST FILES ONLY.
//
// Rationale (single site; .patterns/unconditional-test-assertions.md): a test whose only
// `expect(...)` sits inside an `if` passes vacuously whenever the branch isn't entered: the
// assertion never runs, no failure is raised, and the suite goes green while proving nothing.
// This is the pipeline's structural test blind spot: coder-written tests are the bulk of new
// suites, and a conditionally-guarded assertion is the easiest way for one to look thorough
// while asserting nothing. The fix is to make an assertion unconditional (assert the branch
// was reached, then its consequence) or to pin the count with `expect.assertions(n)` /
// `expect.hasAssertions()`, so a skipped branch reds the test instead of silently passing.
//
// Precision: why the "no unconditional assertion in the test" qualifier is load-bearing.
// The naive "any expect inside any if" shape is structurally identical to a dominant, CORRECT
// discriminated-union idiom, `expect(u.ok).toBe(true); if (u.ok) { expect(u.value)...}`, where the
// `if` is a pure TS type-narrowing guard and the discriminant is asserted UNCONDITIONALLY on the
// line above, so the branch is guaranteed to run. That idiom is not a silent pass (the issue's own
// definition is "a branch that may never be taken"), so a naive rule is ~95% false positives here.
// We therefore only fire when the nearest function body holds NO unconditional assertion: if any
// `expect(...)` / `expect.assertions(n)` / `expect.hasAssertions()` runs unconditionally, the test
// proves *something* and the guarded assert is the safe-narrow idiom, not a vacuous pass. A "mixed"
// test (one unconditional assert + a rarely-taken guarded one) is deliberately UNDER-reported:
// fail-safe, the same bias the sibling gates take.
//
// Scope: TEST FILES ONLY, through the `overrides` block of `.oxlintrc.json` for `**/*.test.ts`.
// Production code is never touched.
//
// The rule sees no types, so it stays syntactic: `expect(...)` is any callee spelled `expect`, at
// any arity (including chained matchers: `expect(x).toBe(y)` holds the `expect(x)` call). An
// assertion counts as unconditional when no `if` is above it, all the way up the file, so an
// `it(...)` inside a top-level `if` holds no unconditional assertion. The nearest function body is
// the one with a block: a one-line arrow has none. A class's `static {}` block is not one either.
//
// A genuinely intentional branch-guarded assertion is exempted per-line with a
// `// oxlint-disable-next-line fabrika/no-expect-in-if -- <reason>`, never a blanket exemption.
import type {CreateRule, ESTree} from "@oxlint/plugins";
import {ancestors, grouped, type Node, plainCall} from "./match.ts";

const isFunction = (node: Node): boolean =>
	node.type === "ArrowFunctionExpression" ||
	node.type === "FunctionExpression" ||
	node.type === "FunctionDeclaration";

export const noExpectInIf: CreateRule = {
	create(context) {
		const provenBodies = new Set<Node>();
		const guarded: {readonly node: ESTree.CallExpression; readonly body: Node | null}[] = [];
		return {
			CallExpression(node) {
				const name = plainCall(node);
				const isExpect = name === "expect";
				const counts =
					isExpect ||
					name === "expect.assertions" ||
					(name === "expect.hasAssertions" && node.arguments.length === 0);
				if (!counts) return;
				const plainly = grouped(context.sourceCode, node.callee) === 0;
				const bodies: Node[] = [];
				let inIf = false;
				for (const up of ancestors(node)) {
					if (up.type === "IfStatement") inIf = true;
					if (up.type === "BlockStatement" && isFunction(up.parent)) bodies.push(up);
				}
				if (!inIf && plainly) {
					for (const body of bodies) provenBodies.add(body);
				} else if (inIf && isExpect) {
					guarded.push({node, body: bodies[0] ?? null});
				}
			},
			"Program:exit"() {
				for (const {node, body} of guarded) {
					if (body === null || provenBodies.has(body)) continue;
					context.report({
						node,
						message:
							"This test's ONLY assertion is nested inside an `if`: it runs only on a branch that may never be taken, so the test passes while asserting nothing (the silent-pass shape). Fix: make an assertion unconditional (assert the branch was reached, then its consequence), or pin the count with `expect.assertions(n)` / `expect.hasAssertions()`. Exception: // oxlint-disable-next-line fabrika/no-expect-in-if -- <reason>.",
					});
				}
			},
		};
	},
};
