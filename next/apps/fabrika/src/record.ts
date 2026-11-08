import {type Chain, recordPart} from "@kampus/libfabrika/data";
import {workerSql} from "@kampus/libfabrika/workers";
import {Effect, Schema} from "effect";
import {settings, type Env} from "./runtime.ts";

type Part = ReturnType<typeof recordPart>;
type Rows = Parameters<Part["write"]>[0];
type Deletion = Parameters<Part["deleteContent"]>[1];
const part = (ctx: DurableObjectState, env: Env, chain: Chain, at: number) => {
	const [, name] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String]))(
		JSON.parse(Schema.decodeUnknownSync(Schema.String)(ctx.id.name)),
	);
	const expected = chain._tag === "spans" ? `spans/${at}` : `job/${chain.process}/${at}`;
	if (name !== expected) throw new Error("wrong record part");
	return recordPart(
		workerSql(ctx.storage),
		chain,
		at,
		settings(env).limits?.recordBytes ?? 1_000_000_000,
	);
};
export const recordWrite = Effect.fn(function* (
	ctx: DurableObjectState,
	env: Env,
	chain: Chain,
	at: number,
	rows: Rows,
) {
	return yield* part(ctx, env, chain, at).write(rows);
});
export const recordRead = Effect.fn(function* (
	ctx: DurableObjectState,
	env: Env,
	chain: Chain,
	at: number,
	after: number,
) {
	return yield* part(ctx, env, chain, at).read(after);
});
export const recordContent = Effect.fn(function* (
	ctx: DurableObjectState,
	env: Env,
	chain: Chain,
	at: number,
	id: string,
) {
	return yield* part(ctx, env, chain, at).content(id);
});
export const recordDelete = Effect.fn(function* (
	ctx: DurableObjectState,
	env: Env,
	chain: Chain,
	at: number,
	id: string,
	by: Deletion,
) {
	return yield* part(ctx, env, chain, at).deleteContent(id, by);
});
