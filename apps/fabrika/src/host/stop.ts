import {Effect, FileSystem, Predicate, Schedule, Schema} from "effect";
import {pathsOf, reach} from "./socket.ts";

// Stop the host on a home, by the pid in `<home>/host/pid`, and wait for it to exit: what the
// window's "Stop the old host and start this one" does first (main.ts), before it attaches and so
// starts a host of its own build. As `tmux kill-server`: SIGTERM, which the host takes as its end
// (host/main.ts). Its scope closes, every tile's tsh stops, their jobs stay kept for `attach %n`
// at the next start, and the socket and the pid file go.
//
//   yield* stopHost(home)
//   // "stopped": a host answered, its pid was sent SIGTERM, and it exited within 10 s
//   // "none": no host answers on the socket, so nothing is sent to anyone
//   // NotStopped: the pid file names no pid, or one of another user's, or this very process, or
//   //             the host still runs 10 s on
//
// The pid is only read while a host answers on the socket. The pid file is written by the host
// that listens, under the start lock, and removed while it still listens (host/run.ts), so a
// live socket and its pid file name the same process. A pid file left by a host that was killed
// sits beside a dead socket, and is never acted on: its pid may be another process's by now.
//
// Node at its thinnest edge, said here: `process.kill`, with SIGTERM to stop and with 0 to ask
// whether the pid still runs, and `process.pid`. Effect's platform has neither for a process it
// did not start.

/** The host could not be stopped, and why, in words for the window. */
export class NotStopped extends Schema.TaggedError<NotStopped>()("NotStopped", {
	why: Schema.String,
}) {}

/** How long a host has to exit once told to. Its tiles stop in a few ms. */
const EXIT_WITHIN = "10 seconds";

const codeOf = (e: unknown) => (Predicate.hasProperty(e, "code") ? String(e.code) : "unknown");

/** Send `signal` to `pid`: sent, gone already, or why not. */
const send = (pid: number, signal: NodeJS.Signals | 0) =>
	Effect.try({try: () => process.kill(pid, signal), catch: codeOf}).pipe(
		Effect.as("sent" as const),
		Effect.catch((code) =>
			code === "ESRCH" ? Effect.succeed("gone" as const) : Effect.fail(code),
		),
	);

export const stopHost = (home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* pathsOf(home);
		if ((yield* reach(paths.sock)) !== "live") return "none" as const;
		const text = yield* fs.readFileString(paths.pid).pipe(Effect.orElseSucceed(() => ""));
		const pid = Number(text.trim());
		if (!Number.isSafeInteger(pid) || pid <= 1)
			return yield* new NotStopped({why: `${paths.pid} names no host's pid`});
		if (pid === process.pid)
			return yield* new NotStopped({why: `${paths.pid} names this process, not a host`});
		const told = yield* send(pid, "SIGTERM").pipe(
			Effect.mapError(
				(code) => new NotStopped({why: `the host's pid ${pid} could not be told to stop: ${code}`}),
			),
		);
		if (told === "gone") return "stopped" as const;
		yield* send(pid, 0).pipe(
			Effect.orElseSucceed(() => "sent" as const),
			Effect.repeat({schedule: Schedule.spaced("50 millis"), until: (r) => r === "gone"}),
			Effect.timeoutOrElse({
				duration: EXIT_WITHIN,
				orElse: () =>
					Effect.fail(new NotStopped({why: `the host's pid ${pid} still runs ${EXIT_WITHIN} on`})),
			}),
		);
		return "stopped" as const;
	});
