import {Effect, Option, Schema} from "effect";
import {Title} from "../tickets/ticket.ts";
import {
	byNumber,
	type ExperimentId,
	Key,
	type Metrics,
	type RunEnd,
	type RunLog,
	type RunPlan,
	type WriteUp,
} from "./experiment.ts";
import {Experiments} from "./experiments.ts";

// The old experiment log, read into experiment facts: extract and transform here, from files a
// caller has read, and load through the `Experiments` service. Read-only on the files; nothing
// here touches the disk.
//
//   const old = transform({index: readme, writeUps: [{name: "167-duplicate-hint.md", text}],
//     results: [{name: "167-duplicate-hint.json", text}]});
//   old.counts.fit                            // results files that gave a run record
//   yield* load(old)                          // into whatever ledger `Experiments` is on
//
// The rules, each a guess about old files written by hand, counted so the guesses can be checked:
//
//   a write-up       `NN-title.md`; its title is its `# NN. Title` line; its sections are its
//                    `## ` parts; its day is its row in the README's table; its answer is its
//                    own opening `**Answer.**` paragraph, taken out of its first part so a page
//                    shows it once, else its row's answer
//   a results file   its experiment is the number its name starts with, when that experiment has
//                    a write-up; else the README row that names the file; else that number; else
//                    the lowest-numbered script whose text names the file; else none
//   a run record     the file's numbers reached through objects alone are its metrics (`a/b/c`);
//                    its first list of objects is its cases, one per object, with that object's
//                    numbers as scores; it fits when it has a metric or a scored case
//   dollars          the metric nearest the top whose name says cost (usd, dollars, cost, spend,
//                    price, or exactly spend or spent); tokens, the `input` and `output` under
//                    a `tokens` object

/** One file, as a caller read it: its name in its folder, and its text. */
export interface File {
	readonly name: string;
	readonly text: string;
}

/** What one import counts, so each rule above can be checked against the files. */
export const Counts = Schema.Struct({
	writeUps: Schema.Int,
	experiments: Schema.Int,
	/** Write-ups that share a number with an earlier one: kept out, the first stands. */
	sharedNumbers: Schema.Int,
	inIndex: Schema.Int,
	withDate: Schema.Int,
	withAnswer: Schema.Int,
	/** Titles that did not fit one line of 256 characters, so the file's name was used. */
	titleFromName: Schema.Int,
	results: Schema.Int,
	notJson: Schema.Int,
	/** Results whose name starts with an experiment's number. */
	numbered: Schema.Int,
	/** Results whose name starts with no number at all. */
	noNumber: Schema.Int,
	/** Of those, the ones a README row names. */
	placedByIndex: Schema.Int,
	/** Of the rest, the ones a numbered script names: they go to the lowest such number. */
	placedByScript: Schema.Int,
	/** Of those, the ones more than one script names, so the pick is a guess. */
	manyScripts: Schema.Int,
	/** Results tied to no experiment: kept out. */
	unplaced: Schema.Int,
	/** Results tied to an experiment with no write-up. */
	noWriteUp: Schema.Int,
	/** Results that gave a run record: a metric, or a case with a score. */
	fit: Schema.Int,
	/** Results with no number in them anywhere. */
	noNumbers: Schema.Int,
	withCases: Schema.Int,
	withUsd: Schema.Int,
	withTokens: Schema.Int,
	metrics: Schema.Int,
	cases: Schema.Int,
	/** Metrics past the cap of a run, kept out. */
	metricsCut: Schema.Int,
	/** The names a cost is saved under, and in how many files each. */
	costNames: Schema.Record(Schema.String, Schema.Int),
	/** The names a token count is saved under, and in how many files each. */
	tokenNames: Schema.Record(Schema.String, Schema.Int),
});
export type Counts = typeof Counts.Type;

/** One run to load: its experiment, how it started, what it logged, how it ended. */
interface Run {
	readonly n: ExperimentId;
	readonly plan: RunPlan;
	readonly logs: readonly RunLog[];
	readonly end: RunEnd;
}

/** One experiment to load: its number, title and write-up. */
interface Old {
	readonly n: ExperimentId;
	readonly title: string;
	readonly writeUp: WriteUp | null;
}

/** The most metrics one run keeps: a results file can hold thousands of numbers. */
const METRICS = 200;
/** How deep through objects a metric is looked for. */
const DEPTH = 4;
/** How deep through objects the list of cases is looked for. */
const CASE_DEPTH = 2;

const WRITE_UP = /^(\d{2,3}[a-z]?)-.+\.md$/;
const NUMBERED = /^(\d{2,3}[a-z]?)[-.]/;
const COST = /usd|dollar|cost|^spen[dt]$|price/i;
const TOKEN = /token/i;
const fitsTitle = Schema.is(Title);
const fitsKey = Schema.is(Key);
const readJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

