// What opens over the desk, as data: a popover's rows and sections, a key as the Mac draws it, and
// what each key does in a menu. Plain data and plain functions, no React, so each rule is tested
// (pop.test.ts); pop.tsx draws them. The rule is docs/direction/popovers.md.
//
//   capsOf("<c-b>", "a")                       ["⌃B", "A"]
//   capsOf("<c-b>", "N")                       ["⌃B", "⇧N"]
//   menuKey(stops, "1/a-1", {key: "ArrowDown"})  {do: "move", to: "2/stuck/r-1"}
//   menuKey(stops, "1/a-1", {key: "h"})          {do: "second", row: "1/a-1"}
//   menuKey(stops, "1/a-1", {key: "Escape"})     {do: "close"}
//
// A menu's rows each do something: Enter does the row's own thing, and a row may have one second
// thing, on its own key (H for Later in the asks list). A key no row shows sits in the footer.

/** One keycap, as the Mac draws it: `⌃B`, `A`, `⇧N`, `↵`, `Esc`. */
export type Cap = string;

/** The Mac's modifier glyphs, in the order the Mac writes them: Control, Option, Shift, Command. */
const MODS: Readonly<Record<string, string>> = {c: "⌃", a: "⌥", m: "⌘"};

const NAMED: Readonly<Record<string, string>> = {
	arrowleft: "←",
	arrowright: "→",
	arrowup: "↑",
	arrowdown: "↓",
	enter: "↵",
	escape: "Esc",
	tab: "⇥",
	backspace: "⌫",
};

/** A bare key as one keycap: a lowercase letter as the key's own capital, a capital with ⇧. */
const bareCap = (key: string): Cap => {
	const named = NAMED[key];
	if (named !== undefined) return named;
	if (key === " ") return "Space";
	if (/^[a-z]$/.test(key)) return key.toUpperCase();
	if (/^[A-Z]$/.test(key)) return `⇧${key}`;
	return key;
};

/**
 * A key of the desk's table (desk/keys.ts, `keyName`) as one keycap: `<c-b>` is `⌃B`, `a` is
 * `A`, `N` is `⇧N`, `<arrowleft>` is `←`, ` ` is `Space`.
 */
export const capOf = (key: string): Cap => {
	const wrapped = /^<(.+)>$/.exec(key)?.[1];
	if (wrapped === undefined) return bareCap(key);
	const parts = /^((?:[cam]-)*)(.+)$/.exec(wrapped);
	const mods = (parts?.[1] ?? "").split("-").filter(Boolean);
	const base = parts?.[2] ?? wrapped;
	const glyphs = ["c", "a", "m"].filter((m) => mods.includes(m)).map((m) => MODS[m] ?? "");
	return `${glyphs.join("")}${mods.length > 0 && base.length === 1 ? base.toUpperCase() : bareCap(base)}`;
};

/** A binding's whole key, as keycaps: the prefix, then its own key. `["⌃B", "Z"]`. */
export const capsOf = (prefix: string, key: string): readonly Cap[] => [capOf(prefix), capOf(key)];

/** A word as a title starts: its first letter a capital, the rest as written (sentence case). */
export const sentence = (text: string): string =>
	text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// ---------------------------------------------------------------- a menu's rows

/**
 * What a row's icon says. Never color alone: each is its own shape too. An ask, a stuck run, an
 * ask set aside; a job that runs, and how one ended.
 */
export type Icon = "ask" | "stuck" | "later" | "running" | "done" | "failed" | "stopped";

/** A run of a row's words. `typed`: what a person types (a command, `%1`), drawn in mono. */
export interface Piece {
	readonly text: string;
	readonly typed: boolean;
}

/** A row's words: plain text, or pieces of it, some typed. */
export type Words = string | readonly Piece[];

/** Words as one plain string: what a typed letter jumps by. */
export const textOf = (words: Words): string =>
	typeof words === "string" ? words : words.map((p) => p.text).join("");

/** A row's second thing, shown on the active row, with its own key. */
export interface Second {
	readonly name: string;
	readonly cap: Cap;
}

/** One row: one line (32px) when it has no `sub`, two lines (44px) when it has one. */
export interface Row {
	/** Its key, the same on every draw. */
	readonly id: string;
	readonly icon: Icon | null;
	/** Sentence case, unless it is typed: a command is as it was typed. */
	readonly title: Words;
	/** One muted line under the title. */
	readonly sub: Words | null;
	/** At the right: a time. The active row shows its second thing there instead. */
	readonly side: string | null;
	readonly second: Second | null;
}

/** A section of rows. `fold`: its heading folds and unfolds it, and is a stop of its own. */
export interface Section {
	readonly id: string;
	/** `null`: the menu's own rows, under its header. A title is drawn as the section's heading. */
	readonly title: string | null;
	readonly fold: boolean;
	readonly rows: readonly Row[];
}

/** One footer hint: its keycaps and what they do. */
export interface Hint {
	readonly caps: readonly Cap[];
	readonly name: string;
}

/** A place the arrows stop at: a row, or a folding section's heading. */
export type Stop =
	| {readonly kind: "row"; readonly id: string; readonly row: Row}
	| {readonly kind: "fold"; readonly id: string; readonly section: Section};

/** A folding section's heading, as a stop. */
export const foldId = (section: string): string => `fold:${section}`;

