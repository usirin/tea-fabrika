// P18 slice 1, next/ (ticket 290): the client's hello exchange as one tea machine, law L2 of the
// approved plan. Written before `transport/Handshake.ts`.
//
// The shape this law holds `Handshake.ts` to, from the plan (the build may add more):
// - `handshakeMachine`: a pure tea machine, no socket and no clock, whose Model is `Handshake`:
//   opened {dial, since, sent} | initializing {dial, since, sent, id} | knocking {dial, since, sent, id}
//   | waiting {dial, since, sent, code, until} | admitted {dial, ping, ms} | failed {dial, reason}.
// - Msgs by `type`: opened {dial, at} (a socket opened), challenge {dial, nonce, at}, granted {dial,
//   nonce, at}, waiting {dial, code, until, at}, answer {dial, id, result, reason?, at} (the door's
//   answer to a string id), and tea's answers to its two Cmds.
// - Cmds: `hello {dial, id, nonce}` (sign and send `initialize`), errors `key` and `closed`; and
//   `knock {dial, id}` (send `gateway.knock`), error `closed`.
// - An answer whose id is not the state's own, or whose dial is another, does nothing. A challenge or
//   a grant emits `hello` with its own nonce. The answer to `initializing` admits, decoded as the
//   door's admission {version, ping, identity}, or on `not_granted` emits `knock`, or on any other
//   reason is `refused {dial, reason}`, the reason kept when it is a word and `other` if not. The answer to
//   `knocking`, or a waiting notice, reaches `waiting`. `hello_err` with `key` is `failed`. `ms` is
//   a measurement and never negative, whatever the clock said.
//
// The walk starts at the real init. Each step reads the state it folded and picks a move possible
// there: the live id, a past id, another dial, an answer to a Cmd really waiting, a clock that went
// back. Stale moves are chosen on purpose.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { handshakeMachine } from "./Handshake.ts";

const SEED = 119120;

type Msg = { readonly type: string; readonly [key: string]: unknown };
type Cmd = { readonly type: string; readonly [key: string]: unknown };
type State = { readonly _tag: string; readonly dial: number; readonly [key: string]: unknown };

const step = (s: State, m: Msg): readonly [State, ReadonlyArray<Cmd>] =>
  applyCell(handshakeMachine as never, s as never, m as never) as never;

const ADMITTED = { version: 1, ping: 5_000, identity: { key: "SHA256:k", person: "person_x", as: "window" } };

/** A blind draw the fold reads in the state it reached. */
const Pick = Schema.Struct({
  move: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  aux: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  // How far the clock moved since the last Msg; a negative step is a clock that went back.
  skew: Schema.Int.check(Schema.isBetween({ minimum: -5_000, maximum: 20_000 })),
  nonce: Schema.String,
  code: Schema.String,
  until: Schema.Number.check(Schema.isFinite()),
  // The door's reason on an error answer: one of its words, or any text a door could send.
  reason: Schema.Union([Schema.String.check(Schema.isPattern(/^[a-z_]{1,40}$/)), Schema.String]),
});
type Pick = typeof Pick.Type;
const Picks = Schema.Array(Pick).check(Schema.isMinLength(10), Schema.isMaxLength(120));

type World = {
  s: State;
  waiting: Array<Cmd>; // Cmds handed out and not answered yet
  ids: Array<{ readonly id: string; readonly dial: number }>; // every request id the machine named
  at: number;
};

type Event = {
  readonly prev: State;
  readonly m: Msg;
  readonly next: State;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly known: ReadonlyArray<{ readonly id: string; readonly dial: number }>; // ids named before this step
};

const liveId = (s: State): string | undefined => (typeof s["id"] === "string" ? s["id"] : undefined);

