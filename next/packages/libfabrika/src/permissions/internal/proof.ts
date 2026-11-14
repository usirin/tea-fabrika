/**
 * The sealed proof a right's check gives, and the one way to make one. Only `Rebac.ts` imports
 * this file; no other module may (`fabrika/modules`).
 *
 * @stability unstable
 */
import type { Context } from "effect";
import type { Sender } from "../Senders.ts";

const ProofTypeId: unique symbol = Symbol.for("@kampus/libfabrika/permissions/Proof");

// Module-local, never `Symbol.for`: the right's key, stamped on a proof at mint and read by
// `provide`. Nothing outside this file can name it, and it is not enumerable, so it is neither in
// the proof's type nor in any copy of its fields.
const KeyId: unique symbol = Symbol("@kampus/libfabrika/permissions/Proof/key");

/**
 * The proof that a right's check passed, keyed by the right `P` so one right's proof does not
 * satisfy another. It is not a Schema, so nothing decodes one.
 *
 * @internal
 */
export interface Proof<out P> {
  readonly [ProofTypeId]: P;
  /** Who was checked, both ids kept (0261). */
  readonly sender: Sender;
  /** The permission that was checked. */
  readonly permission: string;
  /** The one object this proof is for. */
  readonly object: string;
}

type Keyed<P> = Proof<P> & { readonly [KeyId]: Context.Key<P, Proof<P>> };

/**
 * The one way to make a proof: a check that passed.
 *
 * @internal
 */
export const mint = <P>(
  sender: Sender,
  permission: string,
  object: string,
  key: Context.Key<P, Proof<P>>,
): Proof<P> => {
  const proof = { [ProofTypeId]: true, sender, permission, object };
  Object.defineProperty(proof, KeyId, { value: key, enumerable: false });
  // The one audited cast: the phantom right `P` is a type only, and the key is stamped just above.
  return proof as Keyed<P>;
};

/**
 * The right's key a proof was minted under.
 *
 * @internal
 */
export const keyFor = <P>(proof: Proof<P>): Context.Key<P, Proof<P>> => {
  // The stamp `mint` made; a value of this type comes only from `mint`.
  const keyed = proof as Keyed<P>;
  return keyed[KeyId];
};
