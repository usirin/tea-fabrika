/**
 * SSHSIG written and checked: the bytes OpenSSH's PROTOCOL.sshsig gives, the same file
 * `ssh-keygen -Y sign` writes and `-Y verify` reads. Ed25519 keys are written and checked; a
 * passkey signature is also checked, when the caller gives a policy.
 *
 * **Details**
 *
 * ```text
 * blob   = "SSHSIG" u32(1) string(key) string(space) string(reserved) string(hash) string(signature)
 * signed = "SSHSIG" string(space) string(reserved) string(hash) string(H(text))
 * string = a u32 length, then the bytes (RFC 4251)
 * ```
 *
 * The code is pure but for WebCrypto, so a browser tab runs it as Node does. Base64 goes through
 * Effect's encoding, never Node's `Buffer`.
 *
 * @stability unstable
 */
import { Effect, Option, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { armor, type Bytes, field, holds, join, reader, same, subtle, u32, utf8 } from "./internal/binary.ts";
import { checkPasskey, passkeyBlob } from "./Webauthn.ts";

const ED25519 = "ssh-ed25519";
const BEGIN = "-----BEGIN SSH SIGNATURE-----";
const END = "-----END SSH SIGNATURE-----";

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

  if (type !== ED25519 || base64 === undefined) {
    return Option.none();
  }

  return Option.filter(Option.getSuccess(Base64.decode(base64)), (blob) => Option.isSome(ed25519(blob, 32)));
};

/**
 * Schema for one key line, `ssh-ed25519 <base64 of the 51-byte key blob> [comment]`, kept as given.
 *
 * **When to use**
 *
 * Use to decode a line once, where it comes in, so `writeSshsig` never meets a line it cannot sign
 * for. A line that is not an Ed25519 key line fails with "an ssh-ed25519 key line".
 *
 * @stability unstable
 * @category models
 */
export const KeyLine = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((line: string) => (Option.isSome(keyBlob(line)) ? undefined : "an ssh-ed25519 key line")),
  ),
  Schema.brand("KeyLine"),
);
/**
 * The type of a decoded `KeyLine`: a string branded as an Ed25519 key line.
 *
 * @stability unstable
 * @category models
 */
export type KeyLine = typeof KeyLine.Type;

/** A hash a signature may name, the spec's two, with WebCrypto's name for it. */
type Hash = { readonly name: "sha512" | "sha256"; readonly web: "SHA-512" | "SHA-256" };
const SHA512: Hash = { name: "sha512", web: "SHA-512" };
const SHA256: Hash = { name: "sha256", web: "SHA-256" };

/** A Map, so a name such as `constructor` is no hash. */
const HASHES: ReadonlyMap<string, Hash> = new Map([
  [SHA512.name, SHA512],
  [SHA256.name, SHA256],
]);

/** What the signature covers. Reserved is always written empty. */
const signedBytes = Effect.fnUntraced(function* (space: string, hash: Hash, text: string) {
  return yield* Effect.map(subtle("digest", hash.web, utf8(text)), (digest) =>
    join(utf8("SSHSIG"), field(space), field(""), field(hash.name), field(new Uint8Array(digest))),
  );
});

/** An armored SSHSIG, read: the fields a check needs. `key` is the whole key blob. */
type Sshsig = {
  readonly key: Bytes;
  readonly space: Bytes;
  readonly hash: Hash;
  readonly signature: Bytes;
};

/** The armor, then the blob: version exactly 1, an Ed25519 key and signature, no byte left over. */
const read = (armored: string): Option.Option<Sshsig> =>
  Option.gen(function* () {
    const text = armored.trim();
    yield* holds(text.startsWith(BEGIN) && text.endsWith(END) && text.length >= BEGIN.length + END.length);
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
      space,
      hash: yield* Option.fromNullishOr(HASHES.get(new TextDecoder().decode(hash))),
      signature,
    };
  });

type Answer = { readonly signer: string } | { readonly reason: "bad_signature" };
const refused: Answer = { reason: "bad_signature" };

/**
 * Schema for the answer of `verifySshsig`: `key` for an Ed25519 signer, `passkey` for a passkey
 * signer, or `refused`.
 *
 * **Details**
 *
 * Both signer cases carry the matching line from `signers`, as given. `passkey` also carries the
 * `origin` and `rp` the signature was made for, the `be` and `bs` flags (backup eligible and
 * backup state) and the signature `counter`. `refused` always has the reason `bad_signature`,
 * whatever the cause.
 *
 * @stability unstable
 * @category models
 */
export const Checked = Schema.TaggedUnion({
  key: { signer: Schema.String },
  passkey: {
    signer: Schema.String,
    origin: Schema.String,
    rp: Schema.String,
    be: Schema.Boolean,
    bs: Schema.Boolean,
    counter: Schema.Int,
  },
  refused: { reason: Schema.Literal("bad_signature") },
});

