import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Duration, Effect, type Layer} from "effect";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {layerHttp} from "./http.ts";
import {type LawResult, law30Wall, layerPlanted, PLANTED, type Planted, runLaws} from "./laws.ts";
import {Ledger} from "./ledger.ts";
import {layerMemory} from "./memory.ts";
import {layerSqlite, layerSqliteSync} from "./sqlite.ts";
import {ledgerOptions} from "./worker-options.ts";

// One law suite, every implementation: the Durable Object (in Miniflare, over HTTP), node:sqlite
// (four threads on one file, then one connection in this thread) and plain memory. Then the SQL
// under each planted mistake, where the same suite must fail.

const dir = mkdtempSync(join(tmpdir(), "tea-host-laws-"));
let mf: Miniflare;
let url = "";
beforeAll(async () => {
	mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
	await mf.ready;
	url = (await mf.unsafeGetDirectURL()).origin;
});
afterAll(async () => {
	await mf.dispose();
	rmSync(dir, {recursive: true, force: true});
});

const lawsOn = (layer: Layer.Layer<Ledger, unknown>) =>
	Effect.runPromise(
		runLaws({alarm: true, graceMs: 1000}).pipe(Effect.provide(layer), Effect.scoped),
	);
const broken = (rs: readonly LawResult[]) => rs.filter((r) => !r.pass);

describe("the ledger's laws", () => {
	it("hold on the Durable Object", async () => {
		const rs = await lawsOn(layerHttp({url, ledger: "laws"}));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});

	it("hold on node:sqlite, four connections to one file", async () => {
		const rs = await lawsOn(layerSqlite({path: join(dir, "laws.sqlite"), threads: 4}));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});

	it("hold on node:sqlite, one connection in this thread", async () => {
		const rs = await lawsOn(layerSqliteSync({path: join(dir, "laws-sync.sqlite")}));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});

	it("hold in memory", async () => {
		const rs = await lawsOn(layerMemory());
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	});
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
