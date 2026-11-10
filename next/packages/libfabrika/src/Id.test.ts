// T518, PR 1, next/: TypeID format, Effect failures, writer state, and the public Id export.
// TypeID 0.3.0: https://github.com/jetify-com/typeid/tree/main/spec
// Fabrika deliberately requires UUIDv7 on decode too; the spec permits other versions on decode.
import { describe, expect, it, vi } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import * as Public from "@kampus/libfabrika";
import * as Data from "@kampus/libfabrika/data";
import { Arbitrary, Cause, Clock, Effect, Exit, Schema, SchemaIssue, Tracer } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { ProcessId } from "./ProcessId.ts";

const seed = 119120;
const options = { seed, numRuns: 100 };
const effectOptions = { arbitrary: { seed, runs: 40 } };
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const maxClock = 2 ** 48 - 1;
const letters = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz");

const text = (minLength: number, maxLength: number) =>
  fc.array(letters, { minLength, maxLength }).map((chars) => chars.join(""));

const prefix = fc.oneof(
  letters,
  fc
    .tuple(letters, fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_"), { maxLength: 61 }), letters)
    .map(([first, middle, last]) => first + middle.join("") + last),
);

// Each generated family visits every structural edge, including repeated interior underscores.
const prefixShapes = fc
  .tuple(letters, text(2, 62), text(63, 63), letters, letters)
  .map(([single, word, longest, first, last]) => [
    single,
    word,
    longest,
    `${first}_${last}`,
    `${first}__${last}`,
    first + "_".repeat(61) + last,
  ]);

const badPrefixShapes = fc
  .tuple(text(1, 63), text(64, 100), fc.constantFrom("0", "-", "/", "é", "\0", " ", "\n"))
  .map(([word, long, bad]) => [
    "", // A8 keeps main's nonempty prefix rule.
    "_",
    `_${word}`,
    `${word}_`,
    word.toUpperCase(),
    long,
    `${word}${bad}${word}`,
    // T518-PREFIX-EXCEPTION: mutation 13 admitted this invalid prefix; UUIDs stay generated.
    "Stryker was here!",
  ]);

const clock = fc.oneof(fc.constant(0), fc.constant(maxClock), fc.integer({ min: 0, max: maxClock }));

const uuid = fc.tuple(clock, fc.uint8Array({ minLength: 10, maxLength: 10 })).map(([at, random]) => {
  const bytes = Uint8Array.from([
    ...Array.from({ length: 6 }, (_, i) => Number((BigInt(at) >> BigInt((5 - i) * 8)) & 255n)),
    ...random,
  ]);
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  return bytes;
});

// Independent oracle: follow the spec's bit-string recipe, not the generator's shift loop.
const referenceEncode = (bytes: Uint8Array): string => {
  const bits = `00${[...bytes].map((byte) => byte.toString(2).padStart(8, "0")).join("")}`;
  return Array.from({ length: 26 }, (_, i) => alphabet[Number.parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join("");
};

const referenceDecode = (suffix: string): Uint8Array => {
  const bits = [...suffix]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("")
    .slice(2);
  return Uint8Array.from({ length: 16 }, (_, i) => Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2));
};

const wire = (type: string, bytes: Uint8Array): string => (type === "" ? "" : `${type}_`) + referenceEncode(bytes);

const split = (value: string): readonly [string, string] => {
  const separator = value.lastIndexOf("_");
  return separator < 0 ? ["", value] : [value.slice(0, separator), value.slice(separator + 1)];
};

const validPrefix = (type: string): boolean =>
  type.length > 0 &&
  type.length <= 63 &&
  /^[a-z]$/.test(type[0]!) &&
  /^[a-z]$/.test(type.at(-1)!) &&
  [...type].every((char) => "abcdefghijklmnopqrstuvwxyz_".includes(char));

const accepts = (input: unknown, type?: string): boolean => {
  if (typeof input !== "string") {
    return false;
  }

  const [found, suffix] = split(input);

  if (!validPrefix(found) || (type !== undefined && found !== type)) {
    return false;
  }

  if (found === "" && input.includes("_")) {
    return false;
  }

  if (suffix.length !== 26 || ![...suffix].every((char) => alphabet.includes(char))) {
    return false;
  }

  if (alphabet.indexOf(suffix[0]!) > 7) {
    return false;
  }

  const bytes = referenceDecode(suffix);
  return bytes[6]! >>> 4 === 7 && bytes[8]! >>> 6 === 2;
};

const canonical = fc.tuple(prefix, uuid).map(([type, bytes]) => wire(type, bytes));
const unknown = fc.oneof(fc.anything(), fc.string(), canonical);

const expectDecoded = <A, E>(
  exit: Exit.Exit<A, E>,
  ok: boolean,
  input: unknown,
  error: (value: unknown) => boolean,
) => {
  expect(Exit.isSuccess(exit)).toBe(ok);

  if (Exit.isSuccess(exit)) {
    expect(exit.value).toBe(input);
  } else {
    expect(exit.cause.reasons.length).toBeGreaterThan(0);

    for (const reason of exit.cause.reasons) {
      expect(Cause.isFailReason(reason)).toBe(true);

      if (Cause.isFailReason(reason)) {
        expect(error(reason.error)).toBe(true);
      }
    }
  }
};

const timestamp = (id: string): number =>
  [...referenceDecode(split(id)[1]).slice(0, 6)].reduce((total, byte) => total * 256 + byte, 0);

const increasing = (ids: ReadonlyArray<string>): void => {
  expect(new Set(ids).size).toBe(ids.length);

  for (let i = 1; i < ids.length; i++) {
    expect(ids[i]! > ids[i - 1]!).toBe(true);
  }
};

const compare = (left: string, right: string): -1 | 0 | 1 => (left < right ? -1 : left > right ? 1 : 0);

const Time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxClock }));
const Count = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 128 }));
const Prefix = Schema.String.check(Schema.isPattern(/^[a-z](?:[a-z_]{0,61}[a-z])?$/));
const rawBytes = fc.uint8Array({ minLength: 16, maxLength: 16 });

