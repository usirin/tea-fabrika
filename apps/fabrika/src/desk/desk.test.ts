import {applyCell} from "@demlik/tea";
import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {windowKeys} from "../../../../fixtures/keybindings/router.ts";
import {PIPES} from "../pipes.ts";
import type {TileJobs} from "../tile-jobs.ts";
import {
	activeOf,
	type Desk,
	type DeskCmd,
	type DeskMsg,
	deskMachine,
	type Open,
	questionOf,
	refusedOf,
	restore,
	savedOf,
	tilesOf,
} from "./desk.ts";
import {decodeKeys, defaults, type Does, type Keys} from "./keymap.ts";
import {keyName} from "./keys.ts";
import {findTile} from "./layout/index.ts";

// The desk, folded by hand. Its laws, as property tests on tea's pbt, are in desk.laws.test.ts.

const [start, booted] = deskMachine.init(null, undefined);

/** A tile's jobs, as its tsh says them: `count` running, none ended. */
const running = (count: number): TileJobs => ({
	running: Array.from({length: count}, (_, i) => ({
		n: i + 1,
		text: "counter",
		since: 0,
		foreground: i === 0,
	})),
	ended: null,
});

describe("today's completed command paths", () => {
	it("K17: a window opens the palette, and an unbound command still runs by name", async () => {
		const read = decodeKeys('palette.open = "<prefix>p"\ntezgah.zoom = []', true);
		if (Result.isFailure(read)) throw new Error(read.failure.why);
		const router = await windowKeys(read.success);
		expect(router.prefixed("p")).toContainEqual(
			expect.objectContaining({
				type: "run",
				target: expect.objectContaining({program: "palette", word: "open"}),
			}),
		);
		const unbound = await windowKeys(read.success);
		expect(unbound.prefixed("z").some((c) => c.type === "run")).toBe(false);
		const two = fold(command("tezgah.split")).s;
		const named = fold([{type: "run", does: "tezgah.zoom"}], two);
		expect(activeOf(opened(named.s)).layout.zoomed).toBe("t2");
	});
});

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

/** The window already resolved the key. The desk receives a finished command. */
const command = (does: Does): readonly DeskMsg[] => [{type: "run", does}];

const ids = (s: Desk) => tilesOf(activeOf(opened(s))).map((t) => t.id);
const focus = (s: Desk) => activeOf(opened(s)).focused;
const counter = {id: "counter:1", program: "counter"};

