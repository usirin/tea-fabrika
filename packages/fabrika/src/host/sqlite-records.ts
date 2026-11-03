import {Clock, Effect, FileSystem, Path, PubSub, Stream} from "effect";
import {StorageBroken} from "../program/storage.ts";
import {callJob, type Heads, KEYFRAME, keepSpans, migrateJob} from "./job-rules.ts";
import type {Records} from "./records.ts";
import type * as L from "./rules.ts";
import {connect} from "./sqlite-driver.ts";
import type {JobCall} from "./traces.ts";

// A host's jobs' records on the laptop: one SQLite file per job, `<dir>/<trace id>.sqlite`, with
// the same tables and SQL the Durable Object runs (./job-rules.ts). One file per job, as one
// object per job in the ledger's Worker: no table grows with every job ever run, and a job's file
// is all of its record. Nothing in one is ever deleted.
//
//   const records = yield* sqliteRecords({dir: "<home>/records", by: "user:owner"});
//   yield* records.calls(trace, {op: "began", n: 1, text: "seq --to 3 | tally", host: "laptop", at});
//   // <home>/records/<trace>.sqlite made, its tables made, and a change sent for the trace
//
// A record is made by its job's start (`began`), and only by it. A step or a span of a trace no
// job began (tsh's own run, the host's table) is let go, and a read of one reads as empty, as a
// trace nobody wrote does behind the door: a host traces more than its jobs, and none of that
// leaves a file.
//
// `by`: who every write is kept as. Behind the door, the door stamps it; here the host's own
// person is the only writer. The newest `OPEN` files stay open, the rest are closed and opened
// again when next written. All of them close with the scope.
//
// Node at the edge: node:sqlite, through ./sqlite-driver.ts. Each call blocks the caller's thread
// while SQLite runs it, as `layerSqliteSync` does.

/** How many records stay open at once. A job that runs for hours keeps its file open by writing. */
export const OPEN = 16;

const TRACE = /^[0-9a-f]{32}$/;

/** Calls that only read a record: one of a trace no job began reads as empty. */
const reads = (call: JobCall): boolean =>
	call.op === "get" ||
	call.op === "size" ||
	call.op === "keys" ||
	call.op === "read" ||
	call.op === "spanOf";

type Opened = {readonly db: L.Db; readonly close: () => void; readonly heads: Heads};

export const sqliteRecords = (o: {readonly dir: string; readonly by: string}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		yield* fs.makeDirectory(o.dir, {recursive: true, mode: 0o700});
		const open = new Map<string, Opened>();
		/** What a record nobody began reads as: one with no rows, in memory, never written. */
		const empty = connect(":memory:");
		migrateJob(empty.db);
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (const r of open.values()) r.close();
				open.clear();
				empty.close();
			}),
		);
		const written = yield* PubSub.unbounded<string>();
		const fileFor = (trace: string) => path.join(o.dir, `${trace}.sqlite`);
		/** The record of `trace`, opened if it is not: newest last, so the first is the one to close. */
		const openRecord = (trace: string): Opened => {
			const found = open.get(trace);
			if (found !== undefined) {
				open.delete(trace);
				open.set(trace, found);
				return found;
			}
			const made = connect(fileFor(trace));
			migrateJob(made.db);
			const record = {...made, heads: new Map() as Heads};
			open.set(trace, record);
			for (const [oldest, r] of open) {
				if (open.size <= OPEN) break;
				r.close();
				open.delete(oldest);
			}
			return record;
		};
		/** A job began `trace`: its record is open, or its file is there. */
		const began = (trace: string) =>
			open.has(trace)
				? Effect.succeed(true)
				: fs.exists(fileFor(trace)).pipe(Effect.orElseSucceed(() => false));
		/**
		 * Run `run` on the record of `trace`. `makes`: the call that makes it (a job's start).
		 * Otherwise a record no job began is not made: a read reads the empty one, a write is let go.
		 */
		const on = <A>(
			trace: string,
			how: "makes" | "reads" | "writes",
			run: (r: Opened, now: number) => A,
		): Effect.Effect<A | undefined, StorageBroken> =>
			Effect.gen(function* () {
				if (!TRACE.test(trace))
					return yield* new StorageBroken({message: `not a trace id: ${trace}`, cause: null});
				const there = how === "makes" || (yield* began(trace));
				if (!there && how === "writes") return undefined;
				const now = yield* Clock.currentTimeMillis;
				const answer = yield* Effect.try({
					try: () => run(there ? openRecord(trace) : {...empty, heads: new Map() as Heads}, now),
					catch: (cause) => new StorageBroken({message: `the record of ${trace}`, cause}),
				});
				if (how !== "reads") PubSub.publishUnsafe(written, trace);
				return answer;
			});
		const records: Records = {
			calls: (trace, call) =>
				on(trace, call.op === "began" ? "makes" : reads(call) ? "reads" : "writes", (r, now) =>
					callJob(r.db, r.heads, call, o.by, now, KEYFRAME),
				),
			keep: (trace, spans) =>
				spans.length === 0
					? Effect.void
					: on(trace, "writes", (r) => keepSpans(r.db, spans, o.by)).pipe(Effect.asVoid),
			changes: (trace) =>
				Stream.unwrap(
					Effect.map(PubSub.subscribe(written), (heard) =>
						Stream.concat(
							Stream.make(undefined),
							Stream.fromSubscription(heard).pipe(
								Stream.filter((t) => t === trace),
								Stream.map(() => undefined),
							),
						),
					),
				),
		};
		return records;
	});
