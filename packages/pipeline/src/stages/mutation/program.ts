import {defineProgram, input, kind, output, type RefsOf} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";
import {nameOf} from "../outcome.ts";
import {mutationInterpret} from "./handlers.ts";
import {Mutation, MutationAsk, MutationReport, mutation} from "./machine.ts";
import {MutationOutcome} from "./outcome.ts";

// The mutation step as a program: one ask in, its machine to its end, how it ended out. No agent
// sits in it: it reads what the build changed, runs the repo's tests, then mutants over those lines.
//
//   tsh> mutation          told {ticket, base, head, ...} on its `ask` input
//   out: {name: "send:test_writer:mutant_survived", report: {ran: {survived: [...]}, ...}}
//
// Whoever starts it provides `MutationScope` and `MutationRunner`.

const base = {
	machine: mutation,
	state: Mutation,
	options: () => ({
		ctx: undefined,
		interpret: mutationInterpret,
		terminal: (s: Mutation) => s.phase === "over",
	}),
	recovered: (s: Mutation) => (s.phase === "idle" ? null : ({type: "resume"} as const)),
	drawing: () => ({
		name: "mutation",
		service: "mutation",
		steps: {
			mutation_scope: "read what changed",
			mutation_tests: "run the tests",
			mutation_run: "run mutants",
		},
	}),
	status: (s: Mutation) => (s.phase === "over" ? nameOf(s.outcome) : s.phase),
};

export const mutationKind = kind({...base, parent: "main"});
export const mutationChild = kind({...base, parent: "lane"});

/** One mutation run to its end, under `id`. Found mid-way, it goes on. */
export const mutationToTheEnd = (
	refs: RefsOf<typeof mutationChild> | RefsOf<typeof mutationKind>,
	id: string,
	ask: MutationAsk,
) =>
	Effect.gen(function* () {
		const runtime = yield* refs.get(id).start({type: "start", ask}, {conflict: "use_existing"});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the mutation step stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

export const mutationProgram = defineProgram({
	name: "mutation",
	description:
		"Runs mutants over the lines a build changed, against the repo's own tests. Any that lives goes back to the test writer.",
	flags: {},
	inputs: {ask: input(MutationAsk, "The base, the head, and what is the exam.")},
	outputs: {
		ended: output(
			Schema.Struct({outcome: MutationOutcome, name: Schema.String, report: MutationReport}),
			"Once per ask: how it ended, and what the mutants did.",
		),
	},
	machines: {mutation: mutationKind},
	main: ({serve, send, machines}) =>
		serve({
			ask: (ask) =>
				Effect.gen(function* () {
					const id = `mutation/${ask.ticket}/${ask.head}`;
					const end = yield* mutationToTheEnd(machines.mutation, id, ask);
					yield* send("ended", {
						outcome: end.outcome,
						name: nameOf(end.outcome),
						report: end.report,
					});
					yield* machines.mutation.get(id).clear;
				}),
		}),
});