type Json = null | boolean | number | string | readonly Json[] | {readonly [k: string]: Json};
const isObject = (v: Json): v is {readonly [k: string]: Json} =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** A table row's cells, split on the `|` that are not escaped. */
const cells = (line: string): string[] =>
	line
		.slice(1, line.endsWith("|") ? -1 : undefined)
		.split(/(?<!\\)\|/)
		.map((c) => c.trim());

/** The README's table: by experiment number, its day, its answer, and the results files it names. */
const indexRows = (index: string) => {
	const rows = new Map<string, {date: string | null; answer: string; results: string[]}>();
	for (const line of index.split("\n")) {
		if (!/^\| *\d{2,3}[a-z]? *\|/.test(line)) continue;
		const [n = "", , scripts = "", date = "", answer = ""] = cells(line);
		const named = [...scripts.matchAll(/results\/([^`\s,)]+)/g)].map((m) => m[1] ?? "");
		rows.set(n, {
			date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
			answer: answer.replaceAll("\\|", "|"),
			results: named,
		});
	}
	return rows;
};

/** A write-up's title and sections, from its text. */
const readWriteUp = (name: string, text: string) => {
	const lines = text.split("\n");
	const first = lines.findIndex((l) => l.startsWith("# "));
	const heading = (first < 0 ? "" : (lines[first] ?? ""))
		.replace(/^#\s+/, "")
		.replace(/^\d{1,3}[a-z]?[.:]\s*/, "")
		.trim();
	const sections: {heading: string; text: string}[] = [];
	let current = {heading: "", lines: [] as string[]};
	for (const line of lines.slice(first + 1)) {
		const h = /^## (.*)$/.exec(line);
		if (h === null) {
			current.lines.push(line);
			continue;
		}
		sections.push({heading: current.heading, text: current.lines.join("\n").trim()});
		current = {heading: (h[1] ?? "").trim(), lines: []};
	}
	sections.push({heading: current.heading, text: current.lines.join("\n").trim()});
	const fromName = name.replace(/\.md$/, "").replace(/^[^-]+-/, "");
	// The write-up's own answer: the `**Answer.**` paragraph that opens it, taken out of the lead
	// section, so a page shows it once.
	const lead = sections[0];
	const own = lead?.heading === "" ? ANSWER.exec(lead.text) : null;
	if (lead !== undefined && own !== null)
		sections[0] = {heading: "", text: lead.text.slice(own[0].length).trim()};
	return {
		title: fitsTitle(heading) ? heading : fromName.replaceAll("-", " "),
		titled: fitsTitle(heading),
		answer: own === null ? null : (own[1] ?? "").replace(/\s*\n\s*/g, " ").trim(),
		sections: sections.filter((s) => s.heading !== "" || s.text !== ""),
	};
};

/** A write-up's opening answer paragraph, up to its first blank line. */
const ANSWER = /^\*\*Answer\.\*\*\s*([\s\S]*?)(?:\n\s*\n|$)/;

/** A metric's name from its path: a part MLflow does not take becomes `_`. */
const keyFrom = (path: readonly string[]): string | null => {
	const key = path.map((p) => p.replace(/[^\w.\-: ]/g, "_")).join("/");
	return fitsKey(key) ? key : null;
};

/** Every number reached through objects alone, by path, nearest the top first. */
const numbers = (value: Json, depth: number): [string[], number][] => {
	const found: [string[], number][] = [];
	let level: [string[], Json][] = [[[], value]];
	for (let d = 0; d <= depth && level.length > 0; d++) {
		const next: [string[], Json][] = [];
		for (const [path, v] of level) {
			if (typeof v === "number" && Number.isFinite(v) && path.length > 0) found.push([path, v]);
			if (isObject(v)) for (const [k, child] of Object.entries(v)) next.push([[...path, k], child]);
		}
		level = next;
	}
	return found;
};

/** Whether a value holds a number anywhere, lists too. */
const anyNumber = (value: Json): boolean =>
	typeof value === "number" ||
	(Array.isArray(value)
		? value.some(anyNumber)
		: isObject(value) && Object.values(value).some(anyNumber));

/** Every key name in a value whose value is a number and whose name matches, lists too. */
const namesMatching = (value: Json, test: RegExp, into: Set<string>): void => {
	if (Array.isArray(value)) for (const v of value) namesMatching(v, test, into);
	if (!isObject(value)) return;
	for (const [k, v] of Object.entries(value)) {
		if (typeof v === "number" && test.test(k)) into.add(k);
		namesMatching(v, test, into);
	}
};

/** The first list of objects, through objects alone: the file's cases. */
const caseList = (value: Json): readonly {readonly [k: string]: Json}[] | null => {
	let level: Json[] = [value];
	for (let d = 0; d <= CASE_DEPTH && level.length > 0; d++) {
		const next: Json[] = [];
		for (const v of level) {
			if (Array.isArray(v) && v.length > 0 && v.every(isObject)) return v;
			if (isObject(v)) next.push(...Object.values(v));
		}
		level = next;
	}
	return null;
};

/** One object's name as a case: its first field that names it, else its place in the list. */
const NAMES = ["key", "id", "item", "case", "ticket", "pr", "name", "n"] as const;
const itemName = (o: {readonly [k: string]: Json}, i: number): string => {
	for (const k of NAMES) {
		const v = o[k];
		if (
			(typeof v === "string" && v !== "" && !/[\r\n]/.test(v) && v.length <= 200) ||
			typeof v === "number"
		)
			return String(v);
	}
	return `#${i + 1}`;
};

/** A results file as a run: its metrics, cases, dollars and tokens, or what it lacked. */
const readResult = (json: Json) => {
	const found = numbers(json, DEPTH);
	const metrics: Record<string, number> = {};
	let cut = 0;
	for (const [path, v] of found) {
		const key = keyFrom(path);
		if (key === null || key in metrics) continue;
		if (Object.keys(metrics).length >= METRICS) cut++;
		else metrics[key] = v;
	}
	const list = caseList(json) ?? [];
	const seen = new Set<string>();
	const cases = list.flatMap((o, i) => {
		const scores: Metrics = Object.fromEntries(
			numbers(o, 2).flatMap(([p, v]) => {
				const key = keyFrom(p);
				return key === null ? [] : [[key, v]];
			}),
		);
		if (Object.keys(scores).length === 0) return [];
		const base = itemName(o, i);
		const item = seen.has(base) ? `${base}#${i + 1}` : base;
		seen.add(item);
		return [{kind: "case" as const, item, output: o, scores}];
	});
	const cost = found.find(([p]) => COST.test(p.at(-1) ?? ""));
	const usd = cost !== undefined && cost[1] >= 0 ? cost[1] : null;
	const tokenObject = found.filter(([p]) => TOKEN.test(p.at(-2) ?? ""));
	const input = tokenObject.find(([p]) => p.at(-1) === "input")?.[1];
	const output = tokenObject.find(([p]) => p.at(-1) === "output")?.[1];
	const tokens =
		input !== undefined &&
		output !== undefined &&
		Number.isInteger(input) &&
		Number.isInteger(output) &&
		input >= 0 &&
		output >= 0
			? {input, output}
			: null;
	const params: Record<string, unknown> = isObject(json)
		? Object.fromEntries(
				Object.entries(json).filter(
					([, v]) => typeof v === "boolean" || (typeof v === "string" && v.length <= 200),
				),
			)
		: {};
	return {metrics, cut, cases, usd, tokens, params};
};

/** The old experiment log, read into what `load` writes, and what was counted on the way. */
export interface Import {
	readonly experiments: readonly Old[];
	readonly runs: readonly Run[];
	readonly counts: Counts;
}

/** Read the README's text, the write-ups and the results files into experiments and runs. */
export function transform(files: {
	readonly index: string;
	readonly writeUps: readonly File[];
	readonly results: readonly File[];
	/** The scripts, `NN-name.ts` or `.mjs`: a results file with no number goes to the one that names it. */
	readonly scripts?: readonly File[];
}): Import {
	const index = indexRows(files.index);
	const experiments = new Map<string, Old>();
	let sharedNumbers = 0;
	let titleFromName = 0;
	for (const file of [...files.writeUps].sort((a, b) => a.name.localeCompare(b.name))) {
		const n = WRITE_UP.exec(file.name)?.[1];
		if (n === undefined) continue;
		if (experiments.has(n)) {
			sharedNumbers++;
			continue;
		}
		const read = readWriteUp(file.name, file.text);
		if (!read.titled) titleFromName++;
		const row = index.get(n);
		const date = row?.date ?? /\b(20\d\d-\d\d-\d\d)\b/.exec(file.text)?.[1] ?? null;
		experiments.set(n, {
			n,
			title: read.title,
			writeUp: {
				date,
				answer: read.answer ?? row?.answer ?? "",
				headline: null,
				sections: read.sections,
			},
		});
	}
	const named = new Map<string, string>();
	for (const [n, row] of index) for (const r of row.results) if (!named.has(r)) named.set(r, n);
	/** The numbered scripts that name a results file, lowest number first: its writer, most likely. */
	const scripts = [...(files.scripts ?? [])]
		.flatMap((s) => {
			const n = NUMBERED.exec(s.name)?.[1];
			return n === undefined ? [] : [{n, text: s.text}];
		})
		.sort((a, b) => byNumber(a.n, b.n));
	const writers = (name: string) => [
		...new Set(scripts.filter((s) => s.text.includes(name)).map((s) => s.n)),
	];

	const costNames: Record<string, number> = {};
	const tokenNames: Record<string, number> = {};
	const runs: Run[] = [];
	const c = {
		notJson: 0,
		numbered: 0,
		noNumber: 0,
		placedByIndex: 0,
		placedByScript: 0,
		manyScripts: 0,
		unplaced: 0,
		noWriteUp: 0,
	};
	const r = {
		fit: 0,
		noNumbers: 0,
		withCases: 0,
		withUsd: 0,
		withTokens: 0,
		metrics: 0,
		cases: 0,
		metricsCut: 0,
	};
	for (const file of [...files.results].sort((a, b) => a.name.localeCompare(b.name))) {
		const read = readJson(file.text);
		if (Option.isNone(read)) {
			c.notJson++;
			continue;
		}
		// JSON text decodes to JSON values only.
		const json = read.value as Json;
		const prefix = NUMBERED.exec(file.name)?.[1];
		if (prefix === undefined) c.noNumber++;
		else c.numbered++;
		const byIndex = named.get(file.name);
		const byScript = prefix === undefined && byIndex === undefined ? writers(file.name) : [];
		if (prefix === undefined && byIndex !== undefined) c.placedByIndex++;
		if (byScript.length > 0) c.placedByScript++;
		if (byScript.length > 1) c.manyScripts++;
		const n =
			prefix !== undefined && experiments.has(prefix) ? prefix : (byIndex ?? prefix ?? byScript[0]);
		if (n === undefined) {
			c.unplaced++;
			continue;
		}
		if (!experiments.has(n)) {
			c.noWriteUp++;
			experiments.set(n, {n, title: `Results ${file.name.replace(/\.json$/, "")}`, writeUp: null});
		}
		for (const [names, test] of [
			[costNames, COST],
			[tokenNames, TOKEN],
		] as const) {
			const seen = new Set<string>();
			namesMatching(json, test, seen);
			for (const name of seen) names[name] = (names[name] ?? 0) + 1;
		}
		const result = readResult(json);
		if (!anyNumber(json)) r.noNumbers++;
		const fits = Object.keys(result.metrics).length > 0 || result.cases.length > 0;
		if (!fits) continue;
		r.fit++;
		if (result.cases.length > 0) r.withCases++;
		if (result.usd !== null) r.withUsd++;
		if (result.tokens !== null) r.withTokens++;
		r.metrics += Object.keys(result.metrics).length;
		r.cases += result.cases.length;
		r.metricsCut += result.cut;
		const date = experiments.get(n)?.writeUp?.date;
		const source = `experiments/results/${file.name}`;
		runs.push({
			n,
			plan: {
				// One results file is one run, so its path is the run's key and makes the run's id: a
				// second import finds that run and starts no new one. A file read another way next
				// time has another plan, and is refused.
				key: `import/${source}`,
				params: result.params,
				tags: {source, ...(date ? {date} : {})},
				job: null,
			},
			logs: [
				...Object.entries(result.metrics).map(([key, value]) => ({
					kind: "metric" as const,
					key,
					value,
				})),
				...result.cases,
				{kind: "artifact", path: source},
			],
			end: {status: "finished", usd: result.usd, tokens: result.tokens},
		});
	}
	const old = [...experiments.values()];
	return {
		experiments: old,
		runs,
		counts: {
			writeUps: files.writeUps.filter((f) => WRITE_UP.test(f.name)).length,
			experiments: old.filter((e) => e.writeUp !== null).length,
			sharedNumbers,
			inIndex: old.filter((e) => index.has(e.n)).length,
			withDate: old.filter((e) => e.writeUp?.date != null).length,
			withAnswer: old.filter((e) => (e.writeUp?.answer ?? "") !== "").length,
			titleFromName,
			results: files.results.length,
			...c,
			...r,
			costNames,
			tokenNames,
		},
	};
}

/**
 * Load an import through `Experiments`: each experiment created and written, each run logged.
 * Loaded again, nothing new lands: every write has its message id, and each run its key.
 */
export const load = (old: Import) =>
	Effect.gen(function* () {
		const experiments = yield* Experiments;
		for (const e of old.experiments) {
			yield* experiments.create(e.n, e.title);
			if (e.writeUp !== null) yield* experiments.write(e.n, e.writeUp);
		}
		for (const run of old.runs) {
			const id = yield* experiments.start(run.n, run.plan);
			yield* experiments.log(id, run.logs);
			yield* experiments.end(id, run.end);
		}
	});
