// p43's pure half, on the waiting machine (ticket 707, decisions 0037 and 0046). The laws step it
// only through its real `init` and update cells: `Waiting.machine.init(loaded, { most, ttl })`, and
// `applyCell(Waiting.machine, model, msg)` with a `knock`, `leave`, `expire` or `accepted` Msg.
// `Waiting.Stored` is the codec for the saved value: the Model in memory, and the flat
// `{ rows, most, ttl }` with each row's legacy `where` and derived `tabs` when encoded.
// Access prunes; duplicate client ids do not count twice. Persistence is owned by door.test.ts.
// Plants: code per tab; increment on every knock; no expiry/cap; newest-first eviction. The walk's
// plants are named on each law and were run once, then undone (decision 0093).
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import * as Waiting from "./waiting.ts";

type Model = typeof Waiting.machine.model.Type;
type Msg = typeof Waiting.machine.msg.Type;
type Knock = Extract<Msg, { readonly type: "knock" }>;
type Empty = Extract<Model, { readonly _tag: "empty" }>;
type Busy = Extract<Model, { readonly _tag: "waiting" }>;
type Pending = Busy["rows"][number];

// Compile-only law: `empty` holds no rows, `waiting` holds at least one, and a pending row holds
// at least one client. `tabs` is derived when a row is encoded, so the Model cannot hold one.
const shapeTypeLaw = (empty: Empty, busy: Busy, row: Pending) => {
  expectTypeOf<Empty["_tag"]>().toEqualTypeOf<"empty">();
  expectTypeOf<Busy["_tag"]>().toEqualTypeOf<"waiting">();
  expectTypeOf<Pending["clients"]>().toEqualTypeOf<readonly [string, ...Array<string>]>();
  const one: Pending = { ...row, clients: [row.clients[0]] };
  // @ts-expect-error a pending row has at least one client
  const lonely: Pending = { ...row, clients: [] };
  // @ts-expect-error an empty Model holds no rows
  const full: Empty = { ...empty, rows: [row] };
  // @ts-expect-error a waiting Model holds at least one row
  const bare: Busy = { ...busy, rows: [] };
  // @ts-expect-error tabs is derived when a row is encoded, never stored in the Model
  const tabs: number = row.tabs;
  return [one, lonely, full, bare, tabs];
};

void shapeTypeLaw;

const runs = { seed: 119120, numRuns: 100 };
const json = () => Schema.fromJsonString(Waiting.Stored);

const step = (s: Model, msg: Msg): Model => {
  const [next, cmds] = applyCell(Waiting.machine, s, msg);
  expect(cmds).toEqual([]);
  return next;
};

const state = (ttl = 600_000, most = 3, loaded: Model | null = null): Model => {
  const [s, cmds] = Waiting.machine.init(loaded, { most, ttl });
  expect(cmds).toEqual([]);
  return s;
};

const encoded = (s: Model) => Schema.encodeSync(Waiting.Stored)(s);

const knock = (s: Model, key: string, client: string, at: number, code: string = "1234") =>
  step(s, {
    type: "knock",
    key,
    client,
    label: "Browser",
    location: "test",
    has: ["verify", "seal"],
    as: "window",
    code,
    pass: null,
    at,
  });

const leave = (s: Model, key: string, client: string) => step(s, { type: "leave", key, client });

const expire = (s: Model, at: number) => step(s, { type: "expire", at });