const v7 = (raw: Uint8Array): Uint8Array => {
  const bytes = raw.slice();
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  return bytes;
};

const expectIdFailure = <A, E>(exit: Exit.Exit<A, E>, failureReason: string): void => {
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toHaveLength(1);
    const reason = exit.cause.reasons[0]!;
    expect(Cause.isFailReason(reason)).toBe(true);

    if (Cause.isFailReason(reason)) {
      expect(Public.IdError, "IdError is exported from the public package").toBeTypeOf("function");
      expect(reason.error).toBeInstanceOf(Public.IdError);
      expect(reason.error).toMatchObject({ _tag: "IdError", reason: failureReason });
    }
  }
};

describe("T518 Id format", () => {
  it("built-in schemas and the type list keep every declared prefix", () => {
    const builtins = [
      ["ledger", Id.Ledger],
      ["person", Id.Person],
      ["process", Id.Process],
      ["connection", Id.Connection],
      ["tab", Id.Tab],
      ["mailbox", Id.Mailbox],
      ["input", Id.Input],
      ["letter", Id.Letter],
      ["cmd", Id.Cmd],
      ["monitor", Id.Monitor],
      ["entry", Id.Entry],
      ["grant", Id.Grant],
      ["revoke", Id.Revoke],
      ["add", Id.Add],
      ["deny", Id.Deny],
    ] as const;
    fc.assert(
      fc.property(uuid, prefix, (bytes, type) => {
        for (const [name, Specific] of builtins) {
          expect(Schema.is(Id.Type)(name)).toBe(true);
          expect(Specific.prefix).toBe(name);
          const raw = wire(name, bytes);
          expect(Schema.decodeUnknownSync(Specific)(raw)).toBe(raw);
          expect(Schema.is(Specific)(wire("", bytes))).toBe(false);
        }

        expect(Schema.is(Id.Type)(type)).toBe(builtins.some(([name]) => name === type));
      }),
      options,
    );
  });
  it("the data exports use the one public Id module", () => {
    fc.assert(
      fc.property(prefix, uuid, (type, bytes) => {
        expect(Data.Id).toBe(Id);
        expect(Data.IdError).toBe(Public.IdError);
        const raw = wire(type, bytes);
        expect(Schema.decodeUnknownSync(Data.Id.make(type))(raw)).toBe(raw);
      }),
      options,
    );
  });
  it("InputId is a built-in schema with the same checked input format", () => {
    fc.assert(
      fc.property(uuid, unknown, (bytes, input) => {
        expect(Id.InputId, "InputId is built into the Id module").toBeDefined();
        const builtin: typeof Id.Input = Id.InputId;
        expect(Data.InputId).toBe(Id.InputId);

        for (const value of [wire("input", bytes), wire("process", bytes), input]) {
          for (const schema of [builtin, Id.Input, Data.InputId]) {
            expectDecoded(
              Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(schema)(value))),
              accepts(value, "input"),
              value,
              Schema.isSchemaError,
            );
          }
        }
      }),
      options,
    );
  });
  it("makeEffect records a named, completed span for valid and invalid generated prefixes", () => {
    fc.assert(
      fc.property(prefix, badPrefixShapes, (type, bad) => {
        for (const name of [type, ...bad]) {
          const spans: Array<Tracer.NativeSpan> = [];
          const tracer = Tracer.make({
            span(options) {
              const span = new Tracer.NativeSpan(options);
              spans.push(span);
              return span;
            },
          });
          const exit = Effect.runSync(Effect.exit(Id.makeEffect(name)).pipe(Effect.withTracer(tracer)));
          expect(Exit.isSuccess(exit)).toBe(validPrefix(name));
          const made = spans.filter((span) => span.name === "id.makeEffect");
          expect(made).toHaveLength(1);
          const status = made[0]!.status;
          expect(status._tag).toBe("Ended");

          if (status._tag === "Ended") {
            expect(Exit.isSuccess(status.exit)).toBe(validPrefix(name));
          }
        }
      }),
      options,
    );
  });
  it("decodes independent UUIDv7 encodings for every valid prefix shape", () => {
    fc.assert(
      fc.property(uuid, prefixShapes, prefix, (bytes, shapes, type) => {
        for (const name of [...shapes, type]) {
          const raw = wire(name, bytes);
          expect(Schema.decodeUnknownSync(Id.Schema)(raw)).toBe(raw);
          expect(Schema.decodeUnknownSync(Id.make(name))(raw)).toBe(raw);
          expect(referenceDecode(split(raw)[1])).toEqual(bytes);
        }
      }),
      options,
    );
  });
  // Plant: the schema hides its format in a refinement that Effect cannot generate from.
  it.effect.prop(
    "Effect Arbitrary generates 200 ids for each prefix that decode only under that prefix",
    { type: Prefix, sampleSeed: Schema.Int },
    ({ type, sampleSeed }) =>
      Effect.gen(function* () {
        const Specific = Id.make(type);
        const Other = Id.make(type === "process" ? "letter" : "process");
        const values = yield* Arbitrary.sampleEffect(Arbitrary.schema(Specific), {
          count: 200,
          seed: sampleSeed,
        });
        expect(values).toHaveLength(200);

        for (const value of values) {
          expect(accepts(value, type)).toBe(true);
          expect(Schema.decodeUnknownSync(Specific)(value)).toBe(value);
          expect(Schema.decodeUnknownSync(Id.Schema)(value)).toBe(value);
          expectDecoded(
            yield* Effect.exit(Schema.decodeUnknownEffect(Other)(value)),
            false,
            value,
            Schema.isSchemaError,
          );
        }
      }),
    effectOptions,
  );
  it("round trips generated values through the schema encoder and decoder", () => {
    fc.assert(
      fc.property(prefix, uuid, (type, bytes) => {
        const Specific = Id.make(type);
        const value = Specific.make(wire(type, bytes));
        const encoded = Schema.encodeSync(Specific)(value);
        expect(encoded).toBe(wire(type, bytes));
        expect(Schema.decodeSync(Specific)(encoded)).toBe(value);
        expect(Schema.decodeSync(Id.Schema)(Schema.encodeSync(Id.Schema)(value))).toBe(value);
        expect(referenceDecode(split(encoded)[1])).toEqual(bytes);
      }),
      options,
    );
  });
  it("rejects malformed suffixes, overflow, whitespace, versions, and variants without repair", () => {
    fc.assert(
      fc.property(
        prefix,
        uuid,
        fc.integer({ min: 0, max: 25 }),
        fc.integer({ min: 8, max: 31 }),
        fc.integer({ min: 0, max: 15 }).filter((version) => version !== 7),
        fc.constantFrom(0, 1, 3),
        (type, bytes, index, overflow, version, variant) => {
          const raw = wire(type, bytes),
            suffix = referenceEncode(bytes);
          const head = type === "" ? "" : `${type}_`;
          const wrongVersion = bytes.slice(),
            wrongVariant = bytes.slice();
          wrongVersion[6] = (bytes[6]! & 15) | (version << 4);
          wrongVariant[8] = (bytes[8]! & 63) | (variant << 6);
          const bad = [
            raw.toUpperCase(),
            head + suffix.toUpperCase(),
            head + suffix.slice(0, index) + suffix.slice(index + 1),
            `${head + suffix.slice(0, index)}0${suffix.slice(index)}`,
            head + alphabet[overflow] + suffix.slice(1),
            wire(type, wrongVersion),
            wire(type, wrongVariant),
            ...[" ", "\t", "\n", "\r\n", "\u00a0"].flatMap((space) => [space + raw, raw + space]),
            ...["i", "l", "o", "u", "-", "_", "é", "\0"].map(
              (char) => head + suffix.slice(0, index) + char + suffix.slice(index + 1),
            ),
            ...(type === "" ? [`_${suffix}`] : [type + suffix, `${type}__${suffix}`]),
          ];
          const Specific = Id.make(type);

          for (const value of bad) {
            expect(accepts(value)).toBe(false);
            expectDecoded(
              Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.Schema)(value))),
              false,
              value,
              Schema.isSchemaError,
            );
            expectDecoded(
              Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Specific)(value))),
              false,
              value,
              Schema.isSchemaError,
            );
          }
        },
      ),
      options,
    );
  });
  it("keeps prefixes distinct at runtime and refuses an unprefixed UUID", () => {
    fc.assert(
      fc.property(prefix, uuid, (type, bytes) => {
        const other = type === "process" ? "letter" : "process";
        const left = wire(type, bytes),
          right = wire(other, bytes);
        expect(Schema.is(Id.make(type))(left)).toBe(true);
        expect(Schema.is(Id.make(other))(right)).toBe(true);
        expect(Schema.is(Id.Schema)(wire("", bytes))).toBe(false);

        for (const [target, input] of [
          [type, right],
          [other, left],
          ["letter", wire("process", bytes)],
          ["process", wire("letter", bytes)],
        ]) {
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.make(target!))(input))),
            false,
            input,
            Schema.isSchemaError,
          );
        }
      }),
      options,
    );
  });
  it("rejects every invalid prefix shape in the factory and in complete ids", () => {
    fc.assert(
      fc.property(badPrefixShapes, uuid, (bad, bytes) => {
        for (const type of bad) {
          expect(() => Id.make(type)).toThrow();
          const exit = Effect.runSync(Effect.exit(Id.makeEffect(type)));
          expect(Exit.isFailure(exit)).toBe(true);
          expectIdFailure(exit, "prefix");
          expect(Schema.is(Id.Schema)(wire(type, bytes))).toBe(false);
        }
      }),
      options,
    );
  });
  it("makeEffect accepts every valid prefix shape", () => {
    fc.assert(
      fc.property(prefixShapes, uuid, (shapes, bytes) => {
        for (const type of shapes) {
          const Specific = Effect.runSync(Id.makeEffect(type));
          expect(Schema.decodeUnknownSync(Specific)(wire(type, bytes))).toBe(wire(type, bytes));
        }
      }),
      options,
    );
  });
  it("unknown decoding never throws or dies, and only non-IDs fail typed", () => {
    fc.assert(
      fc.property(unknown, prefix, (input, type) => {
        expectDecoded(
          Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.Schema)(input))),
          accepts(input),
          input,
          Schema.isSchemaError,
        );
        expectDecoded(
          Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.make(type))(input))),
          accepts(input, type),
          input,
          Schema.isSchemaError,
        );
      }),
      options,
    );
  });
  it("schema makeEffect keeps invalid strings and unknowns in its typed Issue channel", () => {
    fc.assert(
      fc.property(unknown, prefix, (input, type) => {
        // @ts-expect-error Deliberately test runtime validation beyond the typed constructor input.
        const common = Id.Schema.makeEffect(input);
        // @ts-expect-error Deliberately test runtime validation beyond the typed constructor input.
        const specific = Id.make(type).makeEffect(input);
        expectDecoded(Effect.runSync(Effect.exit(common)), accepts(input), input, SchemaIssue.isIssue);
        expectDecoded(Effect.runSync(Effect.exit(specific)), accepts(input, type), input, SchemaIssue.isIssue);
      }),
      options,
    );
  });
  it("trusted make and decodeSync throw on invalid strings", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), canonical), prefix, (input, type) => {
        const Specific = Id.make(type);
        expect(Schema.is(Specific)(input)).toBe(accepts(input, type));

        if (accepts(input)) {
          expect(Id.Schema.make(input)).toBe(input);
          expect(Schema.decodeSync(Id.Schema)(input)).toBe(input);
        } else {
          expect(() => Id.Schema.make(input)).toThrow();
          expect(() => Schema.decodeSync(Id.Schema)(input)).toThrow();
        }

        if (accepts(input, type)) {
          expect(Specific.make(input)).toBe(input);
          expect(Schema.decodeSync(Specific)(input)).toBe(input);
        } else {
          expect(() => Specific.make(input)).toThrow();
          expect(() => Schema.decodeSync(Specific)(input)).toThrow();
        }
      }),
      options,
    );
  });
  it("ProcessId and Id.make(process) accept exactly the same inputs in both directions", () => {
    fc.assert(
      fc.property(unknown, uuid, (input, bytes) => {
        const Specific = Id.make("process");
        const wrongVersion = bytes.slice(),
          wrongVariant = bytes.slice();
        wrongVersion[6] = (bytes[6]! & 15) | 0x40;
        wrongVariant[8] = bytes[8]! & 63;

        for (const value of [
          input,
          wire("process", bytes),
          wire("process", wrongVersion),
          wire("process", wrongVariant),
          wire("letter", bytes),
        ]) {
          const ok = accepts(value, "process");
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(ProcessId)(value))),
            ok,
            value,
            Schema.isSchemaError,
          );
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Specific)(value))),
            ok,
            value,
            Schema.isSchemaError,
          );
        }
      }),
      options,
    );
  });
});

