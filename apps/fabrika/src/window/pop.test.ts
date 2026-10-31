import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {
	capOf,
	capsOf,
	foldId,
	hintsOf,
	marked,
	menuKey,
	neighborOf,
	type Row,
	type Section,
	sentence,
	stopsOf,
	textOf,
	tipWait,
} from "./pop.ts";
import {Menu, type MenuProps, Palette, type PaletteProps, Panel} from "./pop.tsx";

// The popover rule (docs/direction/popovers.md): keys as the Mac draws them, what each key does
// in a menu, the palette's bold letters, the tooltip's wait, and the roles each one draws.

const row = (
	id: string,
	title: string,
	second: Row["second"] = {name: "Later", cap: "H"},
): Row => ({
	id,
	icon: "ask",
	title,
	sub: `#${id} · t2`,
	side: "11:13",
	second,
});

const LIVE: Section = {
	id: "asks",
	title: null,
	fold: false,
	rows: [row("7", "Approve plan"), row("8", "Stuck: checks red"), row("9", "Answer the question")],
};
const LATER: Section = {id: "later", title: "Later", fold: true, rows: [row("4", "Pick a name")]};
const stops = stopsOf([LIVE, LATER], new Set());

describe("keys as the Mac draws them", () => {
	it("draws a key of the desk's table as one keycap", () => {
		expect(capOf("<c-b>")).toBe("⌃B");
		expect(capOf("<c-a-m-x>")).toBe("⌃⌥⌘X");
		expect(capOf("a")).toBe("A");
		expect(capOf("N")).toBe("⇧N");
		expect(capOf("<arrowleft>")).toBe("←");
		expect(capOf("<enter>")).toBe("↵");
		expect(capOf("<escape>")).toBe("Esc");
		expect(capOf(" ")).toBe("Space");
		expect(capOf("|")).toBe("|");
		expect(capOf("?")).toBe("?");
	});

	it("draws a binding as its prefix, then its own key", () => {
		expect(capsOf("<c-b>", "z")).toEqual(["⌃B", "Z"]);
		expect(capsOf("<c-b>", "N")).toEqual(["⌃B", "⇧N"]);
	});

	it("writes a title in sentence case, the rest as written", () => {
		expect(sentence("approve plan for #7")).toBe("Approve plan for #7");
		expect(sentence("t2")).toBe("T2");
		expect(sentence("")).toBe("");
	});
});

describe("a menu's stops", () => {
	it("stops at each row, and at a folding section's heading", () => {
		expect(stops.map((s) => s.id)).toEqual(["7", "8", "9", foldId("later"), "4"]);
	});

	it("drops a folded section's rows, but keeps its heading", () => {
		const folded = stopsOf([LIVE, LATER], new Set(["later"]));
		expect(folded.map((s) => s.id)).toEqual(["7", "8", "9", "fold:later"]);
	});

	it("lets the active row's second thing name its key in the footer", () => {
		const foot = [
			{caps: ["↵"], name: "Open"},
			{caps: ["H"], name: "Later"},
		];
		const back = stopsOf(
			[{...LATER, rows: [row("4", "Pick a name", {name: "Bring back", cap: "H"})]}],
			new Set(),
		);
		expect(hintsOf(foot, back[1])).toEqual([
			{caps: ["↵"], name: "Open"},
			{caps: ["H"], name: "Bring back"},
		]);
		expect(hintsOf(foot, stops[0])).toEqual(foot);
		expect(hintsOf(foot, back[0])).toBe(foot);
		expect(hintsOf(foot, undefined)).toBe(foot);
	});

	it("moves to the next row when the active one leaves, else the one before", () => {
		expect(neighborOf(stops, "8")).toBe("9");
		expect(neighborOf(stops, "4")).toBe("fold:later");
		expect(neighborOf(stopsOf([{...LIVE, rows: [row("7", "Approve plan")]}], new Set()), "7")).toBe(
			null,
		);
		expect(neighborOf(stops, "nowhere")).toBe(null);
	});
});

