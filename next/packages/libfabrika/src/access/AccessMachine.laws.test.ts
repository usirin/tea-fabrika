// Ticket 706, next/: the access fold is one tea machine (0037, 0046). Written before the build.
//
// The contract these laws hold the build to, from the approved plan:
// - `Access.ts` exports one machine, `access`, made with `Machine.make` and no Cmds. Its Model is
//   `Folded`: `unfounded { reply }` or `founded { person, name, keys, ids, reply }`. Each key is one
//   of `live`, `revoked`, `spent` or `replaced`, keeping its `rank` and `under`. Its one Msg is
//   `{ type: "fold", event }`, and `reply` answers the last event: `accepted` or `refused { reason }`.
// - `members(model)` in `Access.ts` is the public `Access` view: `{ person, name, keys, spent }`,
//   each key `{ rank, live, under }`, with empty strings and no keys before founding.
// - `AccessFold.ts` drives the machine: `EMPTY` is its init, `allows` steps it once, `foldAccess`
//   steps every event in order and returns the view.
//
// Each law walks the machine (0093): fast-check draws blind choices, and the walk reads the Model it
// has folded to before it turns each choice into an event, picking live, stopped and recovery keys,
// fresh keys, colliding keys, accepted and refused ids, and signers that are not allowed. A shrink
// replays the walk from `init`. The assertions read only the Model and the view, never the
// machine's own helpers.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import { type Access, access, admitted, type Folded, type MemberEvent, members, type Reason } from "./Access.ts";
import { allows, EMPTY, foldAccess } from "./AccessFold.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;

type Founded = Extract<Folded, { readonly _tag: "founded" }>;
type Unfounded = Extract<Folded, { readonly _tag: "unfounded" }>;
type Key = Founded["keys"] extends ReadonlyMap<string, infer K> ? K : never;
type Standing = Key["_tag"];

const P = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const OTHER = "person_01m6v5270hg0000000000000zz";
const TO = "ledger:home";
const SENT = "2026-11-11T09:00:00.000Z";
const SAW = { code: "4417", label: "Mac", where: "Istanbul", how: "compare", check: "touch", has: [] } as const;
const TOOK = { label: "Mac", where: "Istanbul", how: "panel", check: "touch" } as const;

const ADD_SAW = {
  how: "device",
  check: "touch",
  where: "Istanbul",
  has: [],
  typed: false,
  kept: null,
  old: null,
} as const;

const signed = (signer: string) => ({ text: `signed by ${signer}`, armored: "-----SSHSIG-----", signer });

// ---- The walk: blind choices, each read against the Model folded so far ----

const Choice = fc.record({
  /** In `unfounded`, most choices found; the rest send what the state must refuse. */
  found: fc.nat({ max: 3 }),
  kind: fc.constantFrom(
    "granted",
    "granted",
    "granted",
    "revoked",
    "revoked",
    "person",
    "person",
    "person",
    "recovery",
    "recovery",
    "denied",
    "resend",
    "resend",
    "founded",
  ),
  signer: fc.nat(),
  pool: fc.nat(),
  target: fc.nat(),
  aim: fc.nat({ max: 7 }),
  /** Who the event is for: the founder mostly, else another person or the empty string. */
  for: fc.nat({ max: 9 }),
  /** 0 an accepted id, 1 an id an earlier event was refused under, else a fresh id. */
  id: fc.nat({ max: 5 }),
  pick: fc.nat(),
  raw: fc.string({ maxLength: 2 }),
  as: fc.constantFrom("window", "agent"),
  drops: fc.array(fc.tuple(fc.nat({ max: 3 }), fc.nat()), { maxLength: 3 }),
  founder: fc.constantFrom(P, P, OTHER, ""),
  name: fc.string({ maxLength: 3 }),
  keys: fc.array(fc.string({ maxLength: 2 }), { maxLength: 4 }),
  window: fc.option(fc.string({ maxLength: 2 }), { nil: null }),
});
type Choice = typeof Choice extends fc.Arbitrary<infer A> ? A : never;

const Walk = fc.array(Choice, { maxLength: 60, size: "max" });