describe("P10 waiting rows", () => {
  it("p43: one checked key, two tabs, one stable code until expiry", () => {
    // Plant: append duplicate clients without a Set. The two-tab match must fail.
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string(),
          clients: fc.uniqueArray(fc.string(), { minLength: 2, maxLength: 2 }),
          codes: fc.tuple(fc.string(), fc.string(), fc.string()),
          at: fc.nat({ max: 1_000_000_000 }),
          ttl: fc.integer({ min: 3, max: 1_000_000 }),
        }),
        ({ key, clients: [one = "", two = ""], codes: [code, secondCode, thirdCode], at, ttl }) => {
          const first = knock(state(ttl), key, one, at, code);
          const second = knock(first, key, two, at + 1, secondCode);
          const duplicate = knock(second, key, two, at + 2, thirdCode);
          expect(encoded(first).rows[0]?.tabs).toBe(1);
          expect(duplicate.rows).toHaveLength(1);
          expect(encoded(duplicate).rows[0]).toMatchObject({
            key,
            tabs: 2,
            code,
            until: at + ttl,
            has: ["verify", "seal"],
            pass: null,
          });
          const left = leave(duplicate, key, one);
          expect(encoded(left).rows[0]?.tabs).toBe(1);
          expect(leave(left, key, two).rows).toEqual([]);
        },
      ),
      {
        ...runs,
        examples: [
          [
            {
              key: "k",
              clients: ["tab1", "tab2"],
              codes: ["1234", "9999", "8888"],
              at: 0,
              ttl: 600_000,
            },
          ],
        ],
      },
    );
  });
  it("p43: expiry boundary and access pruning do not renew an old code", () => {
    // Plant: keep rows whose until equals at. The empty rows assertion must fail.
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        fc.string(),
        fc.string(),
        fc.nat({ max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (key, one, two, code, replacement, at, ttl) => {
          const first = knock(state(ttl), key, one, at, code);
          expect(expire(first, at + ttl - 1).rows).toHaveLength(1);
          expect(expire(first, at + ttl).rows).toEqual([]);
          const next = knock(first, key, two, at + ttl, replacement);
          expect(encoded(next).rows[0]).toMatchObject({ code: replacement, tabs: 1, until: at + 2 * ttl });
        },
      ),
      { ...runs, examples: [["a", "tab1", "tab2", "1234", "5678", 0, 600_000]] },
    );
  });
  it("p43: the cap evicts the oldest key, never another tab's newer code", () => {
    // Plant: keep the oldest rows with slice(0, most). The remaining-key equality must fail.
    fc.assert(
      fc.property(fc.uniqueArray(fc.string(), { minLength: 2, maxLength: 20 }), (keys) => {
        let s = state(600_000, keys.length - 1);

        for (const [at, key] of keys.entries()) {
          s = knock(s, key, `${key}1`, at);
        }

        expect(s.rows.map((r) => r.key)).toEqual(keys.slice(1));
      }),
      { ...runs, examples: [[["a", "b", "c", "d"]]] },
    );
  });
  it("p43: arbitrary duplicate knocks have exactly the distinct live tab count", () => {
    // Plant: append duplicate clients without a Set. The distinct-count equality must fail.
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 40 }), (tabs) => {
        let s = state();

        for (const tab of tabs) {
          s = knock(s, "a", `t${tab}`, 0);
        }

        expect(s.rows).toHaveLength(1);
        expect(encoded(s).rows[0]?.tabs).toBe(new Set(tabs).size);
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
  // The cap is an Int of at least 1. A cap below 1 is refused by init and by decode. Any cap
  // n >= 1 keeps exactly the newest n rows after knocks from more than n keys. Plants: drop the
  // >= 1 check; drop the cap's slice.
  it("p43: a cap below 1 is refused, and any cap n keeps the newest n rows", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 8 }), fc.integer({ min: 1, max: 6 }), (most, extra) => {
        const raw = { rows: [], most, ttl: 600_000 };

        if (most < 1) {
          expect(() => Waiting.machine.init(null, { most, ttl: 600_000 })).toThrow();
          expect(Schema.decodeUnknownOption(Waiting.Stored)(raw)).toEqual(Option.none());
          return;
        }

        const keys = Array.from({ length: most + extra }, (_, i) => `k${i}`);
        const s = keys.reduce((w, k, i) => knock(w, k, `${k}-tab`, i), state(600_000, most));
        expect(s.rows.map((r) => r.key)).toEqual(keys.slice(-most));
      }),
      // pinned: a cap of 0. Before PR 516 the cap was any Int, and slice(-0) kept every row, so
      // 0 capped nothing.
      { seed: 119120, endOnFailure: true, numRuns: 100, examples: [[0, 3]] },
    );
  });
});

// One generated walk (decision 0093). Each seed is resolved against the Model the real machine
// has folded so far: it picks a present, gone or fresh key, a present or new client, a time
// before, at or after a present row's deadline, a subset of present keys plus an absent one, or
// the previous Msg again. Each law reads every transition the walk made, not only its end.
const Seed = fc.record({
  kind: fc.constantFrom("knock", "knock", "knock", "leave", "expire", "accepted"),
  pick: fc.nat(),
  other: fc.nat(),
  fresh: fc.nat(3),
  when: fc.integer({ min: -1, max: 2 }),
  again: fc.nat(7),
  code: fc.string({ maxLength: 3 }),
  label: fc.string({ maxLength: 3 }),
  pass: fc.option(fc.string({ maxLength: 3 }), { nil: null }),
  has: fc.subarray(["verify", "seal"]),
  as: fc.constantFrom("window", "agent"),
});

