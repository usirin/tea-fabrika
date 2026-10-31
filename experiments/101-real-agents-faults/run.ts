// One fault run of experiment 101: the asker on the Mac asks N questions of answerer:1, served by
// two containers (b1, b2) running Claude Code. Three faults land while an agent run is in flight,
// plus one crash in the window 98 found:
//
//   kill_turn1   docker kill the owner during a run's first turn
//   kill_turn2   docker kill the owner during a run's second turn (turn 1 is on record)
//   crash        the owner SIGKILLs itself after a run finished, before its answer is saved
//                (CRASH_AFTER, set on both containers, fires once)
//   pause        docker pause the owner during a run, past its lease; the other takes over; unpause
//
// A killed or crashed container is started again (`docker start`), so two hosts are up again.
// After the run every row of the ledger and every host line is read and judged.
import {mkdirSync, rmSync} from "node:fs";
import {Ledger, type Row} from "@kampus/fabrika";
import {Duration, Effect, Schedule} from "effect";
import {numberIn, questionOf} from "../95-agents-across-hosts/question.ts";
import {
	type Child,
	firstLines,
	here,
	node,
	parse,
	sleep,
	spawnChild,
	stats,
	stopGroup,
	tempDir,
	until,
} from "../98-tea-host-package/harness.ts";
import {LEDGER, liveLease, openLocal} from "../98-tea-host-package/ledger.ts";
import {docker, dockerQuiet, runContainer} from "./docker.ts";

const HOST = here("101-real-agents-faults/host.ts");
const IN_CONTAINER = "experiments/101-real-agents-faults/host.ts";
const ASKER = "asker:1";
const ANSWERER = "answerer:1";
const TTL_MS = Number(process.env.TTL_MS ?? "3000");
const RENEW_MS = Number(process.env.RENEW_MS ?? "500");
const STOP_MS = Number(process.env.STOP_MS ?? "4000");
const RESTART_MS = Number(process.env.RESTART_MS ?? "300");
const WINDOW = Number(process.env.WINDOW ?? "1");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? "90000");

type Line = Record<string, unknown> & {host: string; at: number};
type Box = {base: string; container: string; starts: Child[]; paused: boolean};
type FaultKind = "kill_turn1" | "kill_turn2" | "crash" | "pause";
type Fault = {
	kind: FaultKind;
	holder: string;
	fence: number;
	at: number;
	id: string | null;
	session: string | null;
	/** An agent run of the owner had started and had not finished when the fault landed. */
	inFlight: boolean;
	waitedMs?: number;
	contAt?: number;
};

const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo));

