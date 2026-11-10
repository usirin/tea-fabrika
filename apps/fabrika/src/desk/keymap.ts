import {Result, Schema} from "effect";
import {parse, TomlError} from "smol-toml";
import {type Does as Action, BINDINGS, type Binding, keyName, THE_MACS, wordOf} from "./keys.ts";

// The keys file: ~/.fabrika/keybindings.toml, read and laid over the defaults that ship with the
// app (docs/direction/keybindings-are-configurable.md, decided; ticket 174, PR 1). The file holds
// only what the person changed. The host reads it (host/settings.ts) and gives the table to the
// desk and to every page; a page never reads a file.
//
//   prefix                   = "ctrl+a"                     a setting, never a row (K5)
//   tezgah.zoom              = ["<prefix>z", "<prefix>m"]   <program>.<word> = a key, or a list (K6, K9)
//   tezgah.split             = "cmd+d"                      pressed alone, no prefix
//   tezgah."split --to down" = "<prefix>-"                  a word with spaces, quoted after the dot
//   tezgah.fold              = []                           unbound: still in the palette and tsh
//   palette.open             = "cmd+k"
//   ignore                   = ["cmd+w"]                    eaten: the system never hears it
//
//   decodeKeys('prefix = "ctrl+a"', true)            the defaults, armed by <c-a>
//   decodeKeys('tezgah.zoom = "<prefix>m"', true)    zoom on m after the prefix, and no longer on z
//   decodeKeys('tezgah.zom = "<prefix>m"', true)     refused: {line: 1, why: "tezgah.zom is not a command"}
//
// A key is spelled as VS Code, Zed and Ghostty write it (`ctrl+a`, `cmd+k`, `mod+k`), and decoded
// here to the name `keyName` gives a press (`<c-a>`, `<m-k>`), so the wire, the desk and the page
// keep one spelling. `mod` is Cmd on a Mac and Ctrl elsewhere.
//
//   file              key
//   "ctrl+a"          alone "<c-a>"
//   "<prefix>|"       after_prefix "|"
//   "<prefix>N"       after_prefix "N", the character typed
//   "<prefix>left"    after_prefix "<arrowleft>"
//   "<prefix>space"   after_prefix " "
//   "<prefix>ctrl+h"  after_prefix "<c-h>"
//
// Your row wins: a default that had your key loses it, and keeps its others. A file that does not
// read is refused whole, with the line to look at and the reason in plain words: the host keeps
// the last table that read.

/** A key's name, as `keyName` spells it (desk/keys.ts): short, always. */
export const KeyName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

/** A key, pressed alone or after the prefix. */
export const Key = Schema.TaggedUnion({
	alone: {key: KeyName},
	after_prefix: {key: KeyName},
});
export type Key = typeof Key.Type;

/** Every command the app has, by its word in the file: the list in code, never a free string. */
export const Does = Schema.Literals([
	"tezgah.split",
	'tezgah."split --to down"',
	'tezgah."focus --to left"',
	'tezgah."focus --to down"',
	'tezgah."focus --to up"',
	'tezgah."focus --to right"',
	'tezgah."focus --to next"',
	'tezgah."focus --to previous"',
	"tezgah.turn",
	"tezgah.fold",
	"tezgah.zoom",
	"tezgah.close",
	'tezgah."workspace --to new"',
	'tezgah."workspace --to previous"',
	'tezgah."workspace --to next"',
	'tezgah."workspace --to 1"',
	'tezgah."workspace --to 2"',
	'tezgah."workspace --to 3"',
	'tezgah."workspace --to 4"',
	'tezgah."workspace --to 5"',
	'tezgah."workspace --to 6"',
	'tezgah."workspace --to 7"',
	'tezgah."workspace --to 8"',
	'tezgah."workspace --to 9"',
	"tezgah.asks",
	"tezgah.jobs",
	"keys.open",
	"tezgah.info",
	"tezgah.bars",
	"tezgah.agents",
	"tezgah.sync",
	"tezgah.host",
	"palette.open",
]);
export type Does = typeof Does.Type;