const Walk = fc.record({
  most: fc.integer({ min: 1, max: 4 }),
  ttl: fc.integer({ min: 1, max: 30 }),
  seeds: fc.array(Seed, { minLength: 10, maxLength: 60, size: "max" }),
});

type Walk = typeof Walk extends fc.Arbitrary<infer A> ? A : never;
type Seed = Walk["seeds"][number];
type Step = { readonly before: Model; readonly msg: Msg; readonly after: Model };

const at = <A>(list: ReadonlyArray<A>, n: number): A | undefined => list[n % Math.max(1, list.length)];

const resolve = (s: Model, seed: Seed, memory: { now: number; keys: Array<string>; clients: number }): Msg => {
  const rows = s.rows;
  const row = at(rows, seed.pick);
  const gone = memory.keys.filter((k) => !rows.some((r) => r.key === k));
  const time = () => {
    const t = row === undefined || seed.when === 2 ? memory.now + 1 + (seed.other % 5) : row.until + seed.when;
    memory.now = Math.max(memory.now, t);
    return t;
  };
  const freshKey = () => {
    const k = `k${memory.keys.length}`;
    memory.keys.push(k);
    return k;
  };
  const absentKey = () => at(gone, seed.other) ?? "unknown";

  if (seed.kind === "expire") {
    return { type: "expire", at: time() };
  }

  if (seed.kind === "accepted") {
    const keys = rows.filter((_, i) => (seed.pick >> i) % 2 === 1).map((r) => r.key);
    return { type: "accepted", keys: seed.fresh === 0 ? [...keys, absentKey()] : keys };
  }

  if (seed.kind === "leave") {
    const target = seed.fresh === 0 || row === undefined ? absentKey() : row.key;
    const client =
      seed.other % 3 === 0 ? "nobody" : (at(row?.clients ?? [], seed.other) ?? at(rows[0]?.clients ?? [], 0) ?? "x");
    return { type: "leave", key: target, client };
  }

  const key =
    seed.fresh === 0 || row === undefined
      ? freshKey()
      : seed.fresh === 1
        ? (at(gone, seed.other) ?? freshKey())
        : row.key;
  const own = rows.find((r) => r.key === key);
  const client =
    own !== undefined && seed.other % 3 !== 0 ? (at(own.clients, seed.other) ?? "x") : `c${memory.clients++}`;
  return {
    type: "knock",
    key,
    client,
    label: seed.label,
    location: `at-${seed.label}`,
    code: seed.code,
    pass: seed.pass,
    has: seed.has,
    as: seed.as,
    at: time(),
  };
};

const fold = (walk: Walk) => {
  const memory = { now: 0, keys: [] as Array<string>, clients: 0 };
  const steps: Array<Step> = [];
  let s = state(walk.ttl, walk.most);

  for (const seed of walk.seeds) {
    const last = steps.at(-1)?.msg;
    const msg = seed.again === 0 && last !== undefined ? last : resolve(s, seed, memory);
    const after = step(s, msg);
    steps.push({ before: s, msg, after });
    s = after;
  }

  return { steps, end: s };
};

// The spec's own words for expiry: a row lives while `until > at`.
const live = (s: Model, t: number) => s.rows.filter((r) => r.until > t);

const legacy = (s: Model) =>
  JSON.stringify({
    rows: s.rows.map((r) => ({
      key: r.key,
      label: r.label,
      where: r.location,
      code: r.code,
      until: r.until,
      tabs: r.clients.length,
      clients: r.clients,
      pass: r.pass,
      has: r.has,
      as: r.as,
    })),
    most: s.most,
    ttl: s.ttl,
  });

