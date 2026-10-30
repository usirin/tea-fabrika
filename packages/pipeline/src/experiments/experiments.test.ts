import {Ledger, streams} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Deferred, Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {
	Comparison,
	Experiment,
	ExperimentPage,
	experimentName,
	fold,
	readRow,
} from "./experiment.ts";
import {Experiments, experimentsOnLedger} from "./experiments.ts";

// The service on a ledger in memory: what every experiment program reads and writes through.

const OWNER = {kind: "user", id: "owner"} as const;

const on = <A, E>(ledger: Ledger["Service"], body: Effect.Effect<A, E, Experiments>) =>
	Effect.runPromise(
		body.pipe(
			Effect.provide(experimentsOnLedger(OWNER)),
			Effect.provide(Layer.succeed(Ledger, ledger)),
		),
	);

const plan = {key: "run-a", params: {model: "jev"}, tags: {}, job: null};

/**
 * The ledger with starts held in pairs: the first waits for the second, so both read the
 * experiment before either is sent, the worst order for two starts sent at once.
 */
const racing = (ledger: Ledger["Service"]): Ledger["Service"] => {
	let first: Deferred.Deferred<void> | null = null;
	const pair = Effect.suspend(() => {
		if (first === null) {
			first = Deferred.makeUnsafe<void>();
			return Deferred.await(first);
		}
		const waiting = first;
		first = null;
		return Deferred.succeed(waiting, undefined);
	});
	return {
		...ledger,
		send: (inbox, id, event, fence) =>
			id.startsWith("started/")
				? pair.pipe(Effect.andThen(ledger.send(inbox, id, event, fence)))
				: ledger.send(inbox, id, event, fence),
	};
};

/** Experiment 170 with two runs over three cases: case t-2 changed, t-3 is only in the second. */
const twoRuns = Effect.gen(function* () {
	const ex = yield* Experiments;
	yield* ex.create("170", "The experiments program");
	const a = yield* ex.start("170", plan);
	yield* ex.log(a, [
		{kind: "case", item: "t-1", output: "yes", scores: {agreed: 1}},
		{kind: "case", item: "t-2", output: "no", scores: {agreed: 0}},
		{kind: "metric", key: "agreed", value: 0.5},
	]);
	yield* ex.end(a, {status: "finished", usd: 0.02, tokens: {input: 900, output: 30}});
	const b = yield* ex.start("170", {...plan, key: "run-b", params: {model: "jev", floor: 0.8}});
	yield* ex.log(b, [
		{kind: "case", item: "t-1", output: "yes", scores: {agreed: 1}},
		{kind: "case", item: "t-2", output: "yes", scores: {agreed: 1}},
		{kind: "case", item: "t-3", output: "yes", scores: {agreed: 1}},
	]);
	// The same case sent again, as after a crash, lands once.
	yield* ex.log(b, [
		{kind: "case", item: "t-3", output: "yes", scores: {agreed: 1}},
		{kind: "metric", key: "agreed", value: 1},
	]);
	yield* ex.end(b, {status: "finished", usd: 0.03, tokens: {input: 1200, output: 40}});
	return [a, b] as const;
});

