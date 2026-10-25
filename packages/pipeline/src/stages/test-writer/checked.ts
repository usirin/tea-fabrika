import {Schema} from "effect";
import {mustFail, mustPass, Result} from "../../controls.ts";
import {type Property, PropertyId} from "./brief.ts";
import {Surprise} from "./outcome.ts";
import type {Answer, TestAnswer} from "./written.ts";

// The run on the base, read with Controls (../../controls.ts). The writer
// knows one side per Property, the base:
//
//   new        mustFail(onBase)   green there is `already_passes`
//   existing   mustPass(onBase)   red there is `fails_on_base`
//
// and the facts the ledger keeps from it: one `checked` per Property tested,
// and one `tests_written` with the commit (docs/direction/the-test-writer.md).

/** What the run on the base said, one result per test it ran. */
export const Results = Schema.Array(Schema.Struct({property: PropertyId, result: Result}));
export type Results = typeof Results.Type;

/** One tool run on one Property, at one plan version and one commit. */
export const Checked = Schema.Struct({
	fact: Schema.Literal("checked"),
	property: PropertyId,
	version: Schema.Finite,
	head: Schema.String,
	tool: Schema.Literal("test"),
	result: Result,
});
export type Checked = typeof Checked.Type;

/** The tests, as a local commit on the base. Never pushed. */
export const TestsWritten = Schema.Struct({
	fact: Schema.Literal("tests_written"),
	ticket: Schema.String,
	commit: Schema.String,
});
export type TestsWritten = typeof TestsWritten.Type;

/** One Property the owner is asked about, and what about. */
export const Found = Schema.Struct({property: PropertyId, for: Surprise});
export type Found = typeof Found.Type;

/** The surprises the writer's own answers hold: each Property it says no test can check. */
export const cannotOf = (answers: readonly Answer[]): readonly Found[] =>
	answers.flatMap((a) => (a.kind === "cannot" ? [{property: a.property, for: "cannot_test"}] : []));

export const testsOf = (answers: readonly Answer[]): readonly TestAnswer[] =>
	answers.flatMap((a) => (a.kind === "test" ? [a] : []));

/** What the run means, or the tests it said nothing for. */
export type Read =
	| {readonly read: true; readonly checked: readonly Checked[]; readonly found: readonly Found[]}
	| {readonly read: false; readonly missing: readonly [PropertyId, ...PropertyId[]]};

/** A Property's control on the base: the one side its `behavior` says. */
const controlOf = (property: Property, result: Result) =>
	property.behavior === "new" ? mustFail(result) : mustPass(result);

const surpriseOf = {missed: "already_passes", false_alarm: "fails_on_base"} as const;

/** Read the run on the base: one `checked` fact per test, and a surprise for each failed control. */
export function readRun(
	properties: readonly Property[],
	tests: readonly TestAnswer[],
	results: Results,
	at: {readonly version: number; readonly head: string},
): Read {
	const byId = new Map(properties.map((p) => [p.id, p]));
	const missing: PropertyId[] = [];
	const checked: Checked[] = [];
	const found: Found[] = [];
	for (const test of tests) {
		const property = byId.get(test.property);
		// The last result for a test holds, as a rerun would.
		const result = results.findLast((r) => r.property === test.property)?.result;
		if (property === undefined || result === undefined) {
			missing.push(test.property);
			continue;
		}
		checked.push({fact: "checked", property: property.id, ...at, tool: "test", result});
		const control = controlOf(property, result);
		if (control.kind !== "ok") found.push({property: property.id, for: surpriseOf[control.kind]});
	}
	const [first, ...rest] = missing;
	return first === undefined
		? {read: true, checked, found}
		: {read: false, missing: [first, ...rest]};
}

/** The surprise the outcome names: the first in `SURPRISES`' order. `null`: none. */
export const firstOf = (found: readonly Found[]): Surprise | null =>
	Surprise.literals.find((s) => found.some((f) => f.for === s)) ?? null;

/** Whether a read of the ledger shows every fact that was written. */
export const shows = (read: readonly Checked[], wrote: readonly Checked[]): boolean =>
	wrote.every((w) =>
		read.some(
			(r) =>
				r.property === w.property &&
				r.version === w.version &&
				r.head === w.head &&
				r.result === w.result,
		),
	);
