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

	it("decodes a file that is no table, or has no [colors], as bad, never a throw", () => {
		const {colors: _, ...noColors} = textFaint();
		expect({
			array: decodeToken("x.toml", [])._tag,
			string: decodeToken("x.toml", "text")._tag,
			noColors: errorsOf("text-faint.toml", noColors),
		}).toEqual({array: "bad", string: "bad", noColors: ["text-faint.toml: colors: Missing key"]});
	});

	it("names the file in an error that has no field", () => {
		expect(errorsOf("x.toml", "text")).toEqual([expect.stringMatching(/^x\.toml: \S/)]);
	});

	it.each(["primitive", "global", "shared", "component"])("decodes the tier %s", (tier) => {
		expect(decodeToken("text-faint.toml", {...textFaint(), tier})._tag).toBe("ok");
	});

	const withDark = (dark: unknown) => {
		const t = textFaint();
		const colors = t["colors"];
		return errorsOf("text-faint.toml", {
			...t,
			colors: {...(typeof colors === "object" ? colors : {}), dark},
		});
	};

	it("decodes a 6- or 8-digit hex, and refuses any other", () => {
		expect({
			six: withDark({hex: "#0c0d0e", bend: "b"}),
			eight: withDark({hex: "#00000066", bend: "b"}),
			seven: withDark({hex: "#0000006", bend: "b"}).some((e) => e.includes("colors.dark.hex:")),
			lead: withDark({hex: "x#000000", bend: "b"}).some((e) => e.includes("colors.dark.hex:")),
			upper: withDark({hex: "#0C0D0E", bend: "b"}).some((e) => e.includes("colors.dark.hex:")),
		}).toEqual({six: [], eight: [], seven: true, lead: true, upper: true});
	});

	it.each(["Surface", "1surface", "surface/Surface", "surface-"])(
		"refuses the backdrop %s",
		(backdrop) => {
			expect(
				errorsOf("text-faint.toml", {...textFaint(), on: [backdrop]}).some((e) =>
					e.startsWith("text-faint.toml: on.0:"),
				),
			).toBe(true);
		},
	);
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

	/** The checks across files with one token file changed, as `[field, message]` pairs. */
	const changed = (name: string, change: (t: Record<string, unknown>) => void) => {
		const s = sources();
		const token = s.tokens.get(name);
		if (token === undefined) throw new Error(`no ${name}`);
		const t: Record<string, unknown> = {...token};
		change(t);
		const decoded = decodeToken(`${name}.toml`, t);
		if (decoded._tag === "bad") throw new Error(decoded.errors.join("\n"));
		s.tokens.set(name, decoded.value);
		return checkAcross(s).map((e) => e.split(": ").slice(1));
	};
	const set =
		(key: string, value: unknown) =>
		(t: Record<string, unknown>): void => {
			t[key] = value;
		};
	const drop =
		(...keys: readonly string[]) =>
		(t: Record<string, unknown>): void => {
			for (const key of keys) delete t[key];
		};

	it("holds a text token to 4.5, so a WCAG 3 is not enough", () => {
		expect(changed("text-faint", set("floor", 3))).toEqual([
			["floor", "a text token needs 4.5 or more"],
		]);
	});

	it("names each part of a backdrop that is no token", () => {
		expect({
			alone: changed("text-faint", set("on", ["no-such"])),
			drawn: changed("text-faint", set("on", ["surface/no-such"])),
		}).toEqual({
			alone: [["on", 'no token "no-such" in "no-such"']],
			drawn: [["on", 'no token "no-such" in "surface/no-such"']],
		});
	});

	it("tells a text token with no on and no floor of both", () => {
		expect(changed("text-faint", drop("on", "floor"))).toEqual([
			["on", "a text token names what it sits on"],
			["floor", "a text token needs 4.5 or more"],
			["on", "a translucent value names its backdrop"],
		]);
	});

	it("refuses a floor on a border that carries nothing", () => {
		expect(changed("border-strong", set("floor", 3))).toEqual([
			["floor", "a value that carries nothing has no floor"],
		]);
	});

	it("tells a border with no carries, no on and no floor of both", () => {
		expect(changed("border-strong", drop("carries", "on"))).toEqual([
			["on", "a border names what it sits on, or carries nothing"],
			["floor", "a border needs 3 or more, or carries nothing"],
			["on", "a translucent value names its backdrop"],
		]);
	});

	it("holds an icon as it holds a border", () => {
		const icon = (t: Record<string, unknown>) => {
			drop("carries", "on")(t);
			t["type"] = "icon";
		};
		expect(changed("border-strong", icon)).toEqual([
			["on", "an icon names what it sits on, or carries nothing"],
			["floor", "an icon needs 3 or more, or carries nothing"],
			["on", "a translucent value names its backdrop"],
		]);
	});

	it("judges a floor on what the token sits on, so a floor needs an on", () => {
		expect(changed("focus", drop("on"))).toEqual([
			["on", "a border names what it sits on, or carries nothing"],
			["on", "a translucent value names its backdrop"],
			["on", "a floor or an aim is judged on what the token sits on"],
		]);
	});

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

