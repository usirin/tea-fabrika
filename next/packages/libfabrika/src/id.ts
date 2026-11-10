// next/: TypeIDs with UUIDv7 suffixes. No platform or other libfabrika layer is needed.
import { type Brand, Clock, Context, Effect, Layer, Order as Ordering, Result, Schema as S } from "effect";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const low62 = (1n << 62n) - 1n;
const maxRandom = (1n << 74n) - 1n;
const maxTime = 2 ** 48 - 1;

export type IdValue<P extends string> = Brand.Branded<string, P>;
export type IdSchema<P extends string> = S.Codec<IdValue<P>, string>;

export class IdError extends S.TaggedError<IdError>()("IdError", {
  reason: S.Literals(["prefix", "clock", "entropy", "exhausted"]),
}) {}

const prefixes = new WeakMap<S.Top, string>();

// Fabrika requires a nonempty prefix, with interior underscores and at most 63 characters.
const validPrefix = (prefix: string): boolean => /^[a-z](?:[a-z_]{0,61}[a-z])?$/.test(prefix);

const split = (id: string): readonly [string, string] => {
  const separator = id.lastIndexOf("_");
  return [id.slice(0, Math.max(0, separator)), id.slice(separator + 1)];
};

const valid = (id: string): boolean => {
  const [prefix, suffix] = split(id);

  if (!validPrefix(prefix)) {
    return false;
  }

  if (suffix.length !== 26 || /[^0-9a-hjkmnp-tv-z]/.test(suffix)) {
    return false;
  }

  // The first character has only three bits: the UUID must fit in 128 bits.
  if (alphabet.indexOf(suffix.charAt(0)) > 7) {
    return false;
  }

  const uuid = [...suffix].reduce((bits, char) => (bits << 5n) | BigInt(alphabet.indexOf(char)), 0n);
  return ((uuid >> 76n) & 15n) === 7n && ((uuid >> 62n) & 3n) === 2n;
};

/** Any canonical TypeID containing a UUIDv7. Validation never trims or repairs input. */
export const Schema = S.String.check(S.makeFilter(valid, { expected: "a UUIDv7 TypeID" }));
export type Schema = typeof Schema.Type;

const specific = <const P extends string>(prefix: P) => {
  const a = "[0-9a-hjkmnp-tv-z]";
  const schema = Object.assign(
    S.String.check(S.isPattern(new RegExp(`^${prefix}_[0-7]${a}{9}[ef]${a}{2}[89abrstv]${a}{12}$`))).pipe(
      // Prefixes may come from runtime input; make and makeEffect validate them first.
      S.brand<P>(prefix as Parameters<typeof S.brand<P>>[0]),
    ),
    { prefix } as const,
  );
  prefixes.set(schema, prefix);
  return schema;
};

type Specific<P extends string> = ReturnType<typeof specific<P>>;

/** A schema branded for one trusted prefix. An invalid prefix throws, as Schema.make does. */
export const make = <const P extends string>(prefix: P): Specific<P> => {
  if (!validPrefix(prefix)) {
    throw new IdError({ reason: "prefix" });
  }

  return specific(prefix);
};

/** The factory for a supplied prefix: invalid prefixes fail with a typed IdError. */
export const makeEffect = Effect.fn("id.makeEffect")(function* <const P extends string>(prefix: P) {
  if (!validPrefix(prefix)) {
    return yield* new IdError({ reason: "prefix" });
  }

  return specific(prefix);
});

/** Built-in types. Other programs can declare their own prefixes with make. */
export const Type = S.Literals([
  "ledger",
  "person",
  "process",
  "connection",
  "tab",
  "mailbox",
  "input",
  "letter",
  "cmd",
  "monitor",
  "entry",
  "grant",
  "revoke",
  "add",
  "deny",
]);
export type Type = typeof Type.Type;

export const Ledger = make("ledger");
export const Person = make("person");
export const Process = make("process");
export const Connection = make("connection");
export const Tab = make("tab");
export const Mailbox = make("mailbox");
export const Input = make("input");
export const InputId = Input;
export type InputId = typeof InputId.Type;
export const Letter = make("letter");
export const Cmd = make("cmd");
export const Monitor = make("monitor");
export const Entry = make("entry");
export const Grant = make("grant");
export const Revoke = make("revoke");
export const Add = make("add");
export const Deny = make("deny");

/** Compare UUID suffixes first, with the complete prefix breaking ties. */
export const Order = Ordering.make<Schema>((left, right) => {
  const [lp, ls] = split(left),
    [rp, rs] = split(right);
  return Ordering.String(ls, rs) || Ordering.String(lp, rp);
});

const entropy = (): bigint =>
  crypto.getRandomValues(new Uint8Array(10)).reduce((n, byte) => (n << 8n) | BigInt(byte), 0n) & maxRandom;

// RFC 9562 5.7: 48 clock bits, version 7, 12 random bits, variant 10, 62 random bits.
const encode = (at: number, random: bigint): string => {
  let uuid = (BigInt(at) << 80n) | (7n << 76n) | ((random >> 62n) << 64n) | (2n << 62n) | (random & low62);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = alphabet.charAt(Number(uuid & 31n)) + suffix;
    uuid >>= 5n;
  }

  return suffix;
};

/** One writer's clock and random state, shared across all its ID types. */
export class Generator extends Context.Service<
  Generator,
  {
    readonly next: <P extends string>(schema: IdSchema<P>) => Effect.Effect<IdValue<P>, IdError>;
  }
>()("@kampus/libfabrika/Id.Generator") {
  static readonly layer = Layer.effect(
    Generator,
    Effect.sync(() => {
      let at = -1,
        random = 0n;
      // Keep allocation and validation synchronous so fibers observe IDs in allocation order.
      const allocate = <P extends string>(schema: IdSchema<P>, prefix: string, now: number) => {
        if (!Number.isSafeInteger(now) || now < 0 || now > maxTime) {
          throw new IdError({ reason: "clock" });
        }

        let nextAt = at,
          nextRandom = random;

        if (now > at) {
          nextAt = now;
          nextRandom = entropy();
        } else if (random === maxRandom) {
          if (at === maxTime) {
            throw new IdError({ reason: "exhausted" });
          }

          nextAt++;
          nextRandom = 0n;
        } else {
          nextRandom++;
        }

        at = nextAt;
        random = nextRandom;
        return Result.getOrThrowWith(
          S.decodeUnknownResult(schema)(`${prefix}_${encode(at, random)}`),
          () => new IdError({ reason: "prefix" }),
        );
      };
      return {
        next: Effect.fn("id.next")(function* <P extends string>(schema: IdSchema<P>) {
          const prefix = prefixes.get(schema);

          if (prefix === undefined) {
            return yield* new IdError({ reason: "prefix" });
          }

          yield* Effect.annotateCurrentSpan({ type: prefix });
          const now = yield* Clock.currentTimeMillis;
          return yield* Effect.try({
            try: () => allocate(schema, prefix, now),
            catch: (error) => (error instanceof IdError ? error : new IdError({ reason: "entropy" })),
          });
        }),
      };
    }),
  );
}
