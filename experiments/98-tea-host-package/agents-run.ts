// Experiment 95's agents-across-hosts test on the package: experiment 97's run and checks
// (../97-one-ledger/agents-run.ts, from 95's), with the same faults (the answerer's container
// killed twice, a second container taking over from a frozen one, the asker's Mac host SIGKILLed
// once), the same presets and the same pass checks. Stub agents only.
//
// What changed: the ledger is the package's local ledger, started and read through
// `@tea-fabrika/tea-host` alone; `asker:1` and `answerer:1` are registered before any host starts;
// the hosts are `serve` (./agents-host.ts), and the asker's calls are the package's call module
// (./asker.ts). The asker's saved state keeps its pending calls under `calls`. The image and the
// volume are this experiment's own (`exp98-host:local`, `exp98-node-modules`); every container
// carries the label `exp98`.
//
// Env, as in 97: WINDOW (8), TIMEOUT_MS (1500), TTL_MS (1000), RENEW_MS (250), STOP_MS (2500),
// RESTART_MS (300), KEEP_LOGS (a folder), KEEP_IMAGE=1.
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {type Lease, Ledger, type Row} from "@tea-fabrika/tea-host";
import {Effect} from "effect";
import {questionOf, stubAnswer} from "../95-agents-across-hosts/question.ts";
import {
	type Child,
	DOCKER,
	docker,
	dockerQuiet,
	firstLines,
	group,
	here,
	killGroup,
	node,
	parse,
	r1,
	removeContainers,
	sleep,
	spawnChild,
	stats,
	stopGroup,
	tempDir,
	until,
	usedDocker,
} from "./harness.ts";
import {LEDGER, liveLease, openLocal} from "./ledger.ts";

const REPO = here("..");
const DIR = here("98-tea-host-package/");
const HOST = here("98-tea-host-package/agents-host.ts");
const IN_CONTAINER_HOST = "experiments/98-tea-host-package/agents-host.ts";
const ASKER = "asker:1";
const ANSWERER = "answerer:1";
const S = {
	asker: ASKER,
	askerState: `${ASKER}/state`,
	askerInbox: `${ASKER}/inbox`,
	answerer: ANSWERER,
	answererState: `${ANSWERER}/state`,
	answererInbox: `${ANSWERER}/inbox`,
};

const LATENCY_N = Number(process.env.LATENCY ?? "200");
const WINDOW = Number(process.env.WINDOW ?? "8");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? "1500");
const TTL_MS = Number(process.env.TTL_MS ?? "1000");
const RENEW_MS = Number(process.env.RENEW_MS ?? "250");
const STOP_MS = Number(process.env.STOP_MS ?? "2500");
const RESTART_MS = Number(process.env.RESTART_MS ?? "300");
const KEEP_LOGS = process.env.KEEP_LOGS;
const KEEP_IMAGE = process.env.KEEP_IMAGE === "1";
const FIRST_FAULT_MS = 1500;
const FAULT_EVERY_MS = 3500;

/** small: 200 questions; large: 2,000. The stub thinks long enough that every fault lands mid-run. */
export const PRESETS = {
	small: {n: 200, stubMs: 80},
	large: {n: 2000, stubMs: 6},
} as const;
type Fault = "kill_b" | "takeover" | "kill_a";
const PLAN: readonly Fault[] = ["kill_b", "kill_b", "takeover", "kill_a"];

// ---------------------------------------------------------------- the image and the volume

export const prepare = () => {
	usedDocker();
	const before = removeContainers();
	const t0 = Date.now();
	docker(["build", "-q", "-t", DOCKER.image, "-f", join(DIR, "Dockerfile"), DIR]);
	const built = Date.now();
	docker([
		"run",
		"--rm",
		"--user",
		"root",
		"--label",
		DOCKER.label,
		"-v",
		`${REPO}:/repo:ro`,
		"-v",
		`${DOCKER.volume}:/ws/node_modules`,
		"--entrypoint",
		"sh",
		DOCKER.image,
		"/repo/experiments/98-tea-host-package/install.sh",
	]);
	return {leftByEarlierRun: before, buildMs: built - t0, installMs: Date.now() - built};
};
export const unprepare = () => {
	const left = removeContainers();
	if (KEEP_IMAGE) return {containers: left, removed: false};
	dockerQuiet(["volume", "rm", DOCKER.volume]);
	dockerQuiet(["image", "rm", DOCKER.image]);
	return {containers: left, removed: true};
};

