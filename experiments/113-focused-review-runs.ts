// Experiment 113: focused review runs. 112's heads and books (./112-reviewer-noise/pairs.ts), each
// judged by a trio of opus runs at effort medium, as a task review and as a last review. Each run of
// a trio has its own focus added to its prompt (`FOCUSES`, below; `focus` in
// packages/fabrika/src/pipeline/stages/review/reviewer.ts). The count joins a trio's three forms:
// a row fails if any run fails it. Write-up: 113-focused-review-runs.md. The count:
// ./113-focused-review-runs/count.ts.
//
// The review path is 112's: the review machine, unchanged, with its read and its Subs, over
// `localCodeHost` on a copy of the pass's repository at the head, the lockfile check 105 ran, the
// same rubrics, and the live reviewer reading the same copy. The only change is the reviewer's
// focus. Nothing is kept: no row goes to any book.
//
// TRIOS=2  PAIRS=<ids, comma>  CONCURRENCY=6  CAP_USD=24  BUDGET=1  OUT=<name>
// FOCUS=A,B,C and KINDS=task,last: the focuses and kinds run (the pilot: one pair, task only).
// Jobs run trio by trio, so a cap cuts the last trio, not the first. Inside a trio, pair by pair,
// task review first, so a cut leaves whole groups where it can.
// Needs CLAUDE_CODE_OAUTH_TOKEN. Results: results/113-focused-review-runs.json (`runs`), kept after
// each review, so a run stopped part way goes on from where it was.
//
// Node at the edge: the copies are made with git through execFileSync and spawnSync, and the
// results file is read and written with readFileSync and writeFileSync.
import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {run} from "@demlik/tea/effect";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Layer} from "effect";
import {memoryLedger} from "../packages/fabrika/src/pipeline/asks/ledger.ts";
import {
	bookTarget,
	localCodeHost,
	taskTarget,
} from "../packages/fabrika/src/pipeline/code-host-local.ts";
import {CodeHost} from "../packages/fabrika/src/pipeline/services.ts";
import {
	reviewReadInterpret,
	reviewSubscribe,
} from "../packages/fabrika/src/pipeline/stages/review/handlers.ts";
import {type Review, review} from "../packages/fabrika/src/pipeline/stages/review/machine.ts";
import {
	liveReviewer,
	type Settings,
} from "../packages/fabrika/src/pipeline/stages/review/reviewer.ts";
import {RUBRICS} from "../packages/fabrika/src/pipeline/stages/review/scripted.ts";
import {LOCKFILE_CHECK} from "./105-the-plan-lane-dry-run/world.ts";
import {type Found, factsFor, PAIRS, type Pair, PLAN_ID} from "./112-reviewer-noise/pairs.ts";
import {
	COUNTED,
	FOCUSES,
	type FocusedRan,
	type FocusId,
} from "./113-focused-review-runs/focuses.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const env = (k: string, d: string) => process.env[k] ?? d;
const RESULTS = here(`results/${env("OUT", "113-focused-review-runs")}.json`);
const MODEL = "opus";
const TRIOS = Number(env("TRIOS", "2"));
const CONCURRENCY = Number(env("CONCURRENCY", "6"));
const CAP_USD = Number(env("CAP_USD", "24"));
const BUDGET = Number(env("BUDGET", "1"));
const FOCUS = env("FOCUS", "A,B,C").split(",") as FocusId[];
const KINDS = env("KINDS", "task,last").split(",") as ("task" | "last")[];
const chosen = new Set(env("PAIRS", COUNTED.join(",")).split(","));
process.env.PATH = [process.env.PNPM_DIR, dirname(process.execPath), process.env.PATH]
	.filter((p) => p !== undefined && p !== "")
	.join(":");

const settings: Settings = {model: MODEL, effort: "medium", budget: BUDGET};

/** A copy of the pass's repository with the head checked out, and `origin/main` where main was (112's). */
const copyOf = (pass: string, head: string): string => {
	const dir = join(mkdtempSync(join(tmpdir(), "exp113-")), "tree");
	const git = (args: string[]) =>
		execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
	git(["clone", "-q", here(`112-reviewer-noise/repos/${pass}.bundle`), dir]);
	git(["-C", dir, "checkout", "-q", "--detach", head]);
	const merged =
		spawnSync("git", ["-C", dir, "merge-base", "--is-ancestor", head, "origin/main"]).status === 0;
	if (merged) git(["-C", dir, "update-ref", "refs/remotes/origin/main", "origin/main^1"]);
	return dir;
};

const results: {settings?: unknown; focuses?: unknown; runs: FocusedRan[]} = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {runs: []};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
const keyOf = (r: Pick<FocusedRan, "pair" | "as" | "k" | "focus">) =>
	`${r.pair}|${r.as}|${r.k}|${r.focus}`;
