// Starting a child, next/ (Tier 1, P42 slice 1): OTP's `whereis` then `supervisor:start_child`, in
// one step, for every caller. This file is the contract only (0095); `ChildrenLedger.layer(...)`
// starts on the ledger. Only a fresh start saves anything: its `started` line and its first letter.
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
export type Child = typeof Child.Type;

/** OTP's answers: `{ok, Pid}`, `{error, {already_started, Pid}}` and `{error, already_present}`. */
export const Started = Schema.TaggedUnion({
  started: { process: ProcessId, name: Text, rev: Rev },
  already_started: { process: ProcessId, name: Text },
  /** Known, not running: its current, newest life ended or went down. */
  already_present: { process: ProcessId, name: Text },
});
export type Started = typeof Started.Type;

export class ChildrenError extends Schema.TaggedError<ChildrenError>()("ChildrenError", {
  /** A refusal, which writes nothing, or `storage`: the ledger failed, and the start may be asked again. */
  reason: Schema.Literals(["forbidden", "stale_sender", "bad_name", "bad_input", "id_reused", "name_taken", "storage"]),
  /** Only `storage` carries one, for the library caller; nothing renders it into an output. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class Children extends Context.Service<
  Children,
  { readonly start: (child: Child, from: From) => Effect.Effect<Started, ChildrenError> }
>()("@kampus/libfabrika/Children") {}
