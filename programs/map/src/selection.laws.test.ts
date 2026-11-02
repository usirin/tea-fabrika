import {
	arbMsgSequence,
	arbRecordMsg,
	propertyTrace,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {map} from "./index.ts";

// Today's map reuses the tracker reducer. Check its selections from the real init.
const tickets = map.machines.tickets.machine;
type Machine = typeof tickets;
const lists = arbMsgSequence(
	arbRecordMsg("open", {ticket: fc.integer({min: 1, max: 10_000})}),
	{maxLength: 40},
);
const ctx = stubCtxThrowingProxy<undefined>();
const OPTS = {numRuns: 300, seed: 1};

const selection = (machine: Machine) =>
	propertyTrace(
		machine,
		ctx,
		lists,
		(steps, last) => {
			if (map.view.of(steps[0]?.prev ?? last).number !== null) return false;
			let selected: number | null = null;
			for (const {msg, next, cmds} of steps) {
				if (msg.type !== "open") return false;
				selected = msg.ticket;
				if (
					next.open !== selected ||
					map.view.of(next).number !== selected ||
					cmds.length !== 0
				)
					return false;
			}
			return last.open === selected && map.view.of(last).number === selected;
		},
		OPTS,
	);

// The real machine with one planted mistake: it ignores each selection.
const ignoredSelection: Machine = {
	...tickets,
	update: {...tickets.update, open: (s) => [s, []]},
};

describe("the map's selection law", () => {
	it("starts with no ticket and shows each selection without asking for work", () => {
		selection(tickets);
	});

	it("catches an ignored selection", () => {
		expect(() => selection(ignoredSelection)).toThrow();
	});
});
