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
			{type: "covered", tile: "t2", run: counter},
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
		const covered = fold([{type: "covered", tile: "t1", run: counter}]).s;
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
			{type: "covered", tile: "t1", run: counter},
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
