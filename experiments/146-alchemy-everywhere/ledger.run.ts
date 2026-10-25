// Spike 4's stack: a resource whose provider asks for the repo's own typed service, `Ledger` from
// @kampus/fabrika, and gets it from the repo's own Layer, `layerSqliteSync`, over a file in the
// driver's temp folder. The stack itself runs on the Effect copy in this folder's node_modules;
// @kampus/fabrika resolves through the workspace to packages/fabrika, which brings the root's
// copy. Both are effect 4.0.6, two copies on disk. Does a service, a Layer and an error cross?
//
//   const name = yield* Name("triage", {stream: "triage", writer: "exp146"});
//
// A ledger forgets nothing, so `delete` cannot undo a registration: it only drops Alchemy's row.
import {Ledger} from "@kampus/fabrika";
import {layerSqliteSync} from "@kampus/fabrika/sqlite";
import * as Alchemy from "alchemy";
import * as Provider from "alchemy/Provider";
import {Resource} from "alchemy/Resource";
import {Config, Effect, Layer} from "effect";

export type Name = Resource<
	"Fabrika.Name",
	{readonly stream: string; readonly writer: string},
	{
		readonly stream: string;
		readonly created: boolean;
		readonly rev: number;
		readonly events: number;
	}
>;
export const Name = Resource<Name>("Fabrika.Name");

export const NameProvider = () =>
	Provider.effect(
		Name,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const eventsIn = (stream: string) =>
				ledger.readStream(stream, 0, -1).pipe(Effect.map((rows) => rows.length));
			return Name.Provider.of({
				list: () => Effect.succeed([]),
				read: ({olds}) =>
					eventsIn(olds.stream).pipe(
						Effect.map((events) =>
							events === 0 ? undefined : {stream: olds.stream, created: false, rev: events, events},
						),
						Effect.orDie,
					),
				reconcile: ({news}) =>
					Effect.gen(function* () {
						const r = yield* ledger.register(news.stream, news.writer);
						return {
							stream: news.stream,
							created: r.created,
							rev: r.rev,
							events: yield* eventsIn(news.stream),
						};
					}).pipe(
						// The ledger's own tagged errors, caught by tag from the other Effect copy.
						Effect.catchTag("Denied", (e) => Effect.die(`denied on ${e.stream}`)),
						Effect.orDie,
					),
				delete: () => Effect.void,
			});
		}),
	);

export default Alchemy.Stack(
	"exp146-ledger",
	{
		providers: Layer.unwrap(
			Effect.gen(function* () {
				const path = yield* Config.String("LEDGER_FILE");
				return NameProvider().pipe(Layer.provide(layerSqliteSync({path})));
			}),
		).pipe(
			// A stack's providers may not fail: a missing LEDGER_FILE ends the run.
			Layer.orDie,
		),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const stream = yield* Config.String("LEDGER_STREAM").pipe(Config.withDefault("triage"));
		const name = yield* Name("triage", {stream, writer: yield* Config.String("LEDGER_WRITER")});
		return {created: name.created, rev: name.rev, events: name.events};
	}),
);
