import {applyCell, msgKeysOf} from "@demlik/tea";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {activeOf, type Desk, type DeskMsg, deskMachine, type Open, tilesOf} from "./desk.ts";
import {checkTree, findTile, resolveSizes} from "./layout/index.ts";

type Request = {
	type: "open_program";
	program: "inbox";
	location: {row: string | null};
	from: string;
	via: {_tag: "key"; keys: string};
};
const request = (row: string | null = "m17", from = "t1"): Request => ({
	type: "open_program",
	program: "inbox",
	location: {row},
	from,
	via: {_tag: "key", keys: "shift+o"},
});
const open = (state: Desk): Open => {
	if (state.at !== "open") throw new Error("expected an open desk");
	return state;
};
// The plan adds this Msg. Check it before stepping, so red means missing opening, never NoCellError.
const supportsOpen = (law: string) =>
	expect(
		msgKeysOf(deskMachine),
		`${law}: the desk has no program-and-location open request`,
	).toContain("open_program");
const step = (state: Desk, msg: DeskMsg | Request): readonly [Desk, readonly {type: string}[]] =>
	Reflect.apply(applyCell, undefined, [deskMachine, state, msg]);
const fold = (
	messages: readonly (DeskMsg | Request)[],
	from: Desk = deskMachine.init(null, undefined)[0],
) => {
	let state = from;
	const cmds: {type: string}[] = [];
	for (const msg of messages) {
		const [next, out] = step(state, msg);
		state = next;
		cmds.push(...out);
	}
	return {state: open(state), cmds};
};
const keys = (key: string, at = 0): readonly DeskMsg[] => [
	{type: "key", key: "<c-b>", at},
	{type: "key", key, at: at + 1},
];
const inboxTiles = (state: Open) =>
	tilesOf(activeOf(state)).filter((t) => t.shows.run?.program === "inbox");

describe("today's inbox open and focus laws", () => {
	it("I12: repeated Open all reserves at most one inbox tile in each workspace before start acknowledgement", () => {
		supportsOpen("I12");
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom("m17", "m18"), {minLength: 2, maxLength: 12}),
				(rows) => {
					const {state, cmds} = fold(rows.map((row) => request(row)));
					expect(inboxTiles(state)).toHaveLength(1);
					expect(cmds.filter((c) => Reflect.get(c, "program") === "inbox")).toHaveLength(1);
					expect(checkTree(activeOf(state).layout)).toEqual([]);
				},
			),
			{numRuns: 30, seed: 119120},
		);
		const first = fold([request()]);
		const secondWorkspace = fold([...keys("N", 100), request("m18", "t3")], first.state).state;
		expect(
			secondWorkspace.workspaces.flatMap((ws) =>
				tilesOf(ws).filter((t) => t.shows.run?.program === "inbox"),
			),
		).toHaveLength(2);
	});

	it("I13: reuse unfolds inbox, ends the covering zoom and sends the selected row to that tile", () => {
		supportsOpen("I13");
		const first = fold([request()]);
		const target = inboxTiles(first.state)[0];
		expect(target).toBeDefined();
		if (target === undefined) throw new Error("Open all made no inbox tile");
		const hidden = fold([{type: "fold", tile: target.id}, ...keys("z", 10)], first.state).state;
		expect(findTile(activeOf(hidden).layout, target.id)?.folded).toBe(true);
		expect(activeOf(hidden).layout.zoomed).not.toBeNull();
		const reused = fold([request("m18")], hidden);
		expect(inboxTiles(reused.state)).toHaveLength(1);
		expect(activeOf(reused.state).focused).toBe(target.id);
		expect(findTile(activeOf(reused.state).layout, target.id)?.folded).toBe(false);
		expect(activeOf(reused.state).layout.zoomed).toBeNull();
		expect(reused.cmds).toContainEqual(expect.objectContaining({location: {row: "m18"}}));
	});

	it("I14: a new open keeps the origin's work and halves its share beside it", () => {
		supportsOpen("I14");
		const counter = {id: "counter:1", program: "counter"};
		const origin = fold([
			{type: "covered", tile: "t1", runs: [counter]},
			{type: "area", width: 1400, height: 900},
		]).state;
		const result = fold([request()], origin).state;
		const workspace = activeOf(result);
		expect(findTile(workspace.layout, "t1")?.shows.run).toEqual(counter);
		const made = inboxTiles(result)[0];
		expect(made).toBeDefined();
		if (made === undefined) throw new Error("new open made no inbox");
		expect(workspace.layout.root.orientation).toBe("horizontal");
		expect(resolveSizes(workspace.layout.root.children, workspace.layout.root.sizes)).toEqual({
			t1: 50,
			[made.id]: 50,
		});
		const tight = fold([{type: "area", width: 320, height: 700}, request()], origin).state;
		const tightInbox = inboxTiles(tight)[0];
		expect(tightInbox?.folded).toBe(false);
		expect(activeOf(tight).focused).toBe(tightInbox?.id);
		expect(findTile(activeOf(tight).layout, "t1")?.shows.run).toEqual(counter);
		expect(checkTree(activeOf(tight).layout)).toEqual([]);
	});

	it("I19: close and C-b ; return to the most recent surviving tile, skipping removed tiles", () => {
		const three = fold([
			...keys("|"),
			...keys("|", 10),
			{type: "go", tile: "t2"},
			{type: "go", tile: "t3"},
		]).state;
		expect(
			activeOf(fold(keys(";", 100), three).state).focused,
			"I19: C-b ; does not read focus history",
		).toBe("t2");
		const closed = fold([{type: "ended", tile: "t3"}], three).state;
		expect(activeOf(closed).focused).toBe("t2");
		const gone = fold([{type: "ended", tile: "t2"}], closed).state;
		expect(activeOf(fold(keys(";", 200), gone).state).focused).toBe("t1");
	});
});
