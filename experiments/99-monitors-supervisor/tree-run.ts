// One fault run of experiment 99: a supervisor, its children and a watcher, served by three host
// processes on one local ledger, while the harness kills hosts, freezes one, crashes children with
// a planted defect and sends one poison message. Then every check reads the ledger itself.
//
// Node at the edge, as in 93 to 98: the host processes, their signals, and the clock
// (../98-tea-host-package/harness.ts). The ledger and everything written to it go through
// `@kampus/fabrika`.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {cast, Ledger, type Row, streams} from "@kampus/fabrika";
import {LocalLedger, layerLocal} from "@kampus/fabrika/local";
import {Duration, Effect, ManagedRuntime} from "effect";
import {
	type Child,
	firstLines,
	here,
	killGroup,
	node,
	signal,
	sleep,
	started,
	stats,
	stopGroup,
	until,
} from "../98-tea-host-package/harness.ts";
import {childNames} from "./programs.ts";

const HOST = here("99-monitors-supervisor/tree-host.ts");
const LEDGER = "tea-host";
const GRACE_MS = 1000;

export type Preset = "small" | "large";
const PRESETS = {
	/** Messages per child, and the gap between two sends to one child. */
	small: {perChild: 100, gapMs: 200},
	large: {perChild: 1000, gapMs: 20},
} as const;

export interface RunOptions {
	/** The ledger's dead letters: a number of crashes in a row, or `null` (off). */
	readonly maxDeliveries: number | null;
	readonly intensity: number;
	readonly periodMs: number;
	/** `tree`: the full fault run. `escalate`: one host, one poison message, nothing else. */
	readonly mode: "tree" | "escalate";
}

