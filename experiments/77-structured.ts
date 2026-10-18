// Experiment 77, the second road for a typed answer: the Agent SDK's own
// `outputFormat`, handed through `_meta.claudeCode.options`, and the SDK's
// result message forwarded raw (`emitRawSDKMessages`) with its
// `structured_output`. Experiment 76 read the adapter and said the answer
// could not come back; this runs it.
//
//   node experiments/77-structured.ts [model]
//
// One session in a scratch folder under ~/.cache, removed at the end, with
// the builder's fence and no tool call asked for. Writes
// results/77-structured.json: whether a result came, whether it decoded as
// the builder's form, and the cost. No text of the reply is kept.
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Option, Schema} from "effect";
import {jsonSchema} from "../wip/src/schema";
import {builderHarness, runTurn, verdictOf} from "../wip/src/stages/build/builder-acp";
import {builderCheck, temps} from "../wip/src/stages/build/check";
import {Built} from "../wip/src/stages/build/form";

const [model = "haiku"] = process.argv.slice(2);
const folder = join(homedir(), ".cache", "tea-fabrika-77", `structured-${Date.now()}`);
mkdirSync(folder, {recursive: true});

const {harness, meta} = builderHarness(folder, 0.3, false);
const claudeCode = (meta as {claudeCode: {options: Record<string, unknown>}}).claudeCode;
const withFormat = {
	claudeCode: {
		...claudeCode,
		options: {
			...claudeCode.options,
			outputFormat: {type: "json_schema", schema: jsonSchema(Built)},
		},
	},
};

const turn = await Effect.runPromise(
	runTurn({
		harness,
		folder,
		meta: withFormat,
		model,
		effort: null,
		prompt:
			"Do not use any tool. Fill your form: summary 'Nothing was changed.', no deviations, ran one check 'true' that passed, nothing left.",
		verdict: verdictOf(builderCheck(folder, temps())),
	}).pipe(Effect.scoped, Effect.provide(nodeServices)),
);
const structured = turn.result?.structured ?? null;
const decoded = Schema.decodeUnknownOption(Built)(structured);
const row = {
	model,
	stop: turn.stop,
	resultCame: turn.result !== null,
	subtype: turn.result?.subtype ?? null,
	structuredCame: structured !== null,
	decodesAsForm: Option.isSome(decoded),
	toolCalls: turn.calls.length,
	costUsd: turn.result?.costUsd ?? turn.cost ?? 0,
};
console.log(JSON.stringify(row));
mkdirSync(join(import.meta.dirname, "results"), {recursive: true});
writeFileSync(
	join(import.meta.dirname, "results", "77-structured.json"),
	`${JSON.stringify(row, null, "\t")}\n`,
);
rmSync(folder, {recursive: true, force: true});
