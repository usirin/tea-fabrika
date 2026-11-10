import {spawn} from "node:child_process";
import {closeSync, mkdirSync, openSync, renameSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {Deferred, Effect, Schema} from "effect";
import type {HostPaths} from "./host/socket.ts";
import type {Project} from "./project.ts";

// The app starts its host: `binary` run as Node on `entry` (`ELECTRON_RUN_AS_NODE`, host/main.ts
// says why), detached, with no stdin or stdout, and let go (`unref`), so quitting the app leaves
// it. Its stderr is appended to the host's own log, so a host that dies before its logger is up
// (a bundle that does not load, a crash in Node itself) still says why:
//
//   yield* startHost({binary: process.execPath, entry: ".../host.mjs", home, paths, project})
//   // <home>/project.json written; <home>/host/log: "SyntaxError: Identifier 'createRequire' …"
//
// Node at its edge, said here. Effect's ChildProcess takes "pipe", "inherit", "ignore" or a Sink
// for stderr. A pipe or a Sink ties the child's stderr to this process, which the host outlives;
// "inherit" sends it wherever the app's own stderr goes, which is nowhere for an app opened from
// the Finder. Handing the child a file descriptor is how a daemon's stderr is kept (launchd's
// StandardErrorPath, systemd's `StandardError=append:`), so this one spawn is Node's.

/** How the app starts a host on `home`, for one checked project. */
export interface HostStart {
	/** The binary to run as Node: the app's own Electron binary, or Node in a test. */
	readonly binary: string;
	/** The host's bundle, host.mjs. */
	readonly entry: string;
	/** The project's durable home: `<appHome>/projects/<key>` (project.ts). */
	readonly home: string;
	readonly paths: HostPaths;
	/**
	 * The checked project the host serves. It is written into the home as `project.json`, which
	 * the host reads and checks again as it starts (host/main.ts); the app always names one. An
	 * inherited `FABRIKA_REPO` is never passed on: the project's root is the only folder its agents
	 * work in. A test of the start itself (start-host.test.ts) names none.
	 */
	readonly project?: Project | undefined;
	/**
	 * The person's settings folder, which holds keybindings.toml (host/settings.ts,
	 * `settingsFolder`), passed as `FABRIKA_SETTINGS`: shared by every project's host. Not said:
	 * the host reads the home's own.
	 */
	readonly settings?: string | undefined;
}

/** The host could not be started at all, and why in words. */
class StartFailed extends Schema.TaggedError<StartFailed>()("StartFailed", {
	why: Schema.String,
}) {}

/** The environment a host starts with: the app's own, less what would name another project. */
const envOf = (s: HostStart): NodeJS.ProcessEnv => {
	const {FABRIKA_REPO: _inherited, ...rest} = process.env;
	return {
		...rest,
		ELECTRON_RUN_AS_NODE: "1",
		FABRIKA_HOME: s.home,
		...(s.settings === undefined ? {} : {FABRIKA_SETTINGS: s.settings}),
	};
};

/**
 * Start the host, let it go, and answer an Effect that ends when it exits. The project's record
 * is written into its home first, beside the file and then over it. The log is opened for
 * appending, in the host's durable folder (mode 0700), and closed in this process once the child
 * has its copy.
 */
export const startHost = (s: HostStart): Effect.Effect<Effect.Effect<number | null>, StartFailed> =>
	Effect.try({
		try: () => {
			if (s.project !== undefined) {
				mkdirSync(s.home, {recursive: true, mode: 0o700});
				const record = join(s.home, "project.json");
				writeFileSync(`${record}.new`, JSON.stringify(s.project), {mode: 0o600});
				renameSync(`${record}.new`, record);
			}
			mkdirSync(dirname(s.paths.log), {recursive: true, mode: 0o700});
			const log = openSync(s.paths.log, "a", 0o600);
			try {
				const child = spawn(s.binary, [s.entry], {
					env: envOf(s),
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
