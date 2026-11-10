// Key tables, next/ (Tier 1, P14; docs/direction/keybindings-are-configurable.md). Pure rules any
// client needs: the person's `keybindings.toml` decoded into command rows, the rows laid over a
// program's defaults, a key event matched against them, and the hint a button shows. Matching,
// hints and unbinding all read the one table, so a rebound key changes all three at once.
//
// A chord is `ctrl+`, `alt+` and `meta+` modifiers and a key: one typed character exactly as typed
// (`+`, `A`), so Shift is already in it, or a lowercase key name (`enter`, `tab`, `arrowup`), which
// may also carry `shift+`. Chords separated by a space are a sequence: the first arms a prefix and
// the next completes it. Editable text, composing input and the browser's own tab and window
// shortcuts are never taken.
import {Result, Schema} from "effect";
import {parse, TomlError} from "smol-toml";

/** A command's chords, as the person wrote them. `[]` unbinds the command. */
export type Rows = Readonly<Record<string, ReadonlyArray<string>>>;

/** Why a key file was not used, and the line it points at. `line` is 0 when it names no line. */
export const KeyProblem = Schema.Struct({
	line: Schema.Int,
	why: Schema.Literals(["syntax", "unknown_command", "unknown_key", "clash", "read", "watch"]),
});
export type KeyProblem = typeof KeyProblem.Type;

/** The rows a client matches against: the file's over the defaults. `file` lists the commands the
 *  file named, which win a chord over a default. */
export type Table = {readonly rows: Rows; readonly file: ReadonlyArray<string>};

/** A prefix that is armed: the chords pressed so far, canonical. */
export type Armed = {readonly chords: ReadonlyArray<string>};

/** One key event, as a browser (or any client) reports it. */
export type KeyEvent = {
	readonly key: string;
	readonly shift: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly meta: boolean;
	readonly composing: boolean;
	readonly editable: boolean;
};

/** What a key event did: ran a command, armed a prefix, or nothing. */
export const KeyOut = Schema.TaggedUnion({
	command: {command: Schema.String},
	prefix: {},
	none: {},
});
export type KeyOut = typeof KeyOut.Type;
const nothing = KeyOut.cases.none.make({});

const NAMED: ReadonlySet<string> = new Set([
	"enter",
	"tab",
	"escape",
	"space",
	"backspace",
	"delete",
	"insert",
	"home",
	"end",
	"pageup",
	"pagedown",
	"arrowup",
	"arrowdown",
	"arrowleft",
	"arrowright",
	...Array.from({length: 12}, (_, n) => `f${n + 1}`),
]);
const MODIFIERS = ["ctrl", "alt", "meta", "shift"] as const;
type Modifier = (typeof MODIFIERS)[number];
const isModifier = (word: string): word is Modifier =>
	(MODIFIERS as ReadonlyArray<string>).includes(word);
/** Keys a browser keeps for its tabs and windows with Ctrl or Cmd: close, new, address, reload, quit. */
const RESERVED: ReadonlySet<string> = new Set(["w", "t", "n", "l", "r", "q"]);
/** Keys that are only a modifier going down, never a chord of their own. */
const LONE: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);

const typed = (key: string): boolean => [...key].length === 1 && key !== " ";

/** The canonical text of one chord the person wrote, or null when it is no chord. */
const chord = (text: string): string | null => {
	const plus = text === "+" || text.endsWith("++");
	const key = plus ? "+" : (text.split("+").at(-1) ?? "");
	const lead = plus
		? text.slice(0, -2)
		: text.length === key.length
			? ""
			: text.slice(0, text.length - key.length - 1);
	const mods = lead === "" ? [] : lead.split("+");
	if (key === "" || mods.some((m) => !isModifier(m)) || new Set(mods).size !== mods.length)
		return null;
	const name = typed(key) ? key : key.toLowerCase();
	if (!typed(key) && !NAMED.has(name)) return null;
	if (typed(key) && mods.includes("shift")) return null;
	return [...MODIFIERS.filter((m) => mods.includes(m)), name].join("+");
};

/** The canonical chords of a sequence, or null when one of them is no chord. */
const sequence = (text: string): ReadonlyArray<string> | null => {
	const chords = text.split(" ").map(chord);
	return chords.every((c): c is string => c !== null) ? chords : null;
};

/** The canonical chord of a key event, or null when it can be no chord. */
const eventChord = (e: KeyEvent): string | null => {
	if (LONE.has(e.key) || e.key === "" || e.key === "Dead" || e.key === "Unidentified") return null;
	const name = typed(e.key) ? e.key : e.key === " " ? "space" : e.key.toLowerCase();
	if (!typed(e.key) && !NAMED.has(name)) return null;
	const mods: ReadonlyArray<Modifier> = [
		...(e.ctrl ? (["ctrl"] as const) : []),
		...(e.alt ? (["alt"] as const) : []),
		...(e.meta ? (["meta"] as const) : []),
		...(e.shift && !typed(e.key) ? (["shift"] as const) : []),
	];
	return [...mods, name].join("+");
};

const startsWith = (long: ReadonlyArray<string>, short: ReadonlyArray<string>): boolean =>
	short.length <= long.length && short.every((c, i) => long[i] === c);

/** Each bound sequence once, canonical, the file's commands first so they win a shared chord. */
const bindings = (t: Table): ReadonlyArray<{command: string; chords: ReadonlyArray<string>}> => {
	const order = [...t.file, ...Object.keys(t.rows).filter((c) => !t.file.includes(c))];
	const out: Array<{command: string; chords: ReadonlyArray<string>}> = [];
	for (const command of order)
		for (const text of t.rows[command] ?? []) {
			const chords = sequence(text);
			if (chords === null) continue;
			if (out.some((b) => startsWith(b.chords, chords) || startsWith(chords, b.chords))) continue;
			out.push({command, chords});
		}
	return out;
};

