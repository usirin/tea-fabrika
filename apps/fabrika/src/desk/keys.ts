import type {Direction, Orientation} from "./layout/index.ts";

// The desk's keys: the prefix, and what each key after it does. tmux's shape, and Tuval's table
// (kamp-us/phoenix, packages/tuval-ui/src/shell/keys/table.ts): with the prefix not armed, every
// key belongs to the focused tile. Plain data; the desk machine reads it (desk.ts).
//
//   keyName({key: "b", ctrl: true, alt: false, meta: false})    "<c-b>"
//   keyName({key: "|", ctrl: false, alt: false, meta: false})   "|"
//   keyName({key: "Shift", ...})                                null: a modifier alone is no key
//   bindingOf("|")                                              {key: "|", does: {kind: "split", ...}}
//
// Left out of Tuval's table for now, and listed in the README as later: `w` (pick a tile),
// `a` (focus the list), `:` (a command line), `r` (reload the config), `p` (the process board).

/** The key that arms the desk, as tmux's `prefix`. */
export const PREFIX = "<c-b>";

/** How long a repeatable key leaves the prefix armed, as tmux's `repeat-time`, in milliseconds. */
export const REPEAT_MS = 500;

/** What a key after the prefix does. */
export type Does =
	| {readonly kind: "split"; readonly orientation: Orientation}
	| {readonly kind: "focus"; readonly to: Direction}
	/** Turn the container holding the focused tile: horizontal to vertical and back. */
	| {readonly kind: "turn"}
	/** Fold the focused tile into a strip; focus goes to the next open tile. */
	| {readonly kind: "fold"}
	| {readonly kind: "zoom"}
	| {readonly kind: "close"}
	| {readonly kind: "new"}
	| {readonly kind: "step"; readonly to: "previous" | "next"};

/** One binding: the key after the prefix, what it does, and whether it repeats (tmux's `bind -r`). */
export interface Binding {
	readonly key: string;
	readonly does: Does;
	readonly repeats: boolean;
}

const once = (key: string, does: Does): Binding => ({key, does, repeats: false});

export const BINDINGS: readonly Binding[] = [
	// `|` puts the two side by side: a row, "horizontal" in the tree. `-` puts one over the other.
	once("|", {kind: "split", orientation: "horizontal"}),
	once("-", {kind: "split", orientation: "vertical"}),
	once("h", {kind: "focus", to: "left"}),
	once("j", {kind: "focus", to: "down"}),
	once("k", {kind: "focus", to: "up"}),
	once("l", {kind: "focus", to: "right"}),
	once("<arrowleft>", {kind: "focus", to: "left"}),
	once("<arrowdown>", {kind: "focus", to: "down"}),
	once("<arrowup>", {kind: "focus", to: "up"}),
	once("<arrowright>", {kind: "focus", to: "right"}),
	// Space turns the container, as AeroSpace's `layout horizontal vertical`. `f` folds the tile.
	once(" ", {kind: "turn"}),
	once("f", {kind: "fold"}),
	once("z", {kind: "zoom"}),
	once("x", {kind: "close"}),
	once("N", {kind: "new"}),
	{key: "<c-h>", does: {kind: "step", to: "previous"}, repeats: true},
	{key: "<c-l>", does: {kind: "step", to: "next"}, repeats: true},
];

export const bindingOf = (key: string): Binding | undefined => BINDINGS.find((b) => b.key === key);

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