describe("Experiments on the ledger", () => {
	it("numbers runs in order, and lists the latest with its headline metric", async () => {
		const ledger = memoryService();
		const [runs, list] = await on(
			ledger,
			Effect.gen(function* () {
				const runs = yield* twoRuns;
				return [runs, yield* (yield* Experiments).list()] as const;
			}),
		);
		expect(runs).toEqual(["170-1", "170-2"]);
		expect(list).toEqual([
			{
				n: "170",
				title: "The experiments program",
				date: null,
				runs: 2,
				latest: {
					run: "170-2",
					at: expect.any(Number),
					status: "finished",
					headline: {key: "agreed", value: 1},
				},
			},
		]);
	});

	it("keeps each case's result, and compares two runs case by case", async () => {
		const ledger = memoryService();
		const compared = await on(
			ledger,
			Effect.gen(function* () {
				const [a, b] = yield* twoRuns;
				const ex = yield* Experiments;
				const [ra, rb] = yield* ex.runs("170");
				if (ra === undefined || rb === undefined) return yield* Effect.die("two runs");
				return Comparison.fromRuns(ra, rb, yield* ex.cases(a), yield* ex.cases(b));
			}),
		);
		expect(compared).toEqual({
			a: "170-1",
			b: "170-2",
			metrics: [
				{key: "agreed", a: 0.5, b: 1},
				{key: "usd", a: 0.02, b: 0.03},
			],
			cases: [
				{item: "t-2", a: {agreed: 0}, b: {agreed: 1}},
				{item: "t-3", a: null, b: {agreed: 1}},
			],
			same: 1,
		});
		expect(Comparison.toMarkdown(compared)).toContain("## Cases that changed: 2, 1 the same");
	});

	it("lands a write sent again once, and refuses a log on an ended run", async () => {
		const ledger = memoryService();
		const [after, why] = await on(
			ledger,
			Effect.gen(function* () {
				const ex = yield* Experiments;
				const [a] = yield* twoRuns;
				// The same create again, as after a crash: nothing new lands.
				yield* ex.create("170", "Another title");
				const late = yield* ex.log(a, [{kind: "metric", key: "late", value: 1}]).pipe(
					Effect.flip,
					Effect.map((e) => e.why),
				);
				return [yield* ex.open("170"), late] as const;
			}),
		);
		expect(after.title).toBe("The experiments program");
		expect(after.runs.map((r) => r.metrics)).toEqual([{agreed: 0.5}, {agreed: 1}]);
		expect(why).toBe("ended");
	});

	it("says which experiment or run it does not know", async () => {
		const ledger = memoryService();
		const whys = await on(
			ledger,
			Effect.gen(function* () {
				const ex = yield* Experiments;
				const a = yield* ex.open("404").pipe(Effect.flip);
				yield* ex.create("170", "The experiments program");
				const b = yield* ex.cases("170-9").pipe(Effect.flip);
				const c = yield* ex.start("171", plan).pipe(Effect.flip);
				return [a.why, b.why, c.why];
			}),
		);
		expect(whys).toEqual(["no_experiment", "no_run", "no_experiment"]);
	});

	it("starts one run per key: again with a key is that run, and another plan is refused", async () => {
		const ledger = memoryService();
		const [runs, again, other, after] = await on(
			ledger,
			Effect.gen(function* () {
				const ex = yield* Experiments;
				yield* ex.create("170", "The experiments program");
				const a = yield* ex.start("170", plan);
				const b = yield* ex.start("170", {...plan, key: "run-b"});
				// The same plan with its params in another order is the same plan.
				const again = yield* ex.start("170", {...plan, tags: {}, params: {model: "jev"}});
				const other = yield* ex.start("170", {...plan, params: {model: "gpt"}}).pipe(Effect.flip);
				return [[a, b], again, other.why, yield* ex.runs("170")] as const;
			}),
		);
		expect(runs).toEqual(["170-1", "170-2"]);
		expect(again).toBe("170-1");
		expect(other).toBe("key_reused");
		expect(after.map((r) => [r.run, r.key, r.params])).toEqual([
			["170-1", "run-a", {model: "jev"}],
			["170-2", "run-b", {model: "jev"}],
		]);
	});

	it("gives two starts sent at once one run when they share a key, two when they do not", async () => {
		const [same, two, runs] = await on(
			racing(memoryService()),
			Effect.gen(function* () {
				const ex = yield* Experiments;
				yield* ex.create("170", "The experiments program");
				const same = yield* Effect.all([ex.start("170", plan), ex.start("170", plan)], {
					concurrency: "unbounded",
				});
				const keys = ["run-b", "run-c"].map((key) => ex.start("170", {...plan, key}));
				const two = yield* Effect.all(keys, {concurrency: "unbounded"});
				return [same, two, yield* ex.runs("170")] as const;
			}),
		);
		expect(same).toEqual(["170-1", "170-1"]);
		// Both land; the ledger's order numbers them, so each has its own number, whichever is first.
		expect([...two].sort()).toEqual(["170-2", "170-3"]);
		expect(runs.map((r) => r.key).sort()).toEqual(["run-a", "run-b", "run-c"]);
	});

	it("takes a log or an end sent again after the run ended, and refuses one that differs", async () => {
		const ledger = memoryService();
		const [runs, other, late] = await on(
			ledger,
			Effect.gen(function* () {
				const ex = yield* Experiments;
				const [a] = yield* twoRuns;
				const how = {status: "finished", usd: 0.02, tokens: {output: 30, input: 900}} as const;
				yield* ex.end(a, how);
				yield* ex.log(a, [{kind: "case", item: "t-1", output: "yes", scores: {agreed: 1}}]);
				const other = yield* ex.end(a, {...how, status: "failed"}).pipe(Effect.flip);
				const late = yield* ex
					.log(a, [
						{kind: "metric", key: "agreed", value: 0.5},
						{kind: "metric", key: "late", value: 1},
					])
					.pipe(Effect.flip);
				return [yield* ex.runs("170"), other.why, late.why] as const;
			}),
		);
		expect(runs[0]).toMatchObject({status: "finished", usd: 0.02, metrics: {agreed: 0.5}});
		expect(other).toBe("ended");
		expect(late).toBe("ended");
	});

	it("draws its page as markdown from the write-up and the runs", async () => {
		const ledger = memoryService();
		const page = await on(
			ledger,
			Effect.gen(function* () {
				const ex = yield* Experiments;
				yield* twoRuns;
				yield* ex.write("170", {
					date: "2026-10-30",
					answer: "Yes.",
					headline: "agreed",
					sections: [{heading: "What was asked", text: "Can it hold runs?"}],
				});
				return yield* ex.open("170");
			}),
		);
		const md = ExperimentPage.toMarkdown(page);
		expect(md.split("\n").slice(0, 7)).toEqual([
			"# 170: The experiments program",
			"",
			"Date: 2026-10-30",
			"",
			"**Answer.** Yes.",
			"",
			"## What was asked",
		]);
		expect(md).toContain("| 170-2 | finished | 0.03 | agreed 1 |");
		expect(Experiment.toMarkdown([Experiment.fromPage(page)])).toContain(
			"| 170 | The experiments program | 2026-10-30 | 2 | 170-2 finished, agreed 1 |",
		);
	});
});