/** One step the walk took: the Model before, the event it chose, the Model after. */
type Step = {
  readonly pre: Folded;
  readonly event: MemberEvent;
  readonly post: Folded;
  /** The Model before, as plain data taken before the step ran. */
  readonly kept: ReturnType<typeof plain>;
  /** Ids earlier events in this walk were refused under. */
  readonly refusedBefore: ReadonlySet<string>;
};

const idFor = (event: MemberEvent): string => {
  switch (event._tag) {
    case "founded":
      return "founded";
    case "denied":
      return event.id;
    case "granted":
      return event.grant.id;
    case "revoked":
      return event.revoke.id;
    case "added":
      return event.add.id;
  }
};

const signerFor = (event: MemberEvent): string | null =>
  event._tag === "granted" || event._tag === "revoked" || event._tag === "added" ? event.signed.signer : null;

const personFor = (event: MemberEvent): string | null => {
  switch (event._tag) {
    case "granted":
      return event.grant.for;
    case "revoked":
      return event.revoke.for;
    case "added":
      return event.add.for;
    default:
      return null;
  }
};

const keysIn = (model: Folded): ReadonlyMap<string, Key> => (model._tag === "founded" ? model.keys : new Map());
const idsIn = (model: Folded): ReadonlySet<string> => (model._tag === "founded" ? model.ids : new Set());

const at = <A>(xs: ReadonlyArray<A>, n: number): A | undefined => (xs.length === 0 ? undefined : xs[n % xs.length]);

const withStanding = (model: Folded, test: (key: Key) => boolean): ReadonlyArray<string> =>
  [...keysIn(model)].filter(([, key]) => test(key)).map(([name]) => name);

/** Signer pools by standing, each with its weight: the walk picks among those the Model holds. */
const SIGNERS: ReadonlyArray<readonly [number, (key: Key) => boolean]> = [
  [5, (k) => k._tag === "live" && k.rank === "person"],
  [3, (k) => k._tag === "live" && k.rank === "recovery"],
  [1, (k) => k._tag === "live" && (k.rank === "window" || k.rank === "agent")],
  [1, (k) => k._tag === "revoked"],
  [2, (k) => k._tag === "spent"],
  [2, (k) => k._tag === "replaced"],
];

/** A signer read off the Model: mostly a live person key, else a sheet, a leaf, a key of each stopped
 *  standing, or a key the Model does not hold. */
const pickSigner = (model: Folded, c: Choice, n: number): string => {
  const pools = SIGNERS.map(([weight, test]) => [weight, withStanding(model, test)] as const)
    .filter(([, keys]) => keys.length > 0)
    .flatMap(([weight, keys]) => Array.from({ length: weight }, () => keys));
  const pool = at([...pools, []], c.pool) ?? [];
  return at(pool, c.signer) ?? `stranger:${c.raw}#${n}`;
};

/** A key an event names: fresh, a short drawn string that may collide, or one the Model holds. */
const pickTarget = (model: Folded, c: Choice, n: number, fresh: string): string => {
  if (c.aim < 3) {
    return `${fresh}#${n}`;
  }

  if (c.aim === 3) {
    return c.raw;
  }

  const live = withStanding(model, (k) => k._tag === "live");
  const stopped = withStanding(model, (k) => k._tag !== "live");
  return at(c.aim === 7 ? stopped : c.aim === 6 ? [...keysIn(model).keys()] : live, c.target) ?? `${fresh}#${n}`;
};

const pickDrops = (model: Folded, c: Choice, signer: string): Array<string> =>
  c.drops.map(([which, n]) =>
    which === 0
      ? signer
      : which === 1
        ? (at(
            withStanding(model, (k) => k._tag !== "live"),
            n,
          ) ?? `gone#${n}`)
        : (at([...keysIn(model).keys()], n) ?? `gone#${n}`),
  );

const pickFor = (model: Folded, c: Choice): string =>
  c.for < 8 ? (model._tag === "founded" ? model.person : P) : c.for === 8 ? OTHER : "";

const pickId = (model: Folded, c: Choice, refused: ReadonlyArray<string>, n: number, kind: string): string => {
  const accepted = [...idsIn(model)];
  return (c.id === 0 ? at(accepted, c.pick) : c.id === 1 ? at(refused, c.pick) : undefined) ?? `${kind}_${c.raw}#${n}`;
};

const founding = (c: Choice): MemberEvent => ({
  _tag: "founded",
  id: c.founder,
  name: c.name,
  keys: [...c.keys],
  window: c.window,
});

