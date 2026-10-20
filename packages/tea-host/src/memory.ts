// The `Ledger` in plain memory, for tests. It does not run `rules.ts`: it is the same rules written a
// second time, in TypeScript over Maps, so the one law suite (`./laws`) checks two independent
// writings of them. Where they disagree, a law fails on one of the two.
//
// One process, one thread: each call is one synchronous step, so it is atomic as a SQL transaction
// is. The alarm is a fiber that runs the due jobs every `tickMs`; the doorbell is a PubSub.
//
// New in 99: exits, monitors, links, the supervisor's start and dead letters, as in `rules.ts`.
import {Duration, Effect, Layer, PubSub, Stream} from "effect";
import {fromRaw, type Lease, Ledger, type Raw, type Row} from "./ledger.ts";
import {
	type AppendResult,
	type CancelResult,
	type ClaimResult,
	type Event,
	type ExitReason,
	type ExitResult,
	type Expected,
	type FlagResult,
	isInbox,
	isLedgerWord,
	isNameShape,
	type LinkResult,
	MAX_DELIVERIES,
	type MonitorResult,
	namesOver,
	type ProcessInfo,
	type RegisterResult,
	type RenewResult,
	type StartResult,
	type Written,
} from "./rules.ts";

export interface MemoryOptions {
	/** How long after a lease's end its `lease_expired` may wait. Default 1000 ms. */
	readonly graceMs?: number;
	/** How often the alarm looks for due jobs. Default 25 ms. */
	readonly tickMs?: number;
	/** Crashes in a row on one message before it goes to `<name>/dead`; `null`: never. Default 3. */
	readonly maxDeliveries?: number | null;
}

type LeaseRow = {holder: string; expiresAt: number; fence: number; stop: boolean};
/** The process behind a name: `rules.ts`'s `names` row. `down` is the `exited` event's pos; 0: up. */
type Proc = {
	pos: number;
	parent: string | null;
	incarnation: number;
	down: number;
	trapExit: boolean;
	suspect: number | null;
	strikes: number;
};
type Monitor = {watcher: string; ref: string; target: string; incarnation: number};
type Ending = {
	reason: ExitReason;
	why: string;
	suspect: number | null;
	by: string | null;
	writer: string;
};

