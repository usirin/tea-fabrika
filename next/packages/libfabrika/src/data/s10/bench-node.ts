// S10 spike, never merged. One append (one turn) on Node, in memory, on three routes.
//   node src/data/s10/bench-node.ts      RUNS=5 TURNS=1000
import {DatabaseSync} from "node:sqlite";
import {SqliteClient} from "@effect/sql-sqlite-node";
import {Effect, Layer, Scope} from "effect";
import {SqlClient} from "effect/sql";
import {ledgerStore} from "../ledger-store.ts";
import {Doorbell} from "../ledger.ts";
import {nodeSql} from "../sqlite.ts";
import {nodeTurn} from "./harness.ts";
import {refereeOnSqlClient} from "./store-effect-sql.ts";
import {withSyncTurn} from "./sync-turn.ts";

const RUNS = Number(process.env["RUNS"] ?? 5);
const TURNS = Number(process.env["TURNS"] ?? 1000);
const bell = {ring: () => Effect.void};
const line = (n: number) => ({
	by: "SHA256:writer-a",
	for: "owner",
	sentAt: "2026-11-07T21:10:01.204Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "b-7c1d073",
	_tag: "saved",
	body: {note: "n-7f3a", base: n},
});
const memory = SqliteClient.layer({filename: ":memory:"}).pipe(Layer.orDie);
const synced = Layer.effect(
	SqlClient.SqlClient,
	Effect.map(SqlClient.SqlClient, (client) => withSyncTurn(client, nodeTurn(client))),
).pipe(Layer.provide(memory));
const onClient = (layer: Layer.Layer<SqlClient.SqlClient>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const context = yield* Layer.buildWithScope(layer, yield* Scope.make());
			return yield* refereeOnSqlClient.pipe(
				Effect.provideContext(context),
				Effect.provideService(Doorbell, bell),
			);
		}),
	);
const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (n: number) => Math.round(n * 10) / 10;

const routes = {
	S: Promise.resolve(ledgerStore(nodeSql(new DatabaseSync(":memory:")), bell)),
	E: onClient(memory),
	Es: onClient(synced),
};

for (const [route, making] of Object.entries(routes)) {
	const store = await making;
	const one = (n: number) => store.append(`s${n % 3}`, `w-${n}`, line(n));
	const sync = (() => {
		try {
			return Effect.runSync(one(0))._tag;
		} catch (error) {
			return String(error).slice(0, 80);
		}
	})();

	for (let n = 1; n <= 200; n++) {
		await Effect.runPromise(one(n));
	}

	const perTurn: Array<number> = [];

	for (let run = 0; run < RUNS; run++) {
		const from = 1000 + run * TURNS;
		const started = performance.now();
		await Effect.runPromise(
			Effect.forEach(
				Array.from({length: TURNS}, (_, i) => from + i),
				(n) => one(n),
				{discard: true},
			),
		);
		perTurn.push(((performance.now() - started) / TURNS) * 1000);
	}

	process.stdout.write(
		`${JSON.stringify({probe: "bench.node", value: {route, runs: RUNS, turns: TURNS, runSyncOfOneAppend: sync, microsPerTurn: {median: round(median(perTurn)), min: round(Math.min(...perTurn)), max: round(Math.max(...perTurn))}}})}\n`,
	);
}

process.exit(0);
