/**
 * Passkey (WebAuthn) keys in OpenSSH form: reading a passkey key line, checking a passkey
 * signature, and turning a browser's WebAuthn assertion into an SSHSIG.
 *
 * **Details**
 *
 * The key type is `sk-ecdsa-sha2-nistp256@openssh.com`, a P-256 key tied to a relying party (rp).
 * The signature type is `webauthn-sk-ecdsa-sha2-nistp256@openssh.com`. Only WebCrypto is used, so
 * a browser tab runs it as Node does.
 *
 * @stability unstable
 */
import { Effect, Option, Schema } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { armor, type Bytes, field, holds, join, reader, same, subtle, u32, utf8 } from "./internal/binary.ts";

const KEY = "sk-ecdsa-sha2-nistp256@openssh.com";
const SIG = "webauthn-sk-ecdsa-sha2-nistp256@openssh.com";
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

const keyParts = (blob: Uint8Array) =>
  Option.gen(function* () {
    const r = reader(blob);
    yield* holds(same(yield* r.string(), utf8(KEY)));
    yield* holds(same(yield* r.string(), utf8("nistp256")));
    const point = yield* r.string();
    const rp = yield* r.string();
    yield* holds(point.length === 65 && point[0] === 4 && rp.length > 0 && r.rest() === 0);
    return { point, rp };
  });

/**
 * Reads the key blob out of a passkey key line, or gives `none`.
 *
 * **Details**
 *
 * The line is `sk-ecdsa-sha2-nistp256@openssh.com <base64> [comment]`. The blob must name the curve
 * `nistp256`, hold a 65-byte uncompressed point, a non-empty rp and nothing after. Any other line
 * gives `none`.
 *
 * @stability unstable
 * @category getters
 */
export const passkeyBlob = (line: string): Option.Option<Bytes> => {
  const [kind, base64] = line.split(/\s+/);

  if (kind !== KEY || base64 === undefined) {
    return Option.none();
  }

  return Option.getSuccess(Base64.decode(base64)).pipe(
    Option.map((bytes) => new Uint8Array(bytes)),
    Option.filter((bytes) => Option.isSome(keyParts(bytes))),
  );
};

/**
 * Reads the relying party (rp) from a passkey key line, or gives `none`.
 *
 * **Details**
 *
 * Gives `none` when the line is not a well-formed passkey line, or when its rp is not valid UTF-8.
 *
 * @stability unstable
 * @category getters
 */
export const passkeyRp = (line: string): Option.Option<string> =>
  passkeyBlob(line).pipe(
    Option.flatMap(keyParts),
    Option.flatMap(({ rp }) => Option.liftThrowable(() => text(rp))()),
  );

/**
 * Schema for one OpenSSH P-256 passkey key line, kept as given and branded `PasskeyLine`.
 *
 * **When to use**
 *
 * Use to check a line once, where it comes in. A line that `passkeyBlob` cannot read fails with
 * "an OpenSSH P-256 passkey line".
 *
 * @stability unstable
 * @category models
 */
export const PasskeyLine = Schema.String.check(
  Schema.makeFilter((line: string) => (Option.isSome(passkeyBlob(line)) ? undefined : "an OpenSSH P-256 passkey line")),
).pipe(Schema.brand("PasskeyLine"));

// Both DER integers and SSH mpints are positive, minimally encoded signed integers.
const fixed = (n: Bytes): Option.Option<Bytes> => {
  if (n.length === 0 || n.length > 33 || (n[0] ?? 128) >= 128 || (n.length > 1 && n[0] === 0 && (n[1] ?? 0) < 128)) {
    return Option.none();
  }

  const value = n[0] === 0 ? n.slice(1) : n;

  if (value.length > 32 || value.every((b) => b === 0)) {
    return Option.none();
  }

  const out = new Uint8Array(32);
  out.set(value, 32 - value.length);
  return Option.some(out);
};

const pair = (bytes: Bytes) =>
  Option.gen(function* () {
    const r = reader(bytes);
    const a = yield* fixed(yield* r.string());
    const b = yield* fixed(yield* r.string());
    yield* holds(r.rest() === 0);
    return join(a, b);
  });

const Client = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal("webauthn.get"),
    challenge: Schema.String,
    origin: Schema.String,
    crossOrigin: Schema.optional(Schema.Boolean),
  }),
);

/**
 * Checks a passkey signature over `challenge` against a passkey key blob and a policy.
 *
 * **Details**
 *
 * Gives `{ origin, rp, be, bs, counter }` when the signature holds, and `null` otherwise. `be` and
 * `bs` are the backup eligible and backup state flags. It does not fail: a WebCrypto error also
 * gives `null`. All of these must hold:
 *
 * - The blob and the signature parse, with no byte left over. The signature is a
 *   `webauthn-sk-ecdsa-sha2-nistp256@openssh.com` signature.
 * - The flags show user presence and user verification, set neither reserved bit nor the attested
 *   credential data bit, and do not set backup state without backup eligible. The extension data
 *   flag is set exactly when extension data is present.
 * - The key's rp equals `policy.rp`. The signature's origin equals the client data's origin and is
 *   in `policy.origins`. The client data is not cross-origin.
 * - The client data type is `webauthn.get`, and its challenge is the base64url of `challenge`.
 * - The ECDSA P-256 signature verifies over the authenticator data and the SHA-256 of the client
 *   data.
 *
 * @stability unstable
 * @category combinators
 */
