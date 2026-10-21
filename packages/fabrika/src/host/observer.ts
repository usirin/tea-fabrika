// The read-only attach: who holds a name, under which fence, until when, and its last saved
// state. Erlang's `whereis/1` and `sys:get_state/1`, read from the ledger. It writes nothing and
// needs no lease, so it can run anywhere the ledger answers, beside the hosts or far from them.
import {Effect, type Schema} from "effect";
import {lastStateOf} from "./journal.ts";
import {Ledger, streams} from "./ledger.ts";

export interface Whereis {
	readonly name: string;
	/** `false`: nobody registered it. */
	readonly registered: boolean;
	/** The holder of the last claim, or `null`: never claimed. */
	readonly holder: string | null;
	readonly fence: number | null;
	readonly expiresAt: number | null;
	/** The lease is live now, by the reader's clock. */
	readonly live: boolean;
	/** The registry stream's last rev: claims, expiries and cancels so far. */
	readonly rev: number;
}

/** Who holds `name` now. */
export const whereis = (name: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const registry = yield* ledger.readStream(streams(name).registry);
		const lease = yield* ledger.lease(name);
		const w: Whereis = {
			name,
			registered: registry.some((r) => r.kind === "registered"),
			holder: lease?.holder ?? null,
			fence: lease?.fence ?? null,
			expiresAt: lease?.expires_at ?? null,
			live: lease !== null && lease.expires_at > Date.now(),
			rev: registry.at(-1)?.rev ?? 0,
		};
		return w;
	});

/** `name`'s last saved state, decoded with its Schema, and the fence that saved it. */
export const getState = <S>(name: string, schema: Schema.Codec<S, unknown>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const rows = yield* ledger.readLast(streams(name).state, 1);
		return {...lastStateOf(schema)(rows), savedBy: rows.at(-1)?.writer ?? null};
	});
