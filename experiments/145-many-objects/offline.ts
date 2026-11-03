// Question 4's run, shared by its test and the script: a start with the server out of reach.
//
//   1. The app saves two desks on the server and its copy catches up.
//   2. The server stops. The app starts: the desk comes from the copy, marked stale.
//   3. The person moves a tile: the new desk is held under its id, not written anywhere.
//   4. The server comes back (same data, same port). The held desk lands once, and a second send
//      of it is answered `dup`. The copy catches up.
//
// Restores are timed from the server and from the copy.
import {NodeFileSystem, NodePath} from "@effect/platform-node";
import {Ledger} from "@kampus/fabrika-old";
import {Duration, Effect, FileSystem, Layer} from "effect";
import {openCopy} from "./cache.ts";
import {layerObject} from "./client.ts";
import {deskOf, openDesk, SAVED} from "./desk.ts";
import {A, personObject, startServer, user} from "./harness.ts";

const files = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** The median of `n` timed runs of `e`, in ms. */
export const medianMs = <A, E, R>(e: Effect.Effect<A, E, R>, n: number) =>
	Effect.gen(function* () {
		const ms: number[] = [];
		for (let i = 0; i < n; i++) {
			const t0 = performance.now();
			yield* e;
			ms.push(performance.now() - t0);
		}
		ms.sort((a, b) => a - b);
		return Math.round((ms[Math.floor(n / 2)] ?? 0) * 100) / 100;
	});

export const offlineStart = async (o: {readonly samples: number; readonly cacheDir: string}) => {
	const object = personObject(A);
	const lease = 1_000;
	const s1 = await startServer({persist: true});
	const dir = s1.dir ?? "";
	const port = Number(new URL(s1.url).port);
	const a = await s1.as(user(A));
	const layer = layerObject(a, object);
	const [v1, v2, v3] = [deskOf(2, 4), deskOf(3, 6), deskOf(3, 7)];

	const online = await Effect.runPromise(
		Effect.gen(function* () {
			const copy = yield* openCopy(o.cacheDir, s1.url, object);
			const app = yield* openDesk("app-1", lease);
			yield* app.save(v1, "save-1");
			yield* app.save(v2, "save-2");
			const caught = yield* copy.catchUp;
			const fromServer = yield* copy.restore;
			const serverMs = yield* medianMs(copy.restore, o.samples);
			return {caught, fromServer, serverMs};
		}).pipe(Effect.provide(Layer.mergeAll(layer, files))),
	);

	await s1.stop();

	const offline = await Effect.runPromise(
		Effect.gen(function* () {
			const copy = yield* openCopy(o.cacheDir, s1.url, object);
			const fromCopy = yield* copy.restore;
			const copyMs = yield* medianMs(copy.restore, o.samples);
			yield* copy.hold("save-3", v3);
			yield* copy.hold("save-3", v3);
			const held = (yield* copy.held).length;
			const fs = yield* FileSystem.FileSystem;
			const bytes = (yield* fs.stat(copy.files.copy)).size;
			// A copy of another server is no copy.
			const other = yield* openCopy(o.cacheDir, "http://127.0.0.1:1", object);
			const otherRows = (yield* other.load).rows.length;
			return {fromCopy, copyMs, held, bytes: Number(bytes), otherRows};
		}).pipe(Effect.provide(Layer.mergeAll(layer, files))),
	);

	const s2 = await startServer({persist: dir, secret: s1.secret, port});
	try {
		const back = await Effect.runPromise(
			Effect.gen(function* () {
				// The app that saved last is gone: its lease runs out before the desk opens again.
				yield* Effect.sleep(Duration.millis(lease + 200));
				const copy = yield* openCopy(o.cacheDir, s2.url, object);
				const flushed = yield* copy.flush("app-1b", lease);
				// A crash between the send and the forget: the next start sends the same held desk again,
				// once the crashed app's lease ran out.
				yield* copy.hold("save-3", v3);
				yield* Effect.sleep(Duration.millis(lease + 200));
				const again = yield* copy.flush("app-1c", lease);
				const caught = yield* copy.catchUp;
				const l = yield* Ledger;
				const saves = (yield* l.readStream(SAVED)).length;
				const fromServer = yield* copy.restore;
				const copied = yield* copy.load;
				const lastCopied = copied.rows.findLast((r) => r.stream === SAVED);
				return {flushed, again, caught, saves, fromServer, lastCopiedId: lastCopied?.id ?? null};
			}).pipe(
				Effect.provide(Layer.mergeAll(layerObject({url: s2.url, token: a.token}, object), files)),
			),
		);
		return {
			url: {before: s1.url, after: s2.url},
			desks: {v1, v2, v3},
			online,
			offline,
			back,
		};
	} finally {
		await s2.drop();
	}
};
