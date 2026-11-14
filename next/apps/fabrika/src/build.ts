/**
 * The app's build: its selected programs and its brain entry, handed to libfabrika's one-file build.
 * Disk and paths go through Effect's FileSystem and Path, which the caller provides.
 *
 * @stability unstable
 */
import { BuildError, build as buildOne, type Selection } from "@kampus/libfabrika/build";
import type { Row } from "@kampus/libfabrika/compiler";
import { Effect, FileSystem, Path } from "effect";
import { programs as selected } from "./table.ts";

export type {
  /**
   * What a finished build answers: the published brain file and its hash, and the tables it carries.
   *
   * @stability unstable
   * @category models
   */
  Built,
} from "@kampus/libfabrika/build";

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

/**
 * Builds the app's brain file into `out`: the table's programs, with `programs` adding or replacing
 * programs by name, the tab with its stylesheets, and the brain entry `src/brain.ts`.
 *
 * **Details**
 *
 * The Compiler checks `files`, or by default every `.tsx` file under `next/` outside
 * `node_modules` and tests. It answers libfabrika's `Built` plus `watch`, the root, entry and
 * programs a watcher rebuilds from. A failed file search or stylesheet lookup fails with a
 * `BuildError` of reason `read`, and the build's own failures pass through.
 *
 * @stability unstable
 * @category constructors
 */
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
  const entry = path.join(APP, "src/brain.ts");
  const built = yield* buildOne({
    out: options.out,
    root: ROOT,
    entry,
    programs,
    files,
    ...(options.ledger === undefined ? {} : { ledger: options.ledger }),
    chaos: options.chaos ?? false,
    tab: { entry: path.join(APP, "src/entry/browser.tsx"), styles },
  });
  return { ...built, watch: { root: ROOT, entry, programs } };
});
