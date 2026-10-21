// Experiment 94's counter test on the package: experiment 97's run and checks
// (../97-one-ledger/counter-run.ts, from 96's), with the same faults, the same attach and the same
// pass checks but one (`aloneRefusedByFence`, below). What changed:
//
//   - The ledger is the package's local ledger (`layerLocal`): the runner starts, reads and stops
//     it through `@kampus/fabrika` alone, and its memory cap is the package's, not the
//     runner's.
//   - `counter:1` is registered first: under deny by default, nothing lands under it before that.
//   - The hosts are `serve` (./counter-host.ts), the senders `cast`, the attach the observer.
//   - The host stops its program at its own lease's end, by its own clock. So a host woken after
//     its lease ended may stop before it tries a write at all. 97 asked that the "alone" host's late
//     writes be refused by the fence, and that there be some; here none being tried is a pass too,
//     and the run counts how often each happened.
//
// Env, as in 97: TTL_MS (1000), RENEW_MS (250), STOP_MS (2500), RESTART_MS (300), CAP_MB (500),
// DUP_RATE (0.02), KEEP_LOGS (a folder).
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {applyCell} from "@demlik/tea";
import type {Meter} from "@kampus/fabrika";
import {type Lease, Ledger, type Row} from "@kampus/fabrika";
import {Effect} from "effect";
import {type Count, type CounterMsg, counter, ZERO} from "../94-tea-host/counter.ts";
import {
	type Child,
	firstLines,
	group,
	here,
	killGroup,
	node,
	parse,
	pct,
	r1,
	rssOf,
	signal,
	sleep,
	stopGroup,
	tempDir,
	until,
} from "./harness.ts";
import {LEDGER, liveLease, openLocal} from "./ledger.ts";

const HOST = here("98-tea-host-package/counter-host.ts");
const SENDER = here("98-tea-host-package/sender.ts");
const ATTACH = here("98-tea-host-package/attach.ts");
const NAME = "counter:1";
const REGISTRY = NAME;
const STATE = `${NAME}/state`;
const INBOX = `${NAME}/inbox`;

const TTL_MS = Number(process.env.TTL_MS ?? "1000");
const RENEW_MS = Number(process.env.RENEW_MS ?? "250");
const STOP_MS = Number(process.env.STOP_MS ?? "2500");
const RESTART_MS = Number(process.env.RESTART_MS ?? "300");
const CAP_MB = Number(process.env.CAP_MB ?? "500");
const DUP_RATE = process.env.DUP_RATE ?? "0.02";
const KEEP_LOGS = process.env.KEEP_LOGS;

const FIRST_FAULT_MS = 1500;
const FAULT_EVERY_MS = 3500;
export const PRESETS = {
	small: {n: 1000, kills: 2, rate: 25},
	large: {n: 10_000, kills: 3, rate: 150},
} as const;

type Fault = {
	kind: "kill" | "zombie" | "alone";
	holder: string;
	fence: number;
	at: number;
	leaseEndsAt: number;
	contAt?: number;
};
type StateData = {fence: number; state: Count};

