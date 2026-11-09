import {EventEmitter} from "node:events";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {fabrika, fabrikaLight, followLook, frameColor} from "./themes.ts";

// The window's frame, what shows before the page draws and behind it as it resizes, is the desk's
// color in the system's look, and it follows a look change while the window is open (ticket 144).
// Electron is faked as it behaves: nativeTheme says `updated` when the look changes, and a window
// says `closed` once, after which it takes no more calls.

const fakeLook = (dark: boolean) => {
	const events = new EventEmitter();
	return {
		shouldUseDarkColors: dark,
		on: (event: "updated", fn: () => void) => events.on(event, fn),
		off: (event: "updated", fn: () => void) => events.off(event, fn),
		turn(next: boolean) {
			this.shouldUseDarkColors = next;
			events.emit("updated");
		},
		get listeners() {
			return events.listenerCount("updated");
		},
	};
};

const fakeWindow = () => {
	const painted: string[] = [];
	const events = new EventEmitter();
	return {
		painted,
		setBackgroundColor: (color: string) => {
			painted.push(color);
		},
		once: (event: "closed", fn: () => void) => events.once(event, fn),
		close: () => events.emit("closed"),
	};
};

describe("the window's frame takes the desk's color in the system's look", () => {
	it("is fabrika's desk in dark and fabrika-light's in light", () => {
		expect(frameColor({shouldUseDarkColors: true})).toBe(fabrika.colors["surface-sunken"]);
		expect(frameColor({shouldUseDarkColors: false})).toBe(fabrikaLight.colors["surface-sunken"]);
	});

	it("follows the look while the window is open", () => {
		const look = fakeLook(true);
		const window = fakeWindow();
		followLook(look, window);
		look.turn(false);
		look.turn(true);
		expect(window.painted).toEqual([
			fabrikaLight.colors["surface-sunken"],
			fabrika.colors["surface-sunken"],
		]);
	});

	it("stops listening once the window has closed", () => {
		const look = fakeLook(true);
		const window = fakeWindow();
		followLook(look, window);
		window.close();
		look.turn(false);
		expect({painted: window.painted, listeners: look.listeners}).toEqual({
			painted: [],
			listeners: 0,
		});
	});

	// Law 15 of the P31 plan: for any start look, any run of look changes, and the window's close
	// at any point in it, the frame is painted the desk of each look changed to before the close,
	// nothing after, and no listener is left once it closed.
	it("for any looks and any close, paints each change before the close and nothing after", () => {
		fc.assert(
			fc.property(
				fc.boolean(),
				fc.array(fc.boolean(), {maxLength: 20}),
				fc.nat({max: 20}),
				(start, changes, closeAt) => {
					const look = fakeLook(start);
					const window = fakeWindow();
					followLook(look, window);
					const cut = Math.min(closeAt, changes.length);
					for (const dark of changes.slice(0, cut)) look.turn(dark);
					window.close();
					for (const dark of changes.slice(cut)) look.turn(dark);
					expect({painted: window.painted, listeners: look.listeners}).toEqual({
						painted: changes
							.slice(0, cut)
							.map((dark) => (dark ? fabrika : fabrikaLight).colors["surface-sunken"]),
						listeners: 0,
					});
				},
			),
			{seed: 119120, numRuns: 200},
		);
	});
});

// T343 review 2, class 1: frame repaint follows the applied theme. Contract for build:
// `followLook(look, window)` returns `{apply(theme | null)}`. A named theme paints its own
// surface-sunken and wins over later OS look changes; `null` (no theme, or forced colors) goes back
// to following the OS with fabrika's built-ins. Nothing is painted after close and no listener
// stays. Plants: keep painting the OS look over a named theme; paint after close.
describe("T24 the frame takes the applied theme", () => {
	it("paints each applied theme, ignores the OS while one is applied, and stops at close", async () => {
		const {decodable} = await import("@kampus/themes-fixture/laws");
		const op = fc.oneof(
			fc.boolean().map((dark) => ({os: dark})),
			fc.option(decodable, {nil: null}).map((theme) => ({theme})),
		);
		fc.assert(
			fc.property(
				fc.boolean(),
				fc.array(op, {maxLength: 16}),
				fc.nat({max: 16}),
				(start, ops, at) => {
					const look = fakeLook(start);
					const window = fakeWindow();
					const followed: unknown = followLook(look, window);
					const apply = applyOf(followed);
					expect(apply).toBeTypeOf("function");
					const want: string[] = [];
					let applied: {colors: {"surface-sunken": string}} | null = null;
					let dark = start;
					ops.forEach((o, i) => {
						if (i === at) window.close();
						const open = i < at;
						if ("os" in o) {
							dark = o.os;
							look.turn(o.os);
							if (open && applied === null)
								want.push((dark ? fabrika : fabrikaLight).colors["surface-sunken"]);
						} else {
							applied = o.theme;
							apply?.(o.theme);
							if (open)
								want.push((applied ?? (dark ? fabrika : fabrikaLight)).colors["surface-sunken"]);
						}
					});
					if (at >= ops.length) window.close();
					expect(window.painted).toEqual(want);
					expect(look.listeners).toBe(0);
				},
			),
			{seed: 119120, numRuns: 200},
		);
	});
});

/** `followLook`'s returned `apply`, when it has one (build's change; today it returns nothing). */
const applyOf = (
	followed: unknown,
): ((theme: {colors: {"surface-sunken": string}} | null) => void) | undefined => {
	const apply: unknown =
		typeof followed === "object" && followed !== null ? Reflect.get(followed, "apply") : undefined;
	return typeof apply === "function"
		? (theme) => {
				Reflect.apply(apply, followed, [theme]);
			}
		: undefined;
};
