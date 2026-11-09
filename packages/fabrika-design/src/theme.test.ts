import {complete, globalNames, hex, name, RUNS} from "@kampus/themes-fixture/laws";
// Today's app, T343 PR 1. Plant: merge partial input with fabrika; accept two sources;
// compare repaired.cursor with colors["text-primary"] instead of terminal.cursor.
import {Result} from "effect";
import fc from "fast-check";
import {stringify} from "smol-toml";
import {describe, expect, it} from "vitest";
import {decodeTheme} from "./theme.ts";

const decode = (input: unknown) => decodeTheme(stringify(input as Record<string, unknown>));
const source = fc.record({
	file: name.map((n) => `${n}.yaml`),
	sha256: fc.stringMatching(/^[0-9a-f]{64}$/),
	by: name,
});
const origins = fc.oneof(
	source.map((v) => ({base16: v})),
	source.map((v) => ({base24: v})),
	source.map((v) => ({ghostty: v})),
	fc
		.record({
			version: fc.constant("3.0.0"),
			gray: fc.constantFrom("gray", "mauve", "slate", "sage", "olive", "sand"),
			accent: fc.constantFrom("indigo", "blue", "mint", "red"),
		})
		.map((v) => ({radix: v})),
);

describe("T1 complete, closed theme files", () => {
	it("keeps every supplied global and each of sixteen terminal entries", () => {
		fc.assert(
			fc.property(complete, (input) => {
				const got = decode(input);
				expect(Result.isSuccess(got)).toBe(true);
				expect(Result.getOrThrow(got)).toMatchObject(input);
			}),
			RUNS,
		);
	});
	it("refuses every missing global rather than filling it from a built-in", () => {
		fc.assert(
			fc.property(complete, fc.constantFrom(...globalNames), (input, key) => {
				const colors = {...input.colors};
				delete colors[key];
				expect(Result.isFailure(decode({...input, colors}))).toBe(true);
			}),
			RUNS,
		);
	});
	it("refuses missing root and terminal fields and palettes of every other length", () => {
		fc.assert(
			fc.property(
				complete,
				fc.constantFrom(
					"format",
					"name",
					"look",
					"colors",
					"terminal",
					"foreground",
					"background",
					"cursor",
					"selection",
					"palette",
				),
				fc.integer({min: 0, max: 32}).filter((n) => n !== 16),
				(input, field, size) => {
					const root: Record<string, unknown> = {...input};
					const terminal: Record<string, unknown> = {...input.terminal};
					if (Object.hasOwn(root, field)) delete root[field];
					else delete terminal[field];
					expect(
						Result.isFailure(decode({...root, ...(field === "terminal" ? {} : {terminal})})),
					).toBe(true);
					expect(
						Result.isFailure(
							decode({
								...input,
								terminal: {...input.terminal, palette: Array.from({length: size}, () => "#112233")},
							}),
						),
					).toBe(true);
				},
			),
			RUNS,
		);
	});
	it("refuses unknown, component and Manti fields at every table", () => {
		fc.assert(
			fc.property(
				complete,
				fc.constantFrom("tile-edge", "--manti-text", "unknown-color"),
				hex,
				(input, key, value) => {
					for (const altered of [
						{...input, [key]: value},
						{...input, colors: {...input.colors, [key]: value}},
						{...input, terminal: {...input.terminal, [key]: value}},
					]) {
						expect(Result.isFailure(decode(altered))).toBe(true);
					}
				},
			),
			RUNS,
		);
	});
	it("refuses malformed colors, Radix refs and CSS expressions", () => {
		fc.assert(
			fc.property(
				complete,
				fc.constantFrom(...globalNames),
				fc.oneof(
					name,
					fc.integer(),
					fc.constantFrom(
						"#123",
						"#GG0000",
						"#ABCDEF",
						"slate.12",
						"var(--text-primary)",
						"rgb(1 2 3)",
					),
				),
				(input, key, value) => {
					expect(
						Result.isFailure(decode({...input, colors: {...input.colors, [key]: value}})),
					).toBe(true);
				},
			),
			RUNS,
		);
	});
	it("refuses invalid format versions and unsafe names", () => {
		fc.assert(
			fc.property(
				complete,
				name,
				fc.integer().filter((n) => n !== 1),
				(input, word, format) => {
					expect(Result.isFailure(decode({...input, format}))).toBe(true);
					for (const invalid of [
						`../${word}`,
						`/invented/${word}`,
						`${word}.toml`,
						`${word}_name`,
						word.toUpperCase(),
					]) {
						expect(Result.isFailure(decode({...input, name: invalid}))).toBe(true);
					}
				},
			),
			RUNS,
		);
	});
});

