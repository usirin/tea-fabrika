import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Effect, Schedule, Schema} from "effect";
import {pathsOf, reach} from "./host/socket.ts";
import {type Down, PROTOCOL} from "./link.ts";
import {appWire} from "./wire.ts";

// The app's side of attaching, as `tmux attach` is: connect to the host on the home's socket; if
// none answers, start one, wait for its socket, then connect. Node is named only through
// Effect's `NodeSocket`; how a host is started is handed in (main.ts starts the app's own
// binary as Node, a test runs one in its own process).
//
//   const wire = yield* attach({home, deliver: relay, start});
//   // no host: `start`, then the socket is tried every 50 ms until it answers, or the host exits
//   // a socket left by a crash: the same; the new host removes it before it listens (host/run.ts)
//   // the host speaks another version: Unattached {kind: "version"}, and that host is left running
//   wire.send({type: "page"});
//
// No host is ever stopped from here. A host of another version runs on with its jobs, and the
// app says so plainly (main.ts) instead of attaching.

/** No host could be started, or it did not listen in time. */
export class NoHost extends Schema.TaggedError<NoHost>()("NoHost", {why: Schema.String}) {}

/** How long a host just started has to listen on its socket. */
const LISTEN_WITHIN = "10 seconds";

export const attach = <E, R>(options: {
	readonly home: string;
	readonly deliver: (m: Down) => void;
	/** Start a host on the home, detached. Answers an Effect done when that host exits. */
	readonly start: Effect.Effect<Effect.Effect<unknown, unknown>, E, R>;
	/** The link's version the app speaks, for a test of an old app. */
	readonly ours?: number;
}) =>
	Effect.gen(function* () {
		const {home, deliver, start, ours = PROTOCOL} = options;
		const paths = yield* pathsOf(home);
		if ((yield* reach(paths.sock)) !== "live") {
			const exited = yield* start;
			const listening = reach(paths.sock).pipe(
				Effect.repeat({schedule: Schedule.spaced("50 millis"), until: (r) => r === "live"}),
			);
			yield* Effect.raceFirst(
				listening.pipe(
					Effect.timeoutOrElse({
						duration: LISTEN_WITHIN,
						orElse: () =>
							Effect.fail(new NoHost({why: `the host did not listen within ${LISTEN_WITHIN}`})),
					}),
				),
				exited.pipe(
					Effect.ignore,
					Effect.andThen(
						Effect.fail(new NoHost({why: `the host stopped as it started: see ${paths.log}`})),
					),
				),
			);
		}
		const socket = yield* NodeSocket.makeNet({path: paths.sock});
		const wire = yield* appWire(socket, deliver, ours);
		yield* wire.up;
		return wire;
	});