/** The ledger's state and its rules, with no clock and no Effect: `now` is passed in. */
export const memoryLedger = (graceMs: number, maxDeliveries: number | null = MAX_DELIVERIES) => {
	const log: Row[] = [];
	const streams = new Map<string, Row[]>();
	const ids = new Map<string, Map<string, Row>>();
	const names = new Map<string, Proc>();
	const leases = new Map<string, LeaseRow>();
	const jobs = new Map<string, number>();
	const monitors = new Map<string, Monitor>();
	const links = new Map<string, Set<string>>();
	const written: string[] = [];

	const revOf = (stream: string) => streams.get(stream)?.length ?? 0;
	const ownerOf = (stream: string) => namesOver(stream).find((n) => names.has(n)) ?? null;
	const openInbox = (stream: string) =>
		isInbox(stream) && ownerOf(stream) === stream.slice(0, -"/inbox".length);
	const nested = (name: string) =>
		namesOver(name)
			.slice(0, -1)
			.some((n) => names.has(n)) ||
		[...names.keys()].some((n) => n.startsWith(`${name}/`)) ||
		isInbox(name);
	/** The name whose live lease this fence is, or null. */
	const fencedName = (now: number, fence: number) =>
		[...leases].find(([, l]) => l.fence === fence && l.expiresAt > now)?.[0] ?? null;
	const fenceHolds = (now: number, stream: string, fence: number) => {
		const name = fencedName(now, fence);
		if (name === null) return false;
		return stream === name || stream.startsWith(`${name}/`) || openInbox(stream);
	};

	const insert = (now: number, stream: string, expected: Expected, e: Event): AppendResult => {
		const id = e.id ?? null;
		const repeat = id === null ? undefined : ids.get(stream)?.get(id);
		if (repeat) return {ok: true, pos: repeat.pos, rev: repeat.rev, dup: true};
		const rev = revOf(stream);
		if (expected !== "any" && expected !== rev) return {ok: false, why: "stale", rev};
		const row: Row = {
			pos: log.length + 1,
			stream,
			rev: rev + 1,
			writer: e.writer,
			kind: e.kind,
			at: now,
			data: JSON.stringify(e.data ?? {}),
			id,
		};
		log.push(row);
		streams.set(stream, [...(streams.get(stream) ?? []), row]);
		if (id !== null) ids.set(stream, (ids.get(stream) ?? new Map()).set(id, row));
		written.push(stream);
		return {ok: true, pos: row.pos, rev: row.rev, dup: false};
	};
	/** The ledger's own message to `stream`, kept in `out` if it landed now. */
	const say = (now: number, out: Written[], stream: string, e: Event) => {
		const r = insert(now, stream, "any", e);
		if (r.ok && !r.dup) out.push({stream, rev: r.rev, pos: r.pos});
		return r;
	};
	const linkBoth = (a: string, b: string) => {
		links.set(a, (links.get(a) ?? new Set()).add(b));
		links.set(b, (links.get(b) ?? new Set()).add(a));
	};
	const newProc = (pos: number, parent: string | null): Proc => ({
		pos,
		parent,
		incarnation: 1,
		down: 0,
		trapExit: false,
		suspect: null,
		strikes: 0,
	});

	const register = (now: number, name: string, writer: string): RegisterResult => {
		if (!isNameShape(name)) return {ok: false, why: "denied"};
		const known = names.get(name);
		if (known !== undefined)
			return {ok: true, created: false, pos: known.pos, rev: log[known.pos - 1]?.rev ?? 0};
		if (nested(name)) return {ok: false, why: "denied"};
		const r = insert(now, name, "any", {kind: "registered", writer});
		if (!r.ok) return {ok: false, why: "denied"};
		names.set(name, newProc(r.pos, null));
		return {ok: true, created: true, pos: r.pos, rev: r.rev};
	};

	const append = (
		now: number,
		stream: string,
		expected: Expected,
		e: Event,
		fence: number | null,
	): AppendResult => {
		const owner = ownerOf(stream);
		if (owner === null) return {ok: false, why: "unknown"};
		if (fence !== null && !fenceHolds(now, stream, fence)) return {ok: false, why: "fenced"};
		if (fence === null && !openInbox(stream)) return {ok: false, why: "denied"};
		if (isLedgerWord(e)) return {ok: false, why: "denied"};
		return insert(now, stream, expected, e);
	};

	const claim = (
		now: number,
		name: string,
		holder: string,
		expectedRev: number,
		ttlMs: number,
	): ClaimResult => {
		const proc = names.get(name);
		if (proc === undefined)
			return nested(name) ? {ok: false, why: "denied"} : {ok: false, why: "unknown"};
		if (proc.down !== 0) return {ok: false, why: "down", pos: proc.down};
		const live = leases.get(name);
		if (live && live.expiresAt > now)
			return {ok: false, why: "held", holder: live.holder, expiresAt: live.expiresAt};
		const expiresAt = now + ttlMs;
		const data = {holder, ttlMs, expiresAt, replaces: live ? live.fence : null};
		const r = insert(now, name, expectedRev, {kind: "claimed", writer: holder, data});
		if (!r.ok) return {ok: false, why: "stale", rev: revOf(name)};
		leases.set(name, {holder, expiresAt, fence: r.pos, stop: false});
		jobs.set(name, expiresAt + graceMs);
		return {ok: true, fence: r.pos, rev: r.rev, expiresAt, incarnation: proc.incarnation};
	};

	const renew = (now: number, name: string, fence: number, ttlMs: number): RenewResult => {
		const l = leases.get(name);
		if (!l || l.fence !== fence || l.expiresAt <= now) return {ok: false, why: "lost"};
		if (l.stop) return {ok: false, why: "stop"};
		l.expiresAt = now + ttlMs;
		jobs.set(name, l.expiresAt + graceMs);
		return {ok: true, expiresAt: l.expiresAt};
	};

	const cancel = (now: number, name: string, writer: string): CancelResult => {
		if (!names.has(name)) return {ok: false, why: "unknown"};
		const r = insert(now, name, "any", {kind: "cancel", writer});
		const l = leases.get(name);
		if (l) l.stop = true;
		return r.ok ? {ok: true, pos: r.pos, rev: r.rev} : {ok: false, why: "unknown"};
	};

	// ------------------------------------------------------------ 99: exits, monitors, links

	/** `rules.ts`'s `strike`: count a crash against the message it names. */
	const strike = (now: number, name: string, p: Proc, e: Ending, out: Written[]) => {
		if (e.reason !== "crash" || e.suspect === null) {
			p.suspect = null;
			p.strikes = 0;
			return;
		}
		const strikes = (p.suspect === e.suspect ? p.strikes : 0) + 1;
		if (maxDeliveries !== null && strikes >= maxDeliveries) {
			say(now, out, `${name}/dead`, {
				kind: "dead_letter",
				writer: "ledger",
				data: {rev: e.suspect, strikes, why: e.why, at: now},
				id: `dead:${e.suspect}`,
			});
			p.suspect = null;
			p.strikes = 0;
			return;
		}
		p.suspect = e.suspect;
		p.strikes = strikes;
	};

	/** `rules.ts`'s `takeDown`: the exit, its monitors' DOWNs, its links' EXITs or exits. */
	const takeDown = (now: number, first: string, ending: Ending, out: Written[]): number => {
		const work: {name: string; e: Ending}[] = [{name: first, e: ending}];
		let firstPos = 0;
		for (let next = work.shift(); next !== undefined; next = work.shift()) {
			const {name, e} = next;
			const p = names.get(name);
			if (p === undefined || p.down !== 0) continue;
			const r = say(now, out, name, {
				kind: "exited",
				writer: e.writer,
				data: {
					fence: leases.get(name)?.fence ?? null,
					incarnation: p.incarnation,
					reason: e.reason,
					why: e.why,
					suspect: e.suspect,
					by: e.by,
				},
				id: `exited:${p.incarnation}`,
			});
			if (!r.ok) continue;
			if (firstPos === 0) firstPos = r.pos;
			leases.delete(name);
			jobs.delete(name);
			p.down = r.pos;
			strike(now, name, p, e, out);
			for (const [key, m] of monitors) {
				if (m.target !== name) continue;
				monitors.delete(key);
				if (m.incarnation !== p.incarnation) continue;
				say(now, out, `${m.watcher}/inbox`, {
					kind: "DOWN",
					writer: "ledger",
					data: {
						ref: m.ref,
						target: name,
						incarnation: p.incarnation,
						reason: e.reason,
						why: e.why,
						at: now,
					},
					id: `DOWN:${m.ref}`,
				});
			}
			const linked = [...(links.get(name) ?? [])].sort();
			links.delete(name);
			for (const other of linked) links.get(other)?.delete(name);
			for (const other of linked) {
				const o = names.get(other);
				if (o === undefined || o.down !== 0) continue;
				if (o.trapExit)
					say(now, out, `${other}/inbox`, {
						kind: "EXIT",
						writer: "ledger",
						data: {from: name, incarnation: p.incarnation, reason: e.reason, why: e.why, at: now},
						id: `EXIT:${name}:${p.incarnation}`,
					});
				else if (e.reason !== "normal")
					work.push({
						name: other,
						e: {reason: e.reason, why: e.why, suspect: null, by: name, writer: "ledger"},
					});
			}
		}
		return firstPos;
	};

	const exit = (
		now: number,
		name: string,
		fence: number,
		reason: ExitReason,
		why: string,
		suspect: number | null,
		writer: string,
	): ExitResult => {
		const p = names.get(name);
		if (p !== undefined && p.down !== 0) {
			const landed = log[p.down - 1];
			const was = landed ? (JSON.parse(landed.data) as {fence?: number | null}) : null;
			if (was?.fence === fence)
				return {ok: true, pos: p.down, incarnation: p.incarnation, dup: true, written: []};
		}
		if (p === undefined || fencedName(now, fence) !== name) return {ok: false, why: "fenced"};
		const out: Written[] = [];
		const incarnation = p.incarnation;
		const pos = takeDown(now, name, {reason, why, suspect, by: null, writer}, out);
		return pos === 0
			? {ok: false, why: "fenced"}
			: {ok: true, pos, incarnation, dup: false, written: out};
	};

	const monitor = (now: number, fence: number, ref: string, target: string): MonitorResult => {
		const watcher = fencedName(now, fence);
		if (watcher === null) return {ok: false, why: "fenced"};
		const held = monitors.get(`${watcher}\u0000${ref}`);
		if (held) return {ok: true, incarnation: held.incarnation, written: []};
		const inbox = `${watcher}/inbox`;
		if (ids.get(inbox)?.has(`DOWN:${ref}`)) return {ok: true, incarnation: null, written: []};
		const t = names.get(target);
		if (t === undefined || t.down !== 0) {
			const out: Written[] = [];
			say(now, out, inbox, {
				kind: "DOWN",
				writer: "ledger",
				data: {
					ref,
					target,
					incarnation: t?.incarnation ?? 0,
					reason: "noproc",
					why: t === undefined ? "not registered" : "down",
					at: now,
				},
				id: `DOWN:${ref}`,
			});
			return {ok: true, incarnation: null, written: out};
		}
		monitors.set(`${watcher}\u0000${ref}`, {watcher, ref, target, incarnation: t.incarnation});
		return {ok: true, incarnation: t.incarnation, written: []};
	};

	const demonitor = (now: number, fence: number, ref: string): FlagResult => {
		const watcher = fencedName(now, fence);
		if (watcher === null) return {ok: false, why: "fenced"};
		monitors.delete(`${watcher}\u0000${ref}`);
		return {ok: true};
	};

	const link = (now: number, fence: number, other: string): LinkResult => {
		const me = fencedName(now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		if (other === me) return {ok: true};
		const o = names.get(other);
		if (o === undefined || o.down !== 0) return {ok: false, why: "noproc"};
		linkBoth(me, other);
		return {ok: true};
	};

	const unlink = (now: number, fence: number, other: string): FlagResult => {
		const me = fencedName(now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		links.get(me)?.delete(other);
		links.get(other)?.delete(me);
		return {ok: true};
	};

	const trapExit = (now: number, fence: number, on: boolean): FlagResult => {
		const me = fencedName(now, fence);
		const p = me === null ? undefined : names.get(me);
		if (p === undefined) return {ok: false, why: "fenced"};
		p.trapExit = on;
		return {ok: true};
	};

	const startChild = (
		now: number,
		fence: number,
		child: string,
		after: number | null,
	): StartResult => {
		const me = fencedName(now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		const out: Written[] = [];
		const c = names.get(child);
		if (c === undefined) {
			if (!isNameShape(child) || nested(child)) return {ok: false, why: "denied"};
			const r = say(now, out, child, {kind: "registered", writer: me, data: {parent: me}});
			if (!r.ok) return {ok: false, why: "denied"};
			names.set(child, newProc(r.pos, me));
			linkBoth(me, child);
			return {ok: true, incarnation: 1, started: true, written: out};
		}
		if (c.parent !== me) return {ok: false, why: "denied"};
		if (c.down !== 0 && (after === null || after === c.incarnation)) {
			const incarnation = c.incarnation + 1;
			say(now, out, child, {
				kind: "restarted",
				writer: me,
				data: {incarnation, after: c.incarnation},
				id: `restarted:${incarnation}`,
			});
			c.incarnation = incarnation;
			c.down = 0;
			c.trapExit = false;
			linkBoth(me, child);
			return {ok: true, incarnation, started: true, written: out};
		}
		if (c.down === 0) linkBoth(me, child);
		return {ok: true, incarnation: c.incarnation, started: false, written: out};
	};

	const processInfo = (name: string): ProcessInfo | null => {
		const p = names.get(name);
		if (p === undefined) return null;
		const {parent, incarnation, down, trapExit} = p;
		return {name, parent, incarnation, down, trapExit};
	};

	const runDue = (now: number) => {
		for (const [name, due] of jobs) {
			if (due > now) continue;
			const l = leases.get(name);
			if (l && l.expiresAt <= now) {
				insert(now, name, "any", {
					kind: "lease_expired",
					writer: "ledger",
					data: {fence: l.fence, holder: l.holder},
				});
				leases.delete(name);
			}
			jobs.delete(name);
		}
	};

	const under = (stream: string, prefix: string) =>
		stream === prefix || stream.startsWith(`${prefix}/`);

	return {
		register,
		append,
		claim,
		renew,
		cancel,
		exit,
		monitor,
		demonitor,
		link,
		unlink,
		trapExit,
		startChild,
		processInfo,
		runDue,
		read: (fromPos: number, limit: number, prefix: string | null) =>
			log
				.slice(fromPos)
				.filter((r) => prefix === null || under(r.stream, prefix))
				.slice(0, limit),
		readStream: (stream: string, fromRev: number, limit: number) => {
			const rows = (streams.get(stream) ?? []).slice(fromRev);
			return limit < 0 ? rows : rows.slice(0, limit);
		},
		readLast: (stream: string, count: number) => (streams.get(stream) ?? []).slice(-count),
		lease: (name: string): Lease | null => {
			const l = leases.get(name);
			return l
				? {
						stream: name,
						holder: l.holder,
						expires_at: l.expiresAt,
						fence: l.fence,
						stop: l.stop ? 1 : 0,
					}
				: null;
		},
		/** The streams written since the last call, in order. */
		drain: () => written.splice(0),
	};
};

/** The in-memory `Ledger`, with its alarm fiber and doorbell; both end with the layer's scope. */
export const layerMemory = (o: MemoryOptions = {}) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const m = memoryLedger(
				o.graceMs ?? 1000,
				o.maxDeliveries === undefined ? MAX_DELIVERIES : o.maxDeliveries,
			);
			const bell = yield* PubSub.unbounded<string>();
			const ring = Effect.suspend(() => PubSub.publishAll(bell, m.drain()));
			const step = <A>(f: (now: number) => A) =>
				Effect.sync(() => f(Date.now())).pipe(Effect.tap(() => ring));
			const alarm = step(m.runDue).pipe(
				Effect.andThen(Effect.sleep(Duration.millis(o.tickMs ?? 25))),
				Effect.forever,
			);
			yield* Effect.forkScoped(alarm);
			const raw: Raw = {
				register: (name, writer) => step((now) => m.register(now, name, writer)),
				append: (stream, expected, event, fence) =>
					step((now) => m.append(now, stream, expected, event, fence)),
				claim: (name, holder, expectedRev, ttlMs) =>
					step((now) => m.claim(now, name, holder, expectedRev, ttlMs)),
				renew: (name, fence, ttlMs) => step((now) => m.renew(now, name, fence, ttlMs)),
				cancel: (name, writer) => step((now) => m.cancel(now, name, writer)),
				exit: (name, fence, reason, why, suspect, writer) =>
					step((now) => m.exit(now, name, fence, reason, why, suspect, writer)),
				monitor: (fence, ref, target) => step((now) => m.monitor(now, fence, ref, target)),
				demonitor: (fence, ref) => step((now) => m.demonitor(now, fence, ref)),
				link: (fence, other) => step((now) => m.link(now, fence, other)),
				unlink: (fence, other) => step((now) => m.unlink(now, fence, other)),
				trapExit: (fence, on) => step((now) => m.trapExit(now, fence, on)),
				startChild: (fence, child, after) => step((now) => m.startChild(now, fence, child, after)),
				processInfo: (name) => Effect.sync(() => m.processInfo(name)),
				read: (fromPos, limit, prefix) => Effect.sync(() => m.read(fromPos, limit, prefix)),
				readStream: (stream, fromRev, limit) =>
					Effect.sync(() => m.readStream(stream, fromRev, limit)),
				readLast: (stream, count) => Effect.sync(() => m.readLast(stream, count)),
				lease: (name) => Effect.sync(() => m.lease(name)),
				watch: (stream) =>
					Stream.fromPubSub(bell).pipe(
						Stream.filter((s) => s === stream),
						Stream.map(() => undefined),
					),
			};
			return fromRaw(raw);
		}),
	);