describe("a menu's keys", () => {
	it("moves with the arrows and with J and K, and wraps at both ends", () => {
		expect(menuKey(stops, "7", {key: "ArrowDown"})).toEqual({do: "move", to: "8"});
		expect(menuKey(stops, "7", {key: "j"})).toEqual({do: "move", to: "8"});
		expect(menuKey(stops, "8", {key: "ArrowUp"})).toEqual({do: "move", to: "7"});
		expect(menuKey(stops, "8", {key: "k"})).toEqual({do: "move", to: "7"});
		expect(menuKey(stops, "7", {key: "ArrowUp"})).toEqual({do: "move", to: "4"});
		expect(menuKey(stops, "4", {key: "ArrowDown"})).toEqual({do: "move", to: "7"});
	});

	it("goes to the ends with Home and End", () => {
		expect(menuKey(stops, "8", {key: "Home"})).toEqual({do: "move", to: "7"});
		expect(menuKey(stops, "8", {key: "End"})).toEqual({do: "move", to: "4"});
	});

	it("starts on the first row, and on it again when the active one has gone", () => {
		expect(menuKey(stops, null, {key: "Enter"})).toEqual({do: "act", row: LIVE.rows[0]});
		expect(menuKey(stops, "gone", {key: "ArrowDown"})).toEqual({do: "move", to: "8"});
	});

	it("does a row's own thing on Enter, and folds a heading", () => {
		expect(menuKey(stops, "8", {key: "Enter"})).toEqual({do: "act", row: LIVE.rows[1]});
		expect(menuKey(stops, "fold:later", {key: "Enter"})).toEqual({do: "fold", section: "later"});
	});

	it("does a row's second thing on H, and nothing on a row with none or on a heading", () => {
		expect(menuKey(stops, "8", {key: "h"})).toEqual({do: "second", row: LIVE.rows[1]});
		expect(menuKey(stops, "8", {key: "H"})).toEqual({do: "second", row: LIVE.rows[1]});
		expect(menuKey(stops, "fold:later", {key: "h"})).toBe(null);
		const plain = stopsOf([{...LIVE, rows: [row("1", "One", null)]}], new Set());
		expect(menuKey(plain, "1", {key: "h"})).toBe(null);
	});

	it("closes on Escape and on Tab, even with a modifier down", () => {
		expect(menuKey(stops, "7", {key: "Escape"})).toEqual({do: "close"});
		expect(menuKey(stops, "7", {key: "Tab"})).toEqual({do: "close"});
		expect(menuKey(stops, "7", {key: "Escape", mods: true})).toEqual({do: "close"});
	});

	it("jumps to the next row whose title starts with a typed letter, wrapping", () => {
		expect(menuKey(stops, "7", {key: "a"})).toEqual({do: "move", to: "9"});
		expect(menuKey(stops, "9", {key: "a"})).toEqual({do: "move", to: "7"});
		expect(menuKey(stops, "7", {key: "L"})).toEqual({do: "move", to: "fold:later"});
		expect(menuKey(stops, "7", {key: "z"})).toBe(null);
	});

	it("leaves a key with Ctrl, Option or Cmd down to the desk, and other keys alone", () => {
		expect(menuKey(stops, "7", {key: "ArrowDown", mods: true})).toBe(null);
		expect(menuKey(stops, "7", {key: "b", mods: true})).toBe(null);
		expect(menuKey(stops, "7", {key: "1"})).toBe(null);
		expect(menuKey(stops, "7", {key: " "})).toBe(null);
	});

	it("does nothing but close in an empty menu", () => {
		expect(menuKey([], null, {key: "ArrowDown"})).toBe(null);
		expect(menuKey([], null, {key: "Enter"})).toBe(null);
		expect(menuKey([], null, {key: "Escape"})).toEqual({do: "close"});
	});
});

describe("the palette's bold letters and the tooltip's wait", () => {
	it("marks the first place each typed word matches", () => {
		expect(marked("Focus left", "fo le")).toEqual([
			{text: "Fo", mark: true},
			{text: "cus ", mark: false},
			{text: "le", mark: true},
			{text: "ft", mark: false},
		]);
		expect(marked("Zoom", "")).toEqual([{text: "Zoom", mark: false}]);
		expect(marked("Zoom", "x")).toEqual([{text: "Zoom", mark: false}]);
	});

	it("waits 700ms before a tooltip shows, and not at all within 300ms of the last one", () => {
		expect(tipWait(1000, null)).toBe(700);
		expect(tipWait(1000, 800)).toBe(0);
		expect(tipWait(1000, 600)).toBe(700);
	});
});

const noop = () => {};
const menu = (sections: readonly Section[], from: MenuProps["from"] = "top") =>
	renderToStaticMarkup(
		createElement(Menu, {
			id: "pop-asks",
			label: "Asks",
			from,
			count: sections.reduce((n, s) => n + s.rows.length, 0),
			sections,
			foot: [{caps: ["↵"], name: "Open"}],
			empty: {title: "Nothing waits on you", sub: "A new ask shows here and in the top bar."},
			onAct: noop,
			onSecond: noop,
			onClose: noop,
		} satisfies MenuProps),
	);

