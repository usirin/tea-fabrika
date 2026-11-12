// P8, next/. format: the frozen eight-line storage format and its independent history.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { expect, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import { Ledger } from "@kampus/libfabrika/ledger/Ledger";
import { Entry, TraceId } from "@kampus/libfabrika/ledger/Log";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";

const Note = Id.make("note");

const Save = Schema.Struct({
  note: Note,
  base: Schema.Number,
  body: Schema.String,
  reason: Schema.optionalKey(Schema.Literals(["pause", "leave", "done", "kept"])),
  from: Schema.optionalKey(Schema.Struct({ note: Note, version: Schema.Number })),
});

const Message = Schema.Struct({ type: Schema.Literal("save"), value: Save });
const Send = Schema.TaggedStruct("send", { m: Message });

const Stored = Schema.Struct({
  ...Entry.fields,
  id: Id.Letter,
  parent: Id.InputId,
  for: Id.Person,
  stream: Schema.Literal("notes:1/inbox"),
  pos: Schema.Int.check(Schema.isGreaterThan(0)),
  rev: Schema.Int.check(Schema.isGreaterThan(0)),
  body: Schema.Struct({ m: Message }),
});

const decode = (raw: unknown) => {
  Schema.decodeUnknownSync(Entry)(raw);
  const entry = Schema.decodeUnknownSync(Stored)(raw);
  Schema.decodeUnknownSync(Send)({ ...entry.body, _tag: entry._tag });
  expect(entry.seen).toBeLessThan(entry.rev);
  expect(entry.by).toMatch(/^SHA256:fixture-(person|agent)$/);
  Schema.decodeUnknownSync(TraceId)(entry.traceId);
  return entry;
};

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const text = yield* fs.readFileString(
    path.resolve(import.meta.dirname, "../../../../../fixtures/next/notes-letters.jsonl"),
  );
  return text
    .trimEnd()
    .split("\n")
    .map((line) => decode(JSON.parse(line)));
});

// Hand-written independently of the fixture reader and any future notes fold.
const expected = [
  {
    note: "A",
    version: 1,
    base: 0,
    body: "",
    reason: "pause",
    rev: 3,
    pos: 1,
    arrivedAt: 1000,
    sentAt: "2030-01-01T00:00:00Z",
    by: "SHA256:fixture-person",
    seen: 0,
    build: "notes-fixture-1",
    n: "1",
  },
  {
    note: "B",
    version: 1,
    base: 0,
    body: "B trailing  ",
    reason: "leave",
    rev: 7,
    pos: 2,
    arrivedAt: 1001,
    sentAt: "2020-01-01T00:00:00Z",
    by: "SHA256:fixture-person",
    seen: 3,
    build: "notes-fixture-1",
    n: "2",
  },
  {
    note: "A",
    version: 2,
    base: 1,
    body: "A\nsecond line\n",
    reason: "done",
    rev: 10,
    pos: 3,
    arrivedAt: 1002,
    sentAt: "2040-01-01T00:00:00Z",
    by: "SHA256:fixture-person",
    seen: 7,
    build: "notes-fixture-1",
    n: "3",
  },
  {
    note: "B",
    version: 2,
    base: 1,
    body: "B 🌱",
    rev: 14,
    pos: 4,
    arrivedAt: 1003,
    sentAt: "2010-01-01T00:00:00Z",
    by: "SHA256:fixture-agent",
    seen: 10,
    build: "notes-fixture-2",
    n: "4",
  },
  {
    note: "A",
    version: 3,
    base: 2,
    body: "A مرحبا\n```ts\nconst n = 3;\n```  ",
    reason: "pause",
    rev: 19,
    pos: 5,
    arrivedAt: 1004,
    sentAt: "2050-01-01T00:00:00Z",
    by: "SHA256:fixture-person",
    seen: 14,
    build: "notes-fixture-2",
    n: "5",
  },
  {
    note: "B",
    version: 3,
    base: 2,
    body: "B kept from A",
    reason: "kept",
    from: { note: "note_0000000000e008000000000001", version: 3 },
    rev: 23,
    pos: 6,
    arrivedAt: 1005,
    sentAt: "2000-01-01T00:00:00Z",
    by: "SHA256:fixture-person",
    seen: 19,
    build: "notes-fixture-2",
    n: "6",
  },
  {
    note: "A",
    version: 4,
    base: 3,
    body: "A final  \n",
    reason: "done",
    rev: 28,
    pos: 7,
    arrivedAt: 1006,
    sentAt: "2060-01-01T00:00:00Z",
    by: "SHA256:fixture-person",
    seen: 23,
    build: "notes-fixture-3",
    n: "7",
  },
  {
    note: "B",
    version: 4,
    base: 3,
    body: "B final 🧪\nשלום",
    reason: "leave",
    rev: 31,
    pos: 8,
    arrivedAt: 1007,
    sentAt: "1990-01-01T00:00:00Z",
    by: "SHA256:fixture-agent",
    seen: 28,
    build: "notes-fixture-3",
    n: "8",
  },
];

