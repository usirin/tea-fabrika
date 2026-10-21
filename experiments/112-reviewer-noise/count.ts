// Experiment 112's count: what the runs in results/112-reviewer-noise.json say, by the reading rule
// in ../112-reviewer-noise.md, written before any counted run. No agent runs here. It also counts
// what "findings wait for a yes" would have held in 105b, from 105b's own records (./inputs.json).
//
//   node experiments/112-reviewer-noise/count.ts            the count, kept under `count`
//   SAMPLE=1 node experiments/112-reviewer-noise/count.ts   print the 20 findings drawn to read
//
// Node at the edge: the results file is read and written with readFileSync and writeFileSync.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {memoryLedger} from "../../packages/fabrika/src/pipeline/asks/ledger.ts";
import {bookOf, foldLedger} from "../../packages/fabrika/src/pipeline/asks/rules.ts";
import {PLAN} from "../../packages/fabrika/src/pipeline/ids.ts";
import {
	type Found,
	factsUpTo,
	type Grade,
	INPUTS,
	ownerOf,
	PAIRS,
	PLAN_ID,
	type Ran,
} from "./pairs.ts";

/** `FROM`: another results file, e.g. a copy taken while a run goes on. */
const RESULTS =
	process.env.FROM ?? fileURLToPath(new URL("../results/112-reviewer-noise.json", import.meta.url));
const results = JSON.parse(readFileSync(RESULTS, "utf8")) as {runs: Ran[]; count?: unknown};
const allRuns = results.runs;
const MODELS = [...new Set(allRuns.map((r) => r.model))];
const KINDS = ["task", "last"] as const;
/** A group has 5 runs (the reading rule's words). */
const REPEAT = 5;
/**
 * The pairs counted: those where every model's every group has all 5 runs, so the models are compared
 * on the same pairs. A pair the spend cap cut part way is shown per group, and its findings and spend
 * still count, but it is left out of the rates.
 */
const COUNTED = new Set(
	PAIRS.filter((p) =>
		MODELS.every((model) =>
			KINDS.every(
				(as) =>
					allRuns.filter((r) => r.pair === p.id && r.model === model && r.as === as).length ===
					REPEAT,
			),
		),
	).map((p) => p.id),
);
const runs = allRuns.filter((r) => COUNTED.has(r.pair));

const pct = (a: number, b: number) => (b === 0 ? null : Math.round((1000 * a) / b) / 10);
const mean = (xs: readonly number[]) =>
	xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (x: number | null, d = 4) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** A review passed when the machine ended `done`. */
const passed = (r: Ran) => r.ended === "done";

/** The runs of one group: one pair, one model, one kind. */
const groupOf = (pair: string, model: string, as: "task" | "last", from = runs) =>
	from.filter((r) => r.pair === pair && r.model === model && r.as === as);

/** Each criterion's grades across a group's runs, in run order; a missing grade is `none`. */
const cellsOf = (group: readonly Ran[]): Map<string, Grade[]> => {
	const ids = [...new Set(group.flatMap((r) => Object.keys(r.grades)))];
	return new Map(ids.map((id) => [id, group.map((r) => r.grades[id] ?? "none")]));
};

/** How many times each grade comes up, most first. */
const tally = (grades: readonly Grade[]) => {
	const counts = new Map<Grade, number>();
	for (const g of grades) counts.set(g, (counts.get(g) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
const modeOf = (grades: readonly Grade[]): Grade => tally(grades)[0]?.[0] ?? "none";
const flips = (grades: readonly Grade[]) => tally(grades).length > 1;
/** A majority of 3 flips when some set of 3 runs outvotes the usual grade: the rest appear twice or more. */
const flipsByThree = (grades: readonly Grade[]) =>
	grades.length - (tally(grades)[0]?.[1] ?? 0) >= 2;

// ---------------------------------------------------------------- findings and their identity

const STOP = new Set(
	"the and that this with from for are its not any but has have when what which each into one all own was were their them they its it's than then also only same more must should would does doing done every there here".split(
		" ",
	),
);
const wordsOf = (text: string) =>
	new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9_]+/)
			.filter((w) => w.length >= 3 && !STOP.has(w)),
	);
