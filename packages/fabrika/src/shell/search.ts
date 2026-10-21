// Ctrl-R: search the history backwards, as bash's reverse-i-search does.
// Node's readline has history and editing but no search, so the launcher
// catches Ctrl-R before readline sees it and runs this. Pure: a key in, the
// search after it out, so a test runs it with strings.
//
//   Ctrl-R              start; again: the next older line that matches
//   a letter            the query grows; the newest line that has it is shown
//   Backspace           the query shrinks
//   Enter               run the line found
//   Esc, Ctrl-G, Ctrl-C leave it; the line typed before is back
//   anything else       take the line found to edit, and that key goes on to readline

export interface Search {
	readonly query: string;
	/** Where the line found is in the history, newest first. `-1`: none. */
	readonly at: number;
}

export const begin: Search = {query: "", at: -1};

export type Key =
	| {readonly kind: "text"; readonly text: string}
	| {readonly kind: "back"}
	| {readonly kind: "again"}
	| {readonly kind: "run"}
	| {readonly kind: "cancel"}
	/** A key that ends the search and goes on to readline: an arrow, Ctrl-A, Tab. */
	| {readonly kind: "other"; readonly raw: string};

/**
 * What the terminal sent in one chunk, cut into keys: one character each,
 * but an escape sequence (an arrow: `ESC [ A`) whole. Typed fast or pasted,
 * a chunk holds many.
 */
export function keysIn(raw: string): readonly string[] {
	const keys: string[] = [];
	const chars = [...raw];
	for (let i = 0; i < chars.length; i += 1) {
		const c = chars[i] as string;
		if (c !== "\x1b" || i + 1 >= chars.length) {
			keys.push(c);
			continue;
		}
		const next = chars[i + 1];
		if (next !== "[" && next !== "O") {
			keys.push(c);
			continue;
		}
		// ESC [ then parameters (digits, ;) then one final letter or ~.
		let end = i + 2;
		while (end < chars.length && /[0-9;]/.test(chars[end] as string)) end += 1;
		keys.push(chars.slice(i, end + 1).join(""));
		i = end;
	}
	return keys;
}

/** One key, in raw mode, as what it does in a search. */
export function keyOf(raw: string): Key {
	if (raw === "\x12") return {kind: "again"};
	if (raw === "\r" || raw === "\n") return {kind: "run"};
	if (raw === "\x7f" || raw === "\b") return {kind: "back"};
	if (raw === "\x1b" || raw === "\x07" || raw === "\x03") return {kind: "cancel"};
	if (raw !== "" && [...raw].every((c) => c >= " " && c !== "\x7f"))
		return {kind: "text", text: raw};
	return {kind: "other", raw};
}

/** The newest line at or after `from` (newest first) that has `query` in it. */
export function find(history: readonly string[], query: string, from: number): number {
	if (query === "") return -1;
	for (let i = Math.max(0, from); i < history.length; i += 1)
		if (history[i]?.includes(query)) return i;
	return -1;
}

export type Stepped =
	| {readonly kind: "searching"; readonly search: Search}
	/** The search is over. `line`: what is on the line now (`null`: what was typed before). `run`: Enter it. `replay`: the key that ended it, for readline to act on. */
	| {
			readonly kind: "done";
			readonly line: string | null;
			readonly run: boolean;
			readonly replay: string | null;
	  };

export function step(history: readonly string[], search: Search, key: Key): Stepped {
	const found = search.at === -1 ? null : (history[search.at] ?? null);
	switch (key.kind) {
		case "text": {
			const query = search.query + key.text;
			// The line found still has the longer query: stay on it, as bash does.
			const at = found?.includes(query) ? search.at : find(history, query, 0);
			return {kind: "searching", search: {query, at}};
		}
		case "back": {
			const query = search.query.slice(0, -1);
			return {kind: "searching", search: {query, at: find(history, query, 0)}};
		}
		case "again": {
			const next = find(history, search.query, search.at + 1);
			return {kind: "searching", search: {query: search.query, at: next === -1 ? search.at : next}};
		}
		case "run":
			return {kind: "done", line: found, run: found !== null, replay: null};
		case "cancel":
			return {kind: "done", line: null, run: false, replay: null};
		case "other":
			return {kind: "done", line: found, run: false, replay: key.raw};
	}
}

/** What the search line shows. */
export const shown = (history: readonly string[], search: Search): string => {
	const found = search.at === -1 ? "" : (history[search.at] ?? "");
	const failing = search.query !== "" && search.at === -1 ? "failing " : "";
	return `(${failing}reverse-i-search)\`${search.query}': ${found}`;
};
