// Experiment 111: sort as a program on tea-host, killed and taken over, with no outside write sent
// twice. The sort machine (packages/pipeline/src/stages/sort/) runs under `sort:<n>` on a
// Miniflare ledger; its sorter runs as the child `sort:<n>:agent` with `limits`. Every write it
// makes (a comment, a label, a close, a link on a plan's ticket, a ruling on the ledger) goes
// through the gate in packages/pipeline/src/hosted/idempotency.ts. Write-up:
// 111-sort-on-tea-host.md. The harness is 104's (104-stages-on-tea-host.ts), cut to one stage.
//
// ONLY: a comma list of kills|limits|plants|real (default kills,limits,plants).
//   kills    a control run per case (duplicate, no, fold, ruling); then KILLS runs, each with one
//            planted SIGKILL at a fault point (inside the sorter's turn, after its answer before
//            the answer row, before or after a write before its done row), taken over by a second
//            host process; then a freeze: the first host SIGSTOPped past its lease just before a
//            comment is sent, the sort finished by another host, then the first woken
//   limits   a sort whose child has a $0.05 cap and bills $0.10 a try: it ends `limit:usd`, and
//            a second host does not start it again
//   plants   two planted mistakes, each must be seen to fail: a write sent with no key; a stage
//            that sends after losing its lease (the freeze, without the lease check)
//   real     haiku on GitHub, on the sandbox only (REAL=1): see `realRuns`
// KILLS=20, TTL_MS=1000. Results: results/111-sort-on-tea-host.json.
//
// The laws, per run:
//   same       the outcome row equals the control's, and so do the issues it left
//   once       no key reached the issue host twice (every attempt counted, applied or not), and
//              the ruling is on the ledger once
//   keyed      every write that reached the issue host had a key, and that key an intent row
//   on time    no write reached the issue host from a fence that did not hold the lease
//   wasted     agent turns past the control's: at most one per takeover
//
// Node at the edge, as 93 to 110: each host is its own process group, signalled whole. The
// Miniflare ledger and the fake issue host run in this process.
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
import {readFacts, sendFact} from "../packages/pipeline/src/asks/ledger.ts";
import {agentOf} from "../packages/pipeline/src/hosted/agent.ts";
import {writesOf} from "../packages/pipeline/src/hosted/idempotency.ts";
import {sortName} from "../packages/pipeline/src/hosted/sort.ts";
import {readOutcome} from "../packages/pipeline/src/hosted/stage.ts";
import {planOf, readTicketId} from "../packages/pipeline/src/ids.ts";
import {type PlanDraft, revisionOfDraft} from "../packages/pipeline/src/stages/plan/plan.ts";
import {SANDBOX} from "./104-stages-on-tea-host/real.ts";
import {startFakeIssues} from "./111-sort-on-tea-host/fake-issues.ts";
import {BACKGROUND, CASES, type Case, issueUrl, PLAN_8} from "./111-sort-on-tea-host/world.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RESULTS = here("results/111-sort-on-tea-host.json");
const HOST = here("111-sort-on-tea-host/host.ts");
const only = new Set((process.env.ONLY ?? "kills,limits,plants").split(","));
const KILLS = Number(process.env.KILLS ?? 20);
const TTL_MS = Number(process.env.TTL_MS ?? 1000);
const WAIT_MS = 60_000;

/** Kept across invocations: a run of one part (ONLY=real) adds to what the others left. */
const results: Record<string, unknown> = existsSync(RESULTS)
	? JSON.parse(readFileSync(RESULTS, "utf8"))
	: {};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (text: string) => console.log(text);
