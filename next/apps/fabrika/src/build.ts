// The app's build: its selected programs, its brain entry and the tab's entry and stylesheets,
// handed to libfabrika's one-file build.
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

/** The tab's stylesheets in the order its page applies them: Manti's, then fabrika's tokens, then
 *  Tuval's own rules. */
const STYLES = ["@manti-ui/styles/index.css", "@kampus/fabrika-design/tokens.css", "@kampus/tuval/style.css"];

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
      Effect.mapError(() => new BuildError({ reason: "read" })),
    ));
  const styles = yield* Effect.forEach(STYLES, (module) => path.fromFileUrl(new URL(import.meta.resolve(module))), {
    concurrency: 1,
  }).pipe(Effect.mapError(() => new BuildError({ reason: "read" })));
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
