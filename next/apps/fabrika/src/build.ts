/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
// The app's build: its selected programs and its brain entry, handed to libfabrika's one-file build.
// Disk and paths go through Effect's FileSystem and Path, which the caller provides.
import { BuildError, build as buildOne, type Selection } from "@kampus/libfabrika/build";
import type { Row } from "@kampus/libfabrika/compiler";
import { Effect, FileSystem, Path } from "effect";
import { programs as selected } from "./table.ts";

export type { Built } from "@kampus/libfabrika/build";

const STYLES = ["@manti-ui/styles/index.css", "@kampus/fabrika-design/tokens.css", "@kampus/tuval/style.css"];

type Options = {
  readonly out: string;
  /** `.tsx` files the Compiler checks. Every `.tsx` file under `next/` by default. */
  readonly files?: ReadonlyArray<string>;
  readonly ledger?: ReadonlyArray<Row>;
  /** More programs by name, each a module that exports `program`. */
  readonly programs?: Readonly<Record<string, string>>;
  readonly chaos?: boolean;
};

export const build = Effect.fn("build.app")(function* (options: Options) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const APP = path.resolve(import.meta.dirname, ".."),
    ROOT = path.resolve(APP, "../../..");
  const extra = options.programs ?? {};
  const programs: ReadonlyArray<Selection> = [
    ...selected.filter((p) => !Object.hasOwn(extra, p.name)),
    ...Object.entries(extra).map(([name, module]) => ({ name, package: module, export: "program" })),
  ];
  const files =
    options.files ??
    (yield* fs.glob("next/**/*.tsx", { root: ROOT }).pipe(
      Effect.map((found) => found.filter((p) => !p.includes("node_modules") && !p.includes(".test."))),
      Effect.mapError((cause) => new BuildError({ reason: "read", cause })),
    ));
  const styles = yield* Effect.forEach(STYLES, (module) => path.fromFileUrl(new URL(import.meta.resolve(module))), {
    concurrency: 1,
  }).pipe(Effect.mapError((cause) => new BuildError({ reason: "read", cause })));
  return yield* buildOne({
    out: options.out,
    root: ROOT,
    entry: path.join(APP, "src/brain.ts"),
    programs,
    files,
    ...(options.ledger === undefined ? {} : { ledger: options.ledger }),
    chaos: options.chaos ?? false,
    tab: { entry: path.join(APP, "src/entry/browser.tsx"), styles },
  });
});
