// T753, next/. Shared start laws take their storage driver from the calling module (0062).
import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Exit, Option, Schema, type Scope } from "effect";
import { Digest } from "effect/crypto";
import { Hex } from "effect/encoding";
import * as fc from "fast-check";
import { property } from "../Testing.test-support.ts";
import * as Declarations from "./Declarations.ts";
import * as Snapshot from "./Snapshot.ts";
import { Origin } from "./Sources.ts";

export const options = { arbitrary: { seed: 119120, runs: 100 } };

// Stateful walks use fast-check because the plan requires fc.array move recipes.
export const law = <A>(
  name: string,
  arbitrary: fc.Arbitrary<A>,
  check: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope | Digest.Digest>,
  examples?: Array<[A]>,
) => {
  const parameters = { numRuns: 100, ...(examples === undefined ? {} : { examples }) };
  it.effect(name, () =>
    property(arbitrary, (value: A) => check(value).pipe(Effect.provide(Digest.layerWebCrypto)), parameters),
  );
};

export const recipe = fc.record({
  port: fc.integer({ min: 1, max: 65535 }),
  start: fc.uuid(),
  build: fc.uuid(),
  revision: fc.option(fc.uuid(), { nil: null }),
  origin: fc.constantFrom("default", "flag", "env", "file"),
});

export type Recipe = typeof recipe extends fc.Arbitrary<infer A> ? A : never;

export const originKinds = ["flag", "env", "file"] as const;

export interface OriginFault {
  readonly path: string;
  readonly origin: Origin;
}

// These strings fit Origin's wire schema but name no declared source, or reveal an absolute path.
export const originFault = (kind: (typeof originKinds)[number]): fc.Arbitrary<OriginFault> =>
  fc
    .tuple(
      fc.constantFrom(...Declarations.all.declarations.map((declaration) => declaration.path)),
      fc.uuid(),
      fc.nat(),
    )
    .map(([path, word, choice]) => ({
      path,
      origin:
        kind === "flag"
          ? Origin.cases.flag.make({ name: `--undeclared.${word}` })
          : kind === "env"
            ? Origin.cases.env.make({ name: `FABRIKA_UNDECLARED_${word.replaceAll("-", "_")}` })
            : Origin.cases.file.make({
                file:
                  choice % 3 === 0
                    ? `/${word}/fabrika.toml`
                    : choice % 3 === 1
                      ? `C:\\${word}\\fabrika.toml`
                      : `\\\\fixture\\${word}\\fabrika.toml`,
                line: 1 + (choice % 1000),
              }),
    }));

export const changeOrigin = (value: Input, fault: OriginFault): Input => ({
  ...value,
  settings: { ...value.settings, origins: { ...value.settings.origins, [fault.path]: fault.origin } },
});

export interface Input {
  readonly settings: Snapshot.Snapshot;
  readonly start: string;
  readonly build: string;
  readonly repo: { readonly revision: string } | null;
  readonly founding: { readonly person: string; readonly founder: string; readonly window: string | null };
  readonly name: string;
  readonly origin?: {
    readonly by: string;
    readonly for: string;
    readonly sentAt: string;
    readonly seen: number;
    readonly parent: string | null;
    readonly traceId: string;
  };
  readonly limits?: { readonly recordBytes: number };
  readonly mail?: { readonly grants: Readonly<Record<string, ReadonlyArray<string>>> };
  readonly starts?: ReadonlyArray<{ readonly source: string; readonly to: string }>;
}

