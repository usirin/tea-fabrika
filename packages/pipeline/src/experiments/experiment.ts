import {type Row, TraceId, Writer, writerOf} from "@kampus/fabrika";
import {Equal, Option, Schema} from "effect";
import {Title} from "../tickets/ticket.ts";

// An experiment: one stream of facts on the ledger, with its own fold, apart from the tracker's
// (docs/direction/experiments-behind-a-service.md). Experiment 170 is the registered name
// `experiments/170`, and its facts are the messages in that name's inbox, oldest first. The words
// are MLflow's (experiment, run, params, metrics, tags, artifacts) and Langfuse's (item, score):
//
//   experiments/170/inbox   {type: "created", title: "The experiments program"}
//                           {type: "written", date: "2026-10-30", answer: "...", headline: null, sections: [...]}
//                           {type: "started", key: "job-7f3a", params: {model: "jev"}, tags: {}, job: null}   run 170-1: the first start
//                           {type: "logged", run: "170-1", what: {kind: "case", item: "ticket-41", output: "yes", scores: {agreed: 1}}}
//                           {type: "logged", run: "170-1", what: {kind: "metric", key: "agreed", value: 0.9}}
//                           {type: "ended", run: "170-1", status: "finished", usd: 0.04, tokens: {input: 9000, output: 300}}
//
//   fold(entries).experiments[0].runs[0]
//   // {run: "170-1", status: "finished", metrics: {agreed: 0.9}, usd: 0.04, ...}
//
// This file is pure: ./experiments.ts reads and writes the ledger.

/** An experiment's number, as its write-up spells it: `01`, `104c`, `170`. */
export const ExperimentId = Schema.String.check(Schema.isPattern(/^\d{2,3}[a-z]?$/));
export type ExperimentId = typeof ExperimentId.Type;

/** A run's id: its experiment and its place among that experiment's runs, `170-1`. */
export const RunId = Schema.String.check(Schema.isPattern(/^\d{2,3}[a-z]?-[1-9]\d*$/));
export type RunId = typeof RunId.Type;

/** A metric's or a score's name, in MLflow's rule: letters, digits, `_ - . / :` and spaces. */
export const Key = Schema.String.check(Schema.isPattern(/^[\w.\-/: ]{1,250}$/));

/** A case's name: one line, such as `ticket-41` or `pr-44`. */
export const Item = Schema.String.check(
	Schema.isNonEmpty(),
	Schema.isMaxLength(256),
	Schema.isPattern(/^[^\r\n]*$/),
);

/** A day, as the write-ups date them: `2026-10-30`. */
export const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Usd = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/** A run's settings: model, effort, prompt version, case set. Any JSON value each. */
export const Params = Schema.Record(Schema.String, Schema.Unknown);
/** A run's labels, MLflow's tags: text each, such as `{source: "results/167-duplicate-hint.json"}`. */
export const Tags = Schema.Record(Schema.String, Schema.String);
/** Numbers by name: a run's metrics, or one case's scores. */
export const Metrics = Schema.Record(Key, Schema.Finite);
export type Metrics = typeof Metrics.Type;

/** Tokens, one name each way, never six. */
export const Tokens = Schema.Struct({input: Count, output: Count});

/** A file a run left. A path in the repository for now: there is no `Blobs` to hold it by hash. */
export const Artifact = Schema.Struct({path: Schema.String.check(Schema.isNonEmpty())});

/** MLflow's run states, in its words. */
export const RunStatus = Schema.Literals(["running", "finished", "failed", "killed"]);

/** One part of a write-up: its heading and its text, as markdown. */
export const Section = Schema.Struct({heading: Schema.String, text: Schema.String});

/**
 * The write-up as data: its day, its answer (given first, as AGENTS.md asks), the metric its list
 * shows, and its sections. The prose of a section stays markdown: it is written for people.
 */
export const WriteUp = Schema.Struct({
	date: Schema.NullOr(Day),
	answer: Schema.String,
	headline: Schema.NullOr(Key),
	sections: Schema.Array(Section),
});
export type WriteUp = typeof WriteUp.Type;

