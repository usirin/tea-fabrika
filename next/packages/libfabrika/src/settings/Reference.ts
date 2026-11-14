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
/**
 * What a person reads about the declared settings: one row per declaration joined to a loaded snapshot, the version warnings for a repo's stated minimum, and the generated reference.
 *
 * **Details**
 *
 * Rows come from the declarations, never from the snapshot's keys. Defaults and releases are derived documentation, never extra settings facts.
 *
 * @stability unstable
 */
import { Schema } from "effect";
import * as Codec from "./Codec.ts";
import { newer } from "./Files.ts";
import type * as Setting from "./Setting.ts";
import type { Snapshot } from "./Snapshot.ts";
import { Origin } from "./Sources.ts";

/**
 * Schema for one report row: a declaration's facts beside the value and origin a snapshot holds for it.
 *
 * **Details**
 *
 * `value` and `default` are JSON-encoded. `scope`, `reload` and `since` copy the declaration.
 *
 * @stability unstable
 * @category models
 */
export const Row = Schema.Struct({
  path: Schema.String,
  value: Schema.Json,
  origin: Origin,
  default: Schema.Json,
  doc: Schema.String,
  scope: Schema.Array(Schema.Literals(["person", "repo"])),
  reload: Schema.Literals(["live", "restart"]),
  since: Schema.String,
});
/**
 * The decoded type of `Row`.
 *
 * @stability unstable
 * @category models
 */
export type Row = typeof Row.Type;

/**
 * A key set explicitly that was introduced after the repo's stated minimum fabrika release.
 *
 * **Details**
 *
 * `since` is the release that introduced the key, and `minimum` is the repo's stated minimum.
 *
 * @stability unstable
 * @category models
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export interface Warning {
  readonly path: string;
  readonly since: string;
  readonly minimum: string;
}

const encoded = (d: Setting.Setting<unknown>): Schema.Json =>
  Schema.encodeSync(Schema.toCodecJson(d.schema))(d.default);

const sorted = <A>(group: Setting.Group<A>) => [...group.declarations].sort((a, b) => (a.path < b.path ? -1 : 1));

/**
 * Builds one row per declaration in the group, sorted by path.
 *
 * **Details**
 *
 * A row takes its value and origin from the snapshot at the declaration's path. When the snapshot holds none, the row shows the encoded default with the default origin.
 *
 * @stability unstable
 * @category constructors
 */
export const rows = <A>(group: Setting.Group<A>, snapshot: Snapshot): Array<Row> =>
  sorted(group).map((d) => ({
    path: d.path,
    value: snapshot.values[d.path] ?? encoded(d),
    origin: snapshot.origins[d.path] ?? Origin.cases.default.make({}),
    default: encoded(d),
    doc: d.doc,
    scope: d.scope,
    reload: d.reload,
    since: d.since,
  }));

/**
 * Returns a warning for each explicitly set row whose `since` release is newer than `minimum`.
 *
 * **Gotchas**
 *
 * A row whose origin is the default never warns: no source set the key.
 *
 * @stability unstable
 * @category combinators
 */
export const warnings = (rows: ReadonlyArray<Row>, minimum: string): Array<Warning> =>
  rows
    .filter((row) => row.origin._tag !== "default" && newer(row.since, minimum))
    .map((row) => ({ path: row.path, since: row.since, minimum }));

/** Words as Markdown shows them as written: every character Markdown reads is escaped. */
const escape = (text: string) => text.replace(/[\\`*_[\]<>#|&~+!-]/g, "\\$&").replace(/^(\s*\d+)\./gm, "$1\\.");

const code = (text: string) => `\`${text}\``;

/**
 * Renders the settings reference as Markdown: one section per declaration, sorted by path.
 *
 * **Details**
 *
 * Each section holds the escaped doc and a table of scope, environment name, flag, encoded default, reload and release. A `text` setting adds its file default and a note on the text spelling a file takes.
 *
 * @stability unstable
 * @category constructors
 */
export const markdown = <A>(group: Setting.Group<A>) =>
  sorted(group)
    .map((d) =>
      [
        `### ${code(d.path)}`,
        "",
        escape(d.doc),
        "",
        "| Field | Value |",
        "|---|---|",
        `| Scope | ${d.scope.join(", ")} |`,
        `| Environment | ${code(d.env)} |`,
        `| Flag | ${code(`--${d.path}`)} |`,
        `| Default | ${code(JSON.stringify(encoded(d)))} |`,
        ...(d.format === "text"
          ? [
              `| File default | ${code(JSON.stringify(Schema.encodeSync(Codec.file(d))(d.default)))} |`,
              "| File input | Text, using the spelling shown by the file default. Recorded values use JSON. |",
            ]
          : []),
        `| Reload | ${d.reload} |`,
        `| Since | ${d.since} |`,
        "",
      ].join("\n"),
    )
    .join("\n");