const wanted = expected.map(({ note, version: _version, n, base, body, reason, from, ...meta }) => ({
  ...meta,
  id: `letter_0000000000e00800000000000${n}`,
  parent: `input_0000000000e00800000000000${n}`,
  for: "person_0000000000e008000000000001",
  traceId: `0000000000000000000000000000000${n}`,
  m: {
    type: "save",
    value: {
      note: `note_0000000000e00800000000000${note === "A" ? 1 : 2}`,
      base,
      body,
      ...(reason === undefined ? {} : { reason }),
      ...(from === undefined ? {} : { from }),
    },
  },
}));

const history = (entries: ReadonlyArray<typeof Stored.Type>) =>
  entries.map(({ stream: _stream, _tag, body, ...metadata }) => ({ ...metadata, m: body.m }));

const checkHistory = (rows: unknown) => expect(rows).toEqual(wanted);

it.effect("format: Entry, TypeIDs and every stored byte match the frozen history", () =>
  Effect.gen(function* () {
    const entries = yield* fixture;
    expect(entries).toHaveLength(8);
    checkHistory(history(entries));
    expect(new Set(entries.map((e) => e.id)).size).toBe(8);
    expect(new Set(entries.map((e) => e.parent)).size).toBe(8);
  }).pipe(Effect.provide(platform)),
);

it.effect("format: Mailbox.read preserves A3 and all metadata in accepted order", () =>
  Effect.gen(function* () {
    const entries = yield* fixture;
    // This read-only ledger adapter supplies frozen disk rows; the reader is the real Mailbox.
    const ledger = Layer.succeed(Ledger, {
      append: () => Effect.die("fixture is read only"),
      wait: () => Effect.die("fixture cannot wait"),
      read: (stream, after) => Stream.fromIterable(entries.filter((e) => e.stream === stream && e.rev > after)),
    });
    const mailbox = yield* Mailbox.pipe(Effect.provide(Mailbox.layer), Effect.provide(ledger));
    checkHistory(yield* Stream.runCollect(mailbox.read("notes:1", 0)));
    expect((yield* Stream.runCollect(mailbox.read("notes:1", 14)))[0]).toEqual(wanted[4]);
  }).pipe(Effect.provide(platform)),
);

it.effect("format: plants remove each required field, corrupt IDs and alter one byte", () =>
  Effect.gen(function* () {
    const entries = yield* fixture;

    for (const entry of entries) {
      decode(entry); // clean control

      for (const field of Object.keys(entry)) {
        const bad: Record<string, unknown> = { ...entry };
        delete bad[field];
        expect(() => decode(bad), `missing ${field}`).toThrow();
      }

      for (const field of ["note", "base", "body"] as const) {
        const bad: Record<string, unknown> = { ...entry.body.m.value };
        delete bad[field];
        expect(() => decode({ ...entry, body: { m: { type: "save", value: bad } } })).toThrow();
      }

      expect(() => decode({ ...entry, id: "p8-01" })).toThrow();
      expect(() =>
        decode({
          ...entry,
          body: { m: { type: "save", value: { ...entry.body.m.value, note: "not-a-TypeID" } } },
        }),
      ).toThrow();
    }

    const rows = history(entries);
    expect(() =>
      checkHistory(
        rows.map((row) => ({
          ...row,
          m: { ...row.m, value: { ...row.m.value, body: `${row.m.value.body}!` } },
        })),
      ),
    ).toThrow();
    console.info("P8 plants caught: required fields, p8-01, non-TypeID note, changed byte");
  }).pipe(Effect.provide(platform)),
);

it.effect("format: plants sort by writer clock, trim bodies or share note versions", () =>
  Effect.gen(function* () {
    const entries = yield* fixture;
    checkHistory(history(entries));
    expect(() => checkHistory(history(entries).sort((a, b) => a.sentAt.localeCompare(b.sentAt)))).toThrow();
    expect(() =>
      checkHistory(
        history(entries).map((row) => ({
          ...row,
          m: { ...row.m, value: { ...row.m.value, body: row.m.value.body.trim() } },
        })),
      ),
    ).toThrow();
    const versions = expected.map((e) => e.version);
    expect(versions).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(() => expect(entries.map((e) => e.pos)).toEqual(versions)).toThrow();
    // Fixed final list, independent of any fold or clock sort.
    expect([wanted[7], wanted[6]].map((e) => e?.m.value.body)).toEqual(["B final 🧪\nשלום", "A final  \n"]);
    console.info("P8 plants caught: sentAt sort, shared versions, trimming");
  }).pipe(Effect.provide(platform)),
);
