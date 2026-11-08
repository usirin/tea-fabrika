import {Schema} from "effect";
import {CheckedTarget, Does, Key, Keys, Target} from "../desk/keymap.ts";

const Bind = {
	does: Schema.optionalKey(Does),
	target: Schema.optionalKey(CheckedTarget),
	keys: Schema.Array(Schema.String),
};
const Reset = {
	does: Schema.optionalKey(Schema.Union([Does, Schema.Literals(["prefix", "ignore"])])),
	target: Schema.optionalKey(CheckedTarget),
};
const RowEdit = Schema.TaggedUnion({bind: Bind, reset: Reset});

export const Edit = Schema.TaggedUnion({
	prefix: {key: Schema.String},
	bind: Bind,
	reset: Reset,
	batch: {edits: Schema.Array(RowEdit)},
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
	displaced: Schema.Array(Schema.Struct({does: Does, target: Target, key: Key})),
	version: Schema.String,
	catalog: Schema.optionalKey(Schema.Int),
});

export const Snapshot = Schema.Struct({
	version: Schema.String,
	keys: Keys,
	changes: Schema.Array(Change),
	catalog: Schema.optionalKey(Schema.Int),
});
export type Snapshot = typeof Snapshot.Type;
