/**
 * The permission core (0526): one model declared once, a right as a typed class whose check gives
 * a sealed proof tied to the one object it checked, the refusal that says who, what and on which
 * object, and the recheck of a proof on newer rows.
 *
 * **Example** (Declare a model and a right, check it, and provide the proof)
 *
 * ```ts
 * import * as Rebac from "@kampus/libfabrika/permissions/Rebac"
 *
 * const Model = Rebac.make("fabrika")
 *   .type("person", {})
 *   .type("fabrika", {
 *     relations: { owner: ["person"], admin: ["person"], member: ["person"] },
 *     permissions: { start: (p) => p.union("owner", "admin", "member") },
 *   })
 *
 * class StartProgram extends Rebac.Permission<StartProgram>()("permissions/StartProgram", {
 *   model: Model,
 *   on: "fabrika",
 *   permission: "start",
 * }) {}
 * ```
 *
 * @stability unstable
 */
import { Context, Effect, Result, Schema } from "effect";
import { type Declared, holds } from "./internal/evaluate.ts";
import * as proofs from "./internal/proof.ts";
import type { Tuples } from "./Relation.ts";
import type { Sender } from "./Senders.ts";

/**
 * A ref to one object of a declared type, written `type:id`, such as `fabrika:demo`.
 *
 * @stability unstable
 * @category models
 */
export type Ref<T extends string> = `${T}:${string}`;

/**
 * The proof a right's check gives: who was checked, for which permission, on which one object.
 *
 * **Details**
 *
 * It is keyed by its right, so one right's proof is not another's. Only a passed check makes one:
 * it is not a Schema, so nothing decodes one, and a literal of its fields is not one.
 *
 * @stability unstable
 * @category models
 */
export type Proof<P> = proofs.Proof<P>;

/**
 * How one permission is made of names on the same object. Made only by `Rewrites`.
 *
 * @stability unstable
 * @category models
 */
export interface Rewrite {
  /** The names whose holders together hold the permission. */
  readonly union: ReadonlyArray<string>;
}

/**
 * The rewrites a permission may be written with, over the names its type declares.
 *
 * @stability unstable
 * @category models
 */
export interface Rewrites<Names extends string> {
  /** The subject holds any of these relations or permissions on the same object (Zanzibar's union). */
  readonly union: (...names: ReadonlyArray<Names>) => Rewrite;
}

/**
 * The names one declared type carries at the type level: its relations and its permissions.
 *
 * @stability unstable
 * @category models
 */
export interface Names {
  readonly relations: string;
  readonly permissions: string;
}

/**
 * A model: every object type with its relations and permissions, declared once as one value. Its
 * types carry every name, so a name it does not declare does not compile.
 *
 * **Details**
 *
 * `type` adds one object type. A relation lists the types that may hold it, which are the types
 * declared before it and the type itself. A permission is a rewrite over the type's own relation
 * and permission names. `ref` writes a `type:id` ref to an object of a declared type.
 *
 * @stability unstable
 * @category models
 */
export interface Model<Types extends Record<string, Names>> {
  readonly name: string;
  readonly type: <
    const T extends string,
    const R extends Record<string, ReadonlyArray<(keyof Types & string) | T>> = Record<never, never>,
    P extends string = never,
  >(
    name: T,
    shape: {
      readonly relations?: R;
      readonly permissions?: { readonly [K in P]: (p: Rewrites<(keyof R & string) | P>) => Rewrite };
    },
  ) => Model<Types & { readonly [K in T]: { readonly relations: keyof R & string; readonly permissions: P } }>;
  readonly ref: <T extends keyof Types & string>(type: T, id: string) => Ref<T>;
}

/** What each model declared, kept beside it for the rights built on it. */
const declarations = new WeakMap<object, ReadonlyMap<string, Declared>>();

const rewrites: Rewrites<string> = { union: (...names) => ({ union: names }) };

const build = <Types extends Record<string, Names>>(
  name: string,
  declared: ReadonlyMap<string, Declared>,
): Model<Types> => {
  const model: Model<Types> = {
    name,
    type: (type, shape) =>
      build(
        name,
        new Map(declared).set(type, {
          relations: new Set(Object.keys(shape.relations ?? {})),
          permissions: new Map(
            Object.entries<(p: Rewrites<string>) => Rewrite>(shape.permissions ?? {}).map(([permission, rewrite]) => [
              permission,
              rewrite(rewrites).union,
            ]),
          ),
        }),
      ),
    ref: (type, id) => `${type}:${id}`,
  };
  declarations.set(model, declared);
  return model;
};

/**
 * Starts a model with no types. Each `type` call gives a new model with one more type.
 *
 * @stability unstable
 * @category constructors
 */
export const make = (name: string): Model<Record<never, Names>> => build(name, new Map());

