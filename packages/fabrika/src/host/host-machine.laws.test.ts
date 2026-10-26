import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {applyCell, subIdOf} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {afterAll, describe, expect, it} from "vitest";
import type {Host, HostCmd, HostMsg, ProgramEnd} from "./host-machine.ts";
import * as realHost from "./host-machine.ts";

// The host's laws for lane 18, part 2: no word from the ledger is not a lost lease. The program
// stops only at its lease's end plus a 10 minute grace; while away it renews every second; a renew
// that comes back ends being away. On `createHost`, the machine every host runs for a name.
//
// Two kinds of law. The pure ones walk random Msg orders through the real reducer, on tea's pbt.
// The timed ones run the machine against a ledger the test plays, on a clock the test owns: every
// timer the machine's Subs ask for fires at its time, the network drops and comes back, another
// host claims the name past its lease's end. That ledger keeps rule B (a fence is good until a
// newer claim exists), so these laws judge the host alone. Nothing sleeps.
//
// Nobody writes their own exam: this file writes the laws and never the machine. Each planted
// mistake is a text edit on a COPY of host-machine.ts in a temp folder, and the exact laws it
// breaks are checked below. Today's machine breaks three of these laws: they are kept as known
// bugs, which pass while the law fails for the rule's reason and turn red the day the fix lands.
//
// The settings the fix needs are passed as experiment 149 named them (`graceMs`, `retryRenewMs`).
// Today's machine has neither and reads neither.

// ---------------------------------------------------------------- the module under test

type Mod = {
	readonly createHost: typeof realHost.createHost;
	readonly programOf: typeof realHost.programOf;
};
const real: Mod = {createHost: realHost.createHost, programOf: realHost.programOf};

const madeDirs: string[] = [];
afterAll(() => {
	for (const d of madeDirs) rmSync(d, {recursive: true, force: true});
});

/** A copy of host-machine.ts with one mistake, imported from its own folder. Each edit matches once. */
async function plant(...edits: readonly (readonly [string, string])[]): Promise<Mod> {
	const dir = mkdtempSync(join(import.meta.dirname, ".host-laws-plant-"));
	madeDirs.push(dir);
	let text = readFileSync(join(import.meta.dirname, "host-machine.ts"), "utf8");
	for (const [a, b] of edits) {
		const count = text.split(a).length - 1;
		if (count !== 1) throw new Error(`plant edit: "${a}" found ${count} times, want 1`);
		text = text.replace(a, () => b);
	}
	writeFileSync(join(dir, "host-machine.ts"), text);
	const mod = (await import(
		/* @vite-ignore */ pathToFileURL(join(dir, "host-machine.ts")).href
	)) as typeof realHost;
	return {createHost: mod.createHost, programOf: mod.programOf};
}

/** The rule's grace past the lease's end, before the program stops with no word. */
const GRACE = 600_000;
/** While away, the next renew comes this soon. */
const AWAY_EVERY = 1000;

/** The settings, with the two the fix adds as experiment 149 named them. */
const settingsOf = (renewEveryMs: number) => {
	const settings = {renewEveryMs, retryMs: 50, graceMs: GRACE, retryRenewMs: AWAY_EVERY};
	return settings;
};
const machineOf = (mod: Mod, renewEveryMs: number) => mod.createHost(settingsOf(renewEveryMs));
type Machine = ReturnType<Mod["createHost"]>;

// ---------------------------------------------------------------- the pure laws

