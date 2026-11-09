// P24, next/. Inspect executable structure and embedded programs, then run the exact file in e2e.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
import {parseSync} from "oxc-parser";
import {rolldown} from "rolldown";
import {buildFixture, runs, type Built} from "./p24.test-support.ts";

type Tree = any;
// Resolve computed constant member names too, so spelling/minification cannot hide ctx.abort().
const text = (node: Tree): string | undefined => {
	if (node?.type === "Literal" && typeof node.value === "string") return node.value;
	if (node?.type === "Identifier") return node.name;
	if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
		return node.quasis.map((q: Tree) => q.value.cooked).join("");
	if (node?.type === "BinaryExpression" && node.operator === "+") {
		const left = text(node.left),
			right = text(node.right);
		return left === undefined || right === undefined ? undefined : left + right;
	}
	return undefined;
};
const forbidden = new Set(["abort", "fire", "injectFault", "arm", "nemesisLive", "chaos"]);
const inspect = (source: string) => {
	const seen = new Set<string>();
	const scan = (source: string) => {
		if (seen.has(source)) return;
		seen.add(source);
		const tree = parseSync("brain.mjs", source);
		expect(tree.errors).toEqual([]);
		const walk = (node: Tree): void => {
			expect.hasAssertions();
			if (node === null || typeof node !== "object") return;
			if (Array.isArray(node)) {
				for (const item of node) walk(item);
				return;
			}
			if (["MethodDefinition", "Property"].includes(node.type))
				expect(
					forbidden.has(text(node.key) ?? "") &&
						(text(node.key) !== "abort" || node.type === "MethodDefinition"),
					`forbidden executable key ${text(node.key)}`,
				).toBe(false);
			if (node.type === "MemberExpression")
				expect(
					forbidden.has(text(node.property) ?? "") &&
						(text(node.property) !== "abort" || text(node.object?.property) === "ctx"),
					`forbidden call ${text(node.property)}`,
				).toBe(false);
			const string = ["Literal", "TemplateLiteral"].includes(node.type) ? text(node) : undefined;
			if (string !== undefined) {
				expect(string).not.toMatch(/(?:\/chaos(?:\/|$)|nemesis[._-]live|injectFault)/);
				// P16 embeds each compiled program and asset as a string literal.
				if (/\bexport\s|\bimport\s|\bclass\s/.test(string)) scan(string);
			}
			for (const [key, value] of Object.entries(node))
				if (!["parent", "comments"].includes(key)) walk(value);
		};
		walk(tree.program);
	};
	scan(source);
};
const inspectBuilt = (built: Built) => {
	const bytes = readFileSync(built.brain);
	expect(createHash("sha256").update(bytes).digest("hex")).toBe(built.sha256);
	expect(bytes.byteLength).toBe(built.bytes);
	expect(built.programs.some((p) => p.name === "counter")).toBe(true);
	expect(built.programs.some((p) => p.name === "chaos")).toBe(false);
	expect(built.assets.some((p) => /chaos/i.test(p.route))).toBe(false);
	inspect(bytes.toString("utf8"));
};

describe("P24 off file", () => {
	it.effect("scenario: p38 final bytes contain no executable faults or embedded chaos", () =>
		Effect.gen(function* () {
			const fixture = yield* buildFixture();
			const {build} = yield* Effect.promise(() => import("./node.ts"));
			const built: Built = yield* build(fixture.spec);
			inspectBuilt(built);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
	it.effect.prop(
		"p33 equal chaos gives equal local/cloud bytes despite paths, order, address and clock",
		{
			reverse: Schema.Boolean,
			clock: Schema.Int,
			host: Schema.NonEmptyString,
		},
		({reverse, clock, host}) =>
			Effect.gen(function* () {
				const fixture = yield* buildFixture();
				const {build} = yield* Effect.promise(() => import("./node.ts"));
				const first: Built = yield* build({...fixture.spec, out: `${fixture.spec.root}/local`});
				const second: Built = yield* build({
					...fixture.spec,
					out: `${fixture.spec.root}/cloud`,
					programs: reverse ? [...fixture.entries].reverse() : fixture.entries,
					// These are deliberately excess data; they must never enter executable bytes.
					stage: "cloud",
					url: `https://${encodeURIComponent(host)}.invalid`,
					at: clock,
				});
				expect(yield* fixture.read(second)).toEqual(yield* fixture.read(first));
				expect(second.sha256).toBe(first.sha256);
			}).pipe(Effect.provide(NodeServices.layer)),
		runs,
	);
	it.effect(
		"scenario: p38 plants survive bundling and minification and fail the same detector",
		() =>
			Effect.gen(function* () {
				for (const source of [
					"export class Project { abort() { return 1; } }",
					'export class Project { a() { return this.ctx["ab" + "ort"](); } }',
					'export default {fetch(r) { if(new URL(r.url).pathname === "/chaos/arm") return arm(); }}',
					`export const embedded = ${JSON.stringify("export class X { fire() { return 1; } }")};`,
					'export const programs = {chaos: {source: "export const fault = 1"}};',
				]) {
					const bundle = yield* Effect.promise(() =>
						rolldown({
							input: "plant",
							plugins: [{name: "p24-plant", resolveId: () => "\0plant", load: () => source}],
						}),
					);
					const output = yield* Effect.promise(() =>
						bundle.generate({format: "esm", minify: true}),
					);
					yield* Effect.promise(() => bundle.close());
					const code = output.output
						.filter((part) => part.type === "chunk")
						.map((part) => part.code)
						.join("\n");
					expect(() => inspect(code)).toThrow();
				}
			}),
	);
	it.prop(
		"plants: a path/stage/clock in output changes the byte comparison",
		{at: Schema.Int, stage: Schema.Literals(["cloud", "local"])},
		({at, stage}) => {
			const baseline = Buffer.from("export const count = 1;");
			const planted = Buffer.from(
				`${baseline}\nexport const env = ${JSON.stringify({at, stage})};`,
			);
			expect(() => expect(planted).toEqual(baseline)).toThrow();
		},
		runs,
	);
});
