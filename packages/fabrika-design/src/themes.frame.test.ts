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
		expect(frameColor({shouldUseDarkColors: true})).toBe(fabrika.colors.desk);
		expect(frameColor({shouldUseDarkColors: false})).toBe(fabrikaLight.colors.desk);
	});

	it("follows the look while the window is open", () => {
		const look = fakeLook(true);
		const window = fakeWindow();
		followLook(look, window);
		look.turn(false);
		look.turn(true);
		expect(window.painted).toEqual([fabrikaLight.colors.desk, fabrika.colors.desk]);
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

					for (const dark of changes.slice(0, cut)) {
						look.turn(dark);
					}

					window.close();

					for (const dark of changes.slice(cut)) {
						look.turn(dark);
					}

					expect({painted: window.painted, listeners: look.listeners}).toEqual({
						painted: changes
							.slice(0, cut)
							.map((dark) => (dark ? fabrika : fabrikaLight).colors.desk),
						listeners: 0,
					});
				},
			),
			{seed: 119120, numRuns: 200},
		);
	});
});
