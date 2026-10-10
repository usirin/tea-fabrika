import { Refusal, replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  BEFORE_SETTINGS,
  type Factory,
  type FactoryMsg,
  factory,
  type Knobs,
  parseFactory,
  SORTED_FOR_A_PERSON,
  unsureForAPerson,
  VET_TRIES_BEFORE,
} from "./factory.ts";
import { SORT_KEY, sortAsk, sortContent } from "./sort.ts";
import { rulingNote } from "./triage.ts";
import { DEFAULT_SETTINGS, knobsOf } from "./settings.ts";
import { factoryInterpret } from "./handlers.ts";
import { type Issue, type RawIssue, testNames } from "./issue.ts";
import {
  SCRIPTED_SESSION,
  type ScriptedSort,
  scriptedBuilder,
  scriptedCommentReader,
  scriptedEnricher,
  scriptedFacts,
  scriptedFailureReader,
  scriptedJev,
  scriptedMissingReader,
  scriptedReviewer,
  scriptedMatcher,
  scriptedRepo,
  scriptedRouter,
  scriptedTracker,
  scriptedWorkspace,
} from "./scripted.ts";
import type { CheckResult } from "./services.ts";
import type { FactsPack } from "./facts.ts";
import type { Vetted } from "./vetting.ts";

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
    { kind: "example", id: "lower", rule: "The slug is lower case", file: "slugify.js", name: "slugify", uses: [], examples: [{ call: `slugify("Hi")`, result: `"hi"` }] },
    { kind: "example", id: "dashes", rule: "Spaces become single dashes", file: "slugify.js", name: "slugify", uses: [], examples: [{ call: `slugify("a b")`, result: `"a-b"` }] },
  ],
  openDecision: null,
};

/** The same rewrite, resting on a call nobody has made. */
const QUESTION = "Should accented letters be dropped or turned into plain ones?";
const undecided: Issue = { ...enriched, openDecision: QUESTION };

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
  value: ["keep", 0.97],
};

/** A sort Jev cannot settle: a feature, or an epic no lane can build. */
const unsureType: ScriptedSort = { ...agentBug, type: ["feature", 0.5, { epic: 0.5 }] };

interface Script {
  readonly raw?: RawIssue;
  readonly enricher?: readonly (Issue | "fail")[];
  readonly sort?: ScriptedSort;
  readonly builder?: readonly ("ok" | "fail")[];
  readonly checks?: readonly CheckResult[];
  readonly repo?: Parameters<typeof scriptedRepo>[0];
  readonly missing?: Parameters<typeof scriptedMissingReader>[0];
  readonly prepared?: Parameters<typeof scriptedWorkspace>[1];
  /** Each vetting of a draft. Left out, every draft vets clean. */
  readonly vets?: Parameters<typeof scriptedWorkspace>[5];
  readonly facts?: Parameters<typeof scriptedFacts>[0];
}

/** Drive the whole factory from `from` with `msg` until it goes quiet. */
async function driveFactory(from: Factory, msg: FactoryMsg, script: Script) {
  const builder = scriptedBuilder(script.builder ?? []);
  const enricher = scriptedEnricher(script.enricher ?? [enriched]);
  const repo = scriptedRepo(script.repo);
  const facts = scriptedFacts(script.facts);
  const layers = Layer.mergeAll(
    facts.layer,
    enricher.layer,
    builder.layer,
    scriptedRouter().layer,
    scriptedMatcher().layer,
    scriptedReviewer().layer,
    // The tracker holds the ticket: the factory is handed only its id.
    scriptedTracker([[]], [script.raw ?? raw]).layer,
    scriptedCommentReader().layer,
    scriptedFailureReader().layer,
    scriptedMissingReader(script.missing).layer,
    scriptedWorkspace(script.checks ?? [], script.prepared, undefined, {}, {}, script.vets),
    scriptedJev(script.sort === undefined ? [] : [script.sort]),
    repo.layer,
  );
  const result = await Effect.runPromise(drive(factory, from, msg, factoryInterpret).pipe(Effect.provide(layers)));
  return { ...result, builds: builder.requests, seals: repo.seals, enrichments: enricher.requests, gathered: facts.asked };
}

/** The Cmds a run sent, by type, in order. */
const cmdsOf = (trace: Awaited<ReturnType<typeof driveFactory>>["trace"]) =>
  trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : []));

const fresh: Factory = { triage: { phase: "idle" }, lane: { phase: "idle" }, ship: { phase: "idle" }, filed: null };

