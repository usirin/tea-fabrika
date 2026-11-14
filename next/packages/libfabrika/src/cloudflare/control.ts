/**
 * The local runtime's control entrypoint: a private, token-guarded way to call a fixed set of
 * methods on the Project, a Process, the Record, the Worker Loader or the bucket.
 *
 * @stability unstable
 */
import { Effect, Equal, Redacted, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { httpContext } from "./fetch.ts";
import { workerLoader, type ProgramSource } from "./index.ts";
import { ProcessClient, ProjectClient, RecordClient } from "./platform.ts";
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
    "codeInstall",
    "codeFailed",
  ]),
  process: new Set(["msg", "open", "due", "restart", "abort", "activity", "recover", "savedAlarm"]),
  record: new Set(["write", "read", "content", "deleteContent"]),
};

const dispatch = Effect.fnUntraced(function* (
  env: Env,
  programs: Readonly<Record<string, ProgramSource>>,
  request: typeof Request.Type,
) {
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

/**
 * Answers one control request: a JSON body naming a target, a project, a name, a method and its
 * arguments.
 *
 * **Details**
 *
 * A request whose bearer token is not `token` gets a 403, and a body that does not decode gets a 400
 * with reason `bad_input`. Only the listed methods of each target are called; another fails with
 * reason `unknown_method`, and a Project `commit` that names its own `process` with reason
 * `reserved`. A success answers `{ value }`, and a failure a 500 with `{ error: { reason } }`.
 *
 * @stability unstable
 * @category combinators
 */
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
