// fabsh slice 2a, next/: the runner's `programs` law L24 of the approved plan
// (docs/plan/lanes/fabsh-PLAN.md, "Laws", and amendment A6), a suite the module owning a real SQLite
// driver runs (0062): `ProgramsTest.suite(harness)`, from `node/runtime/Programs.test.ts`. The plan
// names one file, `runtime/Programs.test.ts`; a runtime test may not open a driver, so the law lives
// here and the driver runs it, as slice 1's `RunnerDraftTest` does. Written before `Programs.ts`;
// until the build adds it, this file fails on that missing module.
//
// The shape this law holds the build to, from the plan's "Slice 2: the start, the desk and 953":
// - `Programs.ts` exports `programs`, a runner built-in Cmd like `start_child`:
//   `Cmd.make("programs", { input: <no field>, ok: <an array of program names>, err: [...] })`.
//   A program declares it in its machine's `cmds` and sends `programs({})`.
// - The runner performs it itself, as it performs `start_child`: its `programs_ok` answer's `value`
//   is every name its `ProgramLoader` can load, sorted (JavaScript's default string order), read
//   when the Cmd runs, never a list kept from an earlier answer or another runner.
// - `ProgramLoader` is the one source: the build may add a call to it that lists its table.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { Writer } from "../access/SessionManager.ts";
import { Archive, RecordManager, SpanSink } from "../coordination/index.ts";
import { InputId } from "../Id.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Program } from "./Program.ts";
import { programs } from "./Programs.ts";
import { ProgramRunner } from "./Runner.ts";
import { BRAIN, type Harness } from "./RunnerRepliesTest.ts";

const SEED = 119120;
const NAME = "asker:1";
const ASKER = "asker";
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
const owner = Writer.cases.person.make({ key: "SHA256:fixture", for: "person-fixture" });

const meta = {
  by: BRAIN,
  for: "brain",
  sentAt: "2026-11-14T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE.traceId,
  build: "test",
};

/** Every answer the asker was told, in order: a `programs_ok` value, or a refusal's reason. */
const Model = Schema.Struct({ told: Schema.Array(Schema.Json) });
const Msg = Schema.Struct({ type: Schema.Literal("ask") });

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [programs],
  init: (saved) => [saved ?? { told: [] }, []],
  update: {
    ask: (s) => [s, [programs({})]],
    programs_ok: (s, m) => [{ told: [...s.told, Schema.decodeUnknownSync(Schema.Json)(m.value)] }, []],
    programs_err: (s, m) => [{ told: [...s.told, m.reason] }, []],
  },
});

/** A program like fabsh, cut to what this law reads: one input that asks the runner what it can start. */
const asker = Program.make({
  name: ASKER,
  machine,
  state: { v: 1, upgrades: [] },
  view: (s) => ({ told: s.told }),
  refuse: () => null,
  inputs: { ask: "Ask which programs can be started" },
  outputs: {},
  writes: {},
  wake: () => null,
});

/** One runner on fresh files whose loader holds `table`, and a way to send it `ask`. */
const world = Effect.fnUntraced(function* (harness: Harness, table: Readonly<Record<string, unknown>>) {
  const files = yield* harness.files;
  const scope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void));
  const sql = yield* files("inbox").pipe(Scope.provide(scope));
  const manager = yield* files("manager").pipe(Scope.provide(scope));
  const spans = yield* files("spans").pipe(Scope.provide(scope));
  const coordination = yield* Layer.build(harness.services(sql, manager)).pipe(Scope.provide(scope));
  const processes = Context.get(coordination, ProcessManager);
  const mailbox = Context.get(coordination, Mailbox);
  yield* processes
    .start(Start.cases.first.make({ id: "boot-asker", name: NAME, code: { program: ASKER, hash: "test" } }), meta)
    .pipe(Effect.orDie);
  const live = yield* processes.status(NAME).pipe(Effect.orDie);
  const dependencies = Layer.mergeAll(
    ProgramLoader.layer(table, {}),
    ProcessStore.layer(sql, { process: live.state.process }),
    Layer.succeed(CheckedWriter, {
      append: (i) =>
        mailbox.send(NAME, i.id, i.envelope.input, {
          ...meta,
          by: i.envelope.by.key,
          for: i.envelope.by.for,
          parent: i.envelope.id,
        }),
      commit: () => Effect.die("no outputs"),
      own: () => Effect.die("no outputs"),
    }),
    Layer.succeed(WatcherManager, { publish: () => Effect.void }),
    Layer.succeed(Alarm, { set: () => Effect.void }),
    Recording.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          SpanSink.layer(spans, { object: "asker" }),
          RecordManager.memory(4 * 1024 * 1024),
          Archive.memory,
        ),
      ),
    ),
  ).pipe(Layer.provideMerge(Layer.succeedContext(coordination)));
  const context = yield* Layer.build(
    ProgramRunner.layer(
      { id: live.state.process, name: NAME, program: ASKER, build: "test", owner },
      { recovery: { sql, name: NAME, capacity: 1024 ** 3 } },
    ).pipe(Layer.provide(dependencies)),
  ).pipe(Scope.provide(scope));
  const runner = Context.get(context, ProgramRunner);
  let serial = 0;
  return {
    ask: Effect.fnUntraced(function* () {
      const incoming: Incoming = {
        id: `ask-${serial}`,
        envelope: {
          id: InputId.make(`input_0000000000e008${(serial++).toString(16).padStart(12, "0")}`),
          by: owner,
          arrivedAt: serial,
          input: { type: "ask" },
        },
        sentAt: meta.sentAt,
        seen: 0,
        span: TRACE,
      };
      expect((yield* runner.msg(incoming))._tag, "the runner takes the ask").toBe("accepted");
    }),
    told: Effect.fnUntraced(function* () {
      const view = (yield* runner.open("law")).view as { readonly told: ReadonlyArray<unknown> };
      return view.told;
    }),
  };
});

/** A table of 0 to 12 program names over three packs, each `pack/program`, with repeats dropped.
 *  Numbered words, so the default string order ("w10" before "w2") differs from a numeric one. */
const Table = Arbitrary.array(
  Arbitrary.all({
    pack: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 }))),
    word: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 }))),
  }),
  { minLength: 0, maxLength: 12 },
).pipe(Arbitrary.map((picks) => [...new Set(picks.map((p) => `p${p.pack}/w${p.word}`))]));

export const suite = (harness: Harness) =>
  describe("fabsh slice 2a: the runner's programs Cmd, next/", () => {
    it.live.prop(
      "L24: the programs Cmd answers exactly the loader's table names, sorted, read when it runs",
      [Table],
      ([names]) =>
        Effect.scoped(
          Effect.gen(function* () {
            // Every name loads a real program; the asker is in the table too, since the runner loads it.
            const table = Object.fromEntries([...names, ASKER].map((n) => [n, asker]));
            const expected = [...names, ASKER].sort();
            const w = yield* world(harness, table);
            yield* w.ask();
            expect(yield* w.told(), "the answer is the loader's table, sorted").toEqual([expected]);
            yield* w.ask();
            expect(yield* w.told(), "asked again, it answers the same table").toEqual([expected, expected]);
          }),
        ),
      { timeout: 50 * 10_000, arbitrary: { seed: SEED, runs: 100 } },
    );
  });