/** One command and its keys. `source` is where its keys come from, as VS Code's Source column (K3). */
const Row = Schema.Struct({
	does: Does,
	/** `[]` is unbound: no key runs it, and the palette and its tsh word still do. */
	keys: Schema.Array(Key),
	source: Schema.Literals(["default", "yours"]),
});
type Row = typeof Row.Type;

/** What came of the file: none (the defaults), read, or refused, with its line and why. */
export const File = Schema.TaggedUnion({
	none: {},
	read: {},
	refused: {line: Schema.Int, why: Schema.String},
});
export type File = typeof File.Type;

/** The whole table: the prefix, one row per command, the keys eaten, and what came of the file. */
export const Keys = Schema.Struct({
	/** A setting, never a row (K5): every `<prefix>` row moves with it. */
	prefix: KeyName,
	rows: Schema.Array(Row),
	/** Command keys nobody hears, as today's Cmd-W: on a Mac they never reach the menu. */
	ignore: Schema.Array(KeyName),
	file: File,
});
export type Keys = typeof Keys.Type;

/** Why a file is refused, and the line to look at, from 1. */
interface Refused {
	readonly line: number;
	readonly why: string;
}

const after = (key: string): Key => Key.cases.after_prefix.make({key});
const alone = (key: string): Key => Key.cases.alone.make({key});

/** The default binding a command runs, or none: `palette.open` is the page's, and acts on no desk. */
export const bindingFor = (does: Does): Binding | undefined =>
	BINDINGS.find((b) => b.command === does);

/**
 * The command a desk action is, by its tsh word: `{kind: "zoom"}` is `tezgah.zoom`. None for an
 * action no command names, such as `focus --to t7`, typed in tsh.
 */
export const commandFor = (does: Action): Does | undefined =>
	BINDINGS.find((b) => wordOf(b.does) === wordOf(does))?.command;

/** The palette opens on Cmd-K, as in Linear and VS Code. */
const PALETTE_KEY = "<m-k>";

/** The table with no file: today's keys, Cmd-K for the palette, Cmd-W eaten. */
export const defaults: Keys = {
	prefix: "<c-b>",
	rows: Does.literals.map((does) =>
		Row.make({
			does,
			keys:
				does === "palette.open"
					? [alone(PALETTE_KEY)]
					: BINDINGS.filter((b) => b.command === does).map((b) =>
							b.does.kind === "cycle" ? alone(b.key) : after(b.key),
						),
			source: "default",
		}),
	),
	ignore: ["<m-w>"],
	file: File.cases.none.make({}),
};

/** The command a key runs in this table, or none. */
export const commandOn = (keys: Keys, key: Key): Does | undefined =>
	keys.rows.find((row) => row.keys.some((k) => k._tag === key._tag && k.key === key.key))?.does;

// ---------------------------------------------------------------- one key, as the file spells it

/** A modifier's word, and its letter in `keyName`'s spelling; `mod` is Cmd on a Mac. */
const MODIFIERS: Readonly<Record<string, "c" | "a" | "m" | "mod" | "shift">> = {
	ctrl: "c",
	control: "c",
	alt: "a",
	opt: "a",
	option: "a",
	cmd: "m",
	command: "m",
	mod: "mod",
	shift: "shift",
};

/** A named key's word, and `keyName`'s name for it (`KeyboardEvent.key`, lowercased). */
const NAMED: Readonly<Record<string, string>> = {
	left: "arrowleft",
	right: "arrowright",
	up: "arrowup",
	down: "arrowdown",
	enter: "enter",
	return: "enter",
	escape: "escape",
	esc: "escape",
	tab: "tab",
	backspace: "backspace",
	delete: "delete",
	home: "home",
	end: "end",
	pageup: "pageup",
	pagedown: "pagedown",
	...Object.fromEntries(Array.from({length: 24}, (_, i) => [`f${i + 1}`, `f${i + 1}`])),
};

/** A key, read: its name, and whether it is one plain character (which types in a tile). */
interface Pressed {
	readonly name: string;
	readonly printable: boolean;
}

