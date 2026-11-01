import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {Clock, Duration, Effect, type Layer, Option, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {afterAll, describe, expect, it} from "vitest";
import {fresh, say} from "./laws.ts";
import type {Claimed, Lease, Row} from "./ledger.ts";
import * as realLedger from "./ledger.ts";
import * as realMemory from "./memory.ts";
import * as realSqlite from "./sqlite.ts";

// The fence's laws (lane 18, part 1, rule B): a fence is good until a newer claim exists, and the
// clock plays no part. Properties over random runs of claims, renews, writes, resends and clock
// moves, on the ledger in memory and on node:sqlite (the same SQL the Durable Object runs), each
// built with its defaults, under a clock the test owns (Effect's TestClock: the ledger's alarm runs
// at each of its ticks as the clock moves on; nothing sleeps on this machine's clock).
//
// Each law judges an answer against what the ledger itself said before it in the same run: the
// fences its claims gave, and the lease's end as its last claim or renew gave it. So a law about
// claims still holds on a ledger whose late renew is refused: it counts the end that ledger gave.
//
// Nobody writes their own exam: this file writes the laws and never the ledger's code. Each planted
// mistake is a text edit on a COPY of the ledger's files, imported from a temp folder, so the real
// code is untouched. The exact list of laws each plant breaks is checked below, as the Door's laws
// do (door.laws.test.ts). Before lane 18 the ledger broke three of these laws. They were kept as
// known bugs, which passed while the law failed for the rule's reason; the fix turned them red,
// and they moved to the laws.

// ---------------------------------------------------------------- the module under test

type Mod = {
	readonly Ledger: typeof realLedger.Ledger;
	readonly layerMemory: typeof realMemory.layerMemory;
	readonly layerSqliteSync: typeof realSqlite.layerSqliteSync;
};
const real: Mod = {
	Ledger: realLedger.Ledger,
	layerMemory: realMemory.layerMemory,
	layerSqliteSync: realSqlite.layerSqliteSync,
};

const madeDirs: string[] = [];
afterAll(() => {
	for (const d of madeDirs) rmSync(d, {recursive: true, force: true});
});

type File = "rules" | "memory" | "sqlite";
const FILES: readonly string[] = [
	"ledger",
	"rules",
	"sqlite-driver",
	"sqlite",
	"sqlite-worker",
	"memory",
];
type Edit = readonly [File, string, string];

/**
 * A copy of the ledger's files with one mistake, imported from its own folder. The real code stays
 * as it is. Each edit must match its file exactly once.
 */
async function plant(...edits: readonly Edit[]): Promise<Mod> {
	const dir = mkdtempSync(join(import.meta.dirname, ".fence-laws-plant-"));
	madeDirs.push(dir);
	for (const f of FILES) {
		let text = readFileSync(join(import.meta.dirname, `${f}.ts`), "utf8");
		for (const [file, a, b] of edits) {
			if (file !== f) continue;
			const count = text.split(a).length - 1;
			if (count !== 1) throw new Error(`plant edit on ${f}: "${a}" found ${count} times, want 1`);
			text = text.replace(a, () => b);
		}
		writeFileSync(join(dir, `${f}.ts`), text);
	}
	const url = (f: string) => pathToFileURL(join(dir, `${f}.ts`)).href;
	const ledger = (await import(/* @vite-ignore */ url("ledger"))) as typeof realLedger;
	const memory = (await import(/* @vite-ignore */ url("memory"))) as typeof realMemory;
	const sqlite = (await import(/* @vite-ignore */ url("sqlite"))) as typeof realSqlite;
	return {
		Ledger: ledger.Ledger,
		layerMemory: memory.layerMemory,
		layerSqliteSync: sqlite.layerSqliteSync,
	};
}

/** One ledger the laws run on: memory or node:sqlite, from the real files or a planted copy. */
type Impl = {readonly kind: "memory" | "sqlite"; readonly mod: Mod};

/** A file per property, so its runs open a database that is there already. */
const sqlitePath = () => {
	const dir = mkdtempSync(join(import.meta.dirname, ".fence-laws-db-"));
	madeDirs.push(dir);
	return join(dir, "ledger.sqlite");
};
/** The ledger, built with its defaults: its expiry grace and its alarm's tick are the real ones. */
const layerOf = (impl: Impl, path: string): Layer.Layer<realLedger.Ledger> =>
	impl.kind === "memory" ? impl.mod.layerMemory() : impl.mod.layerSqliteSync({path});

// ---------------------------------------------------------------- a run

/** The lease's ttl in a run. Waits are drawn around it. */
const TTL = 2000;
/** What the rule keeps: the alarm writes `lease_expired` this long after a lease's end. */
const GRACE = 1000;
/** How often the alarm looks, by default: it writes at most this late. */
const TICK = 25;

/** Which fence a write or a renew carries: the newest one given out, or an older one. */
type Who = "newest" | "older";
/** Where a write goes: the name's own streams (its state, deeper, the name itself), a sibling name, or another name's inbox. */
type Where = "state" | "deeper" | "name" | "sibling" | "reply";
type Act =
	| {readonly do: "claim"}
	| {readonly do: "renew"; readonly by: Who; readonly pick: number}
	| {
			readonly do: "write";
			readonly by: Who;
			readonly pick: number;
			readonly to: Where;
			/**
			 * A resend of a write sent before (by `pick`): its stream and its id, under the fence this
			 * act carries. Its answer was lost in a drop, or a new host sends it again after a takeover.
			 */
			readonly again: boolean;
	  }
	| {readonly do: "wait"; readonly ms: number};

/** One act as it was done: what the ledger had said before it, and what it answered. */
interface Step {
	readonly act: Act;
	/** The ledger's time when it was done. */
	readonly at: number;
	/** Every fence the run's claims were given before it, oldest first. */
	readonly fences: readonly number[];
	/** The lease's end as the ledger last gave it (its claim's or its renew's), or null: no claim yet. */
	readonly end: number | null;
	/** The alarm wrote `lease_expired` for the newest fence before it. */
	readonly swept: boolean;
	/** The fence a write or a renew carried. */
	readonly fence: number | null;
	/** Where a write went: for a resend, where the write it repeats went. */
	readonly where: Where | null;
	readonly stream: string | null;
	/** A write: its id had landed in that stream before. */
	readonly landed: boolean;
	readonly word: string;
	readonly value: unknown;
	/** A wait: the `lease_expired` rows the alarm wrote while the clock moved on, and the lease row after. */
	readonly expiries: readonly Row[];
	readonly leaseAfter: Lease | null;
}
interface Run {
	readonly steps: readonly Step[];
	/** Each stream the run wrote, as it ends. */
	readonly rows: ReadonlyMap<string, readonly Row[]>;
	/** The name's own stream, as it ends: its claims and expiries. */
	readonly registry: readonly Row[];
}

const newestOf = (s: Step) => s.fences.at(-1) ?? null;
const decodeFence = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Struct({fence: Schema.Number})),
);
/** The fence a row's data names, or null: it names none. */
const fenceIn = (row: Row): number | null =>
	Option.match(decodeFence(row.data), {onNone: () => null, onSome: (d) => d.fence});