/** One run: 94's, with the faults, the cap and the attach as they were. */
export async function runOnce(preset: keyof typeof PRESETS, index: number) {
	const {n, kills, rate} = PRESETS[preset];
	const dir = tempDir("run");
	const led = await openLocal(dir, {capMb: CAP_MB});
	const registered = await led.run(
		Effect.gen(function* () {
			return yield* (yield* Ledger).register(NAME, "runner");
		}),
	);
	const env = {
		LEDGER_URL: led.url,
		LEDGER_NAME: LEDGER,
		NAME,
		TTL_MS: String(TTL_MS),
		RENEW_MS: String(RENEW_MS),
	};
	const log = (s: string) => console.log(`[counter ${preset} ${index}] ${s}`);
	log(`ledger up in ${led.startMs} ms; ${NAME} registered at pos ${registered.pos}`);

	// The cap is the package's (`capMb`); the runner only reads the peak, for the record.
	let peakWorkerdMb = 0;
	let peakGroupMb = 0;
	let watching = true;
	const capWatch = (async () => {
		while (watching) {
			await sleep(1000);
			if (!watching) break;
			peakWorkerdMb = Math.max(peakWorkerdMb, rssOf(await led.pid()).workerdMb);
			peakGroupMb = Math.max(peakGroupMb, await led.memoryMb());
		}
	})();

	const hosts = new Map<string, Child>();
	const dead = new Map<string, number>();
	let gen = 0;
	const startHost = (base: string) => {
		gen++;
		const name = `${base}.${gen}`;
		hosts.set(name, node(HOST, {...env, HOST: name}));
		return name;
	};
	for (const base of ["host-a", "host-b", "host-c"]) startHost(base);
	await until(
		"an owner",
		() =>
			[...hosts.values()].some((h) =>
				h.lines.some((l) => l.ev === "program" && l.phase === "started"),
			),
		20_000,
	);

	const attachments: Record<string, unknown>[] = [];
	const attach = async (when: string) => {
		const a = node(ATTACH, env);
		await a.exited;
		const line = a.lines[0] ?? {error: a.err.join("")};
		attachments.push({when, ...line});
		log(`attach (${when}): ${String(line.line ?? line.error)}`);
	};
	await attach("before the first send");

	const runStart = Date.now();
	const senders = ["s1", "s2"].map((s, i) =>
		node(SENDER, {
			...env,
			SENDER: s,
			COUNT: String(n / 2),
			RATE: String(rate),
			DUP_RATE,
			SEED: String(index * 10 + i + 1),
		}),
	);

	const faults: Fault[] = [];
	const plan = [
		...Array.from({length: kills}, () => "kill" as const),
		"zombie" as const,
		"alone" as const,
	];
	for (const [i, kind] of plan.entries()) {
		const due = runStart + FIRST_FAULT_MS + i * FAULT_EVERY_MS;
		await sleep(Math.max(0, due - Date.now()));
		let lease: Lease | null = null;
		for (let tries = 0; tries < 200; tries++) {
			lease = await led.run(liveLease(REGISTRY));
			const owner = lease === null ? undefined : hosts.get(lease.holder);
			const since = owner?.lines.findLast((l) => l.ev === "program" && l.phase === "started")?.at;
			if (lease !== null && typeof since === "number" && Date.now() - since > 300) break;
			lease = null;
			await sleep(25);
		}
		if (lease === null) throw new Error(`no steady owner for fault ${i + 1}`);
		const owner = hosts.get(lease.holder);
		if (owner === undefined)
			throw new Error(`the lease is held by ${lease.holder}, not a host here`);
		const at = Date.now();
		if (kind === "kill") {
			await killGroup(owner.pgid);
			dead.set(lease.holder, at);
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt: lease.expires_at,
			});
			log(
				`SIGKILL ${lease.holder} (fence ${lease.fence}), lease ends in ${lease.expires_at - at} ms`,
			);
			await sleep(RESTART_MS);
			startHost(lease.holder.split(".")[0] ?? "host-x");
			if (i === 0) {
				await sleep(TTL_MS + 500);
				await attach("after the first kill");
			}
		} else if (kind === "alone") {
			const others = [...hosts.entries()].filter(([h]) => h !== lease.holder && !dead.has(h));
			for (const [, h] of others) signal(h.pgid, "SIGSTOP");
			signal(owner.pgid, "SIGSTOP");
			await sleep(Math.max(0, lease.expires_at - Date.now()) + 300);
			const contAt = Date.now();
			signal(owner.pgid, "SIGCONT");
			log(`SIGSTOP ${lease.holder} (fence ${lease.fence}) and every other host; woke it alone`);
			await sleep(400);
			for (const [, h] of others) signal(h.pgid, "SIGCONT");
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt: lease.expires_at,
				contAt,
			});
		} else {
			signal(owner.pgid, "SIGSTOP");
			log(`SIGSTOP ${lease.holder} (fence ${lease.fence}) for ${STOP_MS} ms`);
			await sleep(STOP_MS);
			await attach("while the old owner sleeps");
			const contAt = Date.now();
			signal(owner.pgid, "SIGCONT");
			faults.push({
				kind,
				holder: lease.holder,
				fence: lease.fence,
				at,
				leaseEndsAt: lease.expires_at,
				contAt,
			});
			log(`SIGCONT ${lease.holder}`);
		}
	}

	const sent = await Promise.all(
		senders.map(async (s) => ({code: await s.exited, out: s.lines[0], err: s.err.join("")})),
	);
	for (const s of sent)
		if (s.code !== 0 || s.out === undefined) throw new Error(`a sender failed: ${s.err}`);
	const sendsDoneAt = Date.now();
	const lastWake = Math.max(...faults.map((f) => f.contAt ?? f.at));

	// Drain: wait until the last saved count covers every id in the inbox.
	let settled = false;
	const lastOf = (stream: string) =>
		led.run(
			Effect.gen(function* () {
				return yield* (yield* Ledger).readLast(stream, 1);
			}),
		);
	for (let i = 0; i < 600 && !settled; i++) {
		const inboxEnd = await lastOf(INBOX);
		const last = await lastOf(STATE);
		const end = inboxEnd.at(-1)?.rev ?? 0;
		const st = last.at(-1);
		settled = st !== undefined && parse<StateData>(st.data).state.cursor === end;
		if (!settled) await sleep(100);
	}
	const drainedAt = Date.now();
	await attach("at the end");
	// One more second, so every host prints what its tails read after the drain.
	await sleep(1200);

	const live = [...hosts.entries()].filter(([name]) => !dead.has(name));
	const rss = {
		ledger: rssOf(await led.pid()),
		peakWorkerdMb,
		peakLedgerGroupMb: peakGroupMb,
		hosts: Object.fromEntries(live.map(([name, h]) => [name, rssOf(h.pgid).nodeMb])),
	};
	const aliveAtEnd = new Set(live.flatMap(([name, h]) => (group(h.pgid).length > 0 ? [name] : [])));
	watching = false;
	await capWatch;
	const capRestarts = await led.restarts();
	const stopAt = Date.now();
	for (const [, h] of live) await stopGroup(h.pgid);
	const rows = [...(await led.readAll())];
	const ledgerPid = await led.pid();
	await led.close();
	const ledgerLeft = group(ledgerPid).length;
	rmSync(dir, {recursive: true, force: true});

	if (KEEP_LOGS !== undefined) {
		mkdirSync(KEEP_LOGS, {recursive: true});
		for (const [name, h] of hosts)
			writeFileSync(
				join(KEEP_LOGS, `counter-${preset}-${index}-${name}.jsonl`),
				h.lines.map((l) => JSON.stringify(l)).join("\n"),
			);
	}
	const check = judge({rows, n, hosts, dead, faults, stopAt, aliveAtEnd, drainedAt, runStart});
	const senderOut = sent.map((s) => s.out ?? {});
	const attempts = senderOut.flatMap((o) =>
		Array.isArray(o.attempts) ? o.attempts.map(Number) : [],
	);
	const sends = senderOut.flatMap((o) => (Array.isArray(o.sends) ? o.sends.map(Number) : []));
	return {
		preset,
		n,
		kills,
		ttlMs: TTL_MS,
		renewMs: RENEW_MS,
		stopMs: STOP_MS,
		sendRatePerSender: rate,
		...check,
		sendLatency: {
			appendP50Ms: r1(pct(attempts, 50)),
			appendP99Ms: r1(pct(attempts, 99)),
			sendP50Ms: r1(pct(sends, 50)),
			sendP99Ms: r1(pct(sends, 99)),
			appends: attempts.length,
			stale: senderOut.reduce((a, o) => a + Number(o.stale ?? 0), 0),
			dupAnswers: senderOut.reduce((a, o) => a + Number(o.dups ?? 0), 0),
			errors: senderOut.reduce((a, o) => a + Number(o.errors ?? 0), 0),
			repeatsInjected: senderOut.reduce((a, o) => a + Number(o.repeats ?? 0), 0),
		},
		sendMs: sendsDoneAt - runStart,
		faultsDuringSends: lastWake < sendsDoneAt - 500,
		drainMs: drainedAt - sendsDoneAt,
		capRestarts,
		ledgerProcessesLeftAfterClose: ledgerLeft,
		rss,
		attach: attachments,
		hostsStarted: [...hosts.keys()],
		hostErrors: Object.fromEntries(
			[...hosts.entries()].flatMap(([name, h]) =>
				h.err.length > 0 ? [[name, firstLines(h.err.join(""))]] : [],
			),
		),
	};
}

