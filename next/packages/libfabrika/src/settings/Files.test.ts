// T664, P38 slice 1, next/: L7, L8 and L10 of the approved plan, for `settings/Files.ts`. Written
// before the module. The oracle is the plan's scope table and settings.md S5.
//
// The shape these tests hold the module to:
// - `Files.validate(group, { repo, person }, { version })` checks both parsed files whole and
//   strictly, each `{ file, document }` with `file` the name a person reads. It reads the repo's
//   `fabrika-version` first and refuses a repo that needs a newer fabrika than `version` before any
//   other check. It succeeds with nothing, or fails with one `SettingsError`.
// - `SettingsError` has a `reason`, one of `version`, `syntax`, `unknown`, `scope`, `invalid` and
//   `read`, and the `message` a person reads, in settings.md S5's words.
// - L7's overriding flags are in `node/settings/Load.test.ts`: `validate` takes no flags at all.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import * as fc from "fast-check";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
const REPO = ".fabrika/fabrika.toml";
const PERSON = "~/.fabrika/fabrika.toml";

const validate = (repo: string, person: string, version: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const toml = yield* Toml;
      const files = {
        repo: { file: REPO, document: yield* toml.parse(repo) },
        person: { file: PERSON, document: yield* toml.parse(person) },
      };
      return yield* Files.validate(Declarations.all, files, { version });
    }).pipe(Effect.provide(TomlParser.layer)),
  );

/** The one typed failure of an exit, or undefined when it succeeded. */
const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return undefined;
  }

  const reason = exit.cause.reasons.find((r) => r._tag === "Fail");
  return reason?._tag === "Fail" && reason.error instanceof Files.SettingsError ? reason.error : "not a SettingsError";
};

// A word no setting uses, for unknown keys and tables.
const unknown = fc
  .stringMatching(/^[a-z][a-z0-9]{1,6}$/)
  .filter((w) => !["instance", "port", "fabrika", "pack", "ledger", "limits", "review"].includes(w));

const entry = fc.oneof(
  fc.record({ _tag: fc.constant("port" as const), port: fc.integer({ min: 1, max: 65535 }) }),
  fc.record({
    _tag: fc.constant("bad-port" as const),
    raw: fc.oneof(
      fc.integer({ min: 65536, max: 2 ** 30 }).map(String),
      fc.integer({ min: -(2 ** 30), max: 0 }).map(String),
      fc.constantFrom('"18800"', '""', "18800.5", "true", "[1]"),
    ),
  }),
  fc.record({ _tag: fc.constant("version" as const) }),
  fc.record({ _tag: fc.constant("sibling" as const), key: unknown, raw: fc.constantFrom("1", '"x"', "true") }),
  fc.record({ _tag: fc.constant("table" as const), name: unknown, empty: fc.boolean() }),
);

type Entry = typeof entry extends fc.Arbitrary<infer E> ? E : never;

/** A file holding the entries, top-level keys first, as TOML requires. */
const text = (entries: ReadonlyArray<Entry>) => {
  const top: Array<string> = [];
  const instance: Array<string> = [];
  const tables: Array<string> = [];
  let port = false;

  for (const e of entries) {
    if (e._tag === "version") {
      top.splice(0, top.length, 'fabrika-version = "1.0.0"');
    } else if ((e._tag === "port" || e._tag === "bad-port") && !port) {
      port = true;
      instance.push(`port = ${e._tag === "port" ? e.port : e.raw}`);
    } else if (e._tag === "sibling" && !instance.some((l) => l.startsWith(`${e.key} =`))) {
      instance.push(`${e.key} = ${e.raw}`);
    } else if (e._tag === "table" && !tables.includes(`[${e.name}]`)) {
      tables.push(`[${e.name}]`, ...(e.empty ? [] : ["key = 1"]));
    }
  }

  const lines = [...top, ...(instance.length > 0 ? ["[instance]", ...instance] : []), ...tables];
  return `${lines.join("\n")}\n`;
};

/** The plan's scope table: what a file may hold. Repeated keys keep only their first in `text`. */
const allowed = (entries: ReadonlyArray<Entry>, file: "repo" | "person") => {
  const firstPort = entries.find((e) => e._tag === "port" || e._tag === "bad-port");
  return entries.every((e) => {
    if (e._tag === "version") {
      return file === "repo";
    }

    if (e._tag === "port" || e._tag === "bad-port") {
      return file === "person" && (e !== firstPort || e._tag === "port");
    }

    return false;
  });
};

const scopeOnly = (entries: ReadonlyArray<Entry>, file: "repo" | "person") =>
  entries.length > 0 && entries.every((e) => (file === "repo" ? e._tag === "port" : e._tag === "version"));

describe("L7, every file is strict and whole, and a key outside its file's scope fails", () => {
  it("both files pass only when every key in each is declared, valid and in scope", async () => {
    const entries = fc.array(entry, { maxLength: 4 });
    await fc.assert(
      fc.asyncProperty(entries, entries, async (repo, person) => {
        const exit = await validate(text(repo), text(person), "1.2.3");
        const ok = allowed(repo, "repo") && allowed(person, "person");
        const error = failure(exit);
        expect(error instanceof Files.SettingsError, `repo:\n${text(repo)}\nperson:\n${text(person)}`).toBe(!ok);
        expect(Exit.isSuccess(exit)).toBe(ok);
        // A file whose only fault is a key the other file owns says so.
        const scope =
          (allowed(repo, "repo") && scopeOnly(person, "person")) ||
          (allowed(person, "person") && scopeOnly(repo, "repo"));
        expect(!scope || (error instanceof Files.SettingsError && error.reason === "scope")).toBe(true);
      }),
      check,
    );
  });
});

