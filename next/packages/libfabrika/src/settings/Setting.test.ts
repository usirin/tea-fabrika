// T664, P38 slice 1, next/: L1 to L4 of the approved plan, for `settings/Setting.ts` and
// `settings/Declarations.ts`. Written before the modules.
//
// The shape these tests hold the modules to:
// - `Setting.make(path, { schema, default, doc, scope, reload })` returns a `Setting`, which is the
//   Config it builds: Effect's own prototype, so `yield*` and `parse(provider)` work, plus its
//   `path`, `schema`, `default`, `doc`, `scope` and `reload`. The dotted path is split into
//   segments, so `"instance.port"` reads `{ instance: { port } }`, never a key named "instance.port".
//   An absent value is the default; a present value that fails the schema is a failure.
// - `Setting.group({ name: setting, ... })` is a Config of the record, with `declarations` beside it.
// - `Declarations.port` is `instance.port`; `Declarations.all` is the group of slice 1's settings.
// - T730, P38 slice 2, L10: `since`, the release that introduced the key, is a required string
//   option of `Setting.make` and a field of `Setting`. It is a release fact, not a setting.
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import * as Declarations from "./Declarations.ts";
import * as Setting from "./Setting.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;
const check = { seed: SEED, numRuns: RUNS };

it.effect.prop(
  "T843 declarations: provider values reach the group and missing values use the declaration (50 runs)",
  {
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    window: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
  },
  ({ limit, window }) =>
    Effect.gen(function* () {
      const values = yield* Declarations.all.parse(ConfigProvider.fromUnknown({ gateway: { limit, window } }));
      expect(values).toMatchObject({ gatewayLimit: limit, gatewayWindow: window });
      const defaults = yield* Declarations.all.parse(ConfigProvider.fromUnknown({}));
      expect(defaults.gatewayLimit).toBe(Declarations.gatewayLimit.default);
      expect(defaults.gatewayWindow).toBe(Declarations.gatewayWindow.default);

      for (const setting of [Declarations.gatewayLimit, Declarations.gatewayWindow]) {
        expect(setting.scope).toEqual(["person"]);
        expect(setting.reload).toBe("restart");
      }
    }),
  { arbitrary: { seed: SEED, runs: 50 } },
);

it("T843 declaration schemas reject disabled, fractional, nonfinite and unsafe budgets (50 runs)", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ max: 0 }),
        fc.double({ min: 0.01, max: 1e6, noNaN: true }).filter((n) => !Number.isInteger(n)),
        fc.constantFrom(Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1),
      ),
      (bad) => {
        expect(Schema.is(Declarations.gatewayLimit.schema)(bad)).toBe(false);
        expect(Schema.is(Declarations.gatewayWindow.schema)(bad)).toBe(false);
      },
    ),
    { seed: SEED, numRuns: 50 },
  );
});

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const DEFAULT = 18787;

const declare = (path: string) =>
  Setting.make(path, {
    schema: Port,
    default: DEFAULT,
    doc: "A generated port.",
    scope: ["person"],
    reload: "restart",
    since: "0.0.0",
  });

// A declaration path segment, as settings.md "Key spelling and paths" writes keys: short words,
// kebab-case when one word does not fit. A segment never holds a dot.
const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}(-[a-z0-9]{1,4})?$/);
const segments = fc.array(segment, { minLength: 1, maxLength: 4 });
const ports = fc.integer({ min: 1, max: 65535 });

/** `value` placed at `path` in nested tables. */
const nest = (path: ReadonlyArray<string>, value: unknown): unknown =>
  path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);

/** What a provider holds at the setting's path: nothing, a valid port, or a value that must fail. */
const supplied = fc.oneof(
  fc.constant({ _tag: "absent" as const }),
  ports.map((port) => ({ _tag: "valid" as const, value: port as unknown, expected: port })),
  fc
    .oneof(
      fc.integer({ min: 65536, max: 2 ** 31 }),
      fc.integer({ min: -(2 ** 31), max: 0 }),
      fc.double({ min: 1.5, max: 6e4, noNaN: true }).filter((n) => !Number.isInteger(n)),
      fc.constant(""),
      fc.constant("   "),
      fc.constant(true),
      fc.stringMatching(/^[a-z]{1,8}$/),
    )
    .map((value) => ({ _tag: "invalid" as const, value: value as unknown })),
);

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect);

