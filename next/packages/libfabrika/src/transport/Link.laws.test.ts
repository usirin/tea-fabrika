// P14 slice 2, next/ (ticket 828): the link to the brain, laws L1 and L2 of the approved plan. Written
// before `transport/Link.ts`.
//
// The shape these laws hold `Link.ts` to, from the plan (the build may add more):
// - `Link`: the Schema.TaggedUnion of dialing{dial, tries?}, waiting_grant{dial, fingerprint, code,
//   until, knocks?}, online{dial, ping, pings?}, retrying{dial, tries >= 1}, removed{fingerprint},
//   blocked{reason}.
// - `LinkMsg` and `linkMachine`, one tea machine whose init is `dialing` at dial 1. Msgs by `type`:
//   admitted{dial, ping, ms}, not_granted{dial, fingerprint, code, until, ms}, granted{dial},
//   closed{dial, code, fingerprint, ms}, retry{dial, tries}, beat{dial}, pong{dial}, stalled{dial, ms},
//   renew{dial, knocks?}, blocked{reason}, ask_again{dial}. Cmds: `ping` and `knock`, each {dial}.
// - `linkTimer(link)`: the timer the state waits on, `{after, msg}` in ms, or null for removed and
//   blocked. Firing it is applying `msg`.
// - `backoff(tries)`: the retry timer's wait, doubling from 500 ms and never past `CAP` (30 s).
// - `dialWait(link)`: the wait the socket Sub runs before it opens the socket for a `dialing` state, an
//   Effect that sleeps on Effect's Clock a wait drawn from Effect's `Random`: nothing for a first dial,
//   and for a retry dial (`tries` >= 1) a wait in `[0, min(1000, backoff(tries) / 2, CAP -
//   backoff(tries))]` ms. The machine itself reads no clock and no random.
//
// L1 walks the real machine from its real init. Each generated step reads the folded state and turns
// its choice numbers into a move that state allows: an answer on the current dial, its own timer, a
// close or block from outside, or a stale copy of a Msg this walk already delivered on an older dial.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Random, Ref, Schema } from "effect";
import * as Clock from "effect/Clock";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { backoff, CAP, dialWait, Link, linkMachine, type LinkMsg, linkTimer } from "./Link.ts";

const SEED = 119120;
const BEAT_BOUND = 10_000; // L1: an unanswered beat leaves online within 10 s
const REMOVED = 4003;

type Step = readonly [Link, ReadonlyArray<{ readonly type: string; readonly dial?: number }>];
const step = (s: Link, m: LinkMsg): Step => applyCell(linkMachine, s, m);

const currentDial = (s: Link): number | null => ("dial" in s ? s.dial : null);
const live = (s: Link): boolean => s._tag !== "removed" && s._tag !== "blocked";
const roundTrip = (s: Link): Link => Schema.decodeUnknownSync(Link)(Schema.encodeSync(Link)(s));

/** One generated step: choice numbers and words the walk turns into a move against its state. */
const choice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  code: fc.nat(),
  ping: fc.integer({ min: 0, max: 60_000 }),
  ms: fc.integer({ min: 0, max: 20_000 }),
  word: fc.stringMatching(/^[A-Z0-9]{4}$/),
});

type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;
const walks = fc.array(choice, { minLength: 1, maxLength: 60 });

/** A close code from outside: a normal close, an abnormal one, an unknown one, or the removal. */
const closeCode = (c: Choice): number => [1000, 1006, 4000, REMOVED][c.code % 4]!;

/** What the walk carries beside the state: every Msg it delivered, for stale copies, and the highest
 *  dial it has seen, so Ask again dials past every old one. */
type Walk = { s: Link; delivered: Array<LinkMsg>; dials: number };

/** The moves the current state allows, each built from the choice. */
const moves = (w: Walk, c: Choice): ReadonlyArray<LinkMsg> => {
  const s = w.s;
  const fingerprint = `SHA256:${c.word}`;
  const timer = linkTimer(s);
  const out: Array<LinkMsg> = timer === null ? [] : [timer.msg];
  const blocked: LinkMsg = { type: "blocked", reason: `store ${c.word}` };
  const stale = w.delivered.filter((m) => "dial" in m && m.dial !== currentDial(s));

  if (stale.length > 0) {
    out.push(stale[c.pick % stale.length]!);
  }

  if (s._tag === "dialing") {
    out.push(
      { type: "admitted", dial: s.dial, ping: c.ping, ms: c.ms },
      { type: "not_granted", dial: s.dial, fingerprint, code: c.word, until: c.ping, ms: c.ms },
      { type: "closed", dial: s.dial, code: closeCode(c), fingerprint, ms: c.ms },
      blocked,
    );
  } else if (s._tag === "waiting_grant") {
    out.push(
      { type: "granted", dial: s.dial },
      // The door renews the code on the same socket, or a confused peer admits without a grant.
      { type: "not_granted", dial: s.dial, fingerprint: s.fingerprint, code: c.word, until: c.ping, ms: c.ms },
      { type: "admitted", dial: s.dial, ping: c.ping, ms: c.ms },
      { type: "closed", dial: s.dial, code: closeCode(c), fingerprint: s.fingerprint, ms: c.ms },
      blocked,
    );
  } else if (s._tag === "online") {
    out.push(
      { type: "pong", dial: s.dial },
      { type: "closed", dial: s.dial, code: closeCode(c), fingerprint, ms: c.ms },
      blocked,
    );
  } else if (s._tag === "retrying") {
    out.push(blocked);
  } else if (s._tag === "removed") {
    out.push({ type: "ask_again", dial: w.dials + 1 }, { type: "granted", dial: w.dials }, blocked);
  } else {
    // Blocked: nothing the outside sends moves it, Ask again included.
    out.push({ type: "ask_again", dial: w.dials + 1 }, blocked);
  }

  return out;
};

