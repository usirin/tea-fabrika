// P34c slice 4, next/. Calibration is copied from A-Numbers, never read from product defaults.
import { describe, expect, it } from "@effect/vitest";
import { ByteSize, Effect, Option, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as Declarations from "./Declarations.ts";
import * as Setting from "./Setting.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const declaration = (path: string) => {
  const found = Declarations.all.declarations.find((d) => d.path === path);
  expect(found, `${path} must be declared once`).toBeDefined();
  return Option.getOrThrow(Option.fromUndefinedOr(found));
};

const group = () =>
  Setting.group({
    writes: declaration("limits.writes"),
    storage: declaration("limits.storage"),
    recovery: declaration("limits.recovery"),
  });

const numeric = (value: unknown): unknown => {
  if (ByteSize.isByteSize(value)) {
    return ByteSize.toNumberUnsafe(value);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, numeric(v)]));
  }

  return value;
};

const measured = {
  project: { writes: 160, bytes: 74_080, letter: { writes: 10, bytes: 5_469 } },
  process: { writes: 290, bytes: 207_410, letter: { writes: 50, bytes: 18_790 } },
};

const empty = { value: {}, spans: [] };

const resolve = Effect.fnUntraced(function* (text: string) {
  const parsed = yield* Toml.use((toml) => toml.parse(text));
  return yield* Sources.resolve(group(), {
    flags: Sources.flags({}),
    env: Sources.env({}),
    repo: Sources.file("repo.toml", empty),
    person: Sources.file("person.toml", parsed),
  });
});

const layers = <A, E, R>(work: Effect.Effect<A, E, R | Toml | Digest.Digest>) =>
  work.pipe(Effect.provide(TomlParser.layer), Effect.provide(Digest.layerWebCrypto));

// fast-check supplies edge-biased tapes; each move changes the currently selected source value.
const Natural = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }));

const Tape = Schema.Array(Schema.Struct({ pick: Natural, value: Natural, remove: Schema.Boolean })).check(
  Schema.isMinLength(3),
  Schema.isMaxLength(15),
);

describe("P34c Q11 settings", () => {
  it.effect("vector: Q11 defaults equal A-Numbers; measurements are fixed independent inputs", () =>
    layers(
      Effect.gen(function* () {
        const g = group();
        expect(numeric(g.settings.writes.default)).toBe(Math.ceil(10 * 2 * 688));
        expect(numeric(g.settings.storage.default)).toBe(1_000_000_000);
        const calculated = {
          process: {
            writes: Math.ceil(10 * Math.max(29, 25 + 3)),
            bytes: Math.ceil(10 * Math.max(20_741, 5_259 + 6_167 + 8_444)),
            letter: { writes: Math.ceil(10 * 5), bytes: Math.ceil(10 * 1_879) },
          },
          project: {
            writes: Math.ceil(10 * Math.max(16, 5 + 5 + 6)),
            bytes: Math.ceil(10 * Math.max(7_408, 2_216 + 2_216 + 2_966)),
            letter: { writes: Math.ceil(10 * 1), bytes: Math.ceil(10 * 546.83) },
          },
        };
        expect(calculated).toEqual(measured);
        expect(numeric(g.settings.recovery.default)).toEqual(measured);

        for (const d of g.declarations) {
          expect(d.scope).toEqual(["person"]);
          expect(d.reload).toBe("restart");
        }

        const resolved = yield* resolve("");
        const saved = yield* Snapshot.make(g, resolved);
        expect(numeric((yield* Snapshot.read(g, saved)).values)).toEqual({
          writes: 13_760,
          storage: 1_000_000_000,
          recovery: measured,
        });
      }),
    ),
  );

  it.effect.prop(
    "Q11 source changes survive TOML and strict snapshot round trips",
    { tape: Tape },
    ({ tape }) =>
      layers(
        Effect.gen(function* () {
          const selected = new Map<string, number>();

          for (const cell of tape) {
            const paths = ["writes", "storage"];
            const key = paths[cell.pick % paths.length]!;
            const cap = key === "writes" ? 13_760 : 1_000_000_000;

            if (cell.remove) {
              selected.delete(key);
            } else {
              selected.set(key, 1 + (cell.value % cap));
            }

            const text = `[limits]\n${[...selected].map(([k, v]) => `${k} = ${k === "storage" ? `"${v} B"` : v}`).join("\n")}\n`;
            const resolved = yield* resolve(text);
            const g = group();
            const saved = yield* Snapshot.make(g, resolved);
            const transport = Schema.decodeSync(Schema.fromJsonString(Snapshot.Snapshot))(JSON.stringify(saved));
            const restored = yield* Snapshot.read(g, transport);
            expect(numeric(restored.values)).toEqual({
              writes: selected.get("writes") ?? 13_760,
              storage: selected.get("storage") ?? 1_000_000_000,
              recovery: measured,
            });
            expect(restored.snapshot).toEqual(saved);
            const bad = { ...transport, values: { ...transport.values } };
            delete bad.values["limits.writes"];
            expect(yield* Effect.result(Snapshot.read(g, bad))).toMatchObject({ _tag: "Failure" });
            expect(yield* Effect.result(Snapshot.read(g, { ...transport, hash: "changed" }))).toMatchObject({
              _tag: "Failure",
            });
          }
        }),
      ),
    { arbitrary: { seed: 119120, runs: 100 } },
  );

  it.effect.prop(
    "Q11 invalid quota settings fail instead of disabling or raising a wall",
    {
      tape: Tape,
    },
    ({ tape }) =>
      layers(
        Effect.gen(function* () {
          const valid = new Map<string, string>([
            ["writes", "1"],
            ["storage", '"1 B"'],
          ]);

          for (const cell of tape) {
            const key = [...valid.keys()][cell.pick % valid.size]!;
            const bad = cell.value % 2 === 0 ? "0" : key === "writes" ? "13761" : '"1000000001 B"';
            const text = `[limits]\n${[...valid].map(([k, v]) => `${k} = ${k === key ? bad : v}`).join("\n")}\n`;
            expect(yield* Effect.result(resolve(text))).toMatchObject({ _tag: "Failure" });
          }

          const recovery = declaration("limits.recovery");
          const encoded = Schema.encodeUnknownSync(recovery.schema)(recovery.default);
          expect(typeof encoded).toBe("object");

          // Mutate a schema-valid recovery value, rather than inventing another error schema.
          for (const location of ["project", "process"]) {
            for (const field of ["writes", "bytes"]) {
              const bad = structuredClone(encoded) as Record<string, Record<string, any>>;
              bad[location][field] = field === "bytes" ? "0 B" : 0;
              expect(Schema.decodeUnknownResult(recovery.schema)(bad)._tag).toBe("Failure");
              const letter = structuredClone(encoded) as Record<string, Record<string, any>>;
              letter[location].letter[field] = field === "bytes" ? "0 B" : 0;
              expect(Schema.decodeUnknownResult(recovery.schema)(letter)._tag).toBe("Failure");
            }
          }
        }),
      ),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});
