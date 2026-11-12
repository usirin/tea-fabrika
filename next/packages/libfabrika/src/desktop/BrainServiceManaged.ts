/**
 * Effect driver for the single brain lifecycle machine.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Id from "../Id.ts";
import * as Declarations from "../settings/Declarations.ts";
import type * as Snapshot from "../settings/Snapshot.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import type { Status } from "./BrainControl.ts";
import { BrainControl, type BrainControlError } from "./BrainControl.ts";
import * as BrainLife from "./BrainLife.ts";
import type { Children, Readiness } from "./BrainProbe.ts";
import { BrainProbe, type BrainProbeError } from "./BrainProbe.ts";
import { BrainService, BrainServiceError, Conflict, Operation, Timeout } from "./BrainService.ts";
import type { BrainSpec } from "./BrainSpec.ts";

const operation = (action: Operation["action"], cause: unknown) =>
  new BrainServiceError({ reason: new Operation({ action, cause: Redacted.make(cause) }) });

const pending = (model: typeof BrainLife.Model.Type): boolean => "pending" in model;

const make = Effect.fnUntraced(function* (spec: BrainSpec, settings: Snapshot.Snapshot) {
  const control = yield* BrainControl;
  const probe = yield* BrainProbe;
  const sink = yield* SpanSink;
  const records = yield* RecordManager;
  const archive = yield* Archive;
  const ids = yield* Id.Generator;
  const timings = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      "desktop.brain-poll": Declarations.brainPoll.schema,
      "desktop.brain-start-timeout": Declarations.brainStartTimeout.schema,
      "desktop.brain-stop-timeout": Declarations.brainStopTimeout.schema,
      "desktop.brain-throttle": Declarations.brainThrottle.schema,
    }),
  )(settings.values).pipe(Effect.mapError((cause) => operation("inspect", cause)));
  const semaphore = yield* Semaphore.make(1);
  const life = BrainLife.machine({ spec, settings });
  let [model] = life.init(null, {});
  const settle = (msg: BrainLife.Msg) => {
    const [next, cmds] = applyCell(life, model, msg);
    model = next;
    return cmds;
  };
  const send = Effect.fnUntraced(function* (msg: BrainLife.Msg) {
    const next = yield* ids.next(Id.Cmd).pipe(Effect.mapError((cause) => operation("inspect", cause)));
    return settle({ ...msg, next });
  });
  const translate = (cause: BrainControlError | BrainProbeError) =>
    cause.reason._tag === "Conflict" || cause.reason._tag === "Foreign" ? "Conflict" : "Operation";
  const Failed = Schema.TaggedUnion({ Conflict: {}, Operation: {} });
  const command = Effect.fnUntraced(function* (cmd: BrainLife.Command, action: "up" | "stop") {
    const began = yield* Clock.currentTimeMillis;
    yield* Effect.annotateCurrentSpan({
      "fab.action": action,
      "fab.build": spec.build,
      "fab.settings": settings.hash,
      "fab.cmd": cmd.id,
      "fab.command": cmd.type,
      "fab.sentAt": String(began),
    });
    const work: Effect.Effect<
      void | typeof Status.Type | typeof Readiness.Type | typeof Children.Type,
      BrainControlError | BrainProbeError
    > = cmd.type === "ready" ? probe.ready : cmd.type === "cleanup" ? probe.cleanup : control[cmd.type];
    const answer = yield* work.pipe(Effect.result);
    const at = yield* Clock.currentTimeMillis;
    yield* Effect.annotateCurrentSpan({
      "fab.elapsed": at - began,
      "fab.result": answer._tag === "Failure" ? answer.failure.reason._tag : "success",
    });

    if (answer._tag === "Failure") {
      if (answer.failure.reason._tag === "Command" && answer.failure.reason.code !== undefined) {
        yield* Effect.annotateCurrentSpan("fab.native.code", answer.failure.reason.code);
      }

      const error = translate(answer.failure);
      return {
        cause: Redacted.make(answer.failure),
        cmds: yield* send({ type: `${cmd.type}_err`, cmd, error: Failed.cases[error].make({}), at } as BrainLife.Msg),
      };
    }

    return {
      cause: null,
      cmds: yield* send({ type: `${cmd.type}_ok`, cmd, value: answer.success ?? null, at } as BrainLife.Msg),
    };
  }, Effect.withSpan("BrainService.command"));
  const flush = sink.flush.pipe(
    Effect.provideService(RecordManager, records),
    Effect.provideService(Archive, archive),
    Effect.mapError((cause) => operation("cleanup", cause)),
  );
  const perform = (action: "up" | "stop") =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const began = yield* Clock.currentTimeMillis;
        let cmds = yield* send({ type: action, at: began });
        const first = cmds[0];
        const deadline =
          began + timings[action === "up" ? "desktop.brain-start-timeout" : "desktop.brain-stop-timeout"];
        const drive = Effect.gen(function* () {
          let cause: unknown = Redacted.make("lifecycle refused");

          while (pending(model)) {
            const next = cmds[0];

            if (next === undefined) {
              yield* Effect.sleep(timings["desktop.brain-poll"]);
              cmds = yield* send({ type: "tick", at: yield* Clock.currentTimeMillis });
            } else {
              const answer = yield* command(next, action);
              cause = answer.cause ?? cause;
              cmds = answer.cmds;
            }

            yield* Effect.annotateCurrentSpan("fab.confirmation", model._tag === "stopped" ? "removed" : model._tag);
          }

          if (model._tag === "failed_up" || model._tag === "failed_stop") {
            const reason =
              model.reason === "Timeout"
                ? new Timeout({ action, cause })
                : model.reason === "Conflict"
                  ? new Conflict({ cause })
                  : new Operation({
                      action:
                        model.command === "ready" ? "start" : model.command === "remove" ? "cleanup" : model.command,
                      cause,
                    });
            return yield* new BrainServiceError({ reason });
          }
        }).pipe(
          Effect.timeoutOption(deadline - began),
          Effect.flatMap((result) => {
            if (Option.isSome(result)) {
              return Effect.void;
            }

            settle({ type: "tick", at: deadline });
            return Effect.fail(
              new BrainServiceError({ reason: new Timeout({ action, cause: Redacted.make("deadline") }) }),
            );
          }),
        );
        const observed = Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({
            "fab.action": action,
            "fab.build": spec.build,
            "fab.settings": settings.hash,
            "fab.cmd": first?.id ?? "",
            "fab.sentAt": String(began),
          });
          const exit = yield* drive.pipe(Effect.exit);
          yield* Effect.annotateCurrentSpan({
            "fab.elapsed": (yield* Clock.currentTimeMillis) - began,
            "fab.result": Exit.isSuccess(exit)
              ? model._tag === "online"
                ? model.result
                : "stopped"
              : model._tag === "failed_up" || model._tag === "failed_stop"
                ? model.reason
                : "interrupted",
          });
          return yield* exit;
        }).pipe(Effect.withSpan(`BrainService.${action}`));
        const exit = yield* sink.batch(observed).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              settle({ type: "tick", at: deadline });
            }),
          ),
          Effect.exit,
        );
        yield* flush.pipe(
          Effect.timeoutOrElse({
            duration: Math.max(0, deadline - (yield* Clock.currentTimeMillis)),
            orElse: () => Effect.fail(operation("cleanup", "record delivery deadline")),
          }),
          Effect.catch((error) =>
            Effect.gen(function* () {
              const at = yield* Clock.currentTimeMillis;
              return yield* sink.batch(
                Effect.fail(error).pipe(
                  Effect.withSpan("BrainService.delivery", {
                    attributes: {
                      "fab.action": action,
                      "fab.build": spec.build,
                      "fab.settings": settings.hash,
                      "fab.cmd": first?.id ?? "",
                      "fab.sentAt": String(at),
                      "fab.result": "delivery_failed",
                      "fab.elapsed": at - began,
                      "fab.confirmation": model._tag === "stopped" ? "removed" : model._tag,
                    },
                  }),
                ),
              );
            }),
          ),
        );
        return yield* exit;
      }),
    );
  return BrainService.of({ up: perform("up").pipe(Effect.as({ url: spec.url })), stop: perform("stop") });
});

/**
 * Serializes complete operations and captures lower services once.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (spec: BrainSpec, settings: Snapshot.Snapshot) =>
  Layer.effect(BrainService, make(spec, settings)).pipe(Layer.provide(Id.Generator.layer));
