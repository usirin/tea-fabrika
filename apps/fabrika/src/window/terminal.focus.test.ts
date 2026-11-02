import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// When nothing had focus before a look change, a remade terminal does not keep the focus
// ghostty-web 0.4's open() gives it (at once, and again after a zero timeout): keys typed next
// must not land in a tile nobody picked (tracker ticket 144). ghostty-web is faked as 0.4.0
// behaves; terminal.test.ts holds the other focus cases.

/** The page: its body, and which element has focus. */
const body = {name: "body"};
const page: {createElement: () => object; activeElement: unknown; body: object} = {
	createElement: () => element(),
	activeElement: body,
	body,
};

const element = (): Record<string, unknown> => {
	const el: Record<string, unknown> = {
		className: "",
		textContent: "",
		parentElement: null,
		setAttribute: () => {},
		append: (...kids: Record<string, unknown>[]) => {
			for (const kid of kids) kid["parentElement"] = el;
		},
		remove: () => {},
		focus: () => {
			page.activeElement = el;
		},
		blur: () => {
			if (page.activeElement === el) page.activeElement = body;
		},
	};
	return el;
};

const timers: ReturnType<typeof setTimeout>[] = [];

class FakeTerminal {
	element: {focus: () => void} | undefined;
	opened = false;
	cols = 80;
	rows = 24;
	readonly buffer = {active: {length: 0, cursorY: 0, getLine: () => undefined}};
	loadAddon() {}
	/** As 0.4.0's open(): it ends by focusing itself, now and after a zero timeout. */
	open(parent: {focus: () => void}) {
		this.opened = true;
		this.element = parent;
		this.focus();
	}
	focus() {
		const at = this.element;
		if (at === undefined) return;
		at.focus();
		timers.push(setTimeout(() => at.focus(), 0));
	}
	onData() {}
	onResize() {}
	write() {}
	dispose() {}
}

class FakeFit {
	fit() {}
	observeResize() {}
}

vi.mock("ghostty-web", () => ({Terminal: FakeTerminal, FitAddon: FakeFit, Ghostty: class {}}));
vi.mock("ghostty-web/ghostty-vt.wasm", () => ({default: new Uint8Array()}));

let change: (() => void) | undefined;
let light = false;

beforeEach(() => {
	page.activeElement = body;
	light = false;
	vi.stubGlobal("document", page);
	vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
	vi.stubGlobal("window", {
		matchMedia: () => ({
			get matches() {
				return light;
			},
			addEventListener: (_: string, fn: () => void) => {
				change = fn;
			},
			removeEventListener: () => {},
		}),
		fabrika: {send: () => {}, forget: () => {}, onMessage: () => {}},
	});
});

afterEach(() => {
	for (const timer of timers) clearTimeout(timer);
	timers.length = 0;
	vi.unstubAllGlobals();
});

const settled = () => new Promise((done) => setTimeout(done, 0));

describe("a look change with nothing focused", () => {
	it("leaves nothing focused once open()'s timeout has run", async () => {
		const {terminalFor} = await import("./terminal.ts");
		terminalFor({} as never, "t1" as never).attach(element() as never);
		page.activeElement = body;
		light = true;
		change?.();
		await settled();
		expect(page.activeElement).toBe(body);
	});
});
