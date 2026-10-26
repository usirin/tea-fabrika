import {applyCell} from "@demlik/tea";
import {type Cause, Deferred, Effect, Queue, Schema, Stream} from "effect";
import {Ndjson} from "effect/encoding";
import {Socket} from "effect/socket";
import {
	type Down,
	type Link,
	type LinkCmd,
	type LinkCtx,
	type LinkMsg,
	linkMachine,
	linkMsgOf,
	PROTOCOL,
	readDown,
	readUp,
	type Up,
} from "./link.ts";
import type {Read} from "./messages.ts";

// One link over one socket, for either side: NDJSON on the wire (Effect's `Ndjson`), and the
// handshake machine (link.ts) stepped on every line. It names no platform: it takes Effect's
// `Socket`, which the host's server (host/serve.ts) and the app (attach.ts) each get from
// `@effect/platform-node`.
//
//   const wire = yield* appWire(socket, (m) => relay(m));   says hello at once
//   yield* wire.up                       the host said hello, with our version
//   wire.send({type: "page"})
//   yield* wire.ended                    the socket ended: answers why
//
// Each side reads every line with the other side's schema (link.ts, `Up` and `Down`). The
// machine says whether a line is handed on; the line handed on is the one read, with its type.
//
// A line is at most `MAX_LINE` bytes. A tile's screen kept for a page loaded again is 256 KiB of
// text, and JSON can spell a byte of it in six, so a few MiB is room enough; past it the link
// ends, so a broken peer cannot make the other side hold its memory without end.

/** The longest line either side reads, in bytes. */
export const MAX_LINE = 4 * 1024 * 1024;

/** Why a link did not come up: the other side speaks another version, or it ended first. */
export class Unattached extends Schema.TaggedError<Unattached>()("Unattached", {
	why: Schema.Union([
		Schema.Struct({kind: Schema.Literal("version"), theirs: Schema.Int, ours: Schema.Int}),
		Schema.Struct({kind: Schema.Literal("ended"), what: Schema.String}),
	]),
}) {}

export interface Wire<Out> {
	/** Send a line. Sent in order; after the link ended it goes nowhere. */
	readonly send: (m: Out) => void;
	/** Done once the other side said hello with our version. */
	readonly up: Effect.Effect<void, Unattached>;
	/** Done once the link ended, with why. */
	readonly ended: Effect.Effect<string>;
	/** Where the handshake is now. */
	readonly state: () => Link;
}

/** Run the link on `socket` until it ends or the scope closes. `deliver` hears each line once the link is up. */
const openWire = <In extends Up | Down, Out extends Up | Down>(
	socket: Socket.Socket,
	options: {
		readonly ctx: LinkCtx;
		readonly read: (raw: unknown) => Read<In>;
		readonly deliver: (m: In) => void;
	},
) =>
	Effect.gen(function* () {
		const {ctx, read, deliver} = options;
		const out = yield* Queue.make<Out | Up | Down, Cause.Done>();
		const up = yield* Deferred.make<void, Unattached>();
		const ended = yield* Deferred.make<string>();
		let state: Link = {...ctx, at: "hello"};

		const perform = (cmds: readonly LinkCmd[], line: In | null) => {
			for (const c of cmds) {
				switch (c.type) {
					case "greet":
						Queue.offerUnsafe(out, {type: "hello", version: c.version});
						break;
					case "deliver":
						if (line !== null) deliver(line);
						break;
					case "refuse":
						Deferred.doneUnsafe(
							up,
							Effect.fail(new Unattached({why: {kind: "version", theirs: c.theirs, ours: c.ours}})),
						);
						break;
					case "drop":
						// What is queued still goes, the host's own hello on a refusal first; then the
						// writing side ends, and the other side closes on its own.
						Queue.endUnsafe(out);
						break;
				}
			}
		};
		const step = (msg: LinkMsg, line: In | null) => {
			const [next, cmds] = applyCell<Link, LinkMsg, LinkCmd>(linkMachine, state, msg);
			state = next;
			perform(cmds, line);
			if (next.at === "up") Deferred.doneUnsafe(up, Effect.void);
			if (next.at === "closed") {
				Deferred.doneUnsafe(
					up,
					Effect.fail(new Unattached({why: {kind: "ended", what: next.why}})),
				);
				Deferred.doneUnsafe(ended, Effect.succeed(next.why));
			}
		};
		const heard = (raw: unknown) => {
			const got = read(raw);
			step(linkMsgOf(got), got.kind === "read" ? got.msg : null);
		};

		const [first, cmds] = linkMachine.init(null, ctx);
		state = first;
		perform(cmds, null);

		const channel = Ndjson.duplex({maxLineBytes: MAX_LINE})(Socket.toChannel(socket));
		yield* Stream.fromQueue(out).pipe(
			Stream.pipeThroughChannel(channel),
			Stream.runForEach((raw) => Effect.sync(() => heard(raw))),
			Effect.matchCause({
				onSuccess: () => "the other side closed",
				onFailure: (cause) => `the socket ended: ${String(cause).split("\n")[0]}`,
			}),
			Effect.flatMap((why) => Effect.sync(() => step({type: "ended", why}, null))),
			Effect.ensuring(Effect.sync(() => step({type: "ended", why: "the link was let go"}, null))),
			Effect.forkScoped,
		);

		const wire: Wire<Out> = {
			send: (m) => {
				Queue.offerUnsafe(out, m);
			},
			up: Deferred.await(up),
			ended: Deferred.await(ended),
			state: () => state,
		};
		return wire;
	});

/** The host's end of a link: it reads `Up`, sends `Down`, and answers the app's hello. */
export const hostWire = (socket: Socket.Socket, deliver: (m: Up) => void, ours = PROTOCOL) =>
	openWire<Up, Down>(socket, {ctx: {side: "host", ours}, read: readUp, deliver});

/** The app's end of a link: it reads `Down`, sends `Up`, and says hello first. */
export const appWire = (socket: Socket.Socket, deliver: (m: Down) => void, ours = PROTOCOL) =>
	openWire<Down, Up>(socket, {ctx: {side: "app", ours}, read: readDown, deliver});
