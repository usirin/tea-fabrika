// One fault run of experiment 102: top over one ticket per case (more in the large run), each a
// supervisor over a scouts supervisor and a stub-agent builder, served by three host processes on
// one local ledger. The harness SIGKILLs a builder's host mid-turn and later freezes one past its
// lease, then waits for every case to end. Every check reads the ledger itself, and the hosts'
// stdout for the provider's bill (one line per turn that started).
//
// Node at the edge, as in 93 to 101: the host processes, their signals, and the clock
// (../98-tea-host-package/harness.ts). The ledger and everything written to it go through
// `@kampus/fabrika-old`.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger, LedgerUnreachable, limitEnds, Reply, type Row} from "@kampus/fabrika-old";
import {LocalLedger, layerLocal} from "@kampus/fabrika-old/local";
import {Duration, Effect, Exit, ManagedRuntime, Schedule, Schema} from "effect";
import {
	type Child,
	firstLines,
	here,
	killGroup,
	node,
	r1,
	signal,
	sleep,
	started,
	stats,
	stopGroup,
	until,
} from "../98-tea-host-package/harness.ts";
import {BURST, CASES, type Case, HOLD, namesOf, type Size, TURN} from "./programs.ts";

const HOST = here("102-limits/host.ts");
const LEDGER = "tea-host";
const GRACE_MS = 1000;

export type Preset = "small" | "large";
export const PRESETS = {
	small: {perCase: 1, scale: 1, waitMs: 120_000},
	large: {perCase: 4, scale: 3, waitMs: 300_000},
} as const;
/** The turn of each `kill` builder its host is SIGKILLed in, and the one it is frozen in. */
const KILL_AT = "t5";
const FREEZE_AT = "t12";
const FREEZE_MS = 2500;
/** No admission: these cases charge after a turn and never hold. */
const NO_ADMISSION: readonly Case[] = ["ownn", "sumn"];

const openLocal = async (persist: string) => {
	const rt = ManagedRuntime.make(
		layerLocal({
			persist,
			ledger: LEDGER,
			graceMs: GRACE_MS,
			maxDeliveries: 3,
			checkEvery: Duration.seconds(1),
			// The large run's ledger passes the default 500 MB; a memory restart is not this test.
			capMb: 2000,
		}),
	);
	const local = await rt.runPromise(
		Effect.gen(function* () {
			return yield* LocalLedger;
		}),
	);
	/** The child's group now: a restart starts a new one, and the exit handler must know it. */
	const track = async () => {
		started.add(await rt.runPromise(local.pid));
	};
	await track();
	// The harness's own reads, again while the ledger does not answer (a restart, a full pool).
	const run = <A, E>(e: Effect.Effect<A, E, Ledger>) =>
		rt.runPromise(
			e.pipe(
				Effect.retry({
					while: (x) => x instanceof LedgerUnreachable,
					schedule: Schedule.spaced(Duration.millis(200)),
					times: 50,
				}),
			),
		);
	return {
		url: local.url,
		run,
		track,
		stats: () =>
			rt.runPromise(
				Effect.all(
					{restarts: local.restarts, memoryMb: local.memoryMb},
					{concurrency: "unbounded"},
				),
			),
		close: () => rt.dispose(),
	};
};

const readAll = Effect.gen(function* () {
	const ledger = yield* Ledger;
	const all: Row[] = [];
	for (;;) {
		const page = yield* ledger.read(all.at(-1)?.pos ?? 0, 5000);
		all.push(...page);
		if (page.length < 5000) return all;
	}
});

type Line = Record<string, unknown> & {host: string; at: number; name?: string};
type Bill = {name: string; host: string; fence: number; turn: string; usd: number; at: number};
type Spend = {fence: number; turn: string; usd: number; tokens: number};
type Ended = {fence: number | null; incarnation: number; reason: string; why: string};
type Fault = {kind: "kill" | "freeze"; name: string; host: string; turn: string; at: number};
const data = <T>(r: Row): T => JSON.parse(r.data) as T;
const decodeReply = Schema.decodeUnknownExit(Schema.fromJsonString(Reply));
const micros = (usd: number) => Math.round(usd * 1e6);
const usdOf = (m: number) => Math.round(m) / 1e6;

