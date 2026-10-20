import {Clock, Duration, Effect, FileSystem, Layer, Option, Path, Schema} from "effect";
import {type Entry, Fact, Ledger} from "./ledger.ts";

// The ledger kept on disk: the same `Ledger` service as `memoryLedger`, over
// one file that holds every fact as one JSON line, oldest first. A fact's
// place is its line number, from 1. Nothing else is kept: every read folds
// the file again, so a fresh process, or a fresh layer over the same file,
// reads what the last one wrote (docs/direction/ledger-behind-a-service.md).
//
//   ledger.jsonl        {"type":"lane","ticket":"o/r#7"}
//                       {"type":"claimed","ticket":"o/r#7","lane":"L1"}
//                       ...
//   ledger.jsonl.lock   there only while one process writes
//
// A write takes the lock file beside the ledger, created with O_EXCL (flag
// `wx`): of two processes, the kernel lets exactly one create it. Under the
// lock the writer reads how many whole lines the file holds, compares that
// with `after`, appends its line, and removes the lock. So `appendAfter` is
// one compare-and-set across processes, and `append` never lands between
// another writer's compare and its line. The lock is held for one read and
// one write; a writer that finds it taken tries again for up to `wait`.
//
// Why a lock file and not `flock` (which ./stages/build/guard.ts takes through
// perl, since Node has none): that lock is held for a builder's whole life,
// so it must go when its process dies. This one is held for milliseconds, and
// a perl process per fact would cost more than the write. The price: a
// process killed while it holds the lock leaves the file behind, and every
// later write fails loudly after `wait`, naming the lock file and the process
// that took it. Nothing is written past it, and nothing is lost.
//
// A line is whole only when its newline is there. A reader skips what comes
// after the last newline: either a writer is between its first byte and its
// last right now, or one was killed there. Nobody was told that fact landed,
// so it never did; the next writer, under the lock, cuts it off before it
// appends. Every whole line must decode as a `Fact`: one that does not stops
// the read with the file and the line number. It is never skipped.
//
// Effect's `encoding/Ndjson` was checked and not taken: its errors carry no
// line number, and it parses a last line that has no newline.
//
// Node at the edge: `process.pid`, written into the lock file so a person can
// tell whose it is.

/** The ledger's file cannot be read or written as facts: where, and why. A defect: the service has no error channel. */
export class LedgerBroken extends Schema.TaggedError<LedgerBroken>()("LedgerBroken", {
	message: Schema.String,
}) {}

const FactLine = Schema.fromJsonString(Fact);
const lineOf = Schema.encodeEffect(FactLine);
const factOf = Schema.decodeUnknownEffect(FactLine);

const NEWLINE = 0x0a;

/** Where the whole lines of `bytes` end: just past the last newline. */
const wholeEnd = (bytes: Uint8Array) => bytes.lastIndexOf(NEWLINE) + 1;

const linesIn = (bytes: Uint8Array, end: number) => {
	let n = 0;
	for (let i = 0; i < end; i++) if (bytes[i] === NEWLINE) n++;
	return n;
};

const broken = (message: string) => Effect.die(new LedgerBroken({message}));

/** Every whole line of `bytes` as an entry, its place its line number. A line that is not a fact stops it. */
const entriesOf = (file: string, bytes: Uint8Array) =>
	Effect.gen(function* () {
		const utf8 = new TextDecoder("utf-8", {fatal: true});
		const end = wholeEnd(bytes);
		const entries: Entry[] = [];
		for (let start = 0, seq = 1; start < end; seq++) {
			const stop = bytes.indexOf(NEWLINE, start);
			const text = yield* Effect.try({
				try: () => utf8.decode(bytes.subarray(start, stop)),
				catch: () => "not UTF-8 text",
			}).pipe(Effect.catch((why) => broken(`${file}:${seq}: ${why}`)));
			const fact = yield* factOf(text).pipe(
				Effect.catch((error) => broken(`${file}:${seq}: not a ledger fact: ${error.message}`)),
			);
			entries.push({seq, fact});
			start = stop + 1;
		}
		return entries;
	});

