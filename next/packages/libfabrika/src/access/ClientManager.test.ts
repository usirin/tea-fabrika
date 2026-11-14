// p96, `write` tells the truth (P9's plan writes it out; the lead commit adds it to
// docs/plan/tier-1-detail.md, "Properties"), for `coordination/client-manager.ts`: its answer is what
// the fold does with the event, `founded` is written once by the first call, and two Macs typing one
// sheet at once never both hear "you are in". Written before the module (Tier 1, P9, ticket 236).
//
// The shape these tests hold the module to, from the plan's "The shape" and flag 6:
// - `ClientManagerLedger.layer(founder & {person})` over a `Ledger`. Building it writes nothing. The first
//   call on an empty `gateway/access` writes `founded` under the fixed id `founded`, once, by the
//   key and build the layer was handed. A ledger refusal of it, except `id_reused`, is a
//   `LedgerError` with its own `reason: "refused"` (not `bad_row`, which means a row that does not
//   decode), never an empty member list.
// - `members` folds `gateway/access` with `foldAccess`.
// - `write(event, from)` folds, refuses what the fold's rule refuses (`{_tag: "refused", reason}`,
//   nothing written), else appends under the event's own id with `seen` the folded head, folds on to
//   the new rev, and answers `{_tag: "applied", rev}` or `{_tag: "ignored", rev, reason}`. A refusal by
//   the ledger itself (`id_reused`) is `refused` with the ledger's reason.
// - Reasons: `not_member` (a key nobody let in), `not_allowed` (a window or agent key signing),
//   `used` (a spent sheet), `replaced` (a sheet a newer one ended), `revoked` (a key that was let in
//   and then removed). The last two are this test's reading of flag 6's list.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, References, Schema, type Scope, Stream, Tracer } from "effect";
import * as fc from "fast-check";
import { processId } from "../Id.test-support.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type { From } from "../processes/Mailbox.ts";
import type { Sql } from "../Sql.ts";
import type { MemberEvent, Access } from "./Access.ts";
import { foldAccess } from "./AccessFold.ts";
import { ClientManager } from "./ClientManager.ts";
import * as ClientManagerLedger from "./ClientManagerLedger.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const READER = "connection:t1";
const MEMBERS = "gateway/access";
const PARENT = `in-${Effect.runSync(processId)}-41`;
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const P = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const NAME = "home";
const TO = "ledger:home";
const SENT = "2026-11-07T21:10:01.204Z";
// The founder's Mac signs `founded`: `by` is its checked key, never the person, and `build` is the
// hash of the code that wrote the line, both handed in by the wiring (log.ts, `Line`).
const FOUNDER_BY = "SHA256:founder-mac";
const FOUNDER_BUILD = "b-5e9c2a0";

const FOUNDER = {
  name: NAME,
  keys: ["pA"],
  window: "wA",
  person: P,
  by: FOUNDER_BY,
  build: FOUNDER_BUILD,
} as const;

const FOUNDED: MemberEvent = { _tag: "founded", id: P, name: NAME, keys: ["pA"], window: "wA" };

// Every ledger is a fresh node:sqlite file in its own temp folder. The scope that opens it closes
// the connection, then removes the folder (0061).
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p9-clients-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

// A store is a scoped Effect, so the layer built on it holds the open file in its own scope.
type Store = Effect.Effect<Sql, never, Scope.Scope>;

const fresh = (): Store =>
  folder.pipe(
    Effect.flatMap((path) =>
      Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(join(path, "ledger.db"))),
        (db) =>
          Effect.sync(() => {
            if (db.isOpen) {
              db.close();
            }
          }),
      ),
    ),
    Effect.map(nodeSql),
  );

/** One fresh store, opened in the test's scope, for the layers of a test that share one ledger. */
const shared = (): Effect.Effect<Store, never, Scope.Scope> => fresh().pipe(Effect.map((sql) => Effect.succeed(sql)));

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const onSql = (sql: Store) =>
  Layer.unwrap(sql.pipe(Effect.map((sql) => LedgerSql.layer(sql, { reader: READER }).pipe(Layer.provide(quiet)))));

