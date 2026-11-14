/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * Mail delivery: how the runner gets a program's Send to its recipient. The runner hands over a
 * saved Send with the sender the host bound; `MailDeliveryLive.layer` saves the letter, then
 * schedules its recipient. This file holds the contract only (0095).
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import { type Delivery, MailRefusal } from "../processes/ProgramMail.ts";
import { type Queued } from "./Send.ts";

/**
 * Error for a Send that was refused, or that could not be delivered yet.
 *
 * **Details**
 *
 * A `MailRefusal` reason is final: the runner gives it to the program as the Send's answer.
 * `storage` (the letter was not saved) and `unavailable` (its recipient was not scheduled) answer
 * nothing: the Send stays dispatched, and the runner tries it again.
 *
 * @stability unstable
 * @category errors
 */
export class MailDeliveryError extends Schema.TaggedError<MailDeliveryError>()("MailDeliveryError", {
  reason: Schema.Union([MailRefusal, Schema.Literals(["storage", "unavailable"])]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * One saved Send: its command ID, the life that runs it, its operands and the writer's own facts.
 *
 * @stability unstable
 * @category models
 */
export type Mail = Delivery;

/**
 * Service that delivers one saved Send: it saves the letter in the recipient's inbox, then
 * schedules the recipient to read it.
 *
 * **Details**
 *
 * `send` answers `queued`, with the saved letter's id, only after both steps. `queued` never means
 * the recipient took or answered the letter.
 *
 * @stability unstable
 * @category services
 */
export class MailDelivery extends Context.Service<
  MailDelivery,
  { readonly send: (mail: Mail) => Effect.Effect<typeof Queued.Type, MailDeliveryError> }
>()("@kampus/libfabrika/runtime/MailDelivery") {}