/** What a run is filed with when `fabrika.toml` sets nothing. */
const KNOBS = knobsOf(DEFAULT_SETTINGS);
const file = (issue: string, knobs: Knobs = KNOBS): FactoryMsg => ({ type: "file", issue, builder: "lane-session", knobs });

/** File one raw issue and drive the whole factory until it goes quiet. */
const runFactory = (script: Script, knobs: Knobs = KNOBS) => driveFactory(fresh, file((script.raw ?? raw).id, knobs), script);

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
    });
    expect(state.lane).toMatchObject({ phase: "done", attempt: 1 });
    // The builder was handed the issue triage wrote, not the raw one.
    expect(builds[0]?.issue).toEqual(enriched);
    // A draft, vetted, and one sort, then the lane: write the tests, build, run
    // them, have the change read. Jev sorts; it does not judge. Then ship seals
    // it. The report names no code, so there are no facts to gather.
    expect(
      trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : [])),
    ).toEqual(["fetch_ticket", "enrich_write", "enrich_check", "sort_run", "prepare", "build", "check", "fresh_check", "inspect", "find_missing", "fetch_comments", "seal"]);
    // Nothing lands without a person's yes.
    expect(state.ship).toMatchObject({ phase: "parked", why: { kind: "approve", head: "sealed-1" } });
  });

  it("lands the change once a person approves the commit they were shown, and only that one", async () => {
    const { state: waiting } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] });
    const other = await driveFactory(waiting, answer({ park: "approve", answer: { kind: "approve", head: "something-else" } }), {});
    const { state } = await driveFactory(waiting, answer({ park: "approve", answer: { kind: "approve", head: "sealed-1" } }), {});

    expect(other.state).toEqual(waiting);
    expect(state.ship).toMatchObject({ phase: "landed", sha: "sealed-1" });
    // The person saw what the lane left on the record.
    expect(waiting.ship.phase === "parked" ? waiting.ship.input.record[0] : "").toBe("1 attempt(s), 1 build(s)");
  });

  describe("the missing-file check, as the person approving reads it", () => {
    const approving = (state: Factory) => (state.ship.phase === "parked" ? state.ship.input : null);

    it("says it ran, how many files it asked, and which", async () => {
      const { state } = await runFactory({
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
        missing: [{ kind: "checked", scope: "imports", asked: 119, flagged: [] }],
      });

      expect(approving(state)?.missing).toEqual({ kind: "checked", scope: "imports", asked: 119, flagged: [] });
      expect(approving(state)?.record).toContain("missing-file check: ran, asked 119 file(s) one import from the change, 0 flagged");
    });

    it("says the whole packages were asked when the scope was, or when the answer predates the scope", async () => {
      for (const scope of ["package", undefined] as const) {
        const answer = { kind: "checked" as const, asked: 911, flagged: [], ...(scope === undefined ? {} : { scope }) };
        const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green], missing: [answer] });

        expect(approving(state)?.record).toContain("missing-file check: ran, asked 911 file(s) in the touched packages, 0 flagged");
      }
    });

    it("says it was skipped for too many files, and why", async () => {
      const { state } = await runFactory({
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
        missing: [{ kind: "too_many", scope: "imports", candidates: 3000, cap: 2000 }],
      });

      expect(state.ship).toMatchObject({ phase: "parked", why: { kind: "approve" } });
      expect(approving(state)?.missing).toEqual({ kind: "too_many", scope: "imports", candidates: 3000, cap: 2000 });
      expect(approving(state)?.record).toContain(
        "missing-file check: SKIPPED, 3000 files one import from the change to ask is over the cap of 2000",
      );
    });

    it("says it did not run when a person finished the lane with nothing built", async () => {
      const { state: parked } = await runFactory({
        sort: agentBug,
        prepared: [{ passing: testNames(enriched), failing: [], output: "" }],
      });
      const { state, trace } = await driveFactory(parked, answer({ park: "nothing_to_build", answer: { kind: "accept" } }), {});

      expect(parked.lane).toMatchObject({ phase: "parked", why: { kind: "nothing_to_build" } });
      expect(trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : []))).not.toContain("find_missing");
      expect(approving(state)?.missing).toEqual({ kind: "no_change" });
      expect(approving(state)?.record).toContain("missing-file check: not run, nothing was built");
    });

    it("says it was skipped when the reader failed", async () => {
      const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green], missing: ["fail"] });

      expect(approving(state)?.missing).toEqual({ kind: "unread" });
      expect(approving(state)?.record).toContain("missing-file check: SKIPPED, the reader failed");
    });
  });

  it("reads the ticket from the tracker, and parks when the tracker does not have it", async () => {
    const { state: parked } = await driveFactory(fresh, file("missing"), {});
    // Once the ticket is there, a retry reads it and goes on.
    const { state } = await driveFactory(parked, answer({ park: "tracker_failed", answer: { kind: "retry" } }), {
      raw: { ...raw, id: "missing" },
      sort: agentBug,
      builder: ["ok"],
      checks: [green],
    });

    expect(parked.triage).toEqual({ phase: "parked", id: "missing", knobs: KNOBS.triage, why: { kind: "tracker_failed" } });
    expect(state.triage).toMatchObject({ phase: "triaged", raw: { id: "missing", title: raw.title } });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  it("reads the ticket again when killed while reading it", async () => {
    const reading: Factory = {
      ...fresh,
      triage: { phase: "fetching", id: raw.id, knobs: KNOBS.triage },
      filed: { builder: "lane-session", lane: KNOBS.lane },
    };
    const { state, trace } = await driveFactory(reading, { type: "resume", at: 0 }, { sort: agentBug, builder: ["ok"], checks: [green] });

    expect(trace.find((entry) => entry.kind === "cmd")).toMatchObject({ cmd: { type: "fetch_ticket", issue: raw.id } });
    expect(state.lane).toMatchObject({ phase: "done" });
  });

  describe("a call nobody has made", () => {
    it("parks for the owner with the enricher's question, and never asks Jev", async () => {
      // No sort is scripted: a Jev call would run the script dry and fail the test.
      const { state, trace, builds } = await runFactory({ enricher: [undecided] });

      expect(state.triage).toMatchObject({ phase: "parked", why: { kind: "needs_decision", question: QUESTION, issue: undecided } });
      expect(cmdsOf(trace)).toEqual(["fetch_ticket", "enrich_write", "enrich_check"]);
      expect(state.lane).toEqual({ phase: "idle" });
      expect(builds).toEqual([]);
    });

    it("hands the owner's ruling to the enricher in the same conversation, then sorts and builds the rewrite", async () => {
      const { state: parked } = await runFactory({ enricher: [undecided] });
      const { state, trace, enrichments, builds } = await driveFactory(
        parked,
        answer({ park: "needs_decision", answer: { kind: "decide", ruling: "Drop them." } }),
        { enricher: [enriched], sort: agentBug, builder: ["ok"], checks: [green] },
      );

      expect(enrichments).toMatchObject([{ raw, note: rulingNote(QUESTION, "Drop them."), session: SCRIPTED_SESSION }]);
      expect(cmdsOf(trace).slice(0, 3)).toEqual(["enrich_write", "enrich_check", "sort_run"]);
      expect(state.triage).toMatchObject({ phase: "triaged", type: "bug", issue: enriched });
      expect(state.lane).toMatchObject({ phase: "done" });
      expect(builds[0]?.issue).toEqual(enriched);
    });

    it("parks again when the rewrite after a ruling still rests on an open call", async () => {
      const { state: parked } = await runFactory({ enricher: [undecided] });
      const next = { ...enriched, openDecision: "Keep digits?" };
      const { state } = await driveFactory(parked, answer({ park: "needs_decision", answer: { kind: "decide", ruling: "Drop them." } }), {
        enricher: [next],
      });

      expect(state.triage).toMatchObject({ phase: "parked", why: { kind: "needs_decision", question: "Keep digits?" } });
    });

    it("keeps the ruling through a restart and a failed enricher", async () => {
      const note = rulingNote(QUESTION, "Drop them.");
      const { state: parked } = await runFactory({ enricher: [undecided] });
      const failed = await driveFactory(parked, answer({ park: "needs_decision", answer: { kind: "decide", ruling: "Drop them." } }), {
        enricher: ["fail"],
      });
      const retried = await driveFactory(failed.state, answer({ park: "enricher_failed", answer: { kind: "retry" } }), {
        enricher: [undecided],
      });
      // Killed while the enricher was working on the ruling: the restart tells it again.
      const working: Factory = {
        ...parked,
        triage: {
          phase: "enriching",
          raw,
          session: SCRIPTED_SESSION,
          facts: null,
          knobs: KNOBS.triage,
          enrichment: { phase: "writing", brief: { raw, facts: null }, session: SCRIPTED_SESSION, tries: 1, limit: 3, note },
        },
      };
      const resumed = await driveFactory(working, { type: "resume", at: 0 }, { enricher: [undecided] });

      expect(failed.state.triage).toMatchObject({ phase: "parked", why: { kind: "enricher_failed", enrichment: { note } } });
      expect(retried.enrichments).toMatchObject([{ raw, note, session: SCRIPTED_SESSION }]);
      expect(resumed.enrichments).toMatchObject([{ raw, note, session: SCRIPTED_SESSION }]);
    });

    it("drops the issue when the owner says so", async () => {
      const { state: parked } = await runFactory({ enricher: [undecided] });
      const { state } = await driveFactory(parked, answer({ park: "needs_decision", answer: { kind: "drop" } }), {});

      expect(state.triage).toMatchObject({ phase: "dropped", why: { kind: "needs_decision", question: QUESTION } });
      expect(state.lane).toEqual({ phase: "idle" });
    });

    it("asks Jev only type, priority and value when nothing is open, and builds on its sure answer", async () => {
      const { state, trace } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] });
      const sort = trace.find((entry) => entry.kind === "cmd" && entry.cmd.type === "sort_run");

      expect(sort?.kind === "cmd" && sort.cmd.type === "sort_run" ? Object.keys(sort.cmd.input.questions) : []).toEqual([
        "type",
        "priority",
        "value",
      ]);
      expect(state.triage).toMatchObject({ phase: "triaged" });
      expect(state.triage).not.toHaveProperty("audience");
      expect(state.lane).toMatchObject({ phase: "done" });
    });
  });

  describe("a rewrite from facts, vetted before it is kept", () => {
    /** A report that names code: one name and one file. */
    const pointed: RawIssue = { ...raw, body: "`slugify` in `slugify.js` keeps the spaces (#3)" };
    const pack: FactsPack = {
      names: [{ name: "slugify", definitions: [], more: 0, mentionedIn: 1 }],
      paths: [{ path: "slugify.js", exists: true, near: [] }],
      refs: ["#3"],
    };
    /** Vetting of {@link enriched} where `lower` already holds today. */
    const lowerHolds: Vetted = {
      missing: [],
      examples: [
        { criterion: "lower", call: `slugify("Hi")`, verdict: "holds_already", detail: "" },
        { criterion: "dashes", call: `slugify("a b")`, verdict: "fails", detail: "'a b' !== 'a-b'" },
      ],
    };
    const tries = (vetTries: number): Knobs => ({ ...KNOBS, triage: { ...KNOBS.triage, vetTries } });

    it("asks the code about what the report mentions, and the enricher starts from the facts", async () => {
      const { state, trace, gathered, enrichments } = await runFactory({ raw: pointed, facts: [pack], sort: agentBug, builder: ["ok"], checks: [green] });

      expect(gathered).toEqual([{ names: ["slugify"], paths: ["slugify.js"], refs: ["#3"] }]);
      expect(enrichments).toMatchObject([{ raw: pointed, facts: pack, note: null, session: null }]);
      expect(cmdsOf(trace).slice(0, 5)).toEqual(["fetch_ticket", "gather_facts", "enrich_write", "enrich_check", "sort_run"]);
      expect(state.triage).toMatchObject({ phase: "triaged", facts: pack, session: SCRIPTED_SESSION });
      expect(state.lane).toMatchObject({ phase: "done" });
    });

    it("enriches without facts when they cannot be gathered: they only help", async () => {
      const { state, enrichments } = await runFactory({ raw: pointed, facts: ["fail"], sort: agentBug, builder: ["ok"], checks: [green] });

      expect(enrichments).toMatchObject([{ facts: null }]);
      expect(state.triage).toMatchObject({ phase: "triaged", facts: null });
    });

    it("sends vetting's problems back to the enricher in its own conversation, and sorts the draft that passes", async () => {
      const { state, enrichments, trace } = await runFactory({
        enricher: [enriched, enriched],
        vets: [lowerHolds, { missing: [], examples: lowerHolds.examples.map((e) => ({ ...e, verdict: "fails" as const })) }],
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
      });

      expect(enrichments).toHaveLength(2);
      expect(enrichments[1]).toMatchObject({ session: SCRIPTED_SESSION });
      expect(enrichments[1]?.note).toContain('Example `slugify("Hi")` (criterion lower) already holds on today\'s code');
      expect(cmdsOf(trace).slice(0, 6)).toEqual(["fetch_ticket", "enrich_write", "enrich_check", "enrich_write", "enrich_check", "sort_run"]);
      expect(state.triage).toMatchObject({ phase: "triaged", issue: enriched });
    });

    it("parks a draft vetting still rejects once its tries are spent, with vetting's last word", async () => {
      const { state, enrichments } = await runFactory({ enricher: [enriched, enriched], vets: [lowerHolds, lowerHolds] }, tries(2));

      expect(enrichments).toHaveLength(2);
      expect(state.triage).toMatchObject({ phase: "parked", why: { kind: "enrichment_unvetted", issue: enriched } });
      const why = state.triage.phase === "parked" ? state.triage.why : null;
      expect(why?.kind === "enrichment_unvetted" ? why.problems : []).toEqual([
        'Example `slugify("Hi")` (criterion lower) already holds on today\'s code, so it shows nothing the change does. If the rule is really about types or docs, make it unchecked with that kind; if today\'s code already follows it, leave it out.',
      ]);
      expect(state.lane).toEqual({ phase: "idle" });
    });

    it("gives a parked draft more tries in the same conversation, takes it as it is, or drops it, as a person says", async () => {
      const { state: parked } = await runFactory({ enricher: [enriched], vets: [lowerHolds] }, tries(1));
      const retried = await driveFactory(parked, answer({ park: "enrichment_unvetted", answer: { kind: "retry", tries: 1 } }), {
        enricher: [enriched],
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
      });
      const accepted = await driveFactory(parked, answer({ park: "enrichment_unvetted", answer: { kind: "accept" } }), {
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
      });
      const dropped = await driveFactory(parked, answer({ park: "enrichment_unvetted", answer: { kind: "drop" } }), {});
      const none = await driveFactory(parked, answer({ park: "enrichment_unvetted", answer: { kind: "retry", tries: 0 } }), {});

      expect(retried.enrichments).toMatchObject([{ session: SCRIPTED_SESSION }]);
      expect(retried.enrichments[0]?.note).toContain("already holds on today's code");
      expect(retried.state.triage).toMatchObject({ phase: "triaged", issue: enriched });
      expect(accepted.enrichments).toEqual([]);
      expect(cmdsOf(accepted.trace)[0]).toBe("sort_run");
      expect(accepted.state.lane).toMatchObject({ phase: "done" });
      expect(dropped.state.triage).toMatchObject({ phase: "dropped", why: { kind: "enrichment_unvetted" } });
      expect(none.state).toEqual(parked);
    });

    it("parks when the draft cannot be vetted; a retry vets the same draft again, and accept takes it unvetted", async () => {
      const { state: parked } = await runFactory({ enricher: [enriched], vets: ["fail"] });
      const retried = await driveFactory(parked, answer({ park: "vetting_failed", answer: { kind: "retry" } }), {
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
      });
      const accepted = await driveFactory(parked, answer({ park: "vetting_failed", answer: { kind: "accept" } }), { sort: agentBug, builder: ["ok"], checks: [green] });

      expect(parked.triage).toMatchObject({ phase: "parked", why: { kind: "vetting_failed", issue: enriched } });
      expect(cmdsOf(retried.trace).slice(0, 2)).toEqual(["enrich_check", "sort_run"]);
      expect(retried.enrichments).toEqual([]);
      expect(accepted.state.triage).toMatchObject({ phase: "triaged", issue: enriched });
    });

    it("vets again after a restart in the middle of vetting, without a new draft", async () => {
      const { state: parked } = await runFactory({ enricher: [enriched], vets: ["fail"] });
      const t = parked.triage;
      if (t.phase !== "parked" || !("raw" in t) || t.why.kind !== "vetting_failed") throw new Error("expected a vetting park");
      const { enrichment } = t.why;
      if (enrichment.phase !== "check_failed") throw new Error("expected a stopped check");
      // The same run, killed while the check was running.
      const checking: Factory = {
        ...parked,
        triage: { phase: "enriching", raw: t.raw, session: t.session, facts: t.facts, knobs: t.knobs, enrichment: { ...enrichment, phase: "checking" } },
      };
      const { state, trace, enrichments } = await driveFactory(JSON.parse(JSON.stringify(checking)) as Factory, { type: "resume", at: 1 }, {
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
      });

      expect(cmdsOf(trace).slice(0, 2)).toEqual(["enrich_check", "sort_run"]);
      expect(enrichments).toEqual([]);
      expect(state.triage).toMatchObject({ phase: "triaged" });
    });

    it("replays a run with facts and a sent-back draft from its Msgs alone", async () => {
      const { state, trace } = await runFactory({
        raw: pointed,
        facts: [pack],
        enricher: [enriched, enriched],
        vets: [lowerHolds, { missing: [], examples: lowerHolds.examples.map((e) => ({ ...e, verdict: "fails" as const })) }],
        sort: agentBug,
        builder: ["ok"],
        checks: [green],
      });
      const msgs = trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : []));

      expect(replay(factory, { msgs, ctx: undefined }).state).toEqual(state);
    });
  });

  it("starts no lane for a type a lane cannot build", async () => {
    const { state } = await runFactory({ sort: { ...agentBug, type: ["epic", 0.9] } });

    expect(state.triage).toMatchObject({ phase: "triaged", type: "epic" });
    expect(state.lane).toEqual({ phase: "idle" });
  });

  it("sorts by the floor it was filed with", async () => {
    const sure = { ...agentBug, type: ["bug", 0.85, { epic: 0.15 }] } satisfies ScriptedSort;
    const loose = await runFactory({ sort: sure, builder: ["ok"], checks: [green] });
    const strict = await runFactory({ sort: sure }, { ...KNOBS, triage: { ...KNOBS.triage, sortFloor: 0.9 } });

    expect(loose.state.triage).toMatchObject({ phase: "triaged", type: "bug" });
    expect(strict.state.triage).toMatchObject({
      phase: "parked",
      why: { kind: "sort_unsure", answers: [{ question: "type", confidence: 0.85 }] },
    });
  });

  it("starts the lane with the knobs the issue was filed with", async () => {
    const lane = { attempts: 5, onUnsure: "park" } as const;
    const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] }, { ...KNOBS, lane });

    expect(state.lane).toMatchObject({ phase: "done", knobs: lane, limit: 5 });
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
    const { state } = await runFactory({ sort: unsureType });

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
    const { state: parked } = await runFactory({ sort: unsureType });
    const { state, builds } = await driveFactory(
      parked,
      answer({ park: "sort_unsure", answer: { kind: "sort", type: "feature", priority: "p2" } }),
      { builder: ["ok"], checks: [green] },
    );

    expect(state.triage).toMatchObject({ phase: "triaged", type: "feature", priority: "p2" });
    expect(state.lane).toMatchObject({ phase: "done" });
    expect(builds[0]?.issue).toEqual(enriched);
  });

  it("keeps a person's filing when a person says it is worth doing, sorted as Jev sorted it", async () => {
    const { state: parked } = await runFactory({ sort: { ...agentBug, value: ["self_generated_churn", 0.9] } });
    const { state } = await driveFactory(parked, answer({ park: "not_worth_doing", answer: { kind: "keep" } }), {
      builder: ["ok"],
      checks: [green],
    });

    expect(state.triage).toMatchObject({ phase: "triaged", type: "bug", priority: "p1" });
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
    const { state: parked } = await runFactory({ sort: unsureType });
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

describe("a saved factory read back", () => {
  it("reads one saved with its knobs as it is", async () => {
    const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] });
    const saved = JSON.parse(JSON.stringify(state)) as unknown;

    expect(parseFactory(saved)).toEqual(state);
  });

  it("gives one saved before the knobs the ones it ran by", async () => {
    const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] });
    // What the same run looked like on disk before the knobs: a `builder`, and no knobs anywhere.
    const { filed, ...rest } = state;
    const strip = (part: object) => Object.fromEntries(Object.entries(part).filter(([key]) => key !== "knobs"));
    const old = { ...rest, triage: strip(state.triage), lane: strip(state.lane), builder: filed?.builder ?? null };

    expect(parseFactory(JSON.parse(JSON.stringify(old)))).toEqual({
      ...state,
      // It never vetted, so its tries are today's default.
      triage: { ...state.triage, knobs: { ...BEFORE_SETTINGS.triage, vetTries: VET_TRIES_BEFORE } },
      lane: { ...state.lane, knobs: BEFORE_SETTINGS.lane },
      filed: { builder: "lane-session", lane: BEFORE_SETTINGS.lane },
    });
    // An idle part has nothing to run by, so it gets nothing.
    const idle = { triage: { phase: "idle" }, lane: { phase: "idle" }, ship: { phase: "idle" } };
    expect(parseFactory({ ...idle, builder: null })).toEqual(fresh);
  });

  it("says a run saved before the lane kept the missing-file check that it is not known, never that it ran", async () => {
    const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] });
    if (state.lane.phase !== "done" || state.ship.phase !== "parked") throw new Error("expected a run waiting for approval");
    // The same run as it was saved before: no `missing` on the lane or ship, and no line for it in the record.
    const { missing: _lane, ...lane } = state.lane;
    const { missing: _ship, ...input } = state.ship.input;
    const record = input.record.filter((line) => !line.startsWith("missing-file check"));
    const old = { ...state, lane, ship: { ...state.ship, input: { ...input, record } } };

    const read = parseFactory(JSON.parse(JSON.stringify(old)));
    const line = "missing-file check: not recorded, the run was saved before the lane kept it";
    expect(read).toEqual({
      ...state,
      lane: { ...state.lane, missing: { kind: "not_recorded" } },
      ship: { ...state.ship, input: { ...state.ship.input, missing: { kind: "not_recorded" }, record: [record[0], line, ...record.slice(1)] } },
    });

    // A lane parked while finishing carries it in its park, and gets it there.
    const parked = {
      ...fresh,
      filed: state.filed,
      lane: { ...lane, phase: "parked", why: { kind: "tracker_failed", deviations: [] } },
    };
    expect((parseFactory(JSON.parse(JSON.stringify(parked))) as Factory).lane).toMatchObject({
      phase: "parked",
      why: { kind: "tracker_failed", missing: { kind: "not_recorded" } },
    });
  });

  it("gives criteria saved before they kept the names a call uses, the files a rule is about or what it is about, none and other", async () => {
    const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] });
    if (state.triage.phase !== "triaged" || state.lane.phase !== "done") throw new Error("expected a finished lane");
    const docs: Issue["criteria"][number] = { kind: "unchecked", id: "docs", rule: "The README says so", files: [], about: "other", why: "docs" };
    const withDocs = (issue: Issue): Issue => ({ ...issue, criteria: [...issue.criteria, docs] });
    const now = {
      ...state,
      triage: { ...state.triage, issue: withDocs(state.triage.issue) },
      lane: { ...state.lane, issue: withDocs(state.lane.issue) },
    };
    // The same issues as they were saved before: no `uses` on an example, no `files` or `about` on an unchecked rule.
    const before = (issue: Issue) => ({
      ...issue,
      criteria: issue.criteria.map((c) => {
        if (c.kind === "example") {
          const { uses: _, ...rest } = c;
          return rest;
        }
        const { files: _, about: _about, ...rest } = c;
        return rest;
      }),
    });
    const saved = { ...now, triage: { ...now.triage, issue: before(now.triage.issue) }, lane: { ...now.lane, issue: before(now.lane.issue) } };

    expect(parseFactory(JSON.parse(JSON.stringify(saved)))).toEqual(now);
  });

  describe("saved while Jev still sorted who picks an issue up", () => {
    /** An issue as it was saved before it carried `openDecision`. */
    const before = ({ openDecision: _, ...issue }: Issue) => issue;
    const sortedHuman = {
      phase: "triaged",
      raw,
      session: SCRIPTED_SESSION,
      knobs: KNOBS.triage,
      issue: before(enriched),
      type: "bug",
      priority: "p1",
      audience: "human",
    };
    const old = (triage: object, lane: object = { phase: "idle" }) =>
      JSON.parse(JSON.stringify({ ...fresh, filed: { builder: "lane-session", lane: KNOBS.lane }, triage, lane })) as unknown;

    it("reads a run sorted for an agent as triaged, and gives every issue in it no open call", async () => {
      const { state } = await runFactory({ sort: agentBug, builder: ["ok"], checks: [green] });
      if (state.triage.phase !== "triaged" || state.lane.phase !== "done") throw new Error("expected a finished lane");
      const saved = {
        ...state,
        triage: { ...state.triage, issue: before(state.triage.issue), audience: "agent" },
        lane: { ...state.lane, issue: before(state.lane.issue) },
      };

      expect(parseFactory(JSON.parse(JSON.stringify(saved)))).toEqual(state);
    });

    it("parks a run sorted for a person on what call it rests on, and carries on once the owner makes it", async () => {
      const read = parseFactory(old(sortedHuman)) as Factory;
      const { state, enrichments } = await driveFactory(
        read,
        answer({ park: "needs_decision", answer: { kind: "decide", ruling: "Drop them." } }),
        { enricher: [enriched], sort: agentBug, builder: ["ok"], checks: [green] },
      );

      expect(read.triage).toEqual({
        phase: "parked",
        raw,
        session: SCRIPTED_SESSION,
        facts: null,
        knobs: KNOBS.triage,
        why: { kind: "needs_decision", issue: enriched, question: SORTED_FOR_A_PERSON },
      });
      expect(enrichments[0]?.note).toBe(rulingNote(SORTED_FOR_A_PERSON, "Drop them."));
      expect(state.lane).toMatchObject({ phase: "done" });
    });

    it("parks a run Jev was unsure about only on the audience the same way, and keeps any other unsure answer", () => {
      const parkedOn = (answers: readonly object[]) => {
        const { type: _t, priority: _p, audience: _a, issue, ...held } = sortedHuman;
        return (parseFactory(old({ ...held, phase: "parked", why: { kind: "sort_unsure", issue, answers } })) as Factory).triage;
      };
      const audience = { question: "audience", choice: "human", confidence: 0.52 };
      const type = { question: "type", choice: "feature", confidence: 0.5 };

      expect(parkedOn([audience])).toMatchObject({
        phase: "parked",
        why: { kind: "needs_decision", issue: enriched, question: unsureForAPerson("human", 0.52) },
      });
      expect(parkedOn([type, audience])).toMatchObject({ phase: "parked", why: { kind: "sort_unsure", answers: [type] } });
    });

    it("re-asks a sort that was in flight with the questions asked now", async () => {
      const [slice] = sortAsk.attempt(sortAsk.init(), SORT_KEY, sortContent(enriched), 0);
      const call = slice.calls[SORT_KEY];
      if (call?.phase !== "running") throw new Error("expected a running sort");
      const asked = { type: "choice", instructions: "Who can pick this up as it is written?", criteria: { agent: "a", human: "b" } };
      const sort = { ...slice, calls: { [SORT_KEY]: { ...call, input: { ...call.input, questions: { ...call.input.questions, audience: asked } } } } };
      const { type: _t, priority: _p, audience: _a, ...held } = sortedHuman;
      const read = parseFactory(old({ ...held, phase: "sorting", sort })) as Factory;

      const { state, trace } = await driveFactory(read, { type: "resume", at: 1 }, { sort: agentBug, builder: ["ok"], checks: [green] });
      const resent = trace.find((entry) => entry.kind === "cmd" && entry.cmd.type === "sort_run");

      expect(resent?.kind === "cmd" && resent.cmd.type === "sort_run" ? Object.keys(resent.cmd.input.questions) : []).toEqual([
        "type",
        "priority",
        "value",
      ]);
      expect(state.triage).toMatchObject({ phase: "triaged", issue: enriched });
      expect(state.lane).toMatchObject({ phase: "done" });
    });

    it("tells an enricher that was working again with no note", () => {
      const { type: _t, priority: _p, audience: _a, issue: _i, ...held } = sortedHuman;

      expect((parseFactory(old({ ...held, phase: "enriching" })) as Factory).triage).toMatchObject({
        phase: "enriching",
        enrichment: { phase: "writing", note: null },
      });
      expect((parseFactory(old({ ...held, phase: "parked", why: { kind: "enricher_failed" } })) as Factory).triage).toMatchObject({
        why: { kind: "enricher_failed", enrichment: { phase: "write_failed", note: null } },
      });
    });

    it("keeps Jev's type and priority on a filing parked as not worth doing, without the audience", () => {
      const { type, priority, audience, issue, ...held } = sortedHuman;
      const why = { kind: "not_worth_doing", issue, clause: "self_generated_churn", sorted: { type, priority, audience } };
      const read = (parseFactory(old({ ...held, phase: "parked", why })) as Factory).triage;

      expect(read).toMatchObject({ why: { kind: "not_worth_doing", issue: enriched, sorted: { type, priority } } });
      expect(read.phase === "parked" && read.why.kind === "not_worth_doing" ? read.why.sorted : null).not.toHaveProperty("audience");
    });
  });

  it("refuses a shape it does not know", () => {
    expect(parseFactory({ triage: { phase: "idle" } })).toBeInstanceOf(Refusal);
    expect(parseFactory({ ...fresh, filed: "lane-session" })).toBeInstanceOf(Refusal);
  });
});
