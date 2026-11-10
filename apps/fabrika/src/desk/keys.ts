import type {Does as Command, Key, Keys} from "./keymap.ts";
import type {Direction, Orientation, TileId} from "./layout/index.ts";

// The desk's keys: what each command does, and the key after the prefix it ships on. tmux's
// shape, and Tuval's table (kamp-us/phoenix, packages/tuval-ui/src/shell/keys/table.ts): with the
// prefix not armed, every key belongs to the focused tile. Plain data.
//
//   keyName({key: "b", ctrl: true, alt: false, meta: false})    "<c-b>"
//   keyName({key: "|", ctrl: false, alt: false, meta: false})   "|"
//   keyName({key: "Shift", ...})                                null: a modifier alone is no key
//   BINDINGS[0]          {key: "|", command: "tezgah.split", does: {kind: "split", ...}, ...}
//
// Each command has its word in the keys file, `<program>.<word>` (docs/direction/keybindings-
// are-configurable.md, K9). The desk is tezgah, and its word is its tsh word, quoted after the
// dot when it has spaces: `tezgah.zoom`, `tezgah."split --to down"`. Two differ, as the note names
// them: the tile's close is `tezgah.close` (tsh's word is `close-tile`), and C-b ? is
// `keys.open`. The table the desk reads is keymap.ts's: these, with keybindings.toml laid over.
//
// Every command has a tsh word too, the line that does the same from a tile's tsh, as each tmux
// key is bound to a tmux command (`bind z resize-pane -Z`). `wordOf` writes it from what the
// command does, so a key and its word cannot drift; desk/words.ts reads the word back.
//
//   wordOf({kind: "zoom"})                                      "zoom"
//   wordOf({kind: "focus", to: "left"})                         "focus --to left"
//   wordOf({kind: "pick", at: 2})                               "workspace --to 2"
//
// Left out of Tuval's table for now, and listed in the README as later: `w` (pick a tile),
// `:` (a command line), `r` (reload the config), `p` (the process board). Tuval's `a` focused its
// list; here it opens the asks list, the frame's nearest thing to it.

/** How long a repeatable key leaves the prefix armed, as tmux's `repeat-time`, in milliseconds. */
export const REPEAT_MS = 500;

/**
 * What the window's frame shows, for the page that pressed the key (window/frame.ts): the asks
 * list, every key, the info mode, the two bars hidden and back, or the few lines under the top
 * bar's agents, sync or host. The desk only says so; the page draws it, as tmux's server runs
 * `list-keys` and the client that pressed shows it.
 */
export const SHOWS = [
	"asks",
	"jobs",
	"keys",
	"info",
	"bars",
	"agents",
	"sync",
	"host",
	"palette",
	"projects",
] as const;
export type Show = (typeof SHOWS)[number];

/** What a key after the prefix does, or a tsh word does in the tile it was typed in. */
export type Does =
	| {readonly kind: "split"; readonly orientation: Orientation}
	| {readonly kind: "focus"; readonly to: Direction}
	| {readonly kind: "cycle"; readonly to: "next" | "previous"}
	/** Focus this tile, wherever it is: a click on it in the top bar's line. No key does it. */
	| {readonly kind: "go"; readonly tile: TileId}
	/** Turn the container holding the focused tile: horizontal to vertical and back. */
	| {readonly kind: "turn"}
	/** Fold the focused tile into a strip; focus goes to the next open tile. */
	| {readonly kind: "fold"}
	| {readonly kind: "zoom"}
	| {readonly kind: "close"}
	| {readonly kind: "new"}
	| {readonly kind: "step"; readonly to: "previous" | "next"}
	/** The workspace in this place, from 1, as tmux's `select-window -t 1`. */
	| {readonly kind: "pick"; readonly at: number}
	| {readonly kind: "show"; readonly what: Show};

/**
 * One default binding: the key after the prefix it ships on, the command's word in the keys file,
 * what it does, whether it repeats (tmux's `bind -r`), and its name: the one word the frame, the
 * palette and a tooltip call it by. Two keys with one command are one command (h and the left
 * arrow): the file and the palette list it once.
 */
export interface Binding {
	readonly key: string;
	readonly command: Command;
	readonly does: Does;
	readonly repeats: boolean;
	readonly name: string;
}

const once = (key: string, command: Command, name: string, does: Does): Binding => ({
	key,
	command,
	does,
	repeats: false,
	name,
});

/** `C-b 1` to `C-b 9`: the workspace in that place. */
const PICKS = [
	'tezgah."workspace --to 1"',
	'tezgah."workspace --to 2"',
	'tezgah."workspace --to 3"',
	'tezgah."workspace --to 4"',
	'tezgah."workspace --to 5"',
	'tezgah."workspace --to 6"',
	'tezgah."workspace --to 7"',
	'tezgah."workspace --to 8"',
	'tezgah."workspace --to 9"',
] as const satisfies readonly Command[];

