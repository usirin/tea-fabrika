// Question 5: move a whole server. Every object the server's index names, every row of every
// table, copied to a second server that has none of them; then both sides hash each object and
// the hashes must match. Like `git push -u` to an empty remote: the first sync is a full copy.
//
// The source should take no writes while it runs: the copy reads table by table, not one
// snapshot. A write that lands mid-copy shows up as a hash that does not match.
//
// Both servers are called as their operator. Nothing secret moves: each server keeps its own
// secret, so every session must be minted again on the new one.
import {Effect, Schema} from "effect";
import {type Answer, ask, door, type Server} from "./client.ts";

const Names = Schema.decodeUnknownEffect(Schema.Array(Schema.String));
const Dump = Schema.decodeUnknownEffect(
	Schema.Struct({
		tables: Schema.Array(Schema.String),
		columns: Schema.Array(Schema.String),
		rows: Schema.Array(Schema.Array(Schema.Unknown)),
		last: Schema.Number,
	}),
);
const Digest = Schema.decodeUnknownEffect(
	Schema.Struct({hash: Schema.String, counts: Schema.Record(Schema.String, Schema.Number)}),
);
const Loaded = Schema.decodeUnknownEffect(
	Schema.Struct({ok: Schema.Literal(true), rows: Schema.Number}),
);

export class MoveError extends Schema.TaggedError<MoveError>()("MoveError", {
	object: Schema.String,
	message: Schema.String,
}) {}

/** An answer's body, decoded, or a MoveError that says what came back. */
const bodyAs =
	<A, E>(decode: (u: unknown) => Effect.Effect<A, E>, object: string) =>
	(a: Answer) =>
		decode(a.body).pipe(
			Effect.mapError(
				() =>
					new MoveError({object, message: `${a.status} ${JSON.stringify(a.body).slice(0, 200)}`}),
			),
		);

export interface Moved {
	readonly object: string;
	readonly rows: number;
	readonly tables: Readonly<Record<string, number>>;
	readonly ms: number;
	readonly same: boolean;
	readonly hash: string;
}

/** One object: every table, in pages of `page` rows; then both digests. */
export const moveObject = (from: Server, to: Server, object: string, page = 500) =>
	Effect.gen(function* () {
		const t0 = performance.now();
		const first = yield* door(from, object, `export?table=migrations&after=0&limit=0`).pipe(
			Effect.flatMap(bodyAs(Dump, object)),
		);
		let rows = 0;
		for (const table of first.tables) {
			let after = 0;
			let sent = 0;
			for (;;) {
				const d = yield* door(
					from,
					object,
					`export?table=${table}&after=${after}&limit=${page}`,
				).pipe(Effect.flatMap(bodyAs(Dump, object)));
				if (d.rows.length === 0) break;
				yield* door(to, object, "import", {
					table,
					columns: d.columns,
					rows: d.rows,
					from: sent,
				}).pipe(Effect.flatMap(bodyAs(Loaded, object)));
				sent += d.rows.length;
				after = d.last;
				if (d.rows.length < page) break;
			}
			rows += sent;
		}
		const [a, b] = yield* Effect.all(
			[from, to].map((s) => door(s, object, "digest").pipe(Effect.flatMap(bodyAs(Digest, object)))),
			{concurrency: "unbounded"},
		);
		return {
			object,
			rows,
			tables: a?.counts ?? {},
			ms: performance.now() - t0,
			same: a !== undefined && b !== undefined && a.hash === b.hash,
			hash: a?.hash ?? "",
		} satisfies Moved;
	});

/** The names in a server's index: every object that ever took an allowed call. */
export const objectsOf = (server: Server) =>
	ask(server, "index").pipe(Effect.flatMap(bodyAs(Names, "index")));

/** Every object of `from`, onto `to`, a few at once. */
export const moveServer = (from: Server, to: Server, concurrency = 4, page = 500) =>
	Effect.gen(function* () {
		const t0 = performance.now();
		const names = yield* objectsOf(from);
		const moved = yield* Effect.forEach(names, (n) => moveObject(from, to, n, page), {concurrency});
		const after = yield* objectsOf(to);
		return {
			objects: moved,
			ms: performance.now() - t0,
			rows: moved.reduce((n, m) => n + m.rows, 0),
			allSame: moved.every((m) => m.same),
			sameIndex: JSON.stringify([...after].sort()) === JSON.stringify([...names].sort()),
		};
	});
