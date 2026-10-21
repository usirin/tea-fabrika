// Experiment 105: a plan's whole lane on tea-host, as a dry run on fake facts. The lane
// (packages/fabrika/src/pipeline/stages/lane/, hosted in ../hosted/lane.ts) takes #700's plan of
// three tasks to ONE pull request on a branch `plan/700`: it plans, builds each task in rounds
// (catch up with main by merge, build, review), folds a ticket sort sends it into a new version,
// runs a last review over the whole book, opens the pull request and ships it. Every child runs on
// tea-host under its own name, with its agent as its own child, and every outside write goes through
// 104's gate. Write-up: 105-the-plan-lane-dry-run.md.
//
// The world (./105-the-plan-lane-dry-run/): a fake GitHub with a real bare git repository on disk
// (fake.ts), a pnpm workspace shaped like demlik's where #700 was built, and scripted agents that
// work from marks (world.ts). The harness plays the owner: it approves each plan version, and
// answers a stuck task as the scenario says.
//
// ONLY: a comma list of A|B|C|C2|real (default A,B,C,C2).
//   A    the happy path with every bend: task 1's first review fails, #707 is filed while task 1
//        builds and sort folds it in (plan version 2), #711 is filed and sort closes it as a
//        duplicate, main moves with a lockfile conflict before version 2 is approved, task 3
//        breaks task 2's work and the last review reopens task 2. Two hosts deliver the plan at
//        once: exactly one may hold the lane
//   B    task 3 never meets one criterion: the owner is asked, says "keep going 1", is asked again,
//        and removes task 3. Tasks 1 and 2 ship
//   C    the happy path, its host killed inside task 2's build turn, a new host taking over
//   C2   the same, killed just after task 2's push and before its done row
//   real one pass of C's world with no kill, haiku as every agent (AGENT=real), the run stopped
//        at CAP_USD (4.5) counted. Asked about a stuck task, the owner says "keep going 2" the
//        first time and removes it the second. Needs
//        CLAUDE_CODE_OAUTH_TOKEN; writes to no real repository. KEY=<name> keeps it under another
//        results key, so a second pass keeps the first
//   AGENTS=<folder> (105b): the real pass's agents by step, from the fabrika.toml in
//        ./105-the-plan-lane-dry-run/agents/<folder> (`sonnet-builder`, `sonnet-builder-planner`);
//        a step it leaves out runs on haiku. OUT=<name>: the results file, e.g. 105b-sonnet-builder
// TTL_MS=1000. Results: results/105-the-plan-lane-dry-run.json.
//
// The laws, per run:
//   one pr       one pull request, merged, every criterion met at the head it merged at
//   closes       every ticket the plan covers closed, the duplicate closed as one
//   no rewrite   no push to plan/700 that did not move it forward (a rebase, a force-push)
//   ci once      the checks ran once on the pull request
//   once         no commit made twice (by its Fabrika-Key), no review row recorded twice
//   world (91)   one lane per ticket (no write from a fence that did not hold the lease); tested
//                with main at landing; only a passed head lands; a stuck task leaves an ask; the
//                lane ends
//   files        each task's commits touch the files its commit touched in #708
//
// Node at the edge, as 93 to 111: each host is its own process group, signalled whole. The Miniflare
// ledger and the fake GitHub run in this process.
import {type ChildProcess, execFileSync, spawn, spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {Effect} from "effect";
import {Miniflare} from "miniflare";
import {cast} from "../packages/fabrika/src/host/host.ts";
import {layerHttp} from "../packages/fabrika/src/host/http.ts";
import {Ledger} from "../packages/fabrika/src/host/ledger.ts";
import {ledgerOptions} from "../packages/fabrika/src/host/worker-options.ts";
import type {AnswerBody} from "../packages/fabrika/src/pipeline/asks/ask.ts";
import {readFacts, sendFact} from "../packages/fabrika/src/pipeline/asks/ledger.ts";
import {foldLedger, openAsks} from "../packages/fabrika/src/pipeline/asks/rules.ts";
import {currentOf} from "../packages/fabrika/src/pipeline/criteria/book.ts";
import {agentOf} from "../packages/fabrika/src/pipeline/hosted/agent.ts";
import {kidsOf} from "../packages/fabrika/src/pipeline/hosted/kids.ts";
import {laneOf} from "../packages/fabrika/src/pipeline/hosted/lane.ts";
import {sortName} from "../packages/fabrika/src/pipeline/hosted/sort.ts";
import {readOutcome} from "../packages/fabrika/src/pipeline/hosted/stage.ts";
import {planOf, ticketId} from "../packages/fabrika/src/pipeline/ids.ts";
import {git, issueUrl, REPO, startFake} from "./105-the-plan-lane-dry-run/fake.ts";
import {
	LATER,
	mainMove,
	makeTemplate,
	PLAN_NUMBER,
	SEEDS,
	TASK_FILES,
} from "./105-the-plan-lane-dry-run/world.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
/** `OUT`: another results file's name, as 105b keeps its passes in its own. */
const RESULTS = here(`results/${process.env.OUT ?? "105-the-plan-lane-dry-run"}.json`);
const HOST = here("105-the-plan-lane-dry-run/host.ts");
const only = new Set((process.env.ONLY ?? "A,B,C,C2").split(","));
const TTL_MS = Number(process.env.TTL_MS ?? 1000);
const REPEAT = Number(process.env.REPEAT ?? 3);
/** The results key for this run's scenario, when not its label: a second real pass keeps the first. */
const KEY = process.env.KEY;
const WAIT_MS = Number(process.env.WAIT_MS ?? 240_000);
// The hosts run pnpm (a lockfile made again, the lockfile check): the real binaries first on the
// path, as a shim that reads the home folder is slow under the hosts' own one.
const PATH = [process.env.PNPM_DIR, dirname(process.execPath), process.env.PATH]
	.filter((p) => p !== undefined && p !== "")
	.join(":");
process.env.PATH = PATH;

const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (text: string) => console.log(text);
const scratch = mkdtempSync(join(tmpdir(), "exp105-"));

// ---------------------------------------------------------------- process groups

type Line = Record<string, unknown>;
type Host = {
	name: string;
	proc: ChildProcess;
	pgid: number;
	lines: Line[];
	exited: Promise<number | null>;
	err: () => string;
};
const groups = new Set<number>();
const signal = (pgid: number, sig: NodeJS.Signals) => {
	// biome-ignore lint/plugin: node at the edge: signalling a process group that may be gone already
	try {
		process.kill(-pgid, sig);
	} catch {
		// the group is gone already
	}
};
const alive = (pgid: number) =>
	execFileSync("ps", ["-A", "-o", "pgid="], {encoding: "utf8"})
		.split("\n")
		.some((l) => Number(l.trim()) === pgid);
const killGroup = async (pgid: number) => {
	signal(pgid, "SIGCONT");
	signal(pgid, "SIGKILL");
	for (let i = 0; i < 100 && alive(pgid); i++) await sleep(20);
	groups.delete(pgid);
};
process.on("exit", () => {
	for (const g of groups) signal(g, "SIGKILL");
});

let hosts = 0;
const startHost = (env: Record<string, string>): Host => {
	const name = `h${++hosts}`;
	const work = mkdtempSync(join(scratch, `${name}-`));
	const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", HOST], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: {...process.env, PATH, TTL_MS: String(TTL_MS), HOST: name, WORK: work, ...env},
	});
	const pgid = Number(proc.pid);
	groups.add(pgid);
	const lines: Line[] = [];
	let buf = "";
	let err = "";
	proc.stdout?.on("data", (d: Buffer) => {
		buf += d.toString();
		const parts = buf.split("\n");
		buf = parts.pop() ?? "";
		for (const p of parts) if (p.trim().startsWith("{")) lines.push(JSON.parse(p));
	});
	proc.stderr?.on("data", (d: Buffer) => {
		err += d.toString();
	});
	const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
	return {
		name,
		proc,
		pgid,
		lines,
		exited,
		err: () => err.replace(/\/[^\s:)]+/g, "<path>").slice(-1500),
	};
};

