// What the harness needs from each library: the same few things apps/fabrika's terminal.ts uses.
//
//   const term = await mount(slot);
//   term.onData((keys) => echo(keys));   // keys pressed, as bytes for the pty
//   term.write("tsh$ ");                  // bytes from the pty
//   term.rows();                          // the screen as text, by the library's own API
//   term.onDrawn(() => check());          // the library just drew: the best hook each one has

/** The app's own look (apps/fabrika/src/window/terminal.ts). */
export const THEME = {background: "#16181d", foreground: "#d8dce4", cursor: "#3b82f6"};
export const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const FONT_SIZE = 13;
export const SCROLLBACK = 1000;

export interface Term {
	readonly write: (data: string) => void;
	readonly onData: (f: (data: string) => void) => void;
	readonly focus: () => void;
	/** The rows on screen, top to bottom, as text. */
	readonly rows: () => string[];
	/** Called each time the library draws. */
	readonly onDrawn: (f: () => void) => void;
	/** What `onDrawn` hooks, in words. */
	readonly drawn: string;
}

/** `variant` picks a library's option the experiment compares, such as a steady cursor. */
export type Mount = (slot: HTMLElement, variant: string) => Promise<Term>;

/** Listeners, called in order. */
export const listeners = <A extends unknown[]>() => {
	const all: ((...a: A) => void)[] = [];
	return {
		add: (f: (...a: A) => void) => {
			all.push(f);
		},
		fire: (...a: A) => {
			for (const f of all) f(...a);
		},
	};
};