// T843's test policy: every start fixture names it, so no test start leans on the declared default.
export const rateLimit = { limit: 100_000, window: 60_000 };

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
    values: {
      port: r.port,
      version: "0.0.0",
      gatewayLimit: rateLimit.limit,
      gatewayWindow: rateLimit.window,
      brainThrottle: Declarations.brainThrottle.default,
      brainPoll: Declarations.brainPoll.default,
      brainStartTimeout: Declarations.brainStartTimeout.default,
      brainStopTimeout: Declarations.brainStopTimeout.default,
      desktopLinkTtl: Declarations.desktopLinkTtl.default,
    },
    origins: {
      "instance.port": origin,
      "fabrika-version": Origin.cases.default.make({}),
      "gateway.limit": Origin.cases.flag.make({ name: "--gateway.limit" }),
      "gateway.window": Origin.cases.flag.make({ name: "--gateway.window" }),
      "desktop.brain-throttle": Origin.cases.default.make({}),
      "desktop.brain-poll": Origin.cases.default.make({}),
      "desktop.brain-start-timeout": Origin.cases.default.make({}),
      "desktop.brain-stop-timeout": Origin.cases.default.make({}),
      "desktop.link-ttl": Origin.cases.default.make({}),
    },
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
  readonly starts?: ReadonlyArray<{ readonly source: string; readonly to: string }>;
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
        ...(config.starts === undefined ? {} : { starts: config.starts }),
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
  const forms = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      for (const form of forms) {
        // A walk visits every string of every output after each move. One assertion per string
        // took two thirds of an entry flow law's time, so only a string that holds the form
        // reaches the assertion, which then fails with its usual message.
        if (value.includes(form)) {
          expect(value).not.toContain(form);
        }
      }
    } else if (typeof value === "object" && value !== null && !seen.has(value)) {
      seen.add(value);

      if (value instanceof ArrayBuffer) {
        visit(new TextDecoder().decode(value));
      }

      if (ArrayBuffer.isView(value)) {
        visit(new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
      }

      for (const [key, item] of Object.entries(value)) {
        visit(key);
        visit(item);
      }

      // Error messages and stacks are not enumerable, but a console can print them.
      if (value instanceof Error) {
        visit(value.message);
        visit(value.stack);
        visit(value.cause);
      }
    }
  };
  visit(output);
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
      fc.tuple(
        recipe,
        fc.record({
          by: fc.uuid(),
          for: fc.uuid(),
          sentAt: fc.integer({ min: 0, max: 2_000_000_000_000 }).map((ms) => new Date(ms).toISOString()),
          seen: fc.nat(),
          parent: fc.option(
            fc.integer({ min: 1, max: 1_000_000 }).map((id) => `in-process_${"0".repeat(26)}-${id}`),
            { nil: null },
          ),
          traceId: fc.uuid().map((id) => id.replaceAll("-", "")),
        }),
        fc.array(fc.nat(), { minLength: 12, maxLength: 50 }),
      ),
      ([first, origin, choices]) =>
        Effect.gen(function* () {
          const driver = yield* open;
          const inputs: Input[] = [{ ...(yield* input(first)), origin: { ...origin, seen: 0 } }];
          const saved = new Map<string, Saved>();

          for (const [index, choice] of choices.entries()) {
            const moves =
              saved.size === 0
                ? ["record", "lost", "fresh"]
                : ["record", "lost", "fresh", "repeat", "concurrent", "conflict", "read"];
            const move = moves[choice % moves.length];

            if (move === "fresh") {
              inputs.push({
                ...(yield* input({
                  ...first,
                  start: `${first.start}-${index}`,
                  port: choice % 2 === 0 ? first.port : (choice % 65535) + 1,
                })),
                origin: {
                  ...origin,
                  seen: Math.min(origin.seen, saved.size),
                  sentAt: DateTime.formatIso(DateTime.makeUnsafe(Date.parse(origin.sentAt) + index + 1)),
                },
              });
              continue;
            }

            const selected =
              move === "repeat" || move === "read" || move === "conflict"
                ? inputs.filter((value) => saved.has(value.start))
                : inputs;
            const current = Option.getOrThrow(Option.fromUndefinedOr(selected[choice % selected.length]));
            const before = driver.counts();
            const absent = !saved.has(current.start);

            if (move === "conflict") {
              const different = yield* input({ ...first, start: current.start, build: `${current.build}-different` });
              expect(Exit.isFailure(yield* Effect.exit(driver.record(different)))).toBe(true);
              expect(yield* driver.read(current.start)).toEqual(saved.get(current.start));

              // A retry cannot replace the original writer clock, parent, trace or reader position.
              for (const key of ["by", "for", "sentAt", "seen", "parent", "traceId"] as const) {
                const original = Option.getOrThrow(Option.fromUndefinedOr(current.origin));
                const changed = {
                  ...current,
                  origin: {
                    ...original,
                    [key]:
                      key === "seen"
                        ? original.seen + 1
                        : key === "parent"
                          ? original.parent === null
                            ? `in-process_${"0".repeat(26)}-1`
                            : null
                          : key === "traceId"
                            ? `${original.traceId[0] === "0" ? "1" : "0"}${original.traceId.slice(1)}`
                            : key === "sentAt"
                              ? DateTime.formatIso(DateTime.makeUnsafe(Date.parse(original.sentAt) + 1))
                              : `${original[key]}-different`,
                  },
                };
                expect(Exit.isFailure(yield* Effect.exit(driver.record(changed)))).toBe(true);
                expect(yield* driver.read(current.start)).toEqual(saved.get(current.start));
              }
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
                  entry: { ...current.origin, id: current.start, stream: `settings/instance/${current.start}` },
                });

                if (saved.has(current.start)) {
                  expect(receipt).toEqual(saved.get(current.start));
                } else {
                  saved.set(current.start, receipt);
                }
              }

              const after = driver.counts();
              const deliveries = move === "concurrent" ? 3 : move === "lost" ? 2 : 1;
              expect(after.reads - before.reads).toBe(deliveries + (absent ? 1 : 0));
              expect(after.appends - before.appends).toBe(absent ? 1 : 0);
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
