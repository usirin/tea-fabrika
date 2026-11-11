// Mail delivery over program mail and wakeups, next/ (P41 slice 1). Both steps repeat safely: the
// receipt is saved once per command, and a wake only schedules. `queued` comes only after both, so
// a lost wake leaves the Send dispatched and its retry finds the same receipt.
import { Effect, Layer } from "effect";
import { ProgramMail } from "../processes/ProgramMail.ts";
import { MailDelivery, MailDeliveryError, type Mail } from "./MailDelivery.ts";
import { MailWakeups } from "./MailWakeups.ts";
import { Queued } from "./Send.ts";

export const layer: Layer.Layer<MailDelivery, never, ProgramMail | MailWakeups> = Layer.effect(
  MailDelivery,
  Effect.gen(function* () {
    const mail = yield* ProgramMail;
    const wakeups = yield* MailWakeups;
    return MailDelivery.of({
      send: Effect.fn("mail_delivery.send")(
        function* (sent: Mail) {
          const receipt = yield* mail.deliver(sent);
          yield* wakeups.wake(receipt.to.name);
          return Queued.make({ id: receipt.id });
        },
        Effect.mapError((error) => new MailDeliveryError({ reason: error.reason, cause: error })),
      ),
    });
  }),
);
