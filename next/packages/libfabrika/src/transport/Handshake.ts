/**
 * A client's hello exchange with the door, one dial at a time. A pure tea machine: it reads no
 * socket and no clock, and every time it holds came in on a Msg.
 *
 * The door challenges a fresh socket with a nonce. The client signs a hello for that nonce and sends
 * `initialize`. The door admits it, refuses it with a reason, or says the key is not granted yet;
 * then the client knocks once
 * and the door shows a code until a person grants the key. A grant brings a new nonce and a new
 * hello. Each request id names its dial and its place on that dial, `h<dial>.<n>`, so an answer to
 * an older request, or to another dial, can never match the live one.
 *
 * The window parent steps this machine by hand and turns each outcome into the Link machine's own
 * Msg (`transport/Link.ts`).
 *
 * @stability unstable
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import { Option, Schema } from "effect";
import { ErrorClass } from "./ClientRows.ts";

const Dial = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** A time or a duration in ms, as the client's own clock read it: a measurement, never authority. */
const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
/** The door's reason, kept only when it is one of its words: anything else is `other`. */
const Reason = Schema.String.check(Schema.isPattern(/^[a-z_]{1,40}$/));
const doorWord = (said: string): string => (Schema.is(Reason)(said) ? said : "other");

/**
 * Schema for where one dial's hello exchange stands.
 *
 * **Details**
 *
 * `dial` is the socket the state is about. `since` is when that socket opened, or when a grant
 * started a new hello; a dial whose opening time never came is timed from the door's first
 * notice. `ms` is how long the dial took to reach an outcome. `sent` counts the
 * request ids named on the dial, and `id` is the live one. `waiting` keeps the door's code until
 * `until`. `failed` keeps the class of the key's failure, never its text. `refused` keeps the door's
 * reason for refusing the hello when it is one of the door's words, else `other`.
 *
 * @stability unstable
 * @category models
 */
export const Handshake = Schema.TaggedUnion({
  /** The dial has a socket and the door has not challenged it yet. `since` is set once it opened. */
  opened: { dial: Dial, since: Schema.optionalKey(Ms) },
  /** `initialize` went out with `id`. */
  initializing: { dial: Dial, since: Ms, sent: Count, id: Schema.String },
  /** The door said not granted, and `gateway.knock` went out with `id`. */
  knocking: { dial: Dial, since: Ms, sent: Count, id: Schema.String },
  /** The door shows `code` until `until`; only a grant moves on. */
  waiting: { dial: Dial, since: Ms, sent: Count, code: Schema.String, until: Schema.Number, ms: Ms },
  /** The door admitted the hello. `ping` is its interval in ms. */
  admitted: { dial: Dial, since: Ms, ping: Schema.Number, ms: Ms },
  /** The key could not sign the hello. */
  failed: { dial: Dial, error: ErrorClass },
  /** The door refused the hello for `reason`, its own word or `other`, `ms` after the dial began. */
  refused: { dial: Dial, reason: Reason, ms: Ms },
});

/**
 * The type of a hello exchange's state.
 *
 * @stability unstable
 * @category models
 */
export type Handshake = typeof Handshake.Type;

/**
 * Schema for what reaches the exchange: the socket opened, the door's challenge, its grant and its
 * waiting notice, and the door's answer to a request with a string id.
 *
 * @stability unstable
 * @category models
 */
export const HandshakeMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("opened"), dial: Dial, at: Schema.optionalKey(Ms) }),
  Schema.Struct({ type: Schema.Literal("challenge"), dial: Dial, nonce: Schema.String, at: Ms }),
  Schema.Struct({ type: Schema.Literal("granted"), dial: Dial, nonce: Schema.String, at: Ms }),
  Schema.Struct({
    type: Schema.Literal("waiting"),
    dial: Dial,
    code: Schema.String,
    until: Schema.Number,
    at: Ms,
  }),
  Schema.Struct({
    type: Schema.Literal("answer"),
    dial: Dial,
    id: Schema.String,
    result: Schema.Unknown,
    reason: Schema.optionalKey(Schema.String),
    at: Ms,
  }),
]);

/**
 * The type of a Msg the hello exchange takes.
 *
 * @stability unstable
 * @category models
 */
export type HandshakeMsg = typeof HandshakeMsg.Type;

/**
 * Cmd that signs the hello text for `nonce` and sends `initialize` with `id` on the dial's socket.
 *
 * **Details**
 *
 * It fails `key` when the key cannot sign, with the platform's class as `error`, and `closed` when
 * the dial has no open socket.
 *
 * @stability unstable
 * @category constructors
 */
export const hello = Cmd.make("hello", {
  input: Schema.Struct({ dial: Dial, id: Schema.String, nonce: Schema.String }),
  ok: Schema.Null,
  err: ["key", "closed"],
});

/**
 * Cmd that sends `gateway.knock` with `id` on the dial's socket, asking the door for a code.
 *
 * @stability unstable
 * @category constructors
 */
export const knock = Cmd.make("knock", {
  input: Schema.Struct({ dial: Dial, id: Schema.String }),
  ok: Schema.Null,
  err: ["closed"],
});

/** The door's admission, as it answers `initialize`. */
const Admitted = Schema.Struct({
  version: Schema.Int,
  ping: Schema.Number,
  identity: Schema.Struct({ key: Schema.String, person: Schema.String, as: Schema.String }),
});

/** The door's waiting code, as it answers a knock. */
const WaitingCode = Schema.Struct({ code: Schema.String, until: Schema.Number });

