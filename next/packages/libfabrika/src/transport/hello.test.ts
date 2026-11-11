// p26/p82. Hello echoes the issued nonce, bound by the existing signature with the URL and tab.
// checkHello takes trusted upgrade values, an atomic nonce consumer and admission.
// It answers online {who,version,ping} or refused {reason}; capability claims grant no rank.
// Plants: accept the first version; omit one signed binding; consume before checking; admit verify.
import { createHash } from "node:crypto";
import { assert, describe, expect, it, vi } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import * as Transport from "./index.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-08T04:00:00.000Z";
const SPACE = "fabrika-client";

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

const field = (value: string | Uint8Array) => {
  const b = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return Buffer.concat([u32(b.length), b]);
};

const armor = (bytes: Uint8Array) =>
  `-----BEGIN SSH SIGNATURE-----\n${Buffer.from(bytes)
    .toString("base64")
    .match(/.{1,70}/g)
    ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;

const fingerprint = (bytes: Uint8Array) =>
  `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;

const signedBytes = (text: string, space: string = SPACE) =>
  Buffer.concat([
    Buffer.from("SSHSIG"),
    field(space),
    field(""),
    field("sha512"),
    field(createHash("sha512").update(text).digest()),
  ]);

const pack = (blob: Uint8Array, signature: Uint8Array, space: string = SPACE) =>
  armor(
    Buffer.concat([
      Buffer.from("SSHSIG"),
      u32(1),
      field(blob),
      field(space),
      field(""),
      field("sha512"),
      field(signature),
    ]),
  );

