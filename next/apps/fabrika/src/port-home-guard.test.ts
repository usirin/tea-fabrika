// T502 S1, next/. The law for the guard law 5's writer runs before it saves a home
// (port-home.test-support.ts, the plan's Files table, the lead's amendment of 2026-11-13). Runs on
// Node, with no workerd.
//
// For any small generated home, with or without one planted machine path, the guard reports exactly
// the planted file and place, and nothing when there is no plant. A plant is one generated root, in
// its plain, JSON-escaped or `file://` form, with a generated tail, put in a text file, a nested JSON
// value, a short SQLite cell, a blob cell or a cell longer than a page, which SQLite splits across
// overflow pages. The roots are generated names under a temp folder of the test's own, never a real
// machine path. The guard also leaves the folder it reads byte for byte as it was.
// edge: Effect SQL has no plain synchronous open, and the test writes SQLite files with chosen pages
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, FileSystem, Path, Schema } from "effect";
import { type Hit, machinePaths, Place } from "./port-home.test-support.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const PAGE = 4096; // SQLite's default page size: a longer cell spills onto overflow pages

const Word = Schema.String.check(Schema.isPattern(/^[a-z]{3,10}$/));
const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

const few = <S extends Schema.Top>(item: S, most: number) =>
  Schema.Array(item).check(Schema.isMinLength(1), Schema.isMaxLength(most));

const HomeInput = Schema.Struct({
  roots: Schema.Struct({ home: Word, temp: Word, repo: Word }),
  // A character that makes a root's JSON-escaped or URL form differ from its plain form.
  spice: Schema.Literals(["", " sp", '"q', "\\b", "%25"]),
  texts: few(Schema.Struct({ name: Word, words: Schema.Array(Word).check(Schema.isMaxLength(20)) }), 3),
  jsons: few(Schema.Struct({ name: Word, keys: few(Word, 4), value: Word }), 3),
  dbs: few(
    Schema.Struct({ name: Word, tables: few(Schema.Struct({ name: Word, rows: few(Word, 4), long: Pick }), 3) }),
    2,
  ),
  plant: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literals(["home", "temp", "repo"]),
      tail: few(Word, 4),
      form: Schema.Literals(["plain", "json", "url"]),
      place: Schema.Literals(["text", "json", "cell", "overflow", "blob"]),
      pick: Pick,
      at: Pick,
    }),
  ),
});

type Input = typeof HomeInput.Type;

const encoder = new TextEncoder();

/** Writes the generated home under `home` with its roots under `base`, and answers the roots and
 *  the one hit the plant must make, worked out here from where the plant was put. */
