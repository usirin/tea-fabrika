import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {pathToFileURL} from "node:url";
import {Ledger, LedgerUnreachable} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {Effect, Layer, Option, Schema} from "effect";
import * as fc from "fast-check";
import {afterAll, describe, expect, it, vi} from "vitest";
import * as realFacts from "../asks/ledger.ts";
import {planOf, ticketId} from "../ids.ts";
import * as realGate from "./idempotency.ts";

// A lane's own writes for lane 18, part 2: a fact, and the idempotency gate's rows and lease
// check. Each waits while the ledger does not answer, and is sent again under the same id, with no
// try limit, until the host stops the program (its lease's end plus a 10 minute grace). (The
// journal's save has its laws beside it, in fabrika's host/journal.laws.test.ts.) Properties over
// random runs, each with a network drop, on the ledger in memory.
//
// The time: these writes sleep on Effect's live clock, and the gate reads `Date.now()`. So the
// test fakes both under them (vitest's fake timers) and moves the clock on by hand. Nothing sleeps
// on this machine's clock.
//
// Nobody writes their own exam: each planted mistake is a text edit on a COPY of the file in a
// temp folder, and the exact laws it breaks are checked below. Before lane 18 the code broke
// three laws, kept as known bugs. The fix turned two red. The third, `gateWaitsForRenew`, kept
// failing because its world never renewed the lease; its world was fixed, and all three moved.
// It checks only that the write was sent, so `gateHoldsOnRunOut` came after: no send on a lease
// that has run out, judged on the ledger's own row.

type Service = Ledger["Service"];

// ---------------------------------------------------------------- the modules under test

type FactsMod = {
	readonly appendFact: typeof realFacts.appendFact;
};
type GateMod = {
	readonly gate: typeof realGate.gate;
	readonly Faults: typeof realGate.Faults;
	readonly useKey: typeof realGate.useKey;
};
type Mod = {readonly facts: FactsMod; readonly gate: GateMod};
const real: Mod = {facts: realFacts, gate: realGate};

const madeDirs: string[] = [];
afterAll(() => {
	for (const d of madeDirs) rmSync(d, {recursive: true, force: true});
});

/**
 * A copy of `file` (beside this one, or in ../asks) with one mistake, imported from its own
 * folder. Its relative imports point back at the real files. Each edit matches once.
 */
async function plantFile(file: string, a: string, b: string): Promise<unknown> {
	const from = join(import.meta.dirname, file);
	const dir = mkdtempSync(join(import.meta.dirname, ".lane-writes-plant-"));
	madeDirs.push(dir);
	const text = readFileSync(from, "utf8").replace(
		/from "(\.\.?\/[^"]+)"/g,
		(_, path: string) => `from "${join(dirname(from), path)}"`,
	);
	const count = text.split(a).length - 1;
	if (count !== 1) throw new Error(`plant edit on ${file}: "${a}" found ${count} times, want 1`);
	const to = join(dir, "planted.ts");
	writeFileSync(
		to,
		text.replace(a, () => b),
	);
	return import(/* @vite-ignore */ pathToFileURL(to).href);
}
const plantFacts = async (a: string, b: string): Promise<Mod> => ({
	...real,
	facts: (await plantFile("../asks/ledger.ts", a, b)) as typeof realFacts,
});
const plantGate = async (a: string, b: string): Promise<Mod> => ({
	...real,
	gate: (await plantFile("idempotency.ts", a, b)) as typeof realGate,
});

// ---------------------------------------------------------------- the world

/** The rule's grace past the lease's end: a write waits out any drop shorter than this. */
const GRACE = 600_000;
/** Once the network is back, a write lands within this long. */
const BACK_WITHIN = 2000;
/** A lease long enough that its end plays no part, but where a law says it does. */
const LONG = 24 * 3_600_000;

/**
 * The network to the ledger. Down from `from` (a time, or the first call that `starts` it) for
 * `drop` ms. `lands`: the first write in the drop reaches the ledger, and only its answer is lost.
 */