/** One key with no `<prefix>`, as `keyName` would name the press: `ctrl+a` is `<c-a>`. */
const readPress = (spelled: string, mac: boolean): Result.Result<Pressed, string> => {
	if (spelled === "") {
		return Result.fail("an empty key: write one, such as ctrl+a");
	}

	// `+` is a key too: `+`, or `ctrl++`.
	const parts =
		spelled === "+"
			? ["+"]
			: spelled.endsWith("++")
				? [...spelled.slice(0, -2).split("+"), "+"]
				: spelled.split("+");
	const base = parts.at(-1) ?? "";
	const mods = new Set<string>();
	let shift = false;

	for (const word of parts.slice(0, -1)) {
		const mod = MODIFIERS[word.toLowerCase()];

		if (mod === undefined) {
			return Result.fail(`${word} is not a modifier here: write ctrl, alt, cmd, mod or shift`);
		}

		if (mod === "shift") {
			shift = true;
		} else {
			mods.add(mod === "mod" ? (mac ? "m" : "c") : mod);
		}
	}

	const char = base === "space" ? " " : [...base].length === 1 ? base : null;
	const named = char === null ? NAMED[base.toLowerCase()] : undefined;

	if (char === null && named === undefined) {
		return Result.fail(`${base} is not a key`);
	}

	const key =
		shift && char !== null && /^[a-z]$/.test(char) ? char.toUpperCase() : (char ?? named ?? "");
	const name = keyName({key, ctrl: mods.has("c"), alt: mods.has("a"), meta: mods.has("m"), shift});
	return name === null
		? Result.fail(`${spelled} is not a key`)
		: Result.succeed({name, printable: char !== null && mods.size === 0});
};

/**
 * The named keys that type or move in a tile, with no modifier: Enter, Escape, Backspace, Tab and
 * the arrows. Never pressed alone, never the prefix (WCAG 2.1.4), as a bare letter is not; after
 * the prefix each is fine. The F keys are not here: an F key alone is the way out of a tile.
 */
const BARE: ReadonlySet<string> = new Set([
	"<enter>",
	"<escape>",
	"<backspace>",
	"<tab>",
	"<arrowleft>",
	"<arrowright>",
	"<arrowup>",
	"<arrowdown>",
]);

/** A key that is never ours to bind: the Mac's own, or Ctrl-C, which a tile's program owns. */
const notOurs = (name: string, spelled: string): string | null => {
	if (THE_MACS.has(name)) {
		return `${spelled} is the system's, so the app never hears it`;
	}

	if (name === "<c-c>") {
		return `${spelled} is the program's in a tile, so it cannot be bound`;
	}

	return null;
};

/** One key of a row: after the prefix (`<prefix>z`), or pressed alone (`cmd+d`). */
const readKey = (spelled: string, mac: boolean): Result.Result<Key, string> => {
	const word = /^<([^<>]*)>(.*)$/.exec(spelled);

	if (word !== null) {
		const [, name = "", rest = ""] = word;

		if (name !== "prefix") {
			return Result.fail(`<${name}> is not a word here; did you mean <prefix>?`);
		}

		if (rest === "") {
			return Result.fail(`${spelled} names no key after the prefix, such as <prefix>z`);
		}

		return Result.flatMap(readPress(rest, mac), (p) => {
			const no = notOurs(p.name, rest);

			if (no !== null) {
				return Result.fail(no);
			}

			// On a Mac the menu takes a Cmd key before the app sees it, prefix or not (keyOwner).
			if (mac && /^<(?:[ca]-)*m-/.test(p.name)) {
				return Result.fail(
					`${rest} after the prefix goes to the Mac's menu first, so it never reaches the app`,
				);
			}

			return Result.succeed(after(p.name));
		});
	}

	return Result.flatMap(readPress(spelled, mac), (p) => {
		const no = notOurs(p.name, spelled);

		if (no !== null) {
			return Result.fail(no);
		}

		if (BARE.has(p.name)) {
			return Result.fail(
				`${spelled} pressed alone would stop it typing or moving in a tile: write <prefix>${spelled}, or add ctrl, alt or cmd`,
			);
		}

		// A bare character pressed alone would stop typing in tsh (WCAG 2.1.4).
		if (p.printable) {
			return Result.fail(
				`${spelled} pressed alone would stop typing in a tile: write <prefix>${spelled === " " ? "space" : spelled}, or add ctrl or cmd`,
			);
		}

		return Result.succeed(alone(p.name));
	});
};