// Today's app, T343/T8 input law. Plant: leave scale choices unsupported and move steps at runtime.
describe("T8 build-time scale choices", () => {
	it("refuses unknown scales and a scale mixed with per-look values", async () => {
		const {default: fc} = await import("fast-check");
		fc.assert(
			fc.property(fc.string(), (unknown) => {
				const common = {
					type: "text",
					tier: "global",
					owner: "design",
					description: "scale refusal",
					on: ["surface"],
					floor: 4.5,
				};
				expect(
					decodeToken("text-test.toml", {...common, colors: {scale: `unknown-${unknown}`}})._tag,
				).toBe("bad");
				expect(
					decodeToken("text-test.toml", {
						...common,
						colors: {scale: "slate", dark: "slate.11", light: "slate.11"},
					})._tag,
				).toBe("bad");
			}),
			{seed: 119120, numRuns: 150},
		);
	});
	it("accepts every decided Radix scale as a global text choice", async () => {
		const {default: fc} = await import("fast-check");
		const scales = [
			"gray",
			"mauve",
			"slate",
			"sage",
			"olive",
			"sand",
			"tomato",
			"red",
			"ruby",
			"crimson",
			"pink",
			"plum",
			"purple",
			"violet",
			"iris",
			"indigo",
			"blue",
			"cyan",
			"teal",
			"jade",
			"green",
			"grass",
			"brown",
			"bronze",
			"gold",
			"sky",
			"mint",
			"lime",
			"yellow",
			"amber",
			"orange",
		] as const;
		fc.assert(
			fc.property(fc.constantFrom(...scales), (scale) => {
				const token = {
					type: "text",
					tier: "global",
					owner: "design",
					description: "generated scale candidate",
					on: ["surface", "surface-hover/surface", "surface-selected/surface"],
					floor: 4.5,
					colors: {scale},
				};
				expect(decodeToken("text-test.toml", token)._tag).toBe("ok");
			}),
			{seed: 119120, numRuns: 150},
		);
	});
});

// T343: the label rule is ordered white/black, never an arbitrary list or a fixed fallback.
// Plants: refuse the new input, accept any candidate, reverse its preference, or mix modes.
describe("T7 build-time white/black label choice", () => {
	it("accepts exactly the white-first choice and refuses other colors or mixed modes", async () => {
		const {default: fc} = await import("fast-check");
		fc.assert(
			fc.property(fc.string(), fc.constantFrom(4.5, 7), (other, floor) => {
				const token = {
					type: "text",
					tier: "global",
					owner: "design",
					description: "text on fixed accent fills",
					on: ["turn-fill", "turn-fill-hover"],
					floor,
				};
				const colors = {choose: ["#ffffff", "#000000"]};
				expect(decodeToken("turn-fg.toml", {...token, colors})._tag).toBe("ok");
				for (const invalid of [
					{choose: ["#000000", "#ffffff"]},
					{choose: ["#ffffff"]},
					{choose: []},
					{choose: ["#ffffff", "#000000", other]},
					{choose: ["#ffffff", `${other}!`]},
					{...colors, scale: "indigo"},
					{...colors, dark: "indigo.11", light: "indigo.11"},
				])
					expect(decodeToken("turn-fg.toml", {...token, colors: invalid})._tag).toBe("bad");
			}),
			{seed: 119120, numRuns: 150},
		);
	});
});