// A8: all six runtime laws from P17a's data/id.test.ts, now exercising the shared module.
describe("P17a, one valid typed identity", () => {
  it("decodes generated UUIDv7 bytes exactly; rejects other prefixes, versions and variants", async () => {
    await fc.assert(
      fc.asyncProperty(prefix, rawBytes, async (p, raw) => {
        const schema = await Effect.runPromise(Id.makeEffect(p));
        const valid = v7(raw),
          value = wire(p, valid);
        expect(await Effect.runPromise(Schema.decodeUnknownEffect(schema)(value))).toBe(value);
        expect(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(value))).toBe(value);
        expect(Schema.is(Id.Input)(wire("input", valid))).toBe(true);
        expect(Schema.is(Id.make("chaos"))(wire("input", valid))).toBe(false);
        expect(Schema.is(schema)(wire(`${p}x`, valid))).toBe(false);

        for (const version of Array.from({ length: 16 }, (_, n) => n).filter((n) => n !== 7)) {
          const bad = valid.slice();
          bad[6] = (bad[6]! & 15) | (version << 4);
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(schema)(wire(p, bad)))),
            false,
            wire(p, bad),
            Schema.isSchemaError,
          );
        }

        for (const variant of [0, 1, 3]) {
          const bad = valid.slice();
          bad[8] = (bad[8]! & 63) | (variant << 6);
          expectDecoded(
            Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(schema)(wire(p, bad)))),
            false,
            wire(p, bad),
            Schema.isSchemaError,
          );
        }
      }),
      { ...options, numRuns: 60 },
    );
  });
  it("rejects base32 mutations, overflow, nonstrings and count-derived input ids", () => {
    fc.assert(
      fc.property(
        rawBytes,
        fc.integer({ min: 0, max: 25 }),
        fc.constantFrom("i", "l", "o", "u", "A", "-", "_"),
        fc.integer({ min: 1 }),
        (raw, at, mutation, count) => {
          const s = referenceEncode(v7(raw));

          for (const bad of [
            `input_${s.slice(0, at)}${mutation}${s.slice(at + 1)}`,
            `input_8${s.slice(1)}`,
            `input_${s.slice(1)}`,
            `input_${s}0`,
            `in-process_${s}-${count}`,
            `input_${count}`,
            null,
            count,
            { id: `input_${s}` },
          ]) {
            expectDecoded(
              Effect.runSync(Effect.exit(Schema.decodeUnknownEffect(Id.Input)(bad))),
              false,
              bad,
              Schema.isSchemaError,
            );
          }
        },
      ),
      { ...options, numRuns: 60 },
    );
  });
  it("outside prefixes get typed errors, while code declarations may throw", async () => {
    await fc.assert(
      fc.asyncProperty(prefix, fc.integer({ min: 64, max: 90 }), rawBytes, async (p, length, raw) => {
        const valid = await Effect.runPromise(Id.makeEffect(p));
        expect(Schema.is(valid)(wire(p, v7(raw)))).toBe(true);

        for (const bad of [
          p.toUpperCase(),
          `_${p}`,
          `${p}_`,
          `${p}1`,
          `${p}-x`,
          "a".repeat(length),
          wire("input", v7(raw)),
        ]) {
          expectIdFailure(await Effect.runPromise(Effect.exit(Id.makeEffect(bad))), "prefix");
          expect(() => Id.make(bad)).toThrow();
        }
      }),
      { ...options, numRuns: 60 },
    );
  });
  it("keeps unique, increasing UUIDv7 ids over equal clocks and rollback; process ids share the format", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10_000, max: 2 ** 46 }),
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 12 }),
        rawBytes,
        async (at, changes, raw) => {
          const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
            if (array instanceof Uint8Array) {
              array.forEach((_, i) => {
                array[i] = raw[i % raw.length]!;
              });
            }

            return array;
          });

          try {
            await Effect.runPromise(
              Effect.gen(function* () {
                const gen = yield* Id.Generator,
                  Input = Id.make("input"),
                  Chaos = Id.make("chaos");
                const made: string[] = [];
                let highest = at;

                for (const now of [at, at, at - 1, ...changes.map((n) => at + n)]) {
                  yield* TestClock.setTime(now);
                  highest = Math.max(now, highest);
                  const input = yield* gen.next(Input),
                    chaos = yield* gen.next(Chaos);

                  if (made.length === 0) {
                    const expected =
                      Array.from({ length: 10 }, (_, i) => raw[i]!).reduce((n, byte) => (n << 8n) | BigInt(byte), 0n) &
                      ((1n << 74n) - 1n);
                    const uuid = [...referenceDecode(split(input)[1])].reduce(
                      (n, byte) => (n << 8n) | BigInt(byte),
                      0n,
                    );
                    const actual = (((uuid >> 64n) & 4095n) << 62n) | (uuid & ((1n << 62n) - 1n));
                    expect(actual, "fresh identity uses the supplied entropy, not a count").toBe(expected);
                  }

                  expect(Schema.is(Input)(input)).toBe(true);
                  expect(Schema.is(Chaos)(chaos)).toBe(true);
                  expect(timestamp(input)).toBeGreaterThanOrEqual(highest);
                  expect(referenceDecode(split(input)[1])[6]! >>> 4).toBe(7);
                  expect(referenceDecode(split(input)[1])[8]! >>> 6).toBe(2);
                  made.push(split(input)[1], split(chaos)[1]);
                }

                expect(made).toEqual([...new Set(made)].sort());
                const process = yield* gen.next(Id.make("process"));
                expect(Schema.is(ProcessId)(process)).toBe(true);
                expect(process).toMatch(/^process_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
                expect(referenceDecode(split(process)[1])[6]! >>> 4).toBe(7);
                expect(referenceDecode(split(process)[1])[8]! >>> 6).toBe(2);
              }).pipe(Effect.provide(Id.Generator.layer), Effect.provide(TestClock.layer())),
            );
          } finally {
            entropy.mockRestore();
          }
        },
      ),
      { ...options, numRuns: 30 },
    );
  });

  for (const reason of ["clock", "entropy"] as const) {
    it(`${reason} failures are typed IdErrors, never defects`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.integer({ max: -1 }),
            fc.integer({ min: 2 ** 48, max: Number.MAX_SAFE_INTEGER }),
            fc.double({ min: 0, max: maxClock, noNaN: true }).filter((n) => !Number.isInteger(n)),
            fc.constantFrom(Number.NaN, Infinity),
          ),
          fc.string({ minLength: 1, maxLength: 20 }),
          async (at, marker) => {
            const run = (time: number) =>
              Effect.gen(function* () {
                yield* TestClock.setTime(time);
                return yield* Id.Generator.use((g) => g.next(Id.Input));
              }).pipe(Effect.provide(Id.Generator.layer), Effect.provide(TestClock.layer()));
            const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
              throw new Error(marker);
            });

            try {
              expectIdFailure(await Effect.runPromise(Effect.exit(run(reason === "clock" ? at : 1000))), reason);
            } finally {
              entropy.mockRestore();
            }
          },
        ),
        { ...options, numRuns: 20 },
      );
    });
  }

  it("random overflow advances the logical clock; its final millisecond refuses exhaustion", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: maxClock - 1 }), async (at) => {
        const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
          if (array instanceof Uint8Array) {
            array.fill(255);
          }

          return array;
        });
        const run = (now: number) =>
          Effect.gen(function* () {
            yield* TestClock.setTime(now);
            const gen = yield* Id.Generator,
              Input = Id.make("input");
            const first = yield* gen.next(Input);
            return { first, second: yield* Effect.exit(gen.next(Input)) };
          }).pipe(Effect.provide(Id.Generator.layer), Effect.provide(TestClock.layer()));

        try {
          const ordinary = await Effect.runPromise(run(at));
          expect(Exit.isSuccess(ordinary.second)).toBe(true);

          if (Exit.isSuccess(ordinary.second)) {
            expect(timestamp(ordinary.second.value)).toBe(at + 1);
          }

          const last = await Effect.runPromise(run(maxClock));
          expectIdFailure(last.second, "exhausted");
        } finally {
          entropy.mockRestore();
        }
      }),
      { ...options, numRuns: 20 },
    );
  });
});

