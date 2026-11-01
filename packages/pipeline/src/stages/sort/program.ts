import {defineProgram, input, kind, output, type RefsOf} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";
import {nameOf} from "../outcome.ts";
import {sortReadInterpret, sortSubscribe, sortWriteInterpret} from "./handlers.ts";
import {SortAsk, SortReport, type SortState, sort} from "./machine.ts";
import {SortOutcome} from "./outcome.ts";
import {Settings} from "./services.ts";

// Triage as a program: one ticket in, its machine to its end, how it ended out. The machine is the
// one today's factory sorts with; one agent reads the ticket and answers, code writes what it said.
//
//   tsh> triage --model opus --effort medium --budget 2     told a ticket url on its `ask` input
//   out: {name: "send:plan:yes", ...}
//
// Whoever starts it provides `SortHost`, `SortPlans`, `SortWrites` and `Sorter`.

// A plain union with no schema, as the machine's file left it: read back as it was written.
const kept: Schema.Codec<SortState, unknown> = Schema.Any;

const base = {
	machine: sort,
	state: kept,
	options: () => ({
		ctx: undefined,
		interpret: {...sortReadInterpret, ...sortWriteInterpret()},
		subscribe: sortSubscribe,
		terminal: (s: SortState) => s.phase === "over",
	}),
	recovered: (s: SortState) => (s.phase === "idle" ? null : ({type: "resume"} as const)),
	drawing: () => ({
		name: "triage",
		service: "triage",
		steps: {
			sort_ticket: "read ticket",
			sort_context: "read context",
			sort_run: "sorter",
			sort_write: "write answer",
		},
	}),
	status: (s: SortState) => (s.phase === "over" ? nameOf(s.outcome) : s.phase),
};

export const sortKind = kind({...base, parent: "main"});
export const sortChild = kind({...base, parent: "lane"});

/** One triage run to its end, under `id`. Found mid-way, it goes on. */
export const sortToTheEnd = (
	refs: RefsOf<typeof sortChild> | RefsOf<typeof sortKind>,
	id: string,
	ask: SortAsk,
	settings: Settings,
) =>
	Effect.gen(function* () {
		const runtime = yield* refs
			.get(id)
			.start({type: "start", ask, settings, key: id}, {conflict: "use_existing"});
		const end: SortState = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the triage stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

export const triageProgram = defineProgram({
	name: "triage",
	description:
		"Reads one ticket and answers whether it should be built: yes and what is next, a duplicate, or no with why.",
	flags: {},
	inputs: {
		ask: input(Schema.Struct({ask: SortAsk, settings: Settings}), "The ticket, and who sorts it."),
	},
	outputs: {
		ended: output(
			Schema.Struct({outcome: SortOutcome, name: Schema.String, report: SortReport}),
			"Once per ticket: how it ended, and what was written.",
		),
	},
	machines: {sort: sortKind},
	main: ({serve, send, machines}) =>
		serve({
			ask: ({ask, settings}) =>
				Effect.gen(function* () {
					const id = `triage/${ask.ticket}`;
					const end = yield* sortToTheEnd(machines.sort, id, ask, settings);
					yield* send("ended", {
						outcome: end.outcome,
						name: nameOf(end.outcome),
						report: end.report,
					});
					yield* machines.sort.get(id).clear;
				}),
		}),
});
