// One fault run of experiment 100: a two-level tree (top over a one_for_all and a rest_for_one
// supervisor), six workers and a watcher, served by three host processes on one local ledger,
// while the harness kills hosts, freezes the watcher's host during a crash, plants crashes, a
// crash loop, a poison message and its redrive, and makes calls. Then every check reads the
// ledger itself.
//
// `tree`: the full fault run; the crash loop backs off, its supervisor gives up, and top restarts
// it once (the flag is cleared when that give-up lands). `escalate`: the crash loop is never
// fixed, so sup:rest gives up again and again until top gives up and takes its tree down.
//
// Node at the edge, as in 93 to 99: the host processes, their signals, and the clock
// (../98-tea-host-package/harness.ts). The ledger and everything written to it go through
// `@kampus/fabrika`.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
	type Answer,
	cast,
	deadLetters,
	Ledger,
	type Redriven,
	Reply,
	type Row,
	redrive,
	streams,
} from "@kampus/fabrika";
import {LocalLedger, layerLocal} from "@kampus/fabrika/local";
import {Duration, Effect, Exit, ManagedRuntime, Schema} from "effect";
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
import {FLAGS, type Flags, RETRY, SPECS, WATCHED, WORKERS} from "./programs.ts";

const HOST = here("100-supervision-tree/host.ts");
const LEDGER = "tea-host";
const GRACE_MS = 1000;
const MAX_DELIVERIES = 3;
const HARNESS = "harness:1";

export type Preset = "small" | "large";
const PRESETS = {
	/** Messages per worker, and the gap between two sends to one worker. */
	small: {perChild: 100, gapMs: 400},
	large: {perChild: 1000, gapMs: 40},
} as const;
export type Mode = "tree" | "escalate";

