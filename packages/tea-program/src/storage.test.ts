import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer, Schema} from "effect";
import {KeyValueStore} from "effect/persistence";
import {afterEach, describe, expect, it} from "vitest";
import {memoryStorage, RunRecord, type Storage, storageOf} from "./storage.ts";
import {fileStorage} from "./storage-node.ts";

// Storage keeps a run's record and its machine runs' states past the process.
// Each kind is checked the same way: what one storage value kept, a second one
// over the same place finds (as the next process would), runs on other ids
// find none of it, a newer open makes an older handle stale, and a torn write
// reads as the value before it.

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
});

const go = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
/** The failure's tag, or `ok`. */
const tagOf = <A, E extends {readonly _tag: string}>(effect: Effect.Effect<A, E>) =>
	Effect.runPromise(
		effect.pipe(
			Effect.as("ok"),
			Effect.catch((e) => Effect.succeed(e._tag)),
		),
	);

const kinds: readonly [string, () => () => Storage][] = [
	[
		"in a folder",
		() => {
			const dir = mkdtempSync(join(tmpdir(), "storage-"));
			dirs.push(dir);
			// Each call is a new storage value over the same folder, as the next process would make.
			return () => fileStorage(dir);
		},
	],
	[
		"in memory",
		() => {
			const storage = memoryStorage();
			return () => storage;
		},
	],
];

describe.each(kinds)("storage %s", (_, place) => {
	it("keeps each machine run's state under its id, an id with a slash in it too, apart from other runs", async () => {
		const open = place();
		const r1 = await go(open().open("ship:r1", null));
		await r1.store<{n: number}>("ship", "r1/1/issue/ship").save({n: 1});
		await r1.store<{n: number}>("ship", "other").save({n: 2});
		const r2 = await go(open().open("ship:r2", null));
		await r2.store<{n: number}>("ship", "r1/1/issue/ship").save({n: 3});

		const next = await go(open().open("ship:r1", null));
		const listed = await go(next.list("ship"));
		expect(listed.map((l) => [l.id, l.state]).sort()).toEqual([
			["other", {n: 2}],
			["r1/1/issue/ship", {n: 1}],
		]);
		expect(await next.store("ship", "r1/1/issue/ship").load()).toEqual({n: 1});
		expect(await go(next.read("ship", "nothing"))).toBeNull();
		const r3 = await go(open().open("ship:r3", null));
		expect(await go(r3.list("ship"))).toEqual([]);
	});

	it("keeps one record per run: the flags of its first start, its closed inputs once each, and how it ended", async () => {
		const open = place();
		const first = await go(open().open("ship:r1", {mode: "write"}));
		await go(first.close("pr"));
		await go(first.close("pr"));
		await go(first.end("stopped"));

		const next = await go(open().open("ship:r1", {mode: "read"}));
		expect(next.found).toEqual({
			run: "ship:r1",
			status: "stopped",
			flags: {mode: "write"},
			closed: ["pr"],
			machines: [],
			deadLetters: [],
		});
		// Opened again, it is running: it has not said how this start ends.
		expect((await go(open().record("ship:r1")))?.status).toBe("running");
		expect(await go(open().record("ship:r2"))).toBeNull();
	});

	it("a newer open makes the older handle stale: every write through it fails Stale, and nothing it tried is kept", async () => {
		const open = place();
		const older = await go(open().open("ship:r1", null));
		await older.store<{n: number}>("ship", "k").save({n: 1});
		const newer = await go(open().open("ship:r1", null));

		const save = await older
			.store<{n: number}>("ship", "k")
			.save({n: 2})
			.then(
				() => "ok",
				(e: {readonly _tag: string}) => e._tag,
			);
		expect([
			save,
			await tagOf(older.close("pr")),
			await tagOf(older.clear("ship", "k")),
			await tagOf(older.end("ended")),
		]).toEqual(["Stale", "Stale", "Stale", "Stale"]);

		expect(await go(newer.read("ship", "k"))).toEqual({n: 1});
		expect(newer.found.closed).toEqual([]);
		await newer.store<{n: number}>("ship", "k").save({n: 3});
		expect(await go(newer.read("ship", "k"))).toEqual({n: 3});
		expect((await go(open().record("ship:r1")))?.closed).toEqual([]);
	});

	it("keeps every run, over or not, until its parent clears it; clearing one twice, or one never kept, changes nothing", async () => {
		const open = place();
		const run = await go(open().open("ship:r1", null));
		await run.store<{over: boolean}>("ship", "asked").save({over: true});
		const bare = run.store<{over: boolean}>("ship", "bare");
		await bare.save({over: false});
		await bare.save({over: true});
		expect((await go(open().record("ship:r1")))?.machines).toEqual([
			{machine: "ship", id: "asked"},
			{machine: "ship", id: "bare"},
		]);

		await go(run.clear("ship", "asked"));
		await go(run.clear("ship", "asked"));
		await go(run.clear("ship", "never"));
		expect(await go(run.read("ship", "asked"))).toBeNull();
		expect(await go(run.read("ship", "bare"))).toEqual({over: true});
		await go(run.clear("ship", "bare"));
		expect((await go(open().record("ship:r1")))?.machines).toEqual([]);
	});

	it("reads an index an older start kept, with how long each run was kept: that part is dropped", () => {
		const older = {
			run: "ship:r1",
			status: "stopped",
			flags: null,
			closed: [],
			machines: [{machine: "ship", id: "bare", until: "over"}],
		};
		expect(Schema.decodeUnknownSync(RunRecord)(older).machines).toEqual([
			{machine: "ship", id: "bare"},
		]);
	});

	it("removes a run whole; a handle still on it is stale", async () => {
		const open = place();
		const run = await go(open().open("ship:r1", null));
		await run.store<{n: number}>("ship", "k").save({n: 1});
		await go(open().remove("ship:r1"));

		expect(await go(open().record("ship:r1"))).toBeNull();
		expect(await go(run.read("ship", "k"))).toBeNull();
		expect(await tagOf(run.close("pr"))).toBe("Stale");
	});

	it("keeps a run's outbox: what was sent and not acked is what the next open finds; an ack heard twice changes nothing; a stale handle sends nothing", async () => {
		const open = place();
		const run = await go(open().open("review:r1", null));
		expect(run.unacked).toEqual([]);
		await go(run.sent("passed", 0, {pr: "a", head: "1"}));
		await go(run.sent("passed", 1, {pr: "b", head: "2"}));
		await go(run.sent("note", 0, "c"));
		await go(run.acked("passed", 0));
		await go(run.acked("passed", 0));

		const next = await go(open().open("review:r1", null));
		expect(next.unacked).toEqual([
			{output: "passed", n: 1, value: {pr: "b", head: "2"}},
			{output: "note", n: 0, value: "c"},
		]);
		// The host's record is the same as before: the outbox is the run's own.
		expect(await go(open().record("review:r1"))).not.toHaveProperty("outbox");
		expect(await tagOf(run.sent("passed", 2, "d"))).toBe("Stale");
		expect(await tagOf(run.acked("passed", 1))).toBe("Stale");
	});

	it("moves an outbox line to the dead letters with why, in one write; one not there changes nothing; a stale handle moves nothing (experiment 79)", async () => {
		const open = place();
		const run = await go(open().open("relay:r1", {}));
		await go(run.sent("out", 0, "Abc"));
		await go(run.sent("out", 1, "abc"));
		await go(run.deadLetter("out", 0, "not in small letters"));
		await go(run.deadLetter("out", 0, "again"));
		await go(run.deadLetter("out", 7, "never sent"));

		const next = await go(open().open("relay:r1", {}));
		expect(next.unacked).toEqual([{output: "out", n: 1, value: "abc"}]);
		expect(next.found.deadLetters).toEqual([
			{output: "out", n: 0, value: "Abc", why: "not in small letters"},
		]);
		expect(await tagOf(run.deadLetter("out", 1, "stale"))).toBe("Stale");
		// A record kept before experiment 79 reads with none.
		const old = {run: "relay:r0", status: "ended", flags: {}, closed: [], machines: []};
		expect(Schema.decodeUnknownSync(RunRecord)(old).deadLetters).toEqual([]);
	});

	it("hands back a copy: a state changed after it was saved is not what is found", async () => {
		const run = await go(place()().open("ship:r1", null));
		const state = {n: 1};
		await run.store<{n: number}>("ship", "k").save(state);
		state.n = 2;

		expect(await run.store("ship", "k").load()).toEqual({n: 1});
	});
});

