// Serving a parent's children as they appear (experiment 105). A lane starts its children one by
// one, under names it makes as it goes, so no host can be told them up front. Before a parent starts
// a child it writes the child's name in `<parent>/kids`, under its own fence; every host that serves
// the parent reads that stream and serves each name it finds there, once. Whichever host then holds
// a child's lease runs it, as for any registered name.
import {Duration, Effect, Schedule, type Scope} from "effect";
import {Ledger} from "../../host/ledger.ts";

/** The stream a parent names its children in, one row per child, the row's id the child's name. */
export const kidsOf = (parent: string) => `${parent}/kids`;

const EVERY = Schedule.spaced(Duration.millis(200));

/**
 * Serve each child `parent` names, as it names it, until the scope closes. `serve` is the caller's:
 * it serves one child's name (and its agent's, if it has one) in the scope it is given.
 */
export const serveKids = <R>(
	parent: string,
	serve: (kid: string) => Effect.Effect<void, never, Scope.Scope | R>,
) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const served = new Set<string>();
		let rev = 0;
		const once = Effect.gen(function* () {
			const rows = yield* ledger
				.readStream(kidsOf(parent), rev)
				.pipe(Effect.orElseSucceed(() => []));
			for (const row of rows) {
				rev = Math.max(rev, row.rev);
				const kid = row.id;
				if (kid === undefined || kid === null || served.has(kid)) continue;
				served.add(kid);
				yield* serve(kid);
			}
		});
		yield* once.pipe(Effect.repeat({schedule: EVERY}), Effect.forkScoped);
	});
