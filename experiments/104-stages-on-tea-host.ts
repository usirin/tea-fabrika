// Experiment 104: each pipeline stage as a program on tea-host, killed and taken over, with no
// outside write sent twice (step S6). Ship, review, plan and build run their own machines,
// unchanged, under registered names on a Miniflare ledger; agents run as child programs with
// `limits`. Every write that leaves the ledger goes through the gate in
// packages/fabrika/src/pipeline/hosted/idempotency.ts. Write-up: 104-stages-on-tea-host.md.
//
// ONLY: a comma list of ship|review|plan|build|limits|plants (default all).
//   <stage>  a control run on one host; then KILLS runs, each with one planted SIGKILL at a fault
//            point (inside the agent's turn, after its answer before the answer row, before or
//            after an outside write before its done row), taken over by a second host process
//            with no working copy; then a freeze: the first host SIGSTOPped past its lease at the
//            point just before a send, the stage finished by another host, then the first woken
//   limits   a review whose child has a $0.05 cap and bills $0.10 a turn: it ends `limit:usd`,
//            and a second host does not start it again
//   plants   two planted mistakes, each must be seen to fail: a write sent with no key; a stage
//            that sends after losing its lease (the freeze, without the lease check)
// KILLS=20, TTL_MS=1000. Results: results/104-stages-on-tea-host.json.
//
// The laws, per run:
//   same       the outcome row equals the control's
//   once       no key reached the code host twice (every attempt counted, applied or not)
//   keyed      every write that reached the code host had a key, and that key an intent row
//   on time    no write reached the code host from a fence that did not hold the lease
//   one push   the build branch took exactly one push (the bare repository's reflog)
//   wasted     agent turns past the control's: at most one per takeover
//
// Node at the edge, as 93 to 110: each host is its own process group, signalled whole. The
// Miniflare ledger and the fake code host run in this process.
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";
import {Effect} from "effect";
import {Miniflare} from "miniflare";
import {cast} from "../packages/fabrika/src/host/host.ts";
import {layerHttp} from "../packages/fabrika/src/host/http.ts";
import {Ledger, streams} from "../packages/fabrika/src/host/ledger.ts";
import {ledgerOptions} from "../packages/fabrika/src/host/worker-options.ts";
import {agentOf} from "../packages/fabrika/src/pipeline/hosted/agent.ts";
import {markerOf, writesOf} from "../packages/fabrika/src/pipeline/hosted/idempotency.ts";
import {readOutcome} from "../packages/fabrika/src/pipeline/hosted/stage.ts";
import {planProblems} from "../packages/fabrika/src/pipeline/stages/plan/check.ts";
import type {PlanDraft} from "../packages/fabrika/src/pipeline/stages/plan/plan.ts";
import {RUBRICS} from "../packages/fabrika/src/pipeline/stages/review/scripted.ts";
import {makeTemplate, startFake} from "./104-stages-on-tea-host/fake-github.ts";
import {analyse, type PlanRun} from "./104-stages-on-tea-host/plan-at-20.ts";
import {SANDBOX} from "./104-stages-on-tea-host/real.ts";
import {
	BUILD_TICKET,
	FIXTURES,
	PLAN_TICKET,
	REVIEW_PR,
	SHIP_PR,
} from "./104-stages-on-tea-host/world.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
/** RESULTS_NAME: the results file under results/, so 104c's runs keep a file of their own. */
const RESULTS = here(`results/${process.env.RESULTS_NAME ?? "104-stages-on-tea-host.json"}`);
const HOST = here("104-stages-on-tea-host/host.ts");
const only = new Set((process.env.ONLY ?? "ship,review,plan,build,limits,plants").split(","));
const KILLS = Number(process.env.KILLS ?? 20);
const FROM = Number(process.env.FROM ?? 0);
const TTL_MS = Number(process.env.TTL_MS ?? 1000);
const WAIT_MS = 60_000;

/** Kept across invocations: a run of one part (ONLY=real) adds to what the others left. */
const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (text: string) => console.log(text);
const scratch = mkdtempSync(join(tmpdir(), "exp104-"));

// ---------------------------------------------------------------- process groups

type Line = Record<string, unknown>;
type Host = {
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
	const work = mkdtempSync(join(scratch, "work-"));
	const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", HOST], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: {...process.env, WORK: work, TTL_MS: String(TTL_MS), HOST: `h${++hosts}`, ...env},
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
	return {proc, pgid, lines, exited, err: () => err.replace(/\/[^\s:)]+/g, "<path>").slice(-800)};
};

// ---------------------------------------------------------------- the ledger and the fake

const mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
const url = (await mf.unsafeGetDirectURL()).origin;
let ledgers = 0;
let current = "";
const on = <A>(ledger: string, e: Effect.Effect<A, unknown, Ledger>) =>
	Effect.runPromise(e.pipe(Effect.orDie, Effect.provide(layerHttp({url, ledger})), Effect.scoped));
const template = makeTemplate(scratch);
const fake = await startFake({
	dir: scratch,
	template,
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

// ---------------------------------------------------------------- one run

type Stage = "ship" | "review" | "plan" | "build";
const SETTINGS = {model: "haiku", effort: "low", budget: 1} as const;
const NAMES: Record<Stage, string> = {
	ship: "ship:1",
	review: "review:1",
	plan: "plan:1",
	build: "build:1:r1",
};
const jobOf = (stage: Stage, usd: number) =>
	stage === "ship"
		? {pr: SHIP_PR}
		: stage === "review"
			? {pr: REVIEW_PR, rubrics: RUBRICS, settings: SETTINGS, usd}
			: stage === "plan"
				? {ticket: PLAN_TICKET, tries: 3, settings: SETTINGS, usd}
				: {ticket: BUILD_TICKET, number: 1, round: 1, settings: SETTINGS, usd, at: 1_760_000_000};

interface RunSpec {
	readonly stage: Stage;
	readonly fault?: string;
	readonly act?: "kill" | "stop";
	readonly plant?: "no_lease_check" | "unkeyed";
	readonly usd?: number;
	/** How long the fake's queue takes to land a pull request. */
	readonly landMs?: number;
}

const waitFor = async (seen: () => boolean | Promise<boolean>, ms = WAIT_MS) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await seen()) return true;
		await sleep(50);
	}
	return false;
};

const run = async (spec: RunSpec) => {
	const ledger = `exp104-${spec.stage}-${Date.now().toString(36)}-${ledgers++}`;
	current = ledger;
	fake.reset(FIXTURES, spec.landMs === undefined ? {} : {landMs: spec.landMs});
	const name = NAMES[spec.stage];
	const child = agentOf(name);
	await on(
		ledger,
		Effect.gen(function* () {
			yield* (yield* Ledger).register(name, "harness");
			yield* cast(name, "job", jobOf(spec.stage, spec.usd ?? 5), "harness");
		}),
	);
	const env = {
		LEDGER_URL: url,
		LEDGER_NAME: ledger,
		FAKE_URL: fake.url,
		REMOTE: fake.remote(),
		STAGE: spec.stage,
		NAME: name,
		PLANT: spec.plant ?? "none",
	};
	const outcome = () => on(ledger, readOutcome(name));
	const started: Host[] = [];
	const t0 = Date.now();
	const a = startHost({...env, FAULT: spec.fault ?? "", FAULT_ACT: spec.act ?? "kill"});
	started.push(a);
	let faulted = false;
	if (spec.fault !== undefined) {
		const fired = () => a.lines.some((l) => l.ev === "fault");
		await waitFor(async () => fired() || (await outcome()) !== null);
		faulted = fired();
		if (faulted && spec.act !== "stop") await a.exited;
		if (faulted) started.push(startHost(env));
	}
	const finished = await waitFor(async () => (await outcome()) !== null);
	let woke: Line[] = [];
	if (spec.act === "stop" && faulted) {
		// The frozen host, woken: its lease is long gone.
		const before = a.lines.length;
		signal(a.pgid, "SIGCONT");
		await sleep(3 * TTL_MS);
		woke = a.lines.slice(before);
	}
	// A second host after the end must find nothing to do.
	if (!faulted && spec.usd !== undefined) {
		await killGroup(a.pgid);
		started.push(startHost(env));
		await sleep(3 * TTL_MS);
	}
	await sleep(200);
	const ms = Date.now() - t0;
	for (const h of started) await killGroup(h.pgid);
	const out = await outcome();
	const facts = await on(
		ledger,
		Effect.gen(function* () {
			const l = yield* Ledger;
			return {
				writes: yield* l.readStream(writesOf(name)),
				usage: yield* l.usage(child),
				dead: yield* l.readStream(streams(child).dead),
				answers: yield* l.readStream(`${child}/answers`),
			};
		}),
	);
	const lines = started.flatMap((h) => h.lines);
	if (process.env.DEBUG === "1")
		writeFileSync(
			join(scratch, `lines-${ledgers}.jsonl`),
			lines.map((l) => JSON.stringify(l)).join("\n"),
		);
	const log = fake.log();
	const intents = new Set(
		facts.writes.filter((r) => r.id.startsWith("intent:")).map((r) => r.id.slice(7)),
	);
	const counts = new Map<string, number>();
	for (const w of log) if (w.key !== null) counts.set(w.key, (counts.get(w.key) ?? 0) + 1);
	return {
		spec,
		ms,
		finished,
		faulted,
		hosts: started.length,
		outcome: out?.outcome ?? null,
		log,
		doubled: [...counts].filter(([, n]) => n > 1).map(([k]) => k),
		unkeyed: log.filter((w) => w.key === null).length,
		noIntent: log.filter((w) => w.key !== null && !intents.has(w.key)).length,
		late: log.filter((w) => w.late).length,
		pushes: spec.stage === "build" ? fake.pushes("build/1") : null,
		// Turns started (a hold each), finished or not: a turn killed half way was paid for too.
		turns: lines.filter((l) => l.ev === "agent" && l.step === "hold").length,
		usd: facts.usage?.used.usd ?? 0,
		limits: facts.dead.filter((r) => r.kind === "limit").length,
		limitRow: facts.dead.find((r) => r.kind === "limit")?.data ?? null,
		// What the woken host got done: a send, a row the ledger took, an answer, an outcome.
		woke: woke.filter(
			(l) =>
				(l.ev === "write" &&
					"op" in l &&
					["send", "sent", "done", "intent"].includes(String(l.step))) ||
				(l.ev === "write" && !("op" in l) && l.ok === true) ||
				(l.ev === "agent" && l.step === "answered") ||
				l.ev === "outcome",
		),
		wokeSaid: woke.map((l) => `${String(l.ev)}:${String(l.step ?? l.phase ?? l.answer ?? "")}`),
		errors: started.map((h) => h.err()).filter((e) => e.trim() !== ""),
		said: lines
			.filter((l) => l.ev === "write" || l.ev === "stage" || l.ev === "fault")
			.map(
				(l) =>
					`${String(l.host)} ${String(l.ev)} ${String(l.op ?? "")} ${String(l.step ?? l.point ?? "")}`,
			),
	};
};
type Run = Awaited<ReturnType<typeof run>>;