/** The keys a row's value names: one key, or a list. */
const spellings = (path: string, value: unknown): Result.Result<readonly string[], string> => {
	if (typeof value === "string") {
		return Result.succeed([value]);
	}

	if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
		return Result.succeed(value);
	}

	return Result.fail(`${path} takes a key or a list of keys, such as "<prefix>z"`);
};

// ---------------------------------------------------------------- the file, as TOML

/** A dotted key's part, as TOML writes it: bare when it can be, quoted when not. */
const partWord = (part: string): string =>
	/^[A-Za-z0-9_-]+$/.test(part) ? part : JSON.stringify(part);

/** A plain table, as the parser gives one: not an array, a date or a value. */
const isTable = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Every value in a parsed table, by its dotted path: `tezgah.zoom`, `tezgah."split --to down"`. */
const leaves = (table: Readonly<Record<string, unknown>>, above: readonly string[] = []) => {
	const out: {path: readonly string[]; value: unknown}[] = [];

	for (const [part, value] of Object.entries(table)) {
		const path = [...above, part];

		if (isTable(value) && Object.keys(value).length > 0) {
			out.push(...leaves(value, path));
		} else {
			out.push({path, value});
		}
	}

	return out;
};

const pathWord = (path: readonly string[]): string => path.map(partWord).join(".");

interface Assignment {
	readonly word: string;
	readonly path: readonly string[];
	readonly start: number;
	readonly end: number;
	readonly value: number;
	readonly until: number;
}

/** A table's section: its path, and where a new row under it goes. Root is the empty path. */
interface Section {
	readonly path: readonly string[];
	after: number;
}

/** Source positions, read with TOML's strings, comments and nested values intact. */
const assignments = (text: string): {rows: Assignment[]; sections: Section[]} => {
	const rows: Assignment[] = [];
	let table: readonly string[] = [];
	const sections: Section[] = [{path: [], after: 0}];
	let section = sections[0] as Section;
	let header = text.length;
	let at = 0;

	while (at < text.length) {
		const start = at;
		const newline = text.indexOf("\n", at);
		const end = newline < 0 ? text.length : newline + 1;
		const line = text.slice(start, end).trim();

		if (line === "" || line.startsWith("#")) {
			at = end;
			continue;
		}

		if (line.startsWith("[")) {
			header = Math.min(header, start);
			const read = readToml(line);
			let named = false;

			if (Result.isSuccess(read)) {
				let nested = read.success;
				const parts: string[] = [];

				while (Object.keys(nested).length === 1) {
					const part = Object.keys(nested)[0];

					if (part === undefined || !isTable(nested[part])) {
						break;
					}

					parts.push(part);
					nested = nested[part];
				}

				table = parts;
				named = parts.length > 0 && !line.startsWith("[[");
			}

			// An array of tables or an unread header takes no new rows.
			section = {path: named ? table : [], after: end};

			if (named) {
				sections.push(section);
			}

			at = end;
			continue;
		}

		let quote = "";
		let equal = start;

		for (; equal < end; equal += 1) {
			const c = text[equal];

			if (quote === '"' && c === "\\") {
				equal += 1;
				continue;
			}

			if (quote !== "") {
				if (c === quote) {
					quote = "";
				}

				continue;
			}

			if (c === '"' || c === "'") {
				quote = c;
				continue;
			}

			if (c === "=") {
				break;
			}
		}

		if (equal === end) {
			at = end;
			continue;
		}

		const key = readToml(`${text.slice(start, equal)} = 0`);

		if (Result.isFailure(key)) {
			at = end;
			continue;
		}

		const path = leaves(key.success)[0]?.path ?? [];
		let value = equal + 1;

		while (text[value] === " " || text[value] === "\t") {
			value += 1;
		}

		let cursor = value;
		let depth = 0;
		quote = "";
		let triple = false;

		for (; cursor < text.length; cursor += 1) {
			const c = text[cursor] ?? "";

			if (quote !== "") {
				if (quote === '"' && c === "\\") {
					cursor += 1;
					continue;
				}

				if (triple ? text.slice(cursor, cursor + 3) === quote.repeat(3) : c === quote) {
					if (triple) {
						cursor += 2;
					}

					quote = "";
					triple = false;
				}

				continue;
			}

			if (c === '"' || c === "'") {
				quote = c;
				triple = text.slice(cursor, cursor + 3) === c.repeat(3);

				if (triple) {
					cursor += 2;
				}

				continue;
			}

			if (c === "#") {
				if (depth === 0) {
					break;
				}

				const next = text.indexOf("\n", cursor);
				cursor = next < 0 ? text.length : next;
				continue;
			}

			if (c === "[" || c === "{") {
				depth += 1;
			}

			if (c === "]" || c === "}") {
				depth -= 1;
			}

			if ((c === "\n" || c === "\r") && depth === 0) {
				break;
			}
		}

		let until = cursor;

		while (until > value && /\s/.test(text[until - 1] ?? "")) {
			until -= 1;
		}

		const last = text.indexOf("\n", cursor);
		at = last < 0 ? text.length : last + 1;
		rows.push({
			word: pathWord([...table, ...path]),
			path: [...table, ...path],
			start,
			end: at,
			value,
			until,
		});
		section.after = at;
	}

	(sections[0] as Section).after = header;
	return {rows, sections};
};

