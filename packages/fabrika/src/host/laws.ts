// The ledger's laws: one suite, written once against the `Ledger` service, run on every
// implementation (the Durable Object over HTTP, node:sqlite, memory) and on the SQL with one planted
// mistake (`layerPlanted`), where it must fail.
//
// Ported from experiments 93, 96 and 97. Not unchanged: under deny by default every write needs a
// registered name, so each law registers its names first, and a few answers moved (a write under a
// name nobody registered is `unknown` now, not `ok`). Law 6 (a SQL view) is retired: this ledger has
// no views. New: law 19 (nothing lands under a name nobody registered) and law 20 (registering).
// New in 99: law 21 (monitors and DOWN), 22 (links and trap_exit), 23 (start_child and restart),
// 24 (dead letters). New in 100: law 25 (a parent's shutdown or kill of its child). New in 102:
// laws 26 to 30, limits (spend up the tree, admission and the end it brings, a late charge,
// children at every depth, wall time from registration).
//
// The laws that need processes (7, 8, 9, 10, 13, 15) live in the experiment that runs them.
//
// One clock (lane 21, after experiment 144): a law about time never reads the test machine's clock.
// A lease's end is a time the ledger wrote, so only the ledger's clock says it is past (`Time`).
// Under a `TestClock` the test owns that clock and jumps it; otherwise a law asks the ledger.
import {Clock, Duration, Effect, Layer, PubSub, Stream} from "effect";
import type {TestClock} from "effect/testing";
import {
	type Denied,
	fromRaw,
	Ledger,
	LedgerUnreachable,
	type NewEvent,
	type Raw,
	type Row,
	rawOf,
	streams,
} from "./ledger.ts";
import * as L from "./rules.ts";
import {dispatch, isMethod, openDb} from "./sqlite-driver.ts";
import {meter, tail} from "./tail.ts";

export type LawResult = {readonly law: string; readonly pass: boolean; readonly numbers: string};

type Service = Ledger["Service"];
const sleep = (ms: number) => Effect.sleep(Duration.millis(ms));

/**
 * How a law reads the time and lets it pass: always on the ledger's clock, never the test
 * machine's. On a Durable Object the two can differ by a tenth of a second or more (experiment
 * 144: a busy object's `Date.now()` moves only on I/O), and a law that compares them flips.
 */
