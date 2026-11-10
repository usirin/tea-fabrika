import { spawnSync } from "node:child_process";
// p27, question 19. Real Chromium 156 assertion from experiment 230, captured by the lead.
// Plants: DER treated as P1363; challenge only the text hash; UP accepted without UV; a prefix
// match admits ordinary ECDSA; JSON reserialized before verification; BE always refused.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { checkSshsig, verifySshsig } from "./Sshsig.ts";
import { PasskeyLine, writeWebauthnSshsig } from "./Webauthn.ts";

const SPACE = "fabrika-client";
const utf8 = (text: string) => new TextEncoder().encode(text);

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

const integer = (raw: Uint8Array) => {
  let at = 0;

  while (raw[at] === 0) {
    at++;
  }

  const bytes = Buffer.from(raw.slice(at));
  return bytes[0] !== undefined && bytes[0] >= 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
};

const passkey = Effect.fn("test.passkey")(function* () {
  const pair = yield* web(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]),
  );
  const point = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const rp = "fabrika.test",
    origin = `https://${rp}`;
  const blob = Buffer.concat([field("sk-ecdsa-sha2-nistp256@openssh.com"), field("nistp256"), field(point), field(rp)]);
  return {
    line: `sk-ecdsa-sha2-nistp256@openssh.com ${blob.toString("base64")}`,
    fingerprint: fingerprint(blob),
    sign: Effect.fnUntraced(function* (
      text: string,
      over: {
        flags?: number;
        counter?: number;
        origin?: string;
        type?: string;
        crossOrigin?: boolean;
        challenge?: Uint8Array;
        extensions?: Uint8Array;
        space?: string;
      } = {},
    ) {
      const flags = over.flags ?? 29,
        counter = over.counter ?? 0,
        space = over.space ?? SPACE;
      const clientDataJSON = utf8(
        JSON.stringify({
          type: over.type ?? "webauthn.get",
          challenge: Buffer.from(over.challenge ?? signedBytes(text, space)).toString("base64url"),
          origin: over.origin ?? origin,
          crossOrigin: over.crossOrigin ?? false,
        }),
      );
      const extensions = over.extensions ?? new Uint8Array();
      const authenticatorData = Buffer.concat([
        createHash("sha256").update(rp).digest(),
        Buffer.from([flags]),
        u32(counter),
        extensions,
      ]);
      const bytes = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
      const raw = new Uint8Array(
        yield* web(() => crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes)),
      );
      const r = integer(raw.slice(0, 32)),
        s = integer(raw.slice(32));
      const der = Buffer.concat([
        Buffer.from([0x30, 4 + r.length + s.length, 2, r.length]),
        r,
        Buffer.from([2, s.length]),
        s,
      ]);
      const signature = Buffer.concat([
        field("webauthn-sk-ecdsa-sha2-nistp256@openssh.com"),
        field(Buffer.concat([field(r), field(s)])),
        Buffer.from([flags]),
        u32(counter),
        field(over.origin ?? origin),
        field(clientDataJSON),
        field(extensions),
      ]);
      return {
        armored: pack(blob, signature, space),
        assertion: {
          authenticatorData: new Uint8Array(authenticatorData),
          clientDataJSON,
          signature: new Uint8Array(der),
        },
        passkey: {
          origin: over.origin ?? origin,
          rp,
          be: (flags & 8) !== 0,
          bs: (flags & 16) !== 0,
          counter,
        },
      };
    }),
  };
});

const text = "P10 passkey SSHSIG spike\n";

const line =
  "sk-ecdsa-sha2-nistp256@openssh.com AAAAInNrLWVjZHNhLXNoYTItbmlzdHAyNTZAb3BlbnNzaC5jb20AAAAIbmlzdHAyNTYAAABBBGEPo5ySi5t5pOwiGQ+WSY3J3s/zKtn06TmL1fMrSNmurpZ9v7/OjqBjuUe2pidsbivMig9u4oyTDcApCEQJE1oAAAAMZmFicmlrYS50ZXN0";