/**
 * The caller's name for one run, one line: the same key on the same experiment is the same run,
 * however often it is started. A job's trace id, an import's `import/<results file>`, or an id
 * a person's start makes once, before its first try, and keeps for its retries.
 */
export const RunKey = Schema.String.check(
	Schema.isNonEmpty(),
	Schema.isMaxLength(256),
	Schema.isPattern(/^[^\r\n]*$/),
);

/**
 * What a run starts with: its key, its settings, and `job`, the trace id of the job it runs in,
 * when a host runs it. The key is not optional, so a start that could not be sent again safely
 * does not type.
 */
export const RunPlan = Schema.Struct({
	key: RunKey,
	params: Params,
	tags: Tags,
	job: Schema.NullOr(TraceId),
});
export type RunPlan = typeof RunPlan.Type;

/** One thing a run logs: a metric, one case's result with its scores, or a file. */
export const RunLog = Schema.Union([
	Schema.Struct({kind: Schema.Literal("metric"), key: Key, value: Schema.Finite}),
	Schema.Struct({
		kind: Schema.Literal("case"),
		item: Item,
		output: Schema.Unknown,
		scores: Metrics,
	}),
	Schema.Struct({kind: Schema.Literal("artifact"), ...Artifact.fields}),
]);
export type RunLog = typeof RunLog.Type;

/** How a run ends, and what it cost. `null`: nobody measured it. */
export const RunEnd = Schema.Struct({
	status: Schema.Literals(["finished", "failed", "killed"]),
	usd: Schema.NullOr(Usd),
	tokens: Schema.NullOr(Tokens),
});
export type RunEnd = typeof RunEnd.Type;

/** What happened to an experiment. The first fact is `created`, and only the first. */
export const Fact = Schema.Union([
	Schema.Struct({type: Schema.Literal("created"), title: Title}),
	Schema.Struct({type: Schema.Literal("written"), ...WriteUp.fields}),
	// No run id: the fold numbers a run by its place among the experiment's starts (see `step`).
	Schema.Struct({type: Schema.Literal("started"), ...RunPlan.fields}),
	Schema.Struct({type: Schema.Literal("logged"), run: RunId, what: RunLog}),
	Schema.Struct({type: Schema.Literal("ended"), run: RunId, ...RunEnd.fields}),
]);
export type Fact = typeof Fact.Type;

/** One run's record: what `field/runs.jsonl` holds by hand today, as one shape. */
export class RunRecord extends Schema.Opaque<RunRecord>()(
	Schema.Struct({
		run: RunId,
		experiment: ExperimentId,
		/** The caller's name for it: started again with this key, it is this run. */
		key: RunKey,
		/** When it started, by the ledger's clock. */
		at: Schema.Finite,
		status: RunStatus,
		params: Params,
		tags: Tags,
		metrics: Metrics,
		usd: Schema.NullOr(Usd),
		tokens: Schema.NullOr(Tokens),
		artifacts: Schema.Array(Artifact),
		job: Schema.NullOr(TraceId),
		/** When it ended, by the ledger's clock. `null`: still running. */
		ended: Schema.NullOr(Schema.Finite),
	}),
) {
	/**
	 * The one number a list shows for a run: the metric the write-up names, else the first one
	 * logged. `null`: the run logged none.
	 *
	 *   RunRecord.headline({...run, metrics: {agreed: 0.9, ms: 840}}, "ms")   {key: "ms", value: 840}
	 *   RunRecord.headline({...run, metrics: {agreed: 0.9, ms: 840}}, null)   {key: "agreed", value: 0.9}
	 */
	static headline(
		run: RunRecord,
		key: string | null,
	): {readonly key: string; readonly value: number} | null {
		const named = key === null ? undefined : run.metrics[key];
		if (key !== null && named !== undefined) return {key, value: named};
		const first = Object.entries(run.metrics)[0];
		return first === undefined ? null : {key: first[0], value: first[1]};
	}

	/**
	 * Whether the run started with this plan: the same key, params, tags and job, in any key order.
	 * `plan` as the ledger keeps it, through JSON, so a field set to `undefined` is no field.
	 */
	static startedWith(run: RunRecord, plan: RunPlan): boolean {
		return (
			run.key === plan.key &&
			Equal.equals(run.params, plan.params) &&
			Equal.equals(run.tags, plan.tags) &&
			run.job === plan.job
		);
	}

	/** Whether the run ended this way: the same status, dollars and tokens. */
	static endedWith(run: RunRecord, how: RunEnd): boolean {
		return run.status === how.status && run.usd === how.usd && Equal.equals(run.tokens, how.tokens);
	}
}