const bad = Checked.cases.refused.make({ reason: "bad_signature" });

/**
 * Checks an armored SSHSIG over `text` and says which of `signers` signed it.
 *
 * **Details**
 *
 * The key inside the signature is matched to a signer line first, as Go's sshsig `Verify` does.
 * A signer line can be an Ed25519 key line or a passkey line; any other line never matches. The
 * signature's namespace must equal `space`, and its hash is sha512 or sha256.
 *
 * - An Ed25519 signer gives `key` when the 64-byte signature verifies.
 * - A passkey signer gives `passkey` only when `policy` is given and `checkPasskey` accepts it
 *   under that policy. Without `policy` it is refused.
 *
 * Any refusal, of any cause, is the one answer `{ _tag: "refused", reason: "bad_signature" }`. It
 * never fails and never dies: a WebCrypto error also becomes that answer.
 *
 * @stability unstable
 * @category combinators
 */
export const verifySshsig = Effect.fn("transport.verifySshsig")(function* (a: {
  readonly text: string;
  readonly armored: string;
  readonly space: "fabrika-client";
  readonly signers: ReadonlyArray<string>;
  readonly policy?: { readonly rp: string; readonly origins: ReadonlyArray<string> };
}) {
  return yield* Option.match(
    Option.gen(function* () {
      const sig = yield* read(a.armored);
      const signer = yield* Option.fromNullishOr(
        a.signers.find((line) =>
          Option.exists(
            Option.orElse(keyBlob(line), () => passkeyBlob(line)),
            (blob) => same(blob, sig.key),
          ),
        ),
      );
      yield* holds(same(sig.space, utf8(a.space)));
      return { sig, signer };
    }),
    {
      onNone: () => Effect.succeed(bad),
      onSome: ({ sig, signer }) =>
        Effect.gen(function* () {
          const bytes = yield* signedBytes(a.space, sig.hash, a.text);
          const publicKey = ed25519(sig.key, 32);

          if (Option.isNone(publicKey)) {
            if (a.policy === undefined) {
              return bad;
            }

            const checked = yield* checkPasskey(sig.key, sig.signature, bytes, a.policy);
            return checked === null ? bad : Checked.cases.passkey.make({ signer, ...checked });
          }

          const signature = ed25519(sig.signature, 64);

          if (Option.isNone(signature)) {
            return bad;
          }

          const key = yield* subtle("importKey", "raw", publicKey.value, { name: "Ed25519" }, false, ["verify"]);
          const ok = yield* subtle("verify", { name: "Ed25519" }, key, signature.value, bytes);
          return ok ? Checked.cases.key.make({ signer }) : bad;
        }).pipe(Effect.catch(() => Effect.succeed(bad))),
    },
  );
});

/**
 * Checks an armored SSHSIG against Ed25519 signer lines only, and answers with a plain object.
 *
 * **Details**
 *
 * Passkey lines in `signers` are dropped before the check and no policy is passed, so only an
 * Ed25519 signature can pass. The answer is `{ signer }` with the matching line, or
 * `{ reason: "bad_signature" }`. It never fails and never dies. Use `verifySshsig` to accept passkeys.
 *
 * @stability unstable
 * @category combinators
 */
export const checkSshsig = Effect.fn("transport.checkSshsig")(function* (a: {
  readonly text: string;
  readonly armored: string;
  readonly space: "fabrika-client";
  readonly signers: ReadonlyArray<string>;
}): Effect.fn.Return<Answer> {
  const checked = yield* verifySshsig({
    ...a,
    signers: a.signers.filter((line) => Option.isSome(keyBlob(line))),
  });
  return checked._tag === "key" ? { signer: checked.signer } : refused;
});

/**
 * Writes an armored SSHSIG over `text`: the same bytes `ssh-keygen -Y sign -n <space>` writes,
 * with sha512 and base64 wrapped at 70.
 *
 * **Details**
 *
 * `sign` is given the bytes to sign and returns the raw Ed25519 signature. It can be any key
 * holder: WebCrypto in a tab, or the person key in the app. This function fails only with
 * `sign`'s error. Hashing bytes cannot fail, so a rejection there is a defect.
 *
 * @stability unstable
 * @category constructors
 */
export const writeSshsig = Effect.fn("transport.writeSshsig")(function* <E>(a: {
  readonly text: string;
  readonly space: "fabrika-client";
  readonly line: KeyLine;
  readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, E>;
}) {
  const key = yield* Option.match(keyBlob(a.line), {
    onNone: () => Effect.die("a KeyLine always holds an Ed25519 key"),
    onSome: Effect.succeed,
  });
  const bytes = yield* Effect.orDie(signedBytes(a.space, SHA512, a.text));
  const raw = yield* a.sign(bytes);
  const signature = join(field(ED25519), field(raw));
  return armor(
    join(utf8("SSHSIG"), u32(1), field(key), field(a.space), field(""), field(SHA512.name), field(signature)),
  );
});
