import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {fabrika, fabrikaLight} from "../themes.ts";
import {over, ratio} from "./contrast.ts";

// The contrast checker the token floors are judged by (design foundations, PR 2, property 15). It
// is exam: the floors are only as good as the checker. What it must give:
//
//   ratio("#ffffff", "#000000")    // 21: WCAG 2.2's contrast ratio, unrounded
//   ratio("#dfebfd6d", "#111113")  // 3.68: an alpha color is drawn over its backdrop first
//   over("#dfebfd6d", "#111113")   // "#696e77": drawn, rounded to 8 bits a channel, as rules.py does
//
// `fg` may carry alpha; `bg` is solid. Colors are lowercase `#rrggbb` or `#rrggbbaa`.
//
// The reference below is a second implementation, the same math themes.test.ts uses, so the two
// must agree: a bug in one shows as a disagreement.

type Rgba = readonly [number, number, number, number];

const rgbaOf = (value: string): Rgba => {
	const at = (i: number) => Number.parseInt(value.slice(i, i + 2), 16) / 255;
	return [at(1), at(3), at(5), value.length === 9 ? at(7) : 1];
};

const hexFrom = ([r, g, b]: Rgba) =>
	`#${[r, g, b]
		.map((c) =>
			Math.round(c * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

const referenceOver = (top: string, bottom: string) => {
	const [r, g, b, a] = rgbaOf(top);
	const [R, G, B] = rgbaOf(bottom);
	const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255) / 255;
	return hexFrom([mix(r, R), mix(g, G), mix(b, B), 1]);
};

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

const referenceRatio = (fg: string, bg: string) => {
	const ink = rgbaOf(referenceOver(fg, bg));
	const [hi, lo] = [luminance(ink), luminance(rgbaOf(bg))].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

const solid = fc.stringMatching(/^[0-9a-f]{6}$/).map((digits) => `#${digits}`);
const translucent = fc.stringMatching(/^[0-9a-f]{8}$/).map((digits) => `#${digits}`);
const anyColor = fc.oneof(solid, translucent);
const RUNS = {seed: 119120, numRuns: 300};

describe("the contrast checker's fixed points", () => {
	it("gives 21 for white on black, either way round", () => {
		expect(ratio("#ffffff", "#000000")).toBeCloseTo(21, 12);
		expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 12);
	});

	it("gives 1 for any solid color on itself", () => {
		fc.assert(
			fc.property(solid, (c) => {
				expect(ratio(c, c)).toBeCloseTo(1, 12);
			}),
			RUNS,
		);
	});
});

