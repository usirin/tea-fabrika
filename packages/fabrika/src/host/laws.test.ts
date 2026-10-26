import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Duration, Effect, type Layer} from "effect";
import {TestClock} from "effect/testing";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {layerInside} from "./inside.ts";
import {
	type LawResult,
	law3Fencing,
	law12PrefixFence,
	law18Reply,
	law30Wall,
	layerPlanted,
	PLANTED,
	type Planted,
	runLaws,
	timeOf,
} from "./laws.ts";
import {Ledger} from "./ledger.ts";
import {layerMemory} from "./memory.ts";
import {layerSqlite, layerSqliteSync} from "./sqlite.ts";
import {ledgerOptions} from "./worker-options.ts";

// One law suite, every implementation: the Durable Object (in Miniflare, over HTTP), node:sqlite
// (four threads on one file, then one connection in this thread) and plain memory. Then the SQL
// under each planted mistake, where the same suite must fail.
//
// The time (lane 21): the ledgers in this process run on a clock the test owns, a `TestClock`
// under both the ledger and the suite, so a law jumps past a lease's end with no sleeping. The
// Durable Object keeps its own real clock, and there a law asks the ledger the time.

const dir = mkdtempSync(join(tmpdir(), "tea-host-laws-"));
let mf: Miniflare;
beforeAll(async () => {
	mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
	await mf.ready;
});
afterAll(async () => {
	await mf.dispose();
	rmSync(dir, {recursive: true, force: true});
});

/** The clock the test owns. A minute before it warns that nothing moves it, as a law may not. */
const owned = TestClock.layer({warningDelay: Duration.minutes(1)});
/** The suite on `layer`, on the ledger's own clock. */
const lawsOn = (layer: Layer.Layer<Ledger, unknown>) =>
	Effect.runPromise(
		runLaws({alarm: true, graceMs: 1000}).pipe(Effect.provide(layer), Effect.scoped),
	);
/** The suite on `layer` built under the test's clock, so the ledger and the laws share it. */
const lawsOnOwnedClock = (layer: Layer.Layer<Ledger, unknown>) =>
	Effect.runPromise(
		runLaws({alarm: true, graceMs: 1000}).pipe(
			Effect.provide(layer),
			Effect.scoped,
			Effect.provide(owned),
		),
	);
const broken = (rs: readonly LawResult[]) => rs.filter((r) => !r.pass);

describe("the ledger's laws", () => {
	it("hold on the Durable Object", async () => {
		const rs = await lawsOn(layerInside(mf, "laws"));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});

	it("hold on node:sqlite, four connections to one file", async () => {
		const rs = await lawsOnOwnedClock(layerSqlite({path: join(dir, "laws.sqlite"), threads: 4}));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});

	it("hold on node:sqlite, one connection in this thread", async () => {
		const rs = await lawsOnOwnedClock(layerSqliteSync({path: join(dir, "laws-sync.sqlite")}));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});

	it("hold in memory", async () => {
		const rs = await lawsOnOwnedClock(layerMemory());
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});
});

describe("a test machine whose clock is off from the Durable Object's", () => {
	// Experiment 144: on Cloudflare a busy object's clock read up to 0.1 s behind the test's, and
	// laws 3, 12 and 18, which waited on the test's clock, flipped. Here the test's own clock is
	// moved by `skew`; workerd runs in its own process, so the object's is not.
	for (const skew of [200, -200]) {
		it(`leaves laws 3, 12 and 18 holding with it ${skew} ms off`, async () => {
			const real = Date.now;
			const moved = vi.spyOn(Date, "now").mockImplementation(() => real.call(Date) + skew);
			try {
				const {off, rs} = await Effect.runPromise(
					Effect.gen(function* () {
						const l = yield* Ledger;
						const ledgerNow = yield* (yield* timeOf(l)).now;
						const off = Date.now() - ledgerNow;
						const rs = yield* Effect.all(
							[law3Fencing(l, 1000), law12PrefixFence(l, 1000), law18Reply(l, 1000)],
							{concurrency: "unbounded"},
						);
						return {off, rs};
					}).pipe(Effect.provide(layerInside(mf, `laws-skew${skew}`)), Effect.scoped),
				);
				// The skew is there: this machine's clock reads `skew` ahead of the object's.
				expect(Math.abs(off - skew)).toBeLessThan(100);
				expect(broken(rs)).toEqual([]);
			} finally {
				moved.mockRestore();
			}
		});
	}
});

describe("a ledger that runs each call late", () => {
	// A busy machine: the ledger stamps a call's time when it runs it, here 200 ms after the law
	// asked. A law about time must count from the ledger's clock, or this is a WRONG, not a law.
	const late = (l: Ledger["Service"]): Ledger["Service"] => ({
		...l,
		startChild: (...a) => Effect.delay(l.startChild(...a), Duration.millis(200)),
	});

	it("still holds law 30", async () => {
		const r = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* law30Wall(late(yield* Ledger));
			}).pipe(Effect.provide(layerMemory()), Effect.scoped),
		);
		expect(broken([r])).toEqual([]);
	});
});

describe("every planted mistake", () => {
	it("breaks at least one law", async () => {
		const names = Object.keys(PLANTED).filter((k): k is Planted => k in PLANTED);
		const caught = await Effect.runPromise(
			Effect.forEach(
				names,
				(name, i) =>
					runLaws().pipe(
						Effect.provide(layerPlanted(join(dir, `planted-${i}.sqlite`), name)),
						Effect.scoped,
						// Each on its own clock: one ledger's jumps must not move another's.
						Effect.provide(owned),
						Effect.map((rs) => ({name, by: broken(rs).map((r) => r.law.split(".")[0])})),
					),
				{concurrency: "unbounded"},
			),
		);
		expect(caught.filter((c) => c.by.length === 0)).toEqual([]);
		// 102's plants are caught by 102's laws, not by chance elsewhere.
		const limits = ["26", "27", "28", "29", "30"];
		expect(
			caught.filter((c) => c.name.endsWith("(102)") && !c.by.some((b) => limits.includes(b ?? ""))),
		).toEqual([]);
		expect(caught.length).toBe(34);
	});
});
