// What a person reads about the declared settings: one row per declaration joined to a loaded
// snapshot, the version warnings for a repo's stated minimum, and the generated reference. Rows
// come from the declarations, never from the snapshot's keys, and defaults and releases are
// derived documentation, never extra settings facts.
import { Schema } from "effect";
import { newer } from "./Files.ts";
import type * as Setting from "./Setting.ts";
import type { Snapshot } from "./Snapshot.ts";
import { Origin } from "./Sources.ts";

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
export type Row = typeof Row.Type;

/** A key set explicitly that a fabrika older than the repo's minimum would not know. */
export interface Warning {
  readonly path: string;
  readonly since: string;
  readonly minimum: string;
}

const encoded = (d: Setting.Setting<unknown>): Schema.Json =>
  Schema.encodeSync(Schema.toCodecJson(d.schema))(d.default);

const sorted = <A>(group: Setting.Group<A>) => [...group.declarations].sort((a, b) => (a.path < b.path ? -1 : 1));

/** One row per declaration, by path, with the value and origin the snapshot holds at its path. */
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

/** The explicitly set keys newer than the repo's minimum. A default is never a warning. */
export const warnings = (rows: ReadonlyArray<Row>, minimum: string): Array<Warning> =>
  rows
    .filter((row) => row.origin._tag !== "default" && newer(row.since, minimum))
    .map((row) => ({ path: row.path, since: row.since, minimum }));

/** Words as Markdown shows them as written: every character Markdown reads is escaped. */
const escape = (text: string) => text.replace(/[\\`*_[\]<>#|&~+!-]/g, "\\$&").replace(/^(\s*\d+)\./gm, "$1\\.");

const code = (text: string) => `\`${text}\``;

/** The generated reference: a section per declaration, by path. */
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
        `| Reload | ${d.reload} |`,
        `| Since | ${d.since} |`,
        "",
      ].join("\n"),
    )
    .join("\n");
