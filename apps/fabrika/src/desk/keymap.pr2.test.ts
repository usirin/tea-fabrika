import {readFileSync} from "node:fs";
import {Result} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	beta,
	browser,
	installed,
	packs,
	program,
} from "../../../../fixtures/keybindings/programs.ts";
import {decodeKeys, patchKeys} from "./keymap.ts";

// Today's version, T174 PR 2. The third argument supplies the live catalog and client.
// Missing support for that argument is product work; these tests never substitute a decoder.
const read = (text = "", programs: readonly unknown[] = packs, client: unknown = installed) =>
	decodeKeys(text, false, {programs, client});
const good = (text = "", programs: readonly unknown[] = packs, client: unknown = installed) => {
	const result = read(text, programs, client);
	expect(Result.isSuccess(result), Result.isFailure(result) ? result.failure.why : text).toBe(true);
	if (Result.isFailure(result)) throw new Error(result.failure.why);
	return result.success;
};
const row = (
	keys: ReturnType<typeof good>,
	program: string,
	word: string,
	mode: string | null = null,
) =>
	keys.rows.find(
		(r) => r.target?.program === program && r.target.word === word && r.target.mode === mode,
	);
const no = (text: string, line: number, why: RegExp) => {
	const result = read(text);
	expect(Result.isFailure(result), text).toBe(true);
	if (Result.isFailure(result)) {
		expect(result.failure.line).toBe(line);
		expect(result.failure.why).toMatch(why);
	}
};

describe("today's program and mode table", () => {
	it("P4: any focused character can belong to both independent programs", () => {
		fc.assert(
			fc.property(fc.constantFrom("j", "k", "İ", "Ж", "🦊"), (key) => {
				const keys = good(
					`alpha.next = ${JSON.stringify(key)}\nbeta.next = ${JSON.stringify(key)}`,
				);
				expect(row(keys, "alpha", "next")?.keys).toEqual([{_tag: "alone", key}]);
				expect(row(keys, "beta", "next")?.keys).toEqual([{_tag: "alone", key}]);
			}),
			{seed: 119120, numRuns: 50},
		);
	});
	it("P6: entries stay flat; mode sections survive decoding and a second patch", () => {
		const original = readFileSync(
			new URL("../../../../fixtures/keybindings/modes.toml", import.meta.url),
			"utf8",
		);
		const keys = good(original);
		expect(row(keys, "tezgah", "info")?.keys).toEqual([{_tag: "after_prefix", key: "i"}]);
		expect(row(keys, "alpha", "exit", "select")?.keys).toHaveLength(2);
		const saved = patchKeys(
			original,
			new Map([["mode.alpha.search.keys.exit", ["escape", "ctrl+g"]]]),
		);
		expect(row(good(saved), "alpha", "exit", "search")?.keys).toHaveLength(2);
		no('[mode.alpha.select]\nenter = "<prefix>["', 2, /enter|flat|alpha.select/i);
		no('alpha.exit = "escape"', 1, /mode\.alpha\.(select|search)\.keys/);
	});
	it("P10: neither pack takes an app key, the prefix, or either F6 direction", () => {
		const thief = program("thief", {
			split: {send: {type: "act", value: "split"}, keys: "<prefix>|", global: true},
			arm: {send: {type: "act", value: "arm"}, keys: "ctrl+b", global: true},
			focus: {send: {type: "act", value: "focus"}, keys: ["f6", "shift+f6"], global: true},
		});
		const keys = good("", [...packs, {program: thief, origin: {pack: "thief-pack"}}]);
		for (const word of ["split", "arm", "focus"]) {
			expect(row(keys, "thief", word)).toMatchObject({keys: [], origin: {pack: "thief-pack"}});
			expect(row(keys, "thief", word)?.disabled).toMatch(/app|prefix|F6|reserved/i);
		}
		expect(row(keys, "tezgah", "split")?.keys).toContainEqual({_tag: "after_prefix", key: "|"});
	});
	it("P11: both pack globals lose their key, in either load order, and name both owners", () => {
		for (const programs of [packs, [...packs].reverse()]) {
			const keys = good("", programs);
			for (const owner of ["alpha", "beta"]) {
				const command = row(keys, owner, "shared");
				expect(command?.keys).toEqual([]);
				expect(command?.disabled).toMatch(/alpha.shared/);
				expect(command?.disabled).toMatch(/beta.shared/);
			}
		}
	});
	it("P12: a user wins defaults; a second user claim refuses at its actual line", () => {
		const keys = good('alpha.previous = "j"');
		expect(row(keys, "alpha", "previous")).toMatchObject({
			source: "yours",
			keys: [{_tag: "alone", key: "j"}],
		});
		expect(row(keys, "alpha", "next")?.keys).toEqual([]);
		expect(row(keys, "beta", "next")?.keys).toHaveLength(1);
		no(
			'# mine\nalpha.next = "j"\n\n# second\nalpha.previous = "j"',
			5,
			/alpha.next.*alpha.previous|alpha.previous.*alpha.next/,
		);
		no('[mode.alpha.search.keys]\nexit = "n"\nfind = "n"', 3, /exit.*find|find.*exit/);
		no('alpha.typo = "j"', 1, /not a command|unknown/i);
	});
	it("P13: unloading drops executable mode rows, diagnoses saved rows, and keeps the other program", () => {
		const text = 'alpha.next = "u"\nbeta.next = "j"';
		expect(row(good(text), "alpha", "next")?.keys).toHaveLength(1);
		const keys = good(text, [{program: beta, origin: {pack: "pack-b"}}]);
		expect(keys.rows.some((r) => r.target.program === "alpha")).toBe(false);
		expect(row(keys, "beta", "next")?.keys).toHaveLength(1);
		expect(keys.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({line: 1, why: expect.stringMatching(/alpha|absent|unloaded/i)}),
			]),
		);
	});
	it("P20: no accepted table counts an undeliverable key as a mode exit", () => {
		fc.assert(
			fc.property(fc.constantFrom("ctrl+w", "escape"), (exit) => {
				const result = read(
					`[mode.alpha.select.keys]\nexit = ${JSON.stringify(exit)}`,
					packs,
					browser,
				);
				expect(Result.isFailure(result)).toBe(exit === "ctrl+w");
				if (exit === "ctrl+w" && Result.isFailure(result))
					expect(result.failure.why).toMatch(/exit|way out/i);
			}),
			{seed: 119120, numRuns: 30},
		);
		no("[mode.alpha.search.keys]\nexit = []", 2, /exit|way out/i);
	});
	it("P26: browser restrictions keep the user's file row and explain the disabled key", () => {
		const text = 'alpha.previous = "ctrl+w"';
		const tab = row(good(text, packs, browser), "alpha", "previous");
		const app = row(good(text, packs, installed), "alpha", "previous");
		expect(tab).toMatchObject({
			source: "yours",
			keys: [{_tag: "alone", key: "<c-w>"}],
			disabled: expect.stringMatching(/browser|tab/i),
		});
		expect(app).toMatchObject({source: "yours", keys: [{_tag: "alone", key: "<c-w>"}]});
		expect(app?.disabled ?? null).toBeNull();
	});
});
