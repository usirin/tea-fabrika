// T753, next/, L3, L14, L17 and L19. No new declaration belongs to this cut.
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as Declarations from "./Declarations.ts";
import * as Start from "./Start.ts";
import * as Starts from "./Starts.ts";
import * as StartsTest from "./StartsTest.ts";

describe("instance start envelope, next/", () => {
  StartsTest.law(
    "L19 the envelope carries the legacy cap without declaring a record setting",
    fc.tuple(StartsTest.recipe, fc.option(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), { nil: undefined })),
    ([recipe, cap]) =>
      Effect.gen(function* () {
        expect(Declarations.all.declarations.map((setting) => setting.path).sort()).toEqual([
          "desktop.link-ttl",
          "fabrika-version",
          "gateway.limit",
          "gateway.window",
          "instance.port",
        ]);
        const base = yield* StartsTest.input(recipe);
        const wire = { ...base, ...(cap === undefined ? {} : { limits: { recordBytes: cap } }) };
        const decoded = yield* Schema.decodeUnknownEffect(Start.Input)(wire, { onExcessProperty: "error" });
        expect(decoded.settings).toEqual(base.settings);
        expect(decoded.limits?.recordBytes).toBe(cap);
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );

  StartsTest.law(
    "L19 malformed legacy limits still fail rather than selecting a fallback",
    fc.tuple(
      StartsTest.recipe,
      fc.oneof(
        fc.integer({ max: 0 }),
        fc.double().filter((n) => !Number.isInteger(n)),
        fc.string(),
        fc.boolean(),
        fc.constant(null),
      ),
    ),
    ([recipe, cap]) =>
      Effect.gen(function* () {
        const base = yield* StartsTest.input(recipe);
        expect(
          Result.isFailure(
            Schema.decodeUnknownResult(Start.Input, { onExcessProperty: "error" })({
              ...base,
              limits: { recordBytes: cap },
            }),
          ),
        ).toBe(true);
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );

  it("format: transport has one snapshot and explicit repo presence, as the approved wire table specifies", () => {
    // format: schema field names are the serialized Worker protocol.
    expectTypeOf<typeof Start.Input.Type.settings>().toEqualTypeOf<typeof import("./Snapshot.ts").Snapshot.Type>();
    expectTypeOf<typeof Start.Input.Type.repo>().toEqualTypeOf<{ readonly revision: string } | null>();
  });

  it.prop(
    "L17 each cause-bearing reason keeps the actual nested failure",
    [Schema.Struct({ message: Schema.String, detail: Schema.Json })],
    ([data]) => {
      const lower = new Error(data.message, { cause: data.detail });

      for (const Reason of [Starts.Decode, Starts.Refused, Starts.Storage, Starts.Unreachable]) {
        const reason = new Reason({ cause: lower });
        const error = new Starts.StartsError({ reason });
        expect(error.reason).toBeInstanceOf(Reason);
        expect(error.reason).toBe(reason);
        expect(reason.cause).toBe(lower);
        expect(lower.cause).toBe(data.detail);
      }
    },
    StartsTest.options,
  );

  it.prop(
    "L17 Missing holds the requested start and has no cause property",
    [Schema.NonEmptyString],
    ([start]) => {
      const target = Starts.MissingTarget.cases.instance.make({ start });
      const reason = new Starts.Missing({ target });
      const error = new Starts.StartsError({ reason });
      expect(error.reason).toBeInstanceOf(Starts.Missing);
      expect(reason.target).toEqual(target);
      expect(Object.hasOwn(reason, "cause")).toBe(false);
      expect("cause" in reason).toBe(false);
    },
    StartsTest.options,
  );
});
