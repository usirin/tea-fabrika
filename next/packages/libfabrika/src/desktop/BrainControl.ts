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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
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