const startsWith = (path: readonly string[], head: readonly string[]): boolean =>
	head.length < path.length && head.every((part, i) => path[i] === part);

/** A dotted word's parts: `tezgah."split --to down"` is `tezgah` then `split --to down`. */
const wordPath = (word: string): readonly string[] => {
	const read = readToml(`${word} = 0`);
	return Result.isSuccess(read) ? (leaves(read.success)[0]?.path ?? [word]) : [word];
};

type Assigned = string | readonly string[];

/** A TOML value as one line: strings and lists as JSON spells them, tables inline. */
const inline = (value: unknown): string =>
	isTable(value)
		? `{ ${Object.entries(value)
				.map(([part, one]) => `${partWord(part)} = ${inline(one)}`)
				.join(", ")} }`
		: JSON.stringify(value);

/** The table with `path` set to `value`, or without it when `value` is null. */
const setIn = (
	table: Readonly<Record<string, unknown>>,
	path: readonly string[],
	value: Assigned | null,
): Readonly<Record<string, unknown>> => {
	const [part, ...rest] = path;

	if (part === undefined) {
		return table;
	}

	const {[part]: here, ...others} = table;

	if (rest.length === 0) {
		return value === null ? others : {...table, [part]: value};
	}

	return {...table, [part]: setIn(isTable(here) ? here : {}, rest, value)};
};

/**
 * Change only the requested assignments. A new row goes into the deepest table header that holds
 * it, as a short key, or into an inline table that holds it; otherwise it goes above the first
 * header, where a dotted key cannot clash with one.
 */