/** One case's result in a run: Langfuse's dataset run item, with its scores. */
export const CaseResult = Schema.Struct({
	run: RunId,
	item: Item,
	output: Schema.Unknown,
	scores: Metrics,
});
export type CaseResult = typeof CaseResult.Type;

/** A run as a list shows it: when, how it stands, and its headline metric. */
export const Latest = Schema.Struct({
	run: RunId,
	at: Schema.Finite,
	status: RunStatus,
	headline: Schema.NullOr(Schema.Struct({key: Key, value: Schema.Finite})),
});

/** One row of the list: the number, the title, how many runs, and the latest one. */
export class Experiment extends Schema.Opaque<Experiment>()(
	Schema.Struct({
		n: ExperimentId,
		title: Title,
		date: Schema.NullOr(Day),
		runs: Count,
		latest: Schema.NullOr(Latest),
	}),
) {
	/** The row for one experiment's page. */
	static fromPage(page: ExperimentPage): Experiment {
		const last = page.runs.at(-1);
		return {
			n: page.n,
			title: page.title,
			date: page.writeUp?.date ?? null,
			runs: page.runs.length,
			latest:
				last === undefined
					? null
					: {
							run: last.run,
							at: last.at,
							status: last.status,
							headline: RunRecord.headline(last, page.writeUp?.headline ?? null),
						},
		};
	}

	/**
	 * The list as a markdown table, a view made from the rows, never read back.
	 *
	 *   | # | Title | Date | Runs | Latest |
	 *   | 170 | The experiments program | 2026-10-30 | 1 | 170-1 finished, agreed 0.9 |
	 */
	static toMarkdown(rows: readonly Experiment[]): string {
		const line = (r: Experiment) => {
			const latest =
				r.latest === null
					? ""
					: `${r.latest.run} ${r.latest.status}${r.latest.headline === null ? "" : `, ${r.latest.headline.key} ${r.latest.headline.value}`}`;
			return `| ${r.n} | ${cell(r.title)} | ${r.date ?? ""} | ${r.runs} | ${cell(latest)} |`;
		};
		return [
			"# Experiments",
			"",
			"| # | Title | Date | Runs | Latest |",
			"|---|---|---|---|---|",
			...rows.map(line),
			"",
		].join("\n");
	}
}

/** One experiment: its title, its write-up as data, and its runs, oldest first. */
export class ExperimentPage extends Schema.Opaque<ExperimentPage>()(
	Schema.Struct({
		n: ExperimentId,
		title: Title,
		writeUp: Schema.NullOr(WriteUp),
		runs: Schema.Array(RunRecord),
	}),
) {
	/**
	 * The page as markdown: the write-up's answer first, its sections, then a table of its runs.
	 * A view made from the data, never read back (docs/direction/data-first-markdown-is-a-view.md).
	 */
	static toMarkdown(page: ExperimentPage): string {
		const w = page.writeUp;
		const head = [`# ${page.n}: ${page.title}`, ""];
		const written =
			w === null
				? ["Nothing written yet.", ""]
				: [
						...(w.date === null ? [] : [`Date: ${w.date}`, ""]),
						...(w.answer === "" ? [] : [`**Answer.** ${w.answer}`, ""]),
						...w.sections.flatMap((s) => [
							...(s.heading === "" ? [] : [`## ${s.heading}`, ""]),
							s.text,
							"",
						]),
					];
		const runs =
			page.runs.length === 0
				? []
				: [
						"## Runs",
						"",
						"| Run | Status | Dollars | Metrics |",
						"|---|---|---|---|",
						...page.runs.map(
							(r) =>
								`| ${r.run} | ${r.status} | ${r.usd ?? ""} | ${cell(
									Object.entries(r.metrics)
										.map(([k, v]) => `${k} ${v}`)
										.join(", "),
								)} |`,
						),
						"",
					];
		return [...head, ...written, ...runs].join("\n");
	}
}

