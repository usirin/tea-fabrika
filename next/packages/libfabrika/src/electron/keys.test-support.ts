// P19, next/. The stand-in Seal the desktop laws use instead of macOS Keychain (plan "Tests before
// implementation"). It is a typed stand-in for an outside effect, not a second sealing policy: it
// proves call order and failures, never Keychain protection. Its bytes open again in a later
// process, so a fixture app that restarts reopens what it sealed, and it never touches a Keychain.
//
// The product's modules are not imported here at run time: a test loads them itself, so a missing
// export fails that law alone, and hands the error class in.
import type {Context} from "effect";
import {Effect, Option, Redacted, Ref} from "effect";
import type {DesktopDown} from "../desktop/founding.ts";
import type {Seal} from "../desktop/keys.ts";

type Why = DesktopDown["why"];
type Shape = Context.Service.Shape<typeof Seal>;
type Op = "available" | "encrypt" | "decrypt";

/** The first bytes of every stand-in seal, so a test can tell sealed bytes from plain text. */
export const TEST_SEAL_HEAD = "P19-TEST-SEAL:";
const MASK = 0x5a;

const seal = (plain: string): Uint8Array => {
	const body = new TextEncoder().encode(plain).map((byte) => byte ^ MASK);
	const head = new TextEncoder().encode(TEST_SEAL_HEAD);
	const out = new Uint8Array(head.length + body.length);
	out.set(head, 0);
	out.set(body, head.length);
	return out;
};

const open = (bytes: Uint8Array): Option.Option<string> => {
	const head = new TextEncoder().encode(TEST_SEAL_HEAD);
	if (bytes.length < head.length || head.some((byte, i) => bytes[i] !== byte)) return Option.none();
	return Option.some(new TextDecoder().decode(bytes.slice(head.length).map((b) => b ^ MASK)));
};

export const testSeal = (
	down: typeof DesktopDown,
	options: {readonly available?: boolean} = {},
): Effect.Effect<{
	readonly impl: Shape;
	readonly calls: Effect.Effect<ReadonlyArray<string>>;
	/** Every plain text the product handed to `encrypt`: the secrets no output may show. */
	readonly plains: Effect.Effect<ReadonlyArray<string>>;
	/** Fail the next call, or the next call of `on` after skipping `skip` of them, with `why`. */
	readonly failNext: (why: Why, on?: Op, skip?: number) => Effect.Effect<void>;
	readonly rotateNext: Effect.Effect<void>;
}> =>
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<string>>([]);
		type Failing = {readonly why: Why; readonly on: Op | undefined; readonly skip: number};
		const failing = yield* Ref.make<Option.Option<Failing>>(Option.none());
		const rotate = yield* Ref.make(false);
		const plains = yield* Ref.make<ReadonlyArray<string>>([]);
		const step = (name: Op) =>
			Effect.gen(function* () {
				yield* Ref.update(calls, (all) => [...all, name]);
				const due = yield* Ref.modify(
					failing,
					(f): readonly [Option.Option<Failing>, Option.Option<Failing>] => {
						if (Option.isNone(f) || (f.value.on !== undefined && f.value.on !== name))
							return [Option.none(), f];
						if (f.value.skip > 0)
							return [Option.none(), Option.some({...f.value, skip: f.value.skip - 1})];
						return [f, Option.none()];
					},
				);
				if (Option.isSome(due)) return yield* new down({why: due.value.why});
			});
		const impl: Shape = {
			available: step("available").pipe(Effect.as(options.available ?? true)),
			encrypt: (plain) =>
				Effect.gen(function* () {
					yield* step("encrypt");
					// oxlint-disable-next-line fabrika/no-redacted-value -- the stand-in seal is the crypto edge
					const text = Redacted.value(plain);
					yield* Ref.update(plains, (all) => [...all, text]);
					return Redacted.make(seal(text));
				}),
			decrypt: (sealed) =>
				Effect.gen(function* () {
					yield* step("decrypt");
					// oxlint-disable-next-line fabrika/no-redacted-value -- the stand-in seal is the crypto edge
					const plain = open(Redacted.value(sealed));
					if (Option.isNone(plain)) return yield* new down({why: "crypto"});
					return {plain: Redacted.make(plain.value), rotate: yield* Ref.getAndSet(rotate, false)};
				}),
		};
		return {
			impl,
			calls: Ref.get(calls),
			plains: Ref.get(plains),
			failNext: (why, on, skip = 0) => Ref.set(failing, Option.some({why, on, skip})),
			rotateNext: Ref.set(rotate, true),
		};
	});
