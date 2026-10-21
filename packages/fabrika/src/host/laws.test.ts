import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, type Layer} from "effect";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {layerHttp} from "./http.ts";
import {type LawResult, layerPlanted, PLANTED, type Planted, runLaws} from "./laws.ts";
import type {Ledger} from "./ledger.ts";
import {layerMemory} from "./memory.ts";
import {layerSqlite} from "./sqlite.ts";
import {ledgerOptions} from "./worker-options.ts";

// One law suite, every implementation: the Durable Object (in Miniflare, over HTTP), node:sqlite
// (four threads on one file) and plain memory. Then the SQL under each planted mistake, where the
// same suite must fail.

const dir = mkdtempSync(join(tmpdir(), "tea-host-laws-"));
let mf: Miniflare;
let url = "";
beforeAll(async () => {
	mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
	await mf.ready;
	url = (await mf.unsafeGetDirectURL()).origin;
}, 60_000);
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
	}, 60_000);

	it("hold on node:sqlite, four connections to one file", async () => {
		const rs = await lawsOn(layerSqlite({path: join(dir, "laws.sqlite"), threads: 4}));
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	}, 60_000);

	it("hold in memory", async () => {
		const rs = await lawsOn(layerMemory());
		expect(broken(rs)).toEqual([]);
		expect(rs.length).toBe(27);
	}, 60_000);
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
	}, 60_000);
});
