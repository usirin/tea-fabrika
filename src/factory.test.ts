import { replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { type Factory, type FactoryMsg, factory } from "./factory.ts";
import { factoryInterpret } from "./handlers.ts";
import { type Issue, type RawIssue, testNames } from "./issue.ts";
import {
  type ScriptedSort,
  scriptedBuilder,
  scriptedCommentReader,
  scriptedEnricher,
  scriptedJev,
  scriptedReviewer,
  scriptedMatcher,
  scriptedRouter,
  scriptedTracker,
  scriptedWorkspace,
} from "./scripted.ts";
import type { CheckResult } from "./services.ts";

const raw: RawIssue = {
  id: "7",
  title: "slugs look wrong",
  body: "titles with spaces come out with the spaces still in them",
  filedBy: "human",
};

const enriched: Issue = {
  id: "7",
  title: "slugify leaves spaces in the slug",
  goal: "slugify turns a title into a URL slug",
  body: "## In plain words\n\nslugify returns the title unchanged.",
  criteria: [
    { kind: "example", id: "lower", rule: "The slug is lower case", file: "slugify.js", name: "slugify", examples: [{ call: `slugify("Hi")`, result: `"hi"` }] },
    { kind: "example", id: "dashes", rule: "Spaces become single dashes", file: "slugify.js", name: "slugify", examples: [{ call: `slugify("a b")`, result: `"a-b"` }] },
  ],
};

const green: CheckResult = {
  passed: true,
  output: "2 passed",
  diff: "+ slugify",
  passingTests: testNames(enriched),
  touched: [],
  changed: ["slugify.js"],
  snapshot: { "slugify.js": { text: "export function slugify(title) {}\n", lines: [1] } },
};

const agentBug: ScriptedSort = {
  type: ["bug", 0.95],
  priority: ["p1", 0.9],
  audience: ["agent", 0.92],
  value: ["keep", 0.97],
};

interface Script {
  readonly raw?: RawIssue;
  readonly enricher?: readonly (Issue | "fail")[];
  readonly sort?: ScriptedSort;
  readonly builder?: readonly ("ok" | "fail")[];
  readonly checks?: readonly CheckResult[];
}

/** Drive the whole factory from `from` with `msg` until it goes quiet. */
async function driveFactory(from: Factory, msg: FactoryMsg, script: Script) {
  const builder = scriptedBuilder(script.builder ?? []);
  const enricher = scriptedEnricher(script.enricher ?? [enriched]);
  const layers = Layer.mergeAll(
    enricher.layer,
    builder.layer,
    scriptedRouter().layer,
    scriptedMatcher().layer,
    scriptedReviewer().layer,
    // The tracker holds the ticket: the factory is handed only its id.
    scriptedTracker([[]], [script.raw ?? raw]).layer,
    scriptedCommentReader().layer,
    scriptedWorkspace(script.checks ?? []),
    scriptedJev(script.sort === undefined ? [] : [script.sort]),
  );
  const result = await Effect.runPromise(drive(factory, from, msg, factoryInterpret).pipe(Effect.provide(layers)));
  return { ...result, builds: builder.requests };
}

/** File one raw issue and drive the whole factory until it goes quiet. */
const runFactory = (script: Script) =>
  driveFactory(
    { triage: { phase: "idle" }, lane: { phase: "idle" }, builder: null },
    { type: "file", issue: (script.raw ?? raw).id, builder: "lane-session" },
    script,
  );

const answer = (a: Extract<FactoryMsg, { type: "answer" }>["answer"]): FactoryMsg => ({ type: "answer", answer: a, at: Date.now() });

describe("the factory", () => {
  it("takes a raw issue through triage and the lane to done", async () => {
    const { state, trace, builds } = await runFactory({
      sort: agentBug,
      builder: ["ok"],
      checks: [green],
    });

    expect(state.triage).toMatchObject({
      phase: "triaged",
      type: "bug",
      priority: "p1",
      audience: "agent",
    });
    expect(state.lane).toMatchObject({ phase: "done", attempt: 1 });
    // The builder was handed the issue triage wrote, not the raw one.
    expect(builds[0]?.issue).toEqual(enriched);
    // Enrich and one sort, then the lane: write the tests, build, run them,
    // have the change read. Jev sorts; it does not judge.
    expect(
      trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : [])),
    ).toEqual(["fetch_ticket", "enrich", "resilient_run", "prepare", "build", "check", "inspect", "fetch_comments"]);
  });

  it("reads the ticket from the tracker, and parks when the tracker does not have it", async () => {
    const empty = { triage: { phase: "idle" }, lane: { phase: "idle" }, builder: null } as const;
    const { state: parked } = await driveFactory(empty, { type: "file", issue: "missing", builder: "lane-session" }, {});
    // Once the ticket is there, a retry reads it and goes on.
    const { state } = await driveFactory(parked, answer({ park: "tracker_failed", answer: { kind: "retry" } }), {
      raw: { ...raw, id: "missing" },
      sort: agentBug,
      builder: ["ok"],
      checks: [green],
    });

    expect(parked.triage).toEqual({ phase: "parked", id: "missing", why: { kind: "tracker_failed" } });
    expect(state.triage).toMatchObject({ phase: "triaged", raw: { id: "missing", title: raw.title } });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("reads the ticket again when killed while reading it", async () => {
    const reading = { triage: { phase: "fetching", id: raw.id }, lane: { phase: "idle" }, builder: "lane-session" } as const;
    const { state, trace } = await driveFactory(reading, { type: "resume", at: 0 }, { sort: agentBug, builder: ["ok"], checks: [green] });

    expect(trace.find((entry) => entry.kind === "cmd")).toMatchObject({ cmd: { type: "fetch_ticket", issue: raw.id } });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("starts no lane for work triage says a person must pick up", async () => {
    const { state, builds } = await runFactory({
      sort: { ...agentBug, audience: ["human", 0.9] },
    });

    expect(state.triage).toMatchObject({ phase: "triaged", audience: "human" });
    expect(state.lane).toEqual({ phase: "idle" });
    expect(builds).toEqual([]);
  });

  it("starts no lane for a type a lane cannot build", async () => {
    const { state } = await runFactory({ sort: { ...agentBug, type: ["epic", 0.9] } });

    expect(state.triage).toMatchObject({ phase: "triaged", type: "epic" });
    expect(state.lane).toEqual({ phase: "idle" });
  });

  it("parks when the sorter cannot say who should pick it up", async () => {
    const { state } = await runFactory({
      sort: { ...agentBug, audience: ["agent", 0.55] },
    });

    expect(state.triage).toMatchObject({
      phase: "parked",
      why: {
        kind: "sort_unsure",
        answers: [{ question: "audience", choice: "agent", confidence: 0.55 }],
      },
    });
    expect(state.lane).toEqual({ phase: "idle" });
  });

  it("prices an unsure priority at p2 and carries on", async () => {
    const { state } = await runFactory({
      sort: { ...agentBug, priority: ["p0", 0.5] },
      builder: ["ok"],
      checks: [green],
    });

    expect(state.triage).toMatchObject({ phase: "triaged", priority: "p2" });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("builds an issue that is a coin flip between bug and feature", async () => {
    const { state } = await runFactory({
      sort: { ...agentBug, type: ["feature", 0.46, { bug: 0.44, chore: 0.1 }] },
      builder: ["ok"],
      checks: [green],
    });

    expect(state.triage).toMatchObject({ phase: "triaged", type: "feature" });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("parks an issue that might not be buildable at all", async () => {
    const { state } = await runFactory({
      sort: { ...agentBug, type: ["feature", 0.5, { epic: 0.5 }] },
    });

    expect(state.triage).toMatchObject({
      phase: "parked",
      why: { kind: "sort_unsure", answers: [{ question: "type" }] },
    });
  });

  it("keeps an issue when the sorter only half thinks it is not worth doing", async () => {
    const { state } = await runFactory({
      raw: { ...raw, filedBy: "agent" },
      sort: { ...agentBug, value: ["self_generated_churn", 0.5] },
      builder: ["ok"],
      checks: [green],
    });

    expect(state.triage).toMatchObject({ phase: "triaged" });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("kills an agent's filing that is not worth doing", async () => {
    const { state } = await runFactory({
      raw: { ...raw, filedBy: "agent" },
      sort: { ...agentBug, value: ["self_generated_churn", 0.9] },
    });

    expect(state.triage).toMatchObject({ phase: "killed", clause: "self_generated_churn" });
  });

  it("never kills a person's filing, it parks it", async () => {
    const { state } = await runFactory({
      sort: { ...agentBug, value: ["self_generated_churn", 0.9] },
    });

    expect(state.triage).toMatchObject({
      phase: "parked",
      why: { kind: "not_worth_doing", clause: "self_generated_churn" },
    });
  });

  it("parks when the enricher fails", async () => {
    const { state } = await runFactory({ enricher: ["fail"] });

    expect(state.triage).toMatchObject({ phase: "parked", why: { kind: "enricher_failed" } });
  });

  it("builds an issue once a person sorts what Jev was unsure about", async () => {
    const { state: parked } = await runFactory({ sort: { ...agentBug, audience: ["human", 0.32] } });
    const { state, builds } = await driveFactory(
      parked,
      answer({ park: "sort_unsure", answer: { kind: "sort", type: "feature", priority: "p2", audience: "agent" } }),
      { builder: ["ok"], checks: [green] },
    );

    expect(state.triage).toMatchObject({ phase: "triaged", type: "feature", priority: "p2", audience: "agent" });
    expect(state.lane).toMatchObject({ phase: "done" });
    expect(builds[0]?.issue).toEqual(enriched);
  });

  it("keeps a person's filing when a person says it is worth doing, sorted as Jev sorted it", async () => {
    const { state: parked } = await runFactory({ sort: { ...agentBug, value: ["self_generated_churn", 0.9] } });
    const { state } = await driveFactory(parked, answer({ park: "not_worth_doing", answer: { kind: "keep" } }), {
      builder: ["ok"],
      checks: [green],
    });

    expect(state.triage).toMatchObject({ phase: "triaged", type: "bug", priority: "p1", audience: "agent" });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("retries a failed enricher when told to", async () => {
    const { state: parked } = await runFactory({ enricher: ["fail"] });
    const { state } = await driveFactory(parked, answer({ park: "enricher_failed", answer: { kind: "retry" } }), {
      enricher: [enriched],
      sort: agentBug,
      builder: ["ok"],
      checks: [green],
    });

    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("drops a parked issue, and ignores an answer meant for the lane", async () => {
    const { state: parked } = await runFactory({ sort: { ...agentBug, audience: ["human", 0.32] } });
    const wrong = await driveFactory(parked, answer({ park: "builder_failed", answer: { kind: "retry" } }), {});
    const dropped = await driveFactory(parked, answer({ park: "sort_unsure", answer: { kind: "drop" } }), {});

    expect(wrong.state).toEqual(parked);
    expect(dropped.state.triage).toMatchObject({ phase: "dropped", why: { kind: "sort_unsure" } });
    expect(dropped.state.lane).toEqual({ phase: "idle" });
  });

  it("replays the whole run from its Msgs alone", async () => {
    const { state, trace } = await runFactory({
      sort: agentBug,
      builder: ["ok"],
      checks: [green],
    });

    const msgs = trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : []));

    expect(replay(factory, { msgs, ctx: undefined }).state).toEqual(state);
  });
});