const openLocal = async (persist: string) => {
	const rt = ManagedRuntime.make(
		layerLocal({
			persist,
			ledger: LEDGER,
			graceMs: GRACE_MS,
			maxDeliveries: MAX_DELIVERIES,
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
	kind: "defect" | "poison" | "kill" | "freeze" | "kill_all" | "crash_loop" | "fixed" | "redrive";
	at: number;
	name?: string;
	host?: string;
	contAt?: number;
	id?: string;
	/** A freeze: the child crashed during it, and the host its lease named then. */
	child?: string;
	childHost?: string | null;
	holders?: Record<string, string | null>;
};
type Called = {
	id: string;
	to: string;
	req: unknown;
	sends: number;
	res: Answer | null;
	ms: number;
	sentAt: number;
};
const data = <T>(r: Row): T => JSON.parse(r.data) as T;
const decodeReply = Schema.decodeUnknownExit(Schema.fromJsonString(Reply));
const waitFor = async (what: string, ok: () => Promise<boolean>, ms: number) => {
	const t0 = Date.now();
	while (!(await ok())) {
		if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
		await sleep(50);
	}
};

export async function runOnce(preset: Preset, index: number, mode: Mode) {
	const p = PRESETS[preset];
	const dir = mkdtempSync(join(tmpdir(), "exp100-"));
	const ledger = await openLocal(dir);
	const log = (s: string) => console.log(`  [${mode} ${preset} ${index}] ${s}`);
	const hosts = new Map<string, Child>();
	const dead = new Map<string, number>();
	let made = 0;
	const env = {LEDGER_URL: ledger.url, LEDGER_NAME: LEDGER};
	const spawnHost = () => {
		const name = `h${++made}-${index}`;
		hosts.set(name, node(HOST, {...env, HOST: name}));
		return name;
	};
	const lines = (): Line[] =>
		[...hosts.entries()].flatMap(([host, h]) =>
			h.lines.map((l) => ({...l, host, at: Number(l.at)}) as Line),
		);
	const holderOf = async (name: string) =>
		(
			await ledger.run(
				Effect.gen(function* () {
					const l = yield* (yield* Ledger).lease(name);
					return l !== null && l.expires_at > Date.now() ? l : null;
				}),
			)
		)?.holder ?? null;
	const streamOf = (stream: string) =>
		ledger.run(
			Effect.gen(function* () {
				return yield* (yield* Ledger).readStream(stream);
			}),
		);
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
	const calls: Called[] = [];
	const redrives: Redriven[] = [];
	const t0 = Date.now();
	let flagsSent = 0;
	const setFlags = (f: Flags) =>
		ledger.run(cast(FLAGS, `flags:${++flagsSent}`, f, "harness")).then(() => undefined);
	const send = (name: string, id: string, body: object) =>
		ledger.run(cast(name, id, body, "harness"));
	/** OTP's `supervisor:*` call: a message with a call id; the reply lands in harness:1's inbox. */
	const call = async (to: string, id: string, req: unknown, sends = 1) => {
		const sentAt = Date.now();
		for (let k = 1; k <= sends; k++)
			await send(to, `${id}#${k}`, {id, replyTo: streams(HARNESS).inbox, req});
		let res: Answer | null = null;
		await waitFor(
			`the reply to ${id}`,
			async () => {
				for (const r of await streamOf(streams(HARNESS).inbox)) {
					const x = decodeReply(r.data);
					if (Exit.isSuccess(x) && x.value.id === id) res = x.value.res;
				}
				return res !== null;
			},
			20_000,
		);
		const c = {id, to, req, sends, res, ms: Date.now() - sentAt, sentAt};
		calls.push(c);
		log(`call ${id} to ${to}: ${JSON.stringify(res)} in ${c.ms} ms`);
		return c;
	};
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
	const upNames = [...WATCHED, "watcher:1"];
	try {
		await ledger.run(
			Effect.gen(function* () {
				const l = yield* Ledger;
				for (const name of ["top", "watcher:1", HARNESS, FLAGS]) yield* l.register(name, "harness");
			}),
		);
		await setFlags({bootCrash: [], poisonBug: true});
		for (let i = 0; i < 3; i++) spawnHost();
		await until(
			"every name running",
			() =>
				upNames.every((n) =>
					lines().some((l) => l.name === n && l.ev === "program" && l.phase === "started"),
				),
			60_000,
		);
		await waitFor("a monitor on every name", () => monitorsOn(WATCHED.length), 20_000);
		const upMs = Date.now() - t0;
		log(`tree up in ${upMs} ms`);

		if (mode === "escalate") {
			// The crash loop, never fixed: sup:rest gives up, top restarts it, it gives up again...
			await setFlags({bootCrash: ["r:2"], poisonBug: true});
			faults.push({kind: "crash_loop", at: Date.now(), name: "r:2"});
			await defect("r:2", 1);
			await waitFor(
				"top to give up",
				async () => (await streamOf("top")).some((r) => r.kind === "exited"),
				90_000,
			);
			log("top gave up");
			await sleep(2500);
		} else {
			// The senders: every worker gets `perChild` plain messages, spread over the faults.
			const senders = WORKERS.map(async (c) => {
				for (let k = 0; k < p.perChild; k++) {
					await send(c, `${c}-m${k}`, {});
					await sleep(p.gapMs);
				}
			});
			const script = async () => {
				// Calls: OTP's supervisor API, each answered once the work is done.
				await call("sup:rest", "c1", {op: "which_children"});
				await call("top", "c2", {op: "start_child", spec: {name: "t:1", restart: "temporary"}});
				await call("top", "c3", {op: "which_children"});
				await call("sup:rest", "c4", {op: "terminate_child", name: "r:3"});
				// The same call again, as a client that never saw the reply would send it.
				await call("sup:rest", "c4", {op: "terminate_child", name: "r:3"}, 2);
				await call("sup:rest", "c5", {op: "restart_child", name: "r:3"});
				await call("top", "c6", {op: "terminate_child", name: "t:1"});
				await call("top", "c7", {op: "delete_child", name: "t:1"});
				await call("top", "c8", {op: "which_children"});
				await sleep(1000);
				// one_for_all: a:2 crashes; a:3 and a:1 are stopped, then all three start in order.
				await defect("a:2", 1);
				await sleep(2500);
				await kill("sup:all");
				await sleep(2500);
				// rest_for_one: r:2 crashes; r:3 is stopped (killed at its 100 ms), r:2 and r:3 start.
				await defect("r:2", 1);
				await sleep(2500);
				// The watcher's host frozen while a child crashes: shorter than the lease (the frozen
				// host reads the DOWN when it wakes), then longer (another host takes the watcher over).
				// The child that crashes must run on another host, or it is frozen too and crashes late.
				const freezeWhile = async (
					ms: number,
					crashAt: number,
					pick: readonly string[],
					n: number,
				) => {
					const holder = await holderOf("watcher:1");
					const h = holder === null ? undefined : hosts.get(holder);
					if (holder === null || h === undefined) return;
					// Who runs each name as the freeze starts: a stop of a child on the frozen host
					// can only end at its shutdown timeout, and a supervisor there restarts late.
					const holders: Record<string, string | null> = {};
					for (const c of WATCHED) holders[c] = await holderOf(c);
					// The pick first, then any worker: a live lease held by another host. A lease that
					// reads as lapsed (null) can still be the frozen host's, so it does not count.
					const child =
						[...pick, ...WORKERS].find((c) => {
							const on = holders[c] ?? null;
							return on !== null && on !== holder;
						}) ??
						pick[0] ??
						"a:1";
					const childHost = holders[child] ?? null;
					const at = Date.now();
					signal(h.pgid, "SIGSTOP");
					await sleep(crashAt);
					await defect(child, n);
					await sleep(ms - crashAt);
					signal(h.pgid, "SIGCONT");
					faults.push({
						kind: "freeze",
						at,
						contAt: Date.now(),
						name: "watcher:1",
						host: holder,
						child,
						childHost,
						holders,
					});
					log(
						`SIGSTOP ${holder} (held watcher:1) for ${ms} ms; ${child} on ${childHost ?? "?"} crashed ${crashAt} ms in`,
					);
				};
				// 700 ms: under the 750 ms a 1000 ms lease renewed every 250 ms has left at least. The
				// crash goes in early, so its DOWN lands inside the freeze.
				await freezeWhile(700, 50, ["r:1", "a:3"], 10);
				await sleep(2500);
				await freezeWhile(2500, 500, ["a:1", "a:2", "a:3"], 11);
				await sleep(3000);
				// A poison message: r:3 crashes on it MAX_DELIVERIES times, then it is set aside.
				const pat = Date.now();
				await send("r:3", "poison", {poison: true});
				faults.push({kind: "poison", at: pat, name: "r:3", id: "poison"});
				log("sent the poison message to r:3");
				await waitFor(
					"the poison set aside",
					async () => (await ledger.run(deadLetters("r:3"))).length === 1,
					30_000,
				);
				// Past sup:rest's 5 s period: the crash loop starts from a clean restart list.
				await sleep(6000);
				// The crash loop: r:2 dies at boot. It backs off, sup:rest gives up, top restarts it.
				await setFlags({bootCrash: ["r:2"], poisonBug: true});
				faults.push({kind: "crash_loop", at: Date.now(), name: "r:2"});
				await defect("r:2", 2);
				await waitFor(
					"sup:rest to give up",
					async () => (await streamOf("sup:rest")).some((r) => r.kind === "exited"),
					30_000,
				);
				await setFlags({bootCrash: [], poisonBug: true});
				faults.push({kind: "fixed", at: Date.now(), name: "r:2"});
				log("sup:rest gave up; the boot crash is fixed");
				await waitFor(
					"sup:rest back, with r:3",
					async () =>
						(await streamOf("sup:rest")).some((r) => r.kind === "restarted") &&
						(await streamOf("r:3")).at(-1)?.kind !== "exited",
					30_000,
				);
				await sleep(1500);
				// The poison bug fixed: the dead letter is sent back, twice; it lands once.
				await setFlags({bootCrash: [], poisonBug: false});
				const letter = (await ledger.run(deadLetters("r:3")))[0];
				if (letter !== undefined) {
					faults.push({kind: "redrive", at: Date.now(), name: "r:3"});
					redrives.push(await ledger.run(redrive("r:3", letter.rev, "harness")));
					redrives.push(await ledger.run(redrive("r:3", letter.rev, "harness")));
					log(`redrive: ${JSON.stringify(redrives)}`);
				}
				await sleep(1500);
				await kill("r:1");
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
			// Every worker's count reaches what was sent to it, less what was set aside.
			const want = async () => {
				const rows = await ledger.run(readAll);
				return WORKERS.every((c) => {
					const inbox = rows.filter((r) => r.stream === streams(c).inbox).length;
					const deadRows = rows.filter((r) => r.stream === streams(c).dead).length;
					const last = rows.filter((r) => r.stream === streams(c).state).at(-1);
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
				join(keep, `100-${mode}-${index}.json`),
				JSON.stringify({lines: lines(), rows, faults, calls}),
			);
		return {
			preset,
			run: index,
			mode,
			upMs,
			...check(rows, lines(), faults, calls, redrives, mode),
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

// ---------------------------------------------------------------- the checks

type Exited = {incarnation: number; reason: string; why: string; by: string | null};
type Down = {ref: string; target: string; incarnation: number; reason: string; at: number};
type Reported = {target: string; kind: "down" | "gap"; from: number; to: number};
const GROUPS = {"sup:all": ["a:1", "a:2", "a:3"], "sup:rest": ["r:1", "r:2", "r:3"]} as const;
type Group = keyof typeof GROUPS;

/** Every check, from the ledger's rows, the hosts' lines and what the harness did. */
export function check(
	rows: readonly Row[],
	lines: readonly Line[],
	faults: readonly Fault[],
	calls: readonly Called[],
	redrives: readonly Redriven[],
	mode: Mode,
) {
	const of = (stream: string) => rows.filter((r) => r.stream === stream);
	const names = [...WATCHED, "t:1"];
	const exits = names.flatMap((name) =>
		of(name)
			.filter((r) => r.kind === "exited")
			.map((r) => ({name, at: r.at, pos: r.pos, writer: r.writer, ...data<Exited>(r)})),
	);
	const restarts = names.flatMap((name) =>
		of(name)
			.filter((r) => r.kind === "restarted")
			.map((r) => ({
				name,
				at: r.at,
				pos: r.pos,
				by: r.writer,
				...data<{incarnation: number; after: number}>(r),
			})),
	);
	const t0 = faults[0]?.at ?? 0;
	const fault = (kind: Fault["kind"]) => faults.find((f) => f.kind === kind);

	// ------------------------------------------------ strategies: who is stopped and started, in order

	const episodes: {
		sup: Group;
		child: string;
		at: number;
		expected: string[];
		observed: string[];
		cut: boolean;
		ok: boolean;
	}[] = [];
	const explained = new Set<number>();
	/** A supervisor's end: it gave up, or its parent shut it down. Its children stop, last first. */
	const giveUps: {
		sup: Group;
		kind: "gave_up" | "parent_shutdown";
		expectedStops: string[];
		observed: string[];
		ok: boolean;
	}[] = [];
	for (const [sup, group] of Object.entries(GROUPS) as [Group, readonly string[]][]) {
		const spec = SPECS[sup];
		const life = rows
			.filter(
				(r) =>
					group.includes(r.stream) &&
					(r.kind === "registered" || r.kind === "restarted" || r.kind === "exited"),
			)
			.sort((a, b) => a.pos - b.pos);
		const upAt = (name: string, pos: number) => {
			const last = life.filter((r) => r.stream === name && r.pos < pos).at(-1);
			return last !== undefined && last.kind !== "exited";
		};
		const ends = of(sup).filter((r) => r.kind === "exited");
		const gaveUp = (r: Row) => data<Exited>(r).why.startsWith("reached_max_restart_intensity");
		const supEnds = ends.filter(gaveUp).map((r) => r.pos);
		const crashes = life.filter((r) => r.kind === "exited" && data<Exited>(r).reason === "crash");
		// Its parent shut it down: the children up then are stopped, last first, before it exits.
		for (const end of ends.filter((r) => !gaveUp(r))) {
			const before = life.filter((r) => r.pos < end.pos);
			let k = before.length;
			while (k > 0) {
				const r = before[k - 1];
				if (r === undefined || r.kind !== "exited" || data<Exited>(r).reason === "crash") break;
				k--;
			}
			const seen = before.slice(k);
			for (const r of seen) explained.add(r.pos);
			const from = seen[0]?.pos ?? end.pos;
			const observed = seen.map((r) => `${r.kind} ${r.stream}`);
			const expectedStops = group
				.filter((n) => upAt(n, from))
				.reverse()
				.map((n) => `exited ${n}`);
			giveUps.push({
				sup,
				kind: "parent_shutdown",
				expectedStops,
				observed,
				ok: JSON.stringify(observed) === JSON.stringify(expectedStops),
			});
		}
		for (const [i, e] of crashes.entries()) {
			explained.add(e.pos);
			const nextCrash = crashes[i + 1]?.pos ?? Number.POSITIVE_INFINITY;
			const supEnd = supEnds.find((x) => x > e.pos && x < nextCrash);
			const x = e.stream;
			const at = group.indexOf(x);
			if (supEnd !== undefined) {
				// It gave up here: every other child still up is stopped, last first; none starts.
				const stops = group.filter((n) => n !== x && upAt(n, e.pos)).reverse();
				const seen = life.filter((r) => r.pos > e.pos && r.pos < supEnd);
				for (const r of seen) explained.add(r.pos);
				const observed = seen.map((r) => `${r.kind} ${r.stream}`);
				const expectedStops = stops.map((n) => `exited ${n}`);
				giveUps.push({
					sup,
					kind: "gave_up",
					expectedStops,
					observed,
					ok: JSON.stringify(observed) === JSON.stringify(expectedStops),
				});
				continue;
			}
			const siblings =
				spec.strategy === "one_for_all"
					? group.filter((n) => n !== x)
					: spec.strategy === "rest_for_one"
						? group.slice(at + 1)
						: [];
			const stops = siblings.filter((n) => upAt(n, e.pos)).reverse();
			const starts = group.filter((n) => n === x || siblings.includes(n));
			const expected = [...stops.map((n) => `exited ${n}`), ...starts.map((n) => `restarted ${n}`)];
			const seen = life.filter((r) => r.pos > e.pos && r.pos < nextCrash).slice(0, expected.length);
			for (const r of seen) explained.add(r.pos);
			const observed = seen.map((r) => `${r.kind} ${r.stream}`);
			const cut = observed.length < expected.length && nextCrash !== Number.POSITIVE_INFINITY;
			const ok = cut
				? JSON.stringify(observed) === JSON.stringify(expected.slice(0, observed.length))
				: JSON.stringify(observed) === JSON.stringify(expected);
			episodes.push({sup, child: x, at: e.at - t0, expected, observed, cut, ok});
		}
		// A new incarnation of the supervisor starts its children from the spec: one restart each.
		for (const s of of(sup).filter((r) => r.kind === "restarted"))
			for (const n of group) {
				const first = life.find((r) => r.stream === n && r.pos > s.pos && r.kind === "restarted");
				if (first !== undefined) explained.add(first.pos);
			}
	}
	// The calls' own stops and starts: terminate_child r:3, then restart_child r:3.
	const c4 = calls.find((c) => c.id === "c4");
	const c5 = calls.find((c) => c.id === "c5");
	const r3Life = rows.filter(
		(r) => r.stream === "r:3" && (r.kind === "exited" || r.kind === "restarted"),
	);
	const termRow = c4 === undefined ? undefined : r3Life.find((r) => r.at >= c4.sentAt);
	const restartRow =
		c5 === undefined ? undefined : r3Life.find((r) => r.at >= c5.sentAt && r.kind === "restarted");
	if (termRow !== undefined) explained.add(termRow.pos);
	if (restartRow !== undefined) explained.add(restartRow.pos);
	const unexplained = rows
		.filter(
			(r) =>
				WORKERS.includes(r.stream as (typeof WORKERS)[number]) &&
				(r.kind === "exited" || r.kind === "restarted") &&
				!explained.has(r.pos),
		)
		.map((r) => `${r.kind} ${r.stream} at ${r.at - t0}`);

	// ------------------------------------------------ escalation: one level per give-up

	const supExits = (name: string) => exits.filter((e) => e.name === name);
	const escalation = {
		supRestGaveUp: supExits("sup:rest").length,
		topRestartedSupRest: restarts.filter((r) => r.name === "sup:rest" && r.by === "top").length,
		supAllExited: supExits("sup:all").length,
		supAllRestarted: restarts.filter((r) => r.name === "sup:all").length,
		topExited: supExits("top").map((e) => e.why),
		// After each give-up of sup:rest: top's next act is one restart of it, or (past top's own
		// intensity) top's own exit. Never a restart of sup:all, which top runs one_for_one.
		eachGiveUp: supExits("sup:rest").map((e) => {
			const next = [
				...restarts.filter((r) => r.pos > e.pos && (r.name === "sup:rest" || r.name === "sup:all")),
				...exits.filter((x) => x.pos > e.pos && x.name === "top"),
			].sort((a, b) => a.pos - b.pos)[0];
			return next === undefined
				? "nothing"
				: "after" in next
					? `restarted ${next.name}`
					: `exited ${next.name}`;
		}),
	};

	// ------------------------------------------------ restart backoff, from sup:rest's own rows

	/** At `at`, a freeze was on and its host held `name` as it began. */
	const heldFrozen = (name: string, at: number) =>
		faults.some(
			(f) =>
				f.kind === "freeze" &&
				at >= f.at &&
				at <= (f.contAt ?? f.at) &&
				f.holders?.[name] === f.host,
		);
	const b = SPECS["sup:rest"].backoff;
	const backoff: {
		child: string;
		n: number;
		plannedMs: number;
		waitMs: number;
		lateMs: number;
		/** The crash came while sup:rest's own host was frozen: it can only restart after. */
		supFrozen: boolean;
	}[] = [];
	{
		// The supervisor's rule, from its rows: a crash after a run shorter than resetAfterMs is
		// one more in a row; a new incarnation of sup:rest starts every count again.
		const fails = new Map<string, number>();
		const since = new Map<string, number>();
		const group: readonly string[] = GROUPS["sup:rest"];
		const life = rows.filter(
			(r) =>
				group.includes(r.stream) &&
				(r.kind === "registered" || r.kind === "restarted" || r.kind === "exited"),
		);
		const supRestarts = of("sup:rest").filter((r) => r.kind === "restarted");
		for (const r of [...life, ...supRestarts].sort((x, y) => x.pos - y.pos)) {
			if (r.stream === "sup:rest") {
				fails.clear();
				continue;
			}
			if (r.kind !== "exited") {
				since.set(r.stream, r.at);
				continue;
			}
			const e = data<Exited>(r);
			if (e.reason !== "crash") continue;
			const restart = life.find(
				(x) =>
					x.stream === r.stream &&
					x.kind === "restarted" &&
					data<{after: number}>(x).after === e.incarnation,
			);
			// No restart, or the one that came is a new sup:rest starting from its spec: it gave up.
			if (restart === undefined || supRestarts.some((s) => s.pos > r.pos && s.pos < restart.pos))
				continue;
			const lived = r.at - (since.get(r.stream) ?? 0);
			const n = (lived >= b.resetAfterMs ? 0 : (fails.get(r.stream) ?? 0)) + 1;
			fails.set(r.stream, n);
			const plannedMs = Math.min(b.maxMs, b.minMs * 2 ** (n - 1));
			const waitMs = restart.at - r.at;
			backoff.push({
				child: r.stream,
				n,
				plannedMs,
				waitMs,
				lateMs: waitMs - plannedMs,
				supFrozen: heldFrozen("sup:rest", r.at),
			});
		}
	}
	const loop = fault("crash_loop");
	const loopExits = exits.filter(
		(e) => e.name === "r:2" && loop !== undefined && e.at >= loop.at && e.reason === "crash",
	);

	// ------------------------------------------------ shutdown: brutal_kill, a timeout, graceful

	// A kill while the child's own host was frozen: it cannot trap the shutdown, so the kill at
	// its timeout is the right end (OTP's `shutdown` timeout), marked as such.
	const stopsBy = (name: string) =>
		exits
			.filter((e) => e.name === name && e.reason !== "crash")
			.map(
				(e) =>
					`${e.reason}${e.by === null ? "" : ` by ${e.by}`}${e.reason === "killed" && heldFrozen(name, e.at) ? " (its host frozen)" : ""}`,
			);
	const signalled = of(streams("r:3").inbox).filter(
		(r) => r.kind === "EXIT" && (r.id ?? "").startsWith("SIGNAL:"),
	);
	const r3KillMs = signalled.flatMap((s) => {
		const e = exits.find((x) => x.name === "r:3" && x.pos > s.pos);
		return e === undefined || e.reason !== "killed" ? [] : [e.at - s.at];
	});
	const shutdown = {
		a3: stopsBy("a:3"),
		a2: stopsBy("a:2"),
		r3: stopsBy("r:3"),
		r3KillAfterSignalMs: r3KillMs,
	};

	// ------------------------------------------------ calls

	const replies = of(streams(HARNESS).inbox).flatMap((r) => {
		const x = decodeReply(r.data);
		return Exit.isSuccess(x) ? [x.value] : [];
	});
	const childrenOf = (res: Answer | null | undefined) =>
		res !== null && res !== undefined && "children" in res ? res.children.map((c) => c.name) : null;
	const resOf = (id: string) => calls.find((c) => c.id === id)?.res;
	const callsOk =
		mode === "escalate"
			? null
			: {
					c1: JSON.stringify(childrenOf(resOf("c1"))) === JSON.stringify(["r:1", "r:2", "r:3"]),
					c2: JSON.stringify(resOf("c2")) === JSON.stringify({ok: true, incarnation: 1}),
					c3:
						JSON.stringify(childrenOf(resOf("c3"))) ===
						JSON.stringify(["sup:all", "sup:rest", "t:1"]),
					c4: JSON.stringify(resOf("c4")) === JSON.stringify({ok: true}),
					c4Again: calls.filter((c) => c.id === "c4").every((c) => c.res?.ok === true),
					c5: resOf("c5")?.ok === true && "incarnation" in (resOf("c5") ?? {}),
					c6: JSON.stringify(resOf("c6")) === JSON.stringify({ok: true}),
					c7: JSON.stringify(resOf("c7")) === JSON.stringify({ok: true}),
					c8: JSON.stringify(childrenOf(resOf("c8"))) === JSON.stringify(["sup:all", "sup:rest"]),
					oneReplyPerId: replies.length === new Set(calls.map((c) => c.id)).size,
				};

	// ------------------------------------------------ DOWNs

	const downs = of(streams("watcher:1").inbox)
		.filter((r) => r.kind === "DOWN")
		.map((r) => ({rev: r.rev, ...data<Down>(r)}));
	const real = downs.filter((d) => d.reason !== "noproc");
	const noprocs = downs.filter((d) => d.reason === "noproc");
	const key = (t: string, i: number) => `${t}@${i}`;
	const exitKeys = new Set(exits.map((e) => key(e.name, e.incarnation)));
	const realKeys = real.map((d) => key(d.target, d.incarnation));
	const watched: readonly string[] = WATCHED;
	const watchedExits = exits.filter((e) => watched.includes(e.name));
	const phantom = real.filter((d) => !exitKeys.has(key(d.target, d.incarnation)));
	const watcherLast = of(streams("watcher:1").state).at(-1);
	const reported =
		watcherLast === undefined
			? []
			: data<{state: {reported: readonly Reported[]}}>(watcherLast).state.reported;
	const reportedKeys = reported.flatMap((r) =>
		Array.from({length: r.to - r.from + 1}, (_, i) => key(r.target, r.from + i)),
	);
	const readAt = new Map<number, number>();
	const readBy = new Map<number, string[]>();
	for (const l of lines) {
		if (l.name !== "watcher:1" || l.ev !== "DOWN") continue;
		const was = readAt.get(Number(l.rev));
		if (was === undefined || Number(l.readAt) < was) readAt.set(Number(l.rev), Number(l.readAt));
		readBy.set(Number(l.rev), [...(readBy.get(Number(l.rev)) ?? []), l.host]);
	}
	const deliveryMs = real.flatMap((d) => {
		const t = readAt.get(d.rev);
		return t === undefined ? [] : [t - d.at];
	});
	const freezeDowns = faults
		.filter((f) => f.kind === "freeze")
		.flatMap((f) =>
			real
				.filter((d) => d.at >= f.at && d.at <= (f.contAt ?? 0))
				.map((d) => ({
					down: key(d.target, d.incarnation),
					freezeMs: (f.contAt ?? f.at) - f.at,
					writtenAt: d.at - f.at,
					readMs: (readAt.get(d.rev) ?? Number.NaN) - d.at,
					// Which hosts' watcher read it: a takeover while frozen, or the frozen host on waking.
					readBy: readBy.get(d.rev) ?? [],
					frozenHost: f.host ?? null,
				})),
		);
	// The crash planted in each freeze: when its exit landed, and which host wrote it.
	const freezeCrashes = faults
		.filter((f) => f.kind === "freeze")
		.map((f) => {
			const e = exits.find((x) => x.name === f.child && x.at >= f.at);
			return {
				child: f.child ?? null,
				childHost: f.childHost ?? null,
				frozenHost: f.host ?? null,
				freezeMs: (f.contAt ?? f.at) - f.at,
				exitAt: e === undefined ? null : e.at - f.at,
				exitWriter: e?.writer ?? null,
			};
		});
	// How long each watched name was down: the time a fixed 50 ms re-arm would have filled.
	const downMs = WATCHED.reduce((sum, name) => {
		let total = 0;
		for (const e of exits.filter((x) => x.name === name)) {
			const back = restarts.find((r) => r.name === name && r.after === e.incarnation);
			total += (back?.at ?? rows.at(-1)?.at ?? e.at) - e.at;
		}
		return sum + total;
	}, 0);

	// ------------------------------------------------ takeovers, writers, counts, dead letters

	let takeovers = 0;
	for (const name of names) {
		let claims = 0;
		for (const r of of(name)) {
			if (r.kind === "restarted") claims = 0;
			if (r.kind === "claimed" && ++claims > 1) takeovers++;
		}
	}
	const killAll = fault("kill_all");
	const exitsAfterKillAll =
		killAll === undefined ? 0 : exits.filter((e) => e.at >= killAll.at).length;
	const writerBreaks: string[] = [];
	for (const name of [...names, "watcher:1"]) {
		let fence: number | null = null;
		const own = [...of(name), ...of(streams(name).state)].sort((a, b2) => a.pos - b2.pos);
		for (const r of own) {
			if (r.kind === "claimed") fence = r.pos;
			if (r.kind === "exited") fence = null;
			if (r.stream !== streams(name).state) continue;
			const f = data<{fence: number}>(r).fence;
			if (f !== fence) writerBreaks.push(`${name} pos ${r.pos}: saved under ${f}, claim ${fence}`);
		}
	}
	const counts = WORKERS.map((c) => {
		const inbox = of(streams(c).inbox);
		const deadRevs = of(streams(c).dead).map((r) => data<{rev: number}>(r).rev);
		const last = of(streams(c).state).at(-1);
		const count = last === undefined ? 0 : data<{state: {count: number}}>(last).state.count;
		const want = inbox.filter((r) => !deadRevs.includes(r.rev)).length;
		return {name: c, inbox: inbox.length, dead: deadRevs, count, want, exact: count === want};
	});
	const poisonRev = of(streams("r:3").inbox).find((r) => r.id === "poison")?.rev ?? null;
	const redriveAt = fault("redrive")?.at ?? Number.POSITIVE_INFINITY;
	const poisonCrashes = exits.filter((e) => e.reason === "crash" && /poison/.test(e.why));
	const deadLetter = {
		rev: poisonRev,
		setAside: of(streams("r:3").dead).map((r) => data<{rev: number; strikes: number}>(r)),
		poisonCrashes: poisonCrashes.length,
		crashesAfterRedrive: poisonCrashes.filter((e) => e.at >= redriveAt).length,
		redrives,
		resentRows: of(streams("r:3").inbox).filter((r) => r.id === `redrive:${poisonRev}`).length,
	};

	// ------------------------------------------------ the tree down (escalate)

	const lastKind = (name: string) =>
		of(name)
			.filter((r) => r.kind === "exited" || r.kind === "restarted" || r.kind === "registered")
			.at(-1)?.kind;
	const treeDown = {
		everyNameDown: [...WATCHED].every((n) => lastKind(n) === "exited"),
		supAllChildrenBeforeIt: (() => {
			const supAll = supExits("sup:all").at(-1);
			const top = supExits("top").at(-1);
			if (supAll === undefined || top === undefined) return null;
			const last = (n: string) => exits.filter((e) => e.name === n).at(-1);
			const order = GROUPS["sup:all"]
				.map((n) => ({n, pos: last(n)?.pos ?? Number.POSITIVE_INFINITY}))
				.sort((a, b2) => a.pos - b2.pos)
				.map((x) => x.n);
			return {
				stopOrder: order,
				childrenFirst: GROUPS["sup:all"].every(
					(n) => (last(n)?.pos ?? Number.POSITIVE_INFINITY) < supAll.pos,
				),
				supAllBeforeTop: supAll.pos < top.pos,
			};
		})(),
		downForTop: real.filter((d) => d.target === "top").length,
	};

	const restartMs = restarts
		.filter((r) => WORKERS.includes(r.name as (typeof WORKERS)[number]))
		.flatMap((r) => {
			const e = exits.find((x) => x.name === r.name && x.incarnation === r.after);
			return e === undefined ? [] : [r.at - e.at];
		});

	return {
		faults: faults.map((f) => ({
			...f,
			at: f.at - t0,
			contAt: f.contAt === undefined ? undefined : f.contAt - t0,
		})),
		episodes,
		giveUps,
		unexplained,
		escalation,
		backoff: {
			each: backoff,
			loopExits: loopExits.length,
			waitMs: stats(backoff.map((x) => x.waitMs)),
			lateMs: stats(backoff.map((x) => x.lateMs)),
		},
		shutdown,
		calls: calls.map((c) => ({id: c.id, to: c.to, sends: c.sends, res: c.res, ms: c.ms})),
		callsOk,
		downs: {
			real: real.length,
			noproc: noprocs.length,
			watchedDownMs: downMs,
			noprocIfFixed50Ms: Math.round(downMs / RETRY.retryMs),
			phantom: phantom.map((d) => key(d.target, d.incarnation)),
			unseen: watchedExits
				.map((e) => key(e.name, e.incarnation))
				.filter((k) => !realKeys.includes(k) && !reportedKeys.includes(k)),
			reportedTwice: reportedKeys.filter((k, i) => reportedKeys.indexOf(k) !== i),
			reportedNotExit: reportedKeys.filter((k) => !exitKeys.has(k)),
			neverReported: watchedExits
				.map((e) => key(e.name, e.incarnation))
				.filter((k) => !reportedKeys.includes(k)),
			deliveryMs: stats(deliveryMs),
			deliverySamples: deliveryMs,
			freeze: freezeDowns,
			freezeCrashes,
		},
		takeovers,
		exitsAfterKillAll,
		writerBreaks,
		counts,
		deadLetter,
		treeDown,
		restartMs: stats(restartMs),
		restartSamples: restartMs,
	};
}
