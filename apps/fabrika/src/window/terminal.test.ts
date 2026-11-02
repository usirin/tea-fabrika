import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fabrika, fabrikaLight, terminalTheme} from "../themes.ts";

// A terminal follows the system's look while it is open (tracker ticket 144). The window's
// stylesheet follows it with light-dark(); a terminal draws on a canvas, so it must be told.
//
// ghostty-web is faked here as 0.4.0 behaves: a terminal draws in the theme it was made with, and
// a theme set on its options after open() is not drawn ("theme changes after open() are not yet
// fully supported", its handleOptionChange). So, until a palette call lands upstream, a look change
// means a terminal made again in the new theme, with what it showed written to it again, as
// docs/direction/themes.md (live switching) says. If a pnpm patch to ghostty-web makes a live change
// real, this fake changes with it.

class FakeTerminal {
	static made: FakeTerminal[] = [];
	/** The theme this terminal draws in: the one it was made with. */
	readonly drawn: unknown;
	readonly options: Record<string, unknown>;
	readonly written: string[] = [];
	opened = false;
	disposed = false;
	cols = 80;
	rows = 24;
	readonly buffer = {active: {length: 0, cursorY: 0, getLine: () => undefined}};
	constructor(options: Record<string, unknown>) {
		this.options = {...options};
		this.drawn = options["theme"];
		FakeTerminal.made.push(this);
	}
	loadAddon() {}
	open() {
		this.opened = true;
	}
	onData() {
		return {dispose: () => {}};
	}
	onResize() {
		return {dispose: () => {}};
	}
	write(data: string, done?: () => void) {
		this.written.push(data);
		done?.();
	}
	reset() {
		this.written.length = 0;
	}
	clear() {}
	refresh() {}
	resize() {}
	scrollToBottom() {}
	focus() {}
	dispose() {
		this.disposed = true;
	}
}

class FakeFit {
	activate() {}
	fit() {}
	observeResize() {}
	dispose() {}
}

vi.mock("ghostty-web", () => ({Terminal: FakeTerminal, FitAddon: FakeFit, Ghostty: class {}}));
vi.mock("ghostty-web/ghostty-vt.wasm", () => ({default: new Uint8Array()}));

/** Just enough of an element for terminal.ts to build and move its own. */
const element = (): Record<string, unknown> => {
	const el: Record<string, unknown> = {
		className: "",
		textContent: "",
		style: {},
		parentElement: null,
		children: [] as unknown[],
		setAttribute: () => {},
		append: (...kids: Record<string, unknown>[]) => {
			for (const kid of kids) kid["parentElement"] = el;
		},
		remove: () => {
			el["parentElement"] = null;
		},
	};
	return el;
};

/** The system's look, and every query list made on it, as a browser's matchMedia gives them. */
let look: "dark" | "light" = "dark";
const lists: {query: string; heard: ((e: {matches: boolean}) => void)[]; list: object}[] = [];
const matches = (query: string) =>
	query.includes("light") ? look === "light" : query.includes("dark") ? look === "dark" : false;
const matchMedia = (query: string) => {
	const heard: ((e: {matches: boolean}) => void)[] = [];
	const list = {
		media: query,
		get matches() {
			return matches(query);
		},
		onchange: null as ((e: {matches: boolean}) => void) | null,
		addEventListener: (_: string, fn: (e: {matches: boolean}) => void) => heard.push(fn),
		removeEventListener: (_: string, fn: (e: {matches: boolean}) => void) => {
			const at = heard.indexOf(fn);
			if (at >= 0) heard.splice(at, 1);
		},
		addListener: (fn: (e: {matches: boolean}) => void) => heard.push(fn),
		removeListener: (fn: (e: {matches: boolean}) => void) => {
			const at = heard.indexOf(fn);
			if (at >= 0) heard.splice(at, 1);
		},
	};
	lists.push({query, heard, list});
	return list;
};
const switchTo = (next: "dark" | "light") => {
	look = next;
	for (const {query, heard, list} of lists) {
		const event = {matches: matches(query), media: query};
		for (const fn of [...heard]) fn(event);
		(list as {onchange: ((e: {matches: boolean}) => void) | null}).onchange?.(event);
	}
};

/** What the tile's port heard, so a test can send it bytes. */
let toTile: ((raw: unknown) => void) | undefined;

beforeEach(() => {
	look = "dark";
	lists.length = 0;
	FakeTerminal.made = [];
	toTile = undefined;
	vi.stubGlobal("document", {createElement: element});
	vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
	vi.stubGlobal("window", {
		matchMedia,
		fabrika: {
			send: () => {},
			forget: () => {},
			onMessage: (_: string, fn: (raw: unknown) => void) => {
				toTile = fn;
			},
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A tile's terminal, open in its slot, that has shown `hello`. */
const openTerminal = async () => {
	const {terminalFor} = await import("./terminal.ts");
	const term = terminalFor({} as never, "t1" as never);
	term.attach(element() as never);
	toTile?.({type: "write", data: "hello"});
	return term;
};

/** The terminals open now and not disposed: what the tile shows. */
const showing = () => FakeTerminal.made.filter((t) => t.opened && !t.disposed);

describe("an open terminal follows the system's look", () => {
	it("is made in the system's look", async () => {
		await openTerminal();
		expect(showing().map((t) => t.drawn)).toEqual([terminalTheme(fabrika)]);
	});

	it("draws in fabrika-light once the system turns light, one terminal, still showing its text", async () => {
		await openTerminal();
		switchTo("light");
		expect(showing().map((t) => t.drawn)).toEqual([terminalTheme(fabrikaLight)]);
		expect(showing()[0]?.written.join("")).toContain("hello");
	});

	it("goes back to fabrika when the system turns dark again", async () => {
		look = "light";
		await openTerminal();
		switchTo("dark");
		expect(showing().map((t) => t.drawn)).toEqual([terminalTheme(fabrika)]);
	});

	it("stops listening once disposed", async () => {
		const term = await openTerminal();
		term.dispose();
		const before = FakeTerminal.made.length;
		switchTo("light");
		expect({made: FakeTerminal.made.length - before, showing: showing().length}).toEqual({
			made: 0,
			showing: 0,
		});
	});
});
