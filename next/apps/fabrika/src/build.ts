/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
// The app's build: its selected programs and its brain entry, handed to libfabrika's one-file build.
// Disk and paths go through Effect's FileSystem and Path, which the caller provides.
import { BuildError, build as buildOne, type Selection } from "@kampus/libfabrika/build";
import type { Row } from "@kampus/libfabrika/compiler";
import { Effect, FileSystem, Path } from "effect";
import { programs as selected } from "./table.ts";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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

export const build = Effect.fn("build.app")(function* (options: Options) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
