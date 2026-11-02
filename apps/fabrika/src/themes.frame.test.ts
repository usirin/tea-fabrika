import {describe, expect, it} from "vitest";
import {fabrika, fabrikaLight, followLook, frameColor} from "./themes.ts";

// The window's frame, what shows before the page draws and behind it as it resizes, is the desk's
// color in the system's look, and it follows a look change while the window is open (ticket 144).
// Electron is faked as it behaves: nativeTheme says `updated` when the look changes, and a window
// says `closed` once, after which it takes no more calls.

const fakeLook = (dark: boolean) => {
	const heard = new Set<() => void>();
	return {
		shouldUseDarkColors: dark,
		on: (_: "updated", fn: () => void) => heard.add(fn),
		off: (_: "updated", fn: () => void) => heard.delete(fn),
		turn(next: boolean) {
			this.shouldUseDarkColors = next;
			for (const fn of [...heard]) fn();
		},
		heard,
	};
};

const fakeWindow = () => {
	const painted: string[] = [];
	let onClosed: (() => void) | undefined;
	return {
		painted,
		setBackgroundColor: (color: string) => {
			painted.push(color);
		},
		once: (_: "closed", fn: () => void) => {
			onClosed = fn;
		},
		close: () => onClosed?.(),
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
		expect({painted: window.painted, listeners: look.heard.size}).toEqual({
			painted: [],
			listeners: 0,
		});
	});
});
