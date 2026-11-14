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
 * Installation and service-manager contract.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

/**
 * Schema for the job's state in the service manager: absent, or loaded with its executable,
 * arguments, home and configuration. A loaded job remains loaded even while it has no process.
 *
 * @stability unstable
 * @category schemas
 */
export const Status = Schema.TaggedUnion({
  absent: {},
  loaded: {
    executable: Schema.NonEmptyString,
    args: Schema.Array(Schema.String),
    home: Schema.NonEmptyString,
    configuration: Schema.NonEmptyString,
    pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  },
});

/**
 * Native command failure, including its observed exit code or termination signal.
 *
 * @stability unstable
 * @category errors
 */
export class Command extends Schema.TaggedError<Command>()("Command", {
  code: Schema.optionalKey(Schema.Int),
  signal: Schema.optionalKey(
    Schema.Literals([
      "SIGABRT",
      "SIGALRM",
      "SIGBUS",
      "SIGCHLD",
      "SIGCONT",
      "SIGFPE",
      "SIGHUP",
      "SIGILL",
      "SIGINT",
      "SIGIO",
      "SIGIOT",
      "SIGKILL",
      "SIGPIPE",
      "SIGPOLL",
      "SIGPROF",
      "SIGPWR",
      "SIGQUIT",
      "SIGSEGV",
      "SIGSTKFLT",
      "SIGSTOP",
      "SIGSYS",
      "SIGTERM",
      "SIGTRAP",
      "SIGTSTP",
      "SIGTTIN",
      "SIGTTOU",
      "SIGUNUSED",
      "SIGURG",
      "SIGUSR1",
      "SIGUSR2",
      "SIGVTALRM",
      "SIGWINCH",
      "SIGXCPU",
      "SIGXFSZ",
      "SIGBREAK",
      "SIGLOST",
      "SIGINFO",
    ]),
  ),
  cause: Schema.Defect(),
}) {}

/**
 * File operation failure.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}
/**
 * Service-manager output, or a job value, that cannot be read or written without guessing.
 *
 * @stability unstable
 * @category errors
 */
export class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", { cause: Schema.Defect() }) {}
/**
 * The job or its file belongs to another configuration, or the home is not canonical.
 *
 * @stability unstable
 * @category errors
 */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { cause: Schema.Defect() }) {}

/**
 * Lower controller failure, preserving its protected cause.
 *
 * @stability unstable
 * @category errors
 */
export class BrainControlError extends Schema.TaggedError<BrainControlError>()("BrainControlError", {
  reason: Schema.Union([Command, Storage, Unsupported, Conflict]),
}) {}

/**
 * Operations on one checked installation.
 *
 * @stability unstable
 * @category services
 */
export class BrainControl extends Context.Service<
  BrainControl,
  {
    readonly inspect: Effect.Effect<typeof Status.Type, BrainControlError>;
    readonly install: Effect.Effect<void, BrainControlError>;
    readonly start: Effect.Effect<void, BrainControlError>;
    readonly stop: Effect.Effect<void, BrainControlError>;
    /** Keeps removal reversible until the caller's scope succeeds. */
    readonly remove: Effect.Effect<void, BrainControlError, Scope.Scope>;
  }
>()("@kampus/libfabrika/desktop/BrainControl") {}
