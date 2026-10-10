import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Answer, drive, type Until, untilFrom } from "./drive.ts";
import { enrichmentText, OURS_FILE, saveEnrichment } from "./enrichment.ts";
import { type Issue, type RawIssue, testNames } from "./issue.ts";
import {
  type ScriptedSort,
  scriptedBuilder,
  scriptedCommentReader,
  scriptedEnricher,
  scriptedFailureReader,
  scriptedJev,
  scriptedMatcher,
  scriptedMissingReader,
  scriptedRepo,
  scriptedReviewer,
  scriptedRouter,
  scriptedTracker,
  scriptedWorkspace,
} from "./scripted.ts";
import type { CheckResult } from "./services.ts";
import { defaultSettings } from "./settings.ts";

// The host's loop on the scripted agents: with UNTIL=triage it stops once
// triage settles, and the lane does no work until a run without it.

const raw: RawIssue = { id: "7", title: "slugs look wrong", body: "spaces stay in", filedBy: "human" };

const enriched: Issue = {
  id: "7",
  title: "slugify leaves spaces in the slug",
  goal: "slugify turns a title into a URL slug",
  body: "## In plain words\n\nslugify returns the title unchanged.\n\nslugify.js lower-cases nothing.\n\n## As filed\n\nspaces stay in",
  criteria: [
    { kind: "example", id: "lower", rule: "The slug is lower case", file: "slugify.js", name: "slugify", uses: [], examples: [{ call: `slugify("Hi")`, result: `"hi"` }] },
  ],
  openDecision: null,
};

/** A rule no call can show, about one file. */
const readme: Issue["criteria"][number] = {
  kind: "unchecked",
  id: "readme",
  rule: "The README shows a slug",
  files: ["README.md"],
  why: "it is about docs",
};

const sort: ScriptedSort = { type: ["bug", 0.95], priority: ["p1", 0.9], value: ["keep", 0.97] };

const green: CheckResult = {
  passed: true,
  output: "1 passed",
  diff: "+ slugify",
  passingTests: testNames(enriched),
  touched: [],
  changed: ["slugify.js"],
  snapshot: { "slugify.js": { text: "export function slugify(title) {}\n", lines: [1] } },
};

interface Script {
  readonly enricher?: readonly Issue[];
  readonly sorts?: readonly ScriptedSort[];
  readonly builder?: readonly ("ok" | "fail")[];
  readonly checks?: readonly CheckResult[];
  /** The runs on untouched code. Left out, every example fails there, as on a fresh issue. */
  readonly prepared?: Parameters<typeof scriptedWorkspace>[1];
}

/** Run the host's loop on ticket 7, kept in `state`, with every agent scripted. */
async function host(state: string, until: Until, script: Script, answer?: Answer) {
  const builder = scriptedBuilder(script.builder ?? []);
  const enricher = scriptedEnricher(script.enricher ?? [enriched]);
  const layers = Layer.mergeAll(
    enricher.layer,
    builder.layer,
    scriptedRouter().layer,
    scriptedMatcher().layer,
    scriptedReviewer().layer,
    scriptedTracker([[]], [raw]).layer,
    scriptedCommentReader().layer,
    scriptedFailureReader().layer,
    scriptedMissingReader().layer,
    scriptedWorkspace(script.checks ?? [], script.prepared),
    scriptedJev(script.sorts ?? []),
    scriptedRepo().layer,
    defaultSettings,
  );
  const result = await Effect.runPromise(
    drive({ issue: raw.id, state, until, ...(answer === undefined ? {} : { answer }) }).pipe(
      Effect.scoped,
      Effect.provide(layers),
    ),
  );
  return { ...result, builds: builder.requests, enrichments: enricher.requests };
}

const saved = async (state: string) => JSON.parse(await readFile(state, "utf8")) as { readonly triage: { readonly phase: string }; readonly lane: { readonly phase: string } };

