import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {ratio} from "./build/contrast.ts";
import {dark, light} from "./theme-colors.ts";

// Ticket 102, ask desk PR 1, plan property 23 and its 2026-11-09 amendment: text reads 4.5:1
// (WCAG 1.4.3, color-principles). In the light look the primary Take rec goes pale with the evidence
// or the note open. This law computes Take rec's label against its own background from the real
// token values, in every ask-box state and both looks, with `ratio` from build/contrast.ts.
//
// What Take rec is drawn with (programs/tracker/src/ask-window.tsx, the toolbar's Button): Manti's
// primary solid, `--manti-accent-fill` = turn-fill, label `--manti-text-on-accent` = on-turn, and
// Manti's own state mixes in oklab (hover 88% fill over white in light, black in dark; pressed 78%);
// While a note is open
// Take rec is the outline variant: label = 78% fill over black in light, 45% fill over white in
// dark (Manti's `--variant-text`), on the raised surface.
//
// The saving state (busy: every action disabled, Manti draws the button at opacity .5) is not
// covered: WCAG 1.4.3 exempts inactive user interface components, so the 4.5:1 law holds only while
// Take rec is enabled (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html, "Incidental").
//
// Properties, not a list: for any look and any ask-box state, the pair reads 4.5. The pairs are
// generated over looks x states; the plant is a paler fill, which must fail the same check.

type Look = "light" | "dark";
const LOOKS = {light, dark} as const;

// The ask-box states a shot captures; each lists which Take rec draw it puts the button in.
const STATES = [
	"rest",
	"shown rec",
	"evidence open",
	"note open",
	"pick: yes",
	"pick: no",
	"pick: other",
	"hovered",
	"pressed",
	"failed save",
] as const;
type State = (typeof STATES)[number];

// oklab mixing, as CSS `color-mix(in oklab, a p%, b)`.
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const toLab = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [
		number,
		number,
		number,
	];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	] as const;
};
const fromLab = ([L, a, b]: readonly [number, number, number]) => {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	return `#${rgb
		.map((c) =>
			Math.round(Math.min(1, Math.max(0, gam(c))) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
};
const mix = (a: string, percent: number, b: string) => {
	const [A, B] = [toLab(a), toLab(b)];
	const p = percent / 100;
	return fromLab([0, 1, 2].map((i) => A[i]! * p + B[i]! * (1 - p)) as [number, number, number]);
};

/** Take rec's label and background in a state and a look: what the page draws, from the tokens. */
const takeRec = (look: Look, state: State): {fg: string; bg: string} => {
	const t = LOOKS[look];
	const fill = t["turn-fill"];
	const surface = t.raised;
	const toward = look === "light" ? "#ffffff" : "#000000";
	switch (state) {
		case "note open": // the outline variant: the one indigo is the note's Send
			return {
				fg: look === "light" ? mix(fill, 78, "#000000") : mix(fill, 45, "#ffffff"),
				bg: surface,
			};
		case "hovered":
			return {fg: t["on-turn"], bg: mix(fill, 88, toward)};
		case "pressed":
			return {fg: t["on-turn"], bg: mix(fill, 78, toward)};
		default:
			return {fg: t["on-turn"], bg: fill};
	}
};

describe("law 23: Take rec's label reads 4.5:1 on its own background", () => {
	it("in every ask-box state, in both looks, from the real tokens", () => {
		fc.assert(
			fc.property(
				fc.constantFrom<Look>("light", "dark"),
				fc.constantFrom(...STATES),
				(look, state) => {
					const {fg, bg} = takeRec(look, state);
					const got = ratio(fg, bg);
					expect(got, `${state}, ${look}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
				},
			),
			{numRuns: 200},
		);
	});

	it("plant: a fill lightened 40% or more toward white under the white label is caught by the same ratio", () => {
		fc.assert(
			fc.property(
				fc.constantFrom<Look>("light", "dark"),
				fc.integer({min: 40, max: 60}),
				(look, pale) => {
					const t = LOOKS[look];
					const bg = mix(t["turn-fill"], 100 - pale, "#ffffff");
					expect(ratio(t["on-turn"], bg)).toBeLessThan(4.5);
				},
			),
		);
	});
});