/** The class a key error carries beside its tag, or `other`. */
const KeyFailure = Schema.Struct({ error: ErrorClass });

type Step = readonly [Handshake, ReadonlyArray<ReturnType<typeof hello> | ReturnType<typeof knock>>];

const stay = (s: Handshake): Step => [s, []];
const elapsed = (at: number, since: number): number => Math.max(0, at - since);
const sentOn = (s: Handshake): number => ("sent" in s ? s.sent : 0);
/** When the dial opened, or `at` when its opening time never came. */
const sinceOn = (s: Handshake, at: number): number => ("since" in s && s.since !== undefined ? s.since : at);
const idOn = (s: Handshake): string | undefined => ("id" in s ? s.id : undefined);
/** The dial's exchange reached an outcome: only a newer dial starts over. */
const ended = (s: Handshake): boolean => s._tag === "admitted" || s._tag === "failed" || s._tag === "refused";

/** Names the dial's next request and sends `hello` with it. */
const helloFor = (s: Handshake, dial: number, since: number, nonce: string): Step => {
  const sent = sentOn(s) + 1;
  const id = `h${dial}.${sent}`;
  return [Handshake.cases.initializing.make({ dial, since, sent, id }), [hello({ dial, id, nonce })]];
};

/**
 * The hello exchange as one tea machine.
 *
 * **Details**
 *
 * It starts at `opened` on dial 0, before any socket. An `opened` Msg for a newer dial starts that
 * dial over. A Msg for another dial than the state's, and an answer whose id is not the live one,
 * change nothing.
 *
 * @stability unstable
 * @category constructors
 */
export const handshakeMachine = Machine.make({
  model: Handshake,
  msg: HandshakeMsg,
  cmds: [hello, knock],
  init: (loaded) => [loaded ?? Handshake.cases.opened.make({ dial: 0 }), []],
  update: {
    opened: (s, m): Step =>
      m.dial > s.dial || (m.dial === s.dial && s._tag === "opened")
        ? [
            Handshake.cases.opened.make({
              dial: m.dial,
              ...(m.at === undefined ? {} : { since: Math.max(0, m.at) }),
            }),
            [],
          ]
        : stay(s),
    challenge: (s, m): Step =>
      s._tag === "opened" && s.dial === m.dial ? helloFor(s, m.dial, sinceOn(s, Math.max(0, m.at)), m.nonce) : stay(s),
    // A grant brings a nonce to sign, so it starts a new hello wherever the dial stands, short of
    // an outcome. Only a grant while waiting is the Link's own `granted`.
    granted: (s, m): Step =>
      s.dial === m.dial && !ended(s) ? helloFor(s, m.dial, Math.max(0, m.at), m.nonce) : stay(s),
    // The door sends its waiting notice after a knock, so only a knocking or waiting dial reads it.
    waiting: (s, m): Step => {
      if (s.dial !== m.dial || (s._tag !== "knocking" && s._tag !== "waiting")) {
        return stay(s);
      }

      const since = s.since;
      return [
        Handshake.cases.waiting.make({
          dial: m.dial,
          since,
          sent: s.sent,
          code: m.code,
          until: m.until,
          ms: elapsed(m.at, since),
        }),
        [],
      ];
    },
    answer: (s, m): Step => {
      if (s.dial !== m.dial || idOn(s) !== m.id) {
        return stay(s);
      }

      if (s._tag === "initializing") {
        if (m.reason === "not_granted") {
          const sent = s.sent + 1;
          const id = `h${s.dial}.${sent}`;
          return [
            Handshake.cases.knocking.make({ dial: s.dial, since: s.since, sent, id }),
            [knock({ dial: s.dial, id })],
          ];
        }

        if (m.reason !== undefined) {
          return [
            Handshake.cases.refused.make({ dial: s.dial, reason: doorWord(m.reason), ms: elapsed(m.at, s.since) }),
            [],
          ];
        }

        const admitted = m.reason === undefined ? Schema.decodeUnknownOption(Admitted)(m.result) : Option.none();
        return Option.match(admitted, {
          onNone: () => stay(s),
          onSome: (a) => [
            Handshake.cases.admitted.make({
              dial: s.dial,
              since: s.since,
              ping: a.ping,
              ms: elapsed(m.at, s.since),
            }),
            [],
          ],
        });
      }

      if (s._tag === "knocking" && m.reason === undefined) {
        return Option.match(Schema.decodeUnknownOption(WaitingCode)(m.result), {
          onNone: () => stay(s),
          onSome: (w) => [
            Handshake.cases.waiting.make({
              dial: s.dial,
              since: s.since,
              sent: s.sent,
              code: w.code,
              until: w.until,
              ms: elapsed(m.at, s.since),
            }),
            [],
          ],
        });
      }

      return stay(s);
    },
    hello_ok: stay,
    hello_err: (s, m): Step =>
      // A key that cannot sign fails the dial, whichever of its hellos found out: the key is the
      // same for every request on it. An admitted or refused dial already signed.
      m.error._tag === "key" && s.dial === m.cmd.dial && !ended(s)
        ? [
            Handshake.cases.failed.make({
              dial: s.dial,
              error: Option.match(Schema.decodeUnknownOption(KeyFailure)(m.error), {
                onNone: () => "other" as const,
                onSome: (k) => k.error,
              }),
            }),
            [],
          ]
        : stay(s),
    knock_ok: stay,
    knock_err: stay,
  },
});
