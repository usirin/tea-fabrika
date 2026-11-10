// Experiment 248 spike, next/. Type probes for Q5 and Q6; tsc's answers are the result.
import type * as Cloudflare from "@alchemy.run/cloudflare";
import type {Effect} from "effect";
import type {Boom, Pong, PongShape} from "./objects.ts";

type Stub = Cloudflare.DurableObjectStub<PongShape>;

type ErrorOf<T> = T extends (...args: never) => Effect.Effect<unknown, infer E, unknown>
	? E
	: "not a method";

type ServicesOf<T> = T extends (...args: never) => Effect.Effect<unknown, unknown, infer R>
	? R
	: "not a method";

type Namespace = Effect.Success<typeof Pong>;
type NamespaceStub = ReturnType<Namespace["getByName"]>;

// Each line errors with the real type in the message.
export const refuseError: {probe: ErrorOf<Stub["refuse"]>} = {probe: 0 as unknown as "SHOW"};
export const noteError: {probe: ErrorOf<Stub["note"]>} = {probe: 0 as unknown as "SHOW"};
export const refuseServices: {probe: ServicesOf<Stub["refuse"]>} = {probe: 0 as unknown as "SHOW"};

export const viaNamespace: {probe: ErrorOf<NamespaceStub["refuse" & keyof NamespaceStub]>} = {
	probe: 0 as unknown as "SHOW",
};

export const hasRpcCallError: Cloudflare.RpcCallError extends ErrorOf<Stub["refuse"]>
	? "yes"
	: "no" = "SHOW" as never;

export type {Boom};

import type {PingLive, StoreLive} from "./objects.ts";
import type {eagerLayers} from "./worker-eager.ts";
export const pingLive: {probe: typeof PingLive} = {probe: "SHOW" as const};
export const storeLive: {probe: typeof StoreLive} = {probe: "SHOW" as const};
export const eager: {probe: typeof eagerLayers} = {probe: "SHOW" as const};
