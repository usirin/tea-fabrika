// Every criterion-and-test pair the earlier experiments saved, each with the
// answer the test runs gave: `good` means the test passes on the correct code
// and fails on code that breaks its criterion.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { duration, slugify } from "./toys.ts";

export interface Case {
  /** Who wrote the test: the test-writer from the enricher's criteria, the agent told to fool the judge, or us. */
  readonly from: "writer" | "fooler" | "hand";
  readonly good: boolean;
  /** One line saying what the code is for. */
  readonly about: string;
  readonly criterion: string;
  readonly test: string;
}

const results = join(import.meta.dirname, "results");
const load = async <T>(name: string) =>
  JSON.parse(await readFile(join(results, name), "utf8").catch(() => "[]")) as T;
const titles: Readonly<Record<string, string>> = {
  [slugify.fixture]: slugify.title,
  [duration.fixture]: duration.title,
};

interface EnricherRun {
  readonly goal: string;
  readonly criteria: readonly {
    readonly text: string;
    readonly source: string;
    readonly wrong: boolean;
    readonly empty: boolean;
    readonly tests: number;
  }[];
}

export async function loadCases(): Promise<Case[]> {
  const enriched = [
    ...(await load<readonly EnricherRun[]>("enricher-criteria.json")),
    ...(await load<readonly EnricherRun[]>("enricher-criteria-ticket-only.json")),
  ];
  const fooling = await load<readonly { toy: string; criterion: string; source: string; truth: string }[]>(
    "bad-tests.json",
  );
  const handBuilt = (
    await load<readonly { toy: string; criterion: string; test: string; truth: string; form: string }[]>(
      "test-check-calibration.json",
    )
  ).filter((r) => r.form === "code");
  const cases: Case[] = [
    ...enriched.flatMap((run) =>
      run.criteria
        .filter((c) => c.tests > 0)
        .map((c): Case => ({
          from: "writer",
          good: !c.wrong && !c.empty,
          about: run.goal,
          criterion: c.text,
          test: c.source,
        })),
    ),
    ...fooling.map((r): Case => ({
      from: "fooler",
      good: r.truth === "checks",
      about: titles[r.toy] ?? "",
      criterion: r.criterion,
      test: r.source,
    })),
    ...handBuilt.map((r): Case => ({
      from: "hand",
      good: r.truth === "checks",
      about: titles[r.toy] ?? "",
      criterion: r.criterion,
      test: r.test,
    })),
  ];
  return [...new Map(cases.map((c) => [`${c.criterion}\n${c.test}`, c])).values()];
}