interface Net {
	from: number | null;
	drop: number;
	lands: boolean;
	starts: (method: string, id: string | null) => boolean;
}
const isDown = (net: Net) => net.from !== null && Date.now() < net.from + net.drop;
const unreachable = (method: string) =>
	Effect.fail(new LedgerUnreachable({method, message: "the network is down"}));

/** The ledger as this host reaches it: cut off while the network is down. */
const cut = (l: Service, net: Net): Service => {
	const at = (method: string, id: string | null) => {
		if (net.from === null && net.starts(method, id)) net.from = Date.now();
	};
	const write = <A, E>(method: string, id: string | null, call: Effect.Effect<A, E>) =>
		Effect.suspend((): Effect.Effect<A, E | LedgerUnreachable> => {
			at(method, id);
			if (!isDown(net)) return call;
			if (!net.lands) return unreachable(method);
			net.lands = false;
			return call.pipe(Effect.ignore, Effect.andThen(unreachable(method)));
		});
	const read = <A, E>(method: string, call: Effect.Effect<A, E>) =>
		Effect.suspend((): Effect.Effect<A, E | LedgerUnreachable> => {
			at(method, null);
			return isDown(net) ? unreachable(method) : call;
		});
	return {
		...l,
		append: (stream, expected, event, fence) =>
			write("append", event.id ?? null, l.append(stream, expected, event, fence)),
		send: (inbox, id, event, fence) => write("send", id, l.send(inbox, id, event, fence)),
		lease: (name) => read("lease", l.lease(name)),
		readStream: (stream) => read("readStream", l.readStream(stream)),
	};
};

/** Run `e` on the fake clock until it ends, or `budget` ms have passed. */
const drive = async <A>(
	e: Effect.Effect<A, unknown>,
	budget: number,
): Promise<{readonly ok: boolean; readonly value: A | null; readonly at: number} | null> => {
	const start = Date.now();
	let end: {ok: boolean; value: A | null; at: number} | null = null;
	Effect.runPromise(e).then(
		(value) => {
			end = {ok: true, value, at: Date.now() - start};
		},
		() => {
			end = {ok: false, value: null, at: Date.now() - start};
		},
	);
	while (end === null && Date.now() - start <= budget)
		await vi.advanceTimersByTimeAsync(Math.min(1000, Math.max(50, budget / 40)));
	return end;
};

const withFakeTime = async <A>(f: () => Promise<A>): Promise<A> => {
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"], now: 0});
	try {
		return await f();
	} finally {
		vi.useRealTimers();
	}
};

const messageOf = (e: unknown): string =>
	e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);

interface Law<W> {
	readonly name: string;
	readonly worlds: fc.Arbitrary<W>;
	/** What went wrong in this world, or null. */
	readonly check: (mod: Mod, world: W) => Promise<string | null>;
}
const assertLaw = <W>(law: Law<W>, mod: Mod) =>
	fc.assert(
		fc.asyncProperty(law.worlds, async (w) => {
			const why = await law.check(mod, w);
			if (why !== null) throw new Error(why);
		}),
		{numRuns: 30, seed: 7},
	);

const shownEnd = (end: {readonly ok: boolean; readonly at: number} | null, budget: number) =>
	end === null
		? `had not ended ${budget} ms on`
		: end.ok
			? `landed after ${end.at} ms`
			: `failed after ${end.at} ms`;

// ---------------------------------------------------------------- facts

const decodeFact = Schema.decodeUnknownSync(realFacts.Fact);
const PLAN = "o/r#1";
const HOLD_NAME = realFacts.planName(planOf(ticketId(PLAN)));
const OTHER = "o/r#9";

/** One fact a lane writes: to its own facts, or to another name's inbox, fenced on its lease. */
interface FactWrite {
	readonly to: "facts" | "inbox";
	readonly drop: number;
	readonly lands: boolean;
}