describe("ticket 707: the waiting machine walks", () => {
  it("one row per key; a repeat knock keeps its code, deadline, metadata and place; tabs are distinct", () => {
    // Plant: replace the existing row's code on a repeat knock. The kept-row equality must fail.
    fc.assert(
      fc.property(Walk, (walk) => {
        for (const { before, msg, after } of fold(walk).steps) {
          expect(after._tag).toBe(after.rows.length === 0 ? "empty" : "waiting");
          expect({ most: after.most, ttl: after.ttl }).toEqual({ most: walk.most, ttl: walk.ttl });
          expect(new Set(after.rows.map((r) => r.key)).size).toBe(after.rows.length);

          for (const r of after.rows) {
            expect(r.clients.length).toBeGreaterThan(0);
            expect(new Set(r.clients).size).toBe(r.clients.length);
          }

          expect(encoded(after).rows.map((r) => r.tabs)).toEqual(after.rows.map((r) => r.clients.length));

          if (msg.type !== "knock") {
            continue;
          }

          const kept = live(before, msg.at);
          const old = kept.find((r) => r.key === msg.key);

          if (old !== undefined) {
            const clients = old.clients.includes(msg.client) ? old.clients : [...old.clients, msg.client];
            expect(after.rows).toEqual(kept.map((r) => (r === old ? { ...old, clients } : r)));
          }
        }
      }),
      runs,
    );
  });
  it("expiry removes exactly the rows with until <= at, and a knock after expiry starts a fresh wait", () => {
    // Plant: keep rows whose until equals at (>= for >). The expired-rows equality must fail.
    fc.assert(
      fc.property(Walk, (walk) => {
        const got: Array<unknown> = [],
          want: Array<unknown> = [];

        for (const { before, msg, after } of fold(walk).steps) {
          if (msg.type === "expire") {
            got.push(after.rows);
            want.push(live(before, msg.at));
          }

          if (msg.type === "knock" && !live(before, msg.at).some((r) => r.key === msg.key)) {
            const { type: _type, client, at: t, ...row } = msg satisfies Knock;
            got.push(after.rows.at(-1));
            want.push({ ...row, clients: [client], until: t + walk.ttl });
          }
        }

        expect(got).toEqual(want);
      }),
      runs,
    );
  });
  it("a positive cap keeps the newest keys, and a repeat knock does not change eviction order", () => {
    // Plant: keep the oldest rows on overflow (slice(0, most)). The key-order equality must fail.
    fc.assert(
      fc.property(Walk, (walk) => {
        for (const { before, msg, after } of fold(walk).steps) {
          if (msg.type !== "knock") {
            continue;
          }

          const keys = live(before, msg.at).map((r) => r.key);
          expect(after.rows.map((r) => r.key)).toEqual(
            keys.includes(msg.key) ? keys : [...keys, msg.key].slice(-walk.most),
          );
        }
      }),
      runs,
    );
  });
  it("leave removes only the named client, and the row only after its last client", () => {
    // Plant: remove the whole row on the first leave. The kept-clients equality must fail.
    fc.assert(
      fc.property(Walk, (walk) => {
        for (const { before, msg, after } of fold(walk).steps) {
          if (msg.type !== "leave") {
            continue;
          }

          const row = before.rows.find((r) => r.key === msg.key && r.clients.includes(msg.client));

          if (row === undefined) {
            expect(after).toEqual(before);
            continue;
          }

          const clients = row.clients.filter((c) => c !== msg.client);
          expect(after.rows).toEqual(
            clients.length === 0
              ? before.rows.filter((r) => r !== row)
              : before.rows.map((r) => (r === row ? { ...row, clients } : r)),
          );
        }
      }),
      runs,
    );
  });
  it("acceptance removes exactly its keys, keeps the rest in order, and is idempotent", () => {
    // Plant: clear every row on acceptance. The survivors equality must fail.
    fc.assert(
      fc.property(Walk, (walk) => {
        for (const { before, msg, after } of fold(walk).steps) {
          if (msg.type !== "accepted") {
            continue;
          }

          expect(after.rows).toEqual(before.rows.filter((r) => !msg.keys.includes(r.key)));
          expect(step(after, msg)).toEqual(after);
        }
      }),
      runs,
    );
  });
  it("every reached state saves in the stored shape and reloads to the same future", () => {
    // Plant: reset `until` while decoding. The reload equality must fail.
    fc.assert(
      fc.property(Walk, (walk) => {
        const { steps } = fold(walk);

        for (const [cut, { after }] of steps.entries()) {
          const bytes = Schema.encodeSync(json())(after);
          // format: the saved value keeps the flat rows-and-settings shape, its legacy `where` key
          // and a `tabs` count derived from clients, so rows written before 707 stay readable.
          expect(bytes).toBe(legacy(after));
          const reloaded = state(walk.ttl, walk.most, Schema.decodeUnknownSync(json())(bytes));
          expect(reloaded).toEqual(after);
          let s = reloaded;

          for (const later of steps.slice(cut + 1)) {
            s = step(s, later.msg);
            expect(s).toEqual(later.after);
          }
        }
      }),
      runs,
    );
  });
});