export async function runFaulted(o: {
	readonly mode: "fresh" | "resume";
	readonly n: number;
	readonly index: number;
	readonly model: string;
}) {
	const dir = tempDir("101-ledger");
	const marks = tempDir("101-marks");
	mkdirSync(marks, {recursive: true});
	const led = await openLocal(dir);
	const boxUrl = `http://host.docker.internal:${led.port}`;
	const log = (s: string) => console.log(`[run ${o.index} ${o.mode}] ${s}`);
	await led.run(
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			yield* ledger.register(ASKER, "runner");
			yield* ledger.register(ANSWERER, "runner");
		}),
	);
	const crashAfter = `q-${Math.round(o.n / 2)}`;
	const common = {LEDGER_NAME: LEDGER, TTL_MS: String(TTL_MS), RENEW_MS: String(RENEW_MS)};
	const boxes: Box[] = [];
	const startBox = (base: string) => {
		const container = `exp101-r${o.index}-${base}`;
		const box: Box = {base, container, starts: [], paused: false};
		box.starts.push(
			runContainer(
				container,
				IN_CONTAINER,
				{
					...common,
					LEDGER_URL: boxUrl,
					HOST: base,
					PROGRAM: "answerer",
					MODE: o.mode,
					MODEL: o.model,
					CRASH_AFTER: crashAfter,
					MARKS: "/marks",
				},
				{mounts: [`${marks}:/marks`]},
			),
		);
		boxes.push(box);
		return box;
	};
	const asker: Child[] = [];
	const lines = (): Line[] =>
		[...boxes.flatMap((b) => b.starts), ...asker].flatMap((c) =>
			c.lines.map((l) => ({...l, host: String(l.host), at: Number(l.at)})),
		);
	const boxOf = (holder: string) => boxes.find((b) => holder.startsWith(`${b.base}@`));

	const b1 = startBox("b1");
	await until(
		"b1 to own answerer:1",
		() => b1.starts[0]?.lines.some((l) => l.ev === "program") ?? false,
		120_000,
	);
	startBox("b2");
	await until(
		"b2 up",
		() => boxes[1]?.starts[0]?.lines.some((l) => l.ev === "up") ?? false,
		120_000,
	);
	asker.push(
		node(HOST, {
			...common,
			LEDGER_URL: led.url,
			HOST: "a",
			PROGRAM: "asker",
			TOTAL: String(o.n),
			WINDOW: String(WINDOW),
			TIMEOUT_MS: String(TIMEOUT_MS),
		}),
	);
	const runStart = Date.now();
	log(`asking ${o.n} questions; crash planted after ${crashAfter}`);

	// Two answerers stay up: a container that exited (killed or crashed) is started again.
	let stopping = false;
	const restarts: {base: string; at: number}[] = [];
	const keeper = (async () => {
		while (!stopping) {
			for (const b of boxes) {
				const last = b.starts.at(-1);
				if (last !== undefined && last.proc.exitCode !== null && !stopping) {
					await sleep(RESTART_MS);
					if (stopping) break;
					restarts.push({base: b.base, at: Date.now()});
					b.starts.push(spawnChild("docker", ["start", "-a", b.container], {}));
				}
			}
			await sleep(100);
		}
	})();

	/** The harness's own reads: a transport error is retried, never fatal (counted). */
	let readErrors = 0;
	const read = <A, E>(e: Effect.Effect<A, E, Ledger>) =>
		led.run(
			e.pipe(
				Effect.tapError(() =>
					Effect.sync(() => {
						readErrors++;
					}),
				),
				Effect.retry({times: 50, schedule: Schedule.spaced(Duration.millis(100))}),
			),
		);
	const answeredNow = async () => {
		const rows = await read(
			Effect.gen(function* () {
				return yield* (yield* Ledger).readLast(`${ASKER}/state`, 1);
			}),
		);
		const last = rows.at(-1);
		if (last === undefined) return {answered: 0, pending: 1};
		const s = parse<{state: {answered: number; calls: {pending: unknown[]}}}>(last.data).state;
		return {answered: s.answered, pending: s.calls.pending.length};
	};
	const waitAnswered = async (k: number) => {
		for (;;) {
			if ((await answeredNow()).answered >= k) return;
			await sleep(200);
		}
	};
	const owner = async () => {
		for (;;) {
			const lease = await read(liveLease(ANSWERER));
			const box = lease === null ? undefined : boxOf(lease.holder);
			if (lease !== null && box !== undefined && !box.paused) return {lease, box};
			await sleep(50);
		}
	};
	const ofHost = (h: string) => lines().filter((l) => l.host === h);

	/** Land a fault while one of the owner's runs is in flight; try again on the next run if not. */
	const landInFlight = async (
		kind: "kill_turn1" | "kill_turn2" | "pause",
		act: (box: Box) => void,
	): Promise<Fault> => {
		for (let tries = 0; tries < 20; tries++) {
			const {lease, box} = await owner();
			const since = Date.now();
			const trigger = await new Promise<Line | null>((resolve) => {
				const t = setInterval(() => {
					const l = ofHost(lease.holder).find(
						(x) =>
							x.at >= since &&
							(kind === "kill_turn2"
								? x.ev === "turn" && x.turn === 1 && x.ok === true
								: x.ev === "ask" && x.how === "fresh"),
					);
					if (l !== undefined || Date.now() - since > 60_000) {
						clearInterval(t);
						resolve(l ?? null);
					}
				}, 20);
			});
			if (trigger === null) continue;
			const session = String(trigger.session);
			const waitedMs = kind === "kill_turn2" ? rand(100, 400) : rand(600, 2400);
			await sleep(Math.max(0, trigger.at + waitedMs - Date.now()));
			const finished = () =>
				ofHost(lease.holder).some(
					(x) =>
						x.session === session &&
						((x.ev === "turn" && kind !== "kill_turn2") ||
							(x.ev === "turn" && x.turn === 2) ||
							x.ev === "think"),
				);
			if (finished()) {
				log(`${kind}: ${trigger.id}'s turn ended before the fault; next run`);
				continue;
			}
			const at = Date.now();
			act(box);
			return {
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				id: String(trigger.id),
				session,
				inFlight: true,
				waitedMs,
			};
		}
		throw new Error(`${kind}: no run in flight to land on`);
	};

	const faults: Fault[] = [];
	let error: string | null = null;
	const land = async () => {
		await waitAnswered(3);
		faults.push(
			await landInFlight("kill_turn1", (b) => {
				docker(["kill", b.container]);
			}),
		);
		log(`kill_turn1 on ${faults.at(-1)?.holder} during ${faults.at(-1)?.id}`);
		await waitAnswered(8);
		faults.push(
			await landInFlight("kill_turn2", (b) => {
				docker(["kill", b.container]);
			}),
		);
		log(`kill_turn2 on ${faults.at(-1)?.holder} during ${faults.at(-1)?.id}`);
		// The crash fires by itself; note it once its line is in.
		await until("the planted crash", () => lines().some((l) => l.ev === "crash"), 600_000);
		const crashLine = lines().find((l) => l.ev === "crash");
		if (crashLine !== undefined) {
			const claims = await read(
				Effect.gen(function* () {
					return yield* (yield* Ledger).readStream(ANSWERER);
				}),
			);
			const fence =
				claims.filter((r) => r.kind === "claimed" && r.writer === crashLine.host).at(-1)?.pos ?? 0;
			faults.push({
				kind: "crash",
				holder: crashLine.host,
				fence,
				at: crashLine.at,
				id: String(crashLine.id),
				session: String(crashLine.session),
				inFlight: false,
			});
			log(`crash on ${crashLine.host} after ${crashLine.id}'s run, before its answer was saved`);
		}
		await waitAnswered(Math.round(o.n * 0.75));
		const paused = await landInFlight("pause", (b) => {
			b.paused = true;
			docker(["pause", b.container]);
		});
		await sleep(STOP_MS);
		const pausedBox = boxOf(paused.holder);
		// Taken before the unpause: the woken host's first lines can land before `docker` returns.
		const contAt = Date.now();
		if (pausedBox !== undefined) {
			docker(["unpause", pausedBox.container]);
			pausedBox.paused = false;
		}
		faults.push({...paused, contAt});
		log(`pause on ${paused.holder} during ${paused.id} for ${STOP_MS} ms`);
	};
	// A harness error is kept, and the run is still drained and judged with what it has.
	await land().catch((e: unknown) => {
		error = e instanceof Error ? e.message : String(e);
		log(`fault plan stopped: ${error}`);
	});

	// ------------------------------------------------ drain
	let finished = "gave up waiting";
	let doneAt = 0;
	for (const t0 = Date.now(); Date.now() - t0 < 600_000;) {
		const s = await answeredNow();
		if (s.answered === o.n && s.pending === 0) {
			finished = "all answered";
			doneAt = Date.now();
			break;
		}
		await sleep(250);
	}
	if (doneAt === 0) doneAt = Date.now();
	log(`${finished} ${doneAt - runStart} ms after the first question`);
	await sleep(3000); // late lines (a woken owner's) come in before the judging

	stopping = true;
	await keeper;
	const stopAt = Date.now();
	for (const b of boxes) dockerQuiet(["rm", "-f", b.container]);
	for (const c of [...boxes.flatMap((b) => b.starts), ...asker]) await stopGroup(c.pgid);
	const rows = [...(await led.readAll())];
	const ledgerRestarts = await led.restarts();
	const ledgerMemoryMb = await led.memoryMb();
	await led.close();
	rmSync(dir, {recursive: true, force: true});
	rmSync(marks, {recursive: true, force: true});

	const all = lines();
	faults.sort((x, y) => x.at - y.at);
	const judged = judge({rows, n: o.n, lines: all, faults, stopAt});
	return {
		mode: o.mode,
		n: o.n,
		model: o.model,
		window: WINDOW,
		ttlMs: TTL_MS,
		stopMs: STOP_MS,
		crashAfter,
		finished,
		finishedMs: doneAt - runStart,
		faults,
		restarts: restarts.length,
		error,
		harnessReadErrors: readErrors,
		ledger: {restarts: ledgerRestarts, memoryMb: ledgerMemoryMb, rows: rows.length},
		...judged,
		hostErrors: Object.fromEntries(
			[...boxes.map((b) => [b.base, b.starts] as const), ["a", asker] as const].flatMap(
				([base, cs]) => {
					const err = cs.map((c) => c.err.join("")).join("");
					return err.trim() === "" ? [] : [[base, firstLines(err)]];
				},
			),
		),
		logs: all.map((l) => JSON.stringify(l)),
	};
}

