import type {Store} from "@demlik/tea";
import {
	Cause,
	Context,
	Effect,
	Exit,
	type FileSystem,
	Hash,
	Layer,
	Path,
	Random,
	Schema,
	Scope,
	Semaphore,
} from "effect";
import {KeyValueStore} from "effect/persistence";

// Where a program's runs keep what must outlive the process. The starter hands
// one to `start` with the run's id, the way a Unix daemon is handed its spool
// directory: started again with the same id and the same storage, a run finds
// its unfinished work where it left it.
//
//   const storage = fileStorage(dir);                          // or memoryStorage(), or storageOf(anyKeyValueLayer)
//   const handle = yield* storage.open("ship:r1", {mode: "write"});   // this handle now holds the run
//   handle.found.closed;                                        // what the run's record said when it was opened
//   const store = handle.store("ship", "r1/1/ship");           // a tea Store: kept until it is cleared
//   yield* handle.clear("ship", "r1/1/ship");                   // its parent is done with it: drop it
//   yield* handle.close("pr");                                  // kept before it returns
//   yield* handle.end("ended");
//   yield* storage.open("ship:r1", flags);                      // a newer open: the older handle's next write fails Stale
//
// Like `fs.open` and its file handle: `open` answers a handle, and every write
// goes through it. The starter's handle of a run (`start`'s `{run, close,
// stop}`) holds the run's storage handle; a program never sees it.
//
// It sits on Effect's `KeyValueStore`, so where the bytes go is a Layer:
// memory, a folder through any `FileSystem` (Node's, or one in a browser), SQL,
// Web Storage. Nothing here knows which.
//
// Three rules hold for every write.
//
// 1. One record per run. Its record is the one place that says which open
//    holds the run, the flags it was first started with, the inputs its
//    starter closed, how it last ended, and the index of its machine runs (a
//    `KeyValueStore` cannot list its keys, so the record does).
//
// 2. Atomic. A `KeyValueStore` may write in place (its file layer does), so a
//    crash mid-write can leave half a value. Every value is kept in two slots,
//    each with a checksum, the open count of the handle that wrote it, and a
//    write count. A write goes to the slot that does not hold the newest value,
//    and a read takes the newest slot whose checksum holds. A torn write is a
//    slot that fails its checksum: the read falls back to the other slot, the
//    value before the write.
//
// 3. Fenced. The record counts the run's opens, and each `open` adds one and
//    a random name. Each write through a handle first reads the record and
//    checks that it still names this handle's open. A newer open has taken
//    the run: the write fails with `Stale`, as a stale file handle does, and
//    nothing is written. A slot's open count also orders the reads: a value an
//    older handle wrote never hides one a newer handle wrote. No process id is
//    used, so a folder moved to another machine fences the same way.
//
// A `KeyValueStore` has no compare-and-set, so the check and the write are two
// steps. In one process they are one step: every write of one storage value
// goes through one lock. Across processes there is a window between them; see
// experiments/68a-storage.md.

/** How a run last ended. `running`: it has not said, so it is running now, or it crashed. */
export const RunStatus = Schema.Literals(["running", "ended", "stopped", "failed"]);
export type RunStatus = typeof RunStatus.Type;

/**
 * One machine run, in its run's index. Every one is kept until it is cleared.
 * An index written before experiment 75b also says `until`: decoding drops it.
 */
const Indexed = Schema.Struct({
	machine: Schema.String,
	id: Schema.String,
});
type Indexed = typeof Indexed.Type;

/** One run's record, as a host reads it. */
export const RunRecord = Schema.Struct({
	run: Schema.String,
	status: RunStatus,
	/** As given at the run's first start. */
	flags: Schema.Unknown,
	/** The inputs its starter closed. */
	closed: Schema.Array(Schema.String),
	/** Its machine runs. */
	machines: Schema.Array(Indexed),
});
export type RunRecord = typeof RunRecord.Type;

/** The record as kept: the fence's two values with it, which no caller reads. */
const Kept = Schema.Struct({
	...RunRecord.fields,
	/** How many times the run was opened: the newest open holds it. */
	opened: Schema.Int,
	/** The newest open's random name, so two opens at the same moment are told apart. */
	name: Schema.String,
});
type Kept = typeof Kept.Type;

const publicOf = ({opened: _, name: __, ...record}: Kept): RunRecord => record;