/** The fence an act carries: the newest, or one of the older ones by `pick`; null: there is none. */
const fenceFor = (by: Who, pick: number, fences: readonly number[]): number | null =>
	by === "newest"
		? (fences.at(-1) ?? null)
		: fences.length < 2
			? null
			: (fences[pick % (fences.length - 1)] ?? null);

const runOn = (impl: Impl, path: string, acts: readonly Act[]): Promise<Run> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const l = yield* impl.mod.Ledger;
			const p = fresh("fence");
			const to: Record<Where, string> = {
				state: `${p}/state`,
				deeper: `${p}/a/b`,
				name: p,
				sibling: `${p}x`,
				reply: `${p}-asker/inbox`,
			};
			for (const n of [p, `${p}x`, `${p}-asker`]) yield* l.register(n, "setup");
			const expiries = Effect.map(l.readStream(p), (rs) =>
				rs.filter((r) => r.kind === "lease_expired"),
			);
			const fences: number[] = [];
			let end: number | null = null;
			/** Every write sent so far, where it went and its id: a resend repeats one of them. */
			const sent: {readonly where: Where; readonly id: string}[] = [];
			const landed = new Set<string>();
			const steps: Step[] = [];
			for (const act of acts) {
				const at = yield* Clock.currentTimeMillis;
				const newest = fences.at(-1) ?? null;
				const swept = newest !== null && (yield* expiries).some((r) => fenceIn(r) === newest);
				const base = {
					act,
					at,
					fences: [...fences],
					end,
					swept,
					fence: null,
					where: null,
					stream: null,
					landed: false,
					expiries: [],
					leaseAfter: null,
				};
				if (act.do === "claim") {
					const rev = (yield* l.readLast(p, 1))[0]?.rev ?? 0;
					const r = yield* say(l.claim(p, `h${fences.length + 1}`, rev, TTL));
					if (r.value !== null) {
						fences.push(r.value.fence);
						end = r.value.expiresAt;
					}
					steps.push({...base, word: r.word, value: r.value});
				} else if (act.do === "renew") {
					const fence = fenceFor(act.by, act.pick, fences);
					if (fence === null) continue;
					const r = yield* say(l.renew(p, fence, TTL));
					if (r.value !== null && fence === newest) end = r.value.expiresAt;
					steps.push({...base, fence, word: r.word, value: r.value});
				} else if (act.do === "write") {
					const fence = fenceFor(act.by, act.pick, fences);
					if (fence === null) continue;
					const earlier = act.again ? sent[act.pick % Math.max(1, sent.length)] : undefined;
					const {where, id} = earlier ?? {where: act.to, id: `w${sent.length}`};
					if (earlier === undefined) sent.push({where, id});
					const stream = to[where];
					const was = landed.has(`${stream} ${id}`);
					const event = {kind: "note", writer: "h", data: {fence}, id};
					const r = yield* say(l.append(stream, "any", event, fence));
					if (r.word === "ok") landed.add(`${stream} ${id}`);
					steps.push({...base, fence, where, stream, landed: was, word: r.word, value: r.value});
				} else {
					const seen = (yield* expiries).length;
					yield* TestClock.adjust(Duration.millis(act.ms));
					const after = (yield* expiries).slice(seen);
					const leaseAfter = yield* l.lease(p);
					steps.push({...base, word: "", value: null, expiries: after, leaseAfter});
				}
			}
			const rows = new Map<string, readonly Row[]>();
			for (const stream of Object.values(to)) rows.set(stream, yield* l.readStream(stream));
			return {steps, rows, registry: yield* l.readStream(p)};
		}).pipe(
			Effect.provide(layerOf(impl, path)),
			Effect.scoped,
			Effect.provide(TestClock.layer({warningDelay: Duration.minutes(1)})),
		),
	);

