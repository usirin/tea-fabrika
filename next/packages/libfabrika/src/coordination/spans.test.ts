// p97, every coordination call is one span, names and numbers only (P9's plan writes it out; the
// lead commit adds it to docs/plan/tier-1-detail.md, "Properties"), for `coordination/mailbox.ts`,
// `process-manager.ts` and `client-manager.ts`. Written before the modules (Tier 1, P9, ticket 236).
//
// The shape these tests hold the modules to, from the plan's "What this piece records" and flag 12:
// - Span names: `mailbox.send`, `mailbox.receive` (one per Stream run), `process.start`,
//   `members.read` (one per `members` call) and `members.write`. P6's `ledger.*` spans nest inside.
// - Tags: OpenTelemetry's messaging keys where they fit and `fab.<piece>.*` for the rest. The plan
//   does not fix each key, so these tests find a tag by its last word (`answer`, `reason`, `after`,
//   `letters`, `skipped`, `events`, `keys`, `live`, `ignored`, `rev`, `program`, `hash`, `tag`), and
//   find a name or an id by its value.
// - No tag holds `m`, a `saw` text, a signature or a string over 128 characters.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, Stream, Tracer } from "effect";
import { LedgerTransaction } from "../data/ledger-transaction.ts";
import { Doorbell, Ledger, LedgerError } from "../data/ledger.ts";
import { nodeSql } from "../data/sqlite.ts";
import type { Sql } from "../Sql.ts";
import { ClientManager } from "./client-manager.ts";
import { type From, Mailbox } from "./mailbox.ts";
import { foldMembers, MemberEvent } from "./members.ts";
import { ProcessManager } from "./process-manager.ts";
import { A, brain, first as firstStart, ids } from "./process.test-support.ts";
import { Start } from "./process.ts";

const READER = "gateway:t1";
const PARENT = `in-${A}-41`;
const P = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TO = "ledger:home";
const SENT = "2026-11-07T21:10:01.204Z";

const FOUNDER = {
  name: "home",
  keys: ["pA"],
  window: "wA",
  person: P,
  by: "SHA256:founder-mac",
  build: "b-5e9c2a0",
} as const;

const MOST = 128; // the longest text a span tag may hold (P37's law, as P6's p95)

const nameArb = Start.cases.first.fields.name.check(Schema.isPattern(/^notes:[a-z][a-z0-9._-]{0,30}$/));

const idArb = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,30}$/));

const keyArb = MemberEvent.cases.denied.fields.key.check(Schema.isPattern(/^key-[a-z][a-z0-9_-]{0,30}$/));

// Include complete prefixed patterns: notes: plus 1..31, key- plus 1..31.
// Bare ids, programs and hashes retain 1..31 characters too.
const options = { arbitrary: { seed: 119120, runs: 20, size: 40 } };

// The installed runner uses runs/seed; old examples stay in these callbacks.
const examples =
  <A extends ReadonlyArray<unknown>, E, R>(
    cases: ReadonlyArray<A>,
    law: (...args: A) => Effect.Effect<unknown, E, R>,
  ) =>
  (args: A) =>
    Effect.forEach([...cases, args], (input) => Effect.suspend(() => law(...input)), {
      discard: true,
      concurrency: 1,
    });

// Markers no tag may hold: the letter's m, every saw text, and the signature's two texts.
const M_MARK = "m-marker-51c0";
const SAW_MARK = "saw-marker-8a2e";
const SIG_MARK = "sig-marker-3f71";
const MARKS = [M_MARK, SAW_MARK, SIG_MARK];

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p9-spans-"));
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

const onSql = (sql: Sql) =>
  Layer.mergeAll(Ledger.sql(sql, { reader: READER }), LedgerTransaction.layer(sql)).pipe(Layer.provide(quiet));

const all = (sql: Sql = fresh()) =>
  Layer.mergeAll(Mailbox.layer, ProcessManager.layer(brain(), ids(A).next), ClientManager.layer(FOUNDER)).pipe(
    Layer.provideMerge(onSql(sql)),
  );

