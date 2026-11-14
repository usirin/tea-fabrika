/**
 * A job: work a program asks one selected set of hands to do. Its request, the executor that takes
 * it, the checked result and each writer's record, as values only (0095).
 *
 * @stability unstable
 */
import { Schema } from "effect";
import { TraceId } from "../ledger/Log.ts";
import { ProcessId } from "../ProcessId.ts";
import { ParentText, Rev } from "../Rev.ts";

const Text = Schema.NonEmptyString;

/** A capability a host advertises in its hello, such as `git`. */
const Capability = Text;

/**
 * Schema for the one supported command. A closed union: no shell text, no caller-chosen executable.
 *
 * @stability unstable
 * @category models
 */
export const Command = Schema.TaggedUnion({
  git_version: {},
});
/**
 * The one supported command: `git_version`.
 *
 * @stability unstable
 * @category models
 */
export type Command = typeof Command.Type;

/**
 * Schema for the checked terminal answer. `unknown` is a crash between start and a saved result.
 *
 * @stability unstable
 * @category models
 */
export const Result = Schema.TaggedUnion({
  exited: { code: Schema.Int, version: Schema.String },
  failed: { reason: Schema.Literals(["unavailable", "spawn_failed", "output_limit"]) },
  unknown: { reason: Schema.Literal("interrupted") },
});
/**
 * The checked terminal answer: `exited` with a code and version, `failed` with a reason, or
 * `unknown` after a crash between start and a saved result.
 *
 * @stability unstable
 * @category models
 */
export type Result = typeof Result.Type;

/**
 * Schema for what a program asked for, with every fact that exists only when it asked.
 *
 * @stability unstable
 * @category models
 */
export const Request = Schema.Struct({
  /** The dispatched Cmd's id, `<process>/<pos>/<index>`: no second id for the same command. */
  id: Text,
  /** The exact process generation that asked. */
  process: ProcessId,
  /** The registered program name. */
  name: Text,
  /** The pack-qualified program, `<pack>/<program>`. */
  program: Text,
  command: Command,
  /** The capabilities the command's trusted declaration needs. */
  needs: Schema.Array(Capability),
  /** The selected client key's fingerprint. */
  target: Text,
  /** The asking program's build. */
  build: Text,
  /** The effective settings hash, or null when no operational setting is used. */
  settings: Schema.NullOr(Text),
  /** The input that caused it, or null for an own request. */
  parent: Schema.NullOr(ParentText),
  /** Trace correlation, never authority. */
  traceId: TraceId,
});
/**
 * What a program asked for, with every fact that exists only when it asked.
 *
 * @stability unstable
 * @category models
 */
export type Request = typeof Request.Type;

/**
 * Schema for the hands that take a job: their key, the connection they came on, what they
 * advertise and their build.
 *
 * @stability unstable
 * @category models
 */
export const Executor = Schema.Struct({
  key: Text,
  connection: Text,
  has: Schema.Array(Capability),
  build: Text,
});
/**
 * The hands that take a job: their key, the connection they came on, what they advertise and their
 * build.
 *
 * @stability unstable
 * @category models
 */
export type Executor = typeof Executor.Type;

/**
 * Schema for what a writer says about one call: who, for whom, its own clock, what it had seen, why
 * and its build.
 *
 * @stability unstable
 * @category models
 */
export const Recorded = Schema.Struct({
  by: Text,
  for: Text,
  /** The writer's own clock. Shown, never decides. */
  sentAt: Schema.String,
  /** The last log rev the writer had folded. */
  seen: Rev,
  parent: Schema.NullOr(ParentText),
  traceId: TraceId,
  build: Text,
  /** Absent on trusted program calls and events saved before connection facts were recorded. */
  connection: Schema.optionalKey(Text),
  has: Schema.optionalKey(Schema.Array(Capability)),
});
/**
 * What a writer says about one call: who, for whom, its own clock, what it had seen, why and its
 * build.
 *
 * @stability unstable
 * @category models
 */
export type Recorded = typeof Recorded.Type;

/**
 * Schema for the one execution a take allocated, and who holds it. Not a lease: it never moves.
 *
 * @stability unstable
 * @category models
 */
export const Assignment = Schema.Struct({ execution: Text, executor: Executor });

/**
 * Schema for a job's control state: `absent`, `requested`, `assigned`, `started` or `finished`.
 * `finished` has no way back to execution.
 *
 * @stability unstable
 * @category models
 */
export const State = Schema.TaggedUnion({
  absent: {},
  requested: { request: Request },
  assigned: { request: Request, assignment: Assignment },
  started: { request: Request, assignment: Assignment },
  finished: { request: Request, assignment: Assignment, result: Result },
});
/**
 * A job's control state: `absent`, `requested`, `assigned`, `started` or `finished`. `finished` has
 * no way back to execution.
 *
 * @stability unstable
 * @category models
 */
export type State = typeof State.Type;

/**
 * Schema for one accepted call as the ledger kept it: the writer's record, and where and when it
 * arrived.
 *
 * @stability unstable
 * @category models
 */
export const Event = Schema.Struct({
  ...Recorded.fields,
  event: Schema.Literals(["requested", "taken", "started", "finished"]),
  rev: Rev,
  /** The referee's clock, in ms since 1970. */
  arrivedAt: Schema.Int,
});
/**
 * One accepted call as the ledger kept it: the writer's record, and where and when it arrived.
 *
 * @stability unstable
 * @category models
 */
export type Event = typeof Event.Type;

/**
 * Schema for a job as `read` answers it: its state, and every accepted event in order.
 *
 * @stability unstable
 * @category models
 */
export const Job = Schema.Struct({ state: State, events: Schema.Array(Event) });
/**
 * A job as `read` answers it: its state, and every accepted event in order.
 *
 * @stability unstable
 * @category models
 */
export type Job = typeof Job.Type;
