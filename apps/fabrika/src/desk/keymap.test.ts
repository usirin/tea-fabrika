import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {commandOn, decodeKeys, defaults, Does, type Key, type Keys} from "./keymap.ts";

// The keybindings file, read: ~/.fabrika/keybindings.toml, laid over the defaults that ship with
// the app (docs/direction/keybindings-are-configurable.md, K5, K6, K9). Today's version, ticket
// 174, PR 1. The laws over any text are in keymap.laws.test.ts.
//
//   decodeKeys('prefix = "ctrl+a"', true)              the defaults, with the prefix <c-a>
//   decodeKeys('tezgah.zoom = "<prefix>m"', true)      zoom on m after the prefix, and no longer on z
//   decodeKeys('tezgah.zom = "<prefix>m"', true)       refused: line 1, "tezgah.zom is not a command"

/** The file, one line per argument. */
const file = (...lines: readonly string[]): string => lines.join("\n");

/** What the file reads to, on a Mac unless said; a refusal fails the test with its line. */
const read = (text: string, mac = true): Keys => {
	const answer = decodeKeys(text, mac);
	if (Result.isFailure(answer))
		throw new Error(`refused at line ${answer.failure.line}: ${answer.failure.why}`);
	return answer.success;
};

/** Why the file is refused, and on which line; a file that reads fails the test. */
const refused = (text: string, mac = true) => {
	const answer = decodeKeys(text, mac);
	if (Result.isSuccess(answer)) throw new Error("the file read; it should have been refused");
	return answer.failure;
};

const after = (key: string): Key => ({_tag: "after_prefix", key});
const alone = (key: string): Key => ({_tag: "alone", key});
const rowOf = (keys: Keys, does: string) => keys.rows.find((r) => r.does === does);

/**
 * Today's table, frozen from desk/keys.ts `BINDINGS` before this change: each key after the
 * prefix, and the name the palette calls it by. Two keys with one name are one command.
 */
const TODAY: readonly (readonly [key: string, name: string])[] = [
	["|", "split"],
	["-", "split down"],
	["h", "focus left"],
	["j", "focus down"],
	["k", "focus up"],
	["l", "focus right"],
	["<arrowleft>", "focus left"],
	["<arrowdown>", "focus down"],
	["<arrowup>", "focus up"],
	["<arrowright>", "focus right"],
	[" ", "turn"],
	["f", "fold"],
	["z", "zoom"],
	["x", "close"],
	["N", "new"],
	["<c-h>", "previous workspace"],
	["<c-l>", "next workspace"],
	...Array.from({length: 9}, (_, i) => [String(i + 1), `workspace ${i + 1}`] as const),
	["a", "asks"],
	["J", "jobs"],
	["?", "keys"],
	["i", "info"],
	["B", "bars"],
	["A", "agents"],
	["S", "sync"],
	["H", "host"],
];

describe("the defaults, with no file (p1)", () => {
	it("keep today's prefix, Cmd-K for the palette and Cmd-W eaten", () => {
		expect(defaults.prefix).toBe("<c-b>");
		expect(commandOn(defaults, alone("<m-k>"))).toBe("palette.open");
		expect(defaults.ignore).toEqual(["<m-w>"]);
		expect(defaults.file).toEqual({_tag: "none"});
	});

	it("bind every key today's table binds, after the prefix, one command per name", () => {
		const words = new Map<string, string>();
		for (const [key, name] of TODAY) {
			const does = commandOn(defaults, after(key));
			expect(does, `C-b ${key}`).toBeDefined();
			// h and the left arrow are one command, as they are one name today.
			const seen = words.get(name);
			if (seen !== undefined) expect(does, `C-b ${key}`).toBe(seen);
			else if (does !== undefined) words.set(name, does);
		}
		expect(new Set(words.values()).size).toBe(new Set(TODAY.map(([, name]) => name)).size);
	});

	it("write the commands the plan names by their file words", () => {
		expect(commandOn(defaults, after("|"))).toBe("tezgah.split");
		expect(commandOn(defaults, after("-"))).toBe('tezgah."split --to down"');
		expect(commandOn(defaults, after("z"))).toBe("tezgah.zoom");
		expect(commandOn(defaults, after("x"))).toBe("tezgah.close");
		expect(commandOn(defaults, after("f"))).toBe("tezgah.fold");
		expect(commandOn(defaults, after("?"))).toBe("keys.open");
	});

	it("hold one row per command, every command the code lists, each from the defaults", () => {
		const does = defaults.rows.map((r) => r.does);
		expect(new Set(does).size).toBe(does.length);
		expect([...does].sort()).toEqual([...Does.literals].sort());
		expect(defaults.rows.every((r) => r.source === "default")).toBe(true);
	});

	it("read the same from an empty file, and from one with only comments", () => {
		expect(read("").rows).toEqual(defaults.rows);
		expect(read(file("# only what you changed", "")).rows).toEqual(defaults.rows);
		expect(read("").file).toEqual({_tag: "read"});
	});
});