export async function runOnce(preset: Preset, index: number) {
	const p = PRESETS[preset];
	const size: Size = {perCase: p.perCase, scale: p.scale};
	const names = namesOf(size);
	const dir = mkdtempSync(join(tmpdir(), "exp102-"));
	const ledger = await openLocal(dir);
	const log = (s: string) => console.log(`  [${preset} ${index}] ${s}`);
	const hosts = new Map<string, Child>();
	const dead = new Set<string>();
	/** Hosts under a fault now: killed, or frozen. */
	const busy = new Set<string>();
	let made = 0;
	const env = {
		LEDGER_URL: ledger.url,
		LEDGER_NAME: LEDGER,
		PER_CASE: String(size.perCase),
		SCALE: String(size.scale),
	};
	const spawnHost = () => {
		const name = `h${++made}-${index}`;
		hosts.set(name, node(HOST, {...env, HOST: name}));
		return name;
	};
	const lines = (): Line[] =>
		[...hosts.entries()].flatMap(([host, h]) =>
			h.lines.map((l) => ({...l, host, at: Number(l.at)}) as Line),
		);
	const call = <A, E>(f: (l: Ledger["Service"]) => Effect.Effect<A, E>) =>
		ledger.run(
			Effect.gen(function* () {
				return yield* f(yield* Ledger);
			}),
		);
	const exitOf = async (name: string) =>
		(await call((l) => l.readStream(name)))
			.filter((r) => r.kind === "exited")
			.map((r) => data<Ended>(r));
	const faults: Fault[] = [];
	const errAtStop = new Map<Child, number>();
	const t0 = Date.now();
	let endedAt = t0;
	let peakMb = 0;
	let ledgerRestarts = 0;

	/** Wait for a builder's turn line, then hit that host 50 ms into the turn. */
	const hit = async (kind: Fault["kind"], name: string, turn: string) => {
		const seen = () =>
			lines().find(
				(l) => l.name === name && l.ev === "turn" && l.turn === turn && !dead.has(l.host),
			);
		await until(`${name} at ${turn}`, () => seen() !== undefined, p.waitMs);
		const l = seen();
		const h = l === undefined ? undefined : hosts.get(l.host);
		// One fault per host at a time: the large run's builders often share one.
		if (l === undefined || h === undefined || busy.has(l.host)) return;
		busy.add(l.host);
		await sleep(50);
		faults.push({kind, name, host: l.host, turn, at: Date.now()});
		if (kind === "kill") {
			dead.add(l.host);
			await killGroup(h.pgid);
			log(`SIGKILL ${l.host} in ${name}'s ${turn}; started ${spawnHost()}`);
		} else {
			signal(h.pgid, "SIGSTOP");
			await sleep(FREEZE_MS);
			signal(h.pgid, "SIGCONT");
			busy.delete(l.host);
			log(`froze ${l.host} for ${FREEZE_MS} ms in ${name}'s ${turn}`);
		}
	};

	/** Each case is over when the name its limit should end has ended (or the bursts are done). */
	const settled = async (x: (typeof names.all)[number]) => {
		if (x.c === "burst") return lines().some((l) => l.name === x.builder && l.ev === "bursts_done");
		const target = x.c === "sum" || x.c === "sumn" || x.c === "wall" ? x.ticket : x.builder;
		return (await exitOf(target)).some((e) => e.reason.startsWith("limit:"));
	};

	try {
		await call((l) =>
			Effect.gen(function* () {
				yield* l.register("top", "harness");
				// A top name has no parent spec: its limit is the desk's (setLimits).
				yield* l.setLimits("top", {usd: 1000}, "harness");
			}),
		);
		for (let i = 0; i < 3; i++) spawnHost();
		const script = Promise.all(
			names.all
				.filter((x) => x.c === "kill")
				.map(async (x) => {
					await hit("kill", x.builder, KILL_AT);
					await hit("freeze", x.builder, FREEZE_AT);
				}),
		);
		const waitAll = (async () => {
			const open = new Set(names.all);
			while (open.size > 0) {
				if (Date.now() - t0 > p.waitMs)
					throw new Error(`timed out; still open: ${[...open].map((x) => x.ticket).join(", ")}`);
				for (const x of [...open]) if (await settled(x)) open.delete(x);
				await ledger.track();
				const s = await ledger.stats();
				peakMb = Math.max(peakMb, s.memoryMb);
				ledgerRestarts = s.restarts;
				await sleep(500);
			}
		})();
		await Promise.all([script, waitAll]);
		endedAt = Date.now();
		log(`every case ended in ${endedAt - t0} ms`);
		// Late charges (the frozen host's) and the last scouts' exits.
		await sleep(3000);
	} finally {
		// What a host printed to stderr before the harness stopped it: a stop's own noise is not a fault.
		for (const h of hosts.values()) errAtStop.set(h, h.err.length);
		for (const h of hosts.values()) await stopGroup(h.pgid);
	}
	const keep = process.env.KEEP_LOGS;
	if (keep)
		writeFileSync(
			join(keep, `102-${preset}-${index}.jsonl`),
			`${lines()
				.map((l) => JSON.stringify(l))
				.join("\n")}\n`,
		);

	const every = [...names.supervisors, ...names.agents];
	// One name at a time: a few hundred reads at once fill the connection pool.
	const usageOf = (n: string) => call((l) => l.usage(n));
	const recordsOf = (n: string) => ledger.run(limitEnds(n));
	const usage = new Map<string, Awaited<ReturnType<typeof usageOf>>>();
	const records = new Map<string, Awaited<ReturnType<typeof recordsOf>>>();
	let rows: readonly Row[] = [];
	try {
		for (const n of every) {
			usage.set(n, await usageOf(n));
			records.set(n, await recordsOf(n));
		}
		rows = await ledger.run(readAll);
	} finally {
		await ledger.close();
		rmSync(dir, {recursive: true, force: true});
	}
	const errors = [...hosts.entries()].flatMap(([host, h]) => {
		const err = h.err.slice(0, errAtStop.get(h) ?? 0);
		return err.length === 0 || dead.has(host) ? [] : [{host, stderr: firstLines(err.join(""))}];
	});
	return {
		...analyse({preset, size, names, rows, lines: lines(), usage, records, faults, t0, errors}),
		ledger: {restarts: ledgerRestarts, peakMb, rows: rows.length},
		ms: endedAt - t0,
	};
}

