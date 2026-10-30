// Experiment 170, part 1: the experiments program on today's ledger. Two steps, both $0, no key,
// no model, no network:
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY node experiments/170-experiments-program.ts
//
//   import   reads experiments/NN-*.md, experiments/README.md and experiments/results/*.json,
//            read-only, and loads them through the `Experiments` service into a ledger in this
//            process's memory. Never the shared ledger, never an app home. Prints the counts.
//   programs runs `experiments`, `experiment --n 167` and `compare` on that ledger, the real
//            programs, and prints what each sent, cut to a few lines.
//
// The counts, and only the counts, go to results/170-experiments-program.json: no title, answer
// or text from an old write-up is written anywhere.
import {readdirSync, readFileSync, writeFileSync} from "node:fs";
import {call, Ledger, memoryStorage} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Experiments, experimentsOnLedger} from "@kampus/pipeline/experiments/experiments";
import {load, transform} from "@kampus/pipeline/experiments/import";
import {compare} from "@tea-fabrika/compare";
import {experiment} from "@tea-fabrika/experiment";
import {experiments} from "@tea-fabrika/experiments";
import {Effect, Layer} from "effect";

const HERE = new URL("./", import.meta.url);
const RESULTS = new URL("./results/170-experiments-program.json", import.meta.url);
const IMPORTER = {kind: "agent", id: "import"} as const;

const read = (folder: URL, name: string) => ({
	name,
	text: readFileSync(new URL(name, folder), "utf8"),
});

/** The old log: every write-up, script and results file but this experiment's own. */
const files = () => {
	const names = readdirSync(HERE).filter((n) => !n.startsWith("170-"));
	const results = new URL("./results/", HERE);
	return {
		index: readFileSync(new URL("README.md", HERE), "utf8"),
		writeUps: names.filter((n) => /^\d{2,3}[a-z]?-.+\.md$/.test(n)).map((n) => read(HERE, n)),
		scripts: names.filter((n) => /^\d{2,3}[a-z]?-.+\.(ts|mjs)$/.test(n)).map((n) => read(HERE, n)),
		results: readdirSync(results)
			.filter((n) => n.endsWith(".json") && !n.startsWith("170-"))
			.map((n) => read(results, n)),
	};
};

const ledger = memoryService();
const services = Layer.mergeAll(
	experimentsOnLedger(IMPORTER).pipe(Layer.provide(Layer.succeed(Ledger, ledger))),
	Layer.succeed(Ledger, ledger),
);

/** One program called once, its values heard, cut to their first lines when they are text. */
const heard = (name: string, run: Effect.Effect<unknown, unknown, Experiments>) =>
	Effect.gen(function* () {
		const t0 = performance.now();
		const called = yield* run;
		const ms = Math.round(performance.now() - t0);
		const values =
			typeof called === "object" && called !== null && "heard" in called
				? (called.heard as readonly {readonly name: string; readonly value: unknown}[])
				: [];
		console.log(`\n${name}: ${values.length} values in ${ms} ms`);
		for (const v of values.slice(0, 3)) {
			const text = typeof v.value === "string" ? v.value : JSON.stringify(v.value);
			console.log(`  ${v.name}: ${text.split("\n").slice(0, 6).join("\n    ").slice(0, 400)}`);
		}
		return {name, values: values.length, ms};
	});

const keeping = (id: string) => ({id, storage: memoryStorage()});

const main = Effect.gen(function* () {
	const t0 = performance.now();
	const old = transform(files());
	const transformMs = Math.round(performance.now() - t0);
	const t1 = performance.now();
	yield* load(old);
	const loadMs = Math.round(performance.now() - t1);
	const rows = yield* ledger.read(0, 1_000_000, "experiments");
	const listed = yield* (yield* Experiments).list();
	console.log("import, into a ledger in memory:");
	console.log(JSON.stringify(old.counts, null, 2));
	console.log(`${rows.length} ledger rows; transform ${transformMs} ms, load ${loadMs} ms`);
	console.log(`${listed.length} experiments listed, ${old.runs.length} runs`);

	// Old results of one experiment are often different measurements, not runs of one thing. Of
	// the experiments with two runs or more, how many have a last two that share a metric name?
	const service = yield* Experiments;
	const many = listed.filter((e) => e.runs >= 2);
	const sharing: string[] = [];
	for (const e of many) {
		const [a, b] = (yield* service.runs(e.n)).slice(-2);
		if (a !== undefined && b !== undefined && Object.keys(a.metrics).some((k) => k in b.metrics))
			sharing.push(e.n);
	}
	console.log(
		`${many.length} with two runs or more, ${sharing.length} whose last two share a metric`,
	);
	const two = sharing[0] ?? many[0]?.n ?? "167";
	const programs = [
		yield* heard(
			"experiments",
			call(experiments, {}, {keeping: keeping("experiments:170")}).pipe(Effect.scoped),
		),
		yield* heard(
			"experiment --n 167",
			call(experiment, {n: "167"}, {keeping: keeping("experiment:170")}).pipe(Effect.scoped),
		),
		yield* heard(
			`compare --n ${two}`,
			call(compare, {n: two, a: undefined, b: undefined}, {keeping: keeping("compare:170")}).pipe(
				Effect.scoped,
			),
		),
	];
	writeFileSync(
		RESULTS,
		`${JSON.stringify(
			{
				date: new Date().toISOString().slice(0, 10),
				// The names themselves stay on the console: they are keys copied from old files.
				counts: {
					...old.counts,
					costNames: Object.keys(old.counts.costNames).length,
					tokenNames: Object.keys(old.counts.tokenNames).length,
				},
				ledgerRows: rows.length,
				listed: listed.length,
				runs: old.runs.length,
				twoRunsOrMore: many.length,
				lastTwoShareAMetric: sharing.length,
				ms: {transform: transformMs, load: loadMs},
				programs,
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(`\nwrote ${RESULTS.pathname.split("/experiments/")[1]}`);
});

await Effect.runPromise(main.pipe(Effect.provide(services)));