const FENCES = [1, 2, 3] as const;
const arbFence = fc.constantFrom(...FENCES);
const arbUntil = fc.constantFrom(500, 1000, 2000);
const ENDS: readonly ProgramEnd[] = [
	{how: "ended"},
	{how: "crashed", why: "boom", suspect: 9},
	{how: "lost"},
	{how: "stopped"},
];

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<HostMsg> = {
	claim_due: arbRecordMsg("claim_due", {tries: fc.nat(2)}),
	seen_expiry: arbRecordMsg("seen_expiry", {fence: arbFence}),
	seen_claim: arbRecordMsg("seen_claim", {fence: arbFence}),
	seen_exit: arbRecordMsg("seen_exit", {pos: fc.constantFrom(2, 5)}),
	seen_restart: arbRecordMsg("seen_restart", {pos: fc.constantFrom(4, 7)}),
	claimed: arbRecordMsg("claimed", {
		fence: arbFence,
		until: arbUntil,
		incarnation: fc.constantFrom(1, 2),
	}),
	held: arbRecordMsg("held", {waitMs: fc.constantFrom(0, 400)}),
	is_down: arbRecordMsg("is_down", {pos: fc.constant(5)}),
	claim_failed: arbConstantMsg("claim_failed"),
	program_started: arbRecordMsg("program_started", {fence: arbFence}),
	program_ended: fc
		.tuple(arbFence, fc.constantFrom(...ENDS))
		.map(([fence, end]) => ({type: "program_ended" as const, fence, ...end})),
	renew_due: arbRecordMsg("renew_due", {fence: arbFence, tick: fc.nat(3)}),
	renewed: arbRecordMsg("renewed", {fence: arbFence, until: arbUntil}),
	renew_lost: arbRecordMsg("renew_lost", {fence: arbFence}),
	renew_unknown: arbRecordMsg("renew_unknown", {fence: arbFence}),
	lease_due: arbRecordMsg("lease_due", {fence: arbFence, until: arbUntil}),
	exited: arbRecordMsg("exited", {fence: arbFence, pos: fc.constant(5)}),
	exit_refused: arbRecordMsg("exit_refused", {fence: arbFence}),
};
/** Every walk starts by winning the name under fence 1, so most steps are an owner's. */
const walks = arbMsgSequence(
	arbMsg(table, {
		weights: {renew_unknown: 4, renew_lost: 3, seen_claim: 3, seen_expiry: 3, renew_due: 2},
	}),
	{
		prefix: [
			{type: "claim_due", tries: 0},
			{type: "claimed", fence: 1, until: 1000, incarnation: 1},
		],
		maxLength: 20,
	},
);
const ctx = stubCtxThrowingProxy<undefined>();
const holds = (s: Host) => s.phase === "owning" || s.phase === "exiting";

interface Law {
	readonly name: string;
	/** Throws when the machine breaks the law, with fast-check's smallest case. */
	readonly check: (mod: Mod) => void;
}

/** A law on every step of every walk: `why` says what went wrong, or null. */
const stepLaw = (
	name: string,
	why: (mod: Mod, step: Step<Host, HostMsg, HostCmd>) => string | null,
): Law => ({
	name,
	check: (mod) =>
		propertyInvariant(
			machineOf(mod, 300),
			ctx,
			walks,
			(step) => {
				const w = why(mod, step);
				if (w !== null) throw new Error(w);
				return true;
			},
			{numRuns: 300, seed: 7},
		),
});

/** P1. A renew with no answer is not a lost lease: the owner keeps the name and its program. */
const unknownKeeps = stepLaw(
	"a renew with no answer never ends owning: no word is not a lost lease",
	(_, {prev, msg, next}) =>
		holds(prev) && msg.type === "renew_unknown" && next.phase !== prev.phase
			? `renew_unknown ${msg.fence} took it from ${prev.phase} to ${next.phase}`
			: null,
);

/** P2. A renew the ledger answers `lost`, or a newer claim in the tail, stops the program at once. */
const lostStops = stepLaw(
	"a lost renew or a newer claim stops the program at once",
	(mod, {prev, msg, next}) => {
		if (prev.phase !== "owning") return null;
		const lost =
			(msg.type === "renew_lost" && msg.fence === prev.fence) ||
			(msg.type === "seen_claim" && msg.fence > prev.fence);
		return lost && mod.programOf(next) !== null
			? `after ${msg.type} ${msg.fence} the program still runs under fence ${prev.fence}`
			: null;
	},
);

/**
 * P3. Rule B: the expiry job's `lease_expired` for its own fence is not a lost lease while nobody
 * claimed, as the fence still writes. Only a newer claim or a `lost` ends it. (This law is this
 * file's reading of the rule: the rule names no host Msg.)
 */