/** One metric in two runs. `null`: that run did not log it. */
export const MetricChange = Schema.Struct({
	key: Key,
	a: Schema.NullOr(Schema.Finite),
	b: Schema.NullOr(Schema.Finite),
});

/** One case whose scores are not the same in the two runs. `null`: that run has no such case. */
export const CaseChange = Schema.Struct({
	item: Item,
	a: Schema.NullOr(Metrics),
	b: Schema.NullOr(Metrics),
});

const sameScores = (a: Metrics, b: Metrics): boolean => {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys].every((k) => a[k] === b[k]);
};

/** Two runs side by side: every metric, then the cases whose scores changed. */
export class Comparison extends Schema.Opaque<Comparison>()(
	Schema.Struct({
		a: RunId,
		b: RunId,
		metrics: Schema.Array(MetricChange),
		cases: Schema.Array(CaseChange),
		/** How many cases scored the same in both. */
		same: Count,
	}),
) {
	/**
	 * Compare run `a` with run `b`: metrics in the order `a` logged them, then any only `b` has;
	 * dollars as one more row when either run counted them; cases in `a`'s order, then `b`'s new ones.
	 *
	 *   Comparison.fromRuns(r1, r2, [{item: "t-1", scores: {agreed: 1}}], [{item: "t-1", scores: {agreed: 0}}])
	 *   // {metrics: [{key: "agreed", a: 1, b: 0}], cases: [{item: "t-1", a: {agreed: 1}, b: {agreed: 0}}], same: 0}
	 */
	static fromRuns(
		a: RunRecord,
		b: RunRecord,
		aCases: readonly CaseResult[],
		bCases: readonly CaseResult[],
	): Comparison {
		const keys = [...new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)])];
		const metrics = keys.map((key) => ({
			key,
			a: a.metrics[key] ?? null,
			b: b.metrics[key] ?? null,
		}));
		const money = a.usd !== null || b.usd !== null ? [{key: "usd", a: a.usd, b: b.usd}] : [];
		const byItem = (cases: readonly CaseResult[]) => new Map(cases.map((c) => [c.item, c.scores]));
		const inA = byItem(aCases);
		const inB = byItem(bCases);
		const items = [...new Set([...inA.keys(), ...inB.keys()])];
		const cases = items.flatMap((item) => {
			const sa = inA.get(item) ?? null;
			const sb = inB.get(item) ?? null;
			return sa !== null && sb !== null && sameScores(sa, sb) ? [] : [{item, a: sa, b: sb}];
		});
		return {
			a: a.run,
			b: b.run,
			metrics: [...metrics, ...money],
			cases,
			same: items.length - cases.length,
		};
	}

	/** The comparison as markdown: a table of metrics, then a table of the cases that changed. */
	static toMarkdown(c: Comparison): string {
		const num = (v: number | null) => (v === null ? "" : String(v));
		const scores = (s: Metrics | null) =>
			s === null
				? "none"
				: Object.entries(s)
						.map(([k, v]) => `${k} ${v}`)
						.join(", ");
		return [
			`# ${c.a} against ${c.b}`,
			"",
			`| Metric | ${c.a} | ${c.b} |`,
			"|---|---|---|",
			...c.metrics.map((m) => `| ${m.key} | ${num(m.a)} | ${num(m.b)} |`),
			"",
			`## Cases that changed: ${c.cases.length}, ${c.same} the same`,
			"",
			...(c.cases.length === 0
				? []
				: [
						`| Case | ${c.a} | ${c.b} |`,
						"|---|---|---|",
						...c.cases.map((k) => `| ${cell(k.item)} | ${scores(k.a)} | ${scores(k.b)} |`),
						"",
					]),
		].join("\n");
	}
}

