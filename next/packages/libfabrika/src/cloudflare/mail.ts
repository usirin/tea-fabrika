import { Effect, Layer, Schema } from "effect";
import { ProgramMail, ProgramMailError } from "../processes/ProgramMail.ts";
import type { MailDelivery } from "../runtime/MailDelivery.ts";
import * as MailDeliveryLive from "../runtime/MailDeliveryLive.ts";
import { MailWakeups, MailWakeupsError } from "../runtime/MailWakeups.ts";
import { MailReplies } from "./bindings.ts";
import { ProcessClient, ProjectClient } from "./platform.ts";
import { type Env, processStub, projectStub, rpc } from "./runtime.ts";

const fromMailReply = Effect.fnUntraced(function* (reply: unknown) {
  const checked = yield* Schema.decodeUnknownEffect(MailReplies)(reply).pipe(
    // The decode error shows the reply, which may hold mail; the reason alone is kept.
    Effect.mapError(() => new ProgramMailError({ reason: "storage" })),
  );

  if (checked._tag === "refused") {
    return yield* new ProgramMailError({ reason: checked.reason });
  }

  return checked.receipt;
});

/** Save mail through the Project, then await the target object's saved alarm. */
export const mailLayer = (env: Env, project: string): Layer.Layer<MailDelivery> =>
  MailDeliveryLive.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProgramMail, {
          deliver: Effect.fn("process.mail")(function* (delivery) {
            const span = yield* Effect.currentSpan.pipe(Effect.orDie);
            // RPC failures can echo mail; keep only the reason before the RPC span records them.
            const reply = yield* rpc(
              ProjectClient.make(projectStub(env, project))
                .mail(delivery, {
                  traceId: span.traceId,
                  spanId: span.spanId,
                })
                .pipe(Effect.mapError(() => new ProgramMailError({ reason: "storage" }))),
            );
            return yield* fromMailReply(reply);
          }),
        }),
        Layer.succeed(MailWakeups, {
          wake: Effect.fnUntraced(function* (name) {
            const span = yield* Effect.currentSpan.pipe(Effect.orDie);
            yield* rpc(
              ProcessClient.make(processStub(env, project, name))
                .mailed({
                  traceId: span.traceId,
                  spanId: span.spanId,
                })
                .pipe(Effect.mapError(() => new MailWakeupsError({ reason: "unavailable" }))),
            );
          }),
        }),
      ),
    ),
  );
