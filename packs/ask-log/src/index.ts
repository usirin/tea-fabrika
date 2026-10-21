import {defineProgram, input} from "@kampus/fabrika";
import {Ask, Settled} from "@kampus/fabrika/pipeline/asks/ask";
import type {Pack} from "@kampus/fabrika/pipeline/asks/packs";
import {Context, Effect, FileSystem, Layer, Path, Schema, Stream} from "effect";

// The smallest pack: it only listens. One line per ask the core makes and per
// answer it takes, appended to one file. It answers nothing, so the core
// cannot tell whether it runs.
//
//   packs = ["@tea-fabrika/owner-desk", "@tea-fabrika/ask-log"]    # fabrika.toml
//   [pack."@tea-fabrika/ask-log"]
//   file = ".desk/asks.log"     # from fabrika.toml's folder; `asks.log` in the host's folder for the pack when left out

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
			const path = yield* Path.Path;
			const {file} = yield* LogFile;
			yield* fs.makeDirectory(path.dirname(file), {recursive: true}).pipe(Effect.orDie);
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
	layer: (settings, places) =>
		Schema.decodeUnknownEffect(Settings)(settings).pipe(
			Effect.mapError((error) => error.message),
			Effect.map(({file}) =>
				Layer.succeed(LogFile, {
					file:
						file === undefined
							? `${places.home}/asks.log`
							: file.startsWith("/")
								? file
								: `${places.folder}/${file}`,
				}),
			),
		),
};

export default pack;