// ---------------------------------------------------------------- hosts

/** One host: a container (host B) or a Mac process (host A, or B in the local latency run). */
type Box = {
	base: string;
	where: "container" | "mac";
	container: string | null;
	starts: Child[];
	kills: number[];
};
const hostEnv = (ledgerUrl: string, base: string, extra: Record<string, string>) => ({
	LEDGER_URL: ledgerUrl,
	LEDGER_NAME: LEDGER,
	HOST: base,
	TTL_MS: String(TTL_MS),
	RENEW_MS: String(RENEW_MS),
	...extra,
});

const runContainer = (name: string, env: Record<string, string>): Child => {
	const flags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
	return spawnChild(
		"docker",
		[
			"run",
			"--name",
			name,
			"--init",
			"--label",
			DOCKER.label,
			"--add-host",
			"host.docker.internal:host-gateway",
			"-v",
			`${REPO}:/repo:ro`,
			"-v",
			`${DOCKER.volume}:/repo/node_modules:ro`,
			...flags,
			DOCKER.image,
			IN_CONTAINER_HOST,
		],
		{},
	);
};

/** RSS of the Node processes in a container, and what `docker stats` says the container uses. */
const containerMemory = (name: string) => {
	const vm = dockerQuiet([
		"exec",
		name,
		"sh",
		"-c",
		"for p in /proc/[0-9]*; do awk '/^Name:/{n=$2} /^VmRSS:/{print n, $2}' $p/status 2>/dev/null; done",
	]);
	const nodeKb = vm
		.split("\n")
		.filter((l) => l.startsWith("node"))
		.reduce((a, l) => a + Number(l.split(" ")[1] ?? 0), 0);
	const stat = dockerQuiet(["stats", "--no-stream", "--format", "{{.MemUsage}}", name]);
	return {nodeRssMb: r1(nodeKb / 1024), dockerStats: stat.split(" / ")[0] ?? stat};
};
const rssMbOf = (pgid: number, pick: (comm: string) => boolean = () => true) =>
	r1(
		group(pgid)
			.filter((p) => pick(p.comm))
			.reduce((a, p) => a + p.rssKb, 0) / 1024,
	);

// ---------------------------------------------------------------- one run

export type Preset = keyof typeof PRESETS | "latency" | "latency-mac";
type FaultNote = {
	kind: Fault;
	holder: string;
	fence: number;
	at: number;
	leaseEndsAt: number;
	restartAt?: number;
	contAt?: number;
	standby?: {upMs: number};
	pendingAtFault?: number;
};