/** Text for one table cell: a `|` would end the cell, so it is escaped. */
const cell = (text: string) => text.replaceAll("|", "\\|");

// ---------------------------------------------------------------- reading the ledger

/** The name every experiment's streams are under, as the ledger reads a prefix. */
export const ROOT = "experiments";

/** Experiment `n`'s registered name. Its facts go to the name's inbox. */
export const experimentName = (n: ExperimentId) => `${ROOT}/${n}`;

/** The experiment a run id belongs to: `170` of `170-3`. */
export const experimentFor = (run: RunId): ExperimentId => run.slice(0, run.lastIndexOf("-"));

const INBOX = /^experiments\/(\d{2,3}[a-z]?)\/inbox$/;
const decodeFact = Schema.decodeUnknownOption(Schema.fromJsonString(Fact));

/** One fact read back: on which experiment, who wrote it, when, and where the ledger put it. */
export const Entry = Schema.Struct({
	pos: Schema.Int,
	experiment: ExperimentId,
	by: Writer,
	at: Schema.Finite,
	fact: Fact,
});
export type Entry = typeof Entry.Type;

/** What one ledger row is to an experiment: a fact, a row of no experiment's facts, or broken. */
export type Read =
	| {readonly kind: "entry"; readonly entry: Entry}
	| {readonly kind: "other"}
	| {readonly kind: "broken"; readonly why: string};

/** Read one row. A row in an experiment's inbox must hold a fact, by a user or an agent. */
export function readRow(row: Row): Read {
	const experiment = INBOX.exec(row.stream)?.[1];
	if (experiment === undefined) return {kind: "other"};
	const broken = (why: string): Read => ({
		kind: "broken",
		why: `row ${row.pos} on ${experiment}: ${why}`,
	});
	const by = writerOf(row.writer);
	if (by === null) return broken(`its writer "${row.writer}" is neither a user nor an agent`);
	const fact = Option.getOrNull(decodeFact(row.data));
	if (fact === null) return broken("its data is not a fact");
	if (fact.type !== row.kind) return broken(`a ${fact.type} fact kept as ${row.kind}`);
	return {kind: "entry", entry: {pos: row.pos, experiment, by, at: row.at, fact}};
}

/** An experiment as the fold keeps it: its page, and every case result of every run. */
export interface Kept {
	readonly page: ExperimentPage;
	readonly cases: readonly CaseResult[];
}

/** The experiments with the entries folded in, by number, and what did not fit, in words. */
export interface Folded {
	readonly experiments: readonly Kept[];
	readonly problems: readonly string[];
}

/** Why a run fact does not fit the runs before it, or `null` when it fits. */
const misfit = (kept: Kept, fact: Fact): string | null => {
	if (fact.type === "created" || fact.type === "written") return null;
	if (fact.type === "started")
		return kept.page.runs.some((r) => r.key === fact.key)
			? `run key ${fact.key} started a second time`
			: null;
	const run = kept.page.runs.find((r) => r.run === fact.run);
	if (run === undefined) return `run ${fact.run} ${fact.type}, but it never started`;
	if (run.status !== "running") return `run ${fact.run} ${fact.type} after it ended`;
	if (fact.type === "ended") return null;
	const {what} = fact;
	if (what.kind === "metric" && what.key in run.metrics)
		return `run ${fact.run} logged ${what.key} a second time`;
	if (what.kind === "case" && kept.cases.some((c) => c.run === fact.run && c.item === what.item))
		return `run ${fact.run} logged case ${what.item} a second time`;
	return null;
};

