// P8, next/. Port source: programs/markdown/src/highlight.test.ts at 2c29c13f433c.
// Mapping: loadColors -> one in-flight load, no Promise identity; colorsNow -> before/failure plain;
// language aliases, span flags/colors, comments and exact characters -> the code contracts below.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {expect, it} from "@effect/vitest";
import {Arbitrary, Effect, FileSystem, Schema} from "effect";

const options = {arbitrary: {seed: 119120, runs: 300, size: 4096, concurrency: 1}};
const text = Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(4096));
const CodeCases = Arbitrary.all({
	lines: Arbitrary.array(Arbitrary.schema(text), {minLength: 0, maxLength: 8}),
	suffix: Arbitrary.schema(Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(96))),
});
const Span = Schema.Struct({
	text: Schema.String,
	color: Schema.NullOr(Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6,8}$/i))),
	italic: Schema.Boolean,
	bold: Schema.Boolean,
});
const Lines = Schema.Array(Schema.Array(Span));
type Lines = typeof Lines.Type;
const exact = (lines: Lines | null, text: string) => {
	expect(Schema.is(Schema.NullOr(Lines))(lines)).toBe(true);
	if (lines !== null) {
		Schema.decodeUnknownSync(Lines)(lines);
		expect(lines.map((line) => line.map((s) => s.text).join("")).join("\n")).toBe(text);
	}
};
type Highlighter = {
	readonly color: (text: string, lang: string | null) => Lines | null;
	readonly wants: (lang: string | null) => boolean;
	readonly loading: () => Effect.Effect<{
		readonly loads: number;
		readonly before: Lines | null;
		readonly after: Lines | null;
	}>;
	readonly failedLoad: () => Effect.Effect<{readonly loads: number; readonly output: Lines | null}>;
};
const loadedOnce = (a: {
	readonly loads: number;
	readonly before: Lines | null;
	readonly after: Lines | null;
}) => {
	expect(a.loads).toBe(1);
	expect(a.before).toBeNull();
	expect(a.after).not.toBeNull();
};
const failedPlain = (a: {readonly loads: number; readonly output: Lines | null}) => {
	expect(a.loads).toBe(1);
	expect(a.output).toBeNull();
};
const unknownPlain = (call: () => Lines | null) => expect(call()).toBeNull();
const binding = (): Highlighter => {
	throw new Error(
		"P22 started: bind real highlighter and its load/failure driver; import failure must fail",
	);
};
const present = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (const file of ["highlight.ts", "highlight.tsx", "window.tsx", "draw.tsx"])
		if (
			yield* fs.exists(new URL(`../../../../programs/notes/src/${file}`, import.meta.url).pathname)
		)
			return true;
	return false;
}).pipe(Effect.provide(NodeFileSystem.layer));
const target = Effect.fnUntraced(function* (ctx: {skip: (reason?: string) => never}) {
	if (!(yield* present)) ctx.skip("not built: P22 highlighter");
	return binding();
});

