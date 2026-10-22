// Experiment 113's count: what the trios in results/113-focused-review-runs.json say, by the reading
// rule in ../113-focused-review-runs.md, written before any counted run. It reads 112b's opus runs
// and 112's sonnet runs to compare against. No agent runs here.
//
//   node experiments/113-focused-review-runs/count.ts          the count, kept under `count`
//   SHOW=1 node experiments/113-focused-review-runs/count.ts   print what is to be read by hand
//
// The hand-read classes are kept below (`READ`), by key, after reading each against the code at
// its pair's head.
//
// Node at the edge: the results files are read and written with readFileSync and writeFileSync.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {Found, Grade, Ran} from "../112-reviewer-noise/pairs.ts";
import {COUNTED, type FocusedRan, type FocusId} from "./focuses.ts";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = process.env.FROM ?? at("../results/113-focused-review-runs.json");
const results = JSON.parse(readFileSync(RESULTS, "utf8")) as {runs: FocusedRan[]; count?: unknown};
const opus = (
	JSON.parse(readFileSync(at("../results/112b-opus-reviewer.json"), "utf8")) as {runs: Ran[]}
).runs.filter((r) => COUNTED.includes(r.pair));
const sonnet = (
	JSON.parse(readFileSync(at("../results/112-reviewer-noise.json"), "utf8")) as {runs: Ran[]}
).runs.filter((r) => COUNTED.includes(r.pair) && r.model.includes("sonnet"));

const KINDS = ["task", "last"] as const;
const FOCUS_IDS: readonly FocusId[] = ["A", "B", "C"];
const GROUPS = COUNTED.flatMap((pair) => KINDS.map((as) => ({pair, as})));
const pct = (a: number, b: number) => (b === 0 ? null : Math.round((1000 * a) / b) / 10);
const mean = (xs: readonly number[]) =>
	xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (x: number | null, d = 3) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const cellKey = (pair: string, as: string, id: string) => `${pair}|${as}|${id}`;

/** 112's fixed draw: the same small linear congruential generator and seed. */
const draw = <A>(xs: readonly A[], n: number, seed = 112): A[] => {
	let s = seed;
	const next = () => {
		s = (s * 1103515245 + 12345) % 2 ** 31;
		return s / 2 ** 31;
	};
	const pool = [...xs];
	const out: A[] = [];
	while (out.length < n && pool.length > 0)
		out.push(...pool.splice(Math.floor(next() * pool.length), 1));
	return out;
};

// ---------------------------------------------------------------- what 112b already says

/** Each cell's grades across a set of runs of one group, in run order. */
const gradesOf = (runs: readonly Ran[], pair: string, as: string) => {
	const group = runs.filter((r) => r.pair === pair && r.as === as).sort((a, b) => a.k - b.k);
	const ids = [...new Set(group.flatMap((r) => Object.keys(r.grades)))];
	return new Map(ids.map((id) => [id, group.map((r) => r.grades[id] ?? ("none" as Grade))]));
};
const opusCells = new Map(
	GROUPS.flatMap(({pair, as}) =>
		[...gradesOf(opus, pair, as)].map(([id, g]) => [cellKey(pair, as, id), g] as const),
	),
);
/** The 21 known defects: cells opus went between pass and fail on in 112b. */
const KNOWN = new Set(
	[...opusCells].filter(([, g]) => g.includes("pass") && g.includes("fail")).map(([k]) => k),
);
/** The steady fails: cells opus failed in all 5 runs in 112b. */
const STEADY = new Set(
	[...opusCells].filter(([, g]) => g.every((x) => x === "fail")).map(([k]) => k),
);

// ---------------------------------------------------------------- the trios

const runOf = (pair: string, as: string, k: number, focus: FocusId) =>
	results.runs.find((r) => r.pair === pair && r.as === as && r.k === k && r.focus === focus);
const trioOf = (pair: string, as: string, k: number) =>
	FOCUS_IDS.map((f) => runOf(pair, as, k, f)).filter((r) => r !== undefined);
const TRIOS = [...new Set(results.runs.map((r) => r.k))].sort((a, b) => a - b);
/** A trio counts only if it is whole in all 10 groups. */
const WHOLE = TRIOS.filter((k) =>
	GROUPS.every(({pair, as}) => trioOf(pair, as, k).length === FOCUS_IDS.length),
);

