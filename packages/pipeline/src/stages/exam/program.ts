import type {Sub} from "@demlik/tea";
import {defineProgram, input, kind, output, type RefsOf} from "@kampus/fabrika-old";
import type {DraftRun} from "@kampus/fabrika-old/agents/claude";
import {Context, Effect, Schema, Stream} from "effect";
import {nameOf} from "../outcome.ts";
import {
	Exam,
	ExamAsk,
	type ExamMsg,
	ExamOutcome,
	ExamReport,
	exam,
	type Landed,
	type landExam,
} from "./machine.ts";

// The exam step as a program. Whoever starts it provides `ExamWork`.
//
//   told {changes: []}                 ended, skip:no_rules_change
//   told {changes: [{path, ...}]}      ended, ask:owner:check_change, with its pull request

export class ExamWork extends Context.Service<
	ExamWork,
	{
		/** The files on a branch of their own, pushed, with a pull request. Sent again, it finds them. */
		readonly land: (
			ticket: string,
			number: number,
			base: string,
			files: readonly {readonly path: string; readonly text: string}[],
		) => Effect.Effect<Landed, {readonly _tag: "unknown"}>;
		/** The writer: one try's run, as a stream of the Draft's Msgs. */
		readonly write: (sub: Sub<"exam_write", DraftRun>) => Stream.Stream<ExamMsg>;
	}
>()("ExamWork") {}

const base = {
	machine: exam,
	state: Exam,
	options: () => ({
		ctx: undefined,
		interpret: {
			exam_land: (cmd: ReturnType<typeof landExam>) =>
				Effect.gen(function* () {
					return yield* (yield* ExamWork).land(cmd.ticket, cmd.number, cmd.base, cmd.files);
				}),
		},
		subscribe: {
			exam_write: (sub: Sub<"exam_write", DraftRun>) =>
				Stream.unwrap(
					Effect.gen(function* () {
						return (yield* ExamWork).write(sub);
					}),
				),
		},
		terminal: (s: Exam) => s.phase === "over",
	}),
	recovered: (s: Exam) => (s.phase === "idle" ? null : ({type: "resume"} as const)),
	drawing: () => ({
		name: "exam",
		service: "exam",
		steps: {exam_write: "writer", exam_land: "land the rule changes"},
	}),
	status: (s: Exam) => (s.phase === "over" ? nameOf(s.outcome) : s.phase),
};

export const examKind = kind({...base, parent: "main"});
export const examChild = kind({...base, parent: "lane"});

/** One exam step run to its end, under `id`. Found mid-way, it goes on. */
export const examToTheEnd = (
	refs: RefsOf<typeof examChild> | RefsOf<typeof examKind>,
	id: string,
	ask: ExamAsk,
) =>
	Effect.gen(function* () {
		const runtime = yield* refs
			.get(id)
			.start({type: "start", ask, key: id}, {conflict: "use_existing"});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the exam step stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

export const examProgram = defineProgram({
	name: "exam",
	description:
		"Lands a plan's rule changes in a pull request of their own, before any test or code. A plan that changes no rule passes with a written skip.",
	flags: {},
	inputs: {ask: input(ExamAsk, "The rule changes a plan lists.")},
	outputs: {
		ended: output(
			Schema.Struct({outcome: ExamOutcome, name: Schema.String, report: ExamReport}),
			"Once per ask: how it ended, and the pull request.",
		),
	},
	machines: {exam: examKind},
	main: ({serve, send, machines}) =>
		serve({
			ask: (ask) =>
				Effect.gen(function* () {
					const id = `exam/${ask.ticket}`;
					const end = yield* examToTheEnd(machines.exam, id, ask);
					yield* send("ended", {
						outcome: end.outcome,
						name: nameOf(end.outcome),
						report: end.report,
					});
					yield* machines.exam.get(id).clear;
				}),
		}),
});
