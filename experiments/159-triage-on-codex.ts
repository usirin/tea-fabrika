// Experiment 159: does GPT sol through Codex triage as well as opus did? Experiment 135 is the one
// place with hard evidence that the model matters for triage (the step the code still calls
// `sort`): opus closed 32 of 58 answers on phoenix's missed "no"s, sonnet 6. This runs 135's cases,
// briefs and scoring (`lib/triage-135.ts`, moved out of 135 unchanged) on GPT sol through this
// repo's Codex adapter (`@kampus/fabrika/agents/codex`, experiment 156's `codex exec --json`, with
// experiment 153's containment). Only the model and the harness change. The calls, sorts and
// tables are in `lib/triage-codex.ts`, shared with experiment 161.
//
//   group p  kamp-us/phoenix, 92b's "both" brief, one call. 135 sent its one line of system
//            prompt as the SDK's system prompt; Codex has no such field in the adapter, so it
//            leads the prompt here.
//   group d  kamp-us/demlik, today's sort brief and Check, up to two tries, as in 135.
//
// Run with
//   node experiments/159-triage-on-codex.ts
//
//   STEP=sort    CONFIG=sol-medium|sol-high, GROUP=p or d, SET=misses|controls|keep|all (default
//                all), ONLY=<n,n>, RUNS (default 2), CONCURRENCY (default 2), PROMPT=1 prints the
//                first prompt and stops
//   STEP=field   print one field/runs.jsonl row per sort
//   (no STEP)    the tables, beside 135's opus and the saved sonnet. WHY=1 adds each answer's why
//
// It reads 135's ticket cache (`runs/exp-135-cache`; make it with 135's STEP=fetch). Codex runs on
// the laptop's ChatGPT plan: run it with no `OPENAI_API_KEY` or `CODEX_API_KEY` in the
// environment, and the adapter hands none on either way.
import {join} from "node:path";
import {SYSTEM} from "./lib/sort.ts";
import {dBrief, PICKED, pPrompt, SETS} from "./lib/triage-135.ts";
import {
	fieldRows,
	printTables,
	printTurns,
	resultsAt,
	savedColumns,
	sortStep,
} from "./lib/triage-codex.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-135-cache");
const STEP = process.env.STEP ?? "tables";
const GROUP = process.env.GROUP === "d" ? "d" : "p";
const {saved, save, poolsOf} = resultsAt(join(here, "results", "159-triage-on-codex.json"));

const CONFIGS = {
	"sol-medium": {effort: "medium", label: "GPT sol, medium effort"},
	"sol-high": {effort: "high", label: "GPT sol, high effort"},
} as const;
type ConfigId = keyof typeof CONFIGS;
const CONFIG_IDS = Object.keys(CONFIGS) as ConfigId[];

if (STEP === "sort") {
	const id = (process.env.CONFIG ?? "") as ConfigId;
	const c = CONFIGS[id];
	if (c === undefined) {
		console.error(`CONFIG is one of ${CONFIG_IDS.join(", ")}`);
		process.exit(1);
	}
	const set = process.env.SET ?? "all";
	await sortStep({
		name: "exp-159",
		group: GROUP,
		cache: CACHE,
		wanted:
			set === "all"
				? PICKED[GROUP]
				: set === "misses" || set === "controls" || set === "keep"
					? SETS[GROUP][set]
					: [],
		only: process.env.ONLY?.split(",").map(Number),
		runs: Number(process.env.RUNS ?? 2),
		concurrency: Number(process.env.CONCURRENCY ?? 2),
		effort: c.effort,
		label: `${id}, set ${set}`,
		pools: poolsOf(id),
		save,
		pPromptOf: (all, t) => `${SYSTEM}\n\n${pPrompt(all, t)}`,
		dBriefOf: dBrief,
		dEdit: (prompt) => prompt,
		printPrompt: process.env.PROMPT === "1",
	});
	process.exit(0);
}

if (STEP === "field") {
	for (const id of CONFIG_IDS) {
		const pools = saved.configs[id];
		if (pools === undefined) continue;
		fieldRows({
			pools,
			effort: CONFIGS[id].effort,
			date: "2026-10-27",
			note: "2026-10-27-04",
			what: {
				p: `experiment 159 group p: 92b's "both" brief`,
				d: "experiment 159 group d: today's sort brief and Check",
			},
		});
	}
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

const ours = CONFIG_IDS.flatMap((id) => {
	const pools = saved.configs[id];
	return pools === undefined ? [] : [{id, label: CONFIGS[id].label, pools}];
});
for (const o of ours) printTurns(o.label, o.pools);
printTables({
	columns: [...savedColumns(), ...ours],
	ours: ours.map((o) => o.pools),
	cut: process.env.SAME === "1",
	each: process.env.EACH !== "0",
	why: process.env.WHY === "1",
	cutNote: "(only tickets GPT sol ran)",
	eachNote: "every ticket GPT sol ran (* not right; for real yeses in group p, a no or duplicate):",
});
