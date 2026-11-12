// next/, ticket 887, P21 L10. The declaration, Config, files and generated editors agree.
import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Result, Schema } from "effect";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import * as Sources from "./Sources.ts";

const seed = 119120;
const ttl = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

it.effect.prop(
  "L10: desktop.link-ttl is read through its declaration and the common source order",
  {
    file: ttl,
    env: ttl,
    flag: ttl,
    source: Schema.Literals(["default", "file", "env", "flag"]),
  },
  ({ file, env, flag, source }) =>
    Effect.gen(function* () {
      const setting = Declarations.desktopLinkTtl;
      const direct = yield* setting.parse(ConfigProvider.fromUnknown({ desktop: { "link-ttl": file } }));
      expect(direct).toBe(file);
      const document = (value: number | undefined) => ({
        value: value === undefined ? {} : { desktop: { "link-ttl": value } },
        spans: value === undefined ? [] : [{ path: ["desktop", "link-ttl"], line: 2 }],
      });
      const resolved = yield* Sources.resolve(Declarations.all, {
        flags: Sources.flags(source === "flag" ? { [setting.path]: String(flag) } : {}),
        env: Sources.env(source === "flag" || source === "env" ? { [setting.env]: String(env) } : {}),
        repo: Sources.file("repo.toml", document(undefined)),
        person: Sources.file("person.toml", document(source === "default" ? undefined : file)),
      });
      expect(resolved.values.desktopLinkTtl).toBe(
        source === "flag" ? flag : source === "env" ? env : source === "file" ? file : setting.default,
      );
      expect(resolved.origins[setting.path]?._tag).toBe(source);
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(Files.schema(Declarations.all, "person"))({
            desktop: { "link-ttl": file },
          }),
        ),
      ).toBe(true);
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(Files.schema(Declarations.all, "repo"), {
            onExcessProperty: "error",
          })({ desktop: { "link-ttl": file } }),
        ),
      ).toBe(true);
    }),
  { arbitrary: { seed, runs: 100 } },
);

it.effect.prop(
  "L10: invalid lifetimes fail the declaration before a start can continue",
  {
    pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
    negative: Schema.Int.check(Schema.isLessThanOrEqualTo(0)),
  },
  ({ pick, negative }) =>
    Effect.gen(function* () {
      // Schema literals are finite. Generate the nonfinite values at this boundary instead.
      const bad = [
        negative,
        0.5,
        -0.5,
        Number.MAX_SAFE_INTEGER + 1,
        Infinity,
        -Infinity,
        Number.NaN,
        "",
        "later",
        true,
      ][pick];
      const setting = Declarations.desktopLinkTtl;
      expect(Schema.is(setting.schema)(bad)).toBe(false);
      const result = yield* setting
        .parse(ConfigProvider.fromUnknown({ desktop: { "link-ttl": bad } }))
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }),
  { arbitrary: { seed, runs: 100 } },
);

// format: the declared settings path, shipped default and file scope are the editor's public format.
it("format: L10 desktop.link-ttl keeps its declared default and metadata", () => {
  expect(Declarations.desktopLinkTtl).toMatchObject({
    path: "desktop.link-ttl",
    default: 60_000,
    scope: ["person"],
    reload: "restart",
    since: "0.0.0",
  });
});
