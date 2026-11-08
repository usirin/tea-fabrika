import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Effect, Layer, Schema} from "effect";
import {Archive, RecordManager, SpanSink} from "../data/index.ts";
import {nodeSql} from "../data/sqlite.ts";

// This is P37's durable span queue, never a second ledger. Delivery makes no spans.
export const stageRecording = Effect.fn(function* <E>(
	home: string,
	object: string,
	call: (
		target: "record" | "bucket",
		name: string,
		method: string,
		args: ReadonlyArray<unknown>,
	) => Effect.Effect<unknown, E>,
) {
	const db = yield* Effect.acquireRelease(
		Effect.sync(() => {
			mkdirSync(home, {recursive: true});
			const db = new DatabaseSync(join(home, "brain.records.sqlite"));
			db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
			return db;
		}),
		(db) => Effect.sync(() => db.close()),
	);
	return yield* Layer.build(
		Layer.mergeAll(
			SpanSink.layer(nodeSql(db), {object}),
			RecordManager.remote((name) => ({
				write: (...args) =>
					// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
					Effect.runPromise(call("record", name, "write", args)),
				read: (...args) =>
					// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
					Effect.runPromise(call("record", name, "read", args)),
				content: (...args) =>
					// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
					Effect.runPromise(call("record", name, "content", args)),
				deleteContent: (...args) =>
					// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
					Effect.runPromise(call("record", name, "deleteContent", args)),
			})),
			Archive.bucket({
				put: (key, body, sha256) =>
					// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the archive binding requires a Promise
					Effect.runPromise(
						call("bucket", "", "put", [key, [...body], sha256]).pipe(Effect.asVoid),
					),
				head: (key) =>
					// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the archive binding requires a Promise
					Effect.runPromise(archiveHead(call("bucket", "", "head", [key]))),
			}),
		),
	);
});

const archiveHead = Effect.fn(function* <E>(work: Effect.Effect<unknown, E>) {
	return yield* work.pipe(
		Effect.flatMap(
			Schema.decodeUnknownEffect(Schema.NullOr(Schema.Struct({sha256: Schema.String}))),
		),
	);
});
