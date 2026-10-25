import {applyCell, type Machine} from "@demlik/tea";
import {
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	activeOf,
	claims,
	close,
	type Desk,
	type DeskCmd,
	type DeskMsg,
	deskMachine,
	fresh,
	type Open,
	open,
	quit,
	restore,
	save,
	savedOf,
	send,
	stop,
	tilesOf,
	whereIs,
} from "./desk.ts";
import {keyName} from "./keys.ts";
import {checkTree, findTile} from "./layout/index.ts";

// The desk, folded by hand, and its laws as property tests on tea's pbt.

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

	it("closes a tile with nothing running at once: its tsh ends, focus goes to the tile beside", () => {
		const {s, cmds} = fold([...prefixed("|"), ...prefixed("x", 10)]);
		expect(ids(s)).toEqual(["t1"]);
		expect(focus(s)).toBe("t1");
		expect(cmds).toContainEqual({type: "close", tile: "t2"});
	});

	it("asks y or n before closing a tile whose tsh runs a job; n keeps it", () => {
		const busy = fold([...prefixed("|"), {type: "jobs", tile: "t2", running: 1}]).s;
		const asked = fold(prefixed("x", 10), busy);
		expect(opened(asked.s).ask).toBe("t2");
		expect(asked.cmds).toEqual([]);
		const no = fold([{type: "key", key: "n", at: 20}], asked.s);
		expect(ids(no.s)).toEqual(["t1", "t2"]);
		expect(opened(no.s).ask).toBeNull();
		const yes = fold([{type: "key", key: "y", at: 20}], asked.s);
		expect(ids(yes.s)).toEqual(["t1"]);
		expect(yes.cmds).toContainEqual({type: "close", tile: "t2"});
	});

	it("quits when the last tile closes, as tmux ends with its last pane", () => {
		const {s, cmds} = fold(prefixed("x"));
		expect(s).toEqual({at: "over"});
		expect(cmds).toEqual([{type: "close", tile: "t1"}, {type: "quit"}]);
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

	it("puts a run started with & in a tile of its own beside its tsh, and takes the tile away at its end", () => {
		const beside = fold([{type: "beside", tile: "t1", run: counter}]).s;
		expect(ids(beside)).toEqual(["t1", "t2"]);
		expect(focus(beside)).toBe("t1");
		expect(findTile(activeOf(opened(beside)).layout, "t2")?.shows).toEqual({
			kind: "run",
			run: counter,
			of: "t1",
		});
		expect(ids(fold([{type: "over", run: counter.id}], beside).s)).toEqual(["t1"]);
	});

	it("closes a tsh's run tiles with it, and stops a run whose own tile is closed", () => {
		const beside = fold([...prefixed("|"), {type: "beside", tile: "t1", run: counter}]).s;
		expect(ids(beside)).toEqual(["t1", "t3", "t2"]);
		const t1 = fold(
			[{type: "click", tile: "t1"}, ...prefixed("x", 10), {type: "key", key: "y", at: 20}],
			beside,
		);
		expect(ids(t1.s)).toEqual(["t2"]);
		expect(t1.cmds).toContainEqual({type: "close", tile: "t1"});
		const own = fold(
			[{type: "click", tile: "t3"}, ...prefixed("x", 10), {type: "key", key: "y", at: 20}],
			beside,
		);
		expect(ids(own.s)).toEqual(["t1", "t2"]);
		expect(own.cmds).toContainEqual({type: "stop", run: counter.id});
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
		const {s} = fold(prefixed("x", 10), two);
		expect(opened(s).workspaces.map((w) => w.id)).toEqual(["w1"]);
		expect(opened(s).active).toBe("w1");
	});

	it("resizes a stack from a dragged border", () => {
		const two = fold(prefixed("|")).s;
		const root = activeOf(opened(two)).layout.root;
		const {s} = fold([{type: "resize", stack: root.id, sizes: {t1: 70, t2: 30}}], two);
		expect(activeOf(opened(s)).layout.root.sizes).toEqual({t1: 70, t2: 30});
	});

	it("closes a tile whose tsh ended", () => {
		const two = fold(prefixed("|")).s;
		const {s, cmds} = fold([{type: "ended", tile: "t2"}], two);
		expect(ids(s)).toEqual(["t1"]);
		expect(cmds).toContainEqual({type: "close", tile: "t2"});
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

	it("drops what ran: a run's own tile goes, a covered tile shows tsh", () => {
		const ran = fold([
			{type: "covered", tile: "t1", run: counter},
			{type: "beside", tile: "t1", run: {id: "counter:2", program: "counter"}},
		]).s;
		const back = restore(savedOf(opened(ran)));
		expect(back === null ? null : ids(back)).toEqual(["t1"]);
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
						children: [{tag: "tile", id: "../x", shows: {kind: "tsh", run: null}}],
					},
				},
			})),
		};
		expect(restore(named)).toBeNull();
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

// The laws, after every step of any list of Msgs, from the real init.

const tile = fc.constantFrom("t1", "t2", "t3", "t4", "t5", "t6");
const run = fc.constantFrom(
	{id: "counter:1", program: "counter"},
	{id: "tracker:1", program: "tracker"},
);
/** Half the keys are the prefix, so most lists split, zoom, close and walk a good deal. */
const after = ["|", "-", "h", "j", "k", "l", "<arrowup>", "z", "x", "N", "<c-h>", "<c-l>"];
const key = fc.oneof(
	{arbitrary: fc.constant("<c-b>"), weight: 1},
	{arbitrary: fc.constantFrom(...after, "y", "n", "<c-c>", "a"), weight: 1},
);

