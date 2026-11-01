import type {Direction, Orientation, TileId} from "./layout/index.ts";

// The desk's keys: the prefix, and what each key after it does. tmux's shape, and Tuval's table
// (kamp-us/phoenix, packages/tuval-ui/src/shell/keys/table.ts): with the prefix not armed, every
// key belongs to the focused tile. Plain data; the desk machine reads it (desk.ts).
//
//   keyName({key: "b", ctrl: true, alt: false, meta: false})    "<c-b>"
//   keyName({key: "|", ctrl: false, alt: false, meta: false})   "|"
//   keyName({key: "Shift", ...})                                null: a modifier alone is no key
//   bindingOf("|")                                              {key: "|", does: {kind: "split", ...}}
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

/** The key that arms the desk, as tmux's `prefix`. */
export const PREFIX = "<c-b>";

/** How long a repeatable key leaves the prefix armed, as tmux's `repeat-time`, in milliseconds. */
export const REPEAT_MS = 500;

/**
 * What the window's frame shows, for the page that pressed the key (window/frame.ts): the asks
 * list, every key, the info mode, the two bars hidden and back, or the few lines under the top
 * bar's agents, sync or host. The desk only says so; the page draws it, as tmux's server runs
 * `list-keys` and the client that pressed shows it.
 */
export const SHOWS = ["asks", "jobs", "keys", "info", "bars", "agents", "sync", "host"] as const;
export type Show = (typeof SHOWS)[number];

/** What a key after the prefix does, or a tsh word does in the tile it was typed in. */
export type Does =
	| {readonly kind: "split"; readonly orientation: Orientation}
	| {readonly kind: "focus"; readonly to: Direction}
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
 * One binding: the key after the prefix, what it does, whether it repeats (tmux's `bind -r`), and
 * its name: the one word the frame, the palette and a tooltip call it by.
 */
export interface Binding {
	readonly key: string;
	readonly does: Does;
	readonly repeats: boolean;
	readonly name: string;
}

const once = (key: string, name: string, does: Does): Binding => ({
	key,
	does,
	repeats: false,
	name,
});

/** `C-b 1` to `C-b 9`: the workspace in that place. */
const PICKS: readonly Binding[] = Array.from({length: 9}, (_, i) =>
	once(String(i + 1), `workspace ${i + 1}`, {kind: "pick", at: i + 1}),
);

export const BINDINGS: readonly Binding[] = [
	// `|` puts the two side by side: a row, "horizontal" in the tree. `-` puts one over the other.
	once("|", "split", {kind: "split", orientation: "horizontal"}),
	once("-", "split down", {kind: "split", orientation: "vertical"}),
	once("h", "focus left", {kind: "focus", to: "left"}),
	once("j", "focus down", {kind: "focus", to: "down"}),
	once("k", "focus up", {kind: "focus", to: "up"}),
	once("l", "focus right", {kind: "focus", to: "right"}),
	once("<arrowleft>", "focus left", {kind: "focus", to: "left"}),
	once("<arrowdown>", "focus down", {kind: "focus", to: "down"}),
	once("<arrowup>", "focus up", {kind: "focus", to: "up"}),
	once("<arrowright>", "focus right", {kind: "focus", to: "right"}),
	// Space turns the container, as AeroSpace's `layout horizontal vertical`. `f` folds the tile.
	once(" ", "turn", {kind: "turn"}),
	once("f", "fold", {kind: "fold"}),
	once("z", "zoom", {kind: "zoom"}),
	once("x", "close", {kind: "close"}),
	once("N", "new", {kind: "new"}),
	{key: "<c-h>", does: {kind: "step", to: "previous"}, repeats: true, name: "previous workspace"},
	{key: "<c-l>", does: {kind: "step", to: "next"}, repeats: true, name: "next workspace"},
	...PICKS,
	// The frame's own: not a bare `?` or `i`, which would go into tsh.
	once("a", "asks", {kind: "show", what: "asks"}),
	// `J`, as `N` and `B`: the bare `j` is focus down.
	once("J", "jobs", {kind: "show", what: "jobs"}),
	once("?", "keys", {kind: "show", what: "keys"}),
	once("i", "info", {kind: "show", what: "info"}),
	once("B", "bars", {kind: "show", what: "bars"}),
	// The top bar's agents, sync and host: capitals, as `N` and `B`. `h` is focus left, and `s`
	// is tmux's session list, a key a tmux hand presses without looking.
	once("A", "agents", {kind: "show", what: "agents"}),
	once("S", "sync", {kind: "show", what: "sync"}),
	once("H", "host", {kind: "show", what: "host"}),
];

export const bindingOf = (key: string): Binding | undefined => BINDINGS.find((b) => b.key === key);

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
 * `close %n input` ends a job's input.
 */
export const wordOf = (does: Does): string => {
	switch (does.kind) {
		case "split":
			return does.orientation === "horizontal" ? "split" : "split --to down";
		case "focus":
			return `focus --to ${does.to}`;
		case "go":
			return `focus --to ${does.tile}`;
		case "turn":
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
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);

/**
 * A key's one spelling, as the table writes it: `<c-b>` for Ctrl-B, `<arrowleft>`, or the
 * character itself. `null` for a modifier pressed alone, which is no key at all: Shift goes down
 * before the `|` it makes, and must not disarm the prefix.
 */
export const keyName = (press: Press): string | null => {
	if (MODIFIERS.has(press.key)) return null;
	const named = press.key.length === 1 ? press.key : press.key.toLowerCase();
	const base = press.key.length === 1 ? named : `<${named}>`;
	if (!press.ctrl && !press.alt && !press.meta) return base;
	const bare = base.startsWith("<") ? base.slice(1, -1) : base.toLowerCase();
	const mods = `${press.ctrl ? "c-" : ""}${press.alt ? "a-" : ""}${press.meta ? "m-" : ""}`;
	return `<${mods}${bare}>`;
};

/** Who a key belongs to: the system and its menu, the app (the desk or a tile), or nobody at all. */
export type KeyOwner = "system" | "app" | "nobody";

/**
 * The Command keys that are not the Mac's. Cmd-K is the app's palette. Cmd-W is nobody's for now,
 * by the owner's choice: it types nothing and closes nothing. Its name has no Shift, so Cmd-Shift-W
 * goes with it. To give it what it should close later, change this one line.
 */
const NOT_THE_MACS: ReadonlyMap<string, KeyOwner> = new Map([
	["<m-k>", "app"],
	["<m-w>", "nobody"],
]);

/**
 * Who a key belongs to. On a Mac, Command is the system's and the menu's, as in Terminal: Cmd-Q
 * quits, whatever has focus. Everywhere else the menu's keys are Ctrl keys, and a shell needs
 * those: Ctrl-C and Ctrl-W stay with tsh.
 *
 *   keyOwner({key: "q", ctrl: false, alt: false, meta: true}, true)    "system"
 *   keyOwner({key: "k", ctrl: false, alt: false, meta: true}, true)    "app": the palette
 *   keyOwner({key: "w", ctrl: false, alt: false, meta: true}, true)    "nobody"
 *   keyOwner({key: "c", ctrl: true, alt: false, meta: false}, true)    "app": tsh's
 *   keyOwner({key: "w", ctrl: false, alt: false, meta: true}, false)   "app": not a Mac
 */
export const keyOwner = (press: Press, mac: boolean): KeyOwner => {
	if (!mac || !press.meta) return "app";
	const name = keyName(press);
	return (name === null ? undefined : NOT_THE_MACS.get(name)) ?? "system";
};