const realArmor =
  "-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQAAAIcAAAAic2stZWNkc2Etc2hhMi1uaXN0cDI1NkBvcGVuc3NoLmNvbQ\nAAAAhuaXN0cDI1NgAAAEEEYQ+jnJKLm3mk7CIZD5ZJjcnez/Mq2fTpOYvV8ytI2a6uln2/\nv86OoGO5R7amJ2xuK8yKD27ijJMNwCkIRAkTWgAAAAxmYWJyaWthLnRlc3QAAAAOZmFicm\nlrYS1jbGllbnQAAAAAAAAABnNoYTUxMgAAAYoAAAArd2ViYXV0aG4tc2stZWNkc2Etc2hh\nMi1uaXN0cDI1NkBvcGVuc3NoLmNvbQAAAEoAAAAhANVTo/thhYAu0D8LJl6iukYHc8bZX2\nu9Ja2sv9PJMY2JAAAAIQC93CWItR64zeSMh+CkAQ31AC/mHRQrOG3gIdz/ZEmcgx0AAAAA\nAAAAFGh0dHBzOi8vZmFicmlrYS50ZXN0AAAA6HsidHlwZSI6IndlYmF1dGhuLmdldCIsIm\nNoYWxsZW5nZSI6IlUxTklVMGxIQUFBQURtWmhZbkpwYTJFdFkyeHBaVzUwQUFBQUFBQUFB\nQVp6YUdFMU1USUFBQUJBTE9kSFltTjBySENnal95eTB5dkNIZTB4azVtLW5tYWlVVWNQYX\nQ5c3ZXM0ROcm1wcmdQbDRGbnZKTm05N1VDdlF4RGFIblZXNE14QlBTUGVCMU02QmciLCJv\ncmlnaW4iOiJodHRwczovL2ZhYnJpa2EudGVzdCIsImNyb3NzT3JpZ2luIjpmYWxzZX0AAA\nAA\n-----END SSH SIGNATURE-----\n";

const real = {
  authenticatorData: "TMQQQmREoPKQly4AZogNCSKbLOxgin60g8viZbLsKGkdAAAAAA",
  clientDataJSON:
    "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiVTFOSVUwbEhBQUFBRG1aaFluSnBhMkV0WTJ4cFpXNTBBQUFBQUFBQUFBWnphR0UxTVRJQUFBQkFMT2RIWW1OMHJIQ2dqX3l5MHl2Q0hlMHhrNW0tbm1haVVVY1BhdDlzdlczRE5ybXByZ1BsNEZudkpObTk3VUN2UXhEYUhuVlc0TXhCUFNQZUIxTTZCZyIsIm9yaWdpbiI6Imh0dHBzOi8vZmFicmlrYS50ZXN0IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ",
  signature: "MEYCIQDVU6P7YYWALtA_CyZeorpGB3PG2V9rvSWtrL_TyTGNiQIhAL3cJYi1HrjN5IyH4KQBDfUAL-YdFCs4beAh3P9kSZyD",
} as const;

const policy = { rp: "fabrika.test", origins: ["https://fabrika.test"] };

const check = (armored: string, signer: string = line, body: string = text, over = {}) =>
  verifySshsig({
    text: body,
    armored,
    space: SPACE,
    signers: [signer],
    policy: { ...policy, ...over },
  });

const refused = { _tag: "refused", reason: "bad_signature" };

const blob = (armored = realArmor) => Buffer.from(armored.trim().split("\n").slice(1, -1).join(""), "base64");

const runs = { seed: 119120, numRuns: 40 };
const bodyArb = fc.string({ unit: "binary" });

const passkeyLineArb = fc
  .tuple(fc.uint8Array({ minLength: 64, maxLength: 64 }), fc.string({ minLength: 1 }))
  .map(
    ([point, rp]) =>
      `sk-ecdsa-sha2-nistp256@openssh.com ${Buffer.concat([
        field("sk-ecdsa-sha2-nistp256@openssh.com"),
        field("nistp256"),
        field(Buffer.concat([Buffer.from([4]), point])),
        field(rp),
      ]).toString("base64")}`,
  );

type Signed = { readonly line: string; readonly armored: string };
const signedArb = fc.record({ body: bodyArb, signed: fc.constant<Signed | null>(null) });
const recorded = { body: text, signed: { line, armored: realArmor } };

