// Where a person's keys come from: the two questions the door asks about a person. The door never
// calls GitHub, or anything else, itself. It asks `Keys`, and a Layer answers.
//
//   const k = yield* Keys
//   yield* k.byId("github:7")
//   // {id: "github:7", name: "alice", keys: ["ssh-ed25519 AAAA..."]}   who has that id, by the
//   //                                                                   name they go by now
//   // null                                                             nobody has it
//   // KeysUnreachable                                                  could not be had: try later
//   yield* k.of("alice")   // the same answer, for whoever goes by "alice" now
//
// The door signs a person in with `byId`: it finds the typed name among the people this ledger
// already knows, and asks only about their ids. A name this ledger does not know is never asked
// about. `of` is for an invite, the one step that brings a new person in: it binds a name to an
// id once, and from then on the ledger goes by the id.
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

/** A person as a keys service knows them: their id, the name they go by now, and their keys. */
export const Signers = Schema.Struct({
	/** Never changes while the person is the same, and names its service first: `github:7`. */
	id: Schema.String,
	/** The name they go by at the service now (on GitHub, their login). It may change. */
	name: Schema.String,
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
		/** Who has the id `id`, and the keys that may sign for them; null: nobody does. */
		readonly byId: (id: string) => Effect.Effect<Signers | null, KeysUnreachable>;
		/** Who goes by `name` now, and the keys that may sign for them; null: nobody does. */
		readonly of: (name: string) => Effect.Effect<Signers | null, KeysUnreachable>;
	}
>()("@kampus/fabrika/Keys") {}

/** Nobody has any id or name: for a door that asks nobody's keys (a local one, or a closed one). */
export const layerNobody: Layer.Layer<Keys> = Layer.succeed(
	Keys,
	Keys.of({byId: () => Effect.succeed(null), of: () => Effect.succeed(null)}),
);
