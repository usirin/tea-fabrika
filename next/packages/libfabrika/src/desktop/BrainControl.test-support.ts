// P19 next/. Only outside facts live here. Every policy decision stays in BrainServiceManaged.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { Deferred, Effect, Layer, Schema } from "effect";
import { BrainControl, BrainControlError, Command, Status } from "./BrainControl.ts";
import { BrainProbe, BrainProbeError, Unreachable, Foreign, Readiness, Children, Cleanup } from "./BrainProbe.ts";
import { BrainSpec } from "./BrainSpec.ts";

export const spec = Schema.decodeUnknownSync(BrainSpec)({
  home: "/test/p19/home",
  executable: "/test/p19/Electron",
  args: ["/test/p19/brain.mjs"],
  url: "http://127.0.0.1:18787",
  build: "p19-test-build",
});

export const absent = Status.cases.absent.make({});

export const loaded = (value: BrainSpec = spec, pid: number | null = 81) =>
  Status.cases.loaded.make({
    executable: value.executable,
    args: value.args,
    home: value.home,
    configuration: value.build,
    pid,
  });

export const foreign = loaded(Schema.decodeUnknownSync(BrainSpec)({ ...spec, args: [...spec.args, "foreign"] }));

const World = Schema.Struct({
  job: Status,
  file: Schema.Literals(["absent", "matching", "foreign"]),
  listener: Schema.Literals(["waiting", "ready", "foreign"]),
  children: Schema.Literals(["alive", "gone"]),
});
type World = typeof World.Type;
const Msg = Schema.Struct({ type: Schema.Literal("observe"), world: World });

const facts = Machine.make({
  model: World,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? { job: absent, file: "absent", listener: "waiting", children: "gone" }, []],
  update: { observe: (_state, msg) => [msg.world, []] },
});

type Action = "inspect" | "install" | "start" | "stop" | "remove" | "ready" | "cleanup";

type Call = {
  readonly action: Action;
  readonly release: Effect.Effect<void>;
  readonly fail: (secret: string) => Effect.Effect<void>;
};

export const make = Effect.fn("BrainControlTest.make")(function* (initial: Partial<World> = {}) {
  let [world] = facts.init(null, {});
  const observe = (next: Partial<World>) =>
    Effect.sync(() => {
      [world] = applyCell(facts, world, { type: "observe", world: { ...world, ...next } });
    });
  yield* observe(initial);
  const calls: Array<Action> = [];
  const pending: Array<Call> = [];
  const invoke = Effect.fnUntraced(function* (action: Action) {
    const gate = yield* Deferred.make<void, BrainControlError>();
    yield* Effect.sync(() => {
      calls.push(action);
      pending.push({
        action,
        release: Deferred.succeed(gate, undefined).pipe(Effect.asVoid),
        fail: (secret: string) =>
          Deferred.fail(gate, new BrainControlError({ reason: new Command({ cause: secret }) })).pipe(Effect.asVoid),
      });
    });
    yield* Deferred.await(gate);
  });
  const control = Layer.succeed(BrainControl, {
    inspect: invoke("inspect").pipe(Effect.map(() => world.job)),
    install: invoke("install").pipe(Effect.andThen(observe({ file: "matching" }))),
    start: invoke("start"),
    stop: invoke("stop"),
    remove: invoke("remove").pipe(Effect.andThen(observe({ file: "absent" }))),
  });
  const probe = Layer.succeed(BrainProbe, {
    ready: invoke("ready").pipe(
      Effect.mapError((cause) => new BrainProbeError({ reason: new Unreachable({ cause }) })),
      Effect.andThen(() =>
        world.listener === "foreign"
          ? Effect.fail(new BrainProbeError({ reason: new Foreign({ cause: "foreign-listener" }) }))
          : Effect.void,
      ),
      Effect.map(() =>
        world.listener === "ready" ? Readiness.cases.ready.make({}) : Readiness.cases.waiting.make({}),
      ),
    ),
    cleanup: invoke("cleanup").pipe(
      Effect.mapError((cause) => new BrainProbeError({ reason: new Cleanup({ cause }) })),
      Effect.map(() => (world.children === "gone" ? Children.cases.gone.make({}) : Children.cases.waiting.make({}))),
    ),
  });
  return {
    control,
    probe,
    calls,
    pending,
    observe,
    read: Effect.sync(() => world),
    take: Effect.sync(() => pending.shift()),
  };
});
