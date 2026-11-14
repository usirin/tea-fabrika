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
import { Ci, type CodeHost } from "@kampus/libfabrika";
import { Array as Arr, Schema } from "effect";
import picomatch from "picomatch/posix.js";

export const Kind = Schema.Literals(["rows", "docs", "code"]);

const compiles = (glob: string) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  try {
    picomatch(glob);
    return true;
  } catch {
    return false;
  }
};

export const Glob = Schema.NonEmptyString.check(
  Schema.makeFilter((g) => (!g.startsWith("!") && g.length <= 65_536 && compiles(g)) || "not a glob"),
);

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const Kinds = Schema.Struct({ rows: Schema.Array(Glob), docs: Schema.Array(Glob) });

export const kind = (
  kinds: typeof Kinds.Type,
  paths: ReadonlyArray<typeof CodeHost.Path.Type> | null,
): typeof Kind.Type => {
  if (paths === null || paths.length === 0) {
    return "code";
  }

  const rows = kinds.rows.map((g) => picomatch(g));
  const docs = kinds.docs.map((g) => picomatch(g));
  let heaviest: typeof Kind.Type = "rows";

  for (const path of paths) {
    if (docs.some((matches) => matches(path))) {
      heaviest = "docs";
    } else if (!rows.some((matches) => matches(path))) {
      return "code";
    }
  }

  return heaviest;
};

export const Check = Schema.Struct({ name: Schema.NonEmptyString, source: Schema.optionalKey(Schema.NonEmptyString) });

export const Plan = Schema.Struct({ rows: Schema.Array(Check), docs: Schema.Array(Check), code: Schema.Array(Check) });

export const checksFor = (plan: typeof Plan.Type, kind: typeof Kind.Type) => plan[kind];

export const Verdict = Schema.TaggedUnion({
  green: { runs: Schema.NonEmptyArray(Ci.CheckRun) },
  red: { runs: Schema.NonEmptyArray(Ci.CheckRun) },
  pending: { checks: Schema.NonEmptyArray(Check) },
  lost: { runs: Schema.NonEmptyArray(Ci.CheckRun) },
});

export const verdict = (
  checks: Arr.NonEmptyReadonlyArray<typeof Check.Type>,
  current: typeof Ci.Checks.Type,
): typeof Verdict.Type => {
  const asked = Arr.dedupeWith(checks, (a, b) => a.name === b.name && a.source === b.source);
  const matches = (c: typeof Check.Type, r: typeof Ci.CheckRun.Type) =>
    c.name === r.name && (c.source === undefined || c.source === r.source);
  const selected = current.filter((r) => asked.some((c) => matches(c, r)));
  const red = selected.filter(
    (r) => r.status._tag === "done" && (r.status.conclusion === "failure" || r.status.conclusion === "timed_out"),
  );
  const lost = selected.filter(
    (r) =>
      r.status._tag === "done" && (r.status.conclusion === "cancelled" || r.status.conclusion === "startup_failure"),
  );
  const pending = asked.filter((c) => {
    const runs = selected.filter((r) => matches(c, r));
    return runs.length === 0 || runs.some((r) => r.status._tag !== "done");
  });

  if (Arr.isReadonlyArrayNonEmpty(red)) {
    return Verdict.cases.red.make({ runs: red });
  }

  if (Arr.isReadonlyArrayNonEmpty(lost)) {
    return Verdict.cases.lost.make({ runs: lost });
  }

  if (Arr.isReadonlyArrayNonEmpty(pending)) {
    return Verdict.cases.pending.make({ checks: pending });
  }

  // At least one check was asked; without a matching run it would have been pending.
  return Verdict.cases.green.make({ runs: Schema.decodeUnknownSync(Schema.NonEmptyArray(Ci.CheckRun))(selected) });
};
