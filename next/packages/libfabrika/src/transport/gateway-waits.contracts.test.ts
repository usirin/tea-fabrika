// P12, next/. Real Gateway connection and P6 rings, with saved attachments as the platform keeps them.
import {DatabaseSync} from "node:sqlite";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Schema} from "effect";
import {Doorbell, Ledger, LedgerError, lineFor, Referee} from "../data/index.ts";
import {nodeSql} from "../data/sqlite.ts";
import {connection} from "./gateway.ts";
import {Answer, Attached} from "./wire.ts";

const fixture = <E>(wait: Parameters<typeof connection<E>>[0]["wait"]) => {
	let attached: typeof Attached.Type = Attached.cases.online.make({
		client: "client",
		who: {key: "SHA256:window", person: "person", as: "window"},
		version: 1,
		waits: [],
		watching: false,
		busy: false,
	});
	const frames: Array<unknown> = [];
	const c = connection({
		reader: "gateway",
		session: "session",
		ping: () => null,
		read: () => attached,
		save: (value) => {
			attached = value;
		},
		send: (text) => {
			frames.push(JSON.parse(text));
		},
		close: () => {},
		wait,
		call: () => Effect.succeed(Answer.cases.ok.make({result: null})),
	});
	return {c, frames, saved: () => attached};
};
const waitFrame = (id: string, after: number) =>
	JSON.stringify({jsonrpc: "2.0", id, method: "ledger.wait", params: {stream: "facts", after}});
describe("P12 durable wait contracts", () => {
	it.effect("a refused wait registration answers its request and removes the saved wait", () =>
		Effect.gen(function* () {
			const f = fixture(() => Effect.fail(new LedgerError({why: "unreachable"})));
			yield* Effect.exit(f.c.frame(waitFrame("refused", 0)));
			expect.soft(f.frames).toMatchObject([{id: "refused", error: {data: {why: "unreachable"}}}]);
			expect.soft(f.saved()).toMatchObject({waits: []});
			yield* f.c.ring("facts", 1);
			expect(f.frames).toHaveLength(1);
		}),
	);
	it.effect("each wait on a stream receives its first revision after its own cursor", () =>
		Effect.gen(function* () {
			const db = new DatabaseSync(":memory:"),
				sql = nodeSql(db);
			try {
				let ring: ReturnType<typeof connection>["ring"] = () => Effect.void;
				const layer = Layer.mergeAll(Referee.layer(sql), Ledger.sql(sql, {reader: "writer"})).pipe(
					Layer.provide(
						Layer.succeed(Doorbell, {ring: (_reader, stream, rev) => ring(stream, rev)}),
					),
				);
				yield* Effect.gen(function* () {
					const referee = yield* Referee,
						ledger = yield* Ledger;
					const f = fixture(referee.wait);
					ring = f.c.ring;
					yield* f.c.frame(waitFrame("early", 0));
					yield* f.c.frame(waitFrame("later", 100));
					for (let n = 1; n <= 101; n++)
						yield* ledger.append(
							"facts",
							`fact-${n}`,
							lineFor(
								{
									by: "writer",
									for: "person",
									sentAt: "2026-11-08T00:00:00Z",
									seen: 0,
									parent: null,
									traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
									build: "build",
								},
								Schema.TaggedStruct("noted", {n: Schema.Int}).make({n}),
							),
						);
					expect.soft(f.frames).toEqual([
						{jsonrpc: "2.0", id: "early", result: {rev: 1}},
						{jsonrpc: "2.0", id: "later", result: {rev: 101}},
					]);
					expect(f.saved()).toMatchObject({waits: []});
				}).pipe(Effect.provide(layer));
			} finally {
				db.close();
			}
		}),
	);
});