const WAITS = [1, 500, TTL - 1, TTL, TTL + 1, TTL + GRACE, TTL + GRACE + 2 * TICK, 3 * TTL];
const arbWho = fc.constantFrom<Who>("newest", "older");
const arbAct: fc.Arbitrary<Act> = fc.oneof(
	{arbitrary: fc.constant<Act>({do: "claim"}), weight: 2},
	{
		arbitrary: fc.record({do: fc.constant("renew" as const), by: arbWho, pick: fc.nat(3)}),
		weight: 2,
	},
	{
		arbitrary: fc.record({
			do: fc.constant("write" as const),
			by: arbWho,
			pick: fc.nat(3),
			to: fc.constantFrom<Where>("state", "deeper", "name", "sibling", "reply"),
			again: fc.boolean(),
		}),
		weight: 5,
	},
	{
		arbitrary: fc.record({
			do: fc.constant("wait" as const),
			ms: fc.oneof(fc.constantFrom(...WAITS), fc.integer({min: 1, max: 3 * TTL})),
		}),
		weight: 3,
	},
);
/** A takeover: the clock moves past the lease's end, maybe past the alarm too, and a new host claims. */
const arbTakeover = fc
	.constantFrom(TTL, TTL + 1, TTL + GRACE, TTL + GRACE + 2 * TICK, 3 * TTL)
	.map((ms): readonly Act[] => [{do: "wait", ms}, {do: "claim"}]);
const arbRound = fc.array(arbAct, {maxLength: 6});
/**
 * A run starts with a claim, so most acts have a fence to carry, and has up to two takeovers, so
 * older fences, their renews and their resends after a takeover come up often.
 */
const arbRun = fc
	.tuple(arbRound, fc.array(fc.tuple(arbTakeover, arbRound), {maxLength: 2}))
	.map(([first, rest]): readonly Act[] => [
		{do: "claim"},
		...first,
		...rest.flatMap(([takeover, round]) => [...takeover, ...round]),
	]);

const OPTS = {numRuns: 40, seed: 7} as const;

// ---------------------------------------------------------------- the laws

interface Law {
	readonly name: string;
	/** What went wrong in this run, or null: the law holds on it. */
	readonly check: (r: Run) => string | null;
}

/** Run `law` over random runs on `impl`. A run where it breaks throws, with fast-check's smallest. */
const assertLaw = async (law: Law, impl: Impl) => {
	const path = sqlitePath();
	await fc.assert(
		fc.asyncProperty(arbRun, async (acts) => {
			const why = law.check(await runOn(impl, path, acts));
			if (why !== null) throw new Error(why);
		}),
		OPTS,
	);
};

const own: readonly Where[] = ["state", "deeper", "name"];
/** When a step was done, against the lease's end the ledger gave. */
const when = (s: Step) =>
	s.end === null
		? `at ${s.at}`
		: s.at < s.end
			? `at ${s.at}, lease live to ${s.end}`
			: `at ${s.at}, ${s.at - s.end} ms past the lease's end`;