describe("the spelling, decoded at the edge", () => {
	it.each([
		["the prefix, ctrl+a", 'prefix = "ctrl+a"', (k: Keys) => k.prefix, "<c-a>"],
		[
			"a key pressed alone, cmd+p",
			'palette.open = "cmd+p"',
			(k: Keys) => rowOf(k, "palette.open")?.keys,
			[alone("<m-p>")],
		],
		[
			"<prefix>|",
			'tezgah.split = "<prefix>|"',
			(k: Keys) => rowOf(k, "tezgah.split")?.keys,
			[after("|")],
		],
		[
			"<prefix>N, the character typed",
			'tezgah.zoom = "<prefix>N"',
			(k: Keys) => rowOf(k, "tezgah.zoom")?.keys,
			[after("N")],
		],
		[
			"<prefix>left",
			'tezgah.zoom = "<prefix>left"',
			(k: Keys) => rowOf(k, "tezgah.zoom")?.keys,
			[after("<arrowleft>")],
		],
		[
			"<prefix>space",
			'tezgah.zoom = "<prefix>space"',
			(k: Keys) => rowOf(k, "tezgah.zoom")?.keys,
			[after(" ")],
		],
		[
			"<prefix>ctrl+h",
			'tezgah.zoom = "<prefix>ctrl+h"',
			(k: Keys) => rowOf(k, "tezgah.zoom")?.keys,
			[after("<c-h>")],
		],
		[
			"two modifiers, in keyName's order whatever the file's",
			'palette.open = "cmd+ctrl+p"',
			(k: Keys) => rowOf(k, "palette.open")?.keys,
			[alone("<c-m-p>")],
		],
		[
			"a list of keys",
			'tezgah.zoom = ["<prefix>z", "<prefix>m"]',
			(k: Keys) => rowOf(k, "tezgah.zoom")?.keys,
			[after("z"), after("m")],
		],
		[
			"a word with spaces, quoted after the dot",
			'tezgah."split --to down" = "<prefix>_"',
			(k: Keys) => rowOf(k, 'tezgah."split --to down"')?.keys,
			[after("_")],
		],
		["ignore, as cmd+w", 'ignore = ["cmd+w"]', (k: Keys) => k.ignore, ["<m-w>"]],
		["ignore, emptied", "ignore = []", (k: Keys) => k.ignore, []],
	] as const)("reads %s", (_, text, pick, want) => {
		expect(pick(read(text))).toEqual(want);
	});

	it("reads mod+ as Cmd on a Mac and Ctrl elsewhere", () => {
		expect(rowOf(read('palette.open = "mod+p"', true), "palette.open")?.keys).toEqual([
			alone("<m-p>"),
		]);
		expect(rowOf(read('palette.open = "mod+p"', false), "palette.open")?.keys).toEqual([
			alone("<c-p>"),
		]);
	});
});

describe("your rows, laid over the defaults (p3, p4)", () => {
	it("moves a command to your key, and its default key goes with it", () => {
		const keys = read('tezgah.zoom = "<prefix>m"');
		expect(commandOn(keys, after("m"))).toBe("tezgah.zoom");
		expect(commandOn(keys, after("z"))).toBeUndefined();
		expect(rowOf(keys, "tezgah.zoom")).toEqual({
			does: "tezgah.zoom",
			keys: [after("m")],
			source: "yours",
		});
		// Every other row is the default's still.
		expect(keys.rows.filter((r) => r.does !== "tezgah.zoom")).toEqual(
			defaults.rows.filter((r) => r.does !== "tezgah.zoom"),
		);
	});

	it("gives a default's key to your command, and the default loses that key", () => {
		const keys = read('tezgah.zoom = "<prefix>x"');
		expect(commandOn(keys, after("x"))).toBe("tezgah.zoom");
		expect(rowOf(keys, "tezgah.close")?.keys).toEqual([]);
		// Pressed alone too: your split on Cmd-K takes it from the palette.
		const taken = read('tezgah.split = "cmd+k"');
		expect(commandOn(taken, alone("<m-k>"))).toBe("tezgah.split");
		expect(rowOf(taken, "palette.open")?.keys).toEqual([]);
	});

	it("keeps an unbound command as a row with no keys, so the palette still lists it", () => {
		const keys = read("tezgah.zoom = []");
		expect(rowOf(keys, "tezgah.zoom")).toEqual({does: "tezgah.zoom", keys: [], source: "yours"});
		expect(commandOn(keys, after("z"))).toBeUndefined();
		expect(keys.rows).toHaveLength(defaults.rows.length);
	});

	it("moves every <prefix> row with the prefix, since a row holds only the key after it", () => {
		const keys = read('prefix = "ctrl+a"');
		expect(keys.prefix).toBe("<c-a>");
		expect(keys.rows).toEqual(defaults.rows);
	});

	it("binds a desk command alone, with no prefix", () => {
		const keys = read('tezgah.split = "cmd+d"');
		expect(commandOn(keys, alone("<m-d>"))).toBe("tezgah.split");
		expect(commandOn(keys, after("|"))).toBeUndefined();
	});
});