describe("a color in any other form is refused", () => {
	it.each([
		["#abc", "#000000"],
		["#ABCDEF", "#000000"],
		["#ffffff", "#00000"],
		["ffffff", "#000000"],
	])("throws on %s over %s", (fg, bg) => {
		expect(() => ratio(fg, bg)).toThrow(/not a #rrggbb or #rrggbbaa color/);
	});
});

describe("the ratio's shape, for any colors", () => {
	it("is the same both ways round for two solid colors", () => {
		fc.assert(
			fc.property(solid, solid, (a, b) => {
				expect(ratio(a, b)).toBeCloseTo(ratio(b, a), 12);
			}),
			RUNS,
		);
	});

	it("is always between 1 and 21, alpha or not", () => {
		fc.assert(
			fc.property(anyColor, solid, (fg, bg) => {
				const r = ratio(fg, bg);
				expect(r >= 1 && r <= 21).toBe(true);
			}),
			RUNS,
		);
	});
});

describe("the luminance weights are WCAG's, red 0.2126, green 0.7152, blue 0.0722", () => {
	it("reads pure red, green and blue on black as 5.25, 15.30 and 2.44", () => {
		expect(["#ff0000", "#00ff00", "#0000ff"].map((c) => ratio(c, "#000000").toFixed(2))).toEqual([
			"5.25",
			"15.30",
			"2.44",
		]);
	});
});

describe("an alpha color is drawn over its backdrop, rounded to 8 bits a channel", () => {
	it("draws dark focus, slate a9, over the dark ground as #696e77", () => {
		expect(over("#dfebfd6d", "#111113")).toBe("#696e77");
	});

	it("leaves a solid color as it is, whatever is under it", () => {
		fc.assert(
			fc.property(solid, solid, (top, bottom) => {
				expect(over(top, bottom)).toBe(top);
			}),
			RUNS,
		);
	});

	it("draws any alpha color as the reference does, to the 8-bit channel", () => {
		fc.assert(
			fc.property(translucent, solid, (top, bottom) => {
				expect(over(top, bottom)).toBe(referenceOver(top, bottom));
			}),
			RUNS,
		);
	});

	it("reads an alpha color by what it draws, not by its own channels", () => {
		// Slate a9 dark is a near-white at alpha 0.43: read as solid it would be about 15:1.
		expect(ratio("#dfebfd6d", "#111113").toFixed(2)).toBe("3.68");
	});
});

describe("the repo's printed values", () => {
	const selectedDark = referenceOver("#d9edfe25", "#111113"); // slate a5 over slate 1, dark

	it("gives 4.28 for white on indigo 10, the hovered turn fill in dark (ticket 153)", () => {
		expect(ratio("#ffffff", "#5472e4").toFixed(2)).toBe("4.28");
	});

	it("gives 2.82 for slate a8 on a dark selected row, why focus is a9", () => {
		expect(ratio("#d9edff5d", selectedDark).toFixed(2)).toBe("2.82");
	});

	it("gives 3.32 for focus, slate a9, on a dark selected row: the worst pair the plan traces", () => {
		expect(ratio("#dfebfd6d", selectedDark).toFixed(2)).toBe("3.32");
	});
});

describe("it agrees with the second implementation", () => {
	it("on any color over any solid backdrop", () => {
		fc.assert(
			fc.property(anyColor, solid, (fg, bg) => {
				expect(ratio(fg, bg)).toBeCloseTo(referenceRatio(fg, bg), 9);
			}),
			RUNS,
		);
	});

	it("on every theme color over each solid page of its look, and over a hovered row", () => {
		const pairs = [fabrika.colors, fabrikaLight.colors].flatMap((colors) => {
			const pages = [colors.desk, colors.ground, colors.raised];
			const backdrops = [...pages, ...pages.map((page) => referenceOver(colors.hover, page))];
			return Object.values(colors).flatMap((fg) => backdrops.map((bg) => [fg, bg] as const));
		});
		expect(pairs.length).toBeGreaterThan(100);
		const apart = pairs.filter(
			([fg, bg]) => Math.abs(ratio(fg, bg) - referenceRatio(fg, bg)) > 1e-9,
		);
		expect(apart).toEqual([]);
	});
});

// T343, today's app, PR 1. These are independent of the production APCA dependency.
// Plants: ignore alpha; swap APCA's arguments; round before comparing; combine floors with OR.
// fast-check generates invalid/boundary mixtures for which no Effect schema exists.
describe("T5 signed APCA and WCAG on drawn colors", () => {
	it("agrees with independent equations for alpha layers and either polarity", async () => {
		const reference = await import("@kampus/themes-fixture/laws");
		const checker = await import("./contrast.ts");
		fc.assert(
			fc.property(
				fc.tuple(anyColor, solid, fc.array(translucent, {maxLength: 5})),
				([fg, base, layers]) => {
					const bg = reference.flatten([base, ...layers]);
					const actual = checker.measure(fg, bg);
					expect(actual.wcag).toBeCloseTo(reference.wcag(fg, bg), 10);
					expect(actual.apca).toBeCloseTo(reference.apca(fg, bg), 10);
					const flipped = checker.measure(bg, reference.composite(fg, bg));
					expect(flipped.apca).toBeCloseTo(reference.apca(bg, reference.composite(fg, bg)), 10);
				},
			),
			RUNS,
		);
	});
	// vector: published apca-w3 0.1.9 black/white endpoints establish signed polarity.
	it("vector: black on white is positive and white on black negative", async () => {
		const {measure} = await import("./contrast.ts");
		expect(measure("#000000", "#ffffff").apca).toBeCloseTo(106.04067321268862, 9);
		expect(measure("#ffffff", "#000000").apca).toBeCloseTo(-107.88473318309848, 9);
	});
});

describe("T6 both floors, with unrounded readings", () => {
	it("requires each floor independently at, just below and just above its reading", async () => {
		const {reading} = await import("@kampus/themes-fixture/laws");
		const {passes} = await import("./contrast.ts");
		fc.assert(
			fc.property(anyColor, solid, (fg, bg) => {
				const r = reading(fg, bg),
					magnitude = Math.abs(r.apca);
				const epsilon = 1e-8;
				expect(passes(fg, bg, {wcag: r.wcag, apca: magnitude})).toBe(true);
				expect(
					passes(fg, bg, {wcag: r.wcag + epsilon, apca: Math.max(0, magnitude - epsilon)}),
				).toBe(false);
				expect(
					passes(fg, bg, {wcag: Math.max(1, r.wcag - epsilon), apca: magnitude + epsilon}),
				).toBe(false);
			}),
			RUNS,
		);
	});
	it("uses text 4.5/Lc60 and non-text 3/Lc15 in either polarity", async () => {
		const {meets} = await import("@kampus/themes-fixture/laws");
		const {passes} = await import("./contrast.ts");
		fc.assert(
			fc.property(
				anyColor,
				solid,
				fc.constantFrom({wcag: 4.5, apca: 60}, {wcag: 7, apca: 60}, {wcag: 3, apca: 15}),
				(fg, bg, floor) => {
					expect(passes(fg, bg, floor)).toBe(meets(fg, bg, floor));
				},
			),
			RUNS,
		);
	});
});

// T9-T12 use the plan's check(theme, pairs, policy, version) entry point.
// The version value carries the test cap; the measured shipping cap stays in repair.toml.
// Plants: alter a background/chroma/alpha; move only lighter; clip channels; replace the theme;
// claim a failing built-in replacement passed; repair despite off.
describe("T9-T12 bounded, lightness-only repair", () => {
	const pair = (token = "text-primary", on = "surface", floor = {wcag: 4.5, apca: 60}) => ({
		token,
		on,
		floor,
	});
	const version = {version: "test-343", cap: 1};
	it("T9 is deterministic, does not mutate input, and preserves non-repairable colors", async () => {
		const {
			complete,
			lab,
			labBounds,
			opacity,
			RUNS: runs,
		} = await import("@kampus/themes-fixture/laws");
		const {check} = await import("./contrast.ts");
		fc.assert(
			fc.property(complete, (theme) => {
				const before = structuredClone(theme);
				const pairs = [
					// The base of each drawn stack is solid; ground itself may carry alpha.
					pair("text-primary", "surface/terminal.background"),
					pair("text-faint", "surface/terminal.background"),
					pair("focus", "surface/terminal.background", {wcag: 3, apca: 15}),
					pair("cursor", "terminal.background", {wcag: 3, apca: 15}),
				];
				const got = check(theme, pairs, {fix: "nudge", contrast: 4.5}, version);
				expect(check(theme, pairs, {fix: "nudge", contrast: 4.5}, version)).toEqual(got);
				expect(theme).toEqual(before);
				expect(got.written).toEqual(before);
				for (const name of [
					"surface-sunken",
					"surface",
					"surface-raised",
					"surface-hover",
					"border-faint",
				] as const)
					expect(got.shown.colors[name]).toBe(theme.colors[name]);
				expect(got.shown.terminal.background).toBe(theme.terminal.background);
				expect(got.shown.terminal.palette).toEqual(theme.terminal.palette);
				for (const change of got.changes.filter(
					(c: {readonly _tag: string; readonly was: string; readonly now: string}) =>
						c._tag === "moved",
				)) {
					const from = lab(change.was),
						bounds = labBounds(change.now);
					// The emitted byte cell must contain the original hue and chroma.
					for (const i of [1, 2]) {
						expect(from[i]!).toBeGreaterThanOrEqual(bounds[i]![0]!);
						expect(from[i]!).toBeLessThanOrEqual(bounds[i]![1]!);
					}
					expect(opacity(change.now)).toBe(opacity(change.was));
				}
			}),
			runs,
		);
	});
	it("T10 has no smaller passing move among every representable achromatic candidate", async () => {
		const {complete, gray, lab, meets} = await import("@kampus/themes-fixture/laws");
		const {check} = await import("./contrast.ts");
		fc.assert(
			fc.property(complete, fc.integer({min: 0, max: 255}), fc.boolean(), (theme, n, light) => {
				const background = light ? "#ffffff" : "#000000";
				const fg = gray(n);
				const input = {
					...theme,
					colors: {...theme.colors, "text-primary": fg, surface: background},
				};
				const got = check(input, [pair()], {fix: "nudge", contrast: 4.5}, version);
				const now = got.shown.colors["text-primary"];
				expect(meets(now, background)).toBe(true);
				const move = Math.abs(lab(now)[0] - lab(fg)[0]);
				const smaller = Array.from({length: 256}, (_, i) => gray(i)).filter(
					(c) => Math.abs(lab(c)[0] - lab(fg)[0]) < move - 1e-10 && meets(c, background),
				);
				expect(smaller).toEqual([]);
				expect(got.failures).toEqual([]);
			}),
			RUNS,
		);
	});
	it("T9 resolves a foreground alias and an alpha background stack before repairing", async () => {
		const {complete, solid, alpha, composite, meets} = await import("@kampus/themes-fixture/laws");
		const {check} = await import("./contrast.ts");
		fc.assert(
			fc.property(complete, solid, alpha, (theme, base, overlay) => {
				const input = {
					...theme,
					colors: {
						...theme.colors,
						surface: base,
						"surface-hover": overlay,
						"text-faint": "text-primary",
					},
				};
				const requirements = [pair("text-faint", "surface-hover/surface")];
				const got = check(input, requirements, {fix: "nudge", contrast: 4.5}, version);
				expect(got.shown.colors["text-faint"]).toBe("text-primary");
				expect(got.shown.colors["surface"]).toBe(base);
				expect(got.shown.colors["surface-hover"]).toBe(overlay);
				expect(got.failures.length === 0).toBe(
					meets(got.shown.colors["text-primary"]!, composite(overlay, base)),
				);
				const flattened = {
					...input,
					colors: {...input.colors, "surface-raised": composite(overlay, base)},
				};
				expect(
					check(
						flattened,
						[pair("text-primary", "surface-raised")],
						{fix: "nudge", contrast: 4.5},
						version,
					).shown.colors["text-primary"],
				).toBe(got.shown.colors["text-primary"]);
			}),
			RUNS,
		);
	});
	it("T10 satisfies every backdrop together, or reports impossibility", async () => {
		const {complete, gray, meets} = await import("@kampus/themes-fixture/laws");
		const {check} = await import("./contrast.ts");
		fc.assert(
			fc.property(complete, fc.integer({min: 0, max: 255}), (theme, n) => {
				const input = {
					...theme,
					colors: {
						...theme.colors,
						"text-primary": gray(n),
						surface: "#000000",
						"surface-raised": "#ffffff",
					},
				};
				const pairs = [pair(), pair("text-primary", "surface-raised")];
				const got = check(input, pairs, {fix: "nudge", contrast: 21}, version);
				expect(got.shown.colors["surface"]).toBe("#000000");
				expect(got.shown.colors["surface-raised"]).toBe("#ffffff");
				expect(got.failures.length).toBeGreaterThan(0);
				const expectedFailures = [
					["surface", "#000000"],
					["surface-raised", "#ffffff"],
				]
					.filter(([, bg]) => !meets(got.shown.colors["text-primary"], bg!, {wcag: 21, apca: 60}))
					.map(([on]) => `text-primary:${on}`)
					.sort();
				expect(
					got.failures
						.map(
							(failure: {readonly token: string; readonly on: string}) =>
								`${failure.token}:${failure.on}`,
						)
						.sort(),
				).toEqual(expectedFailures);
			}),
			RUNS,
		);
	});
	it("T11 past-cap fallback touches only that token and uses its own look", async () => {
		const {complete, gray, lab} = await import("@kampus/themes-fixture/laws");
		const {check} = await import("./contrast.ts");
		fc.assert(
			fc.property(complete, fc.boolean(), (theme, light) => {
				const builtin = light ? fabrikaLight : fabrika;
				const input = {
					...theme,
					look: light ? "light" : "dark",
					colors: {
						...theme.colors,
						"text-primary": gray(light ? 255 : 0),
						surface: gray(light ? 255 : 0),
					},
				};
				const unrestricted = check(input, [pair()], {fix: "nudge", contrast: 4.5}, version);
				const move = Math.abs(
					lab(unrestricted.shown.colors["text-primary"])[0] - lab(input.colors["text-primary"])[0],
				);
				expect(move).toBeGreaterThan(0);
				for (const cap of [move - 1e-8, move, move + 1e-8]) {
					const got = check(input, [pair()], {fix: "nudge", contrast: 4.5}, {...version, cap});
					const replacement = got.changes.filter(
						(c: {readonly _tag: string}) => c._tag === "builtin",
					);
					expect(replacement.length).toBe(cap < move ? 1 : 0);
					expect({...got.shown.colors, "text-primary": input.colors["text-primary"]}).toEqual(
						input.colors,
					);
					expect(got.shown.terminal).toEqual(input.terminal);
					expect(
						cap < move
							? got.shown.colors["text-primary"]
							: unrestricted.shown.colors["text-primary"],
					).toBe(cap < move ? builtin.terminal.foreground : got.shown.colors["text-primary"]);
				}
			}),
			RUNS,
		);
	});
	it("T11 never reports a failed replacement as passing", async () => {
		const {complete, meets} = await import("@kampus/themes-fixture/laws");
		const {check} = await import("./contrast.ts");
		fc.assert(
			fc.property(complete, fc.boolean(), (theme, light) => {
				const builtin = light ? fabrikaLight : fabrika;
				const input = {
					...theme,
					look: light ? "light" : "dark",
					colors: {
						...theme.colors,
						surface: builtin.terminal.foreground,
						"text-primary": builtin.terminal.foreground,
					},
				};
				const got = check(input, [pair()], {fix: "nudge", contrast: 21}, {...version, cap: 0});
				expect(got.shown.colors["text-primary"]).toBe(builtin.terminal.foreground);
				expect(
					meets(got.shown.colors["text-primary"], input.colors["surface"], {wcag: 21, apca: 60}),
				).toBe(false);
				expect(got.failures.length).toBeGreaterThan(0);
			}),
			RUNS,
		);
	});
	it("T12 off preserves every color and still lists the failing pairs", async () => {
		const {complete, composite} = await import("@kampus/themes-fixture/laws");
		const {check} = await import("./contrast.ts");
		fc.assert(
			fc.property(complete, fc.double({min: 4.5, max: 21, noNaN: true}), (theme, contrast) => {
				const input = {
					...theme,
					colors: {
						...theme.colors,
						"text-primary": composite(theme.colors["surface"]!, theme.terminal.background),
					},
				};
				const got = check(
					input,
					[pair("text-primary", "surface/terminal.background")],
					{fix: "off", contrast},
					version,
				);
				expect(got.shown).toEqual(input);
				expect(got.written).toEqual(input);
				expect(got.failures.length).toBeGreaterThan(0);
			}),
			RUNS,
		);
	});
});