/** Every key the desk ships with after the prefix, today's table. */
export const BINDINGS: readonly Binding[] = [
	// `|` puts the two side by side: a row, "horizontal" in the tree. `-` puts one over the other.
	once("|", "tezgah.split", "split", {kind: "split", orientation: "horizontal"}),
	once("-", 'tezgah."split --to down"', "split down", {kind: "split", orientation: "vertical"}),
	once("h", 'tezgah."focus --to left"', "focus left", {kind: "focus", to: "left"}),
	once("j", 'tezgah."focus --to down"', "focus down", {kind: "focus", to: "down"}),
	once("k", 'tezgah."focus --to up"', "focus up", {kind: "focus", to: "up"}),
	once("l", 'tezgah."focus --to right"', "focus right", {kind: "focus", to: "right"}),
	once("<arrowleft>", 'tezgah."focus --to left"', "focus left", {kind: "focus", to: "left"}),
	once("<arrowdown>", 'tezgah."focus --to down"', "focus down", {kind: "focus", to: "down"}),
	once("<arrowup>", 'tezgah."focus --to up"', "focus up", {kind: "focus", to: "up"}),
	once("<arrowright>", 'tezgah."focus --to right"', "focus right", {kind: "focus", to: "right"}),
	once("<f6>", 'tezgah."focus --to next"', "focus next", {kind: "cycle", to: "next"}),
	once("<s-f6>", 'tezgah."focus --to previous"', "focus previous", {kind: "cycle", to: "previous"}),
	// Space turns the container, as AeroSpace's `layout horizontal vertical`. `f` folds the tile.
	once(" ", "tezgah.turn", "turn", {kind: "turn"}),
	once("f", "tezgah.fold", "fold", {kind: "fold"}),
	once("z", "tezgah.zoom", "zoom", {kind: "zoom"}),
	once("x", "tezgah.close", "close", {kind: "close"}),
	once("N", 'tezgah."workspace --to new"', "new", {kind: "new"}),
	{
		key: "<c-h>",
		command: 'tezgah."workspace --to previous"',
		does: {kind: "step", to: "previous"},
		repeats: true,
		name: "previous workspace",
	},
	{
		key: "<c-l>",
		command: 'tezgah."workspace --to next"',
		does: {kind: "step", to: "next"},
		repeats: true,
		name: "next workspace",
	},
	...PICKS.map((command, i) =>
		once(String(i + 1), command, `workspace ${i + 1}`, {kind: "pick", at: i + 1}),
	),
	// The frame's own: not a bare `?` or `i`, which would go into tsh.
	once("a", "tezgah.asks", "asks", {kind: "show", what: "asks"}),
	// `J`, as `N` and `B`: the bare `j` is focus down.
	once("J", "tezgah.jobs", "jobs", {kind: "show", what: "jobs"}),
	once("?", "keys.open", "keys", {kind: "show", what: "keys"}),
	once("i", "tezgah.info", "info", {kind: "show", what: "info"}),
	once("B", "tezgah.bars", "bars", {kind: "show", what: "bars"}),
	// The top bar's agents, sync and host: capitals, as `N` and `B`. `h` is focus left, and `s`
	// is tmux's session list, a key a tmux hand presses without looking.
	once("A", "tezgah.agents", "agents", {kind: "show", what: "agents"}),
	once("S", "tezgah.sync", "sync", {kind: "show", what: "sync"}),
	once("H", "tezgah.host", "host", {kind: "show", what: "host"}),
];

/** What a key acts on: the focused tile, focus, the workspaces, or the window's frame. */
export type Group = "tile" | "focus" | "workspace" | "window";

/** The group a binding is listed under, in the palette and the keys panel (window/frame.ts). */
export const groupOf = (does: Does): Group => {
	switch (does.kind) {
		case "split":
		case "turn":
		case "fold":
		case "zoom":
		case "close":
			return "tile";
		case "focus":
		case "cycle":
		case "go":
			return "focus";
		case "new":
		case "step":
		case "pick":
			return "workspace";
		case "show":
			return "window";
	}
};

/**
 * The tsh word that does what `does` does, typed in a tile: one program per kind of command
 * (desk/words.ts), with `--to` where a key picks a way. `close-tile`, not `close`: tsh's own
 * `close %n input` ends a job's input. `turn-container`, not `turn`: `turn` is one turn of a
 * summoned agent (`@scout ...`), a program of its own.
 */
export const wordOf = (does: Does): string => {
	switch (does.kind) {
		case "split":
			return does.orientation === "horizontal" ? "split" : "split --to down";
		case "focus":
			return `focus --to ${does.to}`;
		case "cycle":
			return `focus --to ${does.to}`;
		case "go":
			return `focus --to ${does.tile}`;
		case "turn":
			return "turn-container";
		case "fold":
		case "zoom":
			return does.kind;
		case "close":
			return "close-tile";
		case "new":
			return "workspace --to new";
		case "step":
			return `workspace --to ${does.to}`;
		case "pick":
			return `workspace --to ${does.at}`;
		case "show":
			return does.what;
	}
};