/** A ClientManager and the Ledger beneath it, so a test can read what was written. */
const clientsOn = (ledger: Layer.Layer<Ledger>, founder: Parameters<typeof ClientManagerLedger.layer>[0] = FOUNDER) =>
  ClientManagerLedger.layer(founder).pipe(Layer.provideMerge(ledger));

const founderArb: fc.Arbitrary<Parameters<typeof ClientManagerLedger.layer>[0]> = fc.record({
  name: fc.string(),
  keys: fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 5 }),
  window: fc.option(fc.string(), { nil: null }),
  person: fc.string({ minLength: 1 }),
  by: fc.string({ minLength: 1 }),
  build: fc.string({ minLength: 1 }),
});

const leaf = fc.string().map((s) => `tab:${s}`);

const check = <A, E, R>(arb: fc.Arbitrary<A>, examples: NoInfer<A>[], law: (a: A) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arb, (a) => Effect.runPromise(law(a).pipe(Effect.provideContext(context)))),
        {
          seed: SEED,
          numRuns: 40,
          includeErrorInReport: true,
          examples: examples.map((a): [A] => [a]),
        },
      ),
    );
  });

const from = (over: Partial<From> = {}): From => ({
  by: "SHA256:door",
  for: P,
  sentAt: SENT,
  seen: 0,
  parent: PARENT,
  traceId: TRACE,
  build: "b-7c1d073",
  ...over,
});

const entries = Ledger.use((ledger) => Stream.runCollect(ledger.read(MEMBERS, 0)));

const write = (event: MemberEvent, over: Partial<From> = {}) =>
  ClientManager.use((clients) => clients.write(event, from(over)));

const members = ClientManager.use((clients) => clients.members);

// ---- Events. Signatures are not checked here, so `signed` is opaque text naming its signer ----

const SAW = {
  code: "4417",
  label: "Firefox",
  location: "Istanbul",
  method: "compare",
  check: "touch",
  has: [],
} as const;

const TOOK = { label: "Mac A", location: "Istanbul", method: "panel", check: "touch" } as const;

const addSaw = (method: "sheet" | "recovery" | "device", old: "lost" | "kept" | null = null) => ({
  method,
  check: "touch" as const,
  location: "Istanbul",
  has: [],
  typed: method === "sheet",
  kept: method === "sheet" ? ("print" as const) : null,
  old,
});

const signed = (signer: string) => ({
  text: `signed by ${signer}`,
  armored: "-----SSHSIG-----",
  signer,
});