const shown = (s: Step) => `${s.where}${s.landed ? " (a resend)" : ""}`;

/** The newest fence's write on its own streams or into another name's inbox: ok, or dup for a resend. */
const newestWrites =
	(after: boolean) =>
	(r: Run): string | null => {
		for (const s of r.steps) {
			if (s.act.do !== "write" || s.where === "sibling" || s.swept !== after) continue;
			if (s.fence !== newestOf(s)) continue;
			const want = s.landed ? "dup" : "ok";
			if (s.word !== want)
				return `a write to ${shown(s)} by the newest fence ${s.fence}, ${when(s)}${after ? ", after the alarm" : ""}: ${s.word}, wanted ${want}`;
		}
		return null;
	};

/** 1. Rule B: until a newer claim, the newest fence writes, whatever the time (the alarm not run yet). */
const newestFenceWrites: Law = {
	name: "the newest fence writes its name's streams and replies whatever the time, before the alarm",
	check: newestWrites(false),
};

/** 2. Rule B after the expiry job: it wrote lease_expired and removed the row, and the fence still writes. */
const newestAfterAlarm: Law = {
	name: "the newest fence still writes after the alarm wrote lease_expired, while nobody claimed",
	check: newestWrites(true),
};

/** 3. Law 12's shape: an older fence is refused on the name, under it, and at the name itself; no fence reaches a sibling. */
const olderRefused: Law = {
	name: "once a newer claim exists, an older fence is refused under p, and no fence of p writes px",
	check: (r) => {
		for (const s of r.steps) {
			if (s.where === null) continue;
			const sibling = s.where === "sibling";
			if (!sibling && (!own.includes(s.where) || s.fence === newestOf(s))) continue;
			if (s.word !== "fenced")
				return sibling
					? `a write to px by fence ${s.fence}, ${when(s)}: ${s.word}, wanted fenced`
					: `a write to ${shown(s)} by the older fence ${s.fence} (newest ${newestOf(s)}), ${when(s)}: ${s.word}, wanted fenced`;
		}
		return null;
	},
};

/** 4. Law 18's shape: a reply fenced on the replier's lease is refused once a newer claim on it exists. */
const olderReplyRefused: Law = {
	name: "a reply fenced on an older lease of the replier is refused",
	check: (r) => {
		for (const s of r.steps) {
			if (s.where !== "reply" || s.fence === newestOf(s)) continue;
			if (s.word !== "fenced")
				return `a reply${s.landed ? " (a resend)" : ""} by the older fence ${s.fence} (newest ${newestOf(s)}), ${when(s)}: ${s.word}, wanted fenced`;
		}
		return null;
	},
};

/** 5. A claim past the lease's end takes it at once, with a bigger fence; a claim on a live lease is held. */
const claims: Law = {
	name: "a claim past the lease's end takes it at once with a bigger fence, and a claim on a live lease is held",
	check: (r) => {
		for (const s of r.steps) {
			if (s.act.do !== "claim") continue;
			if (s.end !== null && s.at < s.end) {
				if (s.word !== "held") return `a claim ${when(s)}: ${s.word}, wanted held`;
				continue;
			}
			if (s.word !== "ok") return `a claim ${when(s)}: ${s.word}, wanted ok`;
			const fence = (s.value as Claimed).fence;
			const most = Math.max(0, ...s.fences);
			if (fence <= most) return `a claim ${when(s)} got fence ${fence}, not bigger than ${most}`;
		}
		return null;
	},
};

/** 6. Rule B: a renew by the newest fence works, past the lease's end too, while no newer claim exists. */
const newestRenews: Law = {
	name: "a renew by the newest fence works whatever the time, while no newer claim exists",
	check: (r) => {
		for (const s of r.steps) {
			if (s.act.do !== "renew" || s.fence !== newestOf(s)) continue;
			if (s.word !== "ok")
				return `a renew by the newest fence ${s.fence}, ${when(s)}${s.swept ? ", after the alarm" : ""}: ${s.word}, wanted ok`;
			const until = (s.value as {readonly expiresAt: number}).expiresAt;
			if (until !== s.at + TTL)
				return `a renew at ${s.at} moved the end to ${until}, not ${s.at + TTL}`;
		}
		return null;
	},
};