/**
 * The refusal of a check: the subject that was checked, the permission it was checked for, and the
 * object it was checked on, exactly as asked.
 *
 * **Details**
 *
 * An agent is checked as its person, so `subject` is `person:<for>` for both kinds of sender.
 *
 * @stability unstable
 * @category errors
 */
export class Denied extends Schema.TaggedError<Denied>()("Denied", {
  /** Who was checked, such as `person:person_01jc…`. */
  subject: Schema.String,
  /** The permission it was checked for, such as `start`. */
  permission: Schema.String,
  /** The object it was checked on, such as `fabrika:demo`. */
  object: Schema.String,
}) {}

/**
 * A right: the context key its proof rides under, and its check.
 *
 * **Details**
 *
 * `within(tuples, sender, object)` checks the sender's person for the right's permission on one
 * object of the right's type, over the tuples of the caller's own ledger turn, and answers a proof
 * tied to that object or `Denied`. The right's `Id` stays a literal, so two rights' proofs are two
 * types (phoenix issue 1483).
 *
 * @stability unstable
 * @category models
 */
export type Right<Self, Id extends string, On extends string> = Context.ServiceClass<Self, Id, Proof<Self>> & {
  readonly within: (tuples: Tuples, sender: Sender, object: Ref<On>) => Result.Result<Proof<Self>, Denied>;
};

/** Each right's check, by the key its proofs carry, for `recheck`. */
const checks = new WeakMap<object, (tuples: Tuples, subject: string, object: string) => boolean>();

/** The subject a sender is checked as: its person, for an agent too (0526's cap). */
const subjectFor = (sender: Sender): string => `person:${sender.for}`;

/**
 * Bridges a built context class to the right's own `Self`. The one audited cast of the module, as
 * phoenix's `sealCapability`: the class names itself as its service `Self`, and its users see the
 * `Self` they declared.
 */
const seal = <T>(tag: unknown): T => tag as T;

/**
 * Builds a right on a model: a class that is the context key of its proof and holds its check.
 *
 * **Details**
 *
 * `on` must be a type the model declares and `permission` one of that type's permissions; neither
 * is a free string. The `Self` curry names the proof type from the one declaration.
 *
 * **Example** (A right to start a program on a fabrika)
 *
 * ```ts
 * import { Model } from "@kampus/libfabrika/permissions/Model"
 * import * as Rebac from "@kampus/libfabrika/permissions/Rebac"
 *
 * class StartProgram extends Rebac.Permission<StartProgram>()("permissions/StartProgram", {
 *   model: Model,
 *   on: "fabrika",
 *   permission: "start",
 * }) {}
 * ```
 *
 * @stability unstable
 * @category constructors
 */
export const Permission =
  <Self>() =>
  <
    const Id extends string,
    Types extends Record<string, Names>,
    const On extends keyof Types & string,
    const P extends Types[On]["permissions"],
  >(
    id: Id,
    config: { readonly model: Model<Types>; readonly on: On; readonly permission: P },
  ): Right<Self, Id, On> => {
    const { permission } = config;
    const declared = declarations.get(config.model)?.get(config.on);
    const check = (tuples: Tuples, subject: string, object: string): boolean =>
      declared !== undefined && holds(declared, tuples, subject, permission, object);

    // oxlint-disable-next-line fabrika/service-id -- a right's id is its own declaration's, handed in by the class that calls this builder, never this file's path.
    class Tag extends Context.Service<Tag, Proof<Self>>()(id) {}
    const key = seal<Context.ServiceClass<Self, Id, Proof<Self>>>(Tag);
    checks.set(key, check);

    return Object.assign(key, {
      within: (tuples: Tuples, sender: Sender, object: Ref<On>): Result.Result<Proof<Self>, Denied> => {
        const subject = subjectFor(sender);
        return check(tuples, subject, object)
          ? Result.succeed(proofs.mint(sender, permission, object, key))
          : Result.fail(new Denied({ subject, permission, object }));
      },
    });
  };

/**
 * Puts a proof into the context under its own right's key, so an Effect that needs that right no
 * longer does. A proof of another right leaves the requirement in place.
 *
 * @stability unstable
 * @category combinators
 */
export const provide =
  <P>(proof: Proof<P>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, P>> =>
    Effect.provideService(self, proofs.keyFor(proof), proof);

/**
 * Checks a proof again on newer tuples: its own sender, permission and object, never another's.
 *
 * **Details**
 *
 * The check that writes runs it in its own ledger turn, so a relation removed after the proof was
 * made refuses the write (Zanzibar's new-enemy problem, with one referee).
 *
 * @stability unstable
 * @category combinators
 */
export const recheck = (proof: Proof<unknown>, tuples: Tuples): boolean =>
  checks.get(proofs.keyFor(proof))?.(tuples, subjectFor(proof.sender), proof.object) ?? false;
