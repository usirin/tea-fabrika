import { applyCell } from "@demlik/tea";
import { type Cause, Deferred, Effect, Queue, Schema, Stream } from "effect";
import { Ndjson } from "effect/encoding";
import { Socket } from "effect/socket";
import { BUILD } from "./build-id.ts";
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
import type { Read } from "./messages.ts";

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
const MAX_LINE = 4 * 1024 * 1024;

/** Why a link did not come up: the other side speaks another version, or it ended first. */
export class Unattached extends Schema.TaggedError<Unattached>()("Unattached", {
  why: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("version"), theirs: Schema.Int, ours: Schema.Int }),
    Schema.Struct({ kind: Schema.Literal("ended"), what: Schema.String }),
    /** The other side serves another project, or names none: the link never comes up. */
    Schema.Struct({ kind: Schema.Literal("project"), theirs: Schema.NullOr(Schema.String) }),
  ]),
}) {}

export interface Wire<Out> {
  /** Send a line. Sent in order; after the link ended it goes nowhere. */
  readonly send: (m: Out) => void;
  /**
   * Done once the other side said hello with our version: answers the build its hello named, or
   * `null` for none. Only a host names one (link.ts).
   */
  readonly up: Effect.Effect<string | null, Unattached>;
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
    /** The build our hello names, or `null`: it names none. */
    readonly build: string | null;
    /**
     * The project this side serves, by its key: our hello names it, and a hello that names
     * another, or none, ends the link before it is up. `null`: this side checks no project, as a
     * test's or a home's from before projects.
     */
    readonly project: string | null;
  },
) =>
  Effect.gen(function* () {
    const { ctx, read, deliver, build, project } = options;
    const out = yield* Queue.make<Out | Up | Down, Cause.Done>();
    const up = yield* Deferred.make<string | null, Unattached>();
    const ended = yield* Deferred.make<string>();
    let state: Link = { ...ctx, at: "hello" };
    /** The build the other side's hello named. */
    let theirs: string | null = null;

    const perform = (cmds: readonly LinkCmd[], line: In | null) => {
      for (const c of cmds) {
        switch (c.type) {
          case "greet":
            Queue.offerUnsafe(out, {
              type: "hello",
              version: c.version,
              ...(build === null ? {} : { build }),
              ...(project === null ? {} : { project }),
            });
            break;
          case "deliver":
            if (line !== null) {
              deliver(line);
            }

            break;
          case "refuse":
            Deferred.doneUnsafe(
              up,
              Effect.fail(new Unattached({ why: { kind: "version", theirs: c.theirs, ours: c.ours } })),
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

      if (next.at === "up") {
        Deferred.doneUnsafe(up, Effect.succeed(theirs));
      }

      if (next.at === "closed") {
        Deferred.doneUnsafe(up, Effect.fail(new Unattached({ why: { kind: "ended", what: next.why } })));
        Deferred.doneUnsafe(ended, Effect.succeed(next.why));
      }
    };
    const heard = (raw: unknown) => {
      const got = read(raw);

      if (got.kind === "read" && got.msg.type === "hello") {
        if ("build" in got.msg) {
          theirs = got.msg.build ?? null;
        }

        const named = got.msg.project ?? null;

        // A hello for another project: refused before any line of it is handed on. Only a hello of
        // our version is read for its project: another version's fields are its own (a host
        // before version 3 names none), so the link machine refuses it by its version, and names both.
        if (project !== null && got.msg.version === ctx.ours && named !== project && state.at === "hello") {
          Deferred.doneUnsafe(up, Effect.fail(new Unattached({ why: { kind: "project", theirs: named } })));
          return step({ type: "bad", why: "the other side serves another project" }, null);
        }
      }

      step(linkMsgOf(got), got.kind === "read" ? got.msg : null);
    };

    const [first, cmds] = linkMachine.init(null, ctx);
    state = first;
    perform(cmds, null);

    const channel = Ndjson.duplex({ maxLineBytes: MAX_LINE })(Socket.toChannel(socket));
    yield* Stream.fromQueue(out).pipe(
      Stream.pipeThroughChannel(channel),
      Stream.runForEach((raw) => Effect.sync(() => heard(raw))),
      Effect.matchCause({
        onSuccess: () => "the other side closed",
        onFailure: (cause) => `the socket ended: ${String(cause).split("\n")[0]}`,
      }),
      Effect.flatMap((why) => Effect.sync(() => step({ type: "ended", why }, null))),
      Effect.ensuring(Effect.sync(() => step({ type: "ended", why: "the link was let go" }, null))),
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

/**
 * The host's end of a link: it reads `Up`, sends `Down`, and answers the app's hello, naming
 * `build` in it. `null` names none, as a host built before builds were named: for a test of one.
 */
export const hostWire = (
  socket: Socket.Socket,
  deliver: (m: Up) => void,
  ours = PROTOCOL,
  build: string | null = BUILD,
  project: string | null = null,
) => openWire<Up, Down>(socket, { ctx: { side: "host", ours }, read: readUp, deliver, build, project });

/**
 * The app's end of a link: it reads `Down`, sends `Up`, and says hello first, naming no build. With
 * a project's key, its hello names it and a host of another project is refused.
 */
export const appWire = (
  socket: Socket.Socket,
  deliver: (m: Down) => void,
  ours = PROTOCOL,
  project: string | null = null,
) =>
  openWire<Down, Up>(socket, {
    ctx: { side: "app", ours },
    read: readDown,
    deliver,
    build: null,
    project,
  });