const from = (over: Partial<From> = {}): From => ({
  by: "SHA256:t2",
  for: P,
  sentAt: SENT,
  seen: 0,
  parent: PARENT,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "b-7c1d073",
  ...over,
});

/** A tracer that keeps every span it makes. */
const capture = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const ended = (name: string) => spans.filter((s) => s.name === name && s.status._tag === "Ended");
  return { tracer, spans, ended };
};

const tags = (span: Tracer.NativeSpan): Record<string, unknown> => Object.fromEntries(span.attributes);

/** The tag whose key is `word` or ends in `.word`. */
const tagged = (span: Tracer.NativeSpan, word: string): unknown =>
  Object.entries(tags(span)).find(([key]) => key === word || key.endsWith(`.${word}`))?.[1];

const holds = (span: Tracer.NativeSpan, value: unknown): boolean => Object.values(tags(span)).includes(value);

/** Whether `outer` is above `span`, walking its parents. */
const within = (span: Tracer.NativeSpan, outer: Tracer.NativeSpan): boolean => {
  let at: Option.Option<Tracer.AnySpan> = span.parent;

  while (Option.isSome(at)) {
    if (at.value.spanId === outer.spanId) {
      return true;
    }

    at = at.value._tag === "Span" ? at.value.parent : Option.none();
  }

  return false;
};

// ---- Events with markers in every saw text and signature ----
const SAW = {
  code: SAW_MARK,
  label: SAW_MARK,
  where: SAW_MARK,
  how: "compare",
  check: "touch",
  has: [SAW_MARK],
} as const;

const TOOK = { label: SAW_MARK, where: SAW_MARK, how: "panel", check: "touch" } as const;

const signed = (signer: string) => ({
  text: `${SIG_MARK} text`,
  armored: `${SIG_MARK} armored`,
  signer,
});

