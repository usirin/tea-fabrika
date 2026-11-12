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
import { ByteSize, Cause, Effect, Exit, Layer, Logger, References, Schema, Tracer } from "effect";
import { Digest } from "effect/crypto";
import { TestConsole } from "effect/testing";
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

// T753 L4–L6: read(group, input) returns { values, snapshot } after checking the complete input.
const savedFlow = fc.record({
  count: fc.oneof(
    fc.bigInt({ min: 0n, max: 9007199254740991n }),
    fc.bigInt({ min: 9007199254740993n, max: 2n ** 100n }),
  ),
  port: fc.integer({ min: 1, max: 65535 }),
  word: fc.string(),
  source: fc.constantFrom("default", "env", "file"),
  order: fc.shuffledSubarray(["record", "port", "word"], { minLength: 3, maxLength: 3 }),
});

type SavedFlow = typeof savedFlow extends fc.Arbitrary<infer A> ? A : never;

const save = (v: SavedFlow) => {
  const meta = { doc: "A saved setting.", scope: ["repo"] as const, reload: "restart" as const, since: "1.2.3" };
  const settings = {
    record: Setting.make("limits.record", {
      ...meta,
      schema: Schema.ByteSize,
      default: ByteSize.bytes(1),
      format: "text",
    }),
    port: Setting.make("instance.port", { ...meta, schema: Port, default: 1 }),
    word: Setting.make("app.word", { ...meta, schema: Schema.String, default: "a" }),
  };
  const group = Setting.group(settings);
  const values = { record: ByteSize.bytes(v.count), port: v.port, word: v.word };
  const origins = Object.fromEntries(
    group.declarations.map((d) => [
      d.path,
      v.source === "file"
        ? Sources.Origin.cases.file.make({ file: REPO, line: 2 })
        : v.source === "env"
          ? Sources.Origin.cases.env.make({ name: d.env })
          : Sources.Origin.cases.default.make({}),
    ]),
  );
  return { settings, group, values, origins };
};

const digest = <A, E>(effect: Effect.Effect<A, E, Digest.Digest>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Digest.layerWebCrypto)));

