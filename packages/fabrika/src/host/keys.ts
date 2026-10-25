// Where a person's keys come from: the one question the door asks about a person. The door never
// calls GitHub, or anything else, itself. It asks `Keys`, and a Layer answers.
//
//   const who = yield* (yield* Keys).of("alice")
//   // {id: "github:7", keys: ["ssh-ed25519 AAAA..."]}   who goes by "alice", and what may sign for them
//   // null                                              nobody goes by "alice"
//   // KeysUnreachable                                   the answer could not be had: try again later
//
// Two answers to it, the first built:
//
//   layerGitHub   `keys-github.ts`: the keys GitHub lists for a login, and GitHub's numeric id
//   on the ledger each person puts their own public keys on the ledger, like OpenSSH's allowed
//                 signers list (ssh-keygen ALLOWED SIGNERS). Not built.
//
// The id is the service's, and it is what the ledger keeps: in a member's facts, a session and
// every writer. So it must not change while the person stays the same (a GitHub login may be
// renamed; GitHub's numeric id never is), and two services must never give the same id: each
// starts its ids with its own name (`github:<n>`).
import {Context, Effect, Layer, Schema} from "effect";

/** Who goes by a name, as a keys service knows them: their id, and the keys that may sign for them. */
export const Signers = Schema.Struct({
	/** Never changes while the person is the same, and names its service first: `github:7`. */
	id: Schema.String,
	/** Public keys as key lines (`ssh-ed25519 AAAA...`). Any one of them may sign for the person. */
	keys: Schema.Array(Schema.String),
});
export type Signers = typeof Signers.Type;

/** The keys service could not be asked, or did not answer as it should. */
export class KeysUnreachable extends Schema.TaggedError<KeysUnreachable>()("KeysUnreachable", {
	why: Schema.String,
}) {}

export class Keys extends Context.Service<
	Keys,
	{
		/** Who goes by `name`, and the keys that may sign for them; null: nobody does. */
		readonly of: (name: string) => Effect.Effect<Signers | null, KeysUnreachable>;
	}
>()("@kampus/fabrika/Keys") {}

/** Nobody goes by any name: for a door that asks nobody's keys (a local one, or a closed one). */
export const layerNobody: Layer.Layer<Keys> = Layer.succeed(
	Keys,
	Keys.of({of: () => Effect.succeed(null)}),
);