// ---------------------------------------------------------------- per stage

const FAULTS: Record<Stage, readonly string[]> = {
	ship: [...Array(10).fill("before-send:enqueue"), ...Array(10).fill("after-send:enqueue")],
	review: [
		...Array(7).fill("agent-turn"),
		...Array(7).fill("agent-answered"),
		...Array(6).fill("after-send:comment"),
	],
	plan: [...Array(10).fill("agent-turn"), ...Array(10).fill("agent-answered")],
	build: [
		...Array(7).fill("agent-turn"),
		...Array(7).fill("agent-answered"),
		...Array(3).fill("after-send:push"),
		...Array(3).fill("after-send:open"),
	],
};
const FREEZE: Record<Stage, string> = {
	ship: "before-send:enqueue",
	review: "before-send:comment",
	plan: "agent-answered",
	build: "before-send:push",
};

/**
 * The outcome row, less build's `runs`: the build machine counts each restart in `building` as a
 * run (its `resume`), so a takeover there says 2 where the control says 1. The agent's own turns
 * are counted apart (`turns`), from the ledger's holds.
 */
const outcomeOf = (r: Run): unknown => {
	const o = r.outcome;
	if (typeof o !== "object" || o === null || !("runs" in o)) return o;
	const {runs: _runs, ...rest} = o;
	return rest;
};

const judge = (r: Run, control: Run) => {
	const broke: string[] = [];
	if (!r.finished) broke.push("no outcome");
	if (!isDeepStrictEqual(outcomeOf(r), outcomeOf(control))) broke.push("outcome differs");
	if (r.doubled.length > 0) broke.push(`doubled ${r.doubled.join(",")}`);
	if (r.unkeyed > 0) broke.push(`unkeyed ${r.unkeyed}`);
	if (r.noIntent > 0) broke.push(`no intent row ${r.noIntent}`);
	if (r.late > 0) broke.push(`late ${r.late}`);
	if (r.pushes !== null && r.pushes !== 1) broke.push(`pushes ${r.pushes}`);
	if (r.turns - control.turns > (r.faulted ? 1 : 0))
		broke.push(`wasted ${r.turns - control.turns}`);
	if (r.woke.length > 0) broke.push(`woken host wrote ${r.woke.length}`);
	return broke;
};
const brief = (r: Run, broke: readonly string[]) => ({
	fault: r.spec.fault ?? null,
	act: r.spec.act ?? null,
	plant: r.spec.plant ?? null,
	faulted: r.faulted,
	hosts: r.hosts,
	ms: r.ms,
	turns: r.turns,
	usd: r.usd,
	pushes: r.pushes,
	writes: r.log.map((w) => `${w.op}${w.applied ? "" : `(${w.why})`}${w.late ? "[late]" : ""}`),
	wokeSaid: r.wokeSaid,
	broke,
	said: r.said,
	...(broke.length > 0 ? {outcome: r.outcome, errors: r.errors} : {}),
});