/** 7. A renew with an older fence is lost. */
const olderRenewLost: Law = {
	name: "a renew by an older fence is lost",
	check: (r) => {
		for (const s of r.steps) {
			if (s.act.do !== "renew" || s.fence === newestOf(s)) continue;
			if (s.word !== "lost")
				return `a renew by the older fence ${s.fence} (newest ${newestOf(s)}), ${when(s)}: ${s.word}, wanted lost`;
		}
		return null;
	},
};

/**
 * 8. The expiry job stays: once the lease's end plus 1 s has passed with no renew or claim, the
 * alarm writes `lease_expired` once, for the newest fence, at most one tick late and never before,
 * and the lease's row is gone.
 */
const expiryJob: Law = {
	name: "the alarm writes lease_expired once, 1 s after the lease's end, and removes the row",
	check: (r) => {
		let doneFor: number | null = null;
		for (const s of r.steps) {
			if (s.act.do !== "wait") continue;
			const from = s.at;
			const to = s.at + s.act.ms;
			const n = s.expiries.length;
			for (const row of s.expiries) {
				if (s.end === null) return `lease_expired at ${row.at} with no lease`;
				if (fenceIn(row) !== newestOf(s))
					return `lease_expired for fence ${fenceIn(row)}; the newest is ${newestOf(s)}`;
				if (row.at < s.end + GRACE)
					return `lease_expired at ${row.at}, before the end ${s.end} plus ${GRACE} ms`;
				if (row.at > s.end + GRACE + TICK)
					return `lease_expired at ${row.at}, more than one alarm tick after ${s.end + GRACE}`;
			}
			if (s.end === null) continue;
			const due = s.end + GRACE;
			if (doneFor === s.end) {
				if (n > 0) return `a second lease_expired for the lease that ended at ${s.end}`;
			} else if (from < due + TICK && to >= due + TICK && n !== 1) {
				return `the lease ended at ${s.end}; by ${to} the alarm wrote ${n} lease_expired, wanted 1`;
			}
			if (n > 1) return `${n} lease_expired in one wait`;
			if (n === 1) {
				doneFor = s.end;
				if (s.leaseAfter !== null)
					return `after lease_expired at ${s.expiries[0]?.at} the lease row is still there (fence ${s.leaseAfter.fence})`;
			}
		}
		return null;
	},
};

/**
 * 9. Nothing lands twice across a drop and a takeover: one row per id in each stream, a resend of
 * an id that landed is never written again, and no row of a fence lands after a newer claim.
 */
const landsOnce: Law = {
	name: "nothing lands twice across a drop and a takeover",
	check: (r) => {
		for (const s of r.steps)
			if (s.landed && s.word !== "dup" && s.word !== "fenced")
				return `a resend to ${s.where} of an id that landed, by fence ${s.fence}, ${when(s)}: ${s.word}, wanted dup or fenced`;
		const claimsAt = r.registry.filter((row) => row.kind === "claimed").map((row) => row.pos);
		for (const [stream, rows] of r.rows) {
			const ids = rows.flatMap((row) => (row.id === null ? [] : [row.id]));
			const twice = ids.find((id, i) => ids.indexOf(id) !== i);
			if (twice !== undefined) return `id ${twice} landed twice in ${stream}`;
			for (const row of rows) {
				const f = fenceIn(row);
				const next = f === null ? undefined : claimsAt.find((pos) => pos > f);
				if (row.kind === "note" && next !== undefined && row.pos > next)
					return `a row of fence ${f} landed at ${row.pos} in ${stream}, after the newer claim at ${next}`;
			}
		}
		return null;
	},
};

const LAWS: readonly Law[] = [
	olderRefused,
	olderReplyRefused,
	claims,
	olderRenewLost,
	expiryJob,
	landsOnce,
	newestFenceWrites,
	newestAfterAlarm,
	newestRenews,
];

/**
 * Laws that found a bug in the real ledger. Each is run as a known failure that must fail for the
 * rule's reason, so the suite stays green and the day the bug is fixed this list turns red: then
 * the law moves to `LAWS`. Lane 18 built rule B, and its three moved.
 */
const BUGS: readonly (readonly [Law, RegExp])[] = [];

/** The law's own words in what fast-check threw: it keeps the law's error as the cause of its own. */
const messageOf = (e: unknown): string =>
	e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);

const IMPLS = ["memory", "sqlite"] as const;
const implOf = (kind: (typeof IMPLS)[number], mod: Mod = real): Impl => ({kind, mod});

// ---------------------------------------------------------------- planted mistakes

/**
 * The names of the laws a ledger breaks, of those that hold today. A plant needs only to be seen
 * failing, not its smallest case, so fast-check stops at the first failing run and does not shrink
 * it, as the editor's laws do (apps/fabrika/src/editor/editor.laws.test.ts). No law's answer
 * changes: only the search for a smaller case is left out.
 */
