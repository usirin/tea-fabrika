// Spike (experiment 248), next/. RecordPart in Alchemy's modular Effect form. Never merged.
import * as Cloudflare from "@alchemy.run/cloudflare";
import {
	recordContent,
	recordDelete,
	recordRead,
	recordWrite,
} from "@kampus/libfabrika/workers/record";
import {Effect} from "effect";
import {settings, type Env} from "./runtime.ts";

type Chain = Parameters<typeof recordWrite>[2];
type Rows = Parameters<typeof recordWrite>[4];
type By = Parameters<typeof recordDelete>[5];

type Call<F extends (...args: never) => Effect.Effect<unknown, unknown>, E = never> = Effect.Effect<
	Effect.Success<ReturnType<F>>,
	Effect.Error<ReturnType<F>> | E
>;

type BadSettings = Effect.Error<ReturnType<typeof settings>>;

// The contract: what a caller's stub answers. Importing it pulls in no code.
export interface RecordShape {
	readonly write: (chain: Chain, at: number, rows: Rows) => Call<typeof recordWrite, BadSettings>;
	readonly read: (chain: Chain, at: number, after: number) => Call<typeof recordRead, BadSettings>;
	readonly content: (
		chain: Chain,
		at: number,
		id: string,
	) => Call<typeof recordContent, BadSettings>;
	readonly deleteContent: (
		chain: Chain,
		at: number,
		id: string,
		by: By,
	) => Call<typeof recordDelete, BadSettings>;
}

// 1. The class is only a name and a contract.
export class RecordPart extends Cloudflare.DurableObject<RecordPart, RecordShape>()("RecordPart") {}

// 2. The Layer is the whole shell: pick up the platform's handles, hand them to the plain service.
export const RecordPartLive = RecordPart.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState; // outer: the reference only
		const env = (yield* Cloudflare.WorkerEnvironment) as unknown as Env;
		// The service takes the platform's own state, as it does on main and in its Node laws.
		const ctx = state.raw as unknown as DurableObjectState;
		const bytes = settings(env).pipe(Effect.map((s) => s.limits?.recordBytes));
		return Effect.succeed({
			write: (chain, at, rows) =>
				Effect.flatMap(bytes, (cap) => recordWrite(ctx, cap, chain, at, rows)),
			read: (chain, at, after) =>
				Effect.flatMap(bytes, (cap) => recordRead(ctx, cap, chain, at, after)),
			content: (chain, at, id) =>
				Effect.flatMap(bytes, (cap) => recordContent(ctx, cap, chain, at, id)),
			deleteContent: (chain, at, id, by) =>
				Effect.flatMap(bytes, (cap) => recordDelete(ctx, cap, chain, at, id, by)),
		} satisfies RecordShape);
	}),
);

// 3. The host: an Effect Worker that only carries the object Layers. The plain classes, Control
//    and the default fetch stay in brain.ts beside it.
export class Brain extends Cloudflare.Worker<Brain, {}>()("Brain") {}

export default Brain.make(
	{main: import.meta.url},
	Effect.void.pipe(Effect.provide(RecordPartLive)),
);
