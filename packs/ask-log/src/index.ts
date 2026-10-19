import {defineProgram} from "@tea-fabrika/tea-program";
import {input} from "@tea-fabrika/tea-program/shape";
import {Ask, Settled} from "@tea-fabrika/wip/asks/ask";
import type {Pack} from "@tea-fabrika/wip/asks/packs";
import {Context, Effect, FileSystem, Layer, Schema, Stream} from "effect";

// The smallest pack: it only listens. One line per ask the core makes and per
// answer it takes, appended to one file. It answers nothing, so the core
// cannot tell whether it runs.
//
//   packs = ["@tea-fabrika/owner-desk", "@tea-fabrika/ask-log"]
//   [pack."@tea-fabrika/ask-log"]
//   file = ".desk/asks.log"

/** Where the lines go. */
export class LogFile extends Context.Service<LogFile, {readonly file: string}>()("LogFile") {}

/** One line of the log. Pure. */
export const lineOf = (heard: {readonly ask: Ask} | {readonly settled: Settled}): string =>
	"ask" in heard
		? `asked ${heard.ask.id} at ${heard.ask.at}`
		: `settled ${heard.settled.ask.id}: ${heard.settled.next.do}`;

export const logProgram = defineProgram({
	name: "ask-log",
	description:
		"Writes one line for every ask the core makes of the owner and every answer it takes.",
	inputs: {
		ask: input(Ask, "Each ask the core makes of the owner."),
		settled: input(Settled, "An answer the core took."),
	},
	outputs: {},
	main: ({inputs}) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const {file} = yield* LogFile;
			const lines = Stream.merge(
				inputs.ask.pipe(Stream.map((ask) => lineOf({ask}))),
				inputs.settled.pipe(Stream.map((settled) => lineOf({settled}))),
			);
			yield* lines.pipe(
				Stream.runForEach((line) => fs.writeFileString(file, `${line}\n`, {flag: "a"})),
				Effect.orDie,
			);
		}),
});

const Settings = Schema.Struct({file: Schema.optional(Schema.String)});

const pack: Pack = {
	program: logProgram,
	listens: {ask: "ask", settled: "settled"},
	answers: {},
	layer: (settings) =>
		Schema.decodeUnknownEffect(Settings)(settings).pipe(
			Effect.mapError((error) => error.message),
			Effect.map(({file = "asks.log"}) => Layer.succeed(LogFile, {file})),
		),
};

export default pack;