/** Turn one choice into an event, reading the Model the walk has reached. */
const choose = (
  model: Folded,
  c: Choice,
  n: number,
  accepted: ReadonlyArray<MemberEvent>,
  refused: ReadonlyArray<string>,
): MemberEvent => {
  if ((model._tag === "unfounded" && c.found > 0) || c.kind === "founded") {
    return founding(c);
  }

  if (c.kind === "resend") {
    return at(accepted, c.pick) ?? founding(c);
  }

  const signer = pickSigner(model, c, n);
  const id = pickId(model, c, refused, n, c.kind);
  const who = pickFor(model, c);

  switch (c.kind) {
    case "denied":
      return { _tag: "denied", id, key: pickTarget(model, c, n, "denied"), saw: SAW, by: signer };
    case "granted":
      return {
        _tag: "granted",
        grant: { id, key: pickTarget(model, c, n, "leaf"), for: who, to: TO, as: c.as, saw: SAW, sentAt: SENT },
        signed: signed(signer),
      };
    case "revoked":
      return {
        _tag: "revoked",
        revoke: { id, key: pickTarget(model, c, n, "gone"), for: who, to: TO, saw: TOOK, sentAt: SENT },
        signed: signed(signer),
      };
    case "person":
      return {
        _tag: "added",
        add: {
          id,
          for: who,
          to: TO,
          adds: { _tag: "person", key: pickTarget(model, c, n, "device"), window: pickTarget(model, c, n + 1, "tab") },
          drops: pickDrops(model, c, signer),
          saw: ADD_SAW,
          sentAt: SENT,
        },
        signed: signed(signer),
      };
    default:
      return {
        _tag: "added",
        add: {
          id,
          for: who,
          to: TO,
          adds: { _tag: "recovery", key: pickTarget(model, c, n, "sheet"), v: 1 },
          drops: pickDrops(model, c, signer),
          saw: { ...ADD_SAW, how: "sheet", typed: true, kept: "print" },
          sentAt: SENT,
        },
        signed: signed(signer),
      };
  }
};

/** Fold a walk through the real machine from its real `init`, one Msg per event. */
const walk = (choices: ReadonlyArray<Choice>): { readonly start: Folded; readonly steps: ReadonlyArray<Step> } => {
  const [start, cmds] = access.init(null, {});
  expect(cmds).toEqual([]);
  const steps: Array<Step> = [];
  const accepted: Array<MemberEvent> = [];
  const refused: Array<string> = [];
  let model = start;

  for (const [n, c] of choices.entries()) {
    const event = choose(model, c, n, accepted, refused);
    const refusedBefore = new Set(refused);
    const kept = plain(model);
    const [post, sent] = applyCell(access, model, { type: "fold", event });
    expect(sent).toEqual([]);
    steps.push({ pre: model, event, post, kept, refusedBefore });

    if (post.reply._tag === "accepted") {
      accepted.push(event);
    } else {
      refused.push(idFor(event));
    }

    model = post;
  }

  return { start, steps };
};

const walks = (check: (steps: ReadonlyArray<Step>, start: Folded) => void) =>
  fc.assert(
    fc.property(Walk, (choices) => {
      const { start, steps } = walk(choices);
      check(steps, start);
    }),
    { seed: SEED, numRuns: RUNS, includeErrorInReport: true },
  );

/** What the reply says: `accepted`, or the refusal's reason. */
const answer = (model: Folded): "accepted" | Reason =>
  model.reply._tag === "accepted" ? "accepted" : model.reply.reason;

/** Keys and ids as plain data, so two Models compare however their maps were filled. */
const plain = (model: Folded) => ({
  tag: model._tag,
  person: model._tag === "founded" ? model.person : null,
  name: model._tag === "founded" ? model.name : null,
  keys: [...keysIn(model)].map(([name, k]) => [name, k._tag, k.rank, k.under] as const).sort(),
  ids: [...idsIn(model)].sort(),
});

/** The view as plain data. */
const viewed = (m: Access) => ({
  person: m.person,
  name: m.name,
  keys: [...m.keys].map(([name, k]) => [name, k.rank, k.live, k.under] as const).sort(),
  spent: [...m.spent].sort(),
});

