import type {Context, ESTree} from "@oxlint/plugins";
import * as fc from "fast-check";
import {expect, it, vi} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";
import {noWhyKey} from "./no-why-key.ts";

const CODE = "fabrika(no-why-key)";
const PATH = "next/packages/libfabrika/src/keys.ts";
const runs = {seed: 119120, numRuns: 12};

// Source text has no domain Schema. Quoted keys can contain any Unicode code point.
const unicodeKey = fc
	.array(fc.integer({min: 0, max: 0x10ffff}), {maxLength: 24})
	.map((points) => String.fromCodePoint(...points));
const identifier = fc
	.array(fc.constantFrom("a", "Z", "_", "$", "0", "é", "λ", "中"), {maxLength: 12})
	.map((letters) => `key${letters.join("")}`);
const escaped = (key: string) =>
	`"${Array.from({length: key.length}, (_, i) => `\\u${key.charCodeAt(i).toString(16).padStart(4, "0")}`).join("")}"`;

const declarations = (key: string, i: number) => [
	`const a${i} = {${key}: 1};`,
	`const b${i} = {${key}() {}};`,
	`const c${i} = {get ${key}() {return 1;}};`,
	`const d${i} = {set ${key}(value: number) {}};`,
	`class E${i} {${key} = 1;}`,
	`class F${i} {readonly ${key} = 1;}`,
	`class G${i} {static ${key}() {}}`,
	`class H${i} {get ${key}() {return 1;}}`,
	`class I${i} {set ${key}(value: number) {}}`,
	`abstract class R${i} {abstract ${key}: number;}`,
	`abstract class S${i} {abstract ${key}(): void;}`,
	`type J${i} = {readonly ${key}?: number};`,
	`type K${i} = {${key}(): void};`,
	`interface L${i} {readonly ${key}: number}`,
	`interface M${i} {${key}(): void}`,
	`const n${i} = Schema.Struct({${key}: Schema.String});`,
	`const o${i} = Schema.TaggedStruct("o", {${key}: Schema.String});`,
	`const p${i} = Schema.TaggedUnion({saved: {${key}: Schema.String}});`,
	`class Q${i} extends Schema.TaggedError<Q${i}>()("q", {${key}: Schema.String}) {}`,
];

it("rejects exactly why across generated Unicode keys and every declaration form", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.oneof(fc.constant("why"), unicodeKey),
			identifier,
			async (key, neighbor) => {
				// Every run includes why, so the positive branch never depends on random text hitting it.
				const keys = ["why", key, neighbor, "whyNot", "Why", "reason"];
				const lines: string[] = [];
				const expected: number[] = [];
				for (const [i, name] of keys.entries()) {
					const spellings = [JSON.stringify(name), escaped(name), `[${JSON.stringify(name)}]`];
					if (/^[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*$/u.test(name))
						spellings.push(name);
					for (const [j, spelling] of spellings.entries()) {
						for (const source of declarations(spelling, i * 4 + j)) {
							lines.push(source);
							if (name === "why") expected.push(lines.length);
						}
					}
				}
				lines.push("const why = 1; const shorthand = {why};", `const neighbor = {${neighbor}};`);
				expected.push(lines.length - 1);
				const result = await plant({[PATH]: lines.join("\n")});
				expect(result(CODE, PATH)).toEqual(expected);
			},
		),
		runs,
	);
});

it("real config keeps generated next paths and tests covered and today's paths off", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.tuple(
				identifier,
				fc.constantFrom("ts", "tsx"),
				fc.constantFrom("why", '"why"', '["why"]', "[`why`]"),
			),
			async ([name, extension, key]) => {
				const paths = [
					`next/${name}.${extension}`,
					`next/${name}.test.${extension}`,
					`next/apps/fabrika/src/exam/${name}.${extension}`,
					`packages/fabrika/src/${name}.${extension}`,
					`apps/fabrika/src/${name}.test.${extension}`,
					`programs/tracker/src/${name}.${extension}`,
				];
				const result = await plant(
					Object.fromEntries(paths.map((path) => [path, `const a = {${key}: 1};`])),
				);
				for (const [i, path] of paths.entries())
					expect(result(CODE, path)).toEqual(i < 3 ? [1] : []);
			},
		),
		runs,
	);
});

it("generated values, dynamic keys, local names, reads and neighboring names pass", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.record({value: unicodeKey, dynamic: identifier, neighbor: identifier}),
			async ({value, dynamic, neighbor}) => {
				const source = [
					`const why = ${JSON.stringify(value)};`,
					`const ${dynamic} = why;`,
					`const a = {[${dynamic}]: why, [why]: why, ["wh" + "y"]: why};`,
					`const b = {[\`wh\${why}\`]: why};`,
					`const c = {reason: why, Why: why, whyNot: why, ${neighbor}: "why"};`,
					'const d = a.why; const e = a["why"]; const f = "why" in a;',
					"const {why: borrowed} = a; const {why: renamed = why} = a;",
					"function read({why}: {reason: string}) {return why;}",
					'const g: A["why"] = borrowed; a.why = why;',
					"// why is an ordinary English word here",
				].join("\n");
				const result = await plant({[PATH]: source});
				expect(result(CODE, PATH)).toEqual([]);
			},
		),
		runs,
	);
});

// format: these exact TypeScript spellings pin decoded names and computed identifiers.
it("format: quoted, escaped, shorthand and computed spellings", async () => {
	const result = await plant({
		[PATH]: [
			"const why = 1; const a = {why};",
			'const b = {"why": 1};',
			'const c = {"\\u0077hy": 1};',
			'const d = {["why"]: 1};',
			"const e = {[`why`]: 1};",
			"const f = {[why]: 1};",
			'interface G {readonly "\\u0077hy": string}',
			'type H = {["why"](): void};',
			"class I {readonly [`why`] = 1;}",
		].join("\n"),
	});
	expect(result(CODE, PATH)).toEqual([1, 2, 3, 4, 5, 7, 8, 9]);
});

// format: the user-facing diagnostic names reason, next/ and why; no partial rename fix.
it("format: diagnostic names the replacement and offers no autofix", () => {
	const report = vi.fn();
	// This diagnostic check supplies only the Context method this rule calls.
	const context: Pick<Context, "report"> = {report};
	const visitor = noWhyKey.create(context as Context);
	const key = {type: "Identifier", name: "why"};
	visitor.Property?.({
		key,
		computed: false,
		parent: {type: "ObjectExpression"},
	} as ESTree.ObjectProperty);
	expect(report.mock.calls).toEqual([
		[{node: key, message: "Use reason for this key in next/; why was renamed in the glossary."}],
	]);
});
