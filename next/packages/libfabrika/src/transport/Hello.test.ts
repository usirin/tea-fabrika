// p26/p82. Hello echoes the issued nonce, bound by the existing signature with the URL and tab.
// checkHello takes trusted upgrade values, an atomic nonce consumer and admission.
// It answers online {who,version,ping} or refused {reason}; capability claims grant no rank.
// Plants: accept the first version; omit one signed binding; consume before checking; admit verify.
import { createHash } from "node:crypto";
import { assert, describe, expect, it, vi } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { checkHello, sameOrigin, selectVersion } from "./Hello.ts";
import { Admission, type Who } from "./Wire.ts";

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
  } satisfies typeof Who.Type;
  let used = false;
  const consume = vi.fn(() => {
    if (used) {
      return false;
    }

    used = true;
    return true;
  });
  const admit = vi.fn(() => Effect.succeed(Admission.cases.admitted.make({ who })));
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
              Effect.succeed(Admission.cases.refused.make({ reason: "not_granted" })),
            );
            const result = yield* checkHello({
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
                yield* checkHello({
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
      expect(yield* checkHello({ hello: { ...x.hello, os: "unknown" }, ...x.trusted })).toMatchObject({
        _tag: "online",
        hello: { os: "unknown" },
      });
    }),
  );
  it.effect("p26: a checked window goes online with the fold's identity and chosen version", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      const checked = checkHello({ hello: x.hello, ...x.trusted });
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
          expect(selectVersion(client, server)).toEqual(common.length ? Math.max(...common) : null);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });

  for (const binding of ["nonce", "url", "tab", "name"] as const) {
    it.effect(`p26: changed trusted ${binding} refuses before admission`, () =>
      Effect.gen(function* () {
        const x = yield* setup();
        const checked = checkHello({
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
      const first = checkHello({ hello: x.hello, ...x.trusted });
      expect((yield* first)._tag).toBe("online");
      const repeated = checkHello({ hello: x.hello, ...x.trusted });
      expect((yield* repeated)._tag).toBe("refused");
    }),
  );

  for (const kind of ["signature", "key", "version", "unknown"] as const) {
    it.effect.prop(
      `p26/p82: ${kind} refusal has no nonce write or successful admission`,
      { generated: Admission.cases.refused },
      ({ generated }) =>
        Effect.forEach(
          [Admission.cases.refused.make({ reason: "not_granted" }), generated],
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
              const checked = checkHello({ hello, ...x.trusted, admit });
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
      const checked = checkHello({
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
        sameOrigin({
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

// T737 D1, next/. The origin check decodes its URL with Effect Schema now. An independent copy of the
// check before that change is the oracle: the same answer for every generated origin, allowlist and
// host relation, in the same order of checks (host first, then null, then the URL).
const oldSameOrigin = (a: Parameters<typeof sameOrigin>[0]): boolean => {
  if (a.localHost !== undefined && a.host !== a.localHost) {
    return false;
  }

  if (a.origin === null) {
    return true;
  }

  if (!URL.canParse(a.origin)) {
    return false;
  }

  const url = new URL(a.origin);
  return (
    (url.protocol === "https:" || url.protocol === "http:") && url.origin === a.origin && a.origins.includes(url.origin)
  );
};

/** What the URL parser makes of a text, or the text itself when it does not parse. */
const normalized = (text: string) => (URL.canParse(text) ? new URL(text).origin : text);

const Canonical = fc
  .record({
    protocol: fc.constantFrom("https", "http", "ftp", "ws", "file", "javascript", "blob"),
    host: fc.oneof(fc.domain(), fc.constantFrom("127.0.0.1", "[::1]", "localhost", "fabrika.test")),
    port: fc.option(fc.integer({ min: 0, max: 65_535 }), { nil: undefined }),
  })
  .map(({ protocol, host, port }) => `${protocol}://${host}${port === undefined ? "" : `:${port}`}`);

/** Mutations around the boundaries the old check drew: empty, relative, port, path, case, credentials, protocol. */
const Origin = fc.oneof(
  Canonical,
  fc.webUrl(),
  fc
    .tuple(Canonical, fc.constantFrom("/", "/path", "?q", "#h", ":80", ":443", ":", " ", "\n", "%2e"))
    .map(([origin, tail]) => `${origin}${tail}`),
  Canonical.map((origin) => origin.toUpperCase()),
  Canonical.map((origin) => origin.replace("://", "://user:pass@")),
  Canonical.map((origin) => origin.replace("://", ":")),
  Canonical.map((origin) => ` ${origin}`),
  fc.constantFrom("", "null", "/", "/relative", "//fabrika.test", "fabrika.test", "https:", "https://", "not a URL"),
  fc.string(),
);

const Origins = fc.record({
  origin: fc.option(Origin, { nil: null }),
  others: fc.array(Origin, { maxLength: 3 }),
  // Whether the allowlist holds the text as given, its normalized origin, both or neither.
  allow: fc.constantFrom("given", "normalized", "both", "neither"),
  host: fc.constantFrom("127.0.0.1:8123", "evil.test:8123", ""),
  localHost: fc.option(fc.constantFrom("127.0.0.1:8123", "evil.test:8123", ""), { nil: undefined }),
  forwardedHost: fc.option(fc.constantFrom("127.0.0.1:8123", "evil.test:8123"), { nil: undefined }),
});

describe("T737 D1 origin acceptance equals the old check, next/", () => {
  it("sameOrigin answers as the old URL check did for generated origins, allowlists and hosts", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(Origins, ({ origin, others, allow, host, localHost, forwardedHost }) => {
        const given = origin === null ? [] : [origin];
        const norm = origin === null ? [] : [normalized(origin)];
        const origins = [
          ...others,
          ...(allow === "given" || allow === "both" ? given : []),
          ...(allow === "normalized" || allow === "both" ? norm : []),
        ];
        const a = {
          origin,
          host,
          origins,
          ...(localHost === undefined ? {} : { localHost }),
          ...(forwardedHost === undefined ? {} : { forwardedHost }),
        };
        const expected = oldSameOrigin(a);
        expect(sameOrigin(a)).toBe(expected);
        seen.add(
          `${expected}:${origin === null ? "null" : origin === normalized(origin) ? "canonical" : "other"}:${allow}`,
        );
      }),
      { seed: 119120, numRuns: 2_000 },
    );

    // The boundaries the plants need: a canonical allowed origin, a refused non-canonical one whose
    // normalized form is allowed, a null origin, and a host mismatch that refuses first.
    for (const side of [
      "true:canonical:given",
      "false:other:normalized",
      "true:null:neither",
      "false:canonical:both",
    ]) {
      expect(seen, side).toContain(side);
    }
  });
});