describe("L8, the version refusal comes first, and a supported version goes on", () => {
  const triple = fc.tuple(fc.nat(12), fc.nat(12), fc.nat(12));
  const companion = fc.constantFrom("none", "unknown-repo", "unknown-person", "bad-port", "scope");
  const COMPANION: Record<string, { repo: string; person: string }> = {
    none: { repo: "", person: "" },
    "unknown-repo": { repo: "[nope]\nkey = 1\n", person: "" },
    "unknown-person": { repo: "", person: "[instance]\nprot = 18800\n" },
    "bad-port": { repo: "", person: "[instance]\nport = 70000\n" },
    scope: { repo: "[instance]\nport = 18800\n", person: "" },
  };

  it("a repo needing a newer fabrika is refused before any other error; an older or equal one goes on", async () => {
    await fc.assert(
      fc.asyncProperty(
        triple,
        fc.oneof(
          triple,
          triple.map(([a, b, c]) => [a, b, c + 1] as const),
        ),
        companion,
        async (running, wanted, other) => {
          const newer = wanted.some((part, n) => part !== running[n])
            ? wanted[wanted.findIndex((part, n) => part !== running[n])]! >
              running[wanted.findIndex((part, n) => part !== running[n])]!
            : false;
          const repo = `fabrika-version = "${wanted.join(".")}"\n${COMPANION[other]!.repo}`;
          const exit = await validate(repo, COMPANION[other]!.person, running.join("."));

          const error = failure(exit);
          const got = error === undefined ? "started" : error instanceof Files.SettingsError ? error.reason : error;
          // Newer: the refusal. Otherwise the companion's own error, or a clean pass with none.
          expect(
            newer
              ? got === "version"
              : other === "none"
                ? got === "started"
                : got !== "version" && got !== "started" && got !== "not a SettingsError",
            `${got}`,
          ).toBe(true);
        },
      ),
      { ...check, examples: [[[0, 9, 0], [0, 10, 0], "unknown-repo"]] },
    );
  });
});

describe("L10, the three S5 messages, word for word", () => {
  // The person's file of settings.md "The design", cut to the keys slice 1 declares, so line 5 is
  // the port's line.
  const person = (line: string) =>
    ["# ~/.fabrika/fabrika.toml, the person's", "#:schema ./person.json", "", "[instance]", line, ""].join("\n");

  it("format: a port out of range names the file, line, key, value and the rule, and stops", async () => {
    // format: settings.md S5 gives these words, and a person reads them at start.
    const exit = await validate("", person("port = 70000"), "0.0.0");
    expect(failure(exit)).toMatchObject({
      reason: "invalid",
      message:
        "~/.fabrika/fabrika.toml, line 5: instance.port = 70000 is not a port.\n" +
        "  A port is a whole number from 1 to 65535. The instance did not start.",
    });
  });

  it("format: a typo names the key and offers the key it meant, and stops", async () => {
    // format: settings.md S5 gives these words, and a person reads them at start.
    const exit = await validate("", person("prot = 18800"), "0.0.0");
    expect(failure(exit)).toMatchObject({
      reason: "unknown",
      message:
        "~/.fabrika/fabrika.toml, line 5: there is no setting instance.prot. Did you mean instance.port?\n" +
        "  fabrika settings lists every setting. The instance did not start.",
    });
  });

  it("format: a person's setting in the repo's file says where it may be set, and stops", async () => {
    // format: settings.md S5 gives these words, and a person reads them at start.
    const exit = await validate("[instance]\nport = 18800\n", "", "0.0.0");
    expect(failure(exit)).toMatchObject({
      reason: "scope",
      message:
        ".fabrika/fabrika.toml, line 2: instance.port is a person's setting, so a repo's file may not set it.\n" +
        "  Set it in ~/.fabrika/fabrika.toml, as FABRIKA_INSTANCE_PORT, or with --instance.port. The instance did not start.",
    });
  });

  it("a typo in the repo's file is never offered a person-only key", async () => {
    // One edit away from `port`: each is a typo of a key the repo's file may not set.
    const typo = fc
      .tuple(fc.nat(3), fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), fc.constantFrom("swap", "add", "drop"))
      .map(([at, letter, edit]) => {
        const word = "port";
        return edit === "swap"
          ? word.slice(0, at) + letter + word.slice(at + 1)
          : edit === "add"
            ? word.slice(0, at) + letter + word.slice(at)
            : word.slice(0, at) + word.slice(at + 1);
      })
      .filter((w) => w !== "port" && w.length > 0);
    await fc.assert(
      fc.asyncProperty(typo, async (key) => {
        const exit = await validate(`[instance]\n${key} = 18800\n`, "", "0.0.0");
        const error = failure(exit);
        expect(error).toMatchObject({ reason: "unknown" });
        // The whole key, so the typo `instance.portt` itself is not counted as the offer.
        expect(error instanceof Files.SettingsError ? error.message : "").not.toMatch(/instance\.port(?![a-z0-9-])/);
        expect(error instanceof Files.SettingsError ? error.message : "").toContain(`instance.${key}`);
      }),
      check,
    );
  });
});