describe("the fold", () => {
	it("keeps out a fact that does not fit, and says why", async () => {
		const ledger = memoryService();
		const rows = await Effect.runPromise(
			Effect.gen(function* () {
				const name = experimentName("170");
				yield* ledger.register(name, "user:owner");
				const send = (id: string, data: {readonly type: string} & Record<string, unknown>) =>
					ledger.send(streams(name).inbox, id, {kind: data.type, writer: "user:owner", data});
				yield* send("1", {
					type: "logged",
					run: "170-1",
					what: {kind: "metric", key: "k", value: 1},
				});
				yield* send("2", {type: "created", title: "Late"});
				yield* send("3", {
					type: "ended",
					run: "170-1",
					status: "finished",
					usd: null,
					tokens: null,
				});
				yield* send("4", {type: "created", title: "Again"});
				return yield* ledger.readStream(streams(name).inbox, 0, -1);
			}),
		);
		const entries = rows.flatMap((r) => {
			const read = readRow(r);
			return read.kind === "entry" ? [read.entry] : [];
		});
		const folded = fold(entries);
		expect(folded.experiments.map((k) => k.page.title)).toEqual(["Late"]);
		// Row 1 is the registration: the ledger counts every row, on every stream.
		expect(folded.problems).toEqual([
			"row 2 on 170: logged, but the experiment was never created",
			"row 4 on 170: run 170-1 ended, but it never started",
			"row 5 on 170: created a second time",
		]);
	});
});