const broken = async (impl: Impl): Promise<readonly string[]> => {
	const before = fc.readConfigureGlobal();
	fc.configureGlobal({...before, endOnFailure: true});
	try {
		const out: string[] = [];
		for (const law of LAWS)
			if (
				await assertLaw(law, impl).then(
					() => false,
					() => true,
				)
			)
				out.push(law.name);
		return out;
	} finally {
		fc.configureGlobal(before);
	}
};

/** Each plant edits a copy of the ledger's files, on the one implementation it names. */
const PLANTS: Record<string, {readonly kind: Impl["kind"]; readonly make: () => Promise<Mod>}> = {
	// An older fence's write passes once a newer claim exists: the fence is compared, not matched.
	// Lane 18 moved the write's check from the lease's row to the name's newest fence; the plant
	// follows it, in the write's check alone, as before.
	olderFencePassesSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				"const name = fencedName(db, fence);",
				'const row = db.all("SELECT name FROM names WHERE fence >= ?", fence)[0];\n\tconst name = row ? str(row.name) : null;',
			]),
	},
	olderFencePassesMemory: {
		kind: "memory",
		make: () =>
			plant([
				"memory",
				"const name = fencedName(fence);",
				"const name = [...names].find(([, p]) => p.fence !== null && p.fence >= fence)?.[0] ?? null;",
			]),
	},
	// A fence reaches p0 and px too: the prefix is matched without its slash.
	siblingSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				// oxlint-disable-next-line eslint/no-template-curly-in-string -- the text of a source file; `${name}` is that file's own template, written out as it is
				"const own = stream === name || stream.startsWith(`${name}/`);",
				"const own = stream === name || stream.startsWith(name);",
			]),
	},
	siblingMemory: {
		kind: "memory",
		make: () =>
			plant([
				"memory",
				// oxlint-disable-next-line eslint/no-template-curly-in-string -- the text of a source file; `${name}` is that file's own template, written out as it is
				"return stream === name || stream.startsWith(`${name}/`) || openInbox(stream);",
				"return stream === name || stream.startsWith(name) || openInbox(stream);",
			]),
	},
	// An inbox takes any fence (96's mistake): a lost host's reply lands.
	inboxIgnoresFenceSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				'if (rules.reach === "inbox-ignores-fence" && isOpenInbox(db, rules, stream)) return true;',
				"if (isOpenInbox(db, rules, stream)) return true;",
			]),
	},
	inboxIgnoresFenceMemory: {
		kind: "memory",
		make: () =>
			plant([
				"memory",
				"if (name === null) return false;\n\t\treturn stream === name",
				"if (name === null) return openInbox(stream);\n\t\treturn stream === name",
			]),
	},
	// The id is checked before the fence: a lost host's resend of a landed write answers dup.
	idBeforeFenceSql: {
		kind: "sqlite",
		make: () => plant(["rules", "if (!rules.fenceFirst) {", "if (rules.fenceFirst) {"]),
	},
	// A claim on a live lease is taken.
	claimsLiveSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				'"SELECT holder, expires_at FROM leases WHERE stream = ? AND expires_at > ?",',
				'"SELECT holder, expires_at FROM leases WHERE stream = ? AND expires_at > ? AND 0",',
			]),
	},
	claimsLiveMemory: {
		kind: "memory",
		make: () =>
			plant(["memory", "if (live && live.expiresAt > now)", "if (live && live.expiresAt < 0)"]),
	},
	// A claim past the end waits for the alarm: a dead host is replaced a second late.
	claimWaitsForAlarmSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				'"SELECT holder, expires_at FROM leases WHERE stream = ? AND expires_at > ?",',
				'"SELECT holder, expires_at FROM leases WHERE stream = ? AND expires_at > ? - 1000",',
			]),
	},
	claimWaitsForAlarmMemory: {
		kind: "memory",
		make: () =>
			plant([
				"memory",
				"if (live && live.expiresAt > now)",
				"if (live && live.expiresAt > now - 1000)",
			]),
	},
	// A renew by an older fence moves the lease on: its check takes any fence up to the newest.
	// Lane 18 moved the renew's check to the name's newest fence. On SQL the plant also finds the
	// lease's row by its name alone, as memory.ts does: with the row found by fence, the older
	// fence's renew would insert a second row for the name, the primary key would throw, and every
	// law would break on that, not on the mistake.
	olderRenewsSql: {
		kind: "sqlite",
		make: () =>
			plant(
				[
					"rules",
					'if (fencedName(db, fence) !== name) return {ok: false, why: "lost"};',
					'if (!db.all("SELECT 1 FROM names WHERE name = ? AND fence >= ?", name, fence)[0]) return {ok: false, why: "lost"};',
				],
				[
					"rules",
					'const lease = db.all("SELECT stop FROM leases WHERE stream = ? AND fence = ?", name, fence)[0];',
					'const lease = db.all("SELECT stop FROM leases WHERE stream = ?", name)[0];',
				],
				[
					"rules",
					'"UPDATE leases SET expires_at = ? WHERE stream = ? AND fence = ?",\n\t\t\t\texpiresAt,\n\t\t\t\tname,\n\t\t\t\tfence,',
					'"UPDATE leases SET expires_at = ? WHERE stream = ?",\n\t\t\t\texpiresAt,\n\t\t\t\tname,',
				],
			),
	},
	olderRenewsMemory: {
		kind: "memory",
		make: () =>
			plant([
				"memory",
				'if (names.get(name)?.fence !== fence) return {ok: false, why: "lost"};',
				'if ((names.get(name)?.fence ?? 0) < fence) return {ok: false, why: "lost"};',
			]),
	},
	// The expiry grace grows to 10 minutes: the patient ledger of experiment 149's first try.
	longGraceSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"sqlite",
				"const graceMs = o.graceMs ?? 1000;",
				"const graceMs = o.graceMs ?? 600_000;",
			]),
	},
	longGraceMemory: {
		kind: "memory",
		make: () =>
			plant(["memory", "memoryLedger(o.graceMs ?? 1000,", "memoryLedger(o.graceMs ?? 600_000,"]),
	},
	// The alarm writes lease_expired and leaves the lease's row.
	rowKeptSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				'db.all("DELETE FROM leases WHERE stream = ? AND fence = ?", stream, fence);',
				"",
			]),
	},
	rowKeptMemory: {
		kind: "memory",
		make: () =>
			plant([
				"memory",
				"data: {fence: l.fence, holder: l.holder},\n\t\t\t\t});\n\t\t\t\tleases.delete(name);",
				"data: {fence: l.fence, holder: l.holder},\n\t\t\t\t});",
			]),
	},
	// Experiment 149's first try: a fence is good while its lease's row is there, so until the
	// alarm, not until a newer claim. Added with lane 18: the laws about after the alarm were known
	// bugs until then, which is how each was seen to fail. On SQL every fenced call asks
	// `fencedName`; memory.ts's renew asks the name on its own, so it takes a second edit.
	fenceUntilAlarmSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				'db.all("SELECT name FROM names WHERE fence = ?", fence)',
				'db.all("SELECT stream AS name FROM leases WHERE fence = ?", fence)',
			]),
	},
	fenceUntilAlarmMemory: {
		kind: "memory",
		make: () =>
			plant(
				[
					"memory",
					"const fencedName = (fence: number) => [...names].find(([, p]) => p.fence === fence)?.[0] ?? null;",
					"const fencedName = (fence: number) => [...leases].find(([, l]) => l.fence === fence)?.[0] ?? null;",
				],
				[
					"memory",
					'if (names.get(name)?.fence !== fence) return {ok: false, why: "lost"};',
					'if (leases.get(name)?.fence !== fence) return {ok: false, why: "lost"};',
				],
			),
	},
	// No dedupe: a resend lands again.
	noDedupeSql: {
		kind: "sqlite",
		make: () =>
			plant([
				"rules",
				"const repeat = seen(db, stream, id);\n\tif (repeat) return {ok: true, pos: num(repeat.pos), rev: num(repeat.rev), dup: true};\n\tconst data",
				"const data",
			]),
	},
	noDedupeMemory: {
		kind: "memory",
		make: () =>
			plant([
				"memory",
				"if (repeat) return {ok: true, pos: repeat.pos, rev: repeat.rev, dup: true};",
				"",
			]),
	},
};

