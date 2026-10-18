import type {ShipName} from "../../../../wip/src/stages/ship/outcome";
import type {Step} from "../../lane-log";

// How today's shipper runs ended, as their lane logs show it, set beside the
// ship machine's outcomes. A shipper's run ends with the event that takes the
// task out of `ship`. Experiment 53 counted seven such endings over 961 runs.
// This is the table from those seven onto the names of ship's outcomes
// (`send:builder:checks_red`). Where an ending fits no outcome, or fits two,
// it says so and maps nothing.

/** One shipper's run, by the line that ended it. */
export type RecordedEnding =
	/** `DONE`, to `shipped`: merged inside the shipper's own run. */
	| {readonly ending: "merged"}
	/** `DONE`, back to `queued`: merged, and the issue stayed open. */
	| {readonly ending: "merged_issue_open"}
	/** `WIP`: the pull request is in the merge queue, and the shipper's run ended there. */
	| {readonly ending: "queued"}
	/** `BLOCKED`: the lane parked. Older lines name no cause. */
	| {readonly ending: "parked"; readonly cause: string | null}
	/** `FAIL`: sent back for repair. The line does not say which gate refused. */
	| {readonly ending: "sent_back"}
	/** `LAP`: a round the pipeline spent on itself. */
	| {readonly ending: "lap"; readonly cause: string | null}
	/** `LANDED` or `CANCELLED`, written from outside while the task stood in `ship`. */
	| {readonly ending: "board_ended"; readonly how: "landed" | "cancelled"}
	/** Any other event out of `ship`: an eighth ending. The recorded runs have none. */
	| {readonly ending: "other"; readonly event: string};

/**
 * No logged ending maps to a `skip`, a `stuck` or `send:reviewer:no_review`:
 * today's shipper has no ending word for them.
 */
export type Mapped =
	/** The ending is this one outcome. */
	| {readonly mapped: true; readonly name: ShipName}
	/** The line says the work went back to the builder, and not why. Nothing is guessed, so it has no name. */
	| {readonly mapped: true; readonly name: null; readonly to: "builder"}
	| {
			readonly mapped: false;
			readonly reason: "not_an_ending" | "no_outcome_fits" | "line_does_not_say" | "unknown_cause";
	  }
	| {
			readonly mapped: false;
			readonly reason: "fits_two";
			readonly names: readonly [ShipName, ShipName];
	  };

/** The step that ended a stay in `ship`, as an ending. `null`: the step is not one. */
export function endingOf(step: Step): RecordedEnding | null {
	if (step.from !== "ship" || step.to === "ship") return null;
	const {event, cause} = step.entry;
	switch (event) {
		case "DONE":
			return {ending: step.to === "shipped" ? "merged" : "merged_issue_open"};
		case "WIP":
			return {ending: "queued"};
		case "BLOCKED":
			return {ending: "parked", cause};
		case "FAIL":
			return {ending: "sent_back"};
		case "LAP":
			return {ending: "lap", cause};
		case "LANDED":
			return {ending: "board_ended", how: "landed"};
		case "CANCELLED":
			return {ending: "board_ended", how: "cancelled"};
		default:
			return {ending: "other", event};
	}
}

/** A park's cause names a fact. Where the gate has a line for that fact, the outcome is that line's. */
const PARKED: Readonly<Record<string, Mapped>> = {
	"awaiting-cp-approval": {mapped: true, name: "ask:owner:approval"},
	"head-ci-red": {mapped: true, name: "send:builder:checks_red"},
	// A branch behind main that still merges cleanly. The gate has no line for it: an open point in the design.
	"head-behind-base": {mapped: false, reason: "no_outcome_fits"},
};

const LAPPED: Readonly<Record<string, Mapped>> = {
	"base-conflicted": {mapped: true, name: "send:builder:conflicts"},
};

/** A cause's row. A line with no cause, or a cause with no row, maps nothing. */
function byCause(table: Readonly<Record<string, Mapped>>, cause: string | null): Mapped {
	if (cause === null) return {mapped: false, reason: "line_does_not_say"};
	return Object.hasOwn(table, cause)
		? (table[cause] as Mapped)
		: {mapped: false, reason: "unknown_cause"};
}

/** The outcome a recorded ending stands for, by name, or why it stands for none. */
export function outcomeOf(e: RecordedEnding): Mapped {
	switch (e.ending) {
		case "merged":
			return {mapped: true, name: "done"};
		case "merged_issue_open":
			return {mapped: true, name: "done:part"};
		case "queued":
			// The ship machine is not over here: it waits on the queue. Today's shipper ends its run instead.
			return {mapped: false, reason: "not_an_ending"};
		case "parked":
			return byCause(PARKED, e.cause);
		case "sent_back":
			return {mapped: true, name: null, to: "builder"};
		case "lap":
			return byCause(LAPPED, e.cause);
		case "board_ended":
			// Merged by hand under the shipper. A fresh read would answer one of the two landings; the line does not say which.
			if (e.how === "landed")
				return {mapped: false, reason: "fits_two", names: ["done", "done:part"]};
			// `CANCELLED` says the issue was closed. It says nothing of the pull request, so it is not `skip:closed`.
			return {mapped: false, reason: "no_outcome_fits"};
		case "other":
			return {mapped: false, reason: "no_outcome_fits"};
	}
}
