import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Effect, Exit, Schedule, Schema, Scope} from "effect";
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
//   // two apps at once on one home: each starts a host; the hosts take turns under a lock, one
//   // listens and the other steps aside, and both apps attach to the one that listens
//   // the host speaks another version: Unattached {kind: "version"}, and that host is left running
//   // a host that answers on its socket but says no hello within 10 s: NoHello
//   wire.send({type: "page"});
//
// No host is ever stopped from here. A host of another version runs on with its jobs, and the
// app says so plainly (main.ts) instead of attaching. A try that does not come up closes its own
// socket before it fails, so nothing of it is left open.

/** No host could be started, or it did not listen in time. */
export class NoHost extends Schema.TaggedError<NoHost>()("NoHost", {why: Schema.String}) {}

/** A host answered on its socket, but said no hello in time. */
export class NoHello extends Schema.TaggedError<NoHello>()("NoHello", {within: Schema.String}) {}

/** How long a host just started has to listen on its socket. */
const LISTEN_WITHIN = "10 seconds";

/**
 * How long a host that answers on its socket has to say hello. The same as `LISTEN_WITHIN`, and
 * as long as VS Code waits for its remote server's first answer in the handshake (10000 ms, in
 * `remoteAgentConnection.ts`). A host on the same laptop answers in a few milliseconds.
 */
const HELLO_WITHIN = "10 seconds";

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
				// The host it started stopped. It may have stepped aside for a host another app started
				// at the same moment (host/run.ts): then that one answers, and the app attaches to it.
				exited.pipe(
					Effect.ignore,
					Effect.andThen(reach(paths.sock)),
					Effect.flatMap((r) =>
						r === "live"
							? Effect.void
							: Effect.fail(new NoHost({why: `the host stopped as it started: see ${paths.log}`})),
					),
				),
			);
		}
		// The link runs in a scope of its own, inside the caller's: closed as soon as the try fails,
		// so its socket is not left open until the caller's scope ends.
		const link = yield* Scope.fork(yield* Effect.scope);
		const socket = yield* NodeSocket.makeNet({path: paths.sock});
		const wire = yield* appWire(socket, deliver, ours).pipe(Scope.provide(link));
		yield* wire.up.pipe(
			Effect.timeoutOrElse({
				duration: HELLO_WITHIN,
				orElse: () => Effect.fail(new NoHello({within: HELLO_WITHIN})),
			}),
			Effect.onError((cause) => Scope.close(link, Exit.failCause(cause))),
		);
		return wire;
	});
