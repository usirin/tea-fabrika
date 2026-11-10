// p27's vectors half and p44's writer half (docs/plan/tier-1-detail.md, "Properties"), for
// `transport/sshsig.ts`: SSHSIG written and checked, Ed25519 only, in the bytes OpenSSH's
// PROTOCOL.sshsig gives and `ssh-keygen -Y sign` writes. Written before the module (Tier 1, P7).
//
// The shape these tests hold the module to:
// - `checkSshsig({text, armored, space, signers})` never fails and never dies. It answers
//   `{signer}`, the entry of `signers` that matched, as given, or the one refusal
//   `{why: "bad_signature"}`, whatever the cause (p27: "refused with the same answer").
// - `KeyLine` is a schema that decodes one `ssh-ed25519 <base64> [comment]` line. `writeSshsig`
//   takes only a decoded one, so a bad line never reaches it, and it fails only with `sign`'s error.
//
// p44 runs the real `ssh-keygen`. With no `ssh-keygen` on the machine it fails loudly, never
// skips: a skipped law is a hole. Its keys are made in a fresh temp folder, removed after.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import { checkSshsig, KeyLine, writeSshsig } from "./sshsig.ts";

const SPACE = "fabrika-client";
const refused = { why: "bad_signature" };
const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const runs = { seed: SEED, numRuns: 40 };
const bodyArb = fc.string({ unit: "binary" });
const wrongType = fc.string().filter((type) => type !== "ssh-ed25519");

// P1's saved vectors (fixtures/next/sshsig/README.md), made once by real `ssh-keygen -Y sign`.
const VECTORS = resolve(import.meta.dirname, "../../../../../fixtures/next/sshsig");
const at = (name: string): string => readFileSync(join(VECTORS, name), "utf8");
const text = at("text.txt");
const goodSig = at("good.sig");
const signer = at("signer.pub").trim();
const other = at("other.pub").trim();
const ecdsa = at("ecdsa.pub").trim();

const check = (armored: string, signers: ReadonlyArray<string>, body: string = text) =>
  checkSshsig({ text: body, armored, space: SPACE, signers });

// The wire, for building blobs by hand: RFC 4251's `string` is a u32 length, then the bytes.
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const join8 = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => {
    out.set(p, offset);
    return offset + p.length;
  }, 0);
  return out;
};

const u32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};

const str = (s: Uint8Array | string): Uint8Array => {
  const bytes = typeof s === "string" ? utf8(s) : s;
  return join8(u32(bytes.length), bytes);
};

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const rows = (body: string): string => (body.match(/.{1,70}/g) ?? []).join("\n");

const armor = (blob: Uint8Array): string =>
  `-----BEGIN SSH SIGNATURE-----\n${rows(base64(blob))}\n-----END SSH SIGNATURE-----\n`;

const unarmor = (armored: string): Uint8Array =>
  Buffer.from(
    armored
      .split("\n")
      .filter((row) => !row.startsWith("-----"))
      .join(""),
    "base64",
  );

const keyBlob = (key: Uint8Array): Uint8Array => join8(str("ssh-ed25519"), str(key));

const lineFor = (blob: Uint8Array, comment?: string): string =>
  comment === undefined ? `ssh-ed25519 ${base64(blob)}` : `ssh-ed25519 ${base64(blob)} ${comment}`;

/** PROTOCOL.sshsig's blob, field by field. */
type Blob = {
  readonly magic: Uint8Array;
  readonly version: number;
  readonly key: Uint8Array;
  readonly space: Uint8Array;
  readonly reserved: Uint8Array;
  readonly hash: Uint8Array;
  readonly signature: Uint8Array;
};

const parse = (bytes: Uint8Array): Blob => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const take = (n: number): Uint8Array => bytes.slice(offset, (offset += n));
  const word = (): number => {
    const n = view.getUint32(offset);
    offset += 4;
    return n;
  };
  const field = (): Uint8Array => take(word());
  return {
    magic: take(6),
    version: word(),
    key: field(),
    space: field(),
    reserved: field(),
    hash: field(),
    signature: field(),
  };
};

const build = (b: Blob, tail: Uint8Array = new Uint8Array()): Uint8Array =>
  join8(b.magic, u32(b.version), str(b.key), str(b.space), str(b.reserved), str(b.hash), str(b.signature), tail);

/** What the signature covers: "SSHSIG", then namespace, reserved, hash name and H(message). */
const toSign = (space: string, hash: string, digest: Uint8Array): Uint8Array =>
  join8(utf8("SSHSIG"), str(space), str(""), str(hash), str(digest));

