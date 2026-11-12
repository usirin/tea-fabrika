// T753, next/: L1–L4. File input and recorded JSON share one declaration.
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { Config } from "effect";
import { ByteSize, Exit, Schema } from "effect";
import * as fc from "fast-check";
import * as Codec from "./Codec.ts";
import * as Setting from "./Setting.ts";

const check = { seed: 119120, numRuns: 100 };
const strict = { onExcessProperty: "error" } as const;

const bytes = fc.oneof(
  fc.bigInt({ min: 0n, max: 9007199254740991n }),
  fc.bigInt({ min: 9007199254740993n, max: 2n ** 100n }),
);

const declarations = (count: bigint, port: number, enabled: boolean, word: string) => {
  const meta = { doc: "A generated setting.", scope: ["repo"] as const, reload: "restart" as const, since: "1.2.3" };
  return Setting.group({
    record: Setting.make("limits.record", {
      ...meta,
      schema: Schema.ByteSize,
      default: ByteSize.bytes(count),
      format: "text",
    }),
    port: Setting.make("instance.port", { ...meta, schema: Schema.Int, default: port }),
    enabled: Setting.make("instance.enabled", { ...meta, schema: Schema.Boolean, default: enabled }),
    word: Setting.make("instance.word", { ...meta, schema: Schema.String, default: word }),
  });
};

describe("T753 shared codecs", () => {
  it("scenario: L1 inferred types follow the concrete declaration record", () => {
    // scenario: compile-time assertions are checked by the lead's typecheck.
    const group = declarations(1n, 1, true, "a");
    const codec = Codec.values(group);
    expectTypeOf(group.settings.record.default).toEqualTypeOf<ByteSize.ByteSize>();
    expectTypeOf<Config.Success<typeof group>>().toEqualTypeOf<typeof codec.Type>();
    expectTypeOf<typeof codec.Type>().toEqualTypeOf<{
      readonly record: ByteSize.ByteSize;
      readonly port: number;
      readonly enabled: boolean;
      readonly word: string;
    }>();
  });

  it("L2 native file codecs keep native types and refuse converted spellings", () => {
    fc.assert(
      fc.property(fc.record({ port: fc.integer(), enabled: fc.boolean(), word: fc.string() }), (v) => {
        const group = declarations(1n, v.port, v.enabled, v.word);
        expect(Schema.decodeUnknownSync(Codec.file(group.settings.port))(v.port)).toBe(v.port);
        expect(Schema.decodeUnknownSync(Codec.file(group.settings.enabled))(v.enabled)).toBe(v.enabled);
        expect(Schema.decodeUnknownSync(Codec.file(group.settings.word))(v.word)).toBe(v.word);
        expect(Exit.isFailure(Schema.decodeUnknownExit(Codec.file(group.settings.port))(String(v.port)))).toBe(true);
        expect(Exit.isFailure(Schema.decodeUnknownExit(Codec.file(group.settings.enabled))(String(v.enabled)))).toBe(
          true,
        );
        expect(Exit.isFailure(Schema.decodeUnknownExit(Codec.file(group.settings.word))(v.port))).toBe(true);
      }),
      check,
    );
  });

  it("L3 unit-bearing file inputs decode exact SI, IEC and fractional quantities", () => {
    const unit = fc.constantFrom(
      { name: "kB", scale: 1000n },
      { name: "KiB", scale: 1024n },
      { name: "MB", scale: 1000000n },
      { name: "MiB", scale: 1048576n },
    );
    fc.assert(
      fc.property(fc.record({ whole: fc.integer({ min: 0, max: 1000000 }), half: fc.boolean(), unit }), (v) => {
        const count = BigInt(v.whole) * v.unit.scale + (v.half ? v.unit.scale / 2n : 0n);
        const d = declarations(count, 1, true, "a").settings.record;
        const file = Codec.file(d);
        const text = `${v.whole}${v.half ? ".5" : ""} ${v.unit.name}`;
        expect(ByteSize.toBigInt(Schema.decodeUnknownSync(file)(text))).toBe(count);

        for (const invalid of [Number(count), String(count), `${v.whole} wobble`, `-${text}`, {}, null]) {
          expect(Exit.isFailure(Schema.decodeUnknownExit(file)(invalid))).toBe(true);
        }

        const encoded = Schema.encodeSync(file)(ByteSize.bytes(count));
        expect(typeof encoded).toBe("string");
        expect(Schema.decodeUnknownSync(file)(encoded)).toBe(ByteSize.bytes(count));
      }),
      check,
    );
  });

  it("L4 complete JSON values round trip without defaults or precision loss", () => {
    fc.assert(
      fc.property(fc.record({ count: bytes, port: fc.integer(), enabled: fc.boolean(), word: fc.string() }), (v) => {
        const group = declarations(v.count, v.port, v.enabled, v.word);
        const codec = Codec.values(group);
        const decoded = { record: ByteSize.bytes(v.count), port: v.port, enabled: v.enabled, word: v.word };
        const json = { record: String(v.count), port: v.port, enabled: v.enabled, word: v.word };
        expect(Schema.encodeSync(codec)(decoded)).toEqual(json);
        expect(Schema.decodeUnknownSync(Schema.fromJsonString(codec))(JSON.stringify(json), strict)).toEqual(decoded);

        for (const key of Object.keys(json)) {
          const missing = { ...json };
          Reflect.deleteProperty(missing, key);
          expect(Exit.isFailure(Schema.decodeUnknownExit(codec)(missing, strict))).toBe(true);
        }

        expect(Exit.isFailure(Schema.decodeUnknownExit(codec)({ ...json, extra: true }, strict))).toBe(true);
        expect(Exit.isFailure(Schema.decodeUnknownExit(codec)({ ...json, record: `${v.count} B` }, strict))).toBe(true);
      }),
      check,
    );
  });

  it("L3–L4 derived encodings keep the declaration's decoded restriction", () => {
    fc.assert(
      fc.property(
        fc.record({ ceiling: fc.integer({ min: 2, max: 1000000 }), extra: fc.integer({ min: 1, max: 1000 }) }),
        (v) => {
          const schema = Schema.ByteSize.check(Schema.isLessThanOrEqualToBigInt(BigInt(v.ceiling)));
          const d = Setting.make("limits.record", {
            schema,
            default: ByteSize.bytes(1),
            doc: "Capped bytes.",
            scope: ["repo"],
            reload: "restart",
            since: "1.2.3",
            format: "text",
          });
          const group = Setting.group({ record: d });
          expect(Schema.decodeUnknownSync(Codec.file(d))(`${v.ceiling} B`)).toBe(ByteSize.bytes(v.ceiling));
          expect(Exit.isFailure(Schema.decodeUnknownExit(Codec.file(d))(`${v.ceiling + v.extra} B`))).toBe(true);
          expect(
            Exit.isFailure(Schema.decodeUnknownExit(Codec.values(group))({ record: String(v.ceiling + v.extra) })),
          ).toBe(true);
        },
      ),
      check,
    );
  });
});
