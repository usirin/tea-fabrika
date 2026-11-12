// P17b slice 1, next/. Pure public contracts; database reads belong to NemesisTest.
// After build, run each plant once and restore by copy:
// Start/Fault: allow zero, unsafe integers, an oversized seed or a non-checklist target.
// Counts/vector: count IDs by body or rev, or count gaps from zero.
// Recovery: choose array order, another predecessor/name, or an event at/before the hit.
// Identity pins: widen ExperimentId to string; CI runs this type-only plant.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Id from "../Id.ts";
import type { History } from "../processes/Mailbox.ts";
import { ProcessEvent } from "../processes/Process.ts";
import type { ProcessId } from "../ProcessId.ts";
import * as Chaos from "./Chaos.ts";

const arbitrary = { seed: 119120, runs: 100 };
const process = "process_0000000000e008000000000000";
const next = "process_0000000000e008000000000001";
const other = "process_0000000000e008000000000002";
const experiment = Schema.decodeUnknownSync(Id.make("chaos"))("chaos_0000000000e008000000000000");

const target = {
  program: "fabrika/checklist",
  name: "checklist:1",
  process,
  client: "client:1",
  key: "public:1",
} as const;

const from = {
  by: "brain",
  for: "person",
  sentAt: "2026-11-12T00:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: "1234567890abcdef1234567890abcdef",
  build: "test",
} as const;

// The planned service values keep the existing shared identities, rather than new string aliases.
expectTypeOf<typeof Chaos.ExperimentId.Type>().toEqualTypeOf<Id.IdValue<"chaos">>();
expectTypeOf<typeof Chaos.Target.Type.process>().toEqualTypeOf<typeof ProcessId.Type>();
expectTypeOf<typeof Chaos.Start.Type.id>().toEqualTypeOf<typeof Chaos.ExperimentId.Type>();
expectTypeOf<typeof Chaos.Fire.Type.id>().toEqualTypeOf<typeof Chaos.ExperimentId.Type>();
expectTypeOf<typeof Chaos.Fire.Type.fault>().toEqualTypeOf<typeof Chaos.Fault.Type>();

expectTypeOf<typeof Chaos.Fault.Type._tag>().toEqualTypeOf<
  "drop_socket" | "drop_answer" | "delay" | "abort" | "abort_all" | "fail_step" | "revoke_key"
>();

const integer = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const positive = integer(1, Number.MAX_SAFE_INTEGER);

const starts = Arbitrary.all({
  id: Arbitrary.Constant(experiment),
  target: Arbitrary.Constant(target),
  seed: integer(1, 0xffffffff),
  most: positive,
  gap: positive,
});

