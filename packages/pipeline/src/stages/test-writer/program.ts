import type {Sub} from "@demlik/tea";
import {defineProgram, input, kind, output, type RefsOf} from "@kampus/fabrika-old";
import type {DraftRun} from "@kampus/fabrika-old/agents/claude";
import {Context, Effect, Schema, Stream} from "effect";
import type {Result} from "../../controls.ts";
import {nameOf} from "../outcome.ts";
import {
	type Answers,
	AnswersAsk,
	AnswersReport,
	type AnswersMsg,
	answers,
	type commitAnswers,
	type readAnswersTaken,
} from "./answers.ts";
import type {Checked, TestsWritten} from "./checked.ts";
import {
	type commitTests,
	type onBase,
	type readChecked,
	type readTaken,
	type recordFacts,
	TestsAsk,
	type TestWriter,
	type TestWriterMsg,
	TestWriterReport,
	testWriter,
} from "./machine.ts";
import {Answered, type kills, MutantsOutcome} from "./mutants.ts";
import {TestWriterOutcome} from "./outcome.ts";
import type {File, Written} from "./written.ts";

// The test writer's two jobs as programs of their own, on the machines beside this file: each takes
// one ask, runs its machine to its end and says how it ended. Whoever starts one provides `TestsWork`
// and `TestsAgents`: the lane's (../pipeline/hosts.ts) or a test's.
//
//   test-writer   tests for a plan's properties, seen red or green on the base
//   mutants       the writer's answer to each mutant that lived, each new test seen to kill it

type Failed = {readonly _tag: "unknown"};

/** What the two jobs' Cmds do. The machines say what; this says how. */
export class TestsWork extends Context.Service<
	TestsWork,
	{
		/** The files at `base` the patterns cover. They exist, so they are never written. */
		readonly taken: (
			base: string,
			includes: readonly string[],
		) => Effect.Effect<readonly string[], Failed>;
		/** The new files as a local commit on `base`. Sent again, it finds its own commit. */
		readonly commit: (
			ticket: string,
			base: string,
			files: readonly File[],
		) => Effect.Effect<string, Failed>;
		/** Each test, run on the commit, in a box with no login. */
		readonly onBase: (
			commit: string,
			tests: readonly {readonly property: string; readonly file: string; readonly name: string}[],
		) => Effect.Effect<
			readonly {readonly property: string; readonly result: Result}[],
			{readonly _tag: "could_not_run"}
		>;
		readonly record: (
			ticket: string,
			written: TestsWritten,
			checked: readonly Checked[],
		) => Effect.Effect<null, Failed>;
		readonly checked: (
			ticket: string,
			version: number,
			head: string,
		) => Effect.Effect<readonly Checked[], Failed>;
		/** One test at `on.commit`, with the mutant in, or without it when `on.mutant` is `null`. */
		readonly kill: (on: {
			readonly commit: string;
			readonly mutant: string | null;
			readonly file: string;
			readonly test: string;
		}) => Effect.Effect<Result, {readonly _tag: "could_not_run"}>;
	}
>()("TestsWork") {}

/** The writer: one try's run, as a stream of the Draft's Msgs. */
export class TestsAgents extends Context.Service<
	TestsAgents,
	{
		readonly write: (sub: Sub<"tests_write", DraftRun>) => Stream.Stream<TestWriterMsg>;
		readonly answer: (sub: Sub<"mutants_answer", DraftRun>) => Stream.Stream<AnswersMsg>;
	}
>()("TestsAgents") {}

// The two states are plain unions with no schema, as the machine's own file left them: read back
// as they were written. Both are all data, so a kept one reads the same.
const keptAs = <S>(): Schema.Codec<S, unknown> => Schema.Any;

const testsInterpret = {
	tests_taken: (cmd: ReturnType<typeof readTaken>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).taken(cmd.base, cmd.includes);
		}),
	tests_commit: (cmd: ReturnType<typeof commitTests>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).commit(cmd.ticket, cmd.base, cmd.files);
		}),
	tests_on_base: (cmd: ReturnType<typeof onBase>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).onBase(cmd.commit, cmd.tests);
		}),
	tests_record: (cmd: ReturnType<typeof recordFacts>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).record(cmd.ticket, cmd.written, cmd.checked);
		}),
	tests_checked: (cmd: ReturnType<typeof readChecked>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).checked(cmd.ticket, cmd.version, cmd.head);
		}),
};

const testsKindBase = {
	machine: testWriter,
	state: keptAs<TestWriter>(),
	options: () => ({
		ctx: undefined,
		interpret: testsInterpret,
		subscribe: {
			tests_write: (sub: Sub<"tests_write", DraftRun>) =>
				Stream.unwrap(
					Effect.gen(function* () {
						return (yield* TestsAgents).write(sub);
					}),
				),
		},
		terminal: (s: TestWriter) => s.phase === "over",
	}),
	recovered: (s: TestWriter) => (s.phase === "idle" ? null : ({type: "resume"} as const)),
	drawing: () => ({
		name: "test writer",
		service: "test-writer",
		steps: {
			tests_taken: "read taken files",
			tests_write: "writer",
			tests_commit: "commit tests",
			tests_on_base: "run on base",
			tests_record: "record",
			tests_checked: "read back",
		},
	}),
	status: (s: TestWriter) => (s.phase === "over" ? nameOf(s.outcome) : s.phase),
};