const good = parse(unarmor(goodSig));
/** `ssh-ed25519`, then a 32-byte key: 4 + 11 + 4 bytes before the key itself. */
const goodKey = good.key.slice(19);
/** `ssh-ed25519`, then a 64-byte signature. */
const goodRaw = good.signature.slice(19);

// A fresh Ed25519 key from WebCrypto, extractable so the test can hand it to `ssh-keygen` too.
type Key = {
  readonly line: string;
  readonly publicKey: Uint8Array;
  readonly seed: Uint8Array;
  readonly privateKey: CryptoKey;
};

const freshKey = (comment?: string): Effect.Effect<Key> =>
  Effect.gen(function* () {
    const pair = yield* Effect.promise(() => crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
    const raw = yield* Effect.promise(() => crypto.subtle.exportKey("raw", pair.publicKey));
    const pkcs8 = yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const publicKey = new Uint8Array(raw);
    return {
      line: lineFor(keyBlob(publicKey), comment),
      publicKey,
      seed: new Uint8Array(pkcs8).slice(-32), // PKCS#8 for Ed25519 ends with the 32-byte seed
      privateKey: pair.privateKey,
    };
  });

const signWith =
  (key: Key) =>
  (bytes: Uint8Array): Effect.Effect<Uint8Array> =>
    Effect.promise(() => crypto.subtle.sign("Ed25519", key.privateKey, new Uint8Array(bytes))).pipe(
      Effect.map((sig) => new Uint8Array(sig)),
    );

const digest = (name: "SHA-256" | "SHA-384" | "SHA-512", bytes: Uint8Array) =>
  Effect.promise(() => crypto.subtle.digest(name, new Uint8Array(bytes))).pipe(Effect.map((d) => new Uint8Array(d)));

const decodeLine = Schema.decodeUnknownEffect(KeyLine);

/** `writeSshsig` over `body` with `key`, its line decoded first, as every caller must. */
const write = (key: Key, body: string) =>
  Effect.flatMap(decodeLine(key.line), (line) => writeSshsig({ text: body, space: SPACE, line, sign: signWith(key) }));

/** A blob signed by hand, with any hash name: what `ssh-keygen` would write if it used one. */
const signedByHand = (key: Key, hash: string, digested: Uint8Array) =>
  Effect.map(signWith(key)(toSign(SPACE, hash, digested)), (raw) =>
    armor(
      build({
        magic: utf8("SSHSIG"),
        version: 1,
        key: keyBlob(key.publicKey),
        space: utf8(SPACE),
        reserved: new Uint8Array(),
        hash: utf8(hash),
        signature: join8(str("ssh-ed25519"), str(raw)),
      }),
    ),
  );

describe("the test's own wire helpers", () => {
  it("format: read good.sig and write it back byte for byte, 70 to a row as ssh-keygen wraps", () => {
    expect(armor(build(good))).toBe(goodSig);
    expect(lineFor(good.key, "signer@fabrika.test")).toBe(signer);
  });
});

describe("p27, the saved ssh-keygen vectors", () => {
  it.effect("vector: passes good.sig over text.txt and names the signer as given", () =>
    Effect.gen(function* () {
      expect(yield* check(goodSig, [signer])).toStrictEqual({ signer });
    }),
  );

  it.effect("vector: refuses good.sig over changed.txt", () =>
    Effect.gen(function* () {
      expect(yield* check(goodSig, [signer], at("changed.txt"))).toStrictEqual(refused);
    }),
  );

  it.effect("vector: refuses a wrong namespace", () =>
    Effect.gen(function* () {
      expect(yield* check(at("wrong-namespace.sig"), [signer])).toStrictEqual(refused);
    }),
  );

  it.effect("vector: refuses another signer", () =>
    Effect.gen(function* () {
      expect(yield* check(at("other-signer.sig"), [signer])).toStrictEqual(refused);
    }),
  );

  it.effect("vector: refuses ECDSA, good to OpenSSH, even with its key named: Ed25519 only", () =>
    Effect.gen(function* () {
      expect(yield* check(at("ecdsa.sig"), [signer, ecdsa])).toStrictEqual(refused);
      expect(yield* check(at("ecdsa.sig"), [ecdsa])).toStrictEqual(refused);
    }),
  );

  it("finds the signer among other keys and garbage, by its key, not its place", async () => {
    // Plant: choose the first parseable signer without comparing its blob. Signer equality fails.
    const others = fc.array(fc.oneof(fc.constantFrom(other, ecdsa), fc.string()));
    await fc.assert(
      fc.asyncProperty(others, fc.nat(), others, fc.nat(), (before, place, more, barePlace) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const insert = (lines: string[], line: string, n: number) => {
              const at = n % (lines.length + 1);
              return [...lines.slice(0, at), line, ...lines.slice(at)];
            };
            expect(yield* check(goodSig, insert(before, signer, place))).toStrictEqual({ signer });
            const bare = lineFor(good.key);
            expect(yield* check(goodSig, insert(more, bare, barePlace))).toStrictEqual({
              signer: bare,
            });
          }),
        ),
      ),
      { ...runs, examples: [[[other, ecdsa, "garbage", ""], 4, [other], 1]] },
    );
  });

  it("refuses with no signers, and with only lines that are not keys", async () => {
    // Plant: return a key on parser or signer lookup failure. The empty-list refusal must fail.
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.constantFrom("ssh-ed25519", "ssh-ed25519 !!!"),
            fc.string().map((s) => `invalid-${s}`),
          ),
        ),
        (lines) =>
          Effect.runPromise(
            Effect.gen(function* () {
              expect(yield* check(goodSig, [])).toStrictEqual(refused);
              expect(yield* check(goodSig, [...lines, other])).toStrictEqual(refused);
            }),
          ),
      ),
      { ...runs, examples: [[["ssh-ed25519", "ssh-ed25519 !!!"]]] },
    );
  });
});