const jaccard = (a: Set<string>, b: Set<string>) => {
	const both = [...a].filter((w) => b.has(w)).length;
	const either = new Set([...a, ...b]).size;
	return either === 0 ? 0 : both / either;
};
/** The same finding: the same file (or both none), and `wants` sharing at least `bar` of their words. */
const same = (a: Found, b: Found, bar = 0.3) =>
	(a.at?.file ?? null) === (b.at?.file ?? null) &&
	jaccard(wordsOf(a.wants), wordsOf(b.wants)) >= bar;

/** In one group: each finding, and whether another run of the group has the same one. */
const repeatsIn = (group: readonly Ran[], bar = 0.3) =>
	group.flatMap((r, i) =>
		r.found.map((f) => ({
			f,
			repeats: group.some((o, j) => j !== i && o.found.some((g) => same(f, g, bar))),
		})),
	);

// ---------------------------------------------------------------- per model

const groupsFor = (model: string) =>
	PAIRS.flatMap((p) =>
		KINDS.map((as) => ({pair: p.id, as, runs: groupOf(p.id, model, as)})).filter(
			(g) => g.runs.length > 0,
		),
	);

const perModel = (model: string) => {
	const groups = groupsFor(model);
	const cells = groups.flatMap((g) => [...cellsOf(g.runs).values()]);
	const all = runs.filter((r) => r.model === model);
	const unsteady = groups.filter((g) => new Set(g.runs.map(passed)).size > 1);
	const notPassed = unsteady.flatMap((g) => g.runs.filter((r) => !passed(r)));
	const findingsOnly = notPassed.filter(
		(r) => Object.values(r.grades).every((g) => g === "pass") && r.found.length > 0,
	);
	const reps = groups.flatMap((g) => repeatsIn(g.runs));
	const reps40 = groups.flatMap((g) => repeatsIn(g.runs, 0.4));
	return {
		model,
		reviews: all.length,
		groups: groups.length,
		runsPerGroup: [...new Set(groups.map((g) => g.runs.length))],
		cells: cells.length,
		flipped: cells.filter(flips).length,
		flipRate: pct(cells.filter(flips).length, cells.length),
		oddOneOut: pct(
			cells.reduce((s, c) => s + c.filter((g) => g !== modeOf(c)).length, 0),
			cells.reduce((s, c) => s + c.length, 0),
		),
		flipRateMajorityOf3: pct(cells.filter(flipsByThree).length, cells.length),
		none: pct(
			cells.reduce((s, c) => s + c.filter((g) => g === "none").length, 0),
			cells.reduce((s, c) => s + c.length, 0),
		),
		verdictSteady: `${groups.length - unsteady.length} of ${groups.length}`,
		verdictSteadyPct: pct(groups.length - unsteady.length, groups.length),
		passed: `${all.filter(passed).length} of ${all.length}`,
		noForm: all.filter((r) => r.ended.includes("draft_failed") || r.ended.includes("unseen"))
			.length,
		endings: Object.fromEntries(
			[...new Set(all.map((r) => r.ended))].map((e) => [
				e,
				all.filter((r) => r.ended === e).length,
			]),
		),
		unsteadyNotPassed: notPassed.length,
		findingsOnly: findingsOnly.length,
		findingsOnlyPct: pct(findingsOnly.length, notPassed.length),
		findingsPerReview: round(mean(all.map((r) => r.found.length)), 2),
		findingsPerReviewByKind: Object.fromEntries(
			KINDS.map((as) => [
				as,
				round(mean(all.filter((r) => r.as === as).map((r) => r.found.length)), 2),
			]),
		),
		findings: reps.length,
		repeatRate: pct(reps.filter((x) => x.repeats).length, reps.length),
		repeatRateAt40: pct(reps40.filter((x) => x.repeats).length, reps40.length),
		findingsBySource: Object.fromEntries(
			[...new Set(reps.map((x) => x.f.from.source))].map((s) => [
				s,
				reps.filter((x) => x.f.from.source === s).length,
			]),
		),
		onCriteriaPerReview: round(mean(all.map((r) => r.onCriteria.length)), 2),
		costPerReview: round(mean(all.map((r) => r.cost)), 4),
		costByKind: Object.fromEntries(
			KINDS.map((as) => [as, round(mean(all.filter((r) => r.as === as).map((r) => r.cost)), 4)]),
		),
		secondsPerReview: round(mean(all.map((r) => r.ms / 1000)), 0),
		spent: round(
			allRuns.filter((r) => r.model === model).reduce((s, r) => s + r.cost, 0),
			3,
		),
		reviewsRun: allRuns.filter((r) => r.model === model).length,
		findingsAllRuns: allRuns
			.filter((r) => r.model === model)
			.reduce((s, r) => s + r.found.length, 0),
	};
};

