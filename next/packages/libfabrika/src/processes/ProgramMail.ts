/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
