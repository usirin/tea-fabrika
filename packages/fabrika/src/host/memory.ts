// The `Ledger` in plain memory, for tests. It does not run `rules.ts`: it is the same rules written a
// second time, in TypeScript over Maps, so the one law suite (`./laws`) checks two independent
// writings of them. Where they disagree, a law fails on one of the two.
//
// One process, one thread: each call is one synchronous step, so it is atomic as a SQL transaction
// is. The alarm is a fiber that runs the due jobs every `tickMs`; the doorbell is a PubSub.
//
// New in 99: exits, monitors, links, the supervisor's start and dead letters, as in `rules.ts`.
// New in 100: `exitChild` (a parent's shutdown or kill), and every EXIT names the run it is for.
// New in 102: limits, `hold`, `charge`, `setLimits` and `usage`, as in `rules.ts`.
// New in 110: `memoryService`, the same service with no alarm fiber: each call runs the due jobs
// first. For a ledger made outside an Effect scope (the pipeline's `memoryLedger`).
import {Clock, Duration, Effect, Layer, PubSub, Stream} from "effect";
import {fromRaw, type Lease, Ledger, type Raw, type Row} from "./ledger.ts";
import {
	type AppendResult,
	type CancelResult,
	type ChargeResult,
	type ClaimResult,
	type Cost,
	type EndReason,
	type Event,
	type ExitChildResult,
	type ExitReason,
	type ExitResult,
	type Expected,
	type FlagResult,
	type HoldResult,
	isInbox,
	isLedgerWord,
	isLimitReason,
	isNameShape,
	type LimitKind,
	type Limits,
	type LinkResult,
	limitsRefusal,
	MAX_DELIVERIES,
	type MonitorResult,
	micros,
	namesOver,
	type Over,
	type ProcessInfo,
	type RegisterResult,
	type RenewResult,
	type SetLimitsResult,
	type Signal,
	type StartResult,
	type Usage,
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
	/** 102: when it was registered; its limits (dollars in micro-dollars) and its subtree's use. */
	at: number;
	max: {usd: number | null; tokens: number | null; wallMs: number | null; children: number | null};
	deadline: number | null;
	used: {usd: number; tokens: number};
	limited: LimitKind | null;
};
type Monitor = {watcher: string; ref: string; target: string; incarnation: number};
type Ending = {
	reason: EndReason;
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
	/** 102: each name's wall-time end, for the alarm. */
	const deadlines = new Map<string, number>();
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
	const newProc = (pos: number, parent: string | null, at: number): Proc => ({
		pos,
		parent,
		incarnation: 1,
		down: 0,
		trapExit: false,
		suspect: null,
		strikes: 0,
		at,
		max: {usd: null, tokens: null, wallMs: null, children: null},
		deadline: null,
		used: {usd: 0, tokens: 0},
		limited: null,
	});

	const register = (now: number, name: string, writer: string): RegisterResult => {
		if (!isNameShape(name)) return {ok: false, why: "denied"};
		const known = names.get(name);
		if (known !== undefined)
			return {ok: true, created: false, pos: known.pos, rev: log[known.pos - 1]?.rev ?? 0};
		if (nested(name)) return {ok: false, why: "denied"};
		const r = insert(now, name, "any", {kind: "registered", writer});
		if (!r.ok) return {ok: false, why: "denied"};
		names.set(name, newProc(r.pos, null, now));
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
						data: {
							from: name,
							incarnation: p.incarnation,
							reason: e.reason,
							why: e.why,
							at: now,
							to: o.incarnation,
						},
						id: `EXIT:${name}:${p.incarnation}`,
					});
				else if (e.reason !== "normal")
					work.push({
						name: other,
						e: {
							reason: isLimitReason(e.reason) ? "killed" : e.reason,
							why: e.why,
							suspect: null,
							by: name,
							writer: "ledger",
						},
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
		limits: Limits | null,
	): StartResult => {
		const me = fencedName(now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		if (limits !== null && limitsRefusal(limits) !== null) return {ok: false, why: "denied"};
		const out: Written[] = [];
		const spent = overIn(now, me, NONE);
		if (spent !== null) {
			end(now, me, spent, out);
			return {ok: false, why: "limit", over: spent, written: out};
		}
		const c = names.get(child);
		if (c === undefined) {
			if (!isNameShape(child) || nested(child)) return {ok: false, why: "denied"};
			const full = tooMany(me);
			if (full !== null) return {ok: false, why: "limit", over: full, written: out};
			const data = limits === null ? {parent: me} : {parent: me, limits};
			const r = say(now, out, child, {kind: "registered", writer: me, data});
			if (!r.ok) return {ok: false, why: "denied"};
			const p = newProc(r.pos, me, now);
			names.set(child, p);
			if (limits !== null) setMax(child, p, limits);
			linkBoth(me, child);
			return {ok: true, incarnation: 1, started: true, written: out};
		}
		if (c.parent !== me) return {ok: false, why: "denied"};
		if (c.down !== 0 && (after === null || after === c.incarnation)) {
			if (c.limited !== null)
				return {ok: false, why: "limit", over: where(now, child, c, c.limited), written: out};
			const own = overOf(now, [[child, c]], NONE);
			if (own !== null) return {ok: false, why: "limit", over: own, written: out};
			const full = tooMany(me);
			if (full !== null) return {ok: false, why: "limit", over: full, written: out};
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

	/** `rules.ts`'s `exitChild`: OTP's `exit(Child, shutdown | kill)`, from the child's parent. */
	const exitChild = (
		now: number,
		fence: number,
		child: string,
		incarnation: number,
		signal: Signal,
		why: string,
	): ExitChildResult => {
		const me = fencedName(now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		const c = names.get(child);
		if (c === undefined || c.parent !== me) return {ok: false, why: "denied"};
		if (c.down !== 0 || c.incarnation !== incarnation)
			return {ok: true, how: "noproc", written: []};
		const out: Written[] = [];
		const reason = signal === "kill" ? "killed" : "shutdown";
		if (signal === "shutdown" && c.trapExit) {
			say(now, out, `${child}/inbox`, {
				kind: "EXIT",
				writer: "ledger",
				data: {
					from: me,
					incarnation: names.get(me)?.incarnation ?? 0,
					reason,
					why,
					at: now,
					to: c.incarnation,
				},
				id: `SIGNAL:${me}:${c.incarnation}`,
			});
			return {ok: true, how: "signalled", written: out};
		}
		takeDown(now, child, {reason, why, suspect: null, by: me, writer: "ledger"}, out);
		return {ok: true, how: "exited", written: out};
	};

	const processInfo = (name: string): ProcessInfo | null => {
		const p = names.get(name);
		if (p === undefined) return null;
		const {parent, incarnation, down, trapExit} = p;
		return {name, parent, incarnation, down, trapExit};
	};

	// ------------------------------------------------------------ 102: limits

	const NONE = {usd: 0, tokens: 0};
	/** The name and its parents, up to the top. */
	const chain = (name: string): [string, Proc][] => {
		const out: [string, Proc][] = [];
		for (let at: string | null = name; at !== null; ) {
			const p = names.get(at);
			if (p === undefined || out.some(([n]) => n === at)) break;
			out.push([at, p]);
			at = p.parent;
		}
		return out;
	};
	const where = (now: number, name: string, p: Proc, kind: LimitKind): Over => {
		if (kind === "usd")
			return {kind, at: name, used: p.used.usd / 1e6, max: (p.max.usd ?? 0) / 1e6};
		if (kind === "tokens") return {kind, at: name, used: p.used.tokens, max: p.max.tokens ?? 0};
		if (kind === "wall") {
			const wall = p.max.wallMs ?? 0;
			return {kind, at: name, used: now - ((p.deadline ?? now) - wall), max: wall};
		}
		return {kind, at: name, used: 0, max: p.max.children ?? 0};
	};
	/** The outermost limit in `c` crossed now, or that `ask` more would cross. */
	const overOf = (
		now: number,
		c: readonly [string, Proc][],
		ask: {usd: number; tokens: number},
	): Over | null => {
		for (const [name, p] of [...c].reverse()) {
			if (p.deadline !== null && p.deadline <= now) return where(now, name, p, "wall");
			if (p.max.usd !== null && p.used.usd + ask.usd > p.max.usd)
				return {kind: "usd", at: name, used: (p.used.usd + ask.usd) / 1e6, max: p.max.usd / 1e6};
			if (p.max.tokens !== null && p.used.tokens + ask.tokens > p.max.tokens)
				return {kind: "tokens", at: name, used: p.used.tokens + ask.tokens, max: p.max.tokens};
		}
		return null;
	};
	const overIn = (now: number, name: string, ask: {usd: number; tokens: number}) =>
		overOf(now, chain(name), ask);
	/** Names running under `name`, at every depth. */
	const liveUnder = (name: string): number => {
		let n = 0;
		const todo = [name];
		const seen = new Set(todo);
		for (let at = todo.pop(); at !== undefined; at = todo.pop())
			for (const [k, p] of names)
				if (p.parent === at && !seen.has(k)) {
					seen.add(k);
					todo.push(k);
					if (p.down === 0) n++;
				}
		return n;
	};
	/** One more child under `parent`: too many, anywhere up the tree? */
	const tooMany = (parent: string): Over | null => {
		for (const [name, p] of chain(parent).reverse()) {
			if (p.max.children === null) continue;
			const used = liveUnder(name) + 1;
			if (used > p.max.children) return {kind: "children", at: name, used, max: p.max.children};
		}
		return null;
	};
	const setMax = (name: string, p: Proc, l: Limits) => {
		p.max = {
			usd: l.usd === undefined ? null : micros(l.usd),
			tokens: l.tokens ?? null,
			wallMs: l.wallMs ?? null,
			children: l.children ?? null,
		};
		p.limited = null;
		p.deadline = l.wallMs === undefined ? null : p.at + l.wallMs;
		if (p.deadline === null) deadlines.delete(name);
		else deadlines.set(name, p.deadline);
	};
	const spendOn = (name: string, usd: number, tokens: number) => {
		for (const [, p] of chain(name)) {
			p.used.usd += usd;
			p.used.tokens += tokens;
		}
	};
	/** End the outermost run still up at or under `over.at`, from `from` up: reason `limit:<kind>`. */
	const end = (now: number, from: string, over: Over, out: Written[]) => {
		if (over.kind === "children") return;
		const c = chain(from);
		const i = c.findIndex(([n]) => n === over.at);
		const target = (i < 0 ? c : c.slice(0, i + 1)).reverse().find(([, p]) => p.down === 0);
		if (target === undefined) return;
		const [name, p] = target;
		const why =
			over.kind === "wall"
				? `${over.at}'s wall time: ${over.used} ms of ${over.max}`
				: `${over.at}'s ${over.kind}: ${over.used} of ${over.max}`;
		const incarnation = p.incarnation;
		const reason = `limit:${over.kind}` as const;
		takeDown(now, name, {reason, why, suspect: null, by: null, writer: "ledger"}, out);
		p.limited = over.kind;
		say(now, out, `${name}/dead`, {
			kind: "limit",
			writer: "ledger",
			data: {
				limit: over.kind,
				of: over.at,
				used: over.used,
				max: over.max,
				why,
				incarnation,
				at: now,
			},
			id: `limit:${incarnation}`,
		});
	};
	const costOk = (c: Cost) =>
		(c.usd === undefined || (Number.isFinite(c.usd) && c.usd >= 0)) &&
		(c.tokens === undefined || (Number.isInteger(c.tokens) && c.tokens >= 0));

	const hold = (now: number, fence: number, id: string, cost: Cost): HoldResult => {
		const me = fencedName(now, fence);
		if (me === null) return {ok: false, why: "fenced"};
		if (!costOk(cost)) return {ok: false, why: "denied"};
		const spend = ids.get(`${me}/spend`);
		if (spend?.has(`hold:${fence}:${id}`) || spend?.has(`charge:${fence}:${id}`))
			return {ok: true, dup: true, written: []};
		const ask = {usd: micros(cost.usd), tokens: cost.tokens ?? 0};
		const out: Written[] = [];
		const over = overIn(now, me, ask);
		if (over !== null) {
			end(now, me, over, out);
			return {ok: false, why: "limit", over, written: out};
		}
		say(now, out, `${me}/spend`, {
			kind: "held",
			writer: "ledger",
			data: {fence, turn: id, usd: ask.usd, tokens: ask.tokens},
			id: `hold:${fence}:${id}`,
		});
		spendOn(me, ask.usd, ask.tokens);
		return {ok: true, dup: false, written: out};
	};

	const charge = (now: number, fence: number, id: string, cost: Cost): ChargeResult => {
		const claimed = log[fence - 1];
		const me = claimed?.kind === "claimed" ? claimed.stream : null;
		if (me === null) return {ok: false, why: "fenced"};
		if (!costOk(cost)) return {ok: false, why: "denied"};
		const spend = ids.get(`${me}/spend`);
		if (spend?.has(`charge:${fence}:${id}`)) return {ok: true, dup: true, over: null, written: []};
		const held = spend?.get(`hold:${fence}:${id}`);
		const h = held ? (JSON.parse(held.data) as {usd: number; tokens: number}) : NONE;
		const paid = {usd: micros(cost.usd), tokens: cost.tokens ?? 0};
		const out: Written[] = [];
		say(now, out, `${me}/spend`, {
			kind: "charged",
			writer: "ledger",
			data: {fence, turn: id, usd: paid.usd, tokens: paid.tokens},
			id: `charge:${fence}:${id}`,
		});
		spendOn(me, paid.usd - h.usd, paid.tokens - h.tokens);
		const over = overIn(now, me, NONE);
		if (over !== null) end(now, me, over, out);
		return {ok: true, dup: false, over, written: out};
	};

	const setLimits = (
		now: number,
		name: string,
		limits: Limits,
		writer: string,
	): SetLimitsResult => {
		if (limitsRefusal(limits) !== null) return {ok: false, why: "denied"};
		const p = names.get(name);
		if (p === undefined) return {ok: false, why: "unknown"};
		const out: Written[] = [];
		const r = say(now, out, name, {kind: "limits", writer, data: limits});
		if (!r.ok) return {ok: false, why: "unknown"};
		setMax(name, p, limits);
		const over = overIn(now, name, NONE);
		if (over !== null) end(now, name, over, out);
		return {ok: true, pos: r.pos, rev: r.rev, written: out};
	};

	const usage = (name: string): Usage | null => {
		const p = names.get(name);
		if (p === undefined) return null;
		const limits: Limits = {};
		if (p.max.usd !== null) limits.usd = p.max.usd / 1e6;
		if (p.max.tokens !== null) limits.tokens = p.max.tokens;
		if (p.max.wallMs !== null) limits.wallMs = p.max.wallMs;
		if (p.max.children !== null) limits.children = p.max.children;
		return {
			name,
			limits,
			used: {usd: p.used.usd / 1e6, tokens: p.used.tokens},
			children: liveUnder(name),
			since: p.at,
			deadline: p.deadline,
		};
	};

	const runDue = (now: number) => {
		for (const [name, due] of deadlines) {
			if (due > now) continue;
			deadlines.delete(name);
			const p = names.get(name);
			const over = p === undefined ? null : overOf(now, [[name, p]], NONE);
			if (over?.kind === "wall") end(now, name, over, []);
		}
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
		exitChild,
		processInfo,
		hold,
		charge,
		setLimits,
		usage,
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

/**
 * The calls over one in-memory ledger: each one synchronous step at the clock's now, then the
 * doorbell rings for what it wrote. `due`: run the due jobs first, for a ledger with no alarm.
 */
const serviceOf = (
	m: ReturnType<typeof memoryLedger>,
	bell: PubSub.PubSub<string>,
	due: boolean,
	clock: Clock.Clock,
): Ledger["Service"] => {
	const ring = Effect.suspend(() => PubSub.publishAll(bell, m.drain()));
	const step = <A>(f: (now: number) => A) =>
		Effect.sync(() => {
			const now = clock.currentTimeMillisUnsafe();
			if (due) m.runDue(now);
			return f(now);
		}).pipe(Effect.tap(() => ring));
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
		startChild: (fence, child, after, limits) =>
			step((now) => m.startChild(now, fence, child, after, limits)),
		exitChild: (fence, child, incarnation, signal, why) =>
			step((now) => m.exitChild(now, fence, child, incarnation, signal, why)),
		processInfo: (name) => step(() => m.processInfo(name)),
		hold: (fence, id, cost) => step((now) => m.hold(now, fence, id, cost)),
		charge: (fence, id, cost) => step((now) => m.charge(now, fence, id, cost)),
		setLimits: (name, limits, writer) => step((now) => m.setLimits(now, name, limits, writer)),
		usage: (name) => step(() => m.usage(name)),
		read: (fromPos, limit, prefix) => step(() => m.read(fromPos, limit, prefix)),
		readStream: (stream, fromRev, limit) => step(() => m.readStream(stream, fromRev, limit)),
		readLast: (stream, count) => step(() => m.readLast(stream, count)),
		lease: (name) => step(() => m.lease(name)),
		watch: (stream) =>
			Stream.fromPubSub(bell).pipe(
				Stream.filter((s) => s === stream),
				Stream.map(() => undefined),
			),
	};
	return fromRaw(raw);
};

const ledgerOf = (o: MemoryOptions) =>
	memoryLedger(o.graceMs ?? 1000, o.maxDeliveries === undefined ? MAX_DELIVERIES : o.maxDeliveries);

/**
 * The in-memory `Ledger`, with its alarm fiber and doorbell; both end with the layer's scope. Its
 * time is Effect's `Clock` where the layer is built: under a `TestClock`, the test owns it.
 */
export const layerMemory = (o: MemoryOptions = {}) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const clock = yield* Clock.Clock;
			const m = ledgerOf(o);
			const bell = yield* PubSub.unbounded<string>();
			const alarm = Effect.sync(() => m.runDue(clock.currentTimeMillisUnsafe())).pipe(
				Effect.andThen(Effect.suspend(() => PubSub.publishAll(bell, m.drain()))),
				Effect.andThen(Effect.sleep(Duration.millis(o.tickMs ?? 25))),
				Effect.forever,
			);
			yield* Effect.forkScoped(alarm);
			return serviceOf(m, bell, false, clock);
		}),
	);

/**
 * The in-memory `Ledger` with no alarm: no fiber and no scope, so one value can be provided to
 * many layers that share it (`Layer.succeed(Ledger, memoryService())`), as many processes share one
 * ledger. The due jobs (a lease's `lease_expired`, a wall limit's end) run at the start of the next
 * call instead of on a timer. A lease still ends on time: every call reads the clock, Effect's own
 * live one, as it is made outside any Effect.
 */
export const memoryService = (o: MemoryOptions = {}): Ledger["Service"] =>
	serviceOf(
		ledgerOf(o),
		Effect.runSync(PubSub.unbounded<string>()),
		true,
		Clock.Clock.defaultValue(),
	);
