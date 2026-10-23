import {describe, expect, it} from "vitest";
import type {SortCmd, SortState} from "../stages/sort/machine.ts";
import {explore, pathText, type Update} from "./explore.ts";
import * as sort from "./sort.ts";

// Each sort law shown to catch a planted mistake, by its shortest breaking sequence.
// standard.test.ts checks each one holds on the real machine.

type Step = Update<SortState, sort.AnySortMsg, SortCmd>;

const caught = (update: Step, depth: number): Record<string, string> =>
	Object.fromEntries(
		explore({
			init: sort.sortInit,
			update,
			world: sort.sortWorld(),
			laws: sort.sortLaws(),
			depth,
		}).broken.map((b) => [b.law, pathText(b.path, sort.showSortMsg)]),
	);

const lines = (...steps: string[]) => steps.map((line, i) => `${i + 1}. ${line}`).join("\n");
const read = ["start", "ticket read: open", "sort_context_ok"];

describe("sort", () => {
	it("catches each planted mistake in a few messages", () => {
		expect(caught(sort.writesBeforeTheDoor, 6)).toMatchObject({
			"nothing is written before the ticket is read again, open and unchanged": lines(
				...read,
				'run k/1: "duplicate"',
			),
		});
		expect(caught(sort.takesAnyRun, 6)).toMatchObject({
			"a sorter Msg counts only for the run asked for": lines(
				...read,
				'run k/1: "duplicate of itself"',
				'run k/1: "duplicate"',
			),
		});
		expect(caught(sort.leavesANoOpen, 8)).toMatchObject({
			"an answer ends only once every write it makes went out": lines(
				...read,
				'run k/1: "no"',
				"ticket read: open",
				"comment written",
				"label written",
			),
		});
	});
});
