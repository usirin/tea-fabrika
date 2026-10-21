// Experiment 112: how noisy is the reviewer, on its own? No lane and no builder. Each pair is one
// commit 105b's passes left, with the criteria book as it stood when the lane reviewed that commit
// (./112-reviewer-noise/pairs.ts). Each pair is judged REPEAT times by each model, as a task review
// (the task's own criteria, `<plan>/tasks/<task>`) and as a last review (the whole book,
// `<plan>/book`). Write-up: 112-reviewer-noise.md. The count: ./112-reviewer-noise/count.ts.
//
// The review path is the lane's own (packages/fabrika/src/pipeline/hosted/review-local.ts), minus
// tea-host: the review machine, unchanged, with its read and its Subs, over `localCodeHost` on a
// copy of the branch at the commit, the one check 105 ran there (the lockfile), the same rubrics,
// and the live reviewer reading the same copy. The book comes from a ledger in memory that holds
// the facts the lane had written by then: the plan as drafted, then every earlier review's rows and
// findings, in order. So `localCodeHost` reads the criteria the way the lane's review read them.
// Nothing is kept: no row goes to any book, and the lane's rules play no part.
//
// MODELS=haiku,claude-sonnet-5-5  REPEAT=5  PAIRS=<ids, comma>  CONCURRENCY=4  CAP_USD=3.8
// OUT=<name>: results under another name (the pilot's: 112-pilot).
// ONLY_CHECK=1: build every book and compare its sizes with the lane's rows, with no agent run.
// Needs CLAUDE_CODE_OAUTH_TOKEN for a real run. Results: results/112-reviewer-noise.json (`runs`),
// kept after each review, so a run stopped part way goes on from where it was.
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
import {bookOf, criteriaOf, foldLedger} from "../packages/fabrika/src/pipeline/asks/rules.ts";
import {
	bookTarget,
	localCodeHost,
	taskTarget,
} from "../packages/fabrika/src/pipeline/code-host-local.ts";
import {currentOf} from "../packages/fabrika/src/pipeline/criteria/book.ts";
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
import {
	type Found,
	factsFor,
	PAIRS,
	type Pair,
	PLAN_ID,
	type Ran,
} from "./112-reviewer-noise/pairs.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const env = (k: string, d: string) => process.env[k] ?? d;
/** `OUT`: another results file, for a pilot that is not counted. */
const RESULTS = here(`results/${env("OUT", "112-reviewer-noise")}.json`);
const MODELS = env("MODELS", "haiku,claude-sonnet-5-5").split(",");
const REPEAT = Number(env("REPEAT", "5"));
const CONCURRENCY = Number(env("CONCURRENCY", "4"));
const CAP_USD = Number(env("CAP_USD", "3.8"));
const ONLY_CHECK = env("ONLY_CHECK", "") === "1";
const chosen = new Set(env("PAIRS", PAIRS.map((p) => p.id).join(",")).split(","));
// The lockfile check runs pnpm: the real binary first on the path, as 105 does.
process.env.PATH = [process.env.PNPM_DIR, dirname(process.execPath), process.env.PATH]
	.filter((p) => p !== undefined && p !== "")
	.join(":");

/** As 105b's review step: effort low, at most $0.4 a run. Only the model changes. */
const settingsOf = (model: string): Settings => ({model, effort: "low", budget: 0.4});

/** A copy of the pass's repository with the head checked out, and `origin/main` where main was. */
const copyOf = (pass: string, head: string): string => {
	const dir = join(mkdtempSync(join(tmpdir(), "exp112-")), "tree");
	const git = (args: string[]) =>
		execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
	git(["clone", "-q", here(`112-reviewer-noise/repos/${pass}.bundle`), dir]);
	git(["-C", dir, "checkout", "-q", "--detach", head]);
	// A pass that merged (pass 1) left main past the head, so the diff would be empty. Main goes back
	// to where it stood before the merge, as it was when the lane reviewed the head.
	const merged =
		spawnSync("git", ["-C", dir, "merge-base", "--is-ancestor", head, "origin/main"]).status === 0;
	if (merged) git(["-C", dir, "update-ref", "refs/remotes/origin/main", "origin/main^1"]);
	return dir;
};

const results: {pairs?: unknown; runs: Ran[]} = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {runs: []};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
const keyOf = (r: Pick<Ran, "pair" | "model" | "as" | "k">) =>
	`${r.pair}|${r.model}|${r.as}|${r.k}`;