// ---------------------------------------------------------------- the tests

describe("the fence's laws (lane 18, rule B)", () => {
	for (const kind of IMPLS) {
		it.each(LAWS.map((law) => [law.name, law] as const))(`${kind}: %s`, async (_, law) => {
			await assertLaw(law, implOf(kind));
		});

		it.each(BUGS.map(([law, how]) => [law.name, law, how] as const))(
			`${kind}: known bug: %s`,
			async (_, law, how) => {
				// fast-check keeps the law's own error as the cause of its own.
				const e = await assertLaw(law, implOf(kind)).then(
					() => null,
					(x: unknown) => x,
				);
				expect(e).toBeInstanceOf(Error);
				expect(messageOf(e)).toMatch(how);
			},
		);
	}

	// Experiment 149's first try (experiments/149-wifi-blips/patient/rules.ts): a fence is good
	// while its lease's row is there, so until the alarm, not until a newer claim. It took three
	// edits on the SQL before lane 18. Rule B now sends every fenced call, writes and renews alike,
	// through `fencedName`, which reads the name's newest fence; 149 read the lease's row instead,
	// so one edit there is 149's rule. The laws tell it from rule B: it keeps every law but the two
	// about after the alarm.
	it("sqlite: experiment 149's ledger fails only the laws about after the alarm", async () => {
		const mod = await plant([
			"rules",
			'db.all("SELECT name FROM names WHERE fence = ?", fence)',
			'db.all("SELECT stream AS name FROM leases WHERE fence = ?", fence)',
		]);
		const out: Record<string, string> = {};
		for (const law of [...LAWS, ...BUGS.map(([l]) => l)])
			out[law.name] = await assertLaw(law, implOf("sqlite", mod)).then(
				() => "holds",
				(e: unknown) => messageOf(e).replace(/\d+/g, "N"),
			);
		expect(out).toEqual({
			...Object.fromEntries([...LAWS, newestFenceWrites].map((law) => [law.name, "holds"])),
			[newestAfterAlarm.name]:
				"a write to state by the newest fence N, at N, N ms past the lease's end, after the alarm: fenced, wanted ok",
			[newestRenews.name]:
				"a renew by the newest fence N, at N, N ms past the lease's end, after the alarm: lost, wanted ok",
		});
	});

	// The exact laws each plant breaks. A plant that breaks more than its own law says why beside it.
	const CAUGHT: Record<string, readonly Law[]> = {
		olderFencePassesSql: [olderRefused, olderReplyRefused, landsOnce],
		olderFencePassesMemory: [olderRefused, olderReplyRefused, landsOnce],
		siblingSql: [olderRefused],
		siblingMemory: [olderRefused],
		// A lost host's reply lands: refused by law 4, and a row of its fence after the newer claim.
		inboxIgnoresFenceSql: [olderReplyRefused, landsOnce],
		inboxIgnoresFenceMemory: [olderReplyRefused, landsOnce],
		idBeforeFenceSql: [olderRefused],
		// On SQL the claim answers ok but the live row stays the old holder's. Before lane 18 the old
		// fence then still wrote and the new one did not, and every law that trusts a claim's answer
		// broke. Rule B keeps the newest fence on the name, so the old fence is refused as it should
		// be. What is left: the new fence's renew finds no row of its own, and the alarm runs on the
		// old row's end, for the old fence.
		claimsLiveSql: [claims, expiryJob, newestRenews],
		claimsLiveMemory: [claims],
		claimWaitsForAlarmSql: [claims],
		claimWaitsForAlarmMemory: [claims],
		// The older renew moves the newer lease on in secret: its end is later than the ledger said.
		olderRenewsSql: [claims, olderRenewLost, expiryJob],
		olderRenewsMemory: [claims, olderRenewLost, expiryJob],
		longGraceSql: [expiryJob],
		longGraceMemory: [expiryJob],
		rowKeptSql: [expiryJob],
		rowKeptMemory: [expiryJob],
		fenceUntilAlarmSql: [newestAfterAlarm, newestRenews],
		fenceUntilAlarmMemory: [newestAfterAlarm, newestRenews],
		// `newestFenceWrites` was a known bug when this list was first written. It sees this plant
		// too: the newest fence's resend of a write that landed answers ok, not dup.
		noDedupeSql: [landsOnce, newestFenceWrites],
		noDedupeMemory: [landsOnce, newestFenceWrites],
	};

	// One test per plant, so each has its own time limit and a failure names its plant. All of
	// sqlite's plants in one test took 30 s on a laptop and ran past the 60 s limit on CI.
	for (const kind of IMPLS) {
		const mine = Object.entries(PLANTS).filter(([, p]) => p.kind === kind);
		it.each(mine)(
			`${kind}: the planted mistake %s fails only the laws it should`,
			async (name, p) => {
				const caught = await broken(implOf(kind, await p.make()));
				expect(caught).toEqual((CAUGHT[name] ?? []).map((law) => law.name));
			},
		);
		// Every law is caught by at least one plant on this ledger: each plant's test above checks
		// that it breaks exactly its list, so the lists are what the plants break.
		it(`${kind}: each law is seen to fail on a planted mistake`, () => {
			const all = new Set(mine.flatMap(([name]) => (CAUGHT[name] ?? []).map((law) => law.name)));
			expect(LAWS.filter((law) => !all.has(law.name)).map((law) => law.name)).toEqual([]);
		});
	}
});
