import {describe, expect, it} from "vitest";
import {type CompiledLane, compileLane, parseLog, walk} from "../../lane-log.ts";
import {issueWorkflow, log} from "../../lane-scripted.ts";
import {isShipName} from "./outcome.ts";
import {endingOf, type Mapped, outcomeOf, type RecordedEnding} from "./recorded.ts";

// Recorded shipper endings, set beside the ship machine's outcomes. The logs
// here are written by hand in fabrika's shape; no real lane's data is in here.

/** Fold a log, and give back how each stay in `ship` ended. */
function endings(...lines: readonly string[]): RecordedEnding[] {
	const walked = walk(
		compileLane(issueWorkflow()) as CompiledLane,
		parseLog(log(...lines)).entries,
	);
	return Object.values(walked.steps)
		.flat()
		.flatMap((step) => endingOf(step) ?? []);
}
const toShip = ["WIP", "DONE", "PASS"] as const;

describe("reading a shipper's ending off the log", () => {
	it("reads each of the seven endings", () => {
		expect(endings(...toShip, "DONE")).toEqual([{ending: "merged"}]);
		expect(endings(...toShip, 'DONE {"partial":true}')).toEqual([{ending: "merged_issue_open"}]);
		expect(endings(...toShip, "WIP")).toEqual([{ending: "queued"}]);
		expect(endings(...toShip, 'BLOCKED {"cause":"head-behind-base"}')).toEqual([
			{ending: "parked", cause: "head-behind-base"},
		]);
		expect(endings(...toShip, "FAIL")).toEqual([{ending: "sent_back"}]);
		expect(endings(...toShip, 'LAP {"cause":"base-conflicted"}')).toEqual([
			{ending: "lap", cause: "base-conflicted"},
		]);
		expect(endings(...toShip, "LANDED")).toEqual([{ending: "board_ended", how: "landed"}]);
	});

	it("keeps a park with no cause as a park with no cause", () => {
		expect(endings(...toShip, "BLOCKED")).toEqual([{ending: "parked", cause: null}]);
	});

	it("counts one ending for each stay in ship, and none for what the queue did after", () => {
		// Parked in ship, unparked back into it, queued, merged from the queue: two stays, two endings.
		expect(
			endings(...toShip, 'BLOCKED {"cause":"head-ci-red"}', "UNBLOCKED", "WIP", "DONE"),
		).toEqual([{ending: "parked", cause: "head-ci-red"}, {ending: "queued"}]);
	});

	it("does not count a lap that leaves the task in ship", () => {
		expect(endings(...toShip, 'LAP {"cause":"queue-ejected"}', "DONE")).toEqual([
			{ending: "merged"},
		]);
	});

	it("reads nothing off a lane that never reached ship", () => {
		expect(endings("WIP", "DONE", "FAIL", "DONE")).toEqual([]);
	});
});

describe("the outcome a recorded ending stands for", () => {
	it.each<[RecordedEnding, Mapped]>([
		[{ending: "merged"}, {mapped: true, name: "done"}],
		[{ending: "merged_issue_open"}, {mapped: true, name: "done:part"}],
		// It went back to the builder, and the line does not say why: no name is made up for it.
		[{ending: "sent_back"}, {mapped: true, name: null, to: "builder"}],
		[
			{ending: "lap", cause: "base-conflicted"},
			{mapped: true, name: "send:builder:conflicts"},
		],
		[
			{ending: "parked", cause: "awaiting-cp-approval"},
			{mapped: true, name: "ask:owner:approval"},
		],
		[
			{ending: "parked", cause: "head-ci-red"},
			{mapped: true, name: "send:builder:checks_red"},
		],
	])("%j fits one outcome", (ending, mapped) => {
		expect(outcomeOf(ending)).toEqual(mapped);
	});

	it.each<[RecordedEnding, Mapped]>([
		[{ending: "queued"}, {mapped: false, reason: "not_an_ending"}],
		[
			{ending: "parked", cause: "head-behind-base"},
			{mapped: false, reason: "no_outcome_fits"},
		],
		[
			{ending: "parked", cause: null},
			{mapped: false, reason: "line_does_not_say"},
		],
		[
			{ending: "parked", cause: "a-new-word"},
			{mapped: false, reason: "unknown_cause"},
		],
		[
			{ending: "lap", cause: null},
			{mapped: false, reason: "line_does_not_say"},
		],
		[
			{ending: "lap", cause: "queue-ejected"},
			{mapped: false, reason: "unknown_cause"},
		],
		[
			{ending: "board_ended", how: "landed"},
			{mapped: false, reason: "fits_two", names: ["done", "done:part"]},
		],
		[
			{ending: "board_ended", how: "cancelled"},
			{mapped: false, reason: "no_outcome_fits"},
		],
		[
			{ending: "other", event: "PASS"},
			{mapped: false, reason: "no_outcome_fits"},
		],
	])("%j is left unmapped", (ending, mapped) => {
		expect(outcomeOf(ending)).toEqual(mapped);
	});

	it("a cause that is a property of every object is still an unknown cause", () => {
		expect(outcomeOf({ending: "parked", cause: "constructor"})).toEqual({
			mapped: false,
			reason: "unknown_cause",
		});
		expect(outcomeOf({ending: "lap", cause: "toString"})).toEqual({
			mapped: false,
			reason: "unknown_cause",
		});
	});

	it("maps only onto names a ship outcome can print", () => {
		const all: RecordedEnding[] = [
			{ending: "merged"},
			{ending: "merged_issue_open"},
			{ending: "queued"},
			{ending: "sent_back"},
			{ending: "lap", cause: "base-conflicted"},
			{ending: "parked", cause: "awaiting-cp-approval"},
			{ending: "parked", cause: "head-ci-red"},
			{ending: "parked", cause: "head-behind-base"},
			{ending: "parked", cause: null},
			{ending: "board_ended", how: "landed"},
			{ending: "board_ended", how: "cancelled"},
		];
		const reached = new Set<string>();
		for (const ending of all) {
			const mapped = outcomeOf(ending);
			if (mapped.mapped && mapped.name !== null) {
				expect(isShipName(mapped.name)).toBe(true);
				reached.add(mapped.name);
			} else if (!mapped.mapped && mapped.reason === "fits_two")
				expect(mapped.names.every(isShipName)).toBe(true);
		}
		// No logged ending is a `skip`, a `stuck` or `send:reviewer:no_review`: today's shipper has no word for them.
		expect([...reached].sort()).toEqual([
			"ask:owner:approval",
			"done",
			"done:part",
			"send:builder:checks_red",
			"send:builder:conflicts",
		]);
	});
});
