// Experiment 145: one ledger server, many Durable Objects. Every number in the write-up comes from
// this script, run on Miniflare on one laptop. No deploy, no Cloudflare account, no model, $0.
//
//   node experiments/145-many-objects.ts
//
// Writes experiments/results/145-many-objects.json. The tests beside the prototype
// (`experiments/145-many-objects/*.test.ts`) check the same things with asserts.
//
// Node at the edge: temp folders, and writing the results file.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger} from "@kampus/fabrika";
import {type LawResult, runLaws} from "@kampus/fabrika/laws";
import {layerLocal} from "@kampus/fabrika/local";
import {Effect, type Layer} from "effect";
import {accessLaws, type Law} from "./145-many-objects/access.ts";
import {door, httpLayer, layerObject} from "./145-many-objects/client.ts";
import {deskOf, openDesk, restore} from "./145-many-objects/desk.ts";
import {fill} from "./145-many-objects/fill.ts";
import {
	A,
	agent,
	OPERATOR,
	personObject,
	type Running,
	startServer,
	user,
} from "./145-many-objects/harness.ts";
import {layerLanes} from "./145-many-objects/lanes.ts";
import {moveObject, moveServer} from "./145-many-objects/move.ts";
import {medianMs, offlineStart} from "./145-many-objects/offline.ts";
import {runCounter} from "./145-many-objects/programs.ts";
import {PLANTED, type Planted} from "./145-many-objects/router.ts";

const SAMPLES = 50;
const log = (s: string) => process.stdout.write(`${s}\n`);
const on = <A, E>(e: Effect.Effect<A, E, Ledger>, layer: Layer.Layer<Ledger, unknown>) =>
	Effect.runPromise(e.pipe(Effect.provide(layer), Effect.scoped));
const create = async (s: Running, project: string, founder: string) =>
	Effect.runPromise(
		door(await s.as(user(OPERATOR)), project, "create", {founder}).pipe(Effect.provide(httpLayer)),
	);

// ---------------------------------------------------------------- 2. access, and its plants

const access = async () => {
	const lawsOn = async (planted?: string) => {
		const s = await startServer(planted === undefined ? {} : {planted});
		try {
			return await Effect.runPromise(accessLaws(s));
		} finally {
			await s.drop();
		}
	};
	const broken = (laws: readonly Law[]) =>
		laws.filter((l) => !l.pass).map((l) => l.law.split(".")[0]);
	const clean = await lawsOn();
	const plants = [
		...Object.keys(PLANTED).filter((p): p is Planted => p in PLANTED),
		"route-by-prefix,name-check-off",
	];
	const caught: {plant: string; broke: string[]}[] = [];
	for (const p of plants)
		caught.push({plant: p, broke: (await lawsOn(p)).flatMap((l) => (l.pass ? [] : [l.law]))});
	log(`access: ${clean.filter((l) => l.pass).length}/${clean.length} laws hold`);
	for (const c of caught)
		log(`  ${c.plant}: breaks ${c.broke.map((l) => l.split(".")[0]).join(", ") || "nothing"}`);
	return {laws: clean, plants: caught, cleanBroken: broken(clean)};
};

// ---------------------------------------------------------------- 1. the router, 3. the desk