const openLocal = async (persist: string, maxDeliveries: number | null) => {
	const rt = ManagedRuntime.make(
		layerLocal({
			persist,
			ledger: LEDGER,
			graceMs: GRACE_MS,
			maxDeliveries,
			checkEvery: Duration.seconds(1),
		}),
	);
	const local = await rt.runPromise(
		Effect.gen(function* () {
			return yield* LocalLedger;
		}),
	);
	started.add(await rt.runPromise(local.pid));
	const run = <A, E>(e: Effect.Effect<A, E, Ledger>) => rt.runPromise(e);
	return {url: local.url, run, close: () => rt.dispose()};
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
type Fault = {
	kind: "defect" | "poison" | "kill" | "freeze" | "kill_all";
	at: number;
	name?: string;
	host?: string;
	contAt?: number;
	id?: string;
};
const data = <T>(r: Row): T => JSON.parse(r.data) as T;

export async function runOnce(preset: Preset, index: number, o: RunOptions) {
	const p = PRESETS[preset];
	const children = childNames(3);
	const dir = mkdtempSync(join(tmpdir(), "exp99-"));
	const ledger = await openLocal(dir, o.maxDeliveries);
	const log = (s: string) => console.log(`  [${o.mode} ${preset} ${index}] ${s}`);
	const hosts = new Map<string, Child>();
	const dead = new Map<string, number>();
	let made = 0;
	const env = {
		LEDGER_URL: ledger.url,
		LEDGER_NAME: LEDGER,
		CHILDREN: String(children.length),
		INTENSITY: String(o.intensity),
		PERIOD_MS: String(o.periodMs),
		MAX_DELIVERIES: o.maxDeliveries === null ? "off" : String(o.maxDeliveries),
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
	const holderOf = async (name: string) => (await ledger.run(leaseOf(name)))?.holder ?? null;
	/** The watcher's saved state has a monitor on every name. */
	const monitorsOn = async (n: number) => {
		const rows = await ledger.run(
			Effect.gen(function* () {
				return yield* (yield* Ledger).readLast(streams("watcher:1").state, 1);
			}),
		);
		const last = rows.at(-1);
		if (last === undefined) return false;
		const s = data<{state: {monitors: {watches: {status: string}[]}}}>(last).state;
		return s.monitors.watches.filter((w) => w.status === "on").length === n;
	};
	const faults: Fault[] = [];
	const sendAt = new Map<string, number>();
	const t0 = Date.now();
	try {
		await ledger.run(
			Effect.gen(function* () {
				const l = yield* Ledger;
				yield* l.register("sup:1", "harness");
				yield* l.register("watcher:1", "harness");
			}),
		);
		const first = o.mode === "tree" ? 3 : 1;
		for (let i = 0; i < first; i++) spawnHost();
		const upNames = ["sup:1", "watcher:1", ...children];
		await until(
			"every name running",
			() =>
				upNames.every((n) =>
					lines().some((l) => l.name === n && l.ev === "program" && l.phase === "started"),
				),
			30_000,
		);
		const tw = Date.now();
		while (!(await monitorsOn(upNames.length - 1)) && Date.now() - tw < 10_000) await sleep(50);
		const upMs = Date.now() - t0;
		log(`tree up in ${upMs} ms`);

		const send = (name: string, id: string, body: object) =>
			ledger.run(cast(name, id, body, "harness")).then((d) => {
				sendAt.set(id, Date.now());
				return d;
			});

		if (o.mode === "escalate") {
			for (const c of children) for (let k = 0; k < 10; k++) await send(c, `${c}-m${k}`, {});
			await sleep(500);
			const at = Date.now();
			await send("c:3", "poison", {poison: true});
			faults.push({kind: "poison", at, name: "c:3", id: "poison"});
			await until(
				"the supervisor down",
				() => lines().some((l) => l.name === "sup:1" && l.ev === "phase" && l.to === "down"),
				30_000,
			);
			await sleep(1500);
		} else {
			// The senders: every child gets `perChild` plain messages, spread over the faults.
			const senders = children.map(async (c) => {
				for (let k = 0; k < p.perChild; k++) {
					await send(c, `${c}-m${k}`, {});
					await sleep(p.gapMs);
				}
			});
			const defect = async (name: string, n: number) => {
				const id = `${name}-defect${n}`;
				faults.push({kind: "defect", at: Date.now(), name, id});
				await send(name, id, {crashAfter: true});
				log(`planted defect in ${name}`);
			};
			const kill = async (name: string) => {
				const holder = await holderOf(name);
				const h = holder === null ? undefined : hosts.get(holder);
				if (holder === null || h === undefined) return;
				faults.push({kind: "kill", at: Date.now(), name, host: holder});
				await killGroup(h.pgid);
				dead.set(holder, Date.now());
				log(`SIGKILL ${holder} (held ${name}); started ${spawnHost()}`);
			};
			const script = async () => {
				await sleep(1500);
				await defect("c:1", 1);
				await sleep(2000);
				await kill("sup:1");
				await sleep(2000);
				await defect("c:2", 1);
				await sleep(1500);
				const holder = await holderOf("watcher:1");
				const h = holder === null ? undefined : hosts.get(holder);
				if (holder !== null && h !== undefined) {
					const at = Date.now();
					signal(h.pgid, "SIGSTOP");
					await sleep(2500);
					signal(h.pgid, "SIGCONT");
					faults.push({kind: "freeze", at, contAt: Date.now(), name: "watcher:1", host: holder});
					log(`SIGSTOP ${holder} (held watcher:1) for 2500 ms`);
				}
				await sleep(2000);
				const pat = Date.now();
				await send("c:3", "poison", {poison: true});
				faults.push({kind: "poison", at: pat, name: "c:3", id: "poison"});
				log("sent the poison message to c:3");
				await sleep(6000);
				await defect("c:1", 2);
				await sleep(1500);
				await kill("c:1");
				await sleep(2000);
				// Every host at once: every name is taken over. Not one of them is down.
				const at = Date.now();
				for (const [name, h] of hosts)
					if (!dead.has(name)) {
						await killGroup(h.pgid);
						dead.set(name, Date.now());
					}
				faults.push({kind: "kill_all", at});
				await sleep(3000);
				log(`SIGKILL every host; started ${spawnHost()} alone`);
			};
			await Promise.all([...senders, script()]);
			// Every child's count reaches what was sent to it, less what was set aside.
			const want = async () => {
				const rows = await ledger.run(readAll);
				return children.every((c) => {
					const inbox = rows.filter((r) => r.stream === streams(c).inbox).length;
					const deadRows = rows.filter((r) => r.stream === streams(c).dead).length;
					const states = rows.filter((r) => r.stream === streams(c).state);
					const last = states.at(-1);
					return (
						last !== undefined &&
						data<{state: {count: number}}>(last).state.count === inbox - deadRows
					);
				});
			};
			const tq = Date.now();
			while (!(await want()) && Date.now() - tq < 60_000) await sleep(250);
			await sleep(1500);
		}
		const rows = await ledger.run(readAll);
		// KEEP_LOGS=<dir>: every host line and ledger row of the run, to read a failure by hand.
		const keep = process.env.KEEP_LOGS;
		if (keep !== undefined && keep !== "")
			writeFileSync(
				join(keep, `99-${o.mode}-${index}.json`),
				JSON.stringify({lines: lines(), rows, faults}),
			);
		return {
			preset,
			run: index,
			mode: o.mode,
			spec: {intensity: o.intensity, periodMs: o.periodMs, maxDeliveries: o.maxDeliveries},
			upMs,
			...check(rows, lines(), faults, children, sendAt),
			errors: [...hosts.entries()]
				.filter(([, h]) => h.err.join("").trim() !== "")
				.map(([host, h]) => ({host, stderr: firstLines(h.err.join(""))})),
			wallMs: Date.now() - t0,
		};
	} finally {
		for (const h of hosts.values()) await stopGroup(h.pgid);
		await ledger.close();
		rmSync(dir, {recursive: true, force: true});
	}
}

const leaseOf = (name: string) =>
	Effect.gen(function* () {
		const l = yield* (yield* Ledger).lease(name);
		return l !== null && l.expires_at > Date.now() ? l : null;
	});

type Exited = {
	fence: number | null;
	incarnation: number;
	reason: string;
	why: string;
	suspect: number | null;
	by: string | null;
};
type Down = {
	ref: string;
	target: string;
	incarnation: number;
	reason: string;
	why: string;
	at: number;
};
type Reported = {
	target: string;
	kind: "down" | "gap";
	from: number;
	to: number;
	reason: string | null;
};

/** Every check, from the ledger's rows and the hosts' lines. */
export function check(
	rows: readonly Row[],
	lines: readonly Line[],
	faults: readonly Fault[],
	children: readonly string[],
	sendAt: ReadonlyMap<string, number>,
) {
	const names = ["sup:1", "watcher:1", ...children];
	const of = (stream: string) => rows.filter((r) => r.stream === stream);
	const exits = names.flatMap((name) =>
		of(name)
			.filter((r) => r.kind === "exited")
			.map((r) => ({name, at: r.at, pos: r.pos, ...data<Exited>(r)})),
	);
	const restarts = names.flatMap((name) =>
		of(name)
			.filter((r) => r.kind === "restarted")
			.map((r) => ({name, at: r.at, ...data<{incarnation: number; after: number}>(r)})),
	);

	// Planted defects and poison crashes, against the exits the ledger wrote.
	const defects = faults.filter((f) => f.kind === "defect");
	const poisonCrashes = exits.filter((e) => e.reason === "crash" && /poison/.test(e.why));
	const defectCrashes = exits.filter((e) => e.reason === "crash" && /planted defect/.test(e.why));
	const otherExits = exits.filter((e) => !poisonCrashes.includes(e) && !defectCrashes.includes(e));

	// Restart: every crash of a child is followed by its restart, and the program runs again.
	const restartMs: number[] = [];
	const backUpMs: number[] = [];
	const notRestarted: string[] = [];
	const t0 = faults[0]?.at ?? 0;
	const each: {
		child: string;
		ended: number;
		at: number;
		restartMs: number;
		backUpMs: number | null;
		on: string | null;
	}[] = [];
	for (const e of exits.filter((x) => children.includes(x.name))) {
		const r = restarts.find((x) => x.name === e.name && x.after === e.incarnation);
		if (r === undefined) {
			notRestarted.push(`${e.name}@${e.incarnation}`);
			continue;
		}
		restartMs.push(r.at - e.at);
		// The first start of the new run, by time: lines come grouped by host, not in time order.
		const up = lines
			.filter(
				(l) =>
					l.name === e.name &&
					l.ev === "program" &&
					l.phase === "started" &&
					l.incarnation === r.incarnation,
			)
			.sort((a, b) => a.at - b.at)[0];
		if (up !== undefined) backUpMs.push(up.at - e.at);
		each.push({
			child: e.name,
			ended: e.incarnation,
			at: e.at - t0,
			restartMs: r.at - e.at,
			backUpMs: up === undefined ? null : up.at - e.at,
			on: up?.host ?? null,
		});
	}

	// DOWNs in the watcher's inbox: each real one for a real exit; none for a takeover.
	const downs = of(streams("watcher:1").inbox)
		.filter((r) => r.kind === "DOWN")
		.map((r) => ({rev: r.rev, ...data<Down>(r)}));
	const real = downs.filter((d) => d.reason !== "noproc");
	const noprocs = downs.filter((d) => d.reason === "noproc");
	const key = (t: string, i: number) => `${t}@${i}`;
	const exitKeys = new Set(exits.map((e) => key(e.name, e.incarnation)));
	const realKeys = real.map((d) => key(d.target, d.incarnation));
	// Two monitors on one incarnation (a lost answer, then its retry) give two DOWNs: the watcher
	// reports the death once. Counted, not a failure.
	const sameDeathTwice = realKeys.filter((k, i) => realKeys.indexOf(k) !== i);
	const phantomDowns = real.filter((d) => !exitKeys.has(key(d.target, d.incarnation)));
	const unseenByMonitor = exits.filter(
		(e) => e.name !== "watcher:1" && !realKeys.includes(key(e.name, e.incarnation)),
	);

	// What the watcher reported, from its own saved state: every exit of a watched name once, as a
	// `down` or inside a `gap`, and nothing that was not an exit.
	const watcherLast = of(streams("watcher:1").state).at(-1);
	const reported =
		watcherLast === undefined
			? []
			: data<{state: {reported: readonly Reported[]}}>(watcherLast).state.reported;
	const reportedKeys = reported.flatMap((r) =>
		Array.from({length: r.to - r.from + 1}, (_, i) => key(r.target, r.from + i)),
	);
	const watchedExits = exits
		.filter((e) => e.name !== "watcher:1")
		.map((e) => key(e.name, e.incarnation));
	const reportedTwice = reportedKeys.filter((k, i) => reportedKeys.indexOf(k) !== i);
	const reportedNotExit = reportedKeys.filter((k) => !exitKeys.has(k));
	const neverReported = watchedExits.filter((k) => !reportedKeys.includes(k));
	const readAt = new Map<number, number>();
	// The first read of each DOWN, by time (a DOWN is read again after a takeover replays).
	for (const l of lines) {
		if (l.name !== "watcher:1" || l.ev !== "DOWN") continue;
		const was = readAt.get(Number(l.rev));
		if (was === undefined || Number(l.readAt) < was) readAt.set(Number(l.rev), Number(l.readAt));
	}
	const downDeliveryMs = real.flatMap((d) => {
		const t = readAt.get(d.rev);
		return t === undefined ? [] : [t - d.at];
	});

	// Takeovers: claims inside one incarnation after its first. Each must give no exit and no DOWN.
	let takeovers = 0;
	for (const name of names) {
		let claimsThisRun = 0;
		for (const r of of(name)) {
			if (r.kind === "restarted") claimsThisRun = 0;
			if (r.kind === "claimed") {
				claimsThisRun++;
				if (claimsThisRun > 1) takeovers++;
			}
		}
	}
	const killAll = faults.find((f) => f.kind === "kill_all");
	const exitsAfterKillAll =
		killAll === undefined ? 0 : exits.filter((e) => e.at >= killAll.at).length;

	// No two writers: every saved state is under the name's latest claim, and none after an exit.
	const writerBreaks: string[] = [];
	for (const name of names) {
		let fence: number | null = null;
		const own = [...of(name), ...of(streams(name).state)].sort((a, b) => a.pos - b.pos);
		for (const r of own) {
			if (r.kind === "claimed") fence = r.pos;
			if (r.kind === "exited") fence = null;
			if (r.stream !== streams(name).state) continue;
			const f = data<{fence: number}>(r).fence;
			if (f !== fence)
				writerBreaks.push(`${name} pos ${r.pos}: saved under ${f}, latest claim ${fence}`);
		}
	}

	// Counts: each child counted every message in its inbox once, less the ones set aside.
	const counts = children.map((c) => {
		const inbox = of(streams(c).inbox);
		const deadRevs = of(streams(c).dead).map((r) => data<{rev: number}>(r).rev);
		const last = of(streams(c).state).at(-1);
		const count = last === undefined ? 0 : data<{state: {count: number}}>(last).state.count;
		const want = inbox.filter((r) => !deadRevs.includes(r.rev)).length;
		return {name: c, inbox: inbox.length, dead: deadRevs, count, want, exact: count === want};
	});

	// The supervisor's own last word.
	const supLast = of(streams("sup:1").state).at(-1);
	const sup =
		supLast === undefined
			? null
			: data<{state: {phase: string; restarted: number; why: string | null; incarnation: number}}>(
					supLast,
				).state;
	const poison = faults.find((f) => f.kind === "poison");
	const poisonRev = of(streams("c:3").inbox).find((r) => r.id === "poison")?.rev ?? null;
	const supDown = exits.find((e) => e.name === "sup:1");

	return {
		faults: faults.map((f) => ({...f, at: f.at - (faults[0]?.at ?? 0)})),
		exits: {
			total: exits.length,
			defects: {planted: defects.length, exited: defectCrashes.length},
			poisonCrashes: poisonCrashes.length,
			other: otherExits.map(
				(e) => `${e.name}@${e.incarnation} ${e.reason}${e.by === null ? "" : ` by ${e.by}`}`,
			),
			afterKillAll: exitsAfterKillAll,
		},
		restarts: {
			total: restarts.length,
			notRestarted,
			each,
			restartMs: stats(restartMs),
			backUpMs: stats(backUpMs),
		},
		downs: {
			real: real.length,
			noproc: noprocs.length,
			sameDeathTwice,
			phantom: phantomDowns.map((d) => key(d.target, d.incarnation)),
			unseenByMonitor: unseenByMonitor.map((e) => key(e.name, e.incarnation)),
			deliveryMs: stats(downDeliveryMs),
			deliverySamples: downDeliveryMs,
		},
		reported: {
			downs: reported.filter((r) => r.kind === "down").length,
			gaps: reported.filter((r) => r.kind === "gap").map((r) => `${r.target}@${r.from}..${r.to}`),
			deaths: reportedKeys.length,
			watchedExits: watchedExits.length,
			twice: reportedTwice,
			notAnExit: reportedNotExit,
			never: neverReported,
		},
		takeovers,
		writerBreaks,
		counts,
		supervisor: sup,
		poison: {
			rev: poisonRev,
			setAside: of(streams("c:3").dead).map((r) => data<{rev: number; strikes: number}>(r)),
			stillInInbox: poisonRev !== null,
			supDownMs: supDown === undefined || poison === undefined ? null : supDown.at - poison.at,
			supDownWhy: supDown?.why ?? null,
			childrenDown: children.filter((c) => exits.some((e) => e.name === c && e.by === "sup:1")),
		},
		sentLast: Math.max(0, ...sendAt.values()),
	};
}
