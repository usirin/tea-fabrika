// Experiment 112: how noisy is the reviewer, on its own? No lane and no builder. Each pair is one
// commit 105b's passes left, with the criteria book as it stood when the lane reviewed that commit.
// Each pair is judged REPEAT times by each model, as a task review (the task's own criteria,
// `<plan>/tasks/<task>`) and as a last review (the whole book, `<plan>/book`). Write-up:
// 112-reviewer-noise.md.
//
// The review path is the lane's own (packages/fabrika/src/pipeline/hosted/review-local.ts), minus
// tea-host: the review machine, unchanged, with its read and its Subs, over `localCodeHost` on a
// copy of the branch at the commit, the one check 105 ran there (the lockfile), the same rubrics,
// and the live reviewer reading the same copy. The book comes from a ledger in memory that holds
// the facts the lane had written by then: the plan as drafted, then every earlier review's rows and
// findings, in order (./112-reviewer-noise/inputs.json, taken from 105b's logs by extract.ts). So
// `localCodeHost` reads the criteria the way the lane's review read them. Nothing is kept: no row
// goes to any book, and the lane's rules play no part.
//
// MODELS=haiku,claude-sonnet-5-5  REPEAT=5  PAIRS=<ids, comma>  CONCURRENCY=4  CAP_USD=3.8
// ONLY_CHECK=1: build every book and compare its sizes with the lane's rows, with no agent run.
// Needs CLAUDE_CODE_OAUTH_TOKEN for a real run. Results: results/112-reviewer-noise.json (`runs`),
// kept after each review, so a run stopped part way goes on from where it was.
//
// Node at the edge: the copies are made with git through execFileSync, and the results file is
// read and written with readFileSync and writeFileSync.
import {execFileSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {run} from "@demlik/tea/effect";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Exit, Layer, Schema} from "effect";
import {type Fact, memoryLedger} from "../packages/fabrika/src/pipeline/asks/ledger.ts";
import {bookOf, criteriaOf, foldLedger} from "../packages/fabrika/src/pipeline/asks/rules.ts";
import {
	bookTarget,
	localCodeHost,
	taskTarget,
} from "../packages/fabrika/src/pipeline/code-host-local.ts";
import {currentOf} from "../packages/fabrika/src/pipeline/criteria/book.ts";
import {
	type Owner,
	PLAN,
	planOf,
	type TaskId,
	taskId,
	ticketId,
	ticketOf,
} from "../packages/fabrika/src/pipeline/ids.ts";
import {CodeHost} from "../packages/fabrika/src/pipeline/services.ts";
import {PlanDraft, revisionOfDraft} from "../packages/fabrika/src/pipeline/stages/plan/plan.ts";
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
import type {Judged, PassInput} from "./112-reviewer-noise/extract.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/112-reviewer-noise.json");
const INPUTS: Record<string, PassInput> = JSON.parse(
	readFileSync(here("112-reviewer-noise/inputs.json"), "utf8"),
);
const env = (k: string, d: string) => process.env[k] ?? d;
const MODELS = env("MODELS", "haiku,claude-sonnet-5-5").split(",");
const REPEAT = Number(env("REPEAT", "5"));
const CONCURRENCY = Number(env("CONCURRENCY", "4"));
const CAP_USD = Number(env("CAP_USD", "3.8"));
const ONLY_CHECK = env("ONLY_CHECK", "") === "1";
// The lockfile check runs pnpm: the real binary first on the path, as 105 does.
process.env.PATH = [process.env.PNPM_DIR, dirname(process.execPath), process.env.PATH]
	.filter((p) => p !== undefined && p !== "")
	.join(":");

/** As 105b's review step: effort low, at most $0.4 a run. Only the model changes. */
const settingsOf = (model: string): Settings => ({model, effort: "low", budget: 0.4});

/**
 * The pairs: a pass, the review of the lane whose book and head are judged again (the book as it
 * stood just before that review ran), and the task.
 */
interface Pair {
	readonly id: string;
	readonly pass: string;
	readonly before: string;
	readonly task: TaskId;
	readonly why: string;
}
const PAIRS: readonly Pair[] = [
	{
		id: "p2-t2-f590",
		pass: "pass2",
		before: "lane:700:t2:r5:review",
		task: taskId("t2"),
		why: "the c6 case: the task review passed c6, the last review failed it, same commit",
	},
	{
		id: "p3-t2-9698",
		pass: "pass3",
		before: "lane:700:t2:r8:review",
		task: taskId("t2"),
		why: "c5, the whole job on one task: failed in 9 reviews of 9; here the only one open",
	},
	{
		id: "p3-t1-5148",
		pass: "pass3",
		before: "lane:700:t1:r4:review",
		task: taskId("t1"),
		why: "judged twice by the lane: c1 and c2 failed, then passed, same commit",
	},
	{
		id: "p4-t2-23bb",
		pass: "pass4",
		before: "lane:700:t2:r2:review",
		task: taskId("t2"),
		why: "the task review failed c13 (review-added); the last review failed c1 and c10",
	},
	{
		id: "p4-t1-741c",
		pass: "pass4",
		before: "lane:700:t1:r7:review",
		task: taskId("t1"),
		why: "the last review failed 8, 5 of them passed by their task's own review",
	},
	{
		id: "p1-t2-fb61",
		pass: "pass1",
		before: "lane:700:t2:r7:review",
		task: taskId("t2"),
		why: "judged three times by the lane at one commit: unseen, a finding, a fail",
	},
];
const chosen = new Set(env("PAIRS", PAIRS.map((p) => p.id).join(",")).split(","));

