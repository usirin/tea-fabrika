// p68 and p92 (docs/plan/tier-1-detail.md, "Properties"; P6's plan writes them out), for
// `data/log.ts` and the referee's first step: every entry has every field, a writer can leave none
// out and set none of the referee's, and an entry keeps its `parent` as text. Written before the
// modules (Tier 1, P6, ticket 233).
//
// The shape these tests hold the modules to:
// - `Line` is what a writer hands in: `by`, `for`, `sentAt`, `seen`, `parent`, `traceId`, `build`, `_tag` and
//   `body`, every key required. `Entry` is a line plus `id`, `stream`, `pos`, `rev` and `arrivedAt`.
// - `Referee.append(stream, id, line: unknown)` decodes the line with excess keys refused. A missing
//   key, a wrong type, an empty `by`, `for`, `build` or `_tag`, or a key `Line` does not have is
//   `{_tag: "refused", reason: "bad_line"}`; a bad `parent` is `bad_parent`, a bad trace is `bad_trace`.
//   Either way nothing is written.
// - P17a exports the checked `InputId` schema; saved parents still accept legacy text.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import * as fc from "fast-check";
import { inputParents, processId } from "../id.test-support.ts";
import * as data from "./index.ts";
import { Doorbell, Ledger } from "./ledger.ts";
import type { Entry, InputId, Line } from "./log.ts";
import { Referee, type Sql } from "./referee.ts";
import { nodeSql } from "./sqlite.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const READER = "gateway:t1";

// T246's approved addendum: a parent names the door's process, then its input counter.
const PARENT = /^in-process_[0-7][0-9a-hjkmnp-tv-z]{25}-[1-9][0-9]*$/;
const PROCESS = Effect.runSync(processId);

const parents = (count: number): ReadonlyArray<string> =>
  fc.sample(fc.stringMatching(PARENT), { seed: SEED, numRuns: count });

const [goodParent = "", otherParent = ""] = parents(2);
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/** Texts one slip away from a good parent: none of them may pass. */
const badParents = (good: string): ReadonlyArray<string> => [
  "",
  good.toUpperCase(),
  `${good} `,
  ` ${good}`,
  `x${good}`,
  `${good}\n`,
  good.slice(0, 4) + good.slice(5),
  good.replace(/-/g, "_"),
  "in-3f9a0c21-41",
  "in-3f9a0c21-0",
  "in-3f9a0c21-01",
  "in-3f9a0c21-",
  "in-3f9a0c2g-1",
  `in-${PROCESS}-0`,
  `in-${PROCESS}-01`,
  `in-${PROCESS}-`,
  ...["i", "l", "o", "u"].map((char) => `in-process_0${char}${"0".repeat(24)}-1`),
  `in-process_8${"0".repeat(25)}-1`,
  `in-process_0${"0".repeat(24)}-1`,
  `in-process_0${"0".repeat(26)}-1`,
];

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p6-log-"));
const opened: Array<DatabaseSync> = [];
let files = 0;

const fresh = (): Sql => {
  const db = new DatabaseSync(join(folder, `ledger-${++files}.db`));
  opened.push(db);
  return nodeSql(db);
};

afterAll(() => {
  for (const db of opened.splice(0)) {
    if (db.isOpen) {
      db.close();
    }
  }

  rmSync(folder, { recursive: true, force: true });
});

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
const onReferee = (sql: Sql) => Referee.layer(sql).pipe(Layer.provide(quiet));
const onLedger = (sql: Sql) => Ledger.sql(sql, { reader: READER }).pipe(Layer.provide(quiet));

const full: Line = {
  by: "SHA256:writer-a",
  for: "owner",
  sentAt: "2026-11-07T21:10:01.204Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: "b-7c1d073",
  _tag: "saved",
  body: { note: "n-7f3a", base: 3 },
};

/** The same line as plain JSON, the way it comes in across an object call. */
const json = (): Record<string, unknown> => JSON.parse(JSON.stringify(full));

const without = (key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(json()).filter(([k]) => k !== key));

const KEYS = ["by", "for", "sentAt", "seen", "parent", "traceId", "build", "_tag", "body"] as const;
const ENTRY_KEYS = [...KEYS, "id", "stream", "pos", "rev", "arrivedAt"].sort();

const refused = (reason: string) => ({ _tag: "refused", reason });

