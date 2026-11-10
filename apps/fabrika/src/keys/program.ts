import {defineMachine} from "@demlik/tea";
import {defineProgram, end, flag, input, kind, output} from "@kampus/fabrika-old";
import {Context, Effect, Schema, type Stream} from "effect";
import {Does, Key, Keys} from "../desk/keymap.ts";

export const Edit = Schema.TaggedUnion({
	prefix: {key: Schema.String},
	bind: {does: Does, keys: Schema.Array(Schema.String)},
	reset: {does: Schema.Union([Does, Schema.Literals(["prefix", "ignore"])])},
	ignore: {keys: Schema.Array(Schema.String)},
	undo: {version: Schema.String},
});

export const Change = Schema.Struct({
	by: Schema.NullOr(Schema.String),
	at: Schema.Number,
	said: Schema.NullOr(Schema.Number),
	window: Schema.NullOr(Schema.String),
	how: Schema.Literals(["pressed", "file"]),
	modified: Schema.NullOr(Schema.Number),
	before: Keys,
	after: Keys,
	displaced: Schema.Array(Schema.Struct({does: Does, key: Key})),
	version: Schema.String,
});

export const Snapshot = Schema.Struct({
	version: Schema.String,
	keys: Keys,
	changes: Schema.Array(Change),
});
export type Snapshot = typeof Snapshot.Type;

export interface KeybindingManager {
	readonly current: Effect.Effect<Snapshot>;
	readonly changes: Stream.Stream<Snapshot>;
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
	view: {machine: "session", data: Session, of: (s) => s},
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
