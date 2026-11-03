import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {Effect, Exit, Schedule, Schema, Scope} from "effect";
import {BUILD} from "./build-id.ts";
import {pathsOf, reach} from "./host/socket.ts";
import {stopHost} from "./host/stop.ts";
import {type Down, foundOf, PROTOCOL, type Up} from "./link.ts";
import type {Attached} from "./messages.ts";
import {appWire, type Wire} from "./wire.ts";

// The app's side of attaching, as `tmux attach` is: connect to the host on the home's socket; if
// none answers, start one, wait for its socket, then connect. Node is named only through
// Effect's `NodeSocket`; how a host is started is handed in (main.ts starts the app's own
// binary as Node, a test runs one in its own process).
//
//   const {wire, found} = yield* attach({home, deliver: relay, start});
//   // found {kind: "up"}: the host runs this build; {kind: "build", theirs, ours}: another, or
//   // it named none (`theirs: null`). Attached either way: the window shows a banner for the second
//   // no host: `start`, then the socket is tried every 50 ms until it answers, or the host exits
//   // a socket left by a crash: the same; the new host removes it before it listens (host/run.ts)
//   // two apps at once on one home: each starts a host; the hosts take turns under a lock, one
//   // listens and the other steps aside, and both apps attach to the one that listens
//   // the host speaks another version: Unattached {kind: "version"}, and that host is left running
//   // a host that answers on its socket but says no hello within 10 s: NoHello
//   wire.send({type: "page"});
//
//   const again = yield* restart({home, deliver: relay, start});
//   // the person confirmed "Stop the old host and start this one": the host is stopped by its
//   // pid (host/stop.ts) and waited for, then `attach`, which finds none and starts this build's
//
// `attach` never stops a host. A host of another version runs on with its jobs, and the app says
// so plainly (main.ts) instead of attaching; only `restart`, asked by the person, stops it. A try
// that does not come up closes its own socket before it fails, so nothing of it is left open.

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

/** How to attach: the home, where the host's lines go, and how a host is started. */
export interface AttachOptions<E, R> {
	readonly home: string;
	readonly deliver: (m: Down) => void;
	/** Start a host on the home, detached. Answers an Effect done when that host exits. */
	readonly start: Effect.Effect<Effect.Effect<unknown, unknown>, E, R>;
	/** The link's version the app speaks, for a test of an old app. */
	readonly ours?: number;
	/** The app's build, to compare with the host's: `BUILD`, but in a test. */
	readonly build?: string;
}

/** Attached: the link, and what the app found of the host's build. */
export interface Attachment {
	readonly wire: Wire<Up>;
	readonly found: Attached;
}

export const attach = <E, R>(options: AttachOptions<E, R>) =>
	Effect.gen(function* () {
		const {home, deliver, start, ours = PROTOCOL, build = BUILD} = options;
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
		const theirs = yield* wire.up.pipe(
			Effect.timeoutOrElse({
				duration: HELLO_WITHIN,
				orElse: () => Effect.fail(new NoHello({within: HELLO_WITHIN})),
			}),
			Effect.onError((cause) => Scope.close(link, Exit.failCause(cause))),
		);
		const attached: Attachment = {wire, found: foundOf(theirs, build)};
		return attached;
	});

/**
 * Stop the host on the home and wait for it to exit (host/stop.ts), then attach: no host answers
 * now, so `attach` starts one of this build. Asked only by the person, from the window.
 */
export const restart = <E, R>(options: AttachOptions<E, R>) =>
	stopHost(options.home).pipe(Effect.andThen(attach(options)));
