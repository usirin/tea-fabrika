import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {folderStorage, type StepLog, type Storage} from "./storage.ts";

// The one place storage touches Node: Effect's `FileSystem`, as Node gives it.
// Everything else in storage is Effect only, so a host with its own
// `FileSystem` (one in a browser) calls `folderStorage(dir, itsOwn)` instead.

/** A storage in a folder on this machine's disk. `steps`: where each machine step goes, if anywhere. */
export const fileStorage = (dir: string, steps?: StepLog): Storage =>
	folderStorage(dir, nodeFileSystem, steps);