const writeHome = Effect.fnUntraced(function* (home: string, base: string, input: Input) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const roots = {
    home: path.join(base, `home-${input.roots.home}${input.spice}`),
    temp: path.join(base, `temp-${input.roots.temp}${input.spice}`),
    repo: path.join(base, `repo-${input.roots.repo}${input.spice}`),
  };
  const plant = input.plant;
  const planted =
    plant === null ? null : { root: roots[plant.kind], full: [roots[plant.kind], ...plant.tail].join("/") };
  // The plant as it lands in a text or a cell, in its generated form.
  const text =
    plant === null || planted === null
      ? ""
      : plant.form === "plain"
        ? planted.full
        : plant.form === "json"
          ? JSON.stringify(planted.full).slice(1, -1)
          : (yield* path.toFileUrl(planted.full)).href;
  let expected: typeof Hit.Type | null = null;

  for (const [n, file] of input.texts.entries()) {
    const name = `${file.name}-${n}.txt`;
    let words = file.words.join(" ");

    if (plant !== null && planted !== null && plant.place === "text" && plant.pick % input.texts.length === n) {
      const before = file.words.slice(0, plant.at % (file.words.length + 1));
      const prefix = before.length === 0 ? "" : `${before.join(" ")} `;
      words = [...before, text, ...file.words.slice(before.length)].join(" ");
      expected = {
        file: name,
        place: Place.cases.byte.make({ offset: encoder.encode(prefix).length }),
        root: planted.root,
      };
    }

    yield* fs.writeFileString(path.join(home, name), words);
  }

  for (const [n, file] of input.jsons.entries()) {
    const name = `${file.name}-${n}.json`;
    const hit = plant !== null && planted !== null && plant.place === "json" && plant.pick % input.jsons.length === n;
    // A JSON file holds the path as a value, so its file holds it JSON-escaped; a URL stays a URL.
    const value = hit ? (plant.form === "url" ? text : planted.full) : file.value;
    const body = JSON.stringify(
      file.keys.reduceRight<unknown>((inner, key) => ({ [key]: inner, _note: file.value }), value),
      null,
      2,
    );

    if (hit) {
      const at = body.indexOf(JSON.stringify(value).slice(1, -1));
      expected = {
        file: name,
        place: Place.cases.byte.make({ offset: encoder.encode(body.slice(0, at)).length }),
        root: planted.root,
      };
    }

    yield* fs.writeFileString(path.join(home, name), body);
  }

  for (const [n, file] of input.dbs.entries()) {
    const name = `${file.name}-${n}.sqlite`;
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(path.join(home, name))),
      (open) => Effect.sync(() => open.close()),
    );
    const sqlite = plant !== null && plant.place !== "text" && plant.place !== "json";
    const here = sqlite && plant.pick % input.dbs.length === n;

    for (const [t, table] of file.tables.entries()) {
      const tableName = `t${t}_${table.name}`;
      db.exec(`CREATE TABLE "${tableName}" (note TEXT, body TEXT, data BLOB)`);
      const insert = db.prepare(`INSERT INTO "${tableName}" (note, body, data) VALUES (?, ?, ?)`);

      for (const [row, word] of table.rows.entries()) {
        const long = `${word} `.repeat(Math.ceil((PAGE + table.long * 8) / (word.length + 1)));
        const target =
          here && plant !== null && planted !== null && plant.at % file.tables.length === t
            ? plant.at % table.rows.length === row
            : false;
        const cut = ((plant?.at ?? 0) * 37) % long.length;
        const note = target && plant?.place === "cell" ? `${word} ${text}` : word;
        const body = target && plant?.place === "overflow" ? `${long.slice(0, cut)}${text}${long.slice(cut)}` : long;
        const data = encoder.encode(target && plant?.place === "blob" ? `${word} ${text}` : word);
        insert.run(note, body, data);

        if (target && plant !== null && planted !== null) {
          const column = plant.place === "cell" ? "note" : plant.place === "overflow" ? "body" : "data";
          expected = {
            file: name,
            place: Place.cases.cell.make({ table: tableName, row, column }),
            root: planted.root,
          };
        }
      }
    }
  }

  return { roots: Object.values(roots), expected };
});

/** Every file's name and bytes, to see the guard changed nothing. */
const snapshot = Effect.fnUntraced(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = (yield* fs.readDirectory(folder, { recursive: true })).sort();
  return yield* Effect.forEach(
    files,
    (file) =>
      fs.readFile(path.join(folder, file)).pipe(Effect.map((bytes) => [file, Array.from(bytes).join(",")] as const)),
    { concurrency: 1 },
  );
});

describe("T502 S1, the writer's guard finds every machine path in a home, next/", () => {
  it.effect.prop(
    "the guard reports exactly the planted file and place, sqlite cells included, and nothing without a plant",
    { input: Arbitrary.schema(HomeInput) },
    ({ input }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "port-guard-home-" });
        const base = yield* fs.makeTempDirectoryScoped({ prefix: "port-guard-roots-" });
        const { roots, expected } = yield* Effect.scoped(writeHome(home, base, input));
        expect(expected === null, "a plant has a place to go").toBe(input.plant === null);
        const before = yield* snapshot(home);
        const hits = yield* machinePaths(home, roots);
        expect(hits).toEqual(expected === null ? [] : [expected]);
        expect(yield* snapshot(home), "the guard leaves the folder it reads as it was").toEqual(before);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});