/** Per pair, kind and model: how many runs passed, the flip rate, and each flipped cell's grades. */
const perGroup = () =>
	PAIRS.flatMap((p) =>
		MODELS.flatMap((model) =>
			KINDS.flatMap((as) => {
				const g = groupOf(p.id, model, as, allRuns);
				if (g.length === 0) return [];
				const cells = cellsOf(g);
				return [
					{
						pair: p.id,
						model,
						as,
						passed: `${g.filter(passed).length}/${g.length}`,
						cells: cells.size,
						flipped: [...cells.values()].filter(flips).length,
						flips: Object.fromEntries(
							[...cells.entries()].filter(([, c]) => flips(c)).map(([id, c]) => [id, c.join(" ")]),
						),
						findings: g.map((r) => r.found.length).join(" "),
					},
				];
			}),
		),
	);

/** Cells that flip under both models, against all flipped cells, where both models judged the group. */
const wording = () => {
	const both: string[] = [];
	let flippedAll = 0;
	let onBoth = 0;
	const criteria = new Set<string>();
	for (const p of PAIRS)
		for (const as of KINDS) {
			const per = MODELS.map((m) => cellsOf(groupOf(p.id, m, as)));
			if (per.some((c) => c.size === 0) || per.length < 2) continue;
			const ids = [...(per[0]?.keys() ?? [])];
			for (const id of ids) {
				criteria.add(`${p.id}|${as}|${id}`);
				const f = per.map((c) => flips(c.get(id) ?? []));
				const n = f.filter(Boolean).length;
				flippedAll += n;
				if (f.every(Boolean)) {
					onBoth += n;
					both.push(`${p.id}|${as}|${id}`);
				}
			}
		}
	return {
		criteria: criteria.size,
		flippedCells: flippedAll,
		onCriteriaFlippingUnderBoth: onBoth,
		share: pct(onBoth, flippedAll),
		criteriaFlippingUnderBoth: both,
		ofAllCriteria: pct(both.length, criteria.size),
	};
};

/** Task review against last review, on the task's own criteria, same pair and model. */
const taskVsLast = () =>
	MODELS.map((model) => {
		let agree = 0;
		let total = 0;
		const across: number[] = [];
		const withinTask: number[] = [];
		const withinLast: number[] = [];
		const differ: string[] = [];
		for (const p of PAIRS) {
			const t = groupOf(p.id, model, "task");
			const l = groupOf(p.id, model, "last");
			if (t.length === 0 || l.length === 0) continue;
			const tc = cellsOf(t);
			const lc = cellsOf(l);
			for (const [id, tg] of tc) {
				const lg = lc.get(id);
				if (lg === undefined) continue;
				total += 1;
				if (modeOf(tg) === modeOf(lg)) agree += 1;
				else differ.push(`${p.id}|${id}: task ${tg.join(" ")} / last ${lg.join(" ")}`);
				for (const a of tg) for (const b of lg) across.push(a === b ? 0 : 1);
				for (let i = 0; i < tg.length; i++)
					for (let j = i + 1; j < tg.length; j++) withinTask.push(tg[i] === tg[j] ? 0 : 1);
				for (let i = 0; i < lg.length; i++)
					for (let j = i + 1; j < lg.length; j++) withinLast.push(lg[i] === lg[j] ? 0 : 1);
			}
		}
		const toPct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
		return {
			model,
			criteria: total,
			majorityAgree: pct(agree, total),
			runPairsDisagree: {
				taskVsLast: toPct(mean(across)),
				taskVsTask: toPct(mean(withinTask)),
				lastVsLast: toPct(mean(withinLast)),
			},
			differ,
		};
	});

