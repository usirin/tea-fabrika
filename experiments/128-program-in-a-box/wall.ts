// Experiment 128, fabrika's part: what crosses the wall of a box, and how a service crosses it.
//
// One channel only: the child's stdin and stdout, one JSON line per frame. Inputs, outputs and
// every service call share it, as Erlang's `peer` with `connection: standard_io` carries the
// whole distribution protocol over stdio. Each service call is Effect's own RPC: the program's
// side runs an `RpcClient`, the host's side an `RpcServer`, and both speak through a protocol
// made here that puts their encoded messages in `rpc` frames.
//
//   host -> box   {kind: "tell", name, value} | {kind: "close", name} | {kind: "stop"}
//                 {kind: "rpc", wall, msg}            msg: an RpcServer answer
//   box -> host   {kind: "hi", pid} | {kind: "out", name, value} | {kind: "end", how, why?}
//                 {kind: "rpc", wall, msg}            msg: an RpcClient request
//
// The Cmd wall (./cmd-wall.ts) is a second way across, on the same channel:
//
//   box -> host   {kind: "cmd", id, name, input}      a tea Cmd that runs on the host
//   host -> box   {kind: "ok", id, value} | {kind: "err", id, tag} | {kind: "no", id, why}

import {fileURLToPath} from "node:url";
import type {AnyProgram} from "@kampus/fabrika-old";
import {type Context, Effect, Layer, Queue, Schema} from "effect";
import {type Rpc, RpcClient, type RpcGroup, RpcSerialization, RpcServer} from "effect/rpc";
import type {Keyed} from "./cmd-wall.ts";

// ---------------------------------------------------------------- frames

const Rpcf = Schema.Struct({kind: Schema.Literal("rpc"), wall: Schema.String, msg: Schema.Unknown});

/** The Cmd wall's answers (./cmd-wall.ts): one per `cmd` frame, by its id. */
export const Answer = Schema.Union([
	Schema.Struct({kind: Schema.Literal("ok"), id: Schema.Number, value: Schema.Unknown}),
	Schema.Struct({kind: Schema.Literal("err"), id: Schema.Number, tag: Schema.String}),
	Schema.Struct({kind: Schema.Literal("no"), id: Schema.Number, why: Schema.String}),
]);
export type Answer = typeof Answer.Type;

/** What the host writes to the box's stdin. */
export const Down = Schema.Union([
	Schema.Struct({kind: Schema.Literal("tell"), name: Schema.String, value: Schema.Unknown}),
	Schema.Struct({kind: Schema.Literal("close"), name: Schema.String}),
	Schema.Struct({kind: Schema.Literal("stop")}),
	Rpcf,
	...Answer.members,
]);
export type Down = typeof Down.Type;

/** How a run in a box ended, as the box says it. */
export const How = Schema.Literals(["ended", "stopped", "failed", "bad_shape"]);

/** What the box writes to its stdout. */
export const Up = Schema.Union([
	Schema.Struct({kind: Schema.Literal("hi"), pid: Schema.Number}),
	Schema.Struct({kind: Schema.Literal("out"), name: Schema.String, value: Schema.Unknown}),
	Schema.Struct({kind: Schema.Literal("end"), how: How, why: Schema.optional(Schema.String)}),
	Rpcf,
	Schema.Struct({
		kind: Schema.Literal("cmd"),
		id: Schema.Number,
		name: Schema.String,
		input: Schema.Unknown,
	}),
]);
export type Up = typeof Up.Type;

export const readDown = Schema.decodeUnknownExit(Schema.fromJsonString(Down));
export const readUp = Schema.decodeUnknownExit(Schema.fromJsonString(Up));
export const line = (frame: Up | Down): string => `${JSON.stringify(frame)}\n`;

// ---------------------------------------------------------------- walls

/**
 * One service that crosses the wall: its tag, the RPC group it is called through, and the two
 * small maps between them. The real service lives on the host, with its key; the program gets
 * `standIn`, which sends each call out.
 */