export const checkPasskey = Effect.fn("transport.checkPasskey")(function* (
  blob: Bytes,
  signature: Bytes,
  challenge: Bytes,
  policy: { readonly rp: string; readonly origins: ReadonlyArray<string> },
) {
  const parsed = Option.gen(function* () {
    const key = yield* keyParts(blob);
    const r = reader(signature);
    yield* holds(same(yield* r.string(), utf8(SIG)));
    const raw = yield* pair(yield* r.string());
    const flags = (yield* r.take(1))[0] ?? 0;
    const counter = yield* r.word();
    const origin = yield* r.string();
    const client = yield* r.string();
    const extensions = yield* r.string();
    yield* holds(
      r.rest() === 0 && (flags & 5) === 5 && (flags & 0x62) === 0 && !((flags & 16) !== 0 && (flags & 8) === 0),
    );
    yield* holds(((flags & 128) !== 0) === extensions.length > 0);
    return { ...key, raw, flags, counter, origin, client, extensions };
  });

  if (Option.isNone(parsed)) {
    return null;
  }

  const p = parsed.value;
  return yield* Effect.try(() => ({
    rp: text(p.rp),
    origin: text(p.origin),
    client: Schema.decodeUnknownSync(Client)(text(p.client)),
  })).pipe(
    Effect.flatMap(
      Effect.fnUntraced(function* ({ rp, origin, client }) {
        if (
          rp !== policy.rp ||
          origin !== client.origin ||
          !policy.origins.includes(origin) ||
          client.crossOrigin === true ||
          client.challenge !== Base64Url.encode(challenge)
        ) {
          return null;
        }

        const hash = new Uint8Array(yield* subtle("digest", "SHA-256", p.rp));
        const clientHash = new Uint8Array(yield* subtle("digest", "SHA-256", p.client));
        const auth = join(hash, new Uint8Array([p.flags]), u32(p.counter), p.extensions);
        const key = yield* subtle("importKey", "raw", p.point, { name: "ECDSA", namedCurve: "P-256" }, false, [
          "verify",
        ]);
        const ok = yield* subtle("verify", { name: "ECDSA", hash: "SHA-256" }, key, p.raw, join(auth, clientHash));
        return ok ? { origin, rp, be: (p.flags & 8) !== 0, bs: (p.flags & 16) !== 0, counter: p.counter } : null;
      }),
    ),
    Effect.catch(() => Effect.succeed(null)),
  );
});

class BadAssertion extends Schema.TaggedError<BadAssertion>()("BadAssertion", {
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Turns a browser's WebAuthn assertion into an armored SSHSIG over `text`.
 *
 * **Details**
 *
 * The passkey must have been asked to sign the SSHSIG signed bytes for `text` as its challenge
 * (namespace `fabrika-client`, sha512). `assertion` holds the authenticator data, the client data
 * JSON and the DER signature the browser gave back. The result is checked with `checkPasskey`
 * before it is returned, using the key's rp and the origin named in the client data as the only
 * allowed origin.
 *
 * It fails with `BadAssertion` when the DER signature is malformed, the authenticator data is
 * shorter than 37 bytes, the client data is not valid, the authenticator data's rp hash does not
 * match the key's rp, or the built signature does not pass `checkPasskey`. A WebCrypto error also
 * fails the effect.
 *
 * @stability unstable
 * @category constructors
 */
export const writeWebauthnSshsig = Effect.fn("transport.writeWebauthnSshsig")(function* (a: {
  readonly text: string;
  readonly line: typeof PasskeyLine.Type;
  readonly assertion: {
    readonly authenticatorData: Uint8Array;
    readonly clientDataJSON: Uint8Array;
    readonly signature: Uint8Array;
  };
}) {
  const { authenticatorData: auth, clientDataJSON: client, signature: der } = a.assertion;
  const parsed = Option.gen(function* () {
    const blob = yield* passkeyBlob(a.line);
    const key = yield* keyParts(blob);
    const r = reader(der);
    yield* holds(same(yield* r.take(1), new Uint8Array([0x30])));
    const size = (yield* r.take(1))[0] ?? 0;
    yield* holds(size === r.rest());
    const ints: Bytes[] = [];

    for (let n = 0; n < 2; n++) {
      yield* holds((yield* r.take(1))[0] === 2);
      const value = yield* r.take((yield* r.take(1))[0] ?? 0);
      yield* fixed(value);
      ints.push(value);
    }

    yield* holds(r.rest() === 0 && auth.length >= 37);
    return { blob, key, ints };
  });

  if (Option.isNone(parsed)) {
    return yield* new BadAssertion({});
  }

  const { blob, key, ints } = parsed.value;
  const decoded = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Client)(text(client)),
    catch: (cause) => new BadAssertion({ cause }),
  });
  const rpHash = new Uint8Array(yield* subtle("digest", "SHA-256", key.rp));

  if (!same(rpHash, auth.slice(0, 32))) {
    return yield* new BadAssertion({});
  }

  const signature = join(
    field(SIG),
    field(join(...ints.map(field))),
    auth.slice(32, 37),
    field(decoded.origin),
    field(client),
    field(auth.slice(37)),
  );
  const digest = new Uint8Array(yield* subtle("digest", "SHA-512", utf8(a.text)));
  const challenge = join(utf8("SSHSIG"), field("fabrika-client"), field(""), field("sha512"), field(digest));
  const checked = yield* checkPasskey(blob, signature, challenge, {
    rp: text(key.rp),
    origins: [decoded.origin],
  });

  if (checked === null) {
    return yield* new BadAssertion({});
  }

  return armor(
    join(utf8("SSHSIG"), u32(1), field(blob), field("fabrika-client"), field(""), field("sha512"), field(signature)),
  );
});