/** What the lane said at each pair's head, against the most common grade here. */
const againstLane = () =>
	PAIRS.flatMap((p) => {
		const info = (
			results as {pairs?: {id: string; lane: {name: string; grades: Record<string, string>}[]}[]}
		).pairs?.find((x) => x.id === p.id);
		return (info?.lane ?? []).flatMap((lane) => {
			const as = ownerOf(lane.name) === "plan" ? "last" : "task";
			if (as === "task" && ownerOf(lane.name) !== p.task) return [];
			return MODELS.map((model) => {
				const cells = cellsOf(groupOf(p.id, model, as));
				const differ = Object.entries(lane.grades).flatMap(([id, g]) => {
					const c = cells.get(id);
					return c !== undefined && modeOf(c) !== g
						? [`${id}: lane ${g}, here ${c.join(" ")}`]
						: [];
				});
				return {pair: p.id, lane: lane.name, model, differ};
			});
		});
	});

// ---------------------------------------------------------------- the 20 findings read by hand

/** A fixed draw: a small linear congruential generator, so the same results draw the same 20. */
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
/** A finding to read: where it came from, the source the reviewer gave (if kept), and its words. */
interface ToRead {
	readonly key: string;
	readonly source: string;
	readonly f: Pick<Found, "fault" | "wants" | "at"> | {fault: null; wants: string; at: null};
}
const allFindings: ToRead[] = allRuns.flatMap((r) =>
	r.found.map((f, i) => ({
		key: `${r.pair}|${r.model}|${r.as}|${r.k}#${i}`,
		source: f.from.source,
		f,
	})),
);
/**
 * 105b's own findings, as the lane wrote them (only their `wants` was kept). The runs here made too few
 * findings for a sample of 20, so the rest of the 20 is drawn from these, with the same seed.
 */
const laneFindings: ToRead[] = Object.entries(INPUTS).flatMap(([pass, input]) =>
	input.reviews.flatMap((r) =>
		r.found.map((wants, i) => ({
			key: `105b|${pass}|${r.name}#${i}`,
			source: "105b",
			f: {fault: null, wants, at: null},
		})),
	),
);
const sample = [
	...draw(allFindings, 20),
	...draw(laneFindings, Math.max(0, 20 - allFindings.length)),
];

/**
 * The class each drawn finding was given by hand, by its key: defect, scope, docs, rule, other. Read
 * against the code at the pair's head. Filled in after the draw; a key not here is not read yet.
 */
const CLASSES: Record<string, "defect" | "scope" | "docs" | "rule" | "other"> = {
	// addDependency returns early when the package or dependency is not found (fs-env.ts 62): true.
	"p2-t2-f590|haiku|last|1#0": "defect",
	"p2-t2-f590|haiku|last|4#0": "defect",
	// packageOf drops a leading '..' (apply.ts 3-11): true, an edge case of a repo-relative plan.
	"p3-t1-5148|haiku|task|4#0": "defect",
	// The single-package test asserts only `[]`, which the stub returns: a test that cannot fail.
	"p3-t1-5148|haiku|last|4#0": "defect",
	// Writing a manifest sorts every dependency (apply.ts 247-250): true. Given under the rule,
	// classed by what it is: a user's manifest changes beyond the move.
	"p3-t2-9698|haiku|task|3#0": "defect",
	"p4-t2-23bb|haiku|last|5#0": "other",
	"p4-t1-741c|haiku|task|1#0": "docs",
	"p4-t1-741c|haiku|task|5#0": "docs",
	"p1-t2-fb61|haiku|last|1#0": "docs",
	"p1-t2-fb61|haiku|last|3#0": "docs",
	"p1-t2-fb61|haiku|last|4#0": "docs",
	"105b|pass3|lane:700:t2:r3:review#0": "defect",
	"105b|pass3|lane:700:t2:r9:review#0": "defect",
	"105b|pass3|lane:700:t2:r2:review#0": "defect",
	"105b|pass4|lane:700:t2:r3:review#2": "docs",
	"105b|pass1|lane:700:t1:r1:review#1": "docs",
	"105b|pass2|lane:700:t1:r2:review#1": "scope",
	"105b|pass4|lane:700:t1:r6:review#0": "scope",
	// A new test no criterion asks for.
	"105b|pass2|lane:700:t2:r4:review#0": "scope",
	// The whole finding is the word "placeholder", and it held the review open.
	"105b|pass1|lane:700:t2:r8:review#0": "other",
};

