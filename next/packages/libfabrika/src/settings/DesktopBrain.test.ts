// L14 next/. Only the declarations and lower settings services belong in this law.
import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const paths = [
  "desktop.brain-throttle",
  "desktop.brain-poll",
  "desktop.brain-start-timeout",
  "desktop.brain-stop-timeout",
] as const;

const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }));

const slots = (flags: Record<string, string>) => ({
  flags: Sources.flags(flags),
  env: Sources.env({}),
  repo: Sources.file("repo", { value: {}, spans: [] }),
  person: Sources.file("person", { value: {}, spans: [] }),
});

const declaration = (path: string) => {
  const value = Declarations.all.declarations.find((d) => d.path === path);
  expect(value, `${path} is declared`).toBeDefined();
  return value!;
};

it.effect.prop(
  "L14 declared person settings read a provider, keep defaults and survive snapshots",
  [Schema.Tuple([Positive, Positive, Positive, Positive])],
  ([values]) =>
    Effect.gen(function* () {
      const flags = Object.fromEntries(paths.map((path, i) => [path, String(values[i])]));
      const resolved = yield* Sources.resolve(Declarations.all, slots(flags));
      const saved = yield* Snapshot.make(Declarations.all, resolved);
      const checked = yield* Snapshot.read(Declarations.all, saved);

      for (const [i, path] of paths.entries()) {
        const d = declaration(path);
        expect(d.scope).toEqual(["person"]);
        expect(d.reload).toBe("restart");
        expect(yield* d.parse(ConfigProvider.fromUnknown({ desktop: { [path.split(".")[1]!]: values[i] } }))).toBe(
          values[i],
        );
        expect(yield* d.parse(ConfigProvider.fromUnknown({}))).toBe(d.default);
        expect(saved.values[path]).toBe(values[i]);
        expect(checked.snapshot.values[path]).toBe(values[i]);
        expect(saved.origins[path]?._tag).toBe("flag");
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { seed: 119120, numRuns: 100 } },
);

it.effect.prop(
  "L14 invalid and repo-scoped timings fail before a start can read them",
  [
    Schema.Literals(paths),
    Schema.Union([Schema.Int.check(Schema.isLessThanOrEqualTo(0)), Schema.Literals([0.5, "bad", "", null])]),
  ],
  ([path, bad]) =>
    Effect.gen(function* () {
      const d = declaration(path);
      expect(
        Exit.isFailure(
          yield* d.parse(ConfigProvider.fromUnknown({ desktop: { [path.split(".")[1]!]: bad } })).pipe(Effect.exit),
        ),
      ).toBe(true);
      const toml = yield* Toml;
      const repo = yield* toml.parse(`[desktop]\n${path.split(".")[1]} = 1\n`);
      const own = yield* toml.parse("");
      const failed = yield* Files.validate(
        Declarations.all,
        { repo: { file: "repo", document: repo }, person: { file: "person", document: own } },
        { version: "0.0.0" },
      ).pipe(Effect.exit);
      expect(Exit.isFailure(failed)).toBe(true);
    }).pipe(Effect.provide(TomlParser.layer)),
  { arbitrary: { seed: 119120, numRuns: 100 } },
);
