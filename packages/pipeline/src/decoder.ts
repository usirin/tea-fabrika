import {type DraftMsg, jsonSchema} from "@kampus/fabrika/agents/claude";
import {Result, Schema} from "effect";

// A stage's answer schema, for an agent program (experiment 169). The program
// takes a JSON Schema on `--schema`, as `claude -p --json-schema` and
// `codex exec --output-schema` do, and hands back a plain JSON value. The
// stage holds its own Effect schema: it makes the JSON Schema from it, and
// decodes the answer with it when the answer arrives. Elm's answer: a value
// from outside comes in as JSON and is decoded at the boundary, into a value
// or an error the program must handle (`Json.Decode.decodeValue`).
//
//   const sorted = decoder(SortReply);
//   flags: (run) => ({...flags, schema: sorted.schema})
//   subscribe: {sort_run: (sub) => runner(sub.deps.run).pipe(Stream.map(sorted.decode))}
//
// An answer that does not fit is a `<name>_failed` Msg with the schema's own
// words: the stage handles it as it handles any failed draft, and it is never
// dropped. That holds for a check JSON Schema cannot say, which the provider
// and the program let through.

/** What the agent was told it must fit: a JSON Schema, as the program's `--schema` flag holds it. */
const JsonObject = Schema.Record(Schema.String, Schema.Json);

/** Why a decoded answer failed: the start of a `<name>_failed` Msg's error. */
export const MISFIT = "the answer did not fit the schema";

/**
 * The stage's schema, both ways: `schema`, the JSON Schema to hand the agent
 * program, and `decode`, which reads each Draft Msg's answer back by the
 * Effect schema itself. Tool and failed Msgs pass as they came.
 */
export const decoder = <A>(answer: Schema.Codec<A, unknown>) => {
	const read = Schema.decodeUnknownResult(Schema.toCodecJson(answer));
	return {
		schema: Schema.decodeUnknownSync(JsonObject)(jsonSchema(answer)),
		decode: <N extends string>(msg: DraftMsg<N, unknown>): DraftMsg<N, A> => {
			// Only a finished Msg carries an answer.
			if (!("output" in msg)) return msg;
			const got = read(msg.output);
			if (Result.isSuccess(got)) return {...msg, output: got.success};
			return {
				// The same Draft's name: `sort_finished` becomes `sort_failed`.
				type: `${msg.type.slice(0, -"finished".length)}failed` as `${N}_failed`,
				key: msg.key,
				id: msg.id,
				error: `${MISFIT}: ${got.failure.message}`,
				spend: msg.spend,
			};
		},
	};
};