const runFacts = (mod: Mod, writes: readonly FactWrite[]) =>
	withFakeTime(async () => {
		const l = memoryService();
		const other = realFacts.planName(planOf(ticketId(OTHER)));
		await Effect.runPromise(l.register(HOLD_NAME, "test"));
		await Effect.runPromise(l.register(other, "test"));
		const c = await Effect.runPromise(l.claim(HOLD_NAME, "lane", 1, LONG));
		const hold = {name: HOLD_NAME, fence: c.fence};
		const ends: {readonly w: FactWrite; readonly end: Awaited<ReturnType<typeof drive>>}[] = [];
		for (const [i, w] of writes.entries()) {
			const net: Net = {from: Date.now(), drop: w.drop, lands: w.lands, starts: () => false};
			const fact =
				w.to === "facts"
					? decodeFact({type: "reviewed", plan: PLAN, task: "plan", open: i})
					: decodeFact({type: "folded", plan: OTHER, ticket: `o/r#${i + 10}`});
			const write = mod.facts
				.appendFact(fact, hold)
				.pipe(Effect.provide(Layer.succeed(Ledger, cut(l, net))));
			const end = await drive(write, w.drop + BACK_WITHIN);
			ends.push({w, end});
			if (end === null || !end.ok) break;
		}
		const own = await Effect.runPromise(l.readStream(realFacts.factsOf(HOLD_NAME)));
		const inbox = await Effect.runPromise(l.readStream(`${other}/inbox`));
		return {ends, own, inbox};
	});

const arbFactWrite = (drop: fc.Arbitrary<number>) =>
	fc.record({to: fc.constantFrom<FactWrite["to"]>("facts", "inbox"), drop, lands: fc.boolean()});

/** F1. A fact whose answer was lost is sent again under its id: it lands once. Drops here are short. */
const factLandsOnce: Law<readonly FactWrite[]> = {
	name: "a fact whose answer was lost lands once, under one id",
	worlds: fc.array(arbFactWrite(fc.oneof(fc.constant(0), fc.integer({min: 1, max: 1500}))), {
		minLength: 1,
		maxLength: 4,
	}),
	check: async (mod, writes) => {
		const {ends, own, inbox} = await runFacts(mod, writes);
		for (const {w, end} of ends)
			if (end === null || !end.ok)
				return `a fact to its ${w.to} in a ${w.drop} ms drop ${shownEnd(end, w.drop + BACK_WITHIN)}: wanted it to land`;
		const want = (to: FactWrite["to"]) => writes.filter((w) => w.to === to).length;
		const facts = own.filter((r) => r.kind === "reviewed").length;
		if (facts !== want("facts"))
			return `${facts} facts in its own stream for ${want("facts")} sent`;
		if (inbox.length !== want("inbox"))
			return `${inbox.length} facts in the inbox for ${want("inbox")} sent`;
		return null;
	},
};

/** F2. No try limit: a fact waits out any drop shorter than the grace, and lands once it is back. */
const factWaitsOut: Law<FactWrite> = {
	name: "a fact waits out any drop shorter than the grace, and lands once the network is back",
	worlds: arbFactWrite(
		fc.oneof(fc.constantFrom(2500, 60_000, GRACE - 1000), fc.integer({min: 1, max: GRACE - 1000})),
	),
	check: async (mod, w) => {
		const {ends} = await runFacts(mod, [w]);
		const end = ends[0]?.end ?? null;
		return end?.ok && end.at <= w.drop + BACK_WITHIN
			? null
			: `a fact to its ${w.to} in a ${w.drop} ms drop ${shownEnd(end, w.drop + BACK_WITHIN)}: wanted it to land within ${BACK_WITHIN} ms of the network coming back`;
	},
};

// ---------------------------------------------------------------- the gate

const NAME = "ship:7";
const TTL = 10_000;

/** One write through the gate: where in its steps the network drops, for how long. */
interface GateWrite {
	readonly at: "intent" | "lease" | "done";
	readonly drop: number;
	readonly lands: boolean;
}
/**
 * The lease check's world. `takeover`: another host claims the name this long past the lease's
 * end, just before the send. `late`: the lease looks run out, or its row is gone (the alarm ran),
 * until the host's renew comes back this long after; nobody claimed. `runOut`: the same on the
 * ledger itself, with nothing hidden: just before the send the clock passes the lease's end (and,
 * if `gone`, the alarm's removal of its row), and the renew comes back `back` ms after that.
 */