const web = <A>(call: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({ try: call, catch: () => new Error("test WebCrypto failed") });

const key = Effect.fn("test.key")(function* () {
  const pair = yield* web(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  const bytes = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw: Buffer.from(bytes).toString("base64url"),
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: fingerprint(bytes),
    sshFingerprint: fingerprint(blob),
    sign: (text: string, space: string = SPACE) =>
      web(() => crypto.subtle.sign("Ed25519", pair.privateKey, signedBytes(text, space))).pipe(
        Effect.map((raw) => pack(blob, Buffer.concat([field("ssh-ed25519"), field(new Uint8Array(raw))]), space)),
      ),
  };
});

const url = "https://fabrika.test/project-a",
  tab = "tab-a",
  nonce = "nonce-a";

const setup = Effect.fnUntraced(function* () {
  const k = yield* key();
  const signed = yield* k.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`);
  const hello = {
    versions: [1, 2],
    has: ["verify", "seal"],
    ping: "30s",
    key: k.raw,
    tab,
    nonce,
    platform: "browser",
    os: "ios",
    sentAt: SENT,
    signed,
  };
  const who = {
    key: k.fingerprint,
    person: PERSON,
    as: "window",
  } satisfies typeof Transport.Who.Type;
  let used = false;
  const consume = vi.fn(() => {
    if (used) {
      return false;
    }

    used = true;
    return true;
  });
  const admit = vi.fn(() => Effect.succeed(Transport.Admission.cases.admitted.make({ who })));
  const trusted = {
    url,
    tab,
    nonce,
    name: k.fingerprint,
    versions: [2, 1],
    ping: { min: 10_000, max: 60_000 },
    consume,
    admit,
  };
  return { hello, trusted, who, consume, admit };
});

describe("P10 hello", () => {
  // d2: for any signed hello (a fresh key, any url, tab and nonce) that admission refuses
  // (not_granted, its one refusal), the refusal carries that caller's own checked fingerprint and spends no nonce.
  // Plant: return the refusal without the fingerprint.
  it("d2: any refused signed hello names its own checked fingerprint", async () => {
    await fc.assert(
      fc.asyncProperty(fc.webUrl(), fc.string(), fc.string(), (url, tab, nonce) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const k = yield* key();
            const hello = {
              versions: [1, 2],
              has: [],
              ping: "30s",
              key: k.raw,
              tab,
              nonce,
              platform: "browser",
              os: "ios",
              sentAt: SENT,
              signed: yield* k.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
            };
            const consume = vi.fn(() => true);
            const admit = vi.fn((_key: string) =>
              Effect.succeed(Transport.Admission.cases.refused.make({ reason: "not_granted" })),
            );
            const result = yield* Transport.checkHello({
              hello,
              url,
              tab,
              nonce,
              name: k.fingerprint,
              versions: [2, 1],
              ping: { min: 10_000, max: 60_000 },
              consume,
              admit,
            });
            expect(admit.mock.calls).toEqual([[k.fingerprint]]);
            expect(result).toEqual({
              _tag: "refused",
              reason: "not_granted",
              fingerprint: k.fingerprint,
            });
            expect(consume).not.toHaveBeenCalled();
          }),
        ),
      ),
      { seed: 119120, endOnFailure: true, numRuns: 40 },
    );
  });

  for (const binding of ["tab", "nonce"] as const) {
    it.effect.prop(
      `p26: an unsigned ${binding} claim cannot differ from the ${binding} bound by the proof`,
      { generated: Schema.String },
      ({ generated }) =>
        Effect.forEach(
          [`another-${binding}`, generated],
          (value) =>
            Effect.gen(function* () {
              const x = yield* setup();
              expect(
                yield* Transport.checkHello({
                  hello: {
                    ...x.hello,
                    [binding]: value === x.hello[binding] ? `another-${value}` : value,
                  },
                  ...x.trusted,
                }),
              ).toMatchObject({ _tag: "refused", reason: "bad_signature" });
              expect(x.admit).not.toHaveBeenCalled();
              expect(x.consume).not.toHaveBeenCalled();
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect("p82: a client with an unknown OS can still initialize", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      expect(yield* Transport.checkHello({ hello: { ...x.hello, os: "unknown" }, ...x.trusted })).toMatchObject({
        _tag: "online",
        hello: { os: "unknown" },
      });
    }),
  );
  it.effect("p26: a checked window goes online with the fold's identity and chosen version", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      const checked = Transport.checkHello({ hello: x.hello, ...x.trusted });
      const result = yield* checked;
      expect(result).toMatchObject({
        _tag: "online",
        who: x.who,
        version: 2,
        ping: 30_000,
        hello: { nonce },
      });
      expect(x.admit).toHaveBeenCalledOnce();
      expect(x.consume).toHaveBeenCalledOnce();
    }),
  );
  it("p82: agreement is the maximum intersection, independent of order and duplicates", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 9 })),
        fc.array(fc.integer({ min: 1, max: 9 })),
        (client, server) => {
          const common = [...new Set(client)].filter((v) => server.includes(v));
          expect(Transport.selectVersion(client, server)).toEqual(common.length ? Math.max(...common) : null);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });

  for (const binding of ["nonce", "url", "tab", "name"] as const) {
    it.effect(`p26: changed trusted ${binding} refuses before admission`, () =>
      Effect.gen(function* () {
        const x = yield* setup();
        const checked = Transport.checkHello({
          hello: x.hello,
          ...x.trusted,
          [binding]: "changed",
        });
        const result = yield* checked;
        expect(result._tag).toBe("refused");
        expect(x.admit).not.toHaveBeenCalled();
        expect(x.consume).not.toHaveBeenCalled();
      }),
    );
  }

  it.effect("p26: a consumed nonce cannot initialize again", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      const first = Transport.checkHello({ hello: x.hello, ...x.trusted });
      expect((yield* first)._tag).toBe("online");
      const repeated = Transport.checkHello({ hello: x.hello, ...x.trusted });
      expect((yield* repeated)._tag).toBe("refused");
    }),
  );

  for (const kind of ["signature", "key", "version", "unknown"] as const) {
    it.effect.prop(
      `p26/p82: ${kind} refusal has no nonce write or successful admission`,
      { generated: Transport.Admission.cases.refused },
      ({ generated }) =>
        Effect.forEach(
          [Transport.Admission.cases.refused.make({ reason: "not_granted" }), generated],
          (value) =>
            Effect.gen(function* () {
              const x = yield* setup();
              const hello = {
                ...x.hello,
                ...(kind === "signature"
                  ? { signed: "broken" }
                  : kind === "key"
                    ? { key: `${x.hello.key}=` }
                    : kind === "version"
                      ? { versions: [8] }
                      : {}),
              };
              const admit = kind === "unknown" ? vi.fn(() => Effect.succeed(value)) : x.admit;
              const checked = Transport.checkHello({ hello, ...x.trusted, admit });
              const result = yield* checked;
              expect(result).toMatchObject({
                _tag: "refused",
                ...(kind === "version" ? { reason: "no_version" } : kind === "unknown" ? { reason: value.reason } : {}),
              });
              expect(x.consume).not.toHaveBeenCalled();
              expect(admit.mock.calls.length).toBe(kind === "unknown" ? 1 : 0);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect("p82/p66: additive hello fields are ignored, has/os preserved, ping clamped", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      const checked = Transport.checkHello({
        ...x.trusted,
        hello: { ...x.hello, future: { rank: "person" }, ping: "1ms" },
      });
      const result = yield* checked;
      expect(result).toMatchObject({ _tag: "online", who: x.who, version: 2, ping: 10_000 });
      assert(result._tag === "online");
      expect(result.hello).toMatchObject({ os: "ios", has: ["verify", "seal"] });
    }),
  );

  for (const [origin, host, accepted] of [
    ["https://fabrika.test", "127.0.0.1:8123", true],
    [null, "127.0.0.1:8123", true],
    ["null", "127.0.0.1:8123", false],
    ["https://fabrika.test.evil.test", "127.0.0.1:8123", false],
    ["https://fabrika.test@evil.test", "127.0.0.1:8123", false],
    ["not a URL", "127.0.0.1:8123", false],
    ["https://fabrika.test", "evil.test:8123", false],
  ] as const) {
    it(`p26 origin: ${origin} / ${host}`, () => {
      expect(
        Transport.sameOrigin({
          origin,
          host,
          origins: ["https://fabrika.test"],
          localHost: "127.0.0.1:8123",
          forwardedHost: "127.0.0.1:8123",
        }),
      ).toBe(accepted);
    });
  }
});
