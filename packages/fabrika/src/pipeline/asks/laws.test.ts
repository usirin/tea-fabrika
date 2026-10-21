import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer} from "effect";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {layerHttp} from "../../host/http.ts";
import {type LawResult, layerPlanted} from "../../host/laws.ts";
import {layerMemory, memoryService} from "../../host/memory.ts";
import {layerSqlite} from "../../host/sqlite.ts";
import {ledgerOptions} from "../../host/worker-options.ts";
import {runPipelineLaws} from "./laws.ts";
import {Ledger} from "./ledger.ts";

// The pipeline's laws on every ledger the tea-host has: the Durable Object (in Miniflare, over
// HTTP), node:sqlite (four connections to one file) and memory. Then two planted mistakes, each of
// which a law must catch.

const dir = mkdtempSync(join(tmpdir(), "pipeline-laws-"));
let mf: Miniflare;
let url = "";
beforeAll(async () => {
	mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
	await mf.ready;
	url = (await mf.unsafeGetDirectURL()).origin;
}, 60_000);
afterAll(async () => {
	await mf.dispose();
});

const lawsOn = (layer: Layer.Layer<Ledger, unknown>) =>
	Effect.runPromise(runPipelineLaws().pipe(Effect.provide(layer), Effect.scoped));
const broken = (rs: readonly LawResult[]) => rs.filter((r) => !r.pass);
const brokenLaws = (rs: readonly LawResult[]) => broken(rs).map((r) => r.law.split(".")[0]);

describe("the pipeline's laws", () => {
	it("hold on the Durable Object", async () => {
		const rs = await lawsOn(layerHttp({url, ledger: "pipeline-laws"}));
		expect(broken(rs)).toEqual([]);
		expect(rs).toHaveLength(5);
	}, 60_000);

	it("hold on node:sqlite, four connections to one file", async () => {
		const rs = await lawsOn(layerSqlite({path: join(dir, "laws.sqlite"), threads: 4}));
		expect(broken(rs)).toEqual([]);
		expect(rs).toHaveLength(5);
	}, 60_000);

	it("hold in memory", async () => {
		const rs = await lawsOn(layerMemory());
		expect(broken(rs)).toEqual([]);
		expect(rs).toHaveLength(5);
	}, 60_000);
});

describe("a planted mistake", () => {
	it("a ledger with no guard, where an unfenced write under a claimed name lands, breaks P2", async () => {
		const rs = await lawsOn(
			layerPlanted(
				join(dir, "no-guard.sqlite"),
				"no guard (95 and 96: an unfenced write under a name lands)",
			),
		);
		expect(brokenLaws(rs)).toContain("P2");
	}, 60_000);

	it("a ledger that hands back one ticket's facts as another's breaks P1", async () => {
		// Every row read from a ticket's stream comes back under the next ticket's name.
		const misread = Layer.effect(
			Ledger,
			Effect.sync(() => {
				const inner = memoryService();
				const moved = (stream: string) =>
					stream.replace(
						/^(pipeline\/ticket\/[^#]+#)(\d+)\//,
						(_, head, n) => `${head}${Number(n) + 1}/`,
					);
				return Ledger.of({
					...inner,
					read: (from, limit, prefix) =>
						inner
							.read(from, limit, prefix)
							.pipe(Effect.map((rows) => rows.map((r) => ({...r, stream: moved(r.stream)})))),
				});
			}),
		);
		const rs = await lawsOn(misread);
		expect(brokenLaws(rs)).toContain("P1");
		expect(broken(rs).find((r) => r.law.startsWith("P1"))?.numbers).toMatch(/read from/);
	}, 60_000);
});
