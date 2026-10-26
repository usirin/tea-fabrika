// A pipeline stage as a program on tea-host (experiment 104). One registered name per piece of
// work (`ship:<n>`, `review:<n>`, `plan:<n>`, `build:<n>:r<round>`); whichever host holds its
// lease runs the stage's own machine, unchanged, with its journal on `<name>/state`.
//
//   the job      one cast into the name's inbox under the id `job`: what to work on.
//   boot         the machine's journal is loaded. A machine still idle is started on the job; one
//                found part way gets `resume`, which sends again whatever Cmd was in flight.
//   writes       every write that leaves the ledger goes through `Idempotency` (./idempotency.ts),
//                made for this lease and given to the machine's handlers.
//   the agent    a child program (`<name>:agent`, ./agent.ts) started with its `limits`. The stage
//                traps exits, so a child its limit ended does not take the stage with it.
//   the end      the stage's last writes (a review's verdict comment), then one row in
//                `<name>/outcome`, fenced, under the id `outcome`. The child is shut down, and the
//                name exits `normal`. A stage taken over after its outcome row exits at once.
import type {EffectBootingRuntime} from "@demlik/tea/effect";
import {defineProgram, envelope, input, Ledger, type Limits, Self} from "@kampus/fabrika";
import {Duration, Effect, Exit, Schema, type Scope, Stream} from "effect";
import {steady} from "../asks/ledger.ts";
import {agentOf} from "./agent.ts";
import {gate, Idempotency, type WriteNote} from "./idempotency.ts";

/** One hosted stage: how to boot its machine, start it on a job, and end it. */
export interface Stage<S, M extends {readonly type: string}, J, R> {
	readonly kind: string;
	readonly job: Schema.Codec<J, unknown>;
	/** `self.run` of the stage's machine, with its handlers. */
	readonly boot: (
		self: Self["Service"],
	) => Effect.Effect<EffectBootingRuntime<S, any, any, any>, never, Scope.Scope | R>;
	readonly over: (s: S) => boolean;
	readonly idle: (s: S) => boolean;
	readonly start: (job: J, name: string) => M;
	readonly resume: M;
	/** After the machine's end: the stage's last writes, and its outcome row's data. */
	readonly finish: (end: S, job: J, name: string) => Effect.Effect<unknown, never, R>;
	/** The agent child's limits for a job (its child spec), or null: this stage runs no agent. */
	readonly agent: ((job: J) => Limits) | null;
}

/** What a hosted stage says, for the harness. */
export type StageNote =
	| WriteNote
	| {readonly ev: "stage"; readonly name: string; readonly fence: number; readonly step: string}
	| {
			readonly ev: "outcome";
			readonly name: string;
			readonly fence: number;
			readonly outcome: unknown;
	  };

/** The stream a stage's outcome row is in. */
export const outcomeOf = (name: string) => `${name}/outcome`;

/** A JSON journal for a machine that revives its own loaded state in `init`. */
export const jsonJournal = <S>(): Schema.Codec<S, unknown> =>
	Schema.Unknown as Schema.Codec<S, unknown>;

/** The job, cast into a stage's inbox under the id `job`. */
export const JOB_ID = "job";

const OutcomeRow = Schema.fromJsonString(Schema.Struct({outcome: Schema.Unknown}));
/** A stage's outcome, read from the ledger. `null`: it has none yet. */
export const readOutcome = (name: string) =>
	Effect.gen(function* () {
		const rows = yield* (yield* Ledger).readStream(outcomeOf(name));
		const row = rows.find((r) => r.id === "outcome");
		if (row === undefined) return null;
		const data = Schema.decodeUnknownExit(OutcomeRow)(row.data);
		return Exit.isSuccess(data) ? {outcome: data.value.outcome, writer: row.writer} : null;
	});

const SPACING = Duration.millis(100);

export const hostedStage = <S, M extends {readonly type: string}, J, R>(
	stage: Stage<S, M, J, R>,
	say: (n: StageNote) => void,
	options: {readonly planted?: "no_lease_check"} = {},
) =>
	defineProgram({
		name: `hosted-${stage.kind}`,
		description: `The ${stage.kind} stage's machine, run under a registered name on tea-host.`,
		inputs: {inbox: input(envelope(Schema.Unknown), "The job, and EXITs from its agent child.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const ledger = yield* Ledger;
				const {name, fence, holder} = self;
				const note = (step: string) => Effect.sync(() => say({ev: "stage", name, fence, step}));
				const exitNormal = self
					.exit("normal", `the ${stage.kind} stage is over`)
					.pipe(Effect.andThen(Effect.never));

				if ((yield* readOutcome(name).pipe(Effect.orElseSucceed(() => null))) !== null) {
					yield* note("already_over");
					return yield* exitNormal;
				}
				const decodeJob = Schema.decodeUnknownExit(Schema.fromJsonString(stage.job));
				const job = yield* Effect.gen(function* () {
					for (;;) {
						const rows = yield* self.reads
							.readStream(self.inbox)
							.pipe(Effect.orElseSucceed(() => []));
						const row = rows.find((r) => r.id === JOB_ID);
						const decoded = row === undefined ? null : decodeJob(row.data);
						if (decoded !== null && Exit.isSuccess(decoded)) return decoded.value;
						yield* Effect.sleep(SPACING);
					}
				});

				if (stage.agent !== null) {
					yield* self.trapExit(true);
					const started = yield* self.startChild(agentOf(name), null, stage.agent(job));
					yield* note(`agent_${started.how}`);
				}
				const idempotency = yield* gate({
					name,
					fence,
					holder,
					say,
					...(options.planted === undefined ? {} : {planted: options.planted}),
				});
				const booting = yield* stage
					.boot(self)
					.pipe(Effect.provideService(Idempotency, idempotency));
				const runtime = yield* booting.ready.pipe(Effect.orDie);
				yield* inputs.inbox.pipe(Stream.runDrain, Effect.forkScoped);
				const now = runtime.getState();
				if (!stage.over(now)) {
					const first = stage.idle(now) ? stage.start(job, name) : stage.resume;
					yield* note(first.type === "resume" ? "resumed" : "started");
					yield* runtime.dispatch(first).pipe(Effect.orDie);
				}
				const end = stage.over(now) ? now : yield* runtime.done();
				const outcome = yield* stage
					.finish(end, job, name)
					.pipe(Effect.provideService(Idempotency, idempotency));
				// 151: sent again with no limit while the ledger does not answer; its id makes that safe.
				const wrote = yield* steady(
					"write the outcome",
					ledger.append(
						outcomeOf(name),
						"any",
						{kind: "outcome", writer: holder, id: "outcome", data: {outcome}},
						fence,
					),
				).pipe(Effect.result);
				// A lost lease: the next holder writes it.
				if (wrote._tag === "Failure") return yield* Effect.never;
				yield* Effect.sync(() => say({ev: "outcome", name, fence, outcome}));
				if (stage.agent !== null) {
					const child = yield* self.reads
						.processInfo(agentOf(name))
						.pipe(Effect.orElseSucceed(() => null));
					if (child !== null && child.down === 0)
						yield* self.exitChild(
							agentOf(name),
							child.incarnation,
							"shutdown",
							"its stage is over",
						);
				}
				return yield* exitNormal;
			}).pipe(Effect.scoped),
	});
