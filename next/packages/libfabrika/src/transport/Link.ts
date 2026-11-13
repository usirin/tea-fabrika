// A client's link to the brain, next/ (Tier 1, P14, law p5 with Tier 1's grant-wait amendment). A
// pure tea machine: it holds where the link is, and every Msg that names a dial is about that dial
// only, so a stale close, reply or timer does nothing. The socket that carries it is a Sub keyed by
// the dial (Tuval's browser adapter, P18's later ones), and the waits are the machine's own timers.
//
// The link never sits still: every live state has a timer that moves it. A grant wait leaves only
// by `client.granted` on its dial, a close or a block: no timer admits a key. A 4003 close means the
// key was removed, and only a person's Ask again dials once more.
//
// A link outcome (`admitted`, `not_granted`, `closed`, `stalled`) carries `ms`: how long the dial took
// to reach it, timed by the handler that dialed, or the wait the link's own timer ran for a stall it
// fired. The machine reads no clock and does not read `ms`; a window copies it into its records.
import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

/** No wait is longer than this: p5's 30-second cap. */
export const CAP = 30_000;
/** How long a dial may take to be admitted or told to wait before it counts as stalled. */
const DIALING = 15_000;
/** How often an online link checks the brain with `ping`, at most: a missed `pong` by the next
 *  check is a hang. The brain's own interval (`ping` from `initialize`) is the upper bound. */
const BEAT = 5_000;
/** How often a grant wait knocks again, which keeps its code or renews an expired one. */
const RENEW = CAP;
/** The close code the door sends when the key's grant was removed. */
const REMOVED = 4003;

const Dial = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Link = Schema.TaggedUnion({
  /** A socket for `dial` is opening, or a fresh hello is being signed on it. `tries` carries the
   *  failed attempts since the link was last online, so the backoff keeps growing. */
  dialing: { dial: Dial, tries: Schema.optionalKey(Count) },
  /** The key is not granted yet: the door showed `code` until `until`. `knocks` counts renewals. */
  waiting_grant: {
    dial: Dial,
    fingerprint: Schema.String,
    code: Schema.String,
    until: Schema.Number,
    knocks: Schema.optionalKey(Count),
  },
  /** Admitted. `ping` is the brain's interval in ms; `pings` the checks still unanswered. */
  online: { dial: Dial, ping: Schema.Number, pings: Schema.optionalKey(Count) },
  /** The last dial failed; the next one waits `backoff(tries)`. */
  retrying: { dial: Dial, tries: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) },
  /** The key was removed (close 4003). Nothing dials again until Ask again. */
  removed: { fingerprint: Schema.String },
  /** The client cannot go on, such as a key store that failed. */
  blocked: { reason: Schema.String },
});
export type Link = typeof Link.Type;

const OnDial = { dial: Dial };
/** How long the dial took to reach an outcome, in ms: a measurement, never authority. */
const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

export const LinkMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("admitted"), ...OnDial, ping: Schema.Number, ms: Ms }),
  Schema.Struct({
    type: Schema.Literal("not_granted"),
    ...OnDial,
    fingerprint: Schema.String,
    code: Schema.String,
    until: Schema.Number,
    ms: Ms,
  }),
  Schema.Struct({ type: Schema.Literal("granted"), ...OnDial }),
  Schema.Struct({
    type: Schema.Literal("closed"),
    ...OnDial,
    code: Schema.Int,
    fingerprint: Schema.String,
    ms: Ms,
  }),
  Schema.Struct({ type: Schema.Literal("retry"), ...OnDial, tries: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("beat"), ...OnDial }),
  Schema.Struct({ type: Schema.Literal("pong"), ...OnDial }),
  Schema.Struct({ type: Schema.Literal("stalled"), ...OnDial, ms: Ms }),
  // `knocks` is the count the timer was set at: each renew gives the next timer new deps, since tea
  // keeps a fired timer until its deps change. A renew for an older count is stale.
  Schema.Struct({ type: Schema.Literal("renew"), ...OnDial, knocks: Schema.optionalKey(Count) }),
  Schema.Struct({ type: Schema.Literal("blocked"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("ask_again"), ...OnDial }),
]);
export type LinkMsg = typeof LinkMsg.Type;

/** Send the text `ping` on the dial's socket; the brain answers `pong`. */
export const ping = Cmd.make("ping", {
  input: Schema.Struct(OnDial),
  ok: Schema.Null,
  err: ["closed"],
});

/** Knock again on the dial's socket (`gateway.knock`), keeping or renewing the waiting code. */
const knock = Cmd.make("knock", {
  input: Schema.Struct(OnDial),
  ok: Schema.Null,
  err: ["closed"],
});

/** The wait before retry number `tries`: doubling from half a second, never past the cap. */
export const backoff = (tries: number): number => Math.min(CAP, 500 * 2 ** Math.max(-1, Math.min(tries - 1, 16)));