// ---------------------------------------------------------------- the ledger and the fake

const mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
const url = (await mf.unsafeGetDirectURL()).origin;
let ledgers = 0;
let current = "";
const on = <A>(ledger: string, e: Effect.Effect<A, unknown, Ledger>) =>
	Effect.runPromise(e.pipe(Effect.orDie, Effect.provide(layerHttp({url, ledger})), Effect.scoped));
const fake = await startFake({
	dir: scratch,
	leaseOf: async (name) => {
		const lease = await on(
			current,
			Effect.gen(function* () {
				return yield* (yield* Ledger).lease(name);
			}),
		);
		return lease === null ? null : {fence: lease.fence, expiresAt: lease.expires_at};
	},
});
say("making the workspace template (pnpm, offline)");
const template = makeTemplate(scratch);

// ---------------------------------------------------------------- one run

const NOTE = "A pnpm workspace of small packages. Its tickets are bugs, features and chores.";
const SORT_SETTINGS = {model: "haiku", effort: "low", budget: 1, note: NOTE} as const;
const PLAN = planOf(ticketId(`${REPO}#${PLAN_NUMBER}`));
const LANE = laneOf(PLAN);
const BRANCH = `plan/${PLAN_NUMBER}`;

type Scenario = "A" | "B" | "C";
interface RunSpec {
	readonly label: string;
	readonly scenario: Scenario;
	/** Two hosts deliver the plan at once. */
	readonly twin?: boolean;
	readonly fault?: string;
	readonly faultName?: string;
	/** Every agent is Claude, on haiku; the run stops when the lane's spend reaches `CAP_USD`. */
	readonly real?: boolean;
	/** The real pass's `AGENTS`: which fabrika.toml picked each step's model (105b). */
	readonly agents?: string;
}

