// next/, W2/W6. No driver imports: Node supplies the scoped database and lower services (0062).
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { Writer } from "../access/SessionManager.ts";
import { InputId } from "../Id.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, type Update, WatcherManager } from "./Entry.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Input } from "./Program.ts";
import { nth } from "./RepliesTest.ts";
import { ProgramRunner, Sent } from "./Runner.ts";
import { BRAIN, type Harness } from "./RunnerRepliesTest.ts";
import { Gone, Unreachable, WatcherManagerError } from "./WatcherManager.ts";

const NAME = "watch-counter:1";
const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("inc") });

const program = {
  name: "watch-counter",
  machine: Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: (saved) => [saved ?? { count: 0 }, []],
    update: { inc: (s) => [{ count: s.count + 1 }, []] },
  }),
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: () => null,
  inputs: { inc: Input.cases.write.make({ schema: Msg, description: "Increment", personOnly: false }) },
  outputs: {},
  writes: {},
  wake: () => null,
} as const;

const Step = Arbitrary.all({
  pick: Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  client: Arbitrary.schema(Schema.NonEmptyString.check(Schema.isMaxLength(240))),
});

const Walk = Arbitrary.array(Step, { minLength: 3, maxLength: 12 });
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
const owner = Writer.cases.person.make({ key: "SHA256:fixture", for: "person-fixture" });

const meta = {
  by: BRAIN,
  for: "brain",
  sentAt: "2026-11-12T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE.traceId,
  build: "test",
};

type Step = typeof Step extends Arbitrary.Arbitrary<infer A> ? A : never;

