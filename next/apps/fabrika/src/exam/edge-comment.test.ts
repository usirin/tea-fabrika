// `edge-comment` (Tier 1, P35; small-exam item 6): an ignore comment that names `fabrika/no-promises`
// or `fabrika/no-effect-run-outside-edge` is `// oxlint-disable-next-line <rule> -- edge: <why>`,
// names only those two rules, and gives a reason. Each wrong comment stands over a line that really
// fires, so only this rule speaks. And no line of `.oxlintrc.json` turns an edge rule off for a
// `next/` file that is not a test, so the list of edge files cannot come back through the config.
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {Schema} from "effect";
import {parseSync} from "oxc-parser";
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";

const CODE = "fabrika(edge-comment)";
const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const PRELUDE = [
	'import {Effect} from "effect";',
	"declare const p: Promise<number>, thing: Effect.Effect<number>;",
];

const PROMISE = "export const a = Effect.tryPromise(() => p);";
const RUN = "export const a = Effect.runPromise(thing);";
const BOTH = "export const a = Effect.runPromise(Effect.tryPromise(() => p));";

/** Each planted file: its comment and the line under it, and whether this rule must refuse it. */
const CASES: Readonly<Record<string, readonly [string, string, boolean]>> = {
	"promises-no-edge": ["// oxlint-disable-next-line fabrika/no-promises -- why", PROMISE, true],
	"runs-no-edge": [
		"// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- why",
		RUN,
		true,
	],
	"edge-empty": ["// oxlint-disable-next-line fabrika/no-promises -- edge:", PROMISE, true],
	"edge-space": ["// oxlint-disable-next-line fabrika/no-promises -- edge: ", PROMISE, true],
	"edge-capital": ["// oxlint-disable-next-line fabrika/no-promises -- Edge: x", PROMISE, true],
	"whole-file": ["/* oxlint-disable fabrika/no-promises -- edge: x */", PROMISE, true],
	"this-line": ["", `${PROMISE} // oxlint-disable-line fabrika/no-promises -- edge: x`, true],
	"another-rule": [
		"// oxlint-disable-next-line fabrika/no-promises, fabrika/no-secret-env -- edge: x",
		'export const a = Effect.tryPromise(() => fetch(process.env.GITHUB_TOKEN ?? ""));',
		true,
	],
	"promises-edge": [
		"// oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object answers a Promise",
		PROMISE,
		false,
	],
	"runs-edge": [
		"// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the platform calls it",
		RUN,
		false,
	],
	"both-edge": [
		"// oxlint-disable-next-line fabrika/no-promises, fabrika/no-effect-run-outside-edge -- edge: x",
		BOTH,
		false,
	],
	"not-an-edge": [
		"// oxlint-disable-next-line fabrika/no-type-assertions -- the types need it here",
		"export const a = p as any;",
		false,
	],
};

const at = (name: string) => `next/packages/libfabrika/src/data/${name}.ts`;
const UNUSED = at("unused");

describe("edge-comment", async () => {
	const all = await plant({
		...Object.fromEntries(
			Object.entries(CASES).map(([name, [comment, line]]) => [
				at(name),
				[...PRELUDE, comment, line].join("\n"),
			]),
		),
		[UNUSED]: [
			...PRELUDE,
			"// oxlint-disable-next-line fabrika/no-promises -- edge: nothing fires below",
			"export const a = 1;",
		].join("\n"),
	});

	it("refuses each wrong edge comment, at the top of the file", () => {
		const refused = Object.entries(CASES).filter(([, [, , no]]) => no);
		expect(refused).toHaveLength(8);

		for (const [name] of refused) {
			expect([name, all(CODE, at(name))]).toEqual([name, [1]]);
		}
	});

	it("passes a right one for each rule and for both, and leaves other comments alone", () => {
		const passed = Object.entries(CASES).filter(([, [, , no]]) => !no);
		expect(passed).toHaveLength(4);

		for (const [name] of passed) {
			expect([name, all(CODE, at(name))]).toEqual([name, []]);
		}
	});

	it("speaks alone: the line under each comment is silenced and no comment is unused", () => {
		for (const name of Object.keys(CASES)) {
			for (const code of [
				"fabrika(no-promises)",
				"fabrika(no-effect-run-outside-edge)",
				"fabrika(no-secret-env)",
				"fabrika(no-type-assertions)",
				"fabrika(no-bare-disable)",
				"",
			]) {
				expect([name, code, all(code, at(name))]).toEqual([name, code, []]);
			}
		}
	});

	it("an edge comment over a line where nothing fires is unused, which fails", () => {
		expect(all("", UNUSED)).toEqual([3]);
		expect(all(CODE, UNUSED)).toEqual([]);
	});
});

// `.oxlintrc.json` is JSON with comments, which a JavaScript parser reads as one object.
const Config = Schema.Struct({
	ignorePatterns: Schema.Array(Schema.String),
	overrides: Schema.Array(
		Schema.Struct({
			files: Schema.Array(Schema.String),
			rules: Schema.Record(Schema.String, Schema.Unknown),
		}),
	),
});

// oxc-parser's tree, read loosely: only literals, arrays and objects are walked.
type Tree = any;

const toValue = (node: Tree): unknown => {
	if (node.type === "ObjectExpression") {
		return Object.fromEntries(
			node.properties.map((p: Tree) => [p.key.value ?? p.key.name, toValue(p.value)]),
		);
	}

	if (node.type === "ArrayExpression") {
		return node.elements.map(toValue);
	}

	if (node.type === "Literal") {
		return node.value;
	}

	throw new Error(`.oxlintrc.json holds a ${node.type}`);
};

describe(".oxlintrc.json", () => {
	const text = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
	const tree: Tree = parseSync("oxlintrc.ts", `export default ${text}`).program;
	const config = Schema.decodeUnknownSync(Config)(toValue(tree.body[0].declaration));
	const RULES = [
		"fabrika/no-promises",
		"fabrika/no-effect-run-outside-edge",
		"fabrika/edge-comment",
	];
	const TESTS = ["next/**/*.test.ts", "next/**/*.test.tsx"];
	const off = (setting: unknown): boolean =>
		setting === "off" || setting === 0 || (Array.isArray(setting) && off(setting[0]));

	it("turns the three rules on in next/**", () => {
		const next = config.overrides.find((o) => o.files.length === 1 && o.files[0] === "next/**");

		for (const rule of RULES) {
			expect([rule, next?.rules[rule]]).toEqual([rule, "error"]);
		}
	});

	it("turns an edge rule off only for next/'s tests, and ignores no next/ path", () => {
		const loosened = config.overrides.filter((o) => RULES.some((rule) => off(o.rules[rule])));

		for (const o of loosened) {
			expect(o.files.filter((f) => !TESTS.includes(f))).toEqual([]);
		}

		expect(config.ignorePatterns.filter((p) => p.startsWith("next"))).toEqual([]);
	});
});