// ---------------------------------------------------------------- the checks

type Analysis = {
	preset: Preset;
	size: Size;
	names: ReturnType<typeof namesOf>;
	rows: readonly Row[];
	lines: readonly Line[];
	usage: ReadonlyMap<string, {used: {usd: number; tokens: number}; deadline: number | null} | null>;
	records: ReadonlyMap<
		string,
		readonly {
			limit: string;
			of: string;
			used: number;
			max: number;
			incarnation: number;
			at: number;
		}[]
	>;
	faults: readonly Fault[];
	t0: number;
	errors: readonly {host: string; stderr: string}[];
};

function analyse(a: Analysis) {
	const {names, rows, lines} = a;
	const of = (stream: string) => rows.filter((r) => r.stream === stream);
	const caseOf = (name: string) => name.split(":")[1] as Case;
	const admits = (name: string) => !NO_ADMISSION.includes(caseOf(name));
	const every = [...names.supervisors, ...names.agents];

	// ------------------------------------------------ spend: the ledger's rows against the bill

	const spendOf = (name: string) => {
		const held = new Map<string, Spend>();
		const charged = new Map<string, Spend[]>();
		for (const r of of(`${name}/spend`)) {
			const s = data<Spend>(r);
			const key = `${s.fence}:${s.turn}`;
			if (r.kind === "held") held.set(key, s);
			if (r.kind === "charged") charged.set(key, [...(charged.get(key) ?? []), s]);
		}
		return {held, charged};
	};
	const parentOf = new Map(
		every.map((n) => {
			const reg = of(n).find((r) => r.kind === "registered");
			return [n, reg === undefined ? null : (data<{parent?: string}>(reg).parent ?? null)] as const;
		}),
	);
	const bills: Bill[] = lines
		.filter((l) => l.ev === "turn")
		.map((l) => ({
			name: String(l.name),
			host: l.host,
			fence: Number(l.fence),
			turn: String(l.turn),
			usd: Number(l.usd),
			at: l.at,
		}));
	/** What the ledger counts for one name: a charge where there is one, else its hold. */
	const counted = new Map<string, {usd: number; tokens: number}>();
	const breaks: string[] = [];
	let lostUsd = 0;
	let lostTurns = 0;
	/** A SIGKILL runs nothing, so a turn it cuts with no hold is lost. Lost anywhere else is a bug. */
	const killed = new Set(a.faults.filter((f) => f.kind === "kill").map((f) => f.host));
	const lostElsewhere: string[] = [];
	let heldOnly = 0;
	let heldOverBill = 0;
	for (const n of names.agents) {
		const {held, charged} = spendOf(n);
		let usd = 0;
		let tokens = 0;
		for (const [key, cs] of charged) {
			if (cs.length > 1) breaks.push(`${n} ${key}: charged ${cs.length} times`);
			usd += cs[0]?.usd ?? 0;
			tokens += cs[0]?.tokens ?? 0;
		}
		for (const [key, h] of held)
			if (!charged.has(key)) {
				usd += h.usd;
				tokens += h.tokens;
			}
		counted.set(n, {usd, tokens});
		const mine = bills.filter((b) => b.name === n);
		const billed = new Map<string, Bill[]>();
		for (const b of mine)
			billed.set(`${b.fence}:${b.turn}`, [...(billed.get(`${b.fence}:${b.turn}`) ?? []), b]);
		for (const [key, bs] of billed) {
			if (bs.length > 1) breaks.push(`${n} ${key}: billed ${bs.length} times`);
			const b = bs[0];
			if (b === undefined) continue;
			const c = charged.get(key)?.[0];
			const h = held.get(key);
			if (c !== undefined) {
				if (c.usd !== micros(b.usd))
					breaks.push(`${n} ${key}: charged ${c.usd}, billed ${micros(b.usd)}`);
			} else if (h !== undefined) {
				heldOnly++;
				heldOverBill += h.usd - micros(b.usd);
				if (h.usd < micros(b.usd)) breaks.push(`${n} ${key}: held ${h.usd} under the bill`);
			} else {
				lostTurns++;
				lostUsd += micros(b.usd);
				if (!killed.has(b.host)) lostElsewhere.push(`${n} ${key} on ${b.host}`);
				if (admits(n)) breaks.push(`${n} ${key}: billed and never counted`);
			}
		}
		for (const key of charged.keys())
			if (!billed.has(key)) breaks.push(`${n} ${key}: charged with no bill`);
	}
	const subtree = (n: string): {usd: number; tokens: number} => {
		const own = counted.get(n) ?? {usd: 0, tokens: 0};
		return every
			.filter((k) => parentOf.get(k) === n)
			.map(subtree)
			.reduce((s, x) => ({usd: s.usd + x.usd, tokens: s.tokens + x.tokens}), own);
	};
	// The ledger's running totals against its own rows, name by name (no reset, no double count).
	const totals = every.flatMap((n) => {
		const u = a.usage.get(n);
		if (u === null || u === undefined) return [];
		const want = subtree(n);
		return micros(u.used.usd) === want.usd && u.used.tokens === want.tokens
			? []
			: [
					`${n}: the ledger says ${u.used.usd} usd ${u.used.tokens} tokens, its rows ${usdOf(want.usd)} usd ${want.tokens} tokens`,
				];
	});
	const charges = lines.filter((l) => l.ev === "charged" && l.stopped !== true);
	const resendNotDup = charges.filter((l) => l.how === "ok" && l.againDup !== true).length;
	const stoppedCharges = lines.filter((l) => l.ev === "charged" && l.stopped === true).length;

	// ------------------------------------------------ limit ends: where, how far over, never again

	/** The agents at or under `name`. */
	const under = (name: string) =>
		names.agents.filter((n) => {
			for (let p: string | null = n; p !== null; p = parentOf.get(p) ?? null)
				if (p === name) return true;
			return false;
		});

	const exits = every.flatMap((n) =>
		of(n)
			.filter((r) => r.kind === "exited")
			.map((r) => ({name: n, at: r.at, pos: r.pos, ...data<Ended>(r)})),
	);
	const limitExits = exits.filter((e) => e.reason.startsWith("limit:"));
	const restartedAfter = limitExits.filter((e) =>
		of(e.name).some((r) => r.kind === "restarted" && r.pos > e.pos),
	);
	const unrecorded = limitExits.filter(
		(e) => !(a.records.get(e.name) ?? []).some((x) => x.incarnation === e.incarnation),
	);
	const strayRecords = every.flatMap((n) =>
		(a.records.get(n) ?? [])
			.filter((x) => !limitExits.some((e) => e.name === n && e.incarnation === x.incarnation))
			.map((x) => `${n}:${x.incarnation}`),
	);
	/** Each spent limit: how far past its max the name went, by the end of the run. */
	const spent = [
		...new Set(
			limitExits.flatMap((e) => (a.records.get(e.name) ?? []).map((x) => `${x.limit}|${x.of}`)),
		),
	]
		.map((k) => {
			const [kind = "", name = ""] = k.split("|");
			const rec = [...a.records.values()].flat().find((x) => x.limit === kind && x.of === name);
			const u = a.usage.get(name);
			const used = kind === "usd" ? (u?.used.usd ?? 0) : (u?.used.tokens ?? 0);
			const max = rec?.max ?? 0;
			const over = kind === "usd" ? r1((used - max) * 1e6) / 1e6 : used - max;
			const unit = kind === "usd" ? TURN.usdMax : TURN.tokMax;
			const agents = under(name);
			const endAt = limitExits.find((e) => e.name === name)?.at ?? null;
			// Turns under it the bill shows starting after its end: a host that had not heard yet.
			const late =
				endAt === null ? [] : bills.filter((b) => agents.includes(b.name) && b.at > endAt);
			return {
				kind,
				name,
				admission: admits(name),
				used,
				max,
				over,
				turnsOver: r1(over / unit),
				agents: agents.length,
				turnsAfterEnd: late.length,
				lateHosts: [...new Set(late.map((b) => b.host))],
			};
		})
		.filter((x) => x.kind === "usd" || x.kind === "tokens");
	const overWithAdmission = spent.filter((x) => x.admission && x.over > 1e-9);
	// No admission is the baseline, measured and not gated: one turn in flight per agent under the
	// limit lands past it, and more if a host has not heard of the end yet.
	const overNoAdmission = spent.filter(
		(x) => !x.admission && x.over > x.agents * (x.kind === "usd" ? TURN.usdMax : TURN.tokMax),
	);

	// ------------------------------------------------ wall time

	const regAt = (n: string) => of(n).find((r) => r.kind === "registered")?.at ?? null;
	const wall = limitExits
		.filter((e) => e.reason === "limit:wall")
		.map((e) => {
			const deadline = a.usage.get(e.name)?.deadline ?? null;
			const restarts = of(e.name).filter((r) => r.kind === "restarted");
			const lastRestart = restarts.at(-1)?.at ?? null;
			// The host's clock: when the program under the name was stopped.
			const stopped = lines.find(
				(l) =>
					l.name === e.name &&
					l.ev === "program" &&
					(l.phase === "ended" || l.phase === "stopped") &&
					deadline !== null &&
					l.at >= deadline - 50,
			);
			return {
				name: e.name,
				lateMs: deadline === null ? null : e.at - deadline,
				stoppedMs: stopped === undefined || deadline === null ? null : stopped.at - deadline,
				turnsAfter:
					deadline === null
						? null
						: bills.filter((b) => under(e.name).includes(b.name) && b.at > deadline).length,
				fromStartMs: e.at - (regAt(e.name) ?? e.at),
				restarts: restarts.length,
				// Counted from the last restart, it would have ended at that restart + its wall time.
				fromLastRestartMs: lastRestart === null ? null : e.at - lastRestart,
			};
		});

	// ------------------------------------------------ max_children

	const bursts = names.all
		.filter((x) => x.c === "burst")
		.map((x) => {
			const replies = of(`${x.builder}/inbox`).flatMap((r) => {
				const d = decodeReply(r.data);
				return Exit.isSuccess(d) ? [d.value] : [];
			});
			const per = Array.from({length: BURST.bursts}, (_, b) => {
				const ids = Array.from({length: BURST.asks}, (_, n) => `ask:${b * BURST.asks + n + 1}`);
				const rs = ids.flatMap((id) => replies.filter((r) => r.id === id).slice(0, 1));
				return {
					answered: rs.length,
					ok: rs.filter((r) => r.res.ok).length,
					maxChildren: rs.filter(
						(r) => !r.res.ok && "error" in r.res && r.res.error === "max_children",
					).length,
					other: rs
						.filter((r) => !r.res.ok && !("error" in r.res && r.res.error === "max_children"))
						.map((r) => r.res),
				};
			});
			// The most scouts ever up at once under the cap, from their registry rows.
			const marks = x.scout.flatMap((s) => {
				const up = of(s)
					.filter((r) => r.kind === "registered" || r.kind === "restarted")
					.map((r) => ({at: r.pos, d: 1}));
				const down = of(s)
					.filter((r) => r.kind === "exited")
					.map((r) => ({at: r.pos, d: -1}));
				return [...up, ...down];
			});
			let live = 0;
			let peak = 0;
			for (const m of marks.sort((p, q) => p.at - q.at)) {
				live += m.d;
				peak = Math.max(peak, live);
			}
			return {ticket: x.ticket, per, peak};
		});

	// ------------------------------------------------ per case

	const fencesOf = (n: string) =>
		new Set(
			of(n)
				.filter((r) => r.kind === "claimed")
				.map((r) => r.pos),
		).size;
	const incarnationsOf = (n: string) => 1 + of(n).filter((r) => r.kind === "restarted").length;
	const cases = CASES.map((c) => {
		const xs = names.all.filter((x) => x.c === c);
		return {
			case: c,
			tickets: xs.map((x) => ({
				ticket: x.ticket,
				ends: limitExits
					.filter(
						(e) =>
							e.name === x.ticket ||
							e.name === x.builder ||
							e.name === x.scouts ||
							x.scout.includes(e.name),
					)
					.map((e) => `${e.name} ${e.reason}`),
				builder: {
					usd: a.usage.get(x.builder)?.used.usd ?? null,
					tokens: a.usage.get(x.builder)?.used.tokens ?? null,
					turns: bills.filter((b) => b.name === x.builder).length,
					runs: incarnationsOf(x.builder),
					leases: fencesOf(x.builder),
				},
				ticketUsd: a.usage.get(x.ticket)?.used.usd ?? null,
			})),
		};
	});

	const pass = {
		limitsStopAtTheCap: overWithAdmission.length === 0,
		spendAddsUp: totals.length === 0 && breaks.length === 0,
		lostOnlyToSigkill: lostElsewhere.length === 0,
		resentChargeIsDup: resendNotDup === 0,
		limitExitsNeverRestarted: restartedAfter.length === 0,
		limitExitsInDead: unrecorded.length === 0 && strayRecords.length === 0,
		everyCaseEndedByItsLimit: cases.every((c) =>
			c.tickets.every((t) => c.case === "burst" || t.ends.length > 0),
		),
		crashLoopKeepsSpend: cases
			.filter((c) => c.case === "loop")
			.every((c) => c.tickets.every((t) => t.builder.runs >= 3)),
		takeoverKeepsSpend: cases
			.filter((c) => c.case === "kill")
			.every((c) => c.tickets.every((t) => t.builder.leases >= 2)),
		// Ended on time by the ledger's clock and the host's, no turn after, and a restart reset nothing.
		wallFromFirstStart:
			// The ticket and its builder, in every wall copy.
			wall.length === 2 * a.size.perCase &&
			wall.every(
				(w) =>
					w.lateMs !== null &&
					w.lateMs >= 0 &&
					w.lateMs < 1500 &&
					// null: no host was running it then (its restart not claimed yet, or its host SIGKILLed).
					(w.stoppedMs === null || w.stoppedMs < 1500) &&
					w.turnsAfter === 0 &&
					(w.restarts === 0 || (w.fromLastRestartMs ?? 0) < w.fromStartMs - 100),
			),
		refusalsTyped: bursts.every(
			(b) =>
				b.peak <= BURST.cap &&
				b.per.every(
					(x) =>
						x.answered === BURST.asks &&
						x.ok === BURST.cap &&
						x.maxChildren === BURST.asks - BURST.cap &&
						x.other.length === 0,
				),
		),
		noHostErrors: a.errors.length === 0,
	};
	return {
		preset: a.preset,
		size: a.size,
		pass,
		cases,
		spent,
		noAdmissionPastInFlight: overNoAdmission.map((x) => x.name),
		wall,
		bursts,
		spend: {
			turns: bills.length,
			billedUsd: usdOf(bills.reduce((s, b) => s + micros(b.usd), 0)),
			heldOnlyTurns: heldOnly,
			heldOverBillUsd: usdOf(heldOverBill),
			lostTurns,
			lostUsd: usdOf(lostUsd),
			lostElsewhere,
			chargedOnStop: stoppedCharges,
			breaks,
			totals,
		},
		limitExits: limitExits.map((e) => ({
			name: e.name,
			reason: e.reason,
			incarnation: e.incarnation,
			atMs: e.at - a.t0,
		})),
		restartedAfter: restartedAfter.map((e) => e.name),
		unrecorded: unrecorded.map((e) => e.name),
		strayRecords,
		faults: a.faults.map((f) => ({...f, at: f.at - a.t0})),
		hold: HOLD,
		errors: a.errors,
		wallStats: stats(wall.flatMap((w) => (w.lateMs === null ? [] : [w.lateMs]))),
	};
}