const walk = Effect.fnUntraced(function* (harness: Harness, steps: ReadonlyArray<Step>, gaps: boolean) {
  const files = yield* harness.files;
  let scope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void));
  // Scope.make is itself a handle: every replacement is also acquired in the enclosing scope.
  const frames: Array<{ client: string; update: Update }> = [];
  const routes = new Set<string>();
  const unknown = new Set<string>();
  const attempted: Array<string> = [];
  let booted = false;
  let pos = 0;
  let serial = 0;
  const expected = new Map<string, { pos: number; count: number }>();
  const connect = Effect.fnUntraced(function* () {
    const sql = yield* files("inbox").pipe(Scope.provide(scope));
    const manager = yield* files("manager").pipe(Scope.provide(scope));
    const coordination = yield* Layer.build(harness.services(sql, manager)).pipe(Scope.provide(scope));
    const processes = Context.get(coordination, ProcessManager);
    const mailbox = Context.get(coordination, Mailbox);

    if (!booted) {
      yield* processes
        .start(
          Start.cases.first.make({ id: "boot-watch", name: NAME, code: { program: program.name, hash: "test" } }),
          meta,
        )
        .pipe(Effect.orDie);
      booted = true;
    }

    const live = yield* processes.status(NAME).pipe(Effect.orDie);
    const dependencies = Layer.mergeAll(
      ProgramLoader.layer({ [program.name]: program }, {}),
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
      Layer.succeed(WatcherManager, {
        publish: (client, update) =>
          Effect.suspend(() => {
            attempted.push(client);

            if (!routes.has(client)) {
              return Effect.fail(new WatcherManagerError({ reason: new Gone({ cause: null }) }));
            }

            if (unknown.has(client)) {
              return Effect.fail(new WatcherManagerError({ reason: new Unreachable({ cause: null }) }));
            }

            frames.push({ client, update });
            return Effect.void;
          }),
      }),
      Layer.succeed(Alarm, { set: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
    ).pipe(Layer.provideMerge(Layer.succeedContext(coordination)));
    const context = yield* Layer.build(
      ProgramRunner.layer(
        { id: live.state.process, name: NAME, program: program.name, build: "test", owner },
        { recovery: { sql, name: NAME, capacity: 1024 ** 3 } },
      ).pipe(Layer.provide(dependencies)),
    ).pipe(Scope.provide(scope));
    return { runner: Context.get(context, ProgramRunner), mailbox, sql };
  });
  let live = yield* connect();
  const rebuild = Effect.fnUntraced(function* () {
    yield* Scope.close(scope, Exit.void);
    scope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void));
    live = yield* connect();
  });
  const open = Effect.fnUntraced(function* (client: string) {
    routes.add(client);
    const view = yield* live.runner.open(client);
    expect(view).toMatchObject({ rev: pos, view: { count: pos } });
    expected.set(client, { pos, count: pos });
  });
  const send = Effect.fnUntraced(function* () {
    frames.length = 0;
    attempted.length = 0;
    const incoming: Incoming = {
      id: `letter-${serial++}`,
      envelope: {
        id: InputId.make("input_0000000000e008000000000001"),
        by: owner,
        arrivedAt: 0,
        input: { type: "inc" },
      },
      sentAt: meta.sentAt,
      seen: 0,
      span: TRACE,
    };
    const answer = yield* live.runner.msg(incoming);
    pos++;
    expect(answer).toEqual(Sent.cases.accepted.make({ rev: answer._tag === "accepted" ? answer.rev : -1, pos }));
    const recipients = [...expected.keys()].filter((c) => routes.has(c) && !unknown.has(c));
    expect(frames.map((f) => f.client).sort()).toEqual(recipients.sort());

    for (const { client, update } of frames) {
      expect(update.type).toBe("patch");

      if (update.type !== "patch") {
        continue;
      }

      const before = expected.get(client) ?? { pos: 0, count: 0 };
      expect(update.base).toBe(pos - 1);
      expect(update.rev).toBe(pos);
      // This program has one scalar field; apply the RFC 6902 operation independently.
      let count = before.count;

      for (const op of update.patch) {
        expect(op.path).toBe("/count");
        expect(op.op).toBe("replace");

        if (op.op !== "remove") {
          count = Number(op.value);
        }
      }

      expect(count).toBe(pos);
      expected.set(client, { pos, count });
    }

    for (const client of [...expected.keys()]) {
      if (!routes.has(client)) {
        expected.delete(client);
      }
    }
  });
  // Required prefix: two pre-sleep watchers, one route removed while all Layers are closed.
  const first = `${nth(steps, 0).client}:a`,
    departed = `${nth(steps, 0).client}:b`;
  yield* open(first);
  yield* open(departed);
  yield* Scope.close(scope, Exit.void);
  routes.delete(departed);
  yield* rebuild();
  yield* send();
  yield* rebuild();
  yield* send();
  expect(attempted).not.toContain(departed);

  for (const [i, step] of steps.entries()) {
    const held = [...expected.keys()];
    const client = held[step.pick % held.length] ?? first;

    if (step.pick % 3 === 0) {
      yield* open(`${step.client}:${i}`);
    }

    if (step.pick % 3 === 1) {
      yield* rebuild();
    }

    if (gaps) {
      for (let gap = 0; gap <= step.pick % 4; gap++) {
        yield* live.mailbox.send("unrelated:1", `gap-${i}-${gap}`, { type: "other" }, meta).pipe(Effect.orDie);
      }

      yield* rebuild();
    }

    if (step.pick % 3 === 2) {
      unknown.add(client);
    }

    yield* send();
    unknown.clear();

    // Recover the client's view after an unknown delivery before the next comparison.
    if (step.pick % 3 === 2) {
      yield* open(client);
    }
  }
});

export const suite = (harness: Harness) =>
  describe("runner watchers across sleep, next/", () => {
    it.live.prop(
      "W2: all Layers and SQL connections can be discarded without losing live watchers",
      [Walk],
      ([steps]) => Effect.scoped(walk(harness, steps, false)),
      { timeout: 50 * 10_000, arbitrary: { seed: 119120, runs: 50 } },
    );
    it.live.prop(
      "W6: unrelated ledger writes never become patch positions",
      [Walk],
      ([steps]) => Effect.scoped(walk(harness, steps, true)),
      { timeout: 50 * 10_000, arbitrary: { seed: 119120, runs: 50 } },
    );
  });