describe("a run with UNTIL=triage", () => {
  let dir = "";
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    dir = await mkdtemp(join(tmpdir(), "tea-fabrika-until-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops once the issue is triaged, before the lane writes a test or asks the builder", async () => {
    const state = join(dir, "state.json");
    const { final, rewrite, builds } = await host(state, "triage", { sorts: [sort] });

    expect(final.triage).toMatchObject({ phase: "triaged", type: "bug", issue: enriched });
    expect(rewrite).toEqual(enriched);
    expect(builds).toEqual([]);
    // The lane was started and its first Cmd held: the saved run still waits on it.
    expect(final.lane.phase).toBe("preparing");
    expect(await saved(state)).toMatchObject({ triage: { phase: "triaged" }, lane: { phase: "preparing" } });
  });

  it("is carried on by a run without it, which asks the held work again", async () => {
    const state = join(dir, "state.json");
    await host(state, "triage", { sorts: [sort] });
    const { final, builds, enrichments } = await host(state, "end", { builder: ["ok"], checks: [green] });

    expect(enrichments).toEqual([]);
    expect(builds).toHaveLength(1);
    expect(final.lane).toMatchObject({ phase: "done" });
  });

  it("stops at a call nobody has made, and after the owner's ruling stops again once the rewrite is sorted", async () => {
    const state = join(dir, "state.json");
    const question = "Keep accents?";
    const parked = await host(state, "triage", { enricher: [{ ...enriched, openDecision: question }] });

    expect(parked.final.triage).toMatchObject({ phase: "parked", why: { kind: "needs_decision", question } });
    expect(parked.rewrite?.openDecision).toBe(question);

    const decided = await host(state, "triage", { sorts: [sort] }, { park: "needs_decision", answer: { kind: "decide", ruling: "Drop them." } });

    expect(decided.enrichments).toHaveLength(1);
    expect(decided.final.triage).toMatchObject({ phase: "triaged", issue: enriched });
    expect(decided.builds).toEqual([]);
  });

  it("stops at once on a run that was already past triage", async () => {
    const state = join(dir, "state.json");
    await host(state, "triage", { sorts: [sort] });
    const { final, builds, enrichments } = await host(state, "triage", {});

    expect(final.lane.phase).toBe("preparing");
    expect(builds).toEqual([]);
    expect(enrichments).toEqual([]);
  });
});

describe("UNTIL as typed", () => {
  it("is the end when left out, and refuses a stop it does not know", () => {
    expect(untilFrom(undefined)).toBe("end");
    expect(untilFrom("")).toBe("end");
    expect(untilFrom("triage")).toBe("triage");
    expect(() => untilFrom("lane")).toThrow(/UNTIL is "lane"/);
  });
});

describe("our enrichment, kept beside fabrika's", () => {
  it("is the rewrite without the report as filed, then the criteria as a checklist, then the open call", async () => {
    const text = enrichmentText({
      ...enriched,
      criteria: [
        {
          kind: "example",
          id: "replays",
          rule: "replay folds every message",
          file: "src/replay.ts",
          name: "replay",
          uses: [{ name: "defineMachine", file: "src/index.ts" }],
          examples: [{ call: "replay(defineMachine({}), { msgs: [] }).state", result: "0" }],
        },
        { kind: "unchecked", id: "fast", rule: "replay stays fast", files: [], why: "it is about timing" },
        readme,
      ],
      openDecision: "Keep accents?",
    });

    expect(text).toBe(
      [
        "# slugify leaves spaces in the slug",
        "",
        "**Goal:** slugify turns a title into a URL slug",
        "",
        "## In plain words",
        "",
        "slugify returns the title unchanged.",
        "",
        "slugify.js lower-cases nothing.",
        "",
        "### Acceptance criteria",
        "",
        "- [ ] replay folds every message (`replays`)",
        "  - imports `replay` from `src/replay.ts`, `defineMachine` from `src/index.ts`",
        "  - `replay(defineMachine({}), { msgs: [] }).state` → `0`",
        "- [ ] replay stays fast (`fast`)",
        "  - unchecked, about no one file: it is about timing",
        "- [ ] The README shows a slug (`readme`)",
        "  - unchecked, about `README.md`: it is about docs",
        "",
        "### Open decision",
        "",
        "Keep accents?",
      ].join("\n"),
    );
  });

  it("is saved in the run folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tea-fabrika-ours-"));
    const file = await saveEnrichment(dir, enriched);

    expect(file).toBe(join(dir, OURS_FILE));
    expect(await readFile(file, "utf8")).toBe(`${enrichmentText(enriched)}\n`);
    expect(await readFile(file, "utf8")).toContain("### Open decision\n\nNone.");
  });
});
