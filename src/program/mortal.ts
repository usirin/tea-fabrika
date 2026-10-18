import {Effect, Layer} from "effect";
import {KeyValueStore} from "effect/persistence";
import {type Storage, storageOf} from "./storage.ts";

// A disk that outlives the processes a test kills, for tests only. Each life
// is one process: its own storage value over the shared disk. `kill` is
// kill -9: from then on nothing that process writes reaches the disk, so
// none of its finalizers (a run's "stopped", a last save) is kept. The next
// life opens the run on what the disk held at the kill.

export interface Life {
	readonly storage: Storage;
	/** The process is gone: none of its writes reaches the disk from here on. */
	kill(): void;
}

/** A shared disk, and a way to start one process over it. */
export function mortalDisk(): {readonly life: () => Life} {
	const disk = new Map<string, string>();
	return {
		life: () => {
			let dead = false;
			const write = (f: () => void) =>
				Effect.sync(() => {
					if (!dead) f();
				});
			const store = KeyValueStore.makeStringOnly({
				get: (key) => Effect.sync(() => disk.get(key)),
				set: (key, value) => write(() => disk.set(key, value)),
				remove: (key) => write(() => disk.delete(key)),
				clear: write(() => disk.clear()),
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