describe("p27, blobs built by hand from good.sig's bytes", () => {
  const shortKey = keyBlob(goodKey.slice(0, 31));
  const cases: ReadonlyArray<readonly [string, string, ReadonlyArray<string>]> = [
    ["version 2", armor(build({ ...good, version: 2 })), [signer]],
    ["version 0", armor(build({ ...good, version: 0 })), [signer]],
    ["a trailing byte", armor(build(good, Uint8Array.of(0))), [signer]],
    ["a cut blob", armor(unarmor(goodSig).slice(0, -10)), [signer]],
    ["another magic", armor(build({ ...good, magic: utf8("SSHSIH") })), [signer]],
    ["an unknown hash name", armor(build({ ...good, hash: utf8("sha384") })), [signer]],
    ["a key blob of 31 bytes", armor(build({ ...good, key: shortKey })), [signer, lineFor(shortKey)]],
    [
      "a signature of 63 bytes",
      armor(build({ ...good, signature: join8(str("ssh-ed25519"), str(goodRaw.slice(0, 63))) })),
      [signer],
    ],
    [
      "a padded signature, 65 bytes",
      armor(
        build({
          ...good,
          signature: join8(str("ssh-ed25519"), str(join8(goodRaw, Uint8Array.of(0)))),
        }),
      ),
      [signer],
    ],
    [
      "a signature typed as another algorithm",
      armor(build({ ...good, signature: join8(str("ssh-rsa"), str(goodRaw)) })),
      [signer],
    ],
    ["armor with its END line cut", goodSig.replace("-----END SSH SIGNATURE-----\n", ""), [signer]],
    ["armor with its BEGIN line cut", goodSig.replace("-----BEGIN SSH SIGNATURE-----\n", ""), [signer]],
    ["a body that is not base64", goodSig.replace("U1NIU0lH", "U1NIU0l!"), [signer]],
    ["an empty text", "", [signer]],
  ];
  it("refuses malformed blobs and armor with the same answer", async () => {
    // Plant: ignore the SSHSIG version. The version-2 example must still be refused.
    const built = fc
      .oneof(
        fc
          .nat({ max: 0xffffffff })
          .filter((n) => n !== 1)
          .map((version) => build({ ...good, version })),
        fc.uint8Array({ minLength: 1 }).map((tail) => build(good, tail)),
        fc.integer({ min: 1, max: unarmor(goodSig).length }).map((n) => unarmor(goodSig).slice(0, -n)),
        fc
          .uint8Array({ minLength: 6, maxLength: 6 })
          .filter((magic) => base64(magic) !== base64(utf8("SSHSIG")))
          .map((magic) => build({ ...good, magic })),
        fc
          .string()
          .filter((hash) => hash !== "sha512" && hash !== "sha256")
          .map((hash) => build({ ...good, hash: utf8(hash) })),
        fc
          .uint8Array()
          .filter((raw) => raw.length !== 64)
          .map((raw) => build({ ...good, signature: join8(str("ssh-ed25519"), str(raw)) })),
        wrongType.map((type) => build({ ...good, signature: join8(str(type), str(goodRaw)) })),
      )
      .map((bytes) => ({ armored: armor(bytes), signers: [signer] }));
    const malformed = fc.oneof(
      built,
      fc
        .uint8Array()
        .filter((bytes) => bytes.length !== 32)
        .map((bytes) => {
          const key = keyBlob(bytes);
          return { armored: armor(build({ ...good, key })), signers: [signer, lineFor(key)] };
        }),
      fc.string().map((body) => ({
        armored: `-----BEGIN SSH SIGNATURE-----\n!${body}\n-----END SSH SIGNATURE-----\n`,
        signers: [signer],
      })),
    );
    await fc.assert(
      fc.asyncProperty(malformed, ({ armored, signers }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            expect(yield* check(armored, signers)).toStrictEqual(refused);
          }),
        ),
      ),
      { ...runs, examples: cases.map(([, armored, signers]) => [{ armored, signers: [...signers] }]) },
    );
  });

  it("passes sha512 and sha256 signed by hand, and refuses sha384 signed the same way", async () => {
    // Plant: remove SHA-256 from HASHES. The SHA-256 signer equality must fail.
    await fc.assert(
      fc.asyncProperty(bodyArb, fc.string(), (body, comment) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const key = yield* freshKey(comment);
            const bytes = utf8(body);
            const sha512 = yield* signedByHand(key, "sha512", yield* digest("SHA-512", bytes));
            const sha256 = yield* signedByHand(key, "sha256", yield* digest("SHA-256", bytes));
            const sha384 = yield* signedByHand(key, "sha384", yield* digest("SHA-384", bytes));
            expect(yield* check(sha512, [key.line], body)).toStrictEqual({ signer: key.line });
            expect(yield* check(sha256, [key.line], body)).toStrictEqual({ signer: key.line });
            expect(yield* check(sha384, [key.line], body)).toStrictEqual(refused);
          }),
        ),
      ),
      { ...runs, examples: [[text, "hand@fabrika.test"]] },
    );
  });

  it("refuses a good signature checked under another space's bytes", async () => {
    // Plant: accept even when Ed25519 verification is false. The signed-space refusal must fail.
    await fc.assert(
      fc.asyncProperty(
        bodyArb,
        fc.string().filter((s) => s !== SPACE),
        (body, space) =>
          Effect.runPromise(
            Effect.gen(function* () {
              // Signed as "fabrika-other" but labelled "fabrika-client": the space is in the signed bytes.
              const key = yield* freshKey();
              const raw = yield* signWith(key)(toSign(space, "sha512", yield* digest("SHA-512", utf8(body))));
              const armored = armor(
                build({
                  magic: utf8("SSHSIG"),
                  version: 1,
                  key: keyBlob(key.publicKey),
                  space: utf8(SPACE),
                  reserved: new Uint8Array(),
                  hash: utf8("sha512"),
                  signature: join8(str("ssh-ed25519"), str(raw)),
                }),
              );
              expect(yield* check(armored, [key.line], body)).toStrictEqual(refused);
            }),
          ),
      ),
      { ...runs, examples: [[text, "fabrika-other"]] },
    );
  });
});