describe("a torn write", () => {
	it("on any KeyValueStore: the slot cut short fails its checksum, and the value before the write is read", async () => {
		let tearNext = false;
		/** A store that writes half of one value, when told to, as a crash mid-write leaves it. */
		const tears = Layer.effect(
			KeyValueStore.KeyValueStore,
			Effect.gen(function* () {
				const real = yield* KeyValueStore.KeyValueStore;
				return KeyValueStore.make({
					...real,
					set: (key, value) => {
						if (!tearNext || typeof value !== "string") return real.set(key, value);
						tearNext = false;
						return real.set(key, value.slice(0, Math.floor(value.length / 2)));
					},
				});
			}),
		).pipe(Layer.provide(KeyValueStore.layerMemory));
		const storage = storageOf(tears);
		const run = await go(storage.open("ship:r1", {mode: "write"}));
		await run.store<{phase: string}>("ship", "k").save({phase: "enqueueing"});

		tearNext = true;
		await run.store<{phase: string}>("ship", "k").save({phase: "queued"});
		expect(await go(run.read("ship", "k"))).toEqual({phase: "enqueueing"});

		tearNext = true;
		await go(run.close("pr"));
		// The record's close was torn: the record before it is read, and a restart opens cleanly on it.
		const next = await go(storage.open("ship:r1", null));
		expect(next.found).toMatchObject({flags: {mode: "write"}, closed: []});
		expect(await go(next.read("ship", "k"))).toEqual({phase: "enqueueing"});
	});

	it("in a folder: a record file cut in half on disk, and the next process opens the run on the record before it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "storage-"));
		dirs.push(dir);
		const run = await go(fileStorage(dir).open("ship:r1", {mode: "write"}));
		await go(run.close("pr"));

		// The record's newest slot, the one the close wrote, cut short as a crash mid-write leaves it.
		const slots = readdirSync(dir).filter((name) => name.includes("record"));
		const newest = slots
			.map((name) => ({name, count: JSON.parse(readFileSync(join(dir, name), "utf8")).count}))
			.sort((a, b) => b.count - a.count)[0];
		if (newest === undefined) throw new Error("no record slot was written");
		const text = readFileSync(join(dir, newest.name), "utf8");
		writeFileSync(join(dir, newest.name), text.slice(0, Math.floor(text.length / 2)));

		const next = await go(fileStorage(dir).open("ship:r1", null));
		expect(next.found).toMatchObject({flags: {mode: "write"}, closed: [], status: "running"});
		await go(next.close("pr"));
		expect((await go(fileStorage(dir).record("ship:r1")))?.closed).toEqual(["pr"]);
	});
});