const stageRuns = async (stage: Stage) => {
	say(`\n== ${stage}`);
	const control = await run({stage});
	say(
		`control: ${control.finished ? "done" : "NO OUTCOME"} in ${control.ms} ms, ${control.turns} turns, writes ${control.log.map((w) => w.op).join(",")}`,
	);
	if (!control.finished) {
		say(control.said.join("\n"));
		say(control.errors.join("\n"));
	}
	const kills: ReturnType<typeof brief>[] = [];
	for (const fault of FAULTS[stage].slice(FROM, FROM + KILLS)) {
		const r = await run({stage, fault, act: "kill"});
		const broke = judge(r, control);
		kills.push(brief(r, broke));
		say(
			`kill at ${fault}: ${broke.length === 0 ? "ok" : broke.join("; ")} (${r.ms} ms, ${r.turns} turns)`,
		);
	}
	const f = await run({stage, fault: FREEZE[stage], act: "stop"});
	const frozen = brief(f, judge(f, control));
	say(
		`freeze at ${FREEZE[stage]}: ${frozen.broke.length === 0 ? "ok" : frozen.broke.join("; ")}; woken said ${f.wokeSaid.join(",")}`,
	);
	const passed = kills.filter((k) => k.broke.length === 0 && k.faulted).length;
	// Ship only: the queue lands the pull request before the next host takes over.
	const early =
		stage === "ship"
			? await run({stage, fault: "after-send:enqueue", act: "kill", landMs: 300}).then((r) => ({
					...brief(r, judge(r, control)),
					outcome: r.outcome,
				}))
			: null;
	if (early !== null) say(`landed before the takeover: ${early.broke.join("; ") || "same"}`);
	results[stage] = {
		control: {...brief(control, []), outcome: control.outcome},
		kills: {
			runs: kills.length,
			passed,
			doubled: kills.filter((k) => k.broke.some((b) => b.startsWith("doubled"))).length,
		},
		freeze: frozen,
		...(early === null ? {} : {landedBeforeTakeover: early}),
		runs: kills,
	};
	save();
	say(
		`${stage}: ${passed}/${kills.length} kill runs pass; freeze ${frozen.broke.length === 0 ? "pass" : "FAIL"}`,
	);
};

// ---------------------------------------------------------------- limits and plants

const limits = async () => {
	say("\n== limits");
	const r = await run({stage: "review", usd: 0.05});
	const ok = r.finished && r.limits === 1 && r.turns === 1;
	results.limits = {
		passed: ok,
		limitRows: r.limits,
		limitRow: r.limitRow,
		turns: r.turns,
		usd: r.usd,
		hosts: r.hosts,
		outcome: r.outcome,
		said: r.said,
	};
	save();
	say(
		`limits: ${ok ? "pass" : "FAIL"}: ${r.limits} limit row, ${r.turns} turn(s) over ${r.hosts} hosts, $${r.usd}`,
	);
};

const plants = async () => {
	say("\n== plants");
	const control = await run({stage: "review"});
	const unkeyed = await run({stage: "review", plant: "unkeyed"});
	const u = judge(unkeyed, control);
	const late = await run({
		stage: "review",
		fault: "before-send:comment",
		act: "stop",
		plant: "no_lease_check",
	});
	const l = judge(late, control);
	results.plants = {
		unkeyed: {caught: u.length > 0, broke: u, writes: brief(unkeyed, u).writes},
		writeAfterLease: {
			caught: l.length > 0,
			broke: l,
			writes: brief(late, l).writes,
			wokeSaid: late.wokeSaid,
		},
	};
	save();
	say(`plant unkeyed: ${u.length > 0 ? `caught (${u.join("; ")})` : "NOT CAUGHT"}`);
	say(`plant write after lease: ${l.length > 0 ? `caught (${l.join("; ")})` : "NOT CAUGHT"}`);
};

// ---------------------------------------------------------------- real agents (ONLY=real, REAL=1)
//
// haiku on GitHub, writing to SANDBOX only. Build makes a pull request from a ticket made for this
// run; review reviews that pull request; plan plans a second ticket. Each: a control run, then
// three runs killed once (inside the turn, after the answer before its row, after an outside
// write before its done row; plan has no outside write and takes a second kill in the turn). Every
// child has a dollar cap on its spec, and the runs stop once the spend passes BUDGET_USD.