const expiryKeeps = stepLaw(
	"its own fence's lease_expired, with no newer claim, does not stop the program",
	(mod, {prev, msg, next}) =>
		prev.phase === "owning" &&
		msg.type === "seen_expiry" &&
		msg.fence === prev.fence &&
		mod.programOf(next) === null
			? `seen_expiry ${msg.fence} stopped the program under fence ${prev.fence}, and nobody claimed`
			: null,
);

// ---------------------------------------------------------------- a timed run

/** One host's world: its pace, when its network drops, and whether another host takes over. */
interface World {
	/** The host's renew pace and its lease's ttl, as one of today's callers sets them. */
	readonly every: number;
	readonly ttl: number;
	/** Windows when this host cannot reach the ledger. The ledger and the other hosts stay up. */
	readonly drops: readonly {readonly from: number; readonly len: number}[];
	/** How long a call takes to fail while the network is down. */
	readonly lag: number;
	/** A renew sent in a drop reaches the ledger, and only its answer is lost. */
	readonly lands: boolean;
	/** Another host claims this long after the ledger's lease end, if no renew landed by then; null: none. */
	readonly takeover: number | null;
}

interface Trace {
	readonly world: World;
	readonly horizon: number;
	/** When the host won the name, or null: it never did. */
	readonly claimedAt: number | null;
	/** Every renew it sent while it owned the name, with what it had heard last. */
	readonly sends: readonly {readonly at: number; readonly away: boolean}[];
	/** Every renew answer it got while it owned the name. */
	readonly answers: readonly {readonly at: number; readonly type: HostMsg["type"]}[];
	/** The first time the program stopped: the Msg that did it, and the lease end the host counted. */
	readonly stop: {
		readonly at: number;
		readonly why: HostMsg["type"];
		readonly until: number;
	} | null;
	/** The first time it ran past the lease's end plus the grace, or null: never. */
	readonly past: {readonly at: number; readonly until: number} | null;
}

const PACES = [
	{every: 250, ttl: 1000}, // the host's defaults (host.ts)
	{every: 2500, ttl: 10_000}, // deliver's (pipeline/hosted/deliver-program.ts)
	{every: 900_000, ttl: 3_600_000}, // the lane's (pipeline/hosted/lane-ends.ts)
] as const;

const arbWorld: fc.Arbitrary<World> = fc.constantFrom(...PACES).chain(({every, ttl}) =>
	fc.record({
		every: fc.constant(every),
		ttl: fc.constant(ttl),
		drops: fc.array(
			fc.record({
				from: fc.integer({min: 1, max: 3 * ttl}),
				len: fc.oneof(
					fc.constantFrom(every, ttl / 2, ttl, ttl + GRACE / 2, ttl + GRACE + 2 * every),
					fc.integer({min: 1, max: 2 * (ttl + GRACE)}),
				),
			}),
			{maxLength: 2},
		),
		lag: fc.constantFrom(0, 100, 1000, 3000),
		lands: fc.boolean(),
		takeover: fc.option(fc.constantFrom(0, 1, 1000, 1001, ttl, GRACE), {nil: null}),
	}),
);

/** Something due at `at`: a message to the host, a Sub firing, or the ledger's own alarm or takeover. */
type Pending =
	| {readonly at: number; readonly kind: "msg"; readonly msg: HostMsg}
	| {
			readonly at: number;
			readonly kind: "sub";
			readonly msg: HostMsg;
			readonly sub: string;
			readonly start: number;
	  }
	| {readonly at: number; readonly kind: "takeover"; readonly ver: number}
	| {readonly at: number; readonly kind: "alarm"; readonly ver: number};
/** `n` orders events due at the same time: first pushed, first run. */
type Event = Pending & {readonly n: number};

