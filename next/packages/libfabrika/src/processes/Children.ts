/**
 * The contract for starting a child process: OTP's `whereis` then `supervisor:start_child`, in one
 * step, for every caller. Only a fresh start saves anything: the child's `started` line and its
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

/** The most bytes a first letter's row may hold: the ledger's row limit. */
export const INPUT_BYTES = ROW_BYTES;

/** A host right, by program: a process of `source` may start a process of `to`. Read as a set. */
export const StartGrant = Schema.Struct({ source: Text, to: Text });

/** One start. A retry of a saved `id` answers that start's `started`, whatever happened since. */
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
});
/**
 * One request to start a child, as `Child` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Child = typeof Child.Type;

/** OTP's answers: `{ok, Pid}`, `{error, {already_started, Pid}}` and `{error, already_present}`. */
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
 * Error for a child start that was refused or could not be saved.
 *
 * **Details**
 *
 * Every reason but `storage` is a refusal, and a refusal writes nothing:
 *
 * - `forbidden`: the host gave the requester's program no right to start the child's program.
 * - `stale_sender`: the requester is no longer a live process.
 * - `bad_name`: the child's name is not a process name.
 * - `bad_input`: the request did not decode, or its first letter is over `INPUT_BYTES`.
 * - `id_reused`: the start id was first used with another name, program, requester or input.
 * - `name_taken`: the name belongs to another program.
 *
 * `storage` means the ledger failed. The caller cannot tell whether the start was saved, and may
 * ask again with the same `id`: a saved start answers its `started`.
 *
 * @stability unstable
 * @category errors
 */
export class ChildrenError extends Schema.TaggedError<ChildrenError>()("ChildrenError", {
  /** A refusal, which writes nothing, or `storage`: the ledger failed, and the start may be asked again. */
  reason: Schema.Literals(["forbidden", "stale_sender", "bad_name", "bad_input", "id_reused", "name_taken", "storage"]),
  /** Only `storage` carries one, for the library caller; nothing renders it into an output. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Service that starts a child process for a requester, under a registered name.
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
 * **Gotchas**
 *
 * A child is not linked to its requester: it keeps running when the requester ends.
 *
 * @stability unstable
 * @category services
 */
export class Children extends Context.Service<
  Children,
  { readonly start: (child: Child, from: From) => Effect.Effect<Started, ChildrenError> }
>()("@kampus/libfabrika/processes/Children") {}