/** How the plan's rule table answers a signer: refused with a reason, or its rank. */
const standing = (pre: Founded, signer: string, person: string): Reason | Key["rank"] => {
  const key = pre.keys.get(signer);

  if (person !== pre.person || key === undefined) {
    return "not_member";
  }

  if (key._tag === "spent") {
    return "used";
  }

  if (key._tag === "replaced" || key._tag === "revoked") {
    return key._tag;
  }

  return key.rank;
};

/** Whether `name` may join as `rank`: missing, or live with that rank. */
const joining = (pre: Founded, name: string, rank: Key["rank"]): "accepted" | Reason => {
  const key = pre.keys.get(name);

  if (key === undefined) {
    return "accepted";
  }

  if (key._tag !== "live") {
    return "revoked";
  }

  return key.rank === rank ? "accepted" : "not_allowed";
};

/** The answer the plan's rule table gives a fresh signed event in `founded`. */
const ruled = (pre: Founded, event: MemberEvent): "accepted" | Reason => {
  const signer = signerFor(event) ?? "";
  const rank = standing(pre, signer, personFor(event) ?? "");

  if (rank !== "person" && rank !== "window" && rank !== "agent" && rank !== "recovery") {
    return rank;
  }

  if (event._tag === "granted") {
    return rank === "person" ? joining(pre, event.grant.key, event.grant.as) : "not_allowed";
  }

  if (event._tag === "revoked") {
    if (rank !== "person" || event.revoke.key === signer) {
      return "not_allowed";
    }

    const target = pre.keys.get(event.revoke.key);
    return target === undefined ? "not_member" : target._tag === "live" ? "accepted" : "revoked";
  }

  if (event._tag === "added") {
    const adds = event.add.adds;

    if (rank !== "person" && !(rank === "recovery" && adds._tag === "person")) {
      return "not_allowed";
    }

    return joining(pre, adds.key, adds._tag);
  }

  return "accepted";
};

/** Whether `name` would dial: a live window or agent whose every key above is live, with no loop. */
const dials = (keys: ReadonlyMap<string, Key>, name: string): boolean => {
  const key = keys.get(name);

  if (key === undefined || key._tag !== "live" || (key.rank !== "window" && key.rank !== "agent")) {
    return false;
  }

  const passed = new Set([name]);

  for (let above = key.under; above !== null;) {
    const parent = keys.get(above);

    if (parent === undefined || parent._tag !== "live" || passed.has(above)) {
      return false;
    }

    passed.add(above);
    above = parent.under;
  }

  return true;
};

/** The keys on `name`'s chain, itself first, stopping at a missing key or a loop. */
const chain = (keys: ReadonlyMap<string, Key>, name: string): ReadonlyArray<string> => {
  const out: Array<string> = [];

  for (let on: string | null = name; on !== null && !out.includes(on); on = keys.get(on)?.under ?? null) {
    out.push(on);
  }

  return out;
};

describe("ticket 706, the access machine's types", () => {
  it("unfounded carries no founder data, and each key has exactly one standing", () => {
    walks((steps, start) => {
      for (const model of [start, ...steps.map((s) => s.post)]) {
        if (model._tag === "unfounded") {
          expect(Object.keys(model).sort()).toEqual(["_tag", "reply"]);
        }

        for (const [name, k] of keysIn(model)) {
          expect(Object.keys(k).sort(), name).toEqual(["_tag", "rank", "under"]);
          expect(["live", "revoked", "spent", "replaced"]).toContain(k._tag);
        }
      }

      expectTypeOf<Folded["_tag"]>().toEqualTypeOf<"unfounded" | "founded">();
      expectTypeOf<Unfounded>().not.toHaveProperty("person");
      expectTypeOf<Unfounded>().not.toHaveProperty("name");
      expectTypeOf<Unfounded>().not.toHaveProperty("keys");
      expectTypeOf<Unfounded>().not.toHaveProperty("ids");
      expectTypeOf<keyof Unfounded>().toEqualTypeOf<"_tag" | "reply">();
      expectTypeOf<Founded["person"]>().toEqualTypeOf<string>();
      expectTypeOf<Standing>().toEqualTypeOf<"live" | "revoked" | "spent" | "replaced">();
      expectTypeOf<Key>().not.toHaveProperty("live");
      expectTypeOf<Key>().not.toHaveProperty("spent");
      expectTypeOf<Key>().not.toHaveProperty("replaced");
      expectTypeOf<Extract<Key, { readonly _tag: "spent" }>["rank"]>().toEqualTypeOf<"recovery">();
      expectTypeOf<Extract<Key, { readonly _tag: "spent" }>["under"]>().toEqualTypeOf<null>();
      expectTypeOf<Extract<Key, { readonly _tag: "replaced" }>["rank"]>().toEqualTypeOf<"recovery">();
      expectTypeOf<Extract<Key, { readonly _tag: "replaced" }>["under"]>().toEqualTypeOf<null>();
      // @ts-expect-error a spent window cannot be written: only a sheet is spent
      const spentWindow: Key = { _tag: "spent", rank: "window", under: null };
      // @ts-expect-error a replaced sheet hangs under nothing
      const replacedUnder: Key = { _tag: "replaced", rank: "recovery", under: "device" };
      // @ts-expect-error a key is live or stopped by its tag, never by a flag beside it
      const flagged: Key = { _tag: "live", rank: "recovery", under: null, spent: true };
      // @ts-expect-error unfounded has no person
      const founder: Unfounded = { _tag: "unfounded", reply: { _tag: "accepted" }, person: P };
      expect([spentWindow, replacedUnder, flagged, founder]).toHaveLength(4);
    });
  });
});

