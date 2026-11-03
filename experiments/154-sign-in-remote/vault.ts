// The box's vault: the PKCE verifier while the sign-in is open, then the pass. In memory only, in
// this one process, each value `Redacted` so a log or an inspect prints `<redacted>`. Nothing in
// it is ever written to a file, the ledger or a log.
//
// Two rules are held here, not by the callers:
//   - the verifier is taken once: a second trade in the same box has no verifier to send;
//   - once closed, the vault stays empty: a trade that lands after the box was told to end
//     cannot put a pass back, and `put` answers `false` so its caller revokes what it got.
import {Context, Effect, type Redacted} from "effect";

export interface Pending {
	readonly verifier: Redacted.Redacted<string>;
	readonly redirect: string;
	/** The client the URL was made with: `dynamic_agent_client`, or a saved issued id. */
	readonly client: string;
}

export interface Held {
	readonly access: Redacted.Redacted<string>;
	/** `null`: a pass with no renewal key, way (b) or way (c). */
	readonly refresh: Redacted.Redacted<string> | null;
	/** The issued client id, which refresh and revoke name. Not a secret. */
	readonly client: string;
	readonly expiresAt: number;
}

export class Vault extends Context.Service<
	Vault,
	{
		readonly open: (p: Pending) => Effect.Effect<void>;
		readonly takePending: Effect.Effect<Pending | null>;
		readonly put: (h: Held) => Effect.Effect<boolean>;
		readonly held: Effect.Effect<Held | null>;
		/** Empty it for good. Answers what was held, so the caller can revoke it. */
		readonly close: Effect.Effect<Held | null>;
	}
>()("exp154/Vault") {}

export const makeVault = () => {
	let pending: Pending | null = null;
	let held: Held | null = null;
	let closed = false;
	return Vault.of({
		open: (p) =>
			Effect.sync(() => {
				// A pass may still be held: way (b) signs in again before the old pass ends.
				if (!closed && pending === null) pending = p;
			}),
		takePending: Effect.sync(() => {
			const p = pending;
			pending = null;
			return p;
		}),
		put: (h) =>
			Effect.sync(() => {
				if (closed) return false;
				held = h;
				return true;
			}),
		held: Effect.sync(() => held),
		close: Effect.sync(() => {
			const h = held;
			closed = true;
			pending = null;
			held = null;
			return h;
		}),
	});
};