export async function runOnce(preset: Preset, index: number) {
	const faulted = preset === "small" || preset === "large";
	const n = faulted ? PRESETS[preset].n : LATENCY_N;
	const stubMs = faulted ? PRESETS[preset].stubMs : 0;
	const window = faulted ? WINDOW : 1;
	const dir = tempDir("agents");
	const led = await openLocal(dir);
	const macUrl = led.url;
	const boxUrl = `http://host.docker.internal:${led.port}`;
	const log = (s: string) => console.log(`[agents ${preset} ${index}] ${s}`);
	const tag = `exp98-${preset}-${index}`;
	// Deny by default: both names are registered before any host starts.
	await led.run(
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			yield* ledger.register(ASKER, "runner");
			yield* ledger.register(ANSWERER, "runner");
		}),
	);

	const boxes = new Map<string, Box>();
	const bEnv = {PROGRAM: "answerer", AGENT: "stub", STUB_MS: String(stubMs)};
	const startB = (base: string): Box => {
		if (preset === "latency-mac") {
			const box: Box = {base, where: "mac", container: null, starts: [], kills: []};
			box.starts.push(node(HOST, hostEnv(macUrl, base, bEnv)));
			boxes.set(base, box);
			return box;
		}
		const name = `${tag}-${base}`;
		const box: Box = {base, where: "container", container: name, starts: [], kills: []};
		box.starts.push(runContainer(name, hostEnv(boxUrl, base, bEnv)));
		boxes.set(base, box);
		return box;
	};
	const restartB = (box: Box) => {
		if (box.container === null) throw new Error("only a container is restarted here");
		box.starts.push(spawnChild("docker", ["start", "-a", box.container], {}));
	};
	const aEnv = {
		PROGRAM: "asker",
		TOTAL: String(n),
		WINDOW: String(window),
		TIMEOUT_MS: String(TIMEOUT_MS),
		REAL: "0",
	};
	const startA = (box: Box) => box.starts.push(node(HOST, hostEnv(macUrl, "a", aEnv)));
	const a: Box = {base: "a", where: "mac", container: null, starts: [], kills: []};
	boxes.set("a", a);
	const lineOf = (box: Box, ev: string, after = 0) =>
		box.starts.flatMap((c) => c.lines).find((l) => l.ev === ev && Number(l.at) >= after);
	const holderBox = (holder: string) => boxes.get(holder.split("@")[0] ?? "");

	// Host B first: its cold start is from `docker run` to owning answerer:1.
	const b1 = startB("b1");
	const bRunAt = b1.starts[0]?.spawnedAt ?? Date.now();
	await until("b1 to own answerer:1", () => lineOf(b1, "program") !== undefined, 60_000);
	const claimed = b1.starts
		.flatMap((c) => c.lines)
		.find((l) => l.ev === "claim" && l.answer === "claimed");
	const coldStart = {
		upMs: Number(lineOf(b1, "up")?.seenAt) - bRunAt,
		owningMs: Number(claimed?.at) - bRunAt,
	};
	log(`b1 up ${coldStart.upMs} ms, owning answerer:1 ${coldStart.owningMs} ms after start`);
	startA(a);
	const runStart = Date.now();

	const lastAsker = async () => {
		const rows = await led.run(
			Effect.gen(function* () {
				return yield* (yield* Ledger).readLast(S.askerState, 1);
			}),
		);
		const last = rows.at(-1);
		if (last === undefined) return null;
		const s = parse<{state: {answered: number; calls: {pending: unknown[]}}}>(last.data).state;
		return {answered: s.answered, pending: s.calls.pending};
	};

	// ------------------------------------------------ faults
	const faults: FaultNote[] = [];
	const steadyOwner = async (name: string) => {
		for (let tries = 0; tries < 400; tries++) {
			const lease = await led.run(liveLease(name));
			const box = lease === null ? undefined : holderBox(lease.holder);
			const since = box?.starts
				.flatMap((c) => c.lines)
				.findLast(
					(l) => l.ev === "program" && l.phase === "started" && l.host === lease?.holder,
				)?.at;
			if (
				lease !== null &&
				box !== undefined &&
				typeof since === "number" &&
				Date.now() - since > 300
			)
				return {lease, box};
			await sleep(25);
		}
		throw new Error(`no steady owner of ${name}`);
	};
	// The lease's end, read once the fault has landed: a renew can land between the read that
	// picked the owner and the fault, and would move the end by one renew period.
	const endOf = async (name: string, fence: number) => {
		const l: Lease | null = await led.run(
			Effect.gen(function* () {
				return yield* (yield* Ledger).lease(name);
			}),
		);
		return l !== null && l.fence === fence ? l.expires_at : Number.NaN;
	};
	for (const [i, kind] of (faulted ? PLAN : []).entries()) {
		const due = runStart + FIRST_FAULT_MS + i * FAULT_EVERY_MS;
		await sleep(Math.max(0, due - Date.now()));
		if (kind === "kill_b") {
			const {lease, box} = await steadyOwner(S.answerer);
			const at = Date.now();
			docker(["kill", box.container ?? ""]);
			box.kills.push(at);
			const leaseEndsAt = await endOf(S.answerer, lease.fence);
			log(
				`docker kill ${box.base} (${lease.holder}, fence ${lease.fence}), lease ends in ${leaseEndsAt - at} ms`,
			);
			await sleep(RESTART_MS);
			const restartAt = Date.now();
			restartB(box);
			faults.push({kind, holder: lease.holder, fence: lease.fence, at, leaseEndsAt, restartAt});
		} else if (kind === "takeover") {
			// A second container stands by, then the owner freezes: only one of them may answer.
			const b2 = startB("b2");
			const b2At = b2.starts[0]?.spawnedAt ?? Date.now();
			await until("b2 up", () => lineOf(b2, "up") !== undefined, 60_000);
			const upMs = Number(lineOf(b2, "up")?.seenAt) - b2At;
			const {lease, box} = await steadyOwner(S.answerer);
			const at = Date.now();
			docker(["pause", box.container ?? ""]);
			const leaseEndsAt = await endOf(S.answerer, lease.fence);
			log(
				`b2 up in ${upMs} ms; docker pause ${box.base} (${lease.holder}, fence ${lease.fence}) for ${STOP_MS} ms`,
			);
			await sleep(STOP_MS);
			const contAt = Date.now();
			docker(["unpause", box.container ?? ""]);
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt,
				contAt,
				standby: {upMs},
			});
		} else {
			const {lease} = await steadyOwner(S.asker);
			const pending = (await lastAsker())?.pending.length ?? 0;
			const child = a.starts.at(-1);
			const at = Date.now();
			if (child !== undefined) await killGroup(child.pgid);
			a.kills.push(at);
			const leaseEndsAt = await endOf(S.asker, lease.fence);
			log(`SIGKILL host A (${lease.holder}, fence ${lease.fence}) with ${pending} calls pending`);
			await sleep(RESTART_MS);
			const restartAt = Date.now();
			startA(a);
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt,
				restartAt,
				pendingAtFault: pending,
			});
		}
	}
	const lastFaultAt = Math.max(0, ...faults.map((f) => f.contAt ?? f.restartAt ?? f.at));

	// ------------------------------------------------ drain
	let done = {at: 0, how: "gave up waiting"};
	const limit = faulted ? 240_000 : 120_000;
	for (const t0 = Date.now(); Date.now() - t0 < limit; ) {
		const s = await lastAsker();
		if (s !== null && s.answered === n && s.pending.length === 0) {
			done = {at: Date.now(), how: "all answered"};
			break;
		}
		await sleep(100);
	}
	if (done.at === 0) done = {at: Date.now(), how: "gave up waiting"};
	log(`${done.how} ${done.at - runStart} ms after the first question`);
	await sleep(faulted ? 1500 : 300); // late duplicate replies land, so the checks see them

	// ------------------------------------------------ memory, then stop everything
	const ledgerPid = await led.pid();
	const memory: Record<string, unknown> = {
		ledgerWorkerdMb: rssMbOf(ledgerPid, (c) => c.includes("workerd")),
		ledgerNodeMb: rssMbOf(ledgerPid, (c) => !c.includes("workerd")),
		hostAMb: rssMbOf(a.starts.at(-1)?.pgid ?? -1),
	};
	for (const box of boxes.values())
		if (box.container !== null) memory[box.base] = containerMemory(box.container);
		else if (box.base !== "a")
			memory[box.base] = {nodeRssMb: rssMbOf(box.starts.at(-1)?.pgid ?? -1)};
	const stopAt = Date.now();
	for (const box of boxes.values()) {
		if (box.container !== null) dockerQuiet(["rm", "-f", box.container]);
		for (const c of box.starts) await stopGroup(c.pgid);
	}
	const rows = [...(await led.readAll())];
	await led.close();
	const ledgerLeft = group(ledgerPid).length;
	rmSync(dir, {recursive: true, force: true});

	if (KEEP_LOGS !== undefined) {
		mkdirSync(KEEP_LOGS, {recursive: true});
		for (const box of boxes.values())
			writeFileSync(
				join(KEEP_LOGS, `agents-${preset}-${index}-${box.base}.jsonl`),
				box.starts.flatMap((c) => c.lines.map((l) => JSON.stringify(l))).join("\n"),
			);
	}

	const check = judge({rows, n, boxes, faults, stopAt});
	return {
		preset,
		n,
		window,
		timeoutMs: TIMEOUT_MS,
		stubMs,
		ttlMs: TTL_MS,
		answerer: preset === "latency-mac" ? "mac process" : "container",
		coldStart,
		finishedMs: done.at - runStart,
		finished: done.how,
		/** The last fault came while calls were still open. */
		faultsDuringCalls: faults.length === 0 ? null : lastFaultAt < done.at - 500,
		faults,
		...check,
		memory,
		ledgerProcessesLeftAfterClose: ledgerLeft,
		hostErrors: Object.fromEntries(
			[...boxes.values()].flatMap((b) => {
				const err = b.starts.map((c) => c.err.join("")).join("");
				return err.trim() === "" ? [] : [[b.base, firstLines(err)]];
			}),
		),
	};
}
export type AgentsRun = Awaited<ReturnType<typeof runOnce>>;