const routerAndDesk = async () => {
	const s = await startServer();
	try {
		await create(s, "project/acme", A);
		const builder = await s.as(agent(A, "builder"));
		const a = await s.as(user(A));
		const project = layerObject(builder, "project/acme");
		const lane = layerObject(builder, "lane/acme~build");
		const person = layerObject(a, personObject(A));
		// The same counter, unchanged, on three kinds of object.
		const counters = {
			project: await on(runCounter("h-p", 20), project),
			lane: await on(runCounter("h-l", 20), lane),
			person: await on(runCounter("h-a", 20), person),
		};
		// One small read through the router and the door, on each kind.
		const read = Effect.gen(function* () {
			const l = yield* Ledger;
			return yield* l.readLast("counter:1/state", 1);
		});
		// The same read on the package's own local ledger: one object, no door, no router.
		const baseDir = mkdtempSync(join(tmpdir(), "exp145-base-"));
		const base = layerLocal({persist: baseDir, ledger: "base"});
		const package_ = await on(
			runCounter("h-b", 20).pipe(Effect.andThen(medianMs(read, SAMPLES))),
			base,
		).finally(() => rmSync(baseDir, {recursive: true, force: true}));
		const readMs = {
			project: await on(medianMs(read, SAMPLES), project),
			lane: await on(medianMs(read, SAMPLES), lane),
			person: await on(medianMs(read, SAMPLES), person),
			package: package_,
		};
		log(`router: one read ${JSON.stringify(readMs)} ms (median of ${SAMPLES})`);
		// The desk: save and restore, a small one and a big one.
		const desks = [
			{name: "3 workspaces, 6 tiles each", desk: deskOf(3, 6)},
			{name: "8 workspaces, 12 tiles each", desk: deskOf(8, 12)},
		];
		const desk = [];
		for (const d of desks) {
			const r = await on(
				Effect.gen(function* () {
					const open = yield* openDesk(`app-${d.name}`, 30_000);
					let n = 0;
					const saveMs = yield* medianMs(
						Effect.suspend(() => open.save(d.desk, `s-${d.name}-${n++}`)),
						SAMPLES,
					);
					const restoreMs = yield* medianMs(restore, SAMPLES);
					const back = yield* restore;
					const l = yield* Ledger;
					yield* l.renew("desk", open.fence, 1);
					return {saveMs, restoreMs, same: JSON.stringify(back) === JSON.stringify(d.desk)};
				}),
				person,
			);
			// Let the short lease end before the next desk opens.
			await Effect.runPromise(Effect.sleep("1200 millis"));
			desk.push({name: d.name, bytes: JSON.stringify(d.desk).length, ...r});
		}
		for (const d of desk)
			log(`desk: ${d.name}, ${d.bytes} B: save ${d.saveMs} ms, restore ${d.restoreMs} ms`);
		return {counters, readMs, desk};
	} finally {
		await s.drop();
	}
};

// ---------------------------------------------------------------- 4. offline start