const scratch = mkdtempSync(join(tmpdir(), "exp111-"));

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
	const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", HOST], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: {...process.env, TTL_MS: String(TTL_MS), HOST: `h${++hosts}`, ...env},
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
const fake = await startFakeIssues({
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

const NOTE = "A small library of web widgets. Its tickets are bugs, features and chores.";
const SETTINGS = {model: "haiku", effort: "low", budget: 1, note: NOTE} as const;

/** The open plan for `planTicket`, as the pipeline's `planned` fact: what a fold reads. */
const seedPlan = (planTicket: string) =>
	Effect.gen(function* () {
		const ticket = readTicketId(planTicket);
		const data = revisionOfDraft(PLAN_8);
		if (ticket === null || data === null) return yield* Effect.die("the seeded plan does not read");
		yield* sendFact(
			{type: "planned", plan: planOf(ticket), tickets: [ticket], data, problems: []},
			{id: "seed-plan", by: "harness"},
		);
	});

/** The `ruling_needed` facts on the ledger for one ticket. */
const rulingsFor = (ticket: string) =>
	Effect.gen(function* () {
		const id = readTicketId(ticket);
		return (yield* readFacts).filter((e) => e.fact.type === "ruling_needed" && e.fact.ticket === id)
			.length;
	});

interface RunSpec {
	readonly case: Case;
	readonly fault?: string;
	readonly act?: "kill" | "stop";
	readonly plant?: "no_lease_check" | "unkeyed";
	readonly usd?: number;
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
	const ledger = `exp111-${spec.case}-${Date.now().toString(36)}-${ledgers++}`;
	current = ledger;
	const seed = CASES[spec.case];
	fake.reset([...BACKGROUND, seed]);
	const ticket = issueUrl(seed.number);
	const name = sortName(seed.number);
	const child = agentOf(name);
	await on(
		ledger,
		Effect.gen(function* () {
			yield* (yield* Ledger).register(name, "harness");
			yield* seedPlan(issueUrl(8));
			yield* cast(
				name,
				"job",
				{ticket, tries: 2, settings: SETTINGS, usd: spec.usd ?? 5},
				"harness",
			);
		}),
	);
	const env = {
		LEDGER_URL: url,
		LEDGER_NAME: ledger,
		FAKE_URL: fake.url,
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
				rulings: yield* rulingsFor(ticket),
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
		facts.writes.flatMap((r) => (r.id?.startsWith("intent:") ? [r.id.slice(7)] : [])),
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
		world: fake.world(),
		rulings: facts.rulings,
		log,
		doubled: [...counts].filter(([, n]) => n > 1).map(([k]) => k),
		unkeyed: log.filter((w) => w.key === null).length,
		noIntent: log.filter((w) => w.key !== null && !intents.has(w.key)).length,
		late: log.filter((w) => w.late).length,
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
				(l.ev === "agent" && l.step === "answered") ||
				l.ev === "outcome",
		),
		wokeSaid: woke.map((l) => `${String(l.ev)}:${String(l.step ?? l.point ?? "")}`),
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

// ---------------------------------------------------------------- the kills

/** Twenty kills over the four cases, at every point a sort can die. */
const KILL_PLAN: readonly {readonly case: Case; readonly fault: string}[] = [
	...(["agent-turn", "agent-turn", "agent-answered", "agent-answered"] as const).map((fault) => ({
		case: "fold" as const,
		fault,
	})),
	{case: "fold", fault: "after-send:comment"},
	{case: "fold", fault: "after-send:label"},
	{case: "fold", fault: "before-send:link"},
	{case: "fold", fault: "after-send:link"},
	{case: "no", fault: "agent-turn"},
	{case: "no", fault: "agent-answered"},
	{case: "no", fault: "after-send:comment"},
	{case: "no", fault: "after-send:close"},
	{case: "duplicate", fault: "agent-answered"},
	{case: "duplicate", fault: "after-send:label"},
	{case: "duplicate", fault: "before-send:close"},
	{case: "duplicate", fault: "after-send:close"},
	{case: "ruling", fault: "agent-turn"},
	{case: "ruling", fault: "after-send:comment"},
	{case: "ruling", fault: "before-send:ruling"},
	{case: "ruling", fault: "after-send:ruling"},
];
const FREEZE = {case: "fold", fault: "before-send:comment"} as const;

const judge = (r: Run, control: Run) => {
	const broke: string[] = [];
	if (!r.finished) broke.push("no outcome");
	if (!isDeepStrictEqual(r.outcome, control.outcome)) broke.push("outcome differs");
	if (!isDeepStrictEqual(r.world, control.world)) broke.push("issues differ");
	if (r.rulings !== control.rulings) broke.push(`rulings ${r.rulings}`);
	if (r.doubled.length > 0) broke.push(`doubled ${r.doubled.join(",")}`);
	if (r.unkeyed > 0) broke.push(`unkeyed ${r.unkeyed}`);
	if (r.noIntent > 0) broke.push(`no intent row ${r.noIntent}`);
	if (r.late > 0) broke.push(`late ${r.late}`);
	if (r.turns - control.turns > (r.faulted ? 1 : 0))
		broke.push(`wasted ${r.turns - control.turns}`);
	if (r.woke.length > 0) broke.push(`woken host wrote ${r.woke.length}`);
	return broke;
};
const brief = (r: Run, broke: readonly string[]) => ({
	case: r.spec.case,
	fault: r.spec.fault ?? null,
	act: r.spec.act ?? null,
	plant: r.spec.plant ?? null,
	faulted: r.faulted,
	hosts: r.hosts,
	ms: r.ms,
	turns: r.turns,
	usd: r.usd,
	rulings: r.rulings,
	writes: r.log.map((w) => `${w.op}${w.applied ? "" : `(${w.why})`}${w.late ? "[late]" : ""}`),
	wokeSaid: r.wokeSaid,
	broke,
	said: r.said,
	...(broke.length > 0 ? {outcome: r.outcome, errors: r.errors} : {}),
});

const killRuns = async () => {
	say("\n== kills");
	const controls = new Map<Case, Run>();
	for (const c of ["duplicate", "no", "fold", "ruling"] as const) {
		const control = await run({case: c});
		controls.set(c, control);
		say(
			`control ${c}: ${control.finished ? "done" : "NO OUTCOME"} in ${control.ms} ms, ${control.turns} turns, writes ${control.log.map((w) => w.op).join(",")}, rulings ${control.rulings}, outcome ${JSON.stringify((control.outcome as {name?: unknown} | null)?.name ?? null)}`,
		);
		if (!control.finished) {
			say(control.said.join("\n"));
			say(control.errors.join("\n"));
		}
	}
	const kills: ReturnType<typeof brief>[] = [];
	for (const k of KILL_PLAN.slice(0, KILLS)) {
		const control = controls.get(k.case);
		if (control === undefined) continue;
		const r = await run({case: k.case, fault: k.fault, act: "kill"});
		const broke = judge(r, control);
		kills.push(brief(r, broke));
		say(
			`${k.case} kill at ${k.fault}: ${broke.length === 0 ? "ok" : broke.join("; ")} (${r.ms} ms, ${r.turns} turns${r.faulted ? "" : ", fault not reached"})`,
		);
	}
	const freezeControl = controls.get(FREEZE.case);
	const f = await run({case: FREEZE.case, fault: FREEZE.fault, act: "stop"});
	const frozen = brief(f, freezeControl === undefined ? ["no control"] : judge(f, freezeControl));
	say(
		`freeze at ${FREEZE.fault}: ${frozen.broke.length === 0 ? "ok" : frozen.broke.join("; ")}; woken said ${f.wokeSaid.join(",")}`,
	);
	const passed = kills.filter((k) => k.broke.length === 0 && k.faulted).length;
	results.kills = {
		controls: Object.fromEntries(
			[...controls].map(([c, r]) => [c, {...brief(r, []), outcome: r.outcome, world: r.world}]),
		),
		summary: {
			runs: kills.length,
			passed,
			faulted: kills.filter((k) => k.faulted).length,
			doubled: kills.filter((k) => k.broke.some((b) => b.startsWith("doubled"))).length,
			lost: kills.filter((k) => k.broke.some((b) => b === "no outcome")).length,
			wastedMax: Math.max(
				0,
				...kills.map((k) => k.turns - (controls.get(k.case as Case)?.turns ?? 0)),
			),
		},
		freeze: frozen,
		runs: kills,
	};
	save();
	say(
		`kills: ${passed}/${kills.length} pass; freeze ${frozen.broke.length === 0 ? "pass" : "FAIL"}`,
	);
};

// ---------------------------------------------------------------- limits and plants

const limits = async () => {
	say("\n== limits");
	const r = await run({case: "no", usd: 0.05});
	const name = (r.outcome as {name?: unknown} | null)?.name;
	const ok =
		r.finished &&
		r.limits === 1 &&
		r.turns === 1 &&
		r.log.length === 0 &&
		name === "stuck:over_budget";
	results.limits = {
		passed: ok,
		limitRows: r.limits,
		limitRow: r.limitRow,
		turns: r.turns,
		usd: r.usd,
		hosts: r.hosts,
		writes: r.log.length,
		outcome: r.outcome,
		said: r.said,
	};
	save();
	say(
		`limits: ${ok ? "pass" : "FAIL"}: ${r.limits} limit row, ${r.turns} turn(s) over ${r.hosts} hosts, $${r.usd}, ${r.log.length} writes, ${String(name)}`,
	);
};

const plants = async () => {
	say("\n== plants");
	const control = await run({case: "no"});
	const unkeyed = await run({case: "no", plant: "unkeyed"});
	const u = judge(unkeyed, control);
	const late = await run({
		case: "no",
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
// haiku on GitHub, writing to SANDBOX only, every run labelled `agent: "real"`. Three reports made
// for this run, each one a case meant to find a weakness:
//
//   duplicate   a reworded copy of open #7 (a record-form machine's error names no cell)
//   no          a bug in the pipeline tool itself, which this repo's bar says belongs elsewhere
//   fold        a case missing from an open plan: a plan ticket is made, its `planned` fact seeded
//               into each run's ledger, and the report adds to it
//
// Each: a control run, then REAL_KILLS runs killed once (inside the turn, after the answer before
// its row, after the last write before its done row), taken over by a second host. Between runs
// every write the last one made is taken back (the ticket reopened, its sort labels and keyed
// comments removed), so each run starts from the same issues. The runs stop once the ledger's
// spend passes BUDGET_USD.

const REAL_BUDGET = Number(process.env.BUDGET_USD ?? 5);
const REAL_SETTINGS = {
	model: "haiku",
	effort: "low",
	budget: 0.25,
	note: [
		"This repository is a sandbox copy of tea, a TypeScript library for Elm-style state machines (`defineMachine`, Cmds, Subs), and its docs.",
		"Its tickets go through fabrika, a work-pipeline tool (triage, plan, build, review, ship skills and agents) that lives in its own repository. A bug in fabrika's own behavior is not work for this repository.",
	].join("\n"),
} as const;
const REAL_CAP = 1;
const REAL_WAIT_MS = 10 * 60_000;
const REAL_KILLS = Number(process.env.REAL_KILLS ?? 3);
const REAL_KEY = process.env.REAL_KEY ?? "real";

/** gh on the sandbox only: every call names it, and nothing else is ever written. */
const ghSandbox = (args: readonly string[]) => {
	if (!args.some((a) => a.includes(SANDBOX)))
		throw new Error("a gh call that does not name the sandbox");
	return execFileSync("gh", [...args], {encoding: "utf8"}).trim();
};
const sandboxIssue = (n: number) => `https://github.com/${SANDBOX}/issues/${n}`;
const numberIn = (u: string) => Number(u.slice(u.lastIndexOf("/") + 1));

const REAL_CASES = {
	duplicate: {
		title:
			"Forgetting one cell in an inline update record gives a type error that does not say which (experiment 111)",
		body: [
			"I wrote my machine's `update` record straight inside `defineMachine` and left out the cell for one of my Msgs by mistake.",
			"",
			'TypeScript said "No overload matches this call" on cells that were fine, plus a pile of implicit-any errors. Nowhere did it name the Msg I forgot. It took me an hour to find.',
			"",
			"When I moved the record into its own `const update: Reducer<...>` the error named the missing cell at once. The inline form should say the same.",
		].join("\n"),
		fault: "after-send:close",
	},
	no: {
		title: "fabrika's operator spawns the reviewer again after a PASS verdict (experiment 111)",
		body: [
			"On the last three lanes here, the fabrika operator got a PASS verdict from its reviewer and then spawned a second reviewer on the same head anyway, which ran the whole review again.",
			"",
			"Nothing in this repository's config asks for that: the operator's loop does it on its own. It wastes about a dollar a lane.",
		].join("\n"),
		fault: "after-send:close",
	},
	fold: {
		title: "The README's install line should mention the effect peer dependency (experiment 111)",
		body: [
			"The plan to add an install section to the README gives `npm install @demlik/tea`, but the Effect engine needs `effect` installed beside it, and a reader who copies the line gets a missing-module error on the first import of `@demlik/tea/effect`.",
			"",
			"The install section should name `effect` too, and say which import needs it.",
		].join("\n"),
		fault: "after-send:link",
	},
} as const;
type RealCase = keyof typeof REAL_CASES;

const PLAN_TICKET = {
	title: "tea README does not say how to install it or where to start (experiment 111)",
	body: "A reader of the tea README cannot tell how to install the package or which page to read first. The README should give the install command and point to the first tutorial, near the top.",
};
const PLAN_README: PlanDraft = {
	...PLAN_8,
	summary:
		"The tea README does not say how to install the package or where to start. After this, its top gives the npm install command and links the first tutorial.",
	stories: [
		{
			id: "s1",
			who: "a new reader",
			want: "to install tea and start",
			why: "a first machine in minutes",
		},
	],
	tasks: [
		{
			title: "Install and first steps at the top of the README",
			ends: "pr" as const,
			job: {
				when: "a new reader opens the README and follows only its first section",
				result: "they have tea installed and are on the first tutorial page",
				fixture: "the README as published, read top to bottom by someone new to tea",
				check: {
					how: "read" as const,
					what: "a reviewer follows the first section on a clean machine",
				},
				serves: ["s1"],
			},
			criteria: [],
		},
	],
};

const realRuns = async () => {
	say("\n== real (haiku, sandbox)");
	// Only whether it is set is read: the value stays in this process's environment.
	if (process.env.REAL !== "1" || (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "") === "") {
		say("real runs need REAL=1 and CLAUDE_CODE_OAUTH_TOKEN in this shell; skipped");
		return;
	}
	const create = (title: string, body: string) =>
		numberIn(ghSandbox(["issue", "create", "-R", SANDBOX, "--title", title, "--body", body]));
	const planNumber = create(PLAN_TICKET.title, PLAN_TICKET.body);
	const tickets = Object.fromEntries(
		Object.entries(REAL_CASES).map(([c, s]) => [c, create(s.title, s.body)]),
	) as Record<RealCase, number>;
	let spent = 0;
	const real: Record<string, unknown> = {agent: "real", plan: planNumber, tickets, runs: []};
	const runs: Record<string, unknown>[] = [];

	type Comment = {id: number; body: string};
	const commentsOf = (n: number): Comment[] =>
		JSON.parse(
			ghSandbox([
				"api",
				`repos/${SANDBOX}/issues/${n}/comments?per_page=100`,
				"--jq",
				"[.[] | {id, body}]",
			]),
		);
	const issueOf = (n: number) =>
		JSON.parse(
			ghSandbox([
				"api",
				`repos/${SANDBOX}/issues/${n}`,
				"--jq",
				"{state, state_reason, labels: [.labels[].name]}",
			]),
		) as {state: string; state_reason: string | null; labels: string[]};
	const SORT_MARK = "<!-- fabrika-key: sort:";
	/** What the run left on the ticket and the plan's ticket, read back. */
	const leftOn = (n: number) => {
		const i = issueOf(n);
		const keyed = commentsOf(n).filter((c) => c.body.includes(SORT_MARK));
		const perKey = new Map<string, number>();
		for (const c of keyed) {
			const key = /<!-- fabrika-key: (\S+) -->/.exec(c.body)?.[1] ?? "?";
			perKey.set(key, (perKey.get(key) ?? 0) + 1);
		}
		return {
			state: i.state,
			reason: i.state_reason,
			labels: i.labels.filter((l) => l.startsWith("sort:")).sort(),
			keyedComments: Object.fromEntries(perKey),
			firstLine: keyed.map((c) => c.body.split("\n")[0]),
		};
	};
	/** Every write a run made, taken back. */
	const takeBack = (n: number) => {
		for (const c of commentsOf(n).filter((c) => c.body.includes(SORT_MARK)))
			ghSandbox(["api", "-X", "DELETE", `repos/${SANDBOX}/issues/comments/${c.id}`]);
		const i = issueOf(n);
		for (const l of i.labels.filter((l) => l.startsWith("sort:")))
			ghSandbox([
				"api",
				"-X",
				"DELETE",
				`repos/${SANDBOX}/issues/${n}/labels/${encodeURIComponent(l)}`,
			]);
		if (i.state === "closed")
			ghSandbox(["api", "-X", "PATCH", `repos/${SANDBOX}/issues/${n}`, "-f", "state=open"]);
	};

	const runReal = async (c: RealCase, fault: string | undefined) => {
		const ledger = `exp111-real-${c}-${Date.now().toString(36)}-${ledgers++}`;
		current = ledger;
		const n = tickets[c];
		const ticket = sandboxIssue(n);
		const name = sortName(n);
		const child = agentOf(name);
		await on(
			ledger,
			Effect.gen(function* () {
				yield* (yield* Ledger).register(name, "harness");
				const planId = readTicketId(sandboxIssue(planNumber));
				const data = revisionOfDraft(PLAN_README);
				if (planId === null || data === null) return yield* Effect.die("the plan does not read");
				yield* sendFact(
					{type: "planned", plan: planOf(planId), tickets: [planId], data, problems: []},
					{id: "seed-plan", by: "harness"},
				);
				yield* cast(
					name,
					"job",
					{ticket, tries: 2, settings: REAL_SETTINGS, usd: REAL_CAP},
					"harness",
				);
			}),
		);
		const env = {
			LEDGER_URL: url,
			LEDGER_NAME: ledger,
			NAME: name,
			AGENT: "real",
			HOLD_USD: String(REAL_SETTINGS.budget),
			// A haiku answer with no tools takes about 3 to 10 s: 1.5 s in is inside it.
			TURN_FAULT_MS: "1500",
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
		await sleep(500);
		for (const h of started) await killGroup(h.pgid);
		const out = (await outcome())?.outcome ?? null;
		const facts = await on(
			ledger,
			Effect.gen(function* () {
				const l = yield* Ledger;
				return {usage: yield* l.usage(child), writes: yield* l.readStream(writesOf(name))};
			}),
		);
		const lines = started.flatMap((h) => h.lines);
		const holds = lines.filter((l) => l.ev === "agent" && l.step === "hold").length;
		const usd = facts.usage?.used.usd ?? 0;
		spent += usd;
		const o = (out ?? {}) as {
			name?: string;
			said?: string | null;
			answer?: Record<string, unknown> | null;
			tries?: number;
		};
		const target =
			o.answer == null
				? null
				: o.said === "duplicate"
					? `#${String(o.answer.of)}`
					: o.said === "no"
						? String(o.answer.rule)
						: o.said === "fold"
							? `#${String(o.answer.partOf)}`
							: null;
		const r = {
			case: c,
			agent: "real",
			fault: fault ?? null,
			faulted,
			finished,
			ms: Date.now() - t0,
			holds,
			usd,
			outcome: o.name ?? null,
			said: o.said ?? null,
			target,
			tries: o.tries ?? null,
			why: typeof o.answer?.why === "string" ? o.answer.why : null,
			ticket: leftOn(n),
			plan: c === "fold" ? leftOn(planNumber) : null,
			intents: facts.writes.flatMap((w) => (w.id?.startsWith("intent:") ? [w.id.slice(7)] : [])),
			steps: lines
				.filter((l) => l.ev === "write" || l.ev === "fault" || l.ev === "agent")
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
			`${c} ${fault ?? "control"}: ${r.outcome} ${r.target ?? ""} in ${r.tries} tries; ${holds} turns, $${usd.toFixed(4)}; ticket ${JSON.stringify(r.ticket.keyedComments)} ${r.ticket.state}/${r.ticket.reason} ${r.ticket.labels.join(",")}; spent $${spent.toFixed(3)}`,
		);
		takeBack(n);
		if (c === "fold") takeBack(planNumber);
		return r;
	};
	const over = () => spent >= REAL_BUDGET - 0.5;

	try {
		const summary: Record<string, unknown> = {};
		for (const c of Object.keys(REAL_CASES) as RealCase[]) {
			if (over()) break;
			const control = await runReal(c, undefined);
			const kills = [];
			for (const fault of ["agent-turn", "agent-answered", REAL_CASES[c].fault].slice(
				0,
				REAL_KILLS,
			)) {
				if (over()) break;
				kills.push(await runReal(c, fault));
			}
			summary[c] = {
				control: `${control.outcome} ${control.target ?? ""}`,
				matches: kills.filter((k) => k.outcome === control.outcome && k.target === control.target)
					.length,
				of: kills.length,
				faulted: kills.filter((k) => k.faulted).length,
				wastedMax: Math.max(0, ...kills.map((k) => k.holds - control.holds)),
				doubledComments: [control, ...kills].filter((k) =>
					[k.ticket, k.plan].some(
						(w) => w !== null && Object.values(w.keyedComments).some((v) => v > 1),
					),
				).length,
			};
		}
		real.summary = summary;
		real.stoppedAtBudget = over();
	} finally {
		for (const n of [planNumber, ...Object.values(tickets)]) {
			// biome-ignore lint/plugin: node at the edge: an issue closed already answers with an error
			try {
				takeBack(n);
				ghSandbox(["issue", "close", String(n), "-R", SANDBOX, "--reason", "not planned"]);
			} catch {
				// closed already
			}
		}
		real.cleaned = true;
		results[REAL_KEY] = real;
		save();
	}
	say(`real: spent about $${spent.toFixed(3)}; ${JSON.stringify(real.summary)}`);
};

try {
	if (only.has("kills")) await killRuns();
	if (only.has("limits")) await limits();
	if (only.has("plants")) await plants();
	if (only.has("real")) await realRuns();
} finally {
	for (const g of groups) await killGroup(g);
	await fake.close();
	await mf.dispose();
}