describe("ticket 706, the access machine walked from init", () => {
  it("the first founding fixes the identity, a later one cannot replace it, and an empty id still founds", () => {
    walks((steps) => {
      for (const { pre, event, post } of steps) {
        if (pre._tag === "unfounded") {
          if (event._tag !== "founded") {
            expect(post._tag, "only a founding leaves unfounded").toBe("unfounded");
            expect(answer(post)).toBe("not_member");
            continue;
          }

          expect(post._tag).toBe("founded");
          expect(answer(post)).toBe("accepted");

          if (post._tag !== "founded") {
            continue;
          }

          // The empty person id founds too: founding is the state, never a non-empty string.
          expect(post.person).toBe(event.id);
          expect(post.name).toBe(event.name);
          expect([...post.ids]).toEqual(["founded"]);
          const [first] = event.keys;

          for (const key of event.keys) {
            expect(post.keys.get(key), key).toEqual({ _tag: "live", rank: "person", under: null });
          }

          const window = event.window;
          const extra = window !== null && first !== undefined && !event.keys.includes(window) ? 1 : 0;
          expect(post.keys.size).toBe(new Set(event.keys).size + extra);

          if (extra === 1 && window !== null) {
            expect(post.keys.get(window)).toEqual({ _tag: "live", rank: "window", under: first });
          }

          continue;
        }

        expect(post._tag, "a founded Model stays founded").toBe("founded");

        if (post._tag !== "founded") {
          continue;
        }

        expect(post.person).toBe(pre.person);
        expect(post.name).toBe(pre.name);

        if (event._tag === "founded") {
          expect(answer(post), "a later founding is the founding again").toBe("accepted");
          expect(plain(post)).toEqual(plain(pre));
        }

        if (event._tag === "denied" && !pre.ids.has(event.id)) {
          // Kept as it was: with an empty person id a fresh denial is refused.
          expect(answer(post)).toBe(pre.person === "" ? "not_member" : "accepted");
          expect(plain(post).keys).toEqual(plain(pre).keys);
        }
      }
    });
  });

  it("an accepted id is accepted again with no change, and a refused id stays free for a later event", () => {
    let reused = 0;
    walks((steps) => {
      for (const { pre, event, post, refusedBefore } of steps) {
        const id = idFor(event);

        if (idsIn(pre).has(id)) {
          expect(answer(post), "dedup comes before any rule").toBe("accepted");
          expect(plain(post)).toEqual(plain(pre));
          continue;
        }

        if (answer(post) !== "accepted") {
          expect(plain(post), "a refusal records nothing").toEqual(plain(pre));
          expect(idsIn(post).has(id)).toBe(false);
          continue;
        }

        expect([...idsIn(post)].sort()).toEqual([...idsIn(pre), id].sort());

        if (refusedBefore.has(id)) {
          reused++;
        }
      }
    });
    expect(reused, "the walk reuses refused ids for events that then pass").toBeGreaterThan(0);
  });

  it("only a permitted live signer changes who belongs, and every refusal keeps its exact reason", () => {
    const seen = new Set<string>();
    walks((steps) => {
      for (const { pre, event, post } of steps) {
        if (pre._tag !== "founded" || pre.ids.has(idFor(event)) || post._tag !== "founded") {
          continue;
        }

        if (event._tag === "founded" || event._tag === "denied") {
          continue;
        }

        const want = ruled(pre, event);
        seen.add(want);
        expect(answer(post), `${event._tag} by ${event.signed.signer}`).toBe(want);

        if (want !== "accepted") {
          expect(plain(post)).toEqual(plain(pre));
          continue;
        }

        const signer = event.signed.signer;
        const changed = [...pre.keys].filter(([name, k]) => post.keys.get(name)?._tag !== k._tag).map(([n]) => n);
        const added = [...post.keys.keys()].filter((name) => !pre.keys.has(name));

        if (event._tag === "granted") {
          expect(changed).toEqual([]);
          const target = event.grant.key;
          expect(added).toEqual(pre.keys.has(target) ? [] : [target]);
          expect(post.keys.get(target)).toEqual(
            pre.keys.get(target) ?? { _tag: "live", rank: event.grant.as, under: signer },
          );
        }

        if (event._tag === "revoked") {
          expect(changed).toEqual([event.revoke.key]);
          expect(added).toEqual([]);
          expect(post.keys.get(event.revoke.key)?._tag).toBe("revoked");
        }

        if (event._tag === "added") {
          const { adds, drops } = event.add;
          const bySheet = pre.keys.get(signer)?.rank === "recovery";
          const sheets = withStanding(pre, (k) => k._tag === "live" && k.rank === "recovery");
          const ended = adds._tag === "recovery" ? sheets.filter((name) => name !== adds.key) : [];
          const named = new Set([...drops.filter((d) => d !== signer), ...ended, ...(bySheet ? [signer] : [])]);

          for (const name of changed) {
            expect(named.has(name), `${name} changed but the event never named it`).toBe(true);
          }

          for (const name of drops) {
            if (name !== signer && post.keys.has(name)) {
              expect(post.keys.get(name)?._tag, `dropped ${name}`).not.toBe("live");
            }
          }

          if (!bySheet) {
            expect(post.keys.get(signer)?._tag, "a device never drops itself").toBe("live");
          }

          const joined = adds._tag === "person" ? [adds.key, adds.window] : [adds.key];
          expect(added.every((name) => joined.includes(name))).toBe(true);
          const fresh = pre.keys.get(adds.key) === undefined;
          expect(post.keys.get(adds.key)?.rank).toBe(adds._tag);
          expect(post.keys.get(adds.key)?.under).toBe(fresh ? null : pre.keys.get(adds.key)?.under);

          if (adds._tag === "person" && !pre.keys.has(adds.window) && adds.window !== adds.key) {
            expect(post.keys.get(adds.window)?.rank).toBe("window");
            expect(post.keys.get(adds.window)?.under).toBe(adds.key);
          }

          for (const name of joined) {
            if (!pre.keys.has(name) && !drops.includes(name)) {
              expect(post.keys.get(name)?._tag, `${name} joins live`).toBe("live");
            }
          }
        }
      }
    });

    for (const reason of ["accepted", "not_member", "not_allowed", "used", "replaced", "revoked"]) {
      expect(seen.has(reason), `the walk reaches ${reason}`).toBe(true);
    }
  });

  it("a key keeps its rank and parent forever, and a stopped key never lives or changes its standing", () => {
    walks((steps) => {
      for (const { pre, post } of steps) {
        for (const [name, before] of keysIn(pre)) {
          const after = keysIn(post).get(name);
          expect(after, `${name} left the Model`).toBeDefined();
          expect(after?.rank, name).toBe(before.rank);
          expect(after?.under, name).toBe(before.under);

          if (before._tag !== "live") {
            expect(after?._tag, `${name} was ${before._tag}`).toBe(before._tag);
          }
        }
      }
    });
  });

  it("a sheet works once, a new sheet ends every other live one, and drops keep spent and replaced", () => {
    let used = 0;
    let replaced = 0;
    walks((steps) => {
      for (const { pre, event, post } of steps) {
        const keys = keysIn(post);
        const sheets = withStanding(post, (k) => k._tag === "live" && k.rank === "recovery");
        expect(sheets.length, "at most one live sheet").toBeLessThanOrEqual(1);

        for (const [name, k] of keys) {
          if (k._tag === "spent" || k._tag === "replaced") {
            expect([k.rank, k.under], name).toEqual(["recovery", null]);
          }
        }

        if (pre._tag !== "founded" || pre.ids.has(idFor(event)) || event._tag !== "added") {
          continue;
        }

        const signer = pre.keys.get(event.signed.signer);
        const accepted = answer(post) === "accepted";

        if (signer?._tag === "spent" && event.add.for === pre.person) {
          used++;
          expect(answer(post), "a spent sheet signs nothing").toBe("used");
          expect(plain(post)).toEqual(plain(pre));
        }

        if (accepted && signer?._tag === "live" && signer.rank === "recovery") {
          expect(keys.get(event.signed.signer)?._tag, "the sheet that let a device in is spent").toBe("spent");
        }

        if (accepted && event.add.adds._tag === "recovery") {
          const fresh = event.add.adds.key;

          for (const name of withStanding(pre, (k) => k._tag === "live" && k.rank === "recovery")) {
            if (name !== fresh) {
              replaced++;
              expect(keys.get(name)?._tag, `${name} ended by the new sheet`).toBe("replaced");
            }
          }
        }
      }
    });
    expect(used, "the walk tries a spent sheet").toBeGreaterThan(0);
    expect(replaced, "the walk replaces a live sheet").toBeGreaterThan(0);
  });

  it("a key is admitted only as a live window or agent under live keys, and a stop ends only its own branch", () => {
    let independent = 0;
    walks((steps) => {
      for (const { pre, post } of steps) {
        const view = members(post);
        const keys = keysIn(post);
        const person = post._tag === "founded" ? post.person : "";

        for (const name of [...keys.keys(), "stranger"]) {
          const rank = keys.get(name)?.rank;
          expect(admitted(view, name), name).toEqual(
            dials(keys, name) ? { key: name, person, as: rank } : { reason: "not_granted" },
          );
        }

        const stopped = [...keysIn(pre)]
          .filter(([name, k]) => k._tag === "live" && keys.get(name)?._tag !== "live")
          .map(([name]) => name);

        for (const name of keysIn(pre).keys()) {
          if (!dials(keysIn(pre), name)) {
            continue;
          }

          const hit = chain(keysIn(pre), name).some((on) => stopped.includes(on));

          if (!hit && stopped.length > 0) {
            independent++;
          }

          expect("as" in admitted(view, name), `${name} after stopping ${stopped.join(", ")}`).toBe(!hit);
        }
      }
    });
    expect(independent, "the walk stops one branch while another stays in").toBeGreaterThan(0);
  });

  it("replay and stepping agree at every cut, and no step touches an earlier Model or event", () => {
    walks((steps, start) => {
      expect(plain(EMPTY)).toEqual(plain(start));
      expect(viewed(members(start))).toEqual({ person: "", name: "", keys: [], spent: [] });
      const events = steps.map((s) => s.event);
      const copies = structuredClone(events);
      expect(
        steps.map((s) => plain(s.pre)),
        "an earlier Model changed",
      ).toEqual(steps.map((s) => s.kept));

      for (const [i, { pre, event, post }] of steps.entries()) {
        expect(viewed(foldAccess(events.slice(0, i + 1))), `cut ${i + 1}`).toEqual(viewed(members(post)));
        const once = allows(pre, event);

        if (answer(post) === "accepted") {
          expect(Result.isSuccess(once) && plain(once.success)).toEqual(plain(post));
        } else {
          expect(Result.isFailure(once) && once.failure).toBe(answer(post));
        }

        const view = members(post);
        expect(view.person).toBe(post._tag === "founded" ? post.person : "");
        expect(view.name).toBe(post._tag === "founded" ? post.name : "");
        expect([...view.keys].map(([name, k]) => [name, k.rank, k.live, k.under] as const).sort()).toEqual(
          [...keysIn(post)].map(([name, k]) => [name, k.rank, k._tag === "live", k.under] as const).sort(),
        );
        expect([...view.spent].sort()).toEqual([...withStanding(post, (k) => k._tag === "spent")].sort());
      }

      expect(events).toEqual(copies);
    });
  });
});