const signed = Effect.fnUntraced(function* (a: { body: string; signed: Signed | null }) {
  if (a.signed !== null) {
    return a.signed;
  }

  const k = yield* passkey();
  return { line: k.line, armored: (yield* k.sign(a.body)).armored };
});

describe("P10 WebAuthn SSHSIG", () => {
  it("p27: a passkey line requires an uncompressed P-256 point", () => {
    // Plant: accept any point prefix. The schema must still refuse it.
    fc.assert(
      fc.property(
        passkeyLineArb,
        fc.integer({ min: 0, max: 255 }).filter((n) => n !== 4),
        (line, prefix) => {
          const bytes = Buffer.from(line.split(" ")[1]!, "base64");
          let at = 0;

          for (let i = 0; i < 2; i++) {
            at += 4 + bytes.readUInt32BE(at);
          }

          bytes[at + 4] = prefix;
          expect(Schema.is(PasskeyLine)(`${line.split(" ")[0]} ${bytes.toString("base64")}`)).toBe(false);
        },
      ),
      { ...runs, examples: [[line, 3]] },
    );
  });
  it("writer: malformed DER answers with a typed BadAssertion", async () => {
    // Plant: rename the error tag to InvalidAssertion. The BadAssertion match must fail.
    const invalid = fc.oneof(
      fc.uint8Array({ maxLength: 1 }),
      fc
        .tuple(
          fc.integer({ min: 0, max: 255 }).filter((n) => n !== 0x30),
          fc.uint8Array(),
        )
        .map(([head, tail]) => new Uint8Array([head, ...tail])),
      fc.uint8Array({ maxLength: 253 }).map((tail) => new Uint8Array([0x30, tail.length + 1, ...tail])),
    );
    await fc.assert(
      fc.asyncProperty(invalid, (signature) =>
        Effect.runPromise(
          Effect.gen(function* () {
            expect(
              yield* Effect.flip(
                writeWebauthnSshsig({
                  text,
                  line: Schema.decodeUnknownSync(PasskeyLine)(line),
                  assertion: {
                    authenticatorData: new Uint8Array(Buffer.from(real.authenticatorData, "base64url")),
                    clientDataJSON: new Uint8Array(Buffer.from(real.clientDataJSON, "base64url")),
                    signature,
                  },
                }),
              ),
            ).toMatchObject({ _tag: "BadAssertion" });
          }),
        ),
      ),
      { ...runs, examples: [[new Uint8Array([0x30, 0])]] },
    );
  });
  it("p27: an ECDSA scalar with an unnecessary leading zero is refused", async () => {
    // Plant: allow a redundant sign-padding byte in fixed(). The refusal must fail.
    await fc.assert(
      fc.asyncProperty(signedArb, (input) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const value = yield* signed(input);
            const source = blob(value.armored);
            let at = 10;
            const take = () => {
              const size = source.readUInt32BE(at);
              at += 4;
              const value = source.subarray(at, at + size);
              at += size;
              return value;
            };
            const key = take(),
              space = take(),
              reserved = take(),
              hash = take(),
              signature = take();
            let sigAt = 0;
            const sigField = () => {
              const size = signature.readUInt32BE(sigAt);
              sigAt += 4;
              const value = signature.subarray(sigAt, sigAt + size);
              sigAt += size;
              return value;
            };
            const algorithm = sigField(),
              pair = sigField(),
              tail = signature.subarray(sigAt);
            const rLength = pair.readUInt32BE(0),
              r = pair.subarray(4, 4 + rLength);
            const s = pair.subarray(8 + rLength);
            // P-256 accepts both s and order-s. The smaller one needs no sign-padding byte.
            const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
            const scalar = BigInt(`0x${s.toString("hex")}`);
            const low = Buffer.from(
              (scalar < order - scalar ? scalar : order - scalar).toString(16).padStart(64, "0"),
              "hex",
            );
            const minimal = integer(low);
            expect(low[0]).toBeLessThan(128);
            const wrap = (value: Uint8Array) =>
              armor(
                Buffer.concat([
                  source.subarray(0, 10),
                  field(key),
                  field(space),
                  field(reserved),
                  field(hash),
                  field(Buffer.concat([field(algorithm), field(Buffer.concat([field(r), field(value)])), tail])),
                ]),
              );
            expect((yield* check(wrap(minimal), value.line, input.body))._tag).toBe("passkey");
            expect(yield* check(wrap(Buffer.concat([Buffer.from([0]), minimal])), value.line, input.body)).toEqual(
              refused,
            );
          }),
        ),
      ),
      { ...runs, examples: [[recorded]] },
    );
  });
  it("p27: a raw WebAuthn object outside SSHSIG is refused", async () => {
    // Plant: return a key on parser failure. A raw JSON object must still be refused.
    await fc.assert(
      fc.asyncProperty(fc.record({ authenticatorData: bodyArb, clientDataJSON: bodyArb, signature: bodyArb }), (raw) =>
        Effect.runPromise(
          Effect.gen(function* () {
            expect(yield* check(JSON.stringify(raw))).toEqual(refused);
          }),
        ),
      ),
      { ...runs, examples: [[real]] },
    );
  });
  it.effect("vector: p27: the independent ordinary ECDSA vector stays refused by the shared verifier", () =>
    Effect.gen(function* () {
      const read = (file: string) =>
        readFileSync(new URL(`../../../../../fixtures/next/sshsig/${file}`, import.meta.url), "utf8");
      expect(yield* check(read("ecdsa.sig"), read("ecdsa.pub").trim(), read("text.txt"))).toEqual(refused);
    }),
  );
  it.effect("vector: p27: the exact real assertion passes, with signed backup flags and counter zero", () =>
    Effect.gen(function* () {
      expect(yield* check(realArmor)).toEqual({
        _tag: "passkey",
        signer: line,
        origin: "https://fabrika.test",
        rp: "fabrika.test",
        be: true,
        bs: true,
        counter: 0,
      });
    }),
  );
  it.effect("format: writer: wraps the real DER assertion byte for byte, without re-signing", () =>
    Effect.gen(function* () {
      const assertion = {
        authenticatorData: new Uint8Array(Buffer.from(real.authenticatorData, "base64url")),
        clientDataJSON: new Uint8Array(Buffer.from(real.clientDataJSON, "base64url")),
        signature: new Uint8Array(Buffer.from(real.signature, "base64url")),
      };
      expect(assertion.signature.length).toBe(72);
      const armored = yield* writeWebauthnSshsig({
        text,
        line: Schema.decodeUnknownSync(PasskeyLine)(line),
        assertion,
      });
      expect(armored).toBe(realArmor);
      expect((yield* check(armored))._tag).toBe("passkey");
    }),
  );
  it("vector: independent control: OpenSSH verifies the same recorded assertion", () => {
    const dir = mkdtempSync(join(tmpdir(), "p10-vector-"));

    try {
      writeFileSync(join(dir, "allowed_signers"), `spike ${line}\n`);
      writeFileSync(join(dir, "assertion.sig"), realArmor);
      const result = spawnSync(
        "ssh-keygen",
        [
          "-Y",
          "verify",
          "-n",
          SPACE,
          "-I",
          "spike",
          "-f",
          join(dir, "allowed_signers"),
          "-s",
          join(dir, "assertion.sig"),
        ],
        { input: text, encoding: "utf8" },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const policyCases = [
    ["UP without UV", { flags: 1 }],
    ["UV without UP", { flags: 4 }],
    ["BS without BE", { flags: 21 }],
    ["ED without extensions", { flags: 157 }],
    ["extensions without ED", { extensions: new Uint8Array([0xa0]) }],
    ["attested data on an assertion", { flags: 93 }],
    ["foreign origin", { origin: "https://foreign.test" }],
    ["wrong type", { type: "webauthn.create" }],
    ["cross origin", { crossOrigin: true }],
    ["wrong challenge", { challenge: utf8("only a hash would be wrong too") }],
  ] as const;
  it("p27 policy: refuses invalid assertions even with a valid P-256 signature", async () => {
    // Plant: require UP alone, without UV. A signed UP-only assertion must be refused.
    const invalid = fc.oneof(
      fc
        .integer({ min: 0, max: 255 })
        .filter((flags) => (flags & 5) !== 5 || (flags & 0x62) !== 0 || ((flags & 16) !== 0 && (flags & 8) === 0))
        .map((flags) => ({ flags })),
      fc.constant({ flags: 157 }),
      fc.uint8Array({ minLength: 1 }).map((extensions) => ({ extensions })),
      bodyArb.filter((origin) => origin !== policy.origins[0]).map((origin) => ({ origin })),
      bodyArb.filter((type) => type !== "webauthn.get").map((type) => ({ type })),
      fc.constant({ crossOrigin: true }),
      fc.uint8Array({ maxLength: 64 }).map((challenge) => ({ challenge })),
    );
    await fc.assert(
      fc.asyncProperty(bodyArb, invalid, (body, options) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const k = yield* passkey();
            const value = yield* k.sign(body, options);
            expect(yield* check(value.armored, k.line, body)).toEqual(refused);
          }),
        ),
      ),
      {
        ...runs,
        examples: policyCases.map(([, options]): [string, typeof options] => [text, options]),
      },
    );
  });
  it("question 19: signed backup flags and counters pass", async () => {
    // Plant: invert the returned BE flag. The signed flag match must fail.
    await fc.assert(
      fc.asyncProperty(bodyArb, fc.constantFrom(5, 13, 29), fc.nat({ max: 0xffffffff }), (body, flags, counter) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const k = yield* passkey();
            const value = yield* k.sign(body, { flags, counter });
            expect(yield* check(value.armored, k.line, body)).toMatchObject({
              _tag: "passkey",
              be: (flags & 8) !== 0,
              bs: (flags & 16) !== 0,
              counter,
            });
          }),
        ),
      ),
      {
        ...runs,
        examples: [
          [text, 5, 0],
          [text, 13, 0],
          [text, 29, 0],
        ],
      },
    );
  });
  const bindingCases = [
    ["text", `${text}!`, {}],
    ["RP", text, { rp: "other.test" }],
    ["origin allowlist", text, { origins: ["https://other.test"] }],
  ] as const;
  it("p27 binding: changing expected text, RP or origin allowlist refuses the real assertion", async () => {
    // Plant: ignore policy.rp. The changed-RP example must still be refused.
    const changed: fc.Arbitrary<{
      body: string;
      over: { rp?: string; origins?: ReadonlyArray<string> };
    }> = fc.oneof(
      bodyArb
        .filter((body) => !Buffer.from(utf8(body)).equals(Buffer.from(utf8(text))))
        .map((body) => ({ body, over: {} })),
      bodyArb.filter((rp) => rp !== policy.rp).map((rp) => ({ body: text, over: { rp } })),
      fc
        .array(bodyArb.filter((origin) => origin !== policy.origins[0]))
        .map((origins) => ({ body: text, over: { origins } })),
    );
    await fc.assert(
      fc.asyncProperty(changed, ({ body, over }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            expect(yield* check(realArmor, line, body, over)).toEqual(refused);
          }),
        ),
      ),
      {
        ...runs,
        examples: bindingCases.map(([, body, over]): [{ body: string; over: typeof over }] => [{ body, over }]),
      },
    );
  });
  it("p27: a different admitted signer cannot borrow the embedded key", async () => {
    // Plant: choose the first parseable signer without comparing its blob. Refusal must fail.
    await fc.assert(
      fc.asyncProperty(signedArb, (input) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const value = yield* signed(input);
            const other = yield* passkey();
            expect(yield* check(value.armored, other.line, input.body)).toEqual(refused);
          }),
        ),
      ),
      { ...runs, examples: [[recorded]] },
    );
  });
  it("p27: a valid signature in another namespace is refused", async () => {
    // Plant: trust the embedded namespace for both selection and signed bytes. Refusal must fail.
    await fc.assert(
      fc.asyncProperty(
        bodyArb,
        bodyArb.filter((space) => space !== SPACE),
        (body, space) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const k = yield* passkey();
              const value = yield* k.sign(body, { space });
              expect(yield* check(value.armored, k.line, body)).toEqual(refused);
            }),
          ),
      ),
      { ...runs, examples: [[text, "other"]] },
    );
  });
  const corruptions = [
    "version",
    "key length",
    "hash",
    "signature algorithm",
    "signature byte",
    "truncated",
    "trailing",
  ] as const;
  it("p27 bytes: refuses corrupt fields, signatures, truncation and trailing bytes", async () => {
    // Plant: ignore the SSHSIG version. The version-2 example must still be refused.
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...corruptions), fc.nat({ max: 0xffffffff }), (kind, change) =>
        Effect.runPromise(
          Effect.gen(function* () {
            let bytes = blob();

            if (kind === "version") {
              bytes.writeUInt32BE(change === 0 ? 2 : change === 1 ? 0 : change, 6);
            }

            if (kind === "key length") {
              bytes.writeUInt32BE(0xffffffff - (change % 100), 10);
            }

            if (kind === "hash") {
              let at = 10;

              for (let n = 0; n < 3; n++) {
                at += 4 + bytes.readUInt32BE(at);
              }

              bytes[at + 4 + 5] = change % 2 === 0 ? "3".charCodeAt(0) : "4".charCodeAt(0);
            }

            if (kind === "signature algorithm") {
              let at = 10;

              for (let n = 0; n < 4; n++) {
                at += 4 + bytes.readUInt32BE(at);
              }

              at += 4;
              const size = bytes.readUInt32BE(at);
              bytes[at + 4 + size - 1] = ("m".charCodeAt(0) + 1 + (change % 127)) % 256;
            }

            if (kind === "signature byte") {
              let at = 10;

              for (let n = 0; n < 4; n++) {
                at += 4 + bytes.readUInt32BE(at);
              }

              at += 4; // Outer signature string, then its algorithm and pair-of-mpints string.
              at += 4 + bytes.readUInt32BE(at);
              at += 4;
              const size = bytes.readUInt32BE(at);
              const last = at + 4 + size - 1 - (change % size);
              bytes[last] = bytes[last]! ^ (1 + (change % 255));
            }

            if (kind === "truncated") {
              bytes = bytes.subarray(0, -(1 + (change % bytes.length)));
            }

            if (kind === "trailing") {
              bytes = Buffer.concat([bytes, Buffer.alloc(1 + (change % 100), change % 256)]);
            }

            expect(yield* check(armor(bytes))).toEqual(refused);
          }),
        ),
      ),
      { ...runs, examples: corruptions.map((kind) => [kind, 0]) },
    );
  });
  it("P7: the compatibility checker keeps SK out and returns an Ed25519 signer as supplied", async () => {
    // Plant: strip the returned signer's comment. The supplied-line equality must fail.
    await fc.assert(
      fc.asyncProperty(bodyArb, bodyArb, (body, comment) =>
        Effect.runPromise(
          Effect.gen(function* () {
            expect(yield* checkSshsig({ text, armored: realArmor, space: SPACE, signers: [line] })).toEqual({
              reason: "bad_signature",
            });
            const k = yield* key();
            const armored = yield* k.sign(body);
            const supplied = `${k.line} ${comment}`;
            expect(yield* checkSshsig({ text: body, armored, space: SPACE, signers: [supplied] })).toEqual({
              signer: supplied,
            });
            const checked = verifySshsig({
              text: body,
              armored,
              space: SPACE,
              signers: [supplied],
              policy,
            });
            expect(yield* checked).toEqual({ _tag: "key", signer: supplied });
          }),
        ),
      ),
      { ...runs, examples: [[text, "public-test-comment"]] },
    );
  });
  it("P7: ordinary ECDSA is not a passkey line", () => {
    // Plant: ignore the outer key type word. The ordinary ECDSA line must still throw.
    fc.assert(
      fc.property(passkeyLineArb, (line) => {
        expect(Schema.decodeUnknownSync(PasskeyLine)(line)).toBe(line);
        expect(() => Schema.decodeUnknownSync(PasskeyLine)(line.replace("sk-ecdsa", "ecdsa"))).toThrow();
      }),
      { ...runs, examples: [[line]] },
    );
  });
});