/** The joined grade: fail if any run fails; else none if any is unseen or has no row; else pass. */
const joined = (grades: readonly Grade[]): Grade =>
	grades.includes("fail") ? "fail" : grades.includes("none") ? "none" : "pass";

/** Every cell of one trio, joined, with the faults the runs gave on it. */
const trioCells = (k: number) =>
	GROUPS.flatMap(({pair, as}) => {
		const trio = trioOf(pair, as, k);
		const ids = [...new Set(trio.flatMap((r) => Object.keys(r.grades)))];
		return ids.map((id) => {
			const per = trio.map((r) => ({focus: r.focus, grade: r.grades[id] ?? ("none" as Grade)}));
			return {
				key: cellKey(pair, as, id),
				k,
				grade: joined(per.map((p) => p.grade)),
				failedBy: per.filter((p) => p.grade === "fail").map((p) => p.focus),
				faults: trio.flatMap((r) =>
					r.onCriteria.filter((c) => c.id === id).map((c) => ({focus: r.focus, fault: c.fault})),
				),
			};
		});
	});
const cells = WHOLE.flatMap(trioCells);
const fails = cells.filter((c) => c.grade === "fail");
const classOf = (key: string) => (KNOWN.has(key) ? "known" : STEADY.has(key) ? "steady" : "new");

// ---------------------------------------------------------------- the hand read

type Read = "real" | "false";
/**
 * By key `<pair>|<kind>|<criterion>#<trio>`: each new fail, the drawn known fails, and one per steady
 * cell, read against the code at the pair's head. A key not here is not read yet.
 */