type LeaseWorld =
	| {readonly kind: "takeover"; readonly after: number}
	| {readonly kind: "late"; readonly gone: boolean; readonly back: number}
	| {readonly kind: "runOut"; readonly gone: boolean; readonly back: number};

/** The in-memory ledger's alarm: it removes a run-out lease's row this long past its end. */
const ALARM = 1000;

const runGate = (
	mod: Mod,
	o: {
		readonly net?: GateWrite;
		readonly lease?: LeaseWorld;
		readonly budget: number;
	},
) =>
	withFakeTime(async () => {
		const l = memoryService();
		await Effect.runPromise(l.register(NAME, "test"));
		const ttl = o.lease === undefined ? LONG : TTL;
		const c = await Effect.runPromise(l.claim(NAME, "a", 1, ttl));
		const w = o.net;
		const net: Net = {
			from: null,
			drop: w?.drop ?? 0,
			lands: w?.lands ?? false,
			starts: (method, id) =>
				w !== undefined &&
				(w.at === "lease" ? method === "lease" : id?.startsWith(`${w.at}:`) === true),
		};
		let ledger = cut(l, net);
		const sent: string[] = [];
		/** For each send: was the ledger's own row this fence's, and not run out, at that moment? */
		const liveAtSend: boolean[] = [];
		let backAt = Number.POSITIVE_INFINITY;
		const lw = o.lease;
		if (lw?.kind === "late" || lw?.kind === "runOut") {
			const seen = ledger;
			// The host's renew comes back at `backAt` and lands on the real row, at the first lease
			// read from then on. Rule B lets it: the newest fence renews past its lease's end, and
			// after the alarm too (`lease_resumed`), while nobody claimed. The `late` world first only
			// stopped hiding the row at `backAt` and never renewed it. With `back` past the 10 s ttl,
			// the gate then read the claim's own row, run out or gone, and waited on for good. That
			// was the world's mistake, not the gate's: the gate must wait for a live lease, since a
			// comment on GitHub carries no fence, and on a lease past its end another host may claim
			// at once and send it too. The `runOut` world hides nothing.
			let renewed = false;
			const renewBack = Effect.suspend(() =>
				renewed || Date.now() < backAt
					? Effect.void
					: Effect.orDie(l.renew(NAME, c.fence, ttl)).pipe(
							Effect.andThen(
								Effect.sync(() => {
									renewed = true;
								}),
							),
						),
			);
			ledger = {
				...seen,
				lease: (name) =>
					Effect.andThen(
						renewBack,
						lw.kind === "runOut"
							? seen.lease(name)
							: Effect.flatMap(seen.lease(name), (row) =>
									Date.now() >= backAt || row === null
										? Effect.succeed(row)
										: Effect.succeed(lw.gone ? null : {...row, expires_at: Date.now() - 1}),
								),
					),
			};
		}
		/** What happens to the lease just before the send. */
		const beforeSend = (lw: LeaseWorld): Effect.Effect<void> => {
			const renewIn = (back: number) =>
				Effect.sync(() => {
					backAt = Date.now() + back;
				});
			switch (lw.kind) {
				case "takeover":
					return Effect.gen(function* () {
						yield* Effect.sleep(ttl + lw.after);
						const rev = (yield* Effect.orDie(l.readLast(NAME, 1)))[0]?.rev ?? 0;
						yield* Effect.orDie(l.claim(NAME, "b", rev, ttl));
					});
				case "late":
					return renewIn(lw.back);
				case "runOut":
					return Effect.andThen(Effect.sleep(ttl + (lw.gone ? 2 * ALARM : 1)), renewIn(lw.back));
			}
		};
		const faults = mod.gate.Faults.of({
			at: (point) =>
				point.startsWith("before-send:") && lw !== undefined ? beforeSend(lw) : Effect.void,
		});
		const write: realGate.Write<string> = {
			op: "comment",
			subject: "pr@abc",
			answer: Schema.String,
			look: (key) =>
				Effect.succeed(sent.includes(key) ? Option.some(`found ${key}`) : Option.none()),
			send: (key) =>
				mod.gate.useKey(key).pipe(
					Effect.flatMap((text) =>
						Effect.map(Effect.orDie(l.lease(NAME)), (row) => {
							sent.push(text);
							liveAtSend.push(row !== null && row.fence === c.fence && row.expires_at > Date.now());
							return `sent ${text}`;
						}),
					),
				),
		};
		const once = Effect.gen(function* () {
			const g = yield* mod.gate.gate({name: NAME, fence: c.fence, holder: "a"});
			return yield* g.once(write);
		}).pipe(
			Effect.provide(Layer.succeed(Ledger, ledger)),
			Effect.provideService(mod.gate.Faults, faults),
		);
		const end = await drive(once, o.budget);
		const rows = await Effect.runPromise(l.readStream(realGate.writesOf(NAME)));
		return {end, sent, liveAtSend, rows};
	});

