// Program mail, next/ (Tier 1, P41 slice 1): one program's letter to another registered name. This
// file is the contract only (0095); `ProgramMailLedger.layer(...)` delivers it. A receipt means the
// letter is saved in the target's inbox, never that the target took or answered the request.
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { From } from "./Mailbox.ts";
import type { State } from "./Process.ts";

/** The host's closed grant: each source name reaches only the names listed for it. */
export type Grants = Readonly<Record<string, ReadonlyArray<string>>>;

/** Why a delivery is refused for good. Other clients decode these by name. */
export const MailRefusal = Schema.Literals([
  "no_name",
  "forbidden",
  "stale_sender",
  "bad_message",
  "id_reused",
  "quota",
]);

export class ProgramMailError extends Schema.TaggedError<ProgramMailError>()("ProgramMailError", {
  /** A refusal, or `storage`: the ledger failed, and the same delivery may be tried again. */
  reason: Schema.Union([MailRefusal, Schema.Literal("storage")]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** One send, as the host binds it: the dispatched command, and the life that executes it. */
export type Delivery = {
  readonly command: string;
  readonly source: { readonly name: string; readonly process: string };
  readonly to: string;
  readonly m: unknown;
  readonly from: From;
};

/** The accepted send, kept as it was first accepted. Its `id` is also the inbox letter's id. */
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

export class ProgramMail extends Context.Service<
  ProgramMail,
  { readonly deliver: (delivery: Delivery) => Effect.Effect<Receipt, ProgramMailError> }
>()("@kampus/libfabrika/processes/ProgramMail") {}