/** The real pass's spend cap, across every agent of the run. */
const CAP_USD = Number(process.env.CAP_USD ?? 4.5);
/**
 * The real pass's agents by step (105b): a folder under ./105-the-plan-lane-dry-run/agents/ whose
 * fabrika.toml picks each step's own model. Left out: every step on haiku, as 105 ran.
 */
const AGENTS = process.env.AGENTS ?? "";
/** The real pass's money per agent run, per child, and the hold a turn takes before it starts. */
const REAL_ENV = {
	AGENT: "real",
	BUDGET: "0.4",
	KID_USD: "0.9",
	HOLD_USD: "0.4",
	AGENTS_FROM: AGENTS === "" ? "" : here(`105-the-plan-lane-dry-run/agents/${AGENTS}`),
};

const waitFor = async (seen: () => boolean | Promise<boolean>, ms = WAIT_MS) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await seen()) return true;
		await sleep(100);
	}
	return false;
};

const castSort = (ledger: string, n: number) =>
	on(
		ledger,
		cast(
			sortName(n),
			"job",
			{ticket: issueUrl(n), tries: 2, settings: SORT_SETTINGS, usd: 5},
			"harness",
		),
	);

/** The round a kid name is for: `lane:700:t3:r4:build` is task t3, round 4. */
const roundOf = (kid: string) => {
	const m = /^lane:\d+:(t\d+):r(\d+):/.exec(kid);
	return m === null ? null : {task: m[1] ?? "", round: Number(m[2])};
};

