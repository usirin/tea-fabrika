import {Ledger, type Row, streams, type Writer, writerText} from "@kampus/fabrika";
import {Context, Effect, Layer, Schema} from "effect";
import {sha256} from "../tickets/approval.ts";
import {
	type CaseResult,
	type Entry,
	Experiment,
	type ExperimentId,
	type ExperimentPage,
	experimentFor,
	experimentName,
	Fact,
	fold,
	type Kept,
	ROOT,
	type RunEnd,
	type RunId,
	type RunLog,
	type RunPlan,
	type RunRecord,
	readRow,
	type WriteUp,
} from "./experiment.ts";

// The service every experiment program reads and writes through
// (docs/direction/experiments-behind-a-service.md). Our ledger is the first implementation; a
// hosted platform (MLflow, Langfuse) would be a second, behind the same methods.
//
//   const experiments = yield* Experiments;
//   yield* experiments.create("170", "The experiments program");
//   const run = yield* experiments.start("170", {params: {model: "jev"}, tags: {}, job: null});  // "170-1"
//   yield* experiments.log(run, [
//     {kind: "case", item: "ticket-41", output: "yes", scores: {agreed: 1}},
//     {kind: "metric", key: "agreed", value: 1},
//   ]);
//   yield* experiments.end(run, {status: "finished", usd: 0.01, tokens: {input: 900, output: 30}});
//   (yield* experiments.list())[0].latest      // {run: "170-1", status: "finished", headline: {key: "agreed", value: 1}}
//
// Each write goes to the experiment's inbox under its own message id, so a write sent again after
// a crash lands once: `created`, `written/<hash of the write-up>`, `metric/<run>/<key>`,
// `case/<run>/<item>`, `artifact/<run>/<path>`, `ended/<run>`. A start is the one exception: it
// takes the next free number, `started/<k>`, so a start sent again is a second run, as MLflow's
// `create_run` is. A metric is logged once per run: MLflow keeps a history of steps for one key,
// this keeps one value.

/** Why a read or a write did not go through. */
export const Why = Schema.Literals([
	/** The ledger did not answer. */
	"unreachable",
	/** No experiment has that number, or its facts do not fold. */
	"no_experiment",
	/** No run has that id. */
	"no_run",
	/** The run has ended: nothing more is logged on it. */
	"ended",
	/** The ledger refused the write. */
	"refused",
	/** The fact does not fit its schema. */
	"bad_fact",
]);

export class ExperimentsFailed extends Schema.TaggedError<ExperimentsFailed>()(
	"ExperimentsFailed",
	{
		why: Why,
		/** What went wrong, in words. */
		says: Schema.String,
	},
) {}

type Call<A> = Effect.Effect<A, ExperimentsFailed>;

export class Experiments extends Context.Service<
	Experiments,
	{
		/** Every experiment, by number: its title, how many runs, the latest one. */
		readonly list: () => Call<readonly Experiment[]>;
		/** A new experiment. Created again, it stays as it was: the first title stands. */
		readonly create: (n: ExperimentId, title: string) => Call<void>;
		/** A new version of its write-up. The newest one is the page. */
		readonly write: (n: ExperimentId, writeUp: WriteUp) => Call<void>;
		/** One experiment: its write-up, as data, and its runs. */
		readonly open: (n: ExperimentId) => Call<ExperimentPage>;
		/** Start a run: its id, the next free one, `170-1`, `170-2`. */
		readonly start: (n: ExperimentId, plan: RunPlan) => Call<RunId>;
		/**
		 * Metrics, cases' results and files, on a running run, in order: MLflow's `log_batch`, so a
		 * run of 120 cases reads its experiment once, not 120 times.
		 */
		readonly log: (run: RunId, what: readonly RunLog[]) => Call<void>;
		/** End a run, with what it cost. */
		readonly end: (run: RunId, how: RunEnd) => Call<void>;
		/** Its runs, oldest first: what `compare` reads. */
		readonly runs: (n: ExperimentId) => Call<readonly RunRecord[]>;
		/** One run's results, case by case. */
		readonly cases: (run: RunId) => Call<readonly CaseResult[]>;
	}
>()("Experiments") {}

const failed = (why: typeof Why.Type, says: string) => new ExperimentsFailed({why, says});

/** Rows read per call. */
const PAGE = 500;

/** The most run numbers a start passes over before it gives up: each one was taken. */
const TRIES = 1000;

const encodeFact = Schema.encodeUnknownEffect(Fact);