const REAL_BUDGET = Number(process.env.BUDGET_USD ?? 15);
const REAL_SETTINGS = {model: "haiku", effort: "low", budget: 0.5} as const;
const REAL_CAP = 4;
const REAL_WAIT_MS = 20 * 60_000;
/** REAL_ONLY: which stages run (build,review,plan); REAL_KILLS: killed runs per stage, 0 to 3. */
const REAL_ONLY = new Set((process.env.REAL_ONLY ?? "build,review,plan").split(","));
const REAL_KILLS = Number(process.env.REAL_KILLS ?? 3);
/** REAL_KEY: where in the results this run goes, so a rerun of one stage keeps the others. */
const REAL_KEY = process.env.REAL_KEY ?? "real";
const REAL_FAULTS: Record<"build" | "review" | "plan", readonly string[]> = {
	build: ["agent-turn", "agent-answered", "after-send:push"],
	review: ["agent-turn", "agent-answered", "after-send:comment"],
	plan: ["agent-turn", "agent-answered", "agent-turn"],
};
/**
 * 104c (PLAN_ROUNDS > 0): plan only, in rounds. Each round is one control and one run killed at
 * each of plan's kill points, in an order turned by one each round, so a drift over the session
 * falls on every arm alike. EST_BUDGET_USD: the runs stop once the estimated spend (what the
 * finished turns billed, plus each lost turn at the mean billed turn) reaches it.
 */
const PLAN_ROUNDS = Number(process.env.PLAN_ROUNDS ?? 0);
/** One plan draft as 104c reads it: its size, and what the Check still finds in it. */
type Draft = {
	readonly ask: string;
	readonly tasks: number | null;
	readonly questions: number | null;
	readonly problems: readonly string[];
};
const EST_BUDGET = Number(process.env.EST_BUDGET_USD ?? 9);

/** gh on the sandbox only: every call names it, and nothing else is ever written. */
const ghSandbox = (args: readonly string[]) => {
	if (!args.some((a) => a.includes(SANDBOX)))
		throw new Error("a gh call that does not name the sandbox");
	return execFileSync("gh", [...args], {encoding: "utf8"}).trim();
};

const BUILD_BODY = [
	"The README does not say this repository is a sandbox, so a reader takes it for the real one.",
	"",
	"## Acceptance criteria",
	"",
	"- [ ] README.md has a section headed `## Sandbox`.",
	"- [ ] That section says, in one or two sentences, that this repository is a sandbox for tea-fabrika experiments and that its pull requests are made by a test.",
].join("\n");
const PLAN_BODY = [
	"A reader of the tea package's README cannot tell from it how to install the package.",
	"",
	"The README should name the npm package and give the one install command, near the top.",
].join("\n");

const realVerdict = (stage: "build" | "review" | "plan", outcome: unknown): string => {
	if (typeof outcome !== "object" || outcome === null) return "none";
	const o = outcome as Record<string, unknown>;
	if (stage === "review") return `${String(o.name)} ${JSON.stringify(o.rows ?? [])}`;
	if (stage === "build") return `${String(o.name)} changed=${String(o.changed)}`;
	return `${String(o.name)} tasks=${Array.isArray(o.tasks) && o.tasks.length > 0}`;
};

