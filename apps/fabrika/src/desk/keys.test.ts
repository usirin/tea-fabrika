import {describe, expect, it} from "vitest";
import {keyOwner, type Press} from "./keys.ts";

// Who a key belongs to before the desk or a tile hears it. On a Mac, Command is the system's and
// the menu's: a terminal never reads it. Everywhere, Ctrl is the shell's.

const press = (key: string, mods: Partial<Omit<Press, "key">> = {}): Press => ({
	key,
	ctrl: false,
	alt: false,
	meta: false,
	...mods,
});
const cmd = (key: string, mods: Partial<Omit<Press, "key" | "meta">> = {}) =>
	press(key, {...mods, meta: true});

describe("keyOwner, on a Mac", () => {
	it.each([
		["Cmd-Q, quit", cmd("q")],
		["Cmd-H, hide", cmd("h")],
		["Cmd-M, minimize", cmd("m")],
		["Cmd-comma, settings", cmd(",")],
		["Cmd-backtick, the next window", cmd("`")],
		["Cmd-C, copy", cmd("c")],
		["Cmd-V, paste", cmd("v")],
		["Cmd-A, select all", cmd("a")],
		["Cmd-R, reload", cmd("r")],
		// With Shift, the event's key is the capital.
		["Cmd-Shift-Z, redo", cmd("Z")],
		["Cmd-Shift-R, force reload", cmd("R")],
		["Cmd-Alt-H, hide others", cmd("˙", {alt: true})],
		["Ctrl-Cmd-F, full screen", cmd("f", {ctrl: true})],
		["Cmd-Left", cmd("ArrowLeft")],
		["Cmd alone", cmd("Meta")],
	])("%s is the system's", (_, key) => {
		expect(keyOwner(key, true)).toBe("system");
	});

	it("Cmd-K, the palette, stays in the app", () => {
		expect(keyOwner(cmd("k"), true)).toBe("app");
	});

	it.each([
		["Cmd-W", cmd("w")],
		// With Shift the key is the capital, and its name is the same `<m-w>`.
		["Cmd-Shift-W", cmd("W")],
	])("%s does nothing, by the owner's choice for now", (_, key) => {
		expect(keyOwner(key, true)).toBe("nobody");
	});

	it.each([
		["Cmd-Alt-W", cmd("∑", {alt: true})],
		["Ctrl-Cmd-W", cmd("w", {ctrl: true})],
	])("%s is another key, and the system's", (_, key) => {
		expect(keyOwner(key, true)).toBe("system");
	});

	it.each([
		["a letter", press("q")],
		["a capital", press("Q")],
		["Enter", press("Enter")],
		["Ctrl-C", press("c", {ctrl: true})],
		["Ctrl-D", press("d", {ctrl: true})],
		["Ctrl-Q", press("q", {ctrl: true})],
		["Ctrl-W", press("w", {ctrl: true})],
		["Ctrl-B, the prefix", press("b", {ctrl: true})],
		["Ctrl-H, the previous workspace after the prefix", press("h", {ctrl: true})],
		["the prefix's own keys", press("|")],
		["Alt-B, readline's back a word", press("∫", {alt: true})],
		["Shift alone", press("Shift")],
	])("%s stays in the app", (_, key) => {
		expect(keyOwner(key, true)).toBe("app");
	});
});

describe("keyOwner, on Windows and Linux", () => {
	it.each([
		["Ctrl-C", press("c", {ctrl: true})],
		["Ctrl-D", press("d", {ctrl: true})],
		["Ctrl-Q", press("q", {ctrl: true})],
		["Ctrl-W", press("w", {ctrl: true})],
		["Ctrl-Shift-R", press("R", {ctrl: true})],
		["a letter", press("q")],
		// The Windows or Super key is not Command: nothing changes for it there.
		["Super-Q", cmd("q")],
		["Super-W", cmd("w")],
	])("%s stays in the app", (_, key) => {
		expect(keyOwner(key, false)).toBe("app");
	});
});