describe("KeyLine", () => {
  it("decodes an ssh-ed25519 line, with or without its comment, and keeps it as given", async () => {
    // Plant: use Schema.Trim for KeyLine. Exact decoded-line equality must fail.
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.string(), (bytes, comment) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const blob = keyBlob(bytes);
            const line = lineFor(blob, comment);
            expect(yield* decodeLine(line)).toBe(line);
            expect(yield* decodeLine(lineFor(blob))).toBe(lineFor(blob));
          }),
        ),
      ),
      { ...runs, examples: [[goodKey, "signer@fabrika.test"]] },
    );
  });

  const bad: ReadonlyArray<readonly [string, string]> = [
    ["an ECDSA line", ecdsa],
    ["an empty line", ""],
    ["a line with no key", "ssh-ed25519"],
    ["a line whose key is not base64", "ssh-ed25519 !!!notbase64 x@fabrika.test"],
    ["an ssh-ed25519 line holding an ECDSA blob", `ssh-ed25519 ${ecdsa.split(" ")[1] ?? ""}`],
    ["a key of 31 bytes", lineFor(keyBlob(goodKey.slice(0, 31)))],
    ["a key blob with a byte after it", lineFor(join8(good.key, Uint8Array.of(0)))],
  ];
  it("refuses malformed and non-Ed25519 key lines", async () => {
    // Plant: ignore the outer key type word. Exit.isFailure must become false.
    const invalid = fc.oneof(
      fc
        .uint8Array()
        .filter((bytes) => bytes.length !== 32)
        .map((bytes) => lineFor(keyBlob(bytes))),
      fc.uint8Array({ minLength: 1 }).map((tail) => lineFor(join8(good.key, tail))),
      fc.string().map((s) => `ssh-ed25519 !${s}`),
      wrongType.filter((type) => !/\s/.test(type)).map((type) => `${type} ${base64(good.key)}`),
    );
    await fc.assert(
      fc.asyncProperty(invalid, (line) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(decodeLine(line));
            expect(Exit.isFailure(exit)).toBe(true);
          }),
        ),
      ),
      { ...runs, examples: bad.map(([, line]) => [line]) },
    );
  });

  it("keeps a comment as given, runs of spaces and a tab inside it too", async () => {
    // Plant: trim decoded lines and strip returned comments. Exact line equality must fail.
    await fc.assert(
      fc.asyncProperty(bodyArb, (comment) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const line = lineFor(good.key, comment);
            expect(yield* decodeLine(line)).toBe(line);
            expect(yield* check(goodSig, [line])).toStrictEqual({ signer: line });
          }),
        ),
      ),
      { ...runs, examples: [["my  laptop\tat home"]] },
    );
  });

  it("is the only line writeSshsig takes: a plain string does not typecheck", () => {
    // Compile-time type law. The owner rule keeps this as a type check.
    type Line = Parameters<typeof writeSshsig>[0]["line"];
    // @ts-expect-error a plain string is not a KeyLine: decode it first, so a bad line never reaches the writer
    const plain: Line = signer;
    expect(plain).toBe(signer);
  });
});

