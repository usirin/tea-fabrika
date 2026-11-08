// next/: TypeIDs with UUIDv7 suffixes. No platform or other libfabrika layer is needed.
import {type Brand, Clock, Context, Effect, Layer, Order as Ordering, Schema as S} from "effect";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const low62 = (1n << 62n) - 1n;
const maxRandom = (1n << 74n) - 1n;

// TypeID 0.3.0 allows an empty prefix and interior underscores, up to 63 characters.
const validPrefix = (prefix: string): boolean =>
	prefix === "" ||
	(prefix.length <= 63 &&
		!/[^a-z_]/.test(prefix) &&
		!prefix.startsWith("_") &&
		!prefix.endsWith("_"));
const Prefix = S.String.check(S.makeFilter(validPrefix, {expected: "a TypeID prefix"}));

const split = (id: string): readonly [string, string] => {
	const separator = id.lastIndexOf("_");
	return [id.slice(0, Math.max(0, separator)), id.slice(separator + 1)];
};

const valid = (id: string): boolean => {
	const [prefix, suffix] = split(id);
	if (!validPrefix(prefix) || (prefix === "" && id.includes("_"))) return false;
	if (suffix.length !== 26 || /[^0-9a-hjkmnp-tv-z]/.test(suffix)) return false;
	// The first character has only three bits: the UUID must fit in 128 bits.
	if (alphabet.indexOf(suffix.charAt(0)) > 7) return false;
	const uuid = [...suffix].reduce(
		(bits, char) => (bits << 5n) | BigInt(alphabet.indexOf(char)),
		0n,
	);
	return ((uuid >> 76n) & 15n) === 7n && ((uuid >> 62n) & 3n) === 2n;
};

/** Any canonical TypeID containing a UUIDv7. Validation never trims or repairs input. */
export const Schema = S.String.check(S.makeFilter(valid, {expected: "a UUIDv7 TypeID"}));
export type Schema = typeof Schema.Type;

const specific = <const P extends string>(prefix: P) =>
	Object.assign(
		Schema.pipe(
			S.refine((id): id is string & Brand.Brand<P> => split(id)[0] === prefix, {
				expected: `a TypeID with prefix ${JSON.stringify(prefix)}`,
			}),
		),
		{prefix} as const,
	);
type Specific<P extends string> = ReturnType<typeof specific<P>>;

/** A schema branded for one trusted prefix. An invalid prefix throws, as Schema.make does. */
export const make = <const P extends string>(prefix: P): Specific<P> => {
	Prefix.make(prefix);
	return specific(prefix);
};

/** The factory for a supplied prefix: validation stays in Effect's typed Issue channel. */
export const makeEffect = Effect.fn("id.makeEffect")(function* <const P extends string>(prefix: P) {
	yield* Prefix.makeEffect(prefix);
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
	crypto.getRandomValues(new Uint8Array(10)).reduce((n, byte) => (n << 8n) | BigInt(byte), 0n) &
	maxRandom;

// RFC 9562 5.7: 48 clock bits, version 7, 12 random bits, variant 10, 62 random bits.
const encode = (at: number, random: bigint): string => {
	let uuid =
		(BigInt(at) << 80n) | (7n << 76n) | ((random >> 62n) << 64n) | (2n << 62n) | (random & low62);
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
		readonly next: <P extends string>(schema: Specific<P>) => Effect.Effect<Specific<P>["Type"]>;
	}
>()("@kampus/libfabrika/Id.Generator") {
	static readonly layer = Layer.effect(
		Generator,
		Effect.sync(() => {
			let at = -1,
				random = 0n;
			return {
				next: Effect.fn("id.next")(function* <P extends string>(schema: Specific<P>) {
					yield* Effect.annotateCurrentSpan({type: schema.prefix});
					const now = yield* Clock.currentTimeMillis;
					if (now > at) {
						at = now;
						random = entropy();
					} else if (random === maxRandom) {
						at++;
						random = 0n;
					} else random++;
					if (!Number.isSafeInteger(at) || at < 0 || at >= 2 ** 48)
						return yield* Effect.die("UUIDv7 clock exhausted");
					const suffix = encode(at, random);
					return schema.make(schema.prefix === "" ? suffix : `${schema.prefix}_${suffix}`);
				}),
			};
		}),
	);
}