let made = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++made).padStart(26, "0")}`;

const granted = (
  signer: string,
  key: string,
  over: { readonly as?: "window" | "agent"; readonly id?: string } = {},
): MemberEvent => ({
  _tag: "granted",
  grant: {
    id: over.id ?? nextId("grant"),
    key,
    for: P,
    to: TO,
    as: over.as ?? "window",
    saw: SAW,
    sentAt: SENT,
  },
  signed: signed(signer),
});

const revoked = (signer: string, key: string): MemberEvent => ({
  _tag: "revoked",
  revoke: { id: nextId("revoke"), key, for: P, to: TO, saw: TOOK, sentAt: SENT },
  signed: signed(signer),
});

const addedDevice = (
  signer: string,
  key: string,
  window: string,
  over: { readonly drops?: ReadonlyArray<string>; readonly old?: "lost" | "kept" } = {},
): MemberEvent => ({
  _tag: "added",
  add: {
    id: nextId("add"),
    for: P,
    to: TO,
    adds: { _tag: "person", key, window },
    drops: [...(over.drops ?? [])],
    saw: addSaw(over.old === undefined ? "device" : "recovery", over.old ?? null),
    sentAt: SENT,
  },
  signed: signed(signer),
});

const addedSheet = (signer: string, key: string): MemberEvent => ({
  _tag: "added",
  add: {
    id: nextId("add"),
    for: P,
    to: TO,
    adds: { _tag: "recovery", key, v: 1 },
    drops: [],
    saw: addSaw("sheet"),
    sentAt: SENT,
  },
  signed: signed(signer),
});

const denied = (key: string, by: string): MemberEvent => ({
  _tag: "denied",
  id: nextId("deny"),
  key,
  saw: SAW,
  by,
});

/** The id an event is appended under: its own, and `founded` for the founding. */
const eventId = (event: MemberEvent): string => {
  switch (event._tag) {
    case "founded":
      return "founded";
    case "granted":
      return event.grant.id;
    case "revoked":
      return event.revoke.id;
    case "added":
      return event.add.id;
    case "denied":
      return event.id;
  }
};

const view = (m: Access) => ({
  person: m.person,
  name: m.name,
  keys: [...m.keys.entries()]
    .map(([key, k]) => ({ key, rank: k.rank, live: k.live, under: k.under }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  spent: [...m.spent].sort(),
});

describe("p96 and p97, replay and write answers", () => {
  it.effect("unknown member events preserve the view and still advance the write head", () =>
    check(fc.tuple(leaf, fc.jsonValue()), [], ([key, body]) =>
      Effect.gen(function* () {
        const before = yield* members;
        const ledger = yield* Ledger;
        yield* ledger.append(MEMBERS, "future", {
          ...from(),
          _tag: "future_member_fact",
          body: Schema.decodeUnknownSync(Schema.Json)({ value: body }),
        });
        const loaded = yield* Effect.exit(members);
        expect(loaded._tag, "unknown member events are skipped").toBe("Success");

        if (loaded._tag === "Success") {
          expect(view(loaded.value)).toEqual(view(before));
        }

        expect(yield* write(granted("pA", key))).toMatchObject({ _tag: "applied" });
        expect((yield* entries).at(-1)?.seen).toBe(2);
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );
  it.effect("each write span keeps its answer and a refusal's reason", () =>
    check(leaf, [], (key) => {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      return Effect.gen(function* () {
        for (const signer of ["pA", "wA", "unknown-signer"]) {
          const answer = yield* write(granted(signer, key));
          const span = spans.filter((s) => s.name === "access.write").at(-1)!;
          expect(span.attributes.get("fab.access.answer")).toBe(answer._tag);

          if (answer._tag === "refused") {
            expect(span.attributes.get("fab.access.reason")).toBe(answer.reason);
          }
        }
      }).pipe(Effect.provide(clientsOn(onSql(fresh()))), Effect.withTracer(tracer));
    }),
  );
});

/**
 * A Ledger that, on the append of `id`, first runs `before`: another Mac's whole write, landing
 * between this write's first check and its append. The race, made certain.
 */
const racing = (sql: Store, hook: { readonly id: string; before: Effect.Effect<void, LedgerError> | null }) =>
  Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const real = yield* Ledger;
      return {
        read: real.read,
        wait: real.wait,
        append: (stream: string, id: string, line: Parameters<typeof real.append>[2]) =>
          Effect.suspend(() => {
            const before = id === hook.id ? hook.before : null;

            if (before === null) {
              return real.append(stream, id, line);
            }

            hook.before = null;
            return Effect.andThen(before, real.append(stream, id, line));
          }),
      };
    }),
  ).pipe(Layer.provide(onSql(sql)));

describe("p96, founded is written once, by the first call", () => {
  it.effect("building the Layer writes nothing; the first call writes founded under its fixed id", () =>
    check(founderArb, [FOUNDER], (founder) =>
      Effect.gen(function* () {
        expect(yield* entries).toEqual([]);
        const m = yield* members;
        expect(view(m)).toEqual(
          view(
            foldAccess([
              {
                _tag: "founded",
                id: founder.person,
                name: founder.name,
                keys: founder.keys,
                window: founder.window,
              },
            ]),
          ),
        );
        const written = yield* entries;
        expect(written.map((e) => [e.id, e._tag, e.rev])).toEqual([["founded", "founded", 1]]);
        yield* members;
        expect((yield* entries).length).toBe(1);
      }).pipe(Effect.provide(clientsOn(onSql(fresh()), founder))),
    ),
  );

  it.effect("plant, founded written at Layer build: a Ledger that always fails still builds", () =>
    check(leaf, ["t1"], (key) => {
      const broken = Layer.succeed(Ledger, {
        append: () => Effect.fail(new LedgerError({ reason: "storage" })),
        read: () => Stream.fail(new LedgerError({ reason: "storage" })),
        wait: () => Effect.fail(new LedgerError({ reason: "storage" })),
      });
      return Effect.gen(function* () {
        const failed = yield* Effect.flip(members);
        expect(failed).toBeInstanceOf(LedgerError);
        expect(failed.reason).toBe("storage");
        const refused = yield* Effect.flip(write(granted("pA", key)));
        expect(refused.reason).toBe("storage");
      }).pipe(Effect.provide(ClientManagerLedger.layer(FOUNDER).pipe(Layer.provide(broken))));
    }),
  );

  it.live("two first calls at once, and two ClientManagers on one ledger, leave one founded", () =>
    check(leaf, ["t1"], (key) =>
      Effect.gen(function* () {
        const sql = yield* shared();
        const one = clientsOn(onSql(sql));
        const two = ClientManagerLedger.layer(FOUNDER).pipe(Layer.provide(onSql(sql)));
        yield* Effect.all(
          [
            members.pipe(Effect.provide(one)),
            members.pipe(Effect.provide(two)),
            write(granted("pA", key)).pipe(Effect.provide(two)),
            members.pipe(Effect.provide(one)),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.provideService(References.MaxOpsBeforeYield, 3));
        const written = yield* entries.pipe(Effect.provide(onSql(sql)));
        expect(written.filter((e) => e._tag === "founded").map((e) => e.id)).toEqual(["founded"]);
      }),
    ),
  );
});

describe("p96, founded carries true facts and is never refused quietly", () => {
  it.effect("the founded line carries the writer's key and build the layer was handed", () =>
    check(founderArb, [FOUNDER], (founder) =>
      Effect.gen(function* () {
        yield* members;
        const [founding, ...more] = yield* entries;
        expect(more).toEqual([]);
        expect(founding).toMatchObject({
          id: "founded",
          _tag: "founded",
          by: founder.by,
          build: founder.build,
          for: founder.person,
          seen: 0,
          parent: null,
        });
      }).pipe(Effect.provide(clientsOn(onSql(fresh()), founder))),
    ),
  );

  // oxlint-disable-next-line fabrika/law-shape -- a type law: its @ts-expect-error lines are the check, so it is neither a property nor an example
  it("the layer's type requires the writer's key and build", () => {
    // Compile-time type law; the owner rule keeps the required-field checks as type checks.
    const base = { name: NAME, keys: ["pA"], window: "wA", person: P };
    const noBy = { ...base, build: FOUNDER_BUILD };
    const noBuild = { ...base, by: FOUNDER_BY };
    // @ts-expect-error `by` is required: the founding line is signed by a checked key
    const one = ClientManagerLedger.layer(noBy);
    // @ts-expect-error `build` is required: the founding line names the code that wrote it
    const two = ClientManagerLedger.layer(noBuild);
    // @ts-expect-error neither can be left out
    const three = ClientManagerLedger.layer(base);
    expect([one, two, three].every(Layer.isLayer)).toBe(true);
  });

  /** A Ledger whose append of `founded` is refused with `reason`, after `before` runs. */
  const refusing = (
    sql: Store,
    reason: "bad_line" | "bad_parent" | "bad_trace" | "seen_ahead" | "id_reused" | "too_big",
    before: Effect.Effect<void, LedgerError> = Effect.void,
  ) =>
    Layer.effect(
      Ledger,
      Effect.map(Ledger, (real) => ({
        read: real.read,
        wait: real.wait,
        append: (stream: string, id: string, line: Parameters<typeof real.append>[2]) =>
          id === "founded" ? Effect.as(before, { _tag: "refused" as const, reason }) : real.append(stream, id, line),
      })),
    ).pipe(Layer.provide(onSql(sql)));

  it.effect("a founding the ledger refuses fails loud, and never starts with no members", () =>
    check(
      fc.constantFrom("bad_line", "bad_parent", "bad_trace", "seen_ahead", "too_big"),
      ["bad_line", "bad_parent", "bad_trace", "seen_ahead", "too_big"],
      (reason) =>
        Effect.gen(function* () {
          const sql = yield* shared();
          const layer = ClientManagerLedger.layer(FOUNDER).pipe(Layer.provide(refusing(sql, reason)));
          const failed = yield* Effect.flip(members.pipe(Effect.provide(layer)));
          expect(failed, reason).toBeInstanceOf(LedgerError);
          expect(failed.reason, reason).toBe("refused");
          const got = yield* Effect.flip(write(granted("pA", "t1")).pipe(Effect.provide(layer)));
          expect(got, reason).toBeInstanceOf(LedgerError);
          expect(got.reason, reason).toBe("refused");
          expect((yield* entries.pipe(Effect.provide(onSql(sql)))).length, reason).toBe(0);
        }),
    ),
  );

  it.effect("a founding refused id_reused, a second load that lost the race, goes on", () =>
    check(leaf, ["t1"], (key) =>
      Effect.flatMap(shared(), (sql) => {
        // Another load's whole first call lands first, so this one's append hears id_reused.
        const other = members.pipe(
          Effect.asVoid,
          Effect.provide(ClientManagerLedger.layer(FOUNDER).pipe(Layer.provide(onSql(sql)))),
        );
        const raced = refusing(sql, "id_reused", other);
        return Effect.gen(function* () {
          expect(view(yield* members)).toEqual(view(foldAccess([FOUNDED])));
          expect(yield* write(granted("pA", key))).toEqual({ _tag: "applied", rev: 2 });
          expect((yield* entries).map((e) => e.id)[0]).toBe("founded");
        }).pipe(Effect.provide(ClientManagerLedger.layer(FOUNDER).pipe(Layer.provideMerge(raced))));
      }),
    ),
  );
});

describe("p96, the traced history from the plan", () => {
  it.effect("each write answers what the fold does with it, and a refusal writes nothing", () =>
    check(leaf, ["t2"], (key) =>
      Effect.gen(function* () {
        const t2 = granted("pB", key);
        const sheet = addedSheet("pB", "r1");
        const steps: ReadonlyArray<readonly [MemberEvent, unknown]> = [
          [granted("pA", "t1"), { _tag: "applied", rev: 2 }],
          [addedDevice("pA", "pB", "wB"), { _tag: "applied", rev: 3 }],
          [t2, { _tag: "applied", rev: 4 }],
          [sheet, { _tag: "applied", rev: 5 }],
          [granted("pA", "g1", { as: "agent" }), { _tag: "applied", rev: 6 }],
          [granted("wB", "t3"), { _tag: "refused", reason: "not_allowed" }],
          [revoked("g1", "pB"), { _tag: "refused", reason: "not_allowed" }],
          [addedDevice("r1", "pC", "wC", { drops: ["pA", "wA"], old: "lost" }), { _tag: "applied", rev: 7 }],
          [addedDevice("r1", "pX", "wX", { old: "lost" }), { _tag: "refused", reason: "used" }],
          [t2, { _tag: "applied", rev: 4 }], // the rev-4 grant resent after the drop: nothing new
        ];
        const kept: Array<MemberEvent> = [FOUNDED];
        yield* members; // founded first, so each step below counts only its own entry

        for (const [event, answer] of steps) {
          const before = (yield* entries).length;
          const got = yield* write(event);
          expect(got, event._tag).toEqual(answer);
          const after = yield* entries;
          const wrote = got._tag === "applied" && got.rev > before;
          expect(after.length, event._tag).toBe(before + (wrote ? 1 : 0));

          if (wrote) {
            kept.push(event);
          }
        }

        const m = yield* members;
        expect(view(m)).toEqual(view(foldAccess(kept)));
        expect([...m.spent]).toEqual(["r1"]);
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );

  it.effect("an applied event sits under its own id, with its tag, the writer's fields and seen = the head", () =>
    check(
      fc.record({
        by: fc.string({ minLength: 1 }),
        build: fc.string({ minLength: 1 }),
        sentAt: fc.string(),
      }),
      [{ by: "SHA256:door", build: "b-7c1d073", sentAt: SENT }],
      (over) =>
        Effect.gen(function* () {
          const grant = granted("pA", "t1");
          yield* write(grant, { ...over, seen: 0 });
          const sheet = addedSheet("pA", "r1");
          yield* write(sheet, { seen: 0, parent: null, by: "SHA256:door-2" });
          const [founding, first, second] = yield* entries;
          expect(founding?.id).toBe("founded");
          expect(first).toMatchObject({
            id: eventId(grant),
            _tag: "granted",
            rev: 2,
            seen: 1,
            by: over.by,
            for: P,
            sentAt: over.sentAt,
            parent: PARENT,
            traceId: TRACE,
            build: over.build,
          });
          expect(second).toMatchObject({
            id: eventId(sheet),
            _tag: "added",
            rev: 3,
            seen: 2,
            parent: null,
            traceId: TRACE,
          });
          expect(second?.by).toBe("SHA256:door-2");
        }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );
});

describe("p96, why a write is refused", () => {
  it.effect("not_member, revoked, replaced and used, each writing nothing", () =>
    check(leaf, ["t1"], (key) =>
      Effect.gen(function* () {
        yield* write(addedDevice("pA", "pB", "wB"));
        yield* write(addedSheet("pA", "r1"));
        yield* write(addedSheet("pB", "r2"));
        yield* write(revoked("pB", "pA"));
        yield* write(addedDevice("r2", "pC", "wC", { old: "kept" }));
        const before = (yield* entries).length;
        expect(yield* write(granted("x1", key))).toEqual({ _tag: "refused", reason: "not_member" });
        expect(yield* write(granted("pA", key))).toEqual({ _tag: "refused", reason: "revoked" });
        expect(yield* write(addedDevice("r1", "pD", "wD", { old: "lost" }))).toEqual({
          _tag: "refused",
          reason: "replaced",
        });
        expect(yield* write(addedDevice("r2", "pD", "wD", { old: "lost" }))).toEqual({
          _tag: "refused",
          reason: "used",
        });
        expect((yield* entries).length).toBe(before);
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );

  it.effect("the ledger's own refusal passes through: another event under a used id is id_reused", () =>
    check(fc.string({ minLength: 1 }), ["grant_01m6v5270hf3c8x2q7w9z4k5aa"], (id) =>
      Effect.gen(function* () {
        const first = granted("pA", "t1", { id });
        expect(yield* write(first)).toEqual({ _tag: "applied", rev: 2 });
        const other = granted("pA", "t2", { id });
        expect(yield* write(other)).toEqual({ _tag: "refused", reason: "id_reused" });
        expect((yield* entries).length).toBe(2);
        expect((yield* members).keys.has("t2")).toBe(false);
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );

  it.effect("plant, the check after the append only: a refused event never reaches the log", () =>
    check(leaf, ["t1"], (key) =>
      Effect.gen(function* () {
        yield* members; // founded first, so the count below is only the refused events
        const before = (yield* entries).length;

        for (const event of [granted("wA", key), revoked("pA", "pA"), granted("x1", key)]) {
          const answer = yield* write(event);
          expect(answer._tag, event._tag).toBe("refused");
        }

        expect((yield* entries).length).toBe(before);
        expect(view(yield* members)).toEqual(view(foldAccess([FOUNDED])));
        expect((yield* write(denied(key, "SHA256:menu")))._tag).not.toBe("ignored");
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );
});

describe("p96, the stolen sheet race", () => {
  it.effect("plant, write that skips the second fold: the Mac that lost the race hears ignored used", () =>
    check(fc.constantFrom("lost", "kept"), ["lost"], (old) =>
      Effect.flatMap(shared(), (sql) => {
        const sheet = addedSheet("pA", "r1");
        const macC = addedDevice("r1", "pC", "wC", { drops: ["pA"], old });
        const macX = addedDevice("r1", "pX", "wX", { old });
        let xAnswer: unknown = null;
        const hook: { readonly id: string; before: Effect.Effect<void, LedgerError> | null } = {
          id: eventId(macC),
          before: write(macX).pipe(
            Effect.tap((answer) =>
              Effect.sync(() => {
                xAnswer = answer;
              }),
            ),
            Effect.asVoid,
            Effect.provide(ClientManagerLedger.layer(FOUNDER).pipe(Layer.provide(onSql(sql)))),
          ),
        };
        return Effect.gen(function* () {
          expect(yield* write(sheet)).toEqual({ _tag: "applied", rev: 2 });
          const answer = yield* write(macC);
          expect(hook.before).toBeNull(); // the other Mac did run in between
          expect(xAnswer).toEqual({ _tag: "applied", rev: 3 });
          expect(answer).toEqual({ _tag: "ignored", rev: 4, reason: "used" });
          expect(yield* write(macC)).toEqual({ _tag: "ignored", rev: 4, reason: "used" });
          const m = yield* members;
          expect(m.keys.get("pX")?.live).toBe(true);
          expect(m.keys.get("pC")?.live ?? false).toBe(false);
          expect(m.keys.get("pA")?.live).toBe(true);
          // Both events are in the log; the fold took only the first.
          expect((yield* entries).map((e) => e.id)).toEqual(["founded", eventId(sheet), eventId(macX), eventId(macC)]);
        }).pipe(Effect.provide(ClientManagerLedger.layer(FOUNDER).pipe(Layer.provideMerge(racing(sql, hook)))));
      }),
    ),
  );

  it.live("two writes of one sheet at once, as fibers: one applied, never two", () =>
    check(
      fc.string().map((suffix) => `pC${suffix}`),
      ["pC"],
      (device) =>
        Effect.gen(function* () {
          for (let round = 0; round < 12; round++) {
            const sql = yield* shared();
            const one = clientsOn(onSql(sql));
            const two = ClientManagerLedger.layer(FOUNDER).pipe(Layer.provide(onSql(sql)));
            yield* write(addedSheet("pA", "r1")).pipe(Effect.provide(one));
            const answers = yield* Effect.all(
              [
                write(addedDevice("r1", device, "wC", { old: "lost" })).pipe(Effect.provide(one)),
                write(addedDevice("r1", "pX", "wX", { old: "lost" })).pipe(Effect.provide(two)),
              ],
              { concurrency: "unbounded" },
            ).pipe(Effect.provideService(References.MaxOpsBeforeYield, 3));
            expect(answers.filter((a) => a._tag === "applied").length, `round ${round}`).toBe(1);
            const lost = answers.find((a) => a._tag !== "applied");
            expect(lost?._tag === "ignored" || lost?._tag === "refused", `round ${round}`).toBe(true);
            expect(lost !== undefined && "reason" in lost ? lost.reason : null).toBe("used");
            const m = yield* members.pipe(Effect.provide(one));
            expect([m.keys.get(device)?.live, m.keys.get("pX")?.live].filter((l) => l === true)).toEqual([true]);
          }
        }),
    ),
  );
});

// ---- p96 over any history: the answer is what the fold does, with no race ----

const PERSONS = ["pA", "pB", "pC"] as const;
const WINDOWS = ["wA", "wB", "wC"] as const;
const LEAVES = ["t1", "t2", "g1"] as const;
const SHEETS = ["r1", "r2"] as const;
const ALL: ReadonlyArray<string> = [...PERSONS, ...WINDOWS, ...LEAVES, ...SHEETS, "x1"];

const signer = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...PERSONS) },
  { weight: 2, arbitrary: fc.constantFrom(...SHEETS) },
  { weight: 2, arbitrary: fc.constantFrom(...WINDOWS, ...LEAVES, "x1") },
);

const anyKey = fc.constantFrom(...ALL);

const event: fc.Arbitrary<() => MemberEvent> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .record({ by: signer, key: fc.constantFrom(...LEAVES), as: fc.constantFrom("window", "agent") })
      .map((g) => () => granted(g.by, g.key, { as: g.as })),
  },
  {
    weight: 2,
    arbitrary: fc.record({ by: signer, key: anyKey }).map((r) => () => revoked(r.by, r.key)),
  },
  {
    weight: 3,
    arbitrary: fc
      .record({
        by: signer,
        pair: fc.integer({ min: 0, max: 2 }),
        drops: fc.uniqueArray(anyKey, { maxLength: 2 }),
        lost: fc.boolean(),
      })
      .map(
        (a) => () =>
          addedDevice(a.by, PERSONS[a.pair] ?? "pA", WINDOWS[a.pair] ?? "wA", {
            drops: a.drops,
            ...(a.lost ? { old: "lost" as const } : {}),
          }),
      ),
  },
  {
    weight: 2,
    arbitrary: fc.record({ by: signer, key: fc.constantFrom(...SHEETS) }).map((s) => () => addedSheet(s.by, s.key)),
  },
  {
    weight: 1,
    arbitrary: fc.record({ key: anyKey, by: signer }).map((d) => () => denied(d.key, d.by)),
  },
  { weight: 1, arbitrary: fc.constant(() => FOUNDED) },
);

describe("p96, write tells the truth over any history", () => {
  it("refused writes nothing and the fold skips it; an event that changes who belongs is applied", async () => {
    let applied = 0;
    let refused = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(event, { minLength: 1, maxLength: 20 }), (makes) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const kept: Array<MemberEvent> = [FOUNDED];
            yield* members;

            for (const make of makes) {
              const next = make();
              const before = yield* entries;
              const head = before.at(-1)?.rev ?? 0;
              const answer = yield* write(next);
              const after = yield* entries;
              const changes =
                JSON.stringify(view(foldAccess([...kept, next]))) !== JSON.stringify(view(foldAccess(kept)));
              expect(answer._tag, "no race, so nothing is ignored").not.toBe("ignored");

              if (changes) {
                expect(answer, next._tag).toEqual({ _tag: "applied", rev: expect.any(Number) });
              }

              if (answer._tag === "refused") {
                refused++;
                expect(after.length, next._tag).toBe(before.length);
                expect(changes, next._tag).toBe(false);
              }

              if (answer._tag === "applied") {
                applied++;
                const placed = after.find((e) => e.rev === answer.rev);
                expect(placed?.id, next._tag).toBe(eventId(next));

                if (answer.rev > head) {
                  kept.push(next);
                }
              }
            }

            expect(view(yield* members)).toEqual(view(foldAccess(kept)));
          }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
        ),
      ),
      { seed: SEED, numRuns: 60 },
    );
    expect(applied).toBeGreaterThan(60);
    expect(refused).toBeGreaterThan(60);
  });
});

// Gaps the mutation step found on the build (ticket 236): answers the tests above held loose.
describe("p96, a write tells the truth about a key that is out", () => {
  it.effect("a revoked tab granted again is refused revoked, and nothing is written", () =>
    check(leaf, ["t1"], (key) =>
      Effect.gen(function* () {
        yield* write(addedDevice("pA", "pB", "wB"));
        yield* write(granted("pA", key));
        expect((yield* write(revoked("pB", key)))._tag).toBe("applied");
        const before = (yield* entries).length;
        expect(yield* write(granted("pA", key))).toEqual({ _tag: "refused", reason: "revoked" });
        expect((yield* entries).length).toBe(before);
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );

  it.effect("revoking a key already revoked is refused revoked, and nothing is written", () =>
    check(leaf, ["t1"], (key) =>
      Effect.gen(function* () {
        yield* write(addedDevice("pA", "pB", "wB"));
        yield* write(granted("pA", key));
        expect((yield* write(revoked("pA", key)))._tag).toBe("applied");
        const before = (yield* entries).length;
        expect(yield* write(revoked("pB", key))).toEqual({ _tag: "refused", reason: "revoked" });
        expect((yield* entries).length).toBe(before);
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );

  it.effect("a sheet revoked before a new one is made answers revoked, never replaced", () =>
    check(fc.constantFrom("lost", "kept"), ["lost"], (old) =>
      Effect.gen(function* () {
        yield* write(addedSheet("pA", "r1"));
        expect((yield* write(revoked("pA", "r1")))._tag).toBe("applied");
        expect((yield* write(addedSheet("pA", "r2")))._tag).toBe("applied");
        expect(yield* write(addedDevice("r1", "pY", "wY", { old }))).toEqual({
          _tag: "refused",
          reason: "revoked",
        });
        // The new sheet still works: the one it ended was the live one, and there was none.
        expect((yield* write(addedDevice("r2", "pY", "wY", { old })))._tag).toBe("applied");
      }).pipe(Effect.provide(clientsOn(onSql(fresh())))),
    ),
  );
});
