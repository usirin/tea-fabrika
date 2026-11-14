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
 * Program mail: one program's letter to another registered name. A receipt means the letter is
 * saved in the target's inbox, never that the target took or answered the request. This file holds
 * the contract only (0095); `ProgramMailLedger.layer(...)` delivers it.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { From } from "./Mailbox.ts";
import type { State } from "./Process.ts";

/**
 * The host's closed grant: each source name reaches only the names listed for it.
 *
 * @stability unstable
 * @category models
 */
export type Grants = Readonly<Record<string, ReadonlyArray<string>>>;

/**
 * Schema for why a delivery is refused for good. Other clients decode these by name.
 *
 * @stability unstable
 * @category schemas
 */
export const MailRefusal = Schema.Literals(["no_name", "forbidden", "stale_sender", "bad_message", "id_reused"]);

/**
 * Error for a letter between programs that was refused or could not be saved.
 *
 * **Details**
 *
 * A refusal is final for that delivery, and nothing was written:
 *
 * - `no_name`: the target name was not found.
 * - `forbidden`: no grant lets the source reach the target.
 * - `stale_sender`: the sending process is no longer its name's live process.
 * - `bad_message`: the message is not JSON, or the ledger refused its line.
 * - `id_reused`: the command already sent a different letter.
 *
 * `storage` means the ledger failed, and the same delivery may be tried again.
 *
 * @stability unstable
 * @category errors
 */
export class ProgramMailError extends Schema.TaggedError<ProgramMailError>()("ProgramMailError", {
  /** A refusal, or `storage`: the ledger failed, and the same delivery may be tried again. */
  reason: Schema.Union([MailRefusal, Schema.Literal("storage")]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * One send, as the host binds it: the dispatched command, and the life that executes it.
 *
 * @stability unstable
 * @category models
 */
export type Delivery = {
  readonly command: string;
  readonly source: { readonly name: string; readonly process: string };
  readonly to: string;
  readonly m: unknown;
  readonly from: From;
};

/**
 * The accepted send, kept as it was first accepted. Its `id` is also the inbox letter's id.
 *
 * @stability unstable
 * @category models
 */
export type Receipt = {
  readonly id: string;
  readonly command: string;
  readonly source: { readonly name: string; readonly process: string };
  /** The target, and its lifecycle state when the letter was accepted. */
  readonly to: { readonly name: string; readonly state: typeof State.Type };
  readonly m: Schema.Json;
  /** The business request's `ref`, when the message carries one. */
  readonly ref: string | null;
  /** The host grant used: `source` may reach `to`. */
  readonly grant: { readonly source: string; readonly to: string };
  readonly from: From;
  /** The referee's clock and the letter's committed place. */
  readonly arrivedAt: number;
  readonly rev: number;
  readonly pos: number;
};

/**
 * Service that delivers one program's letter to another registered name.
 *
 * **Details**
 *
 * `deliver` answers a `Receipt` once the letter is saved in the target's inbox. A repeat of the
 * same delivery answers the first receipt and saves nothing more, so a sender that heard no answer
 * can send again.
 *
 * **Gotchas**
 *
 * A receipt means saved, never that the target took or answered the letter. A send never registers
 * or starts a name.
 *
 * @stability unstable
 * @category services
 */
export class ProgramMail extends Context.Service<
  ProgramMail,
  { readonly deliver: (delivery: Delivery) => Effect.Effect<Receipt, ProgramMailError> }
>()("@kampus/libfabrika/processes/ProgramMail") {}
