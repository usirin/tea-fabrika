import {defineProgram, listed, memoryStorage, Shell, start} from "@kampus/fabrika";
import {Effect, Layer, Schema} from "effect";

export const View = Schema.Struct({lines: Schema.Array(Schema.String), ready: Schema.Boolean});
export type View = typeof View.Type;
export const Message = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("line"),
		line: Schema.String.check(Schema.isMaxLength(8192)),
	}),
	Schema.Struct({type: Schema.Literal("interrupt")}),
]);
export type Message = typeof Message.Type;

// The GUI is a launcher for the real tsh program, just as runTsh is its Node terminal launcher.
export const openTsh = (
	id: string,
	display: (kind: "counter" | "terminal" | "pipe") => Effect.Effect<void, never>,
) =>
	Effect.gen(function* () {
		const transcript: {lines: string[]; ready: boolean} = {
			lines: ["Type counter, terminal or pipe. programs lists everything; help explains tsh."],
			ready: true,
		};
		const entry = (name: "counter" | "terminal" | "pipe") =>
			listed(
				defineProgram({
					name,
					description: `Open ${name} in this pane.`,
					inputs: {},
					outputs: {},
					main: () => display(name),
				}),
				Layer.empty,
			);
		const started = yield* start(
			Shell.tsh,
			{show: "short"},
			{
				printed: (printed) => {
					transcript.lines = [...transcript.lines, printed.text].slice(-200);
				},
				ready: () => {
					transcript.ready = true;
				},
			},
			{id: `tsh:${id}`, storage: memoryStorage()},
		).pipe(
			Effect.provideService(
				Shell.Programs,
				Shell.programList([...Shell.SMALL, entry("counter"), entry("terminal"), entry("pipe")]),
			),
			Effect.provideService(Shell.JobStorage, memoryStorage()),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh refused its startup shape.");
		return {
			run: started.run,
			view: (): View => ({...transcript}),
			line: (line: string) => {
				transcript.lines = [...transcript.lines, `tsh › ${line}`].slice(-200);
				transcript.ready = false;
			},
		};
	});
