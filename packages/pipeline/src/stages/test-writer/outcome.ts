import {Schema} from "effect";
import {type Name, outcomesOf} from "../outcome.ts";

// What the test writer hands back, in the shape every stage uses
// (`../outcome.ts`). Which Property each surprise is about is in the report.

/** The surprises, in the order the outcome names the first: a bug today, then a test too weak, then no test. */
export const SURPRISES = ["fails_on_base", "already_passes", "cannot_test"] as const;
export const Surprise = Schema.Literals(SURPRISES);
export type Surprise = typeof Surprise.Type;

const testWriter = outcomesOf({
	/** Every test fails or passes on the base as the plan says. `commit`: the tests, a local commit on the base. */
	done: {commit: Schema.String},
	/** This stage passes no work on: a parent starts build. */
	send: {},
	/**
	 * The owner picks, in a box on the ticket's timeline.
	 * `fails_on_base`: an existing Property's test fails today.
	 * `already_passes`: a new Property's test passes today.
	 * `cannot_test`: no test can check a Property.
	 */
	ask: {owner: SURPRISES},
	/** `no_properties`: the plan has no Property to test. */
	skip: ["no_properties"],
	/**
	 * Stop, never guess. `read_failed`: the files at the base could not be read.
	 * `draft_failed`: the writer broke, or answered with something that is not
	 * tests. `unchecked`: its last draft still has problems and the tries are
	 * spent. `cut_off`: a restart cut the writer off twice. `commit_failed`:
	 * the tests could not be committed on the base. `run_failed`: the tests
	 * could not be run there. `no_result`: the run said nothing for a test.
	 * `record_failed`: the facts could not be written, or the read after did not show them.
	 */
	stuck: [
		"read_failed",
		"draft_failed",
		"unchecked",
		"cut_off",
		"commit_failed",
		"run_failed",
		"no_result",
		"record_failed",
	],
});

export const TestWriterOutcome = testWriter.schema;
export type TestWriterOutcome = typeof TestWriterOutcome.Type;
export type TestWriterName = Name<TestWriterOutcome>;
export const TEST_WRITER_NAMES = testWriter.names;
export const isTestWriterName = testWriter.isName;