export const patchKeys = (text: string, values: ReadonlyMap<string, Assigned | null>): string => {
	const source = assignments(text);
	const patches: {start: number; end: number; text: string}[] = [];
	const added = new Map<number, string>();
	const inlines = new Map<Assignment, Readonly<Record<string, unknown>>>();

	for (const [word, value] of values) {
		const path = wordPath(word);
		const row = source.rows.find((row) => row.word === pathWord(path));
		const holder = source.rows.find(
			(row) => startsWith(path, row.path) && text.slice(row.value, row.value + 1) === "{",
		);

		if (row !== undefined) {
			if (value === null) {
				// Leave a trailing hand-written comment in place when removing its assignment.
				const tail = text.slice(row.until, row.end);
				patches.push({
					start: row.start,
					end: row.end,
					text: tail.trimStart().startsWith("#") ? tail.trimStart() : "",
				});
			} else {
				patches.push({start: row.value, end: row.until, text: JSON.stringify(value)});
			}
		} else if (holder !== undefined) {
			const read = readToml(`x = ${text.slice(holder.value, holder.until)}`);
			const before =
				inlines.get(holder) ??
				(Result.isSuccess(read) && isTable(read.success.x) ? read.success.x : {});
			inlines.set(holder, setIn(before, path.slice(holder.path.length), value));
		} else if (value !== null) {
			const section = source.sections
				.filter((one) => one.path.length === 0 || startsWith(path, one.path))
				.reduce((deepest, one) => (one.path.length > deepest.path.length ? one : deepest));
			const line = `${pathWord(path.slice(section.path.length))} = ${JSON.stringify(value)}\n`;
			added.set(section.after, (added.get(section.after) ?? "") + line);
		}
	}

	for (const [holder, table] of inlines) {
		patches.push({start: holder.value, end: holder.until, text: inline(table)});
	}

	for (const [at, rows] of added) {
		patches.push({
			start: at,
			end: at,
			text: `${at > 0 && text[at - 1] !== "\n" ? "\n" : ""}${rows}`,
		});
	}

	let saved = text;

	for (const patch of patches.sort((a, b) => b.start - a.start)) {
		saved = saved.slice(0, patch.start) + patch.text + saved.slice(patch.end);
	}

	return saved;
};

export const writtenKeys = (text: string): ReadonlyMap<string, string | readonly string[]> => {
	const read = readToml(text);
	return new Map(
		Result.isFailure(read)
			? []
			: leaves(read.success).flatMap(({path, value}) =>
					typeof value === "string" ||
					(Array.isArray(value) && value.every((one) => typeof one === "string"))
						? [[pathWord(path), value] as const]
						: [],
				),
	);
};

/** The text read as TOML, or the line it breaks on. */
const readToml = (text: string): Result.Result<Readonly<Record<string, unknown>>, Refused> => {
	try {
		return Result.succeed(parse(text));
	} catch (error) {
		const line = error instanceof TomlError ? error.line : 1;
		const said = error instanceof Error ? error.message.split("\n")[0] : String(error);
		return Result.fail({line, why: `not TOML: ${said ?? "it does not read"}`});
	}
};

/**
 * The line each value is written on, from 1. smol-toml names a line only when it cannot parse,
 * so each line is read on its own: a key line parses alone, a table header sets the path for the
 * lines under it, and a value over several lines is read until it closes.
 */
const linesOf = (text: string): ReadonlyMap<string, number> => {
	const lines = text.split("\n");
	const at = new Map<string, number>();
	let table: readonly string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = (lines[i] ?? "").trim();
		const header = /^\[\[?(.+?)\]\]?\s*(#.*)?$/.exec(line);

		if (line === "" || line.startsWith("#")) {
			i += 1;
			continue;
		}

		if (header !== null) {
			const read = readToml(`${header[1]} = 0`);
			table = Result.isSuccess(read) ? (leaves(read.success)[0]?.path ?? []) : [];
			at.set(pathWord(table), i + 1);
			i += 1;
			continue;
		}

		let end = i;
		let read = readToml(lines[i] ?? "");

		while (Result.isFailure(read) && end + 1 < lines.length) {
			end += 1;
			read = readToml(lines.slice(i, end + 1).join("\n"));
		}

		if (Result.isSuccess(read)) {
			for (const leaf of leaves(read.success)) {
				const word = pathWord([...table, ...leaf.path]);

				if (!at.has(word)) {
					at.set(word, i + 1);
				}
			}
		}

		i = Result.isSuccess(read) ? end + 1 : i + 1;
	}

	return at;
};

const isCommand = (word: string): word is Does =>
	(Does.literals as readonly string[]).includes(word);

/** One of your rows: its command, its keys as read and as spelled, and its line. */
interface Yours {
	readonly does: Does;
	readonly keys: readonly {readonly key: Key; readonly spelled: string}[];
	readonly line: number;
}

