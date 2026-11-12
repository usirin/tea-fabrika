// T753, next/. Shared start laws take their storage driver from the calling module (0062).
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Option, Schema, type Scope } from "effect";
import { Digest } from "effect/crypto";
import { Hex } from "effect/encoding";
import * as fc from "fast-check";
import * as Declarations from "./Declarations.ts";
import * as Snapshot from "./Snapshot.ts";
import { Origin } from "./Sources.ts";

export const options = { arbitrary: { seed: 119120, runs: 100 } };

// Stateful walks use fast-check because the plan requires fc.array move recipes.
export const law = <A>(
  name: string,
  arbitrary: fc.Arbitrary<A>,
  check: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>,
) =>
  it(name, () =>
    fc.assert(
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits a Promise for each generated walk
      fc.asyncProperty(arbitrary, (value) => Effect.runPromise(Effect.scoped(check(value)))),
      { seed: 119120, numRuns: 100 },
    ),
  );

export const recipe = fc.record({
  port: fc.integer({ min: 1, max: 65535 }),
  start: fc.uuid(),
  build: fc.uuid(),
  revision: fc.option(fc.uuid(), { nil: null }),
  origin: fc.constantFrom("default", "flag", "env", "file"),
});

export type Recipe = fc.ArbitraryValue<typeof recipe>;

export interface Input {
  readonly settings: Snapshot.Snapshot;
  readonly start: string;
  readonly build: string;
  readonly repo: { readonly revision: string } | null;
  readonly founding: { readonly person: string; readonly founder: string; readonly window: string | null };
  readonly name: string;
  readonly limits?: { readonly recordBytes: number };
  readonly mail?: { readonly grants: Readonly<Record<string, ReadonlyArray<string>>> };
}

export const input = Effect.fnUntraced(function* (r: Recipe): Effect.fn.Return<Input, never, Digest.Digest> {
  const origin =
    r.origin === "flag"
      ? Origin.cases.flag.make({ name: "--instance.port" })
      : r.origin === "env"
        ? Origin.cases.env.make({ name: "FABRIKA_INSTANCE_PORT" })
        : r.origin === "file"
          ? Origin.cases.file.make({ file: "~/.fabrika/fabrika.toml", line: 2 })
          : Origin.cases.default.make({});
  const settings = yield* Snapshot.make(Declarations.all, {
    values: { port: r.port, version: "0.0.0" },
    origins: { "instance.port": origin, "fabrika-version": Origin.cases.default.make({}) },
  });
  return {
    settings,
    start: r.start,
    build: r.build,
    repo: r.revision === null ? null : { revision: r.revision },
    founding: { person: "test-person", founder: "test-public-key", window: null },
    name: "settings-law",
  };
});

export interface Fixture {
  readonly port: number;
  readonly name: string;
  readonly person?: string;
  readonly founder?: string;
  readonly window?: string | null;
  readonly build?: string;
  readonly start?: string;
  readonly limits?: { readonly recordBytes: number };
  readonly mail?: { readonly grants: Readonly<Record<string, ReadonlyArray<string>>> };
}

// The calling platform supplies its synchronous hash driver. Snapshot.make still owns the encoding.
export const fixture = (config: Fixture, hash: (algorithm: Digest.Algorithm, data: Uint8Array) => Uint8Array) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: synchronous Vitest fixture setup needs a plain snapshot value
  Effect.runSync(
    Effect.gen(function* () {
      const base = yield* input({
        port: config.port,
        start: config.start ?? `${config.name}-fixture`,
        build: config.build ?? "fixture-build",
        revision: null,
        origin: "flag",
      });
      return {
        ...base,
        name: config.name,
        founding: {
          person: config.person ?? "test-person",
          founder: config.founder ?? "test-public-key",
          window: config.window ?? null,
        },
        ...(config.limits === undefined ? {} : { limits: config.limits }),
        ...(config.mail === undefined ? {} : { mail: config.mail }),
      };
    }).pipe(
      Effect.provideService(Digest.Digest, {
        digest: (algorithm, data) => Effect.sync(() => hash(algorithm, data)),
        digestHex: (algorithm, data) => Effect.sync(() => Hex.encode(hash(algorithm, data))),
      }),
    ),
  );

export const corrupt = (value: Input, choice: number, secret = "invalid") => {
  const snapshot = value.settings;
  const { "instance.port": _port, ...withoutPort } = snapshot.values;
  const { "instance.port": _origin, ...withoutOrigin } = snapshot.origins;
  const variants = [
    { ...value, settings: undefined },
    { ...value, settings: { ...snapshot, values: withoutPort } },
    { ...value, settings: { ...snapshot, origins: withoutOrigin } },
    { ...value, settings: { ...snapshot, values: { ...snapshot.values, unexpected: secret } } },
    {
      ...value,
      settings: { ...snapshot, origins: { ...snapshot.origins, unexpected: Origin.cases.default.make({}) } },
    },
    { ...value, settings: { ...snapshot, values: { ...snapshot.values, "instance.port": secret } } },
    { ...value, settings: { ...snapshot, hash: `${snapshot.hash}0` } },
    {
      ...value,
      settings: {
        ...snapshot,
        values: { ...snapshot.values, "instance.port": value.settings.values["instance.port"] === 1 ? 2 : 1 },
      },
    },
    { ...value, port: 18800 },
    { ...value, secrets: { password: secret } },
  ];
  return variants[choice % variants.length];
};

