// T664, P38 slice 1, next/: the snapshot's encoding, and L14 [secrets] of the approved plan, for
// `settings/Snapshot.ts` with `Sources.ts` and `Files.ts`. Written before the module.
//
// The shape these tests hold the module to:
// - `Snapshot.make(group, resolved)` takes what `Sources.resolve` gave and returns a `Snapshot`:
//   `values`, each declared setting's value as its schema encodes it, keyed by dotted path;
//   `origins`, as resolved; and `hash`, over the values alone, sorted by path, so equal settings
//   from different sources have one hash. It may need `Digest` from `effect/crypto`.
// - `Snapshot.Snapshot` is its Schema: what a process start saves, and what a replay reads back.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema, Tracer } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import * as Setting from "./Setting.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
const REPO = ".fabrika/fabrika.toml";
const PERSON = "~/.fabrika/fabrika.toml";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const parse = (text: string) =>
  Effect.gen(function* () {
    const toml = yield* Toml;
    return yield* toml.parse(text);
  });

const empty = { value: {}, spans: [] };

const sources = (slots: Partial<Sources.Slots>): Sources.Slots => ({
  flags: Sources.flags({}),
  env: Sources.env({}),
  repo: Sources.file(REPO, empty),
  person: Sources.file(PERSON, empty),
  ...slots,
});

const snapshot = <A>(group: Setting.Group<A>, slots: Sources.Slots) =>
  Effect.runPromise(
    Sources.resolve(group, slots).pipe(
      Effect.flatMap((resolved) => Snapshot.make(group, resolved)),
      Effect.provide(Digest.layerWebCrypto),
    ),
  );

const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);

// One to three port settings at distinct two-segment paths, with a value each.
const declared = fc
  .uniqueArray(fc.tuple(segment, segment), { minLength: 1, maxLength: 3, selector: ([a]) => a })
  .chain((paths) =>
    fc.tuple(fc.constant(paths), fc.array(fc.integer({ min: 1, max: 65535 }), { minLength: 3, maxLength: 3 })),
  );

const portGroup = (paths: ReadonlyArray<readonly [string, string]>) =>
  Setting.group(
    Object.fromEntries(
      paths.map(([a, b], n) => [
        `s${n}`,
        Setting.make(`${a}.${b}`, {
          schema: Port,
          default: 18787,
          doc: "A port.",
          scope: ["person"],
          reload: "restart",
        }),
      ]),
    ),
  );

describe("the snapshot: encoded values by path, and a hash of the values alone", () => {
  it("equal values give one hash, whatever source and declaration order; other values another", async () => {
    await fc.assert(
      fc.asyncProperty(declared, fc.integer({ min: 0, max: 2 }), async ([paths, values], changed) => {
        const flags = Object.fromEntries(paths.map(([a, b], n) => [`${a}.${b}`, String(values[n])]));
        const env = Object.fromEntries(
          paths.map(([a, b], n) => [`FABRIKA_${a.toUpperCase()}_${b.toUpperCase()}`, String(values[n])]),
        );
        const fromFlags = await snapshot(portGroup(paths), sources({ flags: Sources.flags(flags) }));
        const fromEnv = await snapshot(portGroup([...paths].reverse()), sources({ env: Sources.env(env) }));
        expect(fromFlags.values).toEqual(Object.fromEntries(paths.map(([a, b], n) => [`${a}.${b}`, values[n]])));
        expect(fromEnv.hash).toBe(fromFlags.hash);
        expect(Object.values(fromEnv.origins).map((o) => o._tag)).toEqual(paths.map(() => "env"));

        const at = changed % paths.length;
        const other = { ...flags, [`${paths[at]![0]}.${paths[at]![1]}`]: String((values[at]! % 65535) + 1) };
        const different = await snapshot(portGroup(paths), sources({ flags: Sources.flags(other) }));
        expect(different.hash).not.toBe(fromFlags.hash);

        // What a start saves is what a replay reads back, hash and all.
        const saved = JSON.stringify(Schema.encodeSync(Snapshot.Snapshot)(fromFlags));
        expect(Schema.decodeUnknownSync(Snapshot.Snapshot)(JSON.parse(saved))).toEqual(fromFlags);
      }),
      check,
    );
  });
});

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

// Made-up secrets with the characters that make the three forms differ.
const secret = fc
  .tuple(fc.stringMatching(/^[A-Za-z0-9]{6,12}$/), fc.constantFrom('"', "/", " ", "+", "\\", "&"))
  .map(([word, mark]) => `sk-${word}${mark}${word.slice(0, 3)}`);

const spans = () => {
  const ended: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      ended.push(span);
      return span;
    },
  });
  const text = () =>
    ended
      .map((span) =>
        JSON.stringify(
          { name: span.name, attributes: [...span.attributes], events: span.events, status: span.status },
          (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value),
        ),
      )
      .join("\n");
  return { tracer, text };
};

describe("L14 [secrets], only declared settings reach values, errors and spans", () => {
  it("a secret in an unrelated env field, or in an unknown file field, never reaches an output", async () => {
    await fc.assert(
      fc.asyncProperty(
        secret,
        fc.constantFrom("GITHUB_TOKEN", "FABRIKA_TOKEN", "FABRIKA_INSTANCE_TOKEN", "CLOUDFLARE_API_TOKEN"),
        fc.constantFrom("token", "key", "password"),
        fc.boolean(),
        fc.integer({ min: 1, max: 65535 }),
        async (word, field, key, inFile, port) => {
          const env = { [field]: word, FABRIKA_INSTANCE_PORT: String(port) };
          // An unknown key holding the secret, in a table the file may hold or in one of its own.
          const person = inFile ? `[instance]\n${key} = ${JSON.stringify(word)}\n` : "[instance]\nport = 18800\n";
          const { tracer, text } = spans();
          const exit = await Effect.runPromiseExit(
            Effect.gen(function* () {
              const repo = { file: REPO, document: yield* parse("") };
              const own = { file: PERSON, document: yield* parse(person) };
              yield* Files.validate(Declarations.all, { repo, person: own }, { version: "0.0.0" });
              const resolved = yield* Sources.resolve(Declarations.all, {
                flags: Sources.flags({}),
                env: Sources.env(env),
                repo: Sources.file(repo.file, repo.document),
                person: Sources.file(own.file, own.document),
              });
              const made = yield* Snapshot.make(Declarations.all, resolved);
              return { resolved, made };
            }).pipe(Effect.provide([TomlParser.layer, Digest.layerWebCrypto]), Effect.withTracer(tracer)),
          );
          const outputs: Array<string> = [text()];

          if (Exit.isSuccess(exit)) {
            expect(inFile).toBe(false);
            outputs.push(JSON.stringify(Schema.encodeSync(Snapshot.Snapshot)(exit.value.made)));
            outputs.push(JSON.stringify(exit.value.resolved));
            expect(exit.value.made.values["instance.port"]).toBe(port);
          } else {
            expect(inFile).toBe(true);
            const error = exit.cause.reasons.find((r) => r._tag === "Fail");
            expect(error?._tag === "Fail" ? error.error : undefined).toBeInstanceOf(Files.SettingsError);
            outputs.push(String(exit.cause), JSON.stringify(error?._tag === "Fail" ? error.error : null));
            // The unknown key is named; its value is not.
            expect(
              error?._tag === "Fail" && error.error instanceof Files.SettingsError ? error.error.message : "",
            ).toContain(`instance.${key}`);
          }

          for (const output of outputs) {
            for (const form of forms(word)) {
              expect(output).not.toContain(form);
            }
          }
        },
      ),
      check,
    );
  });
});
