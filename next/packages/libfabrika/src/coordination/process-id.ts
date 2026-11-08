import {Context, Effect, Layer} from "effect";
import {type ProcessId} from "../data/trace.ts";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const low62 = (1n << 62n) - 1n;
const maxRandom = (1n << 74n) - 1n;
const entropy = () =>
	crypto.getRandomValues(new Uint8Array(10)).reduce((n, b) => (n << 8n) | BigInt(b), 0n) &
	maxRandom;

// RFC 9562 5.7: 48 clock bits, version 7, 12 random bits, variant 10, 62 random bits.
const encode = (at: number, random: bigint): string => {
	let uuid =
		(BigInt(at) << 80n) | (7n << 76n) | ((random >> 62n) << 64n) | (2n << 62n) | (random & low62);
	let suffix = "";
	for (let i = 0; i < 26; i++) {
		suffix = alphabet[Number(uuid & 31n)] + suffix;
		uuid >>= 5n;
	}
	return `process_${suffix}`;
};

export class ProcessIdGenerator extends Context.Service<
	ProcessIdGenerator,
	{
		readonly next: Effect.Effect<typeof ProcessId.Type>;
	}
>()("@kampus/libfabrika/ProcessIdGenerator") {
	static readonly layer = Layer.effect(
		ProcessIdGenerator,
		Effect.sync(() => {
			let at = -1,
				random = 0n;
			return {
				next: Effect.gen(function* () {
					const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
					if (now > at) {
						at = now;
						random = entropy();
					} else if (random === maxRandom) {
						at++;
						random = 0n;
					} else random++;
					if (!Number.isSafeInteger(at) || at < 0 || at >= 2 ** 48)
						return yield* Effect.die("UUIDv7 clock exhausted");
					return encode(at, random);
				}).pipe(Effect.withSpan("process.next")),
			};
		}),
	);
}