/** A system error of this kind, from the file system. */
const isReason =
	(tag: "AlreadyExists" | "NotFound") =>
	(error: {readonly reason: {readonly _tag: string}}): boolean =>
		error.reason._tag === tag;

/**
 * A ledger kept in `file`, made if it is not there. Any number of layers, in
 * any number of processes, over one file share it. `wait`: how long a write
 * waits for another writer's lock before it fails.
 */
export function diskLedger(file: string, options: {readonly wait?: Duration.Input} = {}) {
	return Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const lock = `${file}.lock`;
			const wait = Duration.toMillis(options.wait ?? "10 seconds");
			const fail = (doing: string) => (error: {readonly message: string}) =>
				broken(`${file}: cannot ${doing}: ${error.message}`);
			yield* fs
				.makeDirectory(path.dirname(file), {recursive: true})
				.pipe(Effect.catch(fail("make its folder")));

			const read = fs.readFile(file).pipe(
				Effect.catchIf(isReason("NotFound"), () => Effect.succeed(new Uint8Array())),
				Effect.catch(fail("read it")),
			);

			/** One try at the lock: `true` when this process made the lock file. */
			const take = Effect.gen(function* () {
				const since = new Date(yield* Clock.currentTimeMillis).toISOString();
				return yield* fs.writeFileString(lock, `pid ${process.pid} since ${since}\n`, {flag: "wx"});
			}).pipe(
				Effect.as(true),
				Effect.catchIf(isReason("AlreadyExists"), () => Effect.succeed(false)),
				Effect.catch(fail("take its lock")),
			);
			const free = fs.remove(lock, {force: true}).pipe(Effect.catch(fail("let its lock go")));

			/** `body` run while this process holds the lock, and the lock let go after, however it ends. */
			const locked = <A>(body: Effect.Effect<A>) =>
				Effect.gen(function* () {
					const until = (yield* Clock.currentTimeMillis) + wait;
					for (let tries = 1; ; tries++) {
						const done = yield* Effect.acquireUseRelease(
							take,
							(took) => (took ? Effect.map(body, Option.some) : Effect.succeedNone),
							(took) => (took ? free : Effect.void),
						);
						if (Option.isSome(done)) return done.value;
						if ((yield* Clock.currentTimeMillis) >= until) {
							const holder = yield* fs
								.readFileString(lock)
								.pipe(Effect.orElseSucceed(() => "it says no holder"));
							return yield* broken(
								`${lock}: the ledger's lock is still taken after ${wait} ms (${holder.trim()}). If no process writes this ledger, one was killed while it wrote: remove the lock file.`,
							);
						}
						yield* Effect.sleep(Math.min(tries, 20));
					}
				});

			/**
			 * Under the lock: the place of the file's last whole line, and `add`,
			 * which appends `fact` as the next. `decide` says whether to.
			 */
			const atEnd = <A>(
				fact: Fact,
				decide: (last: number, add: Effect.Effect<Entry>) => Effect.Effect<A>,
			) =>
				Effect.gen(function* () {
					const line = yield* lineOf(fact).pipe(Effect.catch(fail("write the fact as a line")));
					return yield* locked(
						Effect.gen(function* () {
							const bytes = yield* read;
							const end = wholeEnd(bytes);
							const last = linesIn(bytes, end);
							const add = Effect.gen(function* () {
								// Bytes past the last newline: a writer killed mid-line. Nobody was told that fact landed.
								if (end < bytes.length)
									yield* fs.truncate(file, end).pipe(Effect.catch(fail("cut a torn last line")));
								yield* fs
									.writeFileString(file, `${line}\n`, {flag: "a"})
									.pipe(Effect.catch(fail("append to it")));
								return {seq: last + 1, fact};
							});
							return yield* decide(last, add);
						}),
					);
				});

			return Ledger.of({
				append: (fact) => atEnd(fact, (_, add) => add),
				appendAfter: (after, fact) =>
					atEnd(fact, (last, add) => (last === after ? add : Effect.succeed(null))),
				entries: read.pipe(Effect.flatMap((bytes) => entriesOf(file, bytes))),
			});
		}),
	);
}
