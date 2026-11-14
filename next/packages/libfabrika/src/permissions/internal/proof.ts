/**
 * The sealed proof a right's check gives, and the one way to make one. Only `Rebac.ts` imports
 * this file; no other module may (`fabrika/modules`).
 *
 * @stability unstable
 */
import type { Context } from "effect";
import type { Sender } from "../Senders.ts";

/**
 * The proof that a right's check passed, keyed by the right `P` so one right's proof does not
 * satisfy another. It is not a Schema, so nothing decodes one.
 *
 * **Details**
 *
 * The seal is the private field `#key`, the right's context key. A private field is nominal: an
 * object literal cannot have it, and a spread does not copy it, in the type or at run time, so a
 * copy of a proof's fields, changed or not, is no proof. The constructor is private, so `mint` is
 * the one way in. `P` is covariant through the key's own type, so any proof widens to
 * `Proof<unknown>` for reading, and `provide` refuses that widened type.
 *
 * @internal
 */
export class Proof<P> {
  readonly #key: Context.Key<P, Proof<P>>;
  /** Who was checked, both ids kept (0261). */
  readonly sender: Sender;
  /** The permission that was checked. */
  readonly permission: string;
  /** The one object this proof is for. */
  readonly object: string;

  private constructor(sender: Sender, permission: string, object: string, key: Context.Key<P, Proof<P>>) {
    this.#key = key;
    this.sender = sender;
    this.permission = permission;
    this.object = object;
  }

  /** The one way to make a proof: a check that passed. */
  static mint<P>(sender: Sender, permission: string, object: string, key: Context.Key<P, Proof<P>>): Proof<P> {
    return new Proof(sender, permission, object, key);
  }

  /** The right's key a proof was minted under. */
  static key<P>(proof: Proof<P>): Context.Key<P, Proof<P>> {
    return proof.#key;
  }
}

/**
 * The one way to make a proof: a check that passed.
 *
 * @internal
 */
export const mint = <P>(sender: Sender, permission: string, object: string, key: Context.Key<P, Proof<P>>): Proof<P> =>
  Proof.mint(sender, permission, object, key);

/**
 * The right's key a proof was minted under.
 *
 * @internal
 */
export const keyFor = <P>(proof: Proof<P>): Context.Key<P, Proof<P>> => Proof.key(proof);
