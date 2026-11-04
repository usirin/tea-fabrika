import {applyCell} from "@demlik/tea";
import {Result} from "effect";
import * as fc from "fast-check";
import {describe, it} from "vitest";
import {type Desk, type DeskCmd, type DeskMsg, deskMachine, savedOf, takenNow} from "./desk.ts";
import {commandOn, decodeKeys, defaults, Does, type Keys} from "./keymap.ts";
import {keyOwner} from "./keys.ts";

// The keybindings file's laws (p12, p17, and the swap of p9), for any text and for any file
// written from the file's own words. Today's version, ticket 174, PR 1. The examples are in
// keymap.test.ts. Seed 119120, the shared one.
//
//   any text at all            rows, or a refusal with a line in the text; never a throw
//   any file that reads        one key does one thing in each place; the prefix is never a row's
//   any table, any desk        the swap disarms the prefix, asks for nothing, keeps what is kept

const OPTS = {seed: 119120, numRuns: 300};

const lineCount = (text: string) => text.split("\n").length;

/** Some words the file knows, and two it does not. */
const word = fc.constantFrom(...Does.literals, "tezgah.zom", "desk.split");
/** Keys as the file writes them: good ones, and a few the load refuses. */
const spelled = fc.constantFrom(
	"<prefix>z",
	"<prefix>m",
	"<prefix>x",
	"<prefix>|",
	"<prefix>left",
	"<prefix>space",
	"<prefix>ctrl+h",
	"<prefix>N",
	"<leader>z",
	"cmd+d",
	"cmd+k",
	"cmd+p",
	"cmd+w",
	"mod+e",
	"ctrl+a",
	"ctrl+b",
	"cmd+q",
	"alt+x",
	"z",
	"",
);
const quoted = (s: string) => JSON.stringify(s);
const value = fc.oneof(
	spelled.map(quoted),
	fc.array(spelled, {maxLength: 3}).map((keys) => `[${keys.map(quoted).join(", ")}]`),
);
const line = fc.oneof(
	{arbitrary: fc.tuple(word, value).map(([w, v]) => `${w} = ${v}`), weight: 6},
	{
		arbitrary: fc
			.constantFrom("ctrl+a", "ctrl+b", "ctrl+space", "a", "cmd+k")
			.map((p) => `prefix = ${quoted(p)}`),
		weight: 1,
	},
	{
		arbitrary: fc
			.array(fc.constantFrom("cmd+w", "cmd+e", "ctrl+w"), {maxLength: 2})
			.map((keys) => `ignore = [${keys.map(quoted).join(", ")}]`),
		weight: 1,
	},
	{arbitrary: fc.constantFrom("", "# a comment"), weight: 1},
);
/** A file of the file's own words: it often reads, and is often refused. */
const keysFile = fc.array(line, {maxLength: 8}).map((lines) => lines.join("\n"));
const mac = fc.boolean();

/** The tables that read, from `keysFile`. */
const table = fc
	.tuple(keysFile, mac)
	.map(([text, onMac]) => decodeKeys(text, onMac))
	.filter(Result.isSuccess)
	.map((answer) => answer.success);

const placeOf = (keys: Keys) => {
	const alone = new Map<string, string[]>();
	const after = new Map<string, string[]>();
	for (const row of keys.rows)
		for (const key of row.keys) {
			const place = key._tag === "alone" ? alone : after;
			place.set(key.key, [...(place.get(key.key) ?? []), row.does]);
		}
	return {alone, after};
};

