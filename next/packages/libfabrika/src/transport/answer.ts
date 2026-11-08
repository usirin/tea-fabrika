import {Effect, Exit, Result, Schema} from "effect";
import type {Admission, Who} from "./wire.ts";
import {Answer, Attached} from "./wire.ts";

const Request = Schema.fromJsonString(
	Schema.Struct({
		jsonrpc: Schema.Literal("2.0"),
		id: Schema.Union([Schema.String, Schema.Number]),
		method: Schema.String,
		params: Schema.optional(Schema.Unknown),
	}),
);

export const answerFrame = Effect.fn("transport.answerFrame")(function* <E, R, E2, R2>(
	text: string,
	attached: typeof Attached.Type,
	_admit: (key: string) => Effect.Effect<typeof Admission.Type, E2, R2>,
	route: (
		method: string,
		params: unknown,
		who: typeof Who.Type,
	) => Effect.Effect<typeof Answer.Type, E, R>,
) {
	const request = Schema.decodeUnknownResult(Request)(text);
	if (Result.isFailure(request)) return {send: null, attached};
	const {id, method, params} = request.success;
	if (attached._tag !== "online")
		return {
			send: JSON.stringify({
				jsonrpc: "2.0",
				id,
				error: {code: -32000, message: "no_hello", data: {why: "no_hello"}},
			}),
			attached,
		};
	const exit = yield* Effect.exit(route(method, params, attached.who));
	if (Exit.isFailure(exit)) return {send: null, attached};
	return Answer.match(exit.value, {
		ok: ({result}) => ({send: JSON.stringify({jsonrpc: "2.0", id, result}), attached}),
		refused: ({why}) => ({
			send: JSON.stringify({jsonrpc: "2.0", id, error: {code: -32000, message: why, data: {why}}}),
			attached,
		}),
		parked: ({stream, after}) => ({
			send: null,
			attached: Attached.cases.online.make({
				...attached,
				waits: [...attached.waits, {id, stream, after}],
			}),
		}),
	});
});
