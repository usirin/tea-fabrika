// Key routing for a window, next/ (Tier 1, P14). A key goes to the focused tile only: the shared
// table says which command it is, and the tile's program says whether it takes that command. A
// printable key never acts without a focused tile (WCAG 2.1.4), and the table can rebind or unbind
// every one. The browser's own event becomes plain data here, so the rules run on Node too.
import {type Armed, commandMsg, type KeyEvent, Keys, type Table} from "@kampus/libfabrika";

/** What a DOM keyboard event says, read once at the edge. */
type DomKey = {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly isComposing: boolean;
	readonly target: unknown;
};

const editable = (target: unknown): boolean => {
	if (typeof target !== "object" || target === null) {return false;}

	const element = target as {readonly tagName?: unknown; readonly isContentEditable?: unknown};
	const tag = typeof element.tagName === "string" ? element.tagName.toLowerCase() : "";
	return (
		element.isContentEditable === true || tag === "input" || tag === "textarea" || tag === "select"
	);
};

/** A browser key event as the table's rules read it. */
export const keyEvent = (e: DomKey): KeyEvent => ({
	key: e.key,
	shift: e.shiftKey,
	ctrl: e.ctrlKey,
	alt: e.altKey,
	meta: e.metaKey,
	composing: e.isComposing || e.key === "Process",
	editable: editable(e.target),
});

/**
 * Routes one key event to the focused tile: the new armed prefix, and the press it makes, if any.
 * `commands` names what the focused tile's program takes; a command outside it does nothing there.
 */
export const routeKey = (a: {
	readonly table: Table;
	readonly armed: Armed | null;
	readonly event: KeyEvent;
	readonly tile: {readonly id: string; readonly pid: string} | null;
	readonly commands: ReadonlyArray<string>;
}): {
	readonly armed: Armed | null;
	readonly press: {
		readonly pid: string;
		readonly m: {readonly type: string};
		readonly command: string;
	} | null;
	readonly taken: boolean;
} => {
	if (a.tile === null) {return {armed: null, press: null, taken: false};}

	const {armed, out} = Keys.matchKey(a.table, a.armed, a.event);

	if (out._tag === "prefix") {return {armed, press: null, taken: true};}

	if (out._tag !== "command" || !a.commands.includes(out.command))
		{return {armed, press: null, taken: false};}

	const m = commandMsg(out.command);
	return m === null
		? {armed, press: null, taken: false}
		: {armed, press: {pid: a.tile.pid, m, command: out.command}, taken: true};
};