/** Every move the world allows now. */
const moves = (w: World, c: Pick): ReadonlyArray<() => Msg> => {
  const s = w.s;
  const at = Math.max(0, w.at);
  const other = s.dial + 1 + (c.aux % 3);
  const out: Array<() => Msg> = [
    () => ({ type: "opened", dial: s.dial + 1, at }),
    () => ({ type: "challenge", dial: s.dial, nonce: c.nonce, at }),
    () => ({ type: "challenge", dial: other, nonce: c.nonce, at }),
    () => ({ type: "granted", dial: s.dial, nonce: c.nonce, at }),
    () => ({ type: "granted", dial: other, nonce: c.nonce, at }),
    () => ({ type: "waiting", dial: s.dial, code: c.code, until: c.until, at }),
    () => ({ type: "waiting", dial: other, code: c.code, until: c.until, at }),
  ];
  const id = liveId(s);

  if (id !== undefined) {
    // The door's answers to the live request, favored so walks go through every state.
    for (let n = 0; n < 3; n++) {
      out.push(
        () => ({ type: "answer", dial: s.dial, id, result: ADMITTED, at }),
        () => ({ type: "answer", dial: s.dial, id, result: null, reason: "not_granted", at }),
        () => ({ type: "answer", dial: s.dial, id, result: { code: c.code, until: c.until }, at }),
        () => ({ type: "answer", dial: s.dial, id, result: null, reason: c.reason, at }),
      );
    }

    out.push(
      () => ({ type: "answer", dial: s.dial, id, result: { nonce: c.nonce }, at }),
      () => ({ type: "answer", dial: other, id, result: ADMITTED, at }),
    );
  }

  const past = w.ids.filter((known) => known.id !== id);

  if (past.length > 0) {
    const old = past[c.pick % past.length]!;
    out.push(
      () => ({ type: "answer", dial: s.dial, id: old.id, result: ADMITTED, at }),
      () => ({ type: "answer", dial: s.dial, id: old.id, result: null, reason: "not_granted", at }),
      () => ({ type: "answer", dial: s.dial, id: old.id, result: null, reason: c.reason, at }),
      () => ({ type: "answer", dial: old.dial, id: old.id, result: ADMITTED, at }),
    );
  }

  if (w.waiting.length > 0) {
    const cmd = w.waiting[c.pick % w.waiting.length]!;
    out.push(
      () => ({ type: `${cmd.type}_ok`, cmd, value: null }),
      () => ({ type: `${cmd.type}_ok`, cmd, value: null }),
      () =>
        cmd.type === "hello" && c.aux % 2 === 0
          ? { type: "hello_err", cmd, error: { _tag: "key" } }
          : { type: `${cmd.type}_err`, cmd, error: { _tag: "closed" } },
    );
  }

  return out;
};

/** Folds a walk from the real init, opened on dial 1, and hands each step to `each`. */
const fold = (list: ReadonlyArray<Pick>, each: (e: Event) => void): void => {
  const [s0, cmds0]: readonly [State, ReadonlyArray<Cmd>] = handshakeMachine.init(null, {} as never);
  const [s1, cmds1] = step(s0, { type: "opened", dial: 1, at: 0 });
  const w: World = { s: s1, waiting: [...cmds0, ...cmds1], ids: [], at: 0 };

  for (const c of list) {
    w.at += c.skew;
    const options = moves(w, c);
    const m = options[c.move % options.length]!();
    const prev = w.s;
    const known = [...w.ids];
    const [next, cmds] = step(prev, m);
    w.waiting = [...w.waiting.filter((cmd) => !("cmd" in m) || m["cmd"] !== cmd), ...cmds];

    for (const cmd of cmds) {
      if (typeof cmd["id"] === "string") {
        w.ids.push({ id: cmd["id"], dial: Number(cmd["dial"]) });
      }
    }

    w.s = next;
    each({ prev, m, next, cmds, known });
  }
};

const runs = { arbitrary: { seed: SEED, runs: 300, size: 120 } };

