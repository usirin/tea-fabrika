import {spawn} from "node:child_process";
import {closeSync, mkdirSync, openSync} from "node:fs";
import {Deferred, Effect, Schema} from "effect";
import type {HostPaths} from "./host/socket.ts";

// The app starts its host: `binary` run as Node on `entry` (`ELECTRON_RUN_AS_NODE`, host/main.ts
// says why), detached, with no stdin or stdout, and let go (`unref`), so quitting the app leaves
// it. Its stderr is appended to the host's own log, so a host that dies before its logger is up
// (a bundle that does not load, a crash in Node itself) still says why:
//
//   yield* startHost({binary: process.execPath, entry: ".../host.mjs", home, paths})
//   // <home>/host/log: "SyntaxError: Identifier 'createRequire' has already been declared"
//
// Node at its edge, said here. Effect's ChildProcess takes "pipe", "inherit", "ignore" or a Sink
// for stderr. A pipe or a Sink ties the child's stderr to this process, which the host outlives;
// "inherit" sends it wherever the app's own stderr goes, which is nowhere for an app opened from
// the Finder. Handing the child a file descriptor is how a daemon's stderr is kept (launchd's
// StandardErrorPath, systemd's `StandardError=append:`), so this one spawn is Node's.

/** How the app starts a host on `home`. */
export interface HostStart {
	/** The binary to run as Node: the app's own Electron binary, or Node in a test. */
	readonly binary: string;
	/** The host's bundle, host.mjs. */
	readonly entry: string;
	readonly home: string;
	readonly paths: HostPaths;
}

/** The host could not be started at all, and why in words. */
export class StartFailed extends Schema.TaggedError<StartFailed>()("StartFailed", {
	why: Schema.String,
}) {}

/**
 * Start the host, let it go, and answer an Effect that ends when it exits. The log is opened for
 * appending, in the host's own folder (mode 0700), and closed in this process once the child has
 * its copy.
 */
export const startHost = (s: HostStart): Effect.Effect<Effect.Effect<number | null>, StartFailed> =>
	Effect.try({
		try: () => {
			mkdirSync(s.paths.dir, {recursive: true, mode: 0o700});
			const log = openSync(s.paths.log, "a", 0o600);
			try {
				const child = spawn(s.binary, [s.entry], {
					env: {...process.env, ELECTRON_RUN_AS_NODE: "1", FABRIKA_HOME: s.home},
					detached: true,
					stdio: ["ignore", "ignore", log],
				});
				// Listened to now, as it starts, so an exit before anyone awaits it is not missed.
				const exited = Deferred.makeUnsafe<number | null>();
				child.once("exit", (code) => Deferred.doneUnsafe(exited, Effect.succeed(code)));
				child.once("error", () => Deferred.doneUnsafe(exited, Effect.succeed(null)));
				child.unref();
				return Deferred.await(exited);
			} finally {
				closeSync(log);
			}
		},
		catch: (cause) => new StartFailed({why: `the host could not be started: ${cause}`}),
	});