const run = async (spec: RunSpec) => {
	const ledger = `exp105-${spec.label}-${Date.now().toString(36)}-${ledgers++}`;
	current = ledger;
	fake.reset(template, SEEDS);
	const t0 = Date.now();
	const later = spec.scenario === "A" ? [707, 711] : [];
	await on(
		ledger,
		Effect.gen(function* () {
			const l = yield* Ledger;
			for (const n of [PLAN_NUMBER, ...later]) yield* l.register(sortName(n), "harness");
		}),
	);
	const base = {
		LEDGER_URL: url,
		LEDGER_NAME: ledger,
		FAKE_URL: fake.url,
		REMOTE: fake.remote(),
		SCENARIO: spec.scenario,
		...(spec.real === true ? REAL_ENV : {}),
	};
	const started: Host[] = [];

	// Sort first: the ticket is sorted as needing a plan, on a host that serves sort only.
	await castSort(ledger, PLAN_NUMBER);
	const sorter = startHost({...base, SORTS: sortName(PLAN_NUMBER), DELIVER: ""});
	started.push(sorter);
	const sorted = await waitFor(
		async () => (await on(ledger, readOutcome(sortName(PLAN_NUMBER)))) !== null,
		60_000,
	);
	await killGroup(sorter.pgid);

	// Then the lane, from one host, or two at once.
	const laneEnv = {
		...base,
		SORTS: later.map(sortName).join(","),
		DELIVER: String(PLAN_NUMBER),
	};
	const first = startHost({
		...laneEnv,
		FAULT: spec.fault ?? "",
		FAULT_NAME: spec.faultName ?? "",
	});
	started.push(first);
	if (spec.twin === true) started.push(startHost(laneEnv));

	const lines = () => started.flatMap((h) => h.lines);
	const claimed = (name: string) => lines().some((l) => l.ev === "claim" && l.name === name);
	const outcome = () => on(ledger, readOutcome(LANE));

	// The owner, and the world moving on, as the scenario says.
	const asked: {
		id: string;
		for: string;
		version?: number;
		time?: number;
		why?: string;
		round: number | null;
		answer: AnswerBody | null;
	}[] = [];
	let filed = false;
	let moved = false;
	let faulted = false;
	let tookOver = false;
	const answer = (id: string, body: AnswerBody) =>
		on(
			ledger,
			sendFact({type: "answered", id, answer: body} as never, {id: `owner:${id}`, by: "owner"}),
		);
	const kidsNow = () =>
		on(
			ledger,
			Effect.gen(function* () {
				return (yield* (yield* Ledger).readStream(kidsOf(LANE))).flatMap((r) =>
					typeof r.id === "string" ? [r.id] : [],
				);
			}),
		);
	const tick = async () => {
		if (spec.scenario === "A" && !filed && claimed(`${LANE}:t1:r1:build`)) {
			filed = true;
			for (const n of later) {
				const seed = LATER[n];
				if (seed !== undefined) fake.file(seed);
				await castSort(ledger, n);
			}
		}
		if (spec.fault !== undefined && !faulted && first.lines.some((l) => l.ev === "fault")) {
			faulted = true;
			await first.exited;
			const next = startHost(laneEnv);
			started.push(next);
			tookOver = true;
		}
		const folded = foldLedger(await on(ledger, readFacts));
		for (const a of openAsks(folded)) {
			if (asked.some((x) => x.id === a.id)) continue;
			const kids = await kidsNow();
			const rounds = kids
				.map(roundOf)
				.filter((r) => r !== null && a.for === "stuck" && r.task === a.task)
				.map((r) => r?.round ?? 0);
			const row = {
				id: a.id,
				for: a.for,
				round: rounds.length === 0 ? null : Math.max(...rounds),
				answer: null as AnswerBody | null,
				...(a.for === "plan" ? {version: a.version} : {}),
				...(a.for === "stuck" ? {time: a.time, why: a.why} : {}),
			};
			asked.push(row);
			if (a.for === "plan") {
				if (spec.scenario === "A" && a.version === 2 && !moved) {
					moved = true;
					fake.moveMain("aa-shared, and structure-sweep depends on it", mainMove);
				}
				row.answer = {kind: "approve"};
			} else if (a.for === "stuck" && spec.scenario === "B") {
				row.answer = a.time === 1 ? {kind: "keep_going", rounds: 1} : {kind: "remove"};
			} else if (a.for === "stuck" && spec.real === true) {
				// A real agent stuck on a task: the owner gives it two more rounds first, as a person
				// would, then takes the task out so the rest can ship.
				row.answer = a.time === 1 ? {kind: "keep_going", rounds: 2} : {kind: "remove"};
			}
			if (row.answer !== null) await answer(a.id, row.answer);
		}
	};
	const spentSoFar = async () => {
		const kids = await kidsNow();
		return on(
			ledger,
			Effect.gen(function* () {
				const l = yield* Ledger;
				let usd = 0;
				for (const k of [...kids, sortName(PLAN_NUMBER)])
					usd += (yield* l.usage(agentOf(k)))?.used.usd ?? 0;
				return usd;
			}),
		);
	};
	let capped = false;
	let ticks = 0;
	const finished = await waitFor(
		async () => {
			await tick();
			if (spec.real === true && ++ticks % 50 === 0 && (await spentSoFar()) >= CAP_USD) {
				capped = true;
				for (const h of started) await killGroup(h.pgid);
				return true;
			}
			return (await outcome()) !== null;
		},
		spec.real === true ? 45 * 60_000 : WAIT_MS,
	);
	// The sorts filed late finish on their own.
	const sortsDone = await waitFor(async () => {
		for (const n of later) if ((await on(ledger, readOutcome(sortName(n)))) === null) return false;
		return true;
	}, 30_000);
	// A host started after the end finds nothing to do.
	const after = startHost(laneEnv);
	started.push(after);
	await sleep(3 * TTL_MS + 2000);
	const ms = Date.now() - t0;
	for (const h of started) await killGroup(h.pgid);
	const out = await outcome();

	// ---------------------------------------- what the run left
	const facts = await on(ledger, readFacts);
	const folded = foldLedger(facts);
	const kids = await kidsNow();
	const spend = await on(
		ledger,
		Effect.gen(function* () {
			const l = yield* Ledger;
			let usd = 0;
			const names = [...kids, sortName(PLAN_NUMBER), ...later.map(sortName)];
			for (const k of names) usd += (yield* l.usage(agentOf(k)))?.used.usd ?? 0;
			return usd;
		}),
	);
	const prs = fake.prs();
	const merged = prs.filter((p) => p.state === "merged");
	const pr = prs[0];
	const issues = fake.issues();
	const issue = (n: number) => issues.find((i) => i.number === n);
	const track = folded.plans.get(PLAN);
	const book = track?.book ?? null;
	const currentRows = book === null ? [] : currentOf(book);
	const headMerged = pr?.head ?? null;
	const metAt = currentRows.map((c) => {
		const v = book?.verdicts.findLast(
			(x) => x.criterion === c.id && x.version === c.version && x.head === headMerged,
		);
		return {id: c.id, task: c.task, grade: v?.grade ?? "none"};
	});
	// Commits on the plan's branch, each with its key: none may be there twice.
	const remote = fake.remote();
	const root = git(["-C", remote, "rev-list", "--max-parents=0", "main"]);
	const commits =
		fake.branchHead(BRANCH) === null
			? []
			: git([
					"-C",
					remote,
					"log",
					"--format=%H%x09%(trailers:key=Fabrika-Key,valueonly,separator=%x2C)",
					BRANCH,
					"--not",
					root,
				])
					.split("\n")
					.filter((l) => l !== "")
					.map((l) => {
						const [sha = "", key = ""] = l.split("\t");
						return {sha, key: key.trim()};
					});
	const keyCount = new Map<string, number>();
	for (const c of commits) if (c.key !== "") keyCount.set(c.key, (keyCount.get(c.key) ?? 0) + 1);
	// Review rows: a `judged` fact for the same task at the same head twice is one review recorded twice.
	const judged = facts.flatMap((e) =>
		e.fact.type === "judged" ? [`${e.fact.task}@${e.fact.head}`] : [],
	);
	const judgedTwice = [...new Set(judged.filter((k, i) => judged.indexOf(k) !== i))];
	// Each review as it judged, and each round as the stall rule counted it.
	const reviews = facts.flatMap((e) =>
		e.fact.type === "judged"
			? [
					{
						task: e.fact.task,
						head: e.fact.head.slice(0, 12),
						pass: e.fact.rows.filter((row) => row.grade === "pass").length,
						fail: e.fact.rows.filter((row) => row.grade === "fail").length,
						found: e.fact.found.length,
					},
				]
			: [],
	);
	const reviewed = facts.flatMap((e) =>
		e.fact.type === "reviewed" ? [{task: e.fact.task, open: e.fact.open}] : [],
	);
	const planned = (track?.versions ?? []).map((v) => ({
		version: v.version,
		tasks: v.data.tasks.map((t) => t.id),
		criteria: v.data.tasks.reduce((n, t) => n + t.criteria.length + 1, 0),
	}));
	// Files per task: what each task's build commits touched, against #708's commits.
	const files = (["t1", "t2", "t3"] as const).map((task) => {
		const touched = new Set<string>();
		for (const c of commits)
			if (c.key.includes(`:${task}:`) && c.key.includes(":build"))
				for (const f of git(["-C", remote, "show", "--format=", "--name-only", c.sha]).split("\n"))
					if (f !== "") touched.add(f);
		const want = new Set(TASK_FILES[task]);
		const both = [...want].filter((f) => touched.has(f));
		return {
			task,
			want: want.size,
			touched: touched.size,
			both: both.length,
			missed: [...want].filter((f) => !touched.has(f)),
			extra: [...touched].filter((f) => !want.has(f)),
		};
	});
	// Each catch-up merge, made again from its two parents: the files git left in conflict.
	const catchups = commits.flatMap((c) => {
		const parents = git(["-C", remote, "rev-list", "--parents", "-n", "1", c.sha]).split(" ");
		if (parents.length !== 3) return [];
		const redo = spawnSync(
			"git",
			[
				"-C",
				remote,
				"merge-tree",
				"--write-tree",
				"--name-only",
				parents[1] ?? "",
				parents[2] ?? "",
			],
			{encoding: "utf8"},
		);
		const conflicts = redo.status === 1 ? redo.stdout.split("\n\n")[0]?.split("\n").slice(1) : [];
		return [{key: c.key, conflicts: conflicts ?? []}];
	});
	// What each last review over the whole book failed, by the task each criterion belongs to.
	const taskOf = new Map<string, string>(currentRows.map((c) => [c.id, c.task]));
	const finals = facts.flatMap((e) =>
		e.fact.type === "judged" && e.fact.task === "plan"
			? [
					{
						head: e.fact.head.slice(0, 12),
						failed: [
							...new Set(
								e.fact.rows
									.filter((row) => row.grade === "fail")
									.map((row) => taskOf.get(row.criterion) ?? "?"),
							),
						],
					},
				]
			: [],
	);
	// A removed task's own change: none may be left at the head that merged. Two checks:
	// - each of its build commits has a revert in that head's history (git made the revert, so it
	//   undid exactly that commit), and
	// - a file only its build commits touched reads at that head as it read on main before it
	//   landed (both missing counts as the same).
	// A file is a task's when one of its build commits touched it, so a file that was in the
	// workspace before the plan is not counted just for being there.
	const removedTasks: readonly string[] = [...(track?.removed ?? [])];
	const filesOf = new Map<string, Set<string>>();
	const unreverted: string[] = [];
	const revertedAtHead =
		headMerged === null
			? new Set<string>()
			: new Set(
					[
						...git(["-C", remote, "log", "--format=%B", headMerged]).matchAll(
							/This reverts commit ([0-9a-f]{40})/g,
						),
					].map((m) => m[1]),
				);
	for (const c of commits) {
		const task = /:(t\d+):r\d+:build(#|$)/.exec(c.key)?.[1];
		if (task === undefined) continue;
		if (removedTasks.includes(task) && !revertedAtHead.has(c.sha))
			unreverted.push(`${c.key.split("#")[0]} not reverted`);
		const touched = git(["-C", remote, "show", "--name-only", "--format=", c.sha]).split("\n");
		const set = filesOf.get(task) ?? new Set<string>();
		for (const f of touched) if (f !== "") set.add(f);
		filesOf.set(task, set);
	}
	const liveFiles = new Set(
		[...filesOf].filter(([t]) => !removedTasks.includes(t)).flatMap(([, fs]) => [...fs]),
	);
	const landedOnto = fake.landings().findLast((l) => l.head === headMerged)?.onto ?? null;
	const blob = (at: string, f: string) =>
		spawnSync("git", ["-C", remote, "rev-parse", "-q", "--verify", `${at}:${f}`], {
			encoding: "utf8",
		}).stdout.trim();
	const leftovers =
		headMerged === null || landedOnto === null
			? []
			: [
					...unreverted,
					...[...filesOf]
						.filter(([t]) => removedTasks.includes(t))
						.flatMap(([, fs]) => [...fs].filter((f) => !liveFiles.has(f)))
						.filter((f) => blob(headMerged, f) !== blob(landedOnto, f)),
				];
	const log = fake.log();
	const pushes = log.filter((w) => w.op === "push");
	const allLines = lines();
	// 105b: what each agent step ran on, cost and did.
	const setup = [...new Set(allLines.filter((l) => l.ev === "setup").map((l) => String(l.said)))];
	/** An agent's step, from its stage's name: `lane:700:t1:r2:build:agent` is build. */
	const stepOf = (name: string) =>
		name.startsWith("sort:") ? "sort" : (/:(\w+):agent$/.exec(name)?.[1] ?? "?");
	const agentLines = allLines.filter((l) => l.ev === "agent");
	const byStep = (step: string) => {
		const of = agentLines.filter((l) => stepOf(String(l.name)) === step);
		return {
			turns: of.filter((l) => l.step === "hold").length,
			billed: of.filter((l) => l.step === "turn").reduce((s, l) => s + Number(l.usd ?? 0), 0),
		};
	};
	const steps = Object.fromEntries(
		["sort", "plan", "catchup", "build", "review"].map((s) => [s, byStep(s)]),
	);
	const billed = agentLines
		.filter((l) => l.step === "turn")
		.reduce((s, l) => s + Number(l.usd ?? 0), 0);
	// Did the builder fix what review named? Each review of a task against the next one of it: of
	// the criteria the first failed, how many the next passed.
	const fixes = (["t1", "t2", "t3"] as const).flatMap((task) => {
		const rounds = facts.flatMap((e) =>
			e.fact.type === "judged" && e.fact.task === task ? [e.fact] : [],
		);
		return rounds.slice(1).map((now, i) => {
			const before = rounds[i];
			const failed = (before?.rows ?? []).filter((r) => r.grade === "fail").map((r) => r.criterion);
			const passedNow = new Set(
				now.rows.filter((r) => r.grade === "pass").map((r) => String(r.criterion)),
			);
			return {
				task,
				round: i + 2,
				named: failed.length + (before?.found.length ?? 0),
				failed: failed.length,
				fixed: failed.filter((c) => passedNow.has(String(c))).length,
				found: before?.found.length ?? 0,
			};
		});
	});
	// Wasted agent turns: an ask held twice (a turn run again), and every turn spent on a task the
	// owner removed (its builds, catch-ups and reviews all came off).
	const holds = agentLines.filter((l) => l.step === "hold").map((l) => `${l.name}#${l.id}`);
	const heldTwice = holds.length - new Set(holds).size;
	// Each child as it ended: its outcome's name, its agent's turns and what they billed.
	const children = [];
	for (const kid of [sortName(PLAN_NUMBER), ...kids]) {
		const ended = (await on(ledger, readOutcome(kid)))?.outcome as {name?: string} | undefined;
		const of = agentLines.filter((l) => l.name === agentOf(kid));
		children.push({
			kid,
			ended: ended?.name ?? null,
			turns: of.filter((l) => l.step === "hold").length,
			billed: of.filter((l) => l.step === "turn").reduce((s, l) => s + Number(l.usd ?? 0), 0),
		});
	}
	const removedNow: readonly string[] = [...(track?.removed ?? [])];
	const onRemoved = agentLines.filter(
		(l) => l.step === "hold" && removedNow.some((t) => String(l.name).includes(`:${t}:`)),
	).length;
	// The hosts that ever held the lane's lease.
	const laneClaims = allLines.filter(
		(l) => l.ev === "phase" && l.name === LANE && l.to === "owning",
	);
	const result = {
		spec,
		ms,
		sorted,
		finished,
		sortsDone,
		outcome: out?.outcome ?? null,
		hosts: started.map((h) => h.name),
		after: after.name,
		tookOver,
		capped,
		// The laws.
		prs: prs.length,
		merged: merged.length,
		metAtHead: metAt.every((m) => m.grade === "pass") && metAt.length > 0,
		notMet: metAt.filter((m) => m.grade !== "pass"),
		criteria: metAt.length,
		removed: removedTasks,
		closes: [...(pr?.body.match(/^Closes #\d+$/gm) ?? [])] as string[],
		issues: issues.map((i) => ({n: i.number, state: i.state, reason: i.reason, labels: i.labels})),
		planClosed: issue(PLAN_NUMBER)?.state === "closed",
		rewrites: fake.rewrites(BRANCH),
		refusedPushes: pushes.filter((w) => w.why === "rejected").length,
		ci: pr?.ci.length ?? 0,
		landings: fake.landings(),
		late: log.filter((w) => w.late).length,
		unkeyed: log.filter((w) => w.key === null).length,
		commits: commits.length,
		commitsTwice: [...keyCount].filter(([, n]) => n > 1).map(([k]) => k),
		judged: judged.length,
		judgedTwice,
		reviews,
		reviewed,
		planned,
		files,
		asks: asked,
		laneClaims: laneClaims.map((l) => String(l.host)),
		catchups,
		finals,
		leftovers,
		turns: allLines.filter((l) => l.ev === "agent" && l.step === "hold").length,
		teaErrors: allLines.filter((l) => l.ev === "tea_error").map((l) => `${String(l.phase)}`),
		kids,
		spend,
		billed,
		setup,
		steps,
		fixes,
		children,
		wasted: {heldTwice, onRemoved},
		writes: log.map((w) => `${w.op}${w.applied ? "" : `(${w.why})`}`),
		errors: started.map((h) => `${h.name}: ${h.err()}`).filter((e) => !e.endsWith(": ")),
	};
	// A real pass is never run twice the same: its lines are kept every time.
	if (process.env.DEBUG === "1" || spec.real === true)
		writeFileSync(
			join(scratch, `lines-${spec.label}.jsonl`),
			allLines.map((l) => JSON.stringify(l)).join("\n"),
		);
	return result;
};
type Run = Awaited<ReturnType<typeof run>>;

// ---------------------------------------------------------------- the verdicts

const broke = (r: Run): string[] => {
	const out: string[] = [];
	const o = r.outcome as {name?: string} | null;
	if (!r.finished) out.push("the lane did not end");
	if (o?.name !== "done") out.push(`the lane ended ${JSON.stringify(r.outcome)}`);
	if (r.leftovers.length > 0) out.push(`a removed task's files are left: ${r.leftovers.join(",")}`);
	if (r.prs !== 1) out.push(`${r.prs} pull requests`);
	if (r.merged !== 1) out.push("the pull request did not merge");
	if (!r.metAtHead) out.push(`not met at the merged head: ${r.notMet.map((m) => m.id).join(",")}`);
	if (!r.planClosed) out.push("#700 is open");
	if (r.rewrites !== 0) out.push(`${r.rewrites} rewrites of ${BRANCH}`);
	if (r.refusedPushes !== 0) out.push(`${r.refusedPushes} refused pushes`);
	if (r.ci !== 1) out.push(`checks ran ${r.ci} times`);
	if (r.late !== 0) out.push(`${r.late} late writes`);
	if (r.unkeyed !== 0) out.push(`${r.unkeyed} unkeyed writes`);
	if (r.commitsTwice.length > 0) out.push(`commits twice: ${r.commitsTwice.join(",")}`);
	if (r.judgedTwice.length > 0) out.push(`reviews twice: ${r.judgedTwice.join(",")}`);
	if (r.landings.some((l) => !l.tested)) out.push("landed untested with main");
	if (r.landings.some((l) => !l.passed)) out.push("landed a head that had not passed");
	// Before the end, one host at a time held the lane: one in all, or one more per kill. No holder
	// seen is a law that could not look, never a pass.
	const holders = new Set(r.laneClaims.filter((h) => h !== r.after));
	if (holders.size === 0) out.push("no host was seen holding the lane");
	if (holders.size > (r.spec.fault === undefined ? 1 : 2))
		out.push(`the lane held by ${[...holders].join(",")}`);
	return [...out, ...bends(r)];
};

/** Each scenario's own bends happened, and ended as they should. */
const bends = (r: Run): string[] => {
	const out: string[] = [];
	const n = (k: number) => r.issues.find((i) => i.n === k);
	switch (r.spec.scenario) {
		case "A": {
			if (!r.asks.some((a) => a.for === "plan" && a.version === 2)) out.push("no plan version 2");
			if (!r.closes.includes("Closes #707")) out.push("the pull request does not close #707");
			if (n(707)?.state !== "closed") out.push("#707 is open");
			if (n(711)?.reason !== "duplicate") out.push("#711 is not closed as a duplicate");
			const lock = r.catchups.filter(
				(c) => c.conflicts.length === 1 && c.conflicts[0] === "pnpm-lock.yaml",
			);
			if (lock.length === 0) out.push("no catch-up met the lockfile conflict");
			if (!r.finals.some((f) => f.failed.includes("t2"))) out.push("no last review reopened t2");
			break;
		}
		case "B": {
			const first = r.asks.find((a) => a.for === "stuck");
			if (first === undefined) out.push("the owner was never asked about t3");
			else if ((first.round ?? 99) > 4) out.push(`the owner was asked at round ${first.round}`);
			if (!r.removed.includes("t3")) out.push("t3 was not removed");
			break;
		}
		case "C":
			if (r.spec.fault !== undefined && !r.tookOver) out.push("the fault never fired");
			break;
	}
	return out;
};

const filesMatch = (r: Run) => {
	const removed: readonly string[] = r.removed;
	const live = r.files.filter((f) => !removed.includes(f.task));
	const want = live.reduce((s, f) => s + f.want, 0);
	const both = live.reduce((s, f) => s + f.both, 0);
	const touched = live.reduce((s, f) => s + f.touched, 0);
	return {recall: want === 0 ? 0 : both / want, precision: touched === 0 ? 0 : both / touched};
};

const SPECS: Record<string, RunSpec> = {
	A: {label: "A", scenario: "A", twin: true},
	B: {label: "B", scenario: "B"},
	C: {
		label: "C",
		scenario: "C",
		fault: "agent-turn",
		faultName: agentOf(`${LANE}:t2:r1:build`),
	},
	C2: {label: "C2", scenario: "C", fault: "after-send:push", faultName: `${LANE}:t2:r1:build`},
	real: {label: "real", scenario: "C", real: true, ...(AGENTS === "" ? {} : {agents: AGENTS})},
};

for (const label of ["A", "B", "C", "C2", "real"]) {
	if (!only.has(label)) continue;
	const spec = SPECS[label];
	if (spec === undefined) continue;
	const runs: unknown[] = [];
	// One real pass: it costs money.
	for (let i = 1; i <= (spec.real === true ? 1 : REPEAT); i++) {
		say(`run ${label} #${i}`);
		const r = await run(spec);
		const verdict = {broke: broke(r), files: filesMatch(r)};
		say(`  ${label}: ${verdict.broke.length === 0 ? "held" : verdict.broke.join("; ")}`);
		say(
			`  ${(r.ms / 1000).toFixed(1)} s, ${r.kids.length} kids, $${r.spend.toFixed(2)} ${spec.real === true ? `counted, $${r.billed.toFixed(2)} billed` : "scripted"}, files ${(verdict.files.recall * 100).toFixed(0)}% / ${(verdict.files.precision * 100).toFixed(0)}%`,
		);
		say(
			`  asks: ${r.asks.map((a) => `${a.for}${a.version ?? ""}${a.time ?? ""}@r${a.round ?? "-"}`).join(" ")}`,
		);
		runs.push({...r, verdict});
		results[KEY ?? label] = {
			held: runs.filter((x) => (x as {verdict: {broke: string[]}}).verdict.broke.length === 0)
				.length,
			of: runs.length,
			runs,
		};
		save();
	}
}

await fake.close();
await mf.dispose();
say(`results: ${RESULTS}`);
process.exit(0);