// The mutation step's gaps (P7). A field equal to the start of the one wanted is not that field:
// the plan wants an `ssh-ed25519` key and signature and the namespace exactly, not a prefix of them.
describe("p27, each field exactly, never a prefix of it", () => {
  /** A good signature by `key` over `text` under SPACE, then some of its blob's fields swapped. */
  const signedThenSwapped = (key: Key, swap: (raw: Uint8Array) => Partial<Blob>, body = text) =>
    Effect.gen(function* () {
      const raw = yield* signWith(key)(toSign(SPACE, "sha512", yield* digest("SHA-512", utf8(body))));
      return armor(
        build({
          magic: utf8("SSHSIG"),
          version: 1,
          key: keyBlob(key.publicKey),
          space: utf8(SPACE),
          reserved: new Uint8Array(),
          hash: utf8("sha512"),
          signature: join8(str("ssh-ed25519"), str(raw)),
          ...swap(raw),
        }),
      );
    });
  it("passes the same blob with nothing swapped, so each refusal below is the swap's", async () => {
    // Plant: refuse every verified Ed25519 signature. The signer equality must fail.
    await fc.assert(
      fc.asyncProperty(bodyArb, (body) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const key = yield* freshKey();
            expect(yield* check(yield* signedThenSwapped(key, () => ({}), body), [key.line], body)).toStrictEqual({
              signer: key.line,
            });
          }),
        ),
      ),
      { ...runs, examples: [[text]] },
    );
  });

  it("refuses any other key type, even with a line holding that blob named", async () => {
    // Plant: ignore the embedded Ed25519 algorithm name. The key-type refusal must fail.
    await fc.assert(
      fc.asyncProperty(bodyArb, wrongType, (body, type) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const key = yield* freshKey();
            const typed = join8(str(type), str(key.publicKey));
            const armored = yield* signedThenSwapped(key, () => ({ key: typed }), body);
            expect(yield* check(armored, [key.line, lineFor(typed)], body)).toStrictEqual(refused);
          }),
        ),
      ),
      {
        ...runs,
        examples: [
          [text, "ssh-ed2551"],
          [text, ""],
        ],
      },
    );
  });

  it("refuses any other signature type", async () => {
    // Plant: ignore the embedded Ed25519 algorithm name. The signature-type refusal must fail.
    await fc.assert(
      fc.asyncProperty(bodyArb, wrongType, (body, type) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const key = yield* freshKey();
            const armored = yield* signedThenSwapped(
              key,
              (raw) => ({
                signature: join8(str(type), str(raw)),
              }),
              body,
            );
            expect(yield* check(armored, [key.line], body)).toStrictEqual(refused);
          }),
        ),
      ),
      {
        ...runs,
        examples: [
          [text, "ssh-ed2551"],
          [text, ""],
        ],
      },
    );
  });

  it("KeyLine refuses any other blob type", async () => {
    // Plant: ignore the embedded Ed25519 algorithm name. Exit.isFailure must become false.
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), wrongType, (bytes, type) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(decodeLine(lineFor(join8(str(type), str(bytes)))));
            expect(Exit.isFailure(exit)).toBe(true);
          }),
        ),
      ),
      {
        ...runs,
        examples: [
          [goodKey, "ssh-ed2551"],
          [goodKey, ""],
        ],
      },
    );
  });

  it("refuses any other namespace field, signed over the whole space", async () => {
    // Plant: ignore the embedded namespace comparison. The namespace refusal must fail.
    await fc.assert(
      fc.asyncProperty(
        bodyArb,
        fc.string().filter((s) => s !== SPACE),
        (body, space) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const key = yield* freshKey();
              const armored = yield* signedThenSwapped(key, () => ({ space: utf8(space) }), body);
              expect(yield* check(armored, [key.line], body)).toStrictEqual(refused);
            }),
          ),
      ),
      {
        ...runs,
        examples: [
          [text, "fabrika-clien"],
          [text, "fabrika"],
          [text, ""],
        ],
      },
    );
  });
});

