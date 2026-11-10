import {Effect, Option, Schema} from "effect";
import {Base64} from "effect/encoding";

export type Bytes = Uint8Array<ArrayBuffer>;
export const utf8 = (text: string): Bytes => new TextEncoder().encode(text);

export const join = (...parts: ReadonlyArray<Uint8Array>): Bytes => {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	parts.reduce((at, part) => {
		out.set(part, at);
		return at + part.length;
	}, 0);
	return out;
};

export const u32 = (n: number): Bytes => {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, n);
	return out;
};

export const field = (value: Uint8Array | string): Bytes => {
	const bytes = typeof value === "string" ? utf8(value) : value;
	return join(u32(bytes.length), bytes);
};

export const same = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((x, i) => x === b[i]);

export const reader = (bytes: Uint8Array) => {
	let at = 0;
	const take = (n: number): Option.Option<Bytes> => {
		if (!Number.isSafeInteger(n) || n < 0 || at + n > bytes.length) {
			return Option.none();
		}

		const out = new Uint8Array(bytes.slice(at, at + n));
		at += n;
		return Option.some(out);
	};
	const word = (): Option.Option<number> =>
		Option.map(take(4), (b) => new DataView(b.buffer).getUint32(0));
	return {
		take,
		word,
		string: (): Option.Option<Bytes> => Option.flatMap(word(), take),
		rest: () => bytes.length - at,
	};
};

export const holds = (ok: boolean): Option.Option<true> => (ok ? Option.some(true) : Option.none());

export const armor = (blob: Uint8Array): string => {
	const body = Base64.encode(blob);
	const rows = Array.from({length: Math.ceil(body.length / 70)}, (_, i) =>
		body.slice(i * 70, (i + 1) * 70),
	);
	return `-----BEGIN SSH SIGNATURE-----\n${rows.join("\n")}\n-----END SSH SIGNATURE-----\n`;
};

class WebCryptoError extends Schema.TaggedError<WebCryptoError>()("WebCryptoError", {}) {}
type CryptoMethod = "digest" | "importKey" | "verify";
type CryptoArgs = {[M in CryptoMethod]: Parameters<SubtleCrypto[M]>};
type CryptoResult = {[M in CryptoMethod]: Awaited<ReturnType<SubtleCrypto[M]>>};

type CryptoApi = {
	[M in CryptoMethod]: (...args: CryptoArgs[M]) => Promise<CryptoResult[M]>;
};

export const subtle = Effect.fn("transport.crypto")(function* <M extends CryptoMethod>(
	method: M,
	...args: CryptoArgs[M]
): Effect.fn.Return<CryptoResult[M], WebCryptoError> {
	const api: CryptoApi = crypto.subtle;
	const fail = () => new WebCryptoError({});
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto answers only with a Promise
	return yield* Effect.tryPromise({try: () => api[method](...args), catch: fail});
});