export interface Time {
	/** The ledger's now. */
	readonly now: Effect.Effect<number, LedgerError>;
	/** Until the ledger's now is past `at`, a time it wrote: a lease's end, a deadline. */
	readonly past: (at: number) => Effect.Effect<void, LedgerError>;
	/** A poll's pause, `ms` long: on a test's clock, that clock moves on by `ms`. */
	readonly pause: (ms: number) => Effect.Effect<void>;
	/** `e` on the live clock, for a law whose waits are about this machine, not the ledger (T). */
	readonly live: <A, E, R>(e: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}
/** What asking the ledger its time can fail with: its `register` and `readLast`. */
type LedgerError = Denied | LedgerUnreachable;

/** The test owns the ledger's clock: a jump past a time is one step, with no sleeping. */
const testTime = (clock: TestClock.TestClock): Time => ({
	now: clock.currentTimeMillis,
	past: (at) =>
		Effect.suspend(() =>
			clock.currentTimeMillisUnsafe() > at ? Effect.void : clock.setTime(at + 1),
		),
	pause: (ms) => clock.adjust(Duration.millis(ms)),
	live: (e) => clock.withLive(e),
});

/** Probes of the ledger's clock before `past` gives up and lets the law's next step judge. */
const PROBES = 100;
/**
 * The ledger keeps its own clock: a law asks it the time. The ledger stamps each event it writes
 * with its now (`at`), so one fresh name registered and read back is its clock's answer.
 */
const ledgerTime = (l: Service): Time => {
	const now = Effect.gen(function* () {
		const name = fresh("now");
		yield* l.register(name, "clock");
		const [row] = yield* l.readLast(name, 1);
		if (row === undefined)
			return yield* Effect.die(new Error(`${name}: registered, not read back`));
		return row.at;
	});
	return {
		now,
		past: (at) =>
			Effect.gen(function* () {
				for (let i = 0; i < PROBES; i++) {
					const n = yield* now;
					if (n > at) return;
					// How long to wait comes from the ledger's own numbers; the probe after it decides.
					yield* sleep(at + 1 - n);
				}
			}),
		pause: sleep,
		live: (e) => e,
	};
};

/** Wait on the ledger's own word: the first `kind` event in `stream`, polled for 5 s. Or null. */
const factOf = (l: Service, time: Time, stream: string, kind: string) =>
	Effect.gen(function* () {
		for (let i = 0; i <= 100; i++) {
			const fact = (yield* l.readStream(stream)).find((e) => e.kind === kind);
			if (fact !== undefined) return fact;
			yield* time.pause(50);
		}
		return null;
	});
/** The `lease_expired` the alarm writes for a lease, from its `end` (the time it wrote) on. */
const expired = (l: Service, time: Time, name: string, end: number) =>
	Effect.andThen(time.past(end), factOf(l, time, name, "lease_expired"));

const isTestClock = (c: Clock.Clock): c is TestClock.TestClock =>
	"setTime" in c && "adjust" in c && "withLive" in c;

/**
 * The time a law runs on: the test's, under a `TestClock`; the ledger's own, under any other. Read
 * from the clock the law runs under, so a suite cannot say one and run on the other.
 */
export const timeOf = (l: Service): Effect.Effect<Time> =>
	Clock.clockWith((c) => Effect.succeed(isTestClock(c) ? testTime(c) : ledgerTime(l)));

/**
 * A short lease's ttl: the steps that need it live run right after the claim, then the law waits
 * for its end. The most steps in one such window is five (law 16). Measured on 2026-10-24 with
 * three whole suites side by side on one laptop, five steps on the Durable Object took 852 ms at
 * worst, and on CI five took over 600 ms: 3000 ms is 3.5 times the first. A law whose window ran
 * past the end anyway says so beside its WRONG (`inTime`).
 */
const LIVE_MS = 3000;
let seq = 0;
/** A fresh name per law, so laws never see each other's events. */
export const fresh = (tag: string) => `${tag}-${Date.now().toString(36)}-${seq++}`;

const WORDS: Record<string, string> = {
	Stale: "stale",
	Fenced: "fenced",
	Denied: "denied",
	UnknownName: "unknown",
	Held: "held",
	LeaseLost: "lost",
	Cancelled: "stop",
	Down: "down",
	NoProc: "noproc",
	OverLimit: "limit",
	LedgerUnreachable: "unreachable",
};
const okWord = (a: unknown) =>
	typeof a === "object" && a !== null && "dup" in a && a.dup === true
		? "dup"
		: typeof a === "object" &&
				a !== null &&
				(("created" in a && a.created === false) || ("started" in a && a.started === false))
			? "existing"
			: "ok";

/** What a call answered, as one word, and its value when it succeeded. */
type Said<A> = {readonly word: string; readonly value: A | null};
/** One call's answer as a word: `ok`, `dup`, `existing`, or the refusal's (`stale`, `fenced`, ...). */
export const say = <A, E extends {readonly _tag: string}>(e: Effect.Effect<A, E>) =>
	Effect.map(
		Effect.result(e),
		(r): Said<A> =>
			r._tag === "Success"
				? {word: okWord(r.success), value: r.success}
				: {word: WORDS[r.failure._tag] ?? r.failure._tag, value: null},
	);

/**
 * Each step: what it did, what it got, what the law wants. A `late` one is no step: it notes that
 * steps were done after a time they needed, so a WRONG may be this machine's slowness.
 */
type Step = {
	readonly what: string;
	readonly got: string;
	readonly want: string;
	readonly late?: true;
};
const verdict = (law: string, all: readonly Step[]): LawResult => {
	const list = all.filter((s) => s.late === undefined);
	const late = all.filter((s) => s.late !== undefined).map((s) => s.what);
	const bad = list.filter((s) => s.got !== s.want);
	return {
		law,
		pass: bad.length === 0,
		numbers:
			bad.length === 0
				? list.map((s) => `${s.what}: ${s.got}`).join("; ")
				: `WRONG ${bad.map((s) => `${s.what}: ${s.got}, wanted ${s.want}`).join("; ")}${
						late.length === 0 ? "" : `; too slow to tell: ${late.join("; ")}`
					}`,
	};
};
/** A law's steps, and `step`: run one call, record its word against the one wanted. */
const steps = () => {
	const list: Step[] = [];
	const step = <A, E extends {readonly _tag: string}>(
		what: string,
		e: Effect.Effect<A, E>,
		want: string,
	) =>
		Effect.map(say(e), (s) => {
			list.push({what, got: s.word, want});
			return s.value;
		});
	const count = (what: string, got: number, want: number) => {
		list.push({what, got: String(got), want: String(want)});
	};
	return {list, step, count};
};
/** The steps of a law about time, on `time`, and `inTime`. */
const timedSteps = (time: Time) => {
	const s = steps();
	/**
	 * After the steps that need a time the ledger wrote not yet passed (a lease's end, the alarm due
	 * after it, a deadline). Their answers came back after it, on the ledger's clock: if one is
	 * WRONG, the verdict says it may be this machine's slowness. It fails nothing itself, as an
	 * answer that came back late may still have been given in time.
	 */
	const inTime = (what: string, end: number) =>
		Effect.map(time.now, (now) => {
			const late = now - end;
			if (late >= 0)
				s.list.push({what: `${what}, back ${late} ms after it`, got: "", want: "", late: true});
		});
	return {...s, inTime};
};

const tally = (words: readonly string[]) => {
	const t: Record<string, number> = {};
	for (const w of words) t[w] = (t[w] ?? 0) + 1;
	return t;
};
const show = (t: Record<string, number>) =>
	Object.entries(t)
		.map(([k, v]) => `${k} ${v}`)
		.join(", ");

const note = (writer: string, id?: string): NewEvent =>
	id === undefined ? {kind: "note", writer} : {kind: "note", writer, id};
const all = <A, E>(xs: readonly Effect.Effect<A, E>[]) =>
	Effect.all(xs, {concurrency: "unbounded"});
const failed = (law: string, why: string): LawResult => ({law, pass: false, numbers: why});

/** Register each name; the claims after it go at the registration's rev. */
const setUp = (l: Service, ...names: string[]) =>
	Effect.forEach(names, (n) => l.register(n, "setup"), {concurrency: 1});

// ---------------------------------------------------------------- 93's laws

export const law1Claims = (l: Service, n = 50) =>
	Effect.gen(function* () {
		const s = fresh("l1");
		const [reg] = yield* setUp(l, s);
		const rs = yield* all(
			Array.from({length: n}, (_, i) => say(l.claim(s, `h${i}`, reg?.rev ?? 1, 30_000))),
		);
		const t = tally(rs.map((r) => r.word));
		const claimed = (yield* l.readStream(s)).filter((e) => e.kind === "claimed").length;
		return {
			law: `1. ${n} claims at once on one registered name`,
			pass: t.ok === 1 && (t.held ?? 0) + (t.stale ?? 0) === n - 1 && claimed === 1,
			numbers: `${show(t)}; claimed events ${claimed}`,
		} satisfies LawResult;
	});

export const law2Appends = (l: Service, n = 50) =>
	Effect.gen(function* () {
		const tag = fresh("l2");
		const names = Array.from({length: n}, (_, i) => `${tag}-${i}`);
		yield* all(names.map((s) => l.register(s, "setup")));
		const t0 = performance.now();
		const many = yield* all(names.map((s) => say(l.append(streams(s).inbox, 0, note("w")))));
		const ms = performance.now() - t0;
		const pos = new Set(many.flatMap((r) => (r.value === null ? [] : [r.value.pos])));
		const a = tally(many.map((r) => r.word));
		const one = fresh("l2one");
		yield* setUp(l, one);
		const inbox = streams(one).inbox;
		const b = tally(
			(yield* all(Array.from({length: n}, (_, i) => say(l.append(inbox, 0, note(`w${i}`)))))).map(
				(r) => r.word,
			),
		);
		const rows = (yield* l.readStream(inbox)).length;
		return [
			{
				law: `2a. ${n} appends at once on ${n} inboxes, each at rev 0`,
				pass: a.ok === n && pos.size === n,
				numbers: `${show(a)}; distinct pos ${pos.size}; ${ms.toFixed(0)} ms`,
			},
			{
				law: `2b. ${n} appends at once on one inbox, same expected rev`,
				pass: b.ok === 1 && b.stale === n - 1 && rows === 1,
				numbers: `${show(b)}; rows ${rows}`,
			},
		] satisfies LawResult[];
	});

export const law3Fencing = (l: Service, graceMs = 1000) =>
	Effect.gen(function* () {
		const law = "3. a stale rev and an old fence are refused";
		const s = fresh("l3");
		const S = streams(s);
		const time = yield* timeOf(l);
		const {list, step, inTime} = timedSteps(time);
		const [reg] = yield* setUp(l, s);
		yield* step("append at 0", l.append(S.inbox, 0, note("w")), "ok");
		yield* step("again at 0", l.append(S.inbox, 0, note("w")), "stale");
		const c1 = yield* step("claim 1", l.claim(s, "h1", reg?.rev ?? 1, LIVE_MS), "ok");
		if (c1 === null) return verdict(law, list);
		yield* step("h1 with its live fence", l.append(S.state, 0, note("h1"), c1.fence), "ok");
		yield* inTime("the step that needs the lease live", c1.expiresAt);
		// At c1's rev, so before the alarm writes lease_expired, `graceMs` after the lease's end.
		yield* time.past(c1.expiresAt);
		const c2 = yield* step("claim 2, lease run out", l.claim(s, "h2", c1.rev, 30_000), "ok");
		yield* inTime("claim 2, before the alarm", c1.expiresAt + graceMs);
		if (c2 === null) return verdict(law, list);
		yield* step(
			"old fence after the reclaim",
			l.append(S.state, 1, note("h1"), c1.fence),
			"fenced",
		);
		yield* step("new fence", l.append(S.state, 1, note("h2"), c2.fence), "ok");
		list.push({what: "fence grew", got: String(c2.fence > c1.fence), want: "true"});
		return verdict(law, list);
	});

/**
 * Needs the alarm. `graceMs` is the ledger's expiry grace. About 6 s on a real clock, none on a
 * test's: there the law jumps the clock and polls until the alarm has written what it writes.
 */
export const law4Expiry = (l: Service, graceMs: number) =>
	Effect.gen(function* () {
		const ttl = 2000;
		const a = fresh("l4a");
		const b = fresh("l4b");
		// c: a lease that ends just after b's, so its lease_expired says the alarm ran past b's.
		const c = fresh("l4c");
		const time = yield* timeOf(l);
		const [ra, rb, rc] = yield* setUp(l, a, b, c);
		const ca = yield* say(l.claim(a, "h1", ra?.rev ?? 1, ttl));
		// Counted on the ledger's clock: from the claim to the `at` it stamped on lease_expired.
		const fact = yield* expired(l, time, a, ca.value?.expiresAt ?? 0);
		const expiredAfter = fact === null ? -1 : fact.at - ((ca.value?.expiresAt ?? 0) - ttl);
		const leaseGone = (yield* l.lease(a)) === null;

		const cb1 = yield* say(l.claim(b, "h1", rb?.rev ?? 1, ttl));
		const cc = yield* say(l.claim(c, "h1", rc?.rev ?? 1, ttl));
		// Right after the end the ledger wrote, so the claim lands before the alarm, `graceMs` later.
		const end = cb1.value?.expiresAt ?? 0;
		yield* time.past(end);
		const cb2 = yield* say(l.claim(b, "h2", cb1.value?.rev ?? 0, 30_000));
		const late = (yield* time.now) - (end + graceMs);
		const before = (yield* l.readStream(b)).filter((e) => e.kind === "lease_expired").length;
		yield* time.past(end + graceMs + 1500);
		const swept = (yield* expired(l, time, c, cc.value?.expiresAt ?? 0)) !== null;
		const after = (yield* l.readStream(b)).filter((e) => e.kind === "lease_expired").length;
		const holder = (yield* l.lease(b))?.holder;
		const f1 = cb1.value?.fence ?? -1;
		const f2 = cb2.value?.fence ?? -1;
		return [
			{
				law: "4a. ttl 2 s, no renew: the alarm writes lease_expired",
				pass: ca.word === "ok" && expiredAfter > 0 && leaseGone,
				numbers: `lease_expired after ${expiredAfter} ms (ttl ${ttl} + grace ${graceMs}); lease row gone ${leaseGone}`,
			},
			{
				law: "4b. a claim after the lease's end, before the alarm (lazy expiry)",
				pass:
					cb2.word === "ok" && f2 > f1 && before === 0 && swept && after === 0 && holder === "h2",
				numbers: `second claim ${cb2.word}${late < 0 ? "" : ` (back ${late} ms after the alarm was due: too slow to tell)`}, fence ${f1} -> ${f2}; lease_expired before ${before}, after the alarm ${after} (the alarm ran past it ${swept}); holder ${holder}`,
			},
		] satisfies LawResult[];
	});

export const law5Stop = (l: Service) =>
	Effect.gen(function* () {
		const law = "5. a renew says stop after a cancel";
		const s = fresh("l5");
		const {list, step} = steps();
		const [reg] = yield* setUp(l, s);
		const c = yield* step("claim", l.claim(s, "h1", reg?.rev ?? 1, 30_000), "ok");
		if (c === null) return verdict(law, list);
		yield* step("renew", l.renew(s, c.fence, 30_000), "ok");
		yield* step("renew, wrong fence", l.renew(s, c.fence + 1000, 30_000), "lost");
		yield* step("cancel", l.cancel(s, "owner"), "ok");
		yield* step("renew after the cancel", l.renew(s, c.fence, 30_000), "stop");
		return verdict(law, list);
	});

// ---------------------------------------------------------------- 96's laws

/** 11a. Senders that append at the end never race: no `stale`, and the revs are 1..n. */
export const law11AppendAny = (l: Service, n = 50) =>
	Effect.gen(function* () {
		const s = fresh("l11a");
		yield* setUp(l, s);
		const inbox = streams(s).inbox;
		const rs = yield* all(
			Array.from({length: n}, (_, i) => say(l.append(inbox, "any", note(`w${i}`, `m${i}`)))),
		);
		const revs = rs.flatMap((r) => (r.value === null ? [] : [r.value.rev])).sort((a, b) => a - b);
		const rows = yield* l.readStream(inbox);
		const gapless = rows.every((r, i) => r.rev === i + 1);
		return {
			law: `11a. ${n} appends at once on one inbox, rev "any"`,
			pass: revs.length === n && revs.every((r, i) => r === i + 1) && rows.length === n && gapless,
			numbers: `${show(tally(rs.map((r) => r.word)))}; rows ${rows.length}; revs 1..${revs.at(-1)} gapless ${gapless}`,
		} satisfies LawResult;
	});

/** 11b. The same message id, sent many times at once (and again later): it lands once. */
export const law11RepeatedId = (l: Service, n = 50) =>
	Effect.gen(function* () {
		const s = fresh("l11b");
		yield* setUp(l, s, `${s}-other`);
		const inbox = streams(s).inbox;
		const rs = yield* all(
			Array.from({length: n}, (_, i) => say(l.append(inbox, "any", note(`w${i}`, "same")))),
		);
		const later = yield* say(l.append(inbox, "any", note("late", "same")));
		const cas = yield* say(l.append(inbox, 7, note("cas", "same")));
		const other = yield* say(l.append(streams(`${s}-other`).inbox, "any", note("w", "same")));
		const rows = yield* l.readStream(inbox);
		const places = new Set(
			rs.flatMap((r) => (r.value === null ? [] : [`${r.value.pos}/${r.value.rev}`])),
		);
		const t = tally(rs.map((r) => r.word));
		return {
			law: `11b. one message id appended ${n} times at once, then twice more: it lands once`,
			pass:
				rows.length === 1 &&
				t.ok === 1 &&
				t.dup === n - 1 &&
				places.size === 1 &&
				later.word === "dup" &&
				cas.word === "dup" &&
				other.word === "ok",
			numbers: `${show(t)}; one place for all ${places.size === 1}; later ${later.word}; with a stale rev ${cas.word}; same id on another inbox ${other.word}; rows ${rows.length}`,
		} satisfies LawResult;
	});

/**
 * 12. A lease on `p` guards `p` and every stream under `p/`, and nothing else. Its newest fence
 * writes there until a newer claim exists, whatever the time: past the lease's end, and after the
 * alarm wrote `lease_expired` (lane 18's rule B, Kafka's epoch). An older fence is refused there
 * once a newer claim exists.
 *
 * Before lane 18 this law said the opposite of its first half: the fence was refused from the
 * lease's end on, before anyone claimed again ("old fence, run out, unclaimed: fenced").
 */
export const law12PrefixFence = (l: Service, graceMs = 1000) =>
	Effect.gen(function* () {
		const law =
			"12. a lease on p guards p/*: its newest fence writes there until a newer claim, and only there";
		const p = fresh("l12");
		const state = `${p}/state`;
		const time = yield* timeOf(l);
		const {list, step, count, inTime} = timedSteps(time);
		const [reg] = yield* setUp(l, p, `${p}0`, `${p}x`);
		const c1 = yield* step("claim 1", l.claim(p, "h1", reg?.rev ?? 1, LIVE_MS), "ok");
		if (c1 === null) return verdict(law, list);
		const save1 = {kind: "state", writer: "h1", id: "save-1"};
		yield* step("under the live fence", l.append(state, 0, save1, c1.fence), "ok");
		yield* step("deeper", l.append(`${p}/a/b`, "any", note("h1"), c1.fence), "ok");
		yield* step("sibling p0/state", l.append(`${p}0/state`, 0, note("h1"), c1.fence), "fenced");
		yield* step("sibling px", l.append(`${p}x`, "any", note("h1"), c1.fence), "fenced");
		yield* inTime("the steps that need the lease live", c1.expiresAt);
		// A fence that names no lease is refused at any time: it needs no window.
		yield* step("no such lease", l.append(state, 1, note("x"), c1.fence + 1000), "fenced");
		// Run out, and nobody claimed: the fence is still the newest one. Deeper, so the state's
		// revs below stay as they were.
		yield* time.past(c1.expiresAt);
		yield* step(
			"newest fence past the lease's end, nobody claimed",
			l.append(`${p}/a/b`, "any", note("h1", "late-1"), c1.fence),
			"ok",
		);
		yield* inTime("the write past the end, before the alarm", c1.expiresAt + graceMs);
		// The alarm ran: it wrote lease_expired, `graceMs` after the end, and still nobody claimed.
		const swept = yield* expired(l, time, p, c1.expiresAt);
		count("lease_expired written", swept === null ? 0 : 1, 1);
		yield* step(
			"newest fence after the alarm, nobody claimed",
			l.append(`${p}/a/b`, "any", note("h1", "late-2"), c1.fence),
			"ok",
		);
		const rev = (yield* l.readLast(p, 1))[0]?.rev ?? c1.rev;
		const c2 = yield* step("claim 2", l.claim(p, "h2", rev, 30_000), "ok");
		if (c2 === null) return verdict(law, list);
		yield* step("old fence after the reclaim", l.append(state, 1, note("h1"), c1.fence), "fenced");
		yield* step(
			"old fence deeper, after the reclaim",
			l.append(`${p}/a/b`, "any", note("h1"), c1.fence),
			"fenced",
		);
		yield* step("repeated id, old fence", l.append(state, 0, save1, c1.fence), "fenced");
		yield* step("new fence", l.append(state, 1, note("h2"), c2.fence), "ok");
		yield* step(
			"repeated id, live fence",
			l.append(state, 0, {...save1, writer: "h2"}, c2.fence),
			"dup",
		);
		count("state rows", (yield* l.readStream(state)).length, 2);
		return verdict(law, list);
	});

/** 14. Reads from a rev, and reads under a prefix, return exactly what they name, in order. */
export const law14Reads = (l: Service) =>
	Effect.gen(function* () {
		const p = fresh("l14");
		const owners = [p, `${p}x`, `${p}0`];
		const reg = yield* setUp(l, ...owners);
		const fences = new Map<string, number>();
		for (const [i, n] of owners.entries()) {
			const c = yield* l.claim(n, "h", reg[i]?.rev ?? 1, 30_000);
			fences.set(n, c.fence);
		}
		const names = [p, `${p}/x`, `${p}/y`, `${p}x`, `${p}/x`, `${p}0`, `${p}/y/z`, `${p}/x`];
		const fenceOf = (s: string) => fences.get(s.startsWith(`${p}/`) ? p : s) ?? -1;
		let from = -1;
		for (const s of names) {
			const r = yield* l.append(s, "any", note("w"), fenceOf(s));
			if (from < 0) from = r.pos - 1;
		}
		const under = (yield* l.read(from, 100, p)).filter((r) => r.kind === "note");
		const want = names.filter((s) => s === p || s.startsWith(`${p}/`));
		const fromRev = yield* l.readStream(`${p}/x`, 1);
		const page = yield* l.readStream(`${p}/x`, 0, 2);
		const last = yield* l.readLast(`${p}/x`, 2);
		const none = yield* l.readLast(`${p}/nothing`, 1);
		const revs = (rs: readonly Row[]) => rs.map((r) => r.rev).join(",");
		const inOrder = under.every((r, i) => i === 0 || r.pos > (under[i - 1]?.pos ?? 0));
		return {
			law: "14. reads from a rev, and under a prefix, return exactly what they name",
			pass:
				under.length === want.length &&
				under.every((r, i) => r.stream === want[i]) &&
				inOrder &&
				revs(fromRev) === "2,3" &&
				revs(page) === "1,2" &&
				revs(last) === "2,3" &&
				none.length === 0,
			numbers: `under p: ${under.length} of ${want.length}, in order ${inOrder}; p/x after rev 1: ${revs(fromRev)}; first page of 2: ${revs(page)}; last 2: ${revs(last)}; last of an empty stream: ${none.length} rows`,
		} satisfies LawResult;
	});

// ---------------------------------------------------------------- 97's laws

/** 16. Under a registered name, only its lease's fence writes, from registration on, for ever. */
export const law16Guard = (l: Service, graceMs = 1000) =>
	Effect.gen(function* () {
		const law =
			"16. an unfenced write under a registered name is refused, before, during and after a lease";
		const p = fresh("l16");
		const time = yield* timeOf(l);
		const {list, step, count, inTime} = timedSteps(time);
		const [reg] = yield* setUp(l, p);
		// 97's hole 1: before any claim, this landed. Registered, the name is guarded from the start.
		yield* step("unfenced, never claimed", l.append(`${p}/notes`, "any", note("x")), "denied");
		const c1 = yield* step("claim 1", l.claim(p, "h1", reg?.rev ?? 1, LIVE_MS), "ok");
		if (c1 === null) return verdict(law, list);
		yield* step("unfenced state, lease live", l.append(`${p}/state`, 0, note("x")), "denied");
		yield* step("unfenced with an id", l.append(`${p}/state`, "any", note("x", "a")), "denied");
		yield* step("unfenced to the name itself", l.append(p, "any", note("x")), "denied");
		yield* step("unfenced deeper", l.append(`${p}/a/b`, "any", note("x")), "denied");
		yield* step("fenced state", l.append(`${p}/state`, 0, note("h1"), c1.fence), "ok");
		yield* inTime("the steps that need the lease live", c1.expiresAt);
		// Run out and not swept yet: right after the end, before the alarm, `graceMs` later.
		yield* time.past(c1.expiresAt);
		yield* step("unfenced, lease run out", l.append(`${p}/state`, 1, note("x")), "denied");
		const c2 = yield* step("reclaim", l.claim(p, "h2", c1.rev, 30_000), "ok");
		yield* inTime("the steps after the end, before the alarm", c1.expiresAt + graceMs);
		if (c2 === null) return verdict(law, list);
		yield* step("unfenced after a reclaim", l.append(`${p}/state`, 1, note("x")), "denied");
		yield* step("new fence", l.append(`${p}/state`, 1, note("h2"), c2.fence), "ok");
		yield* step("unregistered sibling", l.append(`${p}0/state`, 0, note("x")), "unknown");
		yield* step("claim inside the name", l.claim(`${p}/state`, "h3", 2, 30_000), "denied");
		yield* step("claim of its inbox", l.claim(`${p}/inbox`, "h3", 0, 30_000), "denied");
		const inner = yield* step("register outer/inner", l.register(`${p}-outer/inner`, "w"), "ok");
		yield* step("claim it", l.claim(`${p}-outer/inner`, "h4", inner?.rev ?? 1, 30_000), "ok");
		yield* step("register around it", l.register(`${p}-outer`, "w"), "denied");
		yield* step("claim around it", l.claim(`${p}-outer`, "h5", 0, 30_000), "denied");
		count("state rows", (yield* l.readStream(`${p}/state`)).length, 2);
		return verdict(law, list);
	});

/** 17. A registered name's inbox is open: senders need no lease; a repeated id is answered, not written. */
export const law17Inbox = (l: Service) =>
	Effect.gen(function* () {
		const law = "17. an inbox append with no lease lands, under a registered name";
		const p = fresh("l17");
		const inbox = streams(p).inbox;
		const time = yield* timeOf(l);
		const {list, step, count, inTime} = timedSteps(time);
		const [reg] = yield* setUp(l, p);
		const c1 = yield* step("claim", l.claim(p, "h1", reg?.rev ?? 1, LIVE_MS), "ok");
		if (c1 === null) return verdict(law, list);
		yield* step("send, lease live", l.append(inbox, "any", note("s", "m1")), "ok");
		yield* step("the owner, fenced", l.append(inbox, "any", note("h1", "m3"), c1.fence), "ok");
		yield* inTime("the steps that need the lease live", c1.expiresAt);
		// What follows lands the same with the lease live or run out: it needs no window.
		yield* step("the same id again", l.append(inbox, "any", note("s", "m1")), "dup");
		yield* step("send with no id", l.append(inbox, "any", note("s")), "ok");
		yield* step("send at a rev", l.append(inbox, 3, note("s", "m2")), "ok");
		yield* step(
			"inbox of an unregistered name",
			l.append(`${p}-new/inbox`, "any", note("s", "m1")),
			"unknown",
		);
		yield* time.past(c1.expiresAt);
		yield* step("send, lease run out", l.append(inbox, "any", note("s", "m4")), "ok");
		count("inbox rows", (yield* l.readStream(inbox)).length, 5);
		return verdict(law, list);
	});

/**
 * 18. A fence reaches another program's inbox until a newer claim on its own name exists, and
 * never after: past its lease's end, a reply by the newest fence still lands (lane 18's rule B).
 *
 * Before lane 18 this law said a reply was refused from the replier's lease's end on, before
 * anyone claimed again ("reply, lease run out: fenced", and its repeat too).
 */
export const law18Reply = (l: Service, graceMs = 1000) =>
	Effect.gen(function* () {
		const law =
			"18. a reply into another program's inbox, fenced on the replier's lease, lands until a newer claim, and is refused after";
		const a = fresh("l18-asker");
		const b = fresh("l18-answerer");
		const time = yield* timeOf(l);
		const {list, step, count, inTime} = timedSteps(time);
		const [ra, rb] = yield* setUp(l, a, b, `${b}x`);
		const ca = yield* step("claim a", l.claim(a, "ha", ra?.rev ?? 1, 30_000), "ok");
		const cb = yield* step("claim b", l.claim(b, "hb", rb?.rev ?? 1, LIVE_MS), "ok");
		if (ca === null || cb === null) return verdict(law, list);
		const reply = (id: string, fence: number) =>
			l.append(streams(a).inbox, "any", {kind: "reply", writer: "hb", id}, fence);
		yield* step("reply, lease live", reply("r1", cb.fence), "ok");
		yield* step(
			"same fence into the asker's state",
			l.append(`${a}/state`, "any", note("hb"), cb.fence),
			"fenced",
		);
		yield* step(
			"same fence into a stream that is no inbox",
			l.append(`${b}x`, "any", note("hb"), cb.fence),
			"fenced",
		);
		yield* inTime("the steps that need b's lease live", cb.expiresAt);
		// Run out and not swept yet: right after the end, before the alarm, `graceMs` later.
		yield* time.past(cb.expiresAt);
		yield* step("reply, b's lease run out, nobody claimed", reply("r2", cb.fence), "ok");
		yield* step("repeat of the landed reply, lease run out", reply("r1", cb.fence), "dup");
		const cb2 = yield* step("reclaim b", l.claim(b, "hb2", cb.rev, 30_000), "ok");
		yield* inTime("the steps after the end, before the alarm", cb.expiresAt + graceMs);
		if (cb2 === null) return verdict(law, list);
		yield* step("old fence after a reclaim", reply("r3", cb.fence), "fenced");
		yield* step(
			"repeat of a landed reply, old fence, after a reclaim",
			reply("r1", cb.fence),
			"fenced",
		);
		yield* step("new fence", reply("r3", cb2.fence), "ok");
		yield* step("a sender with no lease", l.append(streams(a).inbox, "any", note("s", "q1")), "ok");
		count("inbox rows", (yield* l.readStream(streams(a).inbox)).length, 4);
		return verdict(law, list);
	});

// ---------------------------------------------------------------- new in 98: deny by default

/** 19. Nothing lands under a name nobody registered; registering opens its inbox, and only that. */
export const law19Unknown = (l: Service) =>
	Effect.gen(function* () {
		const law = "19. nothing lands under a name nobody registered";
		const u = fresh("l19");
		const S = streams(u);
		const {list, step, count} = steps();
		const other = fresh("l19-other");
		const [reg] = yield* setUp(l, other);
		const c = yield* l.claim(other, "h", reg?.rev ?? 1, 30_000);
		yield* step("unfenced state", l.append(S.state, 0, note("x")), "unknown");
		yield* step("state, another name's fence", l.append(S.state, 0, note("x"), c.fence), "unknown");
		yield* step("the name itself", l.append(u, "any", note("x")), "unknown");
		yield* step("its inbox", l.append(S.inbox, "any", note("s", "m1")), "unknown");
		yield* step(
			"its inbox, another name's fence",
			l.send(S.inbox, "m2", note("h"), c.fence),
			"unknown",
		);
		yield* step("a claim", l.claim(u, "h", 0, 30_000), "unknown");
		yield* step("a cancel", l.cancel(u, "x"), "unknown");
		const nothing = (yield* l.readStream(u)).length + (yield* l.readStream(S.inbox)).length;
		count("rows under it", nothing, 0);
		yield* step("register", l.register(u, "w"), "ok");
		yield* step("its inbox, registered", l.append(S.inbox, "any", note("s", "m1")), "ok");
		yield* step("an inbox deeper", l.append(`${u}/sub/inbox`, "any", note("s", "m1")), "denied");
		yield* step("unfenced state, registered", l.append(S.state, 0, note("x")), "denied");
		count("inbox rows", (yield* l.readStream(S.inbox)).length, 1);
		return verdict(law, list);
	});

/** 20. A name is registered once, by one register, and never inside, around or on an inbox. */
export const law20Register = (l: Service, n = 50) =>
	Effect.gen(function* () {
		const law = "20. a name registers once: idempotent, never nested, never an inbox";
		const p = fresh("l20");
		const {list, step, count} = steps();
		const first = yield* step("register", l.register(p, "w1"), "ok");
		yield* step("again", l.register(p, "w2"), "existing");
		count("registry rows", (yield* l.readStream(p)).length, 1);
		count("first registration's rev", first?.rev ?? -1, 1);
		yield* step("a claim at rev 0", l.claim(p, "h", 0, 30_000), "stale");
		yield* step("inside it", l.register(`${p}/a`, "w"), "denied");
		yield* step("its inbox", l.register(`${p}/inbox`, "w"), "denied");
		yield* step("an inbox-shaped name", l.register(`${p}x/inbox`, "w"), "denied");
		yield* step("an empty segment", l.register(`${p}x//b`, "w"), "denied");
		yield* step("a leading slash", l.register(`/${p}x`, "w"), "denied");
		yield* step("a sibling", l.register(`${p}0`, "w"), "ok");
		yield* step("under an unregistered name", l.register(`${p}-o/x`, "w"), "ok");
		yield* step("around it", l.register(`${p}-o`, "w"), "denied");
		const q = fresh("l20-race");
		const rs = yield* all(Array.from({length: n}, (_, i) => say(l.register(q, `w${i}`))));
		const t = tally(rs.map((r) => r.word));
		count(`${n} registers at once: created`, t.ok ?? 0, 1);
		count(`${n} registers at once: existing`, t.existing ?? 0, n - 1);
		count("registry rows after the race", (yield* l.readStream(q)).length, 1);
		return verdict(law, list);
	});

/**
 * T. The tail: every event of a stream, once each, in order, live, from any rev. Its waits are
 * for this machine's own fibers, not for a time the ledger wrote: they run on the live clock.
 */
export const lawTail = (l: Service, n = 100) =>
	Effect.flatMap(timeOf(l), (time) =>
		time.live(
			Effect.gen(function* () {
				const p = fresh("lt");
				yield* setUp(l, p);
				const inbox = streams(p).inbox;
				yield* l.append(inbox, "any", note("w", "before"));
				const got: Row[] = [];
				const m = meter();
				yield* tail(l, {stream: inbox, fromRev: 1, meter: m}).pipe(
					Stream.runForEach((r) => Effect.sync(() => got.push(r))),
					Effect.forkScoped,
				);
				for (let i = 0; i < n; i++) {
					yield* l.append(inbox, "any", note("w", `m${i}`));
					if (i % 10 === 0) yield* sleep(5);
				}
				const t0 = performance.now();
				while (got.length < n && performance.now() - t0 < 10_000) yield* sleep(10);
				yield* sleep(300);
				yield* l.append(inbox, "any", note("w", "late"));
				const lateAt = performance.now();
				while (got.length < n + 1 && performance.now() - lateAt < 3000) yield* sleep(5);
				const lateMs = Math.round(performance.now() - lateAt);
				const inOrder = got.every((r, i) => r.rev === i + 2);
				return {
					law: `T. a live tail hands on ${n + 1} events once each, in order, as they land`,
					pass: got.length === n + 1 && inOrder && got.at(-1)?.id === "late",
					numbers: `${got.length} handed on, revs from 2 in order ${inOrder}; the late one after ${lateMs} ms; reads ${m.reads}, rings ${m.rings}`,
				} satisfies LawResult;
			}).pipe(Effect.scoped),
		),
	);

// ---------------------------------------------------------------- new in 99: OTP's processes

/** The data of every `kind` event in a stream, parsed. */
const dataOf = (l: Service, stream: string, kind: string) =>
	Effect.map(l.readStream(stream), (rows) =>
		rows
			.filter((r) => r.kind === kind)
			.map((r) => JSON.parse(r.data) as Record<string, string | number | null>),
	);

/**
 * 21. A monitor's DOWN comes once per monitor, when the incarnation it watches exits, and never for
 * a lease that runs out and is taken over. Only the live lease may say the name exited.
 */
export const law21Monitors = (l: Service) =>
	Effect.gen(function* () {
		const law = "21. DOWN once per monitor, on an exit only: a takeover is no DOWN";
		const w = fresh("l21-watcher");
		const t = fresh("l21-target");
		const inbox = streams(w).inbox;
		const time = yield* timeOf(l);
		const {list, step, count, inTime} = timedSteps(time);
		const [rw, rt] = yield* setUp(l, w, t);
		const cw = yield* step("claim the watcher", l.claim(w, "hw", rw?.rev ?? 1, 30_000), "ok");
		const ct = yield* step("claim the target", l.claim(t, "h1", rt?.rev ?? 1, LIVE_MS), "ok");
		if (cw === null || ct === null) return verdict(law, list);
		// The monitors are set while the target's lease is live, so its running out comes after them.
		const m = yield* step("monitor r1", l.monitor(cw.fence, "r1", t), "ok");
		count("r1 watches incarnation", m?.incarnation ?? -1, 1);
		yield* step("monitor r1 again", l.monitor(cw.fence, "r1", t), "ok");
		yield* step("monitor r2", l.monitor(cw.fence, "r2", t), "ok");
		yield* step("monitor r3", l.monitor(cw.fence, "r3", t), "ok");
		yield* step("demonitor r3", l.demonitor(cw.fence, "r3"), "ok");
		yield* inTime("the monitors, set while the target's lease is live", ct.expiresAt);
		count("lease_expired written", (yield* expired(l, time, t, ct.expiresAt)) === null ? 0 : 1, 1);
		count("DOWNs after the lease ran out", (yield* dataOf(l, inbox, "DOWN")).length, 0);
		const ct2 = yield* step(
			"take over",
			l.claim(t, "h2", (yield* l.readLast(t, 1))[0]?.rev ?? 0, 30_000),
			"ok",
		);
		if (ct2 === null) return verdict(law, list);
		count("incarnation after the takeover", ct2.incarnation, 1);
		count("DOWNs after the takeover", (yield* dataOf(l, inbox, "DOWN")).length, 0);
		yield* step(
			"exit, the old host's fence",
			l.exit(t, ct.fence, "crash", "x", null, "h1"),
			"fenced",
		);
		yield* step("exit", l.exit(t, ct2.fence, "crash", "boom", null, "h2"), "ok");
		yield* step("exit again, same fence", l.exit(t, ct2.fence, "crash", "boom", null, "h2"), "dup");
		const downs = yield* dataOf(l, inbox, "DOWN");
		count("DOWNs after the exit", downs.length, 2);
		count(
			"of them crash, incarnation 1",
			downs.filter((d) => d.reason === "crash" && d.incarnation === 1).length,
			2,
		);
		yield* step("claim the down name", l.claim(t, "h3", 0, 30_000), "down");
		yield* step("renew the exited lease", l.renew(t, ct2.fence, 30_000), "lost");
		yield* step("monitor the down name", l.monitor(cw.fence, "r4", t), "ok");
		yield* step("monitor a name nobody registered", l.monitor(cw.fence, "r5", `${t}-none`), "ok");
		const after = yield* dataOf(l, inbox, "DOWN");
		count("DOWN noproc at once", after.filter((d) => d.reason === "noproc").length, 2);
		yield* step("monitor with no live lease", l.monitor(ct2.fence, "r6", w), "fenced");
		const forged = {kind: "DOWN", writer: "x", data: {ref: "r9", target: t, reason: "crash"}};
		yield* step("a forged DOWN into the inbox", l.append(inbox, "any", forged), "denied");
		yield* step(
			"a note signed by the ledger",
			l.append(inbox, "any", {kind: "note", writer: "ledger"}),
			"denied",
		);
		count("DOWNs in the end", (yield* dataOf(l, inbox, "DOWN")).length, 4);
		return verdict(law, list);
	});

/** 22. A link takes both names down together, unless one traps exits: then it gets an EXIT. */
export const law22Links = (l: Service) =>
	Effect.gen(function* () {
		const law = "22. linked names exit together; trap_exit turns it into an EXIT message";
		const p = fresh("l22");
		const [a, b, c, d, e, f] = ["a", "b", "c", "d", "e", "f"].map((x) => `${p}-${x}`);
		const {list, step, count} = steps();
		const names = [a, b, c, d, e, f].flatMap((x) => (x === undefined ? [] : [x]));
		const reg = yield* setUp(l, ...names);
		const fences = new Map<string, number>();
		for (const [i, n] of names.entries())
			fences.set(n, (yield* l.claim(n, `h-${i}`, reg[i]?.rev ?? 1, 30_000)).fence);
		const fence = (n: string | undefined) => fences.get(n ?? "") ?? -1;
		const down = (n: string | undefined) =>
			Effect.map(l.processInfo(n ?? ""), (pi) =>
				pi === null ? "none" : pi.down > 0 ? "down" : "up",
			);
		yield* step("b traps exits", l.trapExit(fence(b), true), "ok");
		yield* step("link a-b", l.link(fence(a), b ?? ""), "ok");
		yield* step("link a-c", l.link(fence(a), c ?? ""), "ok");
		yield* step("link c-d", l.link(fence(c), d ?? ""), "ok");
		yield* step("link to a name nobody registered", l.link(fence(a), `${p}-none`), "noproc");
		yield* step("a crashes", l.exit(a ?? "", fence(a), "crash", "boom", null, "ha"), "ok");
		const exits = yield* dataOf(l, streams(b ?? "").inbox, "EXIT");
		count("EXITs in b's inbox", exits.length, 1);
		count(
			"of them from a, crash",
			exits.filter((x) => x.from === a && x.reason === "crash").length,
			1,
		);
		list.push({what: "b", got: yield* down(b), want: "up"});
		list.push({what: "c", got: yield* down(c), want: "down"});
		list.push({what: "d, linked to c only", got: yield* down(d), want: "down"});
		const dExit = (yield* dataOf(l, d ?? "", "exited"))[0];
		list.push({what: "d taken down by", got: String(dExit?.by), want: String(c)});
		yield* step("link b to the down a", l.link(fence(b), a ?? ""), "noproc");
		yield* step("link e-f", l.link(fence(e), f ?? ""), "ok");
		yield* step("e ends normally", l.exit(e ?? "", fence(e), "normal", "done", null, "he"), "ok");
		list.push({what: "f after a normal exit", got: yield* down(f), want: "up"});
		return verdict(law, list);
	});

/** 23. Only a child's parent starts it again, once per exit; a supervisor's exit takes its children down. */
export const law23Start = (l: Service) =>
	Effect.gen(function* () {
		const law = "23. start_child: the parent alone restarts a child, once per incarnation";
		const s = fresh("l23-sup");
		const o = fresh("l23-other");
		const k = `${s}-child`;
		const {list, step, count} = steps();
		const [rs, ro] = yield* setUp(l, s, o);
		const cs = yield* step("claim the supervisor", l.claim(s, "hs", rs?.rev ?? 1, 30_000), "ok");
		const co = yield* step("claim another name", l.claim(o, "ho", ro?.rev ?? 1, 30_000), "ok");
		if (cs === null || co === null) return verdict(law, list);
		yield* step("the supervisor traps exits", l.trapExit(cs.fence, true), "ok");
		yield* step("start the child", l.startChild(cs.fence, k, null), "ok");
		yield* step("start it again", l.startChild(cs.fence, k, null), "existing");
		yield* step("another name starts it", l.startChild(co.fence, k, null), "denied");
		const ck = yield* step("claim the child", l.claim(k, "hk", 1, 30_000), "ok");
		if (ck === null) return verdict(law, list);
		count("child incarnation", ck.incarnation, 1);
		yield* step("the child crashes", l.exit(k, ck.fence, "crash", "boom", null, "hk"), "ok");
		count("EXITs to the supervisor", (yield* dataOf(l, streams(s).inbox, "EXIT")).length, 1);
		yield* step("claim the down child", l.claim(k, "hk", 0, 30_000), "down");
		yield* step("another name restarts it", l.startChild(co.fence, k, 1), "denied");
		yield* step(
			"restart after an incarnation it never had",
			l.startChild(cs.fence, k, 7),
			"existing",
		);
		const r = yield* step("restart after incarnation 1", l.startChild(cs.fence, k, 1), "ok");
		count("restarted as incarnation", r?.incarnation ?? -1, 2);
		yield* step("restart after 1 again", l.startChild(cs.fence, k, 1), "existing");
		const rev = (yield* l.readLast(k, 1))[0]?.rev ?? 0;
		const ck2 = yield* step("claim the restarted child", l.claim(k, "hk2", rev, 30_000), "ok");
		count("its incarnation", ck2?.incarnation ?? -1, 2);
		yield* step(
			"the supervisor shuts down",
			l.exit(s, cs.fence, "shutdown", "gave up", null, "hs"),
			"ok",
		);
		const kExit = (yield* dataOf(l, k, "exited")).at(-1);
		list.push({
			what: "the child after",
			got: `${kExit?.reason} by ${kExit?.by === s ? "sup" : kExit?.by}`,
			want: "shutdown by sup",
		});
		return verdict(law, list);
	});

/** 24. A message that crashed the program `MAX_DELIVERIES` (3) times in a row goes to `<name>/dead`. */
export const law24DeadLetters = (l: Service) =>
	Effect.gen(function* () {
		const law = "24. three crashes in a row on one message set it aside; anything between resets";
		const s = fresh("l24-sup");
		const k = `${s}-child`;
		const dead = streams(k).dead;
		const {list, step, count} = steps();
		const [rs] = yield* setUp(l, s);
		const cs = yield* step("claim the supervisor", l.claim(s, "hs", rs?.rev ?? 1, 30_000), "ok");
		if (cs === null) return verdict(law, list);
		yield* l.trapExit(cs.fence, true);
		yield* l.startChild(cs.fence, k, null);
		/** One run of the child: claim, exit, and its parent restarts it. */
		const run = (reason: L.ExitReason, suspect: number | null) =>
			Effect.gen(function* () {
				const rev = (yield* l.readLast(k, 1))[0]?.rev ?? 0;
				const c = yield* l.claim(k, "hk", rev, 30_000);
				yield* l.exit(k, c.fence, reason, "boom", suspect, "hk");
				yield* l.startChild(cs.fence, k, c.incarnation);
			});
		const deadRevs = Effect.map(dataOf(l, dead, "dead_letter"), (ds) =>
			ds.map((x) => x.rev).join(","),
		);
		yield* run("crash", 5);
		yield* run("crash", 5);
		list.push({what: "after 2 crashes on rev 5", got: yield* deadRevs, want: ""});
		yield* run("crash", 5);
		list.push({what: "after 3 crashes on rev 5", got: yield* deadRevs, want: "5"});
		yield* run("crash", 7);
		yield* run("crash", 8);
		yield* run("crash", 7);
		yield* run("crash", 8);
		list.push({what: "7 and 8 in turn, twice", got: yield* deadRevs, want: "5"});
		yield* run("crash", 9);
		yield* run("crash", 9);
		yield* run("normal", null);
		yield* run("crash", 9);
		yield* run("crash", 9);
		list.push({what: "9, 9, a normal exit, 9, 9", got: yield* deadRevs, want: "5"});
		yield* run("crash", 9);
		list.push({what: "9 a third time in a row", got: yield* deadRevs, want: "5,9"});
		yield* run("crash", null);
		yield* run("crash", null);
		yield* run("crash", null);
		list.push({what: "3 crashes naming nothing", got: yield* deadRevs, want: "5,9"});
		count("dead rows", (yield* l.readStream(dead)).length, 2);
		return verdict(law, list);
	});

// ---------------------------------------------------------------- new in 100: a parent's exit signal

/**
 * 25. OTP's `exit(Child, shutdown | kill)`, the call behind a supervisor's `shutdown` option. Only
 * the parent sends it, to one run of the child. A `shutdown` to a child that traps exits is one EXIT
 * in its inbox; any other `shutdown` takes it down; a `kill` always takes it down, reason `killed`.
 * A run that has ended already, or an older run than the live one, is `noproc`: nothing is written.
 */
export const law25ExitChild = (l: Service) =>
	Effect.gen(function* () {
		const law = "25. exit_child: the parent alone, one run, shutdown trappable, kill not";
		const s = fresh("l25-sup");
		const o = fresh("l25-other");
		const [a, b] = [`${s}-a`, `${s}-b`];
		const {list, step, count} = steps();
		const [rs, ro] = yield* setUp(l, s, o);
		const cs = yield* step("claim the supervisor", l.claim(s, "hs", rs?.rev ?? 1, 30_000), "ok");
		const co = yield* step("claim another name", l.claim(o, "ho", ro?.rev ?? 1, 30_000), "ok");
		if (cs === null || co === null) return verdict(law, list);
		yield* l.trapExit(cs.fence, true);
		yield* l.startChild(cs.fence, a, null);
		yield* l.startChild(cs.fence, b, null);
		const ca = yield* step("claim a", l.claim(a, "ha", 1, 30_000), "ok");
		const cb = yield* step("claim b", l.claim(b, "hb", 1, 30_000), "ok");
		if (ca === null || cb === null) return verdict(law, list);
		yield* step("b traps exits", l.trapExit(cb.fence, true), "ok");
		/** One exit signal: its answer word against the one wanted. */
		const signal = (
			what: string,
			e: Effect.Effect<string, {readonly _tag: string}>,
			want: string,
		) =>
			Effect.map(say(e), (x) => {
				list.push({what, got: x.word === "ok" ? String(x.value) : x.word, want});
			});
		const upOrDown = (n: string) =>
			Effect.map(l.processInfo(n), (pi) => (pi === null ? "none" : pi.down > 0 ? "down" : "up"));
		yield* signal(
			"another name shuts a down",
			l.exitChild(co.fence, a, 1, "shutdown", "x"),
			"denied",
		);
		yield* signal(
			"shutdown to a, no trap",
			l.exitChild(cs.fence, a, 1, "shutdown", "stop"),
			"exited",
		);
		const aExit = (yield* dataOf(l, a, "exited")).at(-1);
		list.push({
			what: "a ended",
			got: `${aExit?.reason} by ${aExit?.by === s ? "sup" : aExit?.by}`,
			want: "shutdown by sup",
		});
		yield* signal("shutdown to a again", l.exitChild(cs.fence, a, 1, "shutdown", "stop"), "noproc");
		yield* signal(
			"shutdown to b, traps",
			l.exitChild(cs.fence, b, 1, "shutdown", "stop"),
			"signalled",
		);
		yield* signal("the same, resent", l.exitChild(cs.fence, b, 1, "shutdown", "stop"), "signalled");
		const bInbox = yield* dataOf(l, streams(b).inbox, "EXIT");
		count("EXITs in b's inbox", bInbox.length, 1);
		count(
			"of them shutdown, to run 1",
			bInbox.filter((x) => x.reason === "shutdown" && x.to === 1).length,
			1,
		);
		list.push({what: "b after the shutdown", got: yield* upOrDown(b), want: "up"});
		yield* signal("kill b, traps", l.exitChild(cs.fence, b, 1, "kill", "too slow"), "exited");
		const bExit = (yield* dataOf(l, b, "exited")).at(-1);
		list.push({what: "b ended", got: String(bExit?.reason), want: "killed"});
		yield* signal("kill b again", l.exitChild(cs.fence, b, 1, "kill", "x"), "noproc");
		yield* step("restart a", l.startChild(cs.fence, a, 1), "ok");
		yield* signal("kill a's old run 1", l.exitChild(cs.fence, a, 1, "kill", "late"), "noproc");
		list.push({what: "a's run 2 after it", got: yield* upOrDown(a), want: "up"});
		const sExits = yield* dataOf(l, streams(s).inbox, "EXIT");
		count("EXITs to the supervisor, one per real end", sExits.length, 2);
		yield* signal(
			"a fence that is not live",
			l.exitChild(cs.fence + 1000, a, 2, "kill", "x"),
			"fenced",
		);
		return verdict(law, list);
	});

// ---------------------------------------------------------------- new in 102: limits

const dollars = (l: Service, name: string) =>
	Effect.map(l.usage(name), (u) => (u === null ? "none" : String(u.used.usd)));
const endOf = (l: Service, name: string) =>
	Effect.map(dataOf(l, name, "exited"), (xs) => String(xs.at(-1)?.reason ?? "up"));
const limitRecords = (l: Service, name: string) =>
	Effect.map(dataOf(l, streams(name).dead, "limit"), (xs) => xs.length);

/**
 * 26. Spend counts on the name and every name up the tree (cgroup v2), once per charge id, and a
 * restart keeps it. Past its own limit, the child's run ends `limit:usd`; its parent lives.
 */
export const law26Spend = (l: Service) =>
	Effect.gen(function* () {
		const law = "26. spend counts up the tree, once per id, and a restart keeps it";
		const p = fresh("l26-ticket");
		const c = `${p}-builder`;
		const {list, step} = steps();
		yield* setUp(l, p);
		yield* step("ticket limits $10", l.setLimits(p, {usd: 10}, "desk"), "ok");
		const rev0 = (yield* l.readLast(p, 1))[0]?.rev ?? 0;
		const cp = yield* step("claim the ticket", l.claim(p, "hp", rev0, 30_000), "ok");
		if (cp === null) return verdict(law, list);
		yield* l.trapExit(cp.fence, true);
		yield* step("start the builder, $5", l.startChild(cp.fence, c, null, {usd: 5}), "ok");
		const c1 = yield* step("claim the builder", l.claim(c, "hc", 1, 30_000), "ok");
		if (c1 === null) return verdict(law, list);
		yield* step("charge $3, id a", l.charge(c1.fence, "a", {usd: 3}), "ok");
		yield* step("charge id a again", l.charge(c1.fence, "a", {usd: 3}), "dup");
		list.push({what: "builder used", got: yield* dollars(l, c), want: "3"});
		list.push({what: "ticket used", got: yield* dollars(l, p), want: "3"});
		yield* step("the builder crashes", l.exit(c, c1.fence, "crash", "boom", null, "hc"), "ok");
		yield* step("restart it", l.startChild(cp.fence, c, 1), "ok");
		list.push({what: "builder used after the restart", got: yield* dollars(l, c), want: "3"});
		const rev = (yield* l.readLast(c, 1))[0]?.rev ?? 0;
		const c2 = yield* step("claim run 2", l.claim(c, "hc", rev, 30_000), "ok");
		if (c2 === null) return verdict(law, list);
		const ch = yield* step("charge $3, id b", l.charge(c2.fence, "b", {usd: 3}), "ok");
		const at = ch?.over?.at === c ? "builder" : ch?.over?.at;
		list.push({what: "it crossed", got: `${ch?.over?.kind} at ${at}`, want: "usd at builder"});
		list.push({what: "the builder", got: yield* endOf(l, c), want: "limit:usd"});
		list.push({what: "ticket used", got: yield* dollars(l, p), want: "6"});
		list.push({what: "the ticket", got: yield* endOf(l, p), want: "up"});
		const exits = yield* dataOf(l, streams(p).inbox, "EXIT");
		list.push({
			what: "the ticket's last EXIT",
			got: String(exits.at(-1)?.reason),
			want: "limit:usd",
		});
		yield* step("a negative charge", l.charge(c2.fence, "c", {usd: -1}), "denied");
		yield* step("bad limits", l.setLimits(p, {usd: -1}, "desk"), "denied");
		return verdict(law, list);
	});

/**
 * 27. Admission: a hold that does not fit under a limit up the tree is refused, and that limit's
 * run ends: `limit:usd` on it, `killed` on what its end takes with it, one record in its `/dead`.
 * Its parent cannot start it again until the desk changes its limits.
 */
export const law27Admission = (l: Service) =>
	Effect.gen(function* () {
		const law = "27. a hold over a limit up the tree is refused and ends that run, once, for good";
		const top = fresh("l27-top");
		const k = `${top}-ticket`;
		const b = `${top}-builder`;
		const {list, step, count} = steps();
		const [rt] = yield* setUp(l, top);
		const ct = yield* step("claim the top", l.claim(top, "ht", rt?.rev ?? 1, 30_000), "ok");
		if (ct === null) return verdict(law, list);
		yield* l.trapExit(ct.fence, true);
		yield* step("start the ticket, $1", l.startChild(ct.fence, k, null, {usd: 1}), "ok");
		const ck = yield* step("claim the ticket", l.claim(k, "hk", 1, 30_000), "ok");
		if (ck === null) return verdict(law, list);
		yield* step("start the builder", l.startChild(ck.fence, b, null), "ok");
		const cb = yield* step("claim the builder", l.claim(b, "hb", 1, 30_000), "ok");
		if (cb === null) return verdict(law, list);
		yield* step("hold $0.6, t1", l.hold(cb.fence, "t1", {usd: 0.6}), "ok");
		yield* step("hold t1 again", l.hold(cb.fence, "t1", {usd: 0.6}), "dup");
		yield* step("hold $0.6, t2", l.hold(cb.fence, "t2", {usd: 0.6}), "limit");
		list.push({what: "ticket used", got: yield* dollars(l, k), want: "0.6"});
		list.push({what: "the ticket", got: yield* endOf(l, k), want: "limit:usd"});
		list.push({what: "the builder", got: yield* endOf(l, b), want: "killed"});
		const exits = yield* dataOf(l, streams(top).inbox, "EXIT");
		list.push({what: "the top's EXIT", got: String(exits.at(-1)?.reason), want: "limit:usd"});
		count("limit records, ticket", yield* limitRecords(l, k), 1);
		count("limit records, builder", yield* limitRecords(l, b), 0);
		yield* step("hold, the builder's old fence", l.hold(cb.fence, "t3", {usd: 0}), "fenced");
		yield* step("restart the ticket", l.startChild(ct.fence, k, 1), "limit");
		yield* step("the desk raises it to $2", l.setLimits(k, {usd: 2}, "desk"), "ok");
		yield* step("restart the ticket now", l.startChild(ct.fence, k, 1), "ok");
		return verdict(law, list);
	});

/**
 * 28. A charge from a host that lost its lease still counts (the money is spent), takes the place
 * of that host's own hold only, and can end the run of the host that took over.
 */
export const law28LateCharge = (l: Service) =>
	Effect.gen(function* () {
		const law = "28. a late charge from a lost lease counts, once, and only replaces its own hold";
		const n = fresh("l28");
		const time = yield* timeOf(l);
		const {list, step, inTime} = timedSteps(time);
		yield* setUp(l, n);
		yield* step("limits $1", l.setLimits(n, {usd: 1}, "desk"), "ok");
		const rev = (yield* l.readLast(n, 1))[0]?.rev ?? 0;
		const c1 = yield* step("claim, a short ttl", l.claim(n, "h1", rev, LIVE_MS), "ok");
		if (c1 === null) return verdict(law, list);
		yield* step("hold $0.5, t1", l.hold(c1.fence, "t1", {usd: 0.5}), "ok");
		yield* inTime("the hold, which needs the lease live", c1.expiresAt);
		list.push({
			what: "lease_expired",
			got: String((yield* expired(l, time, n, c1.expiresAt)) !== null),
			want: "true",
		});
		const c2 = yield* step(
			"take over",
			l.claim(n, "h2", (yield* l.readLast(n, 1))[0]?.rev ?? 0, 30_000),
			"ok",
		);
		if (c2 === null) return verdict(law, list);
		yield* step("the new host charges t1 for $0", l.charge(c2.fence, "t1", {usd: 0}), "ok");
		list.push({what: "used: the old hold stays", got: yield* dollars(l, n), want: "0.5"});
		yield* step("hold, the old fence", l.hold(c1.fence, "t9", {usd: 0}), "fenced");
		yield* step("the old host charges t1, $0.7", l.charge(c1.fence, "t1", {usd: 0.7}), "ok");
		yield* step("the same, resent", l.charge(c1.fence, "t1", {usd: 0.7}), "dup");
		list.push({what: "used", got: yield* dollars(l, n), want: "0.7"});
		yield* step("a fence that was never a claim", l.charge(-1, "x", {}), "fenced");
		const ch = yield* step("the new host charges $0.4", l.charge(c2.fence, "t2", {usd: 0.4}), "ok");
		list.push({what: "crossed", got: String(ch?.over?.kind), want: "usd"});
		list.push({what: "the name", got: yield* endOf(l, n), want: "limit:usd"});
		return verdict(law, list);
	});

/** 29. Children at once count at every depth (cgroup's `pids.max`); one too many is refused, typed. */
export const law29Children = (l: Service) =>
	Effect.gen(function* () {
		const law = "29. children count at every depth; one too many is a refusal, not an exit";
		const s = fresh("l29");
		const [a, a1, a2, b] = [`${s}-a`, `${s}-a1`, `${s}-a2`, `${s}-b`];
		const {list, step, count} = steps();
		yield* setUp(l, s);
		yield* step("limits: 2 children", l.setLimits(s, {children: 2}, "desk"), "ok");
		const rev = (yield* l.readLast(s, 1))[0]?.rev ?? 0;
		const cs = yield* step("claim", l.claim(s, "hs", rev, 30_000), "ok");
		if (cs === null) return verdict(law, list);
		yield* l.trapExit(cs.fence, true);
		yield* step("start a", l.startChild(cs.fence, a, null), "ok");
		const ca = yield* step("claim a", l.claim(a, "ha", 1, 30_000), "ok");
		if (ca === null) return verdict(law, list);
		yield* l.trapExit(ca.fence, true);
		yield* step("a starts a1", l.startChild(ca.fence, a1, null), "ok");
		count("running under the top", (yield* l.usage(s))?.children ?? -1, 2);
		yield* step("start b", l.startChild(cs.fence, b, null), "limit");
		yield* step("a starts a2", l.startChild(ca.fence, a2, null), "limit");
		list.push({what: "the top after", got: yield* endOf(l, s), want: "up"});
		const c1 = yield* step("claim a1", l.claim(a1, "h1", 1, 30_000), "ok");
		if (c1 === null) return verdict(law, list);
		yield* step("a1 ends", l.exit(a1, c1.fence, "normal", "done", null, "h1"), "ok");
		yield* step("start b now", l.startChild(cs.fence, b, null), "ok");
		return verdict(law, list);
	});

/**
 * 30. Wall time runs from registration and a restart does not reset it (a Job's deadline). Past
 * it, the alarm ends the run `limit:wall`, and a hold ends it if the alarm has not yet.
 */
export const law30Wall = (l: Service) =>
	Effect.gen(function* () {
		const law = "30. wall time runs from registration, across restarts";
		const s = fresh("l30");
		const [c, d] = [`${s}-c`, `${s}-d`];
		// Two windows of steps in c's wall time: its first run's, then, from the middle, its restart's.
		const wall = 2 * LIVE_MS;
		const time = yield* timeOf(l);
		const {list, step, inTime} = timedSteps(time);
		const [rs] = yield* setUp(l, s);
		const cs = yield* step("claim", l.claim(s, "hs", rs?.rev ?? 1, 30_000), "ok");
		if (cs === null) return verdict(law, list);
		yield* l.trapExit(cs.fence, true);
		// Before c starts: these need none of its wall time.
		yield* step("start d, 300 ms", l.startChild(cs.fence, d, null, {wallMs: 300}), "ok");
		yield* step("bad limits", l.startChild(cs.fence, `${s}-e`, null, {wallMs: 0}), "denied");
		yield* step(`start c, ${wall} ms`, l.startChild(cs.fence, c, null, {wallMs: wall}), "ok");
		// The ledger starts c's wall time when it runs the start, which on a busy machine is well
		// after this law asked. Count from the deadline it wrote, never from here.
		const due = (yield* l.usage(c))?.deadline ?? null;
		if (due === null) return failed(law, "c has no deadline after its start");
		const c1 = yield* step("claim c", l.claim(c, "hc", 1, 30_000), "ok");
		if (c1 === null) return verdict(law, list);
		yield* step("c crashes", l.exit(c, c1.fence, "crash", "boom", null, "hc"), "ok");
		// Restarted once half its wall time is gone: a deadline counted from the restart would end
		// half a wall time after `due`, where the hold below finds it.
		yield* time.past(due - wall / 2);
		yield* step("restart c", l.startChild(cs.fence, c, 1), "ok");
		const rev = (yield* l.readLast(c, 1))[0]?.rev ?? 0;
		const c2 = yield* step("claim c, run 2", l.claim(c, "hc", rev, 30_000), "ok");
		yield* inTime("c's steps, inside its wall time", due);
		if (c2 === null) return verdict(law, list);
		const moved = ((yield* l.usage(c))?.deadline ?? Number.NaN) - due;
		list.push({what: "ms the restart moved c's deadline", got: String(moved), want: "0"});
		yield* time.past(due);
		// Past its wall time the hold is refused: `limit` if it comes before the alarm, `fenced` after.
		const h = yield* say(l.hold(c2.fence, "t", {usd: 0}));
		list.push({
			what: `c holds past ${wall} ms`,
			got: h.word === "ok" ? "ok" : "refused",
			want: "refused",
		});
		list.push({what: "c", got: yield* endOf(l, c), want: "limit:wall"});
		// Only the alarm ends d: wait for its word, as on a test's clock it may still be on its way.
		yield* factOf(l, time, d, "exited");
		list.push({what: "d, never touched", got: yield* endOf(l, d), want: "limit:wall"});
		return verdict(law, list);
	});

// ---------------------------------------------------------------- the suite

export interface SuiteOptions {
	/** Run law 4 (needs the alarm, about 6 s). */
	readonly alarm?: boolean;
	/** The ledger's expiry grace: how long after a lease's end its alarm writes lease_expired. */
	readonly graceMs?: number;
}

const guard = (law: string, e: Effect.Effect<LawResult | readonly LawResult[], unknown>) =>
	e.pipe(
		Effect.map((r): readonly LawResult[] => ("law" in r ? [r] : r)),
		Effect.catchCause((c) => Effect.succeed([failed(law, `stopped: ${String(c).slice(0, 300)}`)])),
	);

/**
 * Every law, each on its own names. A law that dies is a failed law, not a crash.
 *
 * On the ledger's own clock, all at once. On a test's clock (a `TestClock` under both the suite
 * and the ledger), the laws that move the clock run one at a time after the rest, as one law's
 * jump past its lease's end would end another law's lease too early.
 */
export const runLaws = (o: SuiteOptions = {}) =>
	Effect.gen(function* () {
		const l = yield* Ledger;
		const grace = o.graceMs ?? 1000;
		const still = [
			guard("1", law1Claims(l)),
			guard("2", law2Appends(l)),
			guard("5", law5Stop(l)),
			guard("11a", law11AppendAny(l)),
			guard("11b", law11RepeatedId(l)),
			guard("14", law14Reads(l)),
			guard("19", law19Unknown(l)),
			guard("20", law20Register(l)),
			guard("22", law22Links(l)),
			guard("23", law23Start(l)),
			guard("24", law24DeadLetters(l)),
			guard("25", law25ExitChild(l)),
			guard("26", law26Spend(l)),
			guard("27", law27Admission(l)),
			guard("29", law29Children(l)),
			guard("T", lawTail(l)),
		];
		const moving = [
			guard("3", law3Fencing(l, grace)),
			...(o.alarm ? [guard("4", law4Expiry(l, grace))] : []),
			guard("12", law12PrefixFence(l, grace)),
			guard("16", law16Guard(l, grace)),
			guard("17", law17Inbox(l)),
			guard("18", law18Reply(l, grace)),
			guard("21", law21Monitors(l)),
			guard("28", law28LateCharge(l)),
			guard("30", law30Wall(l)),
		];
		const owned = Clock.clockWith((c) => Effect.succeed(isTestClock(c)));
		const out = (yield* owned)
			? [
					...(yield* Effect.all(still, {concurrency: "unbounded"})),
					...(yield* Effect.all(moving, {concurrency: 1})),
				]
			: yield* Effect.all([...still, ...moving], {concurrency: "unbounded"});
		return out.flat();
	});

// ---------------------------------------------------------------- planted mistakes

export {PLANTED, type Planted} from "./rules.ts";

/**
 * The ledger's SQL under one planted mistake (`rules.ts`'s PLANTED), on one node:sqlite connection
 * in this thread, with its alarm. Only for seeing a law fail on it; nothing else runs it.
 */
export const layerPlanted = (path: string, planted: L.Planted, graceMs = 1000) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const clock = yield* Clock.Clock;
			const {db} = yield* Effect.acquireRelease(
				Effect.sync(() => openDb(path)),
				(d) => Effect.sync(() => d.close()),
			);
			const rules = L.PLANTED[planted];
			const bell = yield* PubSub.unbounded<string>();
			const call = (method: string, args: readonly unknown[]) =>
				(isMethod(method)
					? Effect.try({
							try: () =>
								dispatch(db, rules, graceMs, clock.currentTimeMillisUnsafe(), method, args),
							catch: (e) => new LedgerUnreachable({method, message: String(e)}),
						})
					: Effect.fail(new LedgerUnreachable({method, message: "no such method"}))
				).pipe(
					Effect.tap((answer) => {
						const w =
							typeof answer === "object" && answer !== null && "written" in answer
								? answer.written
								: [];
						const more = Array.isArray(w)
							? w.flatMap((x) =>
									typeof x === "object" && x && "stream" in x ? [String(x.stream)] : [],
								)
							: [];
						return PubSub.publishAll(bell, [
							...(typeof args[0] === "string" ? [args[0]] : []),
							...more,
						]);
					}),
				);
			yield* call("runDue", []).pipe(
				Effect.ignore,
				Effect.andThen(sleep(25)),
				Effect.forever,
				Effect.forkScoped,
			);
			const watch: Raw["watch"] = (stream) =>
				Stream.fromPubSub(bell).pipe(
					Stream.filter((s) => s === stream),
					Stream.map(() => undefined),
				);
			return fromRaw(rawOf(call, watch));
		}),
	);