it.prop(
  "Start accepts valid starts and rejects one invalid bound or target",
  [starts, Arbitrary.schema(Schema.String)],
  ([start, text]) => {
    expect(Schema.is(Chaos.Start)(start)).toBe(true);

    for (const field of ["seed", "most", "gap"] as const) {
      for (const value of [0, -1, 0.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(Schema.is(Chaos.Start)({ ...start, [field]: value }), `${field}=${value}`).toBe(false);
      }
    }

    expect(Schema.is(Chaos.Start)({ ...start, seed: 0x100000000 })).toBe(false);

    for (const program of ["chaos", "fabrika/chaos", "fabrika/counter", "fabrika/notes", `${text}/chaos`]) {
      expect(Schema.is(Chaos.Start)({ ...start, target: { ...target, program } })).toBe(false);
    }

    for (const field of ["name", "process", "client", "key"] as const) {
      expect(Schema.is(Chaos.Target)({ ...target, [field]: "" })).toBe(false);
    }

    expect(Schema.is(Chaos.Target)({ ...target, process: "not-a-process" })).toBe(false);
    expect(Schema.is(Chaos.Start)({ ...start, id: process })).toBe(false);
  },
  { arbitrary },
);

it.prop(
  "Fault round trips and refuses unsafe delay, failure counts and unknown object kinds",
  [Arbitrary.schema(Chaos.Fault)],
  ([fault]) => {
    const json = Schema.toCodecJson(Chaos.Fault);
    expect(Schema.decodeUnknownSync(json)(Schema.encodeSync(json)(fault))).toEqual(fault);

    for (const field of ["client", "key", "name", "process"] as const) {
      if (field in fault) {
        expect(Schema.is(Chaos.Fault)({ ...fault, [field]: "" })).toBe(false);
      }
    }

    if ("process" in fault) {
      expect(Schema.is(Chaos.Fault)({ ...fault, process: "not-a-process" })).toBe(false);
    }

    for (const ms of [0, -1, 0.25, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(Schema.is(Chaos.Fault)({ ...Chaos.Fault.cases.delay.make({ client: "c", ms: 1 }), ms })).toBe(false);
    }

    for (const times of [0, 2, 4, 1.5]) {
      expect(Schema.is(Chaos.Fault)({ ...Chaos.Fault.cases.fail_step.make({ process, times: 1 }), times })).toBe(false);
    }

    expect(
      Schema.is(Chaos.Fault)({ ...Chaos.Fault.cases.abort.make({ target: "project", name: "p" }), target: "gateway" }),
    ).toBe(false);
  },
  { arbitrary },
);

const letters = Arbitrary.array(
  Arbitrary.all({
    id: integer(0, 12).pipe(Arbitrary.map(String)),
    pos: integer(1, 80),
    rev: integer(1, 1_000_000),
    m: Arbitrary.schema(Schema.Json),
  }),
  { maxLength: 120 },
);

const history = (letter: { id: string; pos: number; rev: number; m: unknown }): History => ({
  ...from,
  ...letter,
  arrivedAt: 100,
});

// Set enumeration is independent of the implementation's count/min/max formula.
const oracle = (input: ReadonlyArray<{ id: string; pos: number }>) => {
  const positions = new Set(input.map((letter) => letter.pos));
  const ids = new Set(input.map((letter) => letter.id));
  const sorted = [...positions].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted.at(-1);
  let gaps = 0;

  if (first !== undefined && last !== undefined) {
    for (let pos = first; pos <= last; pos++) {
      if (!positions.has(pos)) {
        gaps++;
      }
    }
  }

  return { letters: input.length, doubled: input.length - ids.size, gaps };
};

it.prop(
  "ID duplicates and observed position gaps match an independent set oracle",
  [letters],
  ([input]) => {
    expect(Chaos.checkHistory(input.map(history))).toEqual(oracle(input));
    expect(Chaos.checkHistory(input.toReversed().map(history))).toEqual(oracle(input));
    const changed = input.map((letter, i) => history({ ...letter, m: { different: i }, rev: 100000 + i * 100 }));
    expect(Chaos.checkHistory(changed)).toEqual(oracle(input));
  },
  { arbitrary },
);

it("vector: empty, singleton, shifted and repeated positions define the count formula", () => {
  // Algorithm vectors pin the observed-interval definition, including equal bodies with distinct IDs.
  const cases = [
    { input: [], want: { letters: 0, doubled: 0, gaps: 0 } },
    { input: [{ id: "a", pos: 41, rev: 900, m: 1 }], want: { letters: 1, doubled: 0, gaps: 0 } },
    {
      input: [
        { id: "a", pos: 43, rev: 1000, m: 1 },
        { id: "a", pos: 41, rev: 2, m: 2 },
        { id: "b", pos: 41, rev: 2000, m: 1 },
      ],
      want: { letters: 3, doubled: 1, gaps: 1 },
    },
  ];

  for (const { input, want } of cases) {
    expect(Chaos.checkHistory(input.map(history))).toEqual(want);
  }
});

// This is a ledger value, made with a tagged schema rather than a second event model.
const RestartEntry = Schema.TaggedStruct("restarted", {
  id: Schema.String,
  stream: Schema.String,
  pos: Schema.Number,
  rev: Schema.Number,
  arrivedAt: Schema.Number,
  by: Schema.String,
  for: Schema.String,
  sentAt: Schema.String,
  seen: Schema.Number,
  parent: Schema.Null,
  traceId: Schema.String,
  build: Schema.String,
  body: Schema.Json,
});

const restart = (id: string, name: string, predecessor: string, successor: string, rev: number, arrivedAt: number) => {
  const { _tag: _event, ...body } = ProcessEvent.cases.restarted.make({
    name,
    after: predecessor,
    process: successor,
    reason: "crash",
    build: "test",
  });
  return RestartEntry.make({ ...from, id, stream: `processes/${name}`, pos: rev, rev, arrivedAt, body });
};

it.prop(
  "Recovery uses the first matching restart revision after the actual hit",
  [
    Arbitrary.all({
      after: integer(10, 10000),
      at: integer(1, 10000),
      reverse: Arbitrary.schema(Schema.Boolean),
      sameClock: Arbitrary.schema(Schema.Boolean),
      matching: Arbitrary.schema(Schema.Boolean),
    }),
  ],
  ([{ after, at, reverse, sameClock, matching }]) => {
    const hit = { name: target.name, process, after };
    const first = restart("first", target.name, process, next, after + 2, at);
    const rows = [
      restart("before", target.name, process, next, after - 1, at),
      restart("at-hit", target.name, process, next, after, at),
      restart("wrong-name", "other:1", process, next, after + 1, at),
      restart("wrong-predecessor", target.name, other, next, after + 1, at),
      // The right body in another stream is not this registered name's public history.
      { ...restart("wrong-stream", target.name, process, next, after + 1, at), stream: "processes/other:1" },
      ...(matching ? [first, restart("later", target.name, process, other, after + 3, sameClock ? at : at + 1)] : []),
    ];
    const input = reverse ? rows.toReversed() : rows;
    expect(Chaos.recovery(hit, input)).toEqual(
      matching ? { ref: first.id, rev: first.rev, arrivedAt: first.arrivedAt, process: next } : null,
    );
    expect(Chaos.recovery(null, input), "an unknown hit or socket fault supplies no process recovery").toBeNull();
  },
  { arbitrary },
);