/** A newer open holds the run: this handle's write failed, and nothing was written. */
export class Stale extends Schema.TaggedError<Stale>()("Stale", {
	run: Schema.String,
	message: Schema.String,
}) {}

/** The storage under the run could not be read or written. */
export class StorageBroken extends Schema.TaggedError<StorageBroken>()("StorageBroken", {
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

export type StorageFailed = Stale | StorageBroken;

/** One machine run kept, as the index lists it. */
export interface Listed {
	readonly id: string;
	/** As last saved. */
	readonly state: unknown;
}

/** One open of one run: the only way to write to it. */
export interface Handle {
	readonly run: string;
	/**
	 * The run's record as this handle found it: its closed inputs, its flags,
	 * its machine runs, and how its last start ended (`running`: it never said,
	 * so it crashed, or this is its first start).
	 */
	readonly found: RunRecord;
	/** Where one machine run keeps its state. Hand it to tea's `run` as its `store`. Each save is fenced. */
	store<S>(machine: string, id: string): Store<S>;
	/** Every machine run of one machine the index lists, with its state. */
	list(machine: string): Effect.Effect<readonly Listed[], StorageFailed>;
	/** One machine run's state, read by its id alone. `null`: none is kept. */
	read(machine: string, id: string): Effect.Effect<unknown, StorageFailed>;
	/** Drop one machine run: its parent is done with it. Clearing one that is not kept changes nothing. */
	clear(machine: string, id: string): Effect.Effect<void, StorageFailed>;
	/** Mark an input closed. Kept before it returns. */
	close(input: string): Effect.Effect<void, StorageFailed>;
	/** Say how this start of the run ended. */
	end(status: Exclude<RunStatus, "running">): Effect.Effect<void, StorageFailed>;
}

export interface Storage {
	/** Open a run: the handle every write goes through. Its record is made at the first open; `flags` are kept only then. */
	open(run: string, flags: unknown): Effect.Effect<Handle, StorageFailed>;
	/** A run's record, read only: what a host shows. `null`: no such run. */
	record(run: string): Effect.Effect<RunRecord | null, StorageFailed>;
	/** Remove a run whole: its machine runs, then its record. A handle still on it fails `Stale` at its next write. */
	remove(run: string): Effect.Effect<void, StorageFailed>;
}

// ---------------------------------------------------------------- slots

/** What one slot holds: the value as JSON text, and what tells a whole write from a torn one. */
const Slot = Schema.Struct({
	opened: Schema.Int,
	count: Schema.Int,
	sum: Schema.Number,
	body: Schema.String,
});
const readSlot = Schema.decodeUnknownExit(Schema.fromJsonString(Slot));
const SLOTS = ["a", "b"] as const;
type At = 0 | 1;

/** The newest whole value of a key, and which slot holds it. */
interface Newest {
	readonly at: At;
	readonly opened: number;
	readonly count: number;
	readonly body: string;
}

const newer = (a: Newest | null, b: Newest | null): Newest | null => {
	if (a === null) return b;
	if (b === null) return a;
	if (a.opened !== b.opened) return a.opened > b.opened ? a : b;
	return a.count >= b.count ? a : b;
};

const broken = (message: string) => (cause: unknown) => new StorageBroken({message, cause});

const part = (text: string) => encodeURIComponent(text);
const recordKey = (run: string) => `run/${part(run)}/record`;
const machineKey = (run: string, machine: string, id: string) =>
	`run/${part(run)}/machine/${part(machine)}/${part(id)}`;

const decodeRecord = Schema.decodeUnknownExit(Schema.fromJsonString(Kept));

/** What tea's `Store` expects from a failed Effect: a rejected Promise, with the failure itself as the reason. */
const promised = <A>(effect: Effect.Effect<A, StorageFailed>): Promise<A> =>
	Effect.runPromiseExit(effect).then((exit) =>
		Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
	);

/** A storage over one `KeyValueStore`. `kv`: how to reach it; asked once per call. */
function storageOn(kv: Effect.Effect<KeyValueStore.KeyValueStore, StorageBroken>): Storage {
	// Every write of this storage, through every handle it opened, one at a time: in one process
	// the fence's check and the write it guards are one step.
	const lock = Semaphore.makeUnsafe(1);
	const one = lock.withPermits(1);

	const get = (key: string, at: At) =>
		kv.pipe(
			Effect.flatMap((store) => store.get(`${key}/${SLOTS[at]}`)),
			Effect.mapError(broken(`could not read ${key}`)),
			Effect.map((text): Newest | null => {
				if (text === undefined) return null;
				const exit = readSlot(text);
				if (Exit.isFailure(exit)) return null;
				const slot = exit.value;
				// A torn write: its checksum does not hold. The other slot keeps the value before it.
				if (Hash.string(slot.body) !== slot.sum) return null;
				return {at, opened: slot.opened, count: slot.count, body: slot.body};
			}),
		);

	const read = (key: string) =>
		Effect.all([get(key, 0), get(key, 1)], {concurrency: 1}).pipe(
			Effect.map(([a, b]) => newer(a, b)),
		);

	/** Write over the slot that does not hold `now`, the newest value. Answers the new newest. */
	const write = (key: string, body: string, opened: number, now: Newest | null) => {
		const at: At = now === null ? 0 : now.at === 0 ? 1 : 0;
		const next: Newest = {at, opened, count: (now?.count ?? 0) + 1, body};
		const slot = JSON.stringify({opened, count: next.count, sum: Hash.string(body), body});
		return kv.pipe(
			Effect.flatMap((store) => store.set(`${key}/${SLOTS[at]}`, slot)),
			Effect.mapError(broken(`could not write ${key}`)),
			Effect.as(next),
		);
	};

	/** Remove a key's two slots, the older first: a crash between leaves the key as it was. */
	const drop = (key: string) =>
		Effect.gen(function* () {
			const now = yield* read(key);
			const order: readonly At[] = now === null || now.at === 1 ? [0, 1] : [1, 0];
			const store = yield* kv;
			for (const at of order) {
				const name = `${key}/${SLOTS[at]}`;
				const there = yield* store.has(name).pipe(Effect.mapError(broken(`could not read ${key}`)));
				if (there)
					yield* store.remove(name).pipe(Effect.mapError(broken(`could not remove ${key}`)));
			}
		});

	const readRecord = (run: string) =>
		Effect.gen(function* () {
			const now = yield* read(recordKey(run));
			if (now === null) return null;
			const exit = decodeRecord(now.body);
			if (Exit.isFailure(exit))
				return yield* new StorageBroken({
					message: `the record of ${run} is whole but not a run record`,
					cause: Cause.squash(exit.cause),
				});
			return {now, record: exit.value};
		});

	const parse = (body: string) =>
		Effect.try({try: () => JSON.parse(body) as unknown, catch: broken("a kept state is not JSON")});

	const handleOf = (first: Kept, last: RunStatus): Handle => {
		const {run, opened, name} = first;

		/** The record as it stands, when it still names this handle's open. */
		const fence = Effect.gen(function* () {
			const found = yield* readRecord(run);
			if (found === null)
				return yield* new Stale({
					run,
					message: `${run} was removed while a handle was still on it`,
				});
			if (found.record.opened !== opened || found.record.name !== name)
				return yield* new Stale({
					run,
					message: `${run} was opened again since this handle opened it; this handle may not write`,
				});
			return found;
		});

		const rewrite = (found: {readonly now: Newest}, next: Kept) =>
			write(recordKey(run), JSON.stringify(next), opened, found.now);

		const listed = (record: Kept, machine: string, id: string) =>
			record.machines.some((m) => m.machine === machine && m.id === id);
		const unlisted = (record: Kept, machine: string, id: string): Kept => ({
			...record,
			machines: record.machines.filter((m) => !(m.machine === machine && m.id === id)),
		});

		/** Drop one machine run: its state first, then its line in the index, so the index never names a state that comes back. */
		const dropRun = (machine: string, id: string) =>
			Effect.gen(function* () {
				const found = yield* fence;
				yield* drop(machineKey(run, machine, id));
				if (listed(found.record, machine, id))
					yield* rewrite(found, unlisted(found.record, machine, id));
			});

		const save = <S>(machine: string, id: string, state: S) =>
			Effect.gen(function* () {
				const found = yield* fence;
				// The index first: a crash after it leaves a line with no state, which the next open drops.
				if (!listed(found.record, machine, id))
					yield* rewrite(found, {
						...found.record,
						machines: [...found.record.machines, {machine, id}],
					});
				const at = machineKey(run, machine, id);
				yield* write(at, JSON.stringify(state), opened, yield* read(at));
			}).pipe(one);

		const readRun = (machine: string, id: string) =>
			read(machineKey(run, machine, id)).pipe(
				Effect.flatMap((now) => (now === null ? Effect.succeed(null) : parse(now.body))),
			);

		return {
			run,
			found: {...publicOf(first), status: last},
			store: <S>(machine: string, id: string): Store<S> => ({
				load: () => promised(readRun(machine, id)),
				save: (state) => promised(save(machine, id, state)),
				// Kept by this program's own machine under this name: its own state.
				migrate: (raw) => raw as S | null,
			}),
			list: (machine) =>
				Effect.gen(function* () {
					const found = yield* readRecord(run);
					const out: Listed[] = [];
					for (const m of found?.record.machines ?? []) {
						if (m.machine !== machine) continue;
						const state = yield* readRun(machine, m.id);
						if (state !== null) out.push({id: m.id, state});
					}
					return out;
				}),
			read: readRun,
			clear: (machine, id) => dropRun(machine, id).pipe(one),
			close: (input) =>
				Effect.gen(function* () {
					const found = yield* fence;
					if (found.record.closed.includes(input)) return;
					yield* rewrite(found, {...found.record, closed: [...found.record.closed, input]});
				}).pipe(one),
			end: (status) =>
				Effect.gen(function* () {
					const found = yield* fence;
					yield* rewrite(found, {...found.record, status});
				}).pipe(one),
		};
	};

	const randomName = Effect.all(
		[Random.nextIntBetween(0, 0xffffffff), Random.nextIntBetween(0, 0xffffffff)],
		{concurrency: 1},
	).pipe(Effect.map((ns) => ns.map((n) => n.toString(16).padStart(8, "0")).join("")));

	return {
		open: (run, flags) =>
			Effect.gen(function* () {
				const before = yield* readRecord(run);
				// A machine run the index names with no state left: a crash came between the two writes. Dropped here.
				const machines: Indexed[] = [];
				for (const m of before?.record.machines ?? [])
					if ((yield* read(machineKey(run, m.machine, m.id))) !== null) machines.push(m);
				const record: Kept = {
					run,
					opened: (before?.record.opened ?? 0) + 1,
					name: yield* randomName,
					status: "running",
					flags: before === null ? flags : before.record.flags,
					closed: before?.record.closed ?? [],
					machines,
				};
				yield* write(recordKey(run), JSON.stringify(record), record.opened, before?.now ?? null);
				return handleOf(record, before?.record.status ?? "running");
			}).pipe(one),
		record: (run) =>
			readRecord(run).pipe(Effect.map((found) => (found === null ? null : publicOf(found.record)))),
		remove: (run) =>
			Effect.gen(function* () {
				const found = yield* readRecord(run);
				for (const m of found?.record.machines ?? []) yield* drop(machineKey(run, m.machine, m.id));
				yield* drop(recordKey(run));
			}).pipe(one),
	};
}

/**
 * A storage on any `KeyValueStore` Layer: memory, a folder through any
 * `FileSystem`, SQL, Web Storage. The Layer is built once, at the first use,
 * and lives as long as the storage value does.
 */
export function storageOf<E>(layer: Layer.Layer<KeyValueStore.KeyValueStore, E>): Storage {
	const scope = Scope.makeUnsafe();
	const built = Layer.buildWithScope(layer, scope).pipe(
		Effect.map((context) => Context.get(context, KeyValueStore.KeyValueStore)),
		Effect.mapError(broken("the storage could not be opened")),
	);
	return storageOn(Effect.runSync(Effect.cached(built)));
}

/**
 * A storage in memory: it outlives a run in this process, not the process.
 * Each value is kept as JSON text and read back as a copy, so a test that
 * kills a run and starts it again sees only what was saved, never a live
 * object.
 */
export const memoryStorage = (): Storage => storageOf(KeyValueStore.layerMemory);

/**
 * A storage in a folder, through `fileSystem`: one file per slot, its name
 * the key's. Any `FileSystem` fits: Node's (`./storage-node.ts`), or one in a
 * browser, with no change here.
 */
export const folderStorage = (dir: string, fileSystem: Layer.Layer<FileSystem.FileSystem>) =>
	storageOf(
		KeyValueStore.layerFileSystem(dir).pipe(Layer.provide(fileSystem), Layer.provide(Path.layer)),
	);