describe("a file that is refused, with its line (p7)", () => {
	it.each([
		["not TOML", file('prefix = "ctrl+a"', "tezgah.zoom = "), 2],
		[
			"a [tezgah] table beside tezgah. rows, TOML's own error",
			file('tezgah.zoom = "<prefix>m"', "", "[tezgah]", 'split = "<prefix>s"'),
			3,
		],
		["a bare letter as the prefix", 'prefix = "a"', 1],
		["a prefix with no key", "prefix = []", 1],
		["an empty prefix", 'prefix = ""', 1],
		["a bare printable key pressed alone", file("# mine", 'tezgah.zoom = "z"'), 2],
		["a bare | pressed alone", 'tezgah.split = "|"', 1],
		["Cmd-Q, the system's", 'tezgah.zoom = "cmd+q"', 1],
		["Cmd-Q written mod+q on a Mac", 'tezgah.zoom = "mod+q"', 1],
		["Cmd-H, the system's", 'tezgah.zoom = "cmd+h"', 1],
		["Cmd-Tab, the system's", 'tezgah.zoom = "cmd+tab"', 1],
		["Cmd-Space, the system's", 'tezgah.zoom = "cmd+space"', 1],
		["a key that is no key", 'tezgah.zoom = "hyper+z"', 1],
		["a number for a key", "tezgah.zoom = 3", 1],
		["a key that is not a string", "tezgah.zoom = [true]", 1],
	] as const)("refuses %s", (_, text, line) => {
		const no = refused(text);
		expect(no.line).toBe(line);
		expect(no.why.length).toBeGreaterThan(0);
	});

	it.each([
		[
			"an unknown command",
			file('prefix = "ctrl+a"', 'tezgah.zom = "<prefix>m"'),
			2,
			"tezgah.zom is not a command",
		],
		["the notes' older program name", 'desk.split = "<prefix>|"', 1, "desk.split is not a command"],
		[
			"an unknown quoted word, after comments and a blank line",
			file(
				"# my keys",
				"",
				'prefix = "ctrl+a"',
				'tezgah."split --to down" = "<prefix>-"',
				'tezgah."split --to dwon" = "<prefix>s"',
			),
			5,
			'tezgah."split --to dwon" is not a command',
		],
		[
			"an unknown <word>",
			'tezgah.zoom = "<leader>z"',
			1,
			"<leader> is not a word here; did you mean <prefix>?",
		],
		[
			"one key on two commands after the prefix",
			file('tezgah.close = "<prefix>x"', 'tezgah.zoom = "<prefix>x"'),
			2,
			"<prefix>x is on both tezgah.close and tezgah.zoom",
		],
		[
			"one key on two commands pressed alone",
			file('tezgah.split = "cmd+d"', 'palette.open = "cmd+d"'),
			2,
			"cmd+d is on both tezgah.split and palette.open",
		],
		[
			"the prefix also bound alone",
			file('prefix = "ctrl+a"', 'tezgah.split = "ctrl+a"'),
			2,
			"ctrl+a is your prefix, so it cannot also run tezgah.split",
		],
	] as const)("refuses %s in plain words", (_, text, line, why) => {
		expect(refused(text)).toEqual({line, why});
	});

	it("refuses the plan's own example, since today's version has no tezgah.detach", () => {
		// The plan's file writes `tezgah.detach = []`; no such command is in today's table.
		expect(refused(file('prefix = "ctrl+a"', "tezgah.detach = []"))).toEqual({
			line: 2,
			why: "tezgah.detach is not a command",
		});
	});
});