const offline = async () => {
	const cacheDir = mkdtempSync(join(tmpdir(), "exp145-cache-"));
	try {
		const r = await offlineStart({samples: SAMPLES, cacheDir});
		log(
			`offline: restore from server ${r.online.serverMs} ms, from copy ${r.offline.copyMs} ms; copy ${r.offline.bytes} B; flush ${JSON.stringify(r.back.flushed)}, again ${JSON.stringify(r.back.again)}`,
		);
		return r;
	} finally {
		rmSync(cacheDir, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------- 5. move a whole server

const move = async () => {
	const from = await startServer({persist: true});
	// Each run moves onto its own empty server: pages of 500 rows, then of 100.
	const pages = [500, 100];
	const targets = await Promise.all(pages.map(() => startServer({persist: true})));
	try {
		const shape = {projects: 6, people: 20, saves: 50, messages: 10, leaseMs: 60_000};
		const t0 = performance.now();
		const filled = await fill(from, shape);
		const fillMs = performance.now() - t0;
		const f = await from.as(user(OPERATOR));
		const runs = [];
		for (const [i, page] of pages.entries()) {
			const target = targets[i];
			if (target === undefined) continue;
			const t = await target.as(user(OPERATOR));
			const m = await Effect.runPromise(moveServer(f, t, 4, page).pipe(Effect.provide(httpLayer)));
			const slowest = [...m.objects].sort((a, b) => b.ms - a.ms).slice(0, 3);
			runs.push({
				page,
				objects: m.objects.length,
				rows: m.rows,
				ms: Math.round(m.ms),
				allSame: m.allSame,
				sameIndex: m.sameIndex,
				slowest: slowest.map((o) => ({object: o.object, rows: o.rows, ms: Math.round(o.ms)})),
			});
			log(
				`move (page ${page}): ${m.objects.length} objects, ${m.rows} rows, ${Math.round(m.ms)} ms, all hashes match: ${m.allSame}`,
			);
		}
		return {shape, fillMs: Math.round(fillMs), objects: filled.objects.length, runs};
	} finally {
		await Promise.all([from, ...targets].map((s) => s.drop()));
	}
};

/** One big object: a person with `saves` small desks, moved alone, to see one object's rate. */
const moveBig = async (saves: number) => {
	const from = await startServer({persist: true});
	const pages = [500, 2000];
	const targets = await Promise.all(pages.map(() => startServer({persist: true})));
	try {
		const p = "github:3001";
		await on(
			Effect.gen(function* () {
				const d = yield* openDesk("app-big");
				yield* Effect.forEach(
					Array.from({length: saves}, (_, k) => k),
					(k) => d.save(deskOf(1, 2), `big-${k}`),
					{concurrency: 8, discard: true},
				);
			}),
			layerObject(await from.as(user(p)), personObject(p)),
		);
		const f = await from.as(user(OPERATOR));
		const runs = [];
		for (const [i, page] of pages.entries()) {
			const target = targets[i];
			if (target === undefined) continue;
			const t = await target.as(user(OPERATOR));
			const m = await Effect.runPromise(
				moveObject(f, t, personObject(p), page).pipe(Effect.provide(httpLayer)),
			);
			const rowsPerSecond = Math.round(m.rows / (m.ms / 1000));
			runs.push({page, rows: m.rows, ms: Math.round(m.ms), same: m.same, rowsPerSecond});
			log(
				`move one big object (page ${page}): ${m.rows} rows, ${Math.round(m.ms)} ms, hashes match: ${m.same}`,
			);
		}
		return {saves, runs};
	} finally {
		await Promise.all([from, ...targets].map((s) => s.drop()));
	}
};

// ---------------------------------------------------------------- 6. lane objects

const lanes = async () => {
	const s = await startServer();
	try {
		await create(s, "project/lab", A);
		const builder = await s.as(agent(A, "builder"));
		const lawsOn = (layer: Layer.Layer<Ledger, unknown>) =>
			Effect.runPromise(
				runLaws({alarm: true, graceMs: 1000}).pipe(Effect.provide(layer), Effect.scoped),
			);
		const summary = (rs: readonly LawResult[]) => ({
			pass: rs.filter((r) => r.pass).length,
			of: rs.length,
			broken: rs
				.filter((r) => !r.pass)
				.map((r) => ({law: r.law, numbers: r.numbers.slice(0, 400)})),
		});
		const one = summary(await lawsOn(layerObject(builder, "project/lab")));
		const table = [];
		const home = [];
		for (let i = 0; i < 3; i++) {
			table.push(summary(await lawsOn(layerLanes(builder, "lab", "table"))));
			home.push(summary(await lawsOn(layerLanes(builder, "lab", "home"))));
		}
		const ids = (r: {broken: {law: string}[]}) =>
			r.broken.map((b) => b.law.split(".")[0]).join(",");
		log(
			`lanes: one object ${one.pass}/${one.of}; table ${table.map(ids).join(" | ")}; home ${home.map(ids).join(" | ")}`,
		);
		return {one, table, home};
	} finally {
		await s.drop();
	}
};

const results = {
	experiment: 145,
	date: new Date().toISOString().slice(0, 10),
	machine: "one laptop, Miniflare in this process, workerd on 127.0.0.1",
	cost: "$0: no model, no Jev, no Cloudflare account, no deploy",
	access: await access(),
	routerAndDesk: await routerAndDesk(),
	offline: await offline(),
	move: await move(),
	moveBig: await moveBig(10_000),
	lanes: await lanes(),
};
writeFileSync(
	new URL("./results/145-many-objects.json", import.meta.url),
	`${JSON.stringify(results, null, "\t")}\n`,
);
log("wrote experiments/results/145-many-objects.json");