describe("L1, a Setting remains a Config", () => {
  it("vector: a declared setting is a Config value, with its declaration beside it", () => {
    // vector: one declaration's own fields, read back; the law below generates the behavior.
    expect(Config.isConfig(Declarations.port)).toBe(true);
    expect(Declarations.port.path).toBe("instance.port");
    expect(Declarations.port.scope).toEqual(["person"]);
    expect(Declarations.port.reload).toBe("restart");
    expect(Declarations.port.default).toBe(DEFAULT);
  });

  it("yield* under a provided ConfigProvider and parse(provider) agree, for every path and source", async () => {
    await fc.assert(
      fc.asyncProperty(segments, supplied, async (path, value) => {
        const setting = declare(path.join("."));
        expect(Config.isConfig(setting)).toBe(true);
        const provider = ConfigProvider.fromUnknown(value._tag === "absent" ? {} : nest(path, value.value));
        const parsed = await run(setting.parse(provider));
        const yielded = await run(
          Effect.gen(function* () {
            return yield* setting;
          }).pipe(Effect.provide(ConfigProvider.layer(provider))),
        );
        expect(Exit.isSuccess(yielded)).toBe(Exit.isSuccess(parsed));

        if (Exit.isSuccess(parsed) && Exit.isSuccess(yielded)) {
          expect(yielded.value).toBe(parsed.value);
        }
      }),
      check,
    );
  });
});

describe("L2, metadata is required, scope is nonempty, and the decoded type is kept", () => {
  // oxlint-disable-next-line fabrika/law-shape -- a type law: its @ts-expect-error lines are the check, so it is neither a property nor an example
  it("type: a declaration missing metadata or with an empty scope does not compile", () => {
    // Compiled by `pnpm typecheck`, never run: each call below must be refused by the compiler.
    const refused = () => [
      // @ts-expect-error scope is required.
      Setting.make("a.b", { schema: Port, default: 1, doc: "d", reload: "restart", since: "0.0.0" }),
      // @ts-expect-error scope cannot be empty.
      Setting.make("a.b", { schema: Port, default: 1, doc: "d", scope: [], reload: "restart", since: "0.0.0" }),
      // @ts-expect-error default is required.
      Setting.make("a.b", { schema: Port, doc: "d", scope: ["person"], reload: "restart", since: "0.0.0" }),
      // @ts-expect-error doc is required.
      Setting.make("a.b", { schema: Port, default: 1, scope: ["person"], reload: "restart", since: "0.0.0" }),
      // @ts-expect-error reload is required.
      Setting.make("a.b", { schema: Port, default: 1, doc: "d", scope: ["person"], since: "0.0.0" }),
      Setting.make("a.b", {
        schema: Port,
        // @ts-expect-error a default must have the schema's type.
        default: "1",
        doc: "d",
        scope: ["person"],
        reload: "restart",
        since: "0.0.0",
      }),
      // @ts-expect-error a scope names only the two files.
      Setting.make("a.b", { schema: Port, default: 1, doc: "d", scope: ["cloud"], reload: "restart", since: "0.0.0" }),
      // @ts-expect-error reload is live or restart.
      Setting.make("a.b", { schema: Port, default: 1, doc: "d", scope: ["person"], reload: "never", since: "0.0.0" }),
      // @ts-expect-error since is required (T730 L10): the release that introduced the key.
      Setting.make("a.b", { schema: Port, default: 1, doc: "d", scope: ["person"], reload: "restart" }),
      // @ts-expect-error since is a release, never a number (T730 L10).
      Setting.make("a.b", { schema: Port, default: 1, doc: "d", scope: ["person"], reload: "restart", since: 1 }),
    ];
    expect(typeof refused).toBe("function");
  });

  // oxlint-disable-next-line fabrika/law-shape -- a type law: its expectTypeOf lines are the check, so it is neither a property nor an example
  it("type: the decoded value, the default and the scope keep their inferred types", () => {
    expectTypeOf<Effect.Success<typeof Declarations.port>>().toEqualTypeOf<number>();
    expectTypeOf(Declarations.port.default).toEqualTypeOf<number>();
    expectTypeOf(Declarations.port.scope).toEqualTypeOf<readonly ["person"]>();
    expectTypeOf(Declarations.port).toExtend<Config.Config<number>>();
    const repo = Setting.make("a.b", {
      schema: Schema.String,
      default: "x",
      doc: "d",
      scope: ["repo", "person"],
      reload: "live",
      since: "1.2.3",
    });
    expectTypeOf(repo.scope).toEqualTypeOf<readonly ["repo", "person"]>();
    // T730 L10: the release metadata is on the declaration, typed, and the value type stays inferred.
    expectTypeOf(repo.since).toEqualTypeOf<string>();
    expectTypeOf(Declarations.port.since).toEqualTypeOf<string>();
    expectTypeOf(Declarations.all.declarations[0]!.since).toEqualTypeOf<string>();
    expectTypeOf(Declarations.version.default).toEqualTypeOf<string>();
    expectTypeOf<Effect.Success<typeof repo>>().toEqualTypeOf<string>();
    expectTypeOf<Effect.Success<typeof Declarations.all>>().toExtend<{ readonly port: number }>();
  });
});