export const testsKind = kind({...testsKindBase, parent: "main"});
export const testsChild = kind({...testsKindBase, parent: "lane"});

const answersInterpret = {
	answers_taken: (cmd: ReturnType<typeof readAnswersTaken>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).taken(cmd.head, cmd.includes);
		}),
	answers_commit: (cmd: ReturnType<typeof commitAnswers>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).commit(cmd.ticket, cmd.base, cmd.files);
		}),
	mutant_kill_control: (cmd: ReturnType<typeof kills.run>) =>
		Effect.gen(function* () {
			return yield* (yield* TestsWork).kill(cmd.on);
		}),
};

const answersKindBase = {
	machine: answers,
	state: keptAs<Answers>(),
	options: () => ({
		ctx: undefined,
		interpret: answersInterpret,
		subscribe: {
			mutants_answer: (sub: Sub<"mutants_answer", DraftRun>) =>
				Stream.unwrap(
					Effect.gen(function* () {
						return (yield* TestsAgents).answer(sub);
					}),
				),
		},
		terminal: (s: Answers) => s.phase === "over",
	}),
	recovered: (s: Answers) => (s.phase === "idle" ? null : ({type: "resume"} as const)),
	drawing: () => ({
		name: "mutants",
		service: "test-writer",
		steps: {
			answers_taken: "read taken files",
			mutants_answer: "writer",
			answers_commit: "commit tests",
			mutant_kill_control: "kill check",
		},
	}),
	status: (s: Answers) => (s.phase === "over" ? nameOf(s.outcome) : s.phase),
};

export const answersKind = kind({...answersKindBase, parent: "main"});
export const answersChild = kind({...answersKindBase, parent: "lane"});

/** One test writer run to its end, under `id`. Found mid-way, it goes on. */
export const testsToTheEnd = (
	refs: RefsOf<typeof testsChild> | RefsOf<typeof testsKind>,
	id: string,
	ask: TestsAsk,
) =>
	Effect.gen(function* () {
		const runtime = yield* refs
			.get(id)
			.start({type: "start", ask, key: id}, {conflict: "use_existing"});
		const end: TestWriter = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the test writer stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

/** One mutants job run to its end, under `id`. Found mid-way, it goes on. */
export const answersToTheEnd = (
	refs: RefsOf<typeof answersChild> | RefsOf<typeof answersKind>,
	id: string,
	ask: AnswersAsk,
) =>
	Effect.gen(function* () {
		const runtime = yield* refs
			.get(id)
			.start({type: "start", ask, key: id}, {conflict: "use_existing"});
		const end: Answers = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the mutants job stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

export const testWriterProgram = defineProgram({
	name: "test-writer",
	description:
		"Writes the tests for a plan's properties before anything is built, and sees each one red or green on the base.",
	flags: {},
	inputs: {ask: input(TestsAsk, "The plan's properties and the commit they are tested on.")},
	outputs: {
		ended: output(
			Schema.Struct({outcome: TestWriterOutcome, name: Schema.String, report: TestWriterReport}),
			"Once per ask: how it ended, and what it wrote.",
		),
	},
	machines: {tests: testsKind},
	main: ({serve, send, machines}) =>
		serve({
			ask: (ask) =>
				Effect.gen(function* () {
					const id = `tests/${ask.ticket}/${ask.plan.version}`;
					const end = yield* testsToTheEnd(machines.tests, id, ask);
					yield* send("ended", {
						outcome: end.outcome,
						name: nameOf(end.outcome),
						report: end.report,
					});
					yield* machines.tests.get(id).clear;
				}),
		}),
});

export const mutantsProgram = defineProgram({
	name: "mutants",
	description:
		"Answers each mutant that lived: a new test that kills it, or why no test can. Each new test is run with the mutant in and without.",
	flags: {},
	inputs: {ask: input(AnswersAsk, "The mutants that lived, and the head they lived on.")},
	outputs: {
		ended: output(
			Schema.Struct({
				outcome: MutantsOutcome,
				name: Schema.String,
				report: AnswersReport,
				answered: Schema.NullOr(Answered),
			}),
			"Once per ask: how it ended, and the answers.",
		),
	},
	machines: {answers: answersKind},
	main: ({serve, send, machines}) =>
		serve({
			ask: (ask) =>
				Effect.gen(function* () {
					const id = `mutants/${ask.ticket}/${ask.head}`;
					const end = yield* answersToTheEnd(machines.answers, id, ask);
					yield* send("ended", {
						outcome: end.outcome,
						name: nameOf(end.outcome),
						report: end.report,
						answered: end.report.answered,
					});
					yield* machines.answers.get(id).clear;
				}),
		}),
});

export type {Written};