// ---------------------------------------------------------------- the checks

function judge(o: {
	rows: Row[];
	n: number;
	lines: Line[];
	faults: readonly Fault[];
	stopAt: number;
}) {
	const of = (stream: string) =>
		o.rows.filter((r) => r.stream === stream).sort((x, y) => x.rev - y.rev);
	const byPos = (a: Row[], b: Row[]) => [...a, ...b].sort((x, y) => x.pos - y.pos);
	const askerRows = byPos(of(ASKER), of(`${ASKER}/state`));
	const answererRows = byPos(of(ANSWERER), of(`${ANSWERER}/state`));
	const replies = of(`${ASKER}/inbox`);

	/** A chain of saved states: each under the latest claim's fence; the count goes +1 or +0. */
	const chain = <T extends {fence: number}>(
		rows: Row[],
		count: (d: T) => number,
		key: (d: T) => string,
	) => {
		let fence = 0;
		let prev = 0;
		const once = new Map<string, number>();
		const breaks: string[] = [];
		for (const r of rows) {
			if (r.kind === "claimed") fence = r.pos;
			if (r.kind !== "state") continue;
			const d = parse<T>(r.data);
			if (d.fence !== fence) breaks.push(`pos ${r.pos}: fence ${d.fence} after claim ${fence}`);
			const c = count(d);
			if (c === prev + 1) once.set(key(d), (once.get(key(d)) ?? 0) + 1);
			else if (c !== prev) breaks.push(`pos ${r.pos}: count ${prev} -> ${c}`);
			prev = c;
		}
		return {once, breaks, final: prev};
	};
	type AskerSaved = {
		fence: number;
		state: {answered: number; last: {i: number; answer: string} | null};
	};
	const asked = chain<AskerSaved>(
		askerRows,
		(d) => d.state.answered,
		(d) => String(d.state.last?.i ?? "?"),
	);
	const askerStates = askerRows
		.filter((r) => r.kind === "state")
		.map((r) => parse<AskerSaved>(r.data).state);
	let right = 0;
	const wrong: string[] = [];
	for (const [i, s] of askerStates.entries()) {
		if (s.answered === (askerStates[i - 1]?.answered ?? 0) || s.last === null) continue;
		if (numberIn(s.last.answer) === questionOf(s.last.i).expected) right++;
		else wrong.push(`q-${s.last.i}: ${s.last.answer.slice(0, 40)}`);
	}
	type AnswererSaved = {fence: number; state: {answered: number; last: {id: string} | null}};
	const produced = chain<AnswererSaved>(
		answererRows,
		(d) => d.state.answered,
		(d) => d.state.last?.id ?? "?",
	);

	// Who may write: each claim's fence, holder, and when the next claim came.
	const claims = of(ANSWERER)
		.filter((r) => r.kind === "claimed")
		.map((r) => ({fence: r.pos, holder: r.writer, at: r.at}))
		.map((c, i, cs) => ({...c, until: cs[i + 1]?.at ?? Number.POSITIVE_INFINITY}));
	const notFromHolder = replies.filter((r) => {
		const d = parse<{fence?: number}>(r.data);
		const c = claims.find((x) => x.fence === d.fence);
		return !(c !== undefined && c.holder === r.writer && r.at >= c.at && r.at < c.until);
	}).length;

	// The agent runs: one `ask` line each.
	const asks = o.lines.filter((l) => l.ev === "ask");
	const turns = o.lines.filter((l) => l.ev === "turn");
	const thinks = o.lines.filter((l) => l.ev === "think");
	const crashes = o.lines.filter((l) => l.ev === "crash");
	const runs = asks.map((a) => {
		const s = String(a.session);
		const ts = turns.filter((t) => t.session === s);
		const think = thinks.find((t) => t.session === s);
		const crashed = crashes.some((c) => c.session === s);
		const wanted = 2 - Number(a.done ?? 0);
		const results = ts.length;
		const cut = think === undefined && !crashed;
		return {
			id: String(a.id),
			session: s,
			host: a.host,
			how: String(a.how),
			at: a.at,
			results,
			cut,
			crashed,
			/** Turns sent: each result, and the turn in flight when it was cut. */
			turnsSent: results + (cut && results < wanted ? 1 : 0),
			usd: Math.max(0, ...ts.map((t) => Number(t.usd))),
			ms: think === undefined ? null : Number(think.ms),
		};
	});
	const recovered = thinks.filter((t) => t.how === "recover");
	const usdSeen = runs.reduce((a, r) => a + r.usd, 0);
	// The cost of a turn cut mid-flight is never reported; estimate it as the median finished turn.
	const turnUsd = (k: number) => {
		const xs: number[] = [];
		for (const r of runs) {
			const ts = turns
				.filter((t) => t.session === r.session)
				.sort((x, y) => Number(x.turn) - Number(y.turn));
			for (const [j, t] of ts.entries()) {
				const before = j === 0 ? 0 : Number(ts[j - 1]?.usd ?? 0);
				if (Number(t.turn) === k) xs.push(Number(t.usd) - before);
			}
		}
		return stats(xs).p50 ?? 0;
	};
	const cutTurns = runs.filter((r) => r.cut && r.turnsSent > r.results);
	const usdCutEstimate = cutTurns.reduce((a, r) => {
		const next = (r.how === "resume" ? 2 : 1) + r.results;
		return a + turnUsd(next);
	}, 0);
	const cleanQuestionUsd = (() => {
		const xs = runs.filter((r) => r.how === "fresh" && r.results === 2 && !r.cut).map((r) => r.usd);
		return stats(xs).p50 ?? 0;
	})();

	// Takeovers: after each fault, the next claim, and the new owner's first answer.
	const takeovers = o.faults.map((f) => {
		const claim = claims.find((c) => c.at >= f.at && c.fence > f.fence);
		const firstThink =
			claim === undefined
				? undefined
				: thinks.find((t) => t.host === claim.holder && t.at >= claim.at);
		const forId =
			claim === undefined || f.id === null
				? []
				: runs.filter((r) => r.id === f.id && r.host === claim.holder && r.at >= claim.at);
		const recoveredHere = recovered.some(
			(t) => t.id === f.id && claim !== undefined && t.host === claim.holder,
		);
		return {
			kind: f.kind,
			id: f.id,
			inFlight: f.inFlight,
			from: f.holder,
			to: claim?.holder ?? null,
			claimMs: claim === undefined ? null : claim.at - f.at,
			firstAnswerMs: firstThink === undefined ? null : firstThink.at - f.at,
			newOwnerDid: recoveredHere ? "recover" : (forId[0]?.how ?? null),
			newOwnerRunMs: forId.find((r) => r.ms !== null)?.ms ?? null,
		};
	});

	// The paused owner: nothing it wrote after waking may be accepted; what its agent did meanwhile.
	const zombies = o.faults
		.filter((f) => f.kind === "pause")
		.map((f) => {
			const cont = f.contAt ?? f.at;
			const ls = o.lines.filter((l) => l.host === f.holder && l.at >= cont);
			return {
				holder: f.holder,
				frozenMs: cont - f.at,
				acceptedAfterWake: o.rows.filter((r) => r.writer === f.holder && r.at >= cont).length,
				turnsAfterWake: ls.filter((l) => l.ev === "turn").length,
				runsFinishedAfterWake: ls.filter((l) => l.ev === "think").length,
				runsStartedAfterWake: ls.filter((l) => l.ev === "ask").length,
				usdAfterWake: Math.max(0, ...ls.filter((l) => l.ev === "turn").map((l) => Number(l.usd))),
				programGoneMs: (() => {
					const s = ls.find(
						(l) => l.ev === "program" && (l.phase === "stopped" || l.phase === "ended"),
					);
					return s === undefined ? null : s.at - cont;
				})(),
				refusedReplies: ls
					.filter((l) => l.ev === "reply" && l.how !== "sent")
					.map((l) => String(l.how)),
			};
		});

	// Latency, from the asker's lines: a question's first send to the first reply it heard.
	const sends = o.lines.filter((l) => l.ev === "send");
	const heard = new Map<string, number>();
	for (const h of o.lines.filter((l) => l.ev === "heard"))
		if (!heard.has(String(h.id))) heard.set(String(h.id), h.at);
	const faultIds = new Set(o.faults.map((f) => f.id));
	const all: number[] = [];
	const clean: number[] = [];
	for (const [id, at] of heard) {
		const i = Number(id.slice(2));
		const first = Math.min(...sends.filter((s) => s.i === i).map((s) => Number(s.began)));
		if (!Number.isFinite(first)) continue;
		all.push(at - first);
		if (!faultIds.has(id)) clean.push(at - first);
	}
	const runMs = runs.filter((r) => r.ms !== null && r.how === "fresh").map((r) => Number(r.ms));
	const resumeMs = runs.filter((r) => r.ms !== null && r.how === "resume").map((r) => Number(r.ms));

	const answered = askerStates.at(-1)?.answered ?? 0;
	const askedTwice = [...asked.once.values()].filter((k) => k > 1).length;
	const producedTwice = [...produced.once.values()].filter((k) => k > 1).length;
	const takeoverCount = takeovers.filter((t) => t.to !== null).length;
	const extraRuns = runs.length - o.n;
	const turnsSent = runs.reduce((a, r) => a + r.turnsSent, 0);
	return {
		answered,
		answeredRight: right,
		wrong,
		answeredTwice: askedTwice,
		notAnswered: o.n - asked.once.size,
		askerChainBreaks: asked.breaks.slice(0, 5),
		answersProducedTwice: producedTwice,
		answererChainBreaks: produced.breaks.slice(0, 5),
		repliesNotFromHolder: notFromHolder,
		agent: {
			runsStarted: runs.length,
			runsPerQuestion: Math.round((runs.length / o.n) * 1000) / 1000,
			extraRuns,
			byHow: {
				fresh: runs.filter((r) => r.how === "fresh").length,
				resume: runs.filter((r) => r.how === "resume").length,
				recover: recovered.length,
			},
			runsCut: runs.filter((r) => r.cut).length,
			runsFinishedButLost: runs.filter((r) => r.crashed).length,
			turnsSent,
			turnsNeeded: 2 * o.n,
			extraTurns: turnsSent - 2 * o.n,
			takeovers: takeoverCount,
			extraRunsPerTakeover:
				takeoverCount === 0 ? null : Math.round((extraRuns / takeoverCount) * 100) / 100,
			extraTurnsPerTakeover:
				takeoverCount === 0
					? null
					: Math.round(((turnsSent - 2 * o.n) / takeoverCount) * 100) / 100,
			runMs: stats(runMs),
			resumeRunMs: stats(resumeMs),
		},
		usd: {
			total: usdSeen + usdCutEstimate,
			reported: usdSeen,
			cutTurnsEstimate: usdCutEstimate,
			cleanQuestion: cleanQuestionUsd,
			turn1: turnUsd(1),
			turn2: turnUsd(2),
			/** Spend past n clean questions: what the faults cost. */
			wasted: usdSeen + usdCutEstimate - o.n * cleanQuestionUsd,
		},
		latency: {questionMs: stats(all), questionNoFaultMs: stats(clean)},
		claims: claims.map((c) => c.holder),
		takeovers,
		zombies,
		pass: {
			everyQuestionOneRightAnswer:
				answered === o.n && askedTwice === 0 && right === o.n && asked.breaks.length === 0,
			noAnswerProducedTwice: producedTwice === 0 && produced.breaks.length === 0,
			repliesOnlyFromLeaseHolder: notFromHolder === 0,
			zombieWroteNothing: zombies.every((z) => z.acceptedAfterWake === 0),
			everyFaultMidRun: o.faults.filter((f) => f.kind !== "crash").every((f) => f.inFlight),
		},
	};
}