const PLAN_ID = planOf(ticketId("example/repo#700"));

/** The task or `plan` a lane review's child name is for: `lane:700:t2:r5:review`, `lane:700:final:r1:review`. */
const ownerOf = (name: string): Owner => {
	const part = name.split(":")[2] ?? "";
	return part === "final" ? PLAN : taskId(part);
};

/** The facts the lane had written when `before` started: the plan, then each earlier review's round. */
const factsFor = (pair: Pair): {facts: Fact[]; head: string; lane: Judged[]} => {
	const input = INPUTS[pair.pass];
	if (input === undefined) throw new Error(`no inputs for ${pair.pass}`);
	const drafted = Schema.decodeUnknownExit(PlanDraft)(input.draft);
	const data = Exit.isSuccess(drafted) ? revisionOfDraft(drafted.value) : null;
	if (data === null) throw new Error(`${pair.pass}: the plan does not read`);
	const at = input.reviews.findIndex((r) => r.name === pair.before);
	const target = input.reviews[at];
	if (target === undefined) throw new Error(`${pair.pass}: no review ${pair.before}`);
	const facts: Fact[] = [
		{type: "planned", plan: PLAN_ID, tickets: [ticketOf(PLAN_ID)], data, problems: []},
	];
	for (const r of input.reviews.slice(0, at)) {
		// As the lane: a review with no row keeps no round (stages/review/program.ts, `judgementOf`).
		if (r.rows.length === 0) continue;
		const task = ownerOf(r.name);
		const proof = `the review of ${task === PLAN ? bookTarget(PLAN_ID) : taskTarget(PLAN_ID, task)} at ${r.head}`;
		facts.push({
			type: "judged",
			plan: PLAN_ID,
			task,
			head: r.head,
			proof,
			rows: r.rows.map((row) => ({...row, head: r.head, proof})),
			found: r.found,
		} as Fact);
	}
	// What the lane itself said at this head: every review of it, the one asked about and after.
	const lane = input.reviews.filter((r) => r.head === target.head);
	return {facts, head: target.head, lane};
};

/** A copy of the pass's repository with the head checked out, and `origin/main` where main was. */
const copyOf = (pass: string, head: string): string => {
	const dir = join(mkdtempSync(join(tmpdir(), "exp112-")), "tree");
	const git = (args: string[]) =>
		execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
	git(["clone", "-q", here(`112-reviewer-noise/repos/${pass}.bundle`), dir]);
	git(["-C", dir, "checkout", "-q", "--detach", head]);
	return dir;
};

/** One run, as the results keep it. */
interface Ran {
	readonly pair: string;
	readonly model: string;
	readonly as: "task" | "last";
	readonly k: number;
	readonly ended: string;
	readonly head: string | null;
	readonly cost: number;
	readonly runs: number;
	readonly ms: number;
	/** Each criterion the review was given, by id: `pass`, `fail`, or `none` (unseen, or no row). */
	readonly grades: Record<string, "pass" | "fail" | "none">;
	/** Findings on a criterion of the book: they hold that row open. */
	readonly onCriteria: readonly {id: string; fault: string; wants: string}[];
	/** Findings no criterion covers: each would become a new criterion of the book. */
	readonly found: readonly {
		from: unknown;
		kind: string;
		fault: string;
		wants: string;
		at: unknown;
	}[];
	readonly problems: readonly string[];
}

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
								? c.findings.map((f) => ({
										from: f.from,
										kind: f.kind,
										fault: f.fault,
										wants: f.wants,
										at: f.at,
									}))
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

const check = () => {
	const rows: unknown[] = [];
	for (const pair of PAIRS) {
		const {facts, head, lane} = factsFor(pair);
		const state = foldLedger(memoryLedger(facts).read());
		const book = bookOf(state, PLAN_ID);
		const task = criteriaOf(state, PLAN_ID, pair.task);
		const all = book === null ? [] : currentOf(book);
		const row = {
			pair: pair.id,
			head: head.slice(0, 12),
			task: task.map((c) => c.id),
			book: all.length,
			lane: lane.map((r) => ({
				name: r.name,
				ended: r.ended,
				rows: r.rows.length,
				failed: r.rows.filter((x) => x.grade === "fail").map((x) => x.criterion),
				found: r.found.length,
			})),
		};
		rows.push(row);
		console.log(JSON.stringify(row));
	}
	return rows;
};

const pairsInfo = () =>
	PAIRS.map((pair) => {
		const {facts, head, lane} = factsFor(pair);
		const state = foldLedger(memoryLedger(facts).read());
		const book = bookOf(state, PLAN_ID);
		return {
			...pair,
			head,
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
	check();
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
