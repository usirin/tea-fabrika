// The app's build: its selected programs and its brain entry, handed to libfabrika's one-file build.
// Disk and paths go through Effect's FileSystem and Path, which the caller provides.
import { BuildError, build as buildOne, type Selection } from "@kampus/libfabrika/build";
import type { Row } from "@kampus/libfabrika/compiler";
import { Effect, FileSystem, Path } from "effect";
import { programs as selected } from "./table.ts";

export type { Built } from "@kampus/libfabrika/build";

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
  return yield* buildOne({
    out: options.out,
    root: ROOT,
    entry: path.join(APP, "src/brain.ts"),
    programs,
    files,
    ...(options.ledger === undefined ? {} : { ledger: options.ledger }),
    chaos: options.chaos ?? false,
  });
});
