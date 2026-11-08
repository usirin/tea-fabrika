// P8, next/, p61. Port: programs/markdown/src/highlight.test.ts, commit 2c29c13.
// P22 binds this exam to real highlighting. Its load adapter holds an outside load until release,
// and observes the machine's JSON state. No Promise identity or function-valued model is allowed.
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";

type Token = {
	readonly text: string;
	readonly color: string | null;
	readonly italic: boolean;
	readonly bold: boolean;
};
type Lines = readonly (readonly Token[])[];
type Highlighter = {
	readonly colors: (text: string, lang: string) => Lines | null;
	readonly wants: (lang: string | null) => boolean;
};
const text = 'const plan = {key: "job-7f3a"};\n// a comment\nyield* start("170", plan);';
const plain = (s: string): Token => ({text: s, color: null, italic: false, bold: false});
const checkTokens = (h: Highlighter) => {
	for (const lang of ["ts", "typescript", "TS"]) {
		const lines = h.colors(text, lang);
		expect(lines).not.toBeNull();
		expect(lines).toHaveLength(3);
		expect(
			lines?.map((l) => l.map((t) => t.text).join("")).join("\n"),
			"every character including newlines",
		).toBe(text);
		const colored = lines?.flat().filter((t) => t.color !== null) ?? [];
		expect(colored.length).toBeGreaterThan(3);
		for (const token of colored) expect(token.color).toMatch(/^#[0-9a-f]{6,8}$/i);
		expect(lines?.[1]).toEqual([
			{text: "// a comment", color: "#9198a1", italic: false, bold: false},
		]);
	}
	for (const lang of ["nope", "text", "constructor", "__proto__"])
		expect(h.colors(text, lang), "unknown languages remain plain").toBeNull();
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
	const html = '<script>alert(1)</script><img src=x onerror="alert(2)">';
	expect(
		h
			.colors(html, "html")
			?.flat()
			.map((t) => t.text)
			.join(""),
		"HTML tokens are text",
	).toBe(html);
	const long = `${"x".repeat(1000)}\nnext\n`;
	const lines = h.colors(long, "ts");
	expect(lines?.[0], "1000-character line is one plain span").toEqual([plain("x".repeat(1000))]);
	expect(lines?.map((l) => l.map((t) => t.text).join("")).join("\n")).toBe(long);
	expect(h.colors("x".repeat(1001), "ts")?.[0]).toEqual([plain("x".repeat(1001))]);
};
// Synthetic lexer output exposes font-style handling without depending on theme token choices.
const checkFlags = (convert: (style: number) => Token) => {
	for (const [style, italic, bold] of [
		[0, false, false],
		[1, true, false],
		[2, false, true],
		[3, true, true],
	] as const)
		expect(convert(style), "italic and bold are separate bits").toEqual({
			text: "token",
			color: "#123456",
			italic,
			bold,
		});
};
type Load = {
	readonly ask: Effect.Effect<void>;
	readonly finish: (ok: boolean) => Effect.Effect<void>;
	readonly reads: () => {
		readonly loads: number;
		readonly text: string;
		readonly model: unknown;
		readonly colored: boolean;
	};
};
const checkLoad = (load: Load, ok: boolean) =>
	Effect.gen(function* () {
		expect(load.reads().text).toBe(text);
		expect(load.reads().colored).toBe(false);
		yield* load.ask;
		yield* load.ask;
		expect(load.reads().loads, "one load in flight").toBe(1);
		expect(load.reads().text, "plain before completion").toBe(text);
		expect(load.reads().colored).toBe(false);
		yield* load.finish(ok);
		const got = load.reads();
		expect(got.text, "loading never loses the body").toBe(text);
		expect(got.colored).toBe(ok);
		// Encoding JSON alone would silently drop a function. Decode first, recursively.
		expect(Schema.is(Schema.Json)(got.model), "model has data only").toBe(true);
		yield* load.ask;
		expect(load.reads().loads, "no reload after success or failure").toBe(1);
	});
const control: Highlighter = {
	wants: (lang) =>
		lang !== null &&
		lang !== "" &&
		!["plain", "plaintext", "text", "txt"].includes(lang.toLowerCase()),
	colors: (body, lang) => {
		if (!["ts", "typescript", "TS", "html"].includes(lang)) return null;
		return body
			.split("\n")
			.map((line) =>
				line.length >= 1000
					? [plain(line)]
					: line === "// a comment"
						? [{...plain(line), color: "#9198a1"}]
						: line.split(/( )/).map((s) => ({...plain(s), color: s === " " ? null : "#123456"})),
			);
	},
};
const loader = (plant: "clean" | "parallel" | "lost" | "function" = "clean"): Load => {
	let loads = 0,
		asked = false,
		colored = false,
		body = text;
	return {
		ask: Effect.sync(() => {
			if (!asked || plant === "parallel") {
				loads++;
				asked = true;
			}
		}),
		finish: (ok) =>
			Effect.sync(() => {
				colored = ok;
				if (!ok && plant === "lost") body = "";
			}),
		reads: () => ({
			loads,
			text: body,
			colored,
			model: plant === "function" ? {body, colors: () => null} : {body, colored},
		}),
	};
};
describe("p61 fixed highlighting exam, controls and plants only", () => {
	it("clean token control", () => checkTokens(control));
	it("font flags are independent bits", () =>
		checkFlags((style) => ({
			text: "token",
			color: "#123456",
			italic: (style & 1) !== 0,
			bold: (style & 2) !== 0,
		})));
	for (const ok of [true, false])
		it(`one pending load, plain until settled, ${ok ? "success" : "failure"}`, () =>
			Effect.runPromise(checkLoad(loader(), ok)));
	it("plant: throw for an unknown language", () =>
		expect(() =>
			checkTokens({
				...control,
				colors: (body, lang) => {
					if (lang === "nope") throw new Error("unknown language");
					return control.colors(body, lang);
				},
			}),
		).toThrow("unknown language"));
	it("plant: drop a token", () =>
		expect(() =>
			checkTokens({
				...control,
				colors: (body, lang) => control.colors(body, lang)?.map((l) => l.slice(1)) ?? null,
			}),
		).toThrow(/every character/));
	it("plant: split a 1000-character line into multiple spans", () =>
		expect(() =>
			checkTokens({
				...control,
				colors: (body, lang) =>
					body.startsWith("x".repeat(1000))
						? [
								[plain(body.slice(0, 500)), plain(body.slice(500, 1000))],
								[plain("next")],
								[plain("")],
							]
						: control.colors(body, lang),
			}),
		).toThrow(/1000-character line/));
	it("plant: lose the bold bit", () =>
		expect(() =>
			checkFlags((style) => ({
				text: "token",
				color: "#123456",
				italic: (style & 1) !== 0,
				bold: false,
			})),
		).toThrow(/italic|bold/));
	for (const [plant, ok, why] of [
		["parallel", true, /one load in flight/],
		["lost", false, /loading never loses/],
		["function", true, /model has data only/],
	] as const)
		it(`plant: ${plant}`, async () => {
			await expect(Effect.runPromise(checkLoad(loader(plant), ok))).rejects.toThrow(why);
		});
});
it("P22 real highlighter binding", (ctx) => {
	const dir = resolve(import.meta.dirname, "../../../../programs/notes/src");
	if (
		!["highlight.ts", "highlight.tsx", "root.ts", "drawn.tsx", "view.tsx", "window.tsx"].some((s) =>
			existsSync(resolve(dir, s)),
		)
	)
		return ctx.skip("not built: P22 highlighter; load controls do not exercise WebAssembly");
	throw new Error(
		"P22 highlighter exists: require real token, font-flag and held-load adapters with declared dependencies",
	);
});
