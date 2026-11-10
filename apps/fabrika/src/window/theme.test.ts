import {isDeepStrictEqual} from "node:util";
import {fabrika} from "@kampus/fabrika-design";
import {Effect} from "effect";
import fc from "fast-check";
// Today's app, T343 PR 1. Real ghostty renderer, with canvas calls recorded.
// Plant: check the default background; swap before inverse; apply faint after correction.
import {CanvasRenderer, CellFlags} from "ghostty-web";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
	channels,
	composite,
	hex,
	rgbHex,
	RUNS,
	solid,
	wcag,
} from "../../../../fixtures/themes/laws.ts";

type Cell = {
	codepoint: number;
	width: number;
	flags: number;
	fg_r: number;
	fg_g: number;
	fg_b: number;
	bg_r: number;
	bg_g: number;
	bg_b: number;
	grapheme_len: number;
	hyperlink_id: number;
};
interface Renderer {
	ctx: {fillStyle: string; globalAlpha: number; font: string; fillText: () => void};
	theme: {background: string; selectionBackground: string; selectionForeground: string};
	metrics: {width: number; height: number; baseline: number};
	fontSize: number;
	fontFamily: string;
	isInSelection: () => boolean;
	correctForeground?: (fg: string, bg: string) => string;
	renderCellText: (cell: Cell, x: number, y: number) => void;
}

describe("T18 per-cell correction", () => {
	it("checks the final drawn foreground and background after selection, inverse and faint", () => {
		fc.assert(
			fc.property(
				fc.record({
					foreground: solid,
					background: solid,
					base: solid,
					selection: hex,
					selectedInk: solid,
					selected: fc.boolean(),
					inverse: fc.boolean(),
					faint: fc.boolean(),
					corrected: solid,
					emoji: fc.constantFrom(0x1f600, 0x1f1f9, 0x2764),
				}),
				(v) => {
					const before: [string, string][] = [],
						drawn: {color: string; alpha: number}[] = [];
					const renderer = Object.create(CanvasRenderer.prototype) as Renderer;
					renderer.theme = {
						background: v.base,
						selectionBackground: v.selection,
						selectionForeground: v.selectedInk,
					};
					renderer.metrics = {width: 8, height: 16, baseline: 12};
					renderer.fontSize = 13;
					renderer.fontFamily = "monospace";
					renderer.isInSelection = () => v.selected;
					renderer.ctx = {
						fillStyle: "",
						globalAlpha: 1,
						font: "",
						fillText: () => {
							drawn.push({color: renderer.ctx.fillStyle, alpha: renderer.ctx.globalAlpha});
						},
					};
					renderer.correctForeground = (fg, bg) => {
						before.push([fg, bg]);
						return v.corrected;
					};
					const [r, g, b] = channels(v.foreground),
						[R, G, B] = channels(v.background);
					const cell: Cell = {
						codepoint: 65,
						width: 1,
						flags: (v.inverse ? CellFlags.INVERSE : 0) | (v.faint ? CellFlags.FAINT : 0),
						fg_r: r!,
						fg_g: g!,
						fg_b: b!,
						bg_r: R!,
						bg_g: G!,
						bg_b: B!,
						grapheme_len: 0,
						hyperlink_id: 0,
					};
					const original = {...cell};
					const rawBg = v.inverse ? v.foreground : v.background;
					const bg = v.selected
						? composite(v.selection, v.base)
						: rawBg === "#000000"
							? v.base
							: rawBg;
					const rawFg = v.selected ? v.selectedInk : v.inverse ? v.background : v.foreground;
					const fg = v.faint
						? rgbHex(channels(rawFg).map((n, i) => (n + channels(bg)[i]!) / 2))
						: rawFg;
					renderer.renderCellText(cell, 0, 0);
					expect(before).toEqual([[fg, bg]]);
					expect(drawn).toEqual([{color: v.corrected, alpha: 1}]);
					expect(cell).toEqual(original);
					expect(renderer.theme).toEqual({
						background: v.base,
						selectionBackground: v.selection,
						selectionForeground: v.selectedInk,
					});
					// Native emoji and an absent callback retain ghostty-web 0.4.0's drawing.
					const native = v.selected
						? v.selectedInk
						: `rgb(${channels(v.inverse ? v.background : v.foreground).join(", ")})`;
					before.length = 0;
					drawn.length = 0;
					renderer.renderCellText({...cell, codepoint: v.emoji}, 0, 0);
					expect(before).toEqual([]);
					expect(drawn).toEqual([{color: native, alpha: v.faint ? 0.5 : 1}]);
					delete renderer.correctForeground;
					drawn.length = 0;
					renderer.renderCellText(cell, 0, 0);
					expect(drawn).toEqual([{color: native, alpha: v.faint ? 0.5 : 1}]);
				},
			),
			RUNS,
		);
	});
});