/**
 * Whether the run holds this log already, by the name its message id is made of: the metric's
 * key, the case's item, the file's path. What it holds under that name stands, as the ledger's
 * `dup` keeps the first.
 */
export const holds = (kept: Kept, run: RunRecord, log: RunLog): boolean => {
	switch (log.kind) {
		case "metric":
			return log.key in run.metrics;
		case "case":
			return kept.cases.some((c) => c.run === run.run && c.item === log.item);
		case "artifact":
			return run.artifacts.some((a) => a.path === log.path);
	}
};

const withRun = (kept: Kept, run: RunId, change: (r: RunRecord) => RunRecord): Kept => ({
	...kept,
	page: {...kept.page, runs: kept.page.runs.map((r) => (r.run === run ? change(r) : r))},
});

/** One entry onto its experiment: the experiment after it, or why it does not fit. */
const step = (kept: Kept | undefined, entry: Entry): Kept | string => {
	const {fact} = entry;
	const where = `row ${entry.pos} on ${entry.experiment}`;
	if (fact.type === "created")
		return kept === undefined
			? {page: {n: entry.experiment, title: fact.title, writeUp: null, runs: []}, cases: []}
			: `${where}: created a second time`;
	if (kept === undefined) return `${where}: ${fact.type}, but the experiment was never created`;
	const wrong = misfit(kept, fact);
	if (wrong !== null) return `${where}: ${wrong}`;
	switch (fact.type) {
		case "written": {
			// The newest write-up is the one that counts, as a new version of a document does.
			const {type: _, ...writeUp} = fact;
			return {...kept, page: {...kept.page, writeUp}};
		}
		case "started": {
			// A run's number is its place among the experiment's starts that fit, in the ledger's
			// order: the third start is `170-3`. The start's message id is its key, so a start sent
			// again is the ledger's `dup` and takes no number; two keys sent at once both land, and
			// the ledger's order numbers them. Nobody picks a number, so two starts cannot pick the
			// same one. The cost: a run's id is known only once its start has landed and been read.
			const run: RunRecord = {
				run: `${entry.experiment}-${kept.page.runs.length + 1}`,
				experiment: entry.experiment,
				key: fact.key,
				at: entry.at,
				status: "running",
				params: fact.params,
				tags: fact.tags,
				metrics: {},
				usd: null,
				tokens: null,
				artifacts: [],
				job: fact.job,
				ended: null,
			};
			return {...kept, page: {...kept.page, runs: [...kept.page.runs, run]}};
		}
		case "ended":
			return withRun(kept, fact.run, (r) => ({
				...r,
				status: fact.status,
				usd: fact.usd,
				tokens: fact.tokens,
				ended: entry.at,
			}));
		case "logged": {
			const {what} = fact;
			switch (what.kind) {
				case "metric":
					return withRun(kept, fact.run, (r) => ({
						...r,
						metrics: {...r.metrics, [what.key]: what.value},
					}));
				case "artifact":
					return withRun(kept, fact.run, (r) => ({
						...r,
						artifacts: [...r.artifacts, {path: what.path}],
					}));
				case "case":
					return {
						...kept,
						cases: [
							...kept.cases,
							{run: fact.run, item: what.item, output: what.output, scores: what.scores},
						],
					};
			}
		}
	}
};

/** Experiment numbers in the order the log counts them: 01, 02, ..., 104, 104c, 105. */
export const byNumber = (a: string, b: string): number =>
	Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b);

/** Fold entries, in the ledger's order, onto the experiments folded so far. */
export function fold(entries: readonly Entry[], from: readonly Kept[] = []): Folded {
	const kept = new Map(from.map((k) => [k.page.n, k]));
	const problems: string[] = [];
	for (const entry of entries) {
		const next = step(kept.get(entry.experiment), entry);
		if (typeof next === "string") problems.push(next);
		else kept.set(entry.experiment, next);
	}
	return {
		experiments: [...kept.values()].sort((a, b) => byNumber(a.page.n, b.page.n)),
		problems,
	};
}
