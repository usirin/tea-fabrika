import { Effect, Result, Schema } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { subtle } from "./internal/binary.ts";
import { checkSshsig } from "./Sshsig.ts";
import type { Admission } from "./Wire.ts";
import { Hello, Who } from "./Wire.ts";

export const helloText = (a: { readonly url: string; readonly tab: string; readonly nonce: string }): string =>
  `fabrika-hello\n${a.url}\n${a.tab}\n${a.nonce}`;

export const selectVersion = (client: ReadonlyArray<number>, server: ReadonlyArray<number>): number | null => {
  const shared = client.filter((v) => server.includes(v));
  return shared.length === 0 ? null : Math.max(...shared);
};

const decodeUrl = Schema.decodeUnknownResult(Schema.URLFromString);

export const sameOrigin = (a: {
  readonly origin: string | null;
  readonly host: string;
  readonly origins: ReadonlyArray<string>;
  readonly localHost?: string;
  readonly forwardedHost?: string;
}): boolean => {
  if (a.localHost !== undefined && a.host !== a.localHost) {
    return false;
  }

  if (a.origin === null) {
    return true;
  }

  const url = decodeUrl(a.origin);
  return (
    Result.isSuccess(url) &&
    (url.success.protocol === "https:" || url.success.protocol === "http:") &&
    url.success.origin === a.origin &&
    a.origins.includes(url.success.origin)
  );
};

const CheckedHello = Schema.TaggedUnion({
  online: { identity: Who, version: Schema.Int, ping: Schema.Number, hello: Hello },
  refused: { reason: Schema.String, fingerprint: Schema.optionalKey(Schema.String) },
});

const no = (reason: string) => CheckedHello.cases.refused.make({ reason });

const pingMs = (text: string, min: number, max: number): number => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text);
  const scale = new Map([
    ["ms", 1],
    ["s", 1000],
    ["m", 60_000],
    ["h", 3_600_000],
  ]);
  const n = match === null ? min : Number(match[1]) * (scale.get(match[2] ?? "") ?? 1);
  return Math.max(min, Math.min(max, n));
};

export const checkHello = Effect.fn("transport.checkHello")(function* <E, R>(a: {
  readonly hello: unknown;
  readonly url: string;
  readonly tab: string;
  readonly nonce: string;
  readonly name: string;
  readonly versions: ReadonlyArray<number>;
  readonly ping: { readonly min: number; readonly max: number };
  readonly consume: () => boolean;
  readonly admit: (key: string) => Effect.Effect<typeof Admission.Type, E, R>;
}) {
  const decoded = Schema.decodeUnknownResult(Hello)(a.hello);

  if (Result.isFailure(decoded)) {
    return no("bad_hello");
  }

  const hello = decoded.success;
  const version = selectVersion(hello.versions, a.versions);

  if (version === null) {
    return no("no_version");
  }

  const raw = Base64Url.decode(hello.key);

  if (
    Result.isFailure(raw) ||
    raw.success.length !== 32 ||
    Base64Url.encode(raw.success) !== hello.key ||
    hello.tab !== a.tab ||
    hello.nonce !== a.nonce
  ) {
    return no("bad_signature");
  }

  const hash = yield* subtle("digest", "SHA-256", new Uint8Array(raw.success));
  const fingerprint = `SHA256:${Base64.encode(new Uint8Array(hash)).replace(/=+$/, "")}`;

  if (fingerprint !== a.name) {
    return no("bad_signature");
  }

  const field = new Uint8Array(51);
  new DataView(field.buffer).setUint32(0, 11);
  field.set(new TextEncoder().encode("ssh-ed25519"), 4);
  new DataView(field.buffer).setUint32(15, 32);
  field.set(raw.success, 19);
  const checked = yield* checkSshsig({
    text: helloText(a),
    armored: hello.signed,
    space: "fabrika-client",
    signers: [`ssh-ed25519 ${Base64.encode(field)}`],
  });

  if ("reason" in checked) {
    return no("bad_signature");
  }

  const admitted = yield* a.admit(fingerprint);

  if (admitted._tag === "refused") {
    return CheckedHello.cases.refused.make({ reason: admitted.reason, fingerprint });
  }

  if (!a.consume()) {
    return no("bad_nonce");
  }

  return CheckedHello.cases.online.make({
    identity: admitted.identity,
    hello,
    version,
    ping: pingMs(hello.ping, a.ping.min, a.ping.max),
  });
});