const KEY = `${NAME}#comment:pr@abc`;
const arbGateWrite = (drop: fc.Arbitrary<number>) =>
	fc.record({
		at: fc.constantFrom<GateWrite["at"]>("intent", "lease", "done"),
		drop,
		lands: fc.boolean(),
	});

/** G1. A write across a short drop is sent once, and its intent and done rows land once each. */
const gateOnce: Law<GateWrite> = {
	name: "a write through the gate across a drop is sent once, and its rows land once",
	worlds: arbGateWrite(fc.oneof(fc.constant(0), fc.integer({min: 1, max: 1500}))),
	check: async (mod, w) => {
		const {end, sent, rows} = await runGate(mod, {net: w, budget: w.drop + BACK_WITHIN});
		if (end === null || !end.ok || end.value !== `sent ${KEY}`)
			return `a write with a ${w.drop} ms drop at its ${w.at} ${shownEnd(end, w.drop + BACK_WITHIN)}: wanted it sent`;
		if (sent.length !== 1) return `sent ${sent.length} times`;
		for (const kind of ["intent", "done"]) {
			const n = rows.filter((r) => r.kind === kind).length;
			if (n !== 1) return `${n} ${kind} rows for one write`;
		}
		return null;
	},
};

/** G2. No try limit: the gate waits out any drop shorter than the grace, at any of its steps. */
const gateWaitsOut: Law<GateWrite> = {
	name: "the gate waits out any drop shorter than the grace, and sends once the network is back",
	worlds: arbGateWrite(
		fc.oneof(fc.constantFrom(2500, 60_000, GRACE - 1000), fc.integer({min: 1, max: GRACE - 1000})),
	),
	check: async (mod, w) => {
		const budget = w.drop + BACK_WITHIN;
		const {end, sent} = await runGate(mod, {net: w, budget});
		return end?.ok && sent.length === 1
			? null
			: `a write with a ${w.drop} ms drop at its ${w.at} ${end === null ? "was never sent" : shownEnd(end, budget)}${sent.length === 0 ? "" : `, sent ${sent.length} times`}: wanted it sent once the network came back`;
	},
};

/** G3. The lease check refuses at once, and sends nothing, when another fence holds the lease. */
const gateOtherFence: Law<number> = {
	name: "the gate sends nothing once another host claimed the name",
	worlds: fc.oneof(fc.constantFrom(0, 1, 1000, GRACE), fc.integer({min: 0, max: GRACE})),
	check: async (mod, after) => {
		const {sent} = await runGate(mod, {
			lease: {kind: "takeover", after},
			budget: TTL + after + 5000,
		});
		return sent.length === 0
			? null
			: `another host claimed ${after} ms past the lease's end, and the gate sent the write ${sent.length} time(s)`;
	},
};

/**
 * G4. Rule B: a lease past its end, or whose row the alarm removed, is still this fence's while
 * nobody claimed. The check waits for the renew, with no try limit, and then sends.
 */