/** Run `machine` in `world` until its program first stops, or the world's end. */
function runIn(machine: Machine, world: World): Trace {
	const {every, ttl, drops, lag, lands, takeover} = world;
	const horizon =
		Math.max(0, ...drops.map((d) => d.from + d.len)) + ttl + GRACE + 2 * every + lag + 1;
	const down = (t: number) => drops.some((d) => d.from <= t && t < d.from + d.len);
	/** When a tail event written at `t` reaches the host: once its network is back. */
	const reach = (t: number) => {
		let at = t;
		for (let d = drops.find((x) => x.from <= at && at < x.from + x.len); d !== undefined; ) {
			at = d.from + d.len;
			d = drops.find((x) => x.from <= at && at < x.from + x.len);
		}
		return at;
	};

	let n = 0;
	const queue: Event[] = [];
	const push = (e: Pending) => queue.push({...e, n: n++});
	const pop = (): Event | undefined => {
		let best = 0;
		for (let i = 1; i < queue.length; i++) {
			const a = queue[i];
			const b = queue[best];
			if (a !== undefined && b !== undefined && (a.at < b.at || (a.at === b.at && a.n < b.n)))
				best = i;
		}
		return queue.splice(best, 1)[0];
	};

	// The ledger, as rule B has it: the host's renews work until another host claims.
	let ledgerEnd = 0;
	let ver = 0;
	let taken = false;
	const moveEnd = (to: number) => {
		ledgerEnd = to;
		ver++;
		push({at: ledgerEnd + 1000, kind: "alarm", ver});
		if (takeover !== null) push({at: ledgerEnd + takeover, kind: "takeover", ver});
	};

	// The machine's Subs, as tea runs them: started when their deps turn on or change.
	const running = new Map<string, number>();
	let starts = 0;
	let programOn = false;
	const syncSubs = (s: Host, now: number) => {
		const want = new Map<string, {readonly type: string; readonly deps: unknown}>();
		for (const entry of machine.subs ?? []) {
			const deps: unknown = (entry.deps as (s: Host) => unknown)(s);
			if (deps !== null) want.set(subIdOf(entry.type, deps), {type: entry.type, deps});
		}
		for (const id of running.keys()) if (!want.has(id)) running.delete(id);
		programOn = [...want.values()].some((w) => w.type === "program");
		for (const [id, w] of want) {
			if (running.has(id)) continue;
			const start = starts++;
			running.set(id, start);
			if (w.type === "timer") {
				const d = w.deps as {readonly ms: number; readonly msg: HostMsg};
				push({at: now + d.ms, kind: "sub", msg: d.msg, sub: id, start});
			} else if (w.type === "lease_clock") {
				const d = w.deps as {readonly fence: number; readonly until: number};
				const msg: HostMsg = {type: "lease_due", fence: d.fence, until: d.until};
				push({at: Math.max(now, d.until), kind: "sub", msg, sub: id, start});
			}
		}
	};

	const sends: {at: number; away: boolean}[] = [];
	const answers: {at: number; type: HostMsg["type"]}[] = [];
	let claimedAt: number | null = null;
	let away = false;
	let stop: Trace["stop"] = null;
	let past: Trace["past"] = null;

	const doCmd = (c: HostCmd, now: number) => {
		if (c.type === "claim") {
			moveEnd(now + ttl);
			push({
				at: now,
				kind: "msg",
				msg: {type: "claimed", fence: 1, until: now + ttl, incarnation: 1},
			});
		} else if (c.type === "renew") {
			sends.push({at: now, away});
			if (down(now)) {
				if (lands && !taken) moveEnd(now + ttl);
				push({at: now + lag, kind: "msg", msg: {type: "renew_unknown", fence: c.fence}});
			} else if (taken) {
				push({at: now, kind: "msg", msg: {type: "renew_lost", fence: c.fence}});
			} else {
				moveEnd(now + ttl);
				push({at: now, kind: "msg", msg: {type: "renewed", fence: c.fence, until: now + ttl}});
			}
		}
	};

	let s: Host = realHost.START;
	syncSubs(s, 0);
	for (let e = pop(); e !== undefined && e.at <= horizon; e = pop()) {
		const now = e.at;
		if (e.kind === "alarm" || e.kind === "takeover") {
			if (e.ver !== ver || taken) continue;
			if (e.kind === "takeover") taken = true;
			const msg: HostMsg =
				e.kind === "takeover" ? {type: "seen_claim", fence: 2} : {type: "seen_expiry", fence: 1};
			push({at: reach(now), kind: "msg", msg});
			continue;
		}
		if (e.kind === "sub" && running.get(e.sub) !== e.start) continue;
		if (programOn && s.phase === "owning" && now > s.until + GRACE && past === null)
			past = {at: now, until: s.until};
		const prev = s;
		const msg = e.msg;
		if (msg.type === "renewed" || msg.type === "renew_lost" || msg.type === "renew_unknown") {
			if (programOn) answers.push({at: now, type: msg.type});
			away = msg.type === "renew_unknown";
		}
		const [next, cmds] = applyCell<Host, HostMsg, HostCmd>(machine, s, msg);
		s = next;
		const was = programOn;
		syncSubs(s, now);
		if (prev.phase !== "owning" && s.phase === "owning") claimedAt = now;
		if (was && !programOn) {
			stop = {at: now, why: msg.type, until: prev.phase === "owning" ? prev.until : -1};
			break;
		}
		for (const c of cmds) doCmd(c, now);
	}
	if (
		stop === null &&
		programOn &&
		s.phase === "owning" &&
		horizon > s.until + GRACE &&
		past === null
	)
		past = {at: horizon, until: s.until};
	return {world, horizon, claimedAt, sends, answers, stop, past};
}