describe("the file's laws", () => {
	it("answers any text with rows or a refusal on one of its lines, and never throws (p12)", () => {
		const text = fc.oneof(
			fc.string({unit: "grapheme", maxLength: 200}),
			fc.string({unit: "binary", maxLength: 200}),
			keysFile,
		);
		fc.assert(
			fc.property(text, mac, (t, onMac) => {
				const answer = decodeKeys(t, onMac);
				if (Result.isSuccess(answer)) return answer.success.rows.length === defaults.rows.length;
				const {line: at, why} = answer.failure;
				return Number.isInteger(at) && at >= 1 && at <= lineCount(t) && why.length > 0;
			}),
			OPTS,
		);
	});

	it("keeps one key on one command in each place, and the prefix on none, in any file that reads", () => {
		fc.assert(
			fc.property(table, (keys) => {
				const {alone, after} = placeOf(keys);
				return (
					// One command's list may name a key twice; two commands may never share one.
					[...alone.values(), ...after.values()].every((on) => new Set(on).size === 1) &&
					!alone.has(keys.prefix)
				);
			}),
			OPTS,
		);
	});

	it("keeps one row for every command the code lists, bound or not", () => {
		fc.assert(
			fc.property(table, (keys) => {
				const does = keys.rows.map((r) => r.does);
				return (
					new Set(does).size === does.length &&
					does.length === Does.literals.length &&
					does.every((d) => (Does.literals as readonly string[]).includes(d))
				);
			}),
			OPTS,
		);
	});

	it("looks a key up to the row that holds it", () => {
		fc.assert(
			fc.property(table, (keys) =>
				keys.rows.every((row) => row.keys.every((key) => commandOn(keys, key) === row.does)),
			),
			OPTS,
		);
	});

	it("leaves Cmd-Q to the system on a Mac, whatever the file (p17)", () => {
		const cmdQ = {key: "q", ctrl: false, alt: false, meta: true};
		fc.assert(
			fc.property(table, (keys) => keyOwner(cmdQ, true, keys) === "system"),
			OPTS,
		);
	});
});

/** Keys pressed into a fresh desk, a moment apart: it ends anywhere, armed or asking or not. */
const pressed = fc.array(
	fc.constantFrom("<c-b>", "<c-b>", "|", "-", "z", "x", "y", "n", "N", "f", "h", "<c-h>"),
	{maxLength: 30},
);

const deskAfter = (keys: readonly string[]): Desk => {
	let s: Desk = deskMachine.init(null, undefined)[0];
	for (const [at, key] of keys.entries())
		s = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, s, {type: "key", key, at})[0];
	return s;
};

describe("the desk's laws for a swapped table (p9)", () => {
	it("disarms the prefix, asks for nothing and keeps what is kept, on any desk, for any table", () => {
		fc.assert(
			fc.property(pressed, table, (keys, swapped) => {
				const s = deskAfter(keys);
				if (s.at !== "open") return true;
				const [next, cmds] = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, s, {
					type: "keys",
					keys: swapped,
				});
				return (
					next.at === "open" &&
					!next.prefix.armed &&
					cmds.length === 0 &&
					JSON.stringify(savedOf(next)) === JSON.stringify(savedOf(s))
				);
			}),
			OPTS,
		);
	});

	it("takes the new prefix, and every tezgah key pressed alone, once swapped in", () => {
		fc.assert(
			fc.property(pressed, table, (keys, swapped) => {
				const s = deskAfter(keys);
				if (s.at !== "open") return true;
				const [next] = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, s, {
					type: "keys",
					keys: swapped,
				});
				if (next.at !== "open" || next.ask !== null) return true;
				const takes = takenNow(next, 0);
				const alone = swapped.rows.flatMap((r) =>
					r.does.startsWith("tezgah.")
						? r.keys.flatMap((k) => (k._tag === "alone" ? [k.key] : []))
						: [],
				);
				const page = swapped.rows.flatMap((r) =>
					r.does === "palette.open"
						? r.keys.flatMap((k) => (k._tag === "alone" ? [k.key] : []))
						: [],
				);
				return (
					takes.keys.includes(swapped.prefix) &&
					alone.every((k) => takes.keys.includes(k)) &&
					page.every((k) => !takes.keys.includes(k))
				);
			}),
			OPTS,
		);
	});
});