describe("p27, the armor's own words", () => {
  const BEGIN = "-----BEGIN SSH SIGNATURE-----";
  const END = "-----END SSH SIGNATURE-----";
  // Each the same length as the line it stands in for, so only its words differ.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["a bad BEGIN line and a good END line", goodSig.replace(BEGIN, "-----BEGIN SSH SIGNATURX-----")],
    ["another kind's BEGIN line", goodSig.replace(BEGIN, "-----BEGIN PGP SIGNATURE-----")],
    ["a good BEGIN line and a bad END line", goodSig.replace(END, "-----END SSH SIGNATURX-----")],
    ["another kind's END line", goodSig.replace(END, "-----END PGP SIGNATURE-----")],
    [
      "both lines bad",
      goodSig.replace(BEGIN, "-----BEGIN SSH SIGNATURX-----").replace(END, "-----END SSH SIGNATURX-----"),
    ],
  ];
  it("refuses changed armor words of the same length", async () => {
    // Plant: check marker lengths alone. The changed-marker refusal must fail.
    const changed = fc.tuple(fc.nat(), fc.integer({ min: 1, max: 127 }), fc.boolean()).map(([place, delta, begin]) => {
      const word = begin ? BEGIN : END;
      const at = place % word.length;
      const swap = String.fromCharCode((word.charCodeAt(at) + delta) % 128);
      return goodSig.replace(word, `${word.slice(0, at)}${swap}${word.slice(at + 1)}`);
    });
    await fc.assert(
      fc.asyncProperty(changed, (armored) =>
        Effect.runPromise(
          Effect.gen(function* () {
            expect(armored).not.toBe(goodSig);
            expect(armored.length).toBe(goodSig.length);
            expect(yield* check(armored, [signer])).toStrictEqual(refused);
          }),
        ),
      ),
      { ...runs, examples: cases.map(([, armored]) => [armored]) },
    );
  });
});

// A key line is `<type> <base64> [comment]`. Between its parts it takes a run of spaces or tabs,
// as OpenSSH's own reader does (the lead's call on P7), and the key is the same one.
describe("a key line's parts and its type", () => {
  const [type = "", key = "", comment = ""] = signer.split(" ");
  it("KeyLine takes runs of spaces and tabs and matches the same key", async () => {
    // Plant: normalize the returned signer to two space-separated words. Exact equality fails.
    const gap = fc.array(fc.constantFrom(" ", "\t"), { minLength: 1 }).map((chars) => chars.join(""));
    await fc.assert(
      fc.asyncProperty(gap, gap, (before, after) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const line = `${type}${before}${key}${after}${comment}`;
            expect(yield* decodeLine(line)).toBe(line);
            // good.sig was signed by signer.pub's key, so a match means the same key blob.
            expect(yield* check(goodSig, [line])).toStrictEqual({ signer: line });
          }),
        ),
      ),
      {
        ...runs,
        examples: [
          ["  ", " "],
          ["\t", " "],
          [" ", "\t"],
        ],
      },
    );
  });

  const bad: ReadonlyArray<readonly [string, string]> = [
    ["an ECDSA type word over an Ed25519 blob", `ecdsa-sha2-nistp256 ${key}`],
    ["an RSA type word over an Ed25519 blob", `ssh-rsa ${key} signer@fabrika.test`],
  ];
  it("KeyLine refuses a different type word and never matches it as a signer", async () => {
    // Plant: ignore the outer key type word. Exit.isFailure must become false.
    const invalid = wrongType.filter((type) => !/\s/.test(type)).map((type) => `${type} ${key} ${comment}`);
    await fc.assert(
      fc.asyncProperty(invalid, (line) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(decodeLine(line));
            expect(Exit.isFailure(exit)).toBe(true);
            expect(yield* check(goodSig, [line])).toStrictEqual(refused);
          }),
        ),
      ),
      { ...runs, examples: bad.map(([, line]) => [line]) },
    );
  });
});

