import {replay} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {KEPT, type PaneMsg, paneMachine} from "./pane.ts";

// The pane, folded from what it heard, with no host and no window.

const fold = (msgs: readonly PaneMsg[]) => replay(paneMachine, {msgs, ctx: {run: "tsh:p1"}}).state;

describe("the pane", () => {
	it("shows a line, what tsh printed for it, and how it ended", () => {
		expect(
			fold([
				{type: "typed", text: "seq --to 2"},
				{type: "printed", to: "out", text: "seq 1"},
				{type: "printed", to: "out", text: "seq 2"},
				{type: "ready", status: 0},
			]),
		).toEqual({
			tsh: {
				run: "tsh:p1",
				lines: [
					{kind: "typed", text: "seq --to 2"},
					{kind: "printed", to: "out", text: "seq 1"},
					{kind: "printed", to: "out", text: "seq 2"},
				],
				state: {kind: "ready", status: 0},
			},
			front: [],
		});
	});

	it("stays busy until every line sent is done", () => {
		const two = fold([
			{type: "typed", text: "sleep --ms 10"},
			{type: "typed", text: "say --text hi"},
			{type: "ready", status: 0},
		]);
		expect(two.tsh.state).toEqual({kind: "busy", waiting: 1});
	});

	it("shows nothing typed after tsh is gone", () => {
		const gone = fold([
			{type: "ended", how: "ended"},
			{type: "typed", text: "say --text late"},
			{type: "ready", status: 0},
		]);
		expect(gone.tsh.lines).toEqual([]);
		expect(gone.tsh.state).toEqual({kind: "ended", how: "ended"});
	});

	it("keeps the newest lines past its scrollback", () => {
		const many = fold(
			Array.from(
				{length: KEPT + 5},
				(_, i): PaneMsg => ({type: "printed", to: "out", text: `${i}`}),
			),
		);
		expect(many.tsh.lines).toHaveLength(KEPT);
		expect(many.tsh.lines[0]).toEqual({kind: "printed", to: "out", text: "5"});
	});

	it("puts a program's window over tsh, keeps it in place as it changes, and takes it off when it ends", () => {
		const over = fold([
			{type: "typed", text: "counter &"},
			{type: "drew", program: "counter", run: "c:1", data: {n: 0}},
			{type: "drew", program: "counter", run: "c:2", data: {n: 0}},
			{type: "drew", program: "counter", run: "c:1", data: {n: 1}},
		]);
		expect(over.front).toEqual([
			{program: "counter", run: "c:1", data: {n: 1}},
			{program: "counter", run: "c:2", data: {n: 0}},
		]);
		const back = fold([
			{type: "drew", program: "counter", run: "c:1", data: {n: 0}},
			{type: "left", run: "c:1"},
		]);
		expect(back.front).toEqual([]);
	});
});