/** A row's size as JSON, without the `id` key: what the same row weighed in 94. */
const bytes94 = (r: Row) => {
	const {id: _, ...rest} = r;
	return JSON.stringify(rest).length + 1;
};
const avg = (xs: readonly number[]) =>
	xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

function judge(o: {
	rows: Row[];
	n: number;
	hosts: Map<string, Child>;
	dead: Map<string, number>;
	faults: Fault[];
	stopAt: number;
	aliveAtEnd: Set<string>;
	drainedAt: number;
	runStart: number;
}) {
	const registry = o.rows.filter((r) => r.stream === REGISTRY);
	const states = o.rows.filter((r) => r.stream === STATE);
	const inbox = o.rows.filter((r) => r.stream === INBOX).sort((a, b) => a.rev - b.rev);

	// The mailbox: the ledger keeps one event per id, so every inbox event is a distinct id.
	const firstOf = new Map<string, number>();
	for (const r of inbox) {
		const id = parse<{id: string}>(r.data).id;
		if (!firstOf.has(id)) firstOf.set(id, r.rev);
	}
	const expected = new Set(
		["s1", "s2"].flatMap((s) => Array.from({length: o.n / 2}, (_, i) => `${s}-${i + 1}`)),
	);
	const missing = [...expected].filter((id) => !firstOf.has(id));
	const extra = [...firstOf.keys()].filter((id) => !expected.has(id));

	// Replay: the real counter's update over the inbox, from zero.
	let replayed: Count = ZERO;
	for (const [id, rev] of [...firstOf.entries()].sort((a, b) => a[1] - b[1])) {
		const msg: CounterMsg = {type: "increment", id, rev};
		[replayed] = applyCell<Count, CounterMsg, never>(counter, replayed, msg);
	}

	// The chain of saved states, in log order with the claims: each under the latest claim's
	// fence, the count +1 or +0.
	let fence = 0;
	let prev = 0;
	const applied = new Map<string, number>();
	const breaks: string[] = [];
	const incAt: {at: number; fence: number}[] = [];
	for (const r of [...registry, ...states].sort((a, b) => a.pos - b.pos)) {
		if (r.kind === "claimed") fence = r.pos;
		if (r.kind !== "state") continue;
		const d = parse<StateData>(r.data);
		if (d.fence !== fence)
			breaks.push(`pos ${r.pos}: saved under fence ${d.fence} after claim ${fence}`);
		if (d.state.count === prev + 1) {
			const id = d.state.last ?? "";
			applied.set(id, (applied.get(id) ?? 0) + 1);
			incAt.push({at: r.at, fence: d.fence});
		} else if (d.state.count !== prev)
			breaks.push(`pos ${r.pos}: count ${prev} -> ${d.state.count}`);
		prev = d.state.count;
	}
	const stateRevGaps = states.filter((r, i) => r.rev !== i + 1).length;
	const twice = [...applied.entries()].filter(([, k]) => k > 1).map(([id]) => id);
	const notApplied = [...firstOf.keys()].filter((id) => !applied.has(id));
	const lastSaved = states.at(-1);
	const final = lastSaved === undefined ? ZERO : parse<StateData>(lastSaved.data).state;

	type Note = Record<string, unknown> & {host: string; at: number};
	const notes = new Map<string, Note[]>();
	for (const [name, h] of o.hosts)
		notes.set(
			name,
			h.lines.map((l) => ({...l, host: name, at: Number(l.at)})),
		);
	const beliefs: {host: string; from: number; to: number}[] = [];
	for (const [name, ls] of notes) {
		let from: number | null = null;
		for (const l of ls) {
			if (l.ev !== "phase") continue;
			if (l.to === "owning") from = l.at;
			if (l.from === "owning" && from !== null) {
				beliefs.push({host: name, from, to: l.at});
				from = null;
			}
		}
		if (from !== null) beliefs.push({host: name, from, to: o.dead.get(name) ?? o.stopAt});
	}
	const accepted = states;
	const overlaps: string[] = [];
	let believedTogetherMs = 0;
	for (const [i, a] of beliefs.entries())
		for (const b of beliefs.slice(i + 1)) {
			if (a.host === b.host) continue;
			const lo = Math.max(a.from, b.from);
			const hi = Math.min(a.to, b.to);
			if (lo >= hi) continue;
			believedTogetherMs += hi - lo;
			const by = (h: string) =>
				accepted.filter((r) => r.writer === h && r.at >= lo && r.at <= hi).length;
			if (by(a.host) > 0 && by(b.host) > 0)
				overlaps.push(
					`${a.host} and ${b.host} both believed they owned it from ${lo} to ${hi}, and both had writes accepted`,
				);
		}

	const zombies = o.faults
		.filter((f) => f.kind !== "kill")
		.map((f) => {
			const ls = notes.get(f.holder) ?? [];
			const cont = f.contAt ?? f.at;
			const sentAfterFreeze = ls.filter(
				(l) => l.ev === "write" && l.fence === f.fence && Number(l.sentAt) >= f.at,
			);
			// A write already in flight when the freeze came can land while the lease still holds,
			// and its answer reaches the host only after the wake. The ledger's own clock tells the
			// two apart: it is late only if its row is missing or was written after the lease ended.
			const landedInLease = (l: Note) =>
				l.ok === true &&
				accepted.some(
					(r) => r.writer === f.holder && Number(r.rev) === Number(l.rev) && r.at <= f.leaseEndsAt,
				);
			const inFlight = sentAfterFreeze.filter(landedInLease);
			const late = sentAfterFreeze.filter((l) => !landedInLease(l));
			const noticed = ls.find(
				(l) => l.ev === "phase" && l.from === "owning" && l.fence === f.fence && l.at >= cont,
			);
			const stopped = ls.find(
				(l) =>
					l.ev === "program" &&
					l.fence === f.fence &&
					(l.phase === "stopped" || l.phase === "ended") &&
					l.at >= cont,
			);
			const acceptedAfter = accepted.filter(
				(r) => r.writer === f.holder && r.at >= cont && parse<StateData>(r.data).fence === f.fence,
			).length;
			return {
				kind: f.kind,
				holder: f.holder,
				fence: f.fence,
				sleptMs: cont - f.at,
				inFlightLandedInLease: inFlight.length,
				lateWrites: late.length,
				lateAccepted: late.filter((l) => l.ok === true).length,
				lateRefused: late.filter((l) => l.ok === false).map((l) => String(l.why)),
				ledgerAcceptedAfterWake: acceptedAfter,
				noticedBy: noticed === undefined ? null : String(noticed.by),
				noticedMs: noticed === undefined ? null : noticed.at - cont,
				programGoneMs: stopped === undefined ? null : stopped.at - cont,
				teaErrors: ls
					.filter((l) => l.ev === "tea_error")
					.map((l) => `${String(l.phase)}: ${String(l.error).slice(0, 120)}`),
				hostAliveAtEnd: o.aliveAtEnd.has(f.holder),
			};
		});

	const takeovers = o.faults.map((f) => {
		const claim = registry.find((r) => r.kind === "claimed" && r.at >= f.at && r.pos > f.fence);
		const resumed =
			claim === undefined
				? undefined
				: accepted.find((r) => parse<StateData>(r.data).fence === claim.pos);
		const startedLine =
			claim === undefined
				? undefined
				: (notes.get(claim.writer) ?? []).find(
						(l) => l.ev === "program" && l.phase === "started" && l.fence === claim.pos,
					);
		const backlog = Number(startedLine?.backlog ?? 0);
		const after = incAt.filter((x) => claim !== undefined && x.fence === claim.pos);
		const caughtUp = backlog >= 20 ? after[backlog - 1] : undefined;
		return {
			kind: f.kind,
			from: f.holder,
			to: claim?.writer ?? null,
			leaseLeftMs: f.leaseEndsAt - f.at,
			claimMs: claim === undefined ? null : claim.at - f.at,
			claimAfterLeaseEndMs: claim === undefined ? null : claim.at - f.leaseEndsAt,
			resumeMs: resumed === undefined ? null : resumed.at - f.at,
			replayMs: startedLine === undefined ? null : Number(startedLine.replayMs),
			backlog,
			catchUpPerS:
				caughtUp === undefined || resumed === undefined
					? null
					: Math.round(backlog / Math.max(0.001, (caughtUp.at - resumed.at) / 1000)),
		};
	});

	// What each host read to follow its streams: the last `reads` line it printed.
	type Reads = {registry: Meter; inbox: Meter};
	const readsOf = (name: string) =>
		(notes.get(name) ?? []).findLast((l) => l.ev === "reads") as (Note & Reads) | undefined;
	const lived = [...o.hosts.keys()].filter((h) => o.aliveAtEnd.has(h));
	const watchers = lived.flatMap((h) => {
		const r = readsOf(h);
		const up = (notes.get(h) ?? []).find((l) => l.ev === "up")?.at ?? o.runStart;
		return r === undefined
			? []
			: [
					{
						host: h,
						seconds: r1((r.at - up) / 1000),
						registryEvents: r.registry.events,
						registryBytes: r.registry.bytes,
						registryReads: r.registry.reads,
						registryRings: r.registry.rings,
						inboxEvents: r.inbox.events,
						inboxBytes: r.inbox.bytes,
						inboxReads: r.inbox.reads,
					},
				];
	});
	const writes = [...notes.values()].flat().filter((l) => l.ev === "write");
	const span = incAt.length < 2 ? 0 : ((incAt.at(-1)?.at ?? 0) - (incAt[0]?.at ?? 0)) / 1000;
	return {
		finalCount: final.count,
		replayedCount: replayed.count,
		replayMatchesLive:
			replayed.count === final.count &&
			replayed.cursor === final.cursor &&
			replayed.last === final.last,
		inboxEvents: inbox.length,
		distinctIds: firstOf.size,
		repeatsInInbox: inbox.length - firstOf.size,
		missingIds: missing.length,
		extraIds: extra.length,
		appliedOnce: applied.size,
		appliedTwice: twice.length,
		notApplied: notApplied.length,
		registryEvents: registry.length,
		registryKinds: Object.fromEntries(
			[...new Set(registry.map((r) => r.kind))].map((k) => [
				k,
				registry.filter((r) => r.kind === k).length,
			]),
		),
		stateEvents: states.length,
		stateRevGaps,
		chainBreaks: breaks.slice(0, 10),
		claims: registry.filter((r) => r.kind === "claimed").length,
		leaseExpiredEvents: registry.filter((r) => r.kind === "lease_expired").length,
		logEvents: o.rows.length,
		rowBytes: {
			inbox: r1(avg(inbox.map(bytes94))),
			state: r1(avg(states.map(bytes94))),
			registry: r1(avg(registry.map(bytes94))),
		},
		writesTried: writes.length,
		writesRefused: writes.filter((l) => l.ok === false).map((l) => `${l.host}: ${String(l.why)}`),
		savesAnsweredDup: writes.filter((l) => l.why === "answer lost, landed").length,
		overlaps,
		believedTogetherMs,
		zombies,
		takeovers,
		watchers,
		hostEvents: {
			leaseEnds: [...notes.values()].flat().filter((l) => l.ev === "lease_end").length,
			teaErrors: [...notes.values()].flat().filter((l) => l.ev === "tea_error").length,
			badShapes: [...notes.values()].flat().filter((l) => l.ev === "bad_shape").length,
		},
		countedPerS: span === 0 ? 0 : Math.round(incAt.length / span),
		pass: {
			countExact: final.count === o.n && missing.length === 0 && extra.length === 0,
			everyIdOnce:
				twice.length === 0 &&
				notApplied.length === 0 &&
				applied.size === o.n &&
				breaks.length === 0 &&
				inbox.length === firstOf.size,
			zombieRefused: zombies.every(
				(z) =>
					z.lateAccepted === 0 &&
					z.ledgerAcceptedAfterWake === 0 &&
					z.noticedBy !== null &&
					z.programGoneMs !== null &&
					z.hostAliveAtEnd,
			),
			// 97: some late writes, every one refused `fenced`. 98: none accepted, and every refused
			// one `fenced`; none tried at all is a pass (the lease clock stopped the program first).
			aloneRefusedByFence: zombies
				.filter((z) => z.kind === "alone")
				.every((z) => z.lateAccepted === 0 && z.lateRefused.every((w) => w === "fenced")),
			noHostCrashed: [...o.hosts.keys()].every((h) => o.dead.has(h) || o.aliveAtEnd.has(h)),
			neverTwoWritingOwners: overlaps.length === 0,
			replayMatches: replayed.count === final.count && replayed.cursor === final.cursor,
			progressOffRegistry: states.length > 0 && registry.every((r) => r.kind !== "state"),
		},
	};
}
export type CounterRun = Awaited<ReturnType<typeof runOnce>>;

