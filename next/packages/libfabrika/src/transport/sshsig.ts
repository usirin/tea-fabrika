// SSHSIG written and checked, Ed25519 only: the bytes OpenSSH's PROTOCOL.sshsig gives, the same
// file `ssh-keygen -Y sign` writes and `-Y verify` reads. Tier 1, P7 (laws p27 and p44).
//
//   blob   = "SSHSIG" u32(1) string(key) string(space) string(reserved) string(hash) string(signature)
//   signed = "SSHSIG" string(space) string(reserved) string(hash) string(H(text))
//   string = a u32 length, then the bytes (RFC 4251)
//
// Pure but for WebCrypto, so a browser tab runs it as Node does. Base64 goes through Effect's
// encoding, never Node's `Buffer`.
import {Effect, Option, Schema} from "effect";
import {Base64} from "effect/encoding";

type Bytes = Uint8Array<ArrayBuffer>;

const ED25519 = "ssh-ed25519";
const BEGIN = "-----BEGIN SSH SIGNATURE-----";
const END = "-----END SSH SIGNATURE-----";
/** What `ssh-keygen` writes to a row. The spec only suggests 76; p44 holds us to its bytes. */
const ROW = 70;

const utf8 = (text: string): Bytes => new TextEncoder().encode(text);

const join = (...parts: ReadonlyArray<Uint8Array>): Bytes => {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	parts.reduce((at, part) => {
		out.set(part, at);
		return at + part.length;
	}, 0);
	return out;
};

const u32 = (n: number): Bytes => {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, n);
	return out;
};

/** RFC 4251's `string`: its length, then its bytes. */
const field = (value: Uint8Array | string): Bytes => {
	const bytes = typeof value === "string" ? utf8(value) : value;
	return join(u32(bytes.length), bytes);
};

const same = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((x, i) => x === b[i]);

/** RFC 4251's fields, read in order. A read past the end answers none; `rest` is what is left. */
const reader = (bytes: Uint8Array) => {
	let at = 0;
	const take = (n: number): Option.Option<Bytes> => {
		if (at + n > bytes.length) return Option.none();
		const out = bytes.slice(at, at + n);
		at += n;
		return Option.some(out);
	};
	const word = (): Option.Option<number> =>
		Option.map(take(4), (four) => new DataView(four.buffer).getUint32(0));
	return {
		take,
		word,
		string: (): Option.Option<Bytes> => Option.flatMap(word(), take),
		rest: (): number => bytes.length - at,
	};
};

/** Goes on only where `ok` holds. */
const holds = (ok: boolean): Option.Option<true> => (ok ? Option.some(true) : Option.none());

/** `string("ssh-ed25519") string(<n bytes>)` and nothing after: the n bytes. */
const ed25519 = (blob: Uint8Array, n: number): Option.Option<Bytes> =>
	Option.gen(function* () {
		const read = reader(blob);
		const type = yield* read.string();
		const value = yield* read.string();
		yield* holds(same(type, utf8(ED25519)) && value.length === n && read.rest() === 0);
		return value;
	});

/** A key line's key blob, `string("ssh-ed25519") string(<32 bytes>)`, if it is an Ed25519 line. */
const keyBlob = (line: string): Option.Option<Uint8Array> => {
	const [type, base64] = line.split(/\s+/);
	if (type !== ED25519 || base64 === undefined) return Option.none();
	return Option.filter(Option.getSuccess(Base64.decode(base64)), (blob) =>
		Option.isSome(ed25519(blob, 32)),
	);
};

/**
 * One key line, `ssh-ed25519 <base64 of the 51-byte key blob> [comment]`, kept as given. Decode it
 * once, where a line comes in, and `writeSshsig` never meets a line it cannot sign for.
 */
export const KeyLine = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((line: string) =>
			Option.isSome(keyBlob(line)) ? undefined : "an ssh-ed25519 key line",
		),
	),
	Schema.brand("KeyLine"),
);
export type KeyLine = typeof KeyLine.Type;

/** A WebCrypto call that answered with a rejection. */
class WebCryptoError extends Schema.TaggedError<WebCryptoError>()("WebCryptoError", {
	cause: Schema.Defect(),
}) {}

const subtle = <A>(call: () => Promise<A>): Effect.Effect<A, WebCryptoError> =>
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto answers only with a Promise
	Effect.tryPromise({try: call, catch: (cause) => new WebCryptoError({cause})});

/** A hash a signature may name, the spec's two, with WebCrypto's name for it. */
type Hash = {readonly name: "sha512" | "sha256"; readonly web: "SHA-512" | "SHA-256"};
const SHA512: Hash = {name: "sha512", web: "SHA-512"};
const SHA256: Hash = {name: "sha256", web: "SHA-256"};
/** A Map, so a name such as `constructor` is no hash. */
const HASHES: ReadonlyMap<string, Hash> = new Map([
	[SHA512.name, SHA512],
	[SHA256.name, SHA256],
]);

