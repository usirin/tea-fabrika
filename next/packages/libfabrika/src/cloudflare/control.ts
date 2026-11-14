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
import { Effect, Equal, Redacted, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { httpContext } from "./fetch.ts";
import { workerLoader, type ProgramSource } from "./index.ts";
import { ProcessClient, ProjectClient, RecordClient } from "./platform.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import {
  checkedPut,
  bucketHead,
  processStub,
  projectStub,
  recordStub,
  rpc,
  settingsFailure,
  type Env,
} from "./runtime.ts";

const Request = Schema.Struct({
  target: Schema.Literals(["project", "process", "record", "loader", "bucket"]),
  project: Schema.String,
  name: Schema.String,
  method: Schema.String,
  args: Schema.Array(Schema.Unknown),
});

const methods = {
  project: new Set([
    "clientConnect",
    "challenge",
    "initialize",
    "route",
    "grant",
    "read",
    "append",
    "wait",
    "start",
    "exit",
    "info",
    "sign",
    "commit",
    "join",
    "leave",
    "online",
    "brain",
  ]),
  process: new Set(["msg", "open", "due", "restart", "abort", "activity", "recover", "savedAlarm"]),
  record: new Set(["write", "read", "content", "deleteContent"]),
};

const dispatch = Effect.fnUntraced(function* (
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
  request: typeof Request.Type,
) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const { target, project, name, method, args } = request;

  if (target === "loader" || target === "bucket") {
    yield* settingsFailure(httpContext(env));
  }

  if (target === "loader") {
    const loaded = yield* workerLoader(env.LOADER, programs).load(name, project);

    if (method === "init") {
      return yield* loaded.execution.init(args[0]);
    }

    if (method === "step") {
      return yield* loaded.execution.step(args[0], args[1]);
    }

    return yield* Effect.fail({ reason: "unknown_method" });
  }

  if (target === "bucket") {
    if (method === "put") {
      const [key, bytes, checksum] = yield* Schema.decodeUnknownEffect(
        Schema.Tuple([Schema.String, Schema.Array(Schema.Number), Schema.String]),
      )(args).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })));
      return yield* checkedPut(env.MEASUREMENTS, key, Uint8Array.from(bytes), checksum);
    }

    if (method === "head") {
      const [key] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String]))(args).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
      );
      return yield* bucketHead(env.MEASUREMENTS, key);
    }

    return yield* Effect.fail({ reason: "unknown_method" });
  }

  if (!methods[target].has(method)) {
    return yield* Effect.fail({ reason: "unknown_method" });
  }

  if (
    target === "project" &&
    method === "commit" &&
    typeof args[1] === "object" &&
    args[1] !== null &&
    "process" in args[1]
  ) {
    return yield* Effect.fail({ reason: "reserved" });
  }

  // A process ID reaches the object its registered name owns; the Project refuses an unknown ID.
  const client =
    target === "project"
      ? ProjectClient.make(projectStub(env, project))
      : target === "process"
        ? ProcessClient.make(
            processStub(env, project, yield* rpc(ProjectClient.make(projectStub(env, project)).processObject(name))),
          )
        : RecordClient.make(recordStub(env, project, name));
  // Only the fixed internal method set above is callable. Public fetch never reaches this entrypoint.
  const answer: Effect.Effect<unknown, unknown> = Reflect.apply(Reflect.get(client, method), client, args);
  return yield* target === "process" && method === "abort" ? answer.pipe(Effect.ignore) : rpc(answer);
});

export const control = Effect.fn("runtime.control")(function* (
  request: globalThis.Request,
  env: Env,
  token: Redacted.Redacted<string>,
  programs: Readonly<Record<string, ProgramSource>>,
) {
  const bearer = Redacted.make(request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]);

  if (!Equal.equals(token, bearer)) {
    return new Response(null, { status: 403 });
  }

  // oxlint-disable-next-line fabrika/no-promises -- edge: a Request body returns a Promise
  const raw = yield* Effect.tryPromise({ try: () => request.json(), catch: () => null });
  const input = Schema.decodeUnknownResult(Request)(raw);

  if (Result.isFailure(input)) {
    return Response.json({ error: { reason: "bad_input" } }, { status: 400 });
  }

  const answer = yield* Effect.result(dispatch(env, programs, input.success));
  return Result.isSuccess(answer)
    ? Response.json({ value: answer.success ?? null })
    : Response.json(
        {
          error: {
            reason:
              typeof answer.failure === "object" && answer.failure !== null && "reason" in answer.failure
                ? answer.failure.reason
                : typeof answer.failure === "object" && answer.failure !== null && "reason" in answer.failure
                  ? answer.failure.reason
                  : "unreachable",
          },
        },
        { status: 500 },
      );
});