/** Saved runs of four experiments, read as they were written. */
type Saved = Record<string, any>;

/** The comparison: 94's, 96's and 97's saved runs and these, by preset (97's, one more column). */
export function compare(runs94: Saved[], runs96: Saved[], runs97: Saved[], runs98: Saved[]) {
	const side = (runs: Saved[], preset: string, was94: boolean) => {
		const rs = runs.filter((r) => r.preset === preset);
		if (rs.length === 0) return null;
		const range = (xs: number[]) => {
			const f = xs.filter((x) => Number.isFinite(x));
			return f.length === 0 ? null : [Math.min(...f), Math.max(...f)];
		};
		const takeovers = rs.flatMap((r) => r.takeovers.filter((t: Saved) => t.kind !== "alone"));
		const zombies = rs.flatMap((r) => r.zombies);
		const watchEvents = rs.map((r) =>
			was94
				? r.inboxEvents + r.stateEvents + r.claims + r.leaseExpiredEvents
				: Math.max(...r.watchers.map((w: Saved) => w.registryEvents)),
		);
		return {
			runs: rs.length,
			pass: rs.map((r) => Object.values(r.pass ?? {}).every((x) => x === true)),
			staleShareOfSendAppends: range(
				rs.map((r) => r1((100 * r.sendLatency.stale) / r.sendLatency.appends)),
			),
			watchEventsPerMessage: range(
				rs.map((r, i) => Math.round((1000 * (watchEvents[i] ?? 0)) / r.n) / 1000),
			),
			repeatsInInbox: range(rs.map((r) => r.repeatsInInbox)),
			sendAppendP50Ms: range(rs.map((r) => r.sendLatency.appendP50Ms)),
			sendAppendP99Ms: range(rs.map((r) => r.sendLatency.appendP99Ms)),
			sendP50Ms: range(rs.map((r) => r.sendLatency.sendP50Ms)),
			sendP99Ms: range(rs.map((r) => r.sendLatency.sendP99Ms)),
			claimAfterLeaseEndMs: range(takeovers.map((t: Saved) => t.claimAfterLeaseEndMs)),
			takeoverMs: range(takeovers.map((t: Saved) => t.claimMs)),
			resumeMs: range(takeovers.map((t: Saved) => t.resumeMs)),
			replayMs: range(takeovers.map((t: Saved) => t.replayMs)),
			zombieRefusals: zombies.map((z: Saved) => `${z.kind}: ${z.lateRefused.join(",")}`),
			zombieNoticedMs: range(zombies.map((z: Saved) => z.noticedMs)),
			zombieProgramGoneMs: range(zombies.map((z: Saved) => z.programGoneMs)),
			zombieNoticedBy: zombies.map((z: Saved) => `${z.kind}: ${z.noticedBy}`),
			peakWorkerdMb: range(rs.map((r) => Number(r.rss?.peakWorkerdMb))),
			countedPerS: range(rs.map((r) => r.countedPerS)),
		};
	};
	const out: Record<string, unknown> = {};
	for (const preset of ["small", "large"])
		out[preset] = {
			"94": side(runs94, preset, true),
			"96": side(runs96, preset, false),
			"97": side(runs97, preset, false),
			"98": side(runs98, preset, false),
		};
	return out;
}