const classes = () => {
	const read = sample.filter((s) => CLASSES[s.key] !== undefined);
	const of = (c: string) => read.filter((s) => CLASSES[s.key] === c).length;
	return {
		read: read.length,
		defect: of("defect"),
		scope: of("scope"),
		docs: of("docs"),
		rule: of("rule"),
		other: of("other"),
		scopeOrDocsPct: pct(of("scope") + of("docs"), read.length),
		bySource: Object.fromEntries(
			[...new Set(read.map((s) => s.source))].map((src) => [
				src,
				read.filter((s) => s.source === src).map((s) => CLASSES[s.key]),
			]),
		),
	};
};

// ---------------------------------------------------------------- 105b: findings that wait for a yes

/**
 * Per 105b pass: the criteria reviews added (each would have waited), and the reviews that failed
 * only on those (each would have passed). Per task, the round it would first have passed with
 * added criteria held, against the round it passed, or did not.
 */
const held = () =>
	Object.entries(INPUTS).map(([pass, input]) => {
		const bookAt = (at: number) =>
			bookOf(foldLedger(memoryLedger(factsUpTo(pass, at)).read()), PLAN_ID);
		const last = bookAt(input.reviews.length);
		const added = new Set<string>(
			(last?.live ?? [])
				.concat(last?.retired ?? [])
				.filter((e) => e.wordings[0].by === "review")
				.map((e) => e.id),
		);
		const reviews = input.reviews.map((r, at) => {
			const owner = ownerOf(r.name);
			// The planned criteria this review was given: its task's, or every one for a last review.
			const given = (bookAt(at)?.live ?? [])
				.filter((e) => e.wordings[0].by === "plan" && (owner === PLAN || e.task === owner))
				.map((e) => e.id as string);
			const grade = new Map(r.rows.map((x) => [x.criterion as string, x.grade]));
			const failed = r.rows.filter((x) => x.grade === "fail").map((x) => x.criterion as string);
			const planned = failed.filter((id) => !added.has(id));
			const onAdded = failed.filter((id) => added.has(id));
			return {
				name: r.name,
				ended: r.ended,
				planned,
				onAdded,
				found: r.found.length,
				// It failed, and every planned criterion it was given passed: the findings alone held it.
				onlyAdded:
					r.ended !== "done" &&
					given.every((id) => grade.get(id) === "pass") &&
					(onAdded.length > 0 || r.found.length > 0),
			};
		});
		const tasks = [...new Set(input.reviews.map((r) => ownerOf(r.name)))].map((task) => {
			const own = reviews.filter((r) => ownerOf(r.name) === task);
			const first = own.findIndex((r) => r.ended === "done");
			const held = own.findIndex((r) => r.ended === "done" || r.onlyAdded);
			return {
				task,
				reviews: own.length,
				passedAt: first === -1 ? null : first + 1,
				wouldPassAt: held === -1 ? null : held + 1,
			};
		});
		return {
			pass,
			addedCriteria: added.size,
			// Findings as the reviews wrote them, a finding written again in a later round counted again.
			findingsWritten: reviews.reduce((s, r) => s + r.found, 0),
			plannedCriteria: (last?.live ?? []).filter((e) => e.wordings[0].by === "plan").length,
			reviews: reviews.length,
			reviewsOnlyOnAdded: reviews.filter((r) => r.onlyAdded).map((r) => r.name),
			tasks,
		};
	});

if (process.env.SAMPLE === "1") {
	for (const s of sample)
		console.log(
			JSON.stringify({
				key: s.key,
				source: s.source,
				at: s.f.at,
				fault: s.f.fault,
				wants: s.f.wants,
			}),
		);
} else {
	const count = {
		counted: [...COUNTED],
		perModel: MODELS.map(perModel),
		perGroup: perGroup(),
		wording: wording(),
		taskVsLast: taskVsLast(),
		againstLane: againstLane(),
		classes: classes(),
		sample: sample.map((s) => ({key: s.key, class: CLASSES[s.key] ?? null})),
		held: held(),
	};
	results.count = count;
	writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
	console.log(JSON.stringify(count, null, 1));
}
