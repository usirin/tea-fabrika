// Experiment 161: can one plain line each fix GPT sol's two weak spots on triage? Experiment 159
// found GPT sol through Codex closes phoenix's real "no"s far better than opus, but it closed two
// built security tickets (#2563, #8010) as "hardening with no incident", and it folded 6 of 26
// answers on 133's demlik controls into an open plan. This runs 159's harness, model and effort,
// with two lines added:
//
//   group p  kamp-us/phoenix, 92b's "both" brief with one more "still a yes" clause: a security gap
//            is not hardening.
//   group d  kamp-us/demlik, today's sort brief and Check with one more sentence after the fold
//            rule: sharing code with an open plan is not enough to fold.
//
// Everything else is 159's (`lib/triage-codex.ts`) and 135's (`lib/triage-135.ts`).
//
// Run with
//   node experiments/161-triage-security-line.ts
//
//   STEP=sort    GROUP=p or d, SET=built|misses|controls|folds|all (default all), ONLY=<n,n>,
//                RUNS (default 2), CONCURRENCY (default 2), PROMPT=1 prints the first prompt and stops
//   STEP=field   print one field/runs.jsonl row per sort
//   (no STEP)    the tables, beside 159's GPT sol, 135's opus and the saved sonnet, on the tickets
//                this run sorted. WHY=1 adds each answer's why
//
// It reads 135's ticket cache (`runs/exp-135-cache`; make it with 135's STEP=fetch). Codex runs on
// the laptop's ChatGPT plan: run it with no `OPENAI_API_KEY` or `CODEX_API_KEY` in the environment.
import {join} from "node:path";
import {SYSTEM} from "./lib/sort.ts";
import {
	CONTROLS,
	dBrief,
	P_BAR_SECURITY,
	P_FALSE_NO,
	P_KEEP,
	pPrompt,
	truth133,
} from "./lib/triage-135.ts";
import {
	fieldRows,
	P_MISSED,
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
const {saved, save, poolsOf} = resultsAt(join(here, "results", "161-triage-security-line.json"));
const saved159 = resultsAt(join(here, "results", "159-triage-on-codex.json")).saved;

const ID = "sol-lines";
const EFFORT = "medium";
const LABEL = "GPT sol, medium, with the two lines";

// ---------------------------------------------------------------- the two lines

/** The security line (`SECURITY` in `lib/triage-135.ts`, shared with 162). */
const P_BAR = P_BAR_SECURITY;

/** Today's fold rule ends with this sentence; the fold line goes right after it. */
const FOLD_RULE_END = "A report that starts work of its own has `partOf: null`.";
const FOLD_LINE =
	"Sharing code or files with an open plan is not enough for `partOf`: a separate bug, or a follow-up to a fix that already landed, is work of its own.";
/** The demlik prompt with the fold line in. Fails loudly if today's brief no longer has the rule. */
const withFoldLine = (prompt: string): string => {
	if (!prompt.includes(FOLD_RULE_END))
		throw new Error("the brief's fold rule changed: fix FOLD_RULE_END");
	return prompt.replace(FOLD_RULE_END, `${FOLD_RULE_END} ${FOLD_LINE}`);
};

// ---------------------------------------------------------------- the sets

/** The demlik folds 159's GPT sol got right at least once: the only right folds the line can cost. */
const FOLDS_RIGHT = [389, 424, 425, 426, 717];
const SETS161 = {
	p: {built: [...P_FALSE_NO, ...P_KEEP], misses: P_MISSED},
	d: {controls: CONTROLS, folds: FOLDS_RIGHT},
} as const;
for (const n of FOLDS_RIGHT)
	if (truth133.fold[n] === undefined) throw new Error(`#${n} is not one of 133's folds`);

if (STEP === "sort") {
	const set = process.env.SET ?? "all";
	const sets: Record<string, readonly number[]> = SETS161[GROUP];
	const wanted = set === "all" ? Object.values(sets).flat() : (sets[set] ?? []);
	if (wanted.length === 0) {
		console.error(`SET is all or one of ${Object.keys(sets).join(", ")} for group ${GROUP}`);
		process.exit(1);
	}
	await sortStep({
		name: "exp-161",
		group: GROUP,
		cache: CACHE,
		wanted,
		only: process.env.ONLY?.split(",").map(Number),
		runs: Number(process.env.RUNS ?? 2),
		concurrency: Number(process.env.CONCURRENCY ?? 2),
		effort: EFFORT,
		label: `${ID}, set ${set}`,
		pools: poolsOf(ID),
		save,
		pPromptOf: (all, t) => `${SYSTEM}\n\n${pPrompt(all, t, P_BAR)}`,
		dBriefOf: dBrief,
		dEdit: withFoldLine,
		printPrompt: process.env.PROMPT === "1",
	});
	process.exit(0);
}

const pools = saved.configs[ID];
if (STEP === "field") {
	if (pools !== undefined)
		fieldRows({
			pools,
			effort: EFFORT,
			date: "2026-10-27",
			note: "2026-10-27-02",
			what: {
				p: `experiment 161 group p: 92b's "both" brief plus "a security gap is not hardening"`,
				d: "experiment 161 group d: today's sort brief and Check plus one line against false folds",
			},
		});
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

if (pools === undefined) {
	console.error("no sorts yet: run STEP=sort first");
	process.exit(1);
}
const sol159 = saved159.configs["sol-medium"];
printTurns(LABEL, pools);
printTables({
	columns: [
		...savedColumns(),
		...(sol159 === undefined
			? []
			: [{id: "sol-159", label: "GPT sol, medium (159)", pools: sol159}]),
		{id: ID, label: LABEL, pools},
	],
	ours: [pools],
	cut: true,
	each: process.env.EACH !== "0",
	why: process.env.WHY === "1",
	cutNote: "(only tickets this run sorted)",
	eachNote:
		"every ticket this run sorted (* not right; for real yeses in group p, a no or duplicate):",
});