const done = new Set(results.runs.map(keyOf));
let spent = results.runs.reduce((sum, r) => sum + r.cost, 0);

/** One review of `target` at the copy's head: the machine to its end, as the lane's child runs it. */
const reviewOnce = (target: string, settings: Settings) =>
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

const runPair = (pair: Pair) =>
	Effect.gen(function* () {
		const {facts, head} = factsFor(pair);
		const tree = copyOf(pair.pass, head);
		const ledger = memoryLedger(facts);
		// One reader for the pair: the lockfile check runs once at the head and is kept for every run.
		const host = yield* Effect.provide(
			Effect.gen(function* () {
				return yield* CodeHost;
			}),
			localCodeHost({repo: tree, base: "origin/main", checks: [LOCKFILE_CHECK]}).layer.pipe(
				Layer.provide(ledger.layer),
			),
		);
		const reviewer = liveReviewer({repo: () => tree});
		const jobs = MODELS.flatMap((model) =>
			Array.from({length: REPEAT}, (_, i) => i + 1).flatMap((k) =>
				(["task", "last"] as const).map((as) => ({pair: pair.id, model, as, k})),
			),
		).filter((job) => !done.has(keyOf(job)));
		yield* Effect.forEach(
			jobs,
			(job) =>
				Effect.gen(function* () {
					if (spent >= CAP_USD) return;
					const target = job.as === "task" ? taskTarget(PLAN_ID, pair.task) : bookTarget(PLAN_ID);
					const started = Date.now();
					const end = yield* reviewOnce(target, settingsOf(job.model)).pipe(
						Effect.provideService(CodeHost, host),
						Effect.provide(reviewer),
					);
					if (end.phase !== "over") return yield* Effect.die(`stopped in ${end.phase}`);
					const {report} = end;
					const given = report.criteria.flatMap((c) => (c.from === "ticket" ? [c.id] : []));
					const grades = Object.fromEntries(
						given.map((id) => [id, report.rows.find((r) => r.criterion === id)?.grade ?? "none"]),
					);
					const ran: Ran = {
						...job,
						ended: end.outcome.kind === "done" ? "done" : `${end.outcome.kind}:${end.outcome.why}`,
						head: report.head,
						cost: report.cost,
						runs: report.runs,
						ms: Date.now() - started,
						grades,
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
					const fails = Object.entries(grades)
						.filter(([, g]) => g !== "pass")
						.map(([id, g]) => `${id}:${g}`);
					console.log(
						`${keyOf(job)} ${ran.ended} $${ran.cost.toFixed(4)} ${Math.round(ran.ms / 1000)}s open=[${fails.join(" ")}] found=${ran.found.length} spent=$${spent.toFixed(3)}`,
					);
				}),
			{concurrency: CONCURRENCY, discard: true},
		);
	}).pipe(Effect.scoped);

/** Each pair's book and what the lane said at its head, with the task's criteria and the book's size. */
const pairsInfo = () =>
	PAIRS.map((pair) => {
		const {facts, head, lane} = factsFor(pair);
		const state = foldLedger(memoryLedger(facts).read());
		const book = bookOf(state, PLAN_ID);
		return {
			...pair,
			head,
			taskCriteria: criteriaOf(state, PLAN_ID, pair.task).map((c) => c.id),
			book: (book === null ? [] : currentOf(book)).map((c) => ({
				id: c.id,
				task: c.task,
				by: book?.live.find((e) => e.id === c.id)?.wordings[0].by ?? null,
				text: c.text,
			})),
			lane: lane.map((r) => ({
				name: r.name,
				ended: r.ended,
				grades: Object.fromEntries(r.rows.map((x) => [x.criterion, x.grade])),
				found: r.found,
			})),
		};
	});

if (ONLY_CHECK) {
	for (const p of pairsInfo())
		console.log(
			JSON.stringify({
				pair: p.id,
				head: p.head.slice(0, 12),
				task: p.taskCriteria,
				book: p.book.length,
				lane: p.lane.map((r) => ({
					name: r.name,
					ended: r.ended,
					rows: Object.keys(r.grades).length,
				})),
			}),
		);
} else {
	results.pairs = pairsInfo();
	save();
	for (const pair of PAIRS.filter((p) => chosen.has(p.id))) {
		if (spent >= CAP_USD) break;
		console.log(`# ${pair.id}: ${pair.why}`);
		await Effect.runPromise(runPair(pair).pipe(Effect.provide(nodeServices)));
	}
	console.log(`spent $${spent.toFixed(3)} counted`);
}
