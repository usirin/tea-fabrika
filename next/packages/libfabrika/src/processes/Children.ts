/**
 * The contract for starting a child process: OTP's `whereis` then `supervisor:start_child`, in one
 * step, for every caller, and for stopping one, OTP's `terminate_child`. Only a fresh start saves anything: the child's `started` line and its
 * first letter. This file holds the contract only (0095); `ChildrenLedger.layer(...)` starts on the
 * ledger.
 *
 * @stability unstable
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import { ROW_BYTES } from "../ledger/Log.ts";
import { ProcessId } from "../ProcessId.ts";
import { Rev } from "../Rev.ts";
import { Code, Recipient, Text } from "./internal/processTable.ts";
import type { From } from "./Mailbox.ts";
import { ProcessName } from "./Process.ts";

/**
 * The most bytes a first letter's row may hold: the ledger's row limit.
 *
 * @stability unstable
 * @category constants
 */
export const INPUT_BYTES = ROW_BYTES;

/**
 * Schema for a host right, by program: a process of `source` may start a process of `to`. Read as
 * a set.
 *
 * @stability unstable
 * @category schemas
 */
export const StartGrant = Schema.Struct({ source: Text, to: Text });

/**
 * Schema for one request to start a child under a registered name. A retry of a saved `id`
 * answers that start's `started`, whatever happened since.
 *
 * @stability unstable
 * @category schemas
 */
export const Child = Schema.Struct({
  id: Text,
  /** The whereis key: the child's registered name. */
  name: ProcessName,
  /** The program and its hash, as the caller's loader resolved them. */
  code: Code,
  /** The process that asked; the host binds it, never the program. */
  requester: Recipient.cases.process,
  /** The child's first letter, written in the start's own turn. */
  input: Schema.optionalKey(Schema.Json),
  /**
   * The verdict of 0170's check on the member whose letter caused the start, which the host binds,
   * never the program. Left out when no member's letter is behind the start: the host's grants
   * decide then.
   */
  permitted: Schema.optionalKey(Schema.Boolean),
});
/**
 * One request to start a child, as `Child` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Child = typeof Child.Type;

/**
 * Schema for the answer to a start, in OTP's three answers: `{ok, Pid}`,
 * `{error, {already_started, Pid}}` and `{error, already_present}`.
 *
 * @stability unstable
 * @category schemas
 */
export const Started = Schema.TaggedUnion({
  started: { process: ProcessId, name: Text, rev: Rev },
  already_started: { process: ProcessId, name: Text },
  /** Known, not running: its current, newest life ended or went down. */
  already_present: { process: ProcessId, name: Text },
});
/**
 * The answer to one start, as `Started` decodes it: a fresh start, a name whose process is already
 * live, or a name that is known but not running.
 *
 * @stability unstable
 * @category models
 */
export type Started = typeof Started.Type;

/**
 * One request to stop a child: its registered `name`, and the process that asks, which the host
 * binds, never the program.
 *
 * @stability unstable
 * @category models
 */
export type ChildStop = {
  readonly name: string;
  readonly requester: typeof Recipient.cases.process.Type;
};

/**
 * Error for a child start or stop that was refused or could not be saved.
 *
 * **Details**
 *
 * Every reason but `storage` is a refusal, and a refusal writes nothing:
 *
 * - `forbidden`: the member whose letter caused the start may not start the child's program, or,
 *   with no member's letter behind it, the host gave the requester's program no right to.
 * - `stale_sender`: the requester is no longer a live process.
 * - `bad_name`: the child's name is not a process name.
 * - `bad_input`: the request did not decode, or its first letter is over `INPUT_BYTES`.
 * - `id_reused`: the start id was first used with another name, program, requester or input.
 * - `name_taken`: the name belongs to another program.
 * - `not_child`: a stop's name is not a child the requester's name started.
 * - `noproc`: a stop's child has already ended.
 *
 * `storage` means the ledger failed. The caller cannot tell whether the start was saved, and may
 * ask again with the same `id`: a saved start answers its `started`.
 *
 * @stability unstable
 * @category errors
 */
export class ChildrenError extends Schema.TaggedError<ChildrenError>()("ChildrenError", {
  /** A refusal, which writes nothing, or `storage`: the ledger failed, and the start may be asked again. */
  reason: Schema.Literals([
    "forbidden",
    "stale_sender",
    "bad_name",
    "bad_input",
    "id_reused",
    "name_taken",
    "not_child",
    "noproc",
    "storage",
  ]),
  /** Only `storage` carries one, for the library caller; nothing renders it into an output. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that starts a child process for a requester, under a registered name, and stops one.
 *
 * **Details**
 *
 * `start` looks the name up and starts it only when it is free, as one step, so two callers that
 * ask for one name never start two processes. It answers `started` for a fresh start,
 * `already_started` when the name's process is live, and `already_present` when the name is known
 * but its newest process ended or went down. A retry of a saved `id` answers that start's
 * `started` again, whatever happened since. `from` is what the requester says about itself, and
 * the child's first letter is written under it.
 *
 * `stop` ends a child the requester's name started, with `shutdown`, and writes a `DOWN` to each
 * of its watchers. Any other name is `not_child`, and an ended child is `noproc`.
 *
 * **Gotchas**
 *
 * A child is not linked to its requester: it keeps running when the requester ends. `stop` is left
 * out where the wiring has no way to stop a child yet, and a `stop_child` there is answered
 * `bad_cmd`.
 *
 * @stability unstable
 * @category services
 */
export class Children extends Context.Service<
  Children,
  {
    readonly start: (child: Child, from: From) => Effect.Effect<Started, ChildrenError>;
    readonly stop?: (stop: ChildStop, from: From) => Effect.Effect<void, ChildrenError>;
  }
>()("@kampus/libfabrika/processes/Children") {}
