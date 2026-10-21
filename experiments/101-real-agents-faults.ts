// Experiment 101: real Claude agents behind packages/tea-host, with the answerer's host killed
// mid-question. Does "one right answer per question" still hold, how many paid agent runs does a
// takeover waste, and can the new owner resume the dead owner's Claude session?
//
//   ONLY=laws    the new answer machine's laws and planted mistakes (no Docker, no key)
//   ONLY=probe   what the Agent SDK's session store and resume do, in the container (REAL=1)
//   ONLY=runs    the fault runs (REAL=1): MODES=fresh,resume,fresh,resume, N=30 questions each
//
// REAL=1 needs CLAUDE_CODE_OAUTH_TOKEN set in this shell. Only whether it is set is read here: the
// containers get it by name (`docker run -e CLAUDE_CODE_OAUTH_TOKEN`), so its value is never on a
// command line, in a file, in the image or in a log. Every container, the image and the volume
// carry the name `exp101` and are removed at the end (KEEP_IMAGE=1 keeps the image and volume).
//
// Node at the edge, as in 93 to 100: process groups, signals and `docker`, through 98's harness.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {here, parse} from "./98-tea-host-package/harness.ts";
import {
	DOCKER101,
	prepare,
	probe,
	removeContainers,
	unprepare,
} from "./101-real-agents-faults/docker.ts";

const RESULTS = here("results/101-real-agents-faults.json");
const results: Record<string, unknown> = existsSync(RESULTS)
	? parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);

const ONLY = new Set((process.env.ONLY ?? "laws,probe,runs").split(","));
const REAL = process.env.REAL === "1";
const MODEL = process.env.MODEL ?? "haiku";
const MODES = (process.env.MODES ?? "fresh,resume,fresh,resume").split(",");
const N = Number(process.env.N ?? "30");
const KEEP_LOGS = process.env.KEEP_LOGS;
/** Stop starting runs once the agent spend passes this. */
const BUDGET_USD = Number(process.env.BUDGET_USD ?? "3");

if (ONLY.has("laws")) {
	const {checkAnswerer} = await import("./101-real-agents-faults/laws.ts");
	const r = checkAnswerer(Number(process.env.ANSWER_DEPTH ?? "8"));
	console.log(`\n## laws: ${r.machine} (${r.states} states, ${r.ms} ms, complete: ${r.complete})`);
	for (const l of r.laws) console.log(`${r.broken[l] === undefined ? "HOLDS" : "BROKEN"}  ${l}`);
	for (const [l, path] of Object.entries(r.broken)) console.log(`  broken: ${l}: ${path}`);
	for (const p of r.planted) console.log(`${p.caught ? "caught" : "MISSED"}  planted "${p.name}"`);
	if (r.unsent.length > 0) console.log(`never sent: ${r.unsent.join(", ")}`);
	results.laws = r;
	save();
}

// Only whether it is set is read here; the value stays in this process's environment.
const tokenSet = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "") !== "";
const wantsReal = ONLY.has("probe") || ONLY.has("runs");
if (wantsReal && !(REAL && tokenSet))
	console.log("probe and runs need REAL=1 and CLAUDE_CODE_OAUTH_TOKEN set in this shell; skipped.");
if (wantsReal && REAL && tokenSet) {
	const before = removeContainers();
	if (before > 0) console.log(`removed ${before} containers left by an earlier run`);
	const prep = prepare();
	console.log(`image built in ${prep.buildMs} ms; node_modules installed in ${prep.installMs} ms`);
	try {
		if (ONLY.has("probe")) {
			const lines = await probe(MODEL);
			for (const l of lines) console.log(JSON.stringify(l));
			results.probe = {model: MODEL, lines, at: new Date().toISOString().slice(0, 10)};
			save();
		}
		if (ONLY.has("runs")) {
			const {runFaulted} = await import("./101-real-agents-faults/run.ts");
			const runs: unknown[] = [];
			let spent = 0;
			for (const [i, mode] of MODES.entries()) {
				if (mode !== "fresh" && mode !== "resume") throw new Error(`no mode called ${mode}`);
				if (spent > BUDGET_USD) {
					console.log(`spent $${spent.toFixed(4)}, past the $${BUDGET_USD} budget: stopping`);
					break;
				}
				const r = await runFaulted({mode, n: N, index: i + 1, model: MODEL});
				spent += r.usd.total;
				if (KEEP_LOGS !== undefined) {
					mkdirSync(KEEP_LOGS, {recursive: true});
					writeFileSync(join(KEEP_LOGS, `run-${i + 1}-${mode}.jsonl`), r.logs.join("\n"));
				}
				const {logs: _logs, ...kept} = r;
				console.log(JSON.stringify({run: i + 1, mode, pass: kept.pass, usd: kept.usd}, null, 1));
				runs.push(kept);
				results.runs = runs;
				results.spentUsd = spent;
				save();
			}
		}
	} finally {
		const left = removeContainers();
		const un = unprepare();
		console.log(
			`removed ${left} containers; image and volume ${un.removed ? "removed" : "kept (KEEP_IMAGE=1)"} (${DOCKER101.label})`,
		);
	}
}