type MsgOf<T> = T extends Machine<infer _S, infer M, infer _C, infer _U, infer _X> ? M : never;

/** A Cmd's failed answer. The desk's Cmds declare no errors, so a malformed answer is the one left. */
const failed = <T extends string, C>(type: T, cmd: C) =>
	fc.constant({type, cmd, error: {_tag: "malformed_result", issues: []} as const, at: 0});

const [opening, closing, stopping, sending, saving, quitting] = [
	open({tile: "t1"}),
	close({tile: "t1"}),
	stop({run: "counter:1"}),
	send({tile: "t1", data: "x"}),
	save({desk: savedOf(fresh())}),
	quit({}),
] as const;

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<MsgOf<typeof deskMachine>> = {
	key: arbRecordMsg("key", {key, at: fc.nat({max: 3000})}),
	click: arbRecordMsg("click", {tile}),
	resize: arbRecordMsg("resize", {
		stack: fc.constantFrom("s1", "s2", "s3", "s4"),
		sizes: fc.dictionary(tile, fc.double({min: 0, max: 200, noNaN: true})),
	}),
	covered: arbRecordMsg("covered", {tile, run}),
	beside: arbRecordMsg("beside", {tile, run}),
	over: arbRecordMsg("over", {run: run.map((r) => r.id)}),
	jobs: arbRecordMsg("jobs", {tile, running: fc.nat({max: 2})}),
	ended: arbRecordMsg("ended", {tile}),
	open_ok: fc.constant(open.ok(opening, null, 0)),
	open_err: failed(open.errType, opening),
	close_ok: fc.constant(close.ok(closing, null, 0)),
	close_err: failed(close.errType, closing),
	stop_ok: fc.constant(stop.ok(stopping, null, 0)),
	stop_err: failed(stop.errType, stopping),
	send_ok: fc.constant(send.ok(sending, null, 0)),
	send_err: failed(send.errType, sending),
	save_ok: fc.constant(save.ok(saving, null, 0)),
	save_err: failed(save.errType, saving),
	quit_ok: fc.constant(quit.ok(quitting, null, 0)),
	quit_err: failed(quit.errType, quitting),
};
/**
 * Lists of Msgs, mostly keys. Not tea's `arbMsgSequence`: at fast-check's default size its lists
 * come out about ten long (demlik#744), too short to make a few workspaces and close them again.
 */
const lists = fc.array(
	arbMsg(table, {weights: {key: 24, click: 2, covered: 2, beside: 2, over: 2, jobs: 2}}),
	{maxLength: 60, size: "max"},
);

/** Every law of an open desk, as one list of what is broken: empty when none is. */
export const broken = (s: Desk): readonly string[] => {
	if (s.at === "over") return [];
	const out: string[] = [];
	if (!s.workspaces.some((ws) => ws.id === s.active))
		out.push(`active ${s.active} is no workspace`);
	const seen = new Set<string>();
	for (const ws of s.workspaces) {
		for (const v of checkTree(ws.layout)) out.push(`${ws.id}: ${JSON.stringify(v)}`);
		if (findTile(ws.layout, ws.focused) === null)
			out.push(`${ws.id}: focus ${ws.focused} is no tile`);
		if (ws.layout.zoomed !== null && ws.layout.zoomed !== ws.focused)
			out.push(`${ws.id}: ${ws.layout.zoomed} is zoomed, ${ws.focused} has focus`);
		for (const t of tilesOf(ws)) {
			if (seen.has(t.id)) out.push(`${t.id} is in two places`);
			seen.add(t.id);
			if (t.shows.kind === "run" && findTile(ws.layout, t.shows.of) === null)
				out.push(`${t.id} is a run of ${t.shows.of}, which is gone`);
		}
	}
	if (s.ask !== null && findTile(activeOf(s).layout, s.ask) === null)
		out.push(`asks in ${s.ask}, not a tile of the active workspace`);
	for (const t of Object.keys(s.running))
		if (whereIs(s, t) === undefined) out.push(`counts jobs of ${t}, which is gone`);
	return out;
};

describe("the desk's laws", () => {
	it("keeps every layout whole, focus on a tile that exists, and the zoom on the focused tile", () => {
		propertyInvariant(
			deskMachine,
			stubCtxThrowingProxy(),
			lists,
			(step) => {
				// A law that breaks says which, as tea's pbt gives no reason of its own (demlik#746).
				const why = broken(step.next);
				if (why.length > 0) throw new Error(`after ${JSON.stringify(step.msg)}: ${why.join("; ")}`);
				return true;
			},
			{numRuns: 400},
		);
	});

	it("asks to open a tile's tsh for every tile it makes, and to close it for every tile that goes", () => {
		propertyInvariant(
			deskMachine,
			stubCtxThrowingProxy(),
			lists,
			(step) => {
				const before = tshTiles(step.prev);
				const after = tshTiles(step.next);
				const opens = step.cmds.flatMap((c) => (c.type === "open" ? [c.tile] : []));
				const closes = step.cmds.flatMap((c) => (c.type === "close" ? [c.tile] : []));
				const made = [...after].filter((t) => !before.has(t));
				const gone = [...before].filter((t) => !after.has(t));
				return same(opens, made) && same(closes, gone);
			},
			{numRuns: 400},
		);
	});
});

const tshTiles = (s: Desk): ReadonlySet<string> =>
	new Set(
		s.at === "over"
			? []
			: s.workspaces.flatMap((ws) =>
					tilesOf(ws)
						.filter((t) => t.shows.kind === "tsh")
						.map((t) => t.id),
				),
	);

const same = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((x) => b.includes(x));