// p44: one signature shape, against the real `ssh-keygen`.
const home = mkdtempSync(join(tmpdir(), "p44-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const keygen = (args: ReadonlyArray<string>, input?: string) =>
  Effect.sync(() => {
    const run = spawnSync("ssh-keygen", args, { input, encoding: "utf8" });

    if (run.error !== undefined) {
      throw new Error(`p44 needs ssh-keygen and it did not run: ${run.error.message}`);
    }

    return run;
  });

const file = (name: string, body: string, mode = 0o644): string => {
  const path = join(home, name);
  writeFileSync(path, body, { mode });
  return path;
};

/** An unencrypted `openssh-key-v1` private key file, so `ssh-keygen` can sign with a WebCrypto key. */
const opensshPrivate = (key: Key): string => {
  const checkWord = u32(0x5a5a5a5a);
  const inner = join8(
    checkWord,
    checkWord,
    str("ssh-ed25519"),
    str(key.publicKey),
    str(join8(key.seed, key.publicKey)),
    str("same@fabrika.test"),
  );
  const pad = Uint8Array.from({ length: (8 - (inner.length % 8)) % 8 }, (_, i) => i + 1);
  const blob = join8(
    utf8("openssh-key-v1\0"),
    str("none"),
    str("none"),
    str(""),
    u32(1),
    str(keyBlob(key.publicKey)),
    str(join8(inner, pad)),
  );
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${rows(base64(blob))}\n-----END OPENSSH PRIVATE KEY-----\n`;
};

describe("p44, one signature shape, with real ssh-keygen", () => {
  it.effect("scenario: what writeSshsig makes passes ssh-keygen -Y verify and checkSshsig", () =>
    Effect.gen(function* () {
      const key = yield* freshKey("ours@fabrika.test");
      const body = "grant: a window key\nfor: a person\n";
      const armored = yield* write(key, body);
      const allowed = file("ours.allowed", `ours@fabrika.test ${key.line}\n`);
      const sig = file("ours.sig", armored);
      const run = yield* keygen(
        ["-Y", "verify", "-f", allowed, "-I", "ours@fabrika.test", "-n", SPACE, "-s", sig],
        body,
      );
      expect(run.status, run.stderr).toBe(0);
      expect(yield* check(armored, [key.line], body)).toStrictEqual({ signer: key.line });
      const elsewhere = yield* keygen(
        ["-Y", "verify", "-f", allowed, "-I", "ours@fabrika.test", "-n", "fabrika-other", "-s", sig],
        body,
      );
      expect(elsewhere.status).not.toBe(0);
    }),
  );

  it.effect("scenario: what ssh-keygen -Y sign makes passes checkSshsig, sha512 and sha256", () =>
    Effect.gen(function* () {
      const made = join(home, "made");
      const keys = yield* keygen(["-q", "-t", "ed25519", "-N", "", "-C", "made@fabrika.test", "-f", made]);
      expect(keys.status, keys.stderr).toBe(0);
      const line = readFileSync(`${made}.pub`, "utf8").trim();
      const body = "made by ssh-keygen\nä ü ş\n";

      for (const options of [[], ["-O", "hashalg=sha256"]]) {
        const msg = file("made.msg", body);
        const run = yield* keygen(["-Y", "sign", "-f", made, "-n", SPACE, ...options, msg]);
        expect(run.status, run.stderr).toBe(0);
        const armored = readFileSync(`${msg}.sig`, "utf8");
        rmSync(`${msg}.sig`);
        expect(yield* check(armored, [other, line], body)).toStrictEqual({ signer: line });
        expect(yield* check(armored, [other], body)).toStrictEqual(refused);
      }
    }),
  );

  it.effect("scenario: writeSshsig and ssh-keygen -Y sign give the same file, byte for byte", () =>
    Effect.gen(function* () {
      // Ed25519 is deterministic: one key and one text give one signature, so one file.
      const key = yield* freshKey();
      const body = text;
      const ours = yield* write(key, body);
      const keyFile = file("same", opensshPrivate(key), 0o600);
      const msg = file("same.msg", body);
      const run = yield* keygen(["-Y", "sign", "-f", keyFile, "-n", SPACE, msg]);
      expect(run.status, run.stderr).toBe(0);
      expect(ours).toBe(readFileSync(`${msg}.sig`, "utf8"));
    }),
  );
});

describe("properties", () => {
  const runs = { seed: SEED, endOnFailure: true };

  it("round trip: any text, a fresh key, its line among any others, gives that line back", async () => {
    // Plant: choose the first parseable signer without comparing its blob. Signer equality fails.
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: "binary" }),
        fc.array(fc.oneof(fc.constant(other), fc.constant(ecdsa), fc.string()), { maxLength: 4 }),
        fc.nat(),
        fc.boolean(),
        (body, others, place, named) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const key = yield* freshKey(named ? "round@fabrika.test" : undefined);
              const armored = yield* write(key, body);
              const at = place % (others.length + 1);
              const signers = [...others.slice(0, at), key.line, ...others.slice(at)];
              expect(yield* check(armored, signers, body)).toStrictEqual({ signer: key.line });
            }),
          ),
      ),
      { ...runs, numRuns: 40 },
    );
  });

  it("any change to the text refuses", async () => {
    // Plant: accept even when Ed25519 verification is false. The changed-text refusal must fail.
    const key = await Effect.runPromise(freshKey());
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: "binary", minLength: 1 }),
        fc.nat(),
        fc.string({ unit: "binary", minLength: 1, maxLength: 1 }),
        (body, place, swap) => {
          const chars = [...body];
          const i = place % chars.length;
          const changed = [...chars.slice(0, i), swap, ...chars.slice(i + 1)].join("");
          fc.pre(Buffer.compare(Buffer.from(utf8(changed)), Buffer.from(utf8(body))) !== 0);
          return Effect.runPromise(
            Effect.gen(function* () {
              const armored = yield* write(key, body);
              expect(yield* check(armored, [key.line], changed)).toStrictEqual(refused);
            }),
          );
        },
      ),
      { ...runs, numRuns: 60 },
    );
  });

  it("any one changed base64 character that changes the blob refuses", async () => {
    // Plant: accept even when Ed25519 verification is false. The changed-blob refusal must fail.
    const lines = goodSig.split("\n");
    const body = lines.slice(1, -2); // the rows between BEGIN and END
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    await fc.assert(
      fc.asyncProperty(fc.nat(), fc.nat(), fc.constantFrom(...ALPHABET), (row, col, swap) => {
        const r = row % body.length;
        const line = body[r] ?? "";
        const c = col % line.length;
        const changedRow = `${line.slice(0, c)}${swap}${line.slice(c + 1)}`;
        const changed = [lines[0], ...body.map((x, i) => (i === r ? changedRow : x)), ...lines.slice(-2)];
        const armored = changed.join("\n");
        fc.pre(Buffer.compare(Buffer.from(unarmor(armored)), Buffer.from(unarmor(goodSig))) !== 0);
        return Effect.runPromise(
          Effect.gen(function* () {
            expect(yield* check(armored, [signer, other, ecdsa])).toStrictEqual(refused);
          }),
        );
      }),
      { ...runs, numRuns: 150 },
    );
  });

  // Bytes that start like a blob, so the parser goes past its first check: a magic, a version,
  // then fields whose lengths may lie, point past the end, or be 2^32 - 1.
  const nearBlob = fc
    .tuple(
      fc.constantFrom(utf8("SSHSIG"), utf8("SSHSIH")),
      fc.constantFrom(0, 1, 2, 0xffffffff),
      fc.array(
        fc.oneof(
          fc.uint8Array({ maxLength: 80 }).map((bytes) => str(bytes)),
          fc.constantFrom("ssh-ed25519", "sha512", "sha256", SPACE, "").map((s) => str(s)),
          fc
            .tuple(fc.constantFrom(0, 31, 32, 64, 0x7fffffff, 0xffffffff), fc.uint8Array({ maxLength: 8 }))
            .map(([n, bytes]) => join8(u32(n), bytes)),
          fc.constant(good.key).map((k) => str(k)),
        ),
        { maxLength: 7 },
      ),
    )
    .map(([magic, version, fields]) => join8(magic, u32(version), ...fields));

  it("total: any armored text or bytes gets an answer, never a failure or a defect", async () => {
    // Plant: return a key on parser failure. The malformed-input refusal must fail.
    const answers = (armored: string) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(check(armored, [signer, other, ecdsa, "garbage"]));
          expect(Exit.isSuccess(exit)).toBe(true);
          expect(Exit.isSuccess(exit) ? exit.value : undefined).toStrictEqual(refused);
        }),
      );
    await fc.assert(fc.asyncProperty(fc.string({ unit: "binary" }), answers), {
      ...runs,
      numRuns: 150,
    });
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), (bytes) => answers(armor(bytes))),
      { ...runs, numRuns: 150 },
    );
    await fc.assert(
      fc.asyncProperty(nearBlob, (bytes) => answers(armor(bytes))),
      { ...runs, numRuns: 300 },
    );
  });
});
