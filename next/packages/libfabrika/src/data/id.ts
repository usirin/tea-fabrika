import {type Brand, Context, Effect, Layer, Schema} from "effect";

export type IdValue<P extends string> = Brand.Branded<string, P>;
export interface IdSchema<P extends string> extends Schema.Codec<IdValue<P>, string> {}

export class IdError extends Schema.TaggedError<IdError>()("IdError", {
	why: Schema.Literals(["prefix", "clock", "entropy", "exhausted"]),
}) {}

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const prefixes = new WeakMap<Schema.Top, string>();
const validPrefix = (prefix: string) => /^[a-z](?:[a-z_]{0,61}[a-z])?$/.test(prefix);
const low62 = (1n << 62n) - 1n;
const maxRandom = (1n << 74n) - 1n;
const maxTime = 2 ** 48 - 1;

const uuid7 = (text: string) => {
	if (!/^[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(text)) return false;
	let uuid = 0n;
	for (const c of text) uuid = (uuid << 5n) | BigInt(alphabet.indexOf(c));
	return ((uuid >> 76n) & 15n) === 7n && ((uuid >> 62n) & 3n) === 2n;
};

const make = <const P extends string>(prefix: P): IdSchema<P> => {
	if (!validPrefix(prefix)) throw new IdError({why: "prefix"});
	const schema = Schema.String.check(
		Schema.makeFilter(
			(text) => text.startsWith(`${prefix}_`) && uuid7(text.slice(prefix.length + 1)),
		),
	).pipe(Schema.brand(prefix));
	prefixes.set(schema, prefix);
	return schema;
};

/** Code declares a prefix with make; outside prefix text uses makeEffect. */
export const Id = {
	make,
	makeEffect: Effect.fn("id.makeEffect")(function* <const P extends string>(prefix: P) {
		if (!validPrefix(prefix)) return yield* new IdError({why: "prefix"});
		return make(prefix);
	}),
};

export const InputId = Id.make("input");
export type InputId = typeof InputId.Type;

// RFC 9562 5.7: 48 clock bits, version 7, 12 random bits, variant 10, 62 random bits.
const encode = (at: number, random: bigint): string => {
	let uuid =
		(BigInt(at) << 80n) | (7n << 76n) | ((random >> 62n) << 64n) | (2n << 62n) | (random & low62);
	let suffix = "";
	for (let i = 0; i < 26; i++) {
		suffix = alphabet[Number(uuid & 31n)] + suffix;
		uuid >>= 5n;
	}
	return suffix;
};

/** One monotonic UUIDv7 sequence, shared by every prefix using this generator. */
export class IdGenerator extends Context.Service<
	IdGenerator,
	{readonly next: <P extends string>(schema: IdSchema<P>) => Effect.Effect<IdValue<P>, IdError>}
>()("@kampus/libfabrika/IdGenerator") {
	static readonly layer = Layer.effect(
		IdGenerator,
		Effect.sync(() => {
			let at = -1,
				random = 0n;
			return {
				next: Effect.fn("id.next")(function* <P extends string>(schema: IdSchema<P>) {
					const prefix = prefixes.get(schema);
					if (prefix === undefined) return yield* new IdError({why: "prefix"});
					const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
					const text = yield* Effect.try({
						try: () => {
							if (!Number.isSafeInteger(now) || now < 0 || now > maxTime)
								throw new IdError({why: "clock"});
							let nextAt = at,
								nextRandom = random;
							if (now > at) {
								nextAt = now;
								nextRandom =
									crypto
										.getRandomValues(new Uint8Array(10))
										.reduce((n, b) => (n << 8n) | BigInt(b), 0n) & maxRandom;
							} else if (random === maxRandom) {
								if (at === maxTime) throw new IdError({why: "exhausted"});
								nextAt++;
								nextRandom = 0n;
							} else nextRandom++;
							at = nextAt;
							random = nextRandom;
							return `${prefix}_${encode(at, random)}`;
						},
						catch: (error) => (error instanceof IdError ? error : new IdError({why: "entropy"})),
					});
					return yield* Schema.decodeUnknownEffect(schema)(text).pipe(
						Effect.mapError(() => new IdError({why: "prefix"})),
					);
				}),
			};
		}),
	);
}
