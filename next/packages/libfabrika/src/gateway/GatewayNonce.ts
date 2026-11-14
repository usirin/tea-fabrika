/**
 * Signed, single-use challenge nonces for the gateway. SYN cookies keep an unproved connection out
 * of storage (RFC 4987, section 3.6).
 *
 * @stability unstable
 */
import { Effect, Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";
import { Crypto, GatewayError, Storage } from "./GatewayError.ts";
import type { gatewayStore } from "./GatewayStore.ts";

/**
 * Creates the nonce tools for one gateway store: `issue`, `check` and `spend`.
 *
 * **Details**
 *
 * The 32-byte signing key is made once and saved in the store, so a restart keeps it. `issue`
 * returns a nonce bound to a client and the current time. `check` returns the time the nonce
 * expires, or null when it is malformed, from the future, older than `ttl` or signed for another
 * client. No nonce is stored until `spend`, which a caller runs inside a store transaction after
 * `check`. It answers false for an expired or already spent nonce, and fails with a
 * `GatewayError` with reason `Storage` when `cap` live receipts are held. A WebCrypto failure is
 * reason `Crypto`.
 *
 * @stability unstable
 * @category constructors
 */
export const gatewayNonce = Effect.fn("gateway.nonce")(function* (
  store: ReturnType<typeof gatewayStore>,
  ttl: number,
  cap: number,
) {
  const secret = yield* store.atomic(() => {
    const saved = store.get("challengeKey", Schema.String);

    if (saved !== null) {
      return saved;
    }

    const fresh = Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)));
    store.set("challengeKey", Schema.String, fresh);
    return fresh;
  });
  const bytes = Base64Url.decode(secret);

  if (Result.isFailure(bytes)) {
    return yield* new GatewayError({ reason: new Storage({ cause: bytes.failure }) });
  }

  // A key of the wrong length decoded fine: no failure to keep.
  if (bytes.success.length !== 32) {
    return yield* new GatewayError({ reason: new Storage({ cause: undefined }) });
  }

  const fail = (cause: unknown) => new GatewayError({ reason: new Crypto({ cause }) });
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
    const salt = Base64Url.encode(crypto.getRandomValues(new Uint8Array(24)));
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
      return Result.fail(new GatewayError({ reason: new Storage({ cause: undefined }) }));
    }

    store.sql.exec("DELETE FROM gateway_spent WHERE until<=?", at);
    store.sql.exec("INSERT INTO gateway_spent (nonce,until) VALUES (?,?)", nonce, until);
    return Result.succeed(true);
  };
  return { issue, check, spend };
});
