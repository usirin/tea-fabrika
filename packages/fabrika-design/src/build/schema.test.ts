import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {parse} from "smol-toml";
import {describe, expect, it} from "vitest";
import {
	checkAcross,
	decodeManti,
	decodeParts,
	decodeToken,
	isOwn,
	isTranslucent,
	type TokenFile,
} from "./schema.ts";

// What a token file may say, decoded directly (design foundations, PR 2, properties 9, 11 to 13
// and 19). tokens.test.ts runs the same rules through the build, with the contrast checks on top.

const TOKENS = join(import.meta.dirname, "..", "..", "tokens");
const read = (path: string) => parse(readFileSync(join(TOKENS, path), "utf8"));
const FILES = readdirSync(join(TOKENS, "color"));

/** tokens.css's custom properties outside the generated regions, as the build passes them. */
const HAND = [
	...["--font", "--mono"],
	...["title", "head", "body", "prose", "small", "micro"].map((s) => `--fs-${s}`),
	...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `--s-${n}`),
	...["--r-sm", "--r", "--r-lg", "--r-xl", "--row-h", "--row-2h", "--ease-out", "--fast"],
];

const decodeAll = () => {
	const tokens = new Map<string, TokenFile>();
	const errors: string[] = [];
	for (const file of FILES) {
		const decoded = decodeToken(file, read(join("color", file)));
		if (decoded._tag === "ok") tokens.set(file.replace(/\.toml$/, ""), decoded.value);
		else errors.push(...decoded.errors);
	}
	return {tokens, errors};
};

const sources = () => {
	const {tokens} = decodeAll();
	const manti = decodeManti(read("manti.toml"));
	const parts = decodeParts(read("parts.toml"));
	if (manti._tag === "bad" || parts._tag === "bad") throw new Error("manti.toml or parts.toml");
	return {tokens, manti: manti.value, parts: parts.value, hand: HAND};
};

describe("the token files as they stand", () => {
	it("decodes every color file, manti.toml and parts.toml", () => {
		expect({
			files: decodeAll().errors,
			manti: decodeManti(read("manti.toml"))._tag,
			parts: decodeParts(read("parts.toml"))._tag,
		}).toEqual({files: [], manti: "ok", parts: "ok"});
	});

	it("passes every check across files", () => {
		expect(checkAcross(sources())).toEqual([]);
	});
});

describe("a bad file is refused, naming its file and field", () => {
	const textFaint = () => read("color/text-faint.toml");
	const errorsOf = (file: string, input: unknown) => {
		const decoded = decodeToken(file, input);
		return decoded._tag === "bad" ? decoded.errors : [];
	};

	it.each([
		["slate.13", "colors.dark"],
		["slaet.a11", "colors.dark"],
		["black.9", "colors.dark"],
	])("refuses the step %s", (step, field) => {
		const t = textFaint();
		const colors = t["colors"];
		const input = {...t, colors: {...(typeof colors === "object" ? colors : {}), dark: step}};
		expect(
			errorsOf("text-faint.toml", input).some((e) => e.startsWith(`text-faint.toml: ${field}:`)),
		).toBe(true);
	});

	it.each([
		["floor", {floor: 4}],
		["colour", {colour: "red"}],
		["type", {type: "fill"}],
		["tier", {tier: "semantic"}],
	])("refuses a bad %s", (field, change) => {
		expect(
			errorsOf("text-faint.toml", {...textFaint(), ...change}).some((e) =>
				e.startsWith(`text-faint.toml: ${field}:`),
			),
		).toBe(true);
	});

	it("refuses a file named in capitals, whatever the file system folds", () => {
		expect(errorsOf("Focus.toml", read("color/focus.toml"))).toEqual([
			"Focus.toml: name: a token's name is lowercase words and hyphens",
		]);
	});

	it("refuses a color as a plain value in manti.toml", () => {
		const decoded = decodeManti({
			...read("manti.toml"),
			"--manti-shadow": {value: "#000000", why: "x"},
		});
		expect(decoded._tag === "bad" && decoded.errors.some((e) => e.includes("--manti-shadow"))).toBe(
			true,
		);
	});
});

describe("the checks across files", () => {
	const without = (name: string, ...keys: readonly string[]) => {
		const s = sources();
		const token = s.tokens.get(name);
		if (token === undefined) throw new Error(`no ${name}`);
		const changed: Record<string, unknown> = {...token};
		for (const key of keys) delete changed[key];
		const decoded = decodeToken(`${name}.toml`, changed);
		if (decoded._tag === "bad") throw new Error(decoded.errors.join("\n"));
		s.tokens.set(name, decoded.value);
		return checkAcross(s);
	};
	const fields = (errors: readonly string[]) =>
		errors.map((e) => e.split(": ").slice(0, 2).join(": "));

	it("holds a text token to its floor and its backdrops", () => {
		expect(fields(without("text-faint", "floor"))).toEqual(["text-faint.toml: floor"]);
	});

	it("holds a border to 3:1 unless it carries nothing", () => {
		expect({
			focus: fields(without("focus", "floor")),
			strong: fields(without("border-strong", "carries")),
		}).toEqual({focus: ["focus.toml: floor"], strong: ["border-strong.toml: floor"]});
	});

	it("needs a backdrop for a translucent value, whatever its type", () => {
		expect(fields(without("surface-hover", "on"))).toEqual(["surface-hover.toml: on"]);
	});

	it("asks no floor of a background", () => {
		expect(without("turn-fill", "on", "floor")).toEqual([]);
	});

	it("refuses an extends cycle, an unknown owner and a name written twice", () => {
		const s = sources();
		const set = (name: string, input: unknown) => {
			const decoded = decodeToken(`${name}.toml`, input);
			if (decoded._tag === "bad") throw new Error(decoded.errors.join("\n"));
			s.tokens.set(name, decoded.value);
		};
		set("tile-text", {tier: "component", owner: "tile", colors: {extends: "tile-text-on"}});
		set("tile-text-on", {tier: "component", owner: "tlie", colors: {extends: "tile-text"}});
		const errors = checkAcross({...s, hand: [...s.hand, "--Surface"]});
		expect({
			cycle: errors.some((e) => e.startsWith("tile-text.toml: colors.extends: a cycle")),
			owner: errors.some((e) => e.startsWith("tile-text-on.toml: owner:")),
			twice: errors.some((e) => e.includes("tokens.css --Surface") && e.includes("surface.toml")),
		}).toEqual({cycle: true, owner: true, twice: true});
	});
});

describe("what a value is", () => {
	it("is translucent for an alpha step, black or white alpha, or an 8-digit hex", () => {
		expect(
			[
				"slate.a3",
				"black.a6",
				{step: "slate.a9", bend: "b"},
				{hex: "#00000066", bend: "b"},
				"slate.12",
				{hex: "#0c0d0e", bend: "b"},
			].map(isTranslucent),
		).toEqual([true, true, true, true, false, false]);
	});

	it("tells a token with values of its own from one that extends", () => {
		const {tokens} = decodeAll();
		const own = [...tokens].filter(([, t]) => isOwn(t)).map(([name]) => name);
		expect({
			count: own.length,
			closed: own.includes("closed"),
			focus: own.includes("focus"),
		}).toEqual({
			count: 21,
			closed: false,
			focus: true,
		});
	});
});