let made = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++made).padStart(26, "0")}`;

const granted = (signer: string, key: string): MemberEvent => ({
  _tag: "granted",
  grant: { id: nextId("grant"), key, for: P, to: TO, as: "window", saw: SAW, sentAt: SENT },
  signed: signed(signer),
});

const revoked = (signer: string, key: string): MemberEvent => ({
  _tag: "revoked",
  revoke: { id: nextId("revoke"), key, for: P, to: TO, saw: TOOK, sentAt: SENT },
  signed: signed(signer),
});

const addSaw = (how: "sheet" | "recovery") => ({
  how,
  check: "touch" as const,
  where: SAW_MARK,
  has: [SAW_MARK],
  typed: how === "sheet",
  kept: how === "sheet" ? ("print" as const) : null,
  old: how === "recovery" ? ("lost" as const) : null,
});

const addedDevice = (signer: string, key: string, window: string, drops: ReadonlyArray<string> = []): MemberEvent => ({
  _tag: "added",
  add: {
    id: nextId("add"),
    for: P,
    to: TO,
    adds: { _tag: "person", key, window },
    drops: [...drops],
    saw: addSaw("recovery"),
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

const denied = (key: string): MemberEvent => ({
  _tag: "denied",
  id: nextId("deny"),
  key,
  saw: SAW,
  by: "SHA256:menu",
});

const write = (event: MemberEvent) => ClientManager.use((clients) => clients.write(event, from()));

/** Every tag of every span: no marker, and no text over 128 characters. */
const clean = (spans: ReadonlyArray<Tracer.NativeSpan>) => {
  for (const span of spans) {
    for (const [key, value] of Object.entries(tags(span))) {
      const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");

      for (const mark of MARKS) {
        expect(text.includes(mark), `${span.name} ${key}`).toBe(false);
      }

      expect(typeof value === "string" ? value.length : 0, `${span.name} ${key}`).toBeLessThanOrEqual(MOST);
    }
  }
};

describe("p97, mailbox spans", () => {
  it.effect.prop(
    "plant, m in a tag: each send ends one mailbox.send span with to, id and answer, ledger inside",
    [nameArb, idArb],
    examples([["notes:1", "letter_a"]], (name: string, id: string) => {
      const { tracer, ended, spans } = capture();
      return Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        const m = { type: "save", value: M_MARK };
        yield* mailbox.send(name, id, m, from());
        yield* mailbox.send(name, id, { type: "delete", value: M_MARK }, from());
        const sends = ended("mailbox.send");
        expect(sends.length).toBe(2);
        const [placed, refused] = sends;

        if (placed === undefined || refused === undefined) {
          return expect.unreachable();
        }

        expect(tagged(placed, "to")).toBe(name);
        expect(tagged(refused, "to")).toBe(name);
        expect(holds(placed, name) || holds(placed, `${name}/inbox`)).toBe(true);
        expect(holds(placed, id)).toBe(true);
        expect(tagged(placed, "answer")).toBe("placed");
        expect(tagged(placed, "rev")).toBe(1);
        expect(tagged(placed, "pos")).toBe(1);
        expect(tags(placed)["messaging.operation.type"]).toBe("send");
        expect(tagged(refused, "answer")).toBe("refused");
        expect(tagged(refused, "reason")).toBe("id_reused");
        const appends = ended("ledger.append");
        expect(appends.length).toBe(2);
        expect(appends.every((append, i) => within(append, sends[i] ?? placed))).toBe(true);
        clean(spans);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );

  it.effect.prop(
    "each receive run ends one mailbox.receive span with name, after, letters and skipped",
    [nameArb],
    examples([["notes:1"]], (name: string) => {
      const { tracer, ended, spans } = capture();
      return Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        const ledger = yield* Ledger;
        yield* mailbox.send(name, "letter_a", M_MARK, from());
        yield* ledger.append(`${name}/inbox`, "x-1", {
          ...from(),
          _tag: "exit",
          body: { m: M_MARK },
        });
        yield* mailbox.send(name, "letter_b", M_MARK, from());
        const letters = yield* Stream.runCollect(mailbox.receive(name, 0));
        expect(letters.length).toBe(2);
        const [receive, ...more] = ended("mailbox.receive");
        expect(more).toEqual([]);

        if (receive === undefined) {
          return expect.unreachable();
        }

        expect(holds(receive, name) || holds(receive, `${name}/inbox`)).toBe(true);
        expect(tags(receive)["fab.mailbox.name"]).toBe(name);
        expect(tagged(receive, "after")).toBe(0);
        expect(tagged(receive, "letters")).toBe(2);
        expect(tagged(receive, "skipped")).toBe(1);
        expect(tags(receive)["messaging.operation.type"]).toBe("receive");
        const reads = ended("ledger.read");
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every((read) => within(read, receive))).toBe(true);
        clean(spans);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );
});

describe("p97, process spans", () => {
  it.effect.prop(
    "each start ends one process.start span with process ID, program, hash and answer",
    [
      nameArb,
      Start.cases.first.fields.code.fields.program.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,30}$/)),
      Start.cases.first.fields.code.fields.hash.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,30}$/)),
    ],
    examples([["notes:1", "notes", "sha256-7c1d073e"]], (name: string, program: string, hash: string) => {
      const { tracer, ended, spans } = capture();
      return Effect.gen(function* () {
        const manager = yield* ProcessManager;
        const request = firstStart("start:notes:1", name, {
          program,
          hash,
        });
        yield* manager.start(request, from());
        expect((yield* Effect.flip(manager.start(request, from({ parent: null })))).reason).toBe("id_reused");
        const [first, second, ...more] = ended("process.start");
        expect(more).toEqual([]);

        if (first === undefined || second === undefined) {
          return expect.unreachable();
        }

        expect(holds(first, name)).toBe(true);
        expect(tags(first)["fab.process"]).toBe(A);
        expect(tagged(first, "program")).toBe(program);
        expect(tagged(first, "hash")).toBe(hash);
        expect(tagged(first, "answer")).toBe("placed");
        expect(tagged(second, "answer")).toBe("refused");
        expect(tagged(second, "reason")).toBe("id_reused");
        // P33 writes a group atomically; it no longer requires separate ledger.append calls.
        clean(spans);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );
});

describe("p97, member spans", () => {
  it.effect.prop(
    "plant, a refused write with no span: every write ends one members.write span",
    [keyArb],
    examples([["t1"]], (key: string) => {
      const { tracer, ended, spans } = capture();
      return Effect.gen(function* () {
        const clients = yield* ClientManager;
        yield* write(granted("pA", key));
        yield* write(granted("wA", "t2"));
        yield* write(denied("t3"));
        yield* write(revoked("pA", key));
        const writes = ended("members.write");
        expect(writes.length).toBe(4);
        const [grant, refused, deny, revoke] = writes;

        if (grant === undefined || refused === undefined || deny === undefined || revoke === undefined) {
          return expect.unreachable();
        }

        expect(tagged(grant, "tag")).toBe("granted");
        expect(tagged(grant, "answer")).toBe("applied");
        expect(tagged(grant, "rev")).toBe(2);
        expect(holds(grant, "pA")).toBe(true); // the signer's key
        expect(tagged(refused, "answer")).toBe("refused");
        expect(tagged(refused, "reason")).toBe("not_allowed");
        expect(holds(refused, "wA")).toBe(true);
        expect(tagged(deny, "tag")).toBe("denied");
        expect(tagged(revoke, "tag")).toBe("revoked");
        const before = ended("members.read").length;
        yield* clients.members;
        const reads = ended("members.read");
        expect(reads.length).toBe(before + 1);
        const read = reads.at(-1);

        if (read === undefined) {
          return expect.unreachable();
        }

        const events = yield* Stream.runCollect((yield* Ledger).read("door/members", 0));
        expect(tagged(read, "events")).toBe(events.length);
        expect(typeof tagged(read, "keys")).toBe("number");
        expect(typeof tagged(read, "live")).toBe("number");
        expect(tagged(read, "ignored")).toBe(0);
        clean(spans);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );

  it.effect.prop(
    "plant, ignored reported as applied: the Mac that lost the sheet race has an ignored span",
    [keyArb],
    examples([["r1"]], (key: string) => {
      const { tracer, ended, spans } = capture();
      const sql = fresh();
      const sheet = addedSheet("pA", key);
      const macC = addedDevice(key, "pC", "wC", ["pA"]);
      const macX = addedDevice(key, "pX", "wX");
      const hook: { before: Effect.Effect<void, LedgerError> | null } = {
        before: write(macX).pipe(
          Effect.asVoid,
          Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provide(onSql(sql)))),
        ),
      };
      const target = macC._tag === "added" ? macC.add.id : "";
      // A Ledger that runs Mac X's whole write just before Mac C's append: the race, made certain.
      const racing = Layer.effect(
        Ledger,
        Effect.gen(function* () {
          const real = yield* Ledger;
          return {
            read: real.read,
            wait: real.wait,
            append: (stream: string, id: string, line: Parameters<typeof real.append>[2]) =>
              Effect.suspend(() => {
                const before = id === target ? hook.before : null;

                if (before === null) {
                  return real.append(stream, id, line);
                }

                hook.before = null;
                return Effect.andThen(before, real.append(stream, id, line));
              }),
          };
        }),
      ).pipe(Layer.provide(onSql(sql)));
      return Effect.gen(function* () {
        const clients = yield* ClientManager;
        yield* write(sheet);
        expect(yield* write(macC)).toEqual({ _tag: "ignored", rev: 4, reason: "used" });
        // Spans are kept in the order they start, and Mac X's starts inside Mac C's, so sort them.
        const answers = ended("members.write")
          .map((span) => `${String(tagged(span, "answer"))} ${String(tagged(span, "reason") ?? "")}`)
          .sort();
        expect(answers).toEqual(["applied ", "applied ", "ignored used"]);
        yield* clients.members;
        const read = ended("members.read").at(-1);
        expect(read === undefined ? null : tagged(read, "ignored")).toBe(1);
        clean(spans);
      }).pipe(Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provide(racing))), Effect.withTracer(tracer));
    }),
    options,
  );
});

describe("p97, names and numbers only", () => {
  it.effect.prop(
    "a name, an id and a key far over 128 characters are cut in every tag",
    [
      Schema.Int.check(Schema.isBetween({ minimum: 129, maximum: 1000 })),
      Schema.Int.check(Schema.isBetween({ minimum: 129, maximum: 256 })),
    ],
    examples([[300, 200]], (length: number, cap: number) => {
      const { tracer, spans, ended } = capture();
      const long = (letter: string) => letter.repeat(length);
      // Process texts stay under their 256-character cap and still pass the 128 tag cut.
      const capped = (letter: string) => letter.repeat(cap);
      return Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        const manager = yield* ProcessManager;
        yield* mailbox.send(long("n"), long("i"), { value: M_MARK }, from({ by: long("b") }));
        yield* Stream.runCollect(mailbox.receive(long("n"), 0));
        yield* manager.start(
          firstStart("start:long", capped("p"), { program: capped("g"), hash: capped("h") }),
          from({ seen: 1 }),
        );
        yield* write(granted(long("k"), "t1"));

        for (const name of ["mailbox.send", "mailbox.receive", "process.start", "members.write"]) {
          expect(ended(name).length, name).toBe(1);
        }

        clean(spans);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );
});

// Gaps the mutation step found on the build (ticket 236): tag names and numbers held loose above.
describe("p97, the tags hold the right names and numbers", () => {
  it.effect.prop(
    "members.read counts only live keys as live, and members.write names its key",
    [keyArb],
    examples([["t1"]], (key: string) => {
      const { tracer, ended } = capture();
      return Effect.gen(function* () {
        const clients = yield* ClientManager;
        const event = granted("pA", key);
        yield* write(event);
        yield* write(revoked("pA", key));
        const [grant] = ended("members.write");

        if (grant === undefined) {
          return expect.unreachable();
        }

        expect(tagged(grant, "key")).toBe(key);
        expect(tagged(grant, "signer")).toBe("pA");
        expect(tagged(grant, "id")).toBe(event._tag === "granted" ? event.grant.id : expect.unreachable());
        yield* clients.members;
        const read = ended("members.read").at(-1);

        if (read === undefined) {
          return expect.unreachable();
        }

        // pA, wA and t1 are known; t1 is revoked, so two are live.
        expect(tagged(read, "keys")).toBe(3);
        expect(tagged(read, "live")).toBe(2);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );

  it.effect.prop(
    "a members call on a founded ledger appends nothing: no ledger.append span",
    [Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 20 }))],
    examples([[2]], (count: number) => {
      const { tracer, ended } = capture();
      return Effect.gen(function* () {
        const clients = yield* ClientManager;
        yield* clients.members;
        expect(ended("ledger.append").length).toBe(1); // the founding
        yield* clients.members;
        yield* clients.members;

        for (let n = 2; n < count; n++) {
          yield* clients.members;
        }

        expect(ended("ledger.append").length).toBe(1);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );

  it.effect.prop(
    "an ignored write's span holds the rev it was placed at",
    [keyArb],
    examples([["r1"]], (key: string) => {
      const { tracer, ended } = capture();
      const sql = fresh();
      const sheet = addedSheet("pA", key);
      const macC = addedDevice(key, "pC", "wC", ["pA"]);
      const macX = addedDevice(key, "pX", "wX");
      const target = macC._tag === "added" ? macC.add.id : "";
      let before: Effect.Effect<void, LedgerError> | null = write(macX).pipe(
        Effect.asVoid,
        Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provide(onSql(sql)))),
      );
      // Mac X's whole write runs just before Mac C's append, as in the race above.
      const racing = Layer.effect(
        Ledger,
        Effect.map(Ledger, (real) => ({
          read: real.read,
          wait: real.wait,
          append: (stream: string, id: string, line: Parameters<typeof real.append>[2]) =>
            Effect.suspend(() => {
              const first = id === target ? before : null;

              if (first === null) {
                return real.append(stream, id, line);
              }

              before = null;
              return Effect.andThen(first, real.append(stream, id, line));
            }),
        })),
      ).pipe(Layer.provide(onSql(sql)));
      return Effect.gen(function* () {
        yield* write(sheet);
        expect(yield* write(macC)).toEqual({ _tag: "ignored", rev: 4, reason: "used" });
        const ignored = ended("members.write").find((span) => tagged(span, "answer") === "ignored");

        if (ignored === undefined) {
          return expect.unreachable();
        }

        expect(tagged(ignored, "rev")).toBe(4);
        expect(tagged(ignored, "reason")).toBe("used");
      }).pipe(Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provide(racing))), Effect.withTracer(tracer));
    }),
    options,
  );

  it.effect.prop(
    "mailbox.send keeps the letter's id under OpenTelemetry's message id key",
    [idArb],
    examples([["letter_a"]], (id: string) => {
      const { tracer, ended } = capture();
      return Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        yield* mailbox.send("notes:1", id, { value: M_MARK }, from());
        const [send] = ended("mailbox.send");

        if (send === undefined) {
          return expect.unreachable();
        }

        expect(tags(send)["messaging.message.id"]).toBe(id);
      }).pipe(Effect.provide(all()), Effect.withTracer(tracer));
    }),
    options,
  );

  it.effect.prop(
    "a send the ledger fails ends its span with the ledger's reason",
    [nameArb, idArb],
    examples([["notes:1", "letter_a"]], (name: string, id: string) => {
      const { tracer, ended } = capture();
      const broken = Layer.succeed(Ledger, {
        append: () => Effect.fail(new LedgerError({ reason: "storage" })),
        read: () => Stream.fail(new LedgerError({ reason: "storage" })),
        wait: () => Effect.fail(new LedgerError({ reason: "storage" })),
      });
      return Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        const failed = yield* Effect.flip(mailbox.send(name, id, {}, from()));
        expect(failed.reason).toBe("storage");
        const [send] = ended("mailbox.send");

        if (send === undefined) {
          return expect.unreachable();
        }

        expect(tagged(send, "reason")).toBe("storage");
      }).pipe(Effect.provide(Mailbox.layer.pipe(Layer.provide(broken))), Effect.withTracer(tracer));
    }),
    options,
  );
  it.effect.prop(
    "a failed members read ends its span with the ledger's reason",
    [Schema.Literals(["storage", "bad_row"])],
    ([reason]) => {
      const { tracer, ended } = capture();
      const broken = Layer.succeed(Ledger, {
        append: () => Effect.fail(new LedgerError({ reason })),
        read: () => Stream.fail(new LedgerError({ reason })),
        wait: () => Effect.fail(new LedgerError({ reason })),
      });
      return Effect.gen(function* () {
        expect((yield* Effect.flip((yield* ClientManager).members)).reason).toBe(reason);
        const reads = ended("members.read");
        expect(reads).toHaveLength(1);
        expect(tagged(reads[0]!, "reason")).toBe(reason);
      }).pipe(Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provide(broken))), Effect.withTracer(tracer));
    },
    { arbitrary: { seed: 119120, runs: 20 } },
  );
  it.effect.prop(
    "a live key cannot join again under another rank",
    [keyArb],
    ([key]) =>
      Effect.gen(function* () {
        const clients = yield* ClientManager;
        expect((yield* write(granted("pA", key)))._tag).toBe("applied");
        const before = yield* clients.members;
        const event = granted("pA", key);

        if (event._tag !== "granted") {
          return expect.unreachable();
        }

        expect(yield* write({ ...event, grant: { ...event.grant, as: "agent" } })).toEqual({
          _tag: "refused",
          reason: "not_allowed",
        });
        expect(yield* clients.members).toEqual(before);
      }).pipe(Effect.provide(all())),
    { arbitrary: { seed: 119120, runs: 20 } },
  );
  it.prop(
    "founding twice with different person ids preserves the first membership",
    [MemberEvent.cases.founded, MemberEvent.cases.founded],
    ([first, input]) => {
      const second = { ...input, id: `${first.id}${input.id}-second` };
      expect(foldMembers([first, second])).toEqual(foldMembers([first]));
    },
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});
