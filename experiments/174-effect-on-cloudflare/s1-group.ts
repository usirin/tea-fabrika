// The door's methods, shared by the object and by an Effect client.
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

export const Row = Schema.Struct({n: Schema.Number, text: Schema.String});

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {top: Schema.Number}) {}

export const Group = RpcGroup.make(
	Rpc.make("append", {
		payload: {base: Schema.Number, text: Schema.String},
		success: Row,
		error: Conflict,
	}),
	Rpc.make("read", {payload: {after: Schema.Number}, success: Schema.Array(Row)}),
	Rpc.make("wakes", {success: Schema.Number}),
	Rpc.make("slow", {payload: {ms: Schema.Number}, success: Schema.Number}),
	// A stream held by a fiber in the object: the plain Effect way.
	Rpc.make("tail", {payload: {after: Schema.Number}, success: Row, stream: true}),
	// A stream the object holds only as data in the socket's attachment.
	Rpc.make("park", {payload: {after: Schema.Number}, success: Row, stream: true}),
);
