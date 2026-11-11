// T664, P38 slice 1, next/: L5 and L6 of the approved plan, for `settings/Sources.ts`. Written
// before the module. The oracle is the plan's precedence table: flag, env, repo, person, default.
//
// The shape these tests hold the module to:
// - A `Source` is `{ provider, origin(path) }`: an Effect ConfigProvider, and the Origin it names
//   for a leaf it supplied. `Sources.flags(record)` reads flag values keyed by dotted path,
//   `Sources.env(record)` reads an explicit environment as `FABRIKA_` plus the constant-cased path,
//   and `Sources.file(name, document)` reads a parsed TOML document, naming its file and line.
// - `Sources.resolve(group, { flags, env, repo, person })` gives `{ values, origins }`: the group's
//   decoded values, and per dotted path the Origin of the source that supplied it, or `default`.
//   A source that fails to read, or a winning value that fails its schema, fails the whole resolve.
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import * as Setting from "./Setting.ts";
import * as Sources from "./Sources.ts";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const DEFAULT = 18787;
const REPO = ".fabrika/fabrika.toml";
const PERSON = "~/.fabrika/fabrika.toml";

const declare = (path: string) =>
  Setting.make(path, { schema: Port, default: DEFAULT, doc: "A port.", scope: ["repo", "person"], reload: "restart" });

// Two settings, so a law also sees that each key picks its own winner.
const group = Setting.group({ alpha: declare("alpha.port"), beta: declare("beta-two.port") });

const KEYS = [
  { name: "alpha", path: ["alpha", "port"], env: "FABRIKA_ALPHA_PORT" },
  { name: "beta", path: ["beta-two", "port"], env: "FABRIKA_BETA_TWO_PORT" },
] as const;

const ORDER = ["flag", "env", "repo", "person"] as const;
type Slot = (typeof ORDER)[number];

const parse = (text: string) =>
  Effect.gen(function* () {
    const toml = yield* Toml;
    return yield* toml.parse(text);
  }).pipe(Effect.provide(TomlParser.layer));

/** A file holding the given keys, one table each, and the line each leaf sits on. */
const fileText = (values: ReadonlyArray<readonly [ReadonlyArray<string>, string]>) => {
  const lines = ["# a settings file"];
  const at: Record<string, number> = {};

  for (const [path, raw] of values) {
    lines.push("", `[${path[0]}]`, `${path[1]} = ${raw}`);
    at[path.join(".")] = lines.length;
  }

  return { text: `${lines.join("\n")}\n`, at };
};

type Choice = Partial<Record<Slot, string>>;

const build = (choices: ReadonlyArray<Choice>, noise: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const flags: Record<string, string> = {};
    const env: Record<string, string> = { ...noise };
    const repo: Array<readonly [ReadonlyArray<string>, string]> = [];
    const person: Array<readonly [ReadonlyArray<string>, string]> = [];
    KEYS.forEach((key, n) => {
      const c = choices[n]!;

      if (c.flag !== undefined) {
        flags[key.path.join(".")] = c.flag;
      }

      if (c.env !== undefined) {
        env[key.env] = c.env;
      }

      if (c.repo !== undefined) {
        repo.push([key.path, c.repo]);
      }

      if (c.person !== undefined) {
        person.push([key.path, c.person]);
      }
    });
    const repoFile = fileText(repo),
      personFile = fileText(person);
    const sources = {
      flags: Sources.flags(flags),
      env: Sources.env(env),
      repo: Sources.file(REPO, yield* parse(repoFile.text)),
      person: Sources.file(PERSON, yield* parse(personFile.text)),
    };
    return { sources, lines: { repo: repoFile.at, person: personFile.at } };
  });

const ports = fc.integer({ min: 1, max: 65535 });
// A pool where equal values are common: the default itself, one shared value, or any port.
const value = (shared: number) => fc.oneof(fc.constant(DEFAULT), fc.constant(shared), ports);

const choice = (shared: number) =>
  fc.record(
    { flag: value(shared), env: value(shared), repo: value(shared), person: value(shared) },
    { requiredKeys: [] },
  );