// ---- T343 review 2, class 1: the window's applied theme -----------------------------------------
//
// Contract for build, in window/theme.ts and window/theme-start.ts (today's app):
//
//   applyAppearance({_tag: "theme", value: AppliedTheme, version})   // the host's next value
//   applyAppearance({_tag: "forced", on: boolean})                    // forced colors on or off
//   readColors()   -> {colors: <the 21 globals>, terminal}            // what a canvas draws now
//   onTheme(hear)  -> unsubscribe                                     // once per applied change
//   themeWord(report) -> string | null                                // the one bottom-line word
//   startTheme(storage, forced) -> boolean                            // theme-start.ts, pre-paint
//
// The root's custom properties are `--<global name>`. Under forced colors none is set, and a
// canvas reads CSS system colors; leaving restores the latest theme, including one that arrived
// while forced. Plants: apply a theme that arrived under forced colors; keep an old override;
// notify after unsubscribe; apply a cached color under forced colors.

// Modules build has not made yet are loaded by URL, so a missing one is a runtime red, not a
// type error in this file. Their shapes are the contract above.
type Applied = {readonly colors: Readonly<Record<string, string>>; readonly terminal: unknown};
type Appearance =
	| {readonly _tag: "theme"; readonly value: unknown; readonly version: string}
	| {readonly _tag: "forced"; readonly on: boolean};
interface WindowTheme {
	readonly applyAppearance: (next: Appearance) => void;
	readonly readColors: () => Applied;
	readonly onTheme: (hear: () => void) => () => void;
	readonly themeWord: (report: unknown) => string | null;
}
interface ThemeStart {
	readonly startTheme: (
		storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
		forced: boolean,
	) => boolean;
}
const built = <T>(path: string): Promise<T> =>
	import(/* @vite-ignore */ new URL(path, import.meta.url).pathname) as Promise<T>;

const SYSTEM = new Set([
	"Canvas",
	"CanvasText",
	"GrayText",
	"Highlight",
	"HighlightText",
	"LinkText",
	"VisitedText",
	"ActiveText",
	"ButtonFace",
	"ButtonText",
	"ButtonBorder",
	"Field",
	"FieldText",
	"Mark",
	"MarkText",
	"SelectedItem",
	"SelectedItemText",
	"AccentColor",
	"AccentColorText",
]);
const fakeRoot = () => {
	const props = new Map<string, string>();
	const storage = new Map<string, string>();
	const root = {
		style: {
			setProperty: (k: string, v: string) => void props.set(k, v),
			removeProperty: (k: string) => void props.delete(k),
			getPropertyValue: (k: string) => props.get(k) ?? "",
		},
		dataset: {} as Record<string, string>,
	};
	const local = {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => void storage.set(k, v),
		removeItem: (k: string) => void storage.delete(k),
	};
	vi.stubGlobal("document", {documentElement: root});
	vi.stubGlobal("localStorage", local);
	return {props, storage, local, root};
};
afterEach(() => {
	vi.unstubAllGlobals();
});