const READ: Record<string, Read> = Object.fromEntries([
	...[
		// New fails. f590: the cycle check reads only `dependencies` (fs-env.ts:31), so a cycle through
		// devDependencies is applied; `packageOf` reads the raw path, so `packages/a/../b/x.ts` counts as
		// package a (a small case); a missing source throws from the write loop after earlier rows moved,
		// and target-package importers are skipped (112b's defects, here on the book's c14).
		"p2-t2-f590|task|c7#1",
		"p2-t2-f590|task|c7#2",
		"p2-t2-f590|task|c7#3",
		"p2-t2-f590|task|c9#1",
		"p2-t2-f590|task|c9#2",
		"p2-t2-f590|last|c14#1",
		"p2-t2-f590|last|c14#2",
		"p2-t2-f590|last|c14#3",
		// 9698: only relative specifiers are walked, so importers by the package's name are left
		// behind (c5, c7, c14); the cycle graph reads only `dependencies` (c10); two rows with one `to`
		// pass the checks and the second rename overwrites the first, after importers, manifests and the
		// lockfile were written (c4, c5, c14); a name already under another section of the importer
		// block skips the lockfile link while the manifest gains it (c12, a small case).
		"p3-t2-9698|task|c5#1",
		"p3-t2-9698|task|c5#2",
		"p3-t2-9698|task|c5#3",
		"p3-t2-9698|task|c10#2",
		"p3-t2-9698|task|c12#3",
		"p3-t2-9698|last|c4#2",
		"p3-t2-9698|last|c5#2",
		"p3-t2-9698|last|c7#1",
		"p3-t2-9698|last|c7#3",
		"p3-t2-9698|last|c10#1",
		"p3-t2-9698|last|c10#3",
		"p3-t2-9698|last|c14#1",
		"p3-t2-9698|last|c14#2",
		// 5148: `packageOf` takes an absolute path as no package, so its row is not named (a small case,
		// c1); task 2 is not built at this head (c9, c11).
		"p3-t1-5148|task|c1#2",
		"p3-t1-5148|last|c1#1",
		"p3-t1-5148|last|c1#2",
		"p3-t1-5148|last|c9#1",
		"p3-t1-5148|last|c11#1",
		// 741c: the same-package loop renames with no check first, so it can stop half way or overwrite
		// a file. True, outside c2's words ("as before": before, apply did nothing).
		"p4-t1-741c|task|c2#1",
		"p4-t1-741c|last|c2#2",
		"p4-t1-741c|last|c2#3",
		// Known defects drawn: the faults are 112b's (bare-name importers, no CLI or bin, no lockfile
		// step at task 1's head, the README's claims, task 1's refusal text that task 2's code dropped).
		"p2-t2-f590|last|c5#1",
		"p2-t2-f590|last|c17#2",
		"p3-t1-5148|last|c13#3",
		"p4-t1-741c|task|c1#1",
		"p4-t1-741c|task|c16#1",
		"p4-t1-741c|task|c16#2",
		"p4-t1-741c|last|c1#3",
		"p4-t2-23bb|last|c3#1",
		"p4-t2-23bb|last|c3#2",
		"p4-t2-23bb|last|c9#2",
		// Steady fails: a task not built at that head, or a plan whose tasks contradict, as the words say.
		"p2-t2-f590|last|c1#1",
		"p2-t2-f590|last|c2#1",
		"p2-t2-f590|last|c4#1",
		"p3-t2-9698|last|c1#1",
		"p3-t2-9698|last|c2#1",
		"p3-t2-9698|last|c3#1",
		"p3-t2-9698|last|c16#1",
		"p3-t1-5148|last|c5#1",
		"p3-t1-5148|last|c6#1",
		"p3-t1-5148|last|c7#1",
		"p3-t1-5148|last|c8#1",
		"p3-t1-5148|last|c10#1",
		"p3-t1-5148|last|c12#1",
		"p3-t1-5148|last|c15#1",
		"p4-t1-741c|last|c3#1",
		"p4-t1-741c|last|c4#1",
		"p4-t1-741c|last|c7#1",
		"p4-t1-741c|last|c8#1",
		"p4-t2-23bb|last|c1#1",
		"p4-t2-23bb|last|c10#1",
	].map((key) => [key, "real" as const]),
	// "No existing test that called apply in its function form is changed". The diff is against a
	// main with no test at all; at the head the function form is gone and every test passes an Env.
	["p2-t2-f590|task|c18#1", "false" as const],
]);
/** By key `<pair>|<kind>|<trio>|<focus>#<i>`: each finding of its own, in 112's classes. */
const FINDING_CLASSES: Record<string, "defect" | "scope" | "docs" | "rule" | "other"> = {
	// Tests that would catch a real breakage are missing: bare-name importers, unquoted lockfile entries.
	"p4-t2-23bb|task|2|A#1": "defect",
	"p4-t2-23bb|task|3|C#1": "defect",
	"p3-t2-9698|task|3|A#0": "defect",
	// Rows are not checked against each other or the disk before the first rename: half-way stops,
	// overwrites, a shared target, paths outside the root or with `..`.
	"p4-t1-741c|task|3|C#0": "defect",
	"p3-t2-9698|task|1|C#0": "defect",
	"p2-t2-f590|last|2|C#1": "defect",
	"p4-t2-23bb|last|2|C#0": "defect",
	"p2-t2-f590|last|1|C#0": "defect",
	"p4-t1-741c|last|1|C#0": "defect",
	"p2-t2-f590|last|1|C#1": "defect",
	"p4-t2-23bb|last|2|C#1": "defect",
	"p2-t2-f590|last|2|C#0": "defect",
	// Third-package importers get no dependency on the target (112b's defect).
	"p2-t2-f590|last|2|C#4": "defect",
	"p2-t2-f590|last|1|C#2": "defect",
	// A same-package move can edit a manifest, and the lockfile step runs only for a crossing row.
	"p4-t2-23bb|task|1|A#0": "defect",
	"p4-t2-23bb|task|3|A#0": "defect",
	// addDependency returns quietly when it cannot find the package (112's defect).
	"p2-t2-f590|last|1|A#0": "defect",
	// The README says every importer is rewritten.
	"p4-t2-23bb|task|3|C#0": "docs",
	"p4-t2-23bb|task|3|B#0": "docs",
	"p4-t2-23bb|task|2|A#0": "docs",
};

const failKey = (c: {key: string; k: number}) => `${c.key}#${c.k}`;
const newFails = fails.filter((c) => classOf(c.key) === "new");
const knownDrawn = draw(
	fails.filter((c) => classOf(c.key) === "known"),
	10,
);
/** One joined fail per steady cell: the first counted trio that fails it. */
const steadyDrawn = [...STEADY].flatMap((key) => {
	const first = fails.find((c) => c.key === key);
	return first === undefined ? [] : [first];
});
const toRead = [...newFails, ...knownDrawn, ...steadyDrawn];
const isFalse = (c: {key: string; k: number}) => READ[failKey(c)] === "false";

const findings = results.runs
	.filter((r) => WHOLE.includes(r.k))
	.flatMap((r) =>
		r.found.map((f: Found, i) => ({key: `${r.pair}|${r.as}|${r.k}|${r.focus}#${i}`, ...f})),
	);