/** A timed law: `why` says what went wrong in a run, or null. */
const timedLaw = (name: string, why: (t: Trace) => string | null): Law => ({
	name,
	check: (mod) =>
		fc.assert(
			fc.property(arbWorld, (world) => {
				const w = why(runIn(machineOf(mod, world.every), world));
				if (w !== null) throw new Error(w);
			}),
			{numRuns: 60, seed: 7},
		),
});

/**
 * T1. No word is not a lost lease: the program stops on a `lost`, a newer claim, or the ledger's
 * own `lease_expired` (P3 judges that one), and on its own clock only at the lease's end plus the
 * grace.
 */
const runsOnThroughGrace = timedLaw(
	"with no word from the ledger, the program runs until its lease's end plus 10 minutes",
	({stop}) => {
		if (stop === null) return null;
		if (stop.why === "renew_lost" || stop.why === "seen_claim" || stop.why === "seen_expiry")
			return null;
		if (stop.why === "lease_due" && stop.at >= stop.until + GRACE) return null;
		return `the program stopped at ${stop.at} on ${stop.why}, ${stop.at - stop.until} ms past its lease's end ${stop.until}: before the 10 minute grace ran out`;
	},
);

/** T2. And never later: past its lease's end plus the grace, the program is stopped. */
const stopsByGrace = timedLaw(
	"the program never runs past its lease's end plus 10 minutes",
	({past}) =>
		past === null
			? null
			: `the program still ran at ${past.at}, ${past.at - past.until - GRACE} ms past its lease's end ${past.until} plus the grace`,
);

/** T3. While away, it renews every second: after a renew with no answer, the next comes within 1 s. */
const awayRenewsEachSecond = timedLaw(
	"while away, it renews every second",
	({answers, sends, stop, horizon}) => {
		for (const a of answers) {
			if (a.type !== "renew_unknown") continue;
			const by = a.at + AWAY_EVERY;
			if (by > horizon || (stop !== null && stop.at <= by)) continue;
			if (!sends.some((x) => x.at >= a.at && x.at <= by)) {
				const next = sends.find((x) => x.at > a.at)?.at;
				return `after no answer at ${a.at}, the next renew came at ${next ?? "never"}${next === undefined ? "" : `, ${next - a.at} ms later`}: wanted within ${AWAY_EVERY} ms`;
			}
		}
		return null;
	},
);

/**
 * T4. A renew that comes back ends being away: when the last renew answered, renews keep their
 * pace, `renewEveryMs` apart (from the claim, for the first).
 */
