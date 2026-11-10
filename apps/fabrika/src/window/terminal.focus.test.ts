import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// Today's version: look changes keep keys in the chosen tile, including between ghostty-web
// 0.4.0's focus timer and the app's restore timer (tracker tickets 144 and 259).

class Element extends EventTarget {
	className = "";
	textContent = "";
	parentElement: Element | null = null;
	readonly children: Element[] = [];
	setAttribute() {}

	append(...kids: Element[]) {
		for (const kid of kids) {
			kid.parentElement = this;
			this.children.push(kid);
		}
	}

	contains(at: unknown): boolean {
		return at === this || this.children.some((kid) => kid.contains(at));
	}

	remove() {
		this.parentElement = null;
	}

	focus() {
		page.activeElement = this;
	}

	blur() {
		if (page.activeElement === this) {
			page.activeElement = body;
		}
	}
}

const element = () => new Element();
const body = element();
const page = {createElement: element, activeElement: body as Element | null, body};
// One callback per turn: advancing all zero-delay timers together hides the stolen focus.
const timers: (() => void)[] = [];
const tick = () => timers.shift()?.();

const settle = () => {
	while (timers.length > 0) {
		tick();
	}
};

class FakeTerminal {
	element: Element | undefined;
	opened = false;
	cols = 80;
	rows = 24;
	readonly buffer = {active: {length: 0, cursorY: 0, getLine: () => undefined}};
	private data: (data: string) => void = () => {};

	private key = (event: Event) => {
		if ("key" in event && typeof event.key === "string") {
			this.data(event.key);
		}
	};

	loadAddon() {}

	/** As 0.4.0's open(): it ends by focusing itself, now and after a zero timeout. */
	open(parent: Element) {
		this.opened = true;
		this.element = parent;
		parent.addEventListener("keydown", this.key);
		this.focus();
	}

	focus() {
		if (!this.opened || this.element === undefined) {
			return;
		}

		this.element.focus();
		setTimeout(() => this.element?.focus(), 0);
	}

	onData(fn: (data: string) => void) {
		this.data = fn;
	}

	onResize() {}
	write() {}

	dispose() {
		this.element?.removeEventListener("keydown", this.key);
		this.element = undefined;
	}
}

class FakeFit {
	fit() {}
	observeResize() {}
}

vi.mock("ghostty-web", () => ({Terminal: FakeTerminal, FitAddon: FakeFit, Ghostty: class {}}));
vi.mock("ghostty-web/ghostty-vt.wasm", () => ({default: new Uint8Array()}));

const changes = new Set<() => void>();
const sent: {port: string; msg: unknown}[] = [];
let light = false;

const switchLook = () => {
	light = !light;

	for (const change of changes) {
		change();
	}
};

beforeEach(() => {
	page.activeElement = body;
	light = false;
	changes.clear();
	sent.length = 0;
	vi.stubGlobal("setTimeout", (fn: () => void) => timers.push(fn));
	vi.stubGlobal("document", page);
	vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
	vi.stubGlobal("window", {
		matchMedia: () => ({
			get matches() {
				return light;
			},
			addEventListener: (_: string, fn: () => void) => {
				changes.add(fn);
			},
			removeEventListener: (_: string, fn: () => void) => {
				changes.delete(fn);
			},
		}),
		fabrika: {
			send: (port: string, msg: unknown) => sent.push({port, msg}),
			forget: () => {},
			onMessage: () => {},
		},
	});
});

afterEach(() => {
	timers.length = 0;
	vi.unstubAllGlobals();
});

describe("a look change with nothing focused", () => {
	it.each([
		["the body", body],
		["null", null],
	])("keeps focus outside the tile once open()'s timeout has run, from %s", async (_, nothing) => {
		const {terminalFor} = await import("./terminal.ts");
		const tile = element();
		terminalFor({} as never, "t1" as never).attach(tile as never);
		page.activeElement = nothing;
		switchLook();
		settle();
		expect(tile.contains(page.activeElement)).toBe(false);
	});

	it("L4: a newly focused input keeps focus while restore timers run", async () => {
		await twoTiles();
		page.activeElement = body;
		switchLook();
		const input = element();
		input.focus();
		expect(page.activeElement).toBe(input);

		while (timers.length > 0) {
			tick();
			expect(page.activeElement).toBe(input);
		}
	});
});

const twoTiles = async () => {
	const {terminalFor} = await import("./terminal.ts");
	const left = element();
	const right = element();
	const other = terminalFor({} as never, "t1" as never);
	other.attach(left as never);
	const chosen = terminalFor({} as never, "t2" as never);
	chosen.attach(right as never);
	settle();
	chosen.focus();
	settle();
	expect(right.contains(page.activeElement)).toBe(true);
	sent.length = 0;
	return {left, right, other};
};

describe("a look change with the right tile focused", () => {
	it("L1: a key between any two timers reaches only the chosen tile", async () => {
		await twoTiles();
		const delivered = () => sent.filter(({msg}) => (msg as {type: string}).type === "keys");
		const type = () => {
			const event = Object.assign(new Event("keydown"), {key: "x"});
			page.activeElement?.dispatchEvent(event);
		};
		type();
		expect(delivered()).toEqual([{port: "tile:t2", msg: {type: "keys", data: "x"}}]);
		sent.length = 0;
		switchLook();
		let turns = 0;

		do {
			if (timers.length > 0) {
				tick();
				turns += 1;
			}

			type();
			expect
				.soft(delivered(), `keys after timer ${turns}`)
				.toEqual([{port: "tile:t2", msg: {type: "keys", data: "x"}}]);
			sent.length = 0;
		} while (timers.length > 0);
	});

	it("L2: no timer turn leaves activeElement inside the unfocused tile", async () => {
		const {left, right} = await twoTiles();
		switchLook();
		let turns = 0;
		const staysRight = () => {
			expect.soft(left.contains(page.activeElement), `left after timer ${turns}`).toBe(false);
			expect.soft(right.contains(page.activeElement), `right after timer ${turns}`).toBe(true);
		};
		staysRight();

		while (timers.length > 0) {
			tick();
			turns += 1;
			staysRight();
		}
	});

	it("L3: an unfocused tile can be chosen after the look change settles", async () => {
		const {left, other} = await twoTiles();
		switchLook();
		settle();
		other.focus();
		const staysLeft = () => {
			expect(left.contains(page.activeElement)).toBe(true);
			page.activeElement?.dispatchEvent(Object.assign(new Event("keydown"), {key: "x"}));
			expect(sent.filter(({msg}) => (msg as {type: string}).type === "keys")).toEqual([
				{port: "tile:t1", msg: {type: "keys", data: "x"}},
			]);
			sent.length = 0;
		};
		staysLeft();

		while (timers.length > 0) {
			tick();
			staysLeft();
		}
	});
});
