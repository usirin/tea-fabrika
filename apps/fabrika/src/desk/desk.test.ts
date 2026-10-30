import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {
	activeOf,
	claims,
	type Desk,
	type DeskCmd,
	type DeskMsg,
	deskMachine,
	type Open,
	questionOf,
	restore,
	savedOf,
	tilesOf,
} from "./desk.ts";
import {keyName} from "./keys.ts";
import {findTile} from "./layout/index.ts";

// The desk, folded by hand. Its laws, as property tests on tea's pbt, are in desk.laws.test.ts.

const [start, booted] = deskMachine.init(null, undefined);

/** Fold msgs through the desk from `from`, keeping every Cmd asked for. */
const fold = (msgs: readonly DeskMsg[], from: Desk = start) => {
	let s = from;
	const cmds: DeskCmd[] = [];
	for (const msg of msgs) {
		const [next, out] = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, s, msg);
		s = next;
		cmds.push(...out);
	}
	return {s, cmds};
};

const opened = (s: Desk): Open => {
	if (s.at !== "open") throw new Error("the desk is over");
	return s;
};

/** Ctrl-B, then `key`, a moment apart. */
const prefixed = (key: string, at = 0): readonly DeskMsg[] => [
	{type: "key", key: "<c-b>", at},
	{type: "key", key, at: at + 1},
];

const ids = (s: Desk) => tilesOf(activeOf(opened(s))).map((t) => t.id);
const focus = (s: Desk) => activeOf(opened(s)).focused;
const counter = {id: "counter:1", program: "counter"};