/** A key press, as the page reads it off a keyboard event. */
export interface Press {
	readonly key: string;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly meta: boolean;
	readonly code?: string;
	readonly shift?: boolean;
	readonly composing?: boolean;
	readonly altGraph?: boolean;
}

const MODIFIERS = new Set([
	"Shift",
	"Control",
	"Alt",
	"Meta",
	"CapsLock",
	"Fn",
	"Dead",
	"Unidentified",
	"Process",
	"AltGraph",
]);

/**
 * A key's one spelling, as the table writes it: `<c-b>` for Ctrl-B, `<arrowleft>`, or the
 * character itself. `null` for a modifier pressed alone, which is no key at all: Shift goes down
 * before the `|` it makes, and must not disarm the prefix.
 */
export const keyName = (press: Press): string | null => {
	if (press.composing || MODIFIERS.has(press.key) || press.key === "") return null;
	const char = [...press.key].length === 1;
	const modified = press.ctrl || press.alt || press.meta;
	const shift = press.shift && (!char || modified);
	if (!modified && !shift) return char ? press.key : `<${press.key.toLowerCase()}>`;
	const bare = char ? press.key.replace(/[A-Z]/g, (c) => c.toLowerCase()) : press.key.toLowerCase();
	const mods = `${press.ctrl ? "c-" : ""}${press.alt ? "a-" : ""}${shift ? "s-" : ""}${press.meta ? "m-" : ""}`;
	return `<${mods}${bare}>`;
};

/** Character matching comes before a Ctrl/Cmd fallback to a Latin key position. */
export const matchPress = (press: Press, keys: readonly Key[], mac: boolean): Key | null => {
	const name = keyName(press);
	if (name === null) return null;
	const exact = keys.find((key) => key.key === name);
	if (exact !== undefined) return exact;
	if (((press.alt && mac) || press.altGraph) && [...press.key].length === 1) {
		const typed = keyName({...press, alt: false, ctrl: press.altGraph ? false : press.ctrl});
		const folded = keys.find((key) => key.key === typed);
		if (folded !== undefined) return folded;
	}
	if (
		(press.ctrl || press.meta) &&
		!press.altGraph &&
		[...press.key].some((char) => (char.codePointAt(0) ?? 0) > 127)
	) {
		const latin = /^Key([A-Z])$/.exec(press.code ?? "")?.[1];
		if (latin !== undefined) {
			const position = keyName({...press, key: latin.toLowerCase()});
			return keys.find((key) => key.key === position) ?? null;
		}
	}
	return null;
};

/** Who a key belongs to: the system and its menu, the app (the desk or a tile), or nobody at all. */
type KeyOwner = "system" | "app" | "nobody";

/**
 * The Mac's own keys, which no file can take: Cmd-Q quits, Cmd-H hides, Cmd-Tab and Cmd-Space
 * are the system's, and Option-Cmd-Esc force quits (docs/direction/keybindings-are-configurable.md,
 * "Keys that cannot be taken away"). The keys file refuses them (keymap.ts); `keyOwner` checks
 * them first all the same, so no table can give one to the app.
 */
export const THE_MACS: ReadonlySet<string> = new Set([
	"<m-q>",
	"<m-h>",
	"<m-tab>",
	"<m- >",
	"<a-m-escape>",
]);

/**
 * Who a key belongs to. On a Mac, Command is the system's and the menu's, as in Terminal: Cmd-Q
 * quits, whatever has focus. A Command key the keys file binds is the app's (by default Cmd-K,
 * the palette), and one it ignores is nobody's (by default Cmd-W, by the owner's choice: it types
 * nothing and closes nothing; its name has no Shift, so Cmd-Shift-W goes with it). Everywhere else
 * the menu's keys are Ctrl keys, and a shell needs those: Ctrl-C and Ctrl-W stay with tsh.
 *
 *   keyOwner({key: "q", ctrl: false, alt: false, meta: true}, true, defaults)    "system"
 *   keyOwner({key: "k", ctrl: false, alt: false, meta: true}, true, defaults)    "app": the palette
 *   keyOwner({key: "w", ctrl: false, alt: false, meta: true}, true, defaults)    "nobody"
 *   keyOwner({key: "c", ctrl: true, alt: false, meta: false}, true, defaults)    "app": tsh's
 *   keyOwner({key: "w", ctrl: false, alt: false, meta: true}, false, defaults)   "app": not a Mac
 */
export const keyOwner = (press: Press, mac: boolean, keys: Keys): KeyOwner => {
	if (!mac || !press.meta) return "app";
	const name = keyName(press);
	if (name === null || THE_MACS.has(name)) return "system";
	const bound =
		matchPress(
			press,
			[
				{_tag: "alone", key: keys.prefix},
				...keys.rows.flatMap((row) => row.keys.filter((k) => k._tag === "alone")),
			],
			mac,
		) !== null;
	if (bound) return "app";
	return keys.ignore.includes(name) ? "nobody" : "system";
};