/** What the file sets, each with its line, before the rows are checked against each other. */
interface Written {
	readonly prefix: {readonly name: string; readonly spelled: string; readonly line: number} | null;
	readonly ignore: {readonly names: readonly string[]; readonly line: number} | null;
	readonly rows: readonly Yours[];
}

/** The prefix as the file sets it: one key, pressed alone, with a modifier or named. */
const readPrefix = (
	value: unknown,
	mac: boolean,
): Result.Result<{name: string; spelled: string}, string> => {
	if (typeof value !== "string") {
		return Result.fail('the prefix is one key, such as "ctrl+a"');
	}

	if (value.startsWith("<")) {
		return Result.fail(`the prefix is a key pressed alone, such as ctrl+a, not ${value}`);
	}

	return Result.flatMap(readPress(value, mac), (p) => {
		const no = notOurs(p.name, value);

		if (no !== null) {
			return Result.fail(no);
		}

		if (p.printable || BARE.has(p.name)) {
			return Result.fail(
				`${value} would ${p.printable ? "type" : "stop it typing or moving"} in every tile: the prefix needs a modifier, such as ctrl+a`,
			);
		}

		return Result.succeed({name: p.name, spelled: value});
	});
};

/** Every value of the file read, in the order of its lines, or the first that is refused. */
const readWritten = (
	table: Readonly<Record<string, unknown>>,
	text: string,
	mac: boolean,
): Result.Result<Written, Refused> => {
	const lines = linesOf(text);
	const values = leaves(table)
		.map((leaf) => {
			const word = pathWord(leaf.path);
			return {word, value: leaf.value, line: lines.get(word) ?? 1};
		})
		.sort((a, b) => a.line - b.line);
	let prefix: Written["prefix"] = null;
	let ignore: Written["ignore"] = null;
	const rows: Yours[] = [];

	for (const {word, value, line} of values) {
		const no = (why: string) => Result.fail({line, why});

		if (word === "prefix") {
			const read = readPrefix(value, mac);

			if (Result.isFailure(read)) {
				return no(read.failure);
			}

			prefix = {...read.success, line};
			continue;
		}

		const spelled = spellings(word, value);

		if (Result.isFailure(spelled)) {
			return no(
				isCommand(word) || word === "ignore" ? spelled.failure : `${word} is not a command`,
			);
		}

		if (word === "ignore") {
			const names: string[] = [];

			for (const one of spelled.success) {
				const read = readKey(one, mac);

				if (Result.isFailure(read)) {
					return no(read.failure);
				}

				if (read.success._tag === "after_prefix") {
					return no(`ignore takes keys pressed alone, such as cmd+w, not ${one}`);
				}

				names.push(read.success.key);
			}

			ignore = {names, line};
			continue;
		}

		if (!isCommand(word)) {
			return no(`${word} is not a command`);
		}

		const keys: Yours["keys"][number][] = [];

		for (const one of spelled.success) {
			const read = readKey(one, mac);

			if (Result.isFailure(read)) {
				return no(read.failure);
			}

			keys.push({key: read.success, spelled: one});
		}

		rows.push({does: word, keys, line});
	}

	return Result.succeed({prefix, ignore, rows});
};

const sameKey = (a: Key, b: Key): boolean => a._tag === b._tag && a.key === b.key;