describe("the roles each one draws", () => {
	it("draws the asks list as a menu: groups of items, the first one active, H said as its key", () => {
		const html = menu([LIVE, LATER]);
		expect(html).toContain('role="menu"');
		expect(html).toContain('aria-label="Asks"');
		expect(html).toContain('aria-activedescendant="pop-asks-0"');
		expect(html).toContain('role="group"');
		expect(html.match(/role="menuitem"/g)).toHaveLength(5);
		expect(html).toContain('aria-keyshortcuts="H"');
		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain('data-over=""');
		// Only the active row shows its second thing, in place of its time.
		expect(html.match(/class="pop-second"/g)).toHaveLength(1);
		expect(html.match(/class="side"/g)).toHaveLength(3);
	});

	it("draws an empty menu as one calm line, a dialog with nothing to pick, and no footer", () => {
		const html = menu([{...LIVE, rows: []}]);
		expect(html).toContain('role="dialog"');
		expect(html).not.toContain('role="menu"');
		expect(html).not.toContain("menuitem");
		expect(html).not.toContain("aria-activedescendant");
		expect(html).toContain("Nothing waits on you");
		expect(html).toContain("A new ask shows here and in the top bar.");
		expect(html).not.toContain("pop-foot");
	});

	it("draws a bare head with no count, and typed words in the calm line in mono", () => {
		const html = renderToStaticMarkup(
			createElement(Menu, {
				id: "pop-jobs",
				label: "Jobs",
				from: "bottom",
				count: null,
				sections: [],
				foot: [],
				empty: {
					title: "Nothing is running",
					sub: [
						{text: "There, ", typed: false},
						{text: "jobs", typed: true},
						{text: " lists them.", typed: false},
					],
				},
				onAct: noop,
				onSecond: noop,
				onClose: noop,
			} satisfies MenuProps),
		);
		expect(html).toContain('<div class="pop-head" aria-hidden="true">Jobs</div>');
		expect(html).toContain("<span>There, </span><code>jobs</code><span> lists them.</span>");
	});

	it("draws typed words in mono, a titled section's heading, and a menu from the bottom line", () => {
		const job: Row = {
			id: "t2/%5",
			icon: "running",
			title: [{text: "sleep --ms 9000", typed: true}],
			sub: [
				{text: "%5", typed: true},
				{text: " · t2", typed: false},
			],
			side: "2m",
			second: null,
		};
		const others: Section = {id: "others", title: "Other tiles", fold: false, rows: [job]};
		const html = menu([{...LIVE, rows: []}, others], "bottom");
		expect(html).toContain("pop menu from-bottom");
		expect(html).toContain("<code>sleep --ms 9000</code>");
		expect(html).toContain("<code>%5</code><span> · t2</span>");
		expect(html).toContain('<div class="pop-group" aria-hidden="true">Other tiles</div>');
		expect(html).toContain('aria-label="Other tiles"');
		expect(html).not.toContain("aria-keyshortcuts");
		// A typed title is still found by its first letter.
		const stops = stopsOf([others], new Set());
		expect(menuKey(stops, null, {key: "s"})).toEqual({do: "move", to: "t2/%5"});
		expect(textOf(job.title)).toBe("sleep --ms 9000");
	});

	it("keeps the Later rows a menu when nothing else waits", () => {
		const html = menu([{...LIVE, rows: []}, LATER]);
		expect(html).toContain('role="menu"');
		expect(html).toContain("Nothing waits on you");
		expect(html.match(/role="menuitem"/g)).toHaveLength(2);
	});

	const palette = (over: Partial<PaletteProps>) =>
		renderToStaticMarkup(
			createElement(Palette, {
				id: "pop-palette",
				label: "Commands",
				chip: "t2 · ticket",
				query: "",
				sections: [
					{
						title: "Tile",
						options: [
							{id: "split", name: "split", caps: ["⌃B", "|"]},
							{id: "zoom", name: "zoom", caps: ["⌃B", "Z"]},
						],
					},
				],
				at: 1,
				count: "2 commands",
				onQuery: noop,
				onMove: noop,
				onRun: noop,
				onClose: noop,
				...over,
			}),
		);

	it("draws the palette as a combobox in a modal dialog over a listbox", () => {
		const html = palette({});
		expect(html).toContain('role="dialog" aria-modal="true" aria-label="Commands"');
		expect(html).toContain('role="combobox"');
		expect(html).toContain('aria-controls="pop-palette-list"');
		expect(html).toContain('aria-activedescendant="pop-palette-o1"');
		expect(html).toContain('id="pop-palette-list" role="listbox"');
		expect(html.match(/role="option"/g)).toHaveLength(2);
		expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
		// Each key is Manti's keycap: its part names are the hook theme.css styles it by.
		const cap = (key: string) =>
			`<kbd data-scope="kbd" data-part="root" data-size="sm">${key}</kbd>`;
		expect(html).toContain(`${cap("⌃B")}${cap("Z")}`);
		expect(html).toContain("2 commands");
	});

	it("says so when nothing matches, with no option picked", () => {
		const html = palette({query: "qq", sections: [], count: "0 commands"});
		expect(html).toContain("Nothing matches “qq”");
		expect(html).not.toContain('role="option"');
		expect(html).not.toContain("aria-activedescendant");
	});

	it("draws a panel as a non-modal dialog", () => {
		const html = renderToStaticMarkup(
			createElement(Panel, {id: "pop-lines", label: "The host", onClose: noop, children: "Up"}),
		);
		expect(html).toContain('role="dialog" aria-label="The host"');
		expect(html).not.toContain("aria-modal");
	});
});