describe("T518 Id order and generation", () => {
  it.effect.prop(
    "id.next keeps the generated type on completed success and failure spans",
    { at: Time, type: Prefix },
    ({ at, type }) => {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span(settings) {
          const span = new Tracer.NativeSpan(settings);
          spans.push(span);
          return span;
        },
      });
      return Effect.gen(function* () {
        const Specific = Id.make(type);
        const generator = yield* Id.Generator;
        yield* TestClock.setTime(at);
        expect(accepts(yield* generator.next(Specific), type)).toBe(true);
        yield* TestClock.setTime(-at - 1);
        expectIdFailure(yield* Effect.exit(generator.next(Specific)), "clock");
        const made = spans.filter((span) => span.name === "id.next");
        expect(made).toHaveLength(2);

        for (const [index, span] of made.entries()) {
          expect(span.attributes.get("type")).toBe(type);
          expect(span.status._tag).toBe("Ended");

          if (span.status._tag === "Ended") {
            expect(Exit.isSuccess(span.status.exit)).toBe(index === 0);
          }
        }
      }).pipe(Effect.provide(Id.Generator.layer), Effect.withTracer(tracer));
    },
    effectOptions,
  );
  it.effect.prop(
    "unregistered schemas fail typed instead of generating an undefined prefix",
    { at: Time, type: Prefix },
    ({ at, type }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(at);
        const generator = yield* Id.Generator;
        const Unregistered = Schema.String.pipe(Schema.brand("unregistered"));
        expectIdFailure(yield* Effect.exit(generator.next(Unregistered)), "prefix");
        const Specific = Id.make(type);
        const value = yield* generator.next(Specific);
        expect(accepts(value, type)).toBe(true);
        expect(timestamp(value)).toBe(at);
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it.effect.prop(
    "built-in prefixes generate UUIDv7 bursts; empty prefixes fail typed",
    { at: Time, count: Count, type: Id.Type },
    ({ at, count, type }) =>
      Effect.gen(function* () {
        const Specific = Id.make(type);
        const generator = yield* Id.Generator;
        const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
          if (array instanceof Uint8Array) {
            array.fill(0);
          }

          return array;
        });

        try {
          yield* TestClock.setTime(at);
          const ids = yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
            concurrency: 1,
          });
          increasing(ids);

          for (const id of ids) {
            expect(accepts(id, type)).toBe(true);
            expect(id.startsWith(`${type}_`)).toBe(true);
            expect(Schema.decodeUnknownSync(Specific)(id)).toBe(id);
            expect(timestamp(id)).toBe(at);
          }

          expect(() => Id.make("")).toThrow();
          expectIdFailure(yield* Effect.exit(Id.makeEffect("")), "prefix");
        } finally {
          random.mockRestore();
        }
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it("Order compares suffix first, then the whole prefix on ties", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(prefix, uuid), { minLength: 2, maxLength: 40 }),
        uuid,
        prefixShapes,
        (values, tied, shapes) => {
          const ids = [
            ...values.map(([type, bytes]) => wire(type, bytes)),
            ...shapes.map((type) => wire(type, tied)),
          ].map((raw) => Id.Schema.make(raw));
          const expected = [...ids].sort((left, right) => {
            const [lp, ls] = split(left),
              [rp, rs] = split(right);
            return compare(ls, rs) || compare(lp, rp);
          });
          expect([...ids].sort(Id.Order)).toEqual(expected);

          for (const left of ids) {
            expect(Id.Order(left, left)).toBe(0);

            for (const right of ids) {
              const [lp, ls] = split(left),
                [rp, rs] = split(right);
              expect(Id.Order(left, right)).toBe(compare(ls, rs) || compare(lp, rp));
            }
          }
        },
      ),
      options,
    );
  });
  it.effect.prop(
    "next(schema) encodes the controlled clock and UUIDv7 bits at both clock edges",
    { at: Time, count: Count },
    ({ at, count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("letter");
        const generator = yield* Id.Generator;
        // Zero entropy keeps a burst at the last millisecond inside the clock's range.
        const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
          if (array instanceof Uint8Array) {
            array.fill(0);
          }

          return array;
        });

        try {
          for (const now of [0, at, maxClock]) {
            yield* TestClock.setTime(now);
            const ids = yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
              concurrency: 1,
            });
            increasing(ids);

            for (const id of ids) {
              expect(accepts(id, "letter")).toBe(true);
              expect(Schema.decodeUnknownSync(Specific)(id)).toBe(id);
              expect(timestamp(id)).toBe(now);
            }
          }
        } finally {
          random.mockRestore();
        }
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it.effect.prop(
    "one writer stays strictly increasing across bursts and clock rollback",
    {
      at: Time,
      deltas: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: -1000, maximum: 1000 }))).check(
        Schema.isBetweenLength(2, 30),
      ),
      count: Count,
    },
    ({ at, deltas, count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");
        const generator = yield* Id.Generator;
        const ids: Array<string> = [];
        // Leave room for increments even when a generated entropy value is all ones.
        const start = Math.max(1000, Math.min(at, maxClock - 10_000));

        for (const delta of [0, 0, -1, ...deltas]) {
          const now = Math.max(0, start + delta);
          yield* TestClock.setTime(now);
          expect(yield* Clock.currentTimeMillis).toBe(now);
          ids.push(
            ...(yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
              concurrency: 1,
            })),
          );
        }

        increasing(ids);
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it.effect.prop(
    "exhausted random bits advance the logical clock and keep the UUID layout",
    { at: Time, count: Count },
    ({ at, count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");
        const generator = yield* Id.Generator;
        const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
          if (array instanceof Uint8Array) {
            array.fill(255);
          }

          return array;
        });

        try {
          const now = Math.min(at, maxClock - 1);
          yield* TestClock.setTime(now);
          const ids = yield* Effect.forEach(Array.from({ length: count }), () => generator.next(Specific), {
            concurrency: 1,
          });
          increasing(ids);
          expect(timestamp(ids[0]!)).toBe(now);

          for (const id of ids.slice(1)) {
            expect(timestamp(id)).toBe(now + 1);
            expect(accepts(id, "process")).toBe(true);
          }
        } finally {
          random.mockRestore();
        }
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it.effect.prop(
    "out-of-range clocks fail with a typed IdError",
    { extra: Count },
    ({ extra }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");

        for (const now of [-extra, maxClock + extra, Number.MAX_SAFE_INTEGER + extra]) {
          yield* TestClock.setTime(now);
          const exit = yield* Effect.gen(function* () {
            const generator = yield* Id.Generator;
            return yield* generator.next(Specific);
          }).pipe(Effect.provide(Id.Generator.layer), Effect.exit);
          expectIdFailure(exit, "clock");
        }
      }),
    effectOptions,
  );
  it.effect.prop(
    "random-bit overflow at the last millisecond fails typed instead of wrapping",
    { count: Count },
    ({ count }) =>
      Effect.gen(function* () {
        const Specific = Id.make("process");
        const generator = yield* Id.Generator;
        const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
          if (array instanceof Uint8Array) {
            array.fill(255);
          }

          return array;
        });

        try {
          yield* TestClock.setTime(maxClock);
          expect(timestamp(yield* generator.next(Specific))).toBe(maxClock);

          for (let i = 1; i < count; i++) {
            const exit = yield* Effect.exit(generator.next(Specific));
            expectIdFailure(exit, "exhausted");
          }
        } finally {
          random.mockRestore();
        }
      }).pipe(Effect.provide(Id.Generator.layer)),
    effectOptions,
  );
  it.effect.prop(
    "independent layers and writer restarts do not collide on generated schedules",
    {
      at: Time,
      writers: Schema.Int.check(Schema.isBetween({ minimum: 8, maximum: 24 })),
      schedule: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: -100, maximum: 100 }))).check(
        Schema.isBetweenLength(4, 20),
      ),
    },
    ({ at, writers, schedule }) =>
      Effect.gen(function* () {
        const Specific = Id.make("letter");
        const start = Math.min(at, maxClock - 10_000);
        // A collision sample, not a proof. Fresh provide calls build independent layers, including
        // writers restarted on exactly the same schedule. Entropy is real, never stubbed here.
        const batches = yield* Effect.forEach(
          Array.from({ length: writers }),
          () =>
            Effect.gen(function* () {
              const generator = yield* Id.Generator;
              return yield* Effect.forEach(
                [0, 0, -1, ...schedule],
                (delta) =>
                  Effect.gen(function* () {
                    yield* TestClock.setTime(Math.max(0, start + delta));
                    return yield* generator.next(Specific);
                  }),
                { concurrency: 1 },
              );
            }).pipe(Effect.provide(Id.Generator.layer)),
          { concurrency: 1 },
        );
        const ids = batches.flat();
        expect(new Set(ids).size).toBe(ids.length);

        for (const batch of batches) {
          increasing(batch);

          for (const id of batch) {
            expect(accepts(id, "letter")).toBe(true);
          }
        }
      }),
    effectOptions,
  );
});