/** The stops, in order: each section's heading if it folds, then its rows unless it is folded. */
export const stopsOf = (
	sections: readonly Section[],
	folded: ReadonlySet<string>,
): readonly Stop[] =>
	sections.flatMap((s): Stop[] => [
		...(s.fold ? [{kind: "fold" as const, id: foldId(s.id), section: s}] : []),
		...(folded.has(s.id) ? [] : s.rows.map((row) => ({kind: "row" as const, id: row.id, row}))),
	]);

/** The active stop: the one named, while it is still there, else the first. */
export const activeIn = (stops: readonly Stop[], at: string | null): Stop | undefined =>
	stops.find((s) => s.id === at) ?? stops[0];

/**
 * The footer as the active row reads it: its second thing names its own key's hint, so a Later
 * row's footer says `H Bring back`, as its button does.
 */
export const hintsOf = (foot: readonly Hint[], active: Stop | undefined): readonly Hint[] => {
	const second = active?.kind === "row" ? active.row.second : null;
	if (second === null) return foot;
	return foot.map((h) =>
		h.caps.length === 1 && h.caps[0] === second.cap ? {...h, name: second.name} : h,
	);
};

/** The stop the active one moves to when its row leaves: the next, else the one before. */
export const neighborOf = (stops: readonly Stop[], id: string): string | null => {
	const i = stops.findIndex((s) => s.id === id);
	if (i === -1) return null;
	return stops[i + 1]?.id ?? stops[i - 1]?.id ?? null;
};

/** What a key does in a menu. */
export type MenuDo =
	| {readonly do: "move"; readonly to: string}
	/** Enter on a row: its own thing, and the menu closes. */
	| {readonly do: "act"; readonly row: Row}
	/** Its second thing (H in the asks list): the menu stays open. */
	| {readonly do: "second"; readonly row: Row}
	| {readonly do: "fold"; readonly section: string}
	/** Escape or Tab: closed, and focus goes back where it was. */
	| {readonly do: "close"};

/** A key, as a menu reads it: its name, and whether Ctrl, Option or Cmd was down. */
export interface MenuPress {
	readonly key: string;
	readonly mods?: boolean;
}

/** The title a stop is found by when a letter is typed. */
const titleOf = (s: Stop): string =>
	s.kind === "row" ? textOf(s.row.title) : (s.section.title ?? "");

/**
 * What a key does in a menu, by WAI-ARIA's menu pattern and Linear's Inbox: the arrows (and J,
 * K) move, wrapping; Home and End go to the ends; Enter acts; H does the row's second thing;
 * Escape and Tab close; any other letter jumps to the next row whose title starts with it.
 * `null`: the key does nothing here.
 */
export const menuKey = (
	stops: readonly Stop[],
	at: string | null,
	press: MenuPress,
): MenuDo | null => {
	if (press.key === "Escape" || press.key === "Tab") return {do: "close"};
	if (press.mods === true) return null;
	const active = activeIn(stops, at);
	if (active === undefined) return null;
	const i = stops.indexOf(active);
	const to = (j: number): MenuDo | null => {
		const s = stops[(j + stops.length) % stops.length];
		return s === undefined ? null : {do: "move", to: s.id};
	};
	switch (press.key) {
		case "ArrowDown":
		case "j":
			return to(i + 1);
		case "ArrowUp":
		case "k":
			return to(i - 1);
		case "Home":
			return to(0);
		case "End":
			return to(stops.length - 1);
		case "Enter":
			return active.kind === "row"
				? {do: "act", row: active.row}
				: {do: "fold", section: active.section.id};
		case "h":
		case "H":
			return active.kind === "row" && active.row.second !== null
				? {do: "second", row: active.row}
				: null;
	}
	if (!/^\p{L}$/u.test(press.key)) return null;
	const letter = press.key.toLowerCase();
	for (let step = 1; step <= stops.length; step += 1) {
		const s = stops[(i + step) % stops.length];
		if (s !== undefined && titleOf(s).toLowerCase().startsWith(letter))
			return {do: "move", to: s.id};
	}
	return null;
};

// ---------------------------------------------------------------- the palette

/** A run of a command's name: drawn bold when `mark`, where it matched what was typed. */
export interface Run {
	readonly text: string;
	readonly mark: boolean;
}

/** A name in runs: the first place each typed word matches is marked. */
export const marked = (name: string, query: string): readonly Run[] => {
	const lower = name.toLowerCase();
	const on = new Array<boolean>(name.length).fill(false);
	for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
		const at = lower.indexOf(word);
		if (at !== -1) on.fill(true, at, at + word.length);
	}
	const runs: Run[] = [];
	for (let i = 0; i < name.length; i += 1) {
		const last = runs.at(-1);
		const mark = on[i] === true;
		if (last !== undefined && last.mark === mark)
			runs[runs.length - 1] = {text: last.text + name.charAt(i), mark};
		else runs.push({text: name.charAt(i), mark});
	}
	return runs;
};

// ---------------------------------------------------------------- tooltips

/** How long the pointer rests before a tooltip shows, in ms, as Radix waits. */
const TIP_WAIT = 700;
/** Within this long of one tooltip going, the next shows at once, as Radix skips the wait. */
const TIP_SKIP = 300;

/** How long a tooltip waits before it shows, `now` and the last one gone in ms. */
export const tipWait = (now: number, lastGone: number | null): number =>
	lastGone !== null && now - lastGone < TIP_SKIP ? 0 : TIP_WAIT;