/** Hands each line to the referee in turn, then answers what each got and what the stream holds. */
const handIn = (lines: ReadonlyArray<unknown>) =>
  Effect.gen(function* () {
    const referee = yield* Referee;
    const answers = yield* Effect.forEach(lines, (line, i) => referee.append("notes:1", `w-${i + 1}`, line), {
      concurrency: 1,
    });
    const entries = yield* referee.read("notes:1", 0, READER);
    return { answers, entries };
  });

describe("p92, every entry has every field: the type", () => {
  // Plant: traceId is optionalKey. Branding ParentText as InputId must fail the type law below.
  it("a Line with any one key left out does not compile", () => {
    const { by: _by, ...noBy } = full;
    const { for: _for, ...noFor } = full;
    const { sentAt: _sentAt, ...noSentAt } = full;
    const { seen: _seen, ...noSeen } = full;
    const { parent: _parent, ...noParent } = full;
    const { traceId: _traceId, ...noTrace } = full;
    const { build: _build, ...noBuild } = full;
    const { _tag: _t, ...noTag } = full;
    const { body: _body, ...noBody } = full;
    // @ts-expect-error `by` is required
    const a: Line = noBy;
    // @ts-expect-error `for` is required
    const b: Line = noFor;
    // @ts-expect-error `sentAt` is required
    const c: Line = noSentAt;
    // @ts-expect-error `seen` is required
    const d: Line = noSeen;
    // @ts-expect-error `parent` is required, even though its value may be null
    const e: Line = noParent;
    // @ts-expect-error `traceId` is required, including an own write with no parent
    const i: Line = noTrace;
    // @ts-expect-error `build` is required
    const f: Line = noBuild;
    // @ts-expect-error `_tag` is required
    const g: Line = noTag;
    // @ts-expect-error `body` is required
    const h: Line = noBody;
    expect([a, b, c, d, e, f, g, h, i].map((line) => Object.keys(line).length)).toEqual(
      KEYS.map(() => KEYS.length - 1),
    );
  });

  it("a Line may not name what the referee sets", () => {
    // @ts-expect-error `arrivedAt` is the referee's
    const a: Line = { ...full, arrivedAt: 5 };
    // @ts-expect-error `rev` is the referee's
    const b: Line = { ...full, rev: 5 };
    // @ts-expect-error `pos` is the referee's
    const c: Line = { ...full, pos: 5 };
    expect([a, b, c].length).toBe(3);
  });

  it("type law, ParentText keeps legacy text, and only input and parent schemas expose InputId", () => {
    // A missing schema fails this assertion while the tests precede the build, not the import.
    expect(data.ParentText, "the parent text schema is public").toBeDefined();
    expectTypeOf<(typeof Entry.Type)["parent"]>().toEqualTypeOf<string | InputId | null>();
    expectTypeOf<Line["parent"]>().toEqualTypeOf<string | InputId | null>();
    expectTypeOf<typeof data.ParentText.Type>().toEqualTypeOf<string | InputId>();
    // P17a's input schema and parent reader expose the brand. No other data export does.
    type Gives<T> = T extends (...args: never) => infer R ? R : T extends { readonly Type: infer A } ? A : never;
    type MakesInputId = {
      [K in keyof typeof data]: [Extract<Gives<(typeof data)[K]>, InputId>] extends [never] ? never : K;
    }[keyof typeof data];
    expectTypeOf<MakesInputId>().toEqualTypeOf<"InputId" | "ParentText">();
    expect(Object.keys(data).length).toBeGreaterThan(0);
  });
});

