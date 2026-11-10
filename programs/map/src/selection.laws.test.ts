import {arbConstantMsg, arbRecordMsg, propertyTrace, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import type {TrackerMsg} from "@tea-fabrika/tracker";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {map} from "./index.ts";

// Today's map reuses the tracker reducer. Check its selection from the real init.
// This law needs no pipe input and passes before the product build.
const tickets = map.machines.tickets.machine;
type Machine = typeof tickets;

const msgs: fc.Arbitrary<TrackerMsg> = fc.oneof(
	arbRecordMsg("open", {ticket: fc.integer({min: 1, max: 1000})}),
	arbRecordMsg("tick", {now: fc.nat()}),
	arbConstantMsg("moved"),
);

const lists = fc.array(msgs, {maxLength: 40});
const OPTS = {numRuns: 300, seed: 117};
const ctx = stubCtxThrowingProxy<undefined>();

/** No ticket at first. Each selection replaces the last. Other messages keep it. */
const selection = (machine: Machine) =>
	propertyTrace(
		machine,
		ctx,
		lists,
		(steps, last) => {
			let selected: number | null = null;
			for (const {msg, next} of steps) {
				if (msg.type === "open") selected = msg.ticket;
				if (next.open !== selected) return false;
			}
			return last.open === selected;
		},
		OPTS,
	);

/** The real reducer with selection ignored. */
const ignoredSelection: Machine = {
	...tickets,
	update: {...tickets.update, open: (s) => [s, []]},
};

describe("the map's selection law", () => {
	it("keeps the latest selection from init, with none before the first", () => {
		selection(tickets);
	});

	it("catches a planted ignored selection", () => {
		expect(() => selection(ignoredSelection)).toThrow(/Counterexample/);
	});
});
