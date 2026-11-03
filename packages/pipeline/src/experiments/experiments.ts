import {Ledger, type Row, streams, type Writer, writerText} from "@kampus/fabrika-old";
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
	holds,
	type Kept,
	ROOT,
	type RunEnd,
	type RunId,
	type RunLog,
	RunPlan,
	RunRecord,
	readRow,
	runIdOf,
	type WriteUp,
} from "./experiment.ts";

// The service every experiment program reads and writes through
// (docs/direction/experiments-behind-a-service.md). Our ledger is the first implementation; a
// hosted platform (MLflow, Langfuse) would be a second, behind the same methods.
//
//   const experiments = yield* Experiments;
//   yield* experiments.create("170", "The experiments program");
//   const plan = {key: "job-7f3a", params: {model: "jev"}, tags: {}, job: null};
//   const run = yield* experiments.start("170", plan);                  // "170.49af0a19b683", from the key
//   yield* experiments.start("170", plan);                              // the same id again: the same key
//   yield* experiments.start("170", {...plan, params: {model: "gpt"}});  // fails: key_reused
//   yield* experiments.log(run, [
//     {kind: "case", item: "ticket-41", output: "yes", scores: {agreed: 1}},
//     {kind: "metric", key: "agreed", value: 1},
//   ]);
//   yield* experiments.end(run, {status: "finished", usd: 0.01, tokens: {input: 900, output: 30}});
//   (yield* experiments.list())[0].latest      // {run: "170.49af0a19b683", label: "170-1", status: "finished", ...}
//
// Each write goes to the experiment's inbox under its own message id, so a write sent again after
// a crash lands once: `created`, `written/<hash of the write-up>`, `started/<run>`,
// `metric/<run>/<key>`, `case/<run>/<item>`, `artifact/<run>/<path>`, `ended/<run>`, where `<run>`
// is the run's id, made from its key (`runIdOf`). A start's key comes from its caller, as
// Stripe's idempotency key does: a job's trace id, an import's results file. A caller with none,
// a person starting a fresh run, makes one once before its first try and keeps it for its retries.
// The same key with another plan is refused, as Stripe refuses a key reused with other
// parameters: returning the first run would log the second plan's results under the first plan's
// params. Another key whose id is taken is refused too, `id_taken`. A metric is logged once per
// run: MLflow keeps a history of steps for one key, this keeps one value.

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
	/** The run key started a run with another plan already. */
	"key_reused",
	/** Another run key has this key's run id: their hashes share their first 12 hex characters. */
	"id_taken",
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
) {
	/** Its words, so tsh prints `failed: no experiment 404`, not the error's tag. */
	override get message(): string {
		return this.says;
	}
}

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
		/**
		 * Start a run: its id, made from its key, `170.49af0a19b683`. Started again with the same
		 * key, it is the same run; with the same key and another plan, `key_reused`; with a key
		 * whose id another key's run has, `id_taken`.
		 */
		readonly start: (n: ExperimentId, plan: RunPlan) => Call<RunId>;
		/**
		 * Metrics, cases' results and files, on a running run, in order: MLflow's `log_batch`, so a
		 * run of 120 cases reads its experiment once, not 120 times. On an ended run, a log it holds
		 * already is no change, and any other is `ended`.
		 */
		readonly log: (run: RunId, what: readonly RunLog[]) => Call<void>;
		/** End a run, with what it cost. Ended again the same way, no change; another way, `ended`. */
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

const encodeFact = Schema.encodeUnknownEffect(Fact);

/** A plan as the ledger keeps it: through JSON and back, so it compares with a plan read back. */
const PlanText = Schema.fromJsonString(RunPlan);
const keptPlan = (plan: RunPlan) =>
	Schema.encodeEffect(PlanText)(plan).pipe(
		Effect.flatMap(Schema.decodeEffect(PlanText)),
		Effect.mapError((e) => failed("bad_fact", e.message)),
	);

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

			/** The run, as its experiment folds it. */
			const known = (run: RunId): Call<{readonly kept: Kept; readonly record: RunRecord}> =>
				one(experimentFor(run)).pipe(
					Effect.flatMap((kept) => {
						const record = kept.page.runs.find((r) => r.run === run);
						return record === undefined
							? Effect.fail(failed("no_run", `no run ${run}`))
							: Effect.succeed({kept, record});
					}),
				);

			const hasEnded = (r: RunRecord) => failed("ended", `run ${r.run} ended ${r.status}`);

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
						// The id is the message id. Two starts with one key at once: the ledger keeps the
						// first, the second is its `dup`, and both read back the same run. Two keys with
						// one id at once: the same, and the second reads back the first key's run.
						const run = runIdOf(n, plan.key);
						const found = (kept: Kept) => kept.page.runs.find((r) => r.run === run);
						const record =
							found(yield* one(n)) ??
							(yield* send(n, `started/${run}`, {type: "started", ...plan}).pipe(
								Effect.andThen(one(n)),
								Effect.map(found),
							));
						if (record === undefined)
							return yield* Effect.fail(
								failed("bad_fact", `the start ${plan.key} on ${n} did not fold into a run`),
							);
						if (record.key !== plan.key)
							return yield* Effect.fail(
								failed(
									"id_taken",
									`run key ${plan.key} makes ${run}, which run key ${record.key} has`,
								),
							);
						if (!RunRecord.startedWith(record, yield* keptPlan(plan)))
							return yield* Effect.fail(
								failed("key_reused", `run key ${plan.key} started ${run} with another plan`),
							);
						return run;
					}),
				log: (run, what) =>
					Effect.gen(function* () {
						const {kept, record} = yield* known(run);
						if (record.status !== "running") {
							// Sent again after the run ended, as a second import does: what it holds is no change.
							if (what.every((log) => holds(kept, record, log))) return;
							return yield* Effect.fail(hasEnded(record));
						}
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
					Effect.gen(function* () {
						const {record} = yield* known(run);
						if (record.status === "running")
							yield* send(experimentFor(run), `ended/${run}`, {type: "ended", run, ...how});
						else if (!RunRecord.endedWith(record, how)) return yield* Effect.fail(hasEnded(record));
					}),
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