it.effect.prop(
	"not built: P22 / colored tokens retain text, line breaks, colors and flags",
	{c: CodeCases},
	({c}, ctx) =>
		Effect.gen(function* () {
			const h = yield* target(ctx),
				code = c.lines.join("\n");
			for (const lang of ["ts", "typescript", "TS", "html", "javascript", "js"])
				exact(h.color(code, lang), code);
			const typed = `const n = 1;\n// ${c.suffix}`;
			const aliases = ["ts", "typescript", "TS"].map((lang) => h.color(typed, lang));
			expect(aliases[0]).not.toBeNull();
			expect(aliases[1]).toEqual(aliases[0]);
			expect(aliases[2]).toEqual(aliases[0]);
			for (const output of aliases) {
				exact(output, typed);
				expect(output?.flat().some((s) => s.color !== null)).toBe(true);
			}
		}),
	options,
);
it.effect.prop(
	"not built: P22 / plain and unknown languages never throw or lose text",
	{c: CodeCases},
	({c}, ctx) =>
		Effect.gen(function* () {
			const h = yield* target(ctx),
				code = c.lines.join("\n");
			for (const lang of [
				null,
				"",
				"text",
				"TXT",
				"plain",
				"plaintext",
				"constructor",
				"__proto__",
				`unknown-${c.suffix}`,
			])
				expect(h.color(code, lang)).toBeNull();
			expect([null, "", "text", "TXT", "plain", "plaintext", "ts", "nope"].map(h.wants)).toEqual([
				false,
				false,
				false,
				false,
				false,
				false,
				true,
				true,
			]);
		}),
	options,
);
it.effect.prop(
	"not built: P22 / one load in flight and plain text before load or after failure",
	{c: CodeCases},
	(_c, ctx) =>
		Effect.gen(function* () {
			const h = yield* target(ctx),
				loaded = yield* h.loading(),
				failed = yield* h.failedLoad();
			loadedOnce(loaded);
			failedPlain(failed);
		}),
	options,
);
it.effect.prop(
	"not built: P22 / 999 and 1000 character lines color; 1001 stays plain",
	{c: CodeCases},
	(_c, ctx) =>
		Effect.gen(function* () {
			const h = yield* target(ctx);
			expect(h.wants("ts")).toBe(true);
			for (const length of [999, 1000, 1001]) {
				const code = `//${"a".repeat(length - 2)}`;
				const result = h.color(code, "ts");
				if (length > 1000) expect(result).toBeNull();
				else {
					expect(result).not.toBeNull();
					exact(result, code);
				}
			}
		}),
	options,
);
it.effect("not built: P22 / format: source comment's color and flags", (ctx) =>
	Effect.gen(function* () {
		const h = yield* target(ctx);
		expect(h.color("// a comment", "ts")).toEqual([
			[{text: "// a comment", color: "#9198a1", italic: false, bold: false}],
		]);
	}),
);

it.prop(
	"checker clean control: spans preserve every code character",
	{c: CodeCases},
	({c}) => {
		const code = c.lines.join("\n");
		exact(
			code.split("\n").map((line) => [{text: line, color: null, italic: false, bold: false}]),
			code,
		);
		loadedOnce({loads: 1, before: null, after: []});
		failedPlain({loads: 1, output: null});
		unknownPlain(() => null);
	},
	options,
);
it.prop(
	"checker plants: HTML tokens, lost newline, bad flags and long-line coloring fail",
	{c: CodeCases},
	({c}) => {
		const code = `${c.lines.join("\n")}\n`;
		expect(() => loadedOnce({loads: 2, before: null, after: []})).toThrow();
		expect(() => failedPlain({loads: 1, output: []})).toThrow();
		expect(() =>
			unknownPlain(() => {
				throw new Error("unknown language");
			}),
		).toThrow();
		expect(() =>
			exact([[{text: `<b>${code}</b>`, color: null, italic: false, bold: false}]], code),
		).toThrow();
		expect(() =>
			exact([[{text: code.slice(0, -1), color: null, italic: false, bold: false}]], code),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(Lines)([[{text: code, color: "red", italic: "true", bold: false}]]),
		).toThrow();
		expect(() =>
			expect([[{text: "a".repeat(1001), color: "#ffffff", italic: false, bold: false}]]).toBeNull(),
		).toThrow();
	},
	options,
);

it.prop(
	"presence checker: absent is pending; partial, failed-import and missing exports fail",
	{c: CodeCases},
	({c}) => {
		const check = (files: ReadonlyArray<string>, load: () => unknown) => {
			if (files.length === 0) return "pending";
			if (!files.includes("highlight.ts")) throw new Error("partial highlighter");
			Schema.decodeUnknownSync(
				Schema.Struct({
					color: Schema.declare((x): x is Highlighter["color"] => typeof x === "function"),
				}),
			)(load());
			return "bound";
		};
		expect(check([], () => null)).toBe("pending");
		expect(() => check([`partial-${c.suffix}.ts`], () => null)).toThrow();
		expect(() =>
			check(["highlight.ts"], () => {
				throw new Error("import failed");
			}),
		).toThrow("import failed");
		expect(() => check(["highlight.ts"], () => ({}))).toThrow();
		expect(check(["highlight.ts"], () => ({color: () => null}))).toBe("bound");
	},
	options,
);
