import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Effect, Path, Predicate} from "effect";

// Where the host's socket is, and whether a host answers on it. Shared by the host (host/run.ts),
// which cleans up a socket left by a crash before it listens, and the app (attach.ts), which
// starts a host when none answers. Node is named here through Effect's `NodeSocket` only.
//
// Everything is in the app's home, never at a fixed global path, so a test on a home of its own
// can never reach the owner's host:
//
//   <home>/host/        mode 0700: only the user can open anything in it, as tmux's socket folder
//   <home>/host/sock    the Unix socket, mode 0600
//   <home>/host/pid     the host's pid, for a test to stop its own host
//   <home>/host/lock    held by a host only while it starts, with its pid (host/lock.ts)
//   <home>/host/log     the host's log
//
// macOS lets a socket's path be at most 104 bytes long. A home deep in a temporary folder can
// pass that; `pathsOf` says so plainly instead of letting `listen` fail with a bare EINVAL.

/** The host's files in a home. */
export interface HostPaths {
	readonly dir: string;
	readonly sock: string;
	readonly pid: string;
	readonly lock: string;
	readonly log: string;
}

/** The longest socket path macOS takes, in bytes (`sun_path`, less its closing zero). */
export const MAX_SOCKET_PATH = 103;

export const pathsOf = (home: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const dir = path.join(home, "host");
		const paths: HostPaths = {
			dir,
			sock: path.join(dir, "sock"),
			pid: path.join(dir, "pid"),
			lock: path.join(dir, "lock"),
			log: path.join(dir, "log"),
		};
		if (new TextEncoder().encode(paths.sock).length > MAX_SOCKET_PATH)
			return yield* Effect.die(
				`the host's socket path is longer than ${MAX_SOCKET_PATH} bytes: use a shorter home`,
			);
		return paths;
	});

/** What answers on a socket path: a host, nothing at all, or a file left by a host that is gone. */
export type Reached = "live" | "absent" | "stale";

const codeOf = (cause: unknown): unknown =>
	Predicate.hasProperty(cause, "code") ? cause.code : undefined;

/** Does a host answer on `sock`? It opens a connection and closes it at once. */
export const reach = (sock: string): Effect.Effect<Reached> =>
	Effect.gen(function* () {
		const socket = yield* NodeSocket.makeNet({path: sock, openTimeout: "2 seconds"});
		return yield* Effect.scoped(socket.reader).pipe(
			Effect.as<Reached>("live"),
			Effect.catch((e) => {
				const cause = e.reason._tag === "SocketOpenError" ? e.reason.cause : undefined;
				const code = codeOf(cause);
				if (code === "ENOENT") return Effect.succeed<Reached>("absent");
				// A socket file no one listens on: its host crashed, or was killed. Or a file that is no
				// socket at all, in a folder only the user can write.
				if (code === "ECONNREFUSED" || code === "ENOTSOCK") return Effect.succeed<Reached>("stale");
				return Effect.die(e);
			}),
		);
	});