describe("T20/T23/T24 the applied theme, forced colors and subscriptions", () => {
	it("draws the latest theme unless forced, and notifies only live subscribers", async () => {
		const {decodable, globalNames} = await import("../../../../fixtures/themes/laws.ts");
		const op = fc.oneof(
			decodable.map((value) => ({_tag: "theme" as const, value})),
			fc.boolean().map((on) => ({_tag: "forced" as const, on})),
			fc.constant({_tag: "subscribe" as const}),
			fc.nat({max: 4}).map((n) => ({_tag: "unsubscribe" as const, n})),
		);
		await fc.assert(
			fc.asyncProperty(decodable, fc.array(op, {maxLength: 16}), async (first, ops) => {
				const {props} = fakeRoot();
				const {applyAppearance, onTheme, readColors} = await built<WindowTheme>("./theme.ts");
				applyAppearance({_tag: "forced", on: false});
				applyAppearance({_tag: "theme", value: first as never, version: "1"});
				let latest = first,
					forced = false;
				const subs: {heard: number; want: number; stop: () => void; live: boolean}[] = [];
				for (const o of ops) {
					if (o._tag === "subscribe") {
						const sub = {heard: 0, want: 0, live: true, stop: () => {}};
						sub.stop = onTheme(() => {
							sub.heard += 1;
						});
						subs.push(sub);
						continue;
					}
					if (o._tag === "unsubscribe") {
						const sub = subs[o.n];
						if (sub !== undefined) {
							sub.stop();
							sub.live = false;
						}
						continue;
					}
					if (o._tag === "theme") {
						latest = o.value;
						applyAppearance({_tag: "theme", value: o.value as never, version: "1"});
					} else {
						forced = o.on;
						applyAppearance(o);
					}
					for (const sub of subs) if (sub.live) sub.want += 1;
				}
				expect(subs.map((s) => s.heard)).toEqual(subs.map((s) => s.want));
				const drawn = readColors();
				const set = Object.fromEntries(
					globalNames.flatMap((n) => (props.has(`--${n}`) ? [[n, props.get(`--${n}`)]] : [])),
				);
				expect(set).toEqual(forced ? {} : latest.colors);
				expect(
					forced
						? Object.values(drawn.colors).every((c) => SYSTEM.has(c))
						: isDeepStrictEqual(drawn.colors, latest.colors),
				).toBe(true);
				expect(drawn.terminal).toEqual(
					forced
						? expect.objectContaining({foreground: "CanvasText", background: "Canvas"})
						: latest.terminal,
				);
				for (const sub of subs) sub.stop();
			}),
			{seed: 119120, numRuns: 60},
		);
	});
});

describe("T21/T24 the startup cache is for paint only", () => {
	it("pre-paints the last applied theme, never under forced colors, and drops a bad cache", async () => {
		const {decodable, globalNames} = await import("../../../../fixtures/themes/laws.ts");
		const damage = fc.constantFrom("missing", "component", "nonhex", "garbage");
		await fc.assert(
			fc.asyncProperty(decodable, fc.boolean(), damage, async (theme, forced, how) => {
				const {props, storage, local, root} = fakeRoot();
				const {applyAppearance} = await built<WindowTheme>("./theme.ts");
				const {startTheme} = await built<ThemeStart>("./theme-start.ts");
				applyAppearance({_tag: "forced", on: false});
				applyAppearance({_tag: "theme", value: theme as never, version: "1"});
				expect(storage.size).toBe(1);
				const [key, cached] = [...storage][0]!;
				props.clear();
				expect(startTheme(local, forced)).toBe(!forced);
				const set = Object.fromEntries(
					globalNames.flatMap((n) => (props.has(`--${n}`) ? [[n, props.get(`--${n}`)]] : [])),
				);
				expect(set).toEqual(forced ? {} : theme.colors);
				expect(root.dataset["appearance"]).toBe(forced ? undefined : "ready");
				// A cache that is not a complete applied theme paints nothing and is removed.
				const value = JSON.parse(cached) as {colors: Record<string, unknown>};
				const colors = {...value.colors};
				if (how === "missing") delete colors["text-primary"];
				if (how === "component") colors["tile-edge"] = "#ffffff";
				if (how === "nonhex") colors["surface"] = "var(--x)";
				storage.set(key, how === "garbage" ? "{" : JSON.stringify({...value, colors}));
				props.clear();
				delete root.dataset["appearance"];
				expect(startTheme(local, false)).toBe(false);
				expect(props.size).toBe(0);
				expect(storage.has(key)).toBe(false);
			}),
			{seed: 119120, numRuns: 60},
		);
	});
});