const gateWaitsForRenew: Law<{readonly gone: boolean; readonly back: number}> = {
	name: "past its lease's end with no newer claim, the gate waits for the renew, then sends",
	worlds: fc.record({
		gone: fc.boolean(),
		back: fc.oneof(
			fc.constantFrom(2500, 60_000, GRACE - 1000),
			fc.integer({min: 1, max: GRACE - 1000}),
		),
	}),
	check: async (mod, {gone, back}) => {
		const budget = back + BACK_WITHIN;
		const {end, sent} = await runGate(mod, {lease: {kind: "late", gone, back}, budget});
		return end?.ok && sent.length === 1
			? null
			: `the lease ${gone ? "row was gone" : "had run out"} until a renew ${back} ms on, and the write ${end === null ? "was never sent" : shownEnd(end, budget)}: wanted it sent after the renew`;
	},
};

/**
 * G5. Rule B is for fenced writes only. A comment on GitHub carries no fence and cannot be refused
 * later, and on a lease past its end another host may claim at any moment and send it too. So
 * while the lease has run out, or the alarm took its row, the gate sends nothing. Once the renew
 * lands, the waiting write goes out once. Each send is judged on the ledger's own row at that
 * moment. G4 sees only that the write was sent, so a gate that sends at once on a run-out lease
 * passed it (experiment 151 found the gap).
 */
const gateHoldsOnRunOut: Law<{readonly gone: boolean; readonly back: number}> = {
	name: "while its lease has run out, the gate sends nothing; once it is renewed, the write goes out once",
	// The spread covers the first minute, where most drops end; a wait near the grace's end is a
	// fixed case. Spread over the whole grace, as G4's is, the plant test took 31 s, not 23 s.
	worlds: fc.record({
		gone: fc.boolean(),
		back: fc.oneof(
			fc.constantFrom(1, 2500, 60_000, GRACE - 3 * ALARM),
			fc.integer({min: 1, max: 60_000}),
		),
	}),
	check: async (mod, {gone, back}) => {
		const budget = TTL + 2 * ALARM + back + BACK_WITHIN;
		const {end, sent, liveAtSend} = await runGate(mod, {
			lease: {kind: "runOut", gone, back},
			budget,
		});
		const world = `the lease ${gone ? "row was gone" : "had run out"} until a renew ${back} ms on`;
		if (liveAtSend.includes(false)) return `${world}, and the gate sent the write before the renew`;
		return end?.ok && sent.length === 1
			? null
			: `${world}, and the write ${end === null ? "was never sent" : shownEnd(end, budget)}${sent.length > 1 ? `, sent ${sent.length} times` : ""}: wanted it sent once after the renew`;
	},
};

// ---------------------------------------------------------------- the laws and the plants

/** A law with its kind of world closed over: each law makes and checks its own. */
interface Checked {
	readonly name: string;
	readonly assert: (mod: Mod) => Promise<void>;
}
const checked = <W>(law: Law<W>): Checked => ({
	name: law.name,
	assert: (mod) => assertLaw(law, mod),
});
const LAWS: readonly Checked[] = [
	checked(factLandsOnce),
	checked(gateOnce),
	checked(gateOtherFence),
	// Were known bugs until lane 18: `steady` gave up after 40 tries, 50 ms apart, and the gate's
	// appends and lease check after 40.
	checked(factWaitsOut),
	checked(gateWaitsOut),
	// A known bug until its world renewed the row at `backAt` (see `runGate`): the gate was right.
	checked(gateWaitsForRenew),
	// Added after lane 18, for the gap experiment 151 found. The gate keeps it.
	checked(gateHoldsOnRunOut),
];
const BUGS: readonly (readonly [Checked, RegExp])[] = [];