/** Folds a walk through the real machine, handing each step to `each`. */
const fold = (list: ReadonlyArray<Choice>, each: (prev: Walk, m: LinkMsg, next: Link, cmds: Step[1]) => void): Walk => {
  const w: Walk = { s: linkMachine.init(null, {})[0], delivered: [], dials: 1 };

  for (const c of list) {
    const options = moves(w, c);
    const m = options[c.move % options.length]!;
    const [next, cmds] = step(w.s, m);
    each({ ...w, delivered: [...w.delivered] }, m, next, cmds);
    w.delivered.push(m);
    w.s = next;
    w.dials = Math.max(w.dials, currentDial(next) ?? 0);
  }

  return w;
};

const opts = { seed: SEED, numRuns: 300 };

describe("L1: the link machine", () => {
  it("init is dialing on dial 1 with no Cmd", () => {
    fc.assert(
      fc.property(fc.constant(null), (loaded) => {
        const [s, cmds] = linkMachine.init(loaded, {});
        expect(s).toEqual(Link.cases.dialing.make({ dial: 1 }));
        expect(cmds).toEqual([]);
      }),
      { seed: SEED, numRuns: 1 },
    );
  });

  it("a Msg for an older dial changes nothing and sends nothing", () => {
    let stale = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, (prev, m, next, cmds) => {
          if (m.type === "ask_again" || !("dial" in m) || !live(prev.s) || m.dial === currentDial(prev.s)) {
            return;
          }

          stale++;
          expect(next, `${m.type} for dial ${m.dial} moved ${prev.s._tag} on dial ${currentDial(prev.s)}`).toEqual(
            prev.s,
          );
          expect(cmds).toEqual([]);
        });
      }),
      opts,
    );
    expect(stale, "the walks delivered stale Msgs").toBeGreaterThan(0);
  });

  it("a grant wait leaves only by granted on its dial, a close on its dial or a block", () => {
    let left = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, (prev, m, next) => {
          if (prev.s._tag !== "waiting_grant" || next._tag === "waiting_grant") {
            return;
          }

          left++;
          const allowed =
            (m.type === "granted" && m.dial === prev.s.dial) ||
            (m.type === "closed" && m.dial === prev.s.dial) ||
            m.type === "blocked";
          expect(allowed, `${m.type} took a grant wait to ${next._tag}`).toBe(true);
          expect(m.type !== "granted" || next._tag === "dialing", "granted signs a fresh hello on the same dial").toBe(
            true,
          );
          expect(m.type !== "granted" || currentDial(next) === prev.s.dial).toBe(true);
        });
      }),
      opts,
    );
    expect(left).toBeGreaterThan(0);
  });

  it("a 4003 close on the current dial is removed, and only ask_again dials, past every old dial", () => {
    let removed = 0,
      asked = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, (prev, m, next, cmds) => {
          if (m.type === "closed" && m.code === REMOVED && live(prev.s) && m.dial === currentDial(prev.s)) {
            if (prev.s._tag !== "retrying") {
              removed++;
              expect(next).toEqual(Link.cases.removed.make({ fingerprint: m.fingerprint }));
            }
          }

          if (prev.s._tag !== "removed") {
            return;
          }

          if (m.type === "ask_again") {
            asked++;
            expect(next._tag).toBe("dialing");
            expect(currentDial(next)).toBe(m.dial);
            expect(m.dial).toBeGreaterThan(Math.max(0, ...prev.delivered.map((d) => ("dial" in d ? d.dial : 0))));
            return;
          }

          expect(next, `${m.type} moved a removed key`).toEqual(prev.s);
          expect(cmds).toEqual([]);
        });
      }),
      opts,
    );
    expect(removed).toBeGreaterThan(0);
    expect(asked).toBeGreaterThan(0);
  });

  it("every live state has a timer that moves it, and removed and blocked have none", () => {
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, (_prev, _m, s) => {
          const timer = linkTimer(s);

          if (!live(s)) {
            expect(timer, `${s._tag} has a timer`).toBeNull();
            return;
          }

          expect(timer, `${s._tag} has no timer`).not.toBeNull();
          expect(timer!.after).toBeGreaterThanOrEqual(0);
          expect(timer!.after).toBeLessThanOrEqual(CAP);
          const [after, cmds] = step(s, timer!.msg);
          expect(after !== s || cmds.length > 0, `${s._tag}'s timer did nothing`).toBe(true);
          expect(s._tag !== "waiting_grant" || after._tag === "waiting_grant", "a timer admitted a grant wait").toBe(
            true,
          );
          expect(s._tag !== "waiting_grant" || cmds.some((c) => c.type === "knock"), "renew knocks").toBe(true);
        });
      }),
      opts,
    );
  });

  it("the retry timer waits backoff(tries), doubling from 0.5 s to the 30 s cap", () => {
    let retries = 0;
    fc.assert(
      fc.property(walks, fc.integer({ min: 1, max: 64 }), (list, tries) => {
        expect(backoff(tries)).toBe(Math.min(CAP, 500 * 2 ** (tries - 1)));
        fold(list, (_prev, _m, s) => {
          const retry = s._tag === "retrying" ? s : null;
          retries += retry === null ? 0 : 1;
          expect(retry === null ? null : linkTimer(retry)).toEqual(
            retry === null
              ? null
              : { after: backoff(retry.tries), msg: { type: "retry", dial: retry.dial, tries: retry.tries } },
          );
        });
      }),
      opts,
    );
    expect(retries).toBeGreaterThan(0);
  });

  it("an online link whose beats go unanswered leaves online within 10 s on its own timers", () => {
    let online = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, (_prev, _m, start) => {
          if (start._tag !== "online") {
            return;
          }

          online++;
          let s: Link = start,
            waited = 0;

          for (let n = 0; n < 8 && s._tag === "online"; n++) {
            const timer = linkTimer(s);
            expect(timer, "online has a timer").not.toBeNull();
            waited += timer!.after;
            s = step(s, timer!.msg)[0];
          }

          expect(s._tag, "an unanswered beat leaves online").toBe("retrying");
          expect(waited).toBeLessThanOrEqual(BEAT_BOUND);
        });
      }),
      opts,
    );
    expect(online).toBeGreaterThan(0);
  });

  it("the Model round-trips its schema at every step", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, (_prev, _m, s) => {
          reached.add(s._tag);
          expect(roundTrip(s)).toEqual(s);
        });
      }),
      opts,
    );
    expect([...reached].sort()).toEqual(["blocked", "dialing", "online", "removed", "retrying", "waiting_grant"]);
  });
});