// Environment fields no setting declares, FABRIKA_ ones included: they are never a source.
const noise = fc.dictionary(
  fc.constantFrom("HOME", "PATH", "FABRIKA_HOME", "FABRIKA_ALPHA", "FABRIKA_PORT"),
  ports.map(String),
);

describe("L5, the highest present source wins per key, and so does its origin", () => {
  it("flag, env, repo, person, default, per key, even when the values are equal", async () => {
    await fc.assert(
      fc.asyncProperty(
        ports.chain((shared) => fc.tuple(choice(shared), choice(shared))),
        noise,
        async (picked, extra) => {
          const choices: Array<Choice> = picked.map((c) =>
            Object.fromEntries(Object.entries(c).map(([slot, v]) => [slot, String(v)])),
          );
          const { resolved, lines } = await Effect.runPromise(
            Effect.gen(function* () {
              const { sources, lines } = yield* build(choices, extra);
              const resolved = yield* Sources.resolve(group, sources);
              return { resolved, lines };
            }),
          );
          KEYS.forEach((key, n) => {
            const c = choices[n]!;
            const winner = ORDER.find((slot) => c[slot] !== undefined);
            const dotted = key.path.join(".");
            expect(resolved.values[key.name]).toBe(winner === undefined ? DEFAULT : Number(c[winner]));
            const want =
              winner === "repo" || winner === "person"
                ? { _tag: "file", file: winner === "repo" ? REPO : PERSON, line: lines[winner][dotted] }
                : winner === "env"
                  ? { _tag: "env", name: key.env }
                  : { _tag: winner ?? "default" };
            expect(resolved.origins[dotted]).toMatchObject(want);
          });
        },
      ),
      check,
    );
  });
});

const unreadable: Sources.Source = {
  provider: ConfigProvider.make(() =>
    Effect.fail(new ConfigProvider.SourceError({ message: "the source could not be read" })),
  ),
  origin: () => ({ _tag: "default" }),
};

describe("L6, a failed source or an invalid winner never falls through", () => {
  it("a read failure fails the resolve, whatever lower sources hold", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ORDER), ports, ports, async (failing, below, other) => {
        // Every source above the failing one is absent, and every one below holds a valid value.
        const lower = ORDER.slice(ORDER.indexOf(failing) + 1);
        const choices: Array<Choice> = [
          Object.fromEntries(lower.map((slot) => [slot, String(below)])),
          { person: String(other) },
        ];
        const exit = await Effect.runPromiseExit(
          Effect.gen(function* () {
            const { sources } = yield* build(choices, {});
            const slot = failing === "flag" ? "flags" : failing;
            return yield* Sources.resolve(group, { ...sources, [slot]: unreadable });
          }),
        );
        expect(Exit.isFailure(exit)).toBe(true);

        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.some((r) => r._tag === "Fail")).toBe(true);
        }
      }),
      check,
    );
  });

  it("an invalid value in the winning source fails, though a lower source holds a valid one", async () => {
    // An empty string is supplied, not absent: it is invalid too.
    const invalid = fc.oneof(
      fc.integer({ min: 65536, max: 2 ** 30 }).map(String),
      fc.integer({ min: -(2 ** 30), max: 0 }).map(String),
      fc.constantFrom('""', '"abc"', "1.5", "true"),
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ORDER), invalid, ports, async (winning, raw, below) => {
        const lower = ORDER.slice(ORDER.indexOf(winning) + 1);
        // A flag or the environment holds text; a file holds TOML.
        const text = winning === "flag" || winning === "env" ? (raw.startsWith('"') ? raw.slice(1, -1) : raw) : raw;
        const choices: Array<Choice> = [
          { [winning]: text, ...Object.fromEntries(lower.map((slot) => [slot, String(below)])) },
          {},
        ];
        const exit = await Effect.runPromiseExit(
          Effect.gen(function* () {
            const { sources } = yield* build(choices, {});
            return yield* Sources.resolve(group, sources);
          }),
        );
        expect(Exit.isFailure(exit), `${winning} = ${raw}`).toBe(true);
      }),
      check,
    );
  });
});
