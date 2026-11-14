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
// Coordination's public names: the mailbox, a process's start, and who belongs (Tier 1, P9). It
// passes the ledger's error and answers on, so a layer above never imports `./data`.
export { ClientManager, Founder, Written } from "../access/ClientManager.ts";
export { appendAdmitted } from "../access/Authorization.ts";
export { Connections } from "../presence/Connections.ts";
export { type From, type History, type Letter, Mailbox, RunnerMail } from "../processes/Mailbox.ts";
export { Checkpoint, Placed, ProcessStore, RuntimeRecord } from "../runtime/ProcessStore.ts";
export { RecoveryStore } from "../runtime/RecoveryStore.ts";
export {
  Add,
  AddSaw,
  Adds,
  admitted,
  Grant,
  MemberEvent,
  type Access,
  Revoke,
  Saw,
  Signed,
  Took,
  Reason,
} from "../access/Access.ts";
export { foldAccess } from "../access/AccessFold.ts";
export { CoordinationLayer, ProcessManager } from "../processes/ProcessManager.ts";
export { ProcessIdGenerator } from "../processes/ProcessIdGenerator.ts";
export {
  Activity,
  brainOnly,
  canRestart,
  Dead,
  DeadInput,
  Down,
  inNoticeSpace,
  inRunnerSpace,
  inSignalSpace,
  noticeId,
  Owner,
  ProcessError,
  ProcessEvent,
  Recipient,
  recoverActivity,
  Start,
  State,
} from "../processes/Process.ts";
export { Appended } from "../ledger/Log.ts";
export { ParentText, Rev } from "../Rev.ts";
export { InputId } from "../Id.ts";
export { LedgerError } from "../ledger/Ledger.ts";
export { type Sql } from "../Sql.ts";
export { Archive, sha256 } from "../telemetry/Archive.ts";
export { RecordManager } from "../telemetry/Records.ts";
export { SinkError, SpanSink } from "../telemetry/Sink.ts";
export { addText, Change, enrollmentText, grantText, revokeText } from "../access/Text.ts";
export {
  type Envelope,
  NotGranted,
  SavedInput,
  Session,
  SessionManager,
  SigningRefused,
  SignRequest,
  Writer,
} from "../access/SessionManager.ts";