describe("L3, absence gives the default, and an invalid present value never does", () => {
  it("missing files and omitted keys give the declared default; a present invalid value fails", async () => {
    await fc.assert(
      fc.asyncProperty(segments, supplied, fc.boolean(), async (path, value, emptyFile) => {
        const setting = declare(path.join("."));
        const root = value._tag === "absent" ? (emptyFile ? {} : nest(path.slice(0, -1), {})) : nest(path, value.value);
        // An explicit empty string is supplied, not absent: it must fail, never become the default.
        const exit = await run(setting.parse(ConfigProvider.fromUnknown(root, { preserveEmptyStrings: true })));

        const want = value._tag === "absent" ? DEFAULT : value._tag === "valid" ? value.expected : "a failure";
        expect(Exit.isSuccess(exit) ? exit.value : "a failure").toBe(want);
      }),
      check,
    );
  });

  it("vector: an empty environment and no files give every declared default", async () => {
    // vector: settings.md S3, "an empty file works": the empty provider decodes to every default.
    const exit = await run(Declarations.all.parse(ConfigProvider.fromUnknown({})));
    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) {
      expect(Object.values(exit.value)).toEqual(Declarations.all.declarations.map((d) => d.default));
    }

    expect(Declarations.all.declarations.map((d) => d.path)).toContain("instance.port");
  });
});

describe("L4, a dotted declaration path reaches the nested value exactly once", () => {
  it("the nested value is read, and a literal dotted key is never mistaken for it", async () => {
    await fc.assert(
      fc.asyncProperty(segments, ports, ports, async (path, nested, literal) => {
        fc.pre(nested !== literal && nested !== DEFAULT && literal !== DEFAULT);
        const dotted = path.join(".");
        const setting = declare(dotted);
        expect(setting.path).toBe(dotted);
        // Both spellings at once: the nested tables and one key whose own name holds the dots. A
        // one-segment path has no dots, so both spellings are the one key.
        const both = path.length > 1 ? { ...(nest(path, nested) as object), [dotted]: literal } : nest(path, nested);
        expect(await run(setting.parse(ConfigProvider.fromUnknown(both)))).toEqual(Exit.succeed(nested));

        // The literal key alone is an unknown key to this setting, so it takes its default.
        if (path.length > 1) {
          const only = await run(setting.parse(ConfigProvider.fromUnknown({ [dotted]: literal })));
          expect(only).toEqual(Exit.succeed(DEFAULT));
        }
      }),
      check,
    );
  });

  it("a group reads each declaration at its own path, once, and keeps the declarations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(segments, { minLength: 1, maxLength: 4, selector: (p) => p[0] }),
        ports,
        async (paths, base) => {
          const settings = Object.fromEntries(paths.map((p, n) => [`s${n}`, declare(p.join("."))]));
          const group = Setting.group(settings);
          expect(group.declarations.map((d) => d.path)).toEqual(paths.map((p) => p.join(".")));
          const root = Object.assign({}, ...paths.map((p, n) => nest(p, ((base + n) % 65535) + 1)));
          const exit = await run(group.parse(ConfigProvider.fromUnknown(root)));
          expect(exit).toEqual(
            Exit.succeed(Object.fromEntries(paths.map((_, n) => [`s${n}`, ((base + n) % 65535) + 1]))),
          );
        },
      ),
      check,
    );
  });
});

it("scenario: T753 L1 a group's named declarations keep their decoded types", () => {
  // scenario: the lead's compiler checks these assertions; no runtime shape check replaces them.
  const group = Setting.group({
    count: declare("a.count"),
    label: Setting.make("a.label", {
      schema: Schema.String,
      default: "x",
      doc: "A label.",
      scope: ["repo"],
      reload: "restart",
      since: "1.2.3",
    }),
  });
  expectTypeOf(group.settings.count.default).toEqualTypeOf<number>();
  expectTypeOf(group.settings.label.default).toEqualTypeOf<string>();
  expectTypeOf(group.settings.count.schema.Type).toEqualTypeOf<number>();
  expectTypeOf(group.settings.label.schema.Type).toEqualTypeOf<string>();
});