describe("T12/T25 the one load diagnostic in the bottom line", () => {
	// pinned: build13's off warning claimed that proposed changes had already happened.
	// Plant: ignore the off policy when choosing the verbs.
	it("pinned: T12 off says would move and would use fabrika's, never moved", async () => {
		const theme = await import("./theme.ts");
		const word = theme.themeWord(
			{
				name: "dusk",
				changes: [
					{
						_tag: "moved",
						token: "text-faint",
						on: "surface",
						was: "#222222",
						now: "#777777",
						from: {wcag: 2.9, apca: -20},
						to: {wcag: 4.5, apca: -60},
					},
					{_tag: "builtin", token: "done", was: "#111111", now: "#89ff9fcd", why: "past_cap"},
				],
				failures: [],
				diagnostics: [],
			},
			{fix: "off", contrast: 4.5},
		);
		expect(word).toBe('theme "dusk": 1 color would move, 1 would use fabrika\'s');
		expect(word).not.toMatch(/\bmoved\b/);
	});
	// vector: themes.md point 4's sketch of the load line.
	it('vector: theme "dusk": 2 colors moved, 1 uses fabrika\'s', async () => {
		const {themeWord} = await built<WindowTheme>("./theme.ts");
		const moved = (token: string) => ({
			_tag: "moved",
			token,
			on: "surface",
			was: "#222222",
			now: "#777777",
			from: {wcag: 2.9, apca: -20},
			to: {wcag: 4.5, apca: -60},
		});
		expect(
			themeWord({
				name: "dusk",
				changes: [
					moved("text-faint"),
					moved("text-faint"),
					moved("closed"),
					{_tag: "builtin", token: "done", was: "#111111", now: "#89ff9fcd", why: "past_cap"},
				],
				failures: [],
				diagnostics: [],
			} as never),
		).toBe('theme "dusk": 2 colors moved, 1 uses fabrika\'s');
	});
	it("says nothing for a clean load, something for any change, failure or refusal, and no values", async () => {
		const {themeWord} = await built<WindowTheme>("./theme.ts");
		const {name} = await import("../../../../fixtures/themes/laws.ts");
		const token = fc.constantFrom("text-faint", "text-primary", "done", "cursor");
		const change = fc.oneof(
			fc.record({
				_tag: fc.constant("moved"),
				token,
				on: fc.constant("surface"),
				was: hex,
				now: hex,
				from: fc.constant({wcag: 2, apca: 20}),
				to: fc.constant({wcag: 5, apca: 70}),
			}),
			fc.record({
				_tag: fc.constant("builtin"),
				token,
				was: hex,
				now: hex,
				why: fc.constant("past_cap"),
			}),
		);
		const failure = fc.record({
			token,
			on: fc.constant("surface"),
			floor: fc.constant({wcag: 4.5, apca: 60}),
			reading: fc.constant({wcag: 2, apca: 20}),
		});
		const diagnostic = name.map((word) => ({
			file: `${word}.toml`,
			field: "colors.surface",
			line: 3,
			message: "expected a complete theme with valid fields",
		}));
		fc.assert(
			fc.property(
				name,
				fc.array(change, {maxLength: 4}),
				fc.array(failure, {maxLength: 3}),
				fc.array(diagnostic, {maxLength: 2}),
				(theme, changes, failures, diagnostics) => {
					const word = themeWord({name: theme, changes, failures, diagnostics} as never);
					const quiet = changes.length + failures.length + diagnostics.length === 0;
					expect(word === null).toBe(quiet);
					const values = changes.flatMap((c) => [c.was, c.now]);
					expect(values.some((v) => (word ?? "").includes(v))).toBe(false);
					expect((word ?? "").includes("/")).toBe(false);
				},
			),
			RUNS,
		);
	});
});