describe("the desk", () => {
	it("starts with one tile running tsh, and asks for it", () => {
		expect(ids(start)).toEqual(["t1"]);
		expect(booted.map((c) => c.type)).toEqual(["open", "save"]);
	});

	it("splits side by side with | and top to bottom with -, the new tile focused and opened", () => {
		const {s, cmds} = fold([...prefixed("|"), ...prefixed("-", 10)]);
		const root = activeOf(opened(s)).layout.root;
		expect(root.orientation).toBe("horizontal");
		expect(ids(s)).toEqual(["t1", "t2", "t3"]);
		expect(focus(s)).toBe("t3");
		expect(cmds.filter((c) => c.type === "open")).toEqual([
			{type: "open", tile: "t2"},
			{type: "open", tile: "t3"},
		]);
	});

	it("moves focus by direction, as tmux does, and stays at an edge", () => {
		const split = fold([...prefixed("|"), ...prefixed("-", 10)]).s;
		expect(focus(fold(prefixed("h", 20), split).s)).toBe("t1");
		expect(focus(fold(prefixed("k", 20), split).s)).toBe("t2");
		expect(focus(fold(prefixed("<arrowup>", 20), split).s)).toBe("t2");
		expect(focus(fold(prefixed("l", 20), split).s)).toBe("t3");
	});

	it("lets every key go to the tile while the prefix is not armed, and swallows an unbound one after it", () => {
		expect(claims(start, "|", 0)).toBe(false);
		expect(claims(start, "<c-b>", 0)).toBe(true);
		const armed = fold([{type: "key", key: "<c-b>", at: 0}]).s;
		expect(claims(armed, "q", 1)).toBe(true);
		const after = fold([{type: "key", key: "q", at: 1}], armed);
		expect(after.cmds).toEqual([]);
		expect(opened(after.s).prefix).toEqual({armed: false});
	});

	it("sends one Ctrl-B on for Ctrl-B twice, as tmux's send-prefix", () => {
		const {cmds} = fold(prefixed("<c-b>"));
		expect(cmds).toEqual([{type: "send", tile: "t1", data: "\x02"}]);
	});

	it("zooms the focused tile and back, and a split or a focus move undoes the zoom", () => {
		const two = fold(prefixed("|")).s;
		const zoomed = fold(prefixed("z", 10), two).s;
		expect(activeOf(opened(zoomed)).layout.zoomed).toBe("t2");
		expect(activeOf(opened(fold(prefixed("z", 20), zoomed).s)).layout.zoomed).toBeNull();
		expect(activeOf(opened(fold(prefixed("h", 20), zoomed).s)).layout.zoomed).toBeNull();
	});

	it("asks before closing a tile with nothing running, and y closes it at once", () => {
		const two = fold(prefixed("|")).s;
		const asked = fold(prefixed("x", 10), two);
		expect(opened(asked.s).ask).toBe("t2");
		expect(questionOf(opened(asked.s), "t2")).toBe("close t2? (y/n)");
		expect(asked.cmds).toEqual([]);
		const {s, cmds} = fold([{type: "key", key: "y", at: 20}], asked.s);
		expect(ids(s)).toEqual(["t1"]);
		expect(focus(s)).toBe("t1");
		expect(cmds).toContainEqual({type: "stop", tile: "t2"});
		expect(cmds.some((c) => c.type === "close")).toBe(false);
	});

	it("takes only y for yes: any other key says no and keeps the tile", () => {
		const asked = fold([...prefixed("|"), ...prefixed("x", 10)]).s;
		for (const key of ["n", "Y", "a", "<c-b>", "<c-c>", "x", "<enter>"]) {
			expect(claims(asked, key, 20)).toBe(true);
			const no = fold([{type: "key", key, at: 20}], asked);
			expect(ids(no.s)).toEqual(["t1", "t2"]);
			expect(opened(no.s).ask).toBeNull();
			expect(no.cmds).toEqual([]);
		}
	});

	it("gives a busy tile's programs the end of their inputs on y, and takes it away when its tsh ended", () => {
		const busy = fold([...prefixed("|"), {type: "jobs", tile: "t2", running: 1}]).s;
		const yes = fold([...prefixed("x", 10), {type: "key", key: "y", at: 20}], busy);
		expect(ids(yes.s)).toEqual(["t1", "t2"]);
		expect(opened(yes.s).closing).toEqual(["t2"]);
		expect(yes.cmds).toEqual([{type: "close", tile: "t2"}]);
		// The programs ended, then tsh: the tile goes, and what is left of it is stopped.
		const ended = fold(
			[
				{type: "jobs", tile: "t2", running: 0},
				{type: "ended", tile: "t2"},
			],
			yes.s,
		);
		expect(ids(ended.s)).toEqual(["t1"]);
		expect(opened(ended.s).closing).toEqual([]);
		expect(ended.cmds).toContainEqual({type: "stop", tile: "t2"});
	});

	it("asks a closing tile to stop now, and y stops it", () => {
		const covered = fold([
			...prefixed("|"),
			{type: "covered", tile: "t2", runs: [counter]},
			...prefixed("x", 10),
			{type: "key", key: "y", at: 20},
		]).s;
		expect(opened(covered).closing).toEqual(["t2"]);
		const asked = fold(prefixed("x", 30), covered).s;
		expect(opened(asked).ask).toBe("t2");
		expect(questionOf(opened(asked), "t2")).toBe("stop t2 now? (y/n)");
		const no = fold([{type: "key", key: "n", at: 40}], asked).s;
		expect(ids(no)).toEqual(["t1", "t2"]);
		expect(opened(no).closing).toEqual(["t2"]);
		const yes = fold([{type: "key", key: "y", at: 40}], asked);
		expect(ids(yes.s)).toEqual(["t1"]);
		expect(yes.cmds).toContainEqual({type: "stop", tile: "t2"});
	});

	it("hears a tile was closing before the page loaded: its question is stop", () => {
		const two = fold([...prefixed("|"), {type: "closing", tile: "t2"}]).s;
		expect(opened(two).closing).toEqual(["t2"]);
		expect(questionOf(opened(two), "t2")).toBe("stop t2 now? (y/n)");
	});

	it("empties when the last tile closes: the window closes, as with Terminal's last tab", () => {
		const {s, cmds} = fold([...prefixed("x"), {type: "key", key: "y", at: 10}]);
		expect(s).toEqual({at: "over"});
		expect(cmds).toEqual([{type: "stop", tile: "t1"}, {type: "empty"}]);
	});

	it("covers a tile with a foreground run, hands Ctrl-C to its tsh, and shows tsh again when it ends", () => {
		const covered = fold([{type: "covered", tile: "t1", runs: [counter]}]).s;
		expect(findTile(activeOf(opened(covered)).layout, "t1")?.shows).toEqual({
			kind: "tsh",
			run: counter,
		});
		expect(claims(covered, "<c-c>", 0)).toBe(true);
		expect(fold([{type: "key", key: "<c-c>", at: 0}], covered).cmds).toEqual([
			{type: "send", tile: "t1", data: "\x03"},
		]);
		const back = fold([{type: "over", run: counter.id}], covered).s;
		expect(findTile(activeOf(opened(back)).layout, "t1")?.shows).toEqual({kind: "tsh", run: null});
		expect(claims(back, "<c-c>", 0)).toBe(false);
	});

	it("makes workspaces with N, and walks them with Ctrl-H and Ctrl-L, repeating within 500 ms", () => {
		const three = fold([...prefixed("N"), ...prefixed("N", 10)]).s;
		expect(opened(three).workspaces.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
		expect(opened(three).active).toBe("w3");
		const walked = fold(
			[
				{type: "key", key: "<c-b>", at: 100},
				{type: "key", key: "<c-h>", at: 101},
				{type: "key", key: "<c-h>", at: 300},
			],
			three,
		).s;
		expect(opened(walked).active).toBe("w1");
		// After the window, the key is the tile's again, and the prefix is not armed.
		expect(claims(walked, "<c-h>", 900)).toBe(false);
		expect(opened(fold(prefixed("<c-l>", 1000), walked).s).active).toBe("w2");
	});

	it("closes a workspace with its last tile, and moves to the one next to it", () => {
		const two = fold(prefixed("N")).s;
		const {s} = fold([...prefixed("x", 10), {type: "key", key: "y", at: 20}], two);
		expect(opened(s).workspaces.map((w) => w.id)).toEqual(["w1"]);
		expect(opened(s).active).toBe("w1");
	});

	it("resizes a container from a dragged border", () => {
		const two = fold(prefixed("|")).s;
		const root = activeOf(opened(two)).layout.root;
		const {s} = fold([{type: "resize", container: root.id, sizes: {t1: 70, t2: 30}}], two);
		expect(activeOf(opened(s)).layout.root.sizes).toEqual({t1: 70, t2: 30});
	});

	it("closes a tile whose tsh ended", () => {
		const two = fold(prefixed("|")).s;
		const {s, cmds} = fold([{type: "ended", tile: "t2"}], two);
		expect(ids(s)).toEqual(["t1"]);
		expect(cmds).toContainEqual({type: "stop", tile: "t2"});
	});
});

describe("the desk, moved by the window's frame", () => {
	it("picks a workspace by its place with Ctrl-B 1 to 9, or by a click on its name", () => {
		const three = fold([...prefixed("N"), ...prefixed("N", 10)]).s;
		expect(opened(fold(prefixed("1", 20), three).s).active).toBe("w1");
		expect(opened(fold(prefixed("9", 20), three).s).active).toBe("w3");
		const {s, cmds} = fold([{type: "pick", workspace: "w2"}], three);
		expect(opened(s).active).toBe("w2");
		expect(cmds.map((c) => c.type)).toEqual(["save"]);
		expect(fold([{type: "pick", workspace: "w9"}], three).s).toBe(three);
	});

	it("goes to a tile in another workspace, as an ask picked in the list does, and unzooms another", () => {
		const zoomed = fold([...prefixed("|"), ...prefixed("z", 10), ...prefixed("N", 20)]).s;
		expect(opened(zoomed).active).not.toBe("w1");
		const {s} = fold([{type: "go", tile: "t1"}], zoomed);
		expect(opened(s).active).toBe("w1");
		expect(focus(s)).toBe("t1");
		expect(activeOf(opened(s)).layout.zoomed).toBeNull();
		expect(fold([{type: "go", tile: "t9"}], zoomed).s).toBe(zoomed);
	});

	it("runs a key's command from the palette as Ctrl-B and that key would", () => {
		const viaPalette = fold([{type: "do", key: "|"}]);
		const viaKeys = fold(prefixed("|"));
		expect(viaPalette.s).toEqual(viaKeys.s);
		expect(viaPalette.cmds).toEqual(viaKeys.cmds);
		expect(fold([{type: "do", key: "q"}]).s).toBe(start);
	});

	it("asks the frame to show the asks, the keys and the info mode, and changes nothing else", () => {
		for (const [key, what] of [
			["a", "asks"],
			["?", "keys"],
			["i", "info"],
			["B", "bars"],
		] as const) {
			const {s, cmds} = fold(prefixed(key));
			expect(cmds).toEqual([{type: "show", what}]);
			expect(savedOf(opened(s))).toEqual(savedOf(opened(start)));
		}
	});
});

describe("folds", () => {
	const layout = (s: Desk) => activeOf(opened(s)).layout;
	const folded = (s: Desk) =>
		tilesOf(activeOf(opened(s)))
			.filter((t) => t.folded)
			.map((t) => t.id);
	/** t1, t2 and t3 side by side, focus on t3. */
	const row = fold([...prefixed("|"), ...prefixed("|", 10)]).s;
	/** t1 beside a column of t2 over t3, the column c3, focus on t3. */
	const column = fold([...prefixed("|"), ...prefixed("-", 10)]).s;

	it("turns the focused tile's container with Space, horizontal to vertical and back, and saves each", () => {
		const turned = fold(prefixed(" ", 20), row);
		expect(layout(turned.s).root.orientation).toBe("vertical");
		expect(turned.cmds.at(-1)?.type).toBe("save");
		expect(layout(fold(prefixed(" ", 30), turned.s).s).root.orientation).toBe("horizontal");
	});

	it("folds the focused tile with Ctrl-B f, keeps its share, moves focus to an open tile, and saves", () => {
		const {s, cmds} = fold(prefixed("f", 20), row);
		expect(folded(s)).toEqual(["t3"]);
		expect(focus(s)).toBe("t2");
		expect(layout(s).root.sizes).toEqual(layout(row).root.sizes);
		expect(cmds.map((c) => c.type)).toEqual(["save"]);
	});

	it("folds a tile from its title bar, and focus stays where it was", () => {
		const {s} = fold([{type: "fold", tile: "t1"}], row);
		expect(folded(s)).toEqual(["t1"]);
		expect(focus(s)).toBe("t3");
	});

	it("focuses a tile on one click of its title bar, and folds it on a double-click", () => {
		const once = fold([{type: "click", tile: "t1"}], row).s;
		expect([focus(once), folded(once)]).toEqual(["t1", []]);
		// A double-click is two presses, each a click, then the fold.
		const twice = fold(
			[
				{type: "click", tile: "t1"},
				{type: "click", tile: "t1"},
				{type: "fold", tile: "t1"},
			],
			row,
		).s;
		expect(folded(twice)).toEqual(["t1"]);
		expect(focus(twice)).toBe("t2");
	});

	it("refuses to fold the last open tile: nothing changes", () => {
		const one = fold(
			[
				{type: "fold", tile: "t1"},
				{type: "fold", tile: "t2"},
			],
			row,
		).s;
		const again = fold(prefixed("f", 20), one);
		expect(folded(again.s)).toEqual(["t1", "t2"]);
		expect(again.cmds).toEqual([]);
		expect(fold([{type: "fold", tile: "t3"}], one).cmds).toEqual([]);
	});

	it("opens a folded tile when focus moves onto it, or its strip is clicked", () => {
		const shut = fold(prefixed("f", 20), row).s;
		const moved = fold(prefixed("l", 30), shut).s;
		expect([focus(moved), folded(moved)]).toEqual(["t3", []]);
		const clicked = fold([{type: "unfold", node: "t3"}], shut).s;
		expect([focus(clicked), folded(clicked)]).toEqual(["t3", []]);
	});

	it("folds a whole column when its tiles fold, and its strip opens them all", () => {
		const shut = fold([...prefixed("f", 20), ...prefixed("f", 30)], column).s;
		expect(folded(shut)).toEqual(["t2", "t3"]);
		expect(focus(shut)).toBe("t1");
		const {s, cmds} = fold([{type: "unfold", node: "c3"}], shut);
		expect([focus(s), folded(s)]).toEqual(["t2", []]);
		expect(cmds.map((c) => c.type)).toEqual(["save"]);
		expect(fold([{type: "unfold", node: "c3"}], s).cmds).toEqual([]);
	});

	it("folds a zoomed tile out of its zoom", () => {
		const zoomed = fold(prefixed("z", 20), row).s;
		const {s} = fold(prefixed("f", 30), zoomed);
		expect([layout(s).zoomed, folded(s), focus(s)]).toEqual([null, ["t3"], "t2"]);
	});

	it("comes back from a kept desk with its folds, and the focused tile open", () => {
		const shut = fold(prefixed("f", 20), row).s;
		const kept = savedOf(opened(shut));
		expect(savedOf(restore(JSON.parse(JSON.stringify(kept))) ?? opened(row))).toEqual(kept);
		const onFolded = {...kept, workspaces: kept.workspaces.map((ws) => ({...ws, focused: "t3"}))};
		const back = restore(JSON.parse(JSON.stringify(onFolded)));
		expect(back === null ? null : folded(back)).toEqual([]);
	});
});

describe("a kept desk", () => {
	it("comes back as it was, and opens each tile's tsh", () => {
		const kept = fold([...prefixed("|"), ...prefixed("-", 10), ...prefixed("N", 20)]).s;
		const back = restore(JSON.parse(JSON.stringify(savedOf(opened(kept)))));
		expect(back).not.toBeNull();
		expect(back === null ? null : savedOf(back)).toEqual(savedOf(opened(kept)));
		const [, cmds] = deskMachine.init(back, undefined);
		expect(cmds).toEqual(["t1", "t2", "t3", "t4"].map((tile) => ({type: "open", tile})));
	});

	it("drops what ran: a covered tile shows tsh, and nothing is closing", () => {
		const ran = fold([
			...prefixed("|"),
			{type: "covered", tile: "t1", runs: [counter]},
			{type: "closing", tile: "t2"},
		]).s;
		const back = restore(savedOf(opened(ran)));
		expect(back === null ? null : ids(back)).toEqual(["t1", "t2"]);
		expect(back?.closing).toEqual([]);
		expect(back === null ? null : findTile(activeOf(back).layout, "t1")?.shows).toEqual({
			kind: "tsh",
			run: null,
		});
	});

	it("refuses one that does not read or breaks a law", () => {
		expect(restore(null)).toBeNull();
		expect(restore({workspaces: [], active: "w1", next: 2})).toBeNull();
		const kept = savedOf(opened(fold(prefixed("|")).s));
		const named = {
			...kept,
			workspaces: kept.workspaces.map((ws) => ({
				...ws,
				layout: {
					...ws.layout,
					root: {
						...ws.layout.root,
						children: [{tag: "tile", id: "../x", shows: {kind: "tsh", run: null}, folded: false}],
					},
				},
			})),
		};
		expect(restore(named)).toBeNull();
		// A desk kept before containers and folds: its root was a "stack". It is not read back.
		const old = {
			...kept,
			workspaces: kept.workspaces.map((ws) => ({
				...ws,
				layout: {...ws.layout, root: {...ws.layout.root, tag: "stack"}},
			})),
		};
		expect(restore(old)).toBeNull();
	});
});

describe("a line with several windows", () => {
	const tracker = {id: "tracker:1", program: "tracker"};
	const ticket = {id: "ticket:1", program: "ticket"};
	const runs = {id: "runs:1", program: "runs"};
	const line = [tracker, ticket, runs] as const;
	const layout = (s: Desk) => activeOf(opened(s)).layout;
	const sizes = (s: Desk) => layout(s).root.sizes;
	/** The same keys, each share within a hundredth of a percent. */
	const near = (got: Readonly<Record<string, number>>, want: Readonly<Record<string, number>>) => {
		expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
		for (const [id, size] of Object.entries(want)) expect(got[id]).toBeCloseTo(size);
	};
	const tile = (s: Desk, id: string) => findTile(layout(s), id);
	/** t1 and t2 side by side, focus on t2, in a workspace this wide. */
	const beside = (width: number) => fold([{type: "area", width, height: 860}, ...prefixed("|")]).s;
	/** The line open in t2, t3 and t4, with focus on t3, the ticket's window. */
	const onTicket = () =>
		fold(
			[
				{type: "covered", tile: "t2", runs: line},
				{type: "click", tile: "t3"},
			],
			beside(1440),
		).s;

	it("opens in place, beside the tile it was typed in, each window a third of its share", () => {
		const {s, cmds} = fold([{type: "covered", tile: "t2", runs: line}], beside(1440));
		expect(ids(s)).toEqual(["t1", "t2", "t3", "t4"]);
		expect(layout(s).root.orientation).toBe("horizontal");
		expect(sizes(s).t1).toBeCloseTo(50);
		for (const id of ["t2", "t3", "t4"]) expect(sizes(s)[id]).toBeCloseTo(50 / 3);
		const own = {id: "tracker:1", from: "t2", tint: 0};
		expect(tile(s, "t2")?.shows).toEqual({kind: "line", run: tracker, line: own});
		expect(tile(s, "t3")?.shows).toEqual({kind: "window", run: ticket, line: own});
		expect(tile(s, "t4")?.shows).toEqual({kind: "window", run: runs, line: own});
		expect(layout(s).root.children.every((c) => c.tag === "tile" && !c.folded)).toBe(true);
		// Focus stays where the line was typed, and only t2 has a tsh to open.
		expect(focus(s)).toBe("t2");
		expect(cmds.map((c) => c.type)).toEqual(["save"]);
		expect(opened(s).next).toBe(5);
	});

	it("opens the windows after the first folded when they would be smaller than 220px", () => {
		const s = fold([{type: "covered", tile: "t2", runs: line}], beside(900)).s;
		expect(tile(s, "t2")?.folded).toBe(false);
		expect(tile(s, "t3")?.folded).toBe(true);
		expect(tile(s, "t4")?.folded).toBe(true);
		// The first window keeps the tile's whole share; the strips hold none.
		near(sizes(s), {t1: 50, t2: 50, t3: 0, t4: 0});
	});

	it("unfolds a window with a share of the line's own space, never an unrelated tile's", () => {
		const tight = fold([{type: "covered", tile: "t2", runs: line}], beside(900)).s;
		const one = fold([{type: "unfold", node: "t3"}], tight).s;
		near(sizes(one), {t1: 50, t2: 25, t3: 25, t4: 0});
		expect(focus(one)).toBe("t3");
		const both = fold([{type: "unfold", node: "t4"}], one).s;
		expect(sizes(both).t1).toBeCloseTo(50);
		for (const id of ["t2", "t3", "t4"]) expect(sizes(both)[id]).toBeCloseTo(50 / 3);
		// Folding one again hands its share back to the line's other open windows.
		const back = fold([{type: "fold", tile: "t4"}], both).s;
		expect(sizes(back).t1).toBeCloseTo(50);
		expect(sizes(back).t2).toBeCloseTo(25);
		expect(sizes(back).t3).toBeCloseTo(25);
	});

	it("nests the line in the tile's place when it runs across the tile's container", () => {
		const s = fold(
			[
				{type: "area", width: 1440, height: 860},
				...prefixed("-"),
				{type: "covered", tile: "t2", runs: line},
			],
			start,
		).s;
		const root = layout(s).root;
		expect(root.orientation).toBe("vertical");
		const [top, row] = root.children;
		expect(top?.id).toBe("t1");
		expect(row?.tag === "container" ? [row.id, row.orientation] : null).toEqual([
			"c3",
			"horizontal",
		]);
		expect(row?.tag === "container" ? row.children.map((c) => c.id) : null).toEqual([
			"t2",
			"t3",
			"t4",
		]);
		expect(root.sizes).toEqual({t1: 50, c3: 50});
	});

	it("hands Ctrl-C in a window to the tsh the line was typed in", () => {
		const s = fold(
			[
				{type: "covered", tile: "t2", runs: line},
				{type: "click", tile: "t4"},
			],
			beside(1440),
		).s;
		expect(fold([{type: "key", key: "<c-c>", at: 0}], s).cmds).toEqual([
			{type: "send", tile: "t2", data: "\x03"},
		]);
	});

	it("takes a window away when its run ends, its space back to the line", () => {
		const s = fold([{type: "covered", tile: "t2", runs: line}], beside(1440)).s;
		const {s: after, cmds} = fold([{type: "over", run: runs.id}], s);
		expect(ids(after)).toEqual(["t1", "t2", "t3"]);
		expect(cmds.map((c) => c.type)).toEqual(["stop", "save"]);
		expect(sizes(after).t1).toBeCloseTo(50);
		expect(sizes(after).t2).toBeCloseTo(25);
		const done = fold(
			[
				{type: "over", run: ticket.id},
				{type: "over", run: tracker.id},
			],
			after,
		).s;
		expect(ids(done)).toEqual(["t1", "t2"]);
		expect(sizes(done).t2).toBeCloseTo(50);
		expect(tile(done, "t2")?.shows).toEqual({kind: "tsh", run: null});
	});

	it("closes a window on y as kill-pane: its one process gets its inputs' end, and the window goes when it ends", () => {
		const s = fold([...prefixed("x", 10), {type: "key", key: "y", at: 20}], onTicket());
		// Only the ticket's process is ended; the tile it was typed in, and its tsh, are not touched.
		expect(s.cmds).toEqual([{type: "end", process: ticket.id}]);
		expect(opened(s.s).closing).toEqual(["t3"]);
		expect(ids(s.s)).toEqual(["t1", "t2", "t3", "t4"]);
		expect(questionOf(opened(s.s), "t3")).toBe("stop t3 now? (y/n)");
		const {s: after, cmds} = fold([{type: "over", run: ticket.id}], s.s);
		expect(ids(after)).toEqual(["t1", "t2", "t4"]);
		expect(opened(after).closing).toEqual([]);
		expect(cmds.map((c) => c.type)).toEqual(["stop", "save"]);
	});

	it("kills a closing window's process on y to stop now, and the window goes at once", () => {
		const closing = fold([...prefixed("x", 10), {type: "key", key: "y", at: 20}], onTicket()).s;
		const s = fold([...prefixed("x", 30), {type: "key", key: "y", at: 40}], closing);
		expect(ids(s.s)).toEqual(["t1", "t2", "t4"]);
		expect(opened(s.s).closing).toEqual([]);
		expect(s.cmds).toEqual([
			{type: "kill", process: ticket.id},
			{type: "stop", tile: "t3"},
			{type: "save", desk: savedOf(opened(s.s))},
		]);
	});

	it("closes the tile the line was typed in as any busy tile: its tsh, and so every process of the line", () => {
		const typed = fold(
			[
				{type: "covered", tile: "t2", runs: line},
				{type: "jobs", tile: "t2", running: 1},
			],
			beside(1440),
		).s;
		const s = fold([...prefixed("x", 10), {type: "key", key: "y", at: 20}], typed);
		expect(s.cmds).toEqual([{type: "close", tile: "t2"}]);
		expect(opened(s.s).closing).toEqual(["t2"]);
	});

	it("gives each line its own tint, and a run alone none", () => {
		const one = fold([{type: "covered", tile: "t2", runs: line}], beside(2400)).s;
		const two = fold(
			[
				{type: "covered", tile: "t1", runs: [{id: "map:1", program: "map"}, runs]},
				{type: "covered", tile: "t4", runs: [counter]},
			],
			one,
		).s;
		const t1 = tile(two, "t1")?.shows;
		expect(t1?.kind === "line" ? t1.line.tint : null).toBe(1);
		expect(tile(two, "t4")?.shows.kind).toBe("window");
		const alone = fold([{type: "covered", tile: "t1", runs: [counter]}], beside(1440)).s;
		expect(tile(alone, "t1")?.shows).toEqual({kind: "tsh", run: counter});
	});

	it("is not kept: a desk read back has the tile it was typed in, at its whole share", () => {
		const s = fold([{type: "covered", tile: "t2", runs: line}], beside(1440)).s;
		const back = restore(JSON.parse(JSON.stringify(savedOf(opened(s)))));
		expect(back === null ? null : ids(back)).toEqual(["t1", "t2"]);
		expect(back === null ? null : sizes(back).t2).toBeCloseTo(50);
		const [, cmds] = deskMachine.init(back, undefined);
		expect(cmds.map((c) => (c.type === "open" ? c.tile : c.type))).toEqual(["t1", "t2"]);
	});
});

describe("keyName", () => {
	it("names keys as the table writes them", () => {
		const plain = {ctrl: false, alt: false, meta: false};
		expect(keyName({...plain, key: "b", ctrl: true})).toBe("<c-b>");
		expect(keyName({...plain, key: "|"})).toBe("|");
		expect(keyName({...plain, key: "N"})).toBe("N");
		expect(keyName({...plain, key: "ArrowLeft"})).toBe("<arrowleft>");
		expect(keyName({...plain, key: "Shift"})).toBeNull();
		expect(keyName({...plain, key: "h", ctrl: true})).toBe("<c-h>");
	});
});