describe("T2 source and repair records", () => {
	it("accepts no source or exactly one known source without inventing metadata", () => {
		fc.assert(
			fc.property(complete, origins, (input, from) => {
				expect(Result.getOrThrow(decode(input))).not.toHaveProperty("from");
				expect(Result.isSuccess(decode({...input, from}))).toBe(true);
				expect(Result.isFailure(decode({...input, from: {}}))).toBe(true);
				expect(Result.isFailure(decode({...input, from: {unknown: from}}))).toBe(true);
			}),
			RUNS,
		);
	});
	it("refuses any two source tables even when each alone is valid", () => {
		fc.assert(
			fc.property(complete, source, (input, metadata) => {
				const entries = [
					{base16: metadata},
					{base24: metadata},
					{ghostty: metadata},
					{radix: {version: "3.0.0", gray: "slate", accent: "indigo"}},
				];
				for (let i = 0; i < entries.length; i += 1)
					for (let j = i + 1; j < entries.length; j += 1) {
						expect(Result.isFailure(decode({...input, from: {...entries[i], ...entries[j]}}))).toBe(
							true,
						);
					}
			}),
			RUNS,
		);
	});
	it("checks repaired values at their destination, cursor separately", () => {
		fc.assert(
			fc.property(
				complete,
				hex,
				fc.constantFrom(
					"text-primary",
					"text-faint",
					"focus",
					"done",
					"running",
					"stuck",
					"closed",
					"turn-fg",
					"turn-text",
					"cursor",
				),
				(input, was, token) => {
					const now = token === "cursor" ? input.terminal.cursor : input.colors[token]!;
					const repaired = {[token]: {was, now, why: "under floor"}};
					expect(Result.isSuccess(decode({...input, repaired}))).toBe(true);
					const wrong = now === "#000000" ? "#ffffff" : "#000000";
					expect(
						Result.isFailure(
							decode({...input, repaired: {[token]: {...repaired[token], now: wrong}}}),
						),
					).toBe(true);
				},
			),
			RUNS,
		);
	});
	it("refuses repair rows for backgrounds, decorative edges and unknown names", () => {
		fc.assert(
			fc.property(
				complete,
				fc.constantFrom(
					"surface-sunken",
					"surface",
					"surface-raised",
					"surface-hover",
					"surface-selected",
					"border-faint",
					"border",
					"border-strong",
					"wire",
					"scrim",
					"turn-fill",
					"turn-fill-hover",
					"palette",
					"tile-edge",
					"other",
				),
				hex,
				(input, token, was) => {
					const colors: Readonly<Record<string, string>> = input.colors;
					expect(
						Result.isFailure(
							decode({
								...input,
								repaired: {
									[token]: {was, now: colors[token] ?? was, why: "not a repairable token"},
								},
							}),
						),
					).toBe(true);
				},
			),
			RUNS,
		);
	});
});

// T25 [secrets], decoder portion. Plant: serialize the source or an invalid field's value.
describe("T25 [secrets] decode refusals", () => {
	it("keeps generated source values and private paths out of every diagnostic form", () => {
		fc.assert(
			fc.property(
				complete,
				name,
				fc.array(fc.constantFrom("color", "extra", "source"), {minLength: 1, maxLength: 8}),
				(input, word, operations) => {
					const secret = `invented-private-${word}`;
					const path = `/invented-home/${secret}/source.toml`;
					for (const operation of operations) {
						const altered =
							operation === "color"
								? {...input, colors: {...input.colors, "text-primary": secret}}
								: operation === "extra"
									? {...input, [secret]: path}
									: {...input, from: {base16: {file: path, sha256: secret}}};
						const got = decode(altered);
						expect(Result.isFailure(got)).toBe(true);
						const output = JSON.stringify(got);
						for (const value of [secret, path, stringify(altered)]) {
							for (const form of [
								value,
								encodeURI(value),
								encodeURIComponent(value),
								encodeURIComponent(encodeURIComponent(value)),
							]) {
								expect(output).not.toContain(form);
							}
						}
					}
				},
			),
			RUNS,
		);
	});
});

// T23 is a type check, not a runtime shape test. Widening to string keys fails tsc.
// @ts-expect-error component names are not global theme colors.
const componentColor: import("./theme.ts").Theme["colors"]["tile-edge"] = "#ffffff";
void componentColor;
// An open index signature cannot prove all global values are present.
const requiredColors = (
	colors: import("./theme.ts").Theme["colors"],
): Record<(typeof globalNames)[number], string> => colors;
void requiredColors;
