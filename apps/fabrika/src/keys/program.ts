import {Schema} from "effect";
import {Does, Key, Keys} from "../desk/keymap.ts";

export const Edit = Schema.TaggedUnion({
	prefix: {key: Schema.String},
	bind: {does: Does, keys: Schema.Array(Schema.String)},
	reset: {does: Does},
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
