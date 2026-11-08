import {defineMachine} from "@demlik/tea";
import {defineProgram, end, flag, input, kind, output} from "@kampus/fabrika-old";
import {Context, Effect, Schema, type Stream} from "effect";
import {type CatalogOptions} from "../desk/keymap.ts";
import {type Editor, EditorState, EditorCommand, editorMachine} from "./machine.ts";
import {Edit, type Snapshot} from "./schema.ts";
export {Edit, Change, Snapshot} from "./schema.ts";

export interface KeybindingManager {
	readonly current: Effect.Effect<Snapshot>;
	readonly changes: Stream.Stream<Snapshot>;
	readonly catalog: (programs: NonNullable<CatalogOptions["programs"]>) => Effect.Effect<Snapshot>;
	readonly edit: (
		edit: typeof Edit.Type,
		from: {readonly how: "pressed"; readonly window: string; readonly said: number},
	) => Effect.Effect<Snapshot, {readonly why: string}>;
}
export const KeybindingService = Context.Service<KeybindingManager, KeybindingManager>(
	"@kampus/fabrika-app-old/KeybindingManager",
);

const Session = Schema.Struct({open: Schema.Boolean});
const session = defineMachine({
	types: {model: {} as typeof Session.Type, msg: {} as {type: "close"}, ctx: undefined},
	cmds: [],
	init: () => [{open: true}, []],
	update: {close: () => [{open: false}, []]},
});

/** A real program run owns the editor's lifetime; the page owns its unsaved recording. */
export const keysProgram = defineProgram({
	mode: (s: Editor): "mapping" | null => (s.mapping ? "mapping" : null),
	commands: {
		mapping: {send: {type: "mapping"}, keys: []},
		exit: {send: {type: "mapping"}, keys: "escape", mode: "mapping", global: true},
		change: {send: {type: "change"}, keys: []},
		add: {send: {type: "add"}, keys: []},
		save: {send: {type: "save"}, keys: []},
		unbind: {send: {type: "unbind"}, keys: []},
		reset: {send: {type: "reset"}, keys: []},
	},
	name: "keys",
	description: "Searches and changes keyboard shortcuts in the palette layer.",
	flags: {window: flag(Schema.String, "The host's window identity.")},
	inputs: {
		close: input(Schema.Null, "Closes this editor.", {personOnly: true}),
		edit: input(
			Schema.Struct({request: Schema.String, edit: Edit, said: Schema.Number}),
			"Checks and saves a binding change.",
			{personOnly: true},
		),
	},
	outputs: {
		saved: output(
			Schema.Struct({request: Schema.String, version: Schema.String}),
			"The applied file version.",
		),
		failed: output(
			Schema.Struct({request: Schema.String, why: Schema.String}),
			"Why the file could not be changed.",
		),
	},
	machines: {
		session: kind({
			machine: session,
			state: Session,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "keys", steps: {}}),
			status: () => "editing keys",
		}),
	},
	view: {
		machine: "session",
		data: Session,
		of: (s) => s,
		window: {machine: editorMachine, state: EditorState, msg: EditorCommand, refuse: () => null},
	},
	main: ({serve, machines, flags, send}) =>
		Effect.gen(function* () {
			const manager = yield* KeybindingService;
			yield* machines.session.get("session").start();
			yield* serve({
				close: () => end,
				edit: ({request, edit, said}) =>
					manager.edit(edit, {how: "pressed", window: flags.window, said}).pipe(
						Effect.matchEffect({
							onSuccess: (snapshot) => send("saved", {request, version: snapshot.version}),
							onFailure: (error) => send("failed", {request, why: error.why}),
						}),
					),
			});
		}).pipe(Effect.scoped),
});

/** tsh waits on this request until the editor closes, without opening another tile. */
export const keysRequest = (open: () => string | null) =>
	defineProgram({
		name: "keys",
		description: "Searches and changes keyboard shortcuts.",
		inputs: {close: input(Schema.Null, "Closes this editor.", {personOnly: true})},
		outputs: {},
		machines: keysProgram.machines,
		view: {machine: "session", data: Session, of: (s: typeof Session.Type) => s},
		main: ({serve, machines}) =>
			Effect.gen(function* () {
				yield* machines.session.get("session").start();
				const why = open();
				if (why !== null) return yield* Effect.fail({message: why});
				yield* serve({close: () => end});
			}).pipe(Effect.scoped),
	});
