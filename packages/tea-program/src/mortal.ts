import {Effect, Layer} from "effect";
import {KeyValueStore} from "effect/persistence";
import {type Storage, storageOf} from "./storage";

// A disk that outlives the processes a test kills, for tests only. Each life
// is one process: its own storage value over the shared disk. `kill` is
// kill -9: from then on nothing that process writes reaches the disk, so
// none of its finalizers (a run's "stopped", a last save) is kept. The next
// life opens the run on what the disk held at the kill.
//
// `before`, when given, runs before each write of that life reaches the
// disk: a test makes a write slow (it waits) or makes it fail, the way a real
// disk sometimes does. A write still waiting when its life is killed never
// lands.

export interface Life {
	readonly storage: Storage;
	/** The process is gone: none of its writes reaches the disk from here on. */
	kill(): void;
}

/** Runs before one write of a life reaches the disk. `key`: the key written; `null` for a clear. */
export type BeforeWrite = (
	key: string | null,
) => Effect.Effect<void, KeyValueStore.KeyValueStoreError>;

/** A shared disk, and a way to start one process over it. */
export function mortalDisk(): {readonly life: (before?: BeforeWrite) => Life} {
	const disk = new Map<string, string>();
	return {
		life: (before = () => Effect.void) => {
			let dead = false;
			const write = (key: string | null, f: () => void) =>
				before(key).pipe(
					Effect.andThen(
						Effect.sync(() => {
							if (!dead) f();
						}),
					),
				);
			const store = KeyValueStore.makeStringOnly({
				get: (key) => Effect.sync(() => disk.get(key)),
				set: (key, value) => write(key, () => disk.set(key, value)),
				remove: (key) => write(key, () => disk.delete(key)),
				clear: write(null, () => disk.clear()),
				size: Effect.sync(() => disk.size),
			});
			return {
				storage: storageOf(Layer.succeed(KeyValueStore.KeyValueStore, store)),
				kill: () => {
					dead = true;
				},
			};
		},
	};
}