/** How long `dialWait` sleeps for `s` under TestClock with Random seeded by `seed`. */
const waited = (s: Link, seed: number) =>
  Effect.gen(function* () {
    const done = yield* Ref.make<number | null>(null);
    const t0 = yield* Clock.currentTimeMillis;
    const fiber = yield* dialWait(s).pipe(
      Effect.andThen(Clock.currentTimeMillis),
      Effect.flatMap((t1) => Ref.set(done, t1 - t0)),
      Random.withSeed(seed),
      Effect.forkChild,
    );
    yield* TestClock.adjust(CAP);
    yield* Fiber.join(fiber);
    return yield* Ref.get(done);
  });

describe("L2: retry jitter in the dial", () => {
  it("a retry dial opens no earlier than backoff(tries), no later than the jitter bound, and never past 30 s", async () => {
    const seen = new Map<number, Set<number>>();
    await fc.assert(
      fc.asyncProperty(fc.array(choice, { minLength: 1, maxLength: 40 }), fc.integer(), async (list, seed) => {
        // Walk failed dials from the current `tries`: each step fails the current dial, by a close or
        // its stall timer, then fires the retry timer, and the dial it makes is measured.
        let s: Link = linkMachine.init(null, {})[0];
        const first = await Effect.runPromise(waited(s, seed).pipe(Effect.provide(TestClock.layer())));
        expect(first, "the first dial opens at once").toBe(0);

        for (const c of list) {
          if (s._tag !== "dialing") {
            break;
          }

          const failure: LinkMsg =
            c.move % 2 === 0
              ? { type: "closed", dial: s.dial, code: 1006, fingerprint: "SHA256:x", ms: c.ms }
              : linkTimer(s)!.msg;
          const retrying = step(s, failure)[0];
          expect(retrying._tag).toBe("retrying");

          if (retrying._tag !== "retrying") {
            break;
          }

          const before = backoff(retrying.tries);
          expect(linkTimer(retrying)?.after, "the machine's timer stays backoff(tries)").toBe(before);
          s = step(retrying, linkTimer(retrying)!.msg)[0];
          const wait = await Effect.runPromise(waited(s, seed + c.pick).pipe(Effect.provide(TestClock.layer())));
          const bound = Math.min(1000, before / 2, CAP - before);
          expect(wait).not.toBeNull();
          expect(wait!).toBeGreaterThanOrEqual(0);
          expect(wait!, `tries ${retrying.tries}`).toBeLessThanOrEqual(bound);
          expect(before + wait!).toBeLessThanOrEqual(CAP);
          seen.set(retrying.tries, (seen.get(retrying.tries) ?? new Set()).add(wait!));
        }
      }),
      { seed: SEED, numRuns: 100 },
    );
    // The jitter is drawn, not fixed: an early retry, whose bound is above zero, waits more than one way.
    expect(seen.get(1)?.size ?? 0, "Random spreads the first retry's wait").toBeGreaterThan(1);
  });
});
