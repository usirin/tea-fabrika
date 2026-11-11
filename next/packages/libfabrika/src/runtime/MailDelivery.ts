// Mail delivery, next/ (P41 slice 1): the contract only (0095). The runner hands it a saved Send
// with the sender the host bound; `MailDeliveryLive.layer` saves the letter, then schedules its
// recipient. A refusal is the Send's answer; `storage` and `unavailable` leave it to be tried again.
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import { type Delivery, MailRefusal } from "../processes/ProgramMail.ts";
import { type Queued } from "./Send.ts";

export class MailDeliveryError extends Schema.TaggedError<MailDeliveryError>()("MailDeliveryError", {
  reason: Schema.Union([MailRefusal, Schema.Literals(["storage", "unavailable"])]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** One saved Send: its command ID, the life that runs it, its operands and the writer's own facts. */
export type Mail = Delivery;

export class MailDelivery extends Context.Service<
  MailDelivery,
  { readonly send: (mail: Mail) => Effect.Effect<typeof Queued.Type, MailDeliveryError> }
>()("@kampus/libfabrika/runtime/MailDelivery") {}
