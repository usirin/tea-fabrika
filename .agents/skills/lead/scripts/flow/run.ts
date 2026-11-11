// run.ts: run one flow end to end in this process, with no agent holding the loop (0064). Today's
// lead tooling, run on our own laptop; it is not product. Run it in the background and read the last
// line only: one JSON object with how the flow ended.
//
//   node .agents/skills/lead/scripts/flow/run.ts <flow-file> [--resume] [--lead] [--state <file>]
//
// The flow file is a small module that default-exports `Flow.make(...)` (./flows/ has the factories).
// The walk is in the module beside this one: the flow machine on tea's Effect engine, with the state
// file (default `BOXES/state/flow-<name>.json`) saved before each step starts and once it ends. A
// first run refuses a state file that exists; `--resume` goes on from one, and refuses a flow file
// that changed since. `--lead` says the lead session started this process: only then does a `lead`
// step run. The steps' runners are the landing table.
//
// Exit codes, as the lane chain's: 0 done, 20 parked on an ask, 30 stuck, 2 usage.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer, Option, Path, Runtime, Schema, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import * as Flow from "./Flow.ts";
import { runners as landing } from "./landing.ts";
import * as Runners from "./Runners.ts";
import { ending, runFlow, Usage } from "./walk.ts";

/** The flow parked on an ask: exit 20. */
export class Parked extends Schema.TaggedError<Parked>()("Parked", { reason: Schema.String }) {
  readonly [Runtime.errorExitCode] = 20;
}

/** The flow is stuck: exit 30. */
export class Stuck extends Schema.TaggedError<Stuck>()("Stuck", { reason: Schema.String }) {
  readonly [Runtime.errorExitCode] = 30;
}

/** BOXES from env.sh, as every lead script finds it. */
const boxes = Effect.fn("flow.boxes")(
  function* () {
    const path = yield* Path.Path;
    const env = path.join(import.meta.dirname, "..", "env.sh");
    const handle = yield* ChildProcess.make("sh", ["-c", '. "$0" && printf "%s" "$BOXES"', env]);
    const [out, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode], {
      concurrency: 2,
    });
    return Number(code) === 0 && out !== "" ? out : yield* new Usage({ reason: "env.sh gave no BOXES" });
  },
  Effect.scoped,
  Effect.catchTag("PlatformError", () => Effect.fail(new Usage({ reason: "env.sh could not run" }))),
);

/** The flow file's default export, read as a Flow. */
const load = Effect.fn("flow.load")(function* (file: string) {
  const path = yield* Path.Path;
  const url = yield* path
    .toFileUrl(path.resolve(file))
    .pipe(Effect.mapError(() => new Usage({ reason: `${file} is no path` })));
  const unloadable = (e: unknown) => new Usage({ reason: `${file} does not load: ${String(e)}` });
  // oxlint-disable-next-line fabrika/no-promises -- edge: Node loads a module by its path only through import()
  const module = yield* Effect.tryPromise({ try: () => import(url.href), catch: unloadable });
  return yield* Schema.decodeUnknownEffect(Flow.Flow)(module.default).pipe(
    Effect.mapError((e) => new Usage({ reason: `${file}'s default export is no Flow: ${e.message}` })),
  );
});

const flowCommand = Command.make(
  "flow",
  {
    file: Argument.String("flow-file"),
    resume: Flag.Boolean("resume").pipe(Flag.withDefault(false)),
    lead: Flag.Boolean("lead").pipe(Flag.withDefault(false)),
    state: Flag.String("state").pipe(Flag.optional),
  },
  ({ file, resume, lead, state }) =>
    Effect.gen(function* () {
      const flow = yield* load(file);
      const path = yield* Path.Path;
      const saved = Option.isSome(state) ? state.value : path.join(yield* boxes(), "state", `flow-${flow.name}.json`);
      const model = yield* runFlow(flow, { state: saved, resume, lead }).pipe(
        Effect.catchTag(["StoreFailed", "SubFailed"], (e) =>
          Effect.fail(new Stuck({ reason: `${e._tag}: ${String(e.cause)}` })),
        ),
      );
      const end = ending(model);
      const spent = model.history.reduce((sum, a) => sum + (a.spent?.usd ?? 0), 0);
      yield* Console.log(
        JSON.stringify({ ...end, flow: flow.name, state: saved, attempts: model.history.length, usd: spent }),
      );

      if (end.outcome === "ask") {
        return yield* new Parked({ reason: end.reason });
      }

      if (end.outcome === "stuck") {
        return yield* new Stuck({ reason: end.reason });
      }
    }).pipe(
      Effect.tapError((e) =>
        e._tag === "Usage" ? Console.log(JSON.stringify({ outcome: "usage", reason: e.reason, exit: 2 })) : Effect.void,
      ),
    ),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(flowCommand, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.provide(Layer.provideMerge(Runners.layer(landing), NodeServices.layer)),
    ),
    { disableErrorReporting: true },
  );
}