/** The timer the state waits on, or null when only a person can move it. A stall it fires carries
 *  the wait it ran as its `ms`: the timer starts when the state is entered, so that is how long the
 *  dial sat without an answer. */
export const linkTimer = (link: Link): { readonly after: number; readonly msg: LinkMsg } | null => {
  switch (link._tag) {
    case "dialing":
      return { after: DIALING, msg: { type: "stalled", dial: link.dial, ms: DIALING } };
    case "waiting_grant":
      return { after: RENEW, msg: { type: "renew", dial: link.dial, knocks: link.knocks ?? 0 } };
    case "online": {
      const after = Math.max(0, Math.min(link.ping, BEAT));
      return (link.pings ?? 0) === 0
        ? { after, msg: { type: "beat", dial: link.dial } }
        : { after, msg: { type: "stalled", dial: link.dial, ms: after } };
    }
    case "retrying":
      return { after: backoff(link.tries), msg: { type: "retry", dial: link.dial, tries: link.tries } };
    case "removed":
    case "blocked":
      return null;
  }
};

/** The link's timer as tea's built-in `timer` Sub takes it. */
export const timerDeps = (link: Link): { readonly ms: number; readonly msg: LinkMsg } | null => {
  const timer = linkTimer(link);
  return timer === null ? null : { ms: timer.after, msg: timer.msg };
};

/** The dial a live state has a socket for, or null. */
export const socketDial = (link: Link): number | null =>
  link._tag === "dialing" || link._tag === "waiting_grant" || link._tag === "online" ? link.dial : null;

const failures = (link: Link): number =>
  link._tag === "dialing" ? (link.tries ?? 0) : link._tag === "retrying" ? link.tries : 0;

const failed = (link: Link & { readonly dial: number }): Link =>
  Link.cases.retrying.make({ dial: link.dial, tries: failures(link) + 1 });

type Step = readonly [Link, ReadonlyArray<ReturnType<typeof ping> | ReturnType<typeof knock>>];
const stay = (link: Link): Step => [link, []];

export const linkMachine = Machine.make({
  model: Link,
  msg: LinkMsg,
  cmds: [ping, knock],
  init: (loaded) => [loaded ?? Link.cases.dialing.make({ dial: 1 }), []],
  update: {
    admitted: (s, m) =>
      s._tag === "dialing" && s.dial === m.dial
        ? [Link.cases.online.make({ dial: m.dial, ping: m.ping, pings: 0 }), []]
        : stay(s),
    not_granted: (s, m) => {
      if (!(s._tag === "dialing" || s._tag === "waiting_grant") || s.dial !== m.dial) {
        return stay(s);
      }

      const knocks = s._tag === "waiting_grant" ? (s.knocks ?? 0) : 0;
      return [
        Link.cases.waiting_grant.make({
          dial: m.dial,
          fingerprint: m.fingerprint,
          code: m.code,
          until: m.until,
          knocks,
        }),
        [],
      ];
    },
    granted: (s, m) =>
      s._tag === "waiting_grant" && s.dial === m.dial ? [Link.cases.dialing.make({ dial: m.dial }), []] : stay(s),
    closed: (s, m) => {
      if (socketDial(s) !== m.dial || s._tag === "removed" || s._tag === "blocked") {
        return stay(s);
      }

      if (m.code === REMOVED) {
        return [Link.cases.removed.make({ fingerprint: m.fingerprint }), []];
      }

      return s._tag === "retrying" ? stay(s) : [failed(s), []];
    },
    retry: (s, m) =>
      s._tag === "retrying" && s.dial === m.dial
        ? [Link.cases.dialing.make({ dial: s.dial + 1, tries: s.tries }), []]
        : stay(s),
    beat: (s, m) =>
      s._tag === "online" && s.dial === m.dial
        ? [{ ...s, pings: (s.pings ?? 0) + 1 }, [ping({ dial: s.dial })]]
        : stay(s),
    pong: (s, m) =>
      s._tag === "online" && s.dial === m.dial && (s.pings ?? 0) > 0 ? [{ ...s, pings: 0 }, []] : stay(s),
    stalled: (s, m) => ((s._tag === "dialing" || s._tag === "online") && s.dial === m.dial ? [failed(s), []] : stay(s)),
    renew: (s, m) =>
      s._tag === "waiting_grant" && s.dial === m.dial && (m.knocks === undefined || m.knocks === (s.knocks ?? 0))
        ? [{ ...s, knocks: (s.knocks ?? 0) + 1 }, [knock({ dial: s.dial })]]
        : stay(s),
    blocked: (s, m) =>
      s._tag === "removed" || s._tag === "blocked" ? stay(s) : [Link.cases.blocked.make({ reason: m.reason }), []],
    ask_again: (s, m) => (s._tag === "removed" ? [Link.cases.dialing.make({ dial: m.dial }), []] : stay(s)),
    ping_ok: stay,
    ping_err: stay,
    knock_ok: stay,
    knock_err: stay,
  },
  subs: [{ type: "timer", deps: (s) => timerDeps(s) }],
});