/** What the signature covers. Reserved is always written empty. */
const signedBytes = (
	space: string,
	hash: Hash,
	text: string,
): Effect.Effect<Bytes, WebCryptoError> =>
	Effect.map(
		subtle(() => crypto.subtle.digest(hash.web, utf8(text))),
		(digest) =>
			join(
				utf8("SSHSIG"),
				field(space),
				field(""),
				field(hash.name),
				field(new Uint8Array(digest)),
			),
	);

/** An armored SSHSIG, read: the fields a check needs. `key` is the whole key blob. */
type Sshsig = {
	readonly key: Bytes;
	readonly publicKey: Bytes;
	readonly space: Bytes;
	readonly hash: Hash;
	readonly signature: Bytes;
};

/** The armor, then the blob: version exactly 1, an Ed25519 key and signature, no byte left over. */
const read = (armored: string): Option.Option<Sshsig> =>
	Option.gen(function* () {
		const text = armored.trim();
		yield* holds(
			text.startsWith(BEGIN) && text.endsWith(END) && text.length >= BEGIN.length + END.length,
		);
		const body = text.slice(BEGIN.length, -END.length).replace(/\s+/g, "");
		const blob = yield* Option.getSuccess(Base64.decode(body));
		const fields = reader(blob);
		const magic = yield* fields.take(6);
		const version = yield* fields.word();
		const key = yield* fields.string();
		const space = yield* fields.string();
		yield* fields.string(); // reserved: the spec says to ignore it
		const hash = yield* fields.string();
		const signature = yield* fields.string();
		yield* holds(same(magic, utf8("SSHSIG")) && version === 1 && fields.rest() === 0);
		return {
			key,
			publicKey: yield* ed25519(key, 32),
			space,
			hash: yield* Option.fromNullishOr(HASHES.get(new TextDecoder().decode(hash))),
			signature: yield* ed25519(signature, 64),
		};
	});

type Answer = {readonly signer: string} | {readonly why: "bad_signature"};
const refused: Answer = {why: "bad_signature"};

/**
 * Which of `signers` signed `text` under `space`: that entry, as given. Any refusal, of any cause,
 * is the one answer `{why: "bad_signature"}` (p27). It never fails and never dies. The key inside
 * the signature is matched to a signer first, as Go's sshsig `Verify` does; a signer line that is
 * not Ed25519 never matches.
 */
export const checkSshsig = (a: {
	readonly text: string;
	readonly armored: string;
	readonly space: "fabrika-client";
	readonly signers: ReadonlyArray<string>;
}): Effect.Effect<Answer> =>
	Option.match(
		Option.gen(function* () {
			const sig = yield* read(a.armored);
			const signer = yield* Option.fromNullishOr(
				a.signers.find((line) => Option.exists(keyBlob(line), (blob) => same(blob, sig.key))),
			);
			yield* holds(same(sig.space, utf8(a.space)));
			return {sig, signer};
		}),
		{
			onNone: () => Effect.succeed(refused),
			onSome: ({sig, signer}) =>
				Effect.gen(function* () {
					const key = yield* subtle(() =>
						crypto.subtle.importKey("raw", sig.publicKey, {name: "Ed25519"}, false, ["verify"]),
					);
					const bytes = yield* signedBytes(a.space, sig.hash, a.text);
					const ok = yield* subtle(() =>
						crypto.subtle.verify({name: "Ed25519"}, key, sig.signature, bytes),
					);
					return ok ? {signer} : refused;
				}).pipe(Effect.catch(() => Effect.succeed(refused))),
		},
	);

const armor = (blob: Uint8Array): string => {
	const body = Base64.encode(blob);
	const rows = Array.from({length: Math.ceil(body.length / ROW)}, (_, i) =>
		body.slice(i * ROW, (i + 1) * ROW),
	);
	return `${BEGIN}\n${rows.join("\n")}\n${END}\n`;
};

/**
 * The same bytes `ssh-keygen -Y sign -n <space>` writes: sha512, base64 wrapped at 70. `sign` is
 * the raw Ed25519 signature from any key holder (WebCrypto in a tab, the person key in the app).
 * It fails only with `sign`'s error: hashing bytes cannot fail, so a rejection there is a defect.
 */
export const writeSshsig = <E>(a: {
	readonly text: string;
	readonly space: "fabrika-client";
	readonly line: KeyLine;
	readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, E>;
}): Effect.Effect<string, E> =>
	Effect.gen(function* () {
		const key = yield* Option.match(keyBlob(a.line), {
			onNone: () => Effect.die("a KeyLine always holds an Ed25519 key"),
			onSome: Effect.succeed,
		});
		const bytes = yield* Effect.orDie(signedBytes(a.space, SHA512, a.text));
		const raw = yield* a.sign(bytes);
		const signature = join(field(ED25519), field(raw));
		return armor(
			join(
				utf8("SSHSIG"),
				u32(1),
				field(key),
				field(a.space),
				field(""),
				field(SHA512.name),
				field(signature),
			),
		);
	});