describe("T753 complete checked snapshots", () => {
  it("L4 exact JSON and decoded values survive a checked snapshot round trip", async () => {
    await fc.assert(
      fc.asyncProperty(savedFlow, async (v) => {
        const flow = save(v);
        const made = await digest(Snapshot.make(flow.group, flow));
        expect(made.values).toEqual({ "limits.record": String(v.count), "instance.port": v.port, "app.word": v.word });
        const transported = Schema.decodeUnknownSync(Schema.fromJsonString(Snapshot.Snapshot))(JSON.stringify(made));
        const wire = { ...transported, values: { ...transported.values }, origins: { ...transported.origins } };
        const checked = await digest(Snapshot.read(flow.group, wire));
        expect(checked.values).toEqual(flow.values);
        expect(checked.snapshot).toEqual(made);
        // A caller changing its input after validation cannot change the returned facts.
        wire.values["instance.port"] = 0;
        wire.origins["instance.port"] = Sources.Origin.cases.env.make({ name: "changed" });
        expect(checked.snapshot).toEqual(made);
      }),
      check,
    );
  });

  it("L5 every declared value and origin is required and extra or renamed keys fail", async () => {
    await fc.assert(
      fc.asyncProperty(
        savedFlow.chain((v) => {
          const { group } = save(v);
          return fc.tuple(
            fc.constant(v),
            fc.constantFrom(...group.declarations.map((d) => d.path)),
            fc.constantFrom("values", "origins"),
            fc.constantFrom("delete", "add", "rename"),
          );
        }),
        async ([v, key, field, move]) => {
          const flow = save(v);
          const made = await digest(Snapshot.make(flow.group, flow));
          const bad = structuredClone(made);

          if (move !== "delete") {
            Object.assign(bad[field], { "unknown.key": bad[field][key] });
          }

          if (move !== "add") {
            Reflect.deleteProperty(bad[field], key);
          }

          const exit = await digest(Snapshot.read(flow.group, bad).pipe(Effect.exit));
          expect(Exit.isFailure(exit)).toBe(true);
          // Missing origins cannot be filled from current files or a default either.
          const invalidOrigin = {
            ...made,
            origins: { ...made.origins, [key]: { _tag: "file", file: REPO, line: "two" } },
          };
          expect(Exit.isFailure(await digest(Snapshot.read(flow.group, invalidOrigin).pipe(Effect.exit)))).toBe(true);
        },
      ),
      check,
    );
  });

  it("L6 canonical values alone determine the hash and corrupt values or hashes fail", async () => {
    await fc.assert(
      fc.asyncProperty(savedFlow, async (v) => {
        const flow = save(v);
        const made = await digest(Snapshot.make(flow.group, flow));
        const reversed = Setting.group(
          Object.fromEntries(v.order.map((name) => [name, flow.settings[name as keyof typeof flow.settings]])),
        );
        const origins = Object.fromEntries(
          flow.group.declarations.map((d) => [d.path, Sources.Origin.cases.flag.make({ name: `--${d.path}` })]),
        );
        const other = await digest(Snapshot.make(reversed, { values: flow.values, origins }));
        expect(other.hash).toBe(made.hash);
        expect(other.origins).toEqual(origins);
        const reordered = {
          ...made,
          values: Object.fromEntries(Object.entries(made.values).reverse()),
          origins: Object.fromEntries(Object.entries(origins).reverse()),
        };
        const checked = await digest(Snapshot.read(flow.group, reordered));
        expect(checked.snapshot.hash).toBe(made.hash);
        expect(checked.snapshot.origins).toEqual(origins);
        // Effect accepts several integer spellings. Hash the canonical re-encoding, not that spelling.
        const alternate = `0${v.count}`;
        const byteCodec = Schema.toCodecJson(Schema.ByteSize);
        const decoded = Schema.decodeUnknownExit(byteCodec)(alternate);

        if (Exit.isSuccess(decoded)) {
          const normalized = await digest(
            Snapshot.read(flow.group, {
              ...made,
              values: { ...made.values, "limits.record": alternate },
            }),
          );
          expect(normalized.values.record).toBe(ByteSize.bytes(v.count));
          expect(normalized.snapshot).toEqual(made);
        }

        const different = await digest(
          Snapshot.make(flow.group, { ...flow, values: { ...flow.values, port: (v.port % 65535) + 1 } }),
        );
        expect(different.hash).not.toBe(made.hash);

        for (const corrupted of [
          { ...made, hash: `${made.hash[0] === "0" ? "1" : "0"}${made.hash.slice(1)}` },
          { ...made, values: { ...made.values, "instance.port": (v.port % 65535) + 1 } },
          { ...made, values: { ...made.values, "limits.record": String(v.count + 1n) } },
        ]) {
          expect(Exit.isFailure(await digest(Snapshot.read(flow.group, corrupted).pipe(Effect.exit)))).toBe(true);
        }
      }),
      check,
    );
  });
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
          since: "0.0.0",
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

/**
 * Where a file holds the secret: nowhere, at an unknown key, or nested under a declared key, as a
 * table, an inline table or an array. Both files' declared keys are reached, and the repo's
 * `fabrika-version` is the one read first. `named` is the key the refusal identifies.
 */
const placed = (key: string, word: string) => {
  const s = JSON.stringify(word);
  return fc.constantFrom(
    { person: "[instance]\nport = 18800\n", repo: "", named: undefined },
    { person: `[instance]\n${key} = ${s}\n`, repo: "", named: `instance.${key}` },
    { person: `[instance.port]\n${key} = ${s}\n`, repo: "", named: "instance.port" },
    { person: `instance.port.${key} = ${s}\n`, repo: "", named: "instance.port" },
    { person: `[instance]\nport = { ${key} = ${s} }\n`, repo: "", named: "instance.port" },
    { person: `[instance]\nport = [${s}]\n`, repo: "", named: "instance.port" },
    { person: "", repo: `[fabrika-version]\n${key} = ${s}\n`, named: "fabrika-version" },
    { person: "", repo: `fabrika-version = { ${key} = ${s} }\n`, named: "fabrika-version" },
    { person: "", repo: `fabrika-version = [${s}]\n`, named: "fabrika-version" },
    { person: "", repo: `[instance.port]\n${key} = ${s}\n`, named: "instance.port" },
  );
};

describe("L14 [secrets], only declared settings reach values, errors and spans", () => {
  it("a secret in an unrelated env field, an unknown file field or under a declared key never reaches an output", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(secret, fc.constantFrom("token", "key", "password"))
          .chain(([word, key]) => fc.tuple(fc.constant(word), fc.constant(key), placed(key, word))),
        fc.constantFrom("GITHUB_TOKEN", "FABRIKA_TOKEN", "FABRIKA_INSTANCE_TOKEN", "CLOUDFLARE_API_TOKEN"),
        fc.integer({ min: 1, max: 65535 }),
        async ([word, _key, place], field, port) => {
          const env = { [field]: word, FABRIKA_INSTANCE_PORT: String(port) };
          const { tracer, text } = spans();
          const exit = await Effect.runPromiseExit(
            Effect.gen(function* () {
              const repo = { file: REPO, document: yield* parse(place.repo) };
              const own = { file: PERSON, document: yield* parse(place.person) };
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
            expect(place.named).toBeUndefined();
            outputs.push(JSON.stringify(Schema.encodeSync(Snapshot.Snapshot)(exit.value.made)));
            outputs.push(JSON.stringify(exit.value.resolved));
            expect(exit.value.made.values["instance.port"]).toBe(port);
          } else {
            expect(place.named).toBeDefined();
            const error = exit.cause.reasons.find((r) => r._tag === "Fail");
            expect(error?._tag === "Fail" ? error.error : undefined).toBeInstanceOf(Files.SettingsError);
            outputs.push(String(exit.cause), JSON.stringify(error?._tag === "Fail" ? error.error : null));
            // The key is named; the value found there is not.
            expect(
              error?._tag === "Fail" && error.error instanceof Files.SettingsError ? error.error.message : "",
            ).toContain(place.named);
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

it("T753 L9 [secrets] malformed snapshots keep rejected values out of public diagnostics", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({ flow: savedFlow, word: secret, field: fc.constantFrom("value", "extra", "origin", "hash") }),
      async ({ flow: v, word, field }) => {
        const flow = save(v);
        const made = await digest(Snapshot.make(flow.group, flow));
        const input =
          field === "value"
            ? { ...made, values: { ...made.values, "limits.record": word } }
            : field === "extra"
              ? { ...made, values: { ...made.values, unrelated: word } }
              : field === "origin"
                ? { ...made, origins: { ...made.origins, "limits.record": { _tag: word } } }
                : { ...made, hash: word };
        const traced = spans();
        const entries: Array<string> = [];
        const logger = Logger.make((options) =>
          entries.push(
            JSON.stringify({
              message: options.message,
              cause: Cause.pretty(options.cause),
              fields: options.fiber.getRef(References.CurrentLogAnnotations),
            }),
          ),
        );
        const ran = await Effect.runPromise(
          Effect.gen(function* () {
            const exit = yield* Snapshot.read(flow.group, input).pipe(Effect.withTracer(traced.tracer), Effect.exit);
            return { exit, stdout: yield* TestConsole.logLines, stderr: yield* TestConsole.errorLines };
          }).pipe(
            Effect.provideService(References.MinimumLogLevel, "All"),
            Effect.provide(Layer.mergeAll(Digest.layerWebCrypto, TestConsole.layer, Logger.layer([logger]))),
          ),
        );
        expect(Exit.isFailure(ran.exit)).toBe(true);
        const outputs = [
          ...ran.stdout.map(String),
          ...ran.stderr.map(String),
          ...entries,
          traced.text(),
          Exit.isFailure(ran.exit) ? Cause.pretty(ran.exit.cause) : "",
        ];

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
