import { Ci, type CodeHost } from "@kampus/libfabrika";
import { Array as Arr, Schema } from "effect";
import picomatch from "picomatch/posix.js";

export const Kind = Schema.Literals(["rows", "docs", "code"]);

const compiles = (glob: string) => {
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