/** Your rows checked against each other and the prefix: one key does one thing in each place. */
const clash = (set: Written, prefix: string): Refused | null => {
	const seen: {key: Key; spelled: string; does: Does; line: number}[] = [];
	const ignored = set.ignore?.names ?? [];

	for (const row of set.rows) {
		for (const {key, spelled} of row.keys) {
			if (key._tag === "alone" && key.key === prefix) {
				return {
					line: Math.max(row.line, set.prefix?.line ?? 0),
					why: `${spelled} is your prefix, so it cannot also run ${row.does}`,
				};
			}

			if (key._tag === "after_prefix" && key.key === prefix) {
				return {
					line: row.line,
					why: `${spelled} is the prefix twice, which sends the prefix to the tile`,
				};
			}

			if (key._tag === "alone" && ignored.includes(key.key) && set.ignore !== null) {
				return {
					line: Math.max(row.line, set.ignore.line),
					why: `${spelled} is on both ignore and ${row.does}`,
				};
			}

			const other = seen.find((s) => s.does !== row.does && sameKey(s.key, key));

			if (other !== undefined) {
				return {line: row.line, why: `${spelled} is on both ${other.does} and ${row.does}`};
			}

			seen.push({key, spelled, does: row.does, line: row.line});
		}
	}

	if (set.prefix !== null && set.ignore?.names.includes(set.prefix.name) === true) {
		return {
			line: Math.max(set.prefix.line, set.ignore.line),
			why: `${set.prefix.spelled} is your prefix, so it cannot also be ignored`,
		};
	}

	return null;
};

/**
 * The keys file read, and laid over the defaults, or why not with its line. `mac` reads `mod` as
 * Cmd; elsewhere it is Ctrl. Your row wins: a default loses each key one of your rows, the prefix
 * or your `ignore` takes, and keeps its others.
 */
export const decodeKeys = (text: string, mac: boolean): Result.Result<Keys, Refused> => {
	const lineCount = text.split("\n").length;
	const within = (refused: Refused): Refused => ({
		line: Math.min(Math.max(1, refused.line), lineCount),
		why: refused.why,
	});
	const read = Result.flatMap(readToml(text), (table) => readWritten(table, text, mac));

	if (Result.isFailure(read)) {
		return Result.fail(within(read.failure));
	}

	const set = read.success;
	const prefix = set.prefix?.name ?? defaults.prefix;
	const no = clash(set, prefix);

	if (no !== null) {
		return Result.fail(within(no));
	}

	const taken = set.rows.flatMap((row) => row.keys.map((k) => k.key));
	const ignore = (set.ignore?.names ?? defaults.ignore).filter(
		(name) => name !== prefix && !taken.some((k) => k._tag === "alone" && k.key === name),
	);
	// A default loses a key you took, the prefix pressed alone (it arms), the prefix after itself
	// (that sends the prefix on, so the row could never run), and an ignored key.
	const lost = (key: Key) =>
		taken.some((k) => sameKey(k, key)) ||
		key.key === prefix ||
		(key._tag === "alone" && ignore.includes(key.key));
	const rows = defaults.rows.map((row) => {
		const yours = set.rows.find((r) => r.does === row.does);
		return yours === undefined
			? {...row, keys: row.keys.filter((k) => !lost(k))}
			: Row.make({does: row.does, keys: yours.keys.map((k) => k.key), source: "yours"});
	});

	if (!rows.some((row) => row.does.startsWith('tezgah."focus --to ') && row.keys.length > 0)) {
		return Result.fail({line: 1, why: "Keep a focus key so a terminal has a keyboard way out"});
	}

	return Result.succeed({prefix, rows, ignore, file: File.cases.read.make({})});
};

// ---------------------------------------------------------------- a key, as the file spells it

const WORDS: Readonly<Record<string, string>> = {c: "ctrl", a: "alt", s: "shift", m: "cmd"};

const SPOKEN: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(NAMED).map(([word, name]) => [name, word]),
);

/**
 * A key's name as the file would spell it: `<c-b>` is `ctrl+b`, `<arrowleft>` is `left`, ` ` is
 * `space`. What the log says a person pressed (host/serve.ts, `did`), in the words they write.
 */
export const spell = (name: string): string => {
	if (name === " ") {
		return "space";
	}

	const wrapped = /^<((?:[casm]-)*)(.+)>$/.exec(name);

	if (wrapped === null) {
		return name;
	}

	const [, mods = "", base = ""] = wrapped;
	const words = mods
		.split("-")
		.filter(Boolean)
		.map((m) => WORDS[m] ?? m);
	const key = base === " " ? "space" : (SPOKEN[base] ?? base);
	return [...words, key].join("+");
};