const realRuns = async () => {
	say("\n== real (haiku, sandbox)");
	// Only whether it is set is read: the value stays in this process's environment.
	if (process.env.REAL !== "1" || (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "") === "") {
		say("real runs need REAL=1 and CLAUDE_CODE_OAUTH_TOKEN in this shell; skipped");
		return;
	}
	const clone = join(scratch, "sandbox-clone");
	execFileSync("git", ["clone", "-q", `https://github.com/${SANDBOX}`, clone]);
	// No label: since 2026-10-22 only an approved plan on the ledger lets a ticket be built.
	const issue = (title: string, body: string) =>
		ghSandbox(["issue", "create", "-R", SANDBOX, "--title", title, "--body", body]);
	// A plan-only run (104c) makes no build ticket: nothing would read it.
	const needsBuild = REAL_ONLY.has("build") || REAL_ONLY.has("review");
	const buildTicket = needsBuild
		? issue("README does not say this is a sandbox (experiment 104)", BUILD_BODY)
		: null;
	const planTicket = issue("tea README does not say how to install it (experiment 104)", PLAN_BODY);
	const buildNumber =
		buildTicket === null ? 0 : Number(buildTicket.slice(buildTicket.lastIndexOf("/") + 1));
	const opened = new Set<string>();
	let spent = 0;
	const real: Record<string, unknown> = {tickets: {build: buildTicket, plan: planTicket}, runs: []};
	const runs: Record<string, unknown>[] = [];

	const runReal = async (
		stage: "build" | "review" | "plan",
		tag: string,
		job: Record<string, unknown>,
		fault: string | undefined,
	) => {
		const ledger = `exp104-real-${stage}-${Date.now().toString(36)}-${ledgers++}`;
		current = ledger;
		const name = stage === "build" ? `build:${buildNumber}:r1` : `${stage}:${tag}`;
		const child = agentOf(name);
		await on(
			ledger,
			Effect.gen(function* () {
				yield* (yield* Ledger).register(name, "harness");
				yield* cast(name, "job", job, "harness");
			}),
		);
		const env = {
			LEDGER_URL: url,
			LEDGER_NAME: ledger,
			STAGE: stage,
			NAME: name,
			AGENT: "real",
			CLONE: clone,
			HOLD_USD: String(REAL_SETTINGS.budget),
			// A haiku turn here takes 5 to 30 s: 4 s in is inside it.
			TURN_FAULT_MS: "4000",
			PLANT: "none",
		};
		const outcome = () => on(ledger, readOutcome(name));
		const t0 = Date.now();
		const started: Host[] = [];
		const a = startHost({...env, FAULT: fault ?? "", FAULT_ACT: "kill"});
		started.push(a);
		let faulted = false;
		if (fault !== undefined) {
			const fired = () => a.lines.some((l) => l.ev === "fault");
			await waitFor(async () => fired() || (await outcome()) !== null, REAL_WAIT_MS);
			faulted = fired();
			if (faulted) {
				await a.exited;
				started.push(startHost(env));
			}
		}
		const finished = await waitFor(async () => (await outcome()) !== null, REAL_WAIT_MS);
		for (const h of started) await killGroup(h.pgid);
		const out = (await outcome())?.outcome ?? null;
		const facts = await on(
			ledger,
			Effect.gen(function* () {
				const l = yield* Ledger;
				return {
					usage: yield* l.usage(child),
					writes: yield* l.readStream(writesOf(name)),
					answers: yield* l.readStream(`${child}/answers`),
				};
			}),
		);
		/** What each turn answered, in short: a failed draft's error is how a real run is read. */
		const answered = facts.answers.map((row) =>
			JSON.stringify(row.data)
				.replace(/\/[^\s":)]+/g, "<path>")
				.slice(0, 600),
		);
		// Plan's drafts, each read again by the Check (pure: the same draft gives the same problems),
		// and what each answered turn billed. A turn killed before its answer row is not here.
		const field = (o: unknown, k: string): unknown =>
			typeof o === "object" && o !== null && k in o ? (o as Record<string, unknown>)[k] : undefined;
		// A row's data is its JSON, as text.
		const msgs = facts.answers.map((row) => {
			const answer = field(JSON.parse(row.data), "answer");
			return {id: row.id ?? "", msgs: Array.isArray(answer) ? (answer as readonly unknown[]) : []};
		});
		const billed = msgs
			.flatMap((a) => a.msgs)
			.reduce<number>((n, m) => {
				const cost = field(field(m, "spend"), "costUsd");
				return n + (typeof cost === "number" ? cost : 0);
			}, 0);
		const drafts =
			stage !== "plan"
				? null
				: msgs.flatMap((a) =>
						a.msgs.flatMap((m): readonly Draft[] => {
							if (field(m, "type") !== "plan_finished") return [];
							const output = field(m, "output") as PlanDraft | null | undefined;
							if (output === null || output === undefined)
								return [{ask: a.id, tasks: null, questions: null, problems: ["no output"]}];
							return [
								{
									ask: a.id,
									tasks: output.tasks.length,
									questions: output.questions.length,
									problems: planProblems(output, null),
								},
							];
						}),
					);
		const lines = started.flatMap((h) => h.lines);
		if (process.env.DEBUG === "1")
			writeFileSync(
				join(scratch, `real-${stage}-${tag}-${fault ?? "c"}.jsonl`),
				[...lines.map((l) => JSON.stringify(l)), ...started.map((h) => h.err())].join("\n"),
			);
		const holds = lines.filter((l) => l.ev === "agent" && l.step === "hold").length;
		const charged = lines.filter((l) => l.ev === "agent" && l.step === "turn").length;
		// A turn killed before its charge stays counted at its hold (102), the most it could cost:
		// the ledger's `used` is already the upper bound, and the spend is counted from it.
		const unbilled = Math.max(0, holds - charged);
		const usd = facts.usage?.used.usd ?? 0;
		spent += usd;
		const pr =
			typeof out === "object" && out !== null && "pr" in out && typeof out.pr === "string"
				? out.pr
				: null;
		if (pr !== null) opened.add(pr);
		const r = {
			stage,
			agent: "real",
			fault: fault ?? null,
			faulted,
			finished,
			ms: Date.now() - t0,
			holds,
			usd,
			killedTurns: unbilled,
			billed,
			lostTurns: Math.max(0, holds - facts.answers.length),
			drafts,
			answered,
			verdict: realVerdict(stage, out),
			outcome: out,
			intents: facts.writes.filter((w) => w.id.startsWith("intent:")).map((w) => w.id.slice(7)),
			said: lines
				.filter((l) => l.ev === "write" || l.ev === "stage" || l.ev === "fault" || l.ev === "agent")
				.map(
					(l) =>
						`${String(l.host)} ${String(l.ev)} ${String(l.op ?? "")} ${String(l.step ?? l.point ?? "")}`,
				),
			errors: started.map((h) => h.err()).filter((e) => e.trim() !== ""),
		};
		runs.push(r);
		real.runs = runs;
		real.spent = spent;
		results[REAL_KEY] = real;
		save();
		say(
			`${stage} ${fault ?? "control"}: ${r.verdict}; ${holds} turns, $${usd.toFixed(3)} on the ledger (${unbilled} killed turns counted at their hold), spent so far $${spent.toFixed(2)}`,
		);
		return r;
	};
	const over = () => spent >= REAL_BUDGET - 2;
	/** The outside world, read back: comments with one key's marker, pull requests from one branch. */
	const countMarked = (pr: string, key: string) => {
		const n = pr.slice(pr.lastIndexOf("/") + 1);
		const bodies = ghSandbox([
			"api",
			`repos/${SANDBOX}/issues/${n}/comments?per_page=100`,
			"--jq",
			".[].body",
		]);
		return bodies.split(markerOf(key)).length - 1;
	};
	/** Open pull requests from `branch`: read before the cleanup closes them. */
	const prsFrom = (branch: string) =>
		Number(
			ghSandbox([
				"api",
				`repos/${SANDBOX}/pulls?head=kamp-us:${branch}&state=open&per_page=100`,
				"--jq",
				"length",
			]),
		);
	const closeBuild = () => {
		if (buildTicket === null) return;
		for (const pr of opened) {
			const n = pr.slice(pr.lastIndexOf("/") + 1);
			// biome-ignore lint/plugin: node at the edge: a pull request closed already answers with an error
			try {
				ghSandbox(["pr", "close", n, "-R", SANDBOX, "--delete-branch"]);
			} catch {
				// closed already
			}
		}
		// biome-ignore lint/plugin: node at the edge: a branch that is gone already answers with an error
		try {
			ghSandbox(["api", "-X", "DELETE", `repos/${SANDBOX}/git/refs/heads/build/${buildNumber}`]);
		} catch {
			// gone already
		}
	};

	const judgeReal = (
		stage: "build" | "review" | "plan",
		control: {verdict: string; holds: number},
		rs: readonly {verdict: string; holds: number; faulted: boolean}[],
	) => ({
		matches: rs.filter((r) => r.verdict === control.verdict).length,
		of: rs.length,
		wastedMax: Math.max(0, ...rs.map((r) => r.holds - control.holds)),
		stage,
	});

	try {
		const buildJob = {
			ticket: buildTicket,
			number: buildNumber,
			round: 1,
			settings: REAL_SETTINGS,
			usd: REAL_CAP,
			at: 1_792_500_000,
		};
		// Build's control first: review reads its pull request.
		const buildControl =
			REAL_ONLY.has("build") || REAL_ONLY.has("review")
				? await runReal("build", "c", buildJob, undefined)
				: null;
		const builtPr = buildControl?.outcome;
		const reviewPr =
			typeof builtPr === "object" && builtPr !== null && "pr" in builtPr && builtPr.pr !== null
				? String(builtPr.pr)
				: null;
		const checks: Record<string, unknown> = {};
		if (REAL_ONLY.has("review") && reviewPr !== null) {
			execFileSync("git", ["-C", clone, "fetch", "-q", "origin", `build/${buildNumber}`]);
			const reviewJob = {pr: reviewPr, rubrics: RUBRICS, settings: REAL_SETTINGS, usd: REAL_CAP};
			const reviewControl = await runReal("review", "c", reviewJob, undefined);
			const reviewKills = [];
			for (const [i, fault] of REAL_FAULTS.review.slice(0, REAL_KILLS).entries()) {
				if (over()) break;
				const r = await runReal("review", `k${i}`, reviewJob, fault);
				for (const key of r.intents.filter((k) => k.includes("#comment:")))
					checks[`review k${i}: comments with key ${key}`] = countMarked(reviewPr, key);
				reviewKills.push(r);
			}
			real.review = judgeReal("review", reviewControl, reviewKills);
		}
		real.buildPullRequests = {[`build/${buildNumber} (control)`]: prsFrom(`build/${buildNumber}`)};
		closeBuild();
		const buildKills = [];
		for (const fault of REAL_ONLY.has("build") ? REAL_FAULTS.build.slice(0, REAL_KILLS) : []) {
			if (over()) break;
			const r = await runReal("build", "k", buildJob, fault);
			checks[`build ${fault}: pull requests from the branch`] = prsFrom(`build/${buildNumber}`);
			buildKills.push(r);
			closeBuild();
		}
		if (buildControl !== null) real.build = judgeReal("build", buildControl, buildKills);
		const planJob = {ticket: planTicket, tries: 2, settings: REAL_SETTINGS, usd: REAL_CAP};
		if (REAL_ONLY.has("plan") && PLAN_ROUNDS > 0) {
			const points = ["control", ...new Set(REAL_FAULTS.plan)];
			const asRun = (r: Awaited<ReturnType<typeof runReal>>): PlanRun => {
				const o = r.outcome;
				const tasks =
					typeof o === "object" && o !== null && "tasks" in o && Array.isArray(o.tasks)
						? o.tasks.length
						: null;
				const questions =
					typeof o === "object" && o !== null && "questions" in o && typeof o.questions === "number"
						? o.questions
						: null;
				const name =
					typeof o === "object" && o !== null && "name" in o ? String(o.name) : ("none" as const);
				return {
					point: r.fault ?? "control",
					faulted: r.faulted,
					name,
					tasks,
					questions,
					holds: r.holds,
				};
			};
			const read: PlanRun[] = [];
			let lost = 0;
			let billed = 0;
			let turns = 0;
			const estimate = () => billed + lost * (turns === 0 ? 0.05 : billed / turns);
			rounds: for (let i = 0; i < PLAN_ROUNDS; i++) {
				const order = points.map((_, j) => points[(i + j) % points.length] ?? "control");
				for (const point of order) {
					if (estimate() >= EST_BUDGET) {
						real.stoppedAtEstimate = estimate();
						break rounds;
					}
					const fault = point === "control" ? undefined : point;
					const tag = `${point === "control" ? "c" : point === "agent-turn" ? "t" : "a"}${i}`;
					const r = await runReal("plan", tag, planJob, fault);
					read.push(asRun(r));
					billed += r.billed;
					turns += r.holds - r.lostTurns;
					lost += r.lostTurns;
					real.estimatedUsd = estimate();
					real.plan = analyse(read);
					save();
				}
			}
			real.plan = analyse(read);
			say(`104c: ${JSON.stringify(real.plan)}`);
		} else if (REAL_ONLY.has("plan") && !over()) {
			const planControl = await runReal("plan", "c", planJob, undefined);
			const planKills = [];
			for (const [i, fault] of REAL_FAULTS.plan.slice(0, REAL_KILLS).entries()) {
				if (over()) break;
				planKills.push(await runReal("plan", `k${i}`, planJob, fault));
			}
			real.plan = judgeReal("plan", planControl, planKills);
		}
		real.outside = checks;
		real.stoppedAtBudget = over();
	} finally {
		closeBuild();
		for (const t of buildTicket === null ? [planTicket] : [buildTicket, planTicket])
			ghSandbox([
				"issue",
				"close",
				t.slice(t.lastIndexOf("/") + 1),
				"-R",
				SANDBOX,
				"--reason",
				"not planned",
			]);
		real.cleaned = true;
		results[REAL_KEY] = real;
		save();
	}
	say(
		`real: spent about $${spent.toFixed(2)}; ${JSON.stringify({build: real.build, review: real.review, plan: real.plan})}`,
	);
};

try {
	for (const stage of ["ship", "review", "plan", "build"] as const)
		if (only.has(stage)) await stageRuns(stage);
	if (only.has("limits")) await limits();
	if (only.has("plants")) await plants();
	if (only.has("real")) await realRuns();
} finally {
	for (const g of groups) await killGroup(g);
	await fake.close();
	await mf.dispose();
}