export interface Wall<Id, S, Rpcs extends Rpc.Any> {
	readonly name: string;
	readonly tag: Context.Key<Id, S>;
	readonly group: RpcGroup.RpcGroup<Rpcs>;
	/** The service, made of the RPC client. Inside the box. */
	readonly inside: (client: RpcClient.RpcClient<Rpcs>) => S;
	/** The RPC handlers, made of the real service. On the host. */
	readonly outside: (service: S) => RpcGroup.HandlersFrom<Rpcs>;
}
export type AnyWall = Wall<any, any, any>;

/**
 * A program a box can start: the program, the file that exports it under `name`, and the
 * services that cross its wall. The runner loads `file` inside the box and runs `name`.
 * `cmds`: the Cmds that run outside, on the host (./cmd-wall.ts).
 */
export interface Boxable<P extends AnyProgram> {
	readonly file: string;
	readonly name: string;
	readonly program: P;
	readonly walls: readonly AnyWall[];
	readonly cmds: readonly Keyed[];
}

export const boxable = <P extends AnyProgram>(
	url: string,
	name: string,
	program: P,
	walls: readonly AnyWall[] = [],
	cmds: readonly Keyed[] = [],
): Boxable<P> => ({file: fileURLToPath(url), name, program, walls, cmds});

/** Where an `rpc` frame for one wall goes, on the side that reads it. */
export type Routes = Map<string, (msg: unknown) => Effect.Effect<void>>;

const codecFor = RpcSerialization.json.codecFor;

/**
 * Inside the box: the stand-in for one wall's service. Each call is an RPC request written as
 * an `rpc` frame; each answer the runner reads is handed back to the client.
 */
export const standIn = <Id, S, Rpcs extends Rpc.Any>(
	wall: Wall<Id, S, Rpcs>,
	write: (frame: Up) => Effect.Effect<void>,
	routes: Routes,
): Layer.Layer<Id> => {
	const protocol = RpcClient.Protocol.make(
		// oxlint-disable-next-line eslint/require-yield -- `Effect.fnUntraced` asks for a generator, and this one has nothing to wait on.
		Effect.fnUntraced(function* (answer, clients) {
			routes.set(wall.name, (msg) =>
				Effect.forEach(clients, (id) => answer(id, msg as never), {discard: true, concurrency: 1}),
			);
			return {
				send: (_id, msg) => write({kind: "rpc", wall: wall.name, msg}),
				supportsAck: false,
				supportsTransferables: false,
				codecFor,
			};
		}),
	);
	return Layer.effect(
		wall.tag,
		Effect.map(RpcClient.make(wall.group), wall.inside).pipe(
			Effect.provideServiceEffect(RpcClient.Protocol, protocol),
		),
	);
};

/**
 * On the host: serve one wall with the real service, for one box. Each `rpc` frame the host
 * reads is a request; each answer goes back down as an `rpc` frame. It runs in the caller's
 * scope, so the box's end ends it.
 */
export const serve = <Id, S, Rpcs extends Rpc.Any>(
	wall: Wall<Id, S, Rpcs>,
	write: (frame: Down) => Effect.Effect<void>,
	routes: Routes,
) =>
	Effect.gen(function* () {
		const service = yield* wall.tag;
		const protocol = yield* RpcServer.Protocol.make(
			Effect.fnUntraced(function* (request) {
				routes.set(wall.name, (msg) => request(0, msg as never));
				return {
					disconnects: yield* Queue.make<number>(),
					send: (_id, msg) => write({kind: "rpc", wall: wall.name, msg}),
					end: () => Effect.void,
					clientIds: Effect.succeed(new Set([0])),
					initialMessage: Effect.succeedNone,
					supportsAck: false,
					supportsTransferables: false,
					supportsSpanPropagation: true,
					supportsNotifications: false,
					codecFor,
				};
			}),
		);
		yield* RpcServer.make(wall.group).pipe(
			Effect.provide(wall.group.toLayer(wall.outside(service))),
			Effect.provideService(RpcServer.Protocol, protocol),
			Effect.forkScoped,
		);
	});
