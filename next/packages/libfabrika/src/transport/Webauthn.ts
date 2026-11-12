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

export const passkeyRp = (line: string): Option.Option<string> =>
  passkeyBlob(line).pipe(
    Option.flatMap(keyParts),
    Option.flatMap(({ rp }) => Option.liftThrowable(() => text(rp))()),
  );

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
