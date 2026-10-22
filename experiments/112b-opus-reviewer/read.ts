// Experiment 112b's hand read: opus's findings and a draw of its fails, as the reading rule in
// ../112b-opus-reviewer.md says, with the class each was given after reading it against the code at
// its pair's head. No agent runs here. Run it after the count (which writes `count.counted`).
//
//   SHOW=1 node experiments/112b-opus-reviewer/read.ts   print what is drawn, to read
//   node experiments/112b-opus-reviewer/read.ts          the classes, kept under `read`
//
// Node at the edge: the results file is read and written with readFileSync and writeFileSync.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {Ran} from "../112-reviewer-noise/pairs.ts";

const RESULTS = fileURLToPath(new URL("../results/112b-opus-reviewer.json", import.meta.url));
const results = JSON.parse(readFileSync(RESULTS, "utf8")) as {
	runs: Ran[];
	count?: {counted: string[]};
	read?: unknown;
};
const counted = new Set(results.count?.counted ?? []);

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

const keyOf = (r: Ran) => `${r.pair}|${r.as}|${r.k}`;

/** Every opus finding, from every pair it ran (findings count on the uncounted pair too). */
const findings = results.runs.flatMap((r) =>
	r.found.map((f, i) => ({key: `${keyOf(r)}#${i}`, source: f.from.source, ...f})),
);
/** Every fail on the counted pairs, with the fault opus gave for it. */
const fails = results.runs
	.filter((r) => counted.has(r.pair))
	.flatMap((r) =>
		Object.entries(r.grades)
			.filter(([, g]) => g === "fail")
			.map(([id]) => {
				const on = r.onCriteria.find((c) => c.id === id);
				return {key: `${keyOf(r)}|${id}`, fault: on?.fault ?? null, wants: on?.wants ?? null};
			}),
	);
const foundDrawn = draw(findings, 20);
const failsDrawn = draw(fails, 10);

type FindingClass = "defect" | "scope" | "docs" | "rule" | "other";
type FailClass = "real" | "outside" | "wrong" | "unseeable";

/** By key, after reading each against the code at its head. A key not here is not read yet. */
const FINDING_CLASSES: Record<string, FindingClass> = {
	// README: importers by the old package name are not rewritten, and the manifest is re-serialised.
	"p4-t2-23bb|last|2#0": "docs",
	"p4-t2-23bb|task|2#0": "docs",
	"p4-t2-23bb|task|4#0": "docs",
	// README says only the source package gets a `link:` entry; the loop adds one per importing package.
	"p1-t2-fb61|task|4#0": "docs",
	"p1-t2-fb61|task|3#0": "docs",
	// README says a move that makes the target depend on the source is refused: every move does that.
	"p2-t2-f590|last|1#0": "docs",
	// Asks for tests of three real breakages: a partial write when a later row's source is missing,
	// target-package importers left on the old path, and the moved file's own relative imports.
	"p2-t2-f590|last|3#0": "defect",
	// The CLI has no test. True, and no criterion asks for one.
	"p2-t2-f590|task|1#0": "scope",
	"p1-t2-fb61|task|3#1": "scope",
};
const FAIL_CLASSES: Record<string, FailClass> = {
	// Task 2 is not built at task 1's head: its criteria fail, as the words say.
	"p3-t1-5148|last|4|c5": "real",
	"p3-t1-5148|last|4|c13": "real",
	"p3-t1-5148|last|3|c15": "real",
	// The plan's task 1 refuses what task 2 builds: at task 2's head, task 1's criteria fail.
	"p3-t2-9698|last|1|c1": "real",
	"p3-t2-9698|last|5|c2": "real",
	"p3-t2-9698|last|3|c3": "real",
	// There is no bin and no CLI at 741c832.
	"p4-t1-741c|last|4|c16": "real",
	// Importers that use the old package name (`@w/a/m0`) are not rewritten (apply.ts, bare specifiers).
	"p4-t2-23bb|task|4|c3": "real",
	// fsEnv.rewriteImports skips the target package; the README says every importer outside the source.
	"p2-t2-f590|task|3|c17": "real",
	// Only relative imports are walked, so the moved file's bare imports never reach the target's manifest.
	"p3-t2-9698|last|2|c14": "real",
};

if (process.env.SHOW === "1") {
	console.log(`# ${findings.length} findings, ${foundDrawn.length} drawn`);
	for (const f of foundDrawn) console.log(JSON.stringify(f));
	console.log(`# ${fails.length} fails on the counted pairs, ${failsDrawn.length} drawn`);
	for (const f of failsDrawn) console.log(JSON.stringify(f));
} else {
	const tally = <C extends string>(keys: readonly string[], classes: Record<string, C>) => {
		const read = keys.filter((k) => classes[k] !== undefined);
		const out: Record<string, number> = {read: read.length};
		for (const k of read) out[classes[k] as string] = (out[classes[k] as string] ?? 0) + 1;
		return out;
	};
	results.read = {
		findings: {
			all: findings.length,
			drawn: foundDrawn.map((f) => ({key: f.key, class: FINDING_CLASSES[f.key] ?? null})),
			tally: tally(
				foundDrawn.map((f) => f.key),
				FINDING_CLASSES,
			),
		},
		fails: {
			all: fails.length,
			drawn: failsDrawn.map((f) => ({key: f.key, class: FAIL_CLASSES[f.key] ?? null})),
			tally: tally(
				failsDrawn.map((f) => f.key),
				FAIL_CLASSES,
			),
		},
	};
	writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
	console.log(JSON.stringify(results.read, null, 1));
}