describe("p92, every entry has every field: at the referee", () => {
  // Plant: traceId is optionalKey; the missing-key case must fail while the full line is placed.
  it.effect.each(KEYS)("a line missing `%s` is refused bad_line, and nothing is written", (key) =>
    Effect.gen(function* () {
      const { answers, entries } = yield* handIn([without(key), json()]);
      expect(answers).toEqual([refused("bad_line"), { _tag: "placed", rev: 1, pos: 1 }]);
      expect(entries.map((entry) => entry.id)).toEqual(["w-2"]);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );

  it.effect.each(["by", "for", "build", "_tag"])("a line with an empty `%s` is refused bad_line", (key) =>
    Effect.gen(function* () {
      const { answers, entries } = yield* handIn([{ ...json(), [key]: "" }]);
      expect(answers).toEqual([refused("bad_line")]);
      expect(entries).toEqual([]);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );

  it.effect.each(["arrivedAt", "rev", "pos", "id", "stream", "color"])(
    "a line that names `%s` is refused bad_line: a writer sets nothing the referee sets",
    (key) =>
      Effect.gen(function* () {
        const { answers, entries } = yield* handIn([{ ...json(), [key]: 7 }, json()]);
        expect(answers).toEqual([refused("bad_line"), { _tag: "placed", rev: 1, pos: 1 }]);
        expect(entries.map((entry) => [entry.id, entry.rev, entry.pos])).toEqual([["w-2", 1, 1]]);
      }).pipe(Effect.provide(onReferee(fresh()))),
  );

  it.effect("a line with a wrong type is refused bad_line", () =>
    Effect.gen(function* () {
      const wrong = [
        { ...json(), seen: "0" },
        { ...json(), seen: -1 },
        { ...json(), seen: 0.5 },
        { ...json(), by: 7 },
        { ...json(), sentAt: 1762549801311 },
        { ...json(), parent: 7 },
        { ...json(), traceId: null },
        { ...json(), _tag: null },
        null,
        "a line",
        [json()],
      ];
      const { answers, entries } = yield* handIn(wrong);
      expect(answers).toEqual(wrong.map(() => refused("bad_line")));
      expect(entries).toEqual([]);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );

  it.effect("every entry read back has all its fields, and rev, pos and arrivedAt are the referee's", () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.append("notes:1", "w-1", full);
      yield* ledger.append("notes:2", "w-2", { ...full, parent: goodParent });
      yield* ledger.append("notes:1", "w-3", { ...full, seen: 2 });
      const entries = yield* Stream.runCollect(ledger.read("notes:1", 0));
      expect(entries.map((entry) => Object.keys(entry).sort())).toEqual([ENTRY_KEYS, ENTRY_KEYS]);
      expect(entries.map((entry) => [entry.id, entry.stream, entry.rev, entry.pos])).toEqual([
        ["w-1", "notes:1", 1, 1],
        ["w-3", "notes:1", 3, 2],
      ]);
      expect(entries.map((entry) => typeof entry.arrivedAt)).toEqual(["number", "number"]);
      expect(entries[1]).toMatchObject({ ...full, seen: 2 });
    }).pipe(Effect.provide(onLedger(fresh()))),
  );

  it.effect("a line whose row would pass 2,000,000 bytes is refused too_big, as workerd would", () =>
    Effect.gen(function* () {
      const big = "x".repeat(2_000_001);
      const near = "x".repeat(1_900_000);
      const { answers, entries } = yield* handIn([
        { ...json(), body: { note: big } },
        { ...json(), body: { note: near } },
      ]);
      expect(answers).toEqual([refused("too_big"), { _tag: "placed", rev: 1, pos: 1 }]);
      expect(entries.map((entry) => entry.id)).toEqual(["w-2"]);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );

  it.effect("a row of exactly 2,000,000 UTF-8 bytes is placed, and one byte more is refused too_big", () =>
    Effect.gen(function* () {
      // The row's bytes: its texts as UTF-8 (stream, id, by, for, sentAt, parent, traceId, build, _tag) and
      // the body as JSON; numbers are not counted. handIn's ids, w-1 and w-2, are the same length.
      const encoder = new TextEncoder();
      const rowBytes = (line: Line): number =>
        [
          "notes:1",
          "w-1",
          line.by,
          line.for,
          line.sentAt,
          line.parent ?? "",
          line.traceId,
          line.build,
          line._tag,
          JSON.stringify(line.body),
        ].reduce((n, text) => n + encoder.encode(text).length, 0);
      // A thousand two-byte letters, so a count of characters instead of bytes misses the limit.
      const WIDE = "ü".repeat(1_000);
      const sized = (total: number): Line => {
        const rest = total - rowBytes({ ...full, body: { note: WIDE } });
        return { ...full, body: { note: WIDE + "x".repeat(rest) } };
      };
      const atLimit = sized(2_000_000);
      const overLimit = sized(2_000_001);
      expect([rowBytes(atLimit), rowBytes(overLimit)]).toEqual([2_000_000, 2_000_001]);
      const { answers, entries } = yield* handIn([overLimit, atLimit]);
      expect(answers).toEqual([refused("too_big"), { _tag: "placed", rev: 1, pos: 1 }]);
      expect(entries.map((entry) => entry.id)).toEqual(["w-2"]);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );

  it.effect("sentAt never decides: any text the writer sent is placed and read back as sent", () =>
    Effect.gen(function* () {
      const sent = ["", "yesterday, around nine", "2099-01-01T00:00:00Z", "1970-01-01T00:00:00Z"];
      const { answers, entries } = yield* handIn(sent.map((sentAt) => ({ ...json(), sentAt })));
      expect(answers.map((answer) => answer._tag)).toEqual(sent.map(() => "placed"));
      expect(entries.map((entry) => entry.sentAt)).toEqual(sent);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );
});

describe("p68, an entry keeps its parent", () => {
  // Plants: keep the old eight-hex pattern, loosen it to in-.*, or answer bad_line.
  it("p68b, ParentText takes a TypeID process and a positive counter, and nothing one slip away", () => {
    expect(data.ParentText, "the parent text schema is public").toBeDefined();
    const is = Schema.is(data.ParentText);
    expect(parents(50).every(is)).toBe(true);
    expect(badParents(goodParent).filter(is)).toEqual([]);
  });

  it.effect.prop(
    "p68b, a generated process parent and positive counter are placed and kept as sent",
    { parent: inputParents },
    ({ parent }) =>
      Effect.gen(function* () {
        const { answers, entries } = yield* handIn([{ ...json(), parent }]);
        expect(answers).toEqual([{ _tag: "placed", rev: 1, pos: 1 }]);
        expect(entries.map((entry) => entry.parent)).toEqual([parent]);
      }).pipe(Effect.provide(onReferee(fresh()))),
    { arbitrary: { seed: SEED, runs: 40 } },
  );

  it.effect("a parent, or null for an own write, is read back the same", () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.append("notes:1", "w-1", { ...full, parent: goodParent });
      yield* ledger.append("notes:1", "w-2", { ...full, parent: null });
      yield* ledger.append("notes:1", "w-3", { ...full, parent: otherParent });
      const entries = yield* Stream.runCollect(ledger.read("notes:1", 0));
      expect(entries.map((entry) => entry.parent)).toEqual([goodParent, null, otherParent]);
    }).pipe(Effect.provide(onLedger(fresh()))),
  );

  it.effect("p68b, old eight-hex parents and malformed TypeID parents are refused bad_parent and write nothing", () =>
    Effect.gen(function* () {
      const bad = badParents(goodParent);
      const { answers, entries } = yield* handIn([
        ...bad.map((parent) => ({ ...json(), parent })),
        { ...json(), parent: goodParent },
      ]);
      expect(answers).toEqual([...bad.map(() => refused("bad_parent")), { _tag: "placed", rev: 1, pos: 1 }]);
      expect(entries.map((entry) => entry.parent)).toEqual([goodParent]);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );

  it("for any text, the referee places it as a parent exactly when it has the form (fast-check)", async () => {
    const text = fc.oneof(fc.stringMatching(PARENT), fc.string(), fc.string({ unit: "binary" }));
    await fc.assert(
      fc.asyncProperty(fc.array(text, { minLength: 1, maxLength: 8 }), (texts) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const { answers, entries } = yield* handIn(texts.map((parent) => ({ ...json(), parent })));
            expect(answers.map((answer) => answer._tag === "placed")).toEqual(
              texts.map((parent) => PARENT.test(parent)),
            );
            expect(answers.filter((answer) => answer._tag === "refused")).toEqual(
              texts.filter((parent) => !PARENT.test(parent)).map(() => refused("bad_parent")),
            );
            expect(entries.map((entry) => entry.parent)).toEqual(texts.filter((parent) => PARENT.test(parent)));
          }).pipe(Effect.provide(onReferee(fresh()))),
        ),
      ),
      { seed: SEED, numRuns: 40 },
    );
  });
});

describe("p68b, an entry keeps a W3C trace id", () => {
  // Plants: drop the all-zeros guard, or allow uppercase hex.
  it.effect.each([
    ["all zeros", "0".repeat(32)],
    ["uppercase", TRACE.toUpperCase()],
    ["31 characters", TRACE.slice(1)],
    ["33 characters", `a${TRACE}`],
    ["not hex", `g${TRACE.slice(1)}`],
    ["empty", ""],
    ["leading space", ` ${TRACE}`],
    ["trailing space", `${TRACE} `],
    ["trailing newline", `${TRACE}\n`],
  ] as const)("%s is refused bad_trace and writes nothing", ([, traceId]) =>
    Effect.gen(function* () {
      const { answers, entries } = yield* handIn([{ ...json(), traceId }, json()]);
      expect(answers).toEqual([refused("bad_trace"), { _tag: "placed", rev: 1, pos: 1 }]);
      expect(entries.map((entry) => [entry.id, entry.traceId])).toEqual([["w-2", TRACE]]);
    }).pipe(Effect.provide(onReferee(fresh()))),
  );
});