const backKeepsPace = timedLaw(
	"a renew that comes back ends being away: renews keep their pace",
	({sends, claimedAt, world}) => {
		for (const [i, x] of sends.entries()) {
			if (x.away) continue;
			const before = i === 0 ? claimedAt : (sends[i - 1]?.at ?? null);
			if (before !== null && x.at - before < world.every)
				return `a renew at ${x.at}, ${x.at - before} ms after the one before, with every renew answered: wanted ${world.every} ms apart`;
		}
		return null;
	},
);

const LAWS: readonly Law[] = [unknownKeeps, lostStops, stopsByGrace, backKeepsPace];

/**
 * Laws today's machine breaks: part 2 is not built yet (lane 18). Each must fail for the rule's
 * reason. The day the fix lands this list turns red: then the law moves to `LAWS`.
 */
const BUGS: readonly (readonly [Law, RegExp])[] = [
	[
		runsOnThroughGrace,
		/^the program stopped at \d+ on lease_due, 0 ms past its lease's end \d+: before the 10 minute grace ran out$/,
	],
	[
		awayRenewsEachSecond,
		/^after no answer at \d+, the next renew came at \d+, \d+ ms later: wanted within 1000 ms$/,
	],
	[expiryKeeps, /^seen_expiry 1 stopped the program under fence 1, and nobody claimed$/],
];

/** The law's own words in what fast-check threw: it keeps the law's error as the cause of its own. */
const messageOf = (e: unknown): string =>
	e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);

const broken = (mod: Mod): readonly string[] =>
	LAWS.flatMap((law) => {
		try {
			law.check(mod);
			return [];
		} catch {
			return [law.name];
		}
	});

// ---------------------------------------------------------------- planted mistakes

const PLANTS: Record<string, () => Promise<Mod>> = {
	// A renew with no answer is taken for a lost one: the first wifi blip ends the program.
	unknownIsLost: () =>
		plant([
			'(m.type === "renew_lost" && m.fence === fence) ||',
			'((m.type === "renew_lost" || m.type === "renew_unknown") && m.fence === fence) ||',
		]),
	// A newer claim in the tail is not heard: two programs run under one name.
	newerClaimMissed: () => plant(['(m.type === "seen_claim" && m.fence > fence) ||\n\t', ""]),
	// A `lost` renew is not heard.
	lostMissed: () => plant(['(m.type === "renew_lost" && m.fence === fence) ||\n\t', ""]),
	// The lease clock is not heard: a host cut off for good runs its program on forever.
	clockMissed: () =>
		plant([' ||\n\t(m.type === "lease_due" && m.fence === fence && m.until === until)', ""]),
	// It renews every second always, away or not: a quick fix for being away that floods the ledger.
	alwaysEachSecond: () =>
		plant([
			'? {ms: every, msg: {type: "renew_due" as const, fence: s.fence, tick: s.ticks}}',
			'? {ms: Math.min(every, 1000), msg: {type: "renew_due" as const, fence: s.fence, tick: s.ticks}}',
		]),
};

// ---------------------------------------------------------------- the tests

describe("the host's laws for a short drop (lane 18, part 2), on createHost", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(real);
	});

	it.each(BUGS.map(([law, how]) => [law.name, law, how] as const))(
		"known bug: %s",
		(_, law, how) => {
			let e: unknown = null;
			try {
				law.check(real);
			} catch (x) {
				e = x;
			}
			expect(e).toBeInstanceOf(Error);
			expect(messageOf(e)).toMatch(how);
		},
	);

	it("each law is seen to fail on a planted mistake, and only the laws it should", async () => {
		const caught: Record<string, readonly string[]> = {};
		for (const [name, make] of Object.entries(PLANTS)) caught[name] = broken(await make());
		expect(caught).toEqual({
			unknownIsLost: [unknownKeeps.name],
			newerClaimMissed: [lostStops.name],
			lostMissed: [lostStops.name],
			clockMissed: [stopsByGrace.name],
			alwaysEachSecond: [backKeepsPace.name],
		});
		const all = new Set(Object.values(caught).flat());
		expect(LAWS.filter((law) => !all.has(law.name)).map((law) => law.name)).toEqual([]);
	});
});
