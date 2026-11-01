import {Schema} from "effect";
import type {Result} from "../../controls.ts";

// A vitest JSON report, read for the tests a writer named. Pure.
//
//   a test that ran and failed                red
//   a test that ran and passed                green
//   a file that did not load: a name it imports does not exist yet
//                                             red: code the test writer's `new` property waits for
//   a file that did not load for any other reason, or a test the report does not hold
//                                             no answer: something is wrong with the test or the run
//
// The second line is what the brief tells the writer too: a test that imports what the build will
// add cannot load before the build, and that is the red the plan asked for.

const Assertion = Schema.Struct({
	title: Schema.String,
	fullName: Schema.optionalKey(Schema.String),
	status: Schema.String,
});

export const Report = Schema.Struct({
	testResults: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			status: Schema.optionalKey(Schema.String),
			message: Schema.optionalKey(Schema.NullOr(Schema.String)),
			assertionResults: Schema.Array(Assertion),
		}),
	),
});
export type Report = typeof Report.Type;

const WAITS_ON_CODE =
	/Cannot find module|Failed to (resolve|load)|does not provide an export|is not exported|ERR_MODULE_NOT_FOUND/;

interface Named {
	readonly property: string;
	readonly file: string;
	readonly name: string;
}

export const resultsOf = (
	report: Report,
	tests: readonly Named[],
): readonly {readonly property: string; readonly result: Result}[] =>
	tests.flatMap((test): readonly {readonly property: string; readonly result: Result}[] => {
		const file = report.testResults.find((r) => r.name.endsWith(test.file));
		if (file === undefined) return [];
		const found = file.assertionResults.find(
			(a) =>
				a.title === test.name || a.fullName === test.name || a.fullName?.endsWith(` ${test.name}`),
		);
		if (found !== undefined) {
			if (found.status === "passed") return [{property: test.property, result: "green"}];
			if (found.status === "failed") return [{property: test.property, result: "red"}];
			return [];
		}
		return file.assertionResults.length === 0 && WAITS_ON_CODE.test(file.message ?? "")
			? [{property: test.property, result: "red"}]
			: [];
	});
