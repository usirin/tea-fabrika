import {Schema} from "effect";

// Today's frame. Only layers that can actually open in PR 1 cross the wire.
export const Layer = Schema.TaggedUnion({
	popover: {item: Schema.String},
	palette: {},
	tooltip: {for: Schema.String},
});
export type Layer = typeof Layer.Type;

export const LayerVia = Schema.TaggedUnion({
	key: {keys: Schema.String},
	click: {},
	pointer: {},
	focus: {},
	word: {},
	palette: {},
});
export type LayerVia = typeof LayerVia.Type;

export const LayerReason = Schema.Literals([
	"escape",
	"outside",
	"done",
	"owner_gone",
	"toggle",
	"replacement",
	"navigation",
]);
export type LayerReason = typeof LayerReason.Type;

export const LayerChange = Schema.TaggedUnion({
	open: {layer: Layer, via: Schema.NullOr(LayerVia)},
	close: {layer: Layer, reason: LayerReason},
});
export type LayerChange = typeof LayerChange.Type;

export const LayerReport = Schema.Struct({
	type: Schema.Literal("layer"),
	id: Schema.NonEmptyString,
	instance: Schema.NonEmptyString,
	change: LayerChange,
	said: Schema.NullOr(
		Schema.Int.check(Schema.isBetween({minimum: 0, maximum: Number.MAX_SAFE_INTEGER})),
	),
});
export type LayerReport = typeof LayerReport.Type;