const findingsDrawn = draw(findings, 20);

// ---------------------------------------------------------------- caught, per trio and per run

const caughtIn = (k: number) =>
	cells.filter((c) => c.k === k && KNOWN.has(c.key) && c.grade === "fail").map((c) => c.key);
/** Known defects one run fails, over the runs of a set: per run, by `k` (and focus). */
const caughtBySingle = (runs: readonly Ran[]) =>
	runs.reduce(
		(s, r) =>
			s +
			Object.entries(r.grades).filter(
				([id, g]) => g === "fail" && KNOWN.has(cellKey(r.pair, r.as, id)),
			).length,
		0,
	);
const singleMean = (runs: readonly Ran[], looks: number) => round(caughtBySingle(runs) / looks, 2);

/** Every set of 3 of 112b's 5 plain runs, joined: known defects caught. Biased up (see the rule). */
const plainThrees = (() => {
	const sets: number[][] = [];
	for (let a = 1; a <= 5; a++)
		for (let b = a + 1; b <= 5; b++) for (let c = b + 1; c <= 5; c++) sets.push([a, b, c]);
	return sets.map(
		(set) =>
			[...KNOWN].filter((key) => {
				const [pair, as, id] = key.split("|") as [string, string, string];
				return opus.some(
					(r) => r.pair === pair && r.as === as && set.includes(r.k) && r.grades[id] === "fail",
				);
			}).length,
	);
})();

// ---------------------------------------------------------------- two looks

/** The share of cells whose grade differs between two looks, over every pair of looks. */
const twoLook = (looks: readonly Map<string, Grade>[], passFailOnly = false) => {
	let differ = 0;
	let all = 0;
	for (let i = 0; i < looks.length; i++)
		for (let j = i + 1; j < looks.length; j++) {
			const a = looks[i] as Map<string, Grade>;
			const b = looks[j] as Map<string, Grade>;
			for (const [key, g] of a) {
				const h = b.get(key) ?? "none";
				all += 1;
				if (passFailOnly ? new Set([g, h]).size === 2 && g !== "none" && h !== "none" : g !== h)
					differ += 1;
			}
		}
	return pct(differ, all);
};
const trioLooks = WHOLE.map(
	(k) => new Map(cells.filter((c) => c.k === k).map((c) => [c.key, c.grade])),
);
const singleLooks = (runs: readonly Ran[]) =>
	[1, 2, 3, 4, 5].map(
		(k) =>
			new Map(
				runs
					.filter((r) => r.k === k)
					.flatMap((r) =>
						Object.entries(r.grades).map(([id, g]) => [cellKey(r.pair, r.as, id), g] as const),
					),
			),
	);
const verdictAgrees = GROUPS.map(({pair, as}) => {
	const passed = WHOLE.map((k) => trioOf(pair, as, k).every((r) => r.ended === "done"));
	return {pair, as, passed, agrees: new Set(passed).size <= 1};
});

// ---------------------------------------------------------------- cost and time

const trios = WHOLE.flatMap((k) => GROUPS.map(({pair, as}) => trioOf(pair, as, k)));
const counted = results.runs.filter((r) => WHOLE.includes(r.k));
const opusCost = mean(opus.map((r) => r.cost)) ?? 0;

const read = (list: readonly {key: string; k: number}[]) => ({
	n: list.length,
	read: list.filter((c) => READ[failKey(c)] !== undefined).length,
	real: list.filter((c) => READ[failKey(c)] === "real").length,
	false: list.filter(isFalse).length,
});