// ---------------------------------------------------------------- the checks (95's)

type Line = Record<string, unknown> & {host: string; at: number};

function judge(o: {
	rows: Row[];
	n: number;
	boxes: Map<string, Box>;
	faults: readonly FaultNote[];
	stopAt: number;
}) {
	const of = (stream: string) =>
		o.rows.filter((r) => r.stream === stream).sort((x, y) => x.rev - y.rev);
	// A name's claims and its saved states, in log order: 95 kept both on one registry stream.
	const chainRows = (name: string, state: string) =>
		[...of(name), ...of(state)].sort((x, y) => x.pos - y.pos);
	const askerReg = of(S.asker);
	const answererReg = of(S.answerer);
	const askerRows = chainRows(S.asker, S.askerState);
	const answererRows = chainRows(S.answerer, S.answererState);
	const questions = of(S.answererInbox);
	const replies = of(S.askerInbox);
	const lines: Line[] = [...o.boxes.values()].flatMap((b) =>
		b.starts.flatMap((c) => c.lines.map((l) => ({...l, host: String(l.host), at: Number(l.at)}))),
	);
	const byHost = (h: string) => lines.filter((l) => l.host === h);

	// The asker's chain of saved states: each under the latest claim's fence; answered +1 or +0.
	type AskerSaved = {
		fence: number;
		state: {
			answered: number;
			wrong: number;
			extra: number;
			last: {i: number; answer: string; right: boolean} | null;
		};
	};
	const chain = <T extends {fence: number}>(
		reg: Row[],
		count: (d: T) => number,
		key: (d: T) => string | null,
	) => {
		let fence = 0;
		let prev = 0;
		const once = new Map<string, number>();
		const breaks: string[] = [];
		for (const r of reg) {
			if (r.kind === "claimed") fence = r.pos;
			if (r.kind !== "state") continue;
			const d = parse<T>(r.data);
			if (d.fence !== fence)
				breaks.push(`pos ${r.pos}: saved under fence ${d.fence} after claim ${fence}`);
			const c = count(d);
			if (c === prev + 1) {
				const k = key(d) ?? "?";
				once.set(k, (once.get(k) ?? 0) + 1);
			} else if (c !== prev) breaks.push(`pos ${r.pos}: count ${prev} -> ${c}`);
			prev = c;
		}
		return {once, breaks, final: prev};
	};
	const asked = chain<AskerSaved>(
		askerRows,
		(d) => d.state.answered,
		(d) => (d.state.last === null ? null : String(d.state.last.i)),
	);
	const askerStates = askerRows
		.filter((r) => r.kind === "state")
		.map((r) => parse<AskerSaved>(r.data).state);
	const askerFinal = askerStates.at(-1);
	const wrongAnswers = askerStates.filter(
		(s, i) => s.answered > (askerStates[i - 1]?.answered ?? 0) && s.last?.right === false,
	);
	// Each answer the asker took, against the question's own expected answer (not the machine's word).
	const rightByHarness = askerStates.filter((s, i) => {
		if (s.answered === (askerStates[i - 1]?.answered ?? 0) || s.last === null) return false;
		const q = questionOf(s.last.i, false);
		return Number(/-?\d+/.exec(s.last.answer)?.[0]) === q.expected;
	}).length;
	const askedTwice = [...asked.once.entries()].filter(([, k]) => k > 1).map(([i]) => i);
	const notAnswered = Array.from({length: o.n}, (_, i) => String(i + 1)).filter(
		(i) => !asked.once.has(i),
	);

	// The answerer's chain: an answer produced is a +1 step naming its message id. Each id once.
	type AnswererSaved = {
		fence: number;
		state: {answered: number; repeats: number; last: {id: string; answer: string} | null};
	};
	const produced = chain<AnswererSaved>(
		answererRows,
		(d) => d.state.answered,
		(d) => d.state.last?.id ?? null,
	);
	const producedTwice = [...produced.once.entries()].filter(([, k]) => k > 1).map(([id]) => id);
	const answererStates = answererRows
		.filter((r) => r.kind === "state")
		.map((r) => parse<AnswererSaved>(r.data).state);
	const producedWrong = answererStates.filter((s, i) => {
		if (s.answered === (answererStates[i - 1]?.answered ?? 0) || s.last === null) return false;
		const q = questions.find((r) => parse<{id: string}>(r.data).id === s.last?.id);
		return q !== undefined && s.last.answer !== stubAnswer(parse<{text: string}>(q.data).text);
	}).length;
	// The agent asked: one `think` line per agent run. A run cut off by a kill leaves none.
	const thinks = lines.filter((l) => l.ev === "think");
	const thinkCount = new Map<string, number>();
	for (const t of thinks) thinkCount.set(String(t.id), (thinkCount.get(String(t.id)) ?? 0) + 1);
	const thoughtTwice = [...thinkCount.entries()].filter(([, k]) => k > 1).map(([id]) => id);

	// Who may write: the fence of each claim, its holder, and when the next claim came.
	const claimsOf = (reg: Row[]) => {
		const cs = reg
			.filter((r) => r.kind === "claimed")
			.map((r) => ({fence: r.pos, holder: r.writer, at: r.at}));
		return cs.map((c, i) => ({...c, until: cs[i + 1]?.at ?? Number.POSITIVE_INFINITY}));
	};
	const bClaims = claimsOf(answererReg);
	const aClaims = claimsOf(askerReg);
	const fromHolder = (claims: ReturnType<typeof claimsOf>, r: Row) => {
		const d = parse<{fence?: number}>(r.data);
		const c = claims.find((x) => x.fence === d.fence);
		return c !== undefined && c.holder === r.writer && r.at >= c.at && r.at < c.until;
	};
	const repliesNotFromHolder = replies.filter((r) => !fromHolder(bClaims, r));
	const questionsNotFromHolder = questions.filter((r) => !fromHolder(aClaims, r));
	const replyCount = new Map<string, number>();
	for (const r of replies) {
		const id = parse<{id: string}>(r.data).id;
		replyCount.set(id, (replyCount.get(id) ?? 0) + 1);
	}
	const sendCount = new Map<string, number>();
	for (const r of questions) {
		const id = parse<{id: string}>(r.data).id;
		sendCount.set(id, (sendCount.get(id) ?? 0) + 1);
	}
	// Every write anyone tried and the ledger refused, by its word.
	const refusals: Record<string, number> = {};
	for (const l of lines) {
		const word =
			l.ev === "write" && l.ok === false
				? `save ${String(l.why)}`
				: (l.ev === "reply" || l.ev === "send") && l.how !== "sent"
					? `${String(l.ev)} ${String(l.how)}`
					: null;
		if (word !== null) refusals[word] = (refusals[word] ?? 0) + 1;
	}

	// The frozen owner, woken after the takeover: nothing it wrote after waking may be accepted.
	const zombies = o.faults
		.filter((f) => f.kind === "takeover")
		.map((f) => {
			const cont = f.contAt ?? f.at;
			const ls = byHost(f.holder);
			const accepted = o.rows.filter((r) => r.writer === f.holder && r.at >= cont).length;
			const refusedWrites = ls
				.filter((l) => l.ev === "write" && l.ok === false && l.at >= cont)
				.map((l) => String(l.why));
			const refusedReplies = ls
				.filter((l) => l.ev === "reply" && l.how !== "sent" && l.at >= cont)
				.map((l) => String(l.how));
			const noticed = ls.find((l) => l.ev === "phase" && l.from === "owning" && l.at >= cont);
			const stopped = ls.find(
				(l) => l.ev === "program" && (l.phase === "stopped" || l.phase === "ended") && l.at >= cont,
			);
			const thoughtAfter = ls.filter((l) => l.ev === "think" && l.at >= cont).length;
			const newOwner = bClaims.find((c) => c.at >= f.at && c.fence > f.fence);
			return {
				holder: f.holder,
				fence: f.fence,
				frozenMs: cont - f.at,
				takenBy: newOwner?.holder ?? null,
				acceptedAfterWake: accepted,
				refusedWrites,
				refusedReplies,
				agentRunsFinishedAfterWake: thoughtAfter,
				noticedBy: noticed === undefined ? null : String(noticed.by),
				noticedMs: noticed === undefined ? null : noticed.at - cont,
				programGoneMs: stopped === undefined ? null : stopped.at - cont,
			};
		});

	// Two hosts that both believed they owned answerer:1, and both had a write accepted meanwhile.
	const beliefs: {host: string; from: number; to: number}[] = [];
	for (const box of o.boxes.values()) {
		if (box.base === "a") continue;
		const hs = [...new Set(box.starts.flatMap((c) => c.lines.map((l) => String(l.host))))];
		for (const h of hs) {
			let from: number | null = null;
			for (const l of byHost(h)) {
				if (l.ev !== "phase") continue;
				if (l.to === "owning") from = l.at;
				if (l.from === "owning" && from !== null) {
					beliefs.push({host: h, from, to: l.at});
					from = null;
				}
			}
			const lastSeen = Math.max(...byHost(h).map((l) => l.at));
			if (from !== null)
				beliefs.push({
					host: h,
					from,
					to: Math.min(o.stopAt, box.kills.find((k) => k >= (from ?? 0)) ?? lastSeen + 1),
				});
		}
	}
	const bWrites = o.rows.filter((r) => r.stream === S.answererState || r.stream === S.askerInbox);
	const overlaps: string[] = [];
	let believedTogetherMs = 0;
	for (const [i, x] of beliefs.entries())
		for (const y of beliefs.slice(i + 1)) {
			if (x.host === y.host) continue;
			const lo = Math.max(x.from, y.from);
			const hi = Math.min(x.to, y.to);
			if (lo >= hi) continue;
			believedTogetherMs += hi - lo;
			const by = (h: string) =>
				bWrites.filter((r) => r.writer === h && r.at >= lo && r.at <= hi).length;
			if (by(x.host) > 0 && by(y.host) > 0)
				overlaps.push(`${x.host} and ${y.host} from ${lo} to ${hi}`);
		}

	// Takeovers: after each fault, the next claim and the first save under it.
	const takeovers = o.faults.map((f) => {
		const reg = f.kind === "kill_a" ? askerReg : answererReg;
		const states = of(f.kind === "kill_a" ? S.askerState : S.answererState);
		const claim = reg.find((r) => r.kind === "claimed" && r.at >= f.at && r.pos > f.fence);
		const resumed =
			claim === undefined
				? undefined
				: states.find((r) => parse<{fence: number}>(r.data).fence === claim.pos);
		const startedLine =
			claim === undefined
				? undefined
				: lines.find(
						(l) =>
							l.host === claim.writer &&
							l.ev === "program" &&
							l.phase === "started" &&
							l.fence === claim.pos,
					);
		return {
			kind: f.kind,
			from: f.holder,
			to: claim?.writer ?? null,
			leaseLeftMs: f.leaseEndsAt - f.at,
			claimMs: claim === undefined ? null : claim.at - f.at,
			claimAfterLeaseEndMs: claim === undefined ? null : claim.at - f.leaseEndsAt,
			firstSaveMs: resumed === undefined ? null : resumed.at - f.at,
			replayMs: startedLine === undefined ? null : Number(startedLine.replayMs),
			backlog: startedLine === undefined ? null : Number(startedLine.backlog),
			pendingAtStart: startedLine === undefined ? null : Number(startedLine.pending ?? Number.NaN),
		};
	});
	const restarts = o.faults
		.filter((f) => f.kind === "kill_b")
		.map((f) => {
			const box = o.boxes.get(f.holder.split("@")[0] ?? "");
			const next = box?.starts.find((c) => c.spawnedAt >= f.at);
			const up = next?.lines.find((l) => l.ev === "up");
			return {
				upAfterDockerStartMs:
					up === undefined || next === undefined ? null : Number(up.seenAt) - next.spawnedAt,
			};
		});

	// Round trips, from host A's own lines: a call's sends and the first reply it heard.
	const sends = lines.filter((l) => l.ev === "send" && String(l.host).startsWith("a@"));
	const heard = lines.filter((l) => l.ev === "heard");
	const firstHeard = new Map<string, number>();
	for (const h of heard) if (!firstHeard.has(String(h.id))) firstHeard.set(String(h.id), h.at);
	const oneSend: number[] = [];
	const whole: number[] = [];
	for (const [id, at] of firstHeard) {
		const i = Number(id.slice(2));
		const mine = sends.filter((s) => s.i === i && Number(s.began) <= at);
		const first = mine.reduce((m, s) => Math.min(m, Number(s.began)), Number.POSITIVE_INFINITY);
		if (Number.isFinite(first)) whole.push(at - first);
		if (mine.length === 1 && sends.filter((s) => s.i === i).length === 1)
			oneSend.push(at - Number(mine[0]?.began));
	}
	const sendMs = sends.filter((s) => s.how === "sent").map((s) => Number(s.at) - Number(s.began));
	const writeMs = (prefix: string) =>
		lines
			.filter((l) => l.ev === "write" && l.ok === true && String(l.host).startsWith(prefix))
			.map((l) => l.at - Number(l.sentAt));

	return {
		answered: askerFinal?.answered ?? 0,
		answeredRightByHarness: rightByHarness,
		wrongAnswers: wrongAnswers.length,
		askerExtraReplies: askerFinal?.extra ?? 0,
		answeredTwice: askedTwice.length,
		notAnswered: notAnswered.length,
		askerChainBreaks: asked.breaks.slice(0, 10),
		answersProduced: produced.final,
		answersProducedTwice: producedTwice.length,
		answersProducedWrong: producedWrong,
		answererRepeats: answererStates.at(-1)?.repeats ?? 0,
		answererChainBreaks: produced.breaks.slice(0, 10),
		agentRuns: thinks.length,
		agentRunsForAnIdTwice: thoughtTwice,
		sends: {
			questionsInInbox: questions.length,
			distinctIds: sendCount.size,
			retriedIds: [...sendCount.values()].filter((k) => k > 1).length,
		},
		replies: {
			inInbox: replies.length,
			idsRepliedMoreThanOnce: [...replyCount.values()].filter((k) => k > 1).length,
			notFromLeaseHolder: repliesNotFromHolder.length,
		},
		questionsNotFromLeaseHolder: questionsNotFromHolder.length,
		refusals,
		claims: {answerer: bClaims.map((c) => c.holder), asker: aClaims.map((c) => c.holder)},
		leaseExpiredEvents: o.rows.filter((r) => r.kind === "lease_expired").length,
		zombies,
		overlaps,
		believedTogetherMs,
		takeovers,
		restarts,
		latency: {
			roundTripOneSendMs: stats(oneSend),
			callIncludingRetriesMs: stats(whole),
			sendAppendMs: stats(sendMs),
			askerSaveMs: stats(writeMs("a@")),
			answererSaveMs: stats(writeMs("b")),
		},
		pass: {
			everyQuestionOneRightAnswer:
				(askerFinal?.answered ?? 0) === o.n &&
				askedTwice.length === 0 &&
				notAnswered.length === 0 &&
				rightByHarness === o.n &&
				asked.breaks.length === 0,
			noAnswerProducedTwice:
				producedTwice.length === 0 && produced.breaks.length === 0 && producedWrong === 0,
			repliesOnlyFromLeaseHolder: repliesNotFromHolder.length === 0 && overlaps.length === 0,
			zombieWroteNothing: zombies.every((z) => z.acceptedAfterWake === 0 && z.noticedBy !== null),
		},
	};
}