describe("P18 L2: the handshake answers only its own request", () => {
  it.prop(
    "a stale id or another dial changes nothing, a hello carries the nonce just folded, a link outcome follows only its own answer, and ms is never negative",
    { list: Arbitrary.schema(Picks) },
    ({ list }) => {
      fold(list, ({ prev, m, next, cmds, known }) => {
        const own = liveId(prev);
        const dialed = typeof m["dial"] === "number" ? m["dial"] : null;
        const label = `${m.type} in ${prev._tag}`;

        if (m.type === "answer" && (m["id"] !== own || dialed !== prev.dial)) {
          expect([next, cmds], `${label}: an answer to ${String(m["id"])} on dial ${dialed} moved it`).toEqual([
            prev,
            [],
          ]);
        }

        if (["challenge", "granted", "waiting", "answer"].includes(m.type) && dialed !== prev.dial) {
          expect([next, cmds], `${label}: dial ${dialed} is not the state's ${prev.dial}`).toEqual([prev, []]);
        }

        // Each hello goes out on the dial and with the nonce of the challenge or grant just folded.
        const hellos = cmds.filter((c) => c.type === "hello");
        expect(
          hellos.map((h) => [h["dial"], h["nonce"]]),
          `${label} sent a hello that is not this Msg's`,
        ).toEqual(hellos.length === 0 ? [] : [[m["dial"], m["nonce"]]]);
        expect(hellos.length === 0 || ["challenge", "granted"].includes(m.type), `${label} sent a hello`).toBe(true);

        if (m.type === "challenge" && dialed === prev.dial && prev._tag === "opened") {
          expect(hellos, "a challenge on an opened socket is answered with one hello").toHaveLength(1);
        }

        if (m.type === "granted" && dialed === prev.dial && prev._tag === "waiting") {
          expect(hellos, "a grant while waiting is answered with one hello, with the grant's nonce").toHaveLength(1);
        }

        // A request id is never named twice, so an answer to an old one can never match.
        for (const c of cmds.filter((c) => typeof c["id"] === "string")) {
          expect(
            known.some((k) => k.id === c["id"]),
            `${c.type} reused ${String(c["id"])}`,
          ).toBe(false);
          expect(liveId(next), `${c.type}'s id is the state's live id`).toBe(c["id"]);
        }

        const matched = m.type === "answer" && m["id"] === own && dialed === prev.dial;

        if (next._tag === "admitted" && prev._tag !== "admitted") {
          expect(matched && prev._tag === "initializing", `${label} admitted`).toBe(true);
          expect(m["reason"], "a not_granted answer admitted").toBeUndefined();
        }

        if (next._tag === "waiting" && prev._tag !== "waiting") {
          expect(
            (matched && prev._tag === "knocking") || (m.type === "waiting" && dialed === prev.dial),
            `${label} reached waiting`,
          ).toBe(true);
        }

        if (next._tag === "failed" && prev._tag !== "failed") {
          expect(m.type === "hello_err" && Reflect.get(Object(m["error"]), "_tag") === "key", `${label} failed`).toBe(
            true,
          );
        }

        // The door's admission, answered to the live `initialize`, admits.
        if (matched && prev._tag === "initializing" && m["result"] === ADMITTED) {
          expect(next).toMatchObject({ _tag: "admitted", dial: prev.dial, ping: ADMITTED.ping });
        }

        // A refused `initialize` knocks once.
        if (matched && prev._tag === "initializing" && m["reason"] === "not_granted") {
          expect(next._tag).toBe("knocking");
          expect(cmds.filter((c) => c.type === "knock")).toHaveLength(1);
        }

        // Any other reason ends the dial's exchange as refused, keeping the door's word when it is
        // one and `other` when it is not, and sends nothing.
        const refusal = m["reason"];
        const refusedNow = matched && prev._tag === "initializing" && typeof refusal === "string";

        if (refusedNow && refusal !== "not_granted") {
          expect([next, cmds], `${label}: the door refused for ${refusal}`).toMatchObject([
            { _tag: "refused", dial: prev.dial, reason: /^[a-z_]{1,40}$/.test(refusal) ? refusal : "other" },
            [],
          ]);
        }

        if (next._tag === "refused" && prev._tag !== "refused") {
          expect(refusedNow && refusal !== "not_granted", `${label} refused`).toBe(true);
        }

        for (const field of ["ms", "since"]) {
          const n = next[field];
          expect(n === undefined || (typeof n === "number" && n >= 0), `${field} ${String(n)}`).toBe(true);
        }
      });
      return true;
    },
    runs,
  );

  it.prop(
    "over twenty walks the handshake admits, waits, fails, is refused and refuses a stale answer",
    { lists: Arbitrary.array(Arbitrary.schema(Picks), { minLength: 20, maxLength: 20 }) },
    ({ lists }) => {
      const seen: Record<string, number> = { admitted: 0, waiting: 0, failed: 0, refused: 0, stale: 0 };

      for (const list of lists) {
        fold(list, ({ prev, m, next }) => {
          if (next._tag !== prev._tag && next._tag in seen) {
            seen[next._tag]!++;
          }

          seen["stale"]! += m.type === "answer" && m["id"] !== liveId(prev) ? 1 : 0;
        });
      }

      expect(
        Object.values(seen).every((n) => n > 0),
        JSON.stringify(seen),
      ).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 120 } },
  );
});