const count = {
	trios: TRIOS,
	counted: WHOLE,
	runs: counted.length,
	known: KNOWN.size,
	steady: STEADY.size,
	caught: {
		perTrio: Object.fromEntries(WHOLE.map((k) => [k, caughtIn(k).length])),
		mean: round(mean(WHOLE.map((k) => caughtIn(k).length)), 2),
		inEvery: [...KNOWN].filter((key) => WHOLE.every((k) => caughtIn(k).includes(key))).length,
		inAny: [...KNOWN].filter((key) => WHOLE.some((k) => caughtIn(k).includes(key))).length,
		missedInEvery: [...KNOWN].filter((key) => WHOLE.every((k) => !caughtIn(k).includes(key))),
		perFocus: Object.fromEntries(
			FOCUS_IDS.map((f) => [
				f,
				singleMean(
					counted.filter((r) => r.focus === f),
					WHOLE.length,
				),
			]),
		),
		singleOpus: singleMean(opus, 5),
		singleSonnet: singleMean(sonnet, 5),
		plainOpusThrees: {mean: round(mean(plainThrees), 2), min: Math.min(...plainThrees)},
		perCell: Object.fromEntries(
			[...KNOWN].map((key) => [
				key,
				{
					trios: WHOLE.map((k) => cells.find((c) => c.k === k && c.key === key)?.failedBy ?? []),
					opus112b: opusCells.get(key),
				},
			]),
		),
	},
	fails: {
		all: fails.length,
		byClass: Object.fromEntries(
			["known", "steady", "new"].map((c) => [c, fails.filter((f) => classOf(f.key) === c).length]),
		),
		perTrio: round((fails.length / Math.max(1, WHOLE.length)) as number, 1),
		newRead: read(newFails),
		knownDrawn: read(knownDrawn),
		steadyDrawn: read(steadyDrawn),
		falseShare: pct(fails.filter(isFalse).length, fails.length),
		falseShareOfNew: pct(newFails.filter(isFalse).length, newFails.length),
		newCells: [...new Set(newFails.map((c) => c.key))],
	},
	twoLook: {
		trio: twoLook(trioLooks),
		trioPassFail: twoLook(trioLooks, true),
		singleOpus: twoLook(singleLooks(opus)),
		singleOpusPassFail: twoLook(singleLooks(opus), true),
		singleSonnet: twoLook(singleLooks(sonnet)),
		singleSonnetPassFail: twoLook(singleLooks(sonnet), true),
		verdictAgrees: `${verdictAgrees.filter((v) => v.agrees).length} of ${verdictAgrees.length}`,
		verdicts: verdictAgrees,
	},
	findings: {
		all: findings.length,
		perTrio: round(findings.length / Math.max(1, trios.length), 2),
		drawn: findingsDrawn.map((f) => ({key: f.key, class: FINDING_CLASSES[f.key] ?? null})),
		tally: Object.fromEntries(
			[...new Set(findingsDrawn.map((f) => FINDING_CLASSES[f.key] ?? "unread"))].map((c) => [
				c,
				findingsDrawn.filter((f) => (FINDING_CLASSES[f.key] ?? "unread") === c).length,
			]),
		),
		perFocus: Object.fromEntries(
			FOCUS_IDS.map((f) => [f, findings.filter((x) => x.key.split("|")[3]?.startsWith(f)).length]),
		),
	},
	cost: {
		perTrio: round(mean(trios.map((t) => t.reduce((s, r) => s + r.cost, 0))), 4),
		perRun: round(mean(counted.map((r) => r.cost)), 4),
		perFocus: Object.fromEntries(
			FOCUS_IDS.map((f) => [
				f,
				round(mean(counted.filter((r) => r.focus === f).map((r) => r.cost)), 4),
			]),
		),
		singleOpus: round(opusCost, 4),
		timesSingleOpus: round(
			(mean(trios.map((t) => t.reduce((s, r) => s + r.cost, 0))) ?? 0) / opusCost,
			2,
		),
		secondsAdded: round(mean(trios.map((t) => t.reduce((s, r) => s + r.ms, 0) / 1000)), 0),
		secondsLongest: round(mean(trios.map((t) => Math.max(...t.map((r) => r.ms)) / 1000)), 0),
		singleOpusSeconds: round(mean(opus.map((r) => r.ms / 1000)), 0),
		spent: round(
			results.runs.reduce((s, r) => s + r.cost, 0),
			3,
		),
		maxRun: round(Math.max(...results.runs.map((r) => r.cost)), 3),
		endings: Object.fromEntries(
			[...new Set(results.runs.map((r) => r.ended))].map((e) => [
				e,
				results.runs.filter((r) => r.ended === e).length,
			]),
		),
	},
};

if (process.env.SHOW === "1") {
	console.log(`# ${toRead.length} joined fails to read`);
	for (const c of toRead)
		console.log(
			JSON.stringify({
				key: failKey(c),
				class: classOf(c.key),
				read: READ[failKey(c)] ?? null,
				faults: c.faults,
			}),
		);
	console.log(`# ${findings.length} findings, ${findingsDrawn.length} drawn`);
	for (const f of findingsDrawn) console.log(JSON.stringify(f));
} else {
	results.count = count;
	writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
	console.log(JSON.stringify({...count, caught: {...count.caught, perCell: undefined}}, null, 1));
}