describe("the desk", () => {
	it("starts with one tile running tsh, and asks for it", () => {
		expect(ids(start)).toEqual(["t1"]);
		expect(booted.map((c) => c.type)).toEqual(["open", "save"]);
	});

	it("splits side by side and top to bottom, the new tile focused and opened", () => {
		const {s, cmds} = fold([...command("tezgah.split"), ...command('tezgah."split --to down"')]);
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
		const split = fold([...command("tezgah.split"), ...command('tezgah."split --to down"')]).s;
		expect(focus(fold(command('tezgah."focus --to left"'), split).s)).toBe("t1");
		expect(focus(fold(command('tezgah."focus --to up"'), split).s)).toBe("t2");
		expect(focus(fold(command('tezgah."focus --to right"'), split).s)).toBe("t3");
	});

	it("the window passes ordinary typing and swallows an unbound key after its prefix", async () => {
		const router = await windowKeys(defaults);
		expect(router.key("|")).toContainEqual(expect.objectContaining({type: "pass"}));
		expect(router.key("<c-b>")).toEqual([]);
		expect(router.state().prefix.armed).toBe(true);
		expect(router.key("q", 1)).toEqual([]);
		expect(router.state().prefix.armed).toBe(false);
	});

	it("the window sends one Ctrl-B on for Ctrl-B twice, as tmux's send-prefix", async () => {
		const router = await windowKeys(defaults);
		expect(router.prefixed("<c-b>")).toEqual([
			expect.objectContaining({
				type: "pass",
				target: expect.objectContaining({tile: "t1"}),
				press: expect.objectContaining({key: "b", ctrl: true}),
			}),
		]);
	});

	it("zooms the focused tile and back, and a split or a focus move undoes the zoom", () => {
		const two = fold(command("tezgah.split")).s;
		const zoomed = fold(command("tezgah.zoom"), two).s;
		expect(activeOf(opened(zoomed)).layout.zoomed).toBe("t2");
		expect(activeOf(opened(fold(command("tezgah.zoom"), zoomed).s)).layout.zoomed).toBeNull();
		expect(
			activeOf(opened(fold(command('tezgah."focus --to left"'), zoomed).s)).layout.zoomed,
		).toBeNull();
	});

	it("asks before closing a tile with nothing running, and Confirm closes it at once", () => {
		const two = fold(command("tezgah.split")).s;
		const asked = fold(command("tezgah.close"), two);
		expect(opened(asked.s).ask).toBe("t2");
		expect(questionOf(opened(asked.s), "t2")).toBe("close t2? (y/n)");
		expect(asked.cmds).toEqual([]);
		const {s, cmds} = fold(command("tezgah.confirm"), asked.s);
		expect(ids(s)).toEqual(["t1"]);
		expect(focus(s)).toBe("t1");
		expect(cmds).toContainEqual({type: "stop", tile: "t2"});
		expect(cmds.some((c) => c.type === "close")).toBe(false);
	});

	it("the window turns y into Confirm, and other ordinary keys into Cancel", async () => {
		for (const key of ["n", "Y", "a", "x", "<enter>"]) {
			const router = await windowKeys(defaults);
			router.send({type: "question", tile: "t2"});
			expect(router.key(key)).toEqual([
				expect.objectContaining({
					type: "run",
					target: expect.objectContaining({program: "tezgah", word: "cancel", tile: "t2"}),
				}),
			]);
		}
		const router = await windowKeys(defaults);
		router.send({type: "question", tile: "t2"});
		expect(router.key("y")).toEqual([
			expect.objectContaining({
				type: "run",
				target: expect.objectContaining({word: "confirm", tile: "t2"}),
			}),
		]);
		const asked = fold([...command("tezgah.split"), ...command("tezgah.close")]).s;
		const no = fold(command("tezgah.cancel"), asked);
		expect(ids(no.s)).toEqual(["t1", "t2"]);
		expect(opened(no.s).ask).toBeNull();
		expect(no.cmds).toEqual([]);
	});
	it("Ctrl-C keeps the tile's priority while a close question is open", async () => {
		const router = await windowKeys(defaults);
		router.send({type: "question", tile: "t1"});
		expect(router.key("<c-c>")).toEqual([
			expect.objectContaining({
				type: "pass",
				target: expect.objectContaining({tile: "t1"}),
				press: expect.objectContaining({key: "c", ctrl: true}),
			}),
		]);
	});

	it("gives a busy tile's programs the end of their inputs on y, and takes it away when its tsh ended", () => {
		const busy = fold([...command("tezgah.split"), {type: "jobs", tile: "t2", jobs: running(1)}]).s;
		const yes = fold([...command("tezgah.close"), ...command("tezgah.confirm")], busy);
		expect(ids(yes.s)).toEqual(["t1", "t2"]);
		expect(opened(yes.s).closing).toEqual(["t2"]);
		expect(yes.cmds).toEqual([{type: "close", tile: "t2"}]);
		// The programs ended, then tsh: the tile goes, and what is left of it is stopped.
		const ended = fold(
			[
				{type: "jobs", tile: "t2", jobs: running(0)},
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
			...command("tezgah.split"),
			{type: "covered", tile: "t2", runs: [counter]},
			...command("tezgah.close"),
			...command("tezgah.confirm"),
		]).s;
		expect(opened(covered).closing).toEqual(["t2"]);
		const asked = fold(command("tezgah.close"), covered).s;
		expect(opened(asked).ask).toBe("t2");
		expect(questionOf(opened(asked), "t2")).toBe("stop t2 now? (y/n)");
		const no = fold(command("tezgah.cancel"), asked).s;
		expect(ids(no)).toEqual(["t1", "t2"]);
		expect(opened(no).closing).toEqual(["t2"]);
		const yes = fold(command("tezgah.confirm"), asked);
		expect(ids(yes.s)).toEqual(["t1"]);
		expect(yes.cmds).toContainEqual({type: "stop", tile: "t2"});
	});

	it("hears a tile was closing before the page loaded: its question is stop", () => {
		const two = fold([...command("tezgah.split"), {type: "closing", tile: "t2"}]).s;
		expect(opened(two).closing).toEqual(["t2"]);
		expect(questionOf(opened(two), "t2")).toBe("stop t2 now? (y/n)");
	});

	it("empties when the last tile closes: the window closes, as with Terminal's last tab", () => {
		const {s, cmds} = fold([...command("tezgah.close"), ...command("tezgah.confirm")]);
		expect(s).toEqual({at: "over"});
		expect(cmds).toEqual([{type: "stop", tile: "t1"}, {type: "empty"}]);
	});

	it("covers a tile with a foreground run, hands Ctrl-C to its tsh, and shows tsh again when it ends", () => {
		const covered = fold([{type: "covered", tile: "t1", runs: [counter]}]).s;
		expect(findTile(activeOf(opened(covered)).layout, "t1")?.shows).toEqual({
			kind: "tsh",
			run: counter,
		});
		expect(fold(command("tezgah.interrupt"), covered).cmds).toEqual([
			{type: "send", tile: "t1", data: "\x03"},
		]);
		const back = fold([{type: "over", run: counter.id}], covered).s;
		expect(findTile(activeOf(opened(back)).layout, "t1")?.shows).toEqual({kind: "tsh", run: null});
		expect(fold(command("tezgah.interrupt"), back).cmds).toEqual([]);
	});

	it("makes workspaces and walks them by finished commands", () => {
		const three = fold([
			...command('tezgah."workspace --to new"'),
			...command('tezgah."workspace --to new"'),
		]).s;
		expect(opened(three).workspaces.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
		expect(opened(three).active).toBe("w3");
		const walked = fold(
			[
				...command('tezgah."workspace --to previous"'),
				...command('tezgah."workspace --to previous"'),
			],
			three,
		).s;
		expect(opened(walked).active).toBe("w1");
		expect(opened(fold(command('tezgah."workspace --to next"'), walked).s).active).toBe("w2");
	});

	it("closes a workspace with its last tile, and moves to the one next to it", () => {
		const two = fold(command('tezgah."workspace --to new"')).s;
		const {s} = fold([...command("tezgah.close"), ...command("tezgah.confirm")], two);
		expect(opened(s).workspaces.map((w) => w.id)).toEqual(["w1"]);
		expect(opened(s).active).toBe("w1");
	});

	it("resizes a container from a dragged border", () => {
		const two = fold(command("tezgah.split")).s;
		const root = activeOf(opened(two)).layout.root;
		const {s} = fold([{type: "resize", container: root.id, sizes: {t1: 70, t2: 30}}], two);
		expect(activeOf(opened(s)).layout.root.sizes).toEqual({t1: 70, t2: 30});
	});

	it("closes a tile whose tsh ended", () => {
		const two = fold(command("tezgah.split")).s;
		const {s, cmds} = fold([{type: "ended", tile: "t2"}], two);
		expect(ids(s)).toEqual(["t1"]);
		expect(cmds).toContainEqual({type: "stop", tile: "t2"});
	});
});

describe("the desk, moved by the window's frame", () => {
	it("picks a workspace by its place, or by a click on its name", () => {
		const three = fold([
			...command('tezgah."workspace --to new"'),
			...command('tezgah."workspace --to new"'),
		]).s;
		expect(opened(fold(command('tezgah."workspace --to 1"'), three).s).active).toBe("w1");
		expect(opened(fold(command('tezgah."workspace --to 9"'), three).s).active).toBe("w3");
		const {s, cmds} = fold([{type: "pick", workspace: "w2"}], three);
		expect(opened(s).active).toBe("w2");
		expect(cmds.map((c) => c.type)).toEqual(["save"]);
		expect(fold([{type: "pick", workspace: "w9"}], three).s).toBe(three);
	});

	it("goes to a tile in another workspace, as an ask picked in the list does, and unzooms another", () => {
		const zoomed = fold([
			...command("tezgah.split"),
			...command("tezgah.zoom"),
			...command('tezgah."workspace --to new"'),
		]).s;
		expect(opened(zoomed).active).not.toBe("w1");
		const {s} = fold([{type: "go", tile: "t1"}], zoomed);
		expect(opened(s).active).toBe("w1");
		expect(focus(s)).toBe("t1");
		expect(activeOf(opened(s)).layout.zoomed).toBeNull();
		expect(fold([{type: "go", tile: "t9"}], zoomed).s).toBe(zoomed);
	});

	it("runs completed commands by name, while opening the palette stays in the window", () => {
		const split = fold(command("tezgah.split"));
		expect(ids(split.s)).toEqual(["t1", "t2"]);
		expect(split.cmds).toContainEqual({type: "open", tile: "t2"});
		expect(fold([{type: "run", does: "keys.open"}]).cmds).toEqual([{type: "show", what: "keys"}]);
		// The palette is the page's own: the desk has nothing to run for it.
		const palette = fold([{type: "run", does: "palette.open"}]);
		expect(palette.s).toBe(start);
		expect(palette.cmds).toEqual([]);
	});

	it("asks the frame to show the asks, the keys, the info mode and an item's lines, and changes nothing else", () => {
		for (const [does, what] of [
			["tezgah.asks", "asks"],
			["keys.open", "keys"],
			["tezgah.info", "info"],
			["tezgah.bars", "bars"],
			["tezgah.agents", "agents"],
			["tezgah.sync", "sync"],
			["tezgah.host", "host"],
		] as const) {
			const {s, cmds} = fold(command(does));
			expect(cmds).toEqual([{type: "show", what}]);
			expect(savedOf(opened(s))).toEqual(savedOf(opened(start)));
		}
	});
});

describe("the desk, moved by a word typed in tsh", () => {
	it("does what the completed command does, from the tile it was typed in", () => {
		const viaWord = fold([{type: "typed", tile: "t1", does: {kind: "zoom"}}]);
		const named = fold(command("tezgah.zoom"));
		expect(viaWord.s).toEqual(named.s);
		expect(viaWord.cmds).toEqual(named.cmds);
	});

	it("brings the tile's workspace forward and focuses it first, with one save of both", () => {
		// t1 in w1, t2 in w2, which is in front.
		const two = fold(command('tezgah."workspace --to new"')).s;
		const {s, cmds} = fold(
			[{type: "typed", tile: "t1", does: {kind: "split", orientation: "vertical"}}],
			two,
		);
		expect(opened(s).active).toBe("w1");
		expect(ids(s)).toEqual(["t1", "t3"]);
		expect(focus(s)).toBe("t3");
		expect(cmds.map((c) => c.type)).toEqual(["open", "save"]);
	});

	it("moves to a tile by name with focus --to, and zooms from the originating tile", () => {
		const two = fold(command("tezgah.split")).s;
		const {s} = fold([{type: "typed", tile: "t2", does: {kind: "go", tile: "t1"}}], two);
		expect(focus(s)).toBe("t1");
		const zoomed = fold([{type: "typed", tile: "t2", does: {kind: "zoom"}}], two).s;
		expect(activeOf(opened(zoomed)).layout.zoomed).toBe("t2");
	});

	it("shows an item's lines on every page, and saves nothing", () => {
		const {s, cmds} = fold([{type: "typed", tile: "t1", does: {kind: "show", what: "agents"}}]);
		expect(cmds).toEqual([{type: "show", what: "agents"}]);
		expect(s).toEqual(start);
	});

	it("says why a word does nothing: a tile gone, a tile or a workspace not there", () => {
		const two = opened(fold(command('tezgah."workspace --to new"')).s);
		expect(refusedOf(two, "t1", {kind: "zoom"})).toBeNull();
		expect(refusedOf(two, "t9", {kind: "zoom"})).toBe("t9 is gone");
		expect(refusedOf(two, "t1", {kind: "go", tile: "t7"})).toBe("no tile t7");
		expect(refusedOf(two, "t1", {kind: "pick", at: 2})).toBeNull();
		expect(refusedOf(two, "t1", {kind: "pick", at: 3})).toBe("no workspace 3: there are 2");
		expect(refusedOf(opened(start), "t1", {kind: "pick", at: 2})).toBe(
			"no workspace 2: there is 1",
		);
		expect(fold([{type: "typed", tile: "t9", does: {kind: "zoom"}}], two).s).toBe(two);
	});
});

describe("folds", () => {
	const layout = (s: Desk) => activeOf(opened(s)).layout;
	const folded = (s: Desk) =>
		tilesOf(activeOf(opened(s)))
			.filter((t) => t.folded)
			.map((t) => t.id);
	/** t1, t2 and t3 side by side, focus on t3. */
	const row = fold([...command("tezgah.split"), ...command("tezgah.split")]).s;
	/** t1 beside a column of t2 over t3, the column c3, focus on t3. */
	const column = fold([...command("tezgah.split"), ...command('tezgah."split --to down"')]).s;

	it("turns the focused tile's container, horizontal to vertical and back, and saves each", () => {
		const turned = fold(command("tezgah.turn"), row);
		expect(layout(turned.s).root.orientation).toBe("vertical");
		expect(turned.cmds.at(-1)?.type).toBe("save");
		expect(layout(fold(command("tezgah.turn"), turned.s).s).root.orientation).toBe("horizontal");
	});

	it("folds the focused tile, keeps its share, moves focus to an open tile, and saves", () => {
		const {s, cmds} = fold(command("tezgah.fold"), row);
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
		const again = fold(command("tezgah.fold"), one);
		expect(folded(again.s)).toEqual(["t1", "t2"]);
		expect(again.cmds).toEqual([]);
		expect(fold([{type: "fold", tile: "t3"}], one).cmds).toEqual([]);
	});

	it("opens a folded tile when focus moves onto it, or its strip is clicked", () => {
		const shut = fold(command("tezgah.fold"), row).s;
		const moved = fold(command('tezgah."focus --to right"'), shut).s;
		expect([focus(moved), folded(moved)]).toEqual(["t3", []]);
		const clicked = fold([{type: "unfold", node: "t3"}], shut).s;
		expect([focus(clicked), folded(clicked)]).toEqual(["t3", []]);
	});

	it("folds a whole column when its tiles fold, and its strip opens them all", () => {
		const shut = fold([...command("tezgah.fold"), ...command("tezgah.fold")], column).s;
		expect(folded(shut)).toEqual(["t2", "t3"]);
		expect(focus(shut)).toBe("t1");
		const {s, cmds} = fold([{type: "unfold", node: "c3"}], shut);
		expect([focus(s), folded(s)]).toEqual(["t2", []]);
		expect(cmds.map((c) => c.type)).toEqual(["save"]);
		expect(fold([{type: "unfold", node: "c3"}], s).cmds).toEqual([]);
	});

	it("folds a zoomed tile out of its zoom", () => {
		const zoomed = fold(command("tezgah.zoom"), row).s;
		const {s} = fold(command("tezgah.fold"), zoomed);
		expect([layout(s).zoomed, folded(s), focus(s)]).toEqual([null, ["t3"], "t2"]);
	});

	it("comes back from a kept desk with its folds, and the focused tile open", () => {
		const shut = fold(command("tezgah.fold"), row).s;
		const kept = savedOf(opened(shut));
		expect(savedOf(restore(JSON.parse(JSON.stringify(kept))) ?? opened(row))).toEqual(kept);
		const onFolded = {...kept, workspaces: kept.workspaces.map((ws) => ({...ws, focused: "t3"}))};
		const back = restore(JSON.parse(JSON.stringify(onFolded)));
		expect(back === null ? null : folded(back)).toEqual([]);
	});
});

describe("a kept desk", () => {
	// A desk kept before pipes had letters: its lines have none, and their tints are the old six's
	// numbers. It still comes back, so nobody loses a desk to the change, and its pipes go as any
	// kept line's do, since nothing runs after a restart.
	it("comes back when it was kept before pipes had letters", () => {
		const tracker = {id: "tracker:1", program: "tracker"};
		const ticket = {id: "ticket:1", program: "ticket"};
		const piped = fold([
			...command("tezgah.split"),
			{type: "covered", tile: "t2", runs: [tracker, ticket]},
		]).s;
		const before = JSON.parse(JSON.stringify(savedOf(opened(piped))), (key, value: unknown) =>
			key === "letter" ? undefined : key === "tint" ? 4 : value,
		);
		expect(JSON.stringify(before)).not.toContain("letter");
		const back = restore(before);
		expect(back === null ? null : ids(back)).toEqual(["t1", "t2"]);
		expect(back === null ? null : findTile(activeOf(back).layout, "t2")?.shows).toEqual({
			kind: "tsh",
			run: null,
		});
	});

	it("comes back as it was, and opens each tile's tsh", () => {
		const kept = fold([
			...command("tezgah.split"),
			...command('tezgah."split --to down"'),
			...command('tezgah."workspace --to new"'),
		]).s;
		const back = restore(JSON.parse(JSON.stringify(savedOf(opened(kept)))));
		expect(back).not.toBeNull();
		expect(back === null ? null : savedOf(back)).toEqual(savedOf(opened(kept)));
		const [, cmds] = deskMachine.init(back, undefined);
		expect(cmds).toEqual(["t1", "t2", "t3", "t4"].map((tile) => ({type: "open", tile})));
	});

	it("drops what ran: a covered tile shows tsh, and nothing is closing", () => {
		const ran = fold([
			...command("tezgah.split"),
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
		const kept = savedOf(opened(fold(command("tezgah.split")).s));
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
	const trace = {id: "trace:1", program: "trace"};
	const line = [tracker, ticket, trace] as const;
	const layout = (s: Desk) => activeOf(opened(s)).layout;
	const sizes = (s: Desk) => layout(s).root.sizes;
	/** The same keys, each share within a hundredth of a percent. */
	const near = (got: Readonly<Record<string, number>>, want: Readonly<Record<string, number>>) => {
		expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
		for (const [id, size] of Object.entries(want)) expect(got[id]).toBeCloseTo(size);
	};
	const tile = (s: Desk, id: string) => findTile(layout(s), id);
	/** t1 and t2 side by side, focus on t2, in a workspace this wide. */
	const beside = (width: number) =>
		fold([{type: "area", width, height: 860}, ...command("tezgah.split")]).s;
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
		const own = {id: "tracker:1", from: "t2", tint: 0, letter: "A"};
		expect(tile(s, "t2")?.shows).toEqual({kind: "line", run: tracker, line: own});
		expect(tile(s, "t3")?.shows).toEqual({kind: "window", run: ticket, line: own});
		expect(tile(s, "t4")?.shows).toEqual({kind: "window", run: trace, line: own});
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
				...command('tezgah."split --to down"'),
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
		expect(fold(command("tezgah.interrupt"), s).cmds).toEqual([
			{type: "send", tile: "t2", data: "\x03"},
		]);
	});

	it("takes a window away when its run ends, its space back to the line", () => {
		const s = fold([{type: "covered", tile: "t2", runs: line}], beside(1440)).s;
		const {s: after, cmds} = fold([{type: "over", run: trace.id}], s);
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
		const s = fold([...command("tezgah.close"), ...command("tezgah.confirm")], onTicket());
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
		const closing = fold([...command("tezgah.close"), ...command("tezgah.confirm")], onTicket()).s;
		const s = fold([...command("tezgah.close"), ...command("tezgah.confirm")], closing);
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
				{type: "jobs", tile: "t2", jobs: running(1)},
			],
			beside(1440),
		).s;
		const s = fold([...command("tezgah.close"), ...command("tezgah.confirm")], typed);
		expect(s.cmds).toEqual([{type: "close", tile: "t2"}]);
		expect(opened(s.s).closing).toEqual(["t2"]);
	});

	it("gives each line its own tint and letter, and a run alone none", () => {
		const one = fold([{type: "covered", tile: "t2", runs: line}], beside(2400)).s;
		const two = fold(
			[
				{type: "covered", tile: "t1", runs: [{id: "map:1", program: "map"}, trace]},
				{type: "covered", tile: "t4", runs: [counter]},
			],
			one,
		).s;
		const t1 = tile(two, "t1")?.shows;
		expect(t1?.kind === "line" ? [t1.line.tint, t1.line.letter] : null).toEqual([1, "B"]);
		expect(tile(two, "t4")?.shows.kind).toBe("window");
		const alone = fold([{type: "covered", tile: "t1", runs: [counter]}], beside(1440)).s;
		expect(tile(alone, "t1")?.shows).toEqual({kind: "tsh", run: counter});
	});

	// pipe-colors.md: colors are counted per workspace, sky first. A pipe in another workspace takes
	// none of this one's colors or letters.
	it("gives pipes in one workspace sky, pink, teal, violet, lime, plum in order, and each workspace its own count", () => {
		const splits = Array.from({length: 5}, () => command("tezgah.split")).flat();
		const six = fold(splits).s;
		expect(ids(six)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
		const pipes = fold(
			["t1", "t2", "t3", "t4", "t5", "t6"].map((at, n): DeskMsg => ({
				type: "covered",
				tile: at,
				runs: [
					{id: `tracker:${n}`, program: "tracker"},
					{id: `ticket:${n}`, program: "ticket"},
				],
			})),
			six,
		).s;
		const lineAt = (s: Desk, at: string) => {
			const shows = tile(s, at)?.shows;
			return shows?.kind === "line" ? shows.line : null;
		};
		const opened6 = ["t1", "t2", "t3", "t4", "t5", "t6"].map((at) => lineAt(pipes, at));
		expect(opened6.map((l) => (l === null ? null : PIPES[l.tint]))).toEqual([
			"sky",
			"pink",
			"teal",
			"violet",
			"lime",
			"plum",
		]);
		expect(opened6.map((l) => l?.letter)).toEqual(["A", "B", "C", "D", "E", "F"]);
		// A new workspace starts its own count: its first pipe is sky and A, though the first
		// workspace already has a sky pipe A. Counted across workspaces, it would be pink.
		const onePipe = fold(
			[
				{
					type: "covered",
					tile: "t1",
					runs: [
						{id: "tracker:8", program: "tracker"},
						{id: "ticket:8", program: "ticket"},
					],
				},
			],
			six,
		).s;
		const other = fold(command('tezgah."workspace --to new"'), onePipe).s;
		const here = focus(other);
		const there = fold(
			[
				{
					type: "covered",
					tile: here,
					runs: [
						{id: "tracker:9", program: "tracker"},
						{id: "ticket:9", program: "ticket"},
					],
				},
			],
			other,
		).s;
		const first = lineAt(there, here);
		expect(first === null ? null : [PIPES[first.tint], first.letter]).toEqual(["sky", "A"]);
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

// ---------------------------------------------------------------- the keys file (ticket 174, PR 1)

/** The keybindings file's table, as the host decodes it; a refusal fails the test. */
const table = (text: string): Keys => {
	const answer = decodeKeys(text, true);
	if (Result.isFailure(answer)) throw new Error(`refused: ${answer.failure.why}`);
	return answer.success;
};
// Shipped keys, frozen before PR 2. Expected command names do not come from the catalog.
const TODAY = [
	["|", "tezgah", "split", false],
	["-", "tezgah", "split --to down", false],
	["h", "tezgah", "focus --to left", false],
	["j", "tezgah", "focus --to down", false],
	["k", "tezgah", "focus --to up", false],
	["l", "tezgah", "focus --to right", false],
	["<arrowleft>", "tezgah", "focus --to left", false],
	["<arrowdown>", "tezgah", "focus --to down", false],
	["<arrowup>", "tezgah", "focus --to up", false],
	["<arrowright>", "tezgah", "focus --to right", false],
	[" ", "tezgah", "turn", false],
	["f", "tezgah", "fold", false],
	["z", "tezgah", "zoom", false],
	["x", "tezgah", "close", false],
	["N", "tezgah", "workspace --to new", false],
	["<c-h>", "tezgah", "workspace --to previous", true],
	["<c-l>", "tezgah", "workspace --to next", true],
	...Array.from(
		{length: 9},
		(_, i) => [String(i + 1), "tezgah", `workspace --to ${i + 1}`, false] as const,
	),
	["a", "tezgah", "asks", false],
	["J", "tezgah", "jobs", false],
	["?", "keys", "open", false],
	["i", "tezgah", "info", false],
	["B", "tezgah", "bars", false],
	["A", "tezgah", "agents", false],
	["S", "tezgah", "sync", false],
	["H", "tezgah", "host", false],
] as const;

/** A key's name in a test's title: the space is Space. */
const titled = (key: string) => (key === " " ? "Space" : key);

describe("the window router, on the keys file", () => {
	it.each(
		TODAY.map(
			([key, program, word, repeats]) => [titled(key), key, program, word, repeats] as const,
		),
	)(
		"keeps C-b %s's shipped command with no file or an empty file (p1)",
		async (_, key, program, word, repeats) => {
			for (const keys of [defaults, table("")]) {
				const router = await windowKeys(keys);
				expect(router.prefixed(key, 100)).toEqual([
					expect.objectContaining({type: "run", target: {program, word, mode: null, tile: "t1"}}),
				]);
				expect(router.state().prefix).toEqual(repeats ? {armed: true, until: 601} : {armed: false});
			}
		},
	);

	it("arms on your prefix, passes Ctrl-B, and sends your prefix once when doubled (p2)", async () => {
		const router = await windowKeys(table('prefix = "ctrl+a"'));
		expect(router.key("<c-b>")).toEqual([
			expect.objectContaining({
				type: "pass",
				press: expect.objectContaining({key: "b", ctrl: true}),
			}),
		]);
		expect(router.key("<c-a>")).toEqual([]);
		expect(router.state().prefix.armed).toBe(true);
		expect(router.key("<c-a>", 1)).toEqual([
			expect.objectContaining({
				type: "pass",
				target: expect.objectContaining({tile: "t1"}),
				press: expect.objectContaining({key: "a", ctrl: true}),
			}),
		]);
		expect(router.state().prefix.armed).toBe(false);
	});

	it.each(TODAY.map(([key, program, word]) => [titled(key), key, program, word] as const))(
		"moves C-b %s to C-a with the prefix (p2)",
		async (_, key, program, word) => {
			const router = await windowKeys(table('prefix = "ctrl+a"'));
			expect(router.prefixed(key, 100, "<c-a>")).toEqual([
				expect.objectContaining({type: "run", target: {program, word, mode: null, tile: "t1"}}),
			]);
		},
	);

	it("runs a command on your key, and swallows its old key after the prefix (p3)", async () => {
		const keys = table('tezgah.zoom = "<prefix>m"');
		const moved = await windowKeys(keys);
		expect(moved.prefixed("m")).toEqual([
			expect.objectContaining({type: "run", target: expect.objectContaining({word: "zoom"})}),
		]);
		const old = await windowKeys(keys);
		expect(old.prefixed("z")).toEqual([]);
		expect(old.state().prefix.armed).toBe(false);
	});

	it("runs your command on a default's key, and the default no longer does (p3)", async () => {
		const router = await windowKeys(table('tezgah.zoom = "<prefix>x"'));
		expect(router.prefixed("x")).toEqual([
			expect.objectContaining({type: "run", target: expect.objectContaining({word: "zoom"})}),
		]);
	});

	it("runs an unbound command from the palette and tsh, and from no key (p4)", async () => {
		const router = await windowKeys(table("tezgah.zoom = []"));
		expect(router.prefixed("z")).toEqual([]);
		const two = fold(command("tezgah.split")).s;
		expect(activeOf(opened(fold(command("tezgah.zoom"), two).s)).layout.zoomed).toBe("t2");
		expect(
			activeOf(opened(fold([{type: "typed", tile: "t2", does: {kind: "zoom"}}], two).s)).layout
				.zoomed,
		).toBe("t2");
	});

	it("resolves tezgah and palette keys pressed alone in the window (p5, p6)", async () => {
		const keys = table('tezgah.split = "cmd+d"\npalette.open = "cmd+p"');
		for (const [key, program, word] of [
			["<m-d>", "tezgah", "split"],
			["<m-p>", "palette", "open"],
		]) {
			const router = await windowKeys(keys);
			expect(router.key(key!)).toEqual([
				expect.objectContaining({type: "run", target: expect.objectContaining({program, word})}),
			]);
			expect(router.state().prefix.armed).toBe(false);
		}
		const old = await windowKeys(keys);
		expect(old.prefixed("|")).toEqual([]);
	});

	it("swaps the window table without work and disarms ordinary and repeating prefixes (p9)", async () => {
		for (const repeat of [false, true]) {
			const router = await windowKeys(defaults);
			if (repeat) {
				const [cmd] = router.prefixed("<c-l>", 10);
				expect(cmd?.id).toBeTypeOf("string");
				router.send({type: "applied", id: cmd!.id!, target: {program: "tsh", tile: "t1"}});
			} else router.key("<c-b>");
			expect(router.state().prefix.armed).toBe(true);
			expect(router.send({type: "keys", keys: table('prefix = "ctrl+a"')})).toEqual([]);
			expect(router.state().prefix.armed).toBe(false);
			expect(router.key("|")).toContainEqual(expect.objectContaining({type: "pass"}));
			expect(router.prefixed("|", 20, "<c-a>")).toContainEqual(
				expect.objectContaining({type: "run", target: expect.objectContaining({word: "split"})}),
			);
		}
	});

	it("repeats workspace movement for 500 ms, then passes the key to the tile", async () => {
		const router = await windowKeys(defaults);
		const [first] = router.prefixed("<c-h>", 100);
		expect(first?.target?.word).toBe("workspace --to previous");
		expect(first?.id).toBeTypeOf("string");
		router.send({type: "applied", id: first!.id!, target: {program: "tsh", tile: "t1"}});
		const [again] = router.key("<c-h>", 300);
		expect(again?.target?.word).toBe("workspace --to previous");
		expect(again?.id).toBeTypeOf("string");
		router.send({type: "applied", id: again!.id!, target: {program: "tsh", tile: "t1"}});
		expect(router.key("<c-h>", 900)).toEqual([expect.objectContaining({type: "pass"})]);
		expect(router.state().prefix.armed).toBe(false);
	});

	it.each([
		["Alt-A", "alt+a", "<a-a>"],
		["F12", "f12", "<f12>"],
	])("takes a %s prefix twice, and sends no byte, since it has none", async (_, spelled, key) => {
		const router = await windowKeys(table(`prefix = "${spelled}"`));
		expect(router.prefixed(key, 0, key)).toEqual([]);
		expect(router.state().prefix.armed).toBe(false);
	});

	it("sends no prefix byte to a tile a program covers, when the prefix is pressed twice", async () => {
		const router = await windowKeys(defaults, {program: "counter", tile: "t1"});
		expect(router.prefixed("<c-b>")).toEqual([]);
		expect(router.state().prefix.armed).toBe(false);
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
