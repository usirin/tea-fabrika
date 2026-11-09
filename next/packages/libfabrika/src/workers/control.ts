import {Effect, Result, Schema} from "effect";
import {workerLoader, type ProgramSource} from "./index.ts";
import {ProcessClient, ProjectClient, RecordClient} from "./platform.ts";
import {
	checkedPut,
	bucketHead,
	processStub,
	projectStub,
	recordStub,
	rpc,
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
	process: new Set(["msg", "open", "due", "abort", "activity", "recover", "savedAlarm"]),
	record: new Set(["write", "read", "content", "deleteContent"]),
};
const dispatch = Effect.fnUntraced(function* (
	env: Env,
	programs: Readonly<Record<string, ProgramSource>>,
	request: typeof Request.Type,
) {
	const {target, project, name, method, args} = request;
	if (target === "loader") {
		const loaded = yield* workerLoader(env.LOADER, programs).load(name, project);
		if (method === "init") return yield* loaded.execution.init(args[0]);
		if (method === "step") return yield* loaded.execution.step(args[0], args[1]);
		return yield* Effect.fail({why: "unknown_method"});
	}
	if (target === "bucket") {
		if (method === "put")
			return yield* checkedPut(
				env.HEALTH,
				String(args[0]),
				Uint8Array.from(Schema.decodeUnknownSync(Schema.Array(Schema.Number))(args[1])),
				String(args[2]),
			);
		if (method === "head") return yield* bucketHead(env.HEALTH, String(args[0]));
		return yield* Effect.fail({why: "unknown_method"});
	}
	if (!methods[target].has(method)) return yield* Effect.fail({why: "unknown_method"});
	if (
		target === "project" &&
		method === "commit" &&
		typeof args[1] === "object" &&
		args[1] !== null &&
		"process" in args[1]
	)
		return yield* Effect.fail({why: "reserved"});
	const client =
		target === "project"
			? ProjectClient.make(projectStub(env, project))
			: target === "process"
				? ProcessClient.make(processStub(env, project, name))
				: RecordClient.make(recordStub(env, project, name));
	// Only the fixed internal method set above is callable. Public fetch never reaches this entrypoint.
	const answer: Effect.Effect<unknown, unknown> = Reflect.apply(
		Reflect.get(client, method),
		client,
		args,
	);
	return yield* target === "process" && method === "abort"
		? answer.pipe(Effect.ignore)
		: rpc(answer);
});

export const control = Effect.fn("runtime.control")(function* (
	request: globalThis.Request,
	env: Env,
	token: string,
	programs: Readonly<Record<string, ProgramSource>>,
) {
	if (typeof token !== "string" || request.headers.get("authorization") !== `Bearer ${token}`)
		return new Response(null, {status: 403});
	// oxlint-disable-next-line fabrika/no-promises -- edge: a Request body returns a Promise
	const raw = yield* Effect.tryPromise({try: () => request.json(), catch: () => null});
	const input = Schema.decodeUnknownResult(Request)(raw);
	if (Result.isFailure(input)) return Response.json({error: {why: "bad_input"}}, {status: 400});
	const answer = yield* Effect.result(dispatch(env, programs, input.success));
	return Result.isSuccess(answer)
		? Response.json({value: answer.success ?? null})
		: Response.json(
				{
					error: {
						why:
							typeof answer.failure === "object" &&
							answer.failure !== null &&
							"why" in answer.failure
								? answer.failure.why
								: "unreachable",
					},
				},
				{status: 500},
			);
});