export const sentinel = fc
  .tuple(fc.uuid(), fc.constantFrom('"', "+", "/", "&", " "))
  .map(([word, mark]) => `private-${word}${mark}end`);

export const exclude = (output: unknown, secret: string) => {
  const text = typeof output === "string" ? output : JSON.stringify(output);

  for (const form of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) {
    expect(text).not.toContain(form);
  }
};

// The driver normalizes its checked receipt. No ledger or platform type enters settings.
export interface Saved {
  readonly start: string;
  readonly settings: Snapshot.Snapshot;
  readonly build: string;
  readonly repo: { readonly revision: string } | null;
  readonly entry: {
    readonly id: string;
    readonly stream: string;
    readonly rev: number;
    readonly pos: number;
    readonly arrivedAt: number;
    readonly by: string;
    readonly for: string;
    readonly sentAt: string;
    readonly seen: number;
    readonly parent: string | null;
    readonly traceId: string;
  };
}

export const receipt = (input: Input): Saved => ({
  start: input.start,
  settings: input.settings,
  build: input.build,
  repo: input.repo,
  entry: {
    id: input.start,
    stream: `settings/instance/${input.start}`,
    rev: 1,
    pos: 1,
    arrivedAt: 1794096000000,
    by: "fixture-writer",
    for: "test-person",
    sentAt: "2026-11-08T04:00:00.000Z",
    seen: 0,
    parent: null,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  },
});

const Reply = Schema.TaggedStruct("ok", { value: Schema.Unknown });
export const reply = (input: Input) => Reply.make({ value: receipt(input) });

export interface Driver {
  readonly record: (input: Input) => Effect.Effect<Saved, unknown>;
  readonly read: (start: string) => Effect.Effect<Saved, unknown>;
  readonly entries: Effect.Effect<ReadonlyArray<Saved>, unknown>;
  readonly loseReply: (work: Effect.Effect<Saved, unknown>) => Effect.Effect<Saved, unknown>;
  readonly counts: () => { readonly reads: number; readonly appends: number; readonly consumers: number };
}

export const suite = <E>(open: Effect.Effect<Driver, E, Scope.Scope>) =>
  describe("L5 L6 instance starts, next/", () => {
    law(
      "reachable deployments and lost replies retain immutable starts and original metadata",
      fc.tuple(recipe, fc.array(fc.nat(), { minLength: 12, maxLength: 50 })),
      ([first, choices]) =>
        Effect.gen(function* () {
          const driver = yield* open;
          const inputs: Input[] = [yield* input(first)];
          const saved = new Map<string, Saved>();

          for (const [index, choice] of choices.entries()) {
            const moves =
              saved.size === 0
                ? ["record", "lost", "fresh"]
                : ["record", "lost", "fresh", "repeat", "concurrent", "conflict", "read"];
            const move = moves[choice % moves.length];

            if (move === "fresh") {
              inputs.push(
                yield* input({
                  ...first,
                  start: `${first.start}-${index}`,
                  port: choice % 2 === 0 ? first.port : (choice % 65535) + 1,
                }),
              );
              continue;
            }

            const selected =
              move === "repeat" || move === "read" || move === "conflict"
                ? inputs.filter((value) => saved.has(value.start))
                : inputs;
            const current = Option.getOrThrow(Option.fromUndefinedOr(selected[choice % selected.length]));
            const before = driver.counts();

            if (move === "conflict") {
              const different = yield* input({ ...first, start: current.start, build: `${current.build}-different` });
              expect(Exit.isFailure(yield* Effect.exit(driver.record(different)))).toBe(true);
              expect(yield* driver.read(current.start)).toEqual(saved.get(current.start));
            } else {
              if (move === "lost") {
                expect(Exit.isFailure(yield* Effect.exit(driver.loseReply(driver.record(current))))).toBe(true);
              }

              const receipts =
                move === "concurrent"
                  ? yield* Effect.forEach([current, current, current], driver.record, { concurrency: "unbounded" })
                  : [yield* move === "read" ? driver.read(current.start) : driver.record(current)];

              for (const receipt of receipts) {
                expect(receipt).toMatchObject({
                  start: current.start,
                  build: current.build,
                  repo: current.repo,
                  settings: current.settings,
                });

                if (saved.has(current.start)) {
                  expect(receipt).toEqual(saved.get(current.start));
                } else {
                  saved.set(current.start, receipt);
                }
              }

              const after = driver.counts();
              expect(after.reads - before.reads).toBe(move === "concurrent" ? 3 : move === "lost" ? 2 : 1);
            }

            const entries = yield* driver.entries;
            expect(entries).toHaveLength(saved.size);
            expect(new Set(entries.map((entry) => entry.entry.stream)).size).toBe(saved.size);
            expect(new Set(entries.map((entry) => entry.entry.id)).size).toBe(saved.size);
            expect(driver.counts().consumers).toBe(0);

            for (const entry of entries) {
              expect(entry).toEqual(saved.get(entry.start));
              expect(Schema.is(Snapshot.Snapshot)(entry.settings)).toBe(true);
              expect(entry.entry.rev).toBeGreaterThan(0);
              expect(entry.entry.pos).toBe(1);
              expect(entry.entry.sentAt).not.toBe("");
              expect(entry.entry.traceId).not.toBe("");
            }
          }
        }),
    );
  });