/** Experiments on the ledger, written as `writer`. */
export const experimentsOnLedger = (writer: Writer): Layer.Layer<Experiments, never, Ledger> =>
	Layer.effect(
		Experiments,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const by = writerText(writer);

			const entries = (rows: readonly Row[]): Entry[] =>
				rows.flatMap((row) => {
					const read = readRow(row);
					return read.kind === "entry" ? [read.entry] : [];
				});

			/** One experiment, folded from its inbox. */
			const one = (n: ExperimentId): Call<Kept> =>
				ledger.readStream(streams(experimentName(n)).inbox, 0, -1).pipe(
					Effect.mapError((e) => failed("unreachable", e.message)),
					Effect.flatMap((rows) => {
						const kept = fold(entries(rows)).experiments.find((k) => k.page.n === n);
						return kept === undefined
							? Effect.fail(failed("no_experiment", `no experiment ${n} on the ledger`))
							: Effect.succeed(kept);
					}),
				);

			/** One fact on experiment `n`'s inbox, under `id`. `true`: it was there already. */
			const send = (n: ExperimentId, id: string, fact: Fact): Call<boolean> =>
				Effect.gen(function* () {
					const data = yield* encodeFact(fact).pipe(
						Effect.mapError((e) => failed("bad_fact", e.message)),
					);
					const sent = yield* ledger.send(streams(experimentName(n)).inbox, id, {
						kind: fact.type,
						writer: by,
						data,
					});
					return sent.dup;
				}).pipe(
					Effect.catchTags({
						LedgerUnreachable: (e) => Effect.fail(failed("unreachable", e.message)),
						Denied: (e) => Effect.fail(failed("refused", `the ledger refused ${e.stream}`)),
						Fenced: (e) => Effect.fail(failed("refused", `the ledger refused ${e.stream}`)),
						UnknownName: () =>
							Effect.fail(failed("no_experiment", `no experiment ${n} on the ledger`)),
					}),
				);

			/** The run, still running, on its experiment. */
			const running = (run: RunId): Call<Kept> =>
				one(experimentFor(run)).pipe(
					Effect.flatMap((kept) => {
						const found = kept.page.runs.find((r) => r.run === run);
						if (found === undefined) return Effect.fail(failed("no_run", `no run ${run}`));
						if (found.status !== "running")
							return Effect.fail(failed("ended", `run ${run} ended ${found.status}`));
						return Effect.succeed(kept);
					}),
				);

			const list = (): Call<readonly Experiment[]> =>
				Effect.gen(function* () {
					const found: Entry[] = [];
					let last = 0;
					for (;;) {
						const page = yield* ledger.read(last, PAGE, ROOT);
						found.push(...entries(page));
						last = page.at(-1)?.pos ?? last;
						if (page.length < PAGE) break;
					}
					return fold(found).experiments.map((k) => Experiment.fromPage(k.page));
				}).pipe(Effect.mapError((e) => failed("unreachable", e.message)));

			return {
				list,
				create: (n, title) =>
					ledger.register(experimentName(n), by).pipe(
						Effect.mapError((e) =>
							e._tag === "Denied"
								? failed("refused", `the ledger refused ${e.stream}`)
								: failed("unreachable", e.message),
						),
						Effect.andThen(send(n, "created", {type: "created", title})),
						Effect.asVoid,
					),
				write: (n, writeUp) =>
					Effect.gen(function* () {
						yield* one(n);
						const hash = yield* sha256(JSON.stringify(writeUp));
						yield* send(n, `written/${hash}`, {type: "written", ...writeUp});
					}),
				open: (n) => one(n).pipe(Effect.map((k) => k.page)),
				start: (n, plan) =>
					Effect.gen(function* () {
						const kept = yield* one(n);
						// The next number nobody took: a start sent at the same time takes the same one,
						// the ledger keeps the first, and the second moves on.
						for (let k = kept.page.runs.length + 1; k < kept.page.runs.length + TRIES; k++) {
							const run = `${n}-${k}`;
							if (!(yield* send(n, `started/${k}`, {type: "started", run, ...plan}))) return run;
						}
						return yield* Effect.fail(failed("refused", `${TRIES} run numbers taken on ${n}`));
					}),
				log: (run, what) =>
					Effect.gen(function* () {
						yield* running(run);
						for (const log of what) {
							const id =
								log.kind === "metric"
									? `metric/${run}/${log.key}`
									: log.kind === "case"
										? `case/${run}/${log.item}`
										: `artifact/${run}/${log.path}`;
							yield* send(experimentFor(run), id, {type: "logged", run, what: log});
						}
					}),
				end: (run, how) =>
					running(run).pipe(
						Effect.andThen(send(experimentFor(run), `ended/${run}`, {type: "ended", run, ...how})),
						Effect.asVoid,
					),
				runs: (n) => one(n).pipe(Effect.map((k) => k.page.runs)),
				cases: (run) =>
					one(experimentFor(run)).pipe(
						Effect.flatMap((k) =>
							k.page.runs.some((r) => r.run === run)
								? Effect.succeed(k.cases.filter((c) => c.run === run))
								: Effect.fail(failed("no_run", `no run ${run}`)),
						),
					),
			};
		}),
	);