describe("T18/T20 forced-color cells", () => {
	// property: Ghostty's cell/selection inputs have no Effect schema. Record the real renderer's
	// canvas calls after inverse, selection and faint, with the real app correction attached.
	// Plant: keep the theme's foreground when forced colors is on.
	it("property: T18/T20 every forced-color cell draws the system color that reads best", async () => {
		fakeRoot();
		const theme = await import("./theme.ts");
		theme.applyAppearance({_tag: "forced", on: true});
		try {
			fc.assert(
				fc.property(
					fc.record({
						foreground: solid,
						background: solid,
						base: solid,
						selection: hex,
						selectedInk: solid,
						selected: fc.boolean(),
						inverse: fc.boolean(),
						faint: fc.boolean(),
						text: solid,
						back: solid,
					}),
					(v) => {
						const drawn: {color: string; alpha: number}[] = [];
						const renderer = Object.create(CanvasRenderer.prototype) as Renderer;
						renderer.theme = {
							background: v.base,
							selectionBackground: v.selection,
							selectionForeground: v.selectedInk,
						};
						renderer.metrics = {width: 8, height: 16, baseline: 12};
						renderer.fontSize = 13;
						renderer.fontFamily = "monospace";
						renderer.isInSelection = () => v.selected;
						renderer.ctx = {
							fillStyle: "",
							globalAlpha: 1,
							font: "",
							fillText: () => {
								drawn.push({color: renderer.ctx.fillStyle, alpha: renderer.ctx.globalAlpha});
							},
						};
						renderer.correctForeground = (fg, bg) => theme.correctCell(fg, bg, v);
						const [r, g, b] = channels(v.foreground),
							[R, G, B] = channels(v.background);
						const cell: Cell = {
							codepoint: 65,
							width: 1,
							flags: (v.inverse ? CellFlags.INVERSE : 0) | (v.faint ? CellFlags.FAINT : 0),
							fg_r: r!,
							fg_g: g!,
							fg_b: b!,
							bg_r: R!,
							bg_g: G!,
							bg_b: B!,
							grapheme_len: 0,
							hyperlink_id: 0,
						};
						const original = {...cell};
						const rawBg = v.inverse ? v.foreground : v.background;
						const bg = v.selected
							? composite(v.selection, v.base)
							: rawBg === "#000000"
								? v.base
								: rawBg;
						const expected = wcag(v.text, bg) >= wcag(v.back, bg) ? v.text : v.back;
						renderer.renderCellText(cell, 0, 0);
						expect(drawn).toEqual([{color: expected, alpha: 1}]);
						expect(cell).toEqual(original);
					},
				),
				RUNS,
			);
		} finally {
			theme.applyAppearance({_tag: "forced", on: false});
		}
	});
});

// scenario: a fresh page boots from its cache, then receives real media-change events, before
// any host theme arrives. A renderer-only cache check missed build13's lost machine state.
// Plant: let the cache paint CSS, but drop the cached message to the look machine.
it("scenario: T20 cached start survives forced colors on then off", async () => {
	vi.resetModules();
	const {props, local, root} = fakeRoot();
	const cached = {
		format: 1,
		name: "cached-nord",
		look: "dark",
		colors: {...fabrika.colors, surface: "#2e3440"},
		terminal: {...fabrika.terminal, background: "#2e3440"},
	};
	local.setItem("fabrika.theme", JSON.stringify(cached));
	let change: (event: {matches: boolean}) => void = () => {
		throw new Error("no media listener");
	};
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("navigator", {userAgent: "test"});
	vi.stubGlobal("document", {documentElement: root, getElementById: () => null});
	const ready = vi.fn();
	vi.stubGlobal("window", {
		addEventListener: vi.fn(),
		matchMedia: () => ({
			matches: false,
			addEventListener: (_: string, hear: typeof change) => {
				change = hear;
			},
		}),
		fabrika: {send: ready, onMessage: vi.fn()},
	});
	vi.doMock("./terminal.ts", () => ({loadGhostty: Effect.succeed(null)}));
	vi.doMock("./windows.tsx", () => ({WINDOWS: new Map()}));
	try {
		const theme = await import("./theme.ts");
		await import("./desk.tsx");
		expect(ready).toHaveBeenCalledWith("desk", {type: "ready"});
		expect(props.get("--surface")).toBe(cached.colors.surface);
		change({matches: true});
		expect(props.has("--surface")).toBe(false);
		expect(theme.readColors().terminal.foreground).toBe("CanvasText");
		change({matches: false});
		expect(theme.readColors()).toEqual({colors: cached.colors, terminal: cached.terminal});
		expect(props.get("--surface")).toBe(cached.colors.surface);
	} finally {
		vi.doUnmock("./terminal.ts");
		vi.doUnmock("./windows.tsx");
		vi.resetModules();
	}
});
