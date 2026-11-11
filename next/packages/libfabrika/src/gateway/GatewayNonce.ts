import { Effect, Result, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";
import { GatewayError } from "./Gateway.ts";
import type { gatewayStore } from "./GatewayStore.ts";

// SYN cookies keep an unproved connection out of storage (RFC 4987, section 3.6).
export const gatewayNonce = Effect.fn("gateway.nonce")(function* (
  store: ReturnType<typeof gatewayStore>,
  ttl: number,
  cap: number,
) {
  const random = yield* SecureRandom.SecureRandom;
  const atomic = <A>(step: () => A) =>
    store.atomic(step).pipe(Effect.mapError((cause) => new GatewayError({ reason: "storage", cause })));
  const read = () => store.get("challengeKey", Schema.String);
  // A transaction never suspends: draw first, then keep whichever secret is installed by then.
  const install = (fresh: string) =>
    atomic(() => {
      const installed = read();

      if (installed !== null) {
        return installed;
      }

      store.set("challengeKey", Schema.String, fresh);
      return fresh;
    });
  const saved = yield* atomic(read);
  const secret = saved ?? (yield* install(Base64Url.encode(yield* random.randomBytes(32))));
  const bytes = Base64Url.decode(secret);

  if (Result.isFailure(bytes)) {
    return yield* new GatewayError({ reason: "storage", cause: bytes.failure });
  }

  if (bytes.success.length !== 32) {
    return yield* new GatewayError({ reason: "storage" });
  }

  const fail = (cause: unknown) => new GatewayError({ reason: "crypto", cause });
  const args: Parameters<SubtleCrypto["importKey"]> = [
    "raw",
    new Uint8Array(bytes.success),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  ];
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto imports keys through a Promise
  const imported = Effect.tryPromise({ try: () => crypto.subtle.importKey(...args), catch: fail });
  const key = yield* imported;
  const clock = Effect.clockWith((c) => c.currentTimeMillis);
  const text = (client: string, issuedAt: number, salt: string) =>
    new TextEncoder().encode(JSON.stringify([client, issuedAt, salt]));
  const issue = Effect.fnUntraced(function* (client: string) {
    const issuedAt = yield* clock;
    const salt = Base64Url.encode(yield* random.randomBytes(24));
    const data = text(client, issuedAt, salt);
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs through a Promise
    const work = Effect.tryPromise({ try: () => crypto.subtle.sign("HMAC", key, data), catch: fail });
    const mac = yield* work;
    return `${issuedAt}.${salt}.${Base64Url.encode(new Uint8Array(mac))}`;
  });
  const check = Effect.fnUntraced(function* (client: string, nonce: string) {
    const parts = /^(0|[1-9]\d*)\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(nonce);

    if (parts === null) {
      return null;
    }

    const issuedAt = Number(parts[1]),
      salt = parts[2] ?? "",
      mac = Base64Url.decode(parts[3] ?? "");
    const at = yield* clock;

    if (!Number.isSafeInteger(issuedAt) || issuedAt > at || issuedAt + ttl <= at || Result.isFailure(mac)) {
      return null;
    }

    const args: Parameters<SubtleCrypto["verify"]> = [
      "HMAC",
      key,
      new Uint8Array(mac.success),
      text(client, issuedAt, salt),
    ];
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto verifies through a Promise
    const checked = Effect.tryPromise({ try: () => crypto.subtle.verify(...args), catch: fail });
    const valid = yield* checked;
    return valid ? issuedAt + ttl : null;
  });
  // Called in the signature-checked transaction. Never evict a still-live receipt.
  const spend = (nonce: string, until: number, at: number) => {
    if (until <= at || store.sql.exec("SELECT nonce FROM gateway_spent WHERE nonce=?", nonce).length > 0) {
      return Result.succeed(false);
    }

    if (Number(store.sql.exec("SELECT count(*) n FROM gateway_spent WHERE until>?", at)[0]?.n ?? 0) >= cap) {
      return Result.fail(new GatewayError({ reason: "storage" }));
    }

    store.sql.exec("DELETE FROM gateway_spent WHERE until<=?", at);
    store.sql.exec("INSERT INTO gateway_spent (nonce,until) VALUES (?,?)", nonce, until);
    return Result.succeed(true);
  };
  return { issue, check, spend };
});
