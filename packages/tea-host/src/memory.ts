// The `Ledger` in plain memory, for tests. It does not run `rules.ts`: it is the same rules written a
// second time, in TypeScript over Maps, so the one law suite (`./laws`) checks two independent
// writings of them. Where they disagree, a law fails on one of the two.
//
// One process, one thread: each call is one synchronous step, so it is atomic as a SQL transaction
// is. The alarm is a fiber that runs the due jobs every `tickMs`; the doorbell is a PubSub.
import {Duration, Effect, Layer, PubSub, Stream} from "effect";
import {fromRaw, type Lease, Ledger, type Raw, type Row} from "./ledger.ts";
import {
	type AppendResult,
	type CancelResult,
	type ClaimResult,
	type Event,
	type Expected,
	isInbox,
	isNameShape,
	namesOver,
	type RegisterResult,
	type RenewResult,
} from "./rules.ts";

export interface MemoryOptions {
	/** How long after a lease's end its `lease_expired` may wait. Default 1000 ms. */
	readonly graceMs?: number;
	/** How often the alarm looks for due jobs. Default 25 ms. */
	readonly tickMs?: number;
}

type LeaseRow = {holder: string; expiresAt: number; fence: number; stop: boolean};

/** The ledger's state and its rules, with no clock and no Effect: `now` is passed in. */
export const memoryLedger = (graceMs: number) => {
	const log: Row[] = [];
	const streams = new Map<string, Row[]>();
	const ids = new Map<string, Map<string, Row>>();
	const names = new Map<string, number>();
	const leases = new Map<string, LeaseRow>();
	const jobs = new Map<string, number>();
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
	const fenceHolds = (now: number, stream: string, fence: number) => {
		const held = [...leases].find(([, l]) => l.fence === fence && l.expiresAt > now);
		if (held === undefined) return false;
		const [name] = held;
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

	const register = (now: number, name: string, writer: string): RegisterResult => {
		if (!isNameShape(name)) return {ok: false, why: "denied"};
		const pos = names.get(name);
		if (pos !== undefined) return {ok: true, created: false, pos, rev: log[pos - 1]?.rev ?? 0};
		if (nested(name)) return {ok: false, why: "denied"};
		const r = insert(now, name, "any", {kind: "registered", writer});
		if (!r.ok) return {ok: false, why: "denied"};
		names.set(name, r.pos);
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
		return insert(now, stream, expected, e);
	};

	const claim = (
		now: number,
		name: string,
		holder: string,
		expectedRev: number,
		ttlMs: number,
	): ClaimResult => {
		if (!names.has(name))
			return nested(name) ? {ok: false, why: "denied"} : {ok: false, why: "unknown"};
		const live = leases.get(name);
		if (live && live.expiresAt > now)
			return {ok: false, why: "held", holder: live.holder, expiresAt: live.expiresAt};
		const expiresAt = now + ttlMs;
		const data = {holder, ttlMs, expiresAt, replaces: live ? live.fence : null};
		const r = insert(now, name, expectedRev, {kind: "claimed", writer: holder, data});
		if (!r.ok) return {ok: false, why: "stale", rev: revOf(name)};
		leases.set(name, {holder, expiresAt, fence: r.pos, stop: false});
		jobs.set(name, expiresAt + graceMs);
		return {ok: true, fence: r.pos, rev: r.rev, expiresAt};
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
			const m = memoryLedger(o.graceMs ?? 1000);
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