const PLANTS: Record<string, () => Promise<Mod>> = {
	// A fact in its own stream gets a new id each try: a resend of one that landed lands again.
	factIdPerTry: () =>
		plantFacts(
			'ledger.append(factsOf(home), "any", event, hold.fence),',
			'Effect.suspend(() => ledger.append(factsOf(home), "any", {...event, id: crypto.randomUUID()}, hold.fence)),',
		),
	// A fact to an inbox gets a new id each try.
	sentIdPerTry: () =>
		plantFacts(
			// oxlint-disable-next-line eslint/no-template-curly-in-string -- the text of a source file; `${fact.type}` is that file's own template, written out as it is
			"steady(`send ${fact.type}`, ledger.send(inbox, id, event, o.hold?.fence));",
			// oxlint-disable-next-line eslint/no-template-curly-in-string -- the text of a planted line; its `${fact.type}` is that line's own template
			"steady(`send ${fact.type}`, Effect.suspend(() => ledger.send(inbox, crypto.randomUUID(), event, o.hold?.fence)));",
		),
	// The gate's rows get a new id each try. Lane 18 moved its retry into `steady`.
	gateIdPerTry: () =>
		plantGate(
			'ledger.append(stream, "any", {kind, writer: o.holder, data, id}, o.fence),',
			// oxlint-disable-next-line eslint/no-template-curly-in-string -- the text of a planted line; its `${...}` is that line's own template
			'Effect.suspend(() => ledger.append(stream, "any", {kind, writer: o.holder, data, id: `${id}:${Date.now()}`}, o.fence)),',
		),
	// The lease check does not look at whose lease it is.
	otherFenceMissed: () =>
		plantGate("if (lease !== null && lease.fence !== o.fence) return false;\n\t\t\t\t", ""),
	// The lease check takes a lease past its end, or a row the alarm took, for a lost one: the
	// clock fences, as before rule B. Added with `gateWaitsForRenew`, so it is seen to fail.
	runOutIsLost: () =>
		plantGate(
			"if (lease !== null && lease.fence !== o.fence) return false;",
			"if (lease === null || lease.fence !== o.fence || lease.expires_at <= Date.now()) return false;",
		),
	// The send goes out with no lease check at all.
	noLeaseCheck: () =>
		plantGate(
			'if (o.planted !== "no_lease_check" && !(yield* leaseHeld))',
			"if (o.planted === undefined && false && !(yield* leaseHeld))",
		),
	// The lease check takes rule B for an outside write: with no newer fence it sends, on a lease
	// past its end too. Added with `gateHoldsOnRunOut`, which alone catches it.
	sendsOnRunOut: () =>
		plantGate(
			"if (lease !== null && lease.expires_at - Date.now() > marginMs) return true;",
			"return true;",
		),
};

describe("a lane's own writes for a short drop (lane 18, part 2)", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", async (_, law) => {
		await law.assert(real);
	});

	it.each(BUGS.map(([law, how]) => [law.name, law, how] as const))(
		"known bug: %s",
		async (_, law, how) => {
			const e = await law.assert(real).then(
				() => null,
				(x: unknown) => x,
			);
			expect(e).toBeInstanceOf(Error);
			expect(messageOf(e)).toMatch(how);
		},
	);

	it("each law is seen to fail on a planted mistake, and only the laws it should", async () => {
		const caught: Record<string, readonly string[]> = {};
		for (const [name, make] of Object.entries(PLANTS)) {
			const mod = await make();
			const out: string[] = [];
			for (const law of LAWS) {
				const failed = await law.assert(mod).then(
					() => false,
					() => true,
				);
				if (failed) out.push(law.name);
			}
			caught[name] = out;
		}
		expect(caught).toEqual({
			factIdPerTry: [factLandsOnce.name],
			sentIdPerTry: [factLandsOnce.name],
			gateIdPerTry: [gateOnce.name],
			otherFenceMissed: [gateOtherFence.name],
			// G5 catches these two as well: one sends on a run-out lease, the other never sends.
			noLeaseCheck: [gateOtherFence.name, gateHoldsOnRunOut.name],
			runOutIsLost: [gateWaitsForRenew.name, gateHoldsOnRunOut.name],
			sendsOnRunOut: [gateHoldsOnRunOut.name],
		});
	});
});