/** Saved runs of three experiments, read as they were written. */
type Saved = Record<string, any>;

/** 95's and 97's runs against these, by preset. */
export function compareAgents(runs95: Saved[], runs97: Saved[], runs98: Saved[]) {
	const side = (runs: Saved[], preset: string) => {
		const rs = runs.filter((r) => r.preset === preset);
		if (rs.length === 0) return null;
		const range = (xs: number[]) => {
			const f = xs.filter((x) => Number.isFinite(x));
			return f.length === 0 ? null : [Math.min(...f), Math.max(...f)];
		};
		const takeovers = rs.flatMap((r) => r.takeovers);
		return {
			runs: rs.length,
			pass: rs.map((r) => Object.values(r.pass).every((x) => x === true)),
			finishedMs: range(rs.map((r) => r.finishedMs)),
			agentRuns: range(rs.map((r) => r.agentRuns)),
			retriedCalls: range(rs.map((r) => r.sends.retriedIds)),
			roundTripP50Ms: range(rs.map((r) => Number(r.latency.roundTripOneSendMs.p50))),
			roundTripP99Ms: range(rs.map((r) => Number(r.latency.roundTripOneSendMs.p99))),
			takeoverClaimMs: range(
				takeovers.filter((t: Saved) => t.kind === "takeover").map((t: Saved) => t.claimMs),
			),
			killClaimMs: range(
				takeovers.filter((t: Saved) => t.kind !== "takeover").map((t: Saved) => t.claimMs),
			),
			zombieAccepted: rs.flatMap((r) => r.zombies.map((z: Saved) => z.acceptedAfterWake)),
			zombieRefused: rs.flatMap((r) =>
				r.zombies.map((z: Saved) => [...z.refusedWrites, ...z.refusedReplies].join(",")),
			),
		};
	};
	const out: Record<string, unknown> = {};
	for (const preset of ["small", "large"])
		out[preset] = {
			"95": side(runs95, preset),
			"97": side(runs97, preset),
			"98": side(runs98, preset),
		};
	return out;
}