describe("T518 shared Id generator", () => {
  type Schedule = {
    readonly type: string;
    readonly entropy: number;
    readonly batches: ReadonlyArray<{
      readonly at: number;
      readonly work: ReadonlyArray<number>;
    }>;
  };
  const checkSchedule = async (schedule: Schedule) => {
    const Specific = Id.make(schedule.type);
    const allocated: Array<string> = [];
    const check = Specific.ast.checks?.find((check) => check._tag === "Filter");

    if (check === undefined) {
      throw new Error("The Id schema needs its real format check");
    }

    const validate = check.run;
    // The real format check runs synchronously after the state write and encoding.
    // Observe there: a fiber can yield between allocation and returning to its caller.
    const decoding = vi.spyOn(check, "run").mockImplementation((input, self, options) => {
      if (typeof input === "string") {
        allocated.push(input);
      }

      return validate(input, self, options);
    });
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (array instanceof Uint8Array) {
        array.fill(schedule.entropy);
      }

      return array;
    });

    try {
      const returned = await Effect.runPromise(
        Effect.gen(function* () {
          const generator = yield* Id.Generator;
          const ids: Array<string> = [];

          for (const batch of schedule.batches) {
            yield* TestClock.setTime(batch.at);
            ids.push(
              ...(yield* Effect.forEach(
                batch.work,
                (work) =>
                  Effect.gen(function* () {
                    for (let i = 0; i < work; i++) {
                      yield* Effect.sync(() => {});
                    }

                    return yield* generator.next(Specific);
                  }),
                { concurrency: batch.work.length },
              )),
            );
            // A later call must continue the state saved by the concurrent burst.
            ids.push(yield* generator.next(Specific));
          }

          return ids;
        }).pipe(Effect.provide(Id.Generator.layer), Effect.provide(TestClock.layer())),
      );
      expect(allocated).toHaveLength(returned.length);
      expect([...allocated].sort()).toEqual([...returned].sort());
      increasing(allocated);
    } finally {
      random.mockRestore();
      decoding.mockRestore();
    }
  };
  it("shared fibers allocate unique, strictly increasing ids over generated schedules", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          type: prefix,
          entropy: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 255 })),
          batches: fc.array(
            fc.record({
              // Leave room for logical-clock increments after all-ones entropy.
              at: fc.integer({ min: 0, max: maxClock - 1000 }),
              // Effect 4.1.1's normal scheduler budget is crossed near this range.
              work: fc.array(fc.integer({ min: 2000, max: 2070 }), { minLength: 2, maxLength: 8 }),
            }),
            { minLength: 2, maxLength: 6 },
          ),
        }),
        checkSchedule,
      ),
      { ...options, numRuns: 40 },
    );
  });
  it("pinned: T518 review 5 P1, four fibers reseed the same millisecond after a scheduler yield", async () => {
    await checkSchedule({
      type: "process",
      entropy: 0,
      batches: [{ at: 1000, work: [2035, 2035, 2035, 2035] }],
    });
  });
});