const done = new Set(results.runs.map(keyOf));
let spent = results.runs.reduce((sum, r) => sum + r.cost, 0);
/** Runs in flight. Each keeps its whole budget aside, so the cap holds whatever a run costs. */
let inFlight = 0;
const mayStart = () => spent + (inFlight + 1) * BUDGET <= CAP_USD;

/** One review of `target` at the copy's head: the machine to its end, as the lane's child runs it. */
const reviewOnce = (target: string) =>
	Effect.gen(function* () {
		const handle = yield* run(review, {
			ctx: undefined,
			interpret: {
				...reviewReadInterpret,
				review_file_note: () => Effect.succeed("kept" as const),
			},
			subscribe: reviewSubscribe,
			terminal: (s: Review) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({
			type: "start",
			ask: {pr: target, head: null, rubrics: RUBRICS},
			settings,
		});
		return yield* runtime.done();
	}).pipe(Effect.scoped);

/** One trio's six runs on one pair: both kinds, each focus. */
const runPair = (pair: Pair, k: number) =>
	Effect.gen(function* () {
		const jobs = KINDS.flatMap((as) =>
			FOCUS.map((focus) => ({pair: pair.id, model: MODEL, as, k, focus})),
		).filter((job) => !done.has(keyOf(job)));
		if (jobs.length === 0) return;
		const {facts, head} = factsFor(pair);
		const tree = copyOf(pair.pass, head);
		const host = yield* Effect.provide(
			Effect.gen(function* () {
				return yield* CodeHost;
			}),
			localCodeHost({repo: tree, base: "origin/main", checks: [LOCKFILE_CHECK]}).layer.pipe(
				Layer.provide(memoryLedger(facts).layer),
			),
		);
		yield* Effect.forEach(
			jobs,
			(job) =>
				Effect.gen(function* () {
					// Wait for runs in flight to end before giving up on the cap: a job is skipped only when
					// nothing else is running and it still could not start.
					while (!mayStart() && inFlight > 0) yield* Effect.sleep("5 seconds");
					if (!mayStart()) return;
					inFlight += 1;
					const target = job.as === "task" ? taskTarget(PLAN_ID, pair.task) : bookTarget(PLAN_ID);
					const started = Date.now();
					const end = yield* reviewOnce(target).pipe(
						Effect.provideService(CodeHost, host),
						Effect.provide(liveReviewer({repo: () => tree, focus: FOCUSES[job.focus]})),
						Effect.ensuring(Effect.sync(() => (inFlight -= 1))),
					);
					if (end.phase !== "over") return yield* Effect.die(`stopped in ${end.phase}`);
					const {report} = end;
					const given = report.criteria.flatMap((c) => (c.from === "ticket" ? [c.id] : []));
					const ran: FocusedRan = {
						...job,
						ended: end.outcome.kind === "done" ? "done" : `${end.outcome.kind}:${end.outcome.why}`,
						head: report.head,
						cost: report.cost,
						runs: report.runs,
						ms: Date.now() - started,
						grades: Object.fromEntries(
							given.map((id) => [id, report.rows.find((r) => r.criterion === id)?.grade ?? "none"]),
						),
						onCriteria: report.criteria.flatMap((c) =>
							c.from === "ticket"
								? c.findings.map((f) => ({id: c.id, fault: f.fault, wants: f.wants}))
								: [],
						),
						found: report.criteria.flatMap((c) =>
							c.from === "review"
								? c.findings.map(
										(f): Found => ({
											from: f.from,
											kind: f.kind,
											fault: f.fault,
											wants: f.wants,
											at: f.at,
										}),
									)
								: [],
						),
						problems: report.problems,
					};
					spent += ran.cost;
					results.runs.push(ran);
					save();
					const fails = Object.entries(ran.grades)
						.filter(([, g]) => g !== "pass")
						.map(([id, g]) => `${id}:${g}`);
					console.log(
						`${keyOf(job)} ${ran.ended} $${ran.cost.toFixed(4)} ${Math.round(ran.ms / 1000)}s open=[${fails.join(" ")}] found=${ran.found.length} spent=$${spent.toFixed(3)}`,
					);
				}),
			{concurrency: CONCURRENCY, discard: true},
		);
	}).pipe(Effect.scoped);

results.settings = {model: MODEL, effort: "medium", budget: BUDGET};
results.focuses = FOCUSES;
save();
for (let k = 1; k <= TRIOS; k++)
	for (const pair of PAIRS.filter((p) => chosen.has(p.id))) {
		if (!mayStart()) break;
		console.log(`# trio ${k}, ${pair.id}: ${pair.why}`);
		await Effect.runPromise(runPair(pair, k).pipe(Effect.provide(nodeServices)));
	}
console.log(`spent $${spent.toFixed(3)} counted`);
