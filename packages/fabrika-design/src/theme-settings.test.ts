// Today's app, T343 PR 1. Plants: accept contrast=3; clamp 22 to 21; preprocess [theme].
import {readFileSync} from "node:fs";
import {name, RUNS} from "@kampus/themes-fixture/laws";
import {Result} from "effect";
import fc from "fast-check";
import {parse} from "smol-toml";
import {describe, expect, it} from "vitest";
import {decodeThemeSettings, readThemeSettings} from "./theme-settings.ts";

const fixture = (file: string) =>
	readFileSync(new URL(`../../../fixtures/themes/${file}`, import.meta.url), "utf8");
const settings = (document: Record<string, unknown>) => readThemeSettings(document);

describe("T3 one policy for app, cursor and terminal", () => {
	it("keeps defaults in any document with unrelated settings", () => {
		fc.assert(
			fc.property(
				fc.dictionary(
					name.map((n) => `unrelated-${n}`),
					fc.jsonValue(),
				),
				(rest) => {
					expect(settings(rest)).toMatchObject({
						pick: "fabrika",
						policy: {fix: "nudge", contrast: 4.5},
						diagnostics: [],
					});
				},
			),
			RUNS,
		);
	});
	it("keeps every valid finite contrast including both boundaries", () => {
		fc.assert(
			fc.property(
				fc.oneof(fc.constantFrom(4.5, 7, 21), fc.double({min: 4.5, max: 21, noNaN: true})),
				fc.constantFrom("nudge", "off"),
				name,
				(contrast, fix, pick) => {
					expect(
						settings({theme: pick, "theme-fix": fix, "theme-contrast": contrast}),
					).toMatchObject({pick, policy: {fix, contrast}, diagnostics: []});
				},
			),
			RUNS,
		);
	});
	it("raises finite numbers below 4.5 with exactly one diagnostic", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.constantFrom(3, 0, -1, 4.499999),
					fc.double({max: 4.499999, noNaN: true, noDefaultInfinity: true}),
				),
				(contrast) => {
					const got = settings({"theme-contrast": contrast});
					expect(got.policy).toEqual({fix: "nudge", contrast: 4.5});
					expect(got.diagnostics).toHaveLength(1);
					expect(JSON.stringify(got.diagnostics)).toContain("theme-contrast");
				},
			),
			RUNS,
		);
	});
	it("defaults invalid, infinite and above-21 values with one diagnostic", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.string(),
					fc.boolean(),
					fc.constant(null),
					fc.constantFrom(Number.NaN, Infinity, -Infinity, 22),
					fc.double({min: 21.00000001, noNaN: true}),
				),
				(contrast) => {
					const got = settings({"theme-contrast": contrast});
					expect(got.policy.contrast).toBe(4.5);
					expect(got.diagnostics).toHaveLength(1);
				},
			),
			RUNS,
		);
	});
	it("refuses invalid policy words rather than enabling a second policy", () => {
		fc.assert(
			fc.property(
				name.filter((v) => v !== "nudge" && v !== "off"),
				(fix) => {
					const got = settings({"theme-fix": fix});
					expect(got.policy.fix).toBe("nudge");
					expect(got.diagnostics).toHaveLength(1);
				},
			),
			RUNS,
		);
	});
});

describe("T4 standard TOML", () => {
	// format: the owner's corrected spelling must be understood by an ordinary TOML parser.
	it("format: selection, fix and contrast coexist as three top-level keys", () => {
		const document = parse(fixture("settings.toml"));
		expect(Result.isSuccess(decodeThemeSettings(fixture("settings.toml")))).toBe(true);
		expect(document).toEqual({theme: "nord-fabrika", "theme-fix": "nudge", "theme-contrast": 4.5});
		expect(settings(document)).toMatchObject({
			pick: "nord-fabrika",
			policy: {fix: "nudge", contrast: 4.5},
			diagnostics: [],
		});
	});
	// format: the exact old key/table collision is kept to prevent a private preprocessing dialect.
	it("format: rejects the old theme string plus theme table document", () => {
		expect(() => parse(fixture("settings-conflict.toml"))).toThrow();
		expect(Result.isFailure(decodeThemeSettings(fixture("settings-conflict.toml")))).toBe(true);
	});
});