/** The file's rows over the defaults: a command the file names takes its row, `[]` unbinding it. */
export const buildTable = (defaults: Rows, rows: Rows): Table => ({
	rows: {...defaults, ...rows},
	file: Object.keys(rows),
});

/** What a key event does with `armed` as the prefix so far. A miss clears the prefix. */
export const matchKey = (
	t: Table,
	armed: Armed | null,
	e: KeyEvent,
): {readonly armed: Armed | null; readonly out: KeyOut} => {
	if (e.composing || e.editable) return {armed, out: nothing};
	const pressed = eventChord(e);
	if (pressed === null) return {armed, out: nothing};
	if ((e.ctrl || e.meta) && RESERVED.has(e.key.toLowerCase())) return {armed: null, out: nothing};
	const chords = [...(armed?.chords ?? []), pressed];
	const all = bindings(t);
	const exact = all.find((b) => b.chords.length === chords.length && startsWith(b.chords, chords));
	if (exact !== undefined)
		return {armed: null, out: KeyOut.cases.command.make({command: exact.command})};
	if (all.some((b) => b.chords.length > chords.length && startsWith(b.chords, chords)))
		return {armed: {chords}, out: KeyOut.cases.prefix.make({})};
	return {armed: null, out: nothing};
};

/** The chord a button shows for `command`: its first, as written, from the same table. */
export const hintFor = (t: Table, command: string): string | null => t.rows[command]?.[0] ?? null;

type Problem = {readonly line: number; readonly why: KeyProblem["why"]};
const problem = (line: number, why: Problem["why"]): Result.Result<never, Problem> =>
	Result.fail({line, why});

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The line a command's row is written on, counting from 1, or 1 when it cannot be found. */
const lineNumber = (text: string, command: string): number => {
	const last = command.split(".").at(-1) ?? command;
	const quoted = new RegExp(`^\\s*["']${escape(command)}["']\\s*=`);
	const bare = new RegExp(`(^|\\.)\\s*${escape(last)}\\s*=`);
	const lines = text.split("\n");
	const at = lines.findIndex((l) => quoted.test(l));
	const loose = at >= 0 ? at : lines.findIndex((l) => bare.test(l));
	return loose >= 0 ? loose + 1 : 1;
};

const isTable = (u: unknown): u is Readonly<Record<string, unknown>> =>
	typeof u === "object" && u !== null && !Array.isArray(u) && !(u instanceof Date);

/** The `[keys]` table's rows, a dotted bare key read as the command it spells. */
const flatten = (
	table: Readonly<Record<string, unknown>>,
	prefix: string,
	out: Array<readonly [string, unknown]>,
): void => {
	for (const [key, value] of Object.entries(table)) {
		const name = prefix === "" ? key : `${prefix}.${key}`;
		if (isTable(value)) flatten(value, name, out);
		else out.push([name, value]);
	}
};

/**
 * The rows a `keybindings.toml` holds, checked against the commands that exist: a `[keys]` table of
 * `"command" = ["chord", ...]`, a string alone being one chord. It refuses the whole file, naming
 * the line, on bad TOML, an unknown command, a chord that is no key, or one chord for two commands.
 */
export const parseKeys = (
	text: string,
	commands: ReadonlyArray<string>,
): Result.Result<Rows, Problem> => {
	const doc = Result.try({try: () => parse(text), catch: (error) => error});
	if (Result.isFailure(doc))
		return problem(doc.failure instanceof TomlError ? Math.max(1, doc.failure.line) : 1, "syntax");
	const keys = doc.success["keys"];
	if (keys === undefined) return Result.succeed({});
	if (!isTable(keys)) return problem(lineNumber(text, "keys"), "syntax");
	const entries: Array<readonly [string, unknown]> = [];
	flatten(keys, "", entries);
	const rows: Record<string, ReadonlyArray<string>> = {};
	const taken: Array<{command: string; chords: ReadonlyArray<string>}> = [];
	for (const [command, value] of entries) {
		const line = lineNumber(text, command);
		const list = typeof value === "string" ? [value] : value;
		if (!Array.isArray(list) || !list.every((k): k is string => typeof k === "string"))
			return problem(line, "syntax");
		if (!commands.includes(command)) return problem(line, "unknown_command");
		for (const k of list) {
			const chords = sequence(k);
			if (chords === null) return problem(line, "unknown_key");
			const other = taken.find(
				(b) =>
					b.command !== command && (startsWith(b.chords, chords) || startsWith(chords, b.chords)),
			);
			if (other !== undefined) return problem(line, "clash");
			taken.push({command, chords});
		}
		rows[command] = list;
	}
	return Result.succeed(rows);
};

/** A key file's text, or the reason it could not be read. */
export const KeySource = Schema.TaggedUnion({
	text: {text: Schema.String},
	failed: {why: Schema.String},
});
export type KeySource = typeof KeySource.Type;

/**
 * The table after the key file changed. A good file gives its table and no error; a bad or unread
 * one keeps `last` and says why. Either way an armed prefix is cleared, so the next key starts fresh.
 */
export const reload = (
	last: Table,
	defaults: Rows,
	commands: ReadonlyArray<string>,
	source: KeySource,
): {readonly table: Table; readonly armed: null; readonly error: Problem | null} => {
	if (source._tag === "failed") return {table: last, armed: null, error: {line: 0, why: "read"}};
	const rows = parseKeys(source.text, commands);
	return Result.isSuccess(rows)
		? {table: buildTable(defaults, rows.success), armed: null, error: null}
		: {table: last, armed: null, error: rows.failure};
};
